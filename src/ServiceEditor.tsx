import { t } from "./i18n";
import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Service } from "./types";
import { ActionIcon } from "./ActionIcon";
import { configPreview } from "./providerConfig";

export function ServiceEditor({
  service,
  original,
  profileId,
  saved,
  busy,
  onChange,
  onSave,
  close,
}: {
  service: Service;
  original?: Service;
  profileId: string;
  saved: boolean;
  busy: boolean;
  onChange: (entry: Service) => void;
  onSave: (key: string | null, remember: boolean) => Promise<boolean>;
  close: () => void;
}) {
  const [key, setKey] = useState("");
  const [visible, setVisible] = useState(false);
  const [remember, setRemember] = useState(saved);
  const [loadingKey, setLoadingKey] = useState(!!original);
  const [error, setError] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const revision = useRef(0);
  const queryRevision = useRef(0);
  const previous = useRef({
    url: service.base_url,
    preset: service.preset,
    scope: service.scope,
  });
  useEffect(() => {
    let cancelled = false;
    const before = revision.current;
    if (!original) {
      setLoadingKey(false);
      return;
    }
    invoke<string>("get_service_key", { profileId, serviceId: original.id })
      .then((value) => {
        if (!cancelled && revision.current === before) setKey(value || "");
      })
      .catch(() => {
        if (!cancelled)
          setError("读取已有密钥失败，可重新填写；留空仍保留已有值。");
      })
      .finally(() => {
        if (!cancelled) setLoadingKey(false);
      });
    return () => {
      cancelled = true;
      queryRevision.current++;
    };
  }, [profileId, service.id]);
  useEffect(() => {
    const before = previous.current;
    if (
      before.url !== service.base_url ||
      before.preset !== service.preset ||
      before.scope !== service.scope
    ) {
      revision.current++;
      queryRevision.current++;
      setKey("");
      setVisible(false);
      setModels([]);
      setFetching(false);
      setError("");
    }
    previous.current = {
      url: service.base_url,
      preset: service.preset,
      scope: service.scope,
    };
  }, [service.base_url, service.preset, service.scope]);
  async function fetchModels() {
    const request = ++queryRevision.current;
    setFetching(true);
    setError("");
    setModels([]);
    try {
      const list = await invoke<string[]>("fetch_models", {
        profileId,
        serviceId: original?.id || null,
        baseUrl: service.base_url,
        protocol: service.scope === "universal" ? "chat" : service.protocol,
        key: key || null,
      });
      if (queryRevision.current === request) setModels(list);
    } catch (e) {
      if (queryRevision.current === request) setError(String(e));
    } finally {
      if (queryRevision.current === request) setFetching(false);
    }
  }
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onSave(key || null, remember)) close();
        else
          setError(
            "保存未完成，请确认 API 请求地址为 HTTPS；更换地址后需填写对应密钥。",
          );
      }}
    >
      <div className="form">
        <label>
          {t("服务名称")}
          <input
            required
            value={service.name}
            placeholder={t("例如：公司专用 API")}
            onChange={(e) => onChange({ ...service, name: e.target.value })}
          />
        </label>
        <label>
          {t("API请求地址")}
          <input
            required
            type="url"
            value={service.base_url}
            placeholder="https://example.com/v1"
            onChange={(e) => onChange({ ...service, base_url: e.target.value })}
          />
        </label>
        <div className="wide model-field">
          <div className="field-heading">
            <label htmlFor="model-name">{t("模型名称")}</label>
            <button
              type="button"
              className="text-button"
              disabled={fetching || loadingKey || !service.base_url}
              onClick={() => void fetchModels()}
            >
              {fetching ? t("正在获取…") : t("获取模型列表")}
            </button>
          </div>
          <input
            id="model-name"
            required
            value={service.model}
            placeholder={t("填写或选择供应商提供的模型名称")}
            onChange={(e) => onChange({ ...service, model: e.target.value })}
          />
          {models.length > 0 && (
            <select
              aria-label={t("选择模型")}
              value={models.includes(service.model) ? service.model : ""}
              onChange={(e) => onChange({ ...service, model: e.target.value })}
            >
              <option value="" disabled>
                {t("选择模型（")}
                {models.length}
                {t(" 个）")}
              </option>
              {models.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          )}
        </div>
        <div className="wide">
          <label htmlFor="api-key">API Key</label>
          <div className="secret-field">
            <input
              id="api-key"
              type={visible ? "text" : "password"}
              autoComplete="off"
              value={key}
              disabled={loadingKey}
              placeholder={
                loadingKey ? t("正在读取已保存密钥…") : t("填写 API Key")
              }
              onChange={(e) => {
                revision.current++;
                queryRevision.current++;
                setModels([]);
                setFetching(false);
                setKey(e.target.value);
              }}
            />
            <button
              type="button"
              title={visible ? t("隐藏 API Key") : t("显示 API Key")}
              aria-label={visible ? t("隐藏 API Key") : t("显示 API Key")}
              onClick={() => setVisible(!visible)}
            >
              <ActionIcon name={visible ? "hidden" : "eye"} />
            </button>
          </div>
          <small className="provider-help">
            {original
              ? t(
                  "已保存的密钥在此处遮罩显示；留空保留原密钥，更换请求地址需填写对应密钥。",
                )
              : t("默认遮罩显示，点击眼睛查看明文。")}
          </small>
        </div>
        <label className="check wide">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          {t("使用 Windows DPAPI 加密保存")}
        </label>
        {error && (
          <p className="wide form-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <section className="config-previews" aria-label={t("生成配置预览")}>
        <p className="provider-help">
          {t("以下配置由表单自动生成；同步到远程设备后生效。")}
        </p>
        {configPreview(service, visible ? key : key ? "••••••••" : "").map(
          (config) => (
            <label key={config.name}>
              {config.name}
              <textarea
                readOnly
                spellCheck={false}
                aria-label={config.name}
                value={config.text}
                rows={config.name.startsWith("config.toml") ? 11 : 4}
              />
            </label>
          ),
        )}
      </section>
      <div className="actions">
        <button type="button" onClick={close}>
          {t("取消")}
        </button>
        <button disabled={busy || loadingKey} className="primary">
          {t("保存服务")}
        </button>
      </div>
    </form>
  );
}
