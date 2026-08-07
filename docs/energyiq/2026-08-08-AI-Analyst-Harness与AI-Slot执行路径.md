---
title: "AI Analyst Harness 与 AI Slot 执行路径"
summary: "跟踪 #30/#36 Harness、两项目 AI Slot 和相关 Open Ticket 的最小实施顺序、Owner、证据与停止项。"
doc_type: playbook
tags: [AI Analyst, Harness Eval, AI Slot, Overview, execution]
updated_at: "2026-08-08"
related:
  - "2026-08-05-Overview用户价值与AI-Slot最小交付决策.md"
  - "2026-08-06-Charles系统价值复核与连续数据演示决策.md"
  - "说明-DataFoundry-Agent-Harness与EnergyIQ复用边界.md"
---

# AI Analyst Harness 与 AI Slot 执行路径

## 1. 目标、适用与不适用

### 目标

在不扩建通用 Agent 平台的前提下，让 EnergyIQ 的 AI：

1. 在同一授权 Project、Scope、Snapshot 与 cutoff 内正确查数和引用 Evidence；
2. 自主判断是否直接回答、继续调查、提出假设或停止；
3. 输出用户能直接理解和用于决策的 What → Why → How → Verify；
4. 在 Overview AI Slot 与 Full AI Analyst 中保持同一可信原则；
5. 用可重复 Eval 证明质量、稳定性和多轮连续性，而不是用一次演示判断完成。

固定优先级：

> 效果正确 > 调查稳定 > 多轮连续 > Cache 命中 > Token 成本

### 适用

- #30 AI Analyst Harness Eval 与客户问题集；
- #36 DeepSeek Context Budget、Cache 与轻量 Run Checkpoint；
- #9/#18/#35 中的 Ngee Ann、Preschool AI Slot；
- #15 Full Analyst 受控图表与异步 Run 的后续验收；
- #21 最终产品验收前的 AI 质量证据。

### 不适用

- 不修改确定性 Overview KPI、公式、Snapshot 或 Evidence；
- 不建设通用 Context、Memory、Prompt Optimizer、Scheduler 或 Provider Router；
- 不以固定 SQL、推理轮次、时间或 Token 上限代替 Agent 判断；
- 不在侧边分支直接修改主 Agent 尚未提交的 Overview/AI Slot 文件；
- 不用 Provider 连通性或单次成功冒充产品验收。

## 2. 三方职责

| 层 | 负责 | 不负责 |
| --- | --- | --- |
| Agent | 理解问题、选择工具、决定调查深度、形成 Finding、判断何时停止 | 授权自己、改写权威 KPI、伪造 Evidence |
| System | 授权、Project/Scope/Snapshot pin、只读 SQL、Evidence/Artifact 校验、结果持久化 | 替 Agent 规定固定调查路线或必须查几条 SQL |
| Harness | 验证正确性、安全、Evidence、连续性；记录效率和质量差异 | 用效率指标限制正确调查，或用关键词分数代替人工价值判断 |

Overview AI Slot 与 Full AI Analyst 均遵守以上职责。项目 Analysis Pack 可以不同，但不应形成两套可信原则。

## 3. 当前事实基线

### 已完成或基本完成

- #30 已有 10 个 Fast cases、真实 AG-UI Runner、确定性正确性/Evidence/Chart 校验和 Candidate-versus-Baseline 报告。
- #34 已完成 Agent/System/Harness 职责校准，并证明 10-case 实际结果可达到 10/10。
- #36 独立分支已完成 1M/32K DeepSeek budget、Context checkpoint、Cache telemetry 和固定三轮 same-session probe。
- #33 的晚绑定 SQL Claim Value 已作为 Integration commit `26d2fd1` 合入。
- Ngee Ann/Preschool AI Slot 已有异步状态、Finding Evidence、Ask AI deeper、Saved result 恢复和可选 Presentation Blocks 第一版。

### 真实剩余问题

1. #36/Harness 已合入 Integration；Ngee Ann 固定 Snapshot 的真实 DeepSeek pass@3 已完成，Preschool 连续追问仍需真实登录环境。
2. #30 当前 `insightQuality` 主要依赖关键词命中，不能充分判断逻辑、可读性和决策价值。
3. Ngee Ann AI Slot 仍强制“一次成功 SQL + 恰好三条 Finding”；Preschool 仍要求固定 2–4 SQL 调查路线，与 #34 原则冲突。
4. #35 Presentation Blocks 已补服务端 materialization、Block 级 Evidence 绑定与无障碍语义；仍需两项目真实 Provider 和 1440/1920/tablet 验收。
5. GitHub Issue 正文勾选状态滞后，必须用 commit、测试、Provider 和 Chrome 证据校准，不能仅看 checkbox。

## 4. 执行任务板

| 顺序 | 任务 | Owner | 状态 | 完成证据 |
| ---: | --- | --- | --- | --- |
| 1 | 将 #36/Harness 独立提交合入最新 Integration | 本侧边任务 | completed | Integration `7edd177`；7 files / 32 tests；build passed |
| 2 | 运行 #36 DeepSeek critical pass@3 + 固定三轮 same-session | 本侧边任务 | Ngee Ann pass@3 completed；Preschool real-auth blocked | Ngee Ann 3/3；Preschool CLI 被真实登录 401 阻止 |
| 3 | 将 #30 质量评分升级为结构化 Rubric，并保留确定性 hard gates | 本侧边任务 | implemented；real Candidate comparison pending | `7fb6977`；报告新增八维质量分解 |
| 4 | 增加重复调查与回答冗长的诊断遥测，不设效率硬门槛 | 本侧边任务 | completed | `7fb6977`；真实 pass@3 无重复 SQL，平均 701 词 |
| 5 | 校准 Ngee Ann/Preschool AI Slot 的固定 SQL/强制 Finding 路线 | 主 Agent | in progress after #35 checkpoint | 0–3 Findings；Agent 自主调查；Evidence guard 不弱化 |
| 6 | 补齐 Ngee Ann 的 acted/ignored/verify 决策后果 | 主 Agent | planned | 两项目共享 Finding 语义；项目 Pack 保持独立 |
| 7 | 完成 #35 Provider 与 Presentation browser acceptance | 主 Agent + 本侧边复核 | contract implemented；runtime acceptance pending | 两项目各有 useful visual 和正确 no-visual 案例 |
| 8 | 校准并关闭已完成 Ticket | 主 Agent | partial；#33 closed | #30/#36/#18/#35 继续按证据关闭 |
| 9 | #15 完整受控图表注册表 | 后续 | deferred | 仅在 Full Analyst 试点明确需要时推进 |
| 10 | #21 Charles/试点验收 | 用户/Charles | blocked by prior tasks | 人工确认信息价值、可读性、深度和行动价值 |

## 5. #30 最小质量 Eval 切片

### 5.1 保留的硬门槛

- 数字、单位、Period、Project、Scope、Snapshot 正确；
- Finding-specific Evidence 与 Chart data 能回到真实工具结果；
- 只读、无跨 Project/Workspace/Snapshot；
- 不泄露内部错误或协议字段；
- 不把假设写成已证明原因；
- Provider/Tool 失败时诚实失败，不伪造结果。

### 5.2 新增的软质量维度

每个 Insight case 独立记录，不用一个关键词总分掩盖弱项：

1. **Takeaway**：是否明确回答发生了什么；
2. **Evidence use**：是否用具体数字/范围支撑，而非只说“数据表明”；
3. **Decision relevance**：是否说明为什么值得关注；
4. **Action**：是否给出可执行的下一步，而非复述 Finding；
5. **Verification**：是否说明看什么结果来支持或推翻判断；
6. **Causal discipline**：是否区分事实、假设与 Missing Evidence；
7. **Readability**：是否先给结论、避免内部术语和不必要长文；
8. **Consequence**：当问题要求时，是否说明行动或不行动的可能后果。

确定性可判定项继续由代码判；主观价值作为 diagnostic rubric，后续可加入可选 LLM judge 和人工抽查，但不能覆盖 hard gate。

### 5.3 效率诊断

- SQL、Reasoning、latency、Token、Cache 和 Context 水位；
- 规范化 SQL 完全重复次数；
- Tool failure 是否恢复；
- 多轮是否复用同一 Evidence，还是无必要地重跑调查；
- 回答字数与首段长度，仅作为可读性诊断；
- 柔性停止原则：继续查询不会改变结论、行动或不确定性时，Agent 可以结束。

## 6. AI Slot 最小校准

### 6.1 Prompt/结果合同

- 返回 0–3 条最有价值 Finding；证据不足时允许 0 条；
- 不强制一条 Finding 对应一个 Horizon，也不强制覆盖全部 1d/7d/28d；
- 不规定固定成功 SQL 数或固定 observation/drill-down/validation 状态机；
- Agent 只引用实际使用的 Horizon、Discovery item 和 SQL Evidence；
- Ngee Ann 与 Preschool 共享 What/Why/Action/Expected/If ignored/Verify/Limitation 语义；
- Presentation 是可选表达，不要求每条 Finding 画图。

### 6.2 必须保留的安全边界

- 同 Workspace/Project/Scope/resource/Snapshot/cutoff；
- scoped read-only SQL；
- Finding-specific numeric Evidence；
- 权威 KPI 不被 AI 修改或冒充；
- unsupported cause、saving、ROI、owner、threshold 保持 Hypothesis/Missing Evidence 或拒绝；
- 刷新恢复已完成结果，相同 Context 不重复启动 Run；
- Ask AI deeper 复用 Session/Project/Finding/Evidence。

### 6.3 Provider 验收

Ngee Ann 与 Preschool 各运行至少三次固定 Profile/Snapshot：

- available/empty/fail-closed 状态正确；
- 非空 Finding 有实际决策价值且不重复 Overview；
- 所有数字与 Presentation 回到 Finding-specific Evidence；
- Agent 自主选择有用 visual，且至少一次正确选择 no visual；
- 记录 latency、SQL、recovery、Token/Cache，不把效率设为质量门槛；
- 人工检查 plain language、图文协同和行动后果。

## 7. 验收与关闭顺序

1. [x] #36/Harness commits 合入并通过自动回归；
2. [x] #36 Ngee Ann real pass@3；Preschool same-session 保留为真实登录环境验收；
3. [x] #30 结构化质量 Rubric 与报告回归；
4. [ ] AI Slot 固定路线校准后跑两项目 Provider；
5. [ ] #35 真实 visual/no-visual 与浏览器验收；
6. [ ] #20 History keyboard/1440/1920 验收；
7. [x] 关闭已合入的 #33（`26d2fd1`；专项回归 4 files / 53 tests）；
8. [ ] 校准 #30/#36/#18/#35 正文或评论；
9. [ ] 最后进入 #21 Charles/试点验收。

自动测试、真实 Provider、Chrome 和 Charles 人工验收必须分层记录，不互相替代。

## 8. 失败模式

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| 关键词分数高但答案没价值 | Rubric 只检查词语，没有检查逻辑与决策链 | 输出分维度结果；增加人工/可选 judge，不改 hard gate |
| Agent 重复查询或运行很慢 | Tool feedback 不清楚、上下文重复、模型不确定是否可结束 | 先用 #36/#30 遥测定位；改反馈与柔性停止提示，不设硬 SQL 上限 |
| AI Slot 经常 unavailable | 严格 JSON、固定 SQL 次数或强制三条 Finding 造成机械失败 | 放宽路线和数量，保留 Evidence/安全校验 |
| 图表数字校验失败 | 模型重复抄写数据或 Block 未绑定具体 Evidence | 服务端 materialize；Block 绑定 Evidence；Finding prose 仍可降级展示 |
| 多轮追问重新调查 | Session/Evidence 没恢复或模型不知道可复用 | 检查 checkpoint、thread、Snapshot；Harness 比较各轮 SQL/Evidence |
| 合并冲突 | 侧边分支修改主 Agent 的未提交 AI Slot 文件 | 等主 Agent 提交后再 rebase/cherry-pick；当前仅做 Harness 独立文件 |

## 9. 明确停止项

- 不创建新的 Context/Memory/Evidence/Artifact 平台；
- 不增加三路线意图分类器或固定分析状态机；
- 不用 SQL/轮次/延迟/Token 作为答案质量硬上限；
- 不为了 Cache 改变语义顺序或删除必要 Evidence；
- 不要求每个 Finding 有图，也不让浏览器执行模型生成代码；
- 不因 AI 失败阻塞确定性 Overview；
- 不在 Provider 真实证据前宣称 #30/#36/#18/#35 完成。

## 10. 维护规则

- 每完成一个切片，更新任务板状态和“完成证据”，不新增竞争文档；
- GitHub Issue 记录正式 AC/关闭状态，本文件记录跨 Ticket 顺序与依赖；
- 代码完成、自动测试、Provider、Chrome、Charles 验收分别标记；
- 发生新问题：范围内写入对应任务；超出范围写入失败模式或 deferred，不立即扩大实现；
- 文档更新必须引用实际 commit/report，不凭聊天记忆宣布完成。

## 11. 2026-08-08 当前执行记录

### #36 已完成代码提交与 Integration 合入

按顺序：

1. `0391b2e`：校准官方 DeepSeek V4 Flash 1M/32K Context budget；
2. `91ebb3d`：暴露 Context checkpoint telemetry；
3. `7febf78`：记录 Provider Cache telemetry；
4. `4866dd4`：在 Eval 报告每步 Context 构成；
5. `2dc959f`：加入固定三轮 same-session continuity；
6. `27df662`：修复预算一致性、Token 去重和 checkpoint 计数。

以上提交及后续 #30/稳定性/表达切片已按顺序进入 Integration `7edd177`。合入后聚焦回归
7 files / 32 tests 与根 build 通过；主 Agent 的未提交 Overview/Presentation 文件未被 stage、commit 或覆盖。

### #30 质量诊断切片

提交：`7fb6977 feat(eval): expose decision quality diagnostics`

新增：

- Takeaway、Evidence use、Decision relevance、Action、Verification、Causal discipline、Readability、Consequence 八维分解；
- 回答总字数、首两句字数；
- 规范化 SQL 的完全重复计数；
- Suite summary、Markdown 和 Candidate-versus-Baseline delta；
- 旧 Baseline 缺少新字段时返回 `null` delta，不产生伪造数值；
- 以上均为质量/效率诊断，没有增加 SQL、轮次、时间或 Token hard gate。

自动证据：

- Harness/Context 聚焦回归：5 files / 28 tests passed；
- 根 `npm run build` passed；
- Mastra stream normalizer contract passed；
- Eval script syntax 与 `git diff --check` passed。

限制：当前八维自动分解仍是透明的规则型 diagnostic，不等于人类价值判断。真实 Candidate/Baseline、可选 LLM judge 与 Charles 抽查仍待后续证据。

### Ticket 维护

- #30 进度证据：<https://github.com/Zion74/energyiq-datafoundry/issues/30#issuecomment-5219684498>
- #36 最新合入交接：<https://github.com/Zion74/energyiq-datafoundry/issues/36#issuecomment-5219684718>
- #33 已验证并关闭：<https://github.com/Zion74/energyiq-datafoundry/issues/33#issuecomment-5219684918>

### Ngee Ann 真实 DeepSeek 验收与修复

验收使用隔离 Metadata/File storage、受保护的 Ngee Ann 事实库和固定 Snapshot
`energy-snapshot-03499dcda183ae28c47f7d66`。没有停止当前 Integration 服务，也没有修改共享事实或登录状态。

第一次有效 pass@3 为 2/3。第三次并非模型结论错误，而是 Context Processor 在 SQL 工具返回
`undefined` observation 时对非字符串调用 `.slice()`，导致 Harness 自身崩溃。已用可复现红测锁定并修复：

- `9c14107 fix(agent): tolerate missing SQL observations`；
- 精确回归 3/3、相关 Context 回归 4/4、根 build 均通过；
- 修复后相同 Ngee Ann case 的真实 DeepSeek pass@3 为 3/3，hard failure 0。

修复后 pass@3 摘要：

| 指标 | 结果 |
| --- | ---: |
| Correctness / Insight | 1.00 / 10.00 |
| p50 / p95 | 139.5s / 206.2s |
| 平均 SQL / Reasoning rounds | 14.33 / 9.33 |
| 完全重复 SQL | 0 |
| Tool failure / recovered | 1 / 1 |
| Max prompt / budget utilization | 67,630 / 5.09% |
| Cache hit tokens / ratio | 653,568 / 1.00 |
| 平均 Decision Quality / Answer words | 0.75 / 701.3 |

结论：1M Context budget 不是当前性能瓶颈；DuckDB 也不是本次 139–206 秒的主要原因。
耗时主要来自模型自主选择了 9.33 个推理轮次和 14.33 条 SQL。因为没有重复 SQL且失败能恢复，
不应增加固定 SQL/轮次硬上限。当前应优化工具反馈、停止判断和最终表达，而不是限制调查能力。

### 决策简报最小优化

提交 `e8d5a16 feat(agent): default EnergyIQ answers to decision briefs` 只调整最终表达合同：默认把单一决策问题
组织为不超过五个短要点的简报，保留一个 takeaway、最多三个决定性 Evidence、一个行动和一个验证；
这不是分析或工具预算，不阻止 Agent 在需要时继续调查。

三次真实 Provider 单次试验均通过 correctness 1.00 / Insight 10：

- 96.4s、9 SQL、6 rounds、366 words；
- 119.8s、13 SQL、10 rounds、498 words；
- 最终文案：86.7s、9 SQL、6 rounds、359 words。

它已把 3-run 平均 701 词显著压短，但 DeepSeek 仍可能超过 300 词目标。今晚不增加第二个总结模型或
通用 Prompt 平台；AI Slot 的卡片级裁剪继续由 Presentation/renderer 负责。

提交 `5b094ff feat(agent): clarify autonomous stopping judgment` 补齐柔性停止原则：当新增查询不会改变
结论、下一步行动或实质不确定性时，Agent 可以结束调查。这一原则明确不是固定 query/step limit，
不会替 Agent 选择路线。聚焦回归 5 files / 9 tests 与根 build 通过。相同隔离 Snapshot 的真实
DeepSeek 单次复核也通过：correctness 1.00、Insight 10、decision quality 0.8125、323 words、
107.3s、13 SQL、9 reasoning rounds、重复 SQL 0、max budget utilization 3.38%。因此没有观察到
柔性停止导致的过早回答或质量下降。

### Preschool same-session 的诚实边界

对当前 `127.0.0.1:8787` 运行 fixed three-turn continuity 时，CLI 在进入模型前收到 `401 Authentication required`。
当前 API 使用真实浏览器 Session，并同时持有项目 DuckDB；不应停服务、复制登录凭据或切换 dev-auth 来制造通过。
因此当前证据边界是：same-session 自动契约测试已通过，但 Preschool 真实 Provider 连续会话仍需在已登录 UI 或
经正式测试账号/Token 的隔离实例完成。该 401 不是 DeepSeek、SQL 或结果质量失败。

### AI Slot 固定路线复核

最新 Integration 的未提交 AI Slot 仍存在两类限制：

- Ngee Ann：最多两次 SQL、第一次成功立即停止、必须恰好三条 Finding、强制覆盖 1d/7d/28d；
- Preschool：固定 observation → drill-down → validation，并要求每条 Finding 至少引用两条 SQL。

这些规则超出了安全/Evidence 边界，确实会限制 Agent 自主调查。但相关文件正包含主 Agent 的 Presentation WIP，
侧边分支不直接改动，避免覆盖或制造难解冲突。安全切片应在该 WIP 提交后单独完成：保留 inspect-first、只读、
Snapshot pin、数字 Evidence 与 fail-closed；删除固定调查状态机、成功 SQL 数和“恰好三条”要求，允许 0–3 条有价值 Finding。

### #35 Presentation Blocks 可信闭环

当前实现采用一个小型、版本化的共享 Presentation contract，不引入可执行模型代码或通用页面 DSL。模型只能在
metric、comparison、ranking、share、distribution、trend、heatmap、table 与 callout 这组安全 Block 中自主选用；
图表是可选表达，系统不设置图表配额。

本切片补齐：

- 定量 Block 必须携带属于当前 Finding 的 `evidenceRefs` 或 `evidenceSqlIndexes`；
- API 在保存和恢复前重新 parse、过滤和 materialize，不能持久化任意 HTML、脚本或未引用数字；
- 每个 Block 只用它自己绑定的 Evidence 校验数字，单个无效 Block 局部降级，不隐藏整个 Finding；
- Saved Analysis/Resume 读取同一份净化后的 Presentation Artifact，不触发新模型运行；
- trend、heatmap 与 table 提供非颜色依赖的辅助技术语义；
- Ngee Ann 与 Preschool 复用同一 contract 和 prompt 片段，项目分析逻辑仍保持独立。

自动证据：共享 contracts build、根 typecheck、Presentation/两项目 AI Slot/Saved Analysis 聚焦回归
7 files / 107 tests passed，`git diff --check` passed。该证据只证明代码合同和回归；真实 Provider 是否自主选择
有用 visual 或正确 no-visual、以及 1440/1920/tablet 的人工阅读效果，仍作为 #35 未完成的运行时验收。
