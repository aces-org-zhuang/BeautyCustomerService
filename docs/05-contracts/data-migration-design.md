# 数据迁移设计

状态：当前有效。

本文定义 BeautyCustomerService 从本地 MVP 数据形态演进到更稳定运行形态时的数据迁移边界、对象、顺序、幂等、校验、回滚和验收标准。当前主仓仍使用 JSON Store；本文是迁移设计与执行准则，不声明已经存在生产数据库、CI 迁移流水线或自动迁移脚本。

## 迁移目标

```text
[现有本地 MVP 数据]
   -> [备份与冻结写入]
      -> [结构补齐与规范化]
         -> [外部知识索引一致性重建]
            -> [验证与切换]
               -> [保留回滚窗口]
```

迁移目标：

- 保留用户对话、人工接管、候选知识、材料、同步记录、回答验证和告警的可追溯性。
- 不把本地 demo 数据误迁移为生产知识。
- 不绕过 LLM Wiki 审核和评估门禁写入 RAGFlow production dataset。
- 保证 RAGFlow document 与 LLM Wiki source path、content hash、answer check 之间可追踪。
- 迁移失败时能回滚到迁移前 JSON store 和外部索引状态。

## 数据源和目标

### 主仓 JSON Store

当前事实源：

```text
src/domain/store.js -> JsonStore
data/local-mvp-store.json
```

顶层集合见 `state-model.md`。迁移时必须保留集合名、owner 和禁止混用规则，不能把字段含义重命名为外部系统私有概念后丢失业务语义。

### LLM Wiki

职责：知识治理事实源。

迁移相关对象：

```text
candidate path
review_status
evaluation_status
sources
content hash
approved-answers scan result
```

只有满足 `approved + pass/passed + sources` 的 candidate 才能进入 RAGFlow production sync。

### RAGFlow

职责：生产检索索引。

迁移相关对象：

```text
dataset id / dataset name
document id
document parse status
chunk refs
retrieval source refs
```

RAGFlow 中的 document 是可重建索引，不应作为知识治理事实源。迁移时优先以 LLM Wiki 文件和主仓 `knowledgeDocuments` 注册表恢复索引关系。

### 本地 demo 数据

包括：

```text
publishedKnowledge
BCS_ENABLE_LOCAL_TEST_KNOWLEDGE fixture 命中结果
BCS_ENABLE_DEMO_PUBLISHED_KNOWLEDGE 产生的本地 fallback
```

迁移边界：这些数据只能进入 demo/test 迁移包，不得进入生产 RAGFlow 或生产知识治理结果。

## 迁移对象

### 必迁对象

```text
conversations
events
outbox
handoffTickets
feedbackCandidates
decisionLogs
materials
materialBatches
materialAssets
materialBlocks
materialParseJobs
distillations
knowledgeSyncJobs
knowledgeAnswerChecks
knowledgeDocuments
knowledgeScanRuns
knowledgeAlerts
ragflowLifecycleChecks
replyPolicy
```

### 条件迁移对象

```text
publishedKnowledge
```

条件：只能迁移到本地 demo 或非生产测试环境；如需进入生产知识链路，必须重新生成 LLM Wiki candidate，并重新通过审核、评估和 sources 门禁。

### 不迁移对象

```text
真实 API key/token/secret
临时日志
未审核 raw material 到生产 RAGFlow 的直接索引
RAGFlow chunk 作为知识治理事实源
```

真实凭据只能由目标环境重新注入，不得通过数据迁移搬运。

## 迁移阶段

### Phase 0: 预检

输入：当前 store、目标环境、外部依赖健康状态。

必须确认：

- 当前 `BCS_DATA_FILE` 指向预期 JSON store。
- 主仓服务已停止写入，或进入维护窗口。
- 目标环境的 RAGFlow/LLM Wiki 是否属于本地、测试或生产。
- 是否允许迁移 demo-only 数据。
- 是否需要重建 RAGFlow 索引。

阻断条件：

- 无法确认源 store 路径。
- 目标环境凭据缺失但迁移计划要求写入外部服务。
- 无法区分 demo/test/production 数据边界。

### Phase 1: 冻结写入和备份

操作顺序：

```text
停止主仓服务或进入维护窗口
   -> 复制 BCS_DATA_FILE 到 backup 文件
      -> 计算备份 hash
         -> 记录迁移批次 id
```

备份命名建议：

```text
data/backups/local-mvp-store.<migration_id>.json
```

边界：当前仓库未提供自动备份脚本；执行迁移前必须手动或由后续脚本实现等价备份动作。

### Phase 2: 结构补齐

依据：`createEmptyState()` 和 `state-model.md`。

操作规则：

- 缺失顶层集合补为空数组。
- 缺失 `replyPolicy` 补为 `null`。
- 保留未知字段到迁移审计记录，不默认删除。
- 对数组对象只补兼容字段，不覆盖已有业务字段。
- 所有新生成 id 必须可追踪，不能改变已有 id。

目标：旧 store 可以被当前 `JsonStore.load()` 和业务接口读取。

### Phase 3: 引用一致性修复

需要校验的引用：

```text
handoffTickets.conversation_id -> conversations.id
feedbackCandidates.batch_id -> materialBatches.id
feedbackCandidates.material_id -> materials.id
materialBatches.block_ids -> materialBlocks.id
materialAssets.batch_id -> materialBatches.id
materialBlocks.batch_id -> materialBatches.id
distillations.material_id / batch_id -> materials/materialBatches
knowledgeSyncJobs.document_id -> knowledgeDocuments.ragflow_document_id
knowledgeAnswerChecks.document_id -> knowledgeDocuments.ragflow_document_id
knowledgeAlerts.source_path -> knowledgeDocuments.source_path or scan finding
```

修复原则：

- 能从同批数据唯一推导的引用可以补齐。
- 无法唯一推导时保留原数据，并创建迁移告警项。
- 不因引用缺失删除业务数据。
- 不把失败 sync job 修复为成功状态。

### Phase 4: 知识治理状态归一

目标：把本地 candidate、LLM Wiki 状态、RAGFlow sync 状态分清楚。

规则：

- `pending_llm_wiki` 只能表示待进入 LLM Wiki 治理。
- `llm_wiki` 状态必须来自 LLM Wiki 读取或写入结果。
- `ragflow_synced` 必须有 sync job、dataset id、document id 和来源引用。
- `publishedKnowledge` 不参与生产迁移。
- 缺少 sources 的 candidate 不允许进入 RAGFlow production sync。

### Phase 5: RAGFlow 索引重建或对账

适用条件：目标环境需要真实 RAGFlow retrieval。

优先策略：

```text
LLM Wiki approved candidate
   -> content hash
      -> knowledgeSyncJobs idempotency key
         -> RAGFlow document upload/parse
            -> knowledgeDocuments 注册
               -> knowledgeAnswerChecks 验证
```

对账规则：

- 已存在相同 `candidate_path + candidate_hash + dataset` 的 parsed job 时，默认跳过重复上传。
- 目标 RAGFlow 中已有 document 但主仓无注册表时，必须先建立 `source_path -> document_id -> content_hash` 关系，再声明可用。
- 修改类迁移必须撤回或替换旧 document，不能只追加新 document。
- 删除、驳回或降级类迁移必须撤回旧 document 或标记 blocked。

### Phase 6: 切换和验证

验证入口：

```text
GET /health
GET /runtime/features
GET /integrations/health
GET /knowledge/sync-jobs
GET /knowledge/answer-loop/checks
GET /knowledge/documents
POST /dev/fake-wechat/messages
```

本地代码验证：

```bash
npm run build
npm test
npm run smoke
npm run verify
```

边界：`npm run verify` 只验证主仓本地 MVP，不证明外部 RAGFlow/LLM Wiki 当前可用。外部依赖必须用 `/integrations/health` 和真实探针补证。

## 幂等设计

迁移批次 id：

```text
migration:<yyyyMMddHHmmss>:<source_hash_prefix>
```

知识同步幂等键沿用：

```text
sync:${candidate_path}:${candidate_hash}:${dataset_id || dataset_name}
```

幂等规则：

- 同一个迁移批次重复执行，不得重复创建业务主对象。
- 同一个 candidate 内容和目标 dataset，不得重复上传 RAGFlow document，除非显式 `force=true`。
- 迁移脚本或人工执行记录必须保存 source hash、target hash、处理数量和告警数量。
- 外部写入失败时不得推进本地状态为成功。

## 回滚设计

### 本地 store 回滚

回滚依据：Phase 1 的备份文件。

顺序：

```text
停止主仓服务
   -> 恢复备份 JSON store
      -> 启动主仓服务
         -> GET /health
            -> GET /runtime/features
```

### RAGFlow 回滚

适用：迁移期间向 RAGFlow 写入、替换或撤回了 document。

规则：

- 新增 document：删除迁移批次新增的 document。
- 替换 document：删除新 document，恢复旧 document 的 active 注册状态；如旧 document 已被物理删除且无法恢复，必须从 LLM Wiki 旧版本重新上传。
- 撤回 document：如误撤回，重新上传通过门禁的 source，并执行回答验证。

RAGFlow 回滚不能只修改本地 `knowledgeDocuments`，必须以真实 retrieval 验证旧/新答案状态。

### LLM Wiki 回滚

LLM Wiki 是知识治理事实源。迁移不得直接篡改审核历史。

如果迁移过程中写入了错误 candidate：

- 新增错误 candidate：在 LLM Wiki 中按治理流程撤回或标记 rejected。
- 状态读取错误：修复主仓同步状态，不改 LLM Wiki 源文件。
- 内容错误：通过 LLM Wiki 正常修订流程产生新版本，再同步。

## 数据质量检查

迁移完成前必须检查：

- 顶层集合完整，`JsonStore.load()` 可读取。
- 所有业务 id 保持稳定。
- conversation、ticket、candidate、material、sync job、document、answer check 关键引用没有断链。
- demo-only 数据没有进入 production RAGFlow。
- 所有 production sync 都能追溯到 LLM Wiki source path、content hash 和 sources。
- 失败、阻断和低置信记录没有被迁移成成功状态。
- RAGFlow document 生效必须有回答验证记录支撑。

## 风险和处理

### 多进程写入风险

当前 `JsonStore.update()` 只保证单进程内串行写入，不保证多进程或多实例一致性。迁移期间必须停止主仓服务或进入维护窗口。

### 外部索引不一致

RAGFlow 是可重建检索索引。发现本地注册表和 RAGFlow 实际 document 不一致时，以 LLM Wiki source 和回答验证重建，不把 RAGFlow chunk 当作治理事实源。

### 凭据迁移风险

真实 token/key/secret 不进入数据迁移包。目标环境必须重新注入凭据，并通过健康检查证明可用。

### 本地 demo 污染生产

`publishedKnowledge`、local test knowledge 和 demo publish 默认不进生产迁移。若要转生产，必须重新走 LLM Wiki candidate、审核、评估、sources、RAGFlow sync 和 answer check。

## 实施切片

### Slice 1: 文档和手工迁移

适合当前阶段。

```text
备份 JSON store
   -> 手工检查顶层集合和引用
      -> 按需修复 store
         -> 用现有 API 验证
```

### Slice 2: 只读迁移审计脚本

后续可新增脚本，只读取 store 并输出：

```text
schema gaps
broken references
sync/document/check consistency
recommended actions
```

### Slice 3: 可回滚迁移脚本

后续可新增脚本执行：

```text
backup
schema patch
reference patch
migration report
rollback manifest
```

写外部 RAGFlow/LLM Wiki 前必须有显式 dry-run、确认和回滚 manifest。

### Slice 4: 数据库迁移

生产化前再设计 SQLite/Postgres schema、版本表、事务、锁和 migration runner。当前不得把 JSON Store 迁移设计写成已存在数据库迁移能力。

## 验收标准

完整数据迁移通过标准：

- 有迁移前备份和 source hash。
- 迁移后主仓 `GET /health` 通过。
- `GET /runtime/features` 能正确展示功能开关和外部依赖配置状态。
- `JsonStore.load()` 能读取所有顶层集合。
- 关键引用无不可解释断链；无法修复的断链进入 `knowledgeAlerts` 或迁移报告。
- 生产知识迁移均能追溯到 LLM Wiki source、门禁状态、RAGFlow document 和 answer check。
- demo-only 数据未进入生产知识链路。
- 如写入外部 RAGFlow，必须通过 `/integrations/health` 和真实 retrieval 验证。
- 如迁移失败，可用备份和 rollback manifest 恢复。
