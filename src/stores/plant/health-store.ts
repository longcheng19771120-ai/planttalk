import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { diagnosePlantImageFile } from "@/lib/plant/plants";
import type { PlantHealthDiagnosis, PlantSpecies } from "@/lib/plant/schemas";
import { usePlantCareStore } from "@/stores/plant/care-store";
import { idbStorage } from "@/stores/plant/idb-storage";
import { buildDiagnosisContext } from "@/stores/plant/plant-context";

// Health checks (pests, diseases, care problems), persisted to IndexedDB with
// a small thumbnail of the photo each one looked at.

const MAX_DIAGNOSES = 50;
const THUMBNAIL_SIZE = 160;

/** Checks saved before species identification have no species. */
export type StoredDiagnosis = Omit<PlantHealthDiagnosis, "species"> & { species?: PlantSpecies };

export interface PlantDiagnosisRecord {
  id: string;
  recordedAt: number;
  source: "camera" | "upload";
  diagnosis: StoredDiagnosis;
  model: string;
  thumbnail: string | null;
  /** Ticked treatment steps, keyed by index into diagnosis.issues. */
  completedSteps: Record<number, number[]>;
  /** Issues whose steps are all done; each was written to the care log once. */
  treatedIssues: number[];
}

interface PlantHealthState {
  diagnoses: PlantDiagnosisRecord[];
  isSubmitting: boolean;
  errorMessage: string | null;

  diagnose: (imageFile: File, source: PlantDiagnosisRecord["source"]) => Promise<void>;
  toggleTreatmentStep: (recordId: string, issueIndex: number, stepIndex: number) => void;
  clearDiagnoses: () => void;
}

export const usePlantHealthStore = create<PlantHealthState>()(
  persist(
    (set, get) => ({
      diagnoses: [],
      isSubmitting: false,
      errorMessage: null,

      diagnose: async (imageFile, source) => {
        if (get().isSubmitting) return;
        set({ isSubmitting: true, errorMessage: null });

        try {
          const [result, thumbnail] = await Promise.all([
            diagnosePlantImageFile(imageFile, buildDiagnosisContext()),
            makeThumbnail(imageFile).catch(() => null),
          ]);
          const record: PlantDiagnosisRecord = {
            id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `dx-${Date.now()}`,
            recordedAt: Date.now(),
            source,
            diagnosis: result.diagnosis,
            model: result.model,
            thumbnail,
            completedSteps: {},
            treatedIssues: [],
          };
          set((state) => ({ diagnoses: [...state.diagnoses, record].slice(-MAX_DIAGNOSES) }));
        } catch (error) {
          set({ errorMessage: error instanceof Error ? error.message : "植物健康诊断失败" });
        } finally {
          set({ isSubmitting: false });
        }
      },

      toggleTreatmentStep: (recordId, issueIndex, stepIndex) => {
        const record = get().diagnoses.find((entry) => entry.id === recordId);
        const issue = record?.diagnosis.issues[issueIndex];
        if (!record || !issue || stepIndex >= issue.treatmentSteps.length) return;
        // A finished treatment is already in the care log; keep it as logged.
        if (record.treatedIssues.includes(issueIndex)) return;

        const done = record.completedSteps[issueIndex] ?? [];
        const nextDone = done.includes(stepIndex)
          ? done.filter((index) => index !== stepIndex)
          : [...done, stepIndex].sort((a, b) => a - b);
        const finished = nextDone.length === issue.treatmentSteps.length;

        if (finished) {
          usePlantCareStore
            .getState()
            .logCare("treat", `${issue.name}：${issue.treatmentSteps.join("；")}`.slice(0, 200));
        }
        set((state) => ({
          diagnoses: state.diagnoses.map((entry) =>
            entry.id === recordId
              ? {
                  ...entry,
                  completedSteps: { ...entry.completedSteps, [issueIndex]: nextDone },
                  treatedIssues: finished ? [...entry.treatedIssues, issueIndex] : entry.treatedIssues,
                }
              : entry,
          ),
        }));
      },

      clearDiagnoses: () => set({ diagnoses: [] }),
    }),
    {
      name: "plant-health-store/v1",
      storage: createJSONStorage(() => idbStorage),
      version: 2,
      partialize: (state) => ({ diagnoses: state.diagnoses }),
      migrate: (persisted, version) => {
        const saved = (persisted ?? {}) as { diagnoses?: unknown[] };
        if (version < 2) saved.diagnoses = (saved.diagnoses ?? []).map(migrateV1Record);
        return saved as { diagnoses: PlantDiagnosisRecord[] };
      },
    },
  ),
);

export function selectLatestDiagnosis(state: { diagnoses: PlantDiagnosisRecord[] }) {
  return state.diagnoses.length > 0 ? state.diagnoses[state.diagnoses.length - 1] : null;
}

// Version 1 stored a single treatment string per issue and no step progress.
function migrateV1Record(raw: unknown): PlantDiagnosisRecord {
  const record = raw as Omit<PlantDiagnosisRecord, "completedSteps"> & { completedSteps?: Record<number, number[]> };
  const completedSteps: Record<number, number[]> = {};
  const issues = record.diagnosis.issues.map((issue, index) => {
    const legacy = issue as typeof issue & { treatment?: string };
    const treatmentSteps = legacy.treatmentSteps ?? (legacy.treatment ? [legacy.treatment] : []);
    if (record.treatedIssues.includes(index)) completedSteps[index] = treatmentSteps.map((_, step) => step);
    return { ...issue, treatmentSteps };
  });
  return { ...record, diagnosis: { ...record.diagnosis, issues }, completedSteps };
}

async function makeThumbnail(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, THUMBNAIL_SIZE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.7);
  } finally {
    bitmap.close();
  }
}
