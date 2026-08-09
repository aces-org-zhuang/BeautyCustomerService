# 知识变更到用户回答闭环策略

状态：当前有效。

本文定义 LLM Wiki 中知识新增、修改、删除后，如何同步到 RAGFlow，并最终改变前端用户咨询结果。它补齐“写入 LLM Wiki”之后的完整闭环策略，避免只完成文件写入，却没有证明线上回答已经生效。

## 当前结论

当前主仓已经具备以下能力：

- 把人工反馈或材料蒸馏生成的问答写入 LLM Wiki。
- 读取 LLM Wiki candidate 的审核和评估状态。
- 只允许 `approved + pass/passed + sources` 的 candidate 同步到 RAGFlow。
- 通过 RAGFlow retrieval 影响用户咨询答案。
- 手动扫描 LLM Wiki `approved-answers`，识别新增、修改、删除、降级、未变化和阻断项。
- 对新增/修改项执行显式 auto sync，并用本次同步 dataset/document 做回答验证。
- 通过 `knowledgeDocuments` 生效注册表逻辑撤回 inactive/superseded 文档，避免最终回答继续使用旧知识。

当前仍未验证或延后的能力：

- 定时扫描或事件驱动自动发现 LLM Wiki 变化。
- 对 RAGFlow 中旧 document 做物理替换、删除或停用。
- 失败重试和真实依赖自动化验收。
- 真实微信 live channel 中的用户咨询验证。

## 闭环总览

```text
LLM Wiki 知识变更
  -> 变更识别
       -> 同步决策
            -> RAGFlow 更新
                 -> 咨询验证
                      -> 生效记录
```

分层含义：

- 知识变更：人在 LLM Wiki 里新增、修改、删除或移动文件。
- 变更识别：主仓判断哪些文件变了，以及变更类型是什么。
- 同步决策：主仓判断该变更是否允许进入 RAGFlow。
- RAGFlow 更新：主仓上传、替换、删除或暂停对应 document。
- 咨询验证：用真实咨询问题或验收问题验证答案是否变化。
- 生效记录：记录本次变更是否已经影响用户咨询结果。

## LLM Wiki CRUD 语义

### 新增

新增是指 LLM Wiki 出现新的问答文件。

允许同步条件：

```text
type = faq_candidate
review_status = approved
evaluation_status = pass | passed
sources 非空
```

同步动作：

- 生成内容 hash。
- 上传到 RAGFlow。
- 记录 `source_path -> document_id -> content_hash`。
- 执行咨询验证。

### 修改

修改是指同一路径文件内容 hash 变化。

同步动作按修改后的状态决定：

- 仍满足通过条件：替换 RAGFlow document。
- 不再满足通过条件：撤回 RAGFlow document。
- sources 变化：重新读取来源材料并替换 RAGFlow document。

修改不能只新增一个 RAGFlow document，否则会出现旧答案和新答案同时命中。

### 删除

删除是指 LLM Wiki 文件消失，或被移动到不再代表已审问答的目录。

同步动作：

- 找到原 `source_path` 对应的 RAGFlow document。
- 从 RAGFlow 删除或标记停用。
- 记录撤回原因为 `llm_wiki_deleted`。
- 执行咨询验证，确认旧答案不再命中。

### 驳回或降级

驳回或降级是指文件仍存在，但状态变成：

```text
review_status = rejected
evaluation_status = fail | pending
sources = []
```

同步动作：

- 不允许继续作为 RAGFlow 生产知识。
- 如已同步过，必须撤回对应 RAGFlow document。
- 记录撤回原因：`review_rejected`、`evaluation_failed` 或 `missing_sources`。

## 同步记录模型

主仓需要把每条 LLM Wiki 文件和 RAGFlow document 建立可追踪关系。

推荐记录：

```js
{
  source_path,          // LLM Wiki 文件路径
  source_hash,          // 当前内容 hash
  source_status,        // draft | approved | rejected | deleted
  ragflow_dataset_id,
  ragflow_document_id,
  ragflow_status,       // uploaded | parsed | replaced | removed | blocked
  answer_check_status,  // not_checked | changed | unchanged | failed
  last_decision_reason,
  created_at,
  updated_at
}
```

命名面向用户时使用：

```text
知识文件
同步状态
检索文档
咨询验证
生效结果
```

不要把这些主标签命名为 `job`、`artifact`、`hash row`、`vector item`。

## RAGFlow 更新策略

### 新增策略

```text
已审问答 -> 上传新 document -> parse -> 咨询验证
```

### 替换策略

```text
已同步问答内容变化
  -> 删除或停用旧 document
  -> 上传新 document
  -> parse
  -> 咨询验证
```

替换必须保证旧 document 不继续提供答案。若 RAGFlow API 暂时无法删除旧 document，必须把该同步标记为 `blocked`，不能声明“已替换”。

### 撤回策略

```text
删除 / 驳回 / 降级
  -> 删除或停用 RAGFlow document
  -> 咨询验证旧答案不再命中
```

撤回失败时必须暴露给运营人员，因为这会造成前端继续回答已撤回知识。

## 前端咨询生效策略

知识同步完成不等于用户咨询已生效。每次关键变更后需要做咨询验证。

验证输入：

- 该问答的 `question`。
- 人工维护的验收问法。
- 历史真实用户问法。

验证输出：

```text
changed    用户答案已按新知识变化
unchanged  用户答案未变化，需要排查检索、排序或缓存
blocked    RAGFlow 同步未完成，不能验证
failed     验证调用失败
```

前端用户咨询链路：

```text
用户问题
  -> 主仓 AnswerOrchestrator
       -> RAGFlowKnowledgeService
            -> RAGFlow retrieval
                 -> 命中已同步 document
                      -> 返回答案和来源
```

只有当 `RAGFlow retrieval` 命中最新 document，并且返回答案符合预期，才能说“知识变更已经影响用户咨询结果”。

## 自动化策略

### 第一阶段：手动触发闭环

适合当前 MVP。

```text
运营在 LLM Wiki 修改知识
  -> 主仓手动触发同步
  -> 主仓手动触发咨询验证
  -> 记录生效结果
```

必备能力：

- 查询 current project。
- 指定 LLM Wiki 文件路径同步。
- 记录 `source_path -> document_id`。
- 验证指定问题的前端咨询结果。

### 第二阶段：半自动扫描闭环

```text
主仓定时扫描 LLM Wiki 已审目录
  -> 对比 source_hash
  -> 自动生成同步计划
  -> 人工确认后执行 RAGFlow 更新
  -> 自动咨询验证
```

适合有人工审核要求的生产前阶段。

### 第三阶段：自动闭环

```text
LLM Wiki 变更事件
  -> 主仓自动同步计划
  -> 门禁通过自动更新 RAGFlow
  -> 自动咨询验证
  -> 异常进入人工队列
```

适合稳定运行后，但必须有撤回告警和失败重试。

## 失败处理

- LLM Wiki 读失败：不更新 RAGFlow。
- 门禁失败：不更新 RAGFlow；如旧 document 已存在，则按降级处理生成撤回任务。
- RAGFlow 上传失败：保留旧 document，不声明新知识生效。
- RAGFlow 替换失败：标记 `blocked`，提示可能存在旧答案。
- 咨询验证失败：同步可记录为完成，但生效状态必须是 `failed`，不能写成已影响用户回答。

## 验收标准

完整闭环必须同时满足：

- LLM Wiki current project 是目标项目。
- LLM Wiki 文件可读，且状态通过门禁。
- RAGFlow document 已创建、替换或撤回。
- 主仓有 `source_path -> ragflow_document_id` 记录。
- 用户咨询验证有明确结果。
- 前端或接口能显示该知识处于：待审、已审、已同步、已生效、撤回中或失败。

## 当前实现差距

当前已实现：

- LLM Wiki 写入。
- LLM Wiki 状态回读。
- approved/pass/sources 门禁。
- RAGFlow 上传和幂等同步 job。
- 用户咨询优先使用 RAGFlow retrieval。

待实现：

- LLM Wiki CRUD 变更扫描。
- RAGFlow document 删除或替换。
- `source_path -> document_id` 的长期映射。
- 咨询验证记录。
- 前端显示“知识是否已影响回答”。
