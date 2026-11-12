import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { App } from "./App";
import { version } from "../package.json";
import { defaultPreferences, emptyProfile, Snapshot } from "./types";
import { setLanguage } from "./i18n";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  confirm: vi.fn(),
  open: vi.fn(),
  events: {} as Record<string, (e: { payload: unknown }) => void>,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (name: string, listener: (e: { payload: unknown }) => void) => {
      mocks.events[name] = listener;
      return () => {};
    },
  ),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: mocks.confirm,
  open: mocks.open,
}));
let data: Snapshot;
beforeEach(() => {
  setLanguage("zh");
  vi.clearAllMocks();
  const p = {
    ...emptyProfile(),
    host: "board.local",
    name: "测试板卡",
    model: "test-model",
    active_api: "b".repeat(32),
  };
  data = {
    profiles: [p],
    selected_profile: p.id,
    services: {
      [p.id]: [
        {
          id: p.active_api,
          name: "测试 API",
          base_url: p.base_url,
          model: p.model,
          protocol: "responses",
        },
      ],
    },
    official: {},
    saved_keys: [],
    tasks: [],
    version,
  };
  mocks.invoke.mockImplementation(async (name: string) =>
    name === "snapshot"
      ? structuredClone(data)
      : name === "connection_status"
        ? {}
        : null,
  );
  mocks.confirm.mockResolvedValue(true);
  mocks.open.mockResolvedValue(null);
});
afterEach(cleanup);
async function models() {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "打开导航" }));
  fireEvent.click(await screen.findByText("模型服务", { selector: "button" }));
}
async function refreshSnapshot() {
  await act(async () => {
    mocks.events["task-finished"]({ payload: {} });
  });
}
describe("桌面工作流", () => {
  it("快速启动拖动排序持久化，隐藏工具的顺序也保留", async () => {
    data.preferences = {
      ...defaultPreferences,
      home_tools: ["codex", "claude"],
    };
    const original = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation(async (name, args) => {
      if (name === "reorder_items") {
        data.list_order = { quick_launch: args.ids };
        return null;
      }
      return original(name, args);
    });
    render(<App />);
    const codex = await screen.findByRole("button", { name: "打开 Codex" });
    const claude = screen.getByRole("button", { name: "打开 Claude Code" });
    const transfer = { setData: vi.fn(), effectAllowed: "" };
    fireEvent.dragStart(claude, { dataTransfer: transfer });
    fireEvent.drop(codex, { dataTransfer: transfer });
    await waitFor(() =>
      expect(
        document
          .querySelector(".launch-tracks button")
          ?.getAttribute("aria-label"),
      ).toBe("打开 Claude Code"),
    );
    expect(data.list_order?.quick_launch).toHaveLength(7);
    expect(data.list_order?.quick_launch).toContain("harness");
    await refreshSnapshot();
    expect(
      document
        .querySelector(".launch-tracks button")
        ?.getAttribute("aria-label"),
    ).toBe("打开 Claude Code");
  });
  it("Claude 未登录不默认显示使用中，显式选择也只标记登录待确认", async () => {
    await models();
    fireEvent.click(screen.getByRole("tab", { name: "Claude Code" }));
    expect(screen.queryByRole("button", { name: "使用中" })).toBeNull();
    expect(screen.getByRole("button", { name: "启用官方账号" })).toBeTruthy();
    data.profiles[0].tool_services = { claude: "official" };
    await refreshSnapshot();
    expect(
      screen.getByRole("button", { name: "已选择，登录状态未确认" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "使用中" })).toBeNull();
  });
  it("Harness 配置多个 API 后仍可从账号通道启用按钮切回", async () => {
    data.services[data.selected_profile] = [1, 2].map((n) => ({
      id: String(n).repeat(32),
      name: `API ${n}`,
      tool: "harness",
      base_url: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      protocol: "chat",
    }));
    data.profiles[0].tool_services = { harness: "1".repeat(32) };
    await models();
    fireEvent.click(screen.getByRole("tab", { name: "DeepSeek Harness" }));
    fireEvent.click(screen.getByRole("button", { name: "启用 DeepSeek 账号" }));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        "start_task",
        expect.objectContaining({ action: "harness_account_sync" }),
      ),
    );
    expect(
      screen.getByRole("button", { name: "打开账号 Harness" }),
    ).toBeTruthy();
    expect(screen.getAllByText(/API [12]/, { selector: "b" })).toHaveLength(2);
  });
  it("本机 Windows 环境无需 SSH，保留内置环境并提供本机编辑入口", async () => {
    data.profiles[0] = {
      ...data.profiles[0],
      kind: "local",
      name: "本机 Windows",
      project: "C:\\Users\\Developer",
    };
    render(<App />);
    expect(
      await screen.findByRole("button", { name: "打开 本机终端" }),
    ).toBeTruthy();
    expect(screen.queryByText("SSH 终端按需连接")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "配置工作环境" }));
    expect(screen.queryByRole("button", { name: "配置 SSH 登录" })).toBeNull();
    expect(
      (screen.getByRole("button", { name: "删除" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByLabelText("工程绝对路径")).toBeTruthy();
    expect(screen.queryByLabelText("主机地址")).toBeNull();
  });
  it("通用设置保存窗口行为，界面语言即时切换并保留环境名称", async () => {
    const original = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation(async (name, args) => {
      if (name === "save_preferences") {
        data.preferences = structuredClone(args.preferences);
        return null;
      }
      if (name === "autostart_status") return false;
      return original(name, args);
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "设置" }));
    const autostart = screen.getByRole("switch", { name: "开机自启" });
    expect((autostart as HTMLInputElement).checked).toBe(false);
    fireEvent.click(autostart);
    await waitFor(() => expect(data.preferences?.autostart).toBe(true));
    fireEvent.click(screen.getByRole("switch", { name: "关闭时最小化到托盘" }));
    await waitFor(() => expect(data.preferences?.close_to_tray).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(await screen.findByRole("tab", { name: "General" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Start at login" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Logs" })).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");
    await waitFor(() => expect(data.preferences?.language).toBe("en"));
    fireEvent.click(screen.getByRole("button", { name: "← Back to studio" }));
    expect(
      screen.getByRole("button", { name: "Configure workspace" }),
    ).toBeTruthy();
    expect(screen.getByText("测试板卡", { selector: "h3" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(await screen.findByRole("tab", { name: "通用" })).toBeTruthy();
  });
  it("保存语言失败时回滚语言和选中状态", async () => {
    const original = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation(async (name, args) => {
      if (name === "save_preferences") throw new Error("磁盘不可写");
      return original(name, args);
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "设置" }));
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(
      await screen.findByRole("dialog", { name: "操作未完成" }),
    ).toBeTruthy();
    expect(document.documentElement.lang).toBe("zh-CN");
  });
  it("每个工具仅提供对应官方默认项，Harness 默认项可直接配置 API", async () => {
    data.services[data.selected_profile] = [];
    await models();
    expect(document.querySelectorAll(".service-card").length).toBe(1);
    expect(screen.getByText("OpenAI Official", { selector: "b" })).toBeTruthy();
    for (const [tool, name] of [
      ["Claude Code", "Claude Official"],
      ["Gemini CLI", "Gemini Official"],
      ["OpenCode", "OpenCode Zen"],
    ]) {
      fireEvent.click(screen.getByRole("tab", { name: tool }));
      expect(document.querySelectorAll(".service-card").length).toBe(1);
      expect(screen.getByText(name, { selector: "b" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "登录官方账号" })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("tab", { name: "DeepSeek Harness" }));
    expect(document.querySelectorAll(".service-card").length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "配置 API" }));
    expect(
      (screen.getByLabelText("API请求地址") as HTMLInputElement).value,
    ).toBe("https://api.deepseek.com/v1");
  });
  it("检查设备直接打开进度弹窗，任务结束后显示结果", async () => {
    const original = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation(async (name, args) => {
      if (name === "start_task") {
        const task = {
          id: "diagnose-task",
          profile_id: data.selected_profile,
          label: "检查设备",
          state: "运行中",
          message: "正在连接板卡",
          result: null,
          started_at: 1,
        };
        data.tasks.push(task);
        return structuredClone(task);
      }
      return original(name, args);
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "检查设备" }));
    const progress = await screen.findByRole("dialog", { name: "检查设备" });
    expect(
      await within(progress).findByText("运行中 · 正在连接板卡"),
    ).toBeTruthy();
    data.tasks[0] = {
      ...data.tasks[0],
      state: "已完成",
      message: "设备正常",
      result: { arch: "aarch64" },
    };
    await refreshSnapshot();
    expect(within(progress).getByText("已完成 · 设备正常")).toBeTruthy();
    expect(within(progress).getByText(/aarch64/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "刷新" })).toBeNull();
  });
  it("提交失败立即显示错误，GitHub 波浪调用项目入口", async () => {
    const original = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation(async (name, args) => {
      if (name === "start_task") throw new Error("SSH 无法连接");
      return original(name, args);
    });
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "打开 GitHub 项目" }),
    );
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("open_project_page", {}),
    );
    fireEvent.click(screen.getByRole("button", { name: "检查设备" }));
    expect(
      await screen.findByRole("dialog", { name: "操作未完成" }),
    ).toBeTruthy();
    expect(screen.getByText(/SSH 无法连接/)).toBeTruthy();
    expect(document.querySelector(".studio-status")).toBeNull();
  });
  it("拖动环境和供应商可保存排序并在刷新后保持", async () => {
    const second = {
      ...emptyProfile(),
      name: "第二块板卡",
      host: "second.local",
    };
    data.profiles.push(second);
    data.services[second.id] = [];
    const original = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation(async (name, args) => {
      if (name === "reorder_items") {
        data.list_order ||= {};
        if (args.kind === "profiles") data.list_order.profiles = args.ids;
        else
          data.list_order.services = {
            [data.selected_profile]: { codex: args.ids },
          };
        return null;
      }
      return original(name, args);
    });
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "配置工作环境" }),
    );
    const transfer = { setData: vi.fn(), effectAllowed: "" };
    fireEvent.dragStart(
      screen.getByText("第二块板卡", { selector: "b" }).closest(".profile")!,
      { dataTransfer: transfer },
    );
    fireEvent.drop(
      screen.getByText("测试板卡", { selector: "b" }).closest(".profile")!,
      { dataTransfer: transfer },
    );
    await waitFor(() =>
      expect(
        document.querySelector(".profile-list .profile b")?.textContent,
      ).toBe("第二块板卡"),
    );
    fireEvent.click(screen.getByRole("button", { name: "模型服务" }));
    fireEvent.dragStart(
      screen.getByText("测试 API", { selector: "b" }).closest("article")!,
      { dataTransfer: transfer },
    );
    fireEvent.drop(
      screen
        .getByText("OpenAI Official", { selector: "b" })
        .closest("article")!,
      { dataTransfer: transfer },
    );
    await waitFor(() =>
      expect(
        document.querySelector(".service-list article b")?.textContent,
      ).toBe("测试 API"),
    );
    expect(mocks.invoke).toHaveBeenCalledWith("reorder_items", {
      kind: "services",
      profileId: data.selected_profile,
      tool: "codex",
      ids: [data.profiles[0].active_api, "official"],
    });
  });
  it("首页提供环境与模型快捷入口，侧边栏包含授权与统计，配置仅在环境编辑内", async () => {
    render(<App />);
    expect(await screen.findByText(`EDGE SWITCH — v${version}`)).toBeTruthy();
    expect(screen.getByText("SSH 终端按需连接")).toBeTruthy();
    expect(screen.queryByText("尚未建立连接通道")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "配置工作环境" }));
    const sidebar = screen
      .getByRole("navigation", { name: "主导航" })
      .closest("aside")!;
    expect(
      within(sidebar)
        .getAllByRole("button")
        .map((b) => b.textContent?.trim()),
    ).toEqual([
      "← 返回唱片台",
      "工作环境",
      "模型服务",
      "授权中心",
      "工具安装",
      "提示词组",
      "使用统计",
      "会话中心",
    ]);
    expect(screen.queryByRole("tab", { name: "AI 工具" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.click(screen.getByRole("tab", { name: "代理连接" }));
    expect(screen.getByRole("button", { name: "连接代理" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "AI 工具" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(screen.getByRole("button", { name: "工具安装" }));
    expect(screen.getByRole("button", { name: "查询可用版本" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "← 返回唱片台" }));
    fireEvent.click(screen.getByRole("button", { name: "配置模型服务" }));
    expect(screen.getByRole("tab", { name: "Codex" })).toBeTruthy();
  });
  it("工具安装直接操作当前已保存环境，不依赖编辑表单", async () => {
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "配置工作环境" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "工具安装" }));
    fireEvent.click(screen.getByRole("button", { name: "查询可用版本" }));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("start_task", {
        profileId: data.selected_profile,
        action: "versions",
        payload: {},
      }),
    );
    expect(
      mocks.invoke.mock.calls.some(([name]) => name === "save_profile"),
    ).toBe(false);
  });
  it("管理区持续保留导航，切换功能不需要重新展开", async () => {
    await models();
    expect(screen.queryByRole("button", { name: "总览与任务" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "工作环境" }));
    expect(screen.getByRole("button", { name: "添加环境" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "模型服务" }));
    expect(screen.getByRole("tab", { name: "Codex" })).toBeTruthy();
  });
  it("未认证账号引导到侧边栏授权中心，登录不需要先启用官方账号", async () => {
    await models();
    expect(
      (
        screen.getByRole("button", {
          name: "启用官方账号",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "前往授权中心" }));
    expect(
      screen
        .getByRole("button", { name: "授权中心" })
        .getAttribute("aria-current"),
    ).toBe("page");
    fireEvent.change(
      screen.getByRole("combobox", { name: "ChatGPT 登录方式" }),
      { target: { value: "device" } },
    );
    fireEvent.click(
      within(screen.getByRole("region", { name: "ChatGPT" })).getByRole(
        "button",
        { name: "添加账号" },
      ),
    );
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("start_task", {
        profileId: data.selected_profile,
        action: "login",
        payload: {},
      }),
    );
    expect(
      mocks.invoke.mock.calls.some(([name]) => name === "activate_service"),
    ).toBe(false);
  });
  it("授权中心按工具打开终端授权并跳转对应模型列表", async () => {
    await models();
    fireEvent.click(screen.getByRole("button", { name: "前往授权中心" }));
    const claude = screen.getByRole("region", { name: "Claude Code" });
    fireEvent.click(within(claude).getByRole("button", { name: "添加账号" }));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("start_task", {
        profileId: data.selected_profile,
        action: "tool_login",
        payload: { tool: "claude" },
      }),
    );
    expect(within(claude).queryByText("已确认登录")).toBeNull();
    fireEvent.click(within(claude).getByRole("button", { name: "管理接入" }));
    expect(
      screen
        .getByRole("tab", { name: "Claude Code" })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });
  it("ChatGPT 默认浏览器登录，导入凭据保留在独立管理入口", async () => {
    await models();
    fireEvent.click(screen.getByRole("button", { name: "前往授权中心" }));
    fireEvent.click(screen.getByRole("button", { name: "全部刷新" }));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("start_task", {
        profileId: data.selected_profile,
        action: "auth_status",
        payload: {},
      }),
    );
    const method = screen.getByRole("combobox", {
      name: "ChatGPT 登录方式",
    }) as HTMLSelectElement;
    expect(method.value).toBe("browser");
    expect(Array.from(method.options).map((o) => o.value)).toEqual([
      "browser",
      "device",
    ]);
    fireEvent.click(
      within(screen.getByRole("region", { name: "ChatGPT" })).getByRole(
        "button",
        { name: "添加账号" },
      ),
    );
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("start_task", {
        profileId: data.selected_profile,
        action: "login_browser",
        payload: {},
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "导入 / 管理 auth.json" }),
    );
    expect(screen.getByRole("button", { name: "选择 auth.json" })).toBeTruthy();
    expect(
      mocks.invoke.mock.calls.some(
        ([name, args]) => name === "start_task" && args.action === "login",
      ),
    ).toBe(false);
  });
  it("自动识别本机 Harness 账号和余额，同步使用原生账号通道", async () => {
    const original = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation(async (name, args) =>
      name === "local_harness_account"
        ? {
            signed_in: true,
            name: "Harness 用户",
            contact: "191****96",
            wallets: [{ currency: "CNY", balance: "11.08" }],
            bonus_wallets: [],
            checked_at: 1800000000,
          }
        : original(name, args),
    );
    await models();
    fireEvent.click(screen.getByRole("button", { name: "前往授权中心" }));
    expect(await screen.findByText("Harness 用户")).toBeTruthy();
    expect(screen.getByText("11.08 CNY")).toBeTruthy();
    const harness = screen.getByRole("region", { name: "DeepSeek Harness" });
    expect(within(harness).queryByRole("combobox")).toBeNull();
    fireEvent.click(within(harness).getByRole("button", { name: "添加账号" }));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("start_task", {
        profileId: data.selected_profile,
        action: "harness_login",
        payload: {},
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "同步账号到当前板卡并启用" }),
    );
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("start_task", {
        profileId: data.selected_profile,
        action: "harness_account_sync",
        payload: {},
      }),
    );
    expect(
      mocks.invoke.mock.calls.some(([name]) => name === "save_service"),
    ).toBe(false);
  });
  it("失效的 Harness 授权不能同步到板卡", async () => {
    const original = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation(async (name, args) =>
      name === "local_harness_account"
        ? {
            signed_in: true,
            expired: true,
            error: "账号授权已失效，请重新登录",
          }
        : original(name, args),
    );
    await models();
    fireEvent.click(screen.getByRole("button", { name: "前往授权中心" }));
    expect(await screen.findByText("授权已失效")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "同步账号到当前板卡并启用",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  it("认证状态刷新后可在模型列表启用官方账号", async () => {
    await models();
    data.official[data.selected_profile] = {
      name: "官方账号",
      remote_authenticated: true,
    };
    await refreshSnapshot();
    const enable = screen.getByRole("button", { name: "启用官方账号" });
    await waitFor(() =>
      expect((enable as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(enable);
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("activate_service", {
        profileId: data.selected_profile,
        serviceId: "official",
        tool: "codex",
      }),
    );
  });
  it("设置持久化主题、首页工具与唱片动画偏好", async () => {
    data.preferences = structuredClone(defaultPreferences);
    mocks.invoke.mockImplementation(async (name: string, args: any) => {
      if (name === "save_preferences") {
        data.preferences = args.preferences;
        return null;
      }
      return name === "snapshot"
        ? structuredClone(data)
        : name === "connection_status"
          ? {}
          : null;
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "设置" }));
    fireEvent.click(screen.getByRole("button", { name: "☾ 深色" }));
    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe("dark"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Claude Code" }));
    await waitFor(() =>
      expect(data.preferences?.home_tools.includes("claude")).toBe(false),
    );
    fireEvent.click(screen.getByLabelText("自动旋转唱片"));
    await waitFor(() => expect(data.preferences?.motion).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "← 返回唱片台" }));
    expect(
      screen.queryByRole("button", { name: "打开 Claude Code" }),
    ).toBeNull();
    expect(document.querySelector(".vinyl.is-spinning")).toBeNull();
  });
  it("添加页展示预设与表单，OpenAI Official 是首个供应商", async () => {
    await models();
    const add = screen.getByRole("button", { name: "添加服务" });
    expect(
      decodeURIComponent(add.querySelector("img")!.getAttribute("src")!),
    ).toContain("加.png");
    expect(
      decodeURIComponent(
        screen
          .getByRole("img", { name: "OpenAI Official" })
          .getAttribute("src")!,
      ),
    ).toContain("OpenAI");
    fireEvent.click(add);
    const dialog = screen.getByRole("dialog", { name: "添加新供应商" });
    expect(within(dialog).getByLabelText("服务名称")).toBeTruthy();
    const choices = within(dialog)
      .getByLabelText("预设供应商")
      .querySelectorAll("button");
    expect(choices[0].textContent).toBe("自定义配置");
    expect(choices[1].textContent).toBe("OpenAI Official");
    fireEvent.click(choices[1]);
    expect(screen.getByText("保存账号")).toBeTruthy();
    expect(screen.queryByText("保存服务")).toBeNull();
  });
  it("预设可填入网关地址，返回不保存，工具标签仅切换列表", async () => {
    await models();
    fireEvent.click(screen.getByRole("tab", { name: "Codex" }));
    expect(screen.queryByRole("dialog", { name: "添加新供应商" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "添加服务" }));
    fireEvent.click(screen.getByRole("button", { name: "OpenRouter" }));
    expect(
      (screen.getByLabelText("API请求地址") as HTMLInputElement).value,
    ).toBe("https://openrouter.ai/api/v1");
    expect(screen.queryByLabelText("协议")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(screen.queryByRole("dialog", { name: "添加新供应商" })).toBeNull();
    expect(
      mocks.invoke.mock.calls.some(
        ([n]) => n === "save_service" || n === "activate_service",
      ),
    ).toBe(false);
  });
  it("刷新快照不覆盖正在编辑的服务输入", async () => {
    await models();
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const input = screen.getByLabelText("服务名称") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "尚未保存的名称" } });
    data.services[data.selected_profile][0].name = "外部刷新名称";
    const before = mocks.invoke.mock.calls.filter(
      ([n]) => n === "snapshot",
    ).length;
    await refreshSnapshot();
    await waitFor(() =>
      expect(
        mocks.invoke.mock.calls.filter(([n]) => n === "snapshot").length,
      ).toBeGreaterThan(before),
    );
    expect(input.value).toBe("尚未保存的名称");
    fireEvent.submit(screen.getByText("保存服务").closest("form")!);
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        "save_service",
        expect.objectContaining({
          entry: expect.objectContaining({ name: "尚未保存的名称" }),
          key: null,
          remember: false,
        }),
      ),
    );
  });
  it("推理验证拒绝确认时不会发送请求", async () => {
    await models();
    mocks.confirm.mockResolvedValue(false);
    fireEvent.click(screen.getByText("推理验证（消耗额度）"));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    expect(mocks.invoke.mock.calls.some(([n]) => n === "start_task")).toBe(
      false,
    );
  });
  it("推理验证确认后携带 infer 参数，连通性检查无需确认", async () => {
    await models();
    fireEvent.click(screen.getByText("推理验证（消耗额度）"));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("start_task", {
        profileId: data.selected_profile,
        action: "api_test",
        payload: { infer: true, tool: "codex" },
      }),
    );
    await waitFor(() =>
      expect(
        (screen.getByText("连通性检查") as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    mocks.confirm.mockClear();
    fireEvent.click(screen.getByText("连通性检查"));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        "start_task",
        expect.objectContaining({ payload: { infer: false, tool: "codex" } }),
      ),
    );
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it("删除服务拒绝确认时保留数据", async () => {
    await models();
    mocks.confirm.mockResolvedValue(false);
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    expect(mocks.invoke.mock.calls.some(([n]) => n === "delete_service")).toBe(
      false,
    );
  });
  it("官方凭据通过选择的文件路径导入", async () => {
    await models();
    fireEvent.click(screen.getByText("编辑 / 导入 auth.json"));
    mocks.open.mockResolvedValue("C:\\test\\auth.json");
    fireEvent.click(screen.getByText("选择 auth.json"));
    await screen.findByText("C:\\test\\auth.json");
    fireEvent.submit(screen.getByText("保存账号").closest("form")!);
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("save_official", {
        profileId: data.selected_profile,
        name: "OpenAI Official",
        note: "",
        path: "C:\\test\\auth.json",
        icon: "",
      }),
    );
  });
  it("任务显示进度且可以取消", async () => {
    data.tasks = [
      {
        id: "task-1",
        profile_id: data.selected_profile,
        label: "安装工具",
        state: "运行中",
        message: "正在上传",
        result: null,
        started_at: 1,
      },
    ];
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "设置" }));
    fireEvent.click(screen.getByRole("tab", { name: "日志" }));
    expect(await screen.findByText("正在上传")).toBeTruthy();
    fireEvent.click(screen.getByText("取消任务"));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("cancel_task", {
        taskId: "task-1",
      }),
    );
  });
  it("工具标签隔离 API 列表，Harness 同步携带工具标识", async () => {
    const id = "c".repeat(32);
    data.services[data.selected_profile].push({
      id,
      tool: "harness",
      provider: "openai",
      name: "Harness OpenAI",
      base_url: "https://api.openai.com/v1",
      model: "test-harness-model",
      protocol: "responses",
    });
    data.profiles[0].tool_services = { harness: id };
    await models();
    expect(screen.getAllByRole("tab")).toHaveLength(5);
    expect(screen.queryByText("Harness OpenAI", { selector: "b" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "DeepSeek Harness" }));
    expect(screen.getByText("Harness OpenAI", { selector: "b" })).toBeTruthy();
    expect(screen.queryByText("测试 API", { selector: "b" })).toBeNull();
    expect(screen.queryByText("使用官方账号")).toBeNull();
    fireEvent.click(screen.getByText("同步到板卡", { selector: "button" }));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("start_task", {
        profileId: data.selected_profile,
        action: "sync_api",
        payload: { tool: "harness" },
      }),
    );
  });
  it("预设仅显示自定义、当前工具官方和两个网关", async () => {
    await models();
    fireEvent.click(screen.getByRole("button", { name: "添加服务" }));
    expect(
      within(screen.getByLabelText("预设供应商"))
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["自定义配置", "OpenAI Official", "OpenRouter", "TheRouter"]);
    expect(screen.queryByLabelText("协议")).toBeNull();
    expect(screen.getByLabelText("config.toml (TOML)")).toBeTruthy();
    expect(screen.getByLabelText("auth.json (JSON) *")).toBeTruthy();
  });
  it("Harness 官方预设自动保存 Chat 格式", async () => {
    await models();
    fireEvent.click(screen.getByRole("tab", { name: "DeepSeek Harness" }));
    fireEvent.click(screen.getByRole("button", { name: "添加服务" }));
    fireEvent.click(screen.getByRole("button", { name: "DeepSeek Official" }));
    fireEvent.change(screen.getByLabelText("模型名称"), {
      target: { value: "deepseek-test" },
    });
    fireEvent.submit(screen.getByText("保存服务").closest("form")!);
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        "save_service",
        expect.objectContaining({
          entry: expect.objectContaining({
            tool: "harness",
            provider: "deepseek",
            protocol: "chat",
            base_url: "https://api.deepseek.com/v1",
          }),
        }),
      ),
    );
  });
  it("Claude 和 Gemini 自动保存各自原生请求格式", async () => {
    await models();
    for (const [name, official, protocol] of [
      ["Claude Code", "Claude Official", "anthropic"],
      ["Gemini CLI", "Gemini Official", "gemini"],
    ]) {
      fireEvent.click(screen.getByRole("tab", { name }));
      fireEvent.click(screen.getByRole("button", { name: "添加服务" }));
      fireEvent.click(screen.getByRole("button", { name: official }));
      fireEvent.change(screen.getByLabelText("模型名称"), {
        target: { value: "test-model" },
      });
      fireEvent.submit(screen.getByText("保存服务").closest("form")!);
      await waitFor(() =>
        expect(mocks.invoke).toHaveBeenCalledWith(
          "save_service",
          expect.objectContaining({
            entry: expect.objectContaining({ protocol }),
          }),
        ),
      );
      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: "添加新供应商" }),
        ).toBeNull(),
      );
    }
  });
  it("New API 可切换并保存为统一供应商，在其他工具列表复用", async () => {
    await models();
    fireEvent.click(screen.getByRole("button", { name: "添加服务" }));
    fireEvent.click(screen.getByRole("tab", { name: "统一供应商 · New API" }));
    fireEvent.change(screen.getByLabelText("API请求地址"), {
      target: { value: "https://newapi.example/v1" },
    });
    fireEvent.change(screen.getByLabelText("模型名称"), {
      target: { value: "test-model" },
    });
    fireEvent.submit(screen.getByText("保存服务").closest("form")!);
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        "save_service",
        expect.objectContaining({
          entry: expect.objectContaining({
            scope: "universal",
            preset: "newapi",
            name: "New API",
          }),
        }),
      ),
    );
    const call = mocks.invoke.mock.calls.find(
      ([name]) => name === "save_service",
    )!;
    data.services[data.selected_profile].push(call[1].entry);
    await refreshSnapshot();
    await screen.findByText("New API · 统一");
    fireEvent.click(screen.getByRole("tab", { name: "Claude Code" }));
    expect(screen.getByText("New API · 统一")).toBeTruthy();
    expect(screen.queryByText("测试 API", { selector: "b" })).toBeNull();
  });
  it("已有密钥遮罩显示，可通过眼睛显隐，预览同步遮罩", async () => {
    const base = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((name, args) =>
      name === "get_service_key"
        ? Promise.resolve("stored-key-example")
        : base(name, args),
    );
    await models();
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const input = screen.getByLabelText("API Key") as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("stored-key-example"));
    expect(input.type).toBe("password");
    expect(
      (screen.getByLabelText("auth.json (JSON) *") as HTMLTextAreaElement)
        .value,
    ).not.toContain("stored-key-example");
    fireEvent.click(screen.getByRole("button", { name: "显示 API Key" }));
    expect(input.type).toBe("text");
    fireEvent.click(screen.getByRole("button", { name: "隐藏 API Key" }));
    expect(input.type).toBe("password");
    fireEvent.change(screen.getByLabelText("API请求地址"), {
      target: { value: "https://other.example/v1" },
    });
    expect(input.value).toBe("");
  });
  it("获取模型后可选择，失败时保留手填模型", async () => {
    const base = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((name, args) =>
      name === "fetch_models"
        ? Promise.resolve(["model-a", "model-b"])
        : base(name, args),
    );
    await models();
    fireEvent.click(screen.getByRole("button", { name: "添加服务" }));
    fireEvent.click(screen.getByRole("button", { name: "OpenRouter" }));
    fireEvent.change(screen.getByLabelText("API Key"), {
      target: { value: "test-key-example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "获取模型列表" }));
    fireEvent.change(await screen.findByLabelText("选择模型"), {
      target: { value: "model-b" },
    });
    expect((screen.getByLabelText("模型名称") as HTMLInputElement).value).toBe(
      "model-b",
    );
    expect(mocks.invoke).toHaveBeenCalledWith(
      "fetch_models",
      expect.objectContaining({
        baseUrl: "https://openrouter.ai/api/v1",
        protocol: "responses",
        key: "test-key-example",
      }),
    );
    mocks.invoke.mockImplementation((name, args) =>
      name === "fetch_models" ? Promise.reject("查询失败") : base(name, args),
    );
    fireEvent.click(screen.getByRole("button", { name: "获取模型列表" }));
    await screen.findByRole("alert");
    expect((screen.getByLabelText("模型名称") as HTMLInputElement).value).toBe(
      "model-b",
    );
  });
  it("列表复制与测试针对当前记录，不切换活动服务", async () => {
    await models();
    fireEvent.click(screen.getByRole("button", { name: "复制" }));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("duplicate_service", {
        profileId: data.selected_profile,
        serviceId: "b".repeat(32),
      }),
    );
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "测试" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "测试" }));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("start_task", {
        profileId: data.selected_profile,
        action: "api_test",
        payload: { tool: "codex", service_id: "b".repeat(32), infer: false },
      }),
    );
    expect(
      mocks.invoke.mock.calls.some(([name]) => name === "activate_service"),
    ).toBe(false);
  });
});
