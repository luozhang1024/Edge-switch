import React from "react";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  within,
} from "@testing-library/react";
import { PromptGroups } from "./PromptGroups";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: vi.fn() }));
beforeEach(() => {
  invoke.mockReset();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  invoke.mockImplementation(async (name) =>
    name === "prompt_library"
      ? {
          prompts: [
            {
              id: "one",
              name: "团队规范",
              description: "说明",
              content: "正文",
              updated: 1,
            },
          ],
          active: "one",
          path: "/AGENTS.md",
          revision: "revision-one",
          bytes: 6,
        }
      : undefined,
  );
});
afterEach(cleanup);
it("copies independent prompts to selected other tools without enabling them", async () => {
  render(<PromptGroups profileId="profile" environment="测试环境" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "更多操作 团队规范" }),
  );
  fireEvent.click(screen.getByRole("menuitem", { name: "复制到其他工具" }));
  const dialog = screen.getByRole("dialog");
  const options = within(dialog).getAllByRole("checkbox") as HTMLInputElement[];
  expect(options).toHaveLength(8);
  expect(options.every((e) => e.checked)).toBe(true);
  expect(within(dialog).queryByText("Codex")).toBeNull();
  options.slice(1).forEach((e) => fireEvent.click(e));
  fireEvent.click(
    within(dialog).getByRole("button", { name: "复制到 1 个工具" }),
  );
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("copy_prompt_to_tools", {
      profileId: "profile",
      tool: "codex",
      id: "one",
      targets: ["claude"],
      revision: "revision-one",
    }),
  );
  expect((await screen.findByRole("status")).textContent).toContain(
    "副本未启用",
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
it("shows why active prompts cannot be deleted and retains the copy dialog on failure", async () => {
  render(<PromptGroups profileId="profile" environment="测试环境" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "更多操作 团队规范" }),
  );
  expect(
    (screen.getByRole("menuitem", { name: "删除提示词" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(screen.getByText("启用中的提示词不能删除，请先停用。")).toBeTruthy();
  fireEvent.click(screen.getByRole("menuitem", { name: "复制到其他工具" }));
  invoke.mockRejectedValueOnce(new Error("复制失败"));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "复制到 8 个工具",
    }),
  );
  await waitFor(() =>
    expect(
      within(screen.getByRole("dialog")).getByRole("alert").textContent,
    ).toContain("复制失败"),
  );
});
