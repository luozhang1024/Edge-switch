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
import editIcon from "../image/编辑.png";
import deleteIcon from "../image/删除.png";
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
} from "./types";
import "./style.css";
import "./studio.css";
import { ModelServices } from "./ModelServices";
import { ProviderPage } from "./ProviderPage";
import { ServiceEditor } from "./ServiceEditor";
import { RecordPlayer } from "./RecordPlayer";
import { WindowControls } from "./WindowControls";
import { ScrollList } from "./ScrollList";
import { protocolNames, tools } from "./catalog";
import { ToolId } from "./types";

const navigation = [
  {
    id: "overview",
    label: "总览与任务",
    icon: logo,
    description: "设备、服务与任务，一目了然。",
  },
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
    id: "proxy",
    label: "代理网络",
    icon: proxyIcon,
    description: "让电脑与板卡之间的连接井然有序。",
  },
  {
    id: "tools",
    label: "AI 工具",
    icon: toolsIcon,
    description: "从安装到启动，你的开发工具都在这里。",
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
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [modelTool, setModelTool] = useState<ToolId>("codex");
  const [editing, setEditing] = useState<Profile | null>(null);
  const [service, setService] = useState<Service | null>(null);
  const [official, setOfficial] = useState<Official | null>(null);
  const [authPath, setAuthPath] = useState("");
  const [message, setMessage] = useState("就绪");
  const [pending, setPending] = useState(false);
  const refreshInFlight = useRef(false);
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
          if (event === "app-error") setMessage(String(e.payload));
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
      await invoke(name, args);
      setMessage("操作已提交");
      await load();
      return true;
    } catch (e) {
      setMessage(String(e));
      return false;
    } finally {
      setPending(false);
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
  const currentConnections = Object.entries(connections).filter(([id]) =>
    id.startsWith(`${current.id}:`),
  );
  async function run(action: string, payload: Record<string, unknown> = {}) {
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
    await command("start_task", { profileId: current.id, action, payload });
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
      if (typeof path === "string") await run(action, { path });
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
      {navigationOpen && (
        <Modal
          title="工作台导航"
          className="navigation-drawer"
          close={() => setNavigationOpen(false)}
        >
          <aside>
            <div className="brand">
              <img src={logo} alt="Edge Switch" />
              <b>Edge Switch</b>
            </div>
            <div className="sub">板卡 AI 工作台</div>
            <div className="nav-caption">YOUR LIBRARY / 工作空间</div>
            <nav aria-label="主导航">
              {navigation.map(({ id, label, icon }) => (
                <button
                  key={id}
                  className={tab === id ? "nav active" : "nav"}
                  aria-current={tab === id ? "page" : undefined}
                  onClick={() => {
                    setTab(id);
                    setNavigationOpen(false);
                  }}
                >
                  <AssetIcon src={icon} />
                  {label}
                </button>
              ))}
            </nav>
            <button
              className="drawer-task-link"
              onClick={() => {
                setTab("tasks");
                setNavigationOpen(false);
              }}
            >
              任务记录
            </button>
            <div className="sidefoot">
              v{data.version}
              <span>关闭窗口后保留在托盘</span>
              <button onClick={() => void command("quit_app")}>退出程序</button>
            </div>
          </aside>
        </Modal>
      )}
      <main>
        <header className="studio-header" data-tauri-drag-region>
          <div className="studio-brand" data-tauri-drag-region>
            <img src={logo} alt="" />
            <b data-tauri-drag-region>Edge Switch</b>
            <span data-tauri-drag-region>REMOTE AI STUDIO</span>
          </div>
          <label>
            当前环境{" "}
            <select
              disabled={pending}
              value={current.id}
              onChange={(e) => {
                setEditing(null);
                setService(null);
                setOfficial(null);
                void command("select_profile", { id: e.target.value });
              }}
            >
              {data.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <WindowControls onError={setMessage} />
        </header>
        <RecordPlayer
          current={current}
          busy={busy}
          connected={currentConnections.some(([, c]) => c.state === "已连接")}
          run={run}
          onNavigate={() => setNavigationOpen(true)}
          onTasks={() => setTab("tasks")}
          onInfo={() => setTab("info")}
          taskCount={
            data.tasks.filter(
              (t) => t.profile_id === current.id && isRunning(t),
            ).length
          }
        />
        <div className="studio-status" role="status">
          <i className={busy ? "is-busy" : ""} />
          {busy && ["就绪", "操作已提交"].includes(message)
            ? "任务进行中 · 可打开任务记录查看"
            : message}
          {tab === "overview" && (
            <button
              aria-label="刷新"
              title="刷新工作台状态"
              onClick={() => void load()}
            >
              ↻
            </button>
          )}
        </div>
      </main>
      {tab !== "overview" && (
        <Modal
          title={
            navigation.find((item) => item.id === tab)?.label ||
            (tab === "tasks" ? "任务记录" : "环境详情")
          }
          className="workspace-sheet"
          refresh={() => void load()}
          close={() => setTab("overview")}
        >
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
                    currentConnections.map(([, c]) => c.state).join(" / ") ||
                    "尚未建立隧道"
                  }
                  detail="SSH 通道按需建立，请查看任务结果确认设备状态"
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
                {data.profiles.map((p) => (
                  <div
                    className={
                      p.id === current.id ? "profile selected" : "profile"
                    }
                    key={p.id}
                  >
                    <div>
                      <b>{p.name}</b>
                      <p>
                        {p.user}@{p.host}:{p.port}
                      </p>
                      <small>{p.project}</small>
                    </div>
                    <div className="buttons">
                      <button
                        disabled={pending || p.id === current.id}
                        onClick={() =>
                          void command("select_profile", { id: p.id })
                        }
                      >
                        <AssetIcon src={activateIcon} />
                        使用
                      </button>
                      <button
                        disabled={data.tasks.some(
                          (t) => t.profile_id === p.id && isRunning(t),
                        )}
                        onClick={() => setEditing({ ...p })}
                      >
                        <AssetIcon src={editIcon} />
                        编辑
                      </button>
                      <button
                        disabled={pending || data.profiles.length <= 1}
                        onClick={() =>
                          void remove(
                            "delete_profile",
                            { id: p.id },
                            `删除「${p.name}」及本地保存的服务和凭据？板卡文件保留。`,
                          )
                        }
                      >
                        <AssetIcon src={deleteIcon} />
                        删除
                      </button>
                    </div>
                  </div>
                ))}
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
            />
          )}
          {tab === "proxy" && (
            <section className="panel">
              <h2>代理网络</h2>
              <p>
                电脑下载：
                {current.proxy ? `127.0.0.1:${current.proxy_port}` : "直连"}
                ；Codex：
                {(current.codex_proxy ?? current.proxy)
                  ? "电脑代理"
                  : "板卡直连"}
                ；Harness：
                {(current.harness_proxy ?? current.proxy)
                  ? "电脑代理"
                  : "板卡直连"}
                。
              </p>
              <p>
                电脑代理通过 SSH
                反向转发到板卡，中断后自动尝试重连。修改设置前先断开本地连接。
              </p>
              <div className="buttons">
                <button
                  disabled={busy}
                  onClick={() => setEditing({ ...current })}
                >
                  <AssetIcon src={editIcon} />
                  编辑网络设置
                </button>
                {button("连接代理", "proxy_start")}
                {button("断开本地连接", "disconnect")}
              </div>
              {currentConnections.map(([id, c]) => (
                <div className="profile" key={id}>
                  <b>{c.kind === "proxy" ? "代理隧道" : "Harness 网页"}</b>
                  <span>
                    {c.state} · 电脑 {c.local_port} ↔ 板卡 {c.remote_port}
                  </span>
                </div>
              ))}
            </section>
          )}
          {tab === "tools" && (
            <section>
              <div className="panel">
                <h2>工具部署</h2>
                <p>
                  安装到当前环境专属目录，不替换系统
                  Node.js。先查询版本，再选择安装。
                </p>
                <div className="buttons">
                  {button("检查设备", "diagnose")}
                  {button("查询可用版本", "versions")}
                  {button("安装独立 Node.js", "install_runtime")}
                  {button("复用已有工具", "reuse_tools")}
                </div>
                <ToolInstaller
                  data={data}
                  profileId={current.id}
                  disabled={busy}
                  install={(tool, version) =>
                    void run("install_tool", { tool, version })
                  }
                />
              </div>
              <div className="panel">
                <h2>启动与服务</h2>
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
                    disabled={busy}
                    onClick={() => void choose("editor_pin")}
                  >
                    <AssetIcon src={vscodeIcon} />
                    选择并固定 Code.exe
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void choose("import_server")}
                  >
                    <AssetIcon src={vscodeIcon} />
                    导入 Server 安装包
                  </button>
                  {button("读取连接诊断", "vscode_diagnostics")}
                </div>
              </div>
            </section>
          )}
          {tab === "tasks" && (
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
                          {new Date(t.started_at * 1000).toLocaleTimeString()}
                        </small>
                      </summary>
                      <p>{t.message}</p>
                      {isRunning(t) && (
                        <button
                          onClick={async () => {
                            if (
                              await confirm(
                                "停止本地等待和 SSH 操作；远端操作可能仍在进行，请随后刷新设备核对。",
                                { title: "取消任务", kind: "warning" },
                              )
                            )
                              await command("cancel_task", { taskId: t.id });
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
                {!data.tasks.some((t) => t.profile_id === current.id) && (
                  <p className="empty">
                    暂无任务。先检查设备，确认 SSH 连接和板卡状态。
                  </p>
                )}
              </ScrollList>
            </section>
          )}
        </Modal>
      )}
      {editing && (
        <Modal title="编辑工作环境" close={() => setEditing(null)}>
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
              <button disabled={pending} className="primary">
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
                导入官方 OAuth
                凭据，或启用官方账号后在“验证与同步”中设备码登录。凭据在本机加密保存，同步时写入远程设备。
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
  refresh,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
  className?: string;
  refresh?: () => void;
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
      <div className="panelhead">
        <h2>{title}</h2>
        {refresh && (
          <button className="sheet-refresh" aria-label="刷新" onClick={refresh}>
            ↻
          </button>
        )}
        <button aria-label="关闭" onClick={close}>
          ×
        </button>
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
