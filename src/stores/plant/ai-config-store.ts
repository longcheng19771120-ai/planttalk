import { create } from "zustand";

// Which AI backend the server is configured for (AI_PROVIDER in .env). The
// voice panel needs to know: OpenAI uses the Realtime WebRTC call, local mode
// chains speech recognition → local chat model → the browser's own voices.

export type AiProvider = "local" | "openai";
export type SpeechRecognitionMode = "server" | "browser";

interface AiConfigState {
  provider: AiProvider;
  speechRecognition: SpeechRecognitionMode;
  isLoaded: boolean;
  load: () => Promise<void>;
}

let inFlight: Promise<void> | null = null;

export const useAiConfigStore = create<AiConfigState>()((set, get) => ({
  provider: "local",
  speechRecognition: "browser",
  isLoaded: false,

  load: () => {
    if (get().isLoaded) return Promise.resolve();
    inFlight ??= fetch("/api/config")
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as { provider?: string; speechRecognition?: string };
        set({
          provider: data.provider === "openai" ? "openai" : "local",
          speechRecognition: data.speechRecognition === "server" ? "server" : "browser",
          isLoaded: true,
        });
      })
      .catch((error) => {
        console.warn("[config] Could not load AI config, assuming local models:", error);
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  },
}));
