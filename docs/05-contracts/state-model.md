# 本地 MVP 状态模型

状态：当前有效。

本文定义主仓本地 MVP JSON Store 的稳定状态集合、owner 和使用边界。运行态默认写入 `data/local-mvp-store.json`，该文件不提交仓库。

## Source Of Truth

```text
src/domain/store.js -> JsonStore
```

`JsonStore.update()` 是本地 MVP 的写入入口。单进程内并发写入必须通过 `update()` 串行执行；直接 `load()` 后自行 `save()` 只用于测试准备或明确的一次性替换。

## 顶层状态

```js
{
  conversations: [],
  events: [],
  outbox: [],
  handoffTickets: [],
  feedbackCandidates: [],
  publishedKnowledge: [],
  decisionLogs: [],
  materials: [],
  materialBatches: [],
  materialAssets: [],
  materialBlocks: [],
  materialParseJobs: [],
  distillations: [],
  knowledgeSyncJobs: [],
  replyPolicy: null
}
```

## Owner 边界

- `conversations/events/outbox/decisionLogs`: 对话编排与 FakeWeChat/未来 WeChat adapter 消费。
- `handoffTickets`: 人工接管状态，客服领取和解决接口消费。
- `feedbackCandidates`: 人工回复和材料蒸馏生成的治理候选，知识审核、评估和 artifact 接口消费。
- `publishedKnowledge`: 仅本地 MVP fallback，不代表 LLM Wiki 或 RAGFlow 生产知识库。
- `materials/materialBatches/materialAssets/materialBlocks/materialParseJobs/distillations`: 材料导入、staging、蒸馏链路消费。
- `knowledgeSyncJobs`: LLM Wiki -> RAGFlow sync 幂等、状态观察和重试依据。
- `replyPolicy`: 话术包装策略，只能影响 final reply，不能改变 factual answer 或 source refs。

## 写入规则

- 常规业务写入必须使用 `JsonStore.update(mutator)`。
- `update()` 内的 mutator 接收最新 state，并在保存前完成同步或异步状态修改。
- 单进程内多个 `update()` 会串行执行，避免 load-update-save 丢写。
- 当前 JSON Store 不保证多进程或多实例一致性；真实生产部署前需要 SQLite/Postgres 或外部锁。

## 禁止混用

- 不把 `publishedKnowledge` 标记为 RAGFlow production KB。
- 不把 `pending_llm_wiki` 标记为已完成 LLM Wiki 治理。
- 不绕过 review/evaluation 直接写入 `knowledgeSyncJobs` 的成功状态。
