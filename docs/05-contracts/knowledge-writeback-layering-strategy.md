# 知识回写分层策略

状态：当前有效。

本文定义主仓、LLM Wiki 和 RAGFlow 之间的知识回写分层。目标是让用户能直观看懂每类内容“是什么、放哪里、谁负责、什么时候能进入下一层”，避免把所有内容都写到一个目录、一个字段或一个笼统的 review 状态里。

## 命名原则

- 用业务可理解名称，不用晦涩内部术语。
- 名称表达当前阶段，而不是表达实现细节。
- 文件路径表达内容类型和治理阶段。
- 状态名称必须能回答用户问题：这是原始材料、待审问答、已审问答、可检索知识，还是同步记录。

## 分层总览

```text
来源材料
  -> 待审问答
       -> 已审问答
            -> 可检索知识
                 -> 同步记录
```

每一层都有独立职责：

- 来源材料：说明答案依据来自哪里。
- 待审问答：还没有通过治理，只能等待审核。
- 已审问答：已通过人工审核和评估，可进入生产检索。
- 可检索知识：已经进入 RAGFlow，用于线上回答。
- 同步记录：记录从 LLM Wiki 到 RAGFlow 的每一次同步结果。

## 目录策略

LLM Wiki 项目内采用以下目录：

```text
wiki/sources/             来源材料
wiki/draft-answers/       待审问答
wiki/approved-answers/    已审问答
wiki/rejected-answers/    驳回问答
wiki/sync-notes/          同步记录或人工补充说明
```

当前兼容状态：

- 现有 `wiki/review/` 仍可读取，但应作为兼容目录，不再作为新回写的首选目录。
- 新增回写应优先写入 `wiki/draft-answers/`。
- 审核通过后应移动或重写到 `wiki/approved-answers/`。

## 状态策略

主仓 candidate 使用用户可理解的治理阶段：

```text
pending_llm_wiki   等待写入 LLM Wiki
llm_wiki_draft     已写入待审问答
llm_wiki_approved  LLM Wiki 已审核通过
ragflow_synced     已同步到 RAGFlow
rejected           已驳回，不进入检索
```

兼容规则：

- 已有 `governance_target=llm_wiki` 表示已写入 LLM Wiki，但不代表已审核通过。
- 新状态应优先表达阶段；旧字段可以保留为兼容和索引。

## 写入策略

### 来源材料

来源材料写入：

```text
wiki/sources/<材料名>-<material_id>.md
```

内容必须包含：

- 材料标题。
- 原文或切片摘要。
- 来源时间和导入批次。
- 可追溯的 `material_id` 或 `material_batch_id`。

### 待审问答

待审问答写入：

```text
wiki/draft-answers/<candidate_id>.md
```

内容必须包含：

- 用户问题。
- 候选回答。
- 来源材料引用。
- 当前审核状态：`review`。
- 当前评估状态：`pending`。
- 风险说明或转人工原因。

### 已审问答

已审问答写入：

```text
wiki/approved-answers/<candidate_id>.md
```

进入条件：

- `review_status=approved`。
- `evaluation_status=pass` 或 `passed`。
- `sources` 非空。

### 驳回问答

驳回问答写入：

```text
wiki/rejected-answers/<candidate_id>.md
```

进入条件：

- 审核拒绝。
- 评估失败。
- 来源不足。
- 内容存在承诺疗效、医疗判断、价格误导或其他风险。

## 回写流程

```text
人工回答 / 材料蒸馏
  -> 写入来源材料
  -> 写入待审问答
  -> LLM Wiki 审核与评估
  -> 回读状态
  -> 写入已审问答或驳回问答
  -> 已审问答同步 RAGFlow
  -> 写入同步记录
```

时序规则：

- 写入待审问答后，只能标记为“已提交审核”，不能标记为“可发布”。
- 只有回读到 LLM Wiki 的审核和评估结果后，才能更新为“已审问答”。
- 只有“已审问答”才能同步 RAGFlow。
- RAGFlow 同步成功后，才记录为“可检索知识”。

## 用户可见命名

UI 或接口返回中优先使用以下中文标签：

```text
来源材料
待审问答
已审问答
驳回问答
可检索知识
同步记录
```

避免直接暴露以下词作为主要标签：

```text
candidate
artifact
governance_target
ragflow_sync_allowed
review directory
```

这些词可以保留在开发接口或调试信息中，但不应作为用户理解流程的主命名。

## 验收标准

- 写入 LLM Wiki 前，能确认 current project path。
- 写入后，能通过 LLM Wiki API 读回同一文件。
- 待审问答不会进入 RAGFlow。
- 已审问答必须有来源材料引用。
- 每次 RAGFlow 同步都有 sync job 记录。
- 用户能从名称判断每条知识当前处于哪个阶段。
