import codex from "../image/providers/openai.svg";
import claude from "../image/providers/claude-color.svg";
import deepseek from "../image/providers/deepseek-color.svg";
import gemini from "../image/providers/gemini-color.svg";
import opencode from "../image/providers/opencode.svg";
import openai from "../image/providers/openai.svg";
import anthropic from "../image/providers/anthropic.svg";
import google from "../image/providers/google-color.svg";
import { ProviderId, Service, ToolId, newId } from "./types";

export const tools: {
  id: ToolId;
  name: string;
  icon: string;
  protocols: string[];
  hint: string;
}[] = [
  {
    id: "codex",
    name: "Codex",
    icon: codex,
    protocols: ["responses"],
    hint: "使用 ChatGPT 官方账号，或接入支持 Responses 的 API。DeepSeek 等模型需通过兼容 Responses 的网关。",
  },
  {
    id: "claude",
    name: "Claude Code",
    icon: claude,
    protocols: ["anthropic"],
    hint: "接入 Anthropic Messages API 或兼容网关，模型与工具可以来自不同供应商。",
  },
  {
    id: "harness",
    name: "DeepSeek Harness",
    icon: deepseek,
    protocols: ["chat", "responses", "anthropic"],
    hint: "通过 Harness 的多供应商适配器接入 DeepSeek、OpenAI、Anthropic 或兼容网关 API。更换服务后请停止并重新打开网页。",
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    icon: gemini,
    protocols: ["gemini"],
    hint: "使用 Gemini 原生 API 或兼容网关；普通 OpenAI API 不能直接用于 Gemini CLI。",
  },
  {
    id: "opencode",
    name: "OpenCode",
    icon: opencode,
    protocols: ["chat", "responses", "anthropic", "gemini"],
    hint: "为 OpenCode 配置供应商、模型与密钥，支持多种 API 协议。",
  },
];
export const providers: {
  id: ProviderId;
  name: string;
  icon?: string;
  url: string;
  protocol: string;
}[] = [
  {
    id: "openai",
    name: "OpenAI / ChatGPT API",
    icon: openai,
    url: "https://api.openai.com/v1",
    protocol: "responses",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    icon: deepseek,
    url: "https://api.deepseek.com/v1",
    protocol: "chat",
  },
  {
    id: "anthropic",
    name: "Anthropic / Claude",
    icon: anthropic,
    url: "https://api.anthropic.com",
    protocol: "anthropic",
  },
  {
    id: "google",
    name: "Google / Gemini",
    icon: google,
    url: "https://generativelanguage.googleapis.com/v1beta",
    protocol: "gemini",
  },
  { id: "custom", name: "自定义 / 中转网关", url: "", protocol: "responses" },
];
export const protocolNames: Record<string, string> = {
  responses: "OpenAI Responses",
  chat: "OpenAI Chat Completions",
  anthropic: "Anthropic Messages",
  gemini: "Gemini 原生 API",
};
export function detectProvider(service: Service) {
  if (service.provider)
    return providers.find((p) => p.id === service.provider) || providers[4];
  const host = (() => {
    try {
      return new URL(service.base_url).hostname;
    } catch {
      return "";
    }
  })();
  return (
    providers.find((p) => p.url && new URL(p.url).hostname === host) ||
    providers[4]
  );
}
export function serviceTemplate(tool: ToolId, provider: ProviderId): Service {
  const t = tools.find((item) => item.id === tool)!;
  const p = providers.find((item) => item.id === provider)!;
  const native = t.protocols.includes(p.protocol);
  return {
    id: newId(),
    tool,
    provider,
    name: provider === "custom" ? "" : p.name,
    base_url: native ? p.url : "",
    model: "",
    protocol: native ? p.protocol : t.protocols[0],
  };
}
