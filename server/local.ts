// Local-model handlers: structured vision, voice chat, and speech-to-text, all
// through OpenAI-compatible endpoints (Ollama, LM Studio, a Whisper server).

import type { Request, Response } from "express";
import OpenAI, { toFile } from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { z } from "zod";
import {
  LOCAL_CHAT_MODEL,
  LOCAL_CHAT_THINKING,
  LOCAL_STT_MODEL,
  LOCAL_VISION_MODEL,
  ensureLocalProvider,
  getLocalLlmClient,
  getLocalSttClient,
} from "./ai-config";
import { PLANT_LOCAL_INSTRUCTIONS } from "../src/lib/plant/realtime-config";

// Local models on modest hardware are slower than the hosted API.
const LOCAL_VISION_TIMEOUT_MS = 300_000;
const LOCAL_CHAT_TIMEOUT_MS = 120_000;
const LOCAL_STT_TIMEOUT_MS = 60_000;

const MAX_CHAT_MESSAGES = 24;
const MAX_CHAT_MESSAGE_LENGTH = 2000;
const MAX_CHAT_CONTEXT_LENGTH = 6000;

// Structured vision

export async function localStructuredVision<T extends z.ZodType>({
  schema,
  schemaName,
  system,
  user,
  imageDataUrl,
  signal,
}: {
  schema: T;
  schemaName: string;
  system: string;
  user: string;
  imageDataUrl: string;
  signal?: AbortSignal;
}): Promise<z.infer<T>> {
  const completion = await getLocalLlmClient().chat.completions.create(
    {
      model: LOCAL_VISION_MODEL,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "text", text: user },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
      // Ollama and LM Studio constrain decoding to this JSON schema.
      response_format: zodResponseFormat(schema, schemaName),
    },
    { signal, timeout: LOCAL_VISION_TIMEOUT_MS, maxRetries: 0 },
  );

  const content = completion.choices[0]?.message?.content ?? "";
  return parseModelJson(schema, content);
}

// Small models sometimes wrap JSON in fences or overshoot a length limit.
// Repair what can be repaired mechanically; reject anything structurally wrong.
export function parseModelJson<T extends z.ZodType>(schema: T, content: string): z.infer<T> {
  const cleaned = stripThinking(content)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let data: unknown;
  try {
    data = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("The local model did not return JSON.");
    data = JSON.parse(match[0]);
  }

  const first = schema.safeParse(data);
  if (first.success) return first.data;

  for (const issue of first.error.issues) {
    repairIssue(data, issue);
  }

  const second = schema.safeParse(data);
  if (second.success) return second.data;

  // Values that are only too short (e.g. two observer thoughts instead of
  // three) are still usable by the app.
  if (second.error.issues.every((issue) => issue.code === "too_small" && issue.origin !== "number")) {
    return data as z.infer<T>;
  }

  throw new Error(
    `The local model returned JSON that does not match the expected shape: ${second.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`)
      .join("; ")}`,
  );
}

function repairIssue(root: unknown, issue: z.core.$ZodIssue) {
  if (issue.path.length === 0) return;
  const parentPath = issue.path.slice(0, -1);
  const key = issue.path[issue.path.length - 1] as string | number;
  let parent: unknown = root;
  for (const segment of parentPath) {
    if (parent === null || typeof parent !== "object") return;
    parent = (parent as Record<PropertyKey, unknown>)[segment as PropertyKey];
  }
  if (parent === null || typeof parent !== "object") return;
  const container = parent as Record<string | number, unknown>;
  const value = container[key];

  if (issue.code === "too_big") {
    const maximum = Number(issue.maximum);
    if (typeof value === "string") container[key] = value.slice(0, maximum).trim();
    else if (Array.isArray(value)) container[key] = value.slice(0, maximum);
    else if (typeof value === "number") container[key] = maximum;
  } else if (issue.code === "too_small" && typeof value === "number") {
    container[key] = Number(issue.minimum);
  } else if (issue.code === "invalid_type") {
    const asNumber = typeof value === "string" ? Number(value) : value;
    if (typeof asNumber === "number" && Number.isFinite(asNumber)) {
      container[key] = issue.expected === "int" ? Math.round(asNumber) : asNumber;
    }
  }
}

function stripThinking(text: string) {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

// POST /api/chat — one conversational turn with the local chat model.
// Body: { messages: [{ role: "user" | "assistant", content }], context?: string }

export async function handleLocalChatRequest(req: Request, res: Response) {
  if (!ensureLocalProvider(res)) return;

  const messages = parseChatMessages(req.body?.messages);
  if (!messages) {
    res.status(400).json({ error: "A non-empty list of chat messages is required." });
    return;
  }
  const context =
    typeof req.body?.context === "string" ? req.body.context.slice(0, MAX_CHAT_CONTEXT_LENGTH) : "";

  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  const request: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
    model: LOCAL_CHAT_MODEL,
    temperature: 0.8,
    max_tokens: 300,
    messages: [
      {
        role: "system",
        content: context ? `${PLANT_LOCAL_INSTRUCTIONS}\n\nCURRENT SENSES\n${context}` : PLANT_LOCAL_INSTRUCTIONS,
      },
      ...messages,
    ],
  };
  const requestOptions = { signal: controller.signal, timeout: LOCAL_CHAT_TIMEOUT_MS, maxRetries: 0 };

  try {
    let completion: OpenAI.Chat.ChatCompletion;
    if (LOCAL_CHAT_THINKING) {
      completion = await getLocalLlmClient().chat.completions.create(request, requestOptions);
    } else {
      try {
        // Ollama maps reasoning_effort "none" to think=false.
        completion = await getLocalLlmClient().chat.completions.create(
          { ...request, reasoning_effort: "none" as OpenAI.ReasoningEffort },
          requestOptions,
        );
      } catch (error) {
        // Servers or models that don't understand the field: ask again without it.
        if (!(error instanceof OpenAI.BadRequestError)) throw error;
        completion = await getLocalLlmClient().chat.completions.create(request, requestOptions);
      }
    }

    const reply = cleanSpokenReply(completion.choices[0]?.message?.content ?? "");
    if (!reply) {
      res.status(502).json({ error: "The local model returned an empty reply." });
      return;
    }
    res.json({ reply, model: LOCAL_CHAT_MODEL });
  } catch (error) {
    console.error("Local chat error:", error);
    res.status(502).json({ error: describeLocalError(error, "Failed to get a reply from the local model.") });
  }
}

function parseChatMessages(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const entry of value.slice(-MAX_CHAT_MESSAGES)) {
    if (!entry || typeof entry !== "object") return null;
    const { role, content } = entry as { role?: unknown; content?: unknown };
    if ((role !== "user" && role !== "assistant") || typeof content !== "string" || !content.trim()) return null;
    messages.push({ role, content: content.slice(0, MAX_CHAT_MESSAGE_LENGTH) });
  }
  return messages;
}

// The reply is read aloud, so drop markup a speech engine would pronounce.
function cleanSpokenReply(text: string) {
  return stripThinking(text)
    .replace(/[*_`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// POST /api/transcribe — raw audio body → { text } via a local Whisper server.

export async function handleLocalTranscribeRequest(req: Request, res: Response) {
  if (!ensureLocalProvider(res)) return;

  const client = getLocalSttClient();
  if (!client) {
    res.status(400).json({ error: "LOCAL_STT_BASE_URL is not set, so the browser handles speech recognition." });
    return;
  }

  const audio = req.body;
  if (!Buffer.isBuffer(audio) || audio.length === 0) {
    res.status(400).json({ error: "An audio recording is required." });
    return;
  }

  const contentType = req.headers["content-type"] ?? "audio/webm";
  const extension = contentType.includes("ogg") ? "ogg" : contentType.includes("mp4") ? "m4a" : "webm";

  try {
    const transcription = await client.audio.transcriptions.create(
      { file: await toFile(audio, `speech.${extension}`, { type: contentType }), model: LOCAL_STT_MODEL },
      { timeout: LOCAL_STT_TIMEOUT_MS, maxRetries: 0 },
    );
    res.json({ text: transcription.text.trim() });
  } catch (error) {
    console.error("Local transcription error:", error);
    res.status(502).json({ error: describeLocalError(error, "Failed to transcribe speech locally.") });
  }
}

export function describeLocalError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error);
  if (/ECONNREFUSED|fetch failed|Connection error/i.test(message)) {
    return `${fallback} The local model server is not reachable. Is Ollama (or your local server) running?`;
  }
  if (/not found|404/i.test(message)) {
    return `${fallback} The model was not found. Pull it first, for example: ollama pull ${LOCAL_VISION_MODEL}`;
  }
  return `${fallback} (${message})`;
}
