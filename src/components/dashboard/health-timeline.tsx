import { HEALTH_LEVEL_ICONS } from "@/lib/plant/health";
import type { PlantDiagnosisRecord } from "@/stores/plant/health-store";

const CHART_POINTS = 20;
const PHOTO_COUNT = 8;
const WIDTH = 300;
const HEIGHT = 90;
const PAD_X = 8;
const PAD_Y = 10;

// Health score over the recent checks, plus a strip of the photos they looked
// at, so you can see whether the plant is getting better or worse.
export function HealthTimeline({ diagnoses }: { diagnoses: PlantDiagnosisRecord[] }) {
  const points = diagnoses.slice(-CHART_POINTS);
  if (points.length < 2) return null;

  const x = (index: number) => PAD_X + (index * (WIDTH - PAD_X * 2)) / (points.length - 1);
  const y = (score: number) => PAD_Y + ((100 - score) * (HEIGHT - PAD_Y * 2)) / 100;
  const line = points.map((record, index) => `${x(index)},${y(record.diagnosis.healthScore)}`).join(" ");
  const first = points[0].diagnosis.healthScore;
  const last = points[points.length - 1].diagnosis.healthScore;
  const change = last - first;
  const photos = diagnoses.filter((record) => record.thumbnail).slice(-PHOTO_COUNT);

  return (
    <section className="health-timeline">
      <p>
        <strong>健康分变化</strong>{" "}
        <small>
          （最近 {points.length} 次：{first} → {last}，
          {change > 0 ? `好转 ${change} 分` : change < 0 ? `下降 ${-change} 分` : "没有变化"}）
        </small>
      </p>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="health-chart"
        role="img"
        aria-label={`健康分从 ${first} 变为 ${last}`}
      >
        {[25, 50, 75].map((score) => (
          <line key={score} x1={PAD_X} x2={WIDTH - PAD_X} y1={y(score)} y2={y(score)} className="health-chart-grid" />
        ))}
        <polyline points={line} className="health-chart-line" />
        {points.map((record, index) => (
          <circle key={record.id} cx={x(index)} cy={y(record.diagnosis.healthScore)} r={3} className="health-chart-dot">
            <title>
              {new Date(record.recordedAt).toLocaleString()}：{record.diagnosis.healthScore} 分
            </title>
          </circle>
        ))}
      </svg>
      <small className="health-chart-dates">
        <span>{new Date(points[0].recordedAt).toLocaleDateString()}</span>
        <span>{new Date(points[points.length - 1].recordedAt).toLocaleDateString()}</span>
      </small>

      {photos.length > 1 && (
        <div className="health-photos">
          {photos.map((record) => (
            <figure key={record.id}>
              <img src={record.thumbnail ?? undefined} alt={`${new Date(record.recordedAt).toLocaleDateString()} 的照片`} />
              <figcaption>
                {new Date(record.recordedAt).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}{" "}
                {HEALTH_LEVEL_ICONS[record.diagnosis.overallHealth]} {record.diagnosis.healthScore}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}
