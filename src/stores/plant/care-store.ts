import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  CARE_INTERVAL_LIMITS,
  DEFAULT_CARE_TASKS,
  DEFAULT_PLANT_PROFILE,
  lastDoneAt,
  type CareAction,
  type CareLogAction,
  type CareLogEntry,
  type CareTaskSettings,
  type PlantProfile,
} from "@/lib/plant/care";
import { idbStorage } from "@/stores/plant/idb-storage";
import { usePlantSensorsStore } from "@/stores/plant/sensors-store";

// The care schedule and care log, persisted to IndexedDB next to the
// observation memory.

const MAX_CARE_LOG_ENTRIES = 500;
const SNOOZE_MS = 24 * 60 * 60 * 1000;

interface PlantCareState {
  tasks: CareTaskSettings;
  profile: PlantProfile;
  log: CareLogEntry[];
  /** "Postpone" pushes a task's due date to at least this time. */
  snoozes: Partial<Record<CareAction, number>>;

  logCare: (action: CareLogAction, note?: string, at?: number) => void;
  removeLogEntry: (id: string) => void;
  snooze: (action: CareAction) => void;
  setTask: (action: CareAction, patch: Partial<{ enabled: boolean; intervalDays: number }>) => void;
  setProfile: (patch: Partial<PlantProfile>) => void;
  clearLog: () => void;
}

export const usePlantCareStore = create<PlantCareState>()(
  persist(
    (set) => ({
      tasks: DEFAULT_CARE_TASKS,
      profile: DEFAULT_PLANT_PROFILE,
      log: [],
      snoozes: {},

      logCare: (action, note, at = Date.now()) =>
        set((state) => {
          const entry: CareLogEntry = { id: newId(), action, at, ...(note ? { note } : {}) };
          const snoozes = { ...state.snoozes };
          if (action !== "treat") delete snoozes[action];
          return {
            log: [...state.log, entry].sort((a, b) => a.at - b.at).slice(-MAX_CARE_LOG_ENTRIES),
            snoozes,
          };
        }),

      removeLogEntry: (id) => set((state) => ({ log: state.log.filter((entry) => entry.id !== id) })),

      snooze: (action) =>
        set((state) => ({
          snoozes: { ...state.snoozes, [action]: Math.max(state.snoozes[action] ?? 0, Date.now()) + SNOOZE_MS },
        })),

      setTask: (action, patch) =>
        set((state) => {
          const current = state.tasks[action];
          const intervalDays =
            patch.intervalDays === undefined
              ? current.intervalDays
              : clamp(Math.round(patch.intervalDays), CARE_INTERVAL_LIMITS.min, CARE_INTERVAL_LIMITS.max);
          return { tasks: { ...state.tasks, [action]: { ...current, ...patch, intervalDays } } };
        }),

      setProfile: (patch) =>
        set((state) => {
          const profile = { ...state.profile, ...patch };
          profile.ambientTempC = clamp(Number.isFinite(profile.ambientTempC) ? profile.ambientTempC : 22, 0, 45);
          return { profile };
        }),

      clearLog: () => set({ log: [], snoozes: {} }),
    }),
    {
      name: "plant-care-store/v1",
      storage: createJSONStorage(() => idbStorage),
      version: 1,
      partialize: (state) => ({
        tasks: state.tasks,
        profile: state.profile,
        log: state.log,
        snoozes: state.snoozes,
      }),
      // Fill in tasks added after a user's data was first saved.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<PlantCareState>;
        return {
          ...current,
          ...saved,
          tasks: { ...DEFAULT_CARE_TASKS, ...saved.tasks },
          profile: { ...DEFAULT_PLANT_PROFILE, ...saved.profile },
        };
      },
    },
  ),
);

// Automatic watering detection: with a live Arduino, a quick jump in soil
// moisture almost always means someone just watered the plant, so log it.
const WATERING_JUMP_PERCENT = 20;
const WATERING_WINDOW_MS = 10 * 60_000;
const WATERING_DEDUP_MS = 3 * 60 * 60_000;
let moistureWindow: Array<{ at: number; moisture: number }> = [];

usePlantSensorsStore.subscribe((state, previous) => {
  if (state.sensorMode !== "arduino" || state.connectionState !== "connected") {
    moistureWindow = [];
    return;
  }
  if (state.lastHardwareReadingAt === null || state.lastHardwareReadingAt === previous.lastHardwareReadingAt) return;

  const now = state.lastHardwareReadingAt;
  const moisture = state.hardwareReadings.moisture;
  moistureWindow = moistureWindow.filter((sample) => now - sample.at <= WATERING_WINDOW_MS);
  moistureWindow.push({ at: now, moisture });

  const lowest = Math.min(...moistureWindow.map((sample) => sample.moisture));
  if (moisture - lowest < WATERING_JUMP_PERCENT) return;

  const care = usePlantCareStore.getState();
  const lastWatered = lastDoneAt(care.log, "water");
  if (lastWatered !== null && now - lastWatered < WATERING_DEDUP_MS) return;

  care.logCare("water", `土壤湿度从 ${Math.round(lowest)}% 升到 ${Math.round(moisture)}%，自动记录`, now);
  moistureWindow = [];
});

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `care-${Date.now()}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
