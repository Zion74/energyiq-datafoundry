---
title: "Ngee Ann 自然月 Managed Overview 夜间执行路线与 Runlog"
summary: "把 Charles 的自然月、持续更新、What Changed 和论点驱动反馈落实为可测试、可复跑、可发布的交付路径。"
doc_type: playbook
tags: [NgeeAnn, ManagedOverview, ReportEdition, AtoB, WhatChanged, NightRun]
updated_at: "2026-08-20"
related:
  - "2026-08-19-Project通用Report-Time-Context与Overview复用决策.md"
  - "2026-08-06-Charles系统价值复核与连续数据演示决策.md"
status: in-progress
---

# Ngee Ann 自然月 Managed Overview 夜间执行路线与 Runlog

## 1. 今晚要交付的产品结果

同一套已发布 Overview Definition 能在持续到达的数据上反复运行：

1. 默认展示最新自然月 Report Edition；当月为 MTD，历史月为完整月；
2. 每天可重算数字、图表、状态和 AI Artifact，不重做静态 HTML 或 Template；
3. 页面先表达 1–3 个管理论点，再用图表、Evidence 和行动建议论证；
4. What Changed 保守展示 retained / updated / new / removed，并区分数据变化与 Template 变化；
5. 四份现有 Ngee Ann Excel 能形成可追溯的多批次数据与 A/B/C 连续验收；
6. 本地自动门、真实浏览器、真实 Provider、多账户和生产部署分别留证，不互相代替。

## 2. 术语纠正

本任务允许“重跑”，但必须说清重跑什么：

| 动作 | 可以每天发生 | 是否改变 Template Revision | 结果 |
| --- | --- | --- | --- |
| Overview Materialization Refresh | 是 | 否 | 在新 Snapshot 上重算确定性数据和图表 |
| Insight Refresh | 是 | 否 | 在新 Snapshot 上生成精确绑定的 AI Artifact |
| Template Regeneration | 否，只有设计变更时 | 是 | 改 Section、能力、公式引用或视觉组织并重新发布 |

Token 成本不是今晚阻止 AI 每天运行的理由。真正的产品门是：新 AI 是否提供有价值的新角度；是否只换了措辞；是否错误复用旧 Artifact；是否导致 What Changed 噪声。

## 3. 产品选项与决定

| 选项 | 做法 | 结论 |
| --- | --- | --- |
| A. 每次数据更新重新生成静态 Overview | AI 重新写 HTML/页面 | 拒绝；不可稳定复跑和治理 |
| B. 所有内容强制同一时间范围 | 全页自然月或全页最近 28 天 | 拒绝；预测、运营和趋势语义冲突 |
| C. Overview 变成任意日期 BI 编辑器 | 用户自由改所有窗口 | 拒绝；破坏稳定报告口径 |
| D. 自然月 Report Edition + Section 命名窗口 | 同一 Definition 持续物化，探索另放 Interactive Analysis | 采用 |

## 4. 今晚任务路径

### M0 — 决策与边界（当前）

- [x] 区分 Template Regeneration、Materialization Refresh、Insight Refresh；
- [x] 固定自然月 Report Edition 与 Section named windows；
- [x] 把旧的“全页单一 Period”共识标记为被 Managed Overview 决策替代；
- [x] 将下列验收边界同步到 GitHub #81、#9、#83、#56。

### M1 — #81 Report Time Context 收口

- [ ] 通过 public `resolveProjectAnalysis` seam 增加完整历史月与同进度比较的 server-owned bounded projection；
- [ ] 当前月比较历史相同进度，完整月比较上一个完整月；不足数据时诚实 unavailable；
- [ ] Calendar/Holiday、Tariff、Data through 和 Section 窗口标签使用精确 revision；
- [ ] 发布新的 Ngee Ann Template Revision，不能改写现有 immutable v6；
- [ ] focused tests、API build、Web production build、diff-check 全绿。

### M2 — 多批次 Excel 与 A/B/C 数据基线

- [ ] 原始四份 workbook 保持不可变，各自创建 Import Batch 与 SHA；
- [ ] 以 Meter Point + timestamp 去重 5 月 19–20 日重叠；相同值合并，冲突值 fail closed；
- [ ] Level 6/7 Mapping 与 Source label 必须保持 exact，不按文件名猜测；
- [ ] A = data through 20 May，B = data through 31 May，C = data through 17 Jun；
- [ ] A 证明 4 月 partial + 5 月 MTD，B 证明 5 月封存 complete，C 证明 6 月 MTD + 5 月历史对比；
- [ ] 若生成合并 workbook，它只用于人工核对，不成为生产事实源。

### M3 — #9 论点驱动 Overview

- [ ] 页首只保留 1–3 个管理主题，回答“发生什么、为什么重要、先核查什么”；
- [ ] 每个主题使用 `Claim → Visual proof → Meaning → Next check → Evidence/limitation`；
- [ ] 图表和表格降为论据或 supporting diagnostics，不再平铺数据；
- [ ] Key Findings 不复制单个 Section Interpretation；
- [ ] 无可证实结论时显示诚实空状态，不让 AI 用套话填满卡片；
- [ ] 1440 / 1920 / tablet 浏览器核对信息层级、折行、Evidence 和可访问性。

### M4 — #83/#56 持续数据与 What Changed

- [ ] 同一 Template Revision 下新 Snapshot 可重算确定性结果和 AI；
- [ ] Artifact identity 包含 Snapshot、Release、时间窗口和生成合同，旧结果不能冒充 current；
- [ ] 变化按事实/结论语义保守分类；随机措辞、Evidence ID 或生成时间变化不算 updated；
- [ ] 记录数据变化与 Template 变化为两条不同 change axes；
- [ ] 普通读取只恢复精确已存 Artifact，零 Provider；明确 refresh/generation 才触发 Provider；
- [ ] A→B→C 验证旧结论 retained/updated/removed 与新异常/new insight。

### M5 — 发布与客户门

- [ ] Integration 运行高层 seams、focused suites、API/Web build；
- [ ] 本地浏览器核对 Ngee Ann/Preschool，不把源码推断当浏览器证据；
- [ ] 真实 Provider 只在明确 generation acceptance 中运行，记录 Run/Artifact；
- [ ] Charles admin 可见全部项目；Ngee-only user 只能看 Ngee Ann；
- [ ] 使用不可变 Release Artifact 部署，核对精确 SHA、健康、登录、数据库和回滚点；
- [ ] Charles 人工判断页面是否真正形成论点、AI 是否值得看。

## 5. 开发前必须关闭的潜在问题

| 风险 | 错误表现 | 今晚的防线 |
| --- | --- | --- |
| 当月与完整月误比 | 17 天 June 对完整 May，制造假下降 | MTD 只与历史同进度比较 |
| 月初样本太少 | 1–2 天被放大成月结论 | 标记 in_progress + 最小完整日门 |
| Excel 重叠静默覆盖 | 19–20 May 重复或冲突 | Import Batch 溯源 + exact dedupe + conflict fail closed |
| 4 月被误称完整月 | 数据从 21 Apr 才开始 | partial 状态，不进入完整月趋势 |
| AI 每天随机改写 | What Changed 每天都是“更新” | 语义/lineage 保守 diff，文本变化不单独升级 |
| AI 旧结果复用 | B 页面显示 A 的结论 | exact Snapshot/Release/Window/Contract identity |
| 每天无条件 AI 带来噪声 | Token 不贵但页面不稳定 | 允许每日运行；发布仍经过价值、去重和事实强度门 |
| Template 与数据版本混在一起 | 无法解释变化来自哪里 | Template axis 与 Report Edition/Snapshot axis 分离 |
| Holiday/Tariff 漂移 | 本地和生产口径不同 | Release-pinned revision + 部署后配置核对 |
| 页面只是图表堆叠 | 用户不知道系统想表达什么 | 管理论点优先，图表服务于 Claim |
| 深层投影膨胀 | API payload、浏览器和上下文爆炸 | server-bounded summary；深层明细按需读取 |
| 部署成功被误当产品通过 | 服务在线但内容/权限错误 | 构建、浏览器、Provider、账户、人工验收分开留证 |

## 6. Public test seams

在写实现前只通过以下可观察边界建立 RED：

1. API：`resolveProjectAnalysis` —— 时间窗口、月度 projection、Snapshot/Policy provenance；
2. Web：`buildNgeeAnnOverviewViewModel` —— Claim-first 组织、窗口标签和 unavailable 语义；
3. Renderer：公开 Ngee Ann Overview Renderer —— 真实用户看见的主题、图表、Evidence、What Changed；
4. Data ingest：现有公开 Excel import / source-to-fact seam —— Import Batch、SHA、重叠去重、冲突拒绝；
5. AI：公开 Artifact read/generate seam —— exact identity、普通 GET 零 Provider、A/B/C 不复用旧结果。

## 7. Stop conditions

- 需要改写或清理脏主目录、删除用户文件、重置其他 Agent WIP；
- 需要把四份原始 Excel 合并覆盖成唯一真相源；
- 需要新增依赖或升级 Node 版本；
- 现有高层 seam 回归且无法在本 ticket 的产品边界内解释；
- 需要猜测 Calendar、Tariff、Level Mapping 或生产凭据；
- 生产发布前自动门未绿，或无法建立可恢复的上一 Release/Storage 备份。

## 8. Runlog

### 2026-08-20 夜间启动

- Worker：`D:\Projects\energyiq-datafoundry-worker-3`
- Branch：`codex/81-multi-window-block-materialization`
- Baseline：`0d147b58d905ed050e617941a85a5b8f1fd1d148`
- 状态：clean；主目录脏改动未触碰。
- 已完成基线切片：Report Time Context、`current-month-progress`、`recent-operations`、趋势/小时/Circuit window binding 与标签一致性。
- Issue：#81、#9、#83、#56 已同步 Charles 会议后的术语、A/B/C 与验收边界。
- Docs smoke：本次新增文档没有新断链；全仓命令仍被既有 reference HTML 伪链接、历史 source-sensitive wording 与既有 evidence 绝对路径阻塞，未放宽规则或修改无关历史文件。
- 本轮第一 RED：完整历史月与同进度比较必须由 API public seam 提供，Web 不得自行从任意日期拼算。

## 9. 完成定义

夜间任务只有在以下证据分别存在时才可称为完成：

1. 决策、术语、Issue 与 Runlog 同步；
2. #81、数据导入、#9、#83/#56 各自有 RED→GREEN 与精确 commit；
3. Integration 全门通过，分支无意外脏文件；
4. 浏览器、真实 Provider、多账户、生产部署和 Charles 人工验收各自有真实证据；
5. 未完成的人类判断或缺少 July/August 数据必须明确标记 `ready-for-human`，不得用 synthetic fixture 冒充完成。
