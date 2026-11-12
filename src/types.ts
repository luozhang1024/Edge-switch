export type Profile = {
  id: string;
  name: string;
  kind?: "ssh" | "local";
  host: string;
  user: string;
  port: number;
  project: string;
  identity: string;
  base_url: string;
  model: string;
  protocol: string;
  codex_auth: string;
  tool_services?: Partial<Record<ToolId, string>>;
  proxy: boolean;
  codex_proxy: boolean | null;
  harness_proxy: boolean | null;
  harness_background: boolean;
  proxy_port: number;
  active_api: string;
  codex_version: string;
  harness_version: string;
};
export type ToolId = "codex" | "claude" | "harness" | "gemini" | "opencode";
export type ProviderId =
  "openai" | "deepseek" | "anthropic" | "google" | "custom";
export type Service = {
  scope?: "cli" | "universal";
  icon?: string;
  preset?: string;
  tool?: ToolId;
  provider?: ProviderId;
  id: string;
  name: string;
  base_url: string;
  model: string;
  protocol: string;
};
export type Official = {
  remote_authenticated?: boolean;
  verified_at?: number;
  icon?: string;
  name?: string;
  note?: string;
  has_credentials?: boolean;
};
export type Task = {
  id: string;
  profile_id: string;
  label: string;
  state: string;
  message: string;
  result: unknown;
  started_at: number;
};
export type Snapshot = {
  list_order?: {
    profiles?: string[];
    services?: Record<string, Partial<Record<ToolId, string[]>>>;
  };
  preferences?: Preferences;
  profiles: Profile[];
  selected_profile: string;
  services: Record<string, Service[]>;
  official: Record<string, Official>;
  saved_keys: string[];
  tasks: Task[];
  version: string;
};
export type Preferences = {
  language: "zh" | "en";
  autostart: boolean;
  close_to_tray: boolean;
  theme: "light" | "dark" | "system";
  motion: boolean;
  home_tools: ToolId[];
};
export const defaultPreferences: Preferences = {
  language: "zh",
  autostart: false,
  close_to_tray: true,
  theme: "system",
  motion: true,
  home_tools: ["codex", "claude", "harness", "gemini", "opencode"],
};
export type Connection = {
  kind: string;
  state: string;
  local_port: number;
  remote_port: number;
  background: boolean;
};
export const newId = () => crypto.randomUUID().replaceAll("-", "");
export const emptyProfile = (): Profile => ({
  id: newId(),
  name: "新工作环境",
  host: "",
  user: "developer",
  port: 22,
  project: "/home/developer/project",
  identity: "",
  base_url: "https://api.deepseek.com/v1",
  model: "",
  protocol: "responses",
  codex_auth: "api",
  proxy: false,
  codex_proxy: null,
  harness_proxy: null,
  harness_background: true,
  proxy_port: 7890,
  active_api: "",
  codex_version: "",
  harness_version: "",
});
export const isRunning = (task: Task) =>
  ["等待执行", "运行中"].includes(task.state);
