import React, { useState } from "react";
import { Preferences, Profile, ToolId } from "./types";
import { ScrollList } from "./ScrollList";

export function RecordPlayer({
  current,
  busy,
  connected,
  run,
  onNavigate,
  onTasks,
  onInfo,
  taskCount,
  preferences,
}: {
  current: Profile;
  busy: boolean;
  connected: boolean;
  run: (action: string) => Promise<void>;
  onNavigate: () => void;
  onTasks: () => void;
  onInfo: () => void;
  taskCount: number;
  preferences: Preferences;
}) {
  const [spinning, setSpinning] = useState(true);
  const tracks = [
    ["01", "Codex", "AI 编程 · 终端工作流", "codex"],
    ["02", "VS Code", "远程编辑 · 专注创造", "vscode"],
    ["03", "DeepSeek Harness", "浏览器里的 AI 工作空间", "harness"],
    ["04", "SSH 终端", "直达板卡 · 自由掌控", "ssh_console"],
    ["05", "Claude Code", "用自然语言，雕琢想法", "claude"],
    ["06", "Gemini CLI", "另一种灵感，另一种可能", "gemini"],
    ["07", "OpenCode", "开放工具 · 自由创造", "opencode"],
  ].filter(
    ([, , , action]) =>
      ["vscode", "ssh_console"].includes(action) ||
      preferences.home_tools.includes(action as ToolId),
  );
  return (
    <section className="listening-room" aria-label="远程开发唱片台">
      <div className="track-column">
        <div className="edition-label">THE WORKSPACE COLLECTION</div>
        <h2>
          让灵感，
          <br />
          开始转动<span>。</span>
        </h2>
        <p className="room-intro">连接你的板卡，进入创造的节奏。</p>
        <div className="track-heading">
          <span>A SIDE / 快速启动</span>
          <span>{String(tracks.length).padStart(2, "0")} TRACKS</span>
        </div>
        <ScrollList className="launch-tracks" label="快速启动列表">
          {tracks.map(([number, name, detail, action]) => (
            <button
              key={action}
              aria-label={`打开 ${name}`}
              disabled={busy}
              onClick={() => void run(action)}
            >
              <span className="track-number" aria-hidden="true">
                {number}
              </span>
              <span
                className={`track-art track-art-${number}`}
                aria-hidden="true"
              >
                {number === "01"
                  ? "✳"
                  : number === "02"
                    ? "⌘"
                    : number === "03"
                      ? "≈"
                      : "›_"}
              </span>
              <span className="track-title">
                <b>{name}</b>
                <small>{detail}</small>
              </span>
              <span className="track-play" aria-hidden="true">
                ↗
              </span>
            </button>
          ))}
        </ScrollList>
        <span className="scroll-hint">滚动探索更多工具 ↓</span>
      </div>
      <div className="turntable">
        <span className="turntable-caption">EDGE SESSIONS — VOL. 01</span>
        <div className="record-platter">
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
              <small>SIDE A · 33⅓ RPM</small>
            </div>
          </div>
        </div>
        <div className="tonearm" aria-hidden="true">
          <i />
        </div>
        <button
          className="spin-control"
          disabled={!preferences.motion}
          aria-pressed={!spinning}
          aria-label={spinning ? "暂停唱片动画" : "继续唱片动画"}
          onClick={() => setSpinning(!spinning)}
        >
          <span aria-hidden="true">{spinning ? "Ⅱ" : "▷"}</span>
          {!preferences.motion
            ? "动画已关闭"
            : spinning
              ? "暂停转动"
              : "继续转动"}
        </button>
      </div>
      <div className="sleeve-column">
        <div className="album-cover" aria-hidden="true">
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
        </div>
        <div className="sleeve-meta">
          <span>当前工作环境</span>
          <span>↗ SSH</span>
        </div>
        <h3>{current.name}</h3>
        <p className="sleeve-address">
          {current.user}@{current.host || "待配置主机"}:{current.port}
        </p>
        <div className="sleeve-note">
          <span className="edition-label">LINER NOTES / 环境信息</span>
          <p>{current.project}</p>
          <span className="connection-indicator">
            <i className={connected ? "connected" : ""} />
            {connected ? "已有连接通道" : "尚未建立连接通道"}
          </span>
        </div>
        <button
          className="check-device"
          disabled={busy}
          onClick={() => void run("diagnose")}
        >
          检查设备 <span aria-hidden="true">↗</span>
        </button>
      </div>
      <div className="record-strip">
        <button
          className="strip-symbol"
          aria-label="打开导航"
          title="打开工作台导航"
          onClick={onNavigate}
        >
          ↗
        </button>
        <span>为下一次创造，准备就绪。</span>
        <div className="waveform" aria-hidden="true">
          {Array.from({ length: 48 }, (_, i) => (
            <i
              key={i}
              style={{ height: `${5 + ((i * 17 + i * i * 3) % 29)}px` }}
            />
          ))}
        </div>
        <div className="studio-actions">
          <button onClick={onInfo}>
            环境详情 <span aria-hidden="true">↗</span>
          </button>
          <button onClick={onTasks}>
            任务记录 {taskCount > 0 && <i>{taskCount}</i>}{" "}
            <span aria-hidden="true">↗</span>
          </button>
        </div>
      </div>
    </section>
  );
}
