import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t } from "./i18n";
export function NetworkSettings() {
  const [endpoint, setEndpoint] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState<string | null>(null);
  const [hasPassword, setHasPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let live = true;
    void invoke<{ endpoint: string; username: string; has_password: boolean }>(
      "network_settings",
      { action: "get", payload: {} },
    )
      .then((v) => {
        if (live && v) {
          setEndpoint(v.endpoint);
          setUsername(v.username);
          setHasPassword(v.has_password);
        }
      })
      .catch((e) => {
        if (live) setMessage(String(e));
      });
    return () => {
      live = false;
    };
  }, []);
  async function run(action: string) {
    setBusy(true);
    setMessage("");
    try {
      const result = await invoke<{ message: string; has_password?: boolean }>(
        "network_settings",
        { action, payload: { endpoint, username, password } },
      );
      setMessage(result.message);
      if (action === "save") {
        setPassword(null);
        setHasPassword(!!result.has_password);
      }
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="network-settings">
      <h2>{t("网络")}</h2>
      <h3>{t("全局出站代理")}</h3>
      <p>
        {t(
          "所有工作环境共用电脑 FlClash 的 HTTP / Mixed 端口；应用的 API、授权、Skills 和下载请求使用此代理，远程工具通过 SSH 隧道访问。",
        )}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run("save");
        }}
      >
        <label>
          {t("代理地址")}
          <input
            placeholder="http://127.0.0.1:7890"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
          />
        </label>
        <div className="form">
          <label>
            {t("用户名（可选）")}
            <input
              autoComplete="off"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label>
            {t("密码（可选）")}
            <input
              type="password"
              autoComplete="new-password"
              placeholder={hasPassword ? t("已保存，留空保留") : ""}
              value={password || ""}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        </div>
        <div className="buttons">
          <button
            type="button"
            disabled={busy}
            onClick={() => void run("test")}
          >
            {t("测试网络")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setEndpoint("");
              setUsername("");
              setPassword("");
            }}
          >
            {t("清空")}
          </button>
          <button className="primary" disabled={busy}>
            {t("保存")}
          </button>
        </div>
      </form>
      <p className="settings-note">
        {t(
          "FlClash 无需开启“允许局域网”；SSH 隧道只在回环地址监听。留空恢复各环境原有线路设置。已启动的终端需关闭后重新打开。",
        )}
      </p>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
