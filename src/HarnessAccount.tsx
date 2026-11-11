import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t } from "./i18n";
import deepseekIcon from "../image/providers/deepseek-color.svg";

export type HarnessAccountStatus = {
  signed_in: boolean;
  expired?: boolean;
  name?: string | null;
  contact?: string | null;
  wallets?: { currency: string; balance: string }[];
  bonus_wallets?: { currency: string; balance: string }[];
  checked_at?: number;
  error?: string;
};

export function HarnessAccount({
  busy,
  active,
  refreshKey,
  run,
  onModels,
}: {
  busy: boolean;
  active: boolean;
  refreshKey: string;
  run: (action: string) => Promise<void>;
  onModels: () => void;
}) {
  const [account, setAccount] = useState<HarnessAccountStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  async function refresh() {
    const request = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const next = await invoke<HarnessAccountStatus>("local_harness_account");
      if (request === generation.current)
        setAccount(next ?? { signed_in: false });
    } catch (e) {
      if (request === generation.current) {
        setAccount(null);
        setError(String(e));
      }
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      ++generation.current;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshKey]);
  const ready = !!account?.signed_in && !account.expired && !loading && !error;
  return (
    <section className="authorization-card" aria-label="DeepSeek Harness">
      <header className="authorization-card-heading">
        <div className="authorization-brand">
          <img src={deepseekIcon} alt="" />
          <div>
            <h3>DeepSeek Harness</h3>
            <small>{t("本机账号 · Web 与 Desktop 共用")}</small>
          </div>
        </div>
        <div className="authorization-actions">
          <button disabled={loading} onClick={() => void refresh()}>
            {loading ? t("正在检测…") : t("刷新账号")}
          </button>
          <button disabled={busy} onClick={() => void run("harness_login")}>
            {t("添加账号")}
          </button>
        </div>
      </header>
      <div className="authorization-card-body">
        <div className="authorization-account-row">
          <div>
            <b>
              {account?.signed_in
                ? account.name || account.contact || t("已识别 DeepSeek 账号")
                : loading
                  ? t("正在识别本机 Harness 账号…")
                  : t("尚未登录 DeepSeek Harness 账号")}
            </b>
            {account?.signed_in && (
              <p>
                {account.contact} · {t("从本机 Harness 自动识别")}
              </p>
            )}
          </div>
          {account?.signed_in && (
            <span className={`auth-state ${account.expired ? "" : "ready"}`}>
              {t(account.expired ? "授权已失效" : "已识别本机授权")}
            </span>
          )}
        </div>
        {account?.signed_in && (
          <div className="harness-wallets" aria-label={t("DeepSeek 账号余额")}>
            {account.wallets?.map((wallet) => (
              <span key={wallet.currency}>
                {t("充值余额")}{" "}
                <b>
                  {wallet.balance} {wallet.currency}
                </b>
              </span>
            ))}
            {account.bonus_wallets?.map((wallet) => (
              <span key={wallet.currency}>
                {t("赠金余额")}{" "}
                <b>
                  {wallet.balance} {wallet.currency}
                </b>
              </span>
            ))}
            {account.checked_at && (
              <small>
                {t("上次检测：")}
                {new Date(account.checked_at * 1000).toLocaleString()}
              </small>
            )}
          </div>
        )}
        {(error || account?.error) && (
          <p className="form-error" role="alert">
            {error || account?.error}
          </p>
        )}
        <div className="buttons">
          <button
            className="primary"
            disabled={busy || !ready}
            onClick={() => void run("harness_account_sync")}
          >
            {t("同步账号到当前板卡并启用")}
          </button>
          <button disabled={busy} onClick={onModels}>
            {t("管理模型服务")}
          </button>
          {active && (
            <span className="auth-state ready">
              {t("当前板卡已选择账号通道")}
            </span>
          )}
        </div>
        <p className="settings-note">
          {t(
            "自动读取本机 DSH_HOME（默认 ~/.dsh）的账号授权。同步后在远程 Harness 中选择 DeepSeek 账号模型，使用对应账号额度；账号令牌不会作为普通 API Key 使用。切换前请先停止正在运行的 Harness。",
          )}
        </p>
      </div>
    </section>
  );
}
