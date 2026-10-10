import { useEffect, useState } from "react";
import { placeholderPlantAnalysisJson } from "@/lib/plant/plants";
import { usePlantExperienceStore } from "@/stores/plant/experience-store";

export function PlantAnalysisPanel() {
  const analysis = usePlantExperienceStore((s) => s.analysis);
  const modelLabel = usePlantExperienceStore((s) => s.modelLabel);
  const jsonOutput = analysis ? JSON.stringify(analysis, null, 2) : placeholderPlantAnalysisJson;

  // Flash the results whenever a new analysis lands — the intake panel and this
  // one are separate cells in the grid, so the flash makes the connection
  // ("I clicked Analyze over there, the answer appeared here") obvious.
  // analyzePlantImage always sets a freshly-parsed object, so the identity
  // changes on every run, re-firing this effect; bumping the key remounts the
  // results and replays the CSS animation.
  const [flashKey, setFlashKey] = useState(0);
  useEffect(() => {
    if (analysis) setFlashKey((key) => key + 1);
  }, [analysis]);

  return (
    <article>
      <header>
        <strong>结构化植物分析</strong>
      </header>

      <p>
        <small>
          模型通过 zod 模式（<code>zodTextFormat</code>）被强制按这个 JSON 结构回答，因此输出可直接使用，无需解析文本。
        </small>
      </p>

      <div key={flashKey} className={flashKey > 0 ? "flash-on-update" : undefined}>
        <pre>
          <code>{jsonOutput}</code>
        </pre>

        <table>
          <thead>
            <tr>
              <th>属性</th>
              <th>数值</th>
              <th>刻度</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>干燥度</td>
              <td>{analysis ? analysis.dryness : "--"}</td>
              <td>1 水润 – 10 干燥</td>
            </tr>
            <tr>
              <td>尺寸</td>
              <td>{analysis ? `${analysis.size} 毫米` : "--"}</td>
              <td>估计的可见跨度</td>
            </tr>
            <tr>
              <td>分枝</td>
              <td>{analysis ? analysis.branching : "--"}</td>
              <td>0 稀疏 – 10 茂密</td>
            </tr>
            <tr>
              <td>表面质感</td>
              <td>{analysis ? analysis.physicalTexture : "--"}</td>
              <td>从照片判断的表面</td>
            </tr>
          </tbody>
        </table>
      </div>

      <footer>
        <small>{modelLabel}</small>
      </footer>
    </article>
  );
}
