# 模型服务与板卡工具

模型服务页面顶部选择的是**板卡上运行的工具**，下面的卡片配置该工具使用的模型 API。工具和模型供应商可以不同；能否连接取决于 API 协议兼容性。

| 工具 | 可配置的接口 | 启动方式 |
| --- | --- | --- |
| Codex | OpenAI Responses；另支持 ChatGPT 官方账号 | 板卡 SSH 终端 |
| Claude Code | Anthropic Messages 或兼容网关 | 板卡 SSH 终端 |
| DeepSeek Harness | OpenAI Chat Completions、Responses、Anthropic Messages | 板卡后台服务 + 本地转发网页 |
| Gemini CLI | Gemini 原生 API 或兼容网关 | 板卡 SSH 终端 |
| OpenCode | OpenAI Chat Completions、Responses、Anthropic Messages、Gemini | 板卡 SSH 终端 |

模型服务参考 CC Switch 的工具图标栏和横向供应商卡片布局。Codex 工具使用 OpenAI 标志，**OpenAI Official** 卡片使用绿色 OpenAI 标志，并固定显示在 Codex 列表首位。卡片右侧提供启用、编辑、登录和删除操作，悬停可查看按钮名称。

添加服务按钮使用 `加.png` 图标，打开整页“添加新供应商”表单。页面顶部为当前工具的供应商分类，预设以按钮排列，下方直接显示配置表单；“自定义配置”之后的首个供应商为 **OpenAI Official**。点击预设会在当前页面切换配置，返回、取消或 Escape 均不保存。工具图标标签只切换该工具的供应商列表。

Codex 还提供从参考项目核对的 AiHubMix、DMXAPI、OpenRouter、TheRouter、PackyCode、Cubence、RightCode 和 CherryIN 网关预设，按自定义 Responses 服务保存，模型 ID 与 API Key 由用户填写；预设地址不代表已通过真实账号验证。

例如，选择 **Codex → 添加服务 → OpenAI / ChatGPT API**，填入模型 ID 和 API Key，就可以让板卡上的 Codex 使用该 API。选择 **DeepSeek Harness → 添加服务 → OpenAI / ChatGPT API**，也可以让 Harness 使用 OpenAI API；选 DeepSeek 时默认使用它的 Chat Completions 接口。

Codex 使用 DeepSeek 等模型时，需要供应商或中转网关提供 Responses 接口；DeepSeek 原生 Chat Completions 地址不能直接作为 Codex 的 Responses 地址。选择不兼容的供应商预设时，地址留空，要求填写兼容网关地址。应用不会自动转换协议。

**ChatGPT 官方账号**卡片用于 Codex 账号登录或导入 `auth.json`；**OpenAI / ChatGPT API** 是单独计费的 API Key 接入方式，订阅账号登录不等同于 API 密钥。

## 使用流程

1. 在工作环境中选择板卡，在 AI 工具中查询版本并安装独立 Node.js 和所需工具。
2. 进入模型服务，选择 Codex、Claude Code、DeepSeek Harness、Gemini CLI 或 OpenCode。
3. 添加服务，选择供应商，填写 HTTPS API 地址、准确的模型 ID 和对应 API Key。自定义或中转网关可手动配置协议。
4. 保存后点击服务卡片的“使用”。每个工具独立记住当前服务；这一步只更新本地配置。
5. 展开列表下方的“验证与同步”，点击“连通性检查”读取模型列表；部分网关不提供模型列表，可以手填模型 ID。推理验证会先提示可能消耗额度，确认后才发出最小请求；它不代表完整工具调用兼容性已验证。
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
