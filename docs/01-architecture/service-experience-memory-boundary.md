# 客服经验记忆边界

状态：稳定策略，RAGFlow Memory/Agent 接入细节仍需后续验证。

本文定义 BeautyCustomerService 对长期记忆能力的使用边界。默认只沉淀客服团队经验，不建立顾客个人长期记忆。

## 核心规则

```text
允许：service_experience_memory
禁止：customer_profile_memory
```

系统默认不记录、检索或使用顾客个人长期记忆。所有长期可复用记忆必须是客服经验记忆，并按租户、门店、产品线、渠道等运营范围隔离。

## 不做顾客个人长期记忆

禁止默认沉淀以下内容：

- 顾客个人皮肤状态长期画像。
- 顾客购买记录、偏好、投诉史或敏感经历。
- 基于 `customer_id`、`external_userid`、手机号、微信身份的长期个性化回答记忆。
- 未经审核的会话摘要直接进入生产回答。

原因：

- 隐私和合规风险高。
- 微信客服、多渠道和人工录入身份可能存在串号风险。
- 自动回复应主要依赖审核过的产品知识和当次上下文。
- 顾客个人信息需要单独授权、删除、访问审计和最小化设计。

## 客服经验记忆定义

客服经验记忆是团队级、可复用、可审核的运营知识。

```json
{
  "type": "service_experience",
  "scope": {
    "tenant_id": "tenant_local",
    "store_id": null,
    "product_line": "beauty_care",
    "channel": "wechat_kf"
  },
  "source": "resolved_ticket | operator_correction | repeated_unanswered_question | rejected_candidate | high_risk_handoff",
  "content": "护理后短期内避免刷酸、强清洁和刺激性护理。",
  "risk_labels": ["post_care"],
  "review_status": "review",
  "evaluation_status": "pending",
  "publication_decision": "block"
}
```

## 允许沉淀的经验类型

- 高频未命中问题模式。
- 转人工原因模式。
- 客服修正过的更好话术。
- 审核拒绝原因和风险提示。
- 产品材料缺口或冲突提示。
- 适用于某个产品线或门店的已审核服务注意事项。

这些经验不能自动进入生产回答，必须先作为 candidate 进入审核和评估。

## 状态流转

```text
resolved tickets / operator corrections / repeated misses
  -> service_experience candidate
  -> UC4 审核与评估
  -> UC5 LLM Wiki 治理
  -> UC6 RAGFlow production sync
  -> UC1 顾客咨询检索使用
```

任何未审核经验默认：

```text
governance_target = pending_llm_wiki
publication_decision = block
```

## RAGFlow Memory/Agent 边界

RAGFlow Memory 如果后续接入，只能承载客服经验记忆或运营范围记忆，不得默认承载顾客个人记忆。

允许的 owner：

```text
owner_type = tenant | store | product_line | channel
```

禁止的 owner：

```text
owner_type = customer | external_user | phone | wechat_user
```

RAGFlow Agent 如果后续接入，优先用于知识运营辅助、材料探索、候选生成或质量检查，不进入微信 callback 的实时主链路。

## UseCase 影响

- UC1 顾客咨询：只能检索已审核的客服经验，不读取顾客个人长期记忆。
- UC2 转人工处理：人工回复和解决原因可以生成 `service_experience` candidate。
- UC3 产品材料蒸馏：材料和 RAGFlow staging chunks 可以生成经验候选，但仍需审核。
- UC4 知识审核与评估：负责判断经验是否可发布、是否存在风险或冲突。
- UC5 LLM Wiki 治理：经验知识进入治理源头，而不是直接写 RAGFlow production。
- UC6 同步 RAGFlow：只同步 approved + passed 的经验知识。
- UC7 系统配置与审计：后续需要配置 Memory 开关、范围隔离和审计日志。

## 验收规则

实现 Memory/Agent 相关能力时必须证明：

- 没有以顾客身份作为长期记忆 owner。
- 经验记忆包含 scope，并能按 tenant/store/product_line/channel 隔离。
- 未审核经验不会被 UC1 生产自动回复检索使用。
- decision log 能记录经验知识是否参与回答。
- 用户数据删除或会话清理不会影响已审核的团队经验知识；团队经验也不能反向暴露个人来源。
