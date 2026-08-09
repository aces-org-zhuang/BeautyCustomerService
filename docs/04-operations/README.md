# 运维与验证

状态：暂定。

本目录保存验证、部署、发布、排障和回滚流程。不要伪造尚未确认的 CI、部署或测试命令。

## 当前验证入口

```bash
npm run build
npm test
npm run smoke
npm run verify
```

当前尚未定义 CI、容器镜像、生产部署或发布回滚流程；不要把本地 `verify` 描述成生产发布验证。

## 文档索引

- `external-dependencies-runtime.md`: RAGFlow、LLM Wiki、Ragas、微信相关部署/验证材料位置、主仓配置和健康检查入口。
- `ragflow-staging-chunk-config.md`: UC3 材料包进入 RAGFlow staging 的推荐 chunk 配置、验证证据和边界。
- `../03-runtime/system-startup-design.md`: 完整系统启动顺序、健康检查和 `ragflow_unavailable` 排障路径。
- `../05-contracts/data-migration-design.md`: 数据迁移对象、阶段、幂等、校验、回滚和验收设计。
