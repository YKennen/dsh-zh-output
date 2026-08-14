# DeepSeek Harness 中文输出插件（dsh-zh-output）

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供「强制中文思考与输出」的中文预设（模式）。

每个中文预设都满足两条硬性约束：

1. 注入给模型的第一句话是中文；
2. persona 中写入「语言铁律」，强制模型的全部思考过程与所有输出使用中文（仅代码、命令、标识符、URL、文件路径、日志原文等非自然语言内容可保留原样）。

## 包含的模式

| 目录（预设 id） | 显示名 | 对应官方模式 |
|----------------|--------|-------------|
| `standard-zh` | 标准模式（中文） | `standard` |
| `code-zh`     | PTC 模式（中文）  | `code`      |
| `minimal-zh`  | 极简模式（中文）  | `minimal`   |
| `cordis-zh`   | 创造模式（中文）  | `cordis`    |

每个预设都基于官方预设完整复制而来，仅改动人设（persona）、计划模式提示词与注释，功能与官方版本一致。

## 安装

### 方式一（推荐，任何部署都可靠）：复制到用户预设目录

把 `presets/` 下的目录复制到你的用户预设根目录。该目录默认是 `${DSH_HOME:-$HOME/.dsh}/.agent-presets/`（Windows 下为 `%DSH_HOME%\.agent-presets\`，未设置 `DSH_HOME` 时为 `%USERPROFILE%\.dsh\.agent-presets\`）。

Windows PowerShell（在本仓库根目录执行）：

```powershell
$root = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$dest = Join-Path $root '.agent-presets'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -Recurse -Force .\presets\* $dest
```

macOS / Linux（在本仓库根目录执行）：

```bash
mkdir -p "${DSH_HOME:-$HOME/.dsh}/.agent-presets"
cp -R presets/* "${DSH_HOME:-$HOME/.dsh}/.agent-presets/"
```

复制后，在 Web 界面的模式选择器（或新建会话时）即可看到四个「（中文）」模式。预设名单是即时重扫的，无需重启。

### 方式二：作为 DSH 组合包（bundle）安装

本仓库同时是一个 DSH 组合包（`package.json` 声明了 `dsh.bundle`），可安装进 profile：

```sh
# 从 GitHub 安装
dsh plugin --profile <name> add github:<你的用户名>/dsh-zh-output

# 或从本地 checkout 安装
dsh plugin --profile <name> add ./dsh-zh-output
```

> ⚠️ 注意：标准 web/headless CLI 在启动时会把 `agent-presets` 的 `roots` 强制改写为内置预设根，因此本组合包的预设登记在标准 CLI 下不生效。此方式主要用于自行组合 host 的部署（Python SDK 运行时、自定义 launcher 等）。**普通用户请优先用方式一。**

## 使用

1. 在 Web 界面选择「标准模式（中文）」「PTC 模式（中文）」「极简模式（中文）」或「创造模式（中文）」新建会话。
2. 想把中文预设设为默认：在设置里把 `agent-presets.default` 改为 `standard-zh`（或其他中文预设 id）。

## 关于「创造模式（中文）」

官方 `cordis` 预设的 `tool-cordis` 会注册进程级单例的运行时检查器（Cordis inspect provider），同一进程只能存在一个实例。为避免与官方「创造模式」同时挂载时冲突，`cordis-zh` 默认禁用了 `tool-cordis`（见 `presets/cordis-zh/agent.cordis.yml` 中的注释）。

- 效果：`cordis-zh` 保留组合创作指导技能（`editing-cordis-compositions`、`cordis-plugin-development`），但没有在线运行时检查 / 插件实验工具。
- 如果你从不使用官方「创造模式」，可删除 `presets/cordis-zh/agent.cordis.yml` 中 `tool-cordis` 行里的 `disabled: true` 以启用它。

## 目录结构

```
dsh-zh-output/
├── package.json       # 声明 dsh.bundle（组合包标记）
├── cordis.patch.yml   # 组合包补丁层：登记中文预设根
├── presets/           # 四个中文预设
│   ├── standard-zh/
│   ├── code-zh/
│   ├── minimal-zh/
│   └── cordis-zh/     # 含 skills/
├── README.md
├── PUBLISHING.md      # 发布到 GitHub 的步骤
└── LICENSE            # MIT
```

## 许可

MIT
