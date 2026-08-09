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
