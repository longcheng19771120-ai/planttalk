// Care schedule and hydration model.
//
// Imported by the browser app only, but kept framework-free like sensors.ts.
//
// Ideas adapted (reimplemented, not copied) from three MIT-licensed projects:
//   - ha-planta: per-action "last done / next due" for watering, fertilizing,
//     misting and cleaning, completed with one button each.
//   - HortusFox: last watered / repotted / fertilised dates and a care log.
//   - kiri: a hydration level that drains smoothly between waterings, sped up
//     or slowed down by season and air temperature, plus "postpone" snoozes.

export const CARE_ACTIONS = ["water", "fertilize", "mist", "clean", "repot"] as const;
export type CareAction = (typeof CARE_ACTIONS)[number];

// "treat" is logged when a health issue is treated; it has no schedule.
export type CareLogAction = CareAction | "treat";

export const CARE_ACTION_LABELS: Record<CareLogAction, string> = {
  water: "浇水",
  fertilize: "施肥",
  mist: "喷雾",
  clean: "擦叶",
  repot: "换盆",
  treat: "病虫害处理",
};

export const CARE_ACTION_ICONS: Record<CareLogAction, string> = {
  water: "💧",
  fertilize: "🧪",
  mist: "🌫️",
  clean: "🧽",
  repot: "🪴",
  treat: "🩹",
};

export interface CareTaskSetting {
  enabled: boolean;
  intervalDays: number;
}

export type CareTaskSettings = Record<CareAction, CareTaskSetting>;

export const DEFAULT_CARE_TASKS: CareTaskSettings = {
  water: { enabled: true, intervalDays: 7 },
  fertilize: { enabled: true, intervalDays: 30 },
  mist: { enabled: false, intervalDays: 3 },
  clean: { enabled: true, intervalDays: 30 },
  repot: { enabled: true, intervalDays: 365 },
};

export const CARE_INTERVAL_LIMITS = { min: 1, max: 730 };

export type Hemisphere = "north" | "south";

export interface PlantProfile {
  isOutdoor: boolean;
  /** Typical air temperature around the plant, used by the hydration model. */
  ambientTempC: number;
  hemisphere: Hemisphere;
}

export const DEFAULT_PLANT_PROFILE: PlantProfile = {
  isOutdoor: false,
  ambientTempC: 22,
  hemisphere: "north",
};

export interface CareLogEntry {
  id: string;
  action: CareLogAction;
  at: number;
  note?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Hydration model

type Season = "spring" | "summer" | "autumn" | "winter";

export function seasonOf(date: Date, hemisphere: Hemisphere): Season {
  const month = date.getMonth(); // 0 = January
  const northern: Season =
    month <= 1 || month === 11 ? "winter" : month <= 4 ? "spring" : month <= 7 ? "summer" : "autumn";
  if (hemisphere === "north") return northern;
  return ({ winter: "summer", spring: "autumn", summer: "winter", autumn: "spring" } as const)[northern];
}

export const SEASON_LABELS: Record<Season, string> = {
  spring: "春季",
  summer: "夏季",
  autumn: "秋季",
  winter: "冬季",
};

// The watering interval is calibrated for spring. Outdoor plants follow the
// seasons strongly; indoor plants only mildly (heating and windows still matter).
const OUTDOOR_SEASON_FACTOR: Record<Season, number> = { spring: 1, summer: 1.5, autumn: 0.75, winter: 0.5 };
const INDOOR_SEASON_FACTOR: Record<Season, number> = { spring: 1, summer: 1.15, autumn: 0.9, winter: 0.8 };

export function seasonFactor(date: Date, profile: PlantProfile) {
  const season = seasonOf(date, profile.hemisphere);
  return (profile.isOutdoor ? OUTDOOR_SEASON_FACTOR : INDOOR_SEASON_FACTOR)[season];
}

// Cool air slows drying; heat speeds it up a little more for every degree.
export function temperatureFactor(tempC: number) {
  if (tempC <= 18) return 0.8;
  if (tempC <= 27) return 1;
  return 1 + (tempC - 27) * 0.05;
}

/** Percentage of the soil's water used per day under current conditions. */
export function dailyDrainPercent(intervalDays: number, date: Date, profile: PlantProfile) {
  if (intervalDays <= 0) return 0;
  return (100 / intervalDays) * seasonFactor(date, profile) * temperatureFactor(profile.ambientTempC);
}

export interface HydrationEstimate {
  /** 0–100, where 100 is freshly watered. */
  level: number;
  /** Days until the estimate reaches zero (0 = water now). */
  daysUntilDry: number;
}

// Integrates day by day so a watering cycle that crosses a season boundary
// drains at each season's rate.
export function estimateHydration(
  lastWateredAt: number | null,
  intervalDays: number,
  profile: PlantProfile,
  now = Date.now(),
): HydrationEstimate | null {
  if (lastWateredAt === null || intervalDays <= 0) return null;

  let level = 100;
  let cursor = lastWateredAt;
  while (cursor < now && level > 0) {
    const step = Math.min(DAY_MS, now - cursor);
    level -= dailyDrainPercent(intervalDays, new Date(cursor), profile) * (step / DAY_MS);
    cursor += step;
  }
  level = Math.max(0, level);

  const drainToday = dailyDrainPercent(intervalDays, new Date(now), profile);
  const daysUntilDry = level <= 0 || drainToday <= 0 ? 0 : level / drainToday;
  return { level: Math.round(level), daysUntilDry };
}

// Schedule status

export type CareTaskState = "never" | "overdue" | "due" | "soon" | "ok";

export interface CareTaskStatus {
  action: CareAction;
  lastDoneAt: number | null;
  nextDueAt: number | null;
  /** Whole days until due; negative when overdue. */
  daysUntilDue: number | null;
  state: CareTaskState;
}

export function lastDoneAt(log: CareLogEntry[], action: CareLogAction): number | null {
  let latest: number | null = null;
  for (const entry of log) {
    if (entry.action === action && (latest === null || entry.at > latest)) latest = entry.at;
  }
  return latest;
}

export function computeCareStatus(
  action: CareAction,
  setting: CareTaskSetting,
  log: CareLogEntry[],
  profile: PlantProfile,
  snoozedUntil: number | undefined,
  now = Date.now(),
): CareTaskStatus {
  const last = lastDoneAt(log, action);
  if (last === null) {
    return { action, lastDoneAt: null, nextDueAt: null, daysUntilDue: null, state: "never" };
  }

  let nextDueAt: number;
  if (action === "water") {
    // Watering follows the hydration model, so heat and season move the date.
    const hydration = estimateHydration(last, setting.intervalDays, profile, now);
    nextDueAt = now + (hydration?.daysUntilDry ?? 0) * DAY_MS;
  } else {
    nextDueAt = last + setting.intervalDays * DAY_MS;
  }
  if (snoozedUntil && snoozedUntil > nextDueAt) nextDueAt = snoozedUntil;

  const daysUntilDue = Math.floor((startOfDay(nextDueAt) - startOfDay(now)) / DAY_MS);
  const soonWindow = Math.max(1, Math.round(setting.intervalDays * 0.2));
  const state: CareTaskState =
    daysUntilDue < 0 ? "overdue" : daysUntilDue === 0 ? "due" : daysUntilDue <= soonWindow ? "soon" : "ok";

  return { action, lastDoneAt: last, nextDueAt, daysUntilDue, state };
}

export function describeDaysUntil(days: number | null) {
  if (days === null) return "还没有记录";
  if (days < 0) return `已逾期 ${-days} 天`;
  if (days === 0) return "今天";
  if (days === 1) return "明天";
  return `${days} 天后`;
}

export function describeTimeAgo(at: number | null, now = Date.now()) {
  if (at === null) return "从未";
  const days = Math.floor((startOfDay(now) - startOfDay(at)) / DAY_MS);
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  return `${days} 天前`;
}

function startOfDay(at: number) {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** One compact English line for model prompts. */
export function summarizeCareForPrompt(
  tasks: CareTaskSettings,
  log: CareLogEntry[],
  profile: PlantProfile,
  snoozes: Partial<Record<CareAction, number>>,
  now = Date.now(),
) {
  const parts = CARE_ACTIONS.filter((action) => tasks[action].enabled).map((action) => {
    const status = computeCareStatus(action, tasks[action], log, profile, snoozes[action], now);
    if (status.lastDoneAt === null) return `${action}: never logged`;
    const ago = Math.round((now - status.lastDoneAt) / DAY_MS);
    return `${action}: last ${ago}d ago, due ${status.daysUntilDue === null ? "?" : status.daysUntilDue < 0 ? `${-status.daysUntilDue}d overdue` : `in ${status.daysUntilDue}d`}`;
  });
  const lastTreatment = lastDoneAt(log, "treat");
  if (lastTreatment !== null) parts.push(`pest/disease treatment: last ${Math.round((now - lastTreatment) / DAY_MS)}d ago`);
  parts.push(`${profile.isOutdoor ? "outdoor" : "indoor"} plant, ~${profile.ambientTempC}°C, ${seasonOf(new Date(now), profile.hemisphere)}`);
  return parts.join("; ");
}
