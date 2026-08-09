# LLM Wiki health 可达但写入不可用

状态：当前有效。

## 失效场景

LLM Wiki health 返回正常，主仓 `/integrations/health` 也显示 `llm_wiki.status=reachable`，但业务写入 LLM Wiki candidate 或 material 时失败。

## 定位方式

按以下顺序拆分，不要只看 health：

1. 服务是否启动：`GET /api/v1/health`。
2. 主仓是否连到正确 base URL：`LLM_WIKI_API_BASE_URL`。
3. 主仓进程是否已重启并加载最新路由。
4. 读接口是否可用：`GET /api/v1/projects/current/files/content?path=...`。
5. 写接口是否可用：当前 LLM Wiki 0.6.6 对 `PUT /api/v1/projects/current/files/content` 返回 `405`。
6. current project 是否是目标项目：`GET /api/v1/projects`。

## 根因

LLM Wiki 0.6.6 的 HTTP API 支持 health、projects、files/content 读取、reviews、search、chat、graph 和 sources/rescan，但不支持主仓最初假设的 `PUT /files/content` 写文件。

## 最终修复

主仓写入采用两段式策略：

- 首选：尝试 HTTP 写入，以兼容未来 LLM Wiki 版本。
- fallback：当返回 `405` 时，写入 LLM Wiki current project 的本地文件，再调用 `sources/rescan`。

安全边界：

- fallback 只允许相对路径。
- 写入目标必须落在 current project 目录内。
- current project 必须通过 LLM Wiki Desktop UI 切换，不直接依赖手改 `app-state.json`。

## 验证方式

```bash
npm run verify
```

外部服务验证：

```text
GET /api/v1/health -> 200
GET /api/v1/projects -> currentProject.path 是目标项目
POST /knowledge/feedback-candidates/:id/publish-to-llm-wiki -> 200
GET /api/v1/projects/current/files/content?path=<written-file> -> content 可读
```

## 避免复发

- 不把 health 检查当成写入能力证明。
- 不把 `pending_llm_wiki` 当成已写入 LLM Wiki。
- 每次切换项目后先查 `GET /api/v1/projects`，确认 current project path。
- 写入后必须读回文件，确认内容和落点。
