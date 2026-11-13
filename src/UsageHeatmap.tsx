import React, { useState } from "react";
import { t } from "./i18n";
import "./usage-heatmap.css";
export function UsageHeatmap({
  daily,
}: {
  daily: { date: string; tokens: number; requests: number }[];
}) {
  const currentYear = new Date().getFullYear();
  const years = [
    ...new Set([currentYear, ...daily.map((d) => Number(d.date.slice(0, 4)))]),
  ].sort((a, b) => b - a);
  const [selected, setSelected] = useState<number | null>(null);
  const year = selected && years.includes(selected) ? selected : years[0];
  const values = new Map(daily.map((d) => [d.date, d]));
  const days: {
    date: string;
    tokens: number;
    requests: number;
    month: string;
  }[] = [];
  for (
    let date = new Date(year, 0, 1);
    date.getFullYear() === year;
    date.setDate(date.getDate() + 1)
  ) {
    const key = `${year}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    days.push({
      date: key,
      tokens: values.get(key)?.tokens || 0,
      requests: values.get(key)?.requests || 0,
      month: date.getDate() === 1 ? `${date.getMonth() + 1}${t("月")}` : "",
    });
  }
  const maximum = Math.max(1, ...days.map((d) => d.tokens));
  const first = new Date(year, 0, 1).getDay();
  return (
    <section className="usage-heatmap" aria-label={t("全部用量热力图")}>
      <header>
        <b>{t("全部用量热力图")}</b>
        <label>
          {t("年份")}{" "}
          <select
            aria-label={t("热力图年份")}
            value={year}
            onChange={(e) => setSelected(Number(e.target.value))}
          >
            {years.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </label>
      </header>
      <div className="heatmap-scroll">
        <div
          className="heatmap-grid"
          role="img"
          aria-label={`${year} · ${t("每日 Token 用量")}`}
        >
          {Array.from({ length: first }, (_, i) => (
            <span key={`blank-${i}`} />
          ))}
          {days.map((d) => (
            <button
              type="button"
              className="heatmap-cell"
              key={d.date}
              data-level={
                d.tokens === 0
                  ? 0
                  : Math.min(4, Math.ceil((d.tokens / maximum) * 4))
              }
              title={`${d.date} · ${d.tokens.toLocaleString()} Tokens · ${d.requests} ${t("请求")}`}
              aria-label={`${d.date} · ${d.tokens.toLocaleString()} Tokens · ${d.requests} ${t("请求")}`}
            />
          ))}
        </div>
      </div>
      <footer>
        <span>
          {year} · {days.filter((d) => d.tokens > 0).length} {t("活跃天数")} ·{" "}
          {days.reduce((n, d) => n + d.tokens, 0).toLocaleString()} Tokens
        </span>
        <span>
          {t("少")}
          {[0, 1, 2, 3, 4].map((n) => (
            <i key={n} data-level={n} />
          ))}
          {t("多")}
        </span>
      </footer>
    </section>
  );
}
