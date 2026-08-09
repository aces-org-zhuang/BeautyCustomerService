# Submodule 索引

本索引记录长期 submodule 的来源、边界、消费者和验证方式。新增、移动、删除 submodule 时必须同步本文件和 `.gitmodules`。

## 锁定 submodule

| Path | URL | 边界 | 消费者 | 验证方式 | 状态 |
| --- | --- | --- | --- | --- | --- |
| `vendor/research/aces-research` | `https://github.com/aces-org-zhuang/aces-research.git` | 研究过程、论文、开源对比、证据包 | 研究任务、论文任务、证据验证任务 | `git submodule status --recursive` | 已添加，pinned `b2025592f1b5a5b37f1ca538ab6dfcf091e74e36` |
| `vendor/ai/maop` | `https://github.com/aces-org-zhuang/maop.git` | maop-owned AI 引擎和 OpenCode 能力面 | `.opencode/opencode.json` | `git -C vendor/ai/maop sparse-checkout list` 应包含 `/.opencode/` 和 `/README.md`；`git -C vendor/ai/maop branch -r --contains <pinned>` 应包含 `origin/main` | 已添加，pinned `c5269031d9ca90889357c67da4869929c3377fa2`，已启用 sparse-checkout，commit 已在 `origin/main` 可见 |

## 规则

- 不普通 clone 外部参考仓到主仓。
- 研究参考仓放入具体课题 `vendor/research/aces-research/topics/<research_slug>/repos/<repo_name>`。
- maop submodule 必须启用 sparse-checkout，只检出 `.opencode` 和 `README.md`。
- 主仓不递归初始化 maop 内部 submodule；maop 内部依赖由 maop 仓库自身治理。
- 当前用户确认暂不初始化 `vendor/research/aces-research/topics/wechat-customer-service-ai-faq-feedback/repos/FastGPT/pro`；该嵌套 submodule 不作为本轮初始化 RED 点。
