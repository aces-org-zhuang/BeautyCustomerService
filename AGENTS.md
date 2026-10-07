# BeautyCustomerService Agent Rules

## 语言规则

本项目默认采用中文友好的交互和文档风格。必要时保留英文技术术语、代码标识、API 名称、命令和路径。

## 供需式协作规则

- 默认把用户视为需求方、授权方和验收方，而不是共同作业者或默认工程执行者。
- Agent 是执行方、收敛方和交付方，必须优先承担探索、验证、筛选、执行和风险归因，不把理解负担转移给用户。
- 只有账号后台操作、真实凭据录入、付费确认、业务偏好选择、外部平台授权或现实环境动作等 Agent 无法代替完成的事项，才要求用户介入。
- 请求用户操作时，每次只给一个最小动作，并说明用户完成后只需反馈什么信号。
- 不要求用户从长方案、完整设计、完整推演或多分支解释中自行提取下一步；Agent 必须明确“当前只做这一步”。
- 技术方案、部署、配置、调试和外部平台联调默认采用“当前判断 -> 我已验证 -> 你只需做 -> 完成后我继续”的格式。
- 完整背景、备选方案、成本展开、技术细节和长文档只在用户要求、决策必要或交付归档时展开；默认先给最小可行动结论。
- 布尔检查结果必须标明是“是否读到/是否满足”，不能让用户误以为 `true/false` 是实际配置值。
- 敏感配置只做存在性、格式或连通性检查；不得要求用户贴出真实 token、secret、key 或企业私密标识。

## 供需式协作与质量门禁协同

- 供需式协作不降低质量门禁；它只约束质量门禁的对用户呈现方式。
- Reasoning、Preview、POC、Review、Verification 和 Confidence 等门禁默认由 Agent 内部承担，除非用户要求完整展开。
- 对用户默认只暴露当前结论、必要证据、一个最小动作和完成后反馈信号。
- 不把质量保障产物变成用户理解成本；完整推演、测试日志、矩阵和长设计默认作为内部证据或归档材料。
- 当质量门禁发现 RED 节点时，Agent 必须先自行收敛；只有遇到账号后台、真实凭据、付费授权、业务偏好或外部平台限制时才请求用户介入。
- 请求用户介入时，每次只提出一个动作；动作必须是用户不可替代完成的。
- Verification Gate 的 fresh evidence 由 Agent 优先采集；用户只承担外部平台后台点击或真实业务验收。
- Stop Rule 触发时，输出“不能继续的单一原因 + 用户唯一下一步”，不要输出多分支长报告。

## 项目定位

BeautyCustomerService 是当前仓库的项目名。业务范围、技术栈、运行方式和交付目标尚未从项目配置中确认，稳定信息应后续沉淀到 `docs/`。

## 工程范围

- 源码域：待补充，确认技术栈后再映射到 `src/`、`apps/`、`packages/` 或框架约定目录。
- 构建域：待补充，构建配置和产物规则需来自真实工具链。
- 安装域：待补充，依赖安装命令需来自真实包管理器配置。
- 测试域：待补充，测试目录和运行命令需来自真实测试配置。
- 文档域：`docs/`。
- 研究域：`vendor/research/aces-research/`。
- AI 引擎域：`vendor/ai/maop/`。
- 外部依赖域：`vendor/`。
- 自动化域：`scripts/` 和 `.opencode/`。

## 关键规则

- 复杂问题定位、架构调整、文档体系演进、研究边界或 submodule 操作前，先使用 `reasoning-map` 推演。
- 不伪造未知技术栈命令；未知命令标记为 `待补充`。
- 新增顶层目录时，必须说明职责域、消费者和索引同步位置。
- 真实凭据不得写入仓库、docs、evidence、日志或 `.opencode` 配置。
- 开发规则只保留通用治理元规则；技术栈细则必须来自本项目真实配置、源码或用户确认。

## 研发流水线规则

- 需求、PRD、用户场景和验收标准优先使用 `product-definition`。
- 技术方案、架构影响面、接口、状态、依赖选型和验证策略优先使用 `technical-design`。
- 架构模型（LikeC4 `.c4`）、上下文图、容器图、组件图、部署图、场景流程图、时序图、架构漂移检测和跨项目架构视图优先使用 `architecture-design`；模型写入 `vendor/design/aces-design`。
- 依赖关系或部署形态变更时，先用 `architecture-design` 经 `likec4` MCP 查询影响面，再改代码，并在同一 PR 更新设计仓模型。
- 代码实现、bugfix、测试验证、代码审查和交付摘要优先使用 `implementation-delivery`。
- 长期研究、趋势发现、论文建模、证据包和仓库研究优先使用 `research`，产物写入研究区。
- 复杂影响面、问题定位、docs 体系、研究区、submodule 和 `.opencode` 规划前使用 `reasoning-map`。

## 质量门禁

- Reasoning Gate：复杂或高影响变更前先推演影响面和 RED/GREEN 节点。
- Preview Gate：高成本表达产物、复杂 Mermaid、前端 UI 或多模态产物落盘前先给出可评审预览或范围说明。
- Review Gate：关键需求、技术设计、实现交付或研究结论应有复核；高风险节点目标评分不低于 80。
- POC Gate：高风险实现、未知依赖或不可逆集成先做最小 POC。
- Verification Gate：声明完成前必须提供 fresh verification evidence；无法运行时说明原因、降级证据和残余风险。
- Confidence Gate：声称 90%+ 置信度必须有验证证据、覆盖边界和未覆盖风险说明。
- Stop Rule：发现会放大错误的 RED 节点时，先收敛或请求确认，不继续扩大产物范围。

## 文档规则

- 长期稳定知识放在 `docs/`。
- 非研究类阶段性工程记录放在 `guides/`。
- 研究过程、论文、开源仓库对比和证据包放在 `vendor/research/aces-research/`。
- 新增、重命名或删除索引型文件时，必须同步对应 README 或 index。

## 研究区规则

- 研究区是必建部分：`vendor/research/aces-research/` -> `https://github.com/aces-org-zhuang/aces-research.git`。
- 研究区不进入默认项目上下文；只有研究任务才读取研究区 `index.md` 和目标课题。
- 研究参考仓必须放在具体课题 `topics/<research_slug>/repos/<repo_name>`，优先 Git submodule。

## AI 引擎规则

- AI 引擎是必建 submodule：`vendor/ai/maop/` -> `https://github.com/aces-org-zhuang/maop.git`。
- `vendor/ai/maop/` 使用 sparse-checkout，只检出 `.opencode` 和 `README.md`。
- 项目仓 `.opencode/opencode.json` 作为桥接配置，必须引用 `vendor/ai/maop/.opencode/skills` 和 `maop-opencode` reference。
- `vendor/ai/maop/.opencode/` 属于 maop 仓库，由 maop 独立演进；项目仓不复制或覆盖 maop 的 `.opencode`。

## 设计仓规则

- 设计仓是必建 submodule：`vendor/design/aces-design/` -> `https://github.com/aces-org-zhuang/design-beauty.git`。
- 设计仓承载架构即代码：组件划分、集成关系、部署形态、时序流程（`src/**/*.c4`）。
- 设计仓**不启用** sparse-checkout；LikeC4 需要完整工作区才能 `validate` 与 `build`。这与 `vendor/ai/maop` 的规则相反，不要照搬。
- 项目 `.opencode/opencode.json` 配置 `likec4` MCP，`LIKEC4_WORKSPACE` 指向 `vendor/design/aces-design`；修改配置后需重启 OpenCode。
- 主仓**不构建**设计仓（索引 `build_entry` 为 `none`）；`likec4 validate` / `build` 由设计仓自身 CI 执行。
- 依赖关系、集成或部署形态变更时，架构模型必须在**同一个 PR 内**同步更新设计仓。
- 需与代码同一个 PR 的设计内容（模块级接口草案、实现级契约、字段级设计）留在 `docs/`，不进入设计仓。设计仓承载跨 PR 生命周期的资产，把代码附属设计放进去会导致设计滞后于代码。
- 一个设计仓只服务一个项目；禁止多项目共用同一设计仓 submodule。
- 跨项目视图由全局聚合仓 `aces-architecture` 维护，不在本仓。

## Submodule 提交规则

- 修改 submodule 内容时，必须在 submodule 仓库内独立分支、提交、推送并创建 PR。
- 主仓只提交远端可见的 submodule 指针，并在主仓 PR 中关联对应 submodule PR。
- 不提交只存在本地、远端不可见的 submodule commit 指针。
- 新增、移动或删除长期 submodule 时，同步 `.gitmodules` 和 `docs/02-development/submodules-index.md`。

## 项目结构

```text
README.md                  项目入口、命令占位和导航
AGENTS.md                  LLM 协作和治理规则
docs/                      长期稳定知识与索引
guides/                    非研究类阶段性工程记录
scripts/                   可重复执行的自动化脚本
vendor/research/aces-research/  研究工作区 submodule
vendor/ai/maop/            AI 引擎 submodule
vendor/design/aces-design/ 架构设计仓 submodule（架构即代码）
.opencode/                 项目 OpenCode 桥接配置
```

## 常用命令

```bash
待补充  # 安装依赖
待补充  # 本地开发
待补充  # 测试
待补充  # 构建
```

## OpenCode 本地配置

项目本地 OpenCode 桥接配置位于 `.opencode/opencode.json`。它引用 `vendor/ai/maop/.opencode/skills`，保证项目开发时可使用 maop AI 引擎能力。修改 maop skill、agent、command 或项目 `opencode.json` 后，需要重启 OpenCode 才会生效。
