import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { t } from "./i18n";
export function AccountMenu({
  profileId,
  tool,
  disabled,
  onDone,
}: {
  profileId: string;
  tool: string;
  disabled: boolean;
  onDone: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="account-menu">
      <details>
        <summary aria-label={t("账号操作")} title={t("账号操作")}>
          ⋯
        </summary>
        <button
          disabled={disabled || pending}
          className="danger-text"
          onClick={async () => {
            if (
              !(await confirm(
                t(
                  tool === "harness"
                    ? "退出本机 DeepSeek Harness 账号？其他配置和已经同步到板卡的账号保留。"
                    : "退出当前环境的 ChatGPT 账号？API 密钥和会话记录保留。",
                ),
              ))
            )
              return;
            setPending(true);
            setError("");
            try {
              await invoke("logout_account", { profileId, tool });
              onDone();
            } catch (e) {
              setError(String(e));
            } finally {
              setPending(false);
            }
          }}
        >
          {t("退出当前账号")}
        </button>
      </details>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
export function LoginProgress({
  profileId,
  taskId,
  cancel,
}: {
  profileId: string;
  taskId: string;
  cancel: () => void;
}) {
  const [link, setLink] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    let live = true;
    const read = () =>
      void invoke<{ url: string | null }>("account_login_link", {
        profileId,
        reopen: false,
      })
        .then((v) => {
          if (live) setLink(v?.url || "");
        })
        .catch(() => {});
    read();
    const timer = setInterval(read, 1000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [profileId, taskId]);
  return (
    <div className="login-progress" role="status">
      <b>{t("等待浏览器授权…")}</b>
      <p>{t("请在官方登录页面完成授权，完成后这里会自动刷新。")}</p>
      <div className="buttons">
        <button onClick={cancel}>{t("取消授权")}</button>
        <button
          disabled={!link}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setMessage(t("已复制登录链接"));
            } catch (e) {
              setMessage(String(e));
            }
          }}
        >
          {t("复制登录链接")}
        </button>
        <button
          disabled={!link}
          onClick={() =>
            void invoke("account_login_link", {
              profileId,
              reopen: true,
            }).catch((e) => setMessage(String(e)))
          }
        >
          {t("重新打开登录页")}
        </button>
      </div>
      {message && <small>{message}</small>}
    </div>
  );
}
