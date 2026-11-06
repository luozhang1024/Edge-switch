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
  let snapshot = await ipc("snapshot");
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
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("SSH 端口", { exact: true }).fill("2222");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  snapshot = await ipc("snapshot");
  expect(snapshot.profiles[0].port).toBe(2222);
  await page.getByRole("button", { name: "模型服务", exact: true }).click();
  await page.getByRole("button", { name: "添加服务", exact: true }).click();
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
  await page.screenshot({ path: join(output, "models.png"), fullPage: true });
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
  await page.getByRole("button", { name: "AI 工具", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "打开 VS Code", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: join(output, "tools.png"), fullPage: true });
  await page.getByRole("button", { name: "代理网络", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "连接代理", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: join(output, "proxy.png"), fullPage: true });
  await page.getByRole("button", { name: "总览与任务", exact: true }).click();
  await page.screenshot({ path: join(output, "overview.png"), fullPage: true });
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
        checks: [
          "native startup",
          "bundled logo",
          "environment edit",
          "API CRUD and DPAPI",
          "active API synchronization",
          "busy mutation rejected",
          "task cancellation",
          "tools and proxy pages",
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
