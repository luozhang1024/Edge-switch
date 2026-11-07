import { t } from "./i18n";
import React, { useState } from "react";
import { ActionIcon } from "./ActionIcon";
import { ScrollList } from "./ScrollList";
import { ordered, moveItem } from "./listOrder";
import { defaultProtocol } from "./providerConfig";
import officialIcon from "../image/providers/openai-official.svg";
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
  const selected = tools.find((t) => t.id === tool)!;
  const activeId =
    tool === "codex" ? current.active_api : current.tool_services?.[tool];
  const official =
    tool === "codex"
      ? current.codex_auth === "chatgpt"
      : tool !== "harness" && (!activeId || activeId === "official");
  const officialReady = !!(
    data.official[current.id]?.has_credentials ||
    data.official[current.id]?.remote_authenticated
  );
  const services = (data.services[current.id] || []).filter(
    (s) => s.scope === "universal" || (s.tool || "codex") === tool,
  );
  const officialName = {
    codex: "OpenAI Official",
    claude: "Claude Official",
    gemini: "Gemini Official",
    opencode: "OpenCode Zen",
    harness: "DeepSeek API",
  }[tool];
  const rows = ordered(
    [
      ...(tool !== "harness"
        ? [{ id: "official" } as Service]
        : services.length
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
  return (
    <section className="model-workspace">
      <div className="model-toolbar">
        <h2>{selected.name}</h2>
        <div
          className="tool-switcher"
          role="tablist"
          aria-label={t("板卡 AI 工具")}
        >
          {tools.map((t) => (
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
          disabled={busy}
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
                  <b>OpenAI Official</b>
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
                        : t("请先在设置中认证")}
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
                      title={t("前往设置认证")}
                      aria-label={t("前往设置认证")}
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
                  <button
                    title={official ? t("使用中") : t("启用官方账号")}
                    aria-label={official ? t("使用中") : t("启用官方账号")}
                    disabled={busy || official}
                    onClick={() => void activate("official")}
                  >
                    {official ? (
                      <span className="active-badge">{t("使用中")}</span>
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
              {t("账号认证设置")}
            </button>
          )}
          <button
            disabled={
              busy || (official && tool !== "codex") || (!official && !active)
            }
            onClick={() => void run("sync_api", { tool })}
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
