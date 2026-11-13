import kimi from "../image/providers/kimi-color.svg";
import grok from "../image/providers/grok.svg";
import qwen from "../image/providers/qwen-color.svg";
import copilot from "../image/providers/githubcopilot.svg";
export const extraCodingTools = [
  {
    id: "kimi",
    name: "Kimi Code",
    icon: kimi,
    category: "ai",
    description:
      "Moonshot 官方终端编程助手，使用 uv 安装独立 Python 工具环境。",
  },
  {
    id: "grok",
    name: "Grok CLI",
    icon: grok,
    category: "ai",
    description:
      "社区 Grok 编程代理（@vibe-kit/grok-cli），使用 xAI 模型；非 xAI 官方 CLI。",
  },
  {
    id: "qwen",
    name: "Qwen Code",
    icon: qwen,
    category: "ai",
    description: "阿里云开源终端编程代理，支持 Qwen 模型与兼容 API。",
  },
  {
    id: "copilot",
    name: "GitHub Copilot CLI",
    icon: copilot,
    category: "ai",
    description: "GitHub 官方终端编程代理，使用 GitHub 账号授权。",
  },
];
