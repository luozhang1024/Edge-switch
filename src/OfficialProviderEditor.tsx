import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Official } from "./types";
import { ProviderPage } from "./ProviderPage";
import { t } from "./i18n";

type Draft = {
  name: string;
  note: string;
  website: string;
  login_method: string;
  config_text: string;
  revision: string;
  active: boolean;
  path: string;
};
export function OfficialProviderEditor({
  profileId,
  initial,
  close,
  saved,
}: {
  profileId: string;
  initial: Official;
  close: () => void;
  saved: () => void;
}) {
  const tool = initial.tool || "codex";
  const [draft, setDraft] = useState<Draft>({
    name:
      initial.name ||
      (tool === "codex" ? "OpenAI Official" : "Claude Official"),
    note: initial.note || "",
    website:
      tool === "codex"
        ? "https://chatgpt.com/codex"
        : "https://www.anthropic.com/claude-code",
    login_method: "follow",
    config_text: tool === "codex" ? "" : "{}",
    revision: "",
    active: false,
    path: "",
  });
  const [auth, setAuth] = useState("");
  const [path, setPath] = useState("");
  const [threads, setThreads] = useState("");
  const [icon, setIcon] = useState(initial.icon || "");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void invoke<Partial<Draft>>("official_provider", {
      profileId,
      tool,
      action: "get",
      payload: {},
    })
      .then((value) => {
        if (live) setDraft((old) => ({ ...old, ...value }));
      })
      .catch((e) => {
        if (live) setError(String(e));
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [profileId, tool]);
  async function format() {
    try {
      const value = await invoke<{ config_text: string }>("official_provider", {
        profileId,
        tool,
        action: "format",
        payload: { config_text: draft.config_text },
      });
      setDraft({ ...draft, config_text: value.config_text });
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <ProviderPage
      tool={tool}
      official
      editing
      icon={icon}
      onIcon={setIcon}
      onSelect={() => {}}
      close={close}
    >
      <form
        className="official-provider-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await invoke("official_provider", {
              profileId,
              tool,
              action: "save",
              payload: {
                ...draft,
                icon,
                auth_json: auth,
                auth_path: path || null,
                max_threads: threads ? Number(threads) : null,
              },
            });
            saved();
          } catch (e) {
            setError(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="provider-help">
          {draft.active
            ? t("这是正在使用的供应商。保存后立即写入工具配置，下次请求生效。")
            : t("保存后，启用官方供应商并启动或同步时写入工具配置。")}
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="form">
          <label>
            {t("名称")}
            <input
              aria-label={t("账号名称")}
              required
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            {t("备注")}
            <input
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
          </label>
        </div>
        <label>
          {t("官网链接")}
          <input
            type="url"
            value={draft.website}
            onChange={(e) => setDraft({ ...draft, website: e.target.value })}
          />
        </label>
        <label>
          {t("登录方式")}
          <select
            value={draft.login_method}
            onChange={(e) =>
              setDraft({ ...draft, login_method: e.target.value })
            }
          >
            <option value="follow">
              {t(
                tool === "codex" ? "跟随 Codex 登录" : "跟随 Claude Code 登录",
              )}
            </option>
            {tool === "codex" && (
              <option value="import">{t("导入官方 OAuth 凭据")}</option>
            )}
          </select>
        </label>
        <p className="provider-help">
          {t(
            "跟随当前工具的官方账号；登录请前往授权中心。配置和账号均属于当前工作环境。",
          )}
        </p>
        {tool === "codex" && (
          <>
            <label>
              {t("子代理并发上限")}
              <input
                type="number"
                min={1}
                max={128}
                placeholder={t("留空使用配置中的值")}
                value={threads}
                onChange={(e) => setThreads(e.target.value)}
              />
            </label>
            <label>
              auth.json (JSON)
              <textarea
                aria-label="auth.json (JSON)"
                rows={5}
                value={auth}
                placeholder={t("留空保留当前登录；可粘贴官方 OAuth auth.json")}
                onChange={(e) => setAuth(e.target.value)}
              />
            </label>
            <button
              type="button"
              onClick={async () => {
                try {
                  const selected = await open({
                    multiple: false,
                    filters: [{ name: "JSON", extensions: ["json"] }],
                  });
                  if (typeof selected === "string") setPath(selected);
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              {t("选择 auth.json")}
            </button>
            <p className="provider-help">
              {path || t("未选择文件，保留已有凭据")}
            </p>
          </>
        )}
        <label>
          {tool === "codex" ? "config.toml (TOML)" : t("配置 JSON")}
          <textarea
            aria-label={
              tool === "codex" ? "config.toml (TOML)" : "settings.json (JSON)"
            }
            rows={14}
            spellCheck={false}
            value={draft.config_text}
            onChange={(e) =>
              setDraft({ ...draft, config_text: e.target.value })
            }
          />
        </label>
        <p className="provider-help">
          {t(
            "MCP、权限和其他全局设置会保留；官方登录不使用 API 供应商的地址与密钥。",
          )}
        </p>
        <button type="button" disabled={busy} onClick={() => void format()}>
          {t("格式化")}
        </button>
        <div className="actions">
          <button type="button" onClick={close}>
            {t("取消")}
          </button>
          <button className="primary" disabled={busy}>
            {t("保存账号")}
          </button>
        </div>
      </form>
    </ProviderPage>
  );
}
