// Express server — the only backend this project needs.
//
// Three jobs:
//   1. Talk to the AI backend — local models by default, or OpenAI — so the
//      browser never sees an API key or a model server address.
//   2. Serve the built SPA in production (`npm run build` then `npm start`).
//   3. Stay on this computer: it binds to 127.0.0.1 unless HOST says otherwise,
//      because these endpoints have no login.
//
// In development, Vite serves the app on :3000 and proxies `/api/*` here
// (see vite.config.ts). Run both with `npm run dev`.

import "./env"; // must stay the first import — loads .env before anything reads it
import path from "node:path";
import express from "express";
import {
  LOCAL_CHAT_MODEL,
  LOCAL_LLM_BASE_URL,
  LOCAL_STT_BASE_URL,
  LOCAL_VISION_MODEL,
  getAiProvider,
} from "./ai-config";
import { handleDiagnoseRequest } from "./diagnose";
import { handleLocalChatRequest, handleLocalTranscribeRequest } from "./local";
import { handleAnalyzeRequest, handleObserveRequest } from "./observe";
import { isApiKeyConfigured } from "./openai";
import { handleRealtimeTokenRequest } from "./realtime";

const PORT = Number(process.env.PORT ?? 3001);
// Only reachable from this computer by default. Set HOST=0.0.0.0 to share it on
// your network — anyone who can reach it can then use your models or API key.
const HOST = process.env.HOST?.trim() || "127.0.0.1";

const app = express();

// Camera frames arrive as base64 data URLs inside JSON bodies, so the
// default 100kb body limit is far too small.
app.use(express.json({ limit: "12mb" }));

// POST /api/analyze — one-shot image → structured plant attributes (the upload tester).
app.post("/api/analyze", handleAnalyzeRequest);

// POST /api/observe — camera frame + sensor readings + history → structured
// observation. Optionally streams the model's reasoning summaries as NDJSON.
app.post("/api/observe", handleObserveRequest);

// POST /api/diagnose — plant photo + sensor and care context → structured
// health check for pests, diseases, and care problems.
app.post("/api/diagnose", handleDiagnoseRequest);

// GET /api/config — tells the browser which voice pipeline to use.
app.get("/api/config", (_req, res) => {
  res.json({
    provider: getAiProvider(),
    speechRecognition: LOCAL_STT_BASE_URL ? "server" : "browser",
  });
});

// POST /api/chat — local mode: one voice-conversation turn with the local model.
app.post("/api/chat", handleLocalChatRequest);

// POST /api/transcribe — local mode: recorded speech → text via a local Whisper server.
app.post("/api/transcribe", express.raw({ type: ["audio/*", "video/webm"], limit: "10mb" }), handleLocalTranscribeRequest);

// POST /api/realtime-token — mints a short-lived client secret so the browser
// can open a WebRTC voice session with the Realtime API (the plant's voice).
app.post("/api/realtime-token", handleRealtimeTokenRequest);

// In production, serve the static build output and fall back to index.html
// for any non-API path (single-page app).
const distDir = path.join(process.cwd(), "dist");
app.use(express.static(distDir));
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

app.listen(PORT, HOST, () => {
  console.log(`[server] listening on http://${HOST === "127.0.0.1" ? "localhost" : HOST}:${PORT}`);
  if (getAiProvider() === "local") {
    console.log(`[server] AI provider: local models at ${LOCAL_LLM_BASE_URL}`);
    console.log(`[server]   vision: ${LOCAL_VISION_MODEL} · chat: ${LOCAL_CHAT_MODEL}`);
    console.log(
      `[server]   speech recognition: ${LOCAL_STT_BASE_URL ? `Whisper server at ${LOCAL_STT_BASE_URL}` : "browser built-in"}`,
    );
  } else if (!isApiKeyConfigured()) {
    console.warn("[server] OpenAI setup is incomplete — run npm run setup and finish .env setup.");
  }
});
