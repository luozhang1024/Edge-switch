import { Service, ToolId } from "./types";
import { serviceTemplate } from "./catalog";

export const defaultProtocol = (tool: ToolId) =>
  ({
    codex: "responses",
    claude: "anthropic",
    gemini: "gemini",
    harness: "chat",
    opencode: "chat",
  })[tool];
export function cliPresets(tool: ToolId) {
  const official = {
    codex: ["OpenAI Official", "openai"],
    claude: ["Anthropic Official", "anthropic"],
    gemini: ["Google Official", "google"],
    harness: ["DeepSeek Official", "deepseek"],
    opencode: ["OpenCode Zen", "custom"],
  }[tool];
  const entry = serviceTemplate(
    tool,
    official[1] as Service["provider"] & string,
  );
  entry.name = official[0];
  if (tool === "opencode") {
    entry.base_url = "https://opencode.ai/zen/v1";
    entry.protocol = "chat";
  }
  const nativeRoot = tool === "claude" || tool === "gemini";
  return [
    {
      id: "custom",
      name: "自定义配置",
      entry: {
        ...serviceTemplate(tool, "custom"),
        protocol: defaultProtocol(tool),
      },
    },
    { id: "official", name: official[0], entry },
    {
      id: "openrouter",
      name: "OpenRouter",
      entry: {
        ...serviceTemplate(tool, "custom"),
        name: "OpenRouter",
        base_url: nativeRoot
          ? "https://openrouter.ai/api"
          : "https://openrouter.ai/api/v1",
        protocol: defaultProtocol(tool),
      },
    },
    {
      id: "therouter",
      name: "TheRouter",
      entry: {
        ...serviceTemplate(tool, "custom"),
        name: "TheRouter",
        base_url: nativeRoot
          ? "https://api.therouter.ai"
          : "https://api.therouter.ai/v1",
        protocol: defaultProtocol(tool),
      },
    },
  ];
}
export function configPreview(service: Service, key: string) {
  const q = (v: string) => JSON.stringify(v);
  const tool = service.tool || "codex";
  if (tool === "codex")
    return [
      {
        name: "config.toml (TOML)",
        text: `forced_login_method = "api"\ncli_auth_credentials_store = "file"\nmodel_provider = "edge"\nmodel = ${q(service.model)}\n\n[model_providers.edge]\nname = "Edge Workbench"\nbase_url = ${q(service.base_url)}\nwire_api = "responses"\nenv_key = "OPENAI_API_KEY"\n`,
      },
      {
        name: "auth.json (JSON) *",
        text: JSON.stringify({ OPENAI_API_KEY: key }, null, 2),
      },
    ];
  const env =
    tool === "claude"
      ? {
          ANTHROPIC_BASE_URL: service.base_url,
          ANTHROPIC_MODEL: service.model,
          ANTHROPIC_API_KEY: key,
        }
      : tool === "gemini"
        ? {
            GOOGLE_GEMINI_BASE_URL: service.base_url,
            GEMINI_API_KEY: key,
            GEMINI_MODEL: service.model,
          }
        : { base_url: service.base_url, model: service.model, api_key: key };
  return [{ name: "连接配置预览 (JSON)", text: JSON.stringify(env, null, 2) }];
}
