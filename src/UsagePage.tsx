import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tools } from "./catalog";
import { ActionIcon } from "./ActionIcon";
import { t } from "./i18n";

type UsageRow = {
  id: string;
  tool: string;
  timestamp: number;
  provider: string;
  model: string;
  input: number;
  output: number;
  cached: number;
  write: number;
  cost: number | null;
};
export type UsageResult = {
  totals: Omit<UsageRow, "id" | "tool" | "timestamp" | "provider" | "model"> & {
    requests: number;
    priced: number;
  };
  options: { provider: string[]; model: string[] };
  trend: { index: number; tokens: number }[];
  groups: {
    provider: string;
    model: string;
    requests: number;
    tokens: number;
  }[];
  rows: UsageRow[];
  warnings: string[];
};
const compact = (value: number) =>
  new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
const money = (value: number | null | undefined) =>
  value == null ? "—" : `$${value.toFixed(4)}`;

export function UsagePage({
  profileId,
  environment,
}: {
  profileId: string;
  environment: string;
}) {
  const [range, setRange] = useState("today");
  const [tool, setTool] = useState("");
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [view, setView] = useState("requests");
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<UsageResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  // Local calendar boundaries are converted to UTC instants before querying the board.
  const now = new Date();
  const endDate = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
  );
  const startDate = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() -
      (range === "week"
        ? 6
        : range === "month"
          ? 29
          : range === "yesterday"
            ? 1
            : 0),
  );
  if (range === "yesterday") endDate.setDate(endDate.getDate() - 1);
  const start = startDate.getTime() / 1000;
  const end = endDate.getTime() / 1000;
  useEffect(() => {
    const request = ++sequence.current;
    setLoading(true);
    setError("");
    setResult(null);
    void invoke<UsageResult>("query_usage", {
      profileId,
      start,
      end,
      tool: tool || null,
      provider: provider || null,
      model: model || null,
      page,
    })
      .then((data) => {
        if (sequence.current === request) setResult(data);
      })
      .catch((reason) => {
        if (sequence.current === request) setError(String(reason));
      })
      .finally(() => {
        if (sequence.current === request) setLoading(false);
      });
    return () => {
      sequence.current++;
    };
  }, [profileId, start, end, tool, provider, model, page, revision]);
  const totals = result?.totals;
  const input =
    (totals?.input || 0) + (totals?.cached || 0) + (totals?.write || 0);
  const tokens = input + (totals?.output || 0);
  const maximum = Math.max(
    1,
    ...(result?.trend.map((item) => item.tokens) || []),
  );
  const filters = (change: () => void) => {
    change();
    setPage(0);
  };
  return (
    <section
      className="usage-page"
      aria-label={t("使用统计")}
      aria-busy={loading}
    >
      <header className="usage-heading">
        <div>
          <h2>
            <ActionIcon name="usage" />
            {t("用量统计")}
          </h2>
          <p>
            {environment} · {t("远程会话用量")}
          </p>
        </div>
        <button
          disabled={loading}
          onClick={() => setRevision((value) => value + 1)}
        >
          <ActionIcon name="upgrade" />
          {loading ? t("正在同步…") : t("刷新同步")}
        </button>
      </header>
      <div className="usage-filters">
        <select
          aria-label={t("统计时间范围")}
          value={range}
          onChange={(event) =>
            filters(() => {
              setRange(event.target.value);
              setProvider("");
              setModel("");
            })
          }
        >
          <option value="today">{t("当天")}</option>
          <option value="yesterday">{t("昨天")}</option>
          <option value="week">{t("最近 7 天")}</option>
          <option value="month">{t("最近 30 天")}</option>
        </select>
        <div className="usage-tools" role="group" aria-label={t("筛选工具")}>
          <button
            aria-pressed={!tool}
            onClick={() => filters(() => setTool(""))}
          >
            {t("全部")}
          </button>
          {tools.map((item) => (
            <button
              key={item.id}
              title={item.name}
              aria-label={item.name}
              aria-pressed={tool === item.id}
              onClick={() => filters(() => setTool(item.id))}
            >
              <img src={item.icon} alt="" />
            </button>
          ))}
        </div>
        <select
          aria-label={t("筛选供应商")}
          value={provider}
          onChange={(event) => filters(() => setProvider(event.target.value))}
        >
          <option value="">{t("全部供应商")}</option>
          {(result?.options.provider || (provider ? [provider] : [])).map(
            (value) => (
              <option key={value}>{value}</option>
            ),
          )}
        </select>
        <select
          aria-label={t("筛选模型")}
          value={model}
          onChange={(event) => filters(() => setModel(event.target.value))}
        >
          <option value="">{t("全部模型")}</option>
          {(result?.options.model || (model ? [model] : [])).map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </div>
      {error && (
        <div className="usage-error" role="alert">
          <p>{error}</p>
          <button onClick={() => setRevision((value) => value + 1)}>
            {t("重试")}
          </button>
        </div>
      )}
      {loading && <p role="status">{t("正在读取板卡会话记录…")}</p>}
      <div className="usage-overview">
        <div className="usage-metrics">
          {[
            ["总成本", money(totals?.cost)],
            ["总请求数", totals ? totals.requests.toLocaleString() : "—"],
            ["消耗 Tokens", totals ? compact(tokens) : "—"],
            [
              "缓存命中率",
              totals
                ? input
                  ? `${((totals.cached / input) * 100).toFixed(1)}%`
                  : "—"
                : "—",
            ],
          ].map(([label, value]) => (
            <div key={label}>
              <small>{t(label)}</small>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        <div className="usage-chart-heading">
          <b>
            {t(
              range === "today" || range === "yesterday"
                ? "Tokens · 按小时"
                : "Tokens · 按天",
            )}
          </b>
          <small>{totals ? `${compact(tokens)} Tokens` : "—"}</small>
        </div>
        <div
          className="usage-chart"
          role="img"
          aria-label={t("Token 使用趋势")}
        >
          {result?.trend.map((item) => {
            const date = new Date(
              (start + item.index * (end - start <= 86400 ? 3600 : 86400)) *
                1000,
            );
            const label =
              end - start <= 86400
                ? `${String(date.getHours()).padStart(2, "0")}:00`
                : `${date.getMonth() + 1}/${date.getDate()}`;
            return (
              <div
                className="usage-chart-column"
                key={item.index}
                title={`${label} · ${item.tokens.toLocaleString()} Tokens`}
              >
                <div className="usage-chart-track">
                  <i style={{ height: `${(item.tokens / maximum) * 100}%` }} />
                </div>
                <small>
                  {item.index %
                    (range === "month" ? 3 : end - start <= 86400 ? 3 : 1) ===
                  0
                    ? label
                    : ""}
                </small>
              </div>
            );
          })}
          {!result && <span className="usage-chart-placeholder">—</span>}
        </div>
      </div>
      <p className="usage-source-note">
        {t(
          "仅统计当前环境内已记录用量的模型请求。新增输入、输出、缓存读取与写入分别计数；费用仅显示日志记录的美元金额，未记录时显示 —，不代表供应商账单。",
        )}
        {totals &&
          totals.priced > 0 &&
          ` ${t("已记录费用")} ${totals.priced}/${totals.requests}`}
      </p>
      {result?.warnings.map((warning) => (
        <p key={warning} className="usage-error" role="status">
          {t(warning)}
        </p>
      ))}
      <div className="usage-log">
        <div
          className="usage-log-tabs"
          role="tablist"
          aria-label={t("统计明细")}
        >
          {[
            ["requests", "请求日志"],
            ["groups", "供应商 / 模型"],
          ].map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={view === id}
              onClick={() => setView(id)}
            >
              {t(label)}
              <small>
                {id === "requests"
                  ? (totals?.requests ?? "—")
                  : (result?.groups.length ?? "—")}
              </small>
            </button>
          ))}
        </div>
        <div
          className="usage-table-scroll"
          role="tabpanel"
          aria-label={t(view === "requests" ? "请求日志" : "供应商 / 模型")}
        >
          <table className="usage-table">
            <thead>
              <tr>
                {(view === "requests"
                  ? [
                      "时间",
                      "应用",
                      "供应商",
                      "模型",
                      "成本",
                      "新增输入",
                      "输出",
                      "缓存命中",
                      "缓存写入",
                    ]
                  : ["供应商", "模型", "请求数", "Tokens"]
                ).map((label) => (
                  <th key={label}>{t(label)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view === "requests"
                ? result?.rows.map((row) => (
                    <tr key={row.id}>
                      <td>{new Date(row.timestamp * 1000).toLocaleString()}</td>
                      <td>
                        <span className="usage-app">
                          <img
                            src={
                              tools.find((item) => item.id === row.tool)?.icon
                            }
                            alt=""
                          />
                          {tools.find((item) => item.id === row.tool)?.name ||
                            row.tool}
                        </span>
                      </td>
                      <td>{t(row.provider)}</td>
                      <td>{row.model}</td>
                      <td>{money(row.cost)}</td>
                      {[row.input, row.output, row.cached, row.write].map(
                        (value, index) => (
                          <td key={index}>{value.toLocaleString()}</td>
                        ),
                      )}
                    </tr>
                  ))
                : result?.groups.map((row) => (
                    <tr key={JSON.stringify([row.provider, row.model])}>
                      <td>{t(row.provider)}</td>
                      <td>{row.model}</td>
                      <td>{row.requests.toLocaleString()}</td>
                      <td>{compact(row.tokens)}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
          {result && totals?.requests === 0 && (
            <div className="usage-empty">
              <ActionIcon name="usage" />
              <b>{t("暂无用量记录")}</b>
              <p>{t("在当前板卡环境使用 AI 工具后，点击刷新同步。")}</p>
            </div>
          )}
        </div>
        {view === "requests" && (
          <footer className="usage-pagination">
            <span>
              {t("请求数")} · {totals?.requests ?? "—"}
            </span>
            <button
              disabled={loading || page === 0}
              onClick={() => setPage((value) => value - 1)}
            >
              {t("上一页")}
            </button>
            <span>
              {page + 1} /{" "}
              {Math.max(1, Math.ceil((totals?.requests || 0) / 50))}
            </span>
            <button
              disabled={
                loading || !totals || (page + 1) * 50 >= totals.requests
              }
              onClick={() => setPage((value) => value + 1)}
            >
              {t("下一页")}
            </button>
          </footer>
        )}
      </div>
    </section>
  );
}
