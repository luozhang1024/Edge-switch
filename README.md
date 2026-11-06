<div align="center">

**简体中文** | [English](README.en.md)

<img src="image/EdgeAI.png" alt="Edge Switch" width="96" />

# Edge Switch

**面向 Linux 板卡的远程 AI 开发工作台**

在 Windows 上管理 SSH 工作环境、网络代理与模型服务，让 Codex、DeepSeek Harness 更容易部署和使用。

[![Version](https://img.shields.io/badge/version-1.1.0-blue)](https://github.com/luozhang52/Edge-switch/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20x64-lightgrey)](#环境要求)
[![Built with](https://img.shields.io/badge/built%20with-Python%20%2B%20CustomTkinter-3776AB)](#开发与构建)
[![Target](https://img.shields.io/badge/target-Linux%20ARM64%20%7C%20x86__64-34C759)](#环境要求)
[![Downloads](https://img.shields.io/github/downloads/luozhang52/Edge-switch/total?label=downloads&color=007AFF)](https://github.com/luozhang52/Edge-switch/releases)
[![Stars](https://img.shields.io/github/stars/luozhang52/Edge-switch?style=flat&color=F5A623)](https://github.com/luozhang52/Edge-switch/stargazers)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)

[下载安装](#下载安装) · [快速开始](#快速开始) · [常见问题](#常见问题) · [Star History](#star-history) · [支持项目](#支持项目)

</div>

## 项目简介

Edge Switch 将板卡 AI 开发中分散的连接、安装、代理和认证操作集中到一个桌面界面。为不同设备或工程创建工作环境，切换官方 ChatGPT 账号与自定义 API，再从工作台打开 VS Code 或 Harness 网页。

程序窗口、托盘和安装包统一使用 **Edge Switch**，当前版本 **1.1.0**。为兼容旧版，本机配置目录保留 `EdgeSSHAI`。桌面端运行于 Windows，AI 工具运行于通过 SSH 连接的 Linux 设备。中英文文档可从首页顶部切换，当前程序界面为中文。

## 功能亮点

| 功能 | 使用体验 |
| --- | --- |
| 多工作环境 | 卡片式管理设备、SSH 身份和工程目录，按需切换，记住上次选择 |
| 首次 SSH 配置 | 为当前电脑创建密钥，在终端输入板卡密码完成公钥授权，不保存 SSH 密码 |
| 工具部署 | 安装独立 Node.js，后台读取 Codex / Harness 版本，从下拉列表选择安装 |
| 多模型服务 | 添加、编辑和切换 API；默认提供 OpenAI Official 官方账号入口 |
| 官方账号管理 | 支持设备码登录、导入本人 `auth.json`，与 API 凭据分别保存 |
| 测试与验证 | 区分连通性测试和实际推理验证，推理前提示额度消耗 |
| 独立网络配置 | Codex 与 Harness 分别选择板卡直连或电脑代理，SSH 隧道支持断线重连 |
| VS Code 接入 | 检查 Remote SSH 与远程 Codex 扩展，配置当前环境的专属启动入口 |
| Harness 网页 | 通过 SSH 转发访问，重开现有服务，支持在板卡后台继续运行 |
| 托盘与安装包 | 关闭窗口后缩至系统托盘，提供无需预装 Python 的 Windows 安装包 |

### 界面预览

以下为历史版本截图，布局与按钮以当前版本为准。

<table>
  <tr>
    <td align="center"><img src="docs/workbench-0.10-environments.png" alt="工作环境列表" width="480" /><br />工作环境</td>
    <td align="center"><img src="docs/workbench-0.10-tools.png" alt="AI 工具安装与启动" width="480" /><br />AI 工具</td>
  </tr>
  <tr>
    <td align="center"><img src="docs/workbench-0.9-api.png" alt="模型服务卡片列表" width="480" /><br />模型服务</td>
    <td align="center"><img src="docs/workbench-0.5-overview.png" alt="设备资源与运行状态" width="480" /><br />设备总览</td>
  </tr>
</table>

## 环境要求

| 组件 | 要求 |
| --- | --- |
| 本地电脑 | Windows x64，安装系统 OpenSSH 客户端 |
| 远程开发 | 安装 VS Code，并确保 `code` 命令可用 |
| Linux 设备 | ARM64 / x86_64、glibc ≥ 2.28、Python ≥ 3.8，已启用 SSH 服务 |
| 存储与权限 | 可写用户目录，以及足够的工具安装空间；安装运行环境时检查剩余空间 |
| 网络 | 电脑至板卡 SSH 可达；下载、扩展市场和模型服务分别需要可用网络 |

已实机验证：**LPB3568 / ARM64 / glibc 2.31**。ARMv7、RISC-V、musl / Alpine、Android 等环境尚未适配；不同发行版仍需满足 VS Code Server 和上游工具的依赖。

## 下载安装

在 [Releases](https://github.com/luozhang52/Edge-switch/releases) 查看已发布版本与附件。如发布页尚无附件，可按下方步骤从源码构建。

| 方式 | 当前构建产物 | 说明 |
| --- | --- | --- |
| 安装版 | `EdgeSwitch-Setup-1.1.3.exe` | 安装到当前 Windows 用户，支持快捷方式与卸载 |
| 便携版 | `EdgeSwitch-1.1.3-Windows-x64.zip` | 解压后运行 EXE，附带许可与中英文说明 |
| 对应源码 | `EdgeSwitch-1.1.3-source.zip` | 本次构建的源码快照，含构建脚本与资源 |
| 源码运行 | `Start-Workbench.cmd` / `start_workbench.py` | 需要 Python 与项目依赖 |

升级前，请从侧栏或托盘菜单选择 **退出程序**，再安装新版。安装包不携带开发者的设备配置、API Key、SSH 私钥或官方账号凭据。给同事使用时，每台电脑分别完成 SSH 授权和模型认证。

发布附件另提供 `SHA256SUMS.txt` 校验文件。版本号遵循 `主版本.次版本.修订版本`，本次发布标签为 `v1.1.3`。版本号不表示所有 Linux 设备或上游工具版本均已验证。

> 仅点击窗口右上角关闭按钮会缩至托盘，程序仍在运行。

## 快速开始

### 1. 建立工作环境

进入 **工作环境**，添加设备地址、Linux 用户、SSH 端口和工程目录。示例地址可使用 `192.168.1.100`，工程目录应填写实际代码位置，例如 `/home/developer/project`。

首次使用点击 **配置 SSH 登录**，在终端核验主机指纹并输入板卡密码。连接测试成功、设备信息可读取后，再继续下一步。已有授权密钥可在编辑窗口直接选择私钥文件。

### 2. 选择网络线路

进入 **代理网络**，为 Codex、Harness 分别选择板卡直连或使用电脑代理。如果服务可以直连，此步骤可跳过。

使用电脑代理时，先运行 FlClash 等兼容工具，再填写实际 HTTP / mixed 端口。运行环境下载与版本查询有独立网络选项；工具安装使用各工具的网络设置。

```text
板卡 AI 工具 → SSH 反向隧道 → 电脑 HTTP / mixed 代理 → 模型服务
```

浏览器账号授权使用电脑浏览器自身的网络，板卡的代理开关不会替浏览器设置代理。

### 3. 安装 AI 工具

进入 **AI 工具**，先点击 **检测板卡工具**。同一 Linux 账号已安装工具时可点击 **使用已有工具**，版本验证通过后复用程序，无需重复下载；账号与任务仍独立。未发现已有安装时，先安装受管 Node.js，再选择版本安装 Codex 或 Harness。版本列表在后台获取，操作结果可在底部 **运行记录** 查看。独立运行环境不替换板卡系统 Node.js。

### 4. 启用模型服务

**官方账号：** 在 **模型服务** 中启用 **OpenAI Official**。未登录时，在编辑窗口选择 **账号登录**，按终端提示在浏览器完成设备码授权；也可导入你本人已登录的 Codex `auth.json`。无需填写 API Key。

**自定义 API：** 点击加号，填写名称、HTTPS 地址、准确模型 ID、协议和 API Key。Codex 需要 **Responses** 协议；Chat Completions 服务可保存和测试。保存后，将鼠标移至卡片，点击 **启用**，成功后显示 **使用中**。

| 图标操作 | 自定义 API | OpenAI Official |
| --- | --- | --- |
| 编辑 | 修改地址、模型、协议和密钥 | 修改名称、备注，导入凭据或发起账号登录 |
| 测试 | 检查接口连通与模型列表 | 检查官方网页连通与 CLI 登录识别 |
| 验证 | 发送最小推理请求 | 通过官方 Codex 发送最小推理请求 |
| 删除 | 删除本机服务记录与保存密钥 | 内置服务不可删除，图标置灰 |

测试通过不代表推理一定成功。点击 **验证** 会先提示可能消耗 API 余额或账号额度；只有完整模型回答才报告推理通过。官方账号的权限与额度由账号套餐及服务可用性决定。

### 5. 开始远程开发

- **Codex / VS Code：** 点击 **打开 VS Code**，使用工作台打开的远程窗口。若已有窗口仍读取旧配置，保存文件后执行 `Developer: Reload Window`；Codex 终端需要重新打开。
- **Codex 终端：** 在 **AI 工具 → Codex** 点击 **打开终端**。
- **Harness：** 点击 **打开网页**，在网页 **Settings → Models** 配置模型服务。Harness 模型配置由其自身管理，不会自动复制工作台中的 API Key。

关闭 Harness 网页不会停止后台服务，再次打开会尝试接回已有服务。需要结束任务时点击 **停止**。

## 配置与数据

| 位置 | 内容 |
| --- | --- |
| `%LOCALAPPDATA%\EdgeSSHAI` | 本机环境配置、加密凭据、SSH 密钥、缓存与专属 VS Code 设置 |
| `%LOCALAPPDATA%\Programs\Edge Switch` | 全新安装路径；升级旧版时沿用原安装位置 |
| `~/.local/share/edge-ssh-ai/<环境标识>/` | 板卡运行环境、工具、模型配置和后台服务状态 |

API Key 在勾选保存后通过 Windows DPAPI 加密，绑定当前 Windows 用户。导入的官方凭据也在本机加密保存；同步到板卡时通过 SSH 传递，认证文件权限为 `0600`。官方账号与 API 使用独立配置目录，切换后保留各自凭据。同一导入快照不会反复覆盖 Codex 已刷新的令牌。

卸载保留本机用户配置和板卡文件。手工清理前请核对环境标识，只处理对应的专属目录。

### 多人共用一个 Linux 账号

每台电脑为每个工作环境生成独立标识，分别管理配置、启动器和连接。工作台不修改共享 `~/.codex`、`.bashrc` / `.profile`，不自动重启共享 VS Code Server，也不按进程名批量停止其他人的任务。

这是配置和连接管理，**不是用户权限隔离**：同一 Linux 账号仍可访问彼此文件，并共享 CPU、内存和磁盘。v1.1.0 起，工作台为各环境准备独立 VS Code Server 目录。不要将本机环境配置整体复制到另一台电脑后同时使用，否则可能复用同一环境身份。

## 常见问题

<details>
<summary><strong>能避免系统 VS Code 更新导致板卡反复下载吗？</strong></summary>

可以。v1.1.0 起，首次打开会从电脑现有 VS Code 创建独立副本；之后固定使用该副本，不跟随系统 VS Code 更新。专属窗口关闭编辑器和扩展自动更新，本机 Remote SSH 扩展也使用独立目录。想升级时，在 **AI 工具 → 编辑器版本** 主动切换为系统当前版本或选择另一套已有的 `Code.exe`。切换前保存并关闭工作台打开的远程窗口；新版本可能需要匹配服务端和扩展。固定版本会额外占用本机磁盘，需自行安排后续升级以获得修复和兼容性更新。

板卡已有同一 commit 的可运行服务端时，工作台复制其程序文件到当前环境，无需联网下载；凭据、扩展和安装锁不复制。电脑和板卡缺少匹配文件的首次部署仍需要安装一次。Codex 终端与 Harness 不依赖 VS Code Server。

</details>

<details>
<summary><strong>每次开机或远程连接，都要重新下载 VS Code Server 吗？</strong></summary>

不需要。板卡已安装与电脑 VS Code commit 匹配的服务端时，直接启动；电脑和板卡重启都不会清除它。v1.1.0 起，电脑还在 `%LOCALAPPDATA%\EdgeSSHAI\downloads\vscode` 保存校验过的安装包，新环境可从缓存上传，无需重复访问下载站。下载失败会保留完成的分块，重试可复用。电脑 VS Code 更新、新环境首次安装或文件被清除时，才需要准备相应版本。服务端缓存不代替模型 API 网络连接。

</details>

<details>
<summary><strong>同事打开 VS Code 提示 Permission denied (publickey,password)</strong></summary>

这是 SSH 身份验证失败，与 API Key 无关。在同事电脑上点击 **工作环境 → 配置 SSH 登录**，使用该电脑自己的密钥完成公钥授权；或选择已有且获板卡授权的 SSH 私钥。

</details>

<details>
<summary><strong>官方授权链接提示 unsupported_country_region_territory</strong></summary>

先检查电脑浏览器的网络线路和官方地区支持。浏览器网络与板卡工具网络分别配置，只开启工作台的板卡代理选项不会改变浏览器线路。导入 `auth.json` 也不保证改变服务端的地区或账号限制。

</details>

<details>
<summary><strong>模型列表能读取，但推理失败</strong></summary>

列表读取与推理是不同请求。核对供应商返回的准确模型 ID、账号分组权限、余额和上游渠道，不要把展示名称直接当作模型 ID。需要实际验证时点击 **验证** 图标。

</details>

<details>
<summary><strong>VS Code 中仍显示未登录，或切换后没有生效</strong></summary>

从工作台重新打开 VS Code，并在已有窗口执行 `Developer: Reload Window`。若一直停留在“正在打开”，点击模型服务页的 **连接诊断** 查看本环境的 Remote - SSH 结果；首次连接检查 VS Code 登录终端提示。确认使用的是当前工作环境的窗口，其他入口打开的 VS Code 不会自动采用工作台专属配置。扩展升级后可重新打开以同步启动器。

</details>

<details>
<summary><strong>退出工作台后，Harness 还能继续使用吗？</strong></summary>

勾选后台运行后，Harness 进程可在板卡继续运行，但工作台退出会关闭其管理的 SSH 连接。如果 Harness 使用电脑代理，模型请求需要等待工作台重新连接；板卡直连不依赖这条代理链路。后台运行不包含板卡重启后自动启动。

</details>

<details>
<summary><strong>SSH 偶发超时，或者 VS Code 连接不稳定</strong></summary>

检查局域网、SSH 服务及板卡 CPU / 内存负载。工程目录应指向实际项目，避免选择 `/` 导致大范围文件扫描。连接失败不等于需要删除 VS Code Server，请先查看运行记录和设备状态。

</details>

## 开发与构建

源码运行需要 **Windows Python 3.10+（含 tkinter）**：

```powershell
git clone https://github.com/luozhang52/Edge-switch.git
cd Edge-switch
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe start_workbench.py
```

构建前在已安装依赖的 Python 环境中安装 PyInstaller。安装包构建另需 Inno Setup 6，可安装到系统目录或 `build/toolchain/inno`。

```powershell
.\.venv\Scripts\Activate.ps1
python -m pip install pyinstaller
.\Build-Workbench.cmd
.\Build-Installer.cmd
```

| 模块 | 职责 |
| --- | --- |
| `workbench/app.py` | 界面交互与后台任务 |
| `workbench/layout.py`、`workbench/ui.py` | 页面布局与通用组件 |
| `workbench/core.py` | 本机配置、DPAPI、OpenSSH 与隧道 |
| `workbench/api_ui.py`、`workbench/official_ui.py` | API 卡片与官方账号编辑 |
| `workbench/remote_agent.py` | 经 SSH 执行的板卡操作 |
| `workbench/harness_service.py` | Harness 后台服务管理 |

基本检查：

```powershell
python start_workbench.py --self-check
python -m unittest test_auth test_reopen test_workbench test_repair test_lifecycle
python -m unittest test_api_services
python -m unittest test_official_card
python -m unittest test_official_import.OfficialImportTests
```

`verify_board_05.py` 和 `verify_board_06.py` 为可选板卡集成检查，需要已配置的真实设备和受管工具；它们创建临时环境并清理，不自动发送模型推理。回归检查通过不代表已验证你所用账号、供应商或板卡的全部能力。

## 版本与项目反馈

- [发布版本与安装包](https://github.com/luozhang52/Edge-switch/releases)
- [问题反馈与功能建议](https://github.com/luozhang52/Edge-switch/issues)
- [历史版本说明](docs/历史说明.md)
- [验证记录](docs/第一版验证记录.md)

反馈时请附版本号、系统与板卡架构、复现步骤和脱敏日志，勿上传 API Key、SSH 私钥或 `auth.json` 登录令牌。

## 致谢

- [OpenAI Codex](https://github.com/openai/codex)：AI 编程助手与远程开发工具。
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：终端与 Web AI 开发工作流。
- [CC Switch](https://github.com/farion1231/cc-switch)：供应商卡片交互与官方账号配置方式的参考。
- [CustomTkinter](https://github.com/TomSchimansky/CustomTkinter)、[PyInstaller](https://github.com/pyinstaller/pyinstaller)、[Inno Setup](https://jrsoftware.org/isinfo.php)：桌面界面与 Windows 打包工具。

## 开源协议

Copyright © 2026 luozhang。Edge Switch 的项目原创代码采用 **GNU Affero General Public License v3.0（AGPL-3.0-only）**，完整条款见 [LICENSE](LICENSE)。

- 允许使用、研究、修改和商业使用；AGPL 不禁止商用。
- 分发受本协议覆盖的软件或修改版时，应保留版权、许可及相关声明，并按协议提供对应源码；分发修改版时应按 AGPL-3.0 授权并标明修改。
- 如果修改本程序并通过网络向用户提供交互服务，应按协议第 13 条，向这些用户显著提供免费获取该修改版对应源码的途径。
- 软件按“现状”提供，不附带任何担保，具体免责及责任限制见协议全文。

第三方依赖、上游 AI 工具及其他权利人的素材仍遵循各自的许可和使用条款，本协议不改变其授权。以上为使用说明，具体权利和义务以 LICENSE 全文为准。

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=luozhang52/Edge-switch&type=Date)](https://www.star-history.com/#luozhang52/Edge-switch&Date)

## 支持项目

如果 Edge Switch 帮你节省了部署和排查时间，欢迎点亮 Star、提交建议，或自愿赞助项目维护。

<div align="center">
<table>
  <tr>
    <th align="center">微信支付</th>
    <th align="center">支付宝</th>
  </tr>
  <tr>
    <td align="center"><img src="image/微信收款码.png" alt="微信收款码" width="220" /></td>
    <td align="center"><img src="image/支付宝收款码.png" alt="支付宝收款码" width="220" /></td>
  </tr>
</table>

Maintained by **luozhang**
</div>
