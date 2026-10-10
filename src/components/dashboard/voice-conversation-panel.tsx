import { useEffect, useRef, useState } from "react";
import { PLANT_NAME, PLANT_VOICES } from "@/lib/plant/realtime-config";
import { selectIsConversationActive, useConversationStore } from "@/stores/plant/conversation-store";
import { useMicrophoneStore } from "@/stores/plant/microphone-store";
import { useAiConfigStore } from "@/stores/plant/ai-config-store";
import { conversationStatusLabel } from "@/lib/plant/labels";
import { actionGlyph, type ActionStatus } from "@/components/dashboard/action-glyph";

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

// Local mode speaks with the browser's own voices, which load asynchronously.
function useBrowserVoices(enabled: boolean) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!enabled || typeof window === "undefined" || !window.speechSynthesis) return;
    const synth = window.speechSynthesis;
    const update = () => setVoices(synth.getVoices());
    update();
    synth.addEventListener("voiceschanged", update);
    return () => synth.removeEventListener("voiceschanged", update);
  }, [enabled]);
  return voices;
}

// The connection owns a detached audio element created inside the click gesture.
export function VoiceConversationPanel() {
  const status = useConversationStore((s) => s.status);
  const statusDetail = useConversationStore((s) => s.statusDetail);
  const isMuted = useConversationStore((s) => s.isMuted);
  const isUserSpeaking = useConversationStore((s) => s.isUserSpeaking);
  const isPlantSpeaking = useConversationStore((s) => s.isPlantSpeaking);
  const transcript = useConversationStore((s) => s.transcript);
  const toolActivity = useConversationStore((s) => s.toolActivity);
  const debugEvents = useConversationStore((s) => s.debugEvents);
  const errorMessage = useConversationStore((s) => s.errorMessage);
  const connect = useConversationStore((s) => s.connect);
  const disconnect = useConversationStore((s) => s.disconnect);
  const toggleMute = useConversationStore((s) => s.toggleMute);
  const clearTranscript = useConversationStore((s) => s.clearTranscript);
  const isActive = useConversationStore(selectIsConversationActive);

  const availableMicrophones = useMicrophoneStore((s) => s.availableMicrophones);
  const selectedMicrophoneId = useMicrophoneStore((s) => s.selectedMicrophoneId);
  const refreshMicrophoneList = useMicrophoneStore((s) => s.refreshMicrophoneList);
  const selectMicrophone = useMicrophoneStore((s) => s.selectMicrophone);
  const selectedVoice = useConversationStore((s) => s.selectedVoice);
  const setVoice = useConversationStore((s) => s.setVoice);
  const provider = useAiConfigStore((s) => s.provider);
  const browserVoices = useBrowserVoices(provider === "local");

  const transcriptEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [transcript]);

  // Voice is billed per minute, so show how long the call has been connected.
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (status !== "connected") {
      setElapsedMs(0);
      return;
    }
    const startedAt = Date.now();
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    return () => clearInterval(id);
  }, [status]);

  // Device labels fill in after microphone permission is granted.
  useEffect(() => {
    void refreshMicrophoneList();

    if (!("mediaDevices" in navigator) || !navigator.mediaDevices.addEventListener) return;
    const onDeviceChange = () => void refreshMicrophoneList();
    navigator.mediaDevices.addEventListener("devicechange", onDeviceChange);
    return () => navigator.mediaDevices.removeEventListener("devicechange", onDeviceChange);
  }, [refreshMicrophoneList]);

  // The selected mic may have been unplugged since last session.
  const selectionMissing =
    selectedMicrophoneId !== null &&
    availableMicrophones.length > 0 &&
    !availableMicrophones.some((mic) => mic.deviceId === selectedMicrophoneId);

  const actionStatus: ActionStatus =
    status === "connected"
      ? "done"
      : status === "requesting-mic" || status === "minting-token" || status === "connecting"
        ? "working"
        : status === "error"
          ? "error"
          : "todo";

  return (
    <article>
      <header>
        {actionGlyph(actionStatus)} <strong>和{PLANT_NAME}聊天</strong> <small>（{conversationStatusLabel(status)}）</small>
      </header>

      {availableMicrophones.length > 0 && (
        <label>
          麦克风
          <select
            value={selectedMicrophoneId ?? ""}
            disabled={isActive}
            onChange={(event) => selectMicrophone(event.target.value || null)}
          >
            <option value="">浏览器默认</option>
            {availableMicrophones.map((mic) => (
              <option key={mic.deviceId} value={mic.deviceId}>
                {mic.label}
              </option>
            ))}
          </select>
          {isActive && <small>挂断后才能切换麦克风。</small>}
          {selectionMissing && <small>之前选择的麦克风未连接。</small>}
        </label>
      )}

      <label>
        声音
        {provider === "openai" ? (
          <select value={selectedVoice} disabled={isActive} onChange={(event) => setVoice(event.target.value)}>
            {PLANT_VOICES.map((voice) => (
              <option key={voice} value={voice}>
                {titleCase(voice)}
              </option>
            ))}
          </select>
        ) : (
          <select
            value={browserVoices.some((voice) => voice.name === selectedVoice) ? selectedVoice : ""}
            disabled={isActive}
            onChange={(event) => setVoice(event.target.value)}
          >
            <option value="">自动（匹配回复的语言）</option>
            {browserVoices.map((voice) => (
              <option key={voice.name} value={voice.name}>
                {voice.name} ({voice.lang})
              </option>
            ))}
          </select>
        )}
        {isActive && <small>挂断后才能更换声音。</small>}
      </label>

      {status === "connected" && (
        <div>
          <small>
            ⏱ {formatElapsed(elapsedMs)} · 你 {isUserSpeaking ? "🎙️ 说话中" : "·"} — {PLANT_NAME}{" "}
            {isPlantSpeaking ? "🪴 说话中" : "·"}
          </small>
          <LevelMeters />
          <small>
            {provider === "openai"
              ? "静默一分钟后自动挂断，以节省 API 费用。"
              : "正在使用本地模型。静默 90 秒后自动挂断。"}
          </small>
        </div>
      )}

      {transcript.length > 0 && (
        <div className="transcript">
          {transcript.map((entry) => (
            <p key={entry.id} className={entry.role === "user" ? "transcript-user" : "transcript-plant"}>
              <small>
                <strong>{entry.role === "user" ? "你" : PLANT_NAME}：</strong> {entry.text || "…"}
              </small>
            </p>
          ))}
          <div ref={transcriptEndRef} />
        </div>
      )}

      {toolActivity.length > 0 && (
        <details>
          <summary>
            <small>
              {PLANT_NAME}感知了 {toolActivity.length} 次自身状态 🔧
            </small>
          </summary>
          <ul>
            {toolActivity.map((entry) => (
              <li key={entry.callId}>
                <small>
                  <code>{entry.name}</code> → <code>{entry.result ?? "运行中…"}</code>
                </small>
              </li>
            ))}
          </ul>
        </details>
      )}

      {debugEvents.length > 0 && (
        <details>
          <summary>
            <small>原始服务器事件（最近 {debugEvents.length} 条）</small>
          </summary>
          <p>
            <small>
              <code>{debugEvents.map((e) => e.type).join(" · ")}</code>
            </small>
          </p>
        </details>
      )}

      {errorMessage && (
        <p>
          <mark>{errorMessage}</mark>
        </p>
      )}
      {statusDetail && (status === "error" || status === "disconnected") && (
        <p>
          <small>{statusDetail}</small>
        </p>
      )}

      <footer>
        <div role="group">
          <button
            type="button"
            aria-busy={isActive && status !== "connected"}
            onClick={isActive ? disconnect : () => void connect()}
          >
            {isActive ? "挂断" : `和${PLANT_NAME}聊天`}
          </button>
          {status === "connected" && (
            <button type="button" className="secondary" onClick={toggleMute}>
              {isMuted ? "打开麦克风" : "静音麦克风"}
            </button>
          )}
          {transcript.length > 0 && !isActive && (
            <button type="button" className="secondary" onClick={clearTranscript}>
              清除对话记录
            </button>
          )}
        </div>
        <small>
          在 <code>src/lib/plant/realtime-config.ts</code> 中的 <code>PLANT_INSTRUCTIONS</code> 字符串里自定义{PLANT_NAME}的性格。
        </small>
      </footer>
    </article>
  );
}

// Draw audio levels outside React state; they change every animation frame.
function LevelMeters() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const getLocalAnalyser = useConversationStore((s) => s.getLocalAnalyser);
  const getRemoteAnalyser = useConversationStore((s) => s.getRemoteAnalyser);

  useEffect(() => {
    let frameId: number;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const buffer = new Uint8Array(128);

    const levelFrom = (analyser: AnalyserNode | null) => {
      if (!analyser) return 0;
      analyser.getByteFrequencyData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) sum += buffer[i];
      return sum / buffer.length / 255;
    };

    const draw = () => {
      const width = canvas.width;
      const height = canvas.height;
      context.clearRect(0, 0, width, height);

      const localLevel = levelFrom(getLocalAnalyser());
      const remoteLevel = levelFrom(getRemoteAnalyser());

      // You (top bar, green) and the plant (bottom bar, amber).
      context.fillStyle = "#4ade80";
      context.fillRect(0, 2, width * localLevel, height / 2 - 4);
      context.fillStyle = "#fbbf24";
      context.fillRect(0, height / 2 + 2, width * remoteLevel, height / 2 - 4);

      frameId = requestAnimationFrame(draw);
    };

    frameId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frameId);
  }, [getLocalAnalyser, getRemoteAnalyser]);

  return <canvas ref={canvasRef} width={300} height={28} className="level-meters" />;
}
