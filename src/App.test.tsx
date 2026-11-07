import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { App } from "./App";
import { version } from "../package.json";
import { emptyProfile, Snapshot } from "./types";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  confirm: vi.fn(),
  open: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: mocks.confirm,
  open: mocks.open,
}));
let data: Snapshot;
beforeEach(() => {
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
  fireEvent.click(await screen.findByText("模型服务", { selector: "button" }));
}
describe("桌面工作流", () => {
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
    ).toContain("#00a67e");
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
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "添加服务" }));
    fireEvent.click(screen.getByRole("button", { name: "OpenRouter" }));
    expect(
      (screen.getByLabelText("API请求地址") as HTMLInputElement).value,
    ).toBe("https://openrouter.ai/api/v1");
    expect(screen.queryByLabelText("协议")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(screen.queryByRole("dialog")).toBeNull();
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
    fireEvent.click(screen.getByText("刷新", { selector: "button" }));
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
      ["Claude Code", "Anthropic Official", "anthropic"],
      ["Gemini CLI", "Google Official", "gemini"],
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
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
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
    fireEvent.click(screen.getByText("刷新", { selector: "button" }));
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
