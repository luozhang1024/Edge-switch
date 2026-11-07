import React from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function WindowControls({
  onError,
}: {
  onError: (message: string) => void;
}) {
  async function act(action: "minimize" | "toggleMaximize" | "close") {
    try {
      await getCurrentWindow()[action]();
    } catch (error) {
      onError(String(error));
    }
  }
  return (
    <div className="window-controls" aria-label="窗口控制">
      <button
        className="traffic minimize"
        aria-label="最小化窗口"
        title="最小化"
        onClick={() => void act("minimize")}
      >
        <span>−</span>
      </button>
      <button
        className="traffic maximize"
        aria-label="最大化或还原窗口"
        title="最大化 / 还原"
        onClick={() => void act("toggleMaximize")}
      >
        <span>↗</span>
      </button>
      <button
        className="traffic close-window"
        aria-label="关闭窗口到托盘"
        title="关闭到托盘"
        onClick={() => void act("close")}
      >
        <span>×</span>
      </button>
    </div>
  );
}
