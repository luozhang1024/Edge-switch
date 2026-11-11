import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";
import { chromium, expect } from "@playwright/test";

if (process.platform !== "win32")
  throw new Error("Desktop smoke test requires Windows and WebView2");
const exe = resolve(
  process.argv[2] || "src-tauri/target/release/edge-switch.exe",
);
const { version: expectedVersion } = JSON.parse(
  await readFile(resolve("package.json"), "utf8"),
);
const output = resolve("build/migration", `desktop-${Date.now()}`);
await mkdir(output, { recursive: true });
const server = createServer();
server.listen(0, "127.0.0.1");
await once(server, "listening");
const port = server.address().port;
await new Promise((r) => server.close(r));
const env = {
  ...process.env,
  LOCALAPPDATA: output,
  WEBVIEW2_USER_DATA_FOLDER: join(output, "webview"),
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`,
};
const child = spawn(exe, [], {
  env,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let diagnostics = "";
child.stderr.on("data", (d) => {
  diagnostics += d;
});
let browser;
try {
  let endpoint;
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null)
      throw new Error(`Desktop exited ${child.exitCode}: ${diagnostics}`);
    try {
      endpoint = (
        await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
      ).webSocketDebuggerUrl;
      if (endpoint) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!endpoint)
    throw new Error(`WebView2 debugging endpoint unavailable: ${diagnostics}`);
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  let page;
  for (let i = 0; i < 80; i++) {
    page = context
      .pages()
      .find(
        (p) =>
          p.url().includes("tauri.localhost") || p.url().includes("tauri://"),
      );
    if (page) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!page) throw new Error("No Tauri page");
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const ipc = (command, args = {}) =>
    page.evaluate(
      ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
      { command, args },
    );
  await expect(
    page.getByRole("button", { name: "打开导航", exact: true }),
  ).toBeVisible();
  expect(
    await page.locator(".studio-brand img").evaluate((img) => img.naturalWidth),
  ).toBeGreaterThan(0);
  async function checkVisuals(name) {
    await page.locator("img").evaluateAll(async (images) => {
      await Promise.all(images.map((img) => img.decode()));
    });
    expect(await page.locator(".window-controls button").count()).toBe(3);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      animations: "disabled",
      path: join(output, `${name}.png`),
      fullPage: (await page.locator(".provider-page").count()) === 0,
    });
  }
  async function navigate(name) {
    if (!(await page.locator(".workspace-hub").count()))
      await page.getByRole("button", { name: "打开导航", exact: true }).click();
    await page
      .locator(".management-sidebar")
      .getByRole("button", { name, exact: true })
      .click();
  }
  await checkVisuals("overview-initial");
  const initialMaximized = await ipc("plugin:window|is_maximized", {
    label: "main",
  });
  await page.getByRole("button", { name: "最大化或还原窗口" }).click();
  await expect
    .poll(() => ipc("plugin:window|is_maximized", { label: "main" }))
    .toBe(!initialMaximized);
  await page.getByRole("button", { name: "最大化或还原窗口" }).click();
  await expect
    .poll(() => ipc("plugin:window|is_maximized", { label: "main" }))
    .toBe(initialMaximized);
  const launchList = page.getByRole("region", { name: "快速启动列表" });
  await expect(launchList).toHaveAttribute("data-below", "true");
  await launchList.hover();
  await page.mouse.wheel(0, 75);
  await expect(launchList).toHaveAttribute("data-above", "true");
  await launchList.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect(launchList).toHaveAttribute("data-below", "false");
  await expect(
    page.getByRole("button", { name: "打开 OpenCode", exact: true }),
  ).toBeInViewport();
  await launchList.evaluate((node) => {
    node.scrollTop = 0;
  });
  await expect(page.locator(".task-history")).toHaveCount(0);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("tab", { name: "日志", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "设置", exact: true }),
  ).toBeVisible();
  await checkVisuals("task-history-dialog");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "设置", exact: true }),
  ).toBeFocused();
  await expect(page.locator(".vinyl")).toHaveCSS(
    "animation-play-state",
    "running",
  );
  await page.getByRole("button", { name: "暂停唱片动画" }).click();
  await expect(page.locator(".vinyl")).toHaveCSS(
    "animation-play-state",
    "paused",
  );
  await page.getByRole("button", { name: "继续唱片动画" }).click();
  await expect(page.locator(".vinyl")).toHaveCSS(
    "animation-play-state",
    "running",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".vinyl")).toHaveCSS("animation-name", "none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const originalViewport = page.viewportSize();
  await page.setViewportSize({ width: 980, height: 660 });
  await checkVisuals("overview-compact");
  await page.setViewportSize(originalViewport || { width: 1180, height: 790 });
  let snapshot = await ipc("snapshot");
  expect(snapshot.version).toBe(expectedVersion);
  let rejectedUnauthenticated = false;
  try {
    await ipc("activate_service", {
      profileId: snapshot.selected_profile,
      serviceId: "official",
      tool: "codex",
    });
  } catch (error) {
    rejectedUnauthenticated = String(error).includes("授权中心");
  }
  expect(rejectedUnauthenticated).toBe(true);
  await page.getByRole("button", { name: "打开导航" }).click();
  await expect(page.locator(".sidefoot")).toHaveCount(0);
  await expect(page.locator(".turntable-caption")).toContainText(
    `v${expectedVersion}`,
  );
  await expect(
    page.getByRole("button", { name: "总览与任务", exact: true }),
  ).toHaveCount(0);
  await checkVisuals("persistent-navigation");
  await page.keyboard.press("Escape");
  const profile = {
    ...snapshot.profiles[0],
    name: "桌面冒烟环境",
    host: "192.0.2.1",
    port: 22,
  };
  await ipc("save_profile", { profile });
  await navigate("工作环境");
  await expect(
    page.locator(".profile b").filter({ hasText: "桌面冒烟环境" }),
  ).toBeVisible();
  await checkVisuals("environments");
  await page.locator(".profile-list .profile").first().hover();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await checkVisuals("environment-dialog");
  await page.getByLabel("SSH 端口", { exact: true }).fill("2222");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator("dialog:not(.workspace-sheet)")).toHaveCount(0);
  snapshot = await ipc("snapshot");
  expect(snapshot.profiles[0].port).toBe(2222);
  await navigate("模型服务");
  await checkVisuals("models-official");
  await page.getByRole("button", { name: "添加服务", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "添加新供应商" });
  await expect(picker.locator(".preset-chips button").nth(1)).toContainText(
    "OpenAI Official",
  );
  await checkVisuals("codex-provider-picker");
  await page.setViewportSize({ width: 980, height: 660 });
  await checkVisuals("provider-form-compact");
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog:not(.workspace-sheet)")).toHaveCount(0);
  await page.setViewportSize({ width: 1180, height: 790 });
  await page.getByRole("button", { name: "添加服务", exact: true }).click();
  await page
    .locator("dialog:not(.workspace-sheet)")
    .getByRole("button", { name: "自定义配置", exact: true })
    .click();
  await page.getByLabel("服务名称").fill("冒烟 API");
  await page
    .getByLabel("API请求地址", { exact: true })
    .fill("https://example.com/v1");
  await page
    .getByLabel("选择供应商图标文件")
    .setInputFiles(resolve("image/EdgeAI.png"));
  await expect(
    page.getByRole("button", { name: "恢复默认图标" }),
  ).toBeVisible();
  await expect(page.getByLabel("协议", { exact: true })).toHaveCount(0);
  await page.getByLabel("模型名称").fill("smoke-model");
  await page
    .getByLabel("API Key", { exact: true })
    .fill("smoke-only-not-a-real-key");
  await page.getByLabel("使用 Windows DPAPI 加密保存").check();
  await page.getByRole("button", { name: "保存服务", exact: true }).click();
  await expect(page.locator("dialog:not(.workspace-sheet)")).toHaveCount(0);
  await expect(page.getByText("冒烟 API", { exact: true })).toBeVisible();
  snapshot = await ipc("snapshot");
  const service = snapshot.services[profile.id].find(
    (s) => s.name === "冒烟 API",
  );
  expect(snapshot.saved_keys).toContain(service.id);
  expect(service.icon.startsWith("data:image/png;base64,")).toBe(true);
  let rejectedKeyForward = false;
  try {
    await ipc("fetch_models", {
      profileId: profile.id,
      serviceId: service.id,
      baseUrl: "https://other.example/v1",
      protocol: "responses",
      key: null,
    });
  } catch (e) {
    rejectedKeyForward = String(e).includes("地址已更改");
  }
  expect(rejectedKeyForward).toBe(true);
  const row = page
    .locator(".service-card")
    .filter({ has: page.getByText("冒烟 API", { exact: true }) });
  await page.mouse.move(0, 0);
  await expect(row.locator(".service-actions")).toHaveCSS("opacity", "0");
  await row.hover();
  await expect(row.locator(".service-actions")).toHaveCSS("opacity", "1");
  await expect(
    row.getByRole("button", { name: "编辑", exact: true }),
  ).toHaveAttribute("title", "编辑");
  await checkVisuals("models-hover-actions");
  await row.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue(
    "smoke-only-not-a-real-key",
  );
  await expect(page.getByLabel("API Key", { exact: true })).toHaveAttribute(
    "type",
    "password",
  );
  await expect(
    page.getByLabel("auth.json (JSON) *", { exact: true }),
  ).not.toContainText("smoke-only-not-a-real-key");
  await page.getByRole("button", { name: "显示 API Key", exact: true }).click();
  await expect(page.getByLabel("API Key", { exact: true })).toHaveAttribute(
    "type",
    "text",
  );
  await page.getByRole("button", { name: "隐藏 API Key", exact: true }).click();
  await checkVisuals("provider-saved-masked-key");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await row.hover();
  await row.getByRole("button", { name: "复制", exact: true }).click();
  await expect(page.getByText("冒烟 API 副本", { exact: true })).toBeVisible();
  const copyState = await ipc("snapshot");
  const copy = copyState.services[profile.id].find(
    (s) => s.name === "冒烟 API 副本",
  );
  expect(copy.icon).toBe(service.icon);
  expect(
    await ipc("get_service_key", { profileId: profile.id, serviceId: copy.id }),
  ).toBe("smoke-only-not-a-real-key");
  await ipc("delete_service", { profileId: profile.id, serviceId: copy.id });
  expect(JSON.stringify(snapshot)).not.toContain("smoke-only-not-a-real-key");
  await ipc("activate_service", {
    profileId: profile.id,
    serviceId: service.id,
  });
  const updated = await ipc("snapshot");
  expect(updated.profiles[0].model).toBe("smoke-model");
  const task = await ipc("start_task", {
    profileId: profile.id,
    action: "diagnose",
    payload: {},
  });
  let blocked = false;
  try {
    await ipc("save_profile", { profile });
  } catch (e) {
    blocked = String(e).includes("任务");
  }
  expect(blocked).toBe(true);
  await ipc("cancel_task", { taskId: task.id });
  await expect
    .poll(
      async () =>
        (await ipc("snapshot")).tasks.find((t) => t.id === task.id)?.state,
    )
    .toBe("已取消");
  const encryptedStore = JSON.parse(
    await readFile(join(output, "EdgeSSHAI/profiles.json"), "utf8"),
  );
  expect(encryptedStore.secrets[service.id]).toBeTruthy();
  expect(JSON.stringify(encryptedStore)).not.toContain(
    "smoke-only-not-a-real-key",
  );
  await ipc("save_service", {
    profileId: profile.id,
    entry: { ...service, model: "updated-smoke-model" },
    key: null,
    remember: true,
  });
  expect((await ipc("snapshot")).profiles[0].model).toBe("updated-smoke-model");
  await expect(page.locator(".service-card")).toContainText([
    "OpenAI Official",
    "updated-smoke-model",
  ]);
  await checkVisuals("models");
  await ipc("delete_service", { profileId: profile.id, serviceId: service.id });
  expect((await ipc("snapshot")).saved_keys).not.toContain(service.id);
  await ipc("save_official", {
    profileId: profile.id,
    name: "冒烟账号",
    note: "无凭据测试",
    path: null,
  });
  expect((await ipc("snapshot")).official[profile.id].name).toBe("冒烟账号");
  await ipc("delete_official", { profileId: profile.id });
  expect((await ipc("snapshot")).official[profile.id]).toBeUndefined();
  const codexBefore = (await ipc("snapshot")).profiles[0];
  const toolServices = [];
  for (const [tool, name, provider] of [
    ["claude", "Claude Code", "anthropic"],
    ["harness", "DeepSeek Harness", "deepseek"],
    ["gemini", "Gemini CLI", "google"],
    ["opencode", "OpenCode", "custom"],
  ]) {
    await page.getByRole("tab", { name, exact: true }).click();
    await page.getByRole("button", { name: "添加服务", exact: true }).click();
    await page
      .locator("dialog:not(.workspace-sheet)")
      .getByRole("button", {
        name: {
          claude: "Claude Official",
          harness: "DeepSeek Official",
          gemini: "Gemini Official",
          opencode: "OpenCode Zen",
        }[tool],
        exact: true,
      })
      .click();
    await page.getByLabel("服务名称", { exact: true }).fill(`smoke-${tool}`);
    await page.getByLabel("模型名称", { exact: true }).fill(`model-${tool}`);
    await page
      .getByLabel("API Key", { exact: true })
      .fill("smoke-only-not-a-real-key");
    await page.getByLabel("使用 Windows DPAPI 加密保存").check();
    await page.getByRole("button", { name: "保存服务", exact: true }).click();
    await expect(page.locator("dialog:not(.workspace-sheet)")).toHaveCount(0);
    const toolRow = page
      .locator(".service-card")
      .filter({ has: page.getByText(`smoke-${tool}`, { exact: true }) });
    await expect(toolRow).toBeVisible();
    await toolRow.hover();
    await page.getByRole("button", { name: "启用", exact: true }).click();
    await expect(page.locator(".service-card .active-badge")).toHaveText(
      "使用中",
    );
    const state = await ipc("snapshot");
    const entry = state.services[profile.id].find(
      (s) => s.name === `smoke-${tool}`,
    );
    expect(entry.tool).toBe(tool);
    expect(entry.provider).toBe(provider);
    expect(state.profiles[0].tool_services[tool]).toBe(entry.id);
    expect(state.profiles[0].active_api).toBe(codexBefore.active_api);
    expect(state.profiles[0].codex_auth).toBe(codexBefore.codex_auth);
    expect(JSON.stringify(state)).not.toContain("smoke-only-not-a-real-key");
    toolServices.push(entry);
    await checkVisuals(`models-${tool}`);
  }
  await page.setViewportSize({ width: 980, height: 660 });
  await checkVisuals("models-compact");
  await page.setViewportSize({ width: 1180, height: 790 });
  await page.reload();
  await navigate("模型服务");
  await page
    .getByRole("tab", { name: "DeepSeek Harness", exact: true })
    .click();
  await expect(page.locator(".service-info b")).toHaveText(["smoke-harness"]);
  await expect(page.locator(".service-card .active-badge")).toHaveText(
    "使用中",
  );
  await page.getByRole("button", { name: "添加服务", exact: true }).click();
  await page
    .getByRole("tab", { name: "统一供应商 · New API", exact: true })
    .click();
  await page
    .getByLabel("API请求地址", { exact: true })
    .fill("https://newapi.example/v1");
  await page.getByLabel("模型名称", { exact: true }).fill("universal-model");
  await page
    .getByLabel("API Key", { exact: true })
    .fill("smoke-only-not-a-real-key");
  await page.getByLabel("使用 Windows DPAPI 加密保存").check();
  await checkVisuals("provider-universal-newapi");
  await page.getByRole("button", { name: "保存服务", exact: true }).click();
  await expect(page.locator("dialog:not(.workspace-sheet)")).toHaveCount(0);
  const shared = (await ipc("snapshot")).services[profile.id].find(
    (s) => s.scope === "universal",
  );
  for (const [tool, name] of [
    ["codex", "Codex"],
    ["claude", "Claude Code"],
    ["gemini", "Gemini CLI"],
    ["harness", "DeepSeek Harness"],
    ["opencode", "OpenCode"],
  ]) {
    await page.getByRole("tab", { name, exact: true }).click();
    const sharedRow = page
      .locator(".service-card")
      .filter({ has: page.getByText("New API · 统一", { exact: true }) });
    await sharedRow.hover();
    await sharedRow.getByRole("button", { name: "启用", exact: true }).click();
    await expect(sharedRow.locator(".active-badge")).toHaveText("使用中");
    const p = (await ipc("snapshot")).profiles[0];
    expect(tool === "codex" ? p.active_api : p.tool_services[tool]).toBe(
      shared.id,
    );
  }
  await ipc("delete_service", { profileId: profile.id, serviceId: shared.id });
  const deletedTool = toolServices.find((s) => s.tool === "opencode");
  await ipc("delete_service", {
    profileId: profile.id,
    serviceId: deletedTool.id,
  });
  expect(
    (await ipc("snapshot")).profiles[0].tool_services.opencode,
  ).toBeUndefined();
  await navigate("工作环境");
  await page.locator(".profile-list .profile").first().hover();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByRole("tab", { name: "AI 工具", exact: true }).click();
  await expect(
    page
      .getByRole("dialog", { name: "编辑工作环境", exact: true })
      .getByRole("button", { name: "打开 VS Code", exact: true }),
  ).toBeVisible();
  await checkVisuals("tools");
  await page.getByRole("tab", { name: "代理连接", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "连接代理", exact: true }),
  ).toBeVisible();
  await checkVisuals("proxy");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "← 返回唱片台", exact: true }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "通用", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("switch", { name: "开机自启", exact: true }),
  ).toBeChecked({ checked: await ipc("autostart_status") });
  await expect(
    page.getByRole("switch", { name: "关闭时最小化到托盘", exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "General", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect
    .poll(async () => (await ipc("snapshot")).preferences.language)
    .toBe("en");
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "General", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "中文", exact: true }).click();
  await expect
    .poll(async () => (await ipc("snapshot")).preferences.language)
    .toBe("zh");
  await page.getByRole("button", { name: "☾ 深色", exact: true }).click();
  await expect
    .poll(async () => (await ipc("snapshot")).preferences.theme)
    .toBe("dark");
  await checkVisuals("settings-dark");
  await page.getByRole("button", { name: "☼ 浅色", exact: true }).click();
  await expect
    .poll(async () => (await ipc("snapshot")).preferences.theme)
    .toBe("light");
  await page.getByRole("button", { name: "Claude Code", exact: true }).click();
  await expect
    .poll(async () =>
      (await ipc("snapshot")).preferences.home_tools.includes("claude"),
    )
    .toBe(false);
  await page.getByLabel("自动旋转唱片").click();
  await expect(page.getByLabel("自动旋转唱片")).not.toBeChecked();
  await expect
    .poll(async () => (await ipc("snapshot")).preferences.motion)
    .toBe(false);
  await checkVisuals("settings-general");
  await expect(
    page.getByRole("tab", { name: "授权中心", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "使用统计", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "授权中心", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "ChatGPT", exact: true })
      .getByRole("button", { name: "添加账号", exact: true }),
  ).toBeVisible();
  await checkVisuals("settings-auth");
  await page.getByRole("button", { name: "← 返回唱片台", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "打开 Claude Code", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".vinyl")).toHaveCSS(
    "animation-play-state",
    "paused",
  );
  await checkVisuals("overview");
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "关于", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.locator(".settings-page .update-result, .settings-page .form-error"),
  ).toBeVisible({ timeout: 25000 });
  await checkVisuals("settings-update-result");
  await page.getByRole("button", { name: "← 返回唱片台", exact: true }).click();
  expect(errors).toEqual([]);
  const stored = JSON.parse(
    await readFile(join(output, "EdgeSSHAI/profiles.json"), "utf8"),
  );
  expect(JSON.stringify(stored)).not.toContain("smoke-only-not-a-real-key");
  expect(stored.client_id).toHaveLength(32);
  expect(stored.preferences.theme).toBe("light");
  expect(stored.preferences.motion).toBe(false);
  expect(stored.preferences.home_tools).not.toContain("claude");
  await page.getByRole("button", { name: "最小化窗口" }).click();
  await expect
    .poll(() => ipc("plugin:window|is_minimized", { label: "main" }))
    .toBe(true);
  await page.locator(".close-window").evaluate((button) => button.click());
  await expect
    .poll(() => ipc("plugin:window|is_visible", { label: "main" }))
    .toBe(false);
  expect(child.exitCode).toBeNull();
  const refocus = spawn(exe, [], { env, windowsHide: true, stdio: "ignore" });
  await once(refocus, "exit");
  await expect
    .poll(() => ipc("plugin:window|is_visible", { label: "main" }))
    .toBe(true);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page
    .getByRole("switch", { name: "关闭时最小化到托盘", exact: true })
    .click();
  await expect
    .poll(async () => (await ipc("snapshot")).preferences.close_to_tray)
    .toBe(false);
  await page.locator(".close-window").click();
  await expect.poll(() => child.exitCode).toBe(0);
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        ok: true,
        version: expectedVersion,
        checks: [
          "native startup",
          "bundled logo and restored navigation/action icons",
          "all page images decode and compact layout has no horizontal overflow",
          "vinyl pause/resume and system reduced-motion preference",
          "edge-to-edge canvas, persistent navigation, task sheet, scroll fade, native maximize/minimize/close-to-tray",
          "persisted theme, tool visibility, animation and account authentication settings",
          "environment edit",
          "API CRUD and DPAPI",
          "active API synchronization",
          "busy mutation rejected",
          "task cancellation",
          "tools and proxy pages",
          "five tool tabs, isolated service activation, provider metadata and persistent bindings",
        ],
        javascriptErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(`Desktop smoke passed; isolated data and screenshots: ${output}`);
} finally {
  await browser?.close().catch(() => {});
  if (child.exitCode === null) {
    child.kill();
    await Promise.race([
      once(child, "exit"),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
  }
}
