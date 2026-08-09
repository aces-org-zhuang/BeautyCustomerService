# RAGFlow Staging Chunk 配置

本文记录 UC3 材料包进入 RAGFlow staging dataset 时的推荐 chunk 配置和验证依据。

## 推荐配置

```text
RAGFLOW_STAGING_CHUNK_METHOD=naive
RAGFLOW_STAGING_CHUNK_TOKEN_NUM=128
RAGFLOW_STAGING_DELIMITER=\n.!?;。；！？
```

主仓默认会将 `text/markdown` 的 staging 上传副本改成 `.txt` + `text/plain`，但不改变本地 asset 原始文件名。原因是当前验证发现：同一段英文长材料以 `.md` 上传时，RAGFlow 无论 delimiter 如何都生成 1 个大 chunk；以 `.txt` 上传并使用上述 delimiter 时能生成多个 chunks。

## 验证证据

真实材料：American Academy of Dermatology 防晒选择页面。

```text
https://www.aad.org/public/everyday-care/sun-protection/shade-clothing-sunscreen/how-to-select-sunscreen
```

抽取正文长度：`7625` 字符。

配置矩阵结果：

```text
aad-long.md  + delimiter \n              -> Generate 1 chunks
aad-long.md  + delimiter \n.!?;。；！？   -> Generate 1 chunks
aad-long.txt + delimiter \n.!?;。；！？   -> Generate 8 chunks
```

因此当前 UC3 staging 推荐使用 `.txt` staging 副本承载网页/markdown 抽取文本，保证英文句号、问号、叹号、分号和中文标点能作为切分边界。

## 边界

- 该配置适用于文本/markdown 抽取内容进入 RAGFlow staging。
- PDF、DOCX、图片 OCR 仍需逐格式验证。
- 该配置不代表 production dataset 的唯一最优配置；production 应按审核后的 FAQ/知识结构单独验证。
- RAGFlow Agent、Memory、GraphRAG、parent-child chunking 还未接入主仓业务链路。

## 下一步

1. 对 `.docx`、PDF、图片 OCR 分别跑格式级 chunk 验证。
2. 验证 parent-child chunking 是否能同时保留精确匹配和较大上下文。
3. 评估 GraphRAG/KnowledgeGraph 是否适合产品功效、禁忌、服务流程之间的关系问答。
4. 评估 RAGFlow Agent/Memory 是否应进入 UC1 客服会话记忆，而不是 UC3 材料蒸馏。
