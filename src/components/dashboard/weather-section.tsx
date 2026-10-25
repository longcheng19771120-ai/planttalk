import { useEffect } from "react";
import { describeForecastDate, todaysMeanTempC, weatherAlerts } from "@/lib/plant/weather";
import { usePlantCareStore } from "@/stores/plant/care-store";
import { usePlantWeatherStore } from "@/stores/plant/weather-store";

// Outdoor plants only: a three-day forecast with frost, heat and heavy-rain
// warnings, and a shortcut that feeds today's temperature to the hydration model.
export function WeatherSection() {
  const location = usePlantWeatherStore((s) => s.location);
  const forecast = usePlantWeatherStore((s) => s.forecast);
  const isLoading = usePlantWeatherStore((s) => s.isLoading);
  const errorMessage = usePlantWeatherStore((s) => s.errorMessage);
  const locate = usePlantWeatherStore((s) => s.locate);
  const refresh = usePlantWeatherStore((s) => s.refresh);
  const forgetLocation = usePlantWeatherStore((s) => s.forgetLocation);
  const ambientTempC = usePlantCareStore((s) => s.profile.ambientTempC);
  const setProfile = usePlantCareStore((s) => s.setProfile);

  // Refreshes a stale forecast when the panel opens; no-op when it is recent.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const alerts = weatherAlerts(forecast);
  const meanTemp = todaysMeanTempC(forecast);

  return (
    <section className="care-weather">
      <strong>🌦️ 户外天气</strong>
      {!location ? (
        <p>
          <small>允许定位后，会提前提醒霜冻、高温和暴雨。位置只精确到约 1 公里，发给 Open-Meteo 天气服务。</small>
          <br />
          <button type="button" className="secondary outline health-small-button" disabled={isLoading} onClick={() => void locate()}>
            {isLoading ? "正在定位…" : "用我的位置获取天气"}
          </button>
        </p>
      ) : (
        <>
          {alerts.length === 0 ? (
            forecast.length > 0 && <p><small>未来三天没有霜冻、高温或暴雨。</small></p>
          ) : (
            <ul className="weather-alerts">
              {alerts.map((alert) => (
                <li key={`${alert.kind}-${alert.date}`}>
                  <mark>{alert.kind === "frost" ? "🥶" : alert.kind === "heat" ? "🥵" : "🌧️"} {alert.message}</mark>
                </li>
              ))}
            </ul>
          )}
          {forecast.length > 0 && (
            <small className="weather-days">
              {forecast.map((day) => (
                <span key={day.date}>
                  {describeForecastDate(day.date)} {Math.round(day.minTempC)}–{Math.round(day.maxTempC)}°C
                  {day.precipitationMm >= 1 && ` · 雨 ${Math.round(day.precipitationMm)} 毫米`}
                </span>
              ))}
            </small>
          )}
          <div className="weather-actions">
            {meanTemp !== null && meanTemp !== ambientTempC && (
              <button
                type="button"
                className="secondary outline health-small-button"
                onClick={() => setProfile({ ambientTempC: meanTemp })}
              >
                把周围气温设为今天的 {meanTemp}°C
              </button>
            )}
            <button
              type="button"
              className="secondary outline health-small-button"
              disabled={isLoading}
              onClick={() => void refresh(true)}
            >
              {isLoading ? "正在更新…" : "刷新"}
            </button>
            <button type="button" className="secondary outline health-small-button" onClick={forgetLocation}>
              删除位置
            </button>
          </div>
        </>
      )}
      {errorMessage && (
        <p>
          <mark>{errorMessage}</mark>
        </p>
      )}
    </section>
  );
}
