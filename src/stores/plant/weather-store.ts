import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { fetchForecast, roundLocation, type WeatherDay, type WeatherLocation } from "@/lib/plant/weather";

// The outdoor forecast, persisted to localStorage. Only fetched for outdoor
// plants, and only after the user shares a location.

const REFRESH_AFTER_MS = 3 * 60 * 60 * 1000;

interface PlantWeatherState {
  location: WeatherLocation | null;
  forecast: WeatherDay[];
  fetchedAt: number | null;
  isLoading: boolean;
  errorMessage: string | null;

  locate: () => Promise<void>;
  refresh: (force?: boolean) => Promise<void>;
  forgetLocation: () => void;
}

export const usePlantWeatherStore = create<PlantWeatherState>()(
  persist(
    (set, get) => ({
      location: null,
      forecast: [],
      fetchedAt: null,
      isLoading: false,
      errorMessage: null,

      locate: async () => {
        if (!("geolocation" in navigator)) {
          set({ errorMessage: "这个浏览器不支持定位" });
          return;
        }
        set({ isLoading: true, errorMessage: null });
        try {
          const position = await new Promise<GeolocationPosition>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 15_000, maximumAge: 3_600_000 }),
          );
          set({ location: roundLocation(position.coords.latitude, position.coords.longitude) });
        } catch (error) {
          set({ isLoading: false, errorMessage: describeGeolocationError(error) });
          return;
        }
        set({ isLoading: false });
        await get().refresh(true);
      },

      refresh: async (force = false) => {
        const { location, fetchedAt, isLoading } = get();
        if (!location || isLoading) return;
        if (!force && fetchedAt !== null && Date.now() - fetchedAt < REFRESH_AFTER_MS) return;

        set({ isLoading: true, errorMessage: null });
        try {
          const forecast = await fetchForecast(location);
          set({ forecast, fetchedAt: Date.now() });
        } catch (error) {
          set({ errorMessage: error instanceof Error ? error.message : "获取天气失败" });
        } finally {
          set({ isLoading: false });
        }
      },

      forgetLocation: () => set({ location: null, forecast: [], fetchedAt: null, errorMessage: null }),
    }),
    {
      name: "plant-weather-store/v1",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (state) => ({ location: state.location, forecast: state.forecast, fetchedAt: state.fetchedAt }),
    },
  ),
);

function describeGeolocationError(error: unknown) {
  if (typeof GeolocationPositionError !== "undefined" && error instanceof GeolocationPositionError) {
    if (error.code === error.PERMISSION_DENIED) return "没有获得定位权限，请在浏览器里允许位置访问";
    if (error.code === error.TIMEOUT) return "定位超时，请再试一次";
  }
  return "无法获取位置";
}
