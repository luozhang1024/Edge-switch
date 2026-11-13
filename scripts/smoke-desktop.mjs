import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
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
await mkdir(join(output, "native-home/AppData/Local"), { recursive: true });
await mkdir(join(output, "native-home/AppData/Roaming"), { recursive: true });
const sessionRoot = join(output, "native-home/.codex/sessions");
await mkdir(sessionRoot, { recursive: true });
await writeFile(
  join(sessionRoot, "smoke-session.jsonl"),
  [
    {
      type: "session_meta",
      payload: {
        id: "desktop-smoke",
        cwd: output,
        model_provider: "smoke-api",
        base_instructions: "x".repeat(24000),
      },
    },
    { type: "turn_context", payload: { model: "smoke-model" } },
    {
      type: "response_item",
      payload: {
        role: "user",
        content: [{ type: "input_text", text: "桌面会话验证" }],
      },
    },
    {
      type: "response_item",
      payload: {
        role: "assistant",
        content: [{ type: "output_text", text: "会话读取正常" }],
      },
    },
    {
      type: "event_msg",
      timestamp: new Date().toISOString(),
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 100,
            output_tokens: 20,
            cached_input_tokens: 30,
          },
        },
      },
    },
  ]
    .map(JSON.stringify)
    .join("\n"),
);
await writeFile(
  join(output, "native-home/.codex/config.toml"),
  "model_provider='smoke-api'\nmodel='smoke-model'\n[model_providers.smoke-api]\nname='Smoke API'\nbase_url='https://example.com/v1'\n",
);
await writeFile(
  join(output, "native-home/.codex/AGENTS.md"),
  "# Imported instructions\nPreserve original content.\n",
);
const smokeSkill = join(output, "native-home/.codex/skills/smoke-skill");
await mkdir(join(smokeSkill, "scripts"), { recursive: true });
await writeFile(
  join(smokeSkill, "SKILL.md"),
  "---\nname: Smoke Skill\ndescription: Desktop skill verification\n---\nInstructions\n",
);
await writeFile(join(smokeSkill, "scripts/run.py"), "print('fixture')\n");
const server = createServer();
server.listen(0, "127.0.0.1");
await once(server, "listening");
const port = server.address().port;
await new Promise((r) => server.close(r));
const env = {
  ...process.env,
  LOCALAPPDATA: output,
  USERPROFILE: join(output, "native-home"),
  HOME: join(output, "native-home"),
  CODEX_HOME: join(output, "native-home/.codex"),
  DSH_HOME: join(output, "native-home/.dsh"),
  CLAUDE_CONFIG_DIR: join(output, "native-home/.claude"),
  GEMINI_CLI_HOME: join(output, "native-home"),
  XDG_DATA_HOME: join(output, "native-home/.local/share"),
  XDG_CONFIG_HOME: join(output, "native-home/.config"),
  WEBVIEW2_USER_DATA_FOLDER: join(output, "webview"),
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`,
};
const child = spawn(exe, [], {
  env,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let diagnostics = "";
child.stdout.on("data", (d) => {
  diagnostics += d;
});
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
  expect(snapshot.profiles[0].kind).toBe("local");
  const nativeConfig = await ipc("native_tool_config", {
    profileId: snapshot.selected_profile,
  });
  expect(nativeConfig.provider).toBe("smoke-api");
  const proxiedRequests = [];
  const fixtureProxy = createHttpServer((request, response) => {
    proxiedRequests.push({
      url: request.url,
      auth: request.headers.authorization,
      proxyAuth: request.headers["proxy-authorization"],
    });
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ data: [{ id: "proxy-fixture-model" }] }));
  });
  fixtureProxy.on("connect", (request, socket) => {
    proxiedRequests.push({
      url: request.url,
      proxyAuth: request.headers["proxy-authorization"],
    });
    socket.end("HTTP/1.1 502 Fixture endpoint\r\nConnection: close\r\n\r\n");
  });
  fixtureProxy.listen(0, "127.0.0.1");
  await once(fixtureProxy, "listening");
  const fixtureProxyPort = fixtureProxy.address().port;
  try {
    const network = await ipc("network_settings", {
      action: "save",
      payload: {
        endpoint: `http://127.0.0.1:${fixtureProxyPort}`,
        username: "fixture",
        password: "fixture-proxy-secret",
      },
    });
    expect(network.has_password).toBe(true);
    expect(JSON.stringify(network)).not.toContain("fixture-proxy-secret");
    // Deliberately reject CONNECT: verify routing without contacting an API or
    // weakening certificate validation to accommodate a fixture certificate.
    await expect(
      ipc("fetch_models", {
        profileId: snapshot.selected_profile,
        serviceId: null,
        baseUrl: "https://models.fixture.invalid/v1",
        protocol: "responses",
        key: "fixture-api-key",
      }),
    ).rejects.toBeTruthy();
    expect(proxiedRequests[0].url).toContain("models.fixture.invalid");
    expect(proxiedRequests[0].proxyAuth).toMatch(/^Basic /);
    expect(
      await readFile(join(output, "EdgeSSHAI/network.json"), "utf8"),
    ).not.toContain("fixture-proxy-secret");
  } finally {
    await ipc("network_settings", {
      action: "save",
      payload: { endpoint: "", username: "", password: "" },
    });
    await new Promise((resolve) => fixtureProxy.close(resolve));
  }
  const localId = snapshot.selected_profile;
  for (const tool of ["kimi", "grok", "qwen"]) {
    const entry = {
      id: { kimi: "d", grok: "e", qwen: "f" }[tool].repeat(32),
      tool,
      provider: "custom",
      scope: "cli",
      name: `${tool} fixture`,
      base_url: "https://fixture.example/v1",
      model: "fixture-model",
      protocol: tool === "kimi" ? "anthropic" : "chat",
    };
    await ipc("save_service", {
      profileId: localId,
      entry,
      key: "fixture-tool-key",
      remember: true,
    });
    await ipc("activate_service", {
      profileId: localId,
      serviceId: entry.id,
      tool,
    });
    const task = await ipc("start_task", {
      profileId: localId,
      action: "sync_api",
      payload: { tool },
    });
    await expect
      .poll(
        async () =>
          (await ipc("snapshot")).tasks.find((t) => t.id === task.id)?.state,
      )
      .toBe("已完成");
    const configPath = {
      kimi: ".kimi/config.toml",
      grok: ".grok/user-settings.json",
      qwen: ".qwen/settings.json",
    }[tool];
    const config = await readFile(
      join(output, "native-home", configPath),
      "utf8",
    );
    expect(config).toContain("fixture-model");
    expect(config).toContain("https://fixture.example/v1");
  }
  const nativeFile = join(output, "native-home/.codex/config.toml");
  const nativeBefore = await readFile(nativeFile, "utf8");
  const officialDraft = await ipc("official_provider", {
    profileId: localId,
    tool: "codex",
    action: "get",
    payload: {},
  });
  await ipc("official_provider", {
    profileId: localId,
    tool: "codex",
    action: "save",
    payload: {
      ...officialDraft,
      name: "OpenAI Official",
      website: "https://chatgpt.com/codex",
      note: "fixture",
      config_text: '[mcp_servers.fixture]\ncommand="node"\n',
      max_threads: 6,
    },
  });
  expect(await readFile(nativeFile, "utf8")).toBe(nativeBefore);
  const localProfile = (await ipc("snapshot")).profiles.find(
    (p) => p.id === localId,
  );
  await ipc("save_profile", {
    profile: { ...localProfile, codex_auth: "chatgpt" },
  });
  const activeDraft = await ipc("official_provider", {
    profileId: localId,
    tool: "codex",
    action: "get",
    payload: {},
  });
  await ipc("official_provider", {
    profileId: localId,
    tool: "codex",
    action: "save",
    payload: {
      ...activeDraft,
      name: "OpenAI Official",
      config_text: '[mcp_servers.fixture]\ncommand="node"\n',
      max_threads: 6,
    },
  });
  const nativeAfter = await readFile(nativeFile, "utf8");
  expect(nativeAfter).toContain('forced_login_method = "chatgpt"');
  expect(nativeAfter).toContain("max_threads = 6");
  expect(nativeAfter).toContain("model_providers.smoke-api");
  await ipc("save_profile", { profile: localProfile });
  await writeFile(nativeFile, nativeBefore);
  // Occupy the callback port so the real browser task can be exercised without
  // opening a sign-in page or requesting credentials from the test runner.
  const callbackBlocker = createServer();
  const callbackOccupied = new Promise((resolve, reject) => {
    callbackBlocker.once("listening", () => resolve(true));
    callbackBlocker.once("error", (error) =>
      error.code === "EADDRINUSE" ? resolve(false) : reject(error),
    );
  });
  callbackBlocker.listen(1455, "127.0.0.1");
  const ownsCallbackPort = await callbackOccupied;
  try {
    const loginTask = await ipc("start_task", {
      profileId: localId,
      action: "login_browser",
      payload: {},
    });
    await expect
      .poll(
        async () =>
          (await ipc("snapshot")).tasks.find((t) => t.id === loginTask.id)
            ?.state,
      )
      .toBe("失败");
    expect(
      (await ipc("snapshot")).tasks.find((t) => t.id === loginTask.id).message,
    ).toContain("1455");
  } finally {
    if (ownsCallbackPort)
      await new Promise((resolve) => callbackBlocker.close(resolve));
  }
  const statusTask = await ipc("start_task", {
    profileId: localId,
    action: "auth_status",
    payload: {},
  });
  await expect
    .poll(
      async () =>
        (await ipc("snapshot")).tasks.find((t) => t.id === statusTask.id)
          ?.state,
    )
    .toBe("已完成");
  const skillsArgs = { profileId: localId, payload: {} };
  const authFixture = join(output, "native-home/.codex/auth.json");
  await writeFile(
    authFixture,
    JSON.stringify({
      OPENAI_API_KEY: "fixture-api-key",
      tokens: { access_token: "fixture-token" },
      auth_mode: "chatgpt",
      last_refresh: "2026-11-13",
    }),
  );
  await ipc("logout_account", { profileId: localId, tool: "codex" });
  expect(JSON.parse(await readFile(authFixture, "utf8"))).toEqual({
    OPENAI_API_KEY: "fixture-api-key",
  });
  const harnessHome = join(output, "native-home/.dsh");
  await mkdir(harnessHome, { recursive: true });
  const harnessFixture = join(harnessHome, ".credentials.yaml");
  await writeFile(
    harnessFixture,
    JSON.stringify({
      version: 1,
      records: {
        "deepseek-account-platform/default": { kind: "grant", payload: {} },
        "unrelated-account": { kind: "fixture", payload: { keep: true } },
      },
    }),
  );
  await ipc("logout_account", { profileId: localId, tool: "harness" });
  const remainingCredentials = await readFile(harnessFixture, "utf8");
  expect(remainingCredentials).not.toContain(
    "deepseek-account-platform/default",
  );
  expect(remainingCredentials).toContain("unrelated-account");
  let skillList = await ipc("skills_request", {
    ...skillsArgs,
    action: "list",
  });
  expect(skillList.candidates.some((s) => s.id === "smoke-skill")).toBe(true);
  await navigate("Skills 技能");
  await expect(
    page.getByRole("heading", { name: "还没有 Skill" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "添加 Skill" }).click();
  await checkVisuals("skills-empty-menu");
  await page.getByRole("menuitem", { name: /导入本机已有/ }).click();
  const skillDialog = page.getByRole("dialog", { name: "导入本机已有" });
  await skillDialog
    .locator("article")
    .filter({ hasText: "Smoke Skill" })
    .getByRole("button", { name: "导入", exact: true })
    .click();
  await expect(
    skillDialog.locator("article").filter({ hasText: "Smoke Skill" }),
  ).toHaveCount(0);
  await skillDialog.getByRole("button", { name: "关闭", exact: true }).click();
  const claudeSkillSwitch = page.getByRole("switch", {
    name: "Smoke Skill · Claude Code",
  });
  await claudeSkillSwitch.click();
  await expect(claudeSkillSwitch).toBeChecked();
  const deployedSkill = join(
    output,
    "native-home/.claude/skills/smoke-skill/scripts/run.py",
  );
  expect(await readFile(deployedSkill, "utf8")).toBe("print('fixture')\n");
  await checkVisuals("skills-installed");
  await claudeSkillSwitch.click();
  await expect(claudeSkillSwitch).not.toBeChecked();
  expect(await readFile(join(smokeSkill, "SKILL.md"), "utf8")).toContain(
    "Instructions",
  );
  skillList = await ipc("skills_request", { ...skillsArgs, action: "list" });
  expect(skillList.skills.find((s) => s.id === "smoke-skill").enabled).toEqual([
    "codex",
  ]);
  const skillZip = join(output, "skill-fixture.zip");
  await writeFile(
    skillZip,
    Buffer.from(
      "UEsDBBQAAAAAAE5fbV1J4mc+JAAAACQAAAASAAAAemlwLXNraWxsL1NLSUxMLm1kLS0tCm5hbWU6IFpJUCBTa2lsbAotLS0KSW5zdHJ1Y3Rpb25zUEsBAhQAFAAAAAAATl9tXUniZz4kAAAAJAAAABIAAAAAAAAAAAAAAIABAAAAAHppcC1za2lsbC9TS0lMTC5tZFBLBQYAAAAAAQABAEAAAABUAAAAAAA=",
      "base64",
    ),
  );
  expect(
    await ipc("skills_request", {
      profileId: localId,
      action: "install_zip",
      payload: { path: skillZip },
    }),
  ).toEqual({ installed: 1, skipped: 0 });
  expect(
    await ipc("skills_request", {
      profileId: localId,
      action: "install_zip",
      payload: { path: skillZip },
    }),
  ).toEqual({ installed: 0, skipped: 1 });
  const nativeUsage = await ipc("query_usage", {
    profileId: snapshot.selected_profile,
    start: Date.now() / 1000 - 86400,
    end: Date.now() / 1000 + 86400,
    tool: null,
    provider: null,
    model: null,
    page: 0,
  });
  expect(nativeUsage.totals.input).toBe(70);
  expect(nativeUsage.totals.cached).toBe(30);
  expect(nativeUsage.totals.output).toBe(20);
  const nativeSessions = await ipc("query_sessions", {
    profileId: snapshot.selected_profile,
    key: null,
  });
  expect(nativeSessions.sessions[0].project).toBe(output);
  expect(nativeSessions.sessions[0].provider).toBe("smoke-api");
  expect(nativeSessions.sessions[0].usage.requests).toBe(1);
  await navigate("工具安装");
  await expect(page.locator(".ti-row")).toHaveCount(12);
  await expect(page.locator(".ti-page")).toHaveAttribute("aria-busy", "false", {
    timeout: 95000,
  });
  await page
    .getByRole("combobox", { name: "工具分类", exact: true })
    .selectOption("ai");
  await expect(page.locator(".ti-row")).toHaveCount(9);
  const visibilitySwitch = page.getByRole("switch", {
    name: "在模型服务中显示 Claude Code",
    exact: true,
  });
  await visibilitySwitch.click();
  await expect(visibilitySwitch).not.toBeChecked();
  await navigate("模型服务");
  for (const name of [
    "Kimi Code",
    "Grok CLI",
    "Qwen Code",
    "GitHub Copilot CLI",
  ]) {
    await expect(page.getByRole("tab", { name, exact: true })).toBeVisible();
  }
  expect(
    await page
      .locator(".profile")
      .evaluateAll((rows) =>
        rows.every(
          (row) => !/^\d/.test(getComputedStyle(row, "::before").content),
        ),
      ),
  ).toBe(true);
  await expect(
    page.getByRole("tab", { name: "Claude Code", exact: true }),
  ).toHaveCount(0);
  await navigate("工具安装");
  await page
    .getByRole("switch", { name: "在模型服务中显示 Claude Code", exact: true })
    .click();
  await expect(visibilitySwitch).toBeChecked();
  await page
    .getByRole("combobox", { name: "工具分类", exact: true })
    .selectOption("all");
  await expect(
    page.getByRole("button", { name: "安装独立 Node.js", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".ti-page")).toHaveAttribute("aria-busy", "false", {
    timeout: 95000,
  });
  await checkVisuals("tools-local");
  await navigate("使用统计");
  await page.getByRole("button", { name: "设置单价", exact: true }).click();
  await page
    .getByRole("combobox", { name: "计价供应商", exact: true })
    .fill("smoke-api");
  await page
    .getByRole("combobox", { name: "计价模型", exact: true })
    .fill("smoke-model");
  await page
    .getByRole("spinbutton", { name: "新增输入单价", exact: true })
    .fill("2");
  await page
    .getByRole("spinbutton", { name: "输出单价", exact: true })
    .fill("10");
  await page
    .getByRole("spinbutton", { name: "缓存读取单价", exact: true })
    .fill("0.1");
  await page
    .getByRole("spinbutton", { name: "缓存写入单价", exact: true })
    .fill("0");
  await page.getByRole("button", { name: "保存单价", exact: true }).click();
  await expect(page.locator(".usage-cost-coverage")).toContainText("估算 1");
  await expect(page.locator(".usage-metrics")).toContainText("$0.0003");
  const pricedUsage = await ipc("query_usage", {
    profileId: snapshot.selected_profile,
    start: Date.now() / 1000 - 86400,
    end: Date.now() / 1000 + 86400,
    tool: null,
    provider: null,
    model: null,
    page: 0,
  });
  expect(pricedUsage.totals.cost).toBeCloseTo(0.000343, 9);
  expect(pricedUsage.totals.estimated).toBe(1);
  expect(pricedUsage.totals.unpriced).toBe(0);
  await checkVisuals("usage-cost-pricing");
  await page.getByRole("button", { name: "恢复参考单价", exact: true }).click();
  await expect(page.locator(".usage-cost-coverage")).toContainText("未计价 1");
  await navigate("模型服务");
  await expect(
    page.getByRole("region", { name: "本机 Codex 配置" }),
  ).toContainText("Smoke API");
  await expect(
    page.getByRole("region", { name: "本机 Codex 配置" }),
  ).toContainText("smoke-model");
  await checkVisuals("native-codex-config");
  await page
    .getByRole("button", { name: "编辑 / 导入 auth.json", exact: true })
    .click();
  await expect(
    page.getByLabel("config.toml (TOML)", { exact: true }),
  ).toBeEditable();
  await expect(
    page.getByLabel("子代理并发上限", { exact: true }),
  ).toBeVisible();
  await checkVisuals("official-codex-editor");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("tab", { name: "Claude Code", exact: true }).click();
  await page
    .getByRole("button", { name: "编辑官方供应商", exact: true })
    .click();
  await expect(
    page.getByLabel("settings.json (JSON)", { exact: true }),
  ).toBeEditable();
  await checkVisuals("official-claude-editor");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("tab", { name: "Codex", exact: true }).click();
  const nativeCard = page.getByRole("region", { name: "本机 Codex 配置" });
  await expect(
    nativeCard.getByRole("button", { name: "编辑本机供应商" }),
  ).toBeVisible();
  await nativeCard.getByRole("button", { name: "编辑本机供应商" }).click();
  await page
    .getByRole("textbox", { name: "名称", exact: true })
    .fill("Smoke API Edited");
  await nativeCard.getByRole("button", { name: "保存", exact: true }).click();
  await expect(nativeCard).toContainText("Smoke API Edited");
  expect(
    await readFile(join(output, "native-home/.codex/config.toml"), "utf8"),
  ).toContain("Smoke API Edited");
  // The remaining source/session checks continue using the same provider id.
  await ipc("native_provider_action", {
    profileId: localId,
    action: "duplicate",
    payload: { provider: "smoke-api" },
  });
  expect(
    (await ipc("snapshot")).services[localId].some(
      (s) => s.name === "Smoke API Edited 副本",
    ),
  ).toBe(true);
  await navigate("使用统计");
  await page
    .getByRole("combobox", { name: "统计时间范围" })
    .selectOption("all");
  await expect(
    page.getByRole("region", { name: "全部用量热力图" }),
  ).toBeVisible();
  expect(await page.locator(".heatmap-cell").count()).toBeGreaterThanOrEqual(
    365,
  );
  await checkVisuals("usage-all-heatmap");
  await navigate("工具安装");
  for (const name of [
    "Kimi Code",
    "Grok CLI",
    "Qwen Code",
    "GitHub Copilot CLI",
  ])
    await expect(
      page.locator(".ti-row").filter({ hasText: name }),
    ).toBeVisible();
  await checkVisuals("coding-tool-catalog");
  await page.getByRole("button", { name: "← 返回唱片台" }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("tab", { name: "高级", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "全局出站代理" }),
  ).toBeVisible();
  await checkVisuals("global-network-settings");
  await page.keyboard.press("Escape");
  await navigate("会话中心");
  await expect(page.locator(".sc-session-row")).toContainText("120 Tokens");
  await page.getByRole("button", { name: /桌面会话验证/ }).click();
  await expect(page.locator(".session-messages")).toContainText("会话读取正常");
  await expect(page.locator(".sc-session-meta")).toContainText("smoke-api");
  await expect(page.locator(".sc-session-meta")).toContainText("120 Tokens");
  await checkVisuals("sessions-native");
  await page.keyboard.press("Escape");
  await navigate("提示词组");
  await expect(page.locator(".pg-row")).toHaveCount(1);
  await expect(page.locator(".pg-row")).toContainText("已启用");
  await expect(page.locator(".pg-target")).toContainText("AGENTS.md");
  await page
    .getByRole("button", { name: "＋ 添加提示词", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "提示词名称", exact: true })
    .fill("桌面提示词验证");
  await page
    .getByRole("textbox", { name: "提示词说明", exact: true })
    .fill("验证新增、编辑和工具隔离");
  await page
    .getByRole("textbox", { name: "提示词正文", exact: true })
    .fill("# Test instructions\nUse Chinese.\n");
  await checkVisuals("prompts-editor");
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await expect(page.locator(".pg-row")).toHaveCount(2);
  const promptRow = page
    .locator(".pg-row")
    .filter({ hasText: "桌面提示词验证" });
  await promptRow.getByRole("button", { name: "启用", exact: true }).click();
  await expect(promptRow).toContainText("已启用");
  expect(
    await readFile(join(output, "native-home/.codex/AGENTS.md"), "utf8"),
  ).toBe("# Test instructions\nUse Chinese.\n");
  await checkVisuals("prompts-list");
  await page
    .getByRole("textbox", { name: "搜索提示词", exact: true })
    .fill("不存在的提示词");
  await expect(page.locator(".pg-row")).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "搜索提示词", exact: true })
    .fill("Use Chinese");
  await expect(page.locator(".pg-row")).toHaveCount(1);
  await page.getByRole("textbox", { name: "搜索提示词", exact: true }).fill("");
  await promptRow
    .getByRole("button", { name: "编辑提示词 桌面提示词验证", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "提示词正文", exact: true })
    .fill("# Updated instructions\n");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".pg-editor")).toHaveCount(0);
  expect(
    await readFile(join(output, "native-home/.codex/AGENTS.md"), "utf8"),
  ).toBe("# Updated instructions\n");
  await promptRow.getByRole("button", { name: "停用", exact: true }).click();
  await expect(page.locator(".pg-row.enabled")).toHaveCount(0);
  expect(
    await readFile(join(output, "native-home/.codex/AGENTS.md"), "utf8"),
  ).toBe("");
  await page
    .getByRole("combobox", { name: "提示词工具", exact: true })
    .selectOption("claude");
  await expect(page.locator(".pg-row")).toHaveCount(0);
  await expect(page.locator(".pg-target")).toContainText("CLAUDE.md");
  await page
    .getByRole("combobox", { name: "提示词工具", exact: true })
    .selectOption("codex");
  await expect(page.locator(".pg-row")).toHaveCount(2);
  const promptArgs = {
    profileId: snapshot.selected_profile,
    tool: "codex",
    action: "list",
    id: null,
    prompt: null,
    revision: null,
  };
  const savedPrompts = await ipc("prompt_library", promptArgs);
  expect(savedPrompts.active).toBeNull();
  expect(
    savedPrompts.prompts.find((p) => p.name === "桌面提示词验证").content,
  ).toBe("# Updated instructions\n");
  await writeFile(
    join(output, "native-home/.codex/AGENTS.md"),
    "External edit\n",
  );
  let staleRejected = false;
  try {
    await ipc("prompt_library", {
      ...promptArgs,
      action: "enable",
      id: savedPrompts.prompts[0].id,
      revision: savedPrompts.revision,
    });
  } catch {
    staleRejected = true;
  }
  expect(staleRejected).toBe(true);
  expect(
    await readFile(join(output, "native-home/.codex/AGENTS.md"), "utf8"),
  ).toBe("External edit\n");
  const refreshed = await ipc("prompt_library", promptArgs);
  expect(refreshed.prompts.some((p) => p.content === "External edit\n")).toBe(
    true,
  );
  const inactivePrompt = refreshed.prompts.find(
    (p) => p.name === "桌面提示词验证",
  );
  const deletedPrompt = await ipc("prompt_library", {
    ...promptArgs,
    action: "delete",
    id: inactivePrompt.id,
    revision: refreshed.revision,
  });
  expect(deletedPrompt.prompts.some((p) => p.id === inactivePrompt.id)).toBe(
    false,
  );
  expect(
    await readFile(join(output, "native-home/.codex/AGENTS.md"), "utf8"),
  ).toBe("External edit\n");
  const reopenedPrompts = await ipc("prompt_library", promptArgs);
  expect(reopenedPrompts.prompts.some((p) => p.id === inactivePrompt.id)).toBe(
    false,
  );
  await page.getByRole("button", { name: "← 返回唱片台", exact: true }).click();
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
    id: "d".repeat(32),
    kind: "ssh",
    user: "developer",
    project: "/home/developer/project",
    name: "桌面冒烟环境",
    host: "192.0.2.1",
    port: 22,
  };
  await ipc("save_profile", { profile });
  await ipc("select_profile", { id: profile.id });
  await ipc("reorder_items", {
    kind: "profiles",
    ids: [profile.id, snapshot.selected_profile],
  });
  await navigate("工作环境");
  await expect(
    page.locator(".profile b").filter({ hasText: "桌面冒烟环境" }),
  ).toBeVisible();
  await checkVisuals("environments");
  await page.locator(".profile-list .profile").first().hover();
  await page
    .locator(".profile-list .profile")
    .first()
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  await checkVisuals("environment-dialog");
  await page.getByLabel("SSH 端口", { exact: true }).fill("2222");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator("dialog:not(.workspace-sheet)")).toHaveCount(0);
  snapshot = await ipc("snapshot");
  expect(snapshot.profiles.find((p) => p.id === profile.id).port).toBe(2222);
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
  await expect(row.locator(".service-actions")).toHaveCSS("opacity", "1");
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
  expect(updated.profiles.find((p) => p.id === profile.id).model).toBe(
    "smoke-model",
  );
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
  expect(
    (await ipc("snapshot")).profiles.find((p) => p.id === profile.id).model,
  ).toBe("updated-smoke-model");
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
  const codexBefore = (await ipc("snapshot")).profiles.find(
    (p) => p.id === profile.id,
  );
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
          claude: "Anthropic API",
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
    expect(
      state.profiles.find((p) => p.id === profile.id).tool_services[tool],
    ).toBe(entry.id);
    expect(state.profiles.find((p) => p.id === profile.id).active_api).toBe(
      codexBefore.active_api,
    );
    expect(state.profiles.find((p) => p.id === profile.id).codex_auth).toBe(
      codexBefore.codex_auth,
    );
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
    const p = (await ipc("snapshot")).profiles.find((p) => p.id === profile.id);
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
    (await ipc("snapshot")).profiles.find((p) => p.id === profile.id)
      .tool_services.opencode,
  ).toBeUndefined();
  await navigate("工作环境");
  await page.locator(".profile-list .profile").first().hover();
  await page
    .locator(".profile-list .profile")
    .first()
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "代理连接", exact: true }),
  ).toHaveCount(0);
  await checkVisuals("environment-editor");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await navigate("工具安装");
  await expect(
    page.getByRole("button", { name: "打开 VS Code", exact: true }),
  ).toBeVisible();
  await checkVisuals("tools");
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
