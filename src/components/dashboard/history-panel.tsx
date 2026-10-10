import { usePlantObserverStore } from "@/stores/plant/observer-store";
import { describeLightReading } from "@/lib/plant/sensors";
import { lightLabel, trendLabel } from "@/lib/plant/labels";

const VISIBLE_HISTORY_COUNT = 25;

// The plant's memory: observation records persisted to IndexedDB. Survives
// reloads — this is what the plant draws on when it talks about its past.
export function HistoryPanel() {
  const observations = usePlantObserverStore((s) => s.observations);
  const clearObservations = usePlantObserverStore((s) => s.clearObservations);

  const recentFirst = observations.slice(-VISIBLE_HISTORY_COUNT).reverse();

  return (
    <article>
      <header>
        <strong>观察记录</strong>{" "}
        <small>（IndexedDB 中已存 {observations.length} 条）</small>
      </header>

      {recentFirst.length === 0 ? (
        <p>
          <small>还没有观察记录。运行观察循环来建立植物的记忆。</small>
        </p>
      ) : (
        <ul className="history-list">
          {recentFirst.map((record) => (
            <li key={record.id}>
              <small>
                <strong>{new Date(record.recordedAt).toLocaleString()}</strong>{" "}
                {/* Flag slider-based readings so the list doesn't imply they were measured. */}
                <span title={record.sensorSource === "fallback" ? "读数来自手动滑块" : "读数来自 Arduino"}>
                  {record.sensorSource === "fallback" ? "🎚️" : "🔌"}
                </span>{" "}
                — {record.observation}{" "}
                <em>
                  （湿度 {Math.round(record.sensorReadings.moisture)}%，光照{" "}
                  {lightLabel(describeLightReading(record.sensorReadings.light))}，干燥度 {record.dryness}/10，{" "}
                  {trendLabel(record.trend)}）
                </em>
              </small>
            </li>
          ))}
        </ul>
      )}

      {observations.length > 0 && (
        <footer>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              if (window.confirm("确定要清除植物的全部观察记录吗？")) {
                clearObservations();
              }
            }}
          >
            清除记录
          </button>
        </footer>
      )}
    </article>
  );
}
