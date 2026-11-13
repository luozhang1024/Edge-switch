import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ActionIcon } from "./ActionIcon";
import { t } from "./i18n";
import { tools } from "./catalog";
import "./skills.css";

type Skill = {
  id: string;
  name: string;
  description: string;
  enabled?: string[];
  tool?: string;
  repo?: string;
  path?: string;
  sha?: string;
};
type Library = { skills: Skill[]; candidates: Skill[]; path: string };
const targets = tools.filter((tool) => tool.id !== "harness");

export function SkillsPage({
  profileId,
  environment,
}: {
  profileId: string;
  environment: string;
}) {
  const [library, setLibrary] = useState<Library | null>(null);
  const [view, setView] = useState("installed");
  const [menu, setMenu] = useState(false);
  const [importing, setImporting] = useState(false);
  const [repo, setRepo] = useState("anthropics/skills");
  const [discovered, setDiscovered] = useState<Skill[]>([]);
  const [loadedRepo, setLoadedRepo] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [installTargets, setInstallTargets] = useState<string[]>(["codex"]);
  const generation = useRef(0);
  const request = <T,>(action: string, payload: object = {}) =>
    invoke<T>("skills_request", { profileId, action, payload });
  async function refresh() {
    setLibrary(await request<Library>("list"));
  }
  async function run(work: () => Promise<void>) {
    const current = ++generation.current;
    setBusy(true);
    setError("");
    setNotice("");
    setMenu(false);
    try {
      await work();
    } catch (e) {
      if (generation.current === current) setError(String(e));
    } finally {
      if (generation.current === current) setBusy(false);
    }
  }
  useEffect(() => {
    void run(refresh);
    return () => {
      ++generation.current;
    };
  }, [profileId]);
  useEffect(() => {
    const close = () => setMenu(false);
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(false);
        setImporting(false);
      }
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", escape);
    };
  }, []);
  async function discover() {
    await run(async () => {
      const result = await request<{ skills: Skill[] }>("discover", { repo });
      setDiscovered(result.skills);
      setLoadedRepo(repo);
    });
  }
  async function enableInstalled(ids: string[]) {
    const failures: string[] = [];
    for (const id of ids)
      for (const tool of installTargets) {
        try {
          await request("enable", { id, tool });
        } catch (e) {
          failures.push(`${id} · ${tool}: ${String(e)}`);
        }
      }
    await refresh();
    if (failures.length) setError(failures.join("\n"));
  }
  async function install(skill: Skill) {
    await run(async () => {
      await request("install_repo", skill);
      await enableInstalled([skill.id]);
      setNotice(t("已加入技能库，可在已安装中调整工具开关。"));
    });
  }
  async function installZip() {
    const path = await open({
      title: t("从 ZIP 安装"),
      filters: [{ name: "Skill ZIP", extensions: ["zip"] }],
      multiple: false,
    });
    if (typeof path !== "string") return;
    await run(async () => {
      const result = await request<{ installed: number; skipped: number }>(
        "install_zip",
        { path },
      );
      await refresh();
      setView("installed");
      setNotice(
        `${t("已导入")}: ${result.installed} · ${t("已跳过同名技能")}: ${result.skipped} · ${t("请使用工具开关启用。")}`,
      );
    });
  }
  const rows = (
    view === "installed" ? library?.skills || [] : discovered
  ).filter((skill) =>
    `${skill.name} ${skill.id} ${skill.description}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <section className="skills-page">
      <header className="skills-heading">
        <div>
          <h2>
            <ActionIcon name="skills" /> Skills <small>{t("技能")}</small>
          </h2>
          <p>{t("发现、安装并管理工具技能。")}</p>
        </div>
        <div className="skills-heading-actions">
          <button disabled={busy} onClick={() => void run(refresh)}>
            {t("刷新")}
          </button>
          <div
            className="skills-menu-anchor"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="primary"
              disabled={busy}
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              ＋ {t("添加 Skill")}⌄
            </button>
            {menu && (
              <div className="skills-menu" role="menu">
                <button
                  role="menuitem"
                  onClick={() => {
                    setView("discover");
                    setMenu(false);
                    if (!loadedRepo) void discover();
                  }}
                >
                  {t("在发现里浏览")}
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    void installZip().catch((e) => setError(String(e)));
                  }}
                >
                  {t("从 ZIP 安装")}
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setImporting(true);
                    setMenu(false);
                  }}
                >
                  {t("导入本机已有")}{" "}
                  <span>{library?.candidates.length || 0}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <p className="settings-note">
        {t(
          "Grok 社区 CLI 的技能会在启动时合并到 GROK.md；项目级指令优先于用户级指令。",
        )}
      </p>
      <div className="skills-context">
        <span>
          {t("当前工作环境")} · <b>{environment}</b>
        </span>
        <small>{t("技能库保存在本机，工具开关应用到当前工作环境。")}</small>
      </div>
      <div className="skills-tabs" role="tablist" aria-label="Skills">
        <button
          role="tab"
          aria-selected={view === "installed"}
          onClick={() => {
            setView("installed");
            setQuery("");
          }}
        >
          {t("已安装")} {library?.skills.length || 0}
        </button>
        <button
          role="tab"
          aria-selected={view === "discover"}
          onClick={() => {
            setView("discover");
            setQuery("");
            if (!loadedRepo && !busy) void discover();
          }}
        >
          {t("发现")}
        </button>
      </div>
      {error && (
        <div className="skills-error" role="alert">
          {error}
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {busy && <p role="status">{t("正在处理…")}</p>}
      {view === "discover" && (
        <div className="skills-discovery">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void discover();
            }}
          >
            <label>
              {t("GitHub 技能仓库")}
              <input
                aria-label={t("GitHub 技能仓库")}
                value={repo}
                placeholder="owner/repo"
                onChange={(e) => setRepo(e.target.value)}
              />
            </label>
            <button type="submit" disabled={busy}>
              {t("读取仓库")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setRepo("openai/skills")}
            >
              OpenAI
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setRepo("anthropics/skills")}
            >
              Anthropic
            </button>
          </form>
          <div className="skills-install-targets">
            <span>{t("安装到")}</span>
            {targets.map((tool) => (
              <label key={tool.id} title={tool.name}>
                <input
                  type="checkbox"
                  checked={installTargets.includes(tool.id)}
                  onChange={(e) =>
                    setInstallTargets((old) =>
                      e.target.checked
                        ? [...old, tool.id]
                        : old.filter((id) => id !== tool.id),
                    )
                  }
                />
                <img
                  className="skill-tool-icon"
                  src={tool.icon}
                  alt={tool.name}
                />
              </label>
            ))}
          </div>
          {loadedRepo && (
            <small>
              {t("来源仓库")} · {loadedRepo}
            </small>
          )}
        </div>
      )}
      {((library?.skills.length || 0) > 0 || view === "discover") && (
        <input
          className="skills-search"
          aria-label={t("搜索技能")}
          placeholder={t("搜索名称、目录或描述")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {view === "installed" && library && !library.skills.length ? (
        <div className="skills-empty">
          <ActionIcon name="skills" />
          <h3>{t("还没有 Skill")}</h3>
          <p>{t("从发现里安装，或者导入本机已有的 Skill。")}</p>
          <div>
            <button
              disabled={busy}
              onClick={() => {
                setView("discover");
                void discover();
              }}
            >
              {t("去发现")}
            </button>
            <button disabled={busy} onClick={() => setImporting(true)}>
              {t("导入本机已有")} ({library.candidates.length})
            </button>
          </div>
        </div>
      ) : (
        <div className="skills-table-wrap">
          <table className="skills-table">
            <thead>
              <tr>
                <th>Skill</th>
                {view === "installed" ? (
                  targets.map((tool) => (
                    <th key={tool.id} title={tool.name}>
                      <img
                        className="skill-tool-icon"
                        src={tool.icon}
                        alt={tool.name}
                      />
                    </th>
                  ))
                ) : (
                  <th>{t("操作")}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((skill) => (
                <tr key={`${skill.repo || ""}:${skill.path || skill.id}`}>
                  <td>
                    <b>{skill.name}</b>
                    <small>{skill.id}</small>
                    <p>{skill.description || t("暂无描述")}</p>
                  </td>
                  {view === "installed" ? (
                    targets.map((tool) => (
                      <td key={tool.id}>
                        <input
                          type="checkbox"
                          role="switch"
                          aria-label={`${skill.name} · ${tool.name}`}
                          checked={skill.enabled?.includes(tool.id) || false}
                          disabled={busy}
                          onChange={(e) => {
                            const action = e.target.checked
                              ? "enable"
                              : "disable";
                            void run(async () => {
                              await request(action, {
                                id: skill.id,
                                tool: tool.id,
                              });
                              await refresh();
                            });
                          }}
                        />
                      </td>
                    ))
                  ) : (
                    <td>
                      <button
                        disabled={
                          busy ||
                          !!library?.skills.some((s) => s.id === skill.id)
                        }
                        onClick={() => void install(skill)}
                      >
                        {library?.skills.some((s) => s.id === skill.id)
                          ? t("已安装")
                          : t("安装")}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && !busy && (
            <p className="skills-no-results">{t("没有匹配的技能")}</p>
          )}
        </div>
      )}
      {library?.path && (
        <p className="skills-storage">
          {t("技能库位置")} · {library.path}
        </p>
      )}
      {importing && (
        <div
          className="modal-backdrop"
          onClick={() => !busy && setImporting(false)}
        >
          <section
            className="skills-import"
            role="dialog"
            aria-modal="true"
            aria-label={t("导入本机已有")}
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <h2>{t("导入本机已有")}</h2>
              <button disabled={busy} onClick={() => setImporting(false)}>
                {t("关闭")}
              </button>
            </header>
            <p>
              {t(
                "导入会复制到技能库，保留原文件。导入后可使用工具开关同步到当前环境。",
              )}
            </p>
            {error && (
              <p role="alert" className="skills-error">
                {error}
              </p>
            )}
            {!library?.candidates.length && <p>{t("没有可导入的技能")}</p>}
            <div className="skills-candidates">
              {library?.candidates.map((skill) => (
                <article key={`${skill.tool}:${skill.id}`}>
                  <div>
                    <b>{skill.name}</b>
                    <small>
                      {skill.tool} · {skill.id}
                    </small>
                    <p>{skill.description}</p>
                  </div>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await request("import", {
                          id: skill.id,
                          tool: skill.tool,
                        });
                        await refresh();
                        setNotice(t("已导入，请使用工具开关启用。"));
                      })
                    }
                  >
                    {t("导入")}
                  </button>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
