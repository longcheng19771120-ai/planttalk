import { useEffect, useState } from "react";
import { useObservationLoopStore } from "@/stores/plant/observation-loop-store";
import { captureLiveFrame, usePlantCameraStore } from "@/stores/plant/camera-store";
import { OBSERVATION_INTERVAL_LIMITS, usePlantSettingsStore } from "@/stores/plant/settings-store";
import { trendLabel } from "@/lib/plant/labels";
import { actionGlyph, type ActionStatus } from "@/components/dashboard/action-glyph";

/** Formats remaining milliseconds as "X分Y秒". */
function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`;
}

// Shows the most recent observation plus the model's reasoning summaries as
// they stream in live during a cycle.
export function ObservationPanel() {
  const latestObservation = useObservationLoopStore((s) => s.latestObservation);
  const reasoningLog = useObservationLoopStore((s) => s.reasoningLog);
  const isSubmitting = useObservationLoopStore((s) => s.isSubmitting);
  const autoUpdatesEnabled = useObservationLoopStore((s) => s.autoUpdatesEnabled);
  const toggleAutoUpdates = useObservationLoopStore((s) => s.toggleAutoUpdates);
  const sendLiveUpdate = useObservationLoopStore((s) => s.sendLiveUpdate);
  const errorMessage = useObservationLoopStore((s) => s.errorMessage);
  const lastUpdatedAt = useObservationLoopStore((s) => s.lastUpdatedAt);
  const cameraStatus = usePlantCameraStore((s) => s.cameraStatus);
  const observationIntervalMs = usePlantSettingsStore((s) => s.observationIntervalMs);
  const setObservationIntervalMs = usePlantSettingsStore((s) => s.setObservationIntervalMs);

  // Countdown to next auto-observation
  const [countdown, setCountdown] = useState<string | null>(null);

  useEffect(() => {
    if (!autoUpdatesEnabled || !lastUpdatedAt) {
      setCountdown(null);
      return;
    }

    const tick = () => {
      const elapsed = Date.now() - lastUpdatedAt.getTime();
      const remaining = observationIntervalMs - elapsed;
      setCountdown(remaining > 0 ? formatCountdown(remaining) : "马上…");
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [autoUpdatesEnabled, lastUpdatedAt, observationIntervalMs]);

  const status: ActionStatus = isSubmitting ? "working" : autoUpdatesEnabled ? "done" : "todo";

  return (
    <article>
      <header>
        {actionGlyph(status)} <strong>观察循环</strong>{" "}
        <small>
          {lastUpdatedAt ? `（上次：${lastUpdatedAt.toLocaleTimeString()}）` : "（尚无观察）"}
          {countdown && ` · ${countdown} 后下一次`}
        </small>
      </header>

      {latestObservation && (
        <>
          <p>{latestObservation.observation}</p>
          <p>
            <small>
              <em>假设：{latestObservation.hypothesis}</em>
            </small>
          </p>
          <p>
            <kbd>趋势：{trendLabel(latestObservation.trend)}</kbd> <kbd>干燥度：{latestObservation.dryness}/10</kbd>
          </p>
        </>
      )}

      {(isSubmitting || reasoningLog.length > 0) && (
        <details open={isSubmitting}>
          <summary>模型推理摘要 {isSubmitting ? "（生成中…）" : ""}</summary>
          <ul>
            {reasoningLog.map((entry, index) => (
              <li key={index}>
                <small>{entry}</small>
              </li>
            ))}
            {isSubmitting && reasoningLog.length === 0 && (
              <li>
                <small>等待模型…</small>
              </li>
            )}
          </ul>
        </details>
      )}

      {errorMessage && (
        <p>
          <mark>{errorMessage}</mark>
        </p>
      )}

      <footer>
        <button
          type="button"
          disabled={isSubmitting || cameraStatus !== "ready"}
          aria-busy={isSubmitting}
          onClick={() => void sendLiveUpdate("manual", captureLiveFrame)}
        >
          立即观察
        </button>
        <label>
          <input type="checkbox" role="switch" checked={autoUpdatesEnabled} onChange={toggleAutoUpdates} />
          自动观察
        </label>
        <label>
          间隔：{Math.round(observationIntervalMs / 60_000)} 分钟
          <input
            type="range"
            min={OBSERVATION_INTERVAL_LIMITS.min}
            max={OBSERVATION_INTERVAL_LIMITS.max}
            step={OBSERVATION_INTERVAL_LIMITS.step}
            value={observationIntervalMs}
            onChange={(event) => setObservationIntervalMs(Number(event.target.value))}
          />
          <small>观察循环拍摄植物并调用模型的频率（5–30 分钟）。</small>
        </label>
        {cameraStatus !== "ready" && <small>打开摄像头即可开始观察。</small>}
      </footer>
    </article>
  );
}
