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
  attempts,
  last_error,
  source_refs,
  parse_progress,
  created_at,
  updated_at
}
```

状态：

- `started`: document 已上传并触发 parse，或 parse 仍未确认完成。
- `parsed`: wait_for_parse 时确认 RAGFlow document parse 完成。
- `failed`: 外部调用、门禁或 parse 失败。
- `skipped_duplicate`: 响应状态，不持久化为新 job。

## 错误边界

- 缺 RAGFlow API key 返回 `unconfigured`。
- dataset name 无法解析且未显式 `create_dataset=true` 时返回 `409/unconfigured`。
- LLM Wiki candidate 未通过 gate 时返回失败，不得伪造成功状态。
- 外部服务失败时记录 `last_error`，不得把失败 job 作为生产可检索证据。
