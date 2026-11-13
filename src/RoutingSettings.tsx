import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t } from "./i18n";
import { Profile, Service } from "./types";
import "./routing.css";

const routeTools = [
  ["claude", "Claude Code"],
  ["codex", "Codex"],
  ["gemini", "Gemini CLI"],
  ["grok", "Grok Build"],
] as const;
type Tool = (typeof routeTools)[number][0];
type Policy = {
  queue: string[];
  retries: number;
  failure_threshold: number;
  first_timeout: number;
  idle_timeout: number;
  request_timeout: number;
  recovery_successes: number;
  recovery_wait: number;
  error_percent: number;
  min_requests: number;
};
type Rectifier = {
  enabled: boolean;
  signature: boolean;
  budget: boolean;
  image: boolean;
  heuristic: boolean;
  optimizer: boolean;
  thinking: boolean;
  cache: boolean;
};
type Config = {
  host: string;
  port: number;
  connect_host: string;
  record_usage: boolean;
  tools: Record<Tool, Policy>;
  rectifier: Rectifier;
};
type Status = {
  config: Config;
  running: boolean;
  usage: { requests: number; bytes: number; failures: number } | null;
};
const defaults = (): Policy => ({
  queue: [],
  retries: 3,
  failure_threshold: 4,
  first_timeout: 60,
  idle_timeout: 120,
  request_timeout: 600,
  recovery_successes: 2,
  recovery_wait: 60,
  error_percent: 60,
  min_requests: 10,
});
const fields: [
  string,
  [keyof Omit<Policy, "queue">, string, number, number, string][],
][] = [
  [
    "重试与超时设置",
    [
      ["retries", "最大重试次数", 0, 10, "请求失败时的重试次数（0–10）"],
      [
        "failure_threshold",
        "失败阈值",
        1,
        100,
        "连续失败多少次后打开熔断器（建议 3–10）",
      ],
    ],
  ],
  [
    "超时配置",
    [
      [
        "first_timeout",
        "流式首字节超时",
        1,
        120,
        "等待首个数据块的最长时间（秒），默认 60",
      ],
      [
        "idle_timeout",
        "流式静默超时",
        0,
        600,
        "数据块之间的最大间隔（秒），60–600，0 为禁用",
      ],
      [
        "request_timeout",
        "非流式超时",
        60,
        1200,
        "非流式请求总超时（秒），60–1200",
      ],
    ],
  ],
  [
    "熔断器设置",
    [
      [
        "recovery_successes",
        "恢复成功阈值",
        1,
        100,
        "半开状态下成功多少次后关闭熔断器",
      ],
      [
        "recovery_wait",
        "恢复等待时间（秒）",
        1,
        3600,
        "熔断后等待多久尝试恢复（建议 30–120）",
      ],
      [
        "error_percent",
        "错误率阈值（%）",
        1,
        100,
        "错误率超过此值时打开熔断器",
      ],
      ["min_requests", "最小请求数", 1, 10000, "计算错误率前的最小请求数"],
    ],
  ],
];
export function RoutingSettings({
  current,
  services,
  busy,
}: {
  current: Profile;
  services: Service[];
  busy: boolean;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [draft, setDraft] = useState<Config | null>(null);
  const [tool, setTool] = useState<Tool>("codex");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    setStatus(null);
    setDraft(null);
    setError("");
    setNotice("");
    void invoke<Status>("routing_status", { profileId: current.id })
      .then((s) => {
        if (active) {
          setStatus(s);
          setDraft(s.config);
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [current.id]);
  const disabled = busy || pending;
  async function act(action: () => Promise<unknown>, message: string) {
    setPending(true);
    setError("");
    setNotice("");
    try {
      await action();
      setStatus(
        await invoke<Status>("routing_status", { profileId: current.id }),
      );
      setNotice(message);
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  }
  if (!draft || !status)
    return (
      <section className="settings-field">
        {error ? (
          <p role="alert" className="form-error">
            {error}
          </p>
        ) : (
          <p>{t("正在加载路由设置…")}</p>
        )}
      </section>
    );
  const c = draft;
  const p = c.tools[tool];
  function policy(next: Partial<Policy>) {
    setDraft({ ...c, tools: { ...c.tools, [tool]: { ...p, ...next } } });
  }
  const saved = JSON.stringify(c) === JSON.stringify(status.config);
  const compatible = services.filter(
    (s) => s.scope === "universal" || (s.tool || "codex") === tool,
  );
  function toggle(
    key: keyof Rectifier,
    title: string,
    description: string,
    locked = false,
  ) {
    return (
      <Switch
        title={title}
        description={description}
        checked={c.rectifier[key]}
        disabled={disabled || locked}
        onChange={(value) =>
          setDraft({ ...c, rectifier: { ...c.rectifier, [key]: value } })
        }
      />
    );
  }
  const save = () =>
    act(
      () => invoke("save_routing", { profileId: current.id, config: c }),
      "路由配置已保存",
    );
  return (
    <div className="model-routing">
      <section className="settings-field">
        <h3>{t("服务")}</h3>
        <div className="routing-card">
          <div className="routing-service-row">
            <div>
              <b>{t("模型路由服务")}</b>
              <small>{t(status.running ? "运行中" : "已停止")}</small>
            </div>
            <button
              disabled={disabled || (!status.running && !saved)}
              onClick={() =>
                void act(
                  () =>
                    invoke("routing_service", {
                      profileId: current.id,
                      start: !status.running,
                    }),
                  status.running ? "路由服务已停止" : "路由服务已启动",
                )
              }
            >
              {t(status.running ? "停止" : "启动")}
            </button>
          </div>
          <div className="routing-inputs">
            <label>
              {t("监听地址")}
              <input
                aria-label={t("监听地址")}
                value={c.host}
                disabled={disabled || status.running}
                onChange={(e) => setDraft({ ...c, host: e.target.value })}
              />
              <small>{t("推荐 127.0.0.1；修改前先停止服务")}</small>
            </label>
            <label>
              {t("监听端口")}
              <input
                type="number"
                min={1024}
                max={65535}
                value={c.port}
                disabled={disabled || status.running}
                onChange={(e) =>
                  setDraft({ ...c, port: Number(e.target.value) })
                }
              />
              <small>1024–65535</small>
            </label>
            <label>
              {t("连接地址")}
              <input
                placeholder="127.0.0.1"
                value={c.connect_host}
                disabled={disabled}
                onChange={(e) =>
                  setDraft({ ...c, connect_host: e.target.value })
                }
              />
              <small>{t("留空使用本机回环地址；板卡始终经 SSH 接入")}</small>
            </label>
          </div>
          <Switch
            title="记录请求用量"
            description="记录本次运行的请求数、传输字节与失败数，不保存请求内容或密钥。"
            checked={c.record_usage}
            disabled={disabled}
            onChange={(v) => setDraft({ ...c, record_usage: v })}
          />
          {status.usage && (
            <p className="settings-note">
              {t("请求数")} {status.usage.requests} · {t("传输字节")}{" "}
              {status.usage.bytes} · {t("失败数")} {status.usage.failures}
            </p>
          )}
        </div>
      </section>
      <section className="settings-field">
        <h3>{t("自动故障转移")}</h3>
        <div className="routing-card">
          <div
            className="setting-segments"
            role="group"
            aria-label={t("路由工具")}
          >
            {routeTools.map(([id, name]) => (
              <button
                key={id}
                aria-pressed={tool === id}
                disabled={pending}
                onClick={() => setTool(id)}
              >
                {name}
              </button>
            ))}
          </div>
          <p className="routing-info">
            {t(
              "请求失败时按队列优先级尝试供应商。连续失败或错误率达到阈值后，熔断器会暂时跳过该供应商，等待后自动尝试恢复。流式响应开始后不会重放请求。",
            )}
          </p>
          <div className="routing-group">
            <h4>{t("供应商优先队列")}</h4>
            <p className="settings-note">
              {t(
                "添加现有 API 供应商，首个供应商优先使用。每个供应商使用自己的模型与密钥。",
              )}
            </p>
            {p.queue.length === 0 && <p>{t("尚未添加供应商")}</p>}
            <ol className="routing-queue">
              {p.queue.map((id, index) => (
                <li key={id}>
                  <span>
                    {services.find((s) => s.id === id)?.name ||
                      t("供应商已删除")}
                  </span>
                  <button
                    aria-label={t("上移供应商")}
                    disabled={disabled || index === 0}
                    onClick={() => {
                      const q = [...p.queue];
                      [q[index - 1], q[index]] = [q[index], q[index - 1]];
                      policy({ queue: q });
                    }}
                  >
                    ↑
                  </button>
                  <button
                    aria-label={t("下移供应商")}
                    disabled={disabled || index === p.queue.length - 1}
                    onClick={() => {
                      const q = [...p.queue];
                      [q[index + 1], q[index]] = [q[index], q[index + 1]];
                      policy({ queue: q });
                    }}
                  >
                    ↓
                  </button>
                  <button
                    disabled={disabled}
                    onClick={() =>
                      policy({ queue: p.queue.filter((s) => s !== id) })
                    }
                  >
                    {t("移除")}
                  </button>
                </li>
              ))}
            </ol>
            <select
              aria-label={t("添加路由供应商")}
              value=""
              disabled={disabled}
              onChange={(e) => policy({ queue: [...p.queue, e.target.value] })}
            >
              <option value="">{t("添加供应商…")}</option>
              {compatible
                .filter((s) => !p.queue.includes(s.id))
                .map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </div>
          {fields.map(([title, items]) => (
            <div className="routing-group" key={title}>
              <h4>{t(title)}</h4>
              <div className="routing-inputs">
                {items.map(([key, name, min, max, hint]) => (
                  <label key={key}>
                    {t(name)}
                    <input
                      type="number"
                      aria-label={t(name)}
                      value={p[key]}
                      min={min}
                      max={max}
                      disabled={disabled}
                      onChange={(e) =>
                        policy({ [key]: Number(e.target.value) })
                      }
                    />
                    <small>{t(hint)}</small>
                  </label>
                ))}
              </div>
            </div>
          ))}
          <div className="routing-actions">
            <button
              disabled={disabled || !saved || p.queue.length === 0}
              onClick={() =>
                void act(
                  () =>
                    invoke("routing_disconnect", {
                      profileId: current.id,
                      tool,
                    }),
                  "已恢复队首供应商直连，请重启工具会话",
                )
              }
            >
              {t("恢复供应商直连")}
            </button>
            <button
              disabled={disabled}
              onClick={() => policy({ ...defaults(), queue: p.queue })}
            >
              {t("重置当前工具参数")}
            </button>
            <button
              disabled={
                disabled || !saved || !status.running || p.queue.length === 0
              }
              onClick={() =>
                void act(
                  () =>
                    invoke("routing_connect", { profileId: current.id, tool }),
                  "工具已接入路由，请重启工具会话",
                )
              }
            >
              {t("接入当前工具")}
            </button>
          </div>
          <p className="settings-note">
            {t(
              "接入会备份并更新当前环境的工具配置。请保持 Edge Switch 和路由服务运行；恢复供应商直连会改用队首供应商，并取消当前工具的路由接入。",
            )}
          </p>
        </div>
      </section>
      <section className="settings-field">
        <h3>{t("整流器")}</h3>
        <div className="routing-card">
          {toggle(
            "enabled",
            "启用整流器",
            "在供应商返回明确兼容性错误时修复请求，同一供应商最多整流重试一次。",
          )}
          <h4>{t("请求整流")}</h4>
          {toggle(
            "signature",
            "Thinking 签名整流",
            "Anthropic 返回签名错误时移除不兼容的 Thinking 块并重试。",
            !c.rectifier.enabled,
          )}
          {toggle(
            "budget",
            "Thinking Budget 整流",
            "遇到 1024 预算约束错误时启用 Thinking，设置预算 32000，必要时将 max_tokens 调整为 64000。",
            !c.rectifier.enabled,
          )}
          {toggle(
            "image",
            "不支持图片降级",
            "供应商明确不支持图片时，将图片替换为 [Unsupported Image]。",
            !c.rectifier.enabled,
          )}
          {toggle(
            "heuristic",
            "纯文本模型预判",
            "发送前为已知纯文本模型移除图片；不会修改模型目录中的能力声明。",
            !c.rectifier.enabled || !c.rectifier.image,
          )}
          <hr />
          <h4>{t("Bedrock 请求优化器")}</h4>
          <p className="settings-note">
            {t(
              "仅适用于提供 Anthropic Messages 兼容接口的 Bedrock 网关，原生 AWS SigV4 接口尚不支持。",
            )}
          </p>
          {toggle(
            "optimizer",
            "启用优化器",
            "为地址包含 bedrock 的 Anthropic 兼容网关优化 Thinking 与缓存。",
          )}
          {toggle(
            "thinking",
            "Thinking 优化",
            "为支持的 Opus / Sonnet 模型补充 Thinking 配置，保留显式配置。",
            !c.rectifier.optimizer,
          )}
          {toggle(
            "cache",
            "Cache 注入",
            "在系统提示词末尾注入标准 5 分钟缓存标记。",
            !c.rectifier.optimizer,
          )}
        </div>
      </section>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{t(notice)}</p>}
      <div className="routing-save">
        <span>{t(saved ? "配置已保存" : "有未保存的更改")}</span>
        <button
          className="primary"
          disabled={disabled || saved}
          onClick={() => void save()}
        >
          {t(pending ? "正在处理…" : "保存路由设置")}
        </button>
      </div>
    </div>
  );
}
function Switch({
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
  onChange: (v: boolean) => void;
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
