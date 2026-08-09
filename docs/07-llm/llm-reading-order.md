# LLM 读取顺序

不要默认读取整个 `docs/`。先读 `docs/README.md`，再按任务类型选择最小路径。

## 任务路径

| 任务 | 读取文档 |
| --- | --- |
| 了解项目整体 | `00-overview/README.md` |
| 新增或修订 PRD/需求 | `00-overview/roles-and-use-cases.md`、`01-architecture/llm-wiki-ragflow-boundary.md` |
| 修改源码或模块 | `01-architecture/README.md`、`02-development/README.md` |
| 修改 API、协议或数据契约 | `05-contracts/README.md` |
| 修改运行、启动或生命周期 | `03-runtime/README.md` |
| 修改验证、部署或发布流程 | `04-operations/README.md` |
| 修改 docs 体系或 LLM 规则 | `07-llm/doc-update-rules.md`、`docs/AGENTS.md` |
| 复杂问题定位、架构调整或影响面分析 | 先触发 `reasoning-map`，再按推演结果读取相关 docs |
| 修复代码问题或运行失败 | `failure-modes/index.md`，再读取相关失效模式记录 |
| 记录复杂调试过程 | `debugs/index.md` |
| 记录实现证据 | `evidences/index.md` |
| 继续研究、论文、证据追踪或开源仓库对比 | `vendor/research/aces-research/index.md`，再读取目标课题目录 |
| 修改 AI 引擎或 engine-side OpenCode 能力 | `vendor/ai/maop/`，并遵循 maop 自身规则 |

## 规则

优先读取 1-3 个目标文档。只有存在明确依赖时，才继续读取更多文档。
