import { z } from "zod";
import { CARE_DIFFICULTIES, HEALTH_LEVELS, ISSUE_CATEGORIES, LIGHT_NEEDS, PLANT_CONDITION_IDS } from "./health";

// Zod schemas for OpenAI structured outputs.

const OBSERVER_THOUGHT_MAX_LENGTH = 120;
const OBSERVER_HYPOTHESIS_MAX_LENGTH = 120;

// One-shot image analysis (the upload tester).
export const plantAttributeAnalysisSchema = z.object({
  dryness: z
    .number()
    .int()
    .min(1)
    .max(10)
    .describe("Estimated dryness on a 1 to 10 scale, where 1 is fully hydrated and 10 is severely dry."),
  size: z
    .number()
    .int()
    .min(1)
    .max(5000)
    .describe("Estimated maximum visible span of the dominant plant in millimeters."),
  branching: z
    .number()
    .int()
    .min(0)
    .max(10)
    .describe(
      "Estimated branching complexity on a 0 to 10 scale based on visible stems, offshoots, or canopy splitting.",
    ),
  physicalTexture: z
    .string()
    .min(2)
    .max(80)
    .describe("Short tactile surface description such as waxy, smooth, fuzzy, fibrous, papery, rough, or spiky."),
});

export const plantTrendDirectionSchema = z
  .enum(["improving", "stable", "declining", "insufficient-data"])
  .describe("Directional read of the plant's wellbeing relative to prior observations.");

export const plantObserverThoughtSchema = z
  .string()
  .min(6)
  .max(OBSERVER_THOUGHT_MAX_LENGTH)
  .describe("A user-visible observer checkpoint grounded in current sensors, visual evidence, or recent history.");

// Periodic observation records saved to the plant's memory.
export const plantObserverResponseSchema = z.object({
  observerThoughts: z
    .array(plantObserverThoughtSchema)
    .min(3)
    .max(6)
    .describe(
      "Short interstitial messages that summarize the model's evidence checks without exposing private chain-of-thought.",
    ),
  observation: z
    .string()
    .min(6)
    .max(160)
    .describe(
      "One neutral, empirical sentence recording what is visible now and how it compares to prior observations.",
    ),
  hypothesis: z
    .string()
    .min(6)
    .max(OBSERVER_HYPOTHESIS_MAX_LENGTH)
    .describe("A short, falsifiable hypothesis about the plant's current state and likely next change."),
  trend: plantTrendDirectionSchema,
  dryness: z
    .number()
    .int()
    .min(1)
    .max(10)
    .describe("Estimated dryness on a 1 to 10 scale, where 1 is fully hydrated and 10 is severely dry."),
});

// Plant health check: pests, diseases, and care problems seen in a photo.
export const plantHealthIssueSchema = z.object({
  category: z.enum(ISSUE_CATEGORIES).describe("What kind of problem this is."),
  conditionId: z
    .enum([...PLANT_CONDITION_IDS, "other"])
    .describe("The matching id from the reference list, or 'other' when none fits."),
  name: z.string().min(2).max(40).describe("Short name of the problem in Simplified Chinese."),
  confidence: z.enum(["low", "medium", "high"]).describe("How sure the visual evidence makes you."),
  severity: z.enum(["mild", "moderate", "severe"]).describe("How much of the plant is affected and how badly."),
  evidence: z.string().min(4).max(160).describe("The visible signs that point to this problem, in Simplified Chinese."),
  treatmentSteps: z
    .array(z.string().min(4).max(100))
    .min(1)
    .max(4)
    .describe("Ordered treatment steps the user can tick off, gentlest first, in Simplified Chinese."),
});

export const plantSpeciesSchema = z.object({
  commonName: z.string().min(1).max(40).describe("Common name in Simplified Chinese."),
  scientificName: z.string().max(60).describe("Latin name, or an empty string when unsure."),
  confidence: z.enum(["low", "medium", "high"]).describe("How sure the photo makes you of the species."),
  careDifficulty: z.enum(CARE_DIFFICULTIES),
  lightNeed: z.enum(LIGHT_NEEDS),
  wateringIntervalDays: z
    .number()
    .int()
    .min(1)
    .max(60)
    .describe("Typical days between waterings indoors in spring at about 22°C."),
  fertilizeIntervalDays: z
    .number()
    .int()
    .min(7)
    .max(180)
    .describe("Typical days between feedings in the growing season."),
  careNotes: z.string().max(120).describe("One short care tip for this species in Simplified Chinese."),
});

export const plantHealthDiagnosisSchema = z.object({
  species: plantSpeciesSchema.describe("Best guess at what plant this is."),
  overallHealth: z.enum(HEALTH_LEVELS).describe("Overall health of the plant in the photo."),
  healthScore: z.number().int().min(0).max(100).describe("0 = dying, 100 = thriving."),
  summary: z.string().min(6).max(200).describe("One or two sentences in Simplified Chinese."),
  issues: z.array(plantHealthIssueSchema).max(5).describe("Problems seen, most important first; empty if none."),
  pestsVisible: z.boolean().describe("True only if insects, mites, eggs, webbing, or their residue are visible."),
  isolateFromOtherPlants: z.boolean().describe("True when a likely problem spreads to nearby plants."),
  careAdvice: z
    .array(z.string().min(4).max(120))
    .min(1)
    .max(5)
    .describe("Practical next steps in Simplified Chinese."),
  followUp: z
    .string()
    .max(160)
    .describe("What close-up photo or check would confirm the diagnosis, in Simplified Chinese; empty if none."),
});

export type PlantAttributeAnalysis = z.infer<typeof plantAttributeAnalysisSchema>;
export type PlantTrendDirection = z.infer<typeof plantTrendDirectionSchema>;
export type PlantObserverThought = z.infer<typeof plantObserverThoughtSchema>;
export type PlantObserverResponse = z.infer<typeof plantObserverResponseSchema>;
export type PlantHealthIssue = z.infer<typeof plantHealthIssueSchema>;
export type PlantHealthDiagnosis = z.infer<typeof plantHealthDiagnosisSchema>;
export type PlantSpecies = z.infer<typeof plantSpeciesSchema>;
