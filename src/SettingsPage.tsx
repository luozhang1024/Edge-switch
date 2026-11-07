import { t, setLanguage } from "./i18n";
import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tools } from "./catalog";
import {
  defaultPreferences,
  isRunning,
  Official,
  Preferences,
  Profile,
  Snapshot,
} from "./types";

export type SettingsTab =
  "general" | "routing" | "auth" | "advanced" | "usage" | "logs" | "about";
const tabs: [SettingsTab, string][] = [
  ["general", "通用"],
  ["routing", "路由"],
  ["auth", "认证"],
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
  onModels: () => void;
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
      ["登录官方账号", "检测官方登录状态", "检查官方账号"].includes(t.label),
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
          <>
            <SettingsField
              title={t("官方账号认证")}
              description={t(
                "账号认证按远程工作环境保存。完成授权后，可在模型服务列表中启用官方账号。",
              )}
            >
              <article className="auth-account">
                <div className="auth-avatar">✳</div>
                <div>
                  <h3>OpenAI / ChatGPT</h3>
                  <p>
                    {t("用于 Codex CLI ·")}
                    {current.name}
                  </p>
                </div>
                <span className={`auth-state ${ready ? "ready" : ""}`}>
                  {account?.remote_authenticated
                    ? t("已确认登录")
                    : account?.has_credentials
                      ? t("已导入凭据")
                      : t("尚未认证")}
                </span>
              </article>
              <div className="buttons">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void run("login")}
                >
                  {t("登录 ChatGPT")}
                </button>
                <button disabled={busy} onClick={() => void run("auth_status")}>
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
                <button disabled={!ready || busy} onClick={onModels}>
                  {t("前往模型列表启用")}
                </button>
              </div>
              <p className="settings-note">
                {t(
                  "首次使用请先在工作环境的 AI 工具中安装 Codex CLI，并配置好 SSH 登录。点击登录后，会打开当前板卡的 SSH 终端。按照终端提示在官方网页完成设备码授权；应用不会收集账号密码。登录过程可在任务记录中查看或取消。",
                )}
              </p>
              {account?.verified_at && (
                <p className="settings-note">
                  {t("上次检测：")}
                  {new Date(account.verified_at * 1000).toLocaleString()}
                </p>
              )}
              {lastAuth && (
                <div className="auth-result" role="status">
                  <b>
                    {lastAuth.label} · {lastAuth.state}
                  </b>
                  <p>{lastAuth.message}</p>
                  <button onClick={onTasks}>{t("查看任务详情")}</button>
                </div>
              )}
            </SettingsField>
            <SettingsField
              title={t("其他工具")}
              description={t(
                "Claude Code、Gemini CLI、Harness 与 OpenCode 目前通过模型服务中的 API 供应商配置接入。",
              )}
            >
              <button onClick={onModels}>{t("管理模型服务")}</button>
            </SettingsField>
          </>
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
