// Cross-store summaries: one place that turns sensors, the care log, and the
// observation memory into prompt context and health risks.

import { summarizeCareForPrompt } from "@/lib/plant/care";
import { assessSensorRisks, type HealthRisk } from "@/lib/plant/health";
import { describeLightReading } from "@/lib/plant/sensors";
import { usePlantCareStore } from "@/stores/plant/care-store";
import {
  selectObservationsForPrompt,
  summarizeObservationHistory,
  usePlantObserverStore,
} from "@/stores/plant/observer-store";
import { selectSensorReadings, selectUsesFallback, usePlantSensorsStore } from "@/stores/plant/sensors-store";

const HOUR_MS = 60 * 60 * 1000;

export function buildCareSummary() {
  const { tasks, log, profile, snoozes } = usePlantCareStore.getState();
  return summarizeCareForPrompt(tasks, log, profile, snoozes);
}

/** Context sent with a health check photo. */
export function buildDiagnosisContext() {
  const sensors = usePlantSensorsStore.getState();
  const readings = selectSensorReadings(sensors);
  const estimate = selectUsesFallback(sensors) ? " (manual estimate)" : "";
  const observer = usePlantObserverStore.getState();

  return [
    `Sensors now: soil moisture ${Math.round(readings.moisture)}%${estimate}, light ${describeLightReading(readings.light)}${estimate}.`,
    `Hardware: ${buildHardwareStatusSummary(sensors)}.`,
    `Care log: ${buildCareSummary()}.`,
    `Observation memory: ${summarizeObservationHistory(selectObservationsForPrompt(observer), observer.observations)}`,
  ].join("\n");
}

export function computeSensorRisks(now = Date.now()): HealthRisk[] {
  const sensors = usePlantSensorsStore.getState();
  const readings = selectSensorReadings(sensors);
  const observations = usePlantObserverStore.getState().observations;

  const samples = observations.map((record) => ({
    at: record.recordedAt,
    moisture: record.sensorReadings.moisture,
    measured: record.sensorSource === "hardware",
  }));

  // Average daily light, only from measured readings over the last three days.
  const measured = observations.filter(
    (record) => record.sensorSource === "hardware" && now - record.recordedAt <= 72 * HOUR_MS,
  );
  const spanHours =
    measured.length > 1 ? (measured[measured.length - 1].recordedAt - measured[0].recordedAt) / HOUR_MS : 0;
  const lightOnHoursPerDay =
    measured.length >= 6 && spanHours >= 24
      ? (measured.filter((record) => record.sensorReadings.light > 50).length / measured.length) * 24
      : null;

  return assessSensorRisks({
    samples,
    currentMoisture: readings.moisture,
    currentMeasured: !selectUsesFallback(sensors),
    lightOnHoursPerDay,
    now,
  });
}

// One compact line describing how much to trust the sensor data, passed into
// the observer prompt (see PLANT_OBSERVER_PROMPTS).
export function buildHardwareStatusSummary(sensors: ReturnType<typeof usePlantSensorsStore.getState>): string {
  if (sensors.sensorMode === "manual") {
    return "sensor_mode=manual; sensor_data=manual_sliders";
  }

  const { connectionState, lastHardwareReadingAt } = sensors;
  if (connectionState === "connected") {
    // Connected but no data yet (the Arduino takes a few seconds to boot) —
    // the readings in the prompt are still manual estimates.
    if (lastHardwareReadingAt === null) {
      return "arduino=connected; sensor_data=manual_sliders (awaiting first hardware reading)";
    }
    return "arduino=connected; sensor_data=live";
  }
  if (lastHardwareReadingAt !== null) {
    const staleMin = Math.round((Date.now() - lastHardwareReadingAt) / 60000);
    return `arduino=disconnected; last_reading=${staleMin}m ago; sensor_data=stale`;
  }
  return "arduino=not_connected; sensor_data=manual_sliders";
}
