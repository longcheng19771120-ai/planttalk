import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { diagnosePlantImageFile } from "@/lib/plant/plants";
import type { PlantHealthDiagnosis } from "@/lib/plant/schemas";
import { usePlantCareStore } from "@/stores/plant/care-store";
import { idbStorage } from "@/stores/plant/idb-storage";
import { buildDiagnosisContext } from "@/stores/plant/plant-context";

// Health checks (pests, diseases, care problems), persisted to IndexedDB with
// a small thumbnail of the photo each one looked at.

const MAX_DIAGNOSES = 50;
const THUMBNAIL_SIZE = 160;

export interface PlantDiagnosisRecord {
  id: string;
  recordedAt: number;
  source: "camera" | "upload";
  diagnosis: PlantHealthDiagnosis;
  model: string;
  thumbnail: string | null;
  /** Indexes into diagnosis.issues that the user marked as treated. */
  treatedIssues: number[];
}

interface PlantHealthState {
  diagnoses: PlantDiagnosisRecord[];
  isSubmitting: boolean;
  errorMessage: string | null;

  diagnose: (imageFile: File, source: PlantDiagnosisRecord["source"]) => Promise<void>;
  markIssueTreated: (recordId: string, issueIndex: number) => void;
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
            treatedIssues: [],
          };
          set((state) => ({ diagnoses: [...state.diagnoses, record].slice(-MAX_DIAGNOSES) }));
        } catch (error) {
          set({ errorMessage: error instanceof Error ? error.message : "植物健康诊断失败" });
        } finally {
          set({ isSubmitting: false });
        }
      },

      markIssueTreated: (recordId, issueIndex) => {
        const record = get().diagnoses.find((entry) => entry.id === recordId);
        const issue = record?.diagnosis.issues[issueIndex];
        if (!record || !issue || record.treatedIssues.includes(issueIndex)) return;

        usePlantCareStore.getState().logCare("treat", `${issue.name}：${issue.treatment}`.slice(0, 200));
        set((state) => ({
          diagnoses: state.diagnoses.map((entry) =>
            entry.id === recordId ? { ...entry, treatedIssues: [...entry.treatedIssues, issueIndex] } : entry,
          ),
        }));
      },

      clearDiagnoses: () => set({ diagnoses: [] }),
    }),
    {
      name: "plant-health-store/v1",
      storage: createJSONStorage(() => idbStorage),
      version: 1,
      partialize: (state) => ({ diagnoses: state.diagnoses }),
    },
  ),
);

export function selectLatestDiagnosis(state: { diagnoses: PlantDiagnosisRecord[] }) {
  return state.diagnoses.length > 0 ? state.diagnoses[state.diagnoses.length - 1] : null;
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
