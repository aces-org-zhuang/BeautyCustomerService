# 外部依赖运行材料

状态：当前有效。

本文索引本地 MVP 涉及的 RAGFlow、LLM Wiki、Ragas、微信相关部署/验证材料，并说明主仓如何连接这些外部服务。详细 POC 过程仍保留在研究区；主仓 docs 只沉淀稳定入口、当前配置和验证边界。

## 依赖全景

```text
BeautyCustomerService 主仓
   -> RAGFlow API: http://127.0.0.1:9380
        -> dataset: beauty-faq
   -> LLM Wiki API: http://127.0.0.1:19828
        -> project: knowledge/llm-wiki-beauty/llm-wiki-beauty
   -> Ragas runtime: 研究区 POC 已验证，主仓 runner 未接入
   -> WeChat live: 后台 callback/secret/sync/send 仍挂起
```

## RAGFlow

完整系统启动顺序、配置注入、健康检查和 `ragflow_unavailable` 排障路径见：

```text
../03-runtime/system-startup-design.md
```

主仓配置：

```text
RAGFLOW_BASE_URL=http://127.0.0.1:9380
RAGFLOW_API_KEY=<secret>
RAGFLOW_DATASET_NAMES=beauty-faq
BCS_USE_RAGFLOW 默认启用；设为 0 可关闭
```

部署/验证材料位置：

```text
vendor/research/aces-research/topics/wechat-customer-service-ai-faq-feedback/validation/runtime/ragflow-compose.poc.override.yml
vendor/research/aces-research/topics/wechat-customer-service-ai-faq-feedback/validation/runtime/probe-ragflow-ingest-retrieve.mjs
vendor/research/aces-research/topics/wechat-customer-service-ai-faq-feedback/validation/runtime-readiness-probe-2026-08-02.md
```

历史可用启动路径见研究区记录：

```text
vendor/research/aces-research/topics/wechat-customer-service-ai-faq-feedback/repos/ragflow/docker
```

主仓健康检查：

```bash
npm start
# then GET /integrations/health
```

通过标准：

```text
ragflow.status = reachable
ragflow_datasets.ok = true
ragflow_datasets.datasetIds contains beauty-faq resolved id
```

## LLM Wiki

主仓配置：

```text
LLM_WIKI_API_BASE_URL=http://127.0.0.1:19828
LLM_WIKI_API_TOKEN=<secret>
LLM_WIKI_CANDIDATE_PATH=wiki/queries/xiaoqipao-oily-skin.md
```

当前主仓项目材料位置：

```text
knowledge/llm-wiki-beauty/llm-wiki-beauty
```

部署/验证材料位置：

```text
vendor/research/aces-research/topics/wechat-customer-service-ai-faq-feedback/validation/runtime/tools/LLM-Wiki-0.6.6-windows-x64-portable.zip
vendor/research/aces-research/topics/wechat-customer-service-ai-faq-feedback/validation/runtime/probe-llmwiki-to-ragflow-sync.mjs
vendor/research/aces-research/topics/wechat-customer-service-ai-faq-feedback/validation/runtime-readiness-probe-2026-08-02.md
```

主仓健康检查：

```bash
npm start
# then GET /integrations/health
```

通过标准：

```text
llm_wiki.status = reachable
llm_wiki.body.version is present
```

## LLM Wiki -> RAGFlow Sync

主仓接口：

```text
POST /knowledge/sync/llm-wiki-to-ragflow
```

输入规则：

- 默认 candidate path 是 `wiki/queries/xiaoqipao-oily-skin.md`。
- 默认 dataset name 是 `beauty-faq`。
- 只有 LLM Wiki candidate 满足 `type: faq_candidate`、`review_status: approved`、`evaluation_status: pass/passed`、`sources` 非空时才允许同步。
- dataset name 无法解析时返回 `409/unconfigured`。
- 只有显式 `create_dataset: true` 时才新建 dataset。

## Ragas

部署/验证材料位置：

```text
vendor/research/aces-research/topics/wechat-customer-service-ai-faq-feedback/validation/runtime/probe-ragas-runtime-smoke.py
vendor/research/aces-research/topics/wechat-customer-service-ai-faq-feedback/validation/runtime/probe-ragas-label-mapping-fixtures.mjs
```

当前主仓状态：

```text
Ragas runtime POC 已在研究区验证；主仓尚未接入 Ragas runner。
当前主仓仅有本地 evaluation policy。
```

## WeChat / WeCom

部署/验证材料位置：

```text
vendor/research/aces-research/topics/wechat-customer-service-ai-faq-feedback/validation/runtime/probe-wecom-crypto-official-runtime.mjs
vendor/research/aces-research/topics/wechat-customer-service-ai-faq-feedback/validation/runtime/probe-wechat-adapter-fixtures.mjs
```

当前主仓状态：

```text
真实微信 live 未完成。
callback 域名后台保存、WECHAT_KF_SECRET、真实 sync_msg、真实 send_msg、add_contact_way 仍是外部阻断。
主仓默认使用 FakeWeChat/local mode。
```

## 主仓完整本地验证

```bash
npm run verify
```

`npm run verify` 只保证主仓本地 MVP 的 build/test/smoke。外部依赖是否可用，需要额外查看：

```text
GET /integrations/health
```

不要把研究区 POC 材料等同于生产部署流水线。当前尚未定义 CI、容器镜像、发布回滚或生产部署流程。
