// POST /api/diagnose — plant photo + context → structured health check
// (pests, diseases, and care problems). Same two backends as /api/observe.

import type { Request, Response } from "express";
import { zodTextFormat } from "openai/helpers/zod";
import { getAiProvider } from "./ai-config";
import { describeLocalError, localStructuredVision } from "./local";
import {
  abortOnDisconnect,
  abortOnDisconnectOrTimeout,
  localModelLabel,
  plantAnalysisModel,
  readBoundedString,
  validateImageDataUrl,
} from "./observe";
import { ensureApiKey, getOpenAI } from "./openai";
import { PLANT_HEALTH_PROMPTS } from "../src/lib/plant/prompts";
import { plantHealthDiagnosisSchema } from "../src/lib/plant/schemas";

export async function handleDiagnoseRequest(req: Request, res: Response) {
  const isLocal = getAiProvider() === "local";
  if (!isLocal && !ensureApiKey(res)) return;

  const imageDataUrl = validateImageDataUrl(req.body?.image, res);
  if (!imageDataUrl) return;

  const contextSummary = readBoundedString(req.body?.context, 3000) ?? "No sensor or care context available.";
  const userPrompt = PLANT_HEALTH_PROMPTS.user({ contextSummary });

  if (isLocal) {
    try {
      const diagnosis = await localStructuredVision({
        schema: plantHealthDiagnosisSchema,
        schemaName: "plant_health_diagnosis",
        system: PLANT_HEALTH_PROMPTS.system,
        user: userPrompt,
        imageDataUrl,
        signal: abortOnDisconnect(res),
      });
      res.json({ diagnosis, model: `${localModelLabel} health check` });
    } catch (error) {
      console.error("Local plant diagnosis error:", error);
      res.status(502).json({ error: describeLocalError(error, "植物健康诊断失败。") });
    }
    return;
  }

  try {
    const response = await getOpenAI().responses.parse(
      {
        model: plantAnalysisModel,
        input: [
          { role: "system", content: [{ type: "input_text", text: PLANT_HEALTH_PROMPTS.system }] },
          {
            role: "user",
            content: [
              { type: "input_text", text: userPrompt },
              { type: "input_image", image_url: imageDataUrl, detail: "high" },
            ],
          },
        ],
        text: { format: zodTextFormat(plantHealthDiagnosisSchema, "plant_health_diagnosis") },
      },
      { signal: abortOnDisconnectOrTimeout(res) },
    );

    if (!response.output_parsed) {
      res.status(502).json({ error: "The model did not return a structured health check." });
      return;
    }

    res.json({
      diagnosis: plantHealthDiagnosisSchema.parse(response.output_parsed),
      model: `${plantAnalysisModel} health check`,
    });
  } catch (error) {
    console.error("Plant diagnosis error:", error);
    res.status(500).json({ error: "植物健康诊断失败。" });
  }
}
