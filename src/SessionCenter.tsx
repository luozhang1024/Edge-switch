import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t } from "./i18n";
import { tools } from "./catalog";
import { ScrollList } from "./ScrollList";

type Session = {
  key: string;
  tool: string;
  id: string;
  title: string;
  project: string;
  modified: number;
  messages: { role: string; content: string }[];
  truncated: boolean;
  resume: string;
};
type Result = { sessions: Session[]; warnings: string[] };

export function SessionCenter({
  profileId,
  environment,
  onTerminal,
}: {
  profileId: string;
  environment: string;
  onTerminal: () => void;
}) {
  const [result, setResult] = useState<Result>({ sessions: [], warnings: [] });
  const [selected, setSelected] = useState<Session | null>(null);
  const [query, setQuery] = useState("");
  const [tool, setTool] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const generation = useRef(0);
  async function load(key?: string) {
    const request = ++generation.current;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const next = await invoke<Result>("query_sessions", {
        profileId,
        key: key ?? null,
      });
      if (request !== generation.current) return;
      if (key) setSelected(next.sessions[0] ?? null);
      else {
        setResult(next);
        setSelected(null);
      }
    } catch (e) {
      if (request === generation.current) setError(String(e));
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    setSelected(null);
    setResult({ sessions: [], warnings: [] });
    setQuery("");
    setTool("");
    void load();
    return () => {
      ++generation.current;
    };
  }, [profileId]);
  const sessions = result.sessions
    .filter(
      (s) =>
        (!tool || s.tool === tool) &&
        [s.title, s.id, s.project, ...s.messages.map((m) => m.content)]
          .join("\n")
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => b.modified - a.modified);
  const markdown = selected
    ? `# ${selected.title}\n\n${selected.project}\n\n${selected.messages.map((m) => `## ${m.role === "user" ? t("用户") : t("助手")}\n\n${m.content}`).join("\n\n")}`
    : "";
  return (
    <section className="session-center" aria-label={t("会话中心")}>
      <div className="session-heading">
        <div>
          <h2>{t("会话中心")}</h2>
          <p>
            {environment} · {t("当前环境的工具会话")}
          </p>
        </div>
        <button disabled={busy} onClick={() => void load()}>
          {t("刷新列表")}
        </button>
      </div>
      <p>
        {t(
          "读取会话列表和对话内容，不修改原始记录。搜索涵盖标题、目录、会话 ID 和已读取的消息摘要。",
        )}
      </p>
      <div className="session-filters">
        <label>
          {t("搜索会话")}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
          />
        </label>
        <label>
          {t("工具")}
          <select value={tool} onChange={(e) => setTool(e.target.value)}>
            <option value="">{t("全部工具")}</option>
            {tools.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {busy && <p role="status">{t("正在读取会话…")}</p>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {status && <p role="status">{t(status)}</p>}
      {result.warnings.map((warning) => (
        <p className="provider-help" key={warning}>
          {t(warning)}
        </p>
      ))}
      <div className="session-layout">
        <ScrollList className="session-list" label={t("会话列表")}>
          {sessions.map((s) => (
            <button
              className={`session-entry ${selected?.key === s.key ? "selected" : ""}`}
              key={s.key}
              disabled={busy}
              onClick={() => {
                setSelected(null);
                void load(s.key);
              }}
            >
              <b>{s.title}</b>
              <small>
                {tools.find((item) => item.id === s.tool)?.name} ·{" "}
                {new Date(s.modified * 1000).toLocaleString()}
              </small>
              <small>{s.project || s.id}</small>
              <p>{s.messages.at(-1)?.content.slice(0, 160)}</p>
            </button>
          ))}
          {!busy && !sessions.length && (
            <p>{t("暂无匹配会话。使用工具后刷新列表。")}</p>
          )}
        </ScrollList>
        <section className="session-reader" aria-label={t("会话详情")}>
          {selected ? (
            <>
              <h3>{selected.title}</h3>
              <p>{selected.project}</p>
              <small>{selected.id}</small>
              <div className="buttons">
                <button
                  disabled={!selected.messages.length}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(markdown);
                      setStatus("已复制对话");
                    } catch {
                      setError(t("复制未完成，请检查系统剪贴板权限"));
                    }
                  }}
                >
                  {t("复制对话")}
                </button>
                <button
                  disabled={!selected.messages.length}
                  onClick={() => {
                    const url = URL.createObjectURL(
                      new Blob([markdown], {
                        type: "text/markdown;charset=utf-8",
                      }),
                    );
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = `session-${selected.tool}-${selected.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 128) || "transcript"}.md`;
                    link.click();
                    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }}
                >
                  {t("导出 Markdown")}
                </button>
                {selected.resume && (
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(selected.resume);
                        setStatus(
                          "已复制恢复命令，请在对应环境的工程目录终端运行",
                        );
                      } catch {
                        setError(t("复制未完成，请检查系统剪贴板权限"));
                      }
                    }}
                  >
                    {t("复制恢复命令")}
                  </button>
                )}
                <button onClick={onTerminal}>{t("打开当前环境终端")}</button>
              </div>
              {selected.truncated && (
                <p role="note">
                  {t(
                    "会话较大，当前只读取前 1 MiB；复制和导出仅包含已读取内容。",
                  )}
                </p>
              )}
              <ScrollList className="session-messages" label={t("对话内容")}>
                {selected.messages.map((message, i) => (
                  <article
                    key={i}
                    className={`session-message ${message.role}`}
                  >
                    <b>{t(message.role === "user" ? "用户" : "助手")}</b>
                    <pre>{message.content}</pre>
                  </article>
                ))}
                {!selected.messages.length && (
                  <p>
                    {t(
                      "此记录暂无可阅读的对话内容，可能仅包含元数据或使用了尚不支持的日志格式。",
                    )}
                  </p>
                )}
              </ScrollList>
            </>
          ) : (
            <p>{t("选择会话查看对话内容。")}</p>
          )}
          {selected && !selected.resume && (
            <p>{t("当前日志格式或账号配置暂不支持生成恢复命令。")}</p>
          )}
        </section>
      </div>
    </section>
  );
}
