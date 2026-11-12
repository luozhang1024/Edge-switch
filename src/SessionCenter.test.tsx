import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionCenter } from "./SessionCenter";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const session = {
  key: "0/test.jsonl",
  tool: "codex",
  id: "session-id",
  title: "修复项目",
  project: "C:\\project",
  modified: 1800000000,
  messages: [
    { role: "user", content: "修复项目" },
    { role: "assistant", content: "已完成修复" },
  ],
  truncated: false,
  resume: "codex resume session-id",
};
describe("会话中心", () => {
  it("搜索和筛选会话，读取详情并复制恢复命令", async () => {
    mocks.invoke.mockResolvedValue({ sessions: [session], warnings: [] });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <SessionCenter
        profileId="local"
        environment="本机 Windows"
        onTerminal={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /修复项目/ }));
    await screen.findByRole("button", { name: "复制恢复命令" });
    expect(mocks.invoke).toHaveBeenLastCalledWith("query_sessions", {
      profileId: "local",
      key: session.key,
    });
    fireEvent.click(screen.getByRole("button", { name: "复制恢复命令" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(session.resume));
    expect(screen.getByRole("navigation", { name: "对话目录" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "会话列表" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "返回会话列表" }));
    fireEvent.change(screen.getByLabelText("搜索会话"), {
      target: { value: "没有匹配" },
    });
    expect(screen.getByText("暂无匹配会话。使用工具后刷新列表。")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("搜索会话"), {
      target: { value: "project" },
    });
    expect(screen.getByRole("button", { name: /修复项目/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "筛选应用" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Claude Code/ }));
    expect(screen.getByText("暂无匹配会话。使用工具后刷新列表。")).toBeTruthy();
  });
  it("项目可折叠，工具过程可展开并切换阅读视图", async () => {
    mocks.invoke.mockResolvedValue({
      sessions: [
        {
          ...session,
          messages: [
            session.messages[0],
            {
              ...session.messages[1],
              content: "**修复完成**\n\n- 验证通过\n- 已保存",
              steps: [
                { name: "apply_patch", content: "*** Update File: main.ts" },
              ],
            },
          ],
        },
      ],
      warnings: [],
    });
    render(
      <SessionCenter
        profileId="local"
        environment="Windows"
        onTerminal={vi.fn()}
      />,
    );
    await screen.findByRole("button", { name: /修复项目/ });
    const group = screen.getByRole("button", { expanded: true });
    fireEvent.click(group);
    expect(screen.queryByRole("button", { name: /修复项目/ })).toBeNull();
    fireEvent.click(group);
    fireEvent.click(screen.getByRole("button", { name: /修复项目/ }));
    await screen.findByRole("button", { name: "复制恢复命令" });
    expect(screen.getByText(/执行过程/).closest("details")?.open).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "对话" }));
    expect(screen.queryByText(/执行过程/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "改动" }));
    expect(screen.getByText("apply_patch")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "切换对话目录" }));
    expect(screen.queryByRole("navigation", { name: "对话目录" })).toBeNull();
  });
  it("切换环境后忽略旧环境的迟到响应，并呈现读取错误", async () => {
    let resolveOld!: (value: unknown) => void;
    mocks.invoke.mockImplementation((_name, args) =>
      args.profileId === "old"
        ? new Promise((resolve) => {
            resolveOld = resolve;
          })
        : Promise.reject("SSH 连接失败"),
    );
    const view = render(
      <SessionCenter
        profileId="old"
        environment="旧环境"
        onTerminal={vi.fn()}
      />,
    );
    view.rerender(
      <SessionCenter
        profileId="new"
        environment="新环境"
        onTerminal={vi.fn()}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "SSH 连接失败",
    );
    await act(async () => resolveOld({ sessions: [session], warnings: [] }));
    expect(screen.queryByRole("button", { name: /修复项目/ })).toBeNull();
  });
});
