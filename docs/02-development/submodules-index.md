# Submodule 索引

本索引记录长期 submodule 的来源、边界、消费者和验证方式。新增、移动、删除 submodule 时必须同步本文件和 `.gitmodules`。

## 锁定 submodule

| Path | URL | 边界 | 消费者 | 验证方式 | 状态 |
| --- | --- | --- | --- | --- | --- |
| `vendor/research/aces-research` | `https://github.com/aces-org-zhuang/aces-research.git` | 研究过程、论文、开源对比、证据包 | 研究任务、论文任务、证据验证任务 | `git submodule status --recursive` | 已添加，pinned `b2025592f1b5a5b37f1ca538ab6dfcf091e74e36` |
| `vendor/ai/maop` | `https://github.com/aces-org-zhuang/maop.git` | maop-owned AI 引擎和 OpenCode 能力面 | `.opencode/opencode.json` | `git -C vendor/ai/maop sparse-checkout list` 应包含 `/.opencode/` 和 `/README.md`；`git -C vendor/ai/maop branch -r --contains <pinned>` 应包含 `origin/main` | 已添加，pinned `c5269031d9ca90889357c67da4869929c3377fa2`，已启用 sparse-checkout，commit 已在 `origin/main` 可见 |
| `vendor/design/aces-design` | `https://github.com/aces-org-zhuang/design-beauty.git` | 架构模型、视图、时序图、部署视图（`src/**/*.c4`）与架构交接规格（`handoff/current.md`）；不含需与代码同 PR 的内容 | `.opencode/opencode.json` 的 `likec4` MCP；`technical-design` 与 `implementation-delivery` 经 `handoff/current.md` 复用架构边界；开发者经 `likec4 serve` 浏览 | `git -C vendor/design/aces-design rev-parse --short HEAD`；`npm run validate` 在设计仓内执行 | 已添加，pinned `c4ff01b`（中文化 + 修正损坏字符 + 移除多余 config + 首次交接规格），**未启用 sparse-checkout**（LikeC4 需要完整工作区），主仓不构建 |

## 设计仓条目说明

### 边界

设计仓只承载跨 PR 生命周期的架构资产：组件划分、集成关系、部署形态、时序流程。

**需与代码同一个 PR 的内容留在本仓 `docs/`**，例如模块级接口草案、实现级契约、字段级设计。原因：设计仓通过 submodule 指针固定，内容变更需先在设计仓发版再回主仓提 PR；若把代码附属设计放进去，设计必然滞后于代码。

### 消费者

- `architecture-design` 技能经 `likec4` MCP 查询模型（结构化图查询，而非读取 `.c4` 原文）
- 开发者经设计仓内 `npm run dev`（`likec4 serve`）热预览

### 构建入口

`none`。主仓**不构建**设计仓，`likec4 build` 由设计仓自身 CI 执行。设计仓 CI 地址：https://github.com/aces-org-zhuang/design-beauty/actions

### 验证入口

设计仓 CI 执行 `likec4 validate` 与 `likec4 format --check`。主仓 CI 只做只读检出（需 `submodules: recursive`），不执行设计仓校验。

### 更新策略

固定 commit，不自动跟随。设计仓发版后由本仓开 PR 更新 submodule 指针。gitlink 不会自动同步。

### 指针同步检查

设计仓有独立 CI，无法在本仓 CI 里直接感知它是否发版。用以下命令检查指针是否落后：

```bash
# 设计仓远端最新 commit
git ls-remote https://github.com/aces-org-zhuang/design-beauty.git refs/heads/main

# 本仓记录的指针
git ls-tree HEAD vendor/design/aces-design
```

两者不一致时，按顺序处理：

1. 在本仓开 PR，只改 `vendor/design/aces-design` 的 gitlink 与本索引的 `pinned` 值
2. 同步 `AGENTS.md` 中如有需要更新的架构描述
3. 合并后通知使用者重启 OpenCode（MCP 的 `LIKEC4_WORKSPACE` 路径不变，但模型内容已更新）

指针落后不影响主仓构建与测试，只会让 AI 读到旧架构上下文。因此它属于**需要修复但不阻塞交付**的问题。

## 规则

- 不普通 clone 外部参考仓到主仓。
- 研究参考仓放入具体课题 `vendor/research/aces-research/topics/<research_slug>/repos/<repo_name>`。
- maop submodule 必须启用 sparse-checkout，只检出 `.opencode` 和 `README.md`。
- **设计仓 submodule 必须禁用 sparse-checkout**。LikeC4 CLI 需要完整工作区才能执行 `validate` 与 `build`；部分检出会导致跨文件 `include` 目标缺失而构建失败。这与 maop 的规则相反，不要照搬。
- **一个设计仓只服务一个项目**。禁止多个项目共用同一设计仓 submodule——gitlink 记录子仓 HEAD commit，会导致每次设计提交都在所有引用方仓产生无关 PR。
- 主仓不递归初始化 maop 内部 submodule；maop 内部依赖由 maop 仓库自身治理。
- 当前用户确认暂不初始化 `vendor/research/aces-research/topics/wechat-customer-service-ai-faq-feedback/repos/FastGPT/pro`；该嵌套 submodule 不作为本轮初始化 RED 点。

## 架构交接规格

架构交接规格位于设计仓内的 `handoff/current.md`，**不放主仓 docs**。它是架构模型的派生物，必须与被引用的模型版本处于同一 commit；放主仓会出现「规格说 A、模型是 B」的错配，而主仓无法独立验证它对应哪个模型版本。主仓 docs 承载的是规则、索引与需与代码同 PR 的内容。

| 项 | 约定 |
| --- | --- |
| 路径 | `vendor/design/aces-design/handoff/current.md` |
| 历史版本 | `handoff/history/<模型 commit>.md` |
| 消费者 | `technical-design` 补齐接口与数据；`implementation-delivery` 消费完整交接包 |
| 过期判定 | 规格记录的模型 commit 与本仓 pinned gitlink 不一致即视为过期 |
| 缺失处理 | 文件不存在表示尚未产出，不阻塞实现类任务，只是不做架构复用 |
| 修改方式 | 只读不改。需要修正架构时由 `architecture-design` 重新产出 |

**依赖关系变更或部署形态变更前，先读该规格确认组件边界与依赖方向，不要重新推导。**

