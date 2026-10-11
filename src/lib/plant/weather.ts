// Outdoor weather from Open-Meteo (free, no API key): a three-day forecast
// and alerts for frost, heat and heavy rain.

export interface WeatherDay {
  /** YYYY-MM-DD in the location's time zone. */
  date: string;
  minTempC: number;
  maxTempC: number;
  precipitationMm: number;
}

export interface WeatherLocation {
  latitude: number;
  longitude: number;
}

export type WeatherAlertKind = "frost" | "heat" | "heavy-rain";

export interface WeatherAlert {
  kind: WeatherAlertKind;
  date: string;
  message: string;
}

export const FROST_TEMP_C = 2;
export const HEAT_TEMP_C = 35;
export const HEAVY_RAIN_MM = 20;
const FORECAST_DAYS = 3;

// Two decimals is about 1 km: plenty for a forecast, and it keeps the exact
// address off the wire.
export function roundLocation(latitude: number, longitude: number): WeatherLocation {
  return { latitude: Math.round(latitude * 100) / 100, longitude: Math.round(longitude * 100) / 100 };
}

export async function fetchForecast(location: WeatherLocation, signal?: AbortSignal): Promise<WeatherDay[]> {
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    daily: "temperature_2m_max,temperature_2m_min,precipitation_sum",
    timezone: "auto",
    forecast_days: String(FORECAST_DAYS),
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal });
  if (!response.ok) throw new Error(`天气服务返回 ${response.status}`);

  const data = (await response.json()) as {
    daily?: {
      time?: string[];
      temperature_2m_max?: Array<number | null>;
      temperature_2m_min?: Array<number | null>;
      precipitation_sum?: Array<number | null>;
    };
  };
  const daily = data.daily;
  if (!daily?.time) throw new Error("天气服务没有返回预报");

  return daily.time.map((date, index) => ({
    date,
    minTempC: daily.temperature_2m_min?.[index] ?? Number.NaN,
    maxTempC: daily.temperature_2m_max?.[index] ?? Number.NaN,
    precipitationMm: daily.precipitation_sum?.[index] ?? 0,
  }));
}

export function weatherAlerts(days: WeatherDay[]): WeatherAlert[] {
  const alerts: WeatherAlert[] = [];
  for (const day of days) {
    const when = describeForecastDate(day.date);
    if (day.minTempC <= FROST_TEMP_C) {
      alerts.push({
        kind: "frost",
        date: day.date,
        message: `${when}最低 ${Math.round(day.minTempC)}°C，可能有霜冻：怕冷的植物搬进室内或盖上防寒布。`,
      });
    }
    if (day.maxTempC >= HEAT_TEMP_C) {
      alerts.push({
        kind: "heat",
        date: day.date,
        message: `${when}最高 ${Math.round(day.maxTempC)}°C：早上浇透水，中午给植物遮阴。`,
      });
    }
    if (day.precipitationMm >= HEAVY_RAIN_MM) {
      alerts.push({
        kind: "heavy-rain",
        date: day.date,
        message: `${when}预计降雨 ${Math.round(day.precipitationMm)} 毫米：先不用浇水，注意盆底排水，必要时挪到屋檐下。`,
      });
    }
  }
  return alerts;
}

/** "今天" / "明天" / "后天", or the month and day. */
export function describeForecastDate(date: string, now = new Date()) {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(year, month - 1, day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return "今天";
  if (diff === 1) return "明天";
  if (diff === 2) return "后天";
  return `${month} 月 ${day} 日`;
}

/** Today's average temperature, for the hydration model. */
export function todaysMeanTempC(days: WeatherDay[]) {
  const today = days[0];
  if (!today || !Number.isFinite(today.minTempC) || !Number.isFinite(today.maxTempC)) return null;
  return Math.round((today.minTempC + today.maxTempC) / 2);
}
