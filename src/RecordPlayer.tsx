import React, { useState } from "react";
import { Profile } from "./types";

export function RecordPlayer({
  current,
  busy,
  connected,
  run,
}: {
  current: Profile;
  busy: boolean;
  connected: boolean;
  run: (action: string) => Promise<void>;
}) {
  const [spinning, setSpinning] = useState(true);
  const tracks = [
    ["01", "Codex", "AI 编程 · 终端工作流", "codex"],
    ["02", "VS Code", "远程编辑 · 专注创造", "vscode"],
    ["03", "DeepSeek Harness", "浏览器里的 AI 工作空间", "harness"],
    ["04", "SSH 终端", "直达板卡 · 自由掌控", "ssh_console"],
  ];
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
          <span>04 TRACKS</span>
        </div>
        <div className="launch-tracks">
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
        </div>
      </div>
      <div className="turntable">
        <span className="turntable-caption">EDGE SESSIONS — VOL. 01</span>
        <div className="record-platter">
          <div
            className={`vinyl ${spinning ? "is-spinning" : ""}`}
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
          aria-pressed={!spinning}
          aria-label={spinning ? "暂停唱片动画" : "继续唱片动画"}
          onClick={() => setSpinning(!spinning)}
        >
          <span aria-hidden="true">{spinning ? "Ⅱ" : "▷"}</span>
          {spinning ? "暂停转动" : "继续转动"}
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
        <span className="strip-symbol" aria-hidden="true">
          ↳
        </span>
        <span>为下一次创造，准备就绪。</span>
        <div className="waveform" aria-hidden="true">
          {Array.from({ length: 48 }, (_, i) => (
            <i
              key={i}
              style={{ height: `${5 + ((i * 17 + i * i * 3) % 29)}px` }}
            />
          ))}
        </div>
        <span className="strip-end">REMOTE AI STUDIO</span>
      </div>
    </section>
  );
}
