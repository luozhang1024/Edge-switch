# 模型服务与板卡工具

模型服务页面顶部选择的是**板卡上运行的工具**，下面的卡片配置该工具使用的模型 API。工具和模型供应商可以不同；能否连接取决于 API 协议兼容性。

| 工具 | 可配置的接口 | 启动方式 |
| --- | --- | --- |
| Codex | OpenAI Responses；另支持 ChatGPT 官方账号 | 板卡 SSH 终端 |
| Claude Code | Anthropic Messages 或兼容网关 | 板卡 SSH 终端 |
| DeepSeek Harness | OpenAI Chat Completions、Responses、Anthropic Messages | 板卡后台服务 + 本地转发网页 |
| Gemini CLI | Gemini 原生 API 或兼容网关 | 板卡 SSH 终端 |
| OpenCode | OpenAI Chat Completions、Responses、Anthropic Messages、Gemini | 板卡 SSH 终端 |

Edge Switch 通过 SSH 为远程 Linux 板卡安装 CLI 工具、配置代理网络和大模型 API，并切换 API 供应商。模型服务顶部的图标表示 Codex、Claude Code 等远程 CLI 工具，不是 API 供应商。

模型服务参考 CC Switch 的工具图标栏和横向供应商卡片布局。Codex 工具使用 OpenAI 标志，**OpenAI Official** 卡片使用绿色 OpenAI 标志，并固定显示在 Codex 列表首位。悬浮卡片时显示启用、编辑、复制、测试和删除图标，悬浮图标查看说明；键盘聚焦时也会显示操作。API 复制会创建包含图标、接口配置和密钥的独立副本，沿用原记录是否加密保存密钥的选择。官方账号是当前设备环境的单个登录入口，其复制操作仅复制账号名称和备注。测试单条 API 不会切换当前活动服务；从远程板卡执行连通性检查，不发起付费推理。

添加服务按钮使用 `加.png` 图标，打开整页“添加新供应商”表单。顶部可切换“当前 CLI 供应商”和“统一供应商 · New API”。CLI 预设按顺序只保留自定义配置、该工具官方入口、OpenRouter、TheRouter；应用按工具和预设自动选择请求格式，无需手动选择协议。不同 CLI 的网关地址可能不同，预设地址参考仓库内 CC Switch 配置。供应商仍需提供对应工具兼容的接口，应用不执行协议转换。

统一 New API 在当前设备环境中保存一次，在各工具列表中复用；每个工具独立选择是否启用它。切换到 Claude 或 Gemini 时自动适配接口根路径和请求格式，实际可用性仍取决于 New API 部署支持的接口与模型。

预设下方可上传 PNG、JPG 或 WebP 图标（不超过 2 MB）；应用缩放为 128×128 PNG，随供应商配置保存在本机。恢复默认、关闭、取消或 Escape 不保存当前修改。

表单显示“API请求地址”和“模型名称”。模型名称可手填，也可点击“获取模型列表”后选择。列表获取由 Windows 控制端发出，使用当前设备环境的本机代理设置；列表卡片上的“测试”则从 SSH 连接的远程设备发出。查询失败不覆盖手填模型。

编辑时载入已保存的 API Key，默认以密码字段遮罩显示，点击眼睛查看或隐藏明文；更改请求地址会清空编辑框，必须输入目标地址对应的密钥。Codex 的 `config.toml (TOML)` 与 `auth.json (JSON)` 只读预览显示在表单底部，随字段自动生成，密钥预览随眼睛按钮一起显隐；远程配置仍由应用在同步时生成。其他工具显示连接配置摘要，不套用 Codex 的文件格式。

例如，选择 **Codex → 添加服务 → OpenAI / ChatGPT API**，填入模型 ID 和 API Key，就可以让板卡上的 Codex 使用该 API。选择 **DeepSeek Harness → 添加服务 → OpenAI / ChatGPT API**，也可以让 Harness 使用 OpenAI API；选 DeepSeek 时默认使用它的 Chat Completions 接口。

Codex 使用 DeepSeek 等模型时，需要供应商或中转网关提供 Responses 接口；DeepSeek 原生 Chat Completions 地址不能直接作为 Codex 的 Responses 地址。选择不兼容的供应商预设时，地址留空，要求填写兼容网关地址。应用不会自动转换协议。

**ChatGPT 官方账号**卡片用于 Codex 账号登录或导入 `auth.json`；**OpenAI / ChatGPT API** 是单独计费的 API Key 接入方式，订阅账号登录不等同于 API 密钥。

## 使用流程

### 授权中心与账号模型

“设置 → 授权中心”的 ChatGPT 卡片提供**浏览器登录**与**设备码登录**两种方式。浏览器登录使用本机 `localhost:1455/auth/callback` 接收官方 OAuth 回调，以 PKCE S256 和 state 校验交换授权，凭据通过 Windows DPAPI 加密保存在发起登录的工作环境中；同步时才写到板卡。1455 端口被其他程序占用时会明确报错，可选择设备码登录。设备码登录仍通过远程 Codex CLI 与 SSH 终端完成。导入 `auth.json` 位于单独的“导入 / 管理 auth.json”入口，不是第三种登录方式。

DeepSeek Harness 卡片自动读取 Edge Switch 进程继承的 `$DSH_HOME/.credentials.yaml`，未设置时读取 `~/.dsh/.credentials.yaml`，识别 `records["deepseek-account-platform/default"]` 中的原生账号授权。本机 Harness Web/Desktop 中登录的账号可直接被识别，不需要导出密钥；打开页面、切回应用、任务结束后及每 30 秒刷新一次，可查看账号、充值余额与赠金余额。网络错误和授权失效分别显示，不把无法查询余额当作已退出登录。

点击“添加账号”使用 DeepSeek 平台原生浏览器授权流程（PKCE S256，本机回调，取消时尽力撤回授权请求），成功后写入同一份原生凭据，保留其他 records 与 API Key refs。平台账号请求仅发往 `https://platform.deepseek.com`，携带 `x-dsh-auth-token`，不跟随重定向；渲染界面不会收到账号令牌。

点击“同步账号到当前板卡并启用”，将本机账号 grant 写入该工作环境独立的 `harness-home/.credentials.yaml`，保留板卡上其他 records 与 refs。写入核对读取时的内容哈希并使用 Harness 原生 `.lock` 锁，拒绝覆盖并发修改；Harness 运行中需先停止。同步同时移除 Edge Switch 自己的 API 覆盖配置，选择该环境的 Harness 官方账号通道，不修改原生 profile。随后打开 Harness，选择 DeepSeek 账号模型即可使用该账号额度。账号授权**不是普通 API Key**，不会写入统一 API 供应商，也不会声称能直接用于 Codex 等其他工具。切回 API 模式仍在模型服务列表中启用对应供应商。

实现协议与原生格式参考仓库内 `cc-switch-reference` 的 `services/dsh_account.rs`、`dsh_config.rs`、`codex_oauth_auth/browser.rs` 以及 `docs/deepseek-harness-integration-zh.md`。参考项目不随 Edge Switch 源码或安装包打包。

1. 创建工作环境，或悬停具体环境后点击“编辑”。在“SSH 与网络”中配置板卡与代理并保存；选中该环境后，从侧边栏“工具安装”查询版本、安装独立 Node.js 和所需工具。本机 Windows 使用该页提供的 npm 命令在本机终端安装。
2. 进入模型服务，选择 Codex、Claude Code、DeepSeek Harness、Gemini CLI 或 OpenCode。
3. 添加服务，选择 CLI 或统一 New API 供应商，填写 API 请求地址、准确的模型名称和对应 API Key。
4. 保存后悬停服务卡片，点击第一个启用图标；选中后变为“使用中”。悬停其他操作图标可查看含义。环境与供应商列表均支持拖动排序，顺序自动保存。
5. 展开列表下方的“验证与同步”，点击“连通性检查”读取模型列表；部分网关不提供模型列表，可以手填模型名称。推理验证会先提示可能消耗额度，确认后才发出最小请求；它不代表完整工具调用兼容性已验证。任务会自动弹出进度、结果或错误，也可在“设置 → 日志”中回看。
6. 点击“同步到板卡”，再点击“打开”启动工具。启动也会先检查并同步所选配置。

首次使用时，各 CLI 默认展示自己的官方入口：Codex 为 OpenAI Official，Claude Code 为 Claude Official，Gemini CLI 为 Gemini Official，OpenCode 为 OpenCode Zen。Codex 在“设置 → 授权中心”中选择浏览器或设备码登录，也可单独导入凭据；其他工具点击官方卡片的登录图标，在板卡终端按提示授权。打开登录终端并不代表授权完成。各工具的官方登录与自定义 API 使用独立目录，切换后保留凭据。Harness 的账号入口可跳转授权中心，识别并同步本机账号；普通 DeepSeek API 接入仍需填写模型和 API Key，已有供应商不会被清除。

Harness 多供应商设置要求 **0.2.2 或更新版本**。当前适配器不提供 Gemini 原生自定义路由；需要使用 Gemini CLI、OpenCode，或为 Harness 选择兼容的 OpenAI 网关。Harness 运行期间更换配置会被拒绝，请先选中具体工作环境，在侧边栏“工具安装”中停止 Harness，再同步并重新打开，避免中断现有任务；配置不变时可以重新打开现有网页。

## 配置与凭据

旧版未标注所属工具的 API 记录继续归于 Codex，已有 ChatGPT 官方账号保留。其他工具新建独立服务卡片和活动服务绑定。

本地可选择 Windows DPAPI 加密保存 API Key；不勾选时，密钥仅在本次进程中保留。更改 API 地址必须重新输入目标地址对应的 Key。同步到板卡后，运行所需密钥以仅当前用户可读的文件保存在该工作环境的专属目录。应用使用工具专属配置目录与启动脚本，避免串用其他工具的 API Key；不清除用户项目已有的工具配置。

Harness 通过独立 `--patch` 配置多供应商适配器和默认模型，不覆盖用户的 `settings.yaml`、home patch 和现有会话。OpenCode 使用独立配置文件与数据目录，Gemini 使用 `GEMINI_CLI_HOME`，Claude 使用 `CLAUDE_CONFIG_DIR`。模型卡片的“删除”删除本地记录和本地密钥；已有板卡文件保留。

## 参考与验证范围

品牌图标来自 [LobeHub Icons](https://lobehub.com/zh/icons)，以本地 SVG 随应用打包，授权与固定来源版本记录在 [图标目录](../image/providers/README.md)。

配置格式参考 [Claude Code settings](https://code.claude.com/docs/en/settings)、[Gemini CLI configuration](https://geminicli.com/docs/reference/configuration/)、[OpenCode providers](https://opencode.ai/docs/providers/) 及发布到 npm 的 `@deepseek-ai/dsh`、`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-llm-pi-ai` 0.2.2-rc.1 文档。Codex 延续已有的 Responses 配置与官方账号隔离实现。

本地回归覆盖工具服务隔离、配置生成、原生协议测试请求、密钥边界与桌面交互。授权中心新增回调 state 校验、原生凭据合并与并发写入保护、账号识别与余额展示测试；另外使用本机已登录的 Harness 账号实际完成一次只读资料和余额查询。未使用真实账号或 API Key 调用付费模型，未连接真实板卡；首次浏览器授权的人工确认、真实供应商的模型权限、流式响应、工具调用以及不同 Linux 架构上的安装仍需实机验证。
