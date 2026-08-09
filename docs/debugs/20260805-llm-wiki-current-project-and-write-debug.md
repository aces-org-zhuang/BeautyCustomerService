# LLM Wiki current project 与写入链路排障

状态：当前有效。

## 问题

主仓调用 LLM Wiki 时表现为“服务不可用”或“写入不可用”。需要区分 LLM Wiki Desktop 是否启动、HTTP health 是否可达、主仓运行进程是否加载最新代码、写入 API 是否被真实服务支持，以及 current project 是否指向主仓知识库。

## 定位路径

1. 检查主仓配置。
   - `LLM_WIKI_API_BASE_URL=http://127.0.0.1:19828`
   - `LLM_WIKI_API_TOKEN=<set>`

2. 检查端口和进程。
   - `127.0.0.1:19828` 正在监听。
   - 进程为 `LLM Wiki.exe`，版本 `0.6.6`。

3. 检查 LLM Wiki health。
   - `GET /api/v1/health` 返回 `200`。
   - body 中 `status=running`、`version=0.6.6`。

4. 检查主仓聚合健康检查。
   - `GET http://127.0.0.1:8787/integrations/health` 返回 `llm_wiki.status=reachable`。

5. 区分读可用与写可用。
   - `GET /api/v1/projects/current/files/content?path=...` 可读取 candidate。
   - `PUT /api/v1/projects/current/files/content` 返回 `405 Method not allowed`。
   - 结论：LLM Wiki 服务可用，但 HTTP 文件写入 API 不可用。

6. 检查主仓服务是否加载最新代码。
   - 重启前，`POST /knowledge/feedback-candidates/:id/publish-to-llm-wiki` 返回 `404`。
   - 重启主仓后，该接口返回 `200`。

7. 检查 current project。
   - 初始 current project 是研究区 POC：`llm-wiki-beauty-poc`。
   - 用户通过 LLM Wiki Desktop UI 打开主仓项目后，current project 变为：

```text
E:/aces_desktop/BeautyCustomerService/knowledge/llm-wiki-beauty/llm-wiki-beauty
```

8. 验证主仓写入。
   - 写入 candidate：`candidate_28b23e001917`。
   - LLM Wiki API 可读取：`wiki/review/candidate_28b23e001917.md`。
   - 磁盘文件存在于主仓项目：`knowledge/llm-wiki-beauty/llm-wiki-beauty/wiki/review/candidate_28b23e001917.md`。

## 修复记录

- `LlmWikiClient.writeFile()` 保留 HTTP `PUT` 尝试。
- 当真实服务返回 `405` 时，fallback 到 current project 文件写入：
  - 调 `GET /api/v1/projects` 获取 current project path。
  - 写入 current project 下的 `wiki/...md`。
  - 调 `POST /api/v1/projects/current/sources/rescan` 触发重扫。
  - 路径必须是相对路径，禁止绝对路径和 `../` 逃逸。

## 最终状态

当前 LLM Wiki current project：

```text
name: llm-wiki-beauty
path: E:/aces_desktop/BeautyCustomerService/knowledge/llm-wiki-beauty/llm-wiki-beauty
```

主仓写入接口验证通过：

```text
POST /knowledge/feedback-candidates/:id/publish-to-llm-wiki -> 200
```

## 复用提醒

- `health reachable` 只证明服务可达，不证明写入链路可用。
- `projects.currentProject` 决定 fallback 写入落点；写入前必须确认它指向预期项目。
- 直接修改 LLM Wiki Desktop `app-state.json` 不可靠；Desktop 会在启动时清理无效状态。current project 应通过 Desktop UI 打开项目来切换。
