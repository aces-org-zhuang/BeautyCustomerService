# LLM Wiki 与 RAGFlow 边界

状态：稳定策略，部分实现仍在演进。

本文定义 BeautyCustomerService 中 LLM Wiki、RAGFlow、主仓本地服务的职责边界和联动场景，避免把知识治理、生产检索、本地演示能力混为一谈。

## 结论

LLM Wiki 和 RAGFlow 不冲突，二者是上下游关系。

```text
LLM Wiki = 知识治理源头
RAGFlow = 生产检索索引
主仓服务 = 消息、决策、话术、转人工和同步编排层
```

LLM Wiki 负责回答“这条知识是否可信、是否经过审核、来源是什么、版本如何追踪”。RAGFlow 负责回答“用户问题触发时，生产检索应召回哪些知识片段”。

## Round 1 Map: 职责边界

```text
[🟢 产品材料 / 人工回复]
   -> [🟢 LLM Wiki 治理层]
        ├─ [🟢 source_material {来源与版本}]
        ├─ [🟢 faq_candidate {可审核问答}]
        ├─ [🟢 review_status {approved/rejected}]
        └─ [🟢 evaluation_status {pass/failed/pending}]
             -> [🟢 Sync Gate {approved + passed + sources}]
                  -> [🟢 RAGFlow dataset: beauty-faq]
                       -> [🟢 主仓服务 retrieval]
                            -> [🟢 自动回复 / 转人工]
```

边界规则：

- LLM Wiki 是治理入口，不是实时生产检索引擎。
- RAGFlow 是生产检索索引，不是知识审核或编辑系统。
- 主仓服务不直接把未审核材料写入 RAGFlow。
- 本地 `publishedKnowledge` 只属于 local MVP fallback，不等同于 LLM Wiki 或 RAGFlow 生产 KB。

## Round 2 Map: 联动场景

```text
[场景 A: 产品材料蒸馏入库]
[🟢 raw material]
   -> [🟢 local_rule_distiller / future LLM distiller]
        -> [🟢 source_material + faq_candidates + risk_findings]
             -> [🔴 pending_llm_wiki {未写入 LLM Wiki}]
                  -> [🟢 LLM Wiki write/read {真实治理记录}]
                       -> [🟢 approved + passed]
                            -> [🟢 RAGFlow sync]

[场景 B: 人工客服反哺]
[🟢 ticket resolve]
   -> [🟢 feedback candidate]
        -> [🔴 pending_llm_wiki {本地候选，不是 LLM Wiki 事实}]
             -> [🟢 LLM Wiki governance]
                  -> [🟢 RAGFlow sync]

[场景 C: 用户咨询]
[🟢 user question]
   -> [🟢 high-risk guard]
        -> [🟢 RAGFlow retrieval {生产优先}]
             -> [🟢 reply policy {只改表达，不改事实}]
                  -> [🟢 final reply + decision log]
```

## Final Panorama Map: 正确链路

```text
[🟢 非结构化产品材料]
   -> [🟢 raw_material 保存]
        -> [🟢 蒸馏]
             -> [🟢 source_material]
             -> [🟢 faq_candidate]
             -> [🟢 risk_findings]
                  -> [🔴 pending_llm_wiki {禁止生产发布}]
                       -> [🟢 LLM Wiki 审核]
                            -> [🟢 Evaluation]
                                 -> [🟢 RAGFlow Sync]
                                      -> [🟢 RAGFlow retrieval]
                                           -> [🟢 factual_answer]
                                                -> [🟢 reply_policy]
                                                     -> [🟢 final_reply]
                                                          -> [🟢 decision_logs]
```

## 不允许的混用

以下做法会破坏可追溯性，应避免：

- 把未审核的 `raw_material` 直接写入 RAGFlow 生产 dataset。
- 把本地 candidate 标记成已进入 LLM Wiki，但实际没有 LLM Wiki API 写入或读取证据。
- 让 RAGFlow dataset 成为人工编辑源头，再反向覆盖 LLM Wiki。
- 真实 RAGFlow enabled 时，让本地 `publishedKnowledge` 优先于 RAGFlow 回答。
- 用话术模板改变事实答案、删除 source refs 或包装低置信结果为确定结论。

## 当前实现状态

已实现：

- RAGFlow 默认启用，dataset 默认名称为 `beauty-faq`。
- RAGFlow dataset name 可解析为 dataset id。
- `POST /knowledge/sync/llm-wiki-to-ragflow` 可读取 LLM Wiki candidate，并校验 `approved + passed/pass + sources` 后同步到 RAGFlow。
- 非结构化材料可保存为 material，并通过 `local_rule_distiller` 蒸馏出 `source_material`、`faq_candidates` 和 `risk_findings`。
- 蒸馏 candidate 默认标记为 `pending_llm_wiki`，不伪装成已写入 LLM Wiki。
- 回答链路记录 `decisionLogs`，包含 source refs、confidence、threshold、factual answer 和 final reply。
- 话术策略只包装最终表达，不改变 factual answer 和 source refs。

待实现或需继续强化：

- `POST /materials/:id/publish-to-llm-wiki`：把蒸馏结果真实写入 LLM Wiki 项目。
- LLM Wiki review/evaluation 状态回写主仓 candidate。
- RAGFlow sync 去重，避免同一 candidate 重复生成 document。
- 话术策略禁用词校验，阻止“永久治好”“保证有效”等违规模板。
- UI 中对 `pending_llm_wiki`、`llm_wiki`、`local_published_knowledge`、`ragflow_synced` 做更清晰分组。

## 实施准则

- 生产自动回复优先使用 RAGFlow retrieval。
- LLM Wiki 是知识治理记录 owner。
- RAGFlow 是检索索引 owner。
- 主仓本地服务是流程 owner 和决策日志 owner。
- Local-only 能力必须显式标记，不得命名成已完成外部集成。
