# LLM Wiki -> RAGFlow -> 回答生效闭环图

状态：当前有效。

用途：把“知识进入 LLM Wiki 后，如何经过审核、同步、验证，最终影响顾客回答”的生产闭环画清楚，避免把本地 demo publish 与真实生效路径混淆。

## 主闭环

```mermaid
flowchart LR
  subgraph input[上游输入]
    A[来源材料<br/>wiki/sources]:::source
    B[人工反馈<br/>客服改写答案]:::source
  end

  subgraph wiki[LLM Wiki 治理区]
    C[待审问答<br/>wiki/draft-answers]:::draft
    D[兼容待审区<br/>wiki/review]:::compat
    E{人工审核 + 评估<br/>approved + pass/passed + sources?}:::gate
    F[已审问答<br/>wiki/approved-answers]:::approved
    X[阻断<br/>缺 sources / rejected / fail]:::blocked
  end

  subgraph sync[主仓同步与验证]
    G[扫描 approved-answers<br/>knowledgeScanRuns]:::process
    H{变更类型}:::gate
    I[同步到 RAGFlow<br/>knowledgeSyncJobs]:::process
    J[可检索知识<br/>RAGFlow dataset/document]:::knowledge
    K[回答生效验证<br/>命中本次 dataset + document]:::verify
    L[同步记录<br/>knowledgeDocuments + knowledgeAnswerChecks]:::record
  end

  subgraph answer[顾客回答链路]
    M[顾客咨询]:::source
    N[检索 RAGFlow]:::process
    O{命中 active document?}:::gate
    P[已生效<br/>回答引用新知识]:::success
    Q[人工接管/阻断<br/>不可假装已生效]:::blocked
  end

  subgraph withdraw[撤回链路]
    R[已撤回<br/>inactive / superseded / withdrawn]:::blocked
  end

  A --> C
  B --> C
  D -.旧数据兼容.-> E
  C --> E
  E -- 通过 --> F
  E -- 不通过 --> X
  F --> G
  G --> H
  H -- added / modified --> I
  H -- unchanged --> L
  H -- deleted / downgraded --> R
  H -- blocked --> X
  I --> J
  J --> K
  K -- 验证通过 --> L
  K -- 验证失败 --> X
  M --> N
  N --> O
  L --> O
  O -- 是 --> P
  O -- 否 --> Q
  R -.过滤旧 document.-> O

  classDef source fill:#eef7ff,stroke:#4472c4,color:#17365d;
  classDef draft fill:#fff2cc,stroke:#d6b656,color:#5f4b00;
  classDef compat fill:#f5f5f5,stroke:#999,color:#444,stroke-dasharray: 4 3;
  classDef gate fill:#e2f0d9,stroke:#70ad47,color:#28551d;
  classDef approved fill:#d9ead3,stroke:#38761d,color:#1f3a13;
  classDef process fill:#e4dfec,stroke:#8064a2,color:#3d2f50;
  classDef knowledge fill:#d9eaf7,stroke:#5b9bd5,color:#1f4e79;
  classDef verify fill:#fde9d9,stroke:#f4b183,color:#7f3f00;
  classDef record fill:#dae8fc,stroke:#6c8ebf,color:#1f4e79;
  classDef success fill:#d5e8d4,stroke:#82b366,color:#274e13;
  classDef blocked fill:#f4cccc,stroke:#cc0000,color:#660000;
```

## 时序透镜

```mermaid
sequenceDiagram
  autonumber
  participant Source as 来源材料/人工反馈
  participant Wiki as LLM Wiki
  participant Repo as 主仓同步服务
  participant Ragflow as RAGFlow
  participant Chat as 顾客咨询链路

  Source->>Wiki: 写入待审问答 draft-answers
  Wiki->>Wiki: 人工审核 + 评估
  Wiki-->>Repo: approved-answers 可扫描
  Repo->>Repo: 校验 approved + pass/passed + sources
  Repo->>Ragflow: 上传/同步 approved answer
  Ragflow-->>Repo: 返回 datasetId + documentId
  Repo->>Chat: 用本次 dataset 验证问题
  Chat->>Ragflow: retrieval
  Ragflow-->>Chat: source_refs 包含本次 documentId
  Chat-->>Repo: 回答命中新知识
  Repo->>Repo: 写入已生效记录
```

## 读图规则

- `wiki/draft-answers` 是新候选默认写入区，`wiki/review` 只表示旧数据兼容。
- 只有 `wiki/approved-answers` 中满足 `approved + pass/passed + sources` 的问答可以进入 RAGFlow 同步。
- `已生效` 不是“同步成功”，而是“回答验证命中本次同步 dataset/document”。
- `已撤回` 依赖 `knowledgeDocuments` 的 active/inactive 状态过滤，避免旧 document 继续影响回答。
- 本地 `publish-local` / `publishedKnowledge` 是 demo fallback，不属于本生产闭环。
