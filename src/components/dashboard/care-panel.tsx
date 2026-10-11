import { useEffect, useState } from "react";
import {
  CARE_ACTIONS,
  CARE_ACTION_ICONS,
  CARE_ACTION_LABELS,
  CARE_INTERVAL_LIMITS,
  SEASON_LABELS,
  computeCareStatus,
  describeDaysUntil,
  describeTimeAgo,
  estimateHydration,
  lastDoneAt,
  seasonOf,
  type CareTaskState,
} from "@/lib/plant/care";
import { usePlantCareStore } from "@/stores/plant/care-store";
import { actionGlyph } from "@/components/dashboard/action-glyph";

const VISIBLE_LOG_COUNT = 12;

const STATE_STYLES: Record<CareTaskState, { label: string; className: string }> = {
  never: { label: "未记录", className: "care-state care-state-never" },
  overdue: { label: "逾期", className: "care-state care-state-overdue" },
  due: { label: "今天", className: "care-state care-state-due" },
  soon: { label: "快到了", className: "care-state care-state-soon" },
  ok: { label: "正常", className: "care-state care-state-ok" },
};

// Watering, feeding and the other chores: when each was last done, when it is
// next due, and one click to log it. Watering follows a hydration estimate
// that drains faster in heat and summer and slower in winter.
export function CarePanel() {
  const tasks = usePlantCareStore((s) => s.tasks);
  const profile = usePlantCareStore((s) => s.profile);
  const log = usePlantCareStore((s) => s.log);
  const snoozes = usePlantCareStore((s) => s.snoozes);
  const logCare = usePlantCareStore((s) => s.logCare);
  const snooze = usePlantCareStore((s) => s.snooze);
  const setTask = usePlantCareStore((s) => s.setTask);
  const setProfile = usePlantCareStore((s) => s.setProfile);
  const removeLogEntry = usePlantCareStore((s) => s.removeLogEntry);
  const clearLog = usePlantCareStore((s) => s.clearLog);

  // Due dates move with the clock; refresh once a minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const statuses = CARE_ACTIONS.filter((action) => tasks[action].enabled).map((action) =>
    computeCareStatus(action, tasks[action], log, profile, snoozes[action], now),
  );
  const needsAttention = statuses.some((status) => status.state === "overdue" || status.state === "due");
  const hydration = estimateHydration(lastDoneAt(log, "water"), tasks.water.intervalDays, profile, now);
  const recentLog = log.slice(-VISIBLE_LOG_COUNT).reverse();

  return (
    <article>
      <header>
        {actionGlyph(needsAttention ? "warn" : "done")} <strong>养护计划</strong>{" "}
        <small>
          （{profile.isOutdoor ? "户外" : "室内"} · {SEASON_LABELS[seasonOf(new Date(now), profile.hemisphere)]} ·{" "}
          {profile.ambientTempC}°C）
        </small>
      </header>

      {hydration && (
        <p>
          估算盆土水分：<strong>{hydration.level}%</strong>
          <progress value={hydration.level} max={100} />
          <small>根据上次浇水时间、季节和气温估算；接了 Arduino 时以实际湿度读数为准。</small>
        </p>
      )}

      <ul className="care-list">
        {statuses.map((status) => (
          <li key={status.action} className="care-row">
            <div className="care-info">
              <strong>
                {CARE_ACTION_ICONS[status.action]} {CARE_ACTION_LABELS[status.action]}
              </strong>{" "}
              <span className={STATE_STYLES[status.state].className}>{STATE_STYLES[status.state].label}</span>
              <br />
              <small>
                {status.lastDoneAt === null
                  ? "还没有记录，点“完成”开始计时"
                  : `上次：${describeTimeAgo(status.lastDoneAt, now)} · 下次：${describeDaysUntil(status.daysUntilDue)}`}
              </small>
            </div>
            <div className="care-actions">
              <button type="button" onClick={() => logCare(status.action)}>
                完成
              </button>
              {status.lastDoneAt !== null && (
                <button
                  type="button"
                  className="secondary outline"
                  title="把这项推迟一天"
                  onClick={() => snooze(status.action)}
                >
                  推迟
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <details>
        <summary>养护设置</summary>
        {CARE_ACTIONS.map((action) => (
          <div key={action} className="care-setting">
            <label>
              <input
                type="checkbox"
                checked={tasks[action].enabled}
                onChange={(event) => setTask(action, { enabled: event.target.checked })}
              />
              {CARE_ACTION_LABELS[action]}
            </label>
            <label>
              每
              <input
                type="number"
                min={CARE_INTERVAL_LIMITS.min}
                max={CARE_INTERVAL_LIMITS.max}
                value={tasks[action].intervalDays}
                disabled={!tasks[action].enabled}
                onChange={(event) => setTask(action, { intervalDays: Number(event.target.value) })}
              />
              天
            </label>
          </div>
        ))}
        <small>浇水间隔按春季、约 22°C 的情况填写，系统会按季节和气温自动调整。</small>

        <label>
          品种
          <input
            type="text"
            placeholder="例如：绿萝。做一次健康诊断可以自动识别"
            value={profile.speciesName}
            maxLength={100}
            onChange={(event) => setProfile({ speciesName: event.target.value })}
          />
        </label>

        <fieldset>
          <legend>摆放位置</legend>
          <label>
            <input
              type="radio"
              name="care-location"
              checked={!profile.isOutdoor}
              onChange={() => setProfile({ isOutdoor: false })}
            />
            室内
          </label>
          <label>
            <input
              type="radio"
              name="care-location"
              checked={profile.isOutdoor}
              onChange={() => setProfile({ isOutdoor: true })}
            />
            户外（季节影响更大）
          </label>
        </fieldset>

        <label>
          周围气温：{profile.ambientTempC}°C
          <input
            type="range"
            min={0}
            max={45}
            step={1}
            value={profile.ambientTempC}
            onChange={(event) => setProfile({ ambientTempC: Number(event.target.value) })}
          />
        </label>

        <label>
          所在半球
          <select
            value={profile.hemisphere}
            onChange={(event) => setProfile({ hemisphere: event.target.value === "south" ? "south" : "north" })}
          >
            <option value="north">北半球</option>
            <option value="south">南半球</option>
          </select>
        </label>
      </details>

      <details>
        <summary>养护日志（共 {log.length} 条）</summary>
        {recentLog.length === 0 ? (
          <p>
            <small>还没有记录。点上面的“完成”来记下第一次养护。</small>
          </p>
        ) : (
          <ul className="history-list">
            {recentLog.map((entry) => (
              <li key={entry.id}>
                <small>
                  <strong>{new Date(entry.at).toLocaleString()}</strong> {CARE_ACTION_ICONS[entry.action]}{" "}
                  {CARE_ACTION_LABELS[entry.action]}
                  {entry.note && <em> — {entry.note}</em>}{" "}
                  <a
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      removeLogEntry(entry.id);
                    }}
                  >
                    撤销
                  </a>
                </small>
              </li>
            ))}
          </ul>
        )}
        {log.length > 0 && (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              if (window.confirm("确定要清除全部养护日志吗？")) clearLog();
            }}
          >
            清除日志
          </button>
        )}
      </details>
    </article>
  );
}
