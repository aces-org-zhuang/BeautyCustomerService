# Knowledge Sync 契约

状态：当前有效。

本文定义 LLM Wiki 到 RAGFlow 的同步门禁、幂等键和 sync job 状态。该链路只允许把已审核、已评估且有来源的 LLM Wiki candidate 写入 RAGFlow production dataset。

## 职责边界

```text
LLM Wiki = 知识治理事实源
RAGFlow = 生产检索索引
主仓服务 = 同步编排、幂等状态和健康检查
```

主仓不得把本地未审核 candidate、raw material 或 local published knowledge 直接写入 RAGFlow production dataset。

## Sync Gate

允许同步的 LLM Wiki candidate 必须满足：

```text
type = faq_candidate
review_status = approved
evaluation_status = pass | passed
sources.length > 0
```

任一条件不满足时，同步必须失败或被阻断，不创建成功 sync job。

## API

```text
POST /knowledge/sync/llm-wiki-to-ragflow
```

请求字段：

```js
{
  candidate_path,
  dataset_id,
  dataset_name,
  create_dataset,
  wait_for_parse,
  force
}
```

响应字段：

```js
{
  ok,
  status,
  candidatePath,
  datasetId,
  documentId,
  sourceRefs,
  parseProgress,
  syncJob
}
```

查询接口：

```text
GET /knowledge/sync-jobs
GET /knowledge/sync-jobs/:id
POST /knowledge/sync-jobs/:id/retry
POST /knowledge/sync/retry-due
```

## 幂等键

```text
sync:${candidate_path}:${candidate_hash}:${dataset_id || dataset_name}
```

`candidate_hash` 是 LLM Wiki candidate markdown 的 SHA-256。相同 candidate 内容和相同目标 dataset 已有 `started` 或 `parsed` job 时，默认返回 `skipped_duplicate`，不重复上传 RAGFlow document。传 `force=true` 可重新尝试。

## Sync Job

```js
{
  id,
  idempotency_key,
  candidate_path,
  candidate_hash,
  dataset_id,
  dataset_name,
  document_id,
  status,
  operation,
  attempts,
  max_attempts,
  next_retry_at,
  last_error,
  error_type,
  previous_document_id,
  replacement_document_id,
  delete_check,
  source_refs,
  parse_progress,
  created_at,
  updated_at
}
```

状态：

- `started`: document 已上传并触发 parse，或 parse 仍未确认完成。
- `parsed`: wait_for_parse 时确认 RAGFlow document parse 完成。
- `failed`: 外部调用、门禁或 parse 失败，且本次请求未完成。
- `retry_scheduled`: 失败被判定为可重试，已写入 `next_retry_at`。
- `retrying`: retry endpoint 正在重试该 job。
- `blocked`: 失败不可重试，或 attempts 达到 `max_attempts`。
- `deleting_old`: 替换流程正在删除旧 RAGFlow document。
- `delete_unverified`: 已请求删除，但 `getDocument` 或 retrieval 仍显示旧 document 可见。
- `replaced`: 修改场景已删除旧 document，并上传、parse 新 document。
- `skipped_duplicate`: 响应状态，不持久化为新 job。

## Retry 契约

`POST /knowledge/sync-jobs/:id/retry` 用于重试单个失败或已调度 job。重试必须复用原 job 的 `candidate_path`、`dataset_id`、`dataset_name` 和 idempotency 规则；不得绕过 Sync Gate。

`POST /knowledge/sync/retry-due` 用于批量执行 `next_retry_at <= now` 的 `retry_scheduled` job，默认 `limit=10`。当前主仓仍是单进程 JSON Store，本接口只适合本地 MVP 或单实例生产前验证，不等同分布式任务队列。

## 替换和撤回契约

修改同一路径的 approved answer 时，生产路径必须先处理旧 RAGFlow document，再上传新 document：

```text
active old document -> deleteDocument -> verify cleared -> upload new document -> parse -> answer verify -> registry supersede
```

删除、驳回或降级时，`POST /knowledge/answer-loop/withdraw` 可通过 `physical_delete=true` 触发 RAGFlow 物理删除，并通过 `verify_cleared=true` 验证旧 document 是否仍可见。删除失败或删除后仍可见时必须返回阻断状态，不能声明撤回或替换已完成。

`POST /knowledge/answer-loop/scan-approved` 支持 `physical_withdraw` 和 `physical_replace`。默认不开启，保持本地 MVP 兼容；开启后 deleted/downgraded 会尝试物理撤回，modified 会尝试物理替换。

## 真实依赖验收

默认本地验证仍使用：

```bash
npm run verify
```

真实 RAGFlow/LLM Wiki 验收使用可选命令：

```bash
npm run verify:ragflow-live
```

该命令需要 `RAGFLOW_API_KEY`、`RAGFLOW_DATASET_IDS` 或 `RAGFLOW_DATASET_NAMES`、`LLM_WIKI_CANDIDATE_PATH` 等真实配置。缺配置时输出 `skipped/missing_live_env`，不得把 skipped 当作生产验证通过。

## 错误边界

- 缺 RAGFlow API key 返回 `unconfigured`。
- dataset name 无法解析且未显式 `create_dataset=true` 时返回 `409/unconfigured`。
- LLM Wiki candidate 未通过 gate 时返回失败，不得伪造成功状态。
- 外部服务失败时记录 `last_error`，不得把失败 job 作为生产可检索证据。
- 物理删除或替换未验证清理成功时，状态必须是 `delete_unverified` 或 `blocked`，不得声明 `replaced` 或 `withdrawn`。
