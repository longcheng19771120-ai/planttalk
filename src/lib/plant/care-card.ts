// A one-page care card to print or save as PDF, for whoever looks after the
// plant while you are away.

import { CARE_ACTIONS, CARE_ACTION_ICONS, CARE_ACTION_LABELS, describeDaysUntil, describeTimeAgo, type CareTaskStatus } from "./care";
import { CARE_DIFFICULTY_LABELS, LIGHT_NEED_LABELS } from "./health";
import type { PlantSpecies } from "./schemas";

export interface CareCardInput {
  plantName: string;
  speciesName: string;
  species: PlantSpecies | null;
  isOutdoor: boolean;
  statuses: CareTaskStatus[];
  intervals: Partial<Record<(typeof CARE_ACTIONS)[number], number>>;
  openTreatments: Array<{ name: string; steps: string[] }>;
  notes: string;
  now: number;
}

export function buildCareCardHtml(input: CareCardInput) {
  const { species } = input;
  const title = input.speciesName.trim() || input.plantName;
  const rows = input.statuses
    .map((status) => {
      const interval = input.intervals[status.action];
      return `<tr><td>${CARE_ACTION_ICONS[status.action]} ${CARE_ACTION_LABELS[status.action]}</td><td>${
        interval ? `每 ${interval} 天` : ""
      }</td><td>${escapeHtml(describeTimeAgo(status.lastDoneAt, input.now))}</td><td>${escapeHtml(
        describeDaysUntil(status.daysUntilDue),
      )}</td></tr>`;
    })
    .join("");

  const facts = [
    input.isOutdoor ? "放在户外" : "放在室内",
    species ? `光照：${LIGHT_NEED_LABELS[species.lightNeed]}` : "",
    species ? `养护难度：${CARE_DIFFICULTY_LABELS[species.careDifficulty]}` : "",
  ].filter(Boolean);

  const treatments = input.openTreatments.length
    ? `<h2>正在处理的问题</h2>${input.openTreatments
        .map(
          (treatment) =>
            `<p><strong>${escapeHtml(treatment.name)}</strong></p><ul class="checks">${treatment.steps
              .map((step) => `<li>☐ ${escapeHtml(step)}</li>`)
              .join("")}</ul>`,
        )
        .join("")}`
    : "";

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)} 养护卡</title>
<style>
  body { font-family: system-ui, "PingFang SC", "Microsoft YaHei", sans-serif; color: #111; max-width: 42rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
  h1 { margin: 0 0 0.25rem; font-size: 1.6rem; }
  h2 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; border-bottom: 1px solid #ccc; }
  .sub { color: #555; margin: 0 0 1rem; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 0.35rem 0.5rem; border-bottom: 1px solid #ddd; }
  .checks { list-style: none; padding-left: 0; }
  .log td:last-child { width: 40%; }
  footer { margin-top: 2rem; color: #777; font-size: 0.85rem; }
  @media print { body { margin: 0 auto; } }
</style>
</head>
<body>
<h1>🪴 ${escapeHtml(title)}</h1>
<p class="sub">${escapeHtml(facts.join(" · "))}</p>
${species?.careNotes ? `<p>${escapeHtml(species.careNotes)}</p>` : ""}
<h2>养护计划</h2>
<table>
<thead><tr><th>项目</th><th>间隔</th><th>上次</th><th>下次</th></tr></thead>
<tbody>${rows}</tbody>
</table>
${treatments}
${input.notes.trim() ? `<h2>备注</h2><p>${escapeHtml(input.notes.trim()).replace(/\n/g, "<br>")}</p>` : ""}
<h2>照看记录</h2>
<table class="log">
<thead><tr><th>日期</th><th>做了什么</th><th>备注</th></tr></thead>
<tbody>${"<tr><td>&nbsp;</td><td></td><td></td></tr>".repeat(6)}</tbody>
</table>
<footer>由 Plant Talk 生成于 ${escapeHtml(new Date(input.now).toLocaleString("zh-CN"))}</footer>
</body>
</html>`;
}

/** Opens the card in a new window and shows the print dialog (where "Save as PDF" lives). */
export function printCareCard(input: CareCardInput) {
  const win = window.open("", "_blank");
  if (!win) throw new Error("浏览器拦截了新窗口，请允许本站弹出窗口后再试");
  win.document.open();
  win.document.write(buildCareCardHtml(input));
  win.document.close();
  win.focus();
  // Give the written document a moment to lay out before printing.
  setTimeout(() => {
    if (!win.closed) win.print();
  }, 300);
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}
