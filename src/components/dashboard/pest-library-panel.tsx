import { useState } from "react";
import { ISSUE_CATEGORY_LABELS, PLANT_CONDITIONS, type IssueCategory } from "@/lib/plant/health";

// A searchable field guide to common houseplant pests, diseases and care
// problems. Works offline — no model call.
export function PestLibraryPanel() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<IssueCategory | "all">("all");

  const categories = [...new Set(PLANT_CONDITIONS.map((condition) => condition.category))];
  const needle = query.trim().toLowerCase();
  const matches = PLANT_CONDITIONS.filter(
    (condition) =>
      (category === "all" || condition.category === category) &&
      (!needle ||
        [condition.name, condition.symptoms, condition.treatment, condition.id].some((text) =>
          text.toLowerCase().includes(needle),
        )),
  );

  return (
    <article>
      <header>
        <strong>病虫害图鉴</strong> <small>（{PLANT_CONDITIONS.length} 种常见问题）</small>
      </header>

      <div role="group">
        <input
          type="search"
          placeholder="搜索症状，比如：黄叶、白粉、小飞虫"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select value={category} onChange={(event) => setCategory(event.target.value as IssueCategory | "all")}>
          <option value="all">全部</option>
          {categories.map((value) => (
            <option key={value} value={value}>
              {ISSUE_CATEGORY_LABELS[value]}
            </option>
          ))}
        </select>
      </div>

      <div className="pest-library">
        {matches.length === 0 ? (
          <p>
            <small>没有找到相符的条目，试试换个说法，或者用健康面板拍照诊断。</small>
          </p>
        ) : (
          matches.map((condition) => (
            <details key={condition.id}>
              <summary>
                {condition.name} <small>（{ISSUE_CATEGORY_LABELS[condition.category]}）</small>
                {condition.contagious && <small> · 会传染</small>}
              </summary>
              <p>
                <small>
                  <strong>症状：</strong>
                  {condition.symptoms}
                </small>
              </p>
              <p>
                <small>
                  <strong>处理：</strong>
                  {condition.treatment}
                </small>
              </p>
              <p>
                <small>
                  <strong>预防：</strong>
                  {condition.prevention}
                </small>
              </p>
            </details>
          ))
        )}
      </div>
    </article>
  );
}
