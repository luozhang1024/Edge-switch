import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t } from "./i18n";

type Rate = {
  provider: string;
  model: string;
  input: number;
  output: number;
  cached: number;
  write: number;
};
type Config = { rates: Rate[]; custom: Rate[] };
export function UsagePricing({
  profileId,
  providers,
  models,
  onSaved,
}: {
  profileId: string;
  providers: string[];
  models: string[];
  onSaved: () => void;
}) {
  const [config, setConfig] = useState<Config | null>(null);
  const [rate, setRate] = useState<Rate>({
    provider: "*",
    model: "",
    input: 0,
    output: 0,
    cached: 0,
    write: 0,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let live = true;
    setConfig(null);
    void invoke<Config>("usage_pricing", {
      profileId,
      rate: null,
      remove: false,
    })
      .then((value) => {
        if (live) setConfig(value);
      })
      .catch((e) => {
        if (live) setMessage(String(e));
      });
    return () => {
      live = false;
    };
  }, [profileId]);
  function select(provider: string, model: string) {
    const found =
      config?.rates.find((r) => r.provider === provider && r.model === model) ||
      config?.rates.find((r) => r.provider === "*" && r.model === model);
    setRate(
      found
        ? { ...found, provider, model }
        : { provider, model, input: 0, output: 0, cached: 0, write: 0 },
    );
    setMessage("");
  }
  async function save(remove: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const value = await invoke<Config>("usage_pricing", {
        profileId,
        rate,
        remove,
      });
      setConfig(value);
      onSaved();
      setMessage(t(remove ? "已恢复参考单价" : "单价已保存，统计已重新计算"));
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }
  const custom = config?.custom.some(
    (r) => r.provider === rate.provider && r.model === rate.model,
  );
  return (
    <section className="usage-pricing panel" aria-label={t("成本单价设置")}>
      <h3>{t("成本单价设置")}</h3>
      <p>
        {t(
          "单位为美元 / 百万 Tokens。参考单价来自 cc-switch-reference，可按当前环境的供应商实际售价覆盖；修改后会重新估算所选时间内的历史请求。",
        )}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save(false);
        }}
      >
        <div className="form">
          <label>
            {t("供应商")}
            <input
              required
              aria-label={t("计价供应商")}
              list="usage-price-providers"
              value={rate.provider}
              onChange={(e) => select(e.target.value, rate.model)}
            />
            <datalist id="usage-price-providers">
              <option value="*">{t("全部供应商参考价")}</option>
              {providers.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </label>
          <label>
            {t("模型")}
            <input
              required
              aria-label={t("计价模型")}
              list="usage-price-models"
              value={rate.model}
              onChange={(e) => select(rate.provider, e.target.value)}
            />
            <datalist id="usage-price-models">
              {Array.from(
                new Set([
                  ...models,
                  ...(config?.rates.map((r) => r.model) || []),
                ]),
              ).map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
          {(
            [
              ["input", "新增输入单价"],
              ["output", "输出单价"],
              ["cached", "缓存读取单价"],
              ["write", "缓存写入单价"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {t(label)}
              <input
                required
                type="number"
                min="0"
                max="1000000"
                step="any"
                aria-label={t(label)}
                value={Number.isNaN(rate[key]) ? "" : rate[key]}
                onChange={(e) =>
                  setRate({
                    ...rate,
                    [key]: e.target.value === "" ? NaN : Number(e.target.value),
                  })
                }
              />
            </label>
          ))}
        </div>
        <div className="buttons">
          <button
            disabled={busy || !config || !rate.model.trim()}
            type="submit"
          >
            {t("保存单价")}
          </button>
          <button
            type="button"
            disabled={busy || !custom}
            onClick={() => void save(true)}
          >
            {t("恢复参考单价")}
          </button>
        </div>
      </form>
      <p>
        {t(
          "供应商填 * 表示此环境的模型参考价；指定供应商优先。账号订阅通道不自动按 API 单价估算，需要显式设置该供应商。",
        )}
      </p>
      {config && config.custom.length > 0 && (
        <div className="buttons">
          {config.custom.map((r) => (
            <button
              key={JSON.stringify([r.provider, r.model])}
              onClick={() => select(r.provider, r.model)}
            >
              {r.provider} · {r.model}
            </button>
          ))}
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
