// The plant's senses: the client-side implementations of the tools declared
// in realtime-config.ts. When the model calls a tool mid-conversation, the
// browser executes it here — against the same Zustand stores the dashboard
// renders — and the result travels back over the WebRTC data channel.
//
// Tool outputs must be strings; JSON is the convention so the model can read
// structure out of them.

import { describeLightReading } from "@/lib/plant/sensors";
import { CARE_ACTIONS, computeCareStatus } from "@/lib/plant/care";
import { findCondition } from "@/lib/plant/health";
import { weatherAlerts } from "@/lib/plant/weather";
import { usePlantCareStore } from "@/stores/plant/care-store";
import { selectLatestDiagnosis, usePlantHealthStore } from "@/stores/plant/health-store";
import { computeSensorRisks } from "@/stores/plant/plant-context";
import { usePlantWeatherStore } from "@/stores/plant/weather-store";
import {
  selectHasFreshHardwareReadings,
  selectSensorReadings,
  usePlantSensorsStore,
} from "@/stores/plant/sensors-store";
import {
  computeHistorySummary,
  selectObservationsForPrompt,
  summarizeObservationHistory,
  usePlantObserverStore,
} from "@/stores/plant/observer-store";

export async function executePlantTool(name: string, argsJson: string): Promise<string> {
  switch (name) {
    case "get_current_sensors": {
      const sensorsState = usePlantSensorsStore.getState();
      const readings = selectSensorReadings(sensorsState);
      const hasLiveArduino = selectHasFreshHardwareReadings(sensorsState);
      return JSON.stringify({
        soilMoisturePercent: Math.round(readings.moisture),
        light: describeLightReading(readings.light),
        source: hasLiveArduino
          ? "live Arduino sensors"
          : sensorsState.sensorMode === "arduino"
            ? "Arduino sensor mode selected, but no live readings yet"
            : "manual dashboard sliders",
      });
    }

    case "get_observation_history": {
      const state = usePlantObserverStore.getState();
      if (state.observations.length === 0) {
        return JSON.stringify({ summary: "No prior observations recorded yet." });
      }

      const args = parseArgs(argsJson);
      if (args.window === "full") {
        return JSON.stringify({
          summary: computeHistorySummary(state.observations) || "Only one observation recorded so far.",
        });
      }

      const selected = selectObservationsForPrompt(state);
      return JSON.stringify({
        summary: summarizeObservationHistory(selected, state.observations),
      });
    }

    case "get_care_and_health": {
      const { tasks, log, profile, snoozes } = usePlantCareStore.getState();
      const now = Date.now();
      const schedule = CARE_ACTIONS.filter((action) => tasks[action].enabled).map((action) => {
        const status = computeCareStatus(action, tasks[action], log, profile, snoozes[action], now);
        return {
          task: action,
          lastDoneDaysAgo: status.lastDoneAt === null ? null : Math.floor((now - status.lastDoneAt) / 86_400_000),
          dueInDays: status.daysUntilDue,
          state: status.state,
        };
      });

      const latest = selectLatestDiagnosis(usePlantHealthStore.getState());
      const healthCheck = latest
        ? {
            checkedHoursAgo: Math.round((now - latest.recordedAt) / 3_600_000),
            overallHealth: latest.diagnosis.overallHealth,
            score: latest.diagnosis.healthScore,
            summary: latest.diagnosis.summary,
            species: latest.diagnosis.species
              ? {
                  name: latest.diagnosis.species.commonName,
                  scientificName: latest.diagnosis.species.scientificName,
                  confidence: latest.diagnosis.species.confidence,
                }
              : "Not identified.",
            issues: latest.diagnosis.issues.map((issue, index) => ({
              name: issue.name,
              confidence: issue.confidence,
              severity: issue.severity,
              treatmentSteps: issue.treatmentSteps,
              stepsDone: latest.completedSteps[index]?.length ?? 0,
              treated: latest.treatedIssues.includes(index),
            })),
          }
        : "No photo health check yet.";

      const { forecast } = usePlantWeatherStore.getState();
      const weather =
        profile.isOutdoor && forecast.length > 0
          ? {
              forecast: forecast.map((day) => ({
                date: day.date,
                minTempC: Math.round(day.minTempC),
                maxTempC: Math.round(day.maxTempC),
                rainMm: Math.round(day.precipitationMm),
              })),
              alerts: weatherAlerts(forecast).map((alert) => alert.message),
            }
          : undefined;

      return JSON.stringify({
        schedule,
        healthCheck,
        ...(weather ? { weather } : {}),
        sensorRisks: computeSensorRisks(now).map((risk) => ({
          problem: findCondition(risk.conditionId)?.name ?? risk.conditionId,
          level: risk.level,
          reason: risk.reason,
        })),
      });
    }

    default:
      return JSON.stringify({ ok: false, error: `Unknown tool: ${name}` });
  }
}

function parseArgs(argsJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argsJson) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
