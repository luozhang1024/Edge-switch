import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { tools } from "./catalog";
import { Profile, ToolId } from "./types";
import { t } from "./i18n";
import { ActionIcon } from "./ActionIcon";
import "./tool-installation.css";
import { extraCodingTools } from "./installableTools";

type Installed = {
  id: string;
  installed: boolean;
  version: string;
  path: string;
  managed: boolean;
  can_remove: boolean;
  can_upgrade: boolean;
};
const catalog = [
  ...tools.map((tool) => ({ ...tool, category: "ai", description: tool.hint })),
  {
    id: "node",
    name: "Node.js LTS",
    icon: "",
    category: "runtime",
    description: "AI 工具的 JavaScript 运行环境。",
  },
  {
    id: "git",
    name: "Git",
    icon: "",
    category: "development",
    description: "版本控制与代码仓库工具。",
  },
  {
    id: "vscode",
    name: "Visual Studio Code",
    icon: "",
    category: "development",
    description: "代码编辑器与远程开发工具。",
  },
];

export function ToolInstallation({
  current,
  busy,
  revision,
  command,
  run,
}: {
  current: Profile;
  busy: boolean;
  revision: string;
  command: (name: string, args: Record<string, unknown>) => Promise<boolean>;
  run: (action: string, payload?: Record<string, unknown>) => Promise<void>;
}) {
  const [inventory, setInventory] = useState<Installed[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const sequence = useRef(0);
  async function refresh() {
    const id = ++sequence.current;
    setLoading(true);
    setError("");
    try {
      const value = await invoke<{ tools: Installed[] }>("tool_inventory", {
        profileId: current.id,
      });
      if (id === sequence.current) setInventory(value.tools);
    } catch (e) {
      if (id === sequence.current) setError(String(e));
    } finally {
      if (id === sequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    setInventory([]);
  }, [current.id]);
  useEffect(() => {
    if (!busy) void refresh();
    return () => {
      ++sequence.current;
    };
  }, [current.id, revision, busy]);
  const rows = catalog.filter(
    (item) =>
      (category === "all" || item.category === category) &&
      `${item.name} ${item.description}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const ready = !busy && !loading && inventory.length > 0;
  async function operate(id: string, operation: string, name: string) {
    if (
      operation === "uninstall" &&
      !(await confirm(
        t(
          current.kind === "local"
            ? "卸载该工具？本机安装由 npm 或 winget 管理，操作会影响本机其他项目。工具配置和会话记录保留。"
            : "卸载当前环境的工具入口？配置、会话和可复用版本文件保留，其他环境不受影响。",
        ),
        { title: `${t("卸载")} ${name}`, kind: "warning" },
      ))
    )
      return;
    await run("manage_tool", { tool: id, operation });
  }
  return (
    <section className="ti-page" aria-label={t("工具安装")} aria-busy={loading}>
      <header>
        <div>
          <h2>{t("工具安装")}</h2>
          <p>
            {current.name} ·{" "}
            {current.kind === "local"
              ? "Windows"
              : `${current.user}@${current.host}:${current.port}`}
          </p>
        </div>
        <button disabled={busy || loading} onClick={() => void refresh()}>
          <ActionIcon name="upgrade" />
          {t(loading ? "正在检测…" : "刷新工具")}
        </button>
      </header>
      <div className="ti-toolbar">
        <label>
          {t("工具分类")}
          <select
            aria-label={t("工具分类")}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="all">{t("全部工具")}</option>
            <option value="ai">{t("AI 工具")}</option>
            <option value="runtime">{t("运行环境")}</option>
            <option value="development">{t("开发工具")}</option>
          </select>
        </label>
        <input
          aria-label={t("搜索工具")}
          placeholder={t("搜索工具名称")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {error && (
        <p role="alert">
          {error}
          <button onClick={() => void refresh()}>{t("重试")}</button>
        </p>
      )}
      <p className="ti-note">
        {t(
          current.kind === "local"
            ? "Kimi Code 通过 uv 安装，其他 AI 工具通过 npm 安装；Node.js、Git 和 VS Code 通过 winget 管理。已有工具按检测到的安装方式管理。"
            : "AI 工具安装到当前环境专属目录，首次自动准备 Node.js。系统工具仅检测；卸载受管入口时保留配置与会话。",
        )}
      </p>
      {[true, false].map((installed) => {
        const group = rows.filter(
          (item) =>
            !!inventory.find((v) => v.id === item.id)?.installed === installed,
        );
        return (
          <section className="ti-group" key={String(installed)}>
            <h3>
              {t(installed ? "已安装" : "未安装")} <small>{group.length}</small>
            </h3>
            {group.map((item) => {
              const info = inventory.find((v) => v.id === item.id);
              const ai = item.category === "ai";
              const supported =
                current.kind === "local" || ai || item.id === "node";
              return (
                <article className="ti-row" key={item.id}>
                  <div className="ti-icon">
                    {item.icon ? (
                      <img src={item.icon} alt="" />
                    ) : (
                      <ActionIcon name="terminal" />
                    )}
                  </div>
                  <div className="ti-info">
                    <b>
                      {item.name}{" "}
                      {installed && (
                        <span className="ti-version">
                          {info?.version || t("版本未知")}
                        </span>
                      )}
                    </b>
                    <p>{t(item.description)}</p>
                    {installed && (
                      <small title={info?.path}>
                        {info?.path} ·{" "}
                        {t(info?.managed ? "受管安装" : "系统或外部安装")}
                      </small>
                    )}
                    {ai && tools.some((tool) => tool.id === item.id) && (
                      <label className="ti-visibility">
                        <input
                          type="checkbox"
                          role="switch"
                          aria-label={`${t("在模型服务中显示")} ${item.name}`}
                          checked={
                            current.tool_visibility?.[item.id as ToolId] !==
                            false
                          }
                          disabled={busy}
                          onChange={(e) =>
                            void command("set_tool_visibility", {
                              profileId: current.id,
                              tool: item.id,
                              visible: e.target.checked,
                            })
                          }
                        />
                        {t("在模型服务中显示")}
                      </label>
                    )}
                  </div>
                  <div className="ti-actions">
                    {ai &&
                      extraCodingTools.some((tool) => tool.id === item.id) &&
                      installed && (
                        <button
                          disabled={!ready}
                          onClick={() =>
                            void run("launch_coding_tool", { tool: item.id })
                          }
                        >
                          {t("启动")}
                        </button>
                      )}
                    {installed ? (
                      <>
                        <button
                          disabled={!ready || !info?.can_upgrade}
                          title={
                            !info?.can_upgrade
                              ? t("请使用原安装方式升级")
                              : undefined
                          }
                          onClick={() =>
                            void operate(item.id, "upgrade", item.name)
                          }
                        >
                          {t("升级")}
                        </button>
                        <button
                          className="danger-text"
                          disabled={!ready || !info?.can_remove}
                          title={
                            !info?.can_remove
                              ? t("系统或共享工具需使用原安装方式卸载")
                              : undefined
                          }
                          onClick={() =>
                            void operate(item.id, "uninstall", item.name)
                          }
                        >
                          {t("卸载")}
                        </button>
                      </>
                    ) : (
                      <button
                        className="primary"
                        disabled={!ready || !supported}
                        onClick={() =>
                          void operate(item.id, "install", item.name)
                        }
                      >
                        {t(supported ? "一键安装" : "请在远程终端安装")}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
            {!group.length && (
              <p className="ti-empty">
                {t(loading ? "正在检测工具…" : "暂无匹配工具")}
              </p>
            )}
          </section>
        );
      })}
      <div className="buttons">
        <button disabled={busy} onClick={() => void run("ssh_console")}>
          {t(current.kind === "local" ? "打开本机终端" : "打开 SSH 终端")}
        </button>
        <button disabled={busy} onClick={() => void run("diagnose")}>
          {t("检查设备")}
        </button>
      </div>
    </section>
  );
}
