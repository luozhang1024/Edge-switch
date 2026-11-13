import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { ActionIcon } from "./ActionIcon";
import { t } from "./i18n";
export type NativeConfig = {
  detected: boolean;
  provider: string;
  name: string;
  model: string;
  endpoint: string | null;
};
export function NativeProviderRow({
  config,
  profileId,
  busy,
  changed,
}: {
  config: NativeConfig;
  profileId: string;
  busy: boolean;
  changed: () => void;
}) {
  const [draft, setDraft] = useState<NativeConfig | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  async function action(action: string, payload: object = {}) {
    setPending(true);
    setMessage("");
    try {
      const result = await invoke<{ message: string }>(
        "native_provider_action",
        {
          profileId,
          action,
          payload: { provider: config.provider, ...payload },
        },
      );
      setMessage(result.message);
      changed();
      if (action === "save") setDraft(null);
    } catch (e) {
      setMessage(String(e));
    } finally {
      setPending(false);
    }
  }
  if (!config.endpoint) return null;
  return (
    <section
      className="native-provider"
      role="region"
      aria-label={t("本机 Codex 配置")}
    >
      <article className="service-card">
        <div className="provider-avatar">C</div>
        <div className="service-info">
          <b>
            {config.name}{" "}
            <small className="active-badge">{t("本机当前配置")}</small>
          </b>
          <span>{config.endpoint}</span>
          <small>{config.model}</small>
        </div>
        <div className="service-actions">
          <button
            title={t("编辑本机供应商")}
            aria-label={t("编辑本机供应商")}
            disabled={busy || pending}
            onClick={() => setDraft({ ...config })}
          >
            <ActionIcon name="edit" />
          </button>
          <button
            title={t("复制本机供应商")}
            aria-label={t("复制本机供应商")}
            disabled={busy || pending}
            onClick={() => void action("duplicate")}
          >
            <ActionIcon name="copy" />
          </button>
          <button
            title={t("测试本机供应商")}
            aria-label={t("测试本机供应商")}
            disabled={busy || pending}
            onClick={() => void action("test")}
          >
            <ActionIcon name="test" />
          </button>
          <button
            title={t("删除本机供应商")}
            aria-label={t("删除本机供应商")}
            disabled={busy || pending}
            onClick={async () => {
              if (
                await confirm(
                  t(
                    "删除当前本机供应商配置？会备份原配置，账号凭据与会话保留。",
                  ),
                )
              )
                await action("delete");
            }}
          >
            <ActionIcon name="delete" />
          </button>
        </div>
      </article>
      {message && <p role="status">{message}</p>}
      {draft && (
        <form
          className="panel native-provider-editor"
          aria-label={t("编辑本机供应商")}
          onSubmit={(e) => {
            e.preventDefault();
            void action("save", draft);
          }}
        >
          <div className="form">
            {(["name", "model", "endpoint"] as const).map((key, index) => (
              <label key={key}>
                {t(["名称", "模型 ID", "API 地址"][index])}
                <input
                  required
                  value={draft[key] || ""}
                  onChange={(e) =>
                    setDraft({ ...draft, [key]: e.target.value })
                  }
                />
              </label>
            ))}
          </div>
          <p>{t("保留原有密钥与其他配置，保存前备份原文件。")}</p>
          <div className="buttons">
            <button
              type="button"
              disabled={pending}
              onClick={() => setDraft(null)}
            >
              {t("取消")}
            </button>
            <button className="primary" disabled={pending}>
              {t("保存")}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
