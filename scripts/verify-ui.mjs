import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer as createNetServer } from "node:net";
import { once } from "node:events";

const output = resolve("build/ui-verification");
await mkdir(output, { recursive: true });
const portProbe = createNetServer();
portProbe.listen(0, "127.0.0.1");
await once(portProbe, "listening");
const port = portProbe.address().port;
await new Promise((done) => portProbe.close(done));
const server = await createServer({
  server: { host: "127.0.0.1", port, strictPort: true },
});
await server.listen();
const browser = await chromium.launch({
  channel: process.platform === "win32" ? "msedge" : undefined,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1180, height: 790 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const profile = {
      id: "a".repeat(32),
      name: "LPB3568",
      host: "board.local",
      user: "developer",
      port: 22,
      project: "/home/developer/project",
      identity: "",
      base_url: "",
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
    };
    const second = { ...profile, id: "b".repeat(32), name: "Linux Board" };
    const snapshot = {
      profiles: [profile, second],
      selected_profile: profile.id,
      services: { [profile.id]: [], [second.id]: [] },
      official: {},
      saved_keys: [],
      tasks: [],
      version: "2.0.0-alpha.6",
      preferences: {
        theme: "light",
        motion: true,
        home_tools: ["codex", "claude", "harness", "gemini", "opencode"],
      },
      list_order: {},
    };
    const callbacks = new Map();
    const listeners = new Map();
    let sequence = 0;
    const emit = (name, payload) =>
      callbacks.get(listeners.get(name))?.({ payload });
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      transformCallback(callback) {
        const id = ++sequence;
        callbacks.set(id, callback);
        return id;
      },
      async invoke(name, args = {}) {
        if (name === "local_harness_account")
          return {
            signed_in: true,
            name: "Harness 用户",
            contact: "191****96",
            wallets: [{ currency: "CNY", balance: "11.08" }],
            bonus_wallets: [],
            checked_at: 1800000000,
          };
        if (name === "snapshot") return structuredClone(snapshot);
        if (name === "connection_status") return {};
        if (name === "plugin:event|listen") {
          listeners.set(args.event, args.handler);
          return ++sequence;
        }
        if (name === "save_profile") {
          const index = snapshot.profiles.findIndex(
            (p) => p.id === args.profile.id,
          );
          if (index < 0) snapshot.profiles.push(args.profile);
          else snapshot.profiles[index] = args.profile;
        }
        if (name === "select_profile") snapshot.selected_profile = args.id;
        if (name === "save_service")
          snapshot.services[args.profileId].push(args.entry);
        if (name === "activate_service") {
          const p = snapshot.profiles.find((p) => p.id === args.profileId);
          p.active_api = args.serviceId;
          p.codex_auth = "api";
        }
        if (name === "reorder_items") {
          if (args.kind === "profiles") snapshot.list_order.profiles = args.ids;
          else {
            snapshot.list_order.services ||= {};
            snapshot.list_order.services[args.profileId] ||= {};
            snapshot.list_order.services[args.profileId][args.tool] = args.ids;
          }
        }
        if (name === "start_task") {
          const task = {
            id: String(++sequence),
            profile_id: args.profileId,
            label: "检查设备",
            state: "运行中",
            message: "正在连接板卡",
            result: null,
            started_at: 1,
          };
          snapshot.tasks.push(task);
          setTimeout(() => {
            task.state = "已完成";
            task.message = "设备正常";
            task.result = { arch: "aarch64", ssh: true };
            emit("task-finished", { id: task.id });
          }, 300);
          return structuredClone(task);
        }
        if (name === "save_preferences")
          snapshot.preferences = args.preferences;
        return null;
      },
    };
  });
  await page.goto(server.resolvedUrls.local[0]);
  await expect(
    page.getByRole("button", { name: "配置工作环境" }),
  ).toBeVisible();
  await expect(page.locator(".studio-status")).toHaveCount(0);
  await expect(page.locator(".waveform i").first()).not.toHaveCSS(
    "animation-name",
    "none",
  );
  const settingsSize = await page
    .getByRole("button", { name: "设置", exact: true })
    .locator("svg")
    .boundingBox();
  expect(settingsSize.width).toBe(settingsSize.height);
  await page.screenshot({ path: resolve(output, "home.png") });
  await page.getByRole("button", { name: "检查设备", exact: true }).click();
  const progress = page.getByRole("dialog", { name: "检查设备" });
  await expect(progress).toBeVisible();
  await expect(progress).toContainText("设备正常");
  await expect(progress).toContainText("aarch64");
  await page.screenshot({ path: resolve(output, "task-result.png") });
  await progress
    .getByRole("button", { name: "关闭", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: "配置工作环境" }).click();
  const rows = page.locator(".profile-list .profile");
  await page.mouse.move(0, 0);
  await expect(rows.first().locator(".profile-actions")).toHaveCSS(
    "opacity",
    "0",
  );
  await rows.first().hover();
  await expect(rows.first().locator(".profile-actions")).toHaveCSS(
    "opacity",
    "1",
  );
  await page.screenshot({ path: resolve(output, "environment-hover.png") });
  await rows.nth(1).dragTo(rows.nth(0));
  await expect(rows.first().locator("b")).toHaveText("Linux Board");
  await rows.first().hover();
  await rows.first().getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "编辑工作环境" });
  await editor.getByRole("tab", { name: "AI 工具", exact: true }).click();
  await expect(
    editor.getByRole("button", { name: "查询可用版本", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: resolve(output, "environment-tools.png") });
  await editor.getByRole("tab", { name: "代理连接", exact: true }).click();
  await expect(
    editor.getByRole("button", { name: "连接代理", exact: true }),
  ).toBeVisible();
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "模型服务", exact: true }).click();
  await page.mouse.move(0, 0);
  await expect(page.locator(".service-actions")).toHaveCSS("opacity", "0");
  await page.locator(".service-card").hover();
  await expect(page.locator(".service-actions")).toHaveCSS("opacity", "1");
  await page.evaluate(async () => {
    const data = await window.__TAURI_INTERNALS__.invoke("snapshot");
    await window.__TAURI_INTERNALS__.invoke("save_service", {
      profileId: data.selected_profile,
      entry: {
        id: "c".repeat(32),
        name: "Custom API",
        base_url: "https://example.com/v1",
        model: "test-model",
        protocol: "responses",
        tool: "codex",
      },
    });
  });
  const serviceRows = page.locator(".service-card");
  await expect(serviceRows).toHaveCount(2);
  await serviceRows.nth(1).dragTo(serviceRows.nth(0));
  await expect(serviceRows.first().locator(".service-info b")).toHaveText(
    "Custom API",
  );
  await serviceRows.first().hover();
  await serviceRows
    .first()
    .getByRole("button", { name: "启用", exact: true })
    .click();
  await expect(
    serviceRows.first().getByRole("button", { name: "使用中", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: resolve(output, "model-reordered.png") });
  await page.getByRole("tab", { name: "Claude Code", exact: true }).click();
  await expect(page.locator(".service-info b")).toHaveText("Claude Official");
  await page.screenshot({ path: resolve(output, "claude-official.png") });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "开机自启" }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("switch", { name: "关闭时最小化到托盘" }),
  ).toBeChecked();
  await page.screenshot({ path: resolve(output, "settings-general.png") });
  await page.getByRole("tab", { name: "授权中心", exact: true }).click();
  await expect(page.locator(".authorization-card")).toHaveCount(5);
  await expect(
    page.getByRole("heading", { name: "授权中心", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "ChatGPT 登录方式" }),
  ).toHaveValue("browser");
  await expect(page.getByText("11.08 CNY")).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".authorization-brand img")
        .evaluateAll((images) =>
          images.every((img) => img.complete && img.naturalWidth > 0),
        ),
    )
    .toBe(true);
  await page.screenshot({
    path: resolve(output, "authorization-light.png"),
    fullPage: true,
  });
  await page
    .getByRole("region", { name: "DeepSeek Harness", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: resolve(output, "authorization-harness-light.png"),
  });
  await page.getByRole("tab", { name: "通用", exact: true }).click();
  await page.getByRole("button", { name: "☾ 深色", exact: true }).click();
  await page.getByRole("tab", { name: "授权中心", exact: true }).click();
  await expect(page.locator(".authorization-brand img").first()).toHaveCSS(
    "filter",
    "invert(1)",
  );
  await page.screenshot({
    path: resolve(output, "authorization-dark.png"),
    fullPage: true,
  });
  await page
    .getByRole("region", { name: "DeepSeek Harness", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: resolve(output, "authorization-harness-dark.png"),
  });
  await page.setViewportSize({ width: 980, height: 660 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: resolve(output, "authorization-compact.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1180, height: 790 });
  await page.getByRole("tab", { name: "通用", exact: true }).click();
  await page.getByRole("button", { name: "☼ 浅色", exact: true }).click();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "General", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("switch", { name: "Start at login" }),
  ).toBeVisible();
  await page.screenshot({ path: resolve(output, "settings-english.png") });
  await page
    .getByRole("button", { name: "← Back to studio", exact: true })
    .click();
  await page.getByRole("combobox", { name: "Switch workspace" }).click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("combobox", { name: "Switch workspace" }),
  ).toHaveCSS("border-radius", "0px");
  await expect(
    page.getByRole("combobox", { name: "Switch workspace" }),
  ).toHaveCSS("outline-style", "none");
  await page.screenshot({ path: resolve(output, "home-english.png") });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "中文", exact: true }).click();
  await page.getByRole("tab", { name: "日志", exact: true }).click();
  await expect(page.locator(".task-history")).toContainText("检查设备");
  await page.setViewportSize({ width: 980, height: 660 });
  await page.screenshot({ path: resolve(output, "settings-compact.png") });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  expect(errors).toEqual([]);
  console.log(`UI verification passed. Screenshots: ${output}`);
} finally {
  await browser.close();
  await server.close();
}
