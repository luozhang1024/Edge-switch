import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { SkillsPage } from "./SkillsPage";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
});
it("导入已有 Skill 后可同步到当前环境，不覆盖来源", async () => {
  let imported = false;
  mocks.invoke.mockImplementation(async (_name, args) => {
    if (args.action === "import") {
      imported = true;
      return {};
    }
    return {
      skills: imported
        ? [{ id: "sample", name: "Sample", description: "test", enabled: [] }]
        : [],
      candidates: imported
        ? []
        : [
            {
              id: "sample",
              name: "Sample",
              description: "test",
              tool: "claude",
            },
          ],
      path: "library",
    };
  });
  render(<SkillsPage profileId="board" environment="测试板卡" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "导入本机已有 (1)" }),
  );
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: /^导入$/,
    }),
  );
  await waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith("skills_request", {
      profileId: "board",
      action: "import",
      payload: { id: "sample", tool: "claude" },
    }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "关闭" }).hasAttribute("disabled"),
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  fireEvent.click(screen.getByRole("switch", { name: "Sample · Codex" }));
  await waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith("skills_request", {
      profileId: "board",
      action: "enable",
      payload: { id: "sample", tool: "codex" },
    }),
  );
});
it("发现安装绑定仓库版本，并报告目标启用失败", async () => {
  const skill = {
    id: "sample",
    name: "Sample",
    description: "repo",
    repo: "anthropics/skills",
    path: "skills/sample/SKILL.md",
    sha: "a".repeat(40),
  };
  mocks.invoke.mockImplementation(async (_name, args) => {
    if (args.action === "discover") return { skills: [skill] };
    if (args.action === "enable") throw new Error("同名 Skill 已存在");
    return { skills: [], candidates: [], path: "library" };
  });
  render(<SkillsPage profileId="board" environment="测试板卡" />);
  await screen.findByText("还没有 Skill");
  fireEvent.click(screen.getByRole("button", { name: "去发现" }));
  fireEvent.click(await screen.findByRole("button", { name: /^安装$/ }));
  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).toContain("同名 Skill 已存在");
  expect(mocks.invoke).toHaveBeenCalledWith("skills_request", {
    profileId: "board",
    action: "install_repo",
    payload: skill,
  });
});
