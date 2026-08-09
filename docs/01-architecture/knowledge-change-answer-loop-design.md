# 知识变更到用户回答闭环技术设计

状态：当前 MVP 设计，替换/撤回能力待 RAGFlow POC 验证。

关联 PRD：`../00-overview/knowledge-change-answer-loop-prd.md`。
关联策略：`../05-contracts/knowledge-change-to-answer-loop-strategy.md`。

## 设计结论

第一阶段采用手动闭环：运营或管理员指定 LLM Wiki 文件路径，主仓读取并同步已审问答到 RAGFlow，然后用主仓咨询链路验证答案是否已经影响用户回答。

由于当前环境 `http://127.0.0.1:9380` 连接被拒绝，RAGFlow document 删除、停用、覆盖能力未完成真实 POC。本设计不声明完整 CRUD 闭环已实现；修改和删除场景先返回 `blocked`，直到 RAGFlow 生命周期 API 被验证。

调整后的生产生效策略：RAGFlow 只负责候选检索，主仓通过 `knowledgeDocuments` 生效注册表决定某个 document 是否仍允许进入最终回答。这样即使 RAGFlow 中旧 document 尚未删除，主仓也能过滤 inactive 或 superseded document，避免前端继续回答旧知识。

## 当前证据

- LLM Wiki current project 已切到主仓项目，并能写入/读回文件。
- `KnowledgeSyncService` 已支持读取 LLM Wiki candidate、执行 approved/pass/sources 门禁、上传 RAGFlow document、记录 sync job。
- `RagflowKnowledgeService` 已通过 RAGFlow retrieval 影响主仓咨询结果。
- `RagflowClient` 当前只有 create/upload/parse/get/retrieve/list 能力，没有 delete/update 封装。
- RAGFlow 生命周期 POC 尝试连接 `127.0.0.1:9380` 时返回 `ECONNREFUSED`。
- `POST /knowledge/answer-loop/scan-approved` 已支持手动扫描已审问答目录。
- `auto_sync=true` 时，`added/modified` 会同步并验证；`deleted/downgraded` 会撤回答复生效权。

## MVP 范围

包含：

- 手动指定 LLM Wiki candidate path。
- 同步已审问答到 RAGFlow。
- 记录 LLM Wiki 文件 path、hash、RAGFlow dataset/document、同步状态。
- 同步后用主仓咨询链路验证是否命中新知识。
- operator UI 展示用户可理解的闭环状态。
- 手动触发扫描 LLM Wiki 已审问答目录，识别新增、修改、删除、驳回/降级、无变化和阻断。
- 显式 `auto_sync=true` 时，对扫描发现的新增和修改执行同步验证。

不包含：

- 定时自动扫描 LLM Wiki 目录。
- 事件驱动同步。
- 未验证的 RAGFlow document 删除、停用或覆盖。
- 真实微信 live channel 验证。

## 数据状态

新增 `knowledgeScanRuns`，记录 LLM Wiki 变更识别扫描。

```js
{
  id,
  scan_root,
  status,       // started | completed | failed
  added,
  modified,
  deleted,
  downgraded,
  unchanged,
  blocked,
  findings,
  failure_reason,
  created_at,
  updated_at
}
```

新增 `knowledgeAlerts`，记录需要运营处理的知识链路告警。

```js
{
  id,
  source,     // llm_wiki_scan 等
  severity,   // warning | error
  status,     // open | acknowledged
  title,
  detail,
  ref_id,
  acknowledged_by,
  created_at,
  updated_at
}
```

`findings` 中每项使用用户可理解分类：

```js
{
  source_path,
  change_type, // added | modified | deleted | downgraded | unchanged | blocked
  source_hash,
  previous_hash,
  review_status,
  evaluation_status,
  document_id,
  reason
}
```

新增 `knowledgeDocuments`，记录 LLM Wiki 文件与 RAGFlow document 的生效关系。

```js
{
  id,
  source_path,
  source_hash,
  dataset_id,
  document_id,
  sync_job_id,
  lifecycle_status, // active | inactive | superseded | blocked
  answer_status,    // not_checked | effective | ineffective | withdrawn | replaced
  superseded_by,
  reason,
  created_at,
  updated_at
}
```

回答链路规则：

- 未登记的 RAGFlow document 默认不拦截，避免破坏外部既有知识库。
- 已登记且 `active` 的 document 允许回答。
- 已登记且 `inactive` 或 `superseded` 的 document 必须过滤。
- 修改同一 `source_path` 时，新 document 变为 `active`，旧 document 变为 `superseded`。
- 删除或驳回时，对应 active document 变为 `inactive`。

新增 `knowledgeAnswerChecks`，记录“知识变更是否影响用户回答”。

```js
{
  id,
  candidate_path,
  candidate_hash,
  question,
  expected_answer,
  dataset_id,
  document_id,
  sync_job_id,
  sync_status,
  answer_check_status,
  answer_text,
  source_refs,
  failure_reason,
  created_at,
  updated_at
}
```

状态含义：

```text
sync_started       已开始同步
sync_parsed        RAGFlow parse 已确认完成
sync_blocked       门禁、配置或生命周期能力阻断
answer_changed     咨询答案命中新知识或包含预期答案
answer_unchanged   咨询答案未命中新知识
answer_failed      咨询验证失败
```

## API 设计

### LLM Wiki 已审问答扫描

```text
POST /knowledge/answer-loop/scan-approved
GET /knowledge/answer-loop/scan-runs
GET /knowledge/answer-loop/scan-runs/:id
```

请求：

```js
{
  scan_root,       // 默认 wiki/approved-answers/
  auto_sync,       // 默认 false；true 时对 added/modified 执行同步验证
  auto_withdraw    // MVP 默认 true；对 deleted/downgraded 撤回答复生效权
}
```

当前实现：

- 默认只扫描，不外呼 RAGFlow。
- `auto_sync=true` 时同步 `added` 和 `modified`。
- `auto_withdraw=true` 时撤回 `deleted` 和 `downgraded` 的回答生效权。
- `unchanged` 不重复同步。
- `blocked` 只记录失败原因，不覆盖旧 active 状态。
- 扫描失败或 `blocked > 0` 时创建 `knowledgeAlerts`，operator UI 可确认告警。

扫描结果：

```text
added       新 path 且通过门禁
modified    同 path hash 变化且通过门禁
deleted     注册表 active path 在扫描目录中消失
downgraded  文件存在但 review/evaluation/sources 不满足门禁
unchanged   path 和 hash 未变化
blocked     读取、解析、目录扫描或同步前置失败
```

文件发现策略：

```text
1. 优先使用 LLM Wiki API list files（如果当前版本支持）
2. API 不支持时，基于 currentProject.path 做受限文件系统扫描
```

受限文件系统扫描规则：

- 必须先通过 `GET /api/v1/projects` 获取 current project path。
- 只允许扫描 current project 内的 `scan_root`。
- `scan_root` 必须是相对路径，禁止绝对路径和 `../`。
- 只读取 `.md` 文件。
- 不扫描 `vendor/`、`.llm-wiki/` 或 current project 外路径。

### RAGFlow 生命周期能力探针

```text
POST /integrations/ragflow/lifecycle-probe
GET /integrations/ragflow/lifecycle-probes
```

探针行为：

- 创建临时 dataset。
- 上传临时 document。
- 触发 parse。
- 调用 RAGFlow document delete。
- 再次 get document 和 retrieval，验证旧文档是否不可见。

当前 delete 封装采用：

```text
DELETE /api/v1/datasets/:datasetId/documents
body: { ids: [documentId] }
```

该封装已有单元测试，但真实 RAGFlow 仍需服务可达后验证。验证未通过前，替换和撤回仍不得声明完成。

### 手动同步并验证

```text
POST /knowledge/answer-loop/sync-and-verify
```

请求：

```js
{
  candidate_path,
  dataset_id,
  dataset_name,
  question,
  expected_answer,
  wait_for_parse,
  force
}
```

行为：

- 读取 LLM Wiki candidate。
- 执行 approved/pass/sources 门禁。
- 同步到 RAGFlow。
- 用 `RagflowKnowledgeService.answer()` 对 question 发起咨询验证。
- 保存 `knowledgeAnswerChecks`。

### 查询验证记录

```text
GET /knowledge/answer-loop/checks
GET /knowledge/answer-loop/checks/:id
```

### 替换和撤回占位

RAGFlow 物理替换和物理撤回在第一阶段仍依赖生命周期探针结果。主仓逻辑撤回已可通过 `knowledgeDocuments` 完成：

```text
POST /knowledge/answer-loop/withdraw
GET /knowledge/documents
```

物理删除能力未验证前，逻辑撤回是前端回答正确性的依据；物理删除只作为存储清理优化。

## 时序

```text
运营指定 LLM Wiki 文件
  -> 主仓读取 candidate
       -> 门禁通过
            -> 上传 RAGFlow
                 -> parse
                      -> 主仓咨询验证
                           -> 记录生效状态
                                -> operator UI 展示
```

扫描时序：

```text
运营触发扫描
  -> 获取 LLM Wiki current project
       -> 发现 scan_root 下 markdown
            -> 读取 frontmatter 并计算 hash
                 -> 对比 knowledgeDocuments
                      -> 生成 findings
                           -> 可选同步/撤回
                                -> 保存 scan run
```

`auto_sync` 时序：

```text
finding = added | modified
  -> 调用 sync-and-verify
       -> 新 document active
       -> 同 path 旧 document superseded
       -> 保存 answer check
```

## 风险

- RAGFlow 不可用时只能记录失败，不能声明生效。
- RAGFlow 删除/替换未验证前，不能承诺修改和撤回闭环。
- 咨询验证依赖检索排序，存在同步成功但未命中的情况，应显示 `answer_unchanged`。
- LLM Wiki API 如果不支持列目录，需要受限文件系统扫描；必须限制在 current project 内，避免路径逃逸。
- 自动同步可能扩大外部调用成本；MVP 默认先记录 findings，自动同步作为显式参数。

## 验证策略

- 单元测试覆盖门禁失败、同步成功后验证命中、同步成功但验证未命中、外部失败记录。
- 单元测试覆盖 active/superseded/inactive 注册表、回答链路过滤 inactive document、逻辑撤回 API。
- 单元测试覆盖扫描 added/modified/deleted/downgraded/unchanged/blocked 分类。
- `npm run verify` 作为主仓 fresh verification。
- 外部 RAGFlow POC 需要 RAGFlow 服务可达后重新执行，补齐删除/替换能力证据。
