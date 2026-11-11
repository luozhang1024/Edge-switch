import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { UsagePage, UsageResult } from "./UsagePage";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const fixture: UsageResult = {
  totals: {
    requests: 61,
    input: 100,
    output: 40,
    cached: 900,
    write: 0,
    cost: null,
    priced: 0,
  },
  options: { provider: ["openai"], model: ["gpt-test"] },
  trend: [{ index: 0, tokens: 1040 }],
  groups: [
    { provider: "openai", model: "gpt-test", requests: 61, tokens: 1040 },
  ],
  rows: [
    {
      id: "one",
      tool: "codex",
      timestamp: 1794358800,
      provider: "openai",
      model: "gpt-test",
      input: 100,
      output: 40,
      cached: 900,
      write: 0,
      cost: null,
    },
  ],
  warnings: [],
};

describe("远程用量统计", () => {
  it("查询当前环境，按工具、供应商、模型筛选并分页", async () => {
    invoke.mockResolvedValue(fixture);
    render(<UsagePage profileId="board-a" environment="Board" />);
    await screen.findByText("90.0%");
    expect(invoke).toHaveBeenCalledWith(
      "query_usage",
      expect.objectContaining({ profileId: "board-a", page: 0 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith(
        "query_usage",
        expect.objectContaining({ page: 1 }),
      ),
    );
    await screen.findByText("90.0%");
    fireEvent.click(screen.getByRole("button", { name: "Codex" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith(
        "query_usage",
        expect.objectContaining({ tool: "codex", page: 0 }),
      ),
    );
    await screen.findByText("90.0%");
    fireEvent.change(screen.getByRole("combobox", { name: "筛选供应商" }), {
      target: { value: "openai" },
    });
    await waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith(
        "query_usage",
        expect.objectContaining({ provider: "openai" }),
      ),
    );
    await screen.findByText("90.0%");
    fireEvent.change(screen.getByRole("combobox", { name: "筛选模型" }), {
      target: { value: "gpt-test" },
    });
    await waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith(
        "query_usage",
        expect.objectContaining({ model: "gpt-test" }),
      ),
    );
    await screen.findByText("90.0%");
    fireEvent.click(screen.getByRole("tab", { name: /供应商 \/ 模型/ }));
    expect(screen.getByRole("tabpanel").textContent).toContain("gpt-test");
  });

  it("旧环境的延迟响应不会覆盖新环境，失败后可重试", async () => {
    let resolveOld!: (value: UsageResult) => void;
    invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    const view = render(<UsagePage profileId="old" environment="Old" />);
    invoke.mockRejectedValueOnce(new Error("SSH unavailable"));
    view.rerender(<UsagePage profileId="new" environment="New" />);
    await screen.findByRole("alert");
    await act(async () => resolveOld(fixture));
    expect(screen.queryByText("90.0%")).toBeNull();
    invoke.mockResolvedValue(fixture);
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByText("90.0%");
    expect(invoke).toHaveBeenLastCalledWith(
      "query_usage",
      expect.objectContaining({ profileId: "new" }),
    );
  });
});
