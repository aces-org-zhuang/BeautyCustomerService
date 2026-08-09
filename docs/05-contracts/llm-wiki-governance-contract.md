# LLM Wiki 治理契约

状态：当前有效。

本文定义主仓本地 candidate 与 LLM Wiki 治理事实源之间的写入、读取和状态回写契约。LLM Wiki 是知识治理源头；主仓只能在有真实写入或读取证据后，把 candidate 标记为 `llm_wiki`。

## 职责边界

```text
主仓 distillation / feedback candidate
   -> LLM Wiki source_material / faq_candidate
        -> review_status / evaluation_status
             -> RAGFlow sync gate
```

- 主仓负责生成候选、保留本地状态和编排外部调用。
- LLM Wiki 负责保存 source material、FAQ candidate、审核状态、评估状态和来源关系。
- RAGFlow 不参与审核或编辑，只消费 LLM Wiki 通过门禁的内容。

## 写入接口

### 材料蒸馏写入

```text
POST /materials/:id/publish-to-llm-wiki
```

输入字段：

```js
{
  distillation_id // 可选；未传时使用该 material 最新 distillation
}
```

行为：

- 写入 `distillation.source_material.path`。
- 写入每个 `faq_candidate` 到 candidate 已指定路径；新写入优先使用 `wiki/draft-answers/<candidate_id>.md`，`wiki/review/<candidate_id>.md` 仅作为旧数据兼容路径。
- 写入成功后，本地 candidate 更新为：

```js
{
  governance_target: "llm_wiki",
  llm_wiki_artifact: {
    path,
    status: "written",
    written_at
  }
}
```

失败规则：

- 缺 LLM Wiki base URL 时返回 `unconfigured`。
- 找不到 distillation 时返回 `distillation_not_found`。
- 外部写入失败时不得把 candidate 标记为 `llm_wiki`。

### 人工反馈候选写入

```text
POST /knowledge/feedback-candidates/:id/publish-to-llm-wiki
```

行为：

- 读取本地 `feedbackCandidates` 中的指定 candidate。
- 写入 `candidate.llm_wiki_artifact.path`；缺省为 `wiki/draft-answers/<candidate_id>.md`，`wiki/review/<candidate_id>.md` 仅作为旧数据兼容路径。
- 写入内容必须是 `type: faq_candidate`，并保留 `question`、`answer`、`review_status`、`evaluation_status` 和 `sources`。
- 写入成功后，本地 candidate 更新为 `governance_target=llm_wiki`、`llm_wiki_artifact.status=written`。

失败规则：

- 找不到 candidate 时返回 `candidate_not_found`。
- 缺 source refs 时返回 `missing_source_refs`。
- 外部写入失败时不得把 candidate 标记为 `llm_wiki`。

## 状态回写接口

```text
POST /knowledge/feedback-candidates/:id/refresh-llm-wiki-status
```

行为：

- 从 `candidate.llm_wiki_artifact.path` 读取 LLM Wiki markdown。
- 只接受 `type: faq_candidate`。
- 回写 `review_status` 和 `evaluation_status`。
- `evaluation_status: passed` 归一化为本地主仓使用的 `pass`。
- 重新计算 `publication_decision`。

## Candidate Markdown Frontmatter

```yaml
---
type: faq_candidate
id: candidate_xxx
question: "顾客问题"
review_status: review | approved | rejected
evaluation_status: pending | pass | passed | fail
sources:
  - wiki/sources/source.md#section
---
Answer: 候选答案
```

## 门禁

- `pending_llm_wiki` 只表示等待治理，不是 LLM Wiki 事实。
- 只有 LLM Wiki 写入成功后才能标记 `governance_target=llm_wiki`。
- 默认扫描事实源是 `wiki/approved-answers/`；draft/review 文件即使 frontmatter 已变为 approved，也应先由 LLM Wiki 人工移动/重写到 approved-answers，或由调用方显式传入 candidate path 并接受后端门禁校验。
- 只有 LLM Wiki 读取到 `approved + pass/passed + sources` 后，才可进入 RAGFlow sync。
- 本地审核或本地发布不能替代 LLM Wiki 治理事实。
