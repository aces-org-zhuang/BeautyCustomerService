# BeautyCustomerService

BeautyCustomerService 项目入口。当前主仓已落地本地可运行 MVP 服务骨架，使用 Node.js 标准库实现，不依赖真实微信后台即可跑通本地消息、AI/转人工、人工反馈和发布门禁流程。
本地 operator UI 可通过浏览器访问 `http://127.0.0.1:8787/operator`。

## 快速入口

- 长期项目知识：`docs/README.md`
- LLM Wiki/RAGFlow 边界：`docs/01-architecture/llm-wiki-ragflow-boundary.md`
- 角色与 UseCase 全景：`docs/00-overview/roles-and-use-cases.md`
- UseCase 实现进度：`docs/08-roadmap/use-case-implementation-progress.md`
- 外部依赖运行材料：`docs/04-operations/external-dependencies-runtime.md`
- 开发规则：`AGENTS.md`
- 文档写作规则：`docs/AGENTS.md`
- 研究区续点：`vendor/research/aces-research/index.md`
- AI 引擎能力：`vendor/ai/maop/.opencode/`
- OpenCode 桥接配置：`.opencode/opencode.json`

## 常用命令

```bash
# 安装依赖
npm install

# 本地开发
npm run dev

# 测试
npm test

# 本地端到端 smoke
npm run smoke

# 构建检查
npm run build

# 完整本地验证
npm run verify
```

当前主仓是 Node.js 标准库 ESM 服务，没有传统编译产物或 `dist/`。统一启动入口是 `src/server.js`，统一配置入口是 `src/config.js`，运行时配置见 `.env.example` 和 `docs/03-runtime/local-service-runtime.md`。

## 知识生效路径边界

本地 demo 路径：`feedback candidate -> 本地审核/本地评估 -> publish-local -> publishedKnowledge`。该路径默认关闭，只在 `BCS_ENABLE_DEMO_PUBLISHED_KNOWLEDGE=1` 时用于本地 fallback/demo，不代表生产 RAGFlow 生效。

生产路径：`feedback/material candidate -> 写入 LLM Wiki 待审区 -> LLM Wiki 人工审核与评估 -> approved-answers -> 主仓扫描或手动 sync -> RAGFlow -> 主仓咨询验证 -> knowledgeDocuments 生效注册`。只有 LLM Wiki 文件满足 `approved + pass/passed + sources` 门禁并通过回答验证，才显示为已生效。

## 本地 MVP 接口

默认端口：`8787`。

```text
GET  /health
GET  /
GET  /operator
GET  /ui/operator.js
GET  /ui/styles.css
GET  /runtime/features
GET  /integrations/health
POST /dev/reset
POST /dev/fake-wechat/messages
GET  /outbox
GET  /decision-logs
GET  /reply-policy
POST /reply-policy
GET  /materials
POST /materials
GET  /materials/:id
POST /materials/:id/distill
GET  /materials/:id/distillations
GET  /materials/batches
POST /materials/import
POST /materials/batches/:id/parse
POST /materials/batches/:id/refresh-blocks
POST /materials/batches/:id/distill
GET  /handoff/tickets
POST /handoff/tickets/:id/claim
POST /handoff/tickets/:id/resolve
GET  /knowledge/feedback-candidates
GET  /knowledge/artifacts
GET  /knowledge/local-test
GET  /knowledge/published
POST /knowledge/feedback-candidates/:id/review
POST /knowledge/feedback-candidates/:id/evaluate
POST /knowledge/feedback-candidates/:id/publish-local  # demo-only，默认禁用
POST /knowledge/sync/llm-wiki-to-ragflow
```

`/operator` 会展示本地 MVP 闭环全景和真实依赖健康状态。RAGFlow、LLM Wiki 和 RAGFlow Sync 只有在对应 env 配置存在并通过真实 HTTP 客户端调用时才启用；缺配置时显示 `unconfigured`，不会伪装成已集成。默认 RAGFlow dataset 名称为 `beauty-faq`，默认 LLM Wiki candidate path 为 `wiki/queries/xiaoqipao-oily-skin.md`，对应主仓 `knowledge/llm-wiki-beauty` 项目。
当前本地测试知识库位于 `src/knowledge/local-test-knowledge.js`，默认关闭；仅设置 `BCS_ENABLE_LOCAL_TEST_KNOWLEDGE=1` 时用于演示 AI 自动回复命中。未命中、低置信或高风险问题仍会转人工，并在出站消息中生成转人工提示。
本地服务 MVP 支持人工回复反哺闭环：feedback candidate 审核通过、本地评估通过、显式开启 demo 开关后发布到本地知识，后续相同问题可命中 `publishedKnowledge` 自动回复。该本地发布不等同于 RAGFlow 生产 KB 同步，生产生效以 LLM Wiki `approved-answers` 到 RAGFlow 的同步和验证为准。
`POST /knowledge/sync/llm-wiki-to-ragflow` 可传 `dataset_id` 或 `dataset_name`；默认会解析 `RAGFLOW_DATASET_NAMES=beauty-faq` 并写入既有 RAGFlow dataset。若 dataset 名称无法解析，接口返回 `409/unconfigured`；只有显式传 `create_dataset: true` 时才新建 dataset。
真实 RAGFlow 自动回复阈值由 `BCS_AUTO_ANSWER_CONFIDENCE` 控制，默认 `0.3`；回答仍必须是 `supported` 且带 source ref 才会发送。当前 `beauty-faq` 对“干皮适合做补水护理吗？”的实测 similarity 约为 `0.3378`，因此默认阈值需要低于该值才能与 RAGFlow 平台表现一致。
RAGFlow 默认启用：只要 `RAGFLOW_API_KEY` 存在且 `RAGFLOW_DATASET_IDS` 或 `RAGFLOW_DATASET_NAMES` 可解析，服务会使用真实 RAGFlow retrieval。设置 `BCS_USE_RAGFLOW=0` 可强制关闭真实检索；此时 UI 显示 `configured_disabled`。
材料蒸馏支持非结构化文本输入，输出 `source_material`、`faq_candidates` 和 `risk_findings`。材料包 staging 支持 JSON 导入 markdown/text 抽取内容，也支持 `multipart/form-data` 上传 `.md/.txt/.docx/.pdf/.png/.jpg` 文件，生成 `materialBatches`、`materialAssets` 和 `materialBlocks`；`POST /materials/batches/:id/parse` 可把材料包上传到 RAGFlow staging dataset 触发 parse，`refresh-blocks` 可把 RAGFlow chunk refs 归一化为 blocks。当前验证推荐 staging 使用 `naive + chunk_token_num=128 + delimiter=\n.!?;。；！？`，并将 markdown 抽取文本作为 `.txt` staging 副本上传，配置依据见 `docs/04-operations/ragflow-staging-chunk-config.md`。蒸馏 candidate 默认 `pending_llm_wiki`，必须进入审核/评估或真实 LLM Wiki 同步流程，不能直接伪装成生产知识。话术策略只包装最终用户回复，不改变 RAGFlow factual answer 和 source refs，`decision-logs` 会记录 factual/final reply。

运行态数据默认写入 `data/local-mvp-store.json`，该文件被 `.gitignore` 忽略；如需改路径，设置 `BCS_DATA_FILE`。

## 顶层目录职责

- `docs/`: 长期稳定项目知识、规则、架构、契约、验证和 LLM 读取入口。
- `src/`: 本地可运行 MVP 服务源码，包括 FakeWeChat、本地编排、RAG 边界、人工接管和知识反馈门禁。
- `src/knowledge/`: 本地测试知识库和后续知识源适配代码；默认只用于 local MVP，不代表生产 RAGFlow 知识库。
- `src/ui/`: 本地 operator UI 静态页面，用于发送 FakeWeChat 消息、领取/解决工单和查看 feedback candidate。
- `tests/`: 主仓本地 MVP 单元和 smoke 验证脚本。
- `data/`: 本地 MVP 运行态 JSON 存储目录；只保留 `.gitkeep`，不提交运行态数据。
- `guides/`: 非研究类阶段性工程记录。
- `scripts/`: 可重复执行的安装、验证、生成、迁移、发布、诊断脚本。
- `vendor/`: 外部仓库、研究工作区、AI 引擎和长期参考资源。
- `.opencode/`: 项目级 OpenCode 桥接配置，不复制 maop 的 `.opencode` 内容。

研究过程、论文草稿、开源仓库对比和证据包不得放入主仓 `docs/`，应放入 `vendor/research/aces-research/`。
