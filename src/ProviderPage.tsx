import React, { useEffect, useRef } from "react";
import { providers, serviceTemplate, tools } from "./catalog";
import { Service, ToolId } from "./types";
import officialIcon from "../image/providers/openai-official.svg";

// Responses presets from cc-switch-reference/src/config/codexProviderPresets.ts.
// These use the existing custom gateway configuration, without protocol conversion.
const codexGateways = [
  ["AiHubMix", "https://aihubmix.com/v1"],
  ["DMXAPI", "https://www.dmxapi.cn/v1"],
  ["OpenRouter", "https://openrouter.ai/api/v1"],
  ["TheRouter", "https://api.therouter.ai/v1"],
  ["PackyCode", "https://www.packyapi.ai/v1"],
  ["Cubence", "https://api.cubence.com/v1"],
  ["RightCode", "https://www.rightapi.ai/codex/v1"],
  ["CherryIN", "https://open.cherryin.net/v1"],
];

export function ProviderPage({
  tool,
  service,
  official,
  editing,
  close,
  onSelect,
  children,
}: {
  tool: ToolId;
  service?: Service;
  official?: boolean;
  editing?: boolean;
  close: () => void;
  onSelect: (service: Service | "official") => void;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const selected = tools.find((t) => t.id === tool)!;
  const provider = providers.find((p) => p.id === service?.provider);
  const gateway = codexGateways.find(([name]) => name === service?.name);
  const icon = official ? officialIcon : provider?.icon;
  const title = editing ? "编辑供应商" : "添加新供应商";
  useEffect(() => {
    const node = dialog.current!;
    if (node.showModal) node.showModal();
    else node.setAttribute("open", "");
    return () => {
      if (node.close) node.close();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="provider-page"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header className="provider-page-header">
        <button
          type="button"
          aria-label="返回"
          title="返回供应商列表"
          onClick={close}
        >
          ←
        </button>
        <h2>{title}</h2>
      </header>
      <div className="provider-page-body">
        <div className="provider-scope">
          <span>{selected.name} 供应商</span>
        </div>
        <section className="provider-form-panel">
          <p className="preset-label">预设供应商</p>
          <div className="preset-chips" aria-label="预设供应商">
            <button
              type="button"
              aria-pressed={
                !official && service?.provider === "custom" && !gateway
              }
              onClick={() => onSelect(serviceTemplate(tool, "custom"))}
            >
              自定义配置
            </button>
            {tool === "codex" && (
              <button
                type="button"
                aria-pressed={!!official}
                onClick={() => onSelect("official")}
              >
                <img src={officialIcon} alt="" />
                OpenAI Official
              </button>
            )}
            {providers
              .filter((p) => p.id !== "custom")
              .map((p) => (
                <button
                  type="button"
                  key={p.id}
                  aria-pressed={!official && service?.provider === p.id}
                  onClick={() => onSelect(serviceTemplate(tool, p.id))}
                >
                  {p.icon && <img src={p.icon} alt="" />}
                  {p.name}
                </button>
              ))}
            {tool === "codex" &&
              codexGateways.map(([name, url]) => (
                <button
                  type="button"
                  key={name}
                  aria-pressed={
                    !official &&
                    service?.name === name &&
                    service.provider === "custom"
                  }
                  onClick={() =>
                    onSelect({
                      ...serviceTemplate(tool, "custom"),
                      name,
                      base_url: url,
                    })
                  }
                >
                  {name}
                </button>
              ))}
          </div>
          <p className="preset-hint">
            {official
              ? "使用 ChatGPT 官方账号，无需填写 API Key"
              : service?.provider === "custom" && !gateway
                ? "自定义配置需手动填写所有必要字段"
                : "已填入供应商预设，请确认 API 地址并填写模型和密钥"}
          </p>
          <div className="provider-preview">
            <span>
              {icon ? (
                <img src={icon} alt="" />
              ) : (
                (service?.name || "P").slice(0, 1).toUpperCase()
              )}
            </span>
          </div>
          {children}
        </section>
      </div>
    </dialog>
  );
}
