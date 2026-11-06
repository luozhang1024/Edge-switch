import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { App } from "./App";
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
    version: "2.0.0-alpha.1",
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
  it("刷新快照不覆盖正在编辑的服务输入", async () => {
    await models();
    fireEvent.click(screen.getByText("编辑", { selector: "button" }));
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
    fireEvent.click(screen.getByText("删除", { selector: "button" }));
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
  it("Codex 选择 DeepSeek 时要求 Responses 网关，不预填不兼容原生接口", async () => {
    await models();
    fireEvent.click(screen.getByText("添加服务", { selector: "button" }));
    fireEvent.change(screen.getByLabelText("模型供应商"), {
      target: { value: "deepseek" },
    });
    expect(
      (screen.getByLabelText("HTTPS API 地址") as HTMLInputElement).value,
    ).toBe("");
    expect((screen.getByLabelText("协议") as HTMLSelectElement).value).toBe(
      "responses",
    );
    expect(screen.getByText(/所选供应商的原生协议不兼容/)).toBeTruthy();
  });
  it("Harness 可保存 OpenAI API，记录工具与供应商", async () => {
    await models();
    fireEvent.click(screen.getByRole("tab", { name: "DeepSeek Harness" }));
    fireEvent.click(screen.getByText("添加服务", { selector: "button" }));
    fireEvent.change(screen.getByLabelText("模型供应商"), {
      target: { value: "openai" },
    });
    fireEvent.change(screen.getByLabelText("模型 ID"), {
      target: { value: "test-model" },
    });
    fireEvent.submit(screen.getByText("保存服务").closest("form")!);
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        "save_service",
        expect.objectContaining({
          entry: expect.objectContaining({
            tool: "harness",
            provider: "openai",
            protocol: "responses",
            base_url: "https://api.openai.com/v1",
          }),
        }),
      ),
    );
  });
  it("Claude 和 Gemini 添加服务使用各自的原生协议", async () => {
    await models();
    for (const [name, protocol] of [
      ["Claude Code", "anthropic"],
      ["Gemini CLI", "gemini"],
    ]) {
      fireEvent.click(screen.getByRole("tab", { name }));
      fireEvent.click(screen.getByText("添加服务", { selector: "button" }));
      expect((screen.getByLabelText("协议") as HTMLSelectElement).value).toBe(
        protocol,
      );
      fireEvent.click(screen.getByText("取消", { selector: "button" }));
    }
  });
});
