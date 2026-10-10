import { del, get, set } from "idb-keyval";
import type { StateStorage } from "zustand/middleware";

// zustand persist storage backed by IndexedDB, for records that outgrow
// localStorage (observation memory, care log, health diagnoses).
export const idbStorage: StateStorage = {
  getItem: async (name) => {
    const value = await get<string>(name);
    return value ?? null;
  },
  setItem: async (name, value) => {
    await set(name, value);
  },
  removeItem: async (name) => {
    await del(name);
  },
};
