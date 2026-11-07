import { t } from "./i18n";
import React, { useEffect, useRef } from "react";
import { detectProvider, serviceTemplate, tools } from "./catalog";
import { Service, ToolId } from "./types";
import officialIcon from "../image/providers/openai-official.svg";
import { cliPresets, defaultProtocol } from "./providerConfig";
import { ProviderIconUpload } from "./ProviderIconUpload";

export function ProviderPage({
  tool,
  service,
  official,
  icon,
  editing,
  close,
  onSelect,
  onIcon,
  children,
}: {
  tool: ToolId;
  service?: Service;
  official?: boolean;
  icon?: string;
  editing?: boolean;
  close: () => void;
  onSelect: (service: Service | "official") => void;
  onIcon: (icon: string) => void;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const selected = tools.find((t) => t.id === tool)!;
  const unified = service?.scope === "universal";
  const presets = cliPresets(tool);
  const preset = official
    ? "official"
    : service?.preset ||
      (service?.provider && service.provider !== "custom"
        ? "official"
        : "custom");
  const title = editing ? "编辑供应商" : "添加新供应商";
  useEffect(() => {
    const node = dialog.current!;
    const trigger = document.activeElement as HTMLElement | null;
    if (node.showModal) node.showModal();
    else node.setAttribute("open", "");
    return () => {
      if (node.close) node.close();
      queueMicrotask(() => {
        if (trigger?.isConnected) trigger.focus();
      });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="provider-page"
      aria-label={t(title)}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header className="provider-page-header">
        <button
          type="button"
          aria-label={t("返回")}
          title={t("返回供应商列表")}
          onClick={close}
        >
          ←
        </button>
        <h2>{t(title)}</h2>
      </header>
      <div className="provider-page-body">
        <div
          className="provider-scope"
          role="tablist"
          aria-label={t("供应商类型")}
        >
          <button
            type="button"
            role="tab"
            aria-selected={!unified}
            onClick={() => {
              if (unified)
                onSelect({
                  ...serviceTemplate(tool, "custom"),
                  scope: "cli",
                  preset: "custom",
                  protocol: defaultProtocol(tool),
                });
            }}
          >
            {selected.name}
            {t(" 供应商")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={!!unified}
            onClick={() => {
              if (!unified)
                onSelect({
                  ...serviceTemplate(tool, "custom"),
                  scope: "universal",
                  preset: "newapi",
                  name: "New API",
                  protocol: defaultProtocol(tool),
                });
            }}
          >
            {t("统一供应商 · New API")}
          </button>
        </div>
        <section className="provider-form-panel">
          <p className="preset-label">{t("预设供应商")}</p>
          <div className="preset-chips" aria-label={t("预设供应商")}>
            {unified ? (
              <button type="button" aria-pressed="true">
                New API
              </button>
            ) : (
              presets.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  aria-pressed={preset === p.id}
                  onClick={() => {
                    if (p.id === "official" && tool === "codex")
                      onSelect("official");
                    else onSelect({ ...p.entry, preset: p.id, scope: "cli" });
                  }}
                >
                  {p.id === "official" && (
                    <img
                      src={tool === "codex" ? officialIcon : selected.icon}
                      alt=""
                    />
                  )}
                  {t(p.name)}
                </button>
              ))
            )}
          </div>
          <p className="preset-hint">
            {unified
              ? t(
                  "同一份 New API 配置可供各 CLI 工具使用；应用按工具生成请求格式，接口需支持对应工具。",
                )
              : official
                ? t("使用 ChatGPT 官方账号，无需填写 API Key")
                : t(
                    "应用根据当前 CLI 工具自动配置接口格式，填写供应商提供的请求地址和模型名称。",
                  )}
          </p>
          <ProviderIconUpload
            icon={icon}
            fallback={
              official
                ? officialIcon
                : service
                  ? detectProvider(service).icon
                  : undefined
            }
            onChange={onIcon}
          />
          {children}
        </section>
      </div>
    </dialog>
  );
}
