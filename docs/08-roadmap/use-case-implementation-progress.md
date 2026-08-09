# UseCase 实现进度

状态：当前有效。

本文跟踪 `docs/00-overview/roles-and-use-cases.md` 中 UseCase 的实现状态。UseCase 被定义不代表已经全部实现；新增 PRD 或实现任务必须同步本文件，避免把目标能力误认为当前能力。

## 状态标记

- `已实现`: 主仓已有接口/状态/UI 或测试证据覆盖主要路径。
- `部分实现`: 有本地 MVP 或局部接口，但关键外部集成、权限、状态回写或生产约束未闭环。
- `未实现`: 仅为目标 UseCase 或外部依赖尚未接入。

## 当前进度

```text
[UC1 顾客咨询] 部分实现
   include -> [UC1.1 接收消息] 已实现: POST /dev/fake-wechat/messages
   include -> [UC1.2 高风险拦截] 已实现: high-risk guard
   include -> [UC1.3 RAGFlow 检索] 已实现: RAGFlow retrieval + beauty-faq dataset name resolve
   include -> [UC1.4 话术包装] 已实现: ReplyPolicyService
   include -> [UC1.5 记录 decision log] 已实现: GET /decision-logs
   extend  -> [UC2 转人工处理] 已实现: low confidence/high risk/no hit path
   缺口: 真实微信 live channel 未接入。

[UC2 转人工处理] 已实现
   include -> [UC2.1 创建工单] 已实现: handoff ticket
   include -> [UC2.2 展示转人工原因] 已实现: UI + ticket payload + decision log
   include -> [UC2.3 客服领取] 已实现: POST /handoff/tickets/:id/claim
   include -> [UC2.4 客服回复解决] 已实现: POST /handoff/tickets/:id/resolve
   include -> [UC2.5 生成 feedback candidate] 已实现: human_feedback candidate
   extend  -> [UC4 知识审核与评估] 部分实现: 本地审核/评估已实现，LLM Wiki 回写未实现。

[UC3 产品材料蒸馏] 部分实现
   include -> [UC3.1 导入非结构化材料] 已实现: POST /materials + POST /materials/import JSON/multipart
   include -> [UC3.2 保存 raw_material] 已实现: local JSON store materials/materialBatches/materialAssets/materialBlocks
   include -> [UC3.3 本地规则蒸馏] 已实现: local_rule_distiller + material_version 幂等 + batch block distill
   include -> [UC3.4 生成 source_material] 已实现: distillation.source_material + sections + section/source block ref
   include -> [UC3.5 生成 faq_candidates] 已实现: distillation.faq_candidates + source_excerpt + feedbackCandidates
   include -> [UC3.6 生成 risk_findings] 已实现: risk_findings + severity/evidence/source_ref
   include -> [UC3.7 RAGFlow staging 解析辅助] 部分实现: markdown staging dataset create/upload/parse/retrieve POC 已验证，主仓提供 parse/refresh-blocks 接口
   extend  -> [UC4 知识审核与评估] 已实现: candidate 进入 review/pending_llm_wiki
   缺口: 大模型蒸馏、PDF/Word/OCR 逐格式解析质量验证、多产品复杂材料抽取未实现。

[UC4 知识审核与评估] 部分实现
   include -> [UC4.1 审核 candidate] 已实现: POST /knowledge/feedback-candidates/:id/review
   include -> [UC4.2 本地/未来 Ragas 评估] 部分实现: 本地 evaluation policy 已实现，Ragas runner 未实现
   include -> [UC4.3 校验 source_refs] 已实现: publication/evaluation gate 校验 source_refs
   extend  -> [UC5 LLM Wiki 治理] 未实现: 主仓 candidate 写入 LLM Wiki 未实现
   extend  -> [UC6 同步 RAGFlow] 部分实现: 已支持读取 LLM Wiki approved/passed candidate 同步 RAGFlow

[UC5 LLM Wiki 治理] 部分实现
   include -> [UC5.1 写入 source_material] 未实现: POST /materials/:id/publish-to-llm-wiki 缺失
   include -> [UC5.2 写入 faq_candidate] 未实现: 主仓到 LLM Wiki 写入缺失
   include -> [UC5.3 读取 review/evaluation 状态] 部分实现: 可读取指定 LLM Wiki candidate；状态回写主仓缺失
   extend  -> [UC6 同步 RAGFlow] 已实现: POST /knowledge/sync/llm-wiki-to-ragflow

[UC6 同步 RAGFlow] 部分实现
   include -> [UC6.1 解析 dataset beauty-faq] 已实现: dataset name resolve
   include -> [UC6.2 上传文档] 已实现: RagflowClient.uploadDocument
   include -> [UC6.3 触发 parse/index] 已实现: RagflowClient.parseDocument
   include -> [UC6.4 后续检索验证] 部分实现: 手工/探针验证已做，自动化真实依赖 smoke 未固化
   extend  -> [UC1 顾客咨询] 已实现: RAGFlow retrieval 可用于自动回复
   缺口: sync 去重、真实依赖自动化验收、失败重试未实现。

[UC7 系统配置与审计] 部分实现
   include -> [UC7.1 配置 RAGFlow/LLM Wiki] 部分实现: env 配置 + GET /integrations/health
   include -> [UC7.2 配置话术策略] 已实现: GET/POST /reply-policy
   include -> [UC7.3 查看 integrations health] 已实现: GET /integrations/health
   include -> [UC7.4 查看 decision logs] 已实现: GET /decision-logs + UI
   include -> [UC7.5 配置 Memory/Agent 边界] 未实现: 已有架构规则，运行时开关/权限/审计未实现
   缺口: UI 配置页权限、配置持久化校验、话术禁用词校验、Memory/Agent 范围隔离开关未实现。

[UC8 真实微信接入] 未实现
   include -> [UC8.1 配置 callback 域名] 未实现: 微信后台保存仍挂起
   include -> [UC8.2 配置 secret/token] 未实现: WECHAT_KF_SECRET 未接入
   include -> [UC8.3 接入 sync_msg] 未实现
   include -> [UC8.4 接入 send_msg] 未实现
   include -> [UC8.5 接入 add_contact_way] 未实现
   extend  -> [UC1 顾客咨询] 未实现: 目前只支持 FakeWeChat/local mode
```

## 下一批优先级

1. `UC5 LLM Wiki 治理`: 实现 `POST /materials/:id/publish-to-llm-wiki`，把材料蒸馏结果真实写入 LLM Wiki。
2. `UC5/UC6 状态闭环`: LLM Wiki review/evaluation 状态回写主仓 candidate，并同步 RAGFlow。
3. `UC6 RAGFlow Sync`: 增加去重、sync job 状态和失败重试。
4. `UC7 配置与审计`: 话术禁用词校验、配置页分组、运行时权限边界。
5. `RAGFlow Memory/Agent 边界 POC`: 只验证客服经验记忆，不接顾客个人长期记忆。
6. `UC8 真实微信接入`: callback、secret、sync_msg、send_msg、add_contact_way。

## 维护规则

- 新增或修改 UseCase 时，同步 `docs/00-overview/roles-and-use-cases.md` 和本文。
- 实现某个 UseCase 子项后，必须补充接口、状态、测试或验证证据。
- 不得把 `部分实现` 或 `本地 MVP` 描述成 `已实现`。
- 真实外部依赖能力只有经过 fresh verification 后才能标为 `已实现`。
