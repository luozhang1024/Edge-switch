import { t, setLanguage } from "./i18n";
import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tools } from "./catalog";
import chatgptIcon from "../image/providers/openai.svg";
import { HarnessAccount } from "./HarnessAccount";
import {
  defaultPreferences,
  isRunning,
  Official,
  Preferences,
  Profile,
  Snapshot,
  ToolId,
} from "./types";

export type SettingsTab =
  "general" | "routing" | "auth" | "advanced" | "usage" | "logs" | "about";
const tabs: [SettingsTab, string][] = [
  ["general", "通用"],
  ["routing", "路由"],
  ["auth", "授权中心"],
  ["advanced", "高级"],
  ["usage", "使用统计"],
  ["logs", "日志"],
  ["about", "关于"],
];
type Props = {
  data: Snapshot;
  current: Profile;
  busy: boolean;
  tab: SettingsTab;
  onTab: (tab: SettingsTab) => void;
  command: (name: string, args?: Record<string, unknown>) => Promise<boolean>;
  run: (action: string, payload?: Record<string, unknown>) => Promise<void>;
  onOfficial: (entry: Official) => void;
  onEdit: () => void;
  onTasks: () => void;
  onModels: (tool?: ToolId) => void;
  checkOnOpen: boolean;
  logs: React.ReactNode;
};
export function SettingsPage({
  data,
  current,
  busy,
  tab,
  onTab,
  command,
  run,
  onOfficial,
  onEdit,
  onTasks,
  onModels,
  checkOnOpen,
  logs,
}: Props) {
  const [prefs, setPrefs] = useState({
    ...defaultPreferences,
    ...data.preferences,
  });
  const saving = useRef(false);
  useEffect(() => {
    if (!saving.current)
      setPrefs({ ...defaultPreferences, ...data.preferences });
  }, [data.preferences]);
  useEffect(() => {
    let active = true;
    void invoke<boolean>("autostart_status")
      .then((enabled) => {
        if (active && typeof enabled === "boolean")
          setPrefs((previous) => ({ ...previous, autostart: enabled }));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const account = data.official[current.id];
  const ready = !!(account?.has_credentials || account?.remote_authenticated);
  const [loginMethod, setLoginMethod] = useState("browser");
  const [accountRefresh, setAccountRefresh] = useState(0);
  const authRunning = data.tasks.some(
    (task) =>
      task.profile_id === current.id &&
      isRunning(task) &&
      [
        "登录官方账号",
        "检测官方登录状态",
        "检查官方账号",
        "打开工具官方登录",
        "ChatGPT 浏览器登录",
        "DeepSeek 账号登录",
        "同步 DeepSeek 账号",
      ].includes(task.label),
  );
  const [checking, setChecking] = useState(false);
  const [update, setUpdate] = useState<{
    available: boolean;
    version: string;
    message: string;
  } | null>(null);
  const [updateError, setUpdateError] = useState("");
  async function check() {
    setChecking(true);
    setUpdateError("");
    try {
      setUpdate(await invoke("check_update"));
    } catch (error) {
      setUpdateError(String(error));
    } finally {
      setChecking(false);
    }
  }
  useEffect(() => {
    if (checkOnOpen) void check();
  }, [checkOnOpen]);
  async function save(next: Preferences) {
    const previous = prefs;
    saving.current = true;
    setPrefs(next);
    setLanguage(next.language);
    try {
      if (!(await command("save_preferences", { preferences: next }))) {
        setPrefs(previous);
        setLanguage(previous.language);
      }
    } finally {
      saving.current = false;
    }
  }
  const entries = data.tasks.filter((t) => t.profile_id === current.id);
  const lastAuth = entries
    .filter((t) =>
      [
        "登录官方账号",
        "检测官方登录状态",
        "检查官方账号",
        "打开工具官方登录",
        "ChatGPT 浏览器登录",
        "DeepSeek 账号登录",
        "同步 DeepSeek 账号",
      ].includes(t.label),
    )
    .at(-1);
  return (
    <section className="settings-page">
      <div className="settings-tabs" role="tablist" aria-label={t("设置分类")}>
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => onTab(id)}
          >
            {t(label)}
          </button>
        ))}
      </div>
      <div
        className="settings-content"
        role="tabpanel"
        aria-label={t(tabs.find(([id]) => id === tab)?.[1] || "")}
      >
        {tab === "logs" && logs}
        {tab === "general" && (
          <>
            <SettingsField
              title={t("窗口行为")}
              description={t("选择应用启动与关闭窗口时的行为。")}
            >
              <div className="window-behavior">
                <BehaviorSwitch
                  title={t("开机自启")}
                  description={t("登录 Windows 后自动运行 Edge Switch。")}
                  checked={prefs.autostart}
                  disabled={busy}
                  onChange={(autostart) => void save({ ...prefs, autostart })}
                />
                <BehaviorSwitch
                  title={t("关闭时最小化到托盘")}
                  description={t(
                    "开启后点击关闭按钮会隐藏到系统托盘，关闭此选项则退出应用。",
                  )}
                  checked={prefs.close_to_tray}
                  disabled={busy}
                  onChange={(close_to_tray) =>
                    void save({ ...prefs, close_to_tray })
                  }
                />
              </div>
            </SettingsField>
            <SettingsField
              title={t("界面语言")}
              description={t("切换后立即生效，保存后下次启动继续使用。")}
            >
              <div
                className="setting-segments language-picker"
                role="group"
                aria-label={t("界面语言")}
              >
                <button
                  aria-pressed={prefs.language === "zh"}
                  disabled={busy}
                  onClick={() => void save({ ...prefs, language: "zh" })}
                >
                  {t("中文")}
                </button>
                <button
                  aria-pressed={prefs.language === "en"}
                  disabled={busy}
                  onClick={() => void save({ ...prefs, language: "en" })}
                >
                  English
                </button>
              </div>
            </SettingsField>
            <SettingsField
              title={t("外观主题")}
              description={t("为唱片工作台选择配色，保存后下次启动继续使用。")}
            >
              <div className="setting-segments">
                {(
                  [
                    ["light", "☼ 浅色"],
                    ["dark", "☾ 深色"],
                    ["system", "▣ 跟随系统"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    aria-pressed={prefs.theme === value}
                    disabled={busy}
                    onClick={() => save({ ...prefs, theme: value })}
                  >
                    {t(label)}
                  </button>
                ))}
              </div>
            </SettingsField>
            <SettingsField
              title={t("主页显示")}
              description={t(
                "选择出现在首页滚动列表中的 AI 工具；VS Code 与 SSH 终端始终保留。",
              )}
            >
              <div className="setting-segments tool-visibility">
                {tools.map((tool) => (
                  <button
                    key={tool.id}
                    aria-pressed={prefs.home_tools.includes(tool.id)}
                    disabled={
                      busy ||
                      (prefs.home_tools.length === 1 &&
                        prefs.home_tools.includes(tool.id))
                    }
                    onClick={() =>
                      save({
                        ...prefs,
                        home_tools: prefs.home_tools.includes(tool.id)
                          ? prefs.home_tools.filter((id) => id !== tool.id)
                          : [...prefs.home_tools, tool.id],
                      })
                    }
                  >
                    <img src={tool.icon} alt="" />
                    {tool.name}
                  </button>
                ))}
              </div>
            </SettingsField>
            <SettingsField
              title={t("唱片动画")}
              description={t("系统启用减少动态效果时，唱片也会自动停止旋转。")}
            >
              <label className="setting-switch">
                <input
                  type="checkbox"
                  checked={prefs.motion}
                  disabled={busy}
                  onChange={(e) => save({ ...prefs, motion: e.target.checked })}
                />
                {t("自动旋转唱片")}
              </label>
            </SettingsField>
          </>
        )}
        {tab === "routing" && (
          <>
            <SettingsField
              title={t("当前环境的网络路由")}
              description={t(`为 ${current.name} 配置下载与工具访问网络。`)}
            >
              <div className="route-summary">
                <span>
                  {t("电脑下载")}
                  <b>
                    {current.proxy
                      ? t(`电脑代理 · 127.0.0.1:${current.proxy_port}`)
                      : t("直连")}
                  </b>
                </span>
                <span>
                  Codex
                  <b>
                    {(current.codex_proxy ?? current.proxy)
                      ? t("电脑代理")
                      : t("板卡直连")}
                  </b>
                </span>
                <span>
                  Harness
                  <b>
                    {(current.harness_proxy ?? current.proxy)
                      ? t("电脑代理")
                      : t("板卡直连")}
                  </b>
                </span>
              </div>
              <div className="buttons">
                <button disabled={busy} onClick={onEdit}>
                  {t("编辑网络设置")}
                </button>
                <button disabled={busy} onClick={() => void run("proxy_start")}>
                  {t("连接代理")}
                </button>
                <button disabled={busy} onClick={() => void run("disconnect")}>
                  {t("断开本地连接")}
                </button>
              </div>
            </SettingsField>
            <p className="settings-note">
              {t(
                "电脑代理通过 SSH 反向转发供板卡使用。修改路由前，请先断开当前环境的代理与网页连接。",
              )}
            </p>
          </>
        )}
        {tab === "auth" && (
          <div className="authorization-center">
            <header className="authorization-heading">
              <div>
                <h2>{t("授权中心")}</h2>
                <p>{t("管理官方账号授权与工具接入，按工作环境独立保存。")}</p>
              </div>
              <button
                disabled={busy || authRunning}
                onClick={() => {
                  setAccountRefresh((v) => v + 1);
                  void run("auth_status");
                }}
              >
                {authRunning ? t("正在处理…") : t("全部刷新")}
              </button>
            </header>
            <div className="authorization-context">
              <span>{t("当前工作环境")}</span>
              <b>{current.name}</b>
              <small>{t("授权成功后，前往模型服务启用对应账号。")}</small>
            </div>
            <section className="authorization-card" aria-label="ChatGPT">
              <header className="authorization-card-heading">
                <div className="authorization-brand">
                  <img src={chatgptIcon} alt="" />
                  <div>
                    <h3>ChatGPT</h3>
                    <small>{t("官方账号 · 用于 Codex CLI")}</small>
                  </div>
                </div>
                <div className="authorization-actions">
                  <select
                    aria-label={t("ChatGPT 登录方式")}
                    value={loginMethod}
                    disabled={busy || authRunning}
                    onChange={(e) => setLoginMethod(e.target.value)}
                  >
                    <option value="browser">{t("浏览器登录")}</option>
                    <option value="device">{t("设备码登录")}</option>
                  </select>
                  <button
                    className="primary"
                    disabled={busy || authRunning}
                    onClick={() =>
                      void run(
                        loginMethod === "browser" ? "login_browser" : "login",
                      )
                    }
                  >
                    {t("添加账号")}
                  </button>
                </div>
              </header>
              <div className="authorization-card-body">
                <div className="authorization-account-row">
                  <div>
                    <b>
                      {ready
                        ? account?.name || "OpenAI Official"
                        : t("尚未添加 ChatGPT 账号")}
                    </b>
                    <p>
                      {ready
                        ? account?.note || t("账号授权仅用于当前工作环境。")
                        : t(
                            "登录官方账号或导入凭据后，即可使用 ChatGPT 订阅。",
                          )}
                    </p>
                  </div>
                  <span className={`auth-state ${ready ? "ready" : ""}`}>
                    {account?.remote_authenticated
                      ? t("已确认登录")
                      : account?.has_credentials
                        ? t("已导入凭据")
                        : t("未授权")}
                  </span>
                </div>
                <div className="buttons">
                  <button
                    disabled={busy || authRunning}
                    onClick={() => void run("auth_status")}
                  >
                    {t("检测已有登录")}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      onOfficial({ name: "OpenAI Official", ...account })
                    }
                  >
                    {t("导入 / 管理 auth.json")}
                  </button>
                  <button
                    disabled={!ready || busy}
                    onClick={() => onModels("codex")}
                  >
                    {t("前往模型列表启用")}
                  </button>
                </div>
                <p className="settings-note">
                  {t(
                    "浏览器登录在本机打开官方授权网页，完成后加密保存到当前工作环境；设备码登录通过板卡 SSH 终端完成。每个工作环境保存一份 ChatGPT 授权，凭据导入可在管理入口中操作。",
                  )}
                </p>
                {account?.verified_at && (
                  <p className="settings-note">
                    {t("上次检测：")}
                    {new Date(account.verified_at * 1000).toLocaleString()}
                  </p>
                )}
              </div>
            </section>
            <HarnessAccount
              busy={busy || authRunning}
              active={current.tool_services?.harness === "official"}
              refreshKey={`${current.id}:${accountRefresh}:${data.tasks.map((task) => `${task.id}:${task.state}`).join(",")}`}
              run={run}
              onModels={() => onModels("harness")}
            />
            <div className="authorization-section-label">
              {t("其他工具接入")}
            </div>
            {tools
              .filter((tool) => tool.id !== "codex" && tool.id !== "harness")
              .map((tool) => {
                const services = (data.services[current.id] || []).filter(
                  (service) =>
                    service.scope === "universal" ||
                    (service.tool || "codex") === tool.id,
                );
                return (
                  <section
                    className="authorization-card"
                    key={tool.id}
                    aria-label={tool.name}
                  >
                    <header className="authorization-card-heading">
                      <div className="authorization-brand">
                        <img src={tool.icon} alt="" />
                        <div>
                          <h3>{tool.name}</h3>
                          <small>
                            {t(
                              tool.id === "harness"
                                ? "API 供应商接入"
                                : "终端授权 / API 供应商接入",
                            )}
                          </small>
                        </div>
                      </div>
                      <div className="authorization-actions">
                        {tool.id !== "harness" && (
                          <button
                            disabled={busy || authRunning}
                            onClick={() =>
                              void run("tool_login", { tool: tool.id })
                            }
                          >
                            {t("添加账号")}
                          </button>
                        )}
                        <button
                          disabled={busy}
                          onClick={() => onModels(tool.id)}
                        >
                          {t("管理接入")}
                        </button>
                      </div>
                    </header>
                    <div className="authorization-card-body authorization-tool-status">
                      <span>
                        {t(
                          services.length
                            ? "已配置供应商"
                            : "尚未配置 API 供应商",
                        )}
                        {services.length > 0 && ` · ${services.length}`}
                      </span>
                      <small>
                        {t(
                          tool.id === "harness"
                            ? "通过模型服务配置 API Key，统一供应商可供多个工具复用。"
                            : "官方账号请在板卡终端完成授权，登录状态以工具提示为准；API 供应商可在模型服务中管理。",
                        )}
                      </small>
                    </div>
                  </section>
                );
              })}
            {lastAuth && (
              <div className="auth-result" role="status">
                <b>
                  {t(lastAuth.label)} · {t(lastAuth.state)}
                </b>
                <p>{lastAuth.message}</p>
                <button onClick={onTasks}>{t("查看任务详情")}</button>
              </div>
            )}
          </div>
        )}
        {tab === "advanced" && (
          <>
            <SettingsField
              title={t("SSH 与工作目录")}
              description={t(
                "连接配置按环境保存；编辑操作不会修改板卡上的工程文件。",
              )}
            >
              <dl className="settings-details">
                <dt>{t("远程设备")}</dt>
                <dd>
                  {current.user}@{current.host}:{current.port}
                </dd>
                <dt>{t("工程目录")}</dt>
                <dd>{current.project}</dd>
                <dt>{t("SSH 身份")}</dt>
                <dd>{current.identity || t("系统默认身份")}</dd>
                <dt>{t("退出策略")}</dt>
                <dd>
                  {current.harness_background
                    ? t("保留 Harness 后台服务")
                    : t("退出时停止 Harness")}
                </dd>
              </dl>
              <button disabled={busy} onClick={onEdit}>
                {t("编辑环境配置")}
              </button>
            </SettingsField>
            <SettingsField
              title={t("安装与维护")}
              description={t("查看设备状态、安装工具或维护远程编辑器。")}
            >
              <div className="buttons">
                <button disabled={busy} onClick={() => void run("diagnose")}>
                  {t("检查设备")}
                </button>
                <button disabled={busy} onClick={() => void run("versions")}>
                  {t("查询工具版本")}
                </button>
              </div>
            </SettingsField>
          </>
        )}
        {tab === "usage" && (
          <>
            <SettingsField
              title={t("本次运行的任务统计")}
              description={t(
                `仅统计当前程序启动后 ${current.name} 的任务；不代表供应商 Token 用量或账单。`,
              )}
            >
              <div className="usage-counters">
                {[
                  ["总任务", entries.length],
                  [
                    "已完成",
                    entries.filter((t) => t.state === "已完成").length,
                  ],
                  ["进行中", entries.filter(isRunning).length],
                  ["失败", entries.filter((t) => t.state === "失败").length],
                ].map(([label, count]) => (
                  <div key={label}>
                    <strong>{count}</strong>
                    <span>{t(String(label))}</span>
                  </div>
                ))}
              </div>
              <button onClick={onTasks}>{t("查看任务记录")}</button>
            </SettingsField>
          </>
        )}
        {tab === "about" && (
          <>
            <SettingsField
              title="Edge Switch"
              description={t("面向 Linux 板卡的远程 AI 开发工作台。")}
            >
              <p className="about-version">v{data.version}</p>
              <p className="settings-note">
                {t(
                  "通过 SSH 安装与启动开发工具，配置代理网络，管理和切换模型 API 供应商。",
                )}
              </p>
              <div className="buttons">
                <button
                  className="primary"
                  disabled={checking}
                  onClick={() => void check()}
                >
                  {checking ? t("正在检查…") : t("检查更新")}
                </button>
                <button onClick={() => void command("open_release_page")}>
                  {t("打开版本发布页")}
                </button>
              </div>
              {update && (
                <div className="update-result" role="status">
                  <b>{update.message}</b>
                  <p>
                    {update.available
                      ? t(`最新版本：v${update.version}`)
                      : t(`当前版本：v${data.version}`)}
                  </p>
                </div>
              )}
              {updateError && (
                <p className="form-error" role="alert">
                  {t(updateError)}
                </p>
              )}
              <p className="settings-note">
                {t(
                  "版本检查来自 GitHub Releases；下载与安装由你在发布页确认。",
                )}
              </p>
            </SettingsField>
          </>
        )}
      </div>
    </section>
  );
}
function BehaviorSwitch({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <label className="behavior-switch">
      <span>
        <b>{t(title)}</b>
        <small>{t(description)}</small>
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-label={t(title)}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <i aria-hidden="true" />
    </label>
  );
}
function SettingsField({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="settings-field">
      <h3>{t(title)}</h3>
      <p>{t(description)}</p>
      {children}
    </section>
  );
}
