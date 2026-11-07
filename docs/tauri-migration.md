# Tauri 2 迁移与开发

当前源码版本为 **2.0.0-alpha.4**。Windows 控制端采用 Tauri 2、Rust、React 和 TypeScript，不打包本地 Python。远端仍需要 Python 3.8+，继续使用仓库内的 `remote_agent.py` 和 `harness_service.py`。旧版 1.1.3 已发布，新版安装包仅用于 alpha 验证，未发布新版 GitHub Release。

## 开发与检查

Windows x64 开发机需要 Node.js 24 LTS、Rust stable（含 rustfmt 和 clippy）、MSVC C++ Build Tools、Windows SDK、WebView2、OpenSSH。Rust 协议兼容测试另需 PATH 中可调用的 Python 3；这是开发依赖，桌面运行不需要本地 Python。

```powershell
npm.cmd ci
npm.cmd run tauri dev
```

```powershell
npm.cmd test
npm.cmd run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --lib -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib
npm.cmd run desktop:build
npm.cmd run test:desktop
```

`desktop:build` 生成优化的 EXE、当前用户 NSIS 安装包、便携 ZIP 和 SHA256SUMS，复制到忽略目录 `dist/tauri/`。NSIS 在未安装 WebView2 的电脑上需要联网安装运行时；便携版也需要系统已有 WebView2。安装包目前未签名。原始 Tauri 输出保留在 `src-tauri/target/release/`。CI 构建和上传 Actions 工件，不发布 Release。

`test:desktop` 实际启动优化构建的 EXE，通过仅在测试子进程中开启的本地 WebView2 调试端口执行检查。使用 `build/migration/desktop-时间戳/` 内的隔离数据，输出页面截图和 `result.json`，不读写用户现有配置，不调用付费模型，不修改板卡。正常退出后关闭测试进程。也可指定调试版路径：

```powershell
node scripts/smoke-desktop.mjs src-tauri/target/debug/edge-switch.exe
```

## 配置迁移和回退

本机继续使用 `%LOCALAPPDATA%\EdgeSSHAI`，保持 client ID、环境 ID、scope、DPAPI Base64 密文和独立 VS Code 数据目录。首次读取旧配置时先保留 `profiles.pre-tauri.json`；之后写入 `schema_version: 2`。首次创建的配置立即持久化，避免未编辑就退出导致 scope 改变。损坏 JSON、环境列表和服务列表不会被静默重置。

升级前从托盘退出旧版，避免两个控制器同时操作同一配置。新版仍使用 `workbench.lock`，并有 Tauri 单实例保护。关闭窗口仅隐藏到托盘；点击退出才停止本地 SSH 连接。请勿把数据目录、备份、私钥或凭据复制进源码仓库。

回退前退出新版，备份整个数据目录后，将 `profiles.pre-tauri.json` 复制为 `profiles.json`，再启动旧版。回退会恢复旧配置快照，迁移后新增的环境与服务不会自动合并。DPAPI 凭据只能由原 Windows 用户解密。

## 控制接口与行为

- 环境：增删改、选择、端口与私钥、工程目录、独立网络和 Harness 退出策略。任务启动与配置修改互斥；有隧道时先断开再编辑连接参数。
- 模型：API 服务增删改与启用，Responses / Chat 协议，临时或 DPAPI 持久密钥；官方账号备注、导入本人 OAuth auth.json、设备码登录、删除本机导入记录。删除本机账号信息不撤销板卡已有登录。
- 验证：连通性检查不发推理请求；真实推理必须确认额度消耗。保存或切换仅修改本地配置，显式同步才写入板卡。
- 工具：查询版本、安装独立 Node.js 和指定版本 Codex / Harness、复用工具、SSH 终端、Codex、Harness 网页、VS Code、固定编辑器、导入服务端与连接诊断。
- 任务：每环境一个、全局最多四个，进度与结果、最多 200 条内存历史、取消。取消停止本地等待和当前 SSH 子进程，**不保证撤销远端已产生的变化**；随后检查设备，不自动重放超时操作。独立终端或编辑器启动成功只表示发出打开请求。
- 代理：电脑 HTTP 代理通过反向 SSH 转发到板卡，隧道指数退避重连。Harness 转发在重连前验证原 supervisor PID 和端口，检测服务变更后要求重新打开。后台 Harness 由板卡 supervisor 管理，按环境退出策略保留或停止；显式断开本地连接保留板卡服务。

持久 SSH 通道首次通过 stdin 发送压缩的固定 Agent 源码，之后使用带序号的逐行 JSON RPC。API Key 与 OAuth 凭据只经过 SSH stdin。失败或超时的通道被丢弃，不自动重试写操作。前端快照不含密文或明文凭据；任务结果递归清理敏感字段和当前密钥。

编辑器副本不复制用户数据，仅复用 Remote SSH 扩展程序。独立 JSONC 设置保留原值并备份，下载缓存需 SHA-256 一致才复用。手工导入 Server 不绕过官方校验，仍需联网读取对应版本校验信息，尚不支持完全离线安装。

## 验证范围

自动化检查覆盖前端交互、配置与 scope 兼容、DPAPI、服务密钥生命周期、设置迁移、SSH 参数、嵌入 Agent 多次 RPC、超时、Harness 进程匹配及原生桌面冒烟。旧 Python 回归在 Windows CI 单独运行，旧版发布工作流仍仅响应 `v1.*` 标签。

这些检查不等于新版已在真实板卡上完成验收。仍需验证首次 SSH 密码授权、网络中断恢复、真实 ARM64 / x86_64 工具安装、官方登录、VS Code Remote SSH 和扩展、Harness 长任务及退出策略。历史文档中的 LPB3568 实测来自 Python 版，不代表新版已实测。涉及推理的验证必须由用户确认额度消耗。

### 本次本机验证记录（2026-11-06）

| 检查 | 实际结果 |
| --- | --- |
| TypeScript / Vite 优化构建 | 通过 |
| React 工作流测试 | 6 通过 |
| Rust 单元与协议测试 | 18 通过 |
| Rustfmt / Clippy 严格检查 | 通过 |
| npm 依赖审计 | 0 个已知漏洞 |
| 优化版原生桌面冒烟 | 通过；隔离配置下验证环境编辑、API CRUD 与 DPAPI、官方账号记录、任务互斥与取消、页面和图标 |
| 旧 Python 全量回归 | 95 通过、2 跳过、1 个 Tcl 初始化失败；失败用例单独重跑 1 通过 |
| 本次修改相关的旧版认证测试 | 5 通过 |

测试不包含真实板卡安装、账号登录或付费推理；优化 EXE 的桌面冒烟不代表安装程序已在干净系统完整安装验收。
