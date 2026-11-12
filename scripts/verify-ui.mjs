import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
import { mkdir, readFile } from "node:fs/promises";
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
        if (name === "prompt_library")
          return {
            prompts: [
              {
                id: "prompt-example",
                name: "团队编码规范",
                description: "统一代码风格与协作约定",
                content: "# AGENTS.md\n\n使用中文回复，修改后运行相关测试。",
                updated: 1794441600,
              },
            ],
            active: "prompt-example",
            path: "C:\\Users\\Developer\\.codex\\AGENTS.md",
            revision: "demo",
            bytes: 81,
          };
        if (name === "query_sessions") {
          const sessionResult = {
            sessions: [
              {
                key: "0/test.jsonl",
                tool: "codex",
                id: "demo-session",
                title: "为板卡配置工具",
                project: "/home/developer/project",
                modified: Date.parse("2026-11-12T06:24:00Z") / 1000,
                truncated: false,
                resume: "codex resume demo-session",
                messages: [
                  { role: "user", content: "帮我检查板卡环境并配置开发工具。" },
                  {
                    role: "assistant",
                    content:
                      "环境检查已完成，可以开始配置开发工具。\n\n已准备好开发工作空间：\n- 独立安装 Node.js 与 CLI 工具\n- 配置当前工程的模型服务\n- 验证板卡网络连接\n\n使用 `codex` 命令即可继续开发。",
                    timestamp: "2026-11-12T06:01:00Z",
                    model: "gpt-test",
                    steps: [
                      { name: "shell_command", content: "uname -m\naarch64" },
                      {
                        name: "apply_patch",
                        content:
                          "*** Update File: config.json\n+ enabled: true",
                      },
                    ],
                  },
                  {
                    role: "user",
                    content: "继续优化工作环境，让工具切换更方便。",
                    timestamp: "2026-11-12T06:22:00Z",
                  },
                  {
                    role: "assistant",
                    content:
                      "已完成工具切换优化。\n\n1. 保存环境配置。\n2. 选择工具和供应商。\n3. 启动开发终端。",
                    timestamp: "2026-11-12T06:24:00Z",
                  },
                ],
              },
            ],
            warnings: [],
          };
          if (!args.key) {
            const base = sessionResult.sessions[0];
            sessionResult.sessions.push(
              ...Array.from({ length: 9 }, (_, index) => ({
                ...base,
                key: `0/demo-${index}.jsonl`,
                id: `demo-${index}`,
                title: ["优化模型服务切换", "检查远程网络", "搭建可视化面板"][
                  index % 3
                ],
                tool: ["codex", "harness", "claude"][index % 3],
                project: [
                  "/home/developer/project",
                  "/home/developer/Embedded-Visualization",
                  "/home/developer/Remote-STM32",
                ][index % 3],
                modified: base.modified - index * 5000,
              })),
            );
          }
          return sessionResult;
        }
        if (name === "query_usage") {
          const rows = Array.from({ length: 12 }, (_, index) => ({
            id: String(index),
            tool: "codex",
            timestamp: args.start + (17 * 60 + 21 - index) * 60,
            provider: "openai",
            model: "gpt-test",
            input: 224 + index * 200,
            output: 201 + index * 12,
            cached: 187000,
            write: 0,
            cost: null,
          }));
          return {
            totals: {
              requests: 12,
              input: 15888,
              output: 3204,
              cached: 2244000,
              write: 0,
              cost: null,
              priced: 0,
            },
            options: { provider: ["openai"], model: ["gpt-test"] },
            rows,
            trend: Array.from({ length: 24 }, (_, index) => ({
              index,
              tokens: [9, 10, 14, 15, 16, 17].includes(index)
                ? ((index % 5) + 1) * 300000
                : 0,
            })),
            groups: [
              {
                provider: "openai",
                model: "gpt-test",
                requests: 12,
                tokens: 2263092,
              },
            ],
            warnings: [],
          };
        }
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
          if (args.kind === "quick_launch")
            snapshot.list_order.quick_launch = args.ids;
          else if (args.kind === "profiles")
            snapshot.list_order.profiles = args.ids;
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
  await page
    .getByRole("button", { name: "打开 VS Code", exact: true })
    .dragTo(page.getByRole("button", { name: "打开 Codex", exact: true }));
  await expect(page.locator(".launch-tracks button").first()).toHaveAttribute(
    "aria-label",
    "打开 VS Code",
  );
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
  await expect(
    page.getByRole("button", { name: "使用中", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("tab", { name: "DeepSeek Harness", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "启用 DeepSeek 账号", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "会话中心", exact: true }).click();
  await page.getByRole("button", { name: /为板卡配置工具/ }).click();
  await page.getByRole("button", { name: "改动", exact: true }).click();
  await expect(page.locator(".sc-execution")).toContainText("apply_patch");
  await page.getByRole("button", { name: "对话", exact: true }).click();
  await expect(page.locator(".sc-execution")).toHaveCount(0);
  await page.getByRole("button", { name: "全部", exact: true }).click();
  await page.getByRole("button", { name: "查找对话", exact: true }).click();
  await page
    .getByRole("textbox", { name: "查找对话", exact: true })
    .fill("继续优化");
  await expect(page.locator(".sc-message")).toHaveCount(1);
  await page.getByRole("textbox", { name: "查找对话", exact: true }).fill("");
  await page.getByRole("button", { name: "查找对话", exact: true }).click();
  await page.setViewportSize({ width: 980, height: 660 });
  await page.screenshot({
    path: resolve(output, "sessions-reader-compact.png"),
  });
  expect(
    await page
      .locator(".sc-browser")
      .evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await page.setViewportSize({ width: 1180, height: 790 });
  await expect(page.locator(".session-messages")).toContainText(
    "环境检查已完成",
  );
  await page.screenshot({ path: resolve(output, "sessions-light.png") });
  await page.getByRole("button", { name: "返回会话列表", exact: true }).click();
  await page.getByRole("button", { name: "筛选应用", exact: true }).click();
  await page.screenshot({
    path: resolve(output, "sessions-list-app-menu.png"),
  });
  await page.getByRole("menuitemradio", { name: /全部应用/ }).click();
  await page.getByRole("button", { name: /为板卡配置工具/ }).click();
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出 Markdown", exact: true })
    .click();
  const markdown = await downloaded;
  expect(markdown.suggestedFilename()).toBe("session-codex-demo-session.md");
  expect(await readFile(await markdown.path(), "utf8")).toContain(
    "环境检查已完成",
  );
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "开机自启" }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("switch", { name: "关闭时最小化到托盘" }),
  ).toBeChecked();
  await page.screenshot({ path: resolve(output, "settings-general.png") });
  await expect(
    page.getByRole("tab", { name: "授权中心", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("tab", { name: "使用统计", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "授权中心", exact: true }).click();
  await expect(page.locator(".authorization-card")).toHaveCount(5);
  await expect(
    page
      .getByRole("tabpanel", { name: "授权中心", exact: true })
      .getByRole("heading", { name: "授权中心", exact: true }),
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
  await page.getByRole("button", { name: "使用统计", exact: true }).click();
  await expect(page.locator(".usage-table tbody tr")).toHaveCount(12);
  await expect(page.locator(".usage-tools img")).toHaveCount(5);
  await page.screenshot({ path: resolve(output, "usage-light.png") });
  await page.getByRole("tab", { name: /供应商 \/ 模型/ }).click();
  await expect(page.locator(".usage-table tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "☾ 深色", exact: true }).click();
  await page.getByRole("button", { name: "使用统计", exact: true }).click();
  await expect(page.locator(".usage-table tbody tr")).toHaveCount(12);
  await page.screenshot({ path: resolve(output, "usage-dark.png") });
  await page.setViewportSize({ width: 980, height: 660 });
  await page.screenshot({ path: resolve(output, "usage-compact.png") });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.setViewportSize({ width: 1180, height: 790 });
  await page.getByRole("button", { name: "授权中心", exact: true }).click();
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
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "☼ 浅色", exact: true }).click();
  await page.getByRole("button", { name: "☾ 深色", exact: true }).click();
  await page.getByRole("button", { name: "会话中心", exact: true }).click();
  await page.screenshot({ path: resolve(output, "sessions-list-dark.png") });
  await page.getByRole("button", { name: /为板卡配置工具/ }).click();
  await page
    .getByRole("navigation", { name: "对话目录", exact: true })
    .getByRole("button")
    .nth(1)
    .click();
  await expect(page.locator(".sc-outline button").nth(1)).toHaveClass(/active/);
  await page.screenshot({ path: resolve(output, "sessions-reader-dark.png") });
  await page.getByRole("button", { name: "提示词组", exact: true }).click();
  await expect(page.locator(".pg-row")).toContainText("团队编码规范");
  await page.screenshot({ path: resolve(output, "prompts-list-dark.png") });
  await page
    .getByRole("button", { name: "＋ 添加提示词", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "提示词名称", exact: true })
    .fill("团队编码规范");
  await page
    .getByRole("textbox", { name: "提示词正文", exact: true })
    .fill("# AGENTS.md\n\n使用中文回复，修改后运行相关测试。");
  await page.screenshot({ path: resolve(output, "prompts-editor-dark.png") });
  await page.setViewportSize({ width: 980, height: 660 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: resolve(output, "prompts-editor-compact.png"),
  });
  await page.setViewportSize({ width: 1180, height: 790 });
  await page.getByRole("button", { name: "设置", exact: true }).click();
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
