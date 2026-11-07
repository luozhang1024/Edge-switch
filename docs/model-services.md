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

1. 在工作环境中选择板卡，在 AI 工具中查询版本并安装独立 Node.js 和所需工具。
2. 进入模型服务，选择 Codex、Claude Code、DeepSeek Harness、Gemini CLI 或 OpenCode。
3. 添加服务，选择 CLI 或统一 New API 供应商，填写 API 请求地址、准确的模型名称和对应 API Key。
4. 保存后点击服务卡片的“使用”。每个工具独立记住当前服务；这一步只更新本地配置。
5. 展开列表下方的“验证与同步”，点击“连通性检查”读取模型列表；部分网关不提供模型列表，可以手填模型名称。推理验证会先提示可能消耗额度，确认后才发出最小请求；它不代表完整工具调用兼容性已验证。Codex 官方账号的设备码登录也在此处。
6. 点击“同步到板卡”，再点击“打开”启动工具。启动也会先检查并同步所选配置。

Harness 多供应商设置要求 **0.2.2 或更新版本**。当前适配器不提供 Gemini 原生自定义路由；需要使用 Gemini CLI、OpenCode，或为 Harness 选择兼容的 OpenAI 网关。Harness 运行期间更换配置会被拒绝，请先在 AI 工具页停止 Harness，再同步并重新打开，避免中断现有任务；配置不变时可以重新打开现有网页。

## 配置与凭据

旧版未标注所属工具的 API 记录继续归于 Codex，已有 ChatGPT 官方账号保留。其他工具新建独立服务卡片和活动服务绑定。

本地可选择 Windows DPAPI 加密保存 API Key；不勾选时，密钥仅在本次进程中保留。更改 API 地址必须重新输入目标地址对应的 Key。同步到板卡后，运行所需密钥以仅当前用户可读的文件保存在该工作环境的专属目录。应用使用工具专属配置目录与启动脚本，避免串用其他工具的 API Key；不清除用户项目已有的工具配置。

Harness 通过独立 `--patch` 配置多供应商适配器和默认模型，不覆盖用户的 `settings.yaml`、home patch 和现有会话。OpenCode 使用独立配置文件与数据目录，Gemini 使用 `GEMINI_CLI_HOME`，Claude 使用 `CLAUDE_CONFIG_DIR`。模型卡片的“删除”删除本地记录和本地密钥；已有板卡文件保留。

## 参考与验证范围

品牌图标来自 [LobeHub Icons](https://lobehub.com/zh/icons)，以本地 SVG 随应用打包，授权与固定来源版本记录在 [图标目录](../image/providers/README.md)。

配置格式参考 [Claude Code settings](https://code.claude.com/docs/en/settings)、[Gemini CLI configuration](https://geminicli.com/docs/reference/configuration/)、[OpenCode providers](https://opencode.ai/docs/providers/) 及发布到 npm 的 `@deepseek-ai/dsh`、`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-llm-pi-ai` 0.2.2-rc.1 文档。Codex 延续已有的 Responses 配置与官方账号隔离实现。

本地回归覆盖工具服务隔离、配置生成、原生协议测试请求、密钥边界与桌面交互。未使用真实 API Key 调用付费模型，未连接真实板卡；真实供应商的模型权限、流式响应、工具调用以及不同 Linux 架构上的安装仍需实机验证。
