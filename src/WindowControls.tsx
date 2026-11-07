import { t } from "./i18n";
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
    <div className="window-controls" aria-label={t("窗口控制")}>
      <button
        className="traffic minimize"
        aria-label={t("最小化窗口")}
        title={t("最小化")}
        onClick={() => void act("minimize")}
      >
        <span>−</span>
      </button>
      <button
        className="traffic maximize"
        aria-label={t("最大化或还原窗口")}
        title={t("最大化 / 还原")}
        onClick={() => void act("toggleMaximize")}
      >
        <span>↗</span>
      </button>
      <button
        className="traffic close-window"
        aria-label={t("关闭窗口")}
        title={t("关闭窗口")}
        onClick={() => void act("close")}
      >
        <span>×</span>
      </button>
    </div>
  );
}
