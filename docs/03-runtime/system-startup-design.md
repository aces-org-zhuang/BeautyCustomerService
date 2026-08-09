# 系统启动设计

状态：当前有效。

本文补齐 BeautyCustomerService 本地 MVP 的完整系统启动设计，覆盖主仓 Node 服务、运行态数据、Operator UI、FakeWeChat、本地知识降级、RAGFlow、LLM Wiki、同步/验证入口和启动后健康检查。

## 启动全景

```text
[启动环境]
   -> [环境变量注入]
      ├─ [主仓 Node 服务]
      │     -> [src/server.js]
      │        -> [loadConfig(process.env)]
      │           -> [createApp(config)]
      │              ├─ [Operator UI]
      │              ├─ [FakeWeChat 消息入口]
      │              ├─ [AnswerOrchestrator]
      │              ├─ [运行态 JSON store]
      │              ├─ [本地测试/演示知识]
      │              └─ [外部依赖客户端]
      ├─ [RAGFlow 外部服务]
      │     -> [真实 retrieval / sync / lifecycle probe]
      └─ [LLM Wiki 外部服务]
            -> [candidate publish / status refresh / sync source]
```

主仓只托管 BeautyCustomerService Node 服务。RAGFlow、LLM Wiki、Ragas 和真实微信都是外部依赖，不由 `npm run dev` 自动启动。

## 启动模式

### 本地基础模式

用途：验证主仓服务、Operator UI、FakeWeChat、人工接管、材料导入和本地状态机。

```text
RAGFlow: 可不启动
LLM Wiki: 可不启动
BCS_USE_RAGFLOW=0
BCS_ENABLE_LOCAL_TEST_KNOWLEDGE 可按需设为 1
BCS_ENABLE_DEMO_PUBLISHED_KNOWLEDGE 可按需设为 1
```

边界：本地测试知识和 demo publish 只用于本地验证，不代表生产 RAGFlow 知识库生效。

### 真实 RAGFlow 回答模式

用途：验证用户提问能走真实 RAGFlow retrieval。

```text
RAGFlow: 必须已启动且 API 可达
LLM Wiki: 非必需
RAGFLOW_API_KEY: 必需
RAGFLOW_DATASET_IDS 或 RAGFLOW_DATASET_NAMES: 必需
BCS_USE_RAGFLOW: 默认启用；不要设为 0
```

通过标准：

```text
GET /integrations/health
ragflow.status = reachable
ragflow_datasets.ok = true
```

### 知识治理同步模式

用途：验证 feedback/material candidate 从 LLM Wiki 审核后同步到 RAGFlow，并通过回答验证进入生效闭环。

```text
RAGFlow: 必须已启动且 dataset 可解析
LLM Wiki: 必须已启动且 token 可用
LLM_WIKI_CANDIDATE_PATH: 指向真实 candidate
POST /knowledge/sync/llm-wiki-to-ragflow
POST /knowledge/answer-loop/sync-and-verify
```

门禁：candidate 必须满足 `approved + pass/passed + sources`，不能直接把未审核候选伪装成生产知识。

## 启动顺序

### 1. 确认 Node 版本和依赖

项目要求：

```text
Node.js >=20
```

依赖安装：

```bash
npm install
```

当前主仓是 Node.js 标准库 ESM 服务，没有传统前端打包、转译或 `dist/` 产物。

### 2. 准备运行态数据

默认数据文件：

```text
data/local-mvp-store.json
```

可通过环境变量覆盖：

```text
BCS_DATA_FILE=path/to/store.json
```

该文件是运行态数据，应保持 gitignored。需要重置本地状态时使用：

```text
POST /dev/reset
```

### 3. 准备外部依赖

RAGFlow 默认地址：

```text
RAGFLOW_BASE_URL=http://127.0.0.1:9380
```

LLM Wiki 默认地址：

```text
LLM_WIKI_API_BASE_URL=http://127.0.0.1:19828
```

历史 POC 启动和验证材料位于研究区：

```text
vendor/research/aces-research/topics/wechat-customer-service-ai-faq-feedback/validation/runtime/ragflow-compose.poc.override.yml
vendor/research/aces-research/topics/wechat-customer-service-ai-faq-feedback/validation/runtime/probe-ragflow-ingest-retrieve.mjs
vendor/research/aces-research/topics/wechat-customer-service-ai-faq-feedback/validation/runtime/probe-llmwiki-to-ragflow-sync.mjs
vendor/research/aces-research/topics/wechat-customer-service-ai-faq-feedback/validation/runtime-readiness-probe-2026-08-02.md
```

边界：研究区材料是 POC 证据，不等同于主仓生产部署流水线。当前主仓尚未定义容器镜像、CI、生产发布或回滚命令。

### 4. 注入环境变量

当前代码只读取 `process.env`，不会自动加载 `.env` 文件。`.env.example` 只是变量样例，真实启动时需要由 shell、IDE、进程管理器或后续明确引入的配置加载器注入环境变量。

主仓基础变量：

```text
PORT=8787
BCS_DATA_FILE=data/local-mvp-store.json
BCS_AUTO_ANSWER_CONFIDENCE=0.3
```

真实 RAGFlow retrieval 变量：

```text
RAGFLOW_BASE_URL=http://127.0.0.1:9380
RAGFLOW_API_KEY=<secret>
RAGFLOW_DATASET_NAMES=beauty-faq
```

如果环境中没有名为 `beauty-faq` 的 dataset，可以改用已知 id：

```text
RAGFLOW_DATASET_IDS=<dataset_id>
```

LLM Wiki 同步变量：

```text
LLM_WIKI_API_BASE_URL=http://127.0.0.1:19828
LLM_WIKI_API_TOKEN=<secret>
LLM_WIKI_CANDIDATE_PATH=wiki/queries/xiaoqipao-oily-skin.md
```

本地降级变量：

```text
BCS_USE_RAGFLOW=0
BCS_ENABLE_LOCAL_TEST_KNOWLEDGE=1
BCS_ENABLE_DEMO_PUBLISHED_KNOWLEDGE=1
```

禁止把真实 `RAGFLOW_API_KEY`、`LLM_WIKI_API_TOKEN` 或微信凭据提交到仓库、docs、日志或 evidence。

### 5. 启动主仓服务

主仓启动入口：

```bash
npm run dev
```

等价入口：

```bash
npm start
```

两者当前均执行：

```bash
node src/server.js
```

启动成功日志只证明主仓 HTTP 服务已监听：

```text
{"ok":true,"service":"beauty-customer-service","port":8787,...}
```

### 6. 打开 Operator UI

浏览器访问：

```text
http://127.0.0.1:8787/operator
```

Operator UI 会读取：

```text
GET /runtime/features
GET /integrations/health
GET /handoff/tickets
GET /decision-logs
GET /knowledge/artifacts
```

## 启动后健康检查

### 主仓服务

```text
GET http://127.0.0.1:8787/health
```

通过标准：

```text
ok = true
service = beauty-customer-service
```

### 功能概览

```text
GET http://127.0.0.1:8787/runtime/features
```

重点查看：

```text
integrations.ragflow.mode
integrations.ragflow.retrieval_enabled
integrations.ragflow.api_key_configured
integrations.ragflow.dataset_ids_configured
integrations.ragflow.dataset_names_configured
integrations.llm_wiki.token_configured
local_test_knowledge status
```

### 外部依赖

```text
GET http://127.0.0.1:8787/integrations/health
```

真实 RAGFlow 模式通过标准：

```text
ragflow.status = reachable
ragflow_datasets.ok = true
ragflow_datasets.datasetIds 至少包含一个可用 dataset id
```

LLM Wiki 同步模式通过标准：

```text
llm_wiki.status = reachable
llm_wiki.body.version is present
```

## 提问链路

本地 FakeWeChat 提问入口：

```text
POST /dev/fake-wechat/messages
```

回答路径：

```text
FakeWeChat message
   -> AnswerOrchestrator
      -> RagflowKnowledgeService.answer()
         ├─ high risk -> handoff
         ├─ real RAGFlow retrieval -> answer or unavailable
         ├─ demo published knowledge -> answer
         ├─ local test knowledge -> answer or low confidence
         └─ handoff ticket
```

`ragflow_unavailable` 出现在这条链路中，含义是主仓服务已进入回答编排，但真实 RAGFlow retrieval 没有完成。

触发 `ragflow_unavailable` 的直接条件：

- `RAGFLOW_API_KEY` 缺失或无效。
- `RAGFLOW_BASE_URL` 不可达。
- `RAGFLOW_DATASET_IDS` 为空，且 `RAGFLOW_DATASET_NAMES` 无法解析到真实 dataset。
- RAGFlow retrieval API 返回失败。

这不是 `npm run dev` 或 `src/server.js` 未启动的同义词。

## 排障路径

```text
[系统启动或提问异常]
   -> [GET /health]
      ├─ [失败]
      │     -> 检查 npm run dev、PORT 占用、Node.js 版本
      └─ [成功]
            -> [GET /runtime/features]
               ├─ [RAGFlow unconfigured]
               │     -> 检查 RAGFLOW_API_KEY、dataset env、BCS_USE_RAGFLOW
               ├─ [LLM Wiki unconfigured]
               │     -> 检查 LLM_WIKI_API_TOKEN 和 LLM_WIKI_API_BASE_URL
               └─ [功能开关符合预期]
                     -> [GET /integrations/health]
                        ├─ [ragflow.status = unconfigured]
                        │     -> 注入 RAGFLOW_API_KEY，确认主仓进程可读
                        ├─ [ragflow.status = auth_failed]
                        │     -> 替换有效 API key
                        ├─ [ragflow.status = unreachable]
                        │     -> 启动外部 RAGFlow 或修正 RAGFLOW_BASE_URL
                        ├─ [ragflow_datasets.reason = ragflow_dataset_names_not_found]
                        │     -> 使用 RAGFLOW_DATASET_IDS 或创建/同步 beauty-faq
                        ├─ [llm_wiki.status 非 reachable]
                        │     -> 启动 LLM Wiki 或修正 token/base URL
                        └─ [外部依赖健康]
                              -> 再执行提问、同步或 lifecycle probe
```

## 验证命令

本地代码验证：

```bash
npm run build
npm test
npm run smoke
npm run verify
```

边界：`npm run verify` 只保证主仓本地 MVP 的 build/test/smoke，不证明 RAGFlow、LLM Wiki、Ragas 或真实微信当前可用。外部依赖是否可用，以 `/integrations/health` 和真实探针为准。

## 当前边界

- 主仓不启动 RAGFlow、LLM Wiki、Ragas 或真实微信后台。
- 主仓不自动读取 `.env`。
- 主仓当前没有生产容器镜像、CI、部署或回滚设计。
- 真实微信 live callback/sync/send 流程仍挂起，默认使用 FakeWeChat/local mode。
- RAGFlow 生产同步仍以 LLM Wiki `approved + pass/passed + sources` 门禁和同步验证为准。
