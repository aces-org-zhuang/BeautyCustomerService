# 开发

状态：暂定。

## 命令

```bash
npm install  # 安装依赖
npm run dev  # 本地开发
npm run build  # 构建检查；当前无 dist 产物
npm test     # 测试
npm run smoke  # 本地端到端 smoke
npm run verify  # build + test + smoke
```

## 目录治理

- 主仓当前本地 MVP 使用 Node.js 标准库实现；源码位于 `src/`，测试位于 `tests/`。
- 当前构建形态见 `../03-runtime/local-service-runtime.md`；没有传统编译产物，`npm run build` 执行 Node 入口语法检查。
- 新增顶层目录时，同步根 `README.md`、根 `AGENTS.md` 或本目录索引。
- 外部参考仓优先使用 Git submodule，放入 `vendor/` 对应职责路径。

## 索引

- `submodules-index.md`: 长期 submodule 来源、边界、消费者和验证方式。
