import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t } from "./i18n";
import { tools } from "./catalog";
import { ActionIcon } from "./ActionIcon";
import { SessionText } from "./SessionText";
import "./session-center.css";

type Message = {
  role: string;
  content: string;
  timestamp?: string;
  model?: string;
  steps?: { name: string; content: string }[];
};
type Session = {
  key: string;
  tool: string;
  id: string;
  title: string;
  project: string;
  modified: number;
  messages: Message[];
  truncated: boolean;
  resume: string;
  provider?: string;
  model?: string;
  usage?: {
    input: number;
    output: number;
    cached: number;
    write: number;
    requests: number;
  };
};
type Result = { sessions: Session[]; warnings: string[] };
const tokenCount = (s: Session) =>
  s.usage ? s.usage.input + s.usage.output + s.usage.cached + s.usage.write : 0;

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
  const [grouping, setGrouping] = useState<"time" | "project">("project");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showTools, setShowTools] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showOutline, setShowOutline] = useState(true);
  const [view, setView] = useState<"all" | "dialogue" | "changes">("all");
  const [find, setFind] = useState("");
  const [showFind, setShowFind] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [activeTurn, setActiveTurn] = useState(0);
  const generation = useRef(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

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
      if (key) {
        setSelected(next.sessions[0] ?? null);
        setActiveTurn(0);
        setFind("");
        setView("all");
        transcriptRef.current?.scrollTo?.({ top: 0 });
      } else {
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
    setShowTools(false);
    setShowMenu(false);
    setCollapsed(new Set());
    void load();
    return () => {
      ++generation.current;
    };
  }, [profileId]);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node))
        setShowTools(false);
      if (!menuRef.current?.contains(event.target as Node)) setShowMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
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
  const groups = Array.from(
    sessions
      .reduce((map, session) => {
        const key =
          grouping === "project"
            ? session.project || t("未命名项目")
            : new Date(session.modified * 1000).toLocaleDateString();
        map.set(key, [...(map.get(key) || []), session]);
        return map;
      }, new Map<string, Session[]>())
      .entries(),
  );
  const selectedTool = tools.find((item) => item.id === selected?.tool);
  const position = sessions.findIndex((s) => s.key === selected?.key);
  const questions =
    selected?.messages.flatMap((m, index) =>
      m.role === "user" ? [{ message: m, index }] : [],
    ) || [];
  const markdown = selected
    ? `# ${selected.title}\n\n${selected.project}\n\n${selected.messages.map((m) => `## ${m.role === "user" ? t("用户") : t("助手")}\n\n${m.content}`).join("\n\n")}`
    : "";
  async function copy(text: string, message: string) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus(message);
    } catch {
      setError(t("复制未完成，请检查系统剪贴板权限"));
    }
  }
  function exportMarkdown() {
    if (!selected) return;
    const url = URL.createObjectURL(
      new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `session-${selected.tool}-${selected.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 128) || "transcript"}.md`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const iconButton = (
    name: string,
    icon: React.ReactNode,
    action: () => void,
    disabled = false,
  ) => (
    <button
      className="sc-icon-button"
      title={t(name)}
      aria-label={t(name)}
      disabled={disabled}
      onClick={action}
    >
      {icon}
    </button>
  );
  function jump(index: number) {
    setActiveTurn(index);
    transcriptRef.current
      ?.querySelector(`[data-message-index="${index}"]`)
      ?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }
  return (
    <section
      className={`session-center sc-browser ${selected ? "sc-reading" : ""}`}
      aria-label={t("会话中心")}
      onKeyDown={(event) => {
        if (event.key === "Escape" && (showTools || showMenu || showFind)) {
          event.stopPropagation();
          setShowTools(false);
          setShowMenu(false);
          setShowFind(false);
        }
      }}
    >
      <header className="sc-header">
        {selected ? (
          <>
            {iconButton("返回会话列表", "←", () => {
              setSelected(null);
              setStatus("");
              setError("");
            })}
            <img className="sc-app-icon" src={selectedTool?.icon} alt="" />
            <h2 title={selected.title}>{selected.title}</h2>
            <div className="sc-header-actions">
              {iconButton(
                "上一个会话",
                "‹",
                () => void load(sessions[position - 1].key),
                busy || position <= 0,
              )}
              {iconButton(
                "下一个会话",
                "›",
                () => void load(sessions[position + 1].key),
                busy || position < 0 || position >= sessions.length - 1,
              )}
              <button
                className="sc-resume"
                disabled={!selected.resume || busy}
                onClick={() =>
                  void copy(
                    selected.resume,
                    "已复制恢复命令，请在对应环境的工程目录终端运行",
                  )
                }
              >
                <ActionIcon name="copy" />
                {t("复制恢复命令")}
              </button>
            </div>
          </>
        ) : (
          <>
            <ActionIcon name="logs" />
            <h2>{t("会话中心")}</h2>
            <span className="sc-environment">{environment}</span>
          </>
        )}
        <div className="sc-menu-wrap" ref={menuRef}>
          {iconButton("更多操作", "•••", () => setShowMenu(!showMenu))}
          {showMenu && (
            <div className="sc-popover sc-actions-menu">
              <button
                disabled={busy}
                onClick={() => {
                  setShowMenu(false);
                  void load(selected?.key);
                }}
              >
                {t(selected ? "刷新会话" : "刷新列表")}
              </button>
              {selected && (
                <>
                  <button
                    disabled={!selected.messages.length}
                    onClick={() => {
                      setShowMenu(false);
                      void copy(markdown, "已复制对话");
                    }}
                  >
                    {t("复制对话")}
                  </button>
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      exportMarkdown();
                    }}
                  >
                    {t("导出 Markdown")}
                  </button>
                  <button onClick={onTerminal}>{t("打开当前环境终端")}</button>
                </>
              )}
              {result.warnings.length > 0 && (
                <div className="sc-scan-notes">
                  {result.warnings.map((warning) => (
                    <p key={warning}>{t(warning)}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </header>
      {error && (
        <p role="alert" className="sc-notice error">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="sc-notice">
          {t(status)}
        </p>
      )}
      {busy && (
        <p role="status" className="sc-notice">
          {t("正在读取会话…")}
        </p>
      )}
      {!selected ? (
        <>
          <div className="sc-toolbar">
            <div className="sc-picker" ref={pickerRef}>
              <button
                className="sc-app-select"
                aria-label={t("筛选应用")}
                aria-expanded={showTools}
                onClick={() => setShowTools(!showTools)}
              >
                <span>▦</span>
                {tools.find((item) => item.id === tool)?.name || t("全部应用")}
                <small>
                  {
                    result.sessions.filter((s) => !tool || s.tool === tool)
                      .length
                  }
                </small>
                <span>⌄</span>
              </button>
              {showTools && (
                <div
                  className="sc-popover sc-app-menu"
                  role="menu"
                  aria-label={t("应用筛选")}
                >
                  {[{ id: "", name: t("全部应用"), icon: "" }, ...tools].map(
                    (item) => {
                      const count = result.sessions.filter(
                        (s) => !item.id || s.tool === item.id,
                      ).length;
                      return (
                        <button
                          key={item.id}
                          role="menuitemradio"
                          aria-checked={tool === item.id}
                          onClick={() => {
                            setTool(item.id);
                            setShowTools(false);
                          }}
                        >
                          {item.icon ? (
                            <img src={item.icon} alt="" />
                          ) : (
                            <span>▦</span>
                          )}
                          <b>{item.name}</b>
                          <small>{count || t("无会话")}</small>
                          <span>{tool === item.id ? "✓" : ""}</span>
                        </button>
                      );
                    },
                  )}
                </div>
              )}
            </div>
            <label className="sc-search">
              <span>⌕</span>
              <input
                aria-label={t("搜索会话")}
                placeholder={t("搜索标题、目录、首末消息或会话 ID")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setQuery("");
                  }
                }}
              />
            </label>
            <div
              className="sc-segments"
              role="group"
              aria-label={t("会话分组")}
            >
              <button
                aria-pressed={grouping === "time"}
                onClick={() => setGrouping("time")}
              >
                {t("按时间")}
              </button>
              <button
                aria-pressed={grouping === "project"}
                onClick={() => setGrouping("project")}
              >
                {t("按项目")}
              </button>
            </div>
            {iconButton("刷新列表", "↻", () => void load(), busy)}
          </div>
          <div
            className="sc-group-list"
            role="region"
            aria-label={t("会话列表")}
          >
            {groups.map(([group, entries]) => (
              <section className="sc-project-group" key={group}>
                <button
                  className="sc-group-heading"
                  aria-expanded={!collapsed.has(group)}
                  onClick={() =>
                    setCollapsed((old) => {
                      const next = new Set(old);
                      if (next.has(group)) next.delete(group);
                      else next.add(group);
                      return next;
                    })
                  }
                >
                  <span
                    className={`sc-chevron ${collapsed.has(group) ? "" : "expanded"}`}
                  >
                    ›
                  </span>
                  <b>
                    {grouping === "project"
                      ? group.split(/[\\/]/).filter(Boolean).at(-1) || group
                      : group}
                  </b>
                  {grouping === "project" && (
                    <small title={group}>{group}</small>
                  )}
                  <span className="sc-group-count">
                    {tools
                      .map((item) => {
                        const count = entries.filter(
                          (s) => s.tool === item.id,
                        ).length;
                        return count ? `${item.name} ${count}` : "";
                      })
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
                {!collapsed.has(group) &&
                  entries.map((s) => (
                    <button
                      className="sc-session-row"
                      key={s.key}
                      disabled={busy}
                      onClick={() => void load(s.key)}
                    >
                      <img
                        src={tools.find((item) => item.id === s.tool)?.icon}
                        alt=""
                      />
                      <span className="sc-session-copy">
                        <b>{s.title}</b>
                        <small>
                          {s.messages.at(-1)?.content.slice(0, 110) || s.id}
                        </small>
                      </span>
                      <span className="sc-session-app">
                        {tools.find((item) => item.id === s.tool)?.name}
                        {s.provider && <small>{s.provider}</small>}
                        {tokenCount(s) > 0 && (
                          <small>{tokenCount(s).toLocaleString()} Tokens</small>
                        )}
                      </span>
                      <time>
                        {new Date(s.modified * 1000).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                      <span>›</span>
                    </button>
                  ))}
              </section>
            ))}
            {!busy && !sessions.length && (
              <p className="sc-empty">
                {t("暂无匹配会话。使用工具后刷新列表。")}
              </p>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="sc-reader-toolbar">
            <div className="sc-project-path" title={selected.project}>
              <ActionIcon name="logs" />
              <span>{selected.project || t("未命名项目")}</span>
            </div>
            <div className="sc-reader-controls">
              {iconButton("切换对话目录", "◧", () =>
                setShowOutline(!showOutline),
              )}
              <div
                className="sc-segments"
                role="group"
                aria-label={t("阅读视图")}
              >
                {(
                  [
                    ["all", "全部"],
                    ["dialogue", "对话"],
                    ["changes", "改动"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    aria-pressed={view === id}
                    onClick={() => setView(id)}
                  >
                    {t(label)}
                  </button>
                ))}
              </div>
              {iconButton(
                "导出 Markdown",
                <ActionIcon name="logs" />,
                exportMarkdown,
              )}
              {iconButton("查找对话", "⌕", () => setShowFind(!showFind))}
            </div>
          </div>
          <div className="sc-session-meta">
            <span>{new Date(selected.modified * 1000).toLocaleString()}</span>
            <span>
              {questions.length} {t("次提问")}
            </span>
            <span>{selectedTool?.name}</span>
            {selected.provider && <span>{selected.provider}</span>}
            {selected.model && <span>{selected.model}</span>}
            {tokenCount(selected) > 0 && (
              <span
                title={`${t("输入")} ${selected.usage!.input.toLocaleString()} · ${t("输出")} ${selected.usage!.output.toLocaleString()} · ${t("缓存")} ${(selected.usage!.cached + selected.usage!.write).toLocaleString()}`}
              >
                {tokenCount(selected).toLocaleString()} Tokens
              </span>
            )}
            {selected.truncated && (
              <span className="sc-truncated">{t("仅显示前 1 MiB")}</span>
            )}
          </div>
          {showFind && (
            <label className="sc-search sc-transcript-search">
              <span>⌕</span>
              <input
                autoFocus
                aria-label={t("查找对话")}
                placeholder={t("查找当前会话内容")}
                value={find}
                onChange={(e) => setFind(e.target.value)}
              />
            </label>
          )}
          <div
            className={`sc-reader-layout ${showOutline ? "" : "no-outline"}`}
          >
            <div
              className="sc-transcript session-messages"
              ref={transcriptRef}
              role="region"
              aria-label={t("对话内容")}
              onScroll={() => {
                const container = transcriptRef.current;
                if (!container) return;
                const top = container.getBoundingClientRect().top;
                const current = questions
                  .filter(({ index }) => {
                    const node = container.querySelector(
                      `[data-message-index="${index}"]`,
                    );
                    return node && node.getBoundingClientRect().top <= top + 90;
                  })
                  .at(-1);
                if (current) setActiveTurn(current.index);
              }}
            >
              {selected.messages.map((message, index) => {
                const steps = message.steps || [];
                const changes = steps.filter((step) =>
                  /edit|patch|write|diff/i.test(step.name),
                );
                if (
                  find &&
                  ![message.content, ...steps.map((s) => s.content)]
                    .join("\n")
                    .toLowerCase()
                    .includes(find.toLowerCase())
                )
                  return null;
                if (view === "changes" && !changes.length) return null;
                return (
                  <article
                    key={index}
                    data-message-index={index}
                    className={`sc-message ${message.role}`}
                  >
                    <header>
                      {message.role !== "user" && (
                        <img src={selectedTool?.icon} alt="" />
                      )}
                      <b>
                        {message.role === "user" ? t("你") : selectedTool?.name}
                      </b>
                      {message.timestamp && (
                        <time>
                          {new Date(message.timestamp).toLocaleString()}
                        </time>
                      )}
                      {message.model && <small>{message.model}</small>}
                    </header>
                    {view !== "dialogue" &&
                      (view === "changes" ? changes : steps).length > 0 && (
                        <details className="sc-execution">
                          <summary>
                            {t("执行过程")} ·{" "}
                            {(view === "changes" ? changes : steps).length}{" "}
                            {t("步")}
                          </summary>
                          {(view === "changes" ? changes : steps).map(
                            (step, stepIndex) => (
                              <details key={stepIndex}>
                                <summary>{step.name}</summary>
                                <pre>{step.content}</pre>
                              </details>
                            ),
                          )}
                        </details>
                      )}
                    {view !== "changes" && message.content && (
                      <div className="sc-message-content">
                        <SessionText text={message.content} />
                        {iconButton(
                          "复制消息",
                          <ActionIcon name="copy" />,
                          () => void copy(message.content, "已复制消息"),
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
              {!selected.messages.length && (
                <p className="sc-empty">
                  {t(
                    "此记录暂无可阅读的对话内容，可能仅包含元数据或使用了尚不支持的日志格式。",
                  )}
                </p>
              )}
              {view === "changes" &&
                !selected.messages.some((m) =>
                  m.steps?.some((s) => /edit|patch|write|diff/i.test(s.name)),
                ) && (
                  <p className="sc-empty">
                    {t("此会话没有可展示的改动记录。")}
                  </p>
                )}
              {selected.truncated && (
                <p className="sc-footnote">
                  {t(
                    "会话较大，当前只读取前 1 MiB；复制和导出仅包含已读取内容。",
                  )}
                </p>
              )}
            </div>
            {showOutline && (
              <nav className="sc-outline" aria-label={t("对话目录")}>
                <h3>
                  {t("对话目录")} <small>{questions.length}</small>
                </h3>
                {questions.map(({ message, index }, number) => (
                  <button
                    key={index}
                    className={activeTurn === index ? "active" : ""}
                    onClick={() => jump(index)}
                  >
                    <small>
                      {String(number + 1).padStart(2, "0")} · {t("你")}
                    </small>
                    <p>{message.content.slice(0, 180)}</p>
                    <span>
                      {selected.messages
                        .slice(index + 1)
                        .find((m) => m.role === "assistant")
                        ?.content.slice(0, 130)}
                    </span>
                  </button>
                ))}
              </nav>
            )}
          </div>
        </>
      )}
    </section>
  );
}
