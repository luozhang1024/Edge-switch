import React from "react";
import editIcon from "../image/编辑.png";
import deleteIcon from "../image/删除.png";
import activateIcon from "../image/启用.png";
import loginIcon from "../image/connect.png";
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
  command,
  run,
  remove,
}: Props) {
  const selected = tools.find((t) => t.id === tool)!;
  const activeId =
    tool === "codex" ? current.active_api : current.tool_services?.[tool];
  const official = tool === "codex" && current.codex_auth === "chatgpt";
  const services = (data.services[current.id] || []).filter(
    (s) => (s.tool || "codex") === tool,
  );
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
        <h2>
          {selected.name}
          <span>供应商</span>
        </h2>
        <div className="tool-switcher" role="tablist" aria-label="板卡 AI 工具">
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
          aria-label="添加服务"
          title="添加新供应商"
          disabled={busy}
          onClick={() => onEdit(serviceTemplate(tool, "custom"))}
        >
          <img src={addIcon} alt="" />
          <span className="sr-only">添加服务</span>
        </button>
      </div>
      <div className="service-list">
        {tool === "codex" && (
          <article className={`service-card ${official ? "selected" : ""}`}>
            <div className="provider-avatar">
              <img src={officialIcon} alt="OpenAI Official" />
            </div>
            <div className="service-info">
              <b>OpenAI Official</b>
              <span
                className="service-url"
                title="ChatGPT 官方账号 · 无需 API Key"
              >
                https://chatgpt.com/codex
              </span>
              <small>
                {data.official[current.id]?.name || "官方 ChatGPT 账号"} ·{" "}
                {data.official[current.id]?.has_credentials
                  ? "已保存导入凭据"
                  : "可在板卡终端登录"}
              </small>
              {data.official[current.id]?.note && (
                <small>{data.official[current.id]?.note}</small>
              )}
            </div>
            <div className="service-actions">
              {official && <span className="active-badge">当前使用</span>}
              <button
                title="使用官方账号"
                className="primary activate-service"
                disabled={busy || official}
                onClick={() => void activate("official")}
              >
                <img src={activateIcon} alt="" />
                使用官方账号
              </button>
              <button
                title="编辑 / 导入 auth.json"
                disabled={busy}
                onClick={() =>
                  onOfficial({
                    name: "OpenAI Official",
                    ...data.official[current.id],
                  })
                }
              >
                <img src={editIcon} alt="" />
                编辑 / 导入 auth.json
              </button>
              <button
                title="设备码登录"
                disabled={busy || !official}
                onClick={() => void run("login")}
              >
                <img src={loginIcon} alt="" />
                设备码登录
              </button>
              <button
                className="danger-text"
                title="删除本机账号信息"
                disabled={busy || !data.official[current.id]}
                onClick={() =>
                  void remove(
                    "delete_official",
                    { profileId: current.id },
                    "删除本机保存的官方账号信息和导入凭据？板卡上已有登录状态保留。",
                  )
                }
              >
                <img src={deleteIcon} alt="" />
                删除本机账号信息
              </button>
            </div>
          </article>
        )}
        {services.map((s) => {
          const provider = detectProvider(s);
          const selected = !official && activeId === s.id;
          return (
            <article
              key={s.id}
              className={`service-card ${selected ? "selected" : ""}`}
            >
              <div className="provider-avatar">
                {provider.icon ? (
                  <img src={provider.icon} alt={provider.name} />
                ) : (
                  <span>{s.name.slice(0, 1).toUpperCase()}</span>
                )}
              </div>
              <div className="service-info">
                <b>{s.name}</b>
                <span className="service-url" title={s.base_url}>
                  {s.base_url}
                </span>
                <small>
                  {s.model || "未设置模型"} ·{" "}
                  {protocolNames[s.protocol] || s.protocol} ·{" "}
                  {data.saved_keys.includes(s.id)
                    ? "已加密保存密钥"
                    : "未持久保存密钥"}
                </small>
              </div>
              <div className="service-actions">
                {selected && <span className="active-badge">当前使用</span>}
                <button
                  title="使用"
                  className="primary activate-service"
                  disabled={busy || selected}
                  onClick={() => void activate(s.id)}
                >
                  <img src={activateIcon} alt="" />
                  使用
                </button>
                <button
                  title="编辑"
                  disabled={busy}
                  onClick={() => onEdit({ ...s, tool })}
                >
                  <img src={editIcon} alt="" />
                  编辑
                </button>
                <button
                  className="danger-text"
                  title="删除"
                  disabled={busy}
                  onClick={() =>
                    void remove(
                      "delete_service",
                      { profileId: current.id, serviceId: s.id },
                      `删除服务「${s.name}」及其本地密钥？`,
                    )
                  }
                >
                  <img src={deleteIcon} alt="" />
                  删除
                </button>
              </div>
            </article>
          );
        })}
        {!services.length && tool !== "codex" && (
          <div className="provider-empty">
            <img src={selected.icon} alt="" />
            <h3>为 {selected.name} 添加第一个模型服务</h3>
            <p>选择供应商，填写 API 地址、模型 ID 和密钥，然后同步到板卡。</p>
            <button
              onClick={() => onEdit(serviceTemplate(tool, "custom"))}
              disabled={busy}
            >
              添加自定义 API
            </button>
          </div>
        )}
      </div>
      <details className="panel sync-panel">
        <summary>验证与同步 · {selected.name}</summary>
        <div>
          <h2>验证与同步 · {selected.name}</h2>
          <p>
            当前：
            {official ? "OpenAI Official" : active?.name || "尚未选择服务"}
            。保存和使用仅更新本地配置，同步后才写入板卡。
          </p>
        </div>
        <div className="buttons">
          <button
            disabled={busy || (!official && !active)}
            onClick={() => void run("sync_api", { tool })}
          >
            同步到板卡
          </button>
          <button
            disabled={busy || (!official && !active)}
            onClick={() =>
              void run(official ? "official_test" : "api_test", {
                tool,
                infer: false,
              })
            }
          >
            连通性检查
          </button>
          <button
            disabled={busy || (!official && !active)}
            onClick={() =>
              void run(official ? "official_test" : "api_test", {
                tool,
                infer: true,
              })
            }
          >
            推理验证（消耗额度）
          </button>
          <button
            className="primary"
            disabled={busy || (!official && !active)}
            onClick={() => void run(tool)}
          >
            打开 {selected.name}
          </button>
        </div>
        {currentTask && (
          <p className="last-result">
            最近任务：{currentTask.label} · {currentTask.state}{" "}
            {currentTask.message}
          </p>
        )}
      </details>
    </section>
  );
}
