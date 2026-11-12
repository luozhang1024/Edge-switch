import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { tools } from "./catalog";
import { t } from "./i18n";
import { ActionIcon } from "./ActionIcon";
import { ToolId } from "./types";
import "./prompt-groups.css";

type Prompt = {
  id: string;
  name: string;
  description: string;
  content: string;
  updated: number;
};
type Library = {
  prompts: Prompt[];
  active: string | null;
  path: string;
  revision: string;
  bytes: number;
};
const size = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
const bytes = (text: string) => new TextEncoder().encode(text).length;
const blank = (): Prompt => ({
  id: "",
  name: "",
  description: "",
  content: "",
  updated: 0,
});

export function PromptGroups({
  profileId,
  environment,
}: {
  profileId: string;
  environment: string;
}) {
  const [tool, setTool] = useState<ToolId>("codex");
  const [library, setLibrary] = useState<Library | null>(null);
  const [draft, setDraft] = useState<Prompt | null>(null);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const selected = tools.find((item) => item.id === tool)!;
  async function request(action = "list", id?: string, prompt?: Prompt) {
    const token = ++generation.current;
    setBusy(true);
    setError("");
    setNotice("");
    setMenu(null);
    try {
      const result = await invoke<Library>("prompt_library", {
        profileId,
        tool,
        action,
        id: id || null,
        prompt: prompt || null,
        revision: library?.revision ?? null,
      });
      if (token !== generation.current) return false;
      setLibrary(result);
      if (action !== "list")
        setNotice(
          t(
            action === "enable"
              ? "已启用，提示词已写入目标文件"
              : action === "disable"
                ? "已停用，目标文件已清空，历史内容保留在提示词库和备份中"
                : action === "delete"
                  ? "已删除提示词"
                  : "提示词已保存",
          ),
        );
      return true;
    } catch (e) {
      if (token === generation.current) setError(String(e));
      return false;
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    setLibrary(null);
    setDraft(null);
    setQuery("");
    void request();
    return () => {
      ++generation.current;
    };
  }, [profileId, tool]);
  useEffect(() => {
    const close = () => setMenu(null);
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", escape);
    };
  }, []);
  async function cancel() {
    if (!draft) return;
    const original = library?.prompts.find((p) => p.id === draft.id) || blank();
    if (
      JSON.stringify(original) !== JSON.stringify(draft) &&
      !(await confirm(t("放弃未保存的提示词修改？"), {
        title: t("提示词组"),
        kind: "warning",
      }))
    )
      return;
    setDraft(null);
    setError("");
  }
  const matches =
    library?.prompts.filter((p) =>
      [p.name, p.description, p.content]
        .join("\n")
        .toLowerCase()
        .includes(query.toLowerCase()),
    ) || [];
  return (
    <section className="pg-page" aria-label={t("提示词组")} aria-busy={busy}>
      <header className="pg-heading">
        <div className="pg-heading-title">
          {draft && (
            <button
              aria-label={t("返回提示词列表")}
              disabled={busy}
              onClick={() => void cancel()}
            >
              ‹
            </button>
          )}
          <ActionIcon name="prompts" />
          <h2>
            {draft
              ? `${t(draft.id ? "编辑提示词" : "添加提示词")} · ${selected.name}`
              : t("提示词组")}
          </h2>
        </div>
        {!draft && (
          <button
            className="pg-primary"
            disabled={busy || !library}
            onClick={() => {
              setDraft(blank());
              setNotice("");
              setError("");
            }}
          >
            ＋ {t("添加提示词")}
          </button>
        )}
      </header>
      {error && (
        <p className="pg-error" role="alert">
          {t(error)}
        </p>
      )}
      {notice && (
        <p className="pg-notice" role="status">
          {notice}
        </p>
      )}
      {!draft ? (
        <>
          <div className="pg-toolbar">
            <label className="pg-tool">
              <img src={selected.icon} alt="" />
              <select
                aria-label={t("提示词工具")}
                value={tool}
                disabled={busy}
                onChange={(e) => setTool(e.target.value as ToolId)}
              >
                {tools.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {tool === item.id && library
                      ? ` ${library.prompts.length}`
                      : ""}
                  </option>
                ))}
              </select>
            </label>
            <span className="pg-target" title={library?.path}>
              {t("目标文件")} <code>{library?.path || "—"}</code>
              {library && ` · ${size(library.bytes)}`}
            </span>
            <input
              className="pg-search"
              aria-label={t("搜索提示词")}
              placeholder={t("搜索名称、说明或正文")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              disabled={busy}
              aria-label={t("刷新提示词")}
              title={t("刷新提示词")}
              onClick={() => void request()}
            >
              ↻
            </button>
          </div>
          <div className="pg-context">
            {environment} ·{" "}
            {t("每个工具同时启用一条提示词；切换前自动保存当前文件内容。")}
          </div>
          <div className="pg-list">
            {matches.map((p) => (
              <article
                key={p.id}
                className={`pg-row ${library?.active === p.id ? "enabled" : ""}`}
              >
                <button
                  className="pg-row-copy"
                  disabled={busy}
                  onClick={() => {
                    setDraft({ ...p });
                    setError("");
                    setNotice("");
                  }}
                >
                  <span>
                    <b>{p.name}</b>
                    {library?.active === p.id && <em>{t("已启用")}</em>}
                  </span>
                  <small>
                    {p.description ||
                      p.content.split("\n").find((s) => s.trim()) ||
                      t("正文为空")}{" "}
                    · {size(bytes(p.content))} ·{" "}
                    {new Date(p.updated * 1000).toLocaleDateString()}{" "}
                    {t("更新")}
                  </small>
                </button>
                <div className="pg-actions">
                  <button
                    disabled={busy}
                    onClick={() =>
                      void request(
                        library?.active === p.id ? "disable" : "enable",
                        p.id,
                      )
                    }
                  >
                    {t(library?.active === p.id ? "停用" : "启用")}
                  </button>
                  <button
                    aria-label={`${t("编辑提示词")} ${p.name}`}
                    title={t("编辑提示词")}
                    disabled={busy}
                    onClick={() => {
                      setDraft({ ...p });
                      setError("");
                      setNotice("");
                    }}
                  >
                    <ActionIcon name="edit" />
                  </button>
                  <div
                    className="pg-menu-wrap"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      aria-label={`${t("更多操作")} ${p.name}`}
                      aria-expanded={menu === p.id}
                      disabled={busy}
                      onClick={() => setMenu(menu === p.id ? null : p.id)}
                    >
                      ⋯
                    </button>
                    {menu === p.id && (
                      <div className="pg-menu" role="menu">
                        <button
                          role="menuitem"
                          onClick={async () => {
                            setMenu(null);
                            try {
                              await navigator.clipboard.writeText(p.content);
                              setNotice(t("提示词正文已复制"));
                            } catch {
                              setError(t("复制未完成，请检查系统剪贴板权限"));
                            }
                          }}
                        >
                          {t("复制正文")}
                        </button>
                        <button
                          role="menuitem"
                          onClick={() => {
                            setMenu(null);
                            setDraft({
                              ...p,
                              id: "",
                              name: `${p.name} (${t("副本")})`,
                            });
                          }}
                        >
                          {t("创建副本")}
                        </button>
                        <button
                          role="menuitem"
                          className="pg-delete"
                          disabled={library?.active === p.id}
                          title={
                            library?.active === p.id
                              ? t("请先停用提示词再删除")
                              : undefined
                          }
                          onClick={async () => {
                            setMenu(null);
                            if (
                              await confirm(
                                t(
                                  "删除这条提示词？此操作只删除提示词库中的条目。",
                                ),
                                { title: t("删除提示词"), kind: "warning" },
                              )
                            )
                              void request("delete", p.id);
                          }}
                        >
                          {t("删除提示词")}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </article>
            ))}
            {!matches.length && (
              <p className="pg-empty">
                {t(
                  busy
                    ? "正在读取提示词…"
                    : query
                      ? "没有匹配的提示词"
                      : "暂无提示词，添加一条或在工具目标文件中编写后刷新。",
                )}
              </p>
            )}
          </div>
        </>
      ) : (
        <form
          className="pg-editor"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await request("save", draft.id, draft)) setDraft(null);
          }}
        >
          <label>
            {t("名称")}
            <span className="pg-required"> *</span>
            <input
              autoFocus
              required
              maxLength={200}
              aria-label={t("提示词名称")}
              placeholder={t("例如 团队编码规范")}
              value={draft.name}
              disabled={busy}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            {t("说明")}
            <input
              aria-label={t("提示词说明")}
              placeholder={t("可选，仅在 Edge Switch 中显示")}
              maxLength={1000}
              value={draft.description}
              disabled={busy}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value })
              }
            />
          </label>
          <label className="pg-body-label">
            {t("正文")}
            <textarea
              aria-label={t("提示词正文")}
              placeholder={`# ${tool === "claude" ? "CLAUDE.md" : tool === "gemini" ? "GEMINI.md" : "AGENTS.md"}\n\n${t("用 Markdown 编写工具的长期说明…")}`}
              value={draft.content}
              disabled={busy}
              spellCheck={false}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            />
          </label>
          <div className="pg-counter">
            {Array.from(draft.content).length.toLocaleString()} {t("个字符")} ·{" "}
            {size(bytes(draft.content))}
          </div>
          <footer className="pg-editor-footer">
            <small>
              {library?.active === draft.id
                ? t("保存后立即更新已启用的目标文件，并保留原文件备份。")
                : t("保存到提示词库，启用后写入目标文件。")}
            </small>
            <button type="button" disabled={busy} onClick={() => void cancel()}>
              {t("取消")}
            </button>
            <button
              className="pg-primary"
              type="submit"
              disabled={
                busy || !draft.name.trim() || bytes(draft.content) > 1024 * 1024
              }
            >
              {t(busy ? "正在保存…" : draft.id ? "保存" : "添加")}
            </button>
          </footer>
        </form>
      )}
    </section>
  );
}
