# 角色与 UseCase 全景

状态：稳定策略，真实微信接入后的权限细分仍需补充。

本文定义 BeautyCustomerService 的系统角色、核心 UseCase 及 `include` / `extend` 关系。以后新增或修订 PRD 时，必须先对照本文做多角色影响推演，不能只从单一角色视角定义需求。

UseCase 实现进度见 `../08-roadmap/use-case-implementation-progress.md`。本文定义目标关系，不代表所有 UseCase 都已完成。

## PRD 前置规则

任何新增 PRD、需求修订或功能范围变更，必须覆盖以下角色影响：

- 顾客：咨询、接收自动回复、被转人工、补充信息。
- 客服 / Operator：查看工单、理解转人工原因、领取、回复、解决、反哺候选。
- 知识运营 / Knowledge Admin：导入材料、蒸馏、审核、评估、治理 LLM Wiki、同步 RAGFlow。
- 后台管理员 / System Admin：配置 RAGFlow、LLM Wiki、话术策略、健康检查、日志审计。
- 微信平台管理员：真实微信 callback、secret、sync_msg、send_msg、add_contact_way 等平台配置。

PRD 不得只描述“后台怎么做”或“客服怎么用”。如果某个角色不受影响，PRD 也必须显式写明“无影响”及原因。

## 角色定义

```text
[顾客]
   使用微信客服入口提问，接收自动回复或转人工服务。

[客服 / Operator]
   处理转人工工单，基于转人工原因、置信度和 source refs 给出人工回复。

[知识运营 / Knowledge Admin]
   管理产品材料、蒸馏结果、FAQ candidate、审核、评估和知识发布流程。

[后台管理员 / System Admin]
   管理集成配置、话术策略、运行健康、审计日志和本地服务状态。

[微信平台管理员]
   管理企业微信/微信客服平台侧配置。当前真实微信 live 接入仍未完成。
```

## UseCase 全景

```text
[UC1 顾客咨询]
   include -> [UC1.1 接收消息]
   include -> [UC1.2 高风险拦截]
   include -> [UC1.3 RAGFlow 检索]
   include -> [UC1.4 话术包装]
   include -> [UC1.5 记录 decision log]
   extend  -> [UC2 转人工处理 {低置信/高风险/无命中/不满意}]

[UC2 转人工处理]
   include -> [UC2.1 创建工单]
   include -> [UC2.2 展示转人工原因]
   include -> [UC2.3 客服领取]
   include -> [UC2.4 客服回复解决]
    include -> [UC2.5 生成 feedback candidate]
    extend  -> [UC4 知识审核与评估 {人工回复可沉淀}]
    extend  -> [UC4 知识审核与评估 {客服经验记忆候选，不是顾客个人记忆}]

[UC3 产品材料蒸馏]
   include -> [UC3.1 导入非结构化材料]
   include -> [UC3.2 保存 raw_material]
   include -> [UC3.3 本地规则蒸馏]
   include -> [UC3.4 生成 source_material]
   include -> [UC3.5 生成 faq_candidates]
   include -> [UC3.6 生成 risk_findings]
   extend  -> [UC4 知识审核与评估 {生成候选后进入审核}]

[UC4 知识审核与评估]
   include -> [UC4.1 审核 candidate]
   include -> [UC4.2 本地/未来 Ragas 评估]
   include -> [UC4.3 校验 source_refs]
   extend  -> [UC5 LLM Wiki 治理 {候选需进入治理源头}]
   extend  -> [UC6 同步 RAGFlow {approved + passed + sources}]

[UC5 LLM Wiki 治理]
   include -> [UC5.1 写入 source_material]
   include -> [UC5.2 写入 faq_candidate]
   include -> [UC5.3 读取 review/evaluation 状态]
   extend  -> [UC6 同步 RAGFlow {治理通过}]

[UC6 同步 RAGFlow]
   include -> [UC6.1 解析 dataset beauty-faq]
   include -> [UC6.2 上传文档]
   include -> [UC6.3 触发 parse/index]
   include -> [UC6.4 后续检索验证]
   extend  -> [UC1 顾客咨询 {新知识可被召回}]

[UC7 系统配置与审计]
   include -> [UC7.1 配置 RAGFlow/LLM Wiki]
   include -> [UC7.2 配置话术策略]
   include -> [UC7.3 查看 integrations health]
    include -> [UC7.4 查看 decision logs]
    include -> [UC7.5 配置 Memory/Agent 边界 {只允许客服经验记忆}]

[UC8 真实微信接入]
   include -> [UC8.1 配置 callback 域名]
   include -> [UC8.2 配置 secret/token]
   include -> [UC8.3 接入 sync_msg]
   include -> [UC8.4 接入 send_msg]
   include -> [UC8.5 接入 add_contact_way]
   extend  -> [UC1 顾客咨询 {live channel}]
```

## include / extend 解释

- `include` 表示主 UseCase 必须执行的稳定子步骤。
- `extend` 表示在特定条件下发生的扩展流程，例如低置信转人工、审核通过后同步 RAGFlow。
- PRD 中不能把 `extend` 当成默认必达路径，也不能省略触发条件。

## 容易混淆的点

```text
[顾客咨询]
   -> [RAGFlow production retrieval]
        -> [风险: local publishedKnowledge 抢答]
        -> [要求: RAGFlow enabled 时生产优先]

[知识治理]
   -> [pending_llm_wiki]
        -> [风险: 被误认成已写入 LLM Wiki]
        -> [要求: 只有真实 LLM Wiki 写入/读取证据后才标 llm_wiki]

[本地发布]
   -> [local_published_knowledge]
        -> [风险: 被误认成 RAGFlow Sync]
        -> [要求: 只能作为 local MVP fallback]

[话术策略]
   -> [final_reply]
        -> [风险: 改变事实答案或隐藏 source refs]
         -> [要求: 只改表达，不改 factual_answer]

[长期记忆]
   -> [service_experience_memory]
        -> [要求: 租户/门店/产品线/渠道级客服经验，必须审核]
   -> [customer_profile_memory]
        -> [禁止: 默认不建立顾客个人长期记忆]
```

## PRD 检查清单

新增 PRD 至少回答：

- 顾客视角：用户如何触发、收到什么、何时转人工？
- 客服视角：客服看到哪些原因、证据、候选和处理动作？
- 知识运营视角：材料、候选、审核、评估、LLM Wiki、RAGFlow 如何流转？
- 后台管理员视角：需要哪些配置、健康检查、日志、回滚或禁用开关？
- 微信平台管理员视角：是否涉及真实微信后台配置？若不涉及，明确写“无影响”。
- include 步骤是否完整？extend 条件是否明确？
- 是否破坏 LLM Wiki 与 RAGFlow 边界？
- 是否保留 decision log 和 source refs？

## 当前置信度

当前 UseCase 主干置信度约 92%。依据包括：现有 API、operator UI、RAGFlow/LLM Wiki 边界文档、decision logs、材料蒸馏、本地 MVP smoke，以及真实 RAGFlow/LLM Wiki 可达性探测。

剩余不确定性来自真实微信 live 接入后的平台角色权限、客服账号体系和 LLM Wiki 写入/状态回写权限。
