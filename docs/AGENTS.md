# BeautyCustomerService 文档 Agent 规则

## 文档范围

- `docs/` 保存长期稳定知识。
- `guides/` 保存非研究类阶段性工程记录。
- `vendor/research/aces-research/` 保存研究过程、论文、开源仓库对比和证据包。
- `vendor/ai/maop/` 保存独立演进的 AI 引擎，maop 的 `.opencode` 不与项目仓 `.opencode` 混写。

## 必读顺序

编辑 `docs/` 前，先读：

1. `docs/README.md`
2. 当前子目录的 `README.md`
3. 被编辑文件直接链接的相关文档
4. 仓库根目录 `AGENTS.md`

## 写作规则

- 常读入口保持短，只做导航和规则。
- 不确定或尚未稳定的行为标记为 `状态：暂定`。
- 不把未来计划写成已实现行为。
- 不把研究过程、候选观点、论文草稿或未验证仓库洞察写入 `docs/`。
- 新增文档时必须同步对应 README 或 index。
- 技术栈细则必须来自本项目真实配置、源码或用户确认；不要从其他项目模板复制业务特化规则。

## reasoning-map 推演优先

修改 docs 体系、架构文档、契约文档、LLM 规则、失效模式规则、调试记录规则或证据规则前，先使用 `reasoning-map` 推演影响面。

## 记录规则

- 可复用问题进入 `docs/failure-modes/` 并更新 index。
- 复杂调试过程进入 `docs/debugs/` 并更新 index。
- 需求到实现证据进入 `docs/evidences/` 并更新 index。

## token 规则

不要强制 LLM 默认读取长报告。先按 `docs/07-llm/llm-reading-order.md` 选择最小上下文，再决定是否继续读取更多文档。
