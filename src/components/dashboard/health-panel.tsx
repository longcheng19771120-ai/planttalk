import { useState } from "react";
import {
  CARE_DIFFICULTY_LABELS,
  CONFIDENCE_LABELS,
  HEALTH_LEVEL_ICONS,
  HEALTH_LEVEL_LABELS,
  ISSUE_CATEGORY_LABELS,
  LIGHT_NEED_LABELS,
  SEVERITY_LABELS,
  findCondition,
} from "@/lib/plant/health";
import { captureLiveFrame, usePlantCameraStore } from "@/stores/plant/camera-store";
import { usePlantCareStore } from "@/stores/plant/care-store";
import { selectLatestDiagnosis, usePlantHealthStore } from "@/stores/plant/health-store";
import { usePlantObserverStore } from "@/stores/plant/observer-store";
import { computeSensorRisks } from "@/stores/plant/plant-context";
import { selectSensorReadings, usePlantSensorsStore } from "@/stores/plant/sensors-store";
import { actionGlyph, type ActionStatus } from "@/components/dashboard/action-glyph";

const VISIBLE_HISTORY_COUNT = 8;

// Pest, disease and care-problem checks. Two sources: free rules over the
// sensor history (always on), and a vision-model health check of a photo
// (on demand, from the camera or an uploaded close-up).
export function HealthPanel() {
  const diagnoses = usePlantHealthStore((s) => s.diagnoses);
  const latest = usePlantHealthStore(selectLatestDiagnosis);
  const isSubmitting = usePlantHealthStore((s) => s.isSubmitting);
  const errorMessage = usePlantHealthStore((s) => s.errorMessage);
  const diagnose = usePlantHealthStore((s) => s.diagnose);
  const toggleTreatmentStep = usePlantHealthStore((s) => s.toggleTreatmentStep);
  const careTasks = usePlantCareStore((s) => s.tasks);
  const applySpecies = usePlantCareStore((s) => s.applySpecies);
  const clearDiagnoses = usePlantHealthStore((s) => s.clearDiagnoses);
  const cameraStatus = usePlantCameraStore((s) => s.cameraStatus);
  // Subscribed so the sensor risks below recompute when readings or memory change.
  usePlantSensorsStore((s) => selectSensorReadings(s).moisture);
  usePlantObserverStore((s) => s.observations);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const risks = computeSensorRisks();
  const diagnosis = latest?.diagnosis;
  const species = diagnosis?.species;
  const speciesApplied =
    species !== undefined &&
    careTasks.water.intervalDays === species.wateringIntervalDays &&
    careTasks.fertilize.intervalDays === species.fertilizeIntervalDays;
  const status: ActionStatus = isSubmitting
    ? "working"
    : diagnosis && (diagnosis.overallHealth === "poor" || diagnosis.overallHealth === "critical")
      ? "error"
      : risks.some((risk) => risk.level === "warning") || (diagnosis && diagnosis.issues.length > 0)
        ? "warn"
        : diagnosis
          ? "done"
          : "todo";

  const diagnoseFromCamera = async () => {
    setCameraError(null);
    try {
      await diagnose(await captureLiveFrame(), "camera");
    } catch (error) {
      setCameraError(error instanceof Error ? error.message : "拍照失败");
    }
  };

  return (
    <article>
      <header>
        {actionGlyph(status)} <strong>植物健康 · 病虫害</strong>{" "}
        {diagnosis && (
          <small>
            （{HEALTH_LEVEL_ICONS[diagnosis.overallHealth]} {HEALTH_LEVEL_LABELS[diagnosis.overallHealth]} ·{" "}
            {diagnosis.healthScore}/100）
          </small>
        )}
      </header>

      <p>
        <strong>传感器风险提示</strong>
        <br />
        {risks.length === 0 ? (
          <small>暂未发现土壤湿度或光照方面的风险。</small>
        ) : (
          risks.map((risk, index) => (
            <small key={`${risk.conditionId}-${index}`} className="health-risk">
              {risk.level === "warning" ? "⚠️" : "👀"} <strong>{findCondition(risk.conditionId)?.name}</strong>：
              {risk.reason}
              <br />
            </small>
          ))
        )}
      </p>

      <div className="health-actions">
        <button
          type="button"
          disabled={cameraStatus !== "ready" || isSubmitting}
          aria-busy={isSubmitting}
          onClick={() => void diagnoseFromCamera()}
        >
          {isSubmitting ? "正在诊断…" : "用摄像头诊断"}
        </button>
        <label>
          或上传叶片、茎、盆土的特写
          <input type="file" accept="image/*" onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)} />
        </label>
        <button
          type="button"
          className="secondary"
          disabled={!uploadFile || isSubmitting}
          onClick={() => uploadFile && void diagnose(uploadFile, "upload")}
        >
          诊断上传的照片
        </button>
      </div>
      {cameraStatus !== "ready" && (
        <small>先在摄像头面板里启动摄像头，或者上传一张照片。</small>
      )}
      {(errorMessage || cameraError) && (
        <p>
          <mark>{errorMessage ?? cameraError}</mark>
        </p>
      )}

      {latest && diagnosis && (
        <section className="health-result">
          <p>
            {latest.thumbnail && <img className="health-thumb" src={latest.thumbnail} alt="诊断用的照片" />}
            {diagnosis.summary}
          </p>

          {species && (
            <div className="health-species">
              <strong>🪴 {species.commonName}</strong>
              {species.scientificName && <em> {species.scientificName}</em>}{" "}
              <small>
                （{CONFIDENCE_LABELS[species.confidence]} · {CARE_DIFFICULTY_LABELS[species.careDifficulty]} ·{" "}
                {LIGHT_NEED_LABELS[species.lightNeed]}）
              </small>
              <br />
              <small>
                一般每 {species.wateringIntervalDays} 天浇一次水，每 {species.fertilizeIntervalDays} 天施一次肥。
                {species.careNotes}
              </small>
              <br />
              <button
                type="button"
                className="secondary outline health-small-button"
                disabled={speciesApplied}
                onClick={() => applySpecies(species)}
              >
                {speciesApplied ? "已按这个品种设置养护间隔" : "按这个品种设置浇水和施肥间隔"}
              </button>
            </div>
          )}

          {diagnosis.isolateFromOtherPlants && (
            <p>
              <mark>可能会传染，建议先把它和其他植物隔开。</mark>
            </p>
          )}

          {diagnosis.issues.length === 0 ? (
            <p>
              <small>没有看到明显的病虫害或养护问题。</small>
            </p>
          ) : (
            <ul className="health-issues">
              {diagnosis.issues.map((issue, index) => {
                const treated = latest.treatedIssues.includes(index);
                return (
                  <li key={index}>
                    <strong>{issue.name}</strong>{" "}
                    <small>
                      （{ISSUE_CATEGORY_LABELS[issue.category]} · {CONFIDENCE_LABELS[issue.confidence]} ·{" "}
                      {SEVERITY_LABELS[issue.severity]}）
                    </small>
                    <br />
                    <small>依据：{issue.evidence}</small>
                    <br />
                    <small>
                      处理步骤
                      {treated && "（已完成，已记入养护日志）"}：
                    </small>
                    <ol className="health-steps">
                      {issue.treatmentSteps.map((step, stepIndex) => (
                        <li key={stepIndex}>
                          <label>
                            <input
                              type="checkbox"
                              disabled={treated}
                              checked={treated || (latest.completedSteps[index] ?? []).includes(stepIndex)}
                              onChange={() => toggleTreatmentStep(latest.id, index, stepIndex)}
                            />
                            <span>{step}</span>
                          </label>
                        </li>
                      ))}
                    </ol>
                  </li>
                );
              })}
            </ul>
          )}

          <p>
            <strong>建议</strong>
          </p>
          <ul>
            {diagnosis.careAdvice.map((advice, index) => (
              <li key={index}>
                <small>{advice}</small>
              </li>
            ))}
          </ul>
          {diagnosis.followUp && (
            <p>
              <small>📷 想确认的话：{diagnosis.followUp}</small>
            </p>
          )}
          <p>
            <small>照片诊断只是参考，不能替代专业检查。用药前请先阅读产品说明。</small>
          </p>
        </section>
      )}

      {diagnoses.length > 1 && (
        <details>
          <summary>诊断记录（共 {diagnoses.length} 次）</summary>
          <ul className="history-list">
            {diagnoses
              .slice(-VISIBLE_HISTORY_COUNT)
              .reverse()
              .map((record) => (
                <li key={record.id}>
                  <small>
                    <strong>{new Date(record.recordedAt).toLocaleString()}</strong>{" "}
                    {HEALTH_LEVEL_ICONS[record.diagnosis.overallHealth]} {record.diagnosis.healthScore}/100 —{" "}
                    {record.diagnosis.issues.length === 0
                      ? "无明显问题"
                      : record.diagnosis.issues.map((issue) => issue.name).join("、")}
                  </small>
                </li>
              ))}
          </ul>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              if (window.confirm("确定要清除全部诊断记录吗？")) clearDiagnoses();
            }}
          >
            清除诊断记录
          </button>
        </details>
      )}

      <footer>
        <small>{latest ? latest.model : "还没有诊断过"}</small>
      </footer>
    </article>
  );
}
