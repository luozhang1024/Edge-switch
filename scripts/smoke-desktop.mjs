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
    page.getByRole("button", { name: "工作环境", exact: true }),
  ).toBeVisible();
  expect(
    await page.locator(".brand img").evaluate((img) => img.naturalWidth),
  ).toBeGreaterThan(0);
  async function checkVisuals(name) {
    await page.locator("img").evaluateAll(async (images) => {
      await Promise.all(images.map((img) => img.decode()));
    });
    expect(await page.locator("nav .asset-icon").count()).toBe(5);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: join(output, `${name}.png`),
      fullPage: (await page.locator(".provider-page").count()) === 0,
    });
  }
  await checkVisuals("overview-initial");
  const originalViewport = page.viewportSize();
  await page.setViewportSize({ width: 980, height: 660 });
  await checkVisuals("overview-compact");
  await page.setViewportSize(originalViewport || { width: 1180, height: 790 });
  let snapshot = await ipc("snapshot");
  expect(snapshot.version).toBe(expectedVersion);
  await expect(page.locator(".sidefoot")).toContainText(`v${expectedVersion}`);
  const profile = {
    ...snapshot.profiles[0],
    name: "桌面冒烟环境",
    host: "192.0.2.1",
    port: 22,
  };
  await ipc("save_profile", { profile });
  await page.getByRole("button", { name: "工作环境", exact: true }).click();
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(
    page.locator(".profile b").filter({ hasText: "桌面冒烟环境" }),
  ).toBeVisible();
  await checkVisuals("environments");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await checkVisuals("environment-dialog");
  await page.getByLabel("SSH 端口", { exact: true }).fill("2222");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  snapshot = await ipc("snapshot");
  expect(snapshot.profiles[0].port).toBe(2222);
  await page.getByRole("button", { name: "模型服务", exact: true }).click();
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
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.setViewportSize({ width: 1180, height: 790 });
  await page.getByRole("button", { name: "添加服务", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /OpenAI \/ ChatGPT API/ })
    .click();
  await page.getByLabel("服务名称").fill("冒烟 API");
  await page.getByLabel("模型 ID").fill("smoke-model");
  await page
    .getByLabel("API Key（留空保留已有值）")
    .fill("smoke-only-not-a-real-key");
  await page.getByLabel("使用 Windows DPAPI 加密保存").check();
  await page.getByRole("button", { name: "保存服务", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("冒烟 API", { exact: true })).toBeVisible();
  snapshot = await ipc("snapshot");
  const service = snapshot.services[profile.id].find(
    (s) => s.name === "冒烟 API",
  );
  expect(snapshot.saved_keys).toContain(service.id);
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
  await page.getByRole("button", { name: "刷新", exact: true }).click();
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
    ["harness", "DeepSeek Harness", "openai"],
    ["gemini", "Gemini CLI", "google"],
    ["opencode", "OpenCode", "deepseek"],
  ]) {
    await page.getByRole("tab", { name, exact: true }).click();
    await page.getByRole("button", { name: "添加服务", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", {
        name:
          provider === "anthropic"
            ? /Anthropic \/ Claude/
            : provider === "google"
              ? /Google \/ Gemini/
              : provider === "deepseek"
                ? /DeepSeek/
                : /OpenAI \/ ChatGPT API/,
      })
      .click();
    await page.getByLabel("服务名称", { exact: true }).fill(`smoke-${tool}`);
    await page.getByLabel("模型 ID", { exact: true }).fill(`model-${tool}`);
    await page
      .getByLabel("API Key（留空保留已有值）")
      .fill("smoke-only-not-a-real-key");
    await page.getByLabel("使用 Windows DPAPI 加密保存").check();
    await page.getByRole("button", { name: "保存服务", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".service-info b")).toHaveText([`smoke-${tool}`]);
    await page.getByRole("button", { name: "使用", exact: true }).click();
    await expect(page.locator(".service-card .active-badge")).toHaveText(
      "当前使用",
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
  await page.getByRole("button", { name: "模型服务", exact: true }).click();
  await page
    .getByRole("tab", { name: "DeepSeek Harness", exact: true })
    .click();
  await expect(page.locator(".service-info b")).toHaveText(["smoke-harness"]);
  await expect(page.locator(".service-card .active-badge")).toHaveText(
    "当前使用",
  );
  const deletedTool = toolServices.find((s) => s.tool === "opencode");
  await ipc("delete_service", {
    profileId: profile.id,
    serviceId: deletedTool.id,
  });
  expect(
    (await ipc("snapshot")).profiles[0].tool_services.opencode,
  ).toBeUndefined();
  await page.getByRole("button", { name: "AI 工具", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "打开 VS Code", exact: true }),
  ).toBeVisible();
  await checkVisuals("tools");
  await page.getByRole("button", { name: "代理网络", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "连接代理", exact: true }),
  ).toBeVisible();
  await checkVisuals("proxy");
  await page.getByRole("button", { name: "总览与任务", exact: true }).click();
  await checkVisuals("overview");
  expect(errors).toEqual([]);
  const stored = JSON.parse(
    await readFile(join(output, "EdgeSSHAI/profiles.json"), "utf8"),
  );
  expect(JSON.stringify(stored)).not.toContain("smoke-only-not-a-real-key");
  expect(stored.client_id).toHaveLength(32);
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
  await ipc("quit_app").catch(() => {});
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
