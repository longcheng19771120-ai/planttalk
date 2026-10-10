// Voice conversation for local mode (AI_PROVIDER=local).
//
// The OpenAI Realtime API does speech-in → speech-out in one WebRTC call. With
// local models the same loop is assembled from three parts:
//
//   1. Speech → text: a local Whisper server behind /api/transcribe (when
//      LOCAL_STT_BASE_URL is set), otherwise the browser's built-in speech
//      recognition. Note: Chrome and Edge run their built-in recognition in
//      the cloud, so only the Whisper route keeps audio on this computer.
//   2. Text → reply: the local chat model behind /api/chat. Instead of tool
//      calls, the plant's current senses are attached to every turn.
//   3. Reply → speech: the browser's speechSynthesis voices (local to the OS).
//
// It reports progress through the same callbacks as RealtimeVoiceConnection,
// so the conversation store and the dashboard don't care which one is running.

import type { RealtimeConnectionCallbacks } from "@/lib/plant/realtime-connection";

export interface VoiceConnection {
  connect: () => Promise<void>;
  disconnect: (reason?: string) => void;
  setMuted: (muted: boolean) => void;
  getLocalAnalyser: () => AnalyserNode | null;
  getRemoteAnalyser: () => AnalyserNode | null;
}

export interface LocalVoiceOptions {
  micDeviceId?: string | null;
  /** A speechSynthesis voice name; empty picks one matching the reply's language. */
  voice?: string | null;
  speechRecognition: "server" | "browser";
}

// No API meter is running, but a forgotten open mic still shouldn't listen forever.
const IDLE_TIMEOUT_MS = 90_000;
const MAX_HISTORY_MESSAGES = 16;

// Simple level-based voice activity detection for the Whisper route.
const VAD_POLL_MS = 50;
const VAD_START_LEVEL = 0.03;
const VAD_END_SILENCE_MS = 900;
const MIN_UTTERANCE_MS = 350;
const MAX_UTTERANCE_MS = 20_000;

// Each turn reads both senses up front and shows them in the tool activity log.
const SENSE_CALLS = [
  { name: "get_current_sensors", args: "{}" },
  { name: "get_observation_history", args: JSON.stringify({ window: "recent" }) },
] as const;

type Phase = "listening" | "thinking" | "speaking";

export class LocalVoiceConnection implements VoiceConnection {
  private callbacks: RealtimeConnectionCallbacks;
  private options: LocalVoiceOptions;
  private phase: Phase = "listening";
  private cancelled = false;
  private muted = false;

  private micStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private localAnalyser: AnalyserNode | null = null;

  private recognition: SpeechRecognitionLike | null = null;
  private recognitionRunning = false;

  private recorder: MediaRecorder | null = null;
  private recordingStartedAt = 0;
  private lastVoiceAt = 0;
  private vadTimer: ReturnType<typeof setInterval> | null = null;

  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private requestController: AbortController | null = null;
  private history: Array<{ role: "user" | "assistant"; content: string }> = [];
  private turn = 0;

  constructor(callbacks: RealtimeConnectionCallbacks, options: LocalVoiceOptions) {
    this.callbacks = callbacks;
    this.options = options;
  }

  getLocalAnalyser() {
    return this.localAnalyser;
  }

  // Browser speech synthesis can't be routed through an AnalyserNode.
  getRemoteAnalyser() {
    return null;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.micStream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    if (this.phase !== "listening") return;
    if (muted) this.stopListening();
    else this.startListening();
  }

  async connect(): Promise<void> {
    try {
      this.callbacks.onStatusChange("requesting-mic");
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...(this.options.micDeviceId ? { deviceId: { exact: this.options.micDeviceId } } : {}),
      };
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      } catch (micError) {
        if (!this.options.micDeviceId) throw micError;
        console.warn("[local-voice] Selected microphone unavailable, using default:", micError);
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      }
      if (this.cancelled) return this.releaseResources();

      this.callbacks.onStatusChange("connecting");

      const audioContext = new AudioContext();
      this.audioContext = audioContext;
      void audioContext.resume();
      this.localAnalyser = audioContext.createAnalyser();
      this.localAnalyser.fftSize = 512;
      audioContext.createMediaStreamSource(this.micStream).connect(this.localAnalyser);

      if (this.options.speechRecognition === "browser") {
        this.recognition = this.createRecognition();
      } else if (typeof MediaRecorder === "undefined") {
        throw new Error("此浏览器无法为本地语音识别录音。请使用 Chrome 或 Edge。");
      }

      // Voices load asynchronously in Chrome; ask early so they're ready.
      window.speechSynthesis?.getVoices();

      this.callbacks.onStatusChange("connected");
      this.resetIdleTimer();
      this.startListening();
    } catch (error) {
      if (this.cancelled) return this.releaseResources();
      const message =
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "麦克风权限被拒绝。请允许使用麦克风来和植物聊天。"
          : error instanceof Error
            ? error.message
            : "无法开始语音对话。";
      this.fail(message);
    }
  }

  disconnect(reason?: string) {
    this.cancelled = true;
    this.releaseResources();
    this.callbacks.onStatusChange("disconnected", reason);
  }

  private fail(message: string) {
    this.cancelled = true;
    this.releaseResources();
    this.callbacks.onStatusChange("error", message);
    this.callbacks.onError(message);
  }

  // Listening

  private startListening() {
    this.phase = "listening";
    if (this.cancelled || this.muted) return;
    if (this.recognition) this.startRecognition();
    else this.startVad();
  }

  private stopListening() {
    if (this.recognition && this.recognitionRunning) {
      this.recognitionRunning = false;
      try {
        this.recognition.abort();
      } catch {
        // Already stopped.
      }
    }
    if (this.vadTimer) {
      clearInterval(this.vadTimer);
      this.vadTimer = null;
    }
    if (this.recorder) {
      this.recorder.onstop = null;
      if (this.recorder.state !== "inactive") this.recorder.stop();
      this.recorder = null;
    }
  }

  // Browser speech recognition route

  private createRecognition(): SpeechRecognitionLike {
    const Recognition =
      (window as WindowWithSpeech).SpeechRecognition ?? (window as WindowWithSpeech).webkitSpeechRecognition;
    if (!Recognition) {
      throw new Error(
        "此浏览器没有内置语音识别。请使用 Chrome 或 Edge，或将 LOCAL_STT_BASE_URL 设置为本地 Whisper 服务器。",
      );
    }

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "zh-CN";

    recognition.onspeechstart = () => {
      this.resetIdleTimer();
      this.callbacks.onSpeechActivity("user-start");
    };

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result.isFinal) continue;
        const text = result[0]?.transcript.trim();
        if (text) {
          this.stopListening();
          this.callbacks.onSpeechActivity("user-stop");
          void this.handleUtterance(text);
          return;
        }
      }
    };

    // Chrome ends continuous recognition on its own after a stretch of
    // silence; restart it while we're still supposed to be listening.
    recognition.onend = () => {
      const wasRunning = this.recognitionRunning;
      this.recognitionRunning = false;
      if (wasRunning && this.phase === "listening" && !this.muted && !this.cancelled) {
        this.startRecognition();
      }
    };

    recognition.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        this.fail("浏览器拒绝了麦克风或语音识别权限。");
      } else if (event.error === "network") {
        this.fail(
          "浏览器的语音识别无法连接其在线服务（Chrome 和 Edge 在云端识别语音）。如需完全离线的语音识别，请将 LOCAL_STT_BASE_URL 设置为本地 Whisper 服务器。",
        );
      } else if (event.error === "language-not-supported") {
        this.fail(`浏览器无法识别 ${recognition.lang} 语音。`);
      } else {
        this.callbacks.onError(`语音识别出错：${event.error}`);
      }
    };

    return recognition;
  }

  private startRecognition() {
    if (!this.recognition || this.recognitionRunning) return;
    try {
      this.recognition.start();
      this.recognitionRunning = true;
    } catch (error) {
      console.warn("[local-voice] Could not start speech recognition:", error);
    }
  }

  // Local Whisper route: detect speech by level, record it, send it to /api/transcribe.

  private startVad() {
    if (this.vadTimer || !this.micStream) return;
    const samples = new Float32Array(this.localAnalyser?.fftSize ?? 512);
    this.vadTimer = setInterval(() => {
      const analyser = this.localAnalyser;
      if (!analyser) return;
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const level = Math.sqrt(sum / samples.length);
      const now = Date.now();

      if (!this.recorder) {
        if (level > VAD_START_LEVEL) this.beginRecording(now);
        return;
      }

      if (level > VAD_START_LEVEL * 0.6) this.lastVoiceAt = now;
      if (now - this.lastVoiceAt > VAD_END_SILENCE_MS || now - this.recordingStartedAt > MAX_UTTERANCE_MS) {
        this.finishRecording();
      }
    }, VAD_POLL_MS);
  }

  private beginRecording(now: number) {
    if (!this.micStream) return;
    const chunks: Blob[] = [];
    const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((type) =>
      MediaRecorder.isTypeSupported(type),
    );
    const recorder = new MediaRecorder(this.micStream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      const spokenMs = this.lastVoiceAt - this.recordingStartedAt;
      if (this.cancelled) return;
      if (spokenMs < MIN_UTTERANCE_MS) {
        this.startListening();
        return;
      }
      void this.transcribeAndHandle(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
    };
    recorder.start();
    this.recorder = recorder;
    this.recordingStartedAt = now;
    this.lastVoiceAt = now;
    this.resetIdleTimer();
    this.callbacks.onSpeechActivity("user-start");
  }

  private finishRecording() {
    if (this.vadTimer) {
      clearInterval(this.vadTimer);
      this.vadTimer = null;
    }
    const recorder = this.recorder;
    this.recorder = null;
    this.phase = "thinking";
    this.callbacks.onSpeechActivity("user-stop");
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }

  private async transcribeAndHandle(audio: Blob) {
    this.phase = "thinking";
    this.pauseIdleTimer();
    try {
      this.requestController = new AbortController();
      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": audio.type.split(";")[0] || "audio/webm" },
        body: audio,
        signal: this.requestController.signal,
      });
      const data = (await response.json().catch(() => null)) as { text?: string; error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? `语音转写失败（HTTP ${response.status}）。`);
      if (this.cancelled) return;
      const text = data?.text?.trim();
      if (text) {
        await this.handleUtterance(text);
        return;
      }
    } catch (error) {
      if (this.cancelled) return;
      this.callbacks.onError(error instanceof Error ? error.message : "语音转写失败。");
    }
    if (!this.cancelled) {
      this.resetIdleTimer();
      this.startListening();
    }
  }

  // One conversational turn

  private async handleUtterance(text: string) {
    this.phase = "thinking";
    this.pauseIdleTimer();
    this.turn += 1;
    const turn = this.turn;
    this.callbacks.onUserTranscript(`local-user-${turn}`, text, true);
    this.callbacks.onServerEvent?.("local.transcript");
    this.history.push({ role: "user", content: text });

    try {
      const context = await this.readSenses(turn);
      if (this.cancelled) return;

      this.requestController = new AbortController();
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: this.history.slice(-MAX_HISTORY_MESSAGES), context }),
        signal: this.requestController.signal,
      });
      const data = (await response.json().catch(() => null)) as { reply?: string; error?: string } | null;
      if (!response.ok || !data?.reply) {
        throw new Error(data?.error ?? `本地模型没有回答（HTTP ${response.status}）。`);
      }
      if (this.cancelled) return;

      this.callbacks.onServerEvent?.("local.reply");
      this.history.push({ role: "assistant", content: data.reply });
      this.history = this.history.slice(-MAX_HISTORY_MESSAGES);
      await this.speak(data.reply, `local-plant-${turn}`);
    } catch (error) {
      if (this.cancelled) return;
      // Drop the unanswered question so user/assistant turns stay paired.
      if (this.history[this.history.length - 1]?.role === "user") this.history.pop();
      this.callbacks.onError(error instanceof Error ? error.message : "本地模型没有回答。");
    } finally {
      if (!this.cancelled) {
        this.resetIdleTimer();
        this.startListening();
      }
    }
  }

  private async readSenses(turn: number) {
    const lines: string[] = [];
    for (const { name, args } of SENSE_CALLS) {
      const callId = `local-${name}-${turn}`;
      let output: string;
      try {
        output = await this.callbacks.onToolCall({ callId, name, args });
      } catch (error) {
        output = JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Unavailable." });
      }
      this.callbacks.onToolResult(callId, name, output);
      lines.push(`${name}: ${output}`);
    }
    return lines.join("\n");
  }

  private speak(text: string, itemId: string): Promise<void> {
    this.phase = "speaking";
    this.callbacks.onModelTranscript(itemId, text, true);

    const synth = window.speechSynthesis;
    if (!synth) return Promise.resolve();

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(safetyTimer);
        this.callbacks.onSpeechActivity("model-stop");
        resolve();
      };
      // Chrome occasionally never fires onend; don't let that wedge the loop.
      const safetyTimer = setTimeout(finish, 10_000 + text.length * 150);

      const utterance = new SpeechSynthesisUtterance(text);
      const voice = this.pickVoice(text);
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang ?? navigator.language;
      utterance.onstart = () => this.callbacks.onSpeechActivity("model-start");
      utterance.onend = finish;
      utterance.onerror = finish;

      synth.cancel();
      synth.speak(utterance);
    });
  }

  private pickVoice(text: string): SpeechSynthesisVoice | null {
    const voices = window.speechSynthesis?.getVoices() ?? [];
    if (voices.length === 0) return null;
    if (this.options.voice) {
      const chosen = voices.find((voice) => voice.name === this.options.voice);
      if (chosen) return chosen;
    }
    // Match the language the plant actually answered in.
    const language = /[一-鿿]/.test(text) ? "zh" : (navigator.language || "en").split("-")[0];
    const matching = voices.filter((voice) => voice.lang.toLowerCase().startsWith(language.toLowerCase()));
    return matching.find((voice) => voice.localService) ?? matching[0] ?? voices.find((voice) => voice.default) ?? null;
  }

  // Idle timeout

  private resetIdleTimer() {
    this.pauseIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.disconnect("静默 90 秒后已结束。点击重新开始。");
    }, IDLE_TIMEOUT_MS);
  }

  // Local models can take a while to answer; that isn't silence.
  private pauseIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private releaseResources() {
    this.pauseIdleTimer();
    this.stopListening();
    if (this.recognition) {
      this.recognition.onresult = null;
      this.recognition.onend = null;
      this.recognition.onerror = null;
      this.recognition.onspeechstart = null;
      this.recognition = null;
    }
    this.requestController?.abort();
    this.requestController = null;
    window.speechSynthesis?.cancel();

    this.micStream?.getTracks().forEach((track) => track.stop());
    this.micStream = null;
    void this.audioContext?.close().catch(() => {});
    this.audioContext = null;
    this.localAnalyser = null;
  }
}

// Minimal Web Speech API types (not in TypeScript's DOM lib).

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: { transcript: string } | undefined;
}

interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: { readonly length: number; [index: number]: SpeechRecognitionResultLike };
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onspeechstart: (() => void) | null;
  start: () => void;
  abort: () => void;
}

type WindowWithSpeech = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};
