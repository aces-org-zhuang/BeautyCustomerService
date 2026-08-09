# BeautyCustomerService 文档中心

`docs/` 保存长期稳定知识。非研究类阶段性工程记录放在 `guides/`；研究过程、论文、开源仓库对比和证据包放在 `vendor/research/aces-research/`。AI 引擎能力位于 `vendor/ai/maop/` submodule，并通过 sparse-checkout + `.opencode/opencode.json` 桥接到项目 OpenCode。

## 快速入口

| 目标 | 阅读路径 |
| --- | --- |
| 了解项目整体 | `00-overview/README.md` |
| 修改架构或模块 | `01-architecture/README.md` |
| 查看开发规则 | `02-development/README.md` |
| 查看运行时或生命周期 | `03-runtime/README.md` |
| 验证、部署或排障 | `04-operations/README.md` |
| 修改 API、协议或跨边界契约 | `05-contracts/README.md` |
| 记录架构决策 | `06-decisions/README.md` |
| 让 LLM 按需读取上下文 | `07-llm/llm-reading-order.md` |
| 查看已知风险 | `08-roadmap/README.md` |
| 查看失效模式 | `failure-modes/index.md` |
| 查看调试记录 | `debugs/index.md` |
| 查看实现证据 | `evidences/index.md` |
| 继续研究课题 | `../vendor/research/aces-research/index.md` |
| 查看 AI 引擎 OpenCode 能力 | `../vendor/ai/maop/.opencode/README.md` |

## 目录边界

- `00-overview/`: 项目范围、系统全景、术语。
- `01-architecture/`: 长期架构事实。
- `02-development/`: 开发命令、编码约束、测试规则、目录治理。
- `03-runtime/`: 启动、运行、生命周期和可观测性。
- `04-operations/`: 验证、部署、发布和排障流程。
- `05-contracts/`: API、协议、数据模型和跨边界契约。
- `06-decisions/`: ADR。
- `07-llm/`: LLM 读取顺序、文档更新规则和上下文控制。
- `08-roadmap/`: 风险、技术债和未来能力。
- `failure-modes/`: 可复用失效模式。
- `debugs/`: 复杂调试过程。
- `evidences/`: 需求到实现证据。
- `_templates/`: 文档模板。

## token 纪律

不要默认读取整个 `docs/`。先读本文件，再按 `07-llm/llm-reading-order.md` 选择 1-3 个目标文档。
