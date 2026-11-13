import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { AccountMenu, LoginProgress } from "./AccountActions";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), confirm: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: mocks.confirm }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("三点菜单退出当前环境账号，刷新显示且不修改 API 供应商", async () => {
  mocks.confirm.mockResolvedValue(true);
  mocks.invoke.mockResolvedValue(null);
  const onDone = vi.fn();
  render(
    <AccountMenu
      profileId="board"
      tool="codex"
      disabled={false}
      onDone={onDone}
    />,
  );
  fireEvent.click(screen.getByLabelText("账号操作"));
  fireEvent.click(screen.getByRole("button", { name: "退出当前账号" }));
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(mocks.invoke).toHaveBeenCalledWith("logout_account", {
    profileId: "board",
    tool: "codex",
  });
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
});
it("等待授权时可重新打开登录页和取消", async () => {
  mocks.invoke.mockResolvedValue({
    url: "https://auth.openai.com/oauth/authorize?state=fixture",
  });
  const cancel = vi.fn();
  render(<LoginProgress profileId="board" taskId="task" cancel={cancel} />);
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "重新打开登录页" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "重新打开登录页" }));
  expect(mocks.invoke).toHaveBeenCalledWith("account_login_link", {
    profileId: "board",
    reopen: true,
  });
  fireEvent.click(screen.getByRole("button", { name: "取消授权" }));
  expect(cancel).toHaveBeenCalledOnce();
});
