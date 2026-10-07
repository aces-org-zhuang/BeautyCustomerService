# Project OpenCode Components

本目录保存项目级 OpenCode 桥接配置。

## 目录

- `opencode.json`: 项目级桥接配置，指向 maop 的 OpenCode 能力面。
- `skills/`: 项目本地 skills，可选，仅用于项目专属覆盖。
- `agents/`: 项目本地 agents，可选，仅用于项目专属覆盖。
- `commands/`: 项目本地 commands，可选，仅用于项目专属覆盖。
- `plugins/`: 项目本地 plugins，可选。

## 配置策略

新项目初始化默认生成最小 `.opencode/opencode.json`，用于桥接 `vendor/ai/maop/.opencode`。

建议 schema：`https://opencode.ai/config.json`。

修改 skill、agent、command、plugin 或 `opencode.json` 后，需要重启 OpenCode 才会生效。

## maop 边界

AI 引擎 submodule 位于 `vendor/ai/maop/`，通过 sparse-checkout 只检出 `.opencode` 和 `README.md`。`vendor/ai/maop/.opencode/` 属于 maop 仓库，由 maop 独立演进。本项目 `.opencode/` 只保存桥接配置和项目专属覆盖，不复制、不覆盖 maop 的 `.opencode`。

## MCP 配置

本项目登记两个 MCP server：

| 名称 | 作用 | Workspace |
| --- | --- | --- |
| `playwright` | 浏览器自动化 | 默认 |
| `likec4` | 查询架构模型，让 AI 以结构化图查询代替读 `.c4` 原文 | `vendor/design/aces-design` |

### likec4

架构模型 submodule 位于 `vendor/design/aces-design/`，用 LikeC4 DSL 描述组件、集成、部署与时序流程。

- `@likec4/mcp` 自带 LikeC4 内核，**无需本地安装 likec4**，`npx` 即可运行。
- MCP 默认 watch，改模型文件会热重载，**不需要重启**。
- 修改 `opencode.json` 本身仍需重启 OpenCode。
- 主仓不构建设计仓，也不对设计仓执行 sparse-checkout；`validate` 与 `build` 由设计仓 CI 负责。

常用查询示例：

- 「列出 `beauty.answerOrchestrator` 的下游依赖」→ `query-outgoers-graph`
- 「RAGFlow 检索的上游是谁」→ `query-incomers-graph`
- 「哪些元素出现在部署视图里」→ `query-by-tags`

## 设计仓边界

设计仓只承载跨 PR 生命周期的架构资产。**需与代码同一个 PR 的设计内容留在 `docs/`**，例如模块级接口草案、实现级契约、字段级设计。

设计仓发版后，本仓需开 PR 更新 submodule 指针；gitlink 不会自动跟随。

