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
  const [editorTab, setEditorTab] = useState("connection");
  useEffect(() => setEditorTab("connection"), [editing?.id]);
  const [service, setService] = useState<Service | null>(null);
  const [official, setOfficial] = useState<Official | null>(null);
  const [authPath, setAuthPath] = useState("");
  const [message, setMessage] = useState("就绪");
  const [pending, setPending] = useState(false);
  const refreshInFlight = useRef(false);
  const preferences = data?.preferences || defaultPreferences;
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
    setPending(true);
    try {
      if (name === "start_task") setFeedback({ title: "正在提交任务…" });
      const result = await invoke<Task | null>(name, args);
      if (name === "start_task")
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
        <p>正在启动 Edge Switch…</p>
        <p role="status">{message}</p>
        <button onClick={() => void load()}>重试</button>
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
      {label}
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
        "将发送真实推理请求，可能消耗 API 余额或账号额度。是否继续？",
        { title: "推理验证", kind: "warning" },
      ))
    )
      return;
    if (
      action === "harness_stop" &&
      !(await confirm(
        "停止 Harness 会中断当前服务和可能进行中的任务。是否继续？",
        { title: "停止 Harness", kind: "warning" },
      ))
    )
      return;
    if (
      action === "disconnect" &&
      !(await confirm(
        "将断开网页和代理隧道，使用这些连接的工具会受影响；板卡后台服务保留。是否继续？",
        { title: "断开连接", kind: "warning" },
      ))
    )
      return;
    await command("start_task", { profileId, action, payload });
  }
  const button = (label: string, action: string, payload = {}) => (
    <button disabled={busy} onClick={() => void run(action, payload)}>
      {actionIcons[action] && <AssetIcon src={actionIcons[action]} />}
      {label}
    </button>
  );
  async function choose(action: string) {
    try {
      const path = await open({
        multiple: false,
        title:
          action === "editor_pin"
            ? "选择 VS Code 的 Code.exe"
            : "选择 Server tar.gz 安装包",
      });
      if (typeof path === "string")
        await configureEnvironment(action, { path });
    } catch (e) {
      setMessage(String(e));
    }
  }
  const remove = async (
    name: string,
    args: Record<string, unknown>,
    warning: string,
  ) => {
    if (await confirm(warning, { title: "确认删除", kind: "warning" }))
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
              title="设置"
              aria-label="设置"
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
              title="检查更新"
              aria-label="检查更新"
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
              aria-label="切换工作环境"
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
                ← 返回唱片台
              </button>
              <div className="nav-caption">WORKSPACE / 工作空间</div>
              <nav aria-label="主导航">
                {navigation.map(({ id, label, icon }) => (
                  <button
                    key={id}
                    className={tab === id ? "nav active" : "nav"}
                    aria-current={tab === id ? "page" : undefined}
                    onClick={() => setTab(id)}
                  >
                    <AssetIcon src={icon} />
                    {label}
                  </button>
                ))}
              </nav>
            </aside>
            <div className="management-content">
              <div className="management-notice" role="status">
                {message}
              </div>
              {tab === "settings" && (
                <SettingsPage
                  data={data}
                  current={current}
                  busy={busy}
                  tab={settingsTab}
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
                  onModels={() => {
                    setModelTool("codex");
                    setTab("models");
                  }}
                  checkOnOpen={checkOnOpen}
                  logs={
                    <>
                      {" "}
                      <section className="panel task-history">
                        <p className="task-environment">
                          {current.name} · 任务与运行结果
                        </p>
                        <ScrollList className="task-list" label="任务记录列表">
                          {data.tasks
                            .filter((t) => t.profile_id === current.id)
                            .slice()
                            .reverse()
                            .map((t) => (
                              <details
                                className="taskdetail"
                                key={t.id}
                                open={isRunning(t)}
                              >
                                <summary>
                                  <span>
                                    {t.label} · {t.state}
                                  </span>
                                  <small>
                                    {new Date(
                                      t.started_at * 1000,
                                    ).toLocaleTimeString()}
                                  </small>
                                </summary>
                                <p>{t.message}</p>
                                {isRunning(t) && (
                                  <button
                                    onClick={async () => {
                                      if (
                                        await confirm(
                                          "停止本地等待和 SSH 操作；远端操作可能仍在进行，请随后刷新设备核对。",
                                          {
                                            title: "取消任务",
                                            kind: "warning",
                                          },
                                        )
                                      )
                                        await command("cancel_task", {
                                          taskId: t.id,
                                        });
                                    }}
                                  >
                                    取消任务
                                  </button>
                                )}
                                {t.result != null && (
                                  <pre>{JSON.stringify(t.result, null, 2)}</pre>
                                )}
                              </details>
                            ))}
                          {!data.tasks.some(
                            (t) => t.profile_id === current.id,
                          ) && (
                            <p className="empty">
                              暂无任务。先检查设备，确认 SSH 连接和板卡状态。
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
                      title="工程目录"
                      value={current.project}
                      detail={current.identity || "使用系统 SSH 身份"}
                    />
                    <Card
                      title="模型服务"
                      value={
                        current.codex_auth === "chatgpt"
                          ? "OpenAI Official"
                          : current.model || "尚未配置"
                      }
                      detail={current.base_url}
                    />
                    <Card
                      title="连接"
                      value={
                        currentConnections
                          .map(([, c]) => c.state)
                          .join(" / ") || "尚未建立隧道"
                      }
                      detail="这里只统计代理和网页隧道；SSH 终端独立连接，可检查设备验证 SSH 是否可用"
                    />
                  </div>
                  <p className="info-address">
                    {current.user}@{current.host}:{current.port}
                  </p>
                </>
              )}
              {tab === "connect" && (
                <section className="panel">
                  <div className="panelhead">
                    <h2>工作环境</h2>
                    <button onClick={() => setEditing(emptyProfile())}>
                      <AssetIcon src={addIcon} />
                      添加环境
                    </button>
                  </div>
                  <ScrollList className="profile-list" label="工作环境列表">
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
                              {p.user}@{p.host}:{p.port}
                            </p>
                            <small>{p.project}</small>
                          </div>
                          <div className="profile-actions">
                            <button
                              title={p.id === current.id ? "使用中" : "使用"}
                              aria-label={
                                p.id === current.id ? "使用中" : "使用"
                              }
                              disabled={pending || p.id === current.id}
                              onClick={() =>
                                void command("select_profile", { id: p.id })
                              }
                            >
                              {p.id === current.id ? (
                                <span className="active-badge">使用中</span>
                              ) : (
                                <ActionIcon name="activate" />
                              )}
                            </button>
                            <button
                              disabled={data.tasks.some(
                                (t) => t.profile_id === p.id && isRunning(t),
                              )}
                              title="编辑"
                              aria-label="编辑"
                              onClick={() => setEditing({ ...p })}
                            >
                              <ActionIcon name="edit" />
                            </button>
                            <button
                              title="删除"
                              aria-label="删除"
                              disabled={pending || data.profiles.length <= 1}
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
                    {button("配置 SSH 登录", "setup_ssh")}
                    {button("打开 SSH 终端", "ssh_console")}
                    {button("检查设备", "diagnose")}
                  </div>
                </section>
              )}
              {tab === "models" && (
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
                    setSettingsTab("auth");
                    setCheckOnOpen(false);
                    setTab("settings");
                  }}
                />
              )}
            </div>
          </div>
        </Modal>
      )}
      {editing && (
        <Modal title="编辑工作环境" close={() => setEditing(null)}>
          <div
            className="environment-tabs"
            role="tablist"
            aria-label="编辑环境配置"
          >
            {[
              ["connection", "SSH 与网络"],
              ["network", "代理连接"],
              ["tools", "AI 工具"],
            ].map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={editorTab === id}
                onClick={() => setEditorTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div hidden={editorTab !== "tools"}>
            <p>操作时先保存此环境的 SSH 与网络配置，随后在对应板卡执行。</p>
            <section>
              <div className="panel">
                <h2>工具部署</h2>
                <p>
                  安装到当前环境专属目录，不替换系统
                  Node.js。先查询版本，再选择安装。
                </p>
                <div className="buttons">
                  {editorButton("检查设备", "diagnose")}
                  {editorButton("查询可用版本", "versions")}
                  {editorButton("安装独立 Node.js", "install_runtime")}
                  {editorButton("复用已有工具", "reuse_tools")}
                </div>
                <ToolInstaller
                  data={data}
                  profileId={editing.id}
                  disabled={editingBusy}
                  install={(tool, version) =>
                    void configureEnvironment("install_tool", { tool, version })
                  }
                />
              </div>
              <div className="panel">
                <h2>启动与服务</h2>
                <div className="buttons">
                  {editorButton("打开 Codex", "codex")}
                  {editorButton("打开 Harness 网页", "harness")}
                  {editorButton("停止 Harness", "harness_stop")}
                  {editorButton("打开 VS Code", "vscode")}
                  {editorButton("打开 SSH 终端", "ssh_console")}
                </div>
                <p>
                  Harness：
                  {editing.harness_background
                    ? "退出工作台后保留板卡后台服务"
                    : "退出工作台时停止服务"}
                  。关闭主窗口仅缩至托盘。
                </p>
              </div>
              <div className="panel">
                <h2>编辑器维护</h2>
                <p>
                  选择已安装的 Code.exe 创建固定副本。独立设置不会覆盖日常 VS
                  Code 配置，导入服务端仍需通过官方 SHA-256 校验。
                </p>
                <div className="buttons">
                  <button
                    disabled={editingBusy}
                    onClick={() => void choose("editor_pin")}
                  >
                    <AssetIcon src={vscodeIcon} />
                    选择并固定 Code.exe
                  </button>
                  <button
                    disabled={editingBusy}
                    onClick={() => void choose("import_server")}
                  >
                    <AssetIcon src={vscodeIcon} />
                    导入 Server 安装包
                  </button>
                  {editorButton("读取连接诊断", "vscode_diagnostics")}
                </div>
              </div>
            </section>
          </div>
          <div hidden={editorTab !== "network"}>
            {" "}
            <section className="panel">
              <h2>代理网络</h2>
              <p>
                电脑下载：
                {editing.proxy ? `127.0.0.1:${editing.proxy_port}` : "直连"}
                ；Codex：
                {(editing.codex_proxy ?? editing.proxy)
                  ? "电脑代理"
                  : "板卡直连"}
                ；Harness：
                {(editing.harness_proxy ?? editing.proxy)
                  ? "电脑代理"
                  : "板卡直连"}
                。
              </p>
              <p>
                电脑代理通过 SSH
                反向转发到板卡，中断后自动尝试重连。修改设置前先断开本地连接。
              </p>
              <div className="buttons">
                {editorButton("连接代理", "proxy_start")}
                {editorButton("断开本地连接", "disconnect")}
              </div>
              {Object.entries(connections)
                .filter(([id]) => id.startsWith(`${editing.id}:`))
                .map(([id, c]) => (
                  <div className="profile" key={id}>
                    <b>{c.kind === "proxy" ? "代理隧道" : "Harness 网页"}</b>
                    <span>
                      {c.state} · 电脑 {c.local_port} ↔ 板卡 {c.remote_port}
                    </span>
                  </div>
                ))}
            </section>
          </div>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await command("save_profile", { profile: editing }))
                setEditing(null);
            }}
          >
            <div className="form" hidden={editorTab !== "connection"}>
              {(["name", "host", "user", "project"] as const).map(
                (field, i) => (
                  <label key={field}>
                    {["名称", "主机地址", "Linux 用户", "工程绝对路径"][i]}
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
              {(["port", "proxy_port"] as const).map((field, i) => (
                <label key={field}>
                  {["SSH 端口", "电脑代理端口"][i]}
                  <input
                    required
                    type="number"
                    min="1"
                    max="65535"
                    value={editing[field]}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        [field]: Number(e.target.value),
                      })
                    }
                  />
                </label>
              ))}
              <label className="wide">
                SSH 私钥（空值使用系统身份）
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
                  选择私钥
                </button>
              </label>
              <label>
                电脑下载线路
                <select
                  value={String(editing.proxy)}
                  onChange={(e) =>
                    setEditing({ ...editing, proxy: e.target.value === "true" })
                  }
                >
                  <option value="false">直连</option>
                  <option value="true">电脑代理</option>
                </select>
              </label>
              {(["codex_proxy", "harness_proxy"] as const).map((field, i) => (
                <label key={field}>
                  {["Codex 线路", "Harness 线路"][i]}
                  <select
                    value={
                      editing[field] == null
                        ? "inherit"
                        : String(editing[field])
                    }
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        [field]:
                          e.target.value === "inherit"
                            ? null
                            : e.target.value === "true",
                      })
                    }
                  >
                    <option value="inherit">跟随电脑下载线路</option>
                    <option value="false">板卡直连</option>
                    <option value="true">电脑代理</option>
                  </select>
                </label>
              ))}
              <label>
                退出策略
                <select
                  value={String(editing.harness_background)}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      harness_background: e.target.value === "true",
                    })
                  }
                >
                  <option value="true">保留 Harness 后台服务</option>
                  <option value="false">退出时停止 Harness</option>
                </select>
              </label>
            </div>
            <div className="actions">
              <button type="button" onClick={() => setEditing(null)}>
                取消
              </button>
              <button disabled={editingBusy} className="primary">
                保存
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
                账号名称
                <input
                  required
                  value={official.name || ""}
                  onChange={(e) =>
                    setOfficial({ ...official, name: e.target.value })
                  }
                />
              </label>
              <label>
                备注
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
                导入官方 OAuth 凭据，或在“设置 →
                认证”中完成设备码登录。凭据在本机加密保存，同步时写入远程设备。
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
                选择 auth.json
              </button>
              <p>{authPath || "未选择文件，保留已有凭据"}</p>
            </section>
            <div className="actions">
              <button type="button" onClick={() => setOfficial(null)}>
                取消
              </button>
              <button disabled={pending} className="primary">
                保存账号
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
                取消任务
              </button>
            )}
            <button onClick={() => setFeedback(null)}>关闭</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function ToolInstaller({
  data,
  profileId,
  disabled,
  install,
}: {
  data: Snapshot;
  profileId: string;
  disabled: boolean;
  install: (tool: string, version: string) => void;
}) {
  const [selected, setSelected] = useState<Record<string, string>>({});
  const task = data.tasks
    .filter(
      (t) =>
        t.profile_id === profileId &&
        t.label === "查询工具版本" &&
        t.state === "已完成",
    )
    .at(-1);
  const versions = task?.result as
    Record<string, { versions: string[] }> | undefined;
  return (
    <div className="form">
      {tools.map(({ id: tool, name, icon }) => (
        <label key={tool}>
          <span className="tool-label">
            <AssetIcon src={icon} />
            {name} 版本
          </span>
          <select
            disabled={disabled}
            value={selected[`${profileId}:${tool}`] || ""}
            onChange={(e) =>
              setSelected({
                ...selected,
                [`${profileId}:${tool}`]: e.target.value,
              })
            }
          >
            <option value="">请先查询并选择版本</option>
            {versions?.[tool]?.versions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <button
            disabled={disabled || !selected[`${profileId}:${tool}`]}
            onClick={() => install(tool, selected[`${profileId}:${tool}`])}
          >
            安装选定版本
          </button>
        </label>
      ))}
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
      aria-label={title}
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
        <h2>{title}</h2>
        {settings && (
          <button
            className="brand-action"
            title="设置"
            aria-label="设置"
            onClick={settings}
          >
            <ActionIcon name="settings" />
          </button>
        )}
        {!windowError && (
          <button aria-label="关闭" onClick={close}>
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
            title === "工程目录"
              ? environmentIcon
              : title === "模型服务"
                ? modelIcon
                : connectIcon
          }
        />
        {title}
      </small>
      <strong>{value}</strong>
      <span title={detail}>{detail}</span>
    </div>
  );
}
