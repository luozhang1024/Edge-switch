import { t, setLanguage, useLanguage } from "./i18n";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import logo from "../image/EdgeAI.png";
import environmentIcon from "../image/配置环境.png";
import modelIcon from "../image/chatgpt-ui.png";
import proxyIcon from "../image/Flclash.png";
import toolsIcon from "../image/Tool.png";
import vscodeIcon from "../image/Vscode.png";
import deepseekIcon from "../image/deepseek-ui.png";
import addIcon from "../image/加.png";
import activateIcon from "../image/启用.png";
import testIcon from "../image/测试.png";
import verifyIcon from "../image/验证.png";
import connectIcon from "../image/connect.png";

import {
  Connection,
  emptyProfile,
  isRunning,
  newId,
  Official,
  Profile,
  Service,
  Snapshot,
  defaultPreferences,
  Task,
} from "./types";
import "./style.css";
import "./studio.css";
import { ModelServices } from "./ModelServices";
import { ProviderPage } from "./ProviderPage";
import { ServiceEditor } from "./ServiceEditor";
import { RecordPlayer } from "./RecordPlayer";
import { WindowControls } from "./WindowControls";
import { ScrollList } from "./ScrollList";
import { SettingsPage, SettingsTab } from "./SettingsPage";
import { UsagePage } from "./UsagePage";
import { ToolInstallation } from "./ToolInstallation";
import { PromptGroups } from "./PromptGroups";
import { SkillsPage } from "./SkillsPage";
import { SessionCenter } from "./SessionCenter";
import { ActionIcon } from "./ActionIcon";
import { tools } from "./catalog";
import { ToolId } from "./types";
import { ordered, moveItem } from "./listOrder";

const navigation = [
  {
    id: "connect",
    label: "工作环境",
    icon: environmentIcon,
    description: "为每一台设备，留一个专属工作空间。",
  },
  {
    id: "models",
    label: "模型服务",
    icon: modelIcon,
    description: "管理 API 与官方账号，随时切换所需模型。",
  },
  {
    id: "auth",
    label: "授权中心",
    icon: "",
    description: "管理工具账号授权。",
  },
  {
    id: "tools",
    label: "工具安装",
    icon: toolsIcon,
    description: "为当前环境安装与维护 AI 工具。",
  },
  {
    id: "prompts",
    label: "提示词组",
    icon: "",
    description: "管理工具的长期提示词。",
  },
  { id: "usage", label: "使用统计", icon: "", description: "查询模型用量。" },
  {
    id: "skills",
    label: "Skills 技能",
    icon: "",
    description: "发现、安装并管理工具技能。",
  },
  {
    id: "sessions",
    label: "会话中心",
    icon: "",
    description: "浏览工具会话与对话记录。",
  },
];
const actionIcons: Record<string, string> = {
  diagnose: verifyIcon,
  setup_ssh: environmentIcon,
  ssh_console: connectIcon,
  proxy_start: proxyIcon,
  disconnect: connectIcon,
  codex: modelIcon,
  harness: deepseekIcon,
  harness_stop: deepseekIcon,
  vscode: vscodeIcon,
  api_test: testIcon,
  official_test: testIcon,
  sync_api: activateIcon,
  versions: toolsIcon,
  install_runtime: toolsIcon,
  reuse_tools: toolsIcon,
  vscode_diagnostics: verifyIcon,
};
function AssetIcon({
  src,
  className = "",
}: {
  src: string;
  className?: string;
}) {
  return (
    <img
      className={`asset-icon ${src === deepseekIcon ? "wordmark" : ""} ${className}`}
      src={src}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}

export function App() {
  useLanguage();
  const [data, setData] = useState<Snapshot | null>(null);
  const [connections, setConnections] = useState<Record<string, Connection>>(
    {},
  );
  const [tab, setTab] = useState("overview");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [checkOnOpen, setCheckOnOpen] = useState(false);
  const [modelTool, setModelTool] = useState<ToolId>("codex");
  const [editing, setEditing] = useState<Profile | null>(null);
  const [draggedProfile, setDraggedProfile] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    id?: string;
    title: string;
    error?: string;
  } | null>(null);
  const [taskProgress, setTaskProgress] = useState<Record<string, string[]>>(
    {},
  );
  const [service, setService] = useState<Service | null>(null);
  const [official, setOfficial] = useState<Official | null>(null);
  const [authPath, setAuthPath] = useState("");
  const [message, setMessage] = useState("就绪");
  const [pending, setPending] = useState(false);
  const refreshInFlight = useRef(false);
  const preferences = { ...defaultPreferences, ...data?.preferences };
  useEffect(() => {
    setLanguage(preferences.language);
  }, [preferences.language]);
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        preferences.theme === "system"
          ? media?.matches
            ? "dark"
            : "light"
          : preferences.theme;
    };
    apply();
    media?.addEventListener("change", apply);
    return () => media?.removeEventListener("change", apply);
  }, [preferences.theme]);
  const load = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      const [snapshot, status] = await Promise.all([
        invoke<Snapshot>("snapshot"),
        invoke<Record<string, Connection>>("connection_status"),
      ]);
      setData(snapshot);
      setConnections(status);
    } catch (e) {
      setMessage(String(e));
    } finally {
      refreshInFlight.current = false;
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 2000);
    const listeners = ["task-progress", "task-finished", "app-error"].map(
      (event) =>
        listen(event, (e) => {
          if (event === "task-progress") {
            const update = e.payload as { id: string; message: string };
            setTaskProgress((previous) => ({
              ...previous,
              [update.id]: [
                ...(previous[update.id] || []),
                update.message,
              ].slice(-200),
            }));
          }
          if (event === "app-error") {
            setMessage(String(e.payload));
            setFeedback({ title: "操作未完成", error: String(e.payload) });
          }
          void load();
        }),
    );
    return () => {
      clearInterval(timer);
      listeners.forEach((p) => void p.then((unlisten) => unlisten()));
    };
  }, [load]);
  async function command(name: string, args: Record<string, unknown> = {}) {
    const inlineAuth =
      name === "start_task" &&
      ["login_browser", "harness_login"].includes(String(args.action));
    setPending(true);
    try {
      if (name === "start_task" && !inlineAuth)
        setFeedback({ title: "正在提交任务…" });
      const result = await invoke<Task | null>(name, args);
      if (name === "start_task" && !inlineAuth)
        setFeedback({ id: result?.id, title: result?.label || "任务进度" });
      setMessage("操作已提交");
      await load();
      return true;
    } catch (e) {
      setMessage(String(e));
      setFeedback({ title: "操作未完成", error: String(e) });
      return false;
    } finally {
      setPending(false);
    }
  }
  async function configureEnvironment(action: string, payload = {}) {
    if (!editing) return;
    const saved = data?.profiles.find((p) => p.id === editing.id);
    const unchanged =
      saved && JSON.stringify(saved) === JSON.stringify(editing);
    if (
      ["disconnect", "harness_stop"].includes(action) ||
      unchanged ||
      (await command("save_profile", { profile: editing }))
    ) {
      await run(action, payload, editing.id);
    }
  }
  if (!data)
    return (
      <div className="loading">
        <div className="loading-titlebar" data-tauri-drag-region>
          <span data-tauri-drag-region>Edge Switch</span>
          <WindowControls onError={setMessage} />
        </div>
        <p>{t("正在启动 Edge Switch…")}</p>
        <p role="status">{t(message)}</p>
        <button onClick={() => void load()}>{t("重试")}</button>
      </div>
    );
  const current =
    data.profiles.find((p) => p.id === data.selected_profile) ||
    data.profiles[0];
  const busy =
    pending ||
    data.tasks.some((t) => t.profile_id === current.id && isRunning(t));
  const editingBusy =
    pending ||
    data.tasks.some((t) => t.profile_id === editing?.id && isRunning(t));
  const editorButton = (label: string, action: string) => (
    <button
      disabled={editingBusy}
      onClick={() => void configureEnvironment(action)}
    >
      {actionIcons[action] && <AssetIcon src={actionIcons[action]} />}
      {t(label)}
    </button>
  );
  const feedbackTask = data.tasks.find((t) => t.id === feedback?.id);
  const currentConnections = Object.entries(connections).filter(([id]) =>
    id.startsWith(`${current.id}:`),
  );
  async function run(
    action: string,
    payload: Record<string, unknown> = {},
    profileId = current.id,
  ) {
    if (
      payload.infer &&
      !(await confirm(
        t("将发送真实推理请求，可能消耗 API 余额或账号额度。是否继续？"),
        { title: t("推理验证"), kind: "warning" },
      ))
    )
      return;
    if (
      action === "harness_stop" &&
      !(await confirm(
        t("停止 Harness 会中断当前服务和可能进行中的任务。是否继续？"),
        { title: t("停止 Harness"), kind: "warning" },
      ))
    )
      return;
    if (
      action === "disconnect" &&
      !(await confirm(
        t(
          "将断开网页和代理隧道，使用这些连接的工具会受影响；板卡后台服务保留。是否继续？",
        ),
        { title: t("断开连接"), kind: "warning" },
      ))
    )
      return;
    await command("start_task", { profileId, action, payload });
  }
  const button = (label: string, action: string, payload = {}) => (
    <button disabled={busy} onClick={() => void run(action, payload)}>
      {actionIcons[action] && <AssetIcon src={actionIcons[action]} />}
      {t(label)}
    </button>
  );
  async function choose(action: string, useCurrent = false) {
    try {
      const path = await open({
        multiple: false,
        title:
          action === "editor_pin"
            ? t("选择 VS Code 的 Code.exe")
            : t("选择 Server tar.gz 安装包"),
      });
      if (typeof path === "string") {
        if (useCurrent) await run(action, { path });
        else await configureEnvironment(action, { path });
      }
    } catch (e) {
      setMessage(String(e));
    }
  }
  const remove = async (
    name: string,
    args: Record<string, unknown>,
    warning: string,
  ) => {
    if (await confirm(t(warning), { title: t("确认删除"), kind: "warning" }))
      await command(name, args);
  };
  function selectProvider(preset: Service | "official") {
    if (preset === "official") {
      setService(null);
      setAuthPath("");
      setOfficial({ name: "OpenAI Official", ...data!.official[current.id] });
    } else {
      setOfficial(null);
      setService({ ...preset, id: service?.id || preset.id });
    }
  }
  return (
    <div className="app studio-app">
      <main aria-hidden={tab !== "overview"}>
        <header className="studio-header" data-tauri-drag-region>
          <div className="studio-brand" data-tauri-drag-region>
            <img src={logo} alt="" />
            <b data-tauri-drag-region>Edge Switch</b>
            <button
              className="brand-action"
              title={t("设置")}
              aria-label={t("设置")}
              onClick={() => {
                setSettingsTab("general");
                setCheckOnOpen(false);
                setTab("settings");
              }}
            >
              <ActionIcon name="settings" />
            </button>
            <button
              className="brand-action upgrade-action"
              title={t("检查更新")}
              aria-label={t("检查更新")}
              onClick={() => {
                setSettingsTab("about");
                setCheckOnOpen(true);
                setTab("settings");
              }}
            >
              <ActionIcon name="upgrade" />
            </button>
            <span data-tauri-drag-region>REMOTE AI STUDIO</span>
          </div>
          <label>
            <select
              aria-label={t("切换工作环境")}
              disabled={pending}
              value={current.id}
              onChange={(e) => {
                setEditing(null);
                setService(null);
                setOfficial(null);
                void command("select_profile", { id: e.target.value });
              }}
            >
              {ordered(data.profiles, data.list_order?.profiles).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {tab === "overview" && <WindowControls onError={setMessage} />}
        </header>
        <RecordPlayer
          current={current}
          version={data.version}
          busy={busy}
          connected={currentConnections.some(([, c]) => c.state === "已连接")}
          run={run}
          preferences={preferences}
          launchOrder={data.list_order?.quick_launch}
          onOrder={(ids) =>
            command("reorder_items", { kind: "quick_launch", ids })
          }
          onNavigate={() => setTab("models")}
          onEnvironment={() => setTab("connect")}
          onProject={() => void command("open_project_page")}
          onInfo={() => setTab("info")}
        />
      </main>
      {tab !== "overview" && (
        <Modal
          title={
            navigation.find((item) => item.id === tab)?.label ||
            (tab === "tasks"
              ? "日志"
              : tab === "settings"
                ? "设置"
                : "环境详情")
          }
          className="workspace-sheet workspace-hub"
          settings={() => {
            setSettingsTab("general");
            setCheckOnOpen(false);
            setTab("settings");
          }}
          close={() => setTab("overview")}
          windowError={setMessage}
        >
          <div className="management-layout">
            <aside className="management-sidebar">
              <button
                className="return-studio"
                onClick={() => setTab("overview")}
              >
                {t("← 返回唱片台")}
              </button>
              <div className="nav-caption">{t("WORKSPACE / 工作空间")}</div>
              <nav aria-label={t("主导航")}>
                {navigation.map(({ id, label, icon }) => (
                  <button
                    key={id}
                    className={tab === id ? "nav active" : "nav"}
                    aria-current={tab === id ? "page" : undefined}
                    onClick={() => setTab(id)}
                  >
                    {id === "auth" ||
                    id === "usage" ||
                    id === "sessions" ||
                    id === "prompts" ||
                    id === "skills" ? (
                      <ActionIcon
                        name={
                          id === "skills"
                            ? "skills"
                            : id === "prompts"
                              ? "prompts"
                              : id === "auth"
                                ? "authorization"
                                : id === "sessions"
                                  ? "logs"
                                  : "usage"
                        }
                      />
                    ) : (
                      <AssetIcon src={icon} />
                    )}
                    {t(label)}
                  </button>
                ))}
              </nav>
            </aside>
            <div
              className={`management-content ${tab === "sessions" ? "sc-content" : ""}`}
            >
              <div className="management-notice" role="status">
                {t(message)}
              </div>
              {tab === "tools" && (
                <>
                  <ToolInstallation
                    current={current}
                    busy={busy}
                    revision={data.tasks
                      .filter((task) => task.profile_id === current.id)
                      .map((task) => `${task.id}:${task.state}`)
                      .join(",")}
                    command={command}
                    run={run}
                  />
                  {current.kind !== "local" && (
                    <section>
                      {" "}
                      <div className="panel">
                        <h2>{t("启动与服务")}</h2>
                        <div className="buttons">
                          {button("打开 Codex", "codex")}
                          {button("打开 Harness 网页", "harness")}
                          {button("停止 Harness", "harness_stop")}
                          {button("打开 VS Code", "vscode")}
                          {button("打开 SSH 终端", "ssh_console")}
                        </div>
                        <p>
                          Harness：
                          {current.harness_background
                            ? t("退出工作台后保留板卡后台服务")
                            : t("退出工作台时停止服务")}
                          {t("。关闭主窗口仅缩至托盘。")}
                        </p>
                      </div>
                      <div className="panel">
                        <h2>{t("编辑器维护")}</h2>
                        <p>
                          {t(
                            "选择已安装的 Code.exe 创建固定副本。独立设置不会覆盖日常 VS Code 配置，导入服务端仍需通过官方 SHA-256 校验。",
                          )}
                        </p>
                        <div className="buttons">
                          <button
                            disabled={busy}
                            onClick={() => void choose("editor_pin", true)}
                          >
                            <AssetIcon src={vscodeIcon} />
                            {t("选择并固定 Code.exe")}
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => void choose("import_server", true)}
                          >
                            <AssetIcon src={vscodeIcon} />
                            {t("导入 Server 安装包")}
                          </button>
                          {button("读取连接诊断", "vscode_diagnostics")}
                        </div>
                      </div>
                    </section>
                  )}
                </>
              )}
              {tab === "skills" && (
                <SkillsPage
                  key={current.id}
                  profileId={current.id}
                  environment={current.name}
                />
              )}
              {tab === "prompts" && (
                <PromptGroups
                  key={current.id}
                  profileId={current.id}
                  environment={current.name}
                />
              )}
              {tab === "usage" && (
                <UsagePage
                  key={current.id}
                  profileId={current.id}
                  environment={current.name}
                />
              )}
              {tab === "sessions" && (
                <SessionCenter
                  key={current.id}
                  profileId={current.id}
                  environment={current.name}
                  onTerminal={() => void run("ssh_console")}
                />
              )}
              {(tab === "settings" || tab === "auth") && (
                <SettingsPage
                  data={data}
                  current={current}
                  busy={busy}
                  tab={tab === "auth" ? "auth" : settingsTab}
                  onTab={setSettingsTab}
                  command={command}
                  run={run}
                  onOfficial={(entry) => {
                    setAuthPath("");
                    setOfficial(entry);
                  }}
                  onEdit={() => setEditing({ ...current })}
                  onTasks={() => {
                    setSettingsTab("logs");
                    setTab("settings");
                  }}
                  onModels={(tool = "codex") => {
                    setModelTool(tool);
                    setTab("models");
                  }}
                  checkOnOpen={checkOnOpen}
                  logs={
                    <>
                      {" "}
                      <section className="panel task-history">
                        <p className="task-environment">
                          {current.name}
                          {t(" · 任务与运行结果")}
                        </p>
                        <ScrollList
                          className="task-list"
                          label={t("任务记录列表")}
                        >
                          {data.tasks
                            .filter((t) => t.profile_id === current.id)
                            .slice()
                            .reverse()
                            .map((task) => (
                              <details
                                className="taskdetail"
                                key={task.id}
                                open={isRunning(task)}
                              >
                                <summary>
                                  <span>
                                    {t(task.label)} · {t(task.state)}
                                  </span>
                                  <small>
                                    {new Date(
                                      task.started_at * 1000,
                                    ).toLocaleTimeString()}
                                  </small>
                                </summary>
                                <p>{t(task.message)}</p>
                                {isRunning(task) && (
                                  <button
                                    onClick={async () => {
                                      if (
                                        await confirm(
                                          t(
                                            "停止本地等待和 SSH 操作；远端操作可能仍在进行，请随后刷新设备核对。",
                                          ),
                                          {
                                            title: t("取消任务"),
                                            kind: "warning",
                                          },
                                        )
                                      )
                                        await command("cancel_task", {
                                          taskId: task.id,
                                        });
                                    }}
                                  >
                                    {t("取消任务")}
                                  </button>
                                )}
                                {task.result != null && (
                                  <pre>
                                    {JSON.stringify(task.result, null, 2)}
                                  </pre>
                                )}
                              </details>
                            ))}
                          {!data.tasks.some(
                            (t) => t.profile_id === current.id,
                          ) && (
                            <p className="empty">
                              {t(
                                "暂无任务。先检查设备，确认 SSH 连接和板卡状态。",
                              )}
                            </p>
                          )}
                        </ScrollList>
                      </section>
                    </>
                  }
                />
              )}
              {tab === "info" && (
                <>
                  <div className="grid">
                    <Card
                      title={t("工程目录")}
                      value={current.project}
                      detail={
                        current.kind === "local"
                          ? t("本机工具使用已有配置")
                          : current.identity || t("使用系统 SSH 身份")
                      }
                    />
                    <Card
                      title={t("模型服务")}
                      value={
                        current.codex_auth === "chatgpt"
                          ? "OpenAI Official"
                          : current.model || t("尚未配置")
                      }
                      detail={current.base_url}
                    />
                    <Card
                      title={t("连接")}
                      value={
                        current.kind === "local"
                          ? "Windows"
                          : currentConnections
                              .map(([, c]) => c.state)
                              .join(" / ") || t("尚未建立隧道")
                      }
                      detail={
                        current.kind === "local"
                          ? t("本机 Windows · 无需 SSH")
                          : t(
                              "这里只统计代理和网页隧道；SSH 终端独立连接，可检查设备验证 SSH 是否可用",
                            )
                      }
                    />
                  </div>
                  <p className="info-address">
                    {current.kind === "local"
                      ? t("本机 Windows · 无需 SSH")
                      : `${current.user}@${current.host}:${current.port}`}
                  </p>
                </>
              )}
              {tab === "connect" && (
                <section className="panel">
                  <div className="panelhead">
                    <h2>{t("工作环境")}</h2>
                    <button onClick={() => setEditing(emptyProfile())}>
                      <AssetIcon src={addIcon} />
                      {t("添加环境")}
                    </button>
                  </div>
                  <ScrollList
                    className="profile-list"
                    label={t("工作环境列表")}
                  >
                    {ordered(data.profiles, data.list_order?.profiles).map(
                      (p) => (
                        <div
                          className={
                            p.id === current.id ? "profile selected" : "profile"
                          }
                          key={p.id}
                          draggable={!pending}
                          onDragStart={(e) => {
                            setDraggedProfile(p.id);
                            e.dataTransfer.setData("text/plain", p.id);
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onDragOver={(e) => {
                            if (draggedProfile) e.preventDefault();
                          }}
                          onDragEnd={() => setDraggedProfile(null)}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (draggedProfile)
                              void command("reorder_items", {
                                kind: "profiles",
                                ids: moveItem(
                                  ordered(
                                    data.profiles,
                                    data.list_order?.profiles,
                                  ).map((p) => p.id),
                                  draggedProfile,
                                  p.id,
                                ),
                              });
                            setDraggedProfile(null);
                          }}
                        >
                          <div>
                            <b>{p.name}</b>
                            <p>
                              {p.kind === "local"
                                ? t("本机 Windows · 无需 SSH")
                                : `${p.user}@${p.host}:${p.port}`}
                            </p>
                            <small>{p.project}</small>
                          </div>
                          <div className="profile-actions">
                            <button
                              title={
                                p.id === current.id ? t("使用中") : t("使用")
                              }
                              aria-label={
                                p.id === current.id ? t("使用中") : t("使用")
                              }
                              disabled={pending || p.id === current.id}
                              onClick={() =>
                                void command("select_profile", { id: p.id })
                              }
                            >
                              {p.id === current.id ? (
                                <span className="active-badge">
                                  {t("使用中")}
                                </span>
                              ) : (
                                <ActionIcon name="activate" />
                              )}
                            </button>
                            <button
                              disabled={data.tasks.some(
                                (t) => t.profile_id === p.id && isRunning(t),
                              )}
                              title={t("编辑")}
                              aria-label={t("编辑")}
                              onClick={() => setEditing({ ...p })}
                            >
                              <ActionIcon name="edit" />
                            </button>
                            <button
                              title={t("删除")}
                              aria-label={t("删除")}
                              disabled={
                                pending ||
                                data.profiles.length <= 1 ||
                                p.kind === "local"
                              }
                              onClick={() =>
                                void remove(
                                  "delete_profile",
                                  { id: p.id },
                                  `删除「${p.name}」及本地保存的服务和凭据？板卡文件保留。`,
                                )
                              }
                            >
                              <ActionIcon name="delete" />
                            </button>
                          </div>
                        </div>
                      ),
                    )}
                  </ScrollList>
                  <div className="buttons">
                    {current.kind !== "local" &&
                      button("配置 SSH 登录", "setup_ssh")}
                    {button(
                      current.kind === "local"
                        ? "打开本机终端"
                        : "打开 SSH 终端",
                      "ssh_console",
                    )}
                    {button("检查设备", "diagnose")}
                  </div>
                </section>
              )}
              {tab === "models" && (
                <>
                  {current.kind === "local" && (
                    <p role="note">
                      {t(
                        "本机工具沿用 Windows 配置；可在工具安装页安装，在授权中心登录，在此管理已识别的 Codex 供应商。",
                      )}
                    </p>
                  )}
                  <ModelServices
                    data={data}
                    current={current}
                    tool={modelTool}
                    busy={busy}
                    onTool={setModelTool}
                    command={command}
                    run={run}
                    remove={remove}
                    onEdit={(entry) => {
                      setService(entry);
                    }}
                    onOfficial={(entry) => {
                      setAuthPath("");
                      setOfficial(entry);
                    }}
                    onAuthenticate={() => {
                      setCheckOnOpen(false);
                      setTab("auth");
                    }}
                  />
                </>
              )}
            </div>
          </div>
        </Modal>
      )}
      {editing?.kind === "local" && (
        <Modal title={t("编辑工作环境")} close={() => setEditing(null)}>
          <p>
            {t(
              "本机工具沿用 Windows 配置；可在工具安装页安装，在授权中心登录，在此管理已识别的 Codex 供应商。",
            )}
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await command("save_profile", { profile: editing }))
                setEditing(null);
            }}
          >
            <div className="form">
              {(["name", "project"] as const).map((field) => (
                <label key={field}>
                  {t(field === "name" ? "名称" : "工程绝对路径")}
                  <input
                    required
                    value={editing[field]}
                    onChange={(e) =>
                      setEditing({ ...editing, [field]: e.target.value })
                    }
                  />
                </label>
              ))}
            </div>
            <div className="buttons">
              <button type="submit" disabled={editingBusy}>
                {t("保存")}
              </button>
            </div>
          </form>
          <div className="buttons">
            {editorButton("检查设备", "diagnose")}
            {editorButton("打开本机终端", "ssh_console")}
          </div>
        </Modal>
      )}
      {editing && editing.kind !== "local" && (
        <Modal title={t("编辑工作环境")} close={() => setEditing(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await command("save_profile", { profile: editing }))
                setEditing(null);
            }}
          >
            <div className="form">
              {(["name", "host", "user", "project"] as const).map(
                (field, i) => (
                  <label key={field}>
                    {t(["名称", "主机地址", "Linux 用户", "工程绝对路径"][i])}
                    <input
                      required
                      value={editing[field]}
                      onChange={(e) =>
                        setEditing({ ...editing, [field]: e.target.value })
                      }
                    />
                  </label>
                ),
              )}
              <label>
                {t("SSH 端口")}
                <input
                  required
                  type="number"
                  min="1"
                  max="65535"
                  value={editing.port}
                  onChange={(e) =>
                    setEditing({ ...editing, port: Number(e.target.value) })
                  }
                />
              </label>
              <label className="wide">
                {t("SSH 私钥（空值使用系统身份）")}
                <input
                  value={editing.identity}
                  onChange={(e) =>
                    setEditing({ ...editing, identity: e.target.value })
                  }
                />
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const path = await open({
                        multiple: false,
                        title: "选择 SSH 私钥",
                      });
                      if (typeof path === "string")
                        setEditing({ ...editing, identity: path });
                    } catch (e) {
                      setMessage(String(e));
                    }
                  }}
                >
                  {t("选择私钥")}
                </button>
              </label>
              <label>
                {t("退出策略")}
                <select
                  value={String(editing.harness_background)}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      harness_background: e.target.value === "true",
                    })
                  }
                >
                  <option value="true">{t("保留 Harness 后台服务")}</option>
                  <option value="false">{t("退出时停止 Harness")}</option>
                </select>
              </label>
            </div>
            <div className="actions">
              <button type="button" onClick={() => setEditing(null)}>
                {t("取消")}
              </button>
              <button disabled={editingBusy} className="primary">
                {t("保存")}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {service && (
        <ProviderPage
          tool={service.tool || "codex"}
          service={service}
          icon={service.icon}
          onIcon={(icon) => setService({ ...service, icon })}
          editing={(data.services[current.id] || []).some(
            (s) => s.id === service.id,
          )}
          onSelect={selectProvider}
          close={() => {
            setService(null);
          }}
        >
          <ServiceEditor
            service={service}
            original={(data.services[current.id] || []).find(
              (s) => s.id === service.id,
            )}
            profileId={current.id}
            saved={data.saved_keys.includes(service.id)}
            busy={busy}
            onChange={setService}
            close={() => setService(null)}
            onSave={(key, remember) =>
              command("save_service", {
                profileId: current.id,
                entry: service,
                key,
                remember,
              })
            }
          />
        </ProviderPage>
      )}
      {official && (
        <ProviderPage
          tool="codex"
          official
          icon={official.icon}
          onIcon={(icon) => setOfficial({ ...official, icon })}
          onSelect={selectProvider}
          close={() => setOfficial(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await command("save_official", {
                  profileId: current.id,
                  name: official.name || "",
                  note: official.note || "",
                  path: authPath || null,
                  icon: official.icon || "",
                })
              )
                setOfficial(null);
            }}
          >
            <div className="form">
              <label>
                {t("账号名称")}
                <input
                  required
                  value={official.name || ""}
                  onChange={(e) =>
                    setOfficial({ ...official, name: e.target.value })
                  }
                />
              </label>
              <label>
                {t("备注")}
                <input
                  value={official.note || ""}
                  onChange={(e) =>
                    setOfficial({ ...official, note: e.target.value })
                  }
                />
              </label>
            </div>
            <section className="config-previews">
              <label>
                config.toml (TOML)
                <textarea
                  readOnly
                  aria-label="config.toml (TOML)"
                  value={
                    'forced_login_method = "chatgpt"\ncli_auth_credentials_store = "file"\n'
                  }
                  rows={3}
                />
              </label>
              <b>auth.json (JSON)</b>
              <p className="provider-help">
                {t(
                  "导入官方 OAuth 凭据，或在侧边栏的授权中心完成设备码登录。凭据在本机加密保存，同步时写入远程设备。",
                )}
              </p>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const path = await open({
                      multiple: false,
                      filters: [{ name: "JSON", extensions: ["json"] }],
                    });
                    if (typeof path === "string") setAuthPath(path);
                  } catch (e) {
                    setMessage(String(e));
                  }
                }}
              >
                {t("选择 auth.json")}
              </button>
              <p>{authPath || t("未选择文件，保留已有凭据")}</p>
            </section>
            <div className="actions">
              <button type="button" onClick={() => setOfficial(null)}>
                {t("取消")}
              </button>
              <button disabled={pending} className="primary">
                {t("保存账号")}
              </button>
            </div>
          </form>
        </ProviderPage>
      )}
      {feedback && (
        <Modal
          title={feedbackTask?.label || feedback.title}
          className="task-feedback"
          close={() => setFeedback(null)}
        >
          <p role="status">
            {feedback.error ||
              (feedbackTask
                ? `${feedbackTask.state} · ${feedbackTask.message}`
                : "任务已提交，正在等待板卡响应…")}
          </p>
          {feedback.id && taskProgress[feedback.id]?.length > 0 && (
            <ol className="task-progress-log">
              {taskProgress[feedback.id].map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ol>
          )}
          {feedbackTask?.result != null && (
            <pre>{JSON.stringify(feedbackTask.result, null, 2)}</pre>
          )}
          <div className="actions">
            {feedbackTask && isRunning(feedbackTask) && (
              <button
                disabled={pending}
                onClick={() =>
                  void command("cancel_task", { taskId: feedbackTask.id })
                }
              >
                {t("取消任务")}
              </button>
            )}
            <button onClick={() => setFeedback(null)}>{t("关闭")}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function Modal({
  title,
  close,
  children,
  className = "",
  settings,
  windowError,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
  className?: string;
  settings?: () => void;
  windowError?: (message: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current!;
    const trigger = document.activeElement as HTMLElement | null;
    if (node.showModal) node.showModal();
    else node.setAttribute("open", "");
    return () => {
      if (node.close) node.close();
      queueMicrotask(() => {
        if (trigger?.isConnected) trigger.focus();
      });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog studio-dialog ${className}`}
      aria-label={t(title)}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            close();
        }
      }}
    >
      <div
        className="panelhead"
        data-tauri-drag-region={windowError ? true : undefined}
      >
        <h2>{t(title)}</h2>
        {settings && (
          <button
            className="brand-action"
            title={t("设置")}
            aria-label={t("设置")}
            onClick={settings}
          >
            <ActionIcon name="settings" />
          </button>
        )}
        {!windowError && (
          <button aria-label={t("关闭")} onClick={close}>
            ×
          </button>
        )}
        {windowError && <WindowControls onError={windowError} />}
      </div>
      {children}
    </dialog>
  );
}
function Card({
  title,
  value,
  detail,
}: {
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="card">
      <small className="card-label">
        <AssetIcon
          src={
            title === t("工程目录")
              ? environmentIcon
              : title === t("模型服务")
                ? modelIcon
                : connectIcon
          }
        />
        {t(title)}
      </small>
      <strong>{value}</strong>
      <span title={t(detail)}>{t(detail)}</span>
    </div>
  );
}
