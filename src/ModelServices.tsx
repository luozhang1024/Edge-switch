import { t } from "./i18n";
import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ActionIcon } from "./ActionIcon";
import { ScrollList } from "./ScrollList";
import { ordered, moveItem } from "./listOrder";
import { defaultProtocol } from "./providerConfig";
import { NativeProviderRow } from "./NativeProviderRow";
import officialIcon from "../image/providers/openai.svg";
import addIcon from "../image/加.png";
import { Official, Profile, Service, Snapshot, ToolId } from "./types";
import {
  detectProvider,
  protocolNames,
  serviceTemplate,
  tools,
} from "./catalog";

type Props = {
  data: Snapshot;
  current: Profile;
  tool: ToolId;
  busy: boolean;
  onTool: (tool: ToolId) => void;
  onEdit: (service: Service) => void;
  onOfficial: (official: Official) => void;
  onAuthenticate: () => void;
  command: (name: string, args?: Record<string, unknown>) => Promise<boolean>;
  run: (action: string, payload?: Record<string, unknown>) => Promise<void>;
  remove: (
    name: string,
    args: Record<string, unknown>,
    warning: string,
  ) => Promise<void>;
};
export function ModelServices({
  data,
  current,
  tool,
  busy,
  onTool,
  onEdit,
  onOfficial,
  onAuthenticate,
  command,
  run,
  remove,
}: Props) {
  const [dragged, setDragged] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [nativeRevision, setNativeRevision] = useState(0);
  const [native, setNative] = useState<{
    detected: boolean;
    provider: string;
    name: string;
    model: string;
    endpoint: string | null;
  } | null>(null);
  useEffect(() => {
    let live = true;
    setNative(null);
    if (current.kind !== "local") return;
    const refresh = () =>
      void invoke<typeof native>("native_tool_config", {
        profileId: current.id,
      })
        .then((value) => {
          if (live) setNative(value);
        })
        .catch(() => {});
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      live = false;
      window.removeEventListener("focus", refresh);
    };
  }, [current.id, current.kind, tool, nativeRevision]);
  const selected = tools.find((t) => t.id === tool)!;
  const visibleTools = tools.filter(
    (item) => current.tool_visibility?.[item.id] !== false,
  );
  useEffect(() => {
    if (current.tool_visibility?.[tool] === false && visibleTools[0])
      onTool(visibleTools[0].id);
  }, [current.id, current.tool_visibility, tool]);
  const activeId =
    tool === "codex" ? current.active_api : current.tool_services?.[tool];
  const official =
    tool === "codex"
      ? current.codex_auth === "chatgpt"
      : tool === "harness"
        ? activeId === "official"
        : activeId === "official";
  const officialReady = !!(
    data.official[current.id]?.has_credentials ||
    data.official[current.id]?.remote_authenticated
  );
  const services = (data.services[current.id] || []).filter(
    (s) =>
      tool !== "copilot" &&
      (s.scope === "universal" || (s.tool || "codex") === tool),
  );
  const officialName =
    data.official_options?.[current.id]?.[tool]?.name ||
    {
      codex: "OpenAI Official",
      claude: "Claude Official",
      gemini: "Gemini Official",
      opencode: "OpenCode Zen",
      harness: "DeepSeek 账号",
      kimi: "Kimi Official",
      grok: "xAI API",
      qwen: "Qwen Official",
      copilot: "GitHub Copilot",
    }[tool];
  const rows = ordered(
    [
      ...(tool === "grok"
        ? []
        : tool !== "harness"
          ? [{ id: "official" } as Service]
          : services.length || current.hide_harness_default
            ? []
            : [{ id: "default-api" } as Service]),
      ...services,
    ],
    data.list_order?.services?.[current.id]?.[tool],
  );
  function dragProps(id: string) {
    return {
      draggable: !busy,
      onDragStart: (e: React.DragEvent) => {
        setDragged(id);
        e.dataTransfer.setData("text/plain", id);
        e.dataTransfer.effectAllowed = "move";
      },
      onDragOver: (e: React.DragEvent) => {
        if (dragged) e.preventDefault();
      },
      onDragEnd: () => setDragged(null),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        if (dragged)
          void command("reorder_items", {
            kind: "services",
            profileId: current.id,
            tool,
            ids: moveItem(
              rows.map((r) => r.id),
              dragged,
              id,
            ),
          });
        setDragged(null);
      },
    };
  }
  const active = services.find((s) => s.id === activeId);
  const currentTask = data.tasks
    .filter((t) => t.profile_id === current.id)
    .at(-1);
  async function activate(serviceId: string) {
    await command("activate_service", {
      profileId: current.id,
      serviceId,
      tool,
    });
  }
  if (!visibleTools.length)
    return (
      <section className="model-workspace">
        <h2>{t("模型服务")}</h2>
        <p>{t("尚未显示 AI 工具，请到工具安装中开启“在模型服务中显示”。")}</p>
      </section>
    );
  return (
    <section className="model-workspace">
      <div className="model-toolbar">
        <h2>{selected.name}</h2>
        <div
          className="tool-switcher"
          role="tablist"
          aria-label={t("板卡 AI 工具")}
        >
          {visibleTools.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tool === t.id}
              title={t.name}
              aria-label={t.name}
              onClick={() => onTool(t.id)}
            >
              <img src={t.icon} alt="" />
              <span className="sr-only">{t.name}</span>
            </button>
          ))}
        </div>
        <button
          className="add-service"
          aria-label={t("添加服务")}
          title={t("添加新供应商")}
          disabled={busy || tool === "copilot"}
          onClick={() =>
            onEdit({
              ...serviceTemplate(tool, "custom"),
              protocol: defaultProtocol(tool),
              preset: "custom",
              scope: "cli",
            })
          }
        >
          <img src={addIcon} alt="" />
          <span className="sr-only">{t("添加服务")}</span>
        </button>
      </div>
      {tool === "codex" && native?.detected && (
        <NativeProviderRow
          config={native}
          profileId={current.id}
          busy={busy}
          changed={() => {
            setNativeRevision((v) => v + 1);
            void command("snapshot");
          }}
        />
      )}
      {tool === "harness" && (
        <section
          className="authorization-context harness-model-account"
          aria-label={t("DeepSeek 账号通道")}
        >
          <img src={selected.icon} alt="" width="24" height="24" />
          <div>
            <b>{t("DeepSeek 账号")}</b>
            <p>
              {t(
                official
                  ? "当前板卡已选择账号通道"
                  : "可在授权中心识别本机 Harness 账号，并同步到当前板卡使用账号模型。",
              )}
            </p>
          </div>
          <button disabled={busy} onClick={onAuthenticate}>
            {t("授权中心")}
          </button>
          <button
            title={official ? t("使用中") : t("启用 DeepSeek 账号")}
            aria-label={official ? t("使用中") : t("启用 DeepSeek 账号")}
            disabled={busy || official}
            onClick={() => void run("harness_account_sync")}
          >
            {official ? (
              <span className="active-badge">{t("使用中")}</span>
            ) : (
              <ActionIcon name="activate" />
            )}
          </button>
          <button
            title={t("打开 Harness")}
            aria-label={t("打开账号 Harness")}
            disabled={busy || !official}
            onClick={() => void run("harness")}
          >
            <ActionIcon name="launch" />
          </button>
          <div className="service-actions">
            <button
              title={t("编辑账号")}
              aria-label={t("编辑账号")}
              disabled={busy}
              onClick={onAuthenticate}
            >
              <ActionIcon name="edit" />
            </button>
            <button
              title={t("复制账号信息")}
              aria-label={t("复制账号信息")}
              disabled={busy}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    "DeepSeek Harness · " + current.name,
                  );
                  setCopyStatus("已复制账号名称和备注");
                } catch {
                  setCopyStatus("复制未完成，请检查系统剪贴板权限");
                }
              }}
            >
              <ActionIcon name="copy" />
            </button>
            <button
              title={t("测试账号")}
              aria-label={t("测试账号")}
              disabled={busy}
              onClick={() =>
                void invoke<{ signed_in: boolean; error?: string }>(
                  "local_harness_account",
                )
                  .then((account) =>
                    setCopyStatus(
                      account?.signed_in && !account.error
                        ? "账号连接测试通过"
                        : account?.error || "尚未登录 DeepSeek Harness 账号",
                    ),
                  )
                  .catch((e) => setCopyStatus(String(e)))
              }
            >
              <ActionIcon name="test" />
            </button>
            <button
              title={t("退出账号")}
              aria-label={t("退出账号")}
              disabled={busy}
              onClick={() =>
                void remove(
                  "logout_account",
                  { profileId: current.id, tool: "harness" },
                  "退出本机 DeepSeek Harness 账号？其他配置和已经同步到板卡的账号保留。",
                )
              }
            >
              <ActionIcon name="delete" />
            </button>
          </div>
        </section>
      )}
      <ScrollList className="service-list" label={t("供应商列表")}>
        {rows.map((s) => {
          if (s.id === "official" && tool === "codex")
            return (
              <article
                key="official"
                {...dragProps("official")}
                className={`service-card ${official ? "selected" : ""}`}
              >
                <div className="provider-avatar">
                  <img
                    src={data.official[current.id]?.icon || officialIcon}
                    alt="OpenAI Official"
                  />
                </div>
                <div className="service-info">
                  <b>{data.official[current.id]?.name || "OpenAI Official"}</b>
                  <span
                    className="service-url"
                    title={t("ChatGPT 官方账号 · 无需 API Key")}
                  >
                    https://chatgpt.com/codex
                  </span>
                  <small>
                    {data.official[current.id]?.name || t("官方 ChatGPT 账号")}{" "}
                    ·{" "}
                    {data.official[current.id]?.has_credentials
                      ? t("已保存导入凭据")
                      : data.official[current.id]?.remote_authenticated
                        ? t("已确认板卡账号登录")
                        : t("请先在授权中心完成授权")}
                  </small>
                  {data.official[current.id]?.note && (
                    <small>{data.official[current.id]?.note}</small>
                  )}
                </div>
                <div className="service-actions">
                  <button
                    title={official ? t("使用中") : t("启用官方账号")}
                    aria-label={official ? t("使用中") : t("启用官方账号")}
                    className="primary activate-service"
                    disabled={busy || official || !officialReady}
                    onClick={() => void activate("official")}
                  >
                    {official ? (
                      <span className="active-badge">{t("使用中")}</span>
                    ) : (
                      <ActionIcon name="activate" />
                    )}
                  </button>
                  {!officialReady && (
                    <button
                      className="authenticate-link"
                      title={t("前往授权中心")}
                      aria-label={t("前往授权中心")}
                      onClick={onAuthenticate}
                    >
                      <ActionIcon name="login" />
                    </button>
                  )}
                  <button
                    title={t("编辑 / 导入 auth.json")}
                    disabled={busy}
                    onClick={() =>
                      onOfficial({
                        name: "OpenAI Official",
                        ...data.official[current.id],
                      })
                    }
                  >
                    <ActionIcon name="edit" />
                    <span className="sr-only">
                      {t("编辑 / 导入 auth.json")}
                    </span>
                  </button>
                  <button
                    title={t("复制账号信息")}
                    aria-label={t("复制账号信息")}
                    disabled={busy}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          JSON.stringify(
                            {
                              name:
                                data.official[current.id]?.name ||
                                "OpenAI Official",
                              note: data.official[current.id]?.note || "",
                            },
                            null,
                            2,
                          ),
                        );
                        setCopyStatus("已复制账号名称和备注");
                      } catch {
                        setCopyStatus("复制未完成，请检查系统剪贴板权限");
                      }
                    }}
                  >
                    <ActionIcon name="copy" />
                  </button>
                  <button
                    title={t("测试官方账号")}
                    aria-label={t("测试官方账号")}
                    disabled={busy}
                    onClick={() =>
                      void run("official_test", { tool, infer: false })
                    }
                  >
                    <ActionIcon name="test" />
                  </button>
                  <button
                    className="danger-text"
                    title={t("删除本机账号信息")}
                    disabled={busy || !data.official[current.id]}
                    onClick={() =>
                      void remove(
                        "delete_official",
                        { profileId: current.id },
                        "删除本机保存的官方账号信息和导入凭据？板卡上已有登录状态保留。",
                      )
                    }
                  >
                    <ActionIcon name="delete" />
                    <span className="sr-only">{t("删除本机账号信息")}</span>
                  </button>
                </div>
              </article>
            );
          if (s.id === "official")
            return (
              <article
                key="official"
                {...dragProps("official")}
                className={`service-card ${official ? "selected" : ""}`}
              >
                <div className="provider-avatar">
                  <img src={selected.icon} alt="" />
                </div>
                <div className="service-info">
                  <b>{officialName}</b>
                  <span>
                    {t("使用")}
                    {selected.name}
                    {t(" 官方账号")}
                  </span>
                  <small>
                    {t("在板卡终端完成授权，凭据保留在此环境专属目录")}
                  </small>
                </div>
                <div className="service-actions">
                  {tool === "claude" && (
                    <button
                      title={t("编辑官方供应商")}
                      aria-label={t("编辑官方供应商")}
                      disabled={busy}
                      onClick={() =>
                        onOfficial({ tool: "claude", name: officialName })
                      }
                    >
                      <ActionIcon name="edit" />
                    </button>
                  )}
                  <button
                    title={
                      official ? t("已选择，登录状态未确认") : t("启用官方账号")
                    }
                    aria-label={
                      official ? t("已选择，登录状态未确认") : t("启用官方账号")
                    }
                    disabled={busy || official}
                    onClick={() => void activate("official")}
                  >
                    {official ? (
                      <span className="active-badge">
                        {t("已选择，登录状态未确认")}
                      </span>
                    ) : (
                      <ActionIcon name="activate" />
                    )}
                  </button>
                  <button
                    title={t("登录官方账号")}
                    aria-label={t("登录官方账号")}
                    disabled={busy}
                    onClick={async () => {
                      if (
                        await command("activate_service", {
                          profileId: current.id,
                          serviceId: "official",
                          tool,
                        })
                      )
                        await run("tool_login", { tool });
                    }}
                  >
                    <ActionIcon name="login" />
                  </button>
                  <button
                    title={t(`打开 ${selected.name}`)}
                    aria-label={t(`打开官方 ${selected.name}`)}
                    disabled={busy || !official}
                    onClick={() => void run(tool)}
                  >
                    <ActionIcon name="launch" />
                  </button>
                </div>
              </article>
            );
          if (s.id === "default-api")
            return (
              <article key={s.id} {...dragProps(s.id)} className="service-card">
                <div className="provider-avatar">
                  <img src={selected.icon} alt="" />
                </div>
                <div className="service-info">
                  <b>DeepSeek API</b>
                  <span>https://api.deepseek.com/v1</span>
                  <small>{t("配置模型与 API Key 后使用")}</small>
                </div>
                <div className="service-actions">
                  <button
                    title={t("配置 API")}
                    aria-label={t("配置 API")}
                    disabled={busy}
                    onClick={() =>
                      onEdit({
                        ...serviceTemplate(tool, "deepseek"),
                        name: "DeepSeek API",
                        preset: "official",
                      })
                    }
                  >
                    <ActionIcon name="edit" />
                  </button>
                  <button
                    title={t("复制")}
                    aria-label={t("复制")}
                    disabled={busy}
                    onClick={() =>
                      onEdit({
                        ...serviceTemplate(tool, "deepseek"),
                        name: "DeepSeek API 副本",
                      })
                    }
                  >
                    <ActionIcon name="copy" />
                  </button>
                  <button
                    title={t("测试")}
                    aria-label={t("测试")}
                    disabled={busy}
                    onClick={() => {
                      setCopyStatus("请先配置模型与 API Key，再测试供应商。");
                      onEdit({
                        ...serviceTemplate(tool, "deepseek"),
                        name: "DeepSeek API",
                        preset: "official",
                      });
                    }}
                  >
                    <ActionIcon name="test" />
                  </button>
                  <button
                    title={t("删除")}
                    aria-label={t("删除")}
                    disabled={busy}
                    onClick={() =>
                      void remove(
                        "hide_default_service",
                        { profileId: current.id },
                        "删除此默认 API 入口？仍可通过添加服务重新配置。",
                      )
                    }
                  >
                    <ActionIcon name="delete" />
                  </button>
                </div>
              </article>
            );
          const provider = detectProvider(s);
          const isActive = !official && activeId === s.id;
          return (
            <article
              key={s.id}
              {...dragProps(s.id)}
              className={`service-card ${isActive ? "selected" : ""}`}
            >
              <div className="provider-avatar">
                {s.icon || provider.icon ? (
                  <img src={s.icon || provider.icon} alt={provider.name} />
                ) : (
                  <span>{s.name.slice(0, 1).toUpperCase()}</span>
                )}
              </div>
              <div className="service-info">
                <b>
                  {s.name}
                  {s.scope === "universal" && (
                    <small className="universal-tag">
                      {t("New API · 统一")}
                    </small>
                  )}
                </b>
                <span className="service-url" title={s.base_url}>
                  {s.base_url}
                </span>
                <small>
                  {s.model || t("未设置模型")} ·{" "}
                  {protocolNames[s.protocol] || s.protocol} ·{" "}
                  {data.saved_keys.includes(s.id)
                    ? t("已加密保存密钥")
                    : t("未持久保存密钥")}
                </small>
              </div>
              <div className="service-actions">
                <button
                  title={isActive ? t("使用中") : t("启用")}
                  aria-label={isActive ? t("使用中") : t("启用")}
                  className="primary activate-service"
                  disabled={busy || isActive}
                  onClick={() => void activate(s.id)}
                >
                  {isActive ? (
                    <span className="active-badge">{t("使用中")}</span>
                  ) : (
                    <ActionIcon name="activate" />
                  )}
                </button>
                <button
                  title={t("编辑")}
                  disabled={busy}
                  onClick={() =>
                    onEdit({
                      ...s,
                      tool: s.scope === "universal" ? s.tool : tool,
                    })
                  }
                >
                  <ActionIcon name="edit" />
                  <span className="sr-only">{t("编辑")}</span>
                </button>
                <button
                  title={t("复制")}
                  aria-label={t("复制")}
                  disabled={busy}
                  onClick={() =>
                    void command("duplicate_service", {
                      profileId: current.id,
                      serviceId: s.id,
                    })
                  }
                >
                  <ActionIcon name="copy" />
                </button>
                <button
                  title={t("测试")}
                  aria-label={t("测试")}
                  disabled={busy}
                  onClick={() =>
                    void run("api_test", {
                      tool,
                      service_id: s.id,
                      infer: false,
                    })
                  }
                >
                  <ActionIcon name="test" />
                </button>
                <button
                  className="danger-text"
                  title={t("删除")}
                  disabled={busy}
                  onClick={() =>
                    void remove(
                      "delete_service",
                      { profileId: current.id, serviceId: s.id },
                      `删除服务「${s.name}」及其本地密钥？`,
                    )
                  }
                >
                  <ActionIcon name="delete" />
                  <span className="sr-only">{t("删除")}</span>
                </button>
              </div>
            </article>
          );
        })}
      </ScrollList>
      {copyStatus && (
        <p className="provider-help" role="status">
          {t(copyStatus)}
        </p>
      )}
      <details className="panel sync-panel">
        <summary>
          {t("验证与同步 ·")}
          {selected.name}
        </summary>
        <div>
          <h2>
            {t("验证与同步 ·")}
            {selected.name}
          </h2>
          <p>
            {t("当前：")}
            {official ? officialName : active?.name || t("尚未选择服务")}
            {t("。保存和使用仅更新本地配置，同步后才写入板卡。")}
          </p>
        </div>
        <div className="buttons">
          {tool === "codex" && (
            <button disabled={busy} onClick={onAuthenticate}>
              {t("授权中心")}
            </button>
          )}
          <button
            disabled={
              busy ||
              (official && tool !== "codex" && tool !== "harness") ||
              (!official && !active)
            }
            onClick={() =>
              official && tool === "harness"
                ? void run("harness_account_sync")
                : void run("sync_api", { tool })
            }
          >
            {t("同步到板卡")}
          </button>
          <button
            disabled={
              busy || (official && tool !== "codex") || (!official && !active)
            }
            onClick={() =>
              void run(official ? "official_test" : "api_test", {
                tool,
                infer: false,
              })
            }
          >
            {t("连通性检查")}
          </button>
          <button
            disabled={
              busy || (official && tool !== "codex") || (!official && !active)
            }
            onClick={() =>
              void run(official ? "official_test" : "api_test", {
                tool,
                infer: true,
              })
            }
          >
            {t("推理验证（消耗额度）")}
          </button>
          <button
            className="primary"
            disabled={busy || (!official && !active)}
            onClick={() => void run(tool)}
          >
            {t("打开 ")}
            {selected.name}
          </button>
        </div>
        {currentTask && (
          <p className="last-result">
            {t("最近任务：")}
            {t(currentTask.label)} · {t(currentTask.state)}{" "}
            {t(currentTask.message)}
          </p>
        )}
      </details>
    </section>
  );
}
