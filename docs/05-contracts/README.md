# 契约

状态：暂定。

本目录保存 API、协议、数据模型、事件和跨边界契约。契约变化应记录来源、消费者和验证方式。

## 当前本地 MVP 契约入口

- 主仓运行接口见根 `README.md` 的“本地 MVP 接口”。
- `state-model.md`: 本地 MVP 持久化状态、owner 和关键流转。
- `llm-wiki-governance-contract.md`: 本地 candidate 与 LLM Wiki 治理事实的写入、读取和状态回写契约。
- `knowledge-writeback-layering-strategy.md`: 知识回写分层、用户可理解命名、LLM Wiki 目录和状态推进策略。
- `knowledge-change-to-answer-loop-strategy.md`: LLM Wiki CRUD、RAGFlow 更新、前端咨询生效验证的完整闭环策略。
- `knowledge-sync-contract.md`: LLM Wiki 到 RAGFlow 的同步门禁、幂等和 sync job 契约。
- 研究来源契约见 `vendor/research/aces-research/topics/wechat-customer-service-ai-faq-feedback/implementation/`。
