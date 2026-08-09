# 本地服务运行时

状态：当前有效。

本文声明 BeautyCustomerService 主仓本地 MVP 的统一启动入口、配置来源、运行态数据和构建验证方式。

## 构建形态

当前服务是 Node.js ESM 应用，使用 Node.js 标准库实现，没有前端打包、转译或二进制构建产物。

```text
package.json
  -> npm run dev / npm start
       -> node src/server.js
            -> loadConfig(process.env)
            -> createApp(config)
            -> HTTP server
```

因此当前 `npm run build` 的含义不是生成 dist 目录，而是执行 Node 语法检查，确认统一启动入口可被 Node 解析。

## 统一启动入口

统一服务入口是：

```text
src/server.js
```

启动命令：

```bash
npm run dev
npm start
```

两者当前等价，均执行：

```bash
node src/server.js
```

## 配置入口

统一配置加载函数是：

```text
src/config.js -> loadConfig(env = process.env)
```

配置来自环境变量；示例文件是：

```text
.env.example
```

当前代码不会自动读取 `.env` 文件。若本地需要 `.env`，应由启动 shell、进程管理器或后续明确引入的配置加载器注入环境变量；不得把真实密钥提交到仓库。

## 运行态数据

默认运行态数据文件：

```text
data/local-mvp-store.json
```

可通过环境变量覆盖：

```bash
BCS_DATA_FILE=path/to/store.json
```

`data/local-mvp-store.json` 是运行态数据，应保持 gitignored。

## 关键环境变量

```text
PORT                         默认 8787
BCS_DATA_FILE                默认 data/local-mvp-store.json
BCS_USE_RAGFLOW              默认启用；设为 0 可关闭真实 RAGFlow retrieval
BCS_AUTO_ANSWER_CONFIDENCE   默认 0.3
RAGFLOW_BASE_URL             默认 http://127.0.0.1:9380
RAGFLOW_API_KEY              真实 RAGFlow API key，不能提交
RAGFLOW_DATASET_IDS          可选，优先于 dataset name
RAGFLOW_DATASET_NAMES        默认 beauty-faq
RAGFLOW_STAGING_DATASET_NAME 默认 beauty-material-staging
RAGFLOW_STAGING_CHUNK_METHOD 默认 naive
RAGFLOW_STAGING_CHUNK_TOKEN_NUM 默认 128
RAGFLOW_STAGING_DELIMITER    默认 \n.!?;。；！？
BCS_ENABLE_LOCAL_TEST_KNOWLEDGE  设为 1 时启用本地测试知识
LLM_WIKI_API_BASE_URL        默认 http://127.0.0.1:19828
LLM_WIKI_API_TOKEN           真实 LLM Wiki token，不能提交
LLM_WIKI_CANDIDATE_PATH      默认 wiki/queries/xiaoqipao-oily-skin.md
```

## 验证命令

```bash
npm run build   # Node 语法检查统一入口
npm test        # 单元测试
npm run smoke   # 本地 MVP smoke
npm run verify  # build + test + smoke
```

## 完整构建保证边界

当前可以保证：

- 主仓服务入口 `src/server.js` 语法可解析。
- 单元测试覆盖本地核心状态机。
- smoke 覆盖本地 API、UI 入口、材料蒸馏、材料包 block 导入、候选、发布门禁和本地闭环。

当前不能保证：

- 真实微信 live callback/sync/send 流程，因为微信后台配置和 secret 尚未完成。
- RAGFlow/LLM Wiki 外部服务在所有环境恒定可达；只能通过 `/integrations/health` 和真实探针确认当前环境。
- 生产部署构建产物，因为当前项目尚未定义容器镜像、CI、打包目录或发布流程。

外部依赖部署/验证材料见 `../04-operations/external-dependencies-runtime.md`。
