import { t } from "./i18n";
import React, { useState } from "react";
import { Preferences, Profile, ToolId } from "./types";
import { ScrollList } from "./ScrollList";
import { tools } from "./catalog";
import vscodeIcon from "../image/Vscode.png";
import { ActionIcon } from "./ActionIcon";
import { ordered, moveItem } from "./listOrder";

export function RecordPlayer({
  current,
  version,
  busy,
  connected,
  run,
  onNavigate,
  onEnvironment,
  onProject,
  onInfo,
  preferences,
  launchOrder = [],
  onOrder,
}: {
  current: Profile;
  version: string;
  busy: boolean;
  connected: boolean;
  run: (action: string) => Promise<void>;
  onNavigate: () => void;
  onEnvironment: () => void;
  onProject: () => void;
  onInfo: () => void;
  preferences: Preferences;
  launchOrder?: string[];
  onOrder: (ids: string[]) => Promise<unknown>;
}) {
  const [spinning, setSpinning] = useState(true);
  const [dragged, setDragged] = useState<string | null>(null);
  const allTracks = [
    ["01", "Codex", "AI 编程 · 终端工作流", "codex"],
    ["02", "VS Code", "远程编辑 · 专注创造", "vscode"],
    ["03", "DeepSeek Harness", "浏览器里的 AI 工作空间", "harness"],
    [
      "04",
      current.kind === "local" ? "本机终端" : "SSH 终端",
      current.kind === "local" ? "Windows PowerShell" : "直达板卡 · 自由掌控",
      "ssh_console",
    ],
    ["05", "Claude Code", "用自然语言，雕琢想法", "claude"],
    ["06", "Gemini CLI", "另一种灵感，另一种可能", "gemini"],
    ["07", "OpenCode", "开放工具 · 自由创造", "opencode"],
  ];
  const sorted = ordered(
    allTracks.map((track) => ({ id: track[3], track })),
    launchOrder,
  );
  const tracks = sorted
    .map(({ track }) => track)
    .filter(
      ([, , , action]) =>
        ["vscode", "ssh_console"].includes(action) ||
        preferences.home_tools.includes(action as ToolId),
    );
  return (
    <section className="listening-room" aria-label={t("远程开发唱片台")}>
      <div className="track-column">
        <div className="edition-label">THE WORKSPACE COLLECTION</div>
        <h2>
          {t("让灵感，")}
          <br />
          {t("开始转动")}
          <span>。</span>
        </h2>
        <p className="room-intro">
          {t(
            current.kind === "local"
              ? "使用本机 Windows，进入创造的节奏。"
              : "连接你的板卡，进入创造的节奏。",
          )}
        </p>
        <div className="track-heading">
          <span>{t("A SIDE / 快速启动")}</span>
          <span>{String(tracks.length).padStart(2, "0")} TRACKS</span>
        </div>
        <ScrollList className="launch-tracks" label={t("快速启动列表")}>
          {tracks.map(([number, name, detail, action], index) => (
            <button
              key={action}
              draggable={!busy}
              onDragStart={(e) => {
                setDragged(action);
                e.dataTransfer.setData("text/plain", action);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                if (dragged) e.preventDefault();
              }}
              onDragEnd={() => setDragged(null)}
              onDrop={(e) => {
                e.preventDefault();
                if (dragged)
                  void onOrder(
                    moveItem(
                      sorted.map((item) => item.id),
                      dragged,
                      action,
                    ),
                  );
                setDragged(null);
              }}
              aria-label={t(`打开 ${name}`)}
              disabled={busy}
              onClick={() => void run(action)}
            >
              <span className="track-number" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span
                className={`track-art track-art-${number}`}
                aria-hidden="true"
              >
                {action === "ssh_console" ? (
                  <ActionIcon name="terminal" />
                ) : (
                  <img
                    src={
                      action === "vscode"
                        ? vscodeIcon
                        : tools.find((tool) => tool.id === action)?.icon
                    }
                    alt=""
                    draggable={false}
                  />
                )}
              </span>
              <span className="track-title">
                <b>{t(name)}</b>
                <small>{t(detail)}</small>
              </span>
              <span className="track-play" aria-hidden="true">
                ↗
              </span>
            </button>
          ))}
        </ScrollList>
        <span className="scroll-hint">
          {t("拖动排序 · 滚动探索更多工具 ↓")}
        </span>
      </div>
      <div className="turntable">
        <span className="turntable-caption">EDGE SWITCH — v{version}</span>
        <button
          type="button"
          className="record-platter"
          title={t("工作环境")}
          aria-label={t("配置工作环境")}
          onClick={onEnvironment}
        >
          <div
            className={`vinyl ${spinning && preferences.motion ? "is-spinning" : ""}`}
            aria-hidden="true"
          >
            <div className="vinyl-label">
              <span>
                EDGE
                <br />
                SWITCH
              </span>
              <i />
              <small>luozhang</small>
            </div>
          </div>
        </button>
        <div className="tonearm" aria-hidden="true">
          <i />
        </div>
        <button
          className="spin-control"
          disabled={!preferences.motion}
          aria-pressed={!spinning}
          aria-label={spinning ? t("暂停唱片动画") : t("继续唱片动画")}
          onClick={() => setSpinning(!spinning)}
        >
          <span aria-hidden="true">{spinning ? "Ⅱ" : "▷"}</span>
          {!preferences.motion
            ? t("动画已关闭")
            : spinning
              ? t("暂停转动")
              : t("继续转动")}
        </button>
      </div>
      <div className="sleeve-column">
        <button
          type="button"
          className="album-cover"
          title={t("配置模型服务")}
          aria-label={t("配置模型服务")}
          onClick={onNavigate}
        >
          <span>
            REMOTE
            <br />
            POSSIBILITIES.
          </span>
          <div className="album-orbit" />
          <small>
            EDGE SWITCH
            <br />
            YOUR NEXT GREAT IDEA
          </small>
          <b>01</b>
        </button>
        <div className="sleeve-meta">
          <span>{t("当前工作环境")}</span>
          <span>{current.kind === "local" ? "Windows" : "↗ SSH"}</span>
        </div>
        <h3>{current.name}</h3>
        <p className="sleeve-address">
          {current.kind === "local"
            ? t("本机 Windows · 无需 SSH")
            : `${current.user}@${current.host || t("待配置主机")}:${current.port}`}
        </p>
        <div className="sleeve-note">
          <span className="edition-label">{t("LINER NOTES / 环境信息")}</span>
          <p>{current.project}</p>
          <span
            className="connection-indicator"
            title={
              current.kind === "local"
                ? t("本机工具使用已有配置")
                : t(
                    "这里只统计应用维护的代理和网页隧道；外部 SSH 终端独立连接，不以隧道状态判断 SSH 是否可用。",
                  )
            }
          >
            <i className={connected ? "connected" : ""} />
            {current.kind === "local"
              ? t("本机工具使用已有配置")
              : connected
                ? t("代理 / 网页隧道已连接")
                : t("SSH 终端按需连接")}
          </span>
        </div>
        <button
          className="check-device"
          disabled={busy}
          onClick={() => void run("diagnose")}
        >
          {t("检查设备 ")}
          <span aria-hidden="true">↗</span>
        </button>
      </div>
      <div className="record-strip">
        <button
          className="strip-symbol"
          aria-label={t("打开导航")}
          title={t("打开工作台导航")}
          onClick={onNavigate}
        >
          ↗
        </button>
        <span>{t("为下一次创造，准备就绪。")}</span>
        <button
          className={`waveform ${preferences.motion ? "waveform-animated" : ""}`}
          aria-label={t("打开 GitHub 项目")}
          title="GitHub · luozhang1024/Edge-switch"
          onClick={onProject}
        >
          {Array.from({ length: 48 }, (_, i) => (
            <i
              key={i}
              style={{
                height: `${5 + ((i * 17 + i * i * 3) % 29)}px`,
                animationDelay: `${-i * 0.13}s`,
              }}
            />
          ))}
        </button>
        <div className="studio-actions">
          <button onClick={onInfo}>
            {t("环境详情 ")}
            <span aria-hidden="true">↗</span>
          </button>
        </div>
      </div>
    </section>
  );
}
