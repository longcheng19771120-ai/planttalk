// Which AI backend the server talks to.
//
//   AI_PROVIDER=local  (default) — any OpenAI-compatible local server, such as
//                       Ollama or LM Studio, for vision and chat. Speech-to-text
//                       goes to an optional local Whisper server; text-to-speech
//                       uses the browser's built-in voices.
//   AI_PROVIDER=openai — the original OpenAI setup (gpt-5.4 vision + Realtime voice).

import type { Response } from "express";
import OpenAI from "openai";

export type AiProvider = "local" | "openai";

export function getAiProvider(): AiProvider {
  return process.env.AI_PROVIDER?.trim().toLowerCase() === "openai" ? "openai" : "local";
}

export const LOCAL_LLM_BASE_URL = readEnv("LOCAL_LLM_BASE_URL") ?? "http://127.0.0.1:11434/v1";
export const LOCAL_VISION_MODEL = readEnv("LOCAL_VISION_MODEL") ?? "qwen3.8";
export const LOCAL_CHAT_MODEL = readEnv("LOCAL_CHAT_MODEL") ?? LOCAL_VISION_MODEL;

// Thinking models (Qwen 3.8 thinks by default) are too slow for spoken replies,
// so voice turns ask for no reasoning unless LOCAL_CHAT_THINKING=on.
export const LOCAL_CHAT_THINKING = readEnv("LOCAL_CHAT_THINKING")?.toLowerCase() === "on";

// Optional. When unset, the browser's own speech recognition is used instead.
export const LOCAL_STT_BASE_URL = readEnv("LOCAL_STT_BASE_URL");
export const LOCAL_STT_MODEL = readEnv("LOCAL_STT_MODEL") ?? "Systran/faster-whisper-small";

let llmClient: OpenAI | null = null;
let sttClient: OpenAI | null = null;

// Local servers ignore the key, but the SDK requires a non-empty one.
export function getLocalLlmClient() {
  llmClient ??= new OpenAI({ baseURL: LOCAL_LLM_BASE_URL, apiKey: readEnv("LOCAL_LLM_API_KEY") ?? "local" });
  return llmClient;
}

export function getLocalSttClient() {
  if (!LOCAL_STT_BASE_URL) return null;
  sttClient ??= new OpenAI({ baseURL: LOCAL_STT_BASE_URL, apiKey: readEnv("LOCAL_STT_API_KEY") ?? "local" });
  return sttClient;
}

export function ensureLocalProvider(res: Response) {
  if (getAiProvider() !== "local") {
    res.status(400).json({ error: "This endpoint is only used when AI_PROVIDER=local." });
    return false;
  }
  return true;
}

function readEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}
