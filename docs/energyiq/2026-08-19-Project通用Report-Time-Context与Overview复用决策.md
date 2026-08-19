---
title: "Project 通用 Report Time Context 与 Overview 复用决策"
summary: "平台统一时间窗口、身份与变化治理，Project Profile 只组合已注册策略并保留自己的 Section 业务语义。"
doc_type: decision
tags: [Overview, ReportTimeContext, ProjectProfile, 时间语义, 平台复用]
updated_at: "2026-08-19"
related:
  - "CONTEXT.md"
  - "决策-项目Renderer-Recipe与时间上下文.md"
  - "2026-08-06-Charles系统价值复核与连续数据演示决策.md"
status: accepted
---

# Project 通用 Report Time Context 与 Overview 复用决策

## 1. 背景

Ngee Ann 需要自然月至今、最近完整日、完整历史月、同进度比较、Holiday 和下月预测；Preschool 需要最近 28 个完整日，同时 Monthly Outlook 又必须按自然月。它们证明了两件事：

1. 所有 Project 强制一个全页日期范围会损害业务意义；
2. 每个 Project 自己写日期算法，会让 Web、Saved、AI Artifact 和 What changed 的口径持续分裂。

EnergyIQ 当前采用“定制化服务通用化”：先在真实 Project 中验证管理问题，再把稳定机制沉淀为平台能力。需要统一的是运行合同，不是每个项目的分析内容。

## 2. 选项

| 选项 | 做法 | 优点 | 缺点 |
| --- | --- | --- | --- |
| A. 全平台唯一日期范围 | 一个 `from/to` 控制所有 Overview Sections | 实现简单 | 运营、月度趋势、预测和异常基线被迫使用错误窗口 |
| B. 每项目自由实现 | 每个 Renderer/Web 自己计算时间 | 定制快 | projectId 分支、历史恢复和 AI identity 无法治理 |
| C. 任意日期表达式平台 | Project 上传表达式或代码 | 表面灵活 | 形成低代码日期引擎，难验证、难迁移、难解释 |
| D. 可信锚点 + 版本化命名窗口 | 平台解析窗口，Project Profile 只引用已注册策略 | 同时保留业务意义、可复跑和跨项目复用 | 需要一次合同迁移 |

## 3. 决定

**选择 D：平台级 `Report Time Context` + 版本化 `Project Overview Profile`。**

Overview 顶部只有一个可信锚点：`Data through`、`Last refreshed`、Timezone 和 Data Snapshot。各 Section 可以使用不同的 named windows，但必须显示用途、精确范围和 `Complete / Partial / Forecast` 状态。

普通用户不在 Overview 任意切换日期。任意区间、粒度和比较属于 Explorer；基于可信数据域的深入问题属于 AI Analysis；历史精确结果属于 Saved Analysis；前后变化由 What changed 表达。

## 4. 平台与 Project 的责任

| 平台统一拥有 | Project 保留定制 |
| --- | --- |
| Report Time Context 解析与版本 | Section 的管理问题和业务含义 |
| 注册的时间策略目录 | 指标、事实投影与 Section Pack |
| Data Snapshot/Release/Profile/Policy identity | 图表与 Renderer placement |
| Business Calendar readiness | AI angle、Method/SOP 组合 |
| Saved/AI Artifact 精确恢复 | 项目特有的限制与解释 |
| What changed compatibility | 对平台策略的新需求输入 |
| 普通读取零 Provider | 人工价值审核 |

Project 不能提供任意日期函数。它只能发布 Profile，选择平台已注册的 strategy，并把自己的 Section 绑定到 window roles。

## 5. 深模块接口

公共 seam 保持小而深：

```ts
resolveReportTimeContext({
  binding,
  timezone,
  asOf,
  acceptedDataEndExclusive,
  lastRefreshedAt,
  policy
}): ReportTimeContext
```

调用方无需知道月界线、完整日、DST、历史同进度或 Forecast horizon 怎么计算。输出包含：

- exact Workspace/Project/Scope/Snapshot/Release binding；
- policy id/revision；
- `dataThroughLocalDate`；
- named windows 的 role、strategy、`from/toExclusive`、segments、phase、complete-day count；
- 用于 What changed 的 comparison compatibility key。

Section 侧只消费：

```text
Section Time Binding
→ primaryWindowId
→ supportingWindowIds[]
→ 每条 Fact/Evidence 记录实际 windowId
```

## 6. 首批平台策略

| Strategy | 典型用途 |
| --- | --- |
| `rolling_complete_days(n)` | 最近运营表现 |
| `calendar_month_to_date` | 本月截至数据日 |
| `completed_calendar_months(n)` | 完整月份趋势 |
| `prior_equivalent_progress(n)` | 历史月份相同进度 |
| `next_complete_calendar_month` | 下一个完整自然月预测 |
| `same_day_type_baseline(n)` | Workday/Weekend/Holiday 异常基线 |

这些是平台算法，不是 Ngee Ann 常量。Ngee Ann 与 Preschool 分别通过 Profile 选择不同组合。

## 7. 定制能力如何晋升为平台能力

```text
真实 Project 管理问题
→ Project Adapter/Profile 中受控验证
→ 第二个场景证明可复用
→ 提交平台 Strategy/Capability Proposal
→ 自动合同测试 + 人工批准
→ 发布不可变 Revision
→ 其他 Project 通过配置引用
```

晋升判断看五点：

1. 输入和输出能否用 Project 无关术语表达；
2. 是否已有第二个真实使用场景；
3. 能否由服务端确定性验证；
4. 是否能进入 Saved/AI/What changed identity；
5. 删除公共模块后，复杂度是否会重新散落到多个项目。

不能满足时，能力继续留在 Project Adapter。平台不为了“看起来通用”而吸收项目专属指标或固定 Sections。

## 8. 具体项目映射

### Ngee Ann

- Current month progress：自然月至 dataThrough；
- Recent operations：最近 28 个完整日；
- Completed month trend：最近 3 个完整自然月；
- Same-progress comparison：历史月份相同进度；
- Forecast：下一个完整自然月；
- Day-type reference：Workday / Weekend / Public holiday。

### Preschool

- Current Overview：保留最近 28 个完整日；
- Monthly Outlook：继续使用自然月计划、实际和展望；
- Benchmark/operational Sections：按自己的管理问题绑定平台窗口，不复制 Ngee Ann Sections。

## 9. Holiday 状态

Business Calendar 是平台能力。任何 Project 都必须区分：

1. `calendar_not_configured`：没有发布 Calendar；
2. `sample_unavailable`：Calendar 已配置，但当前 Evidence 窗口没有完整 Holiday sample；
3. `available`：Holiday profile 可用，并显示 sample count 与限制。

不得把后两种状态都写成“Holiday 未配置”。

## 10. 后果与失效条件

### 正面后果

- 新项目接入不再修改 Web 日期代码；
- AI/Saved/What changed 可以解释每条结论使用了哪个窗口；
- Excel 和 API 持续进数共享同一 Snapshot → Time Context → Overview 流程；
- 新定制可通过 Profile 快速验证，稳定后再提升为平台 revision。

### 代价

- 现有 Ngee Ann/Preschool period 逻辑需要迁移；
- Artifact identity 必须纳入 Policy/Profile revision；
- UI 需要在 Section 级显示时间标签，不能只显示一个含糊全页日期。

### 失效条件

出现以下信号时复审本决策：

- 大量 Project 需要平台策略目录无法表达的实时/事件窗口；
- Overview 的核心任务从管理报告转成自由探索；
- 同一 Section 的窗口组合无法通过静态 Profile 表达；
- 第二种真正独立的 Calendar/Forecast 实现出现，需要形成新的 Adapter seam。

## 11. 执行入口

- Map：GitHub #75
- Contract/resolver：#79
- Project Overview Profile：#80
- Ngee Ann/Preschool migration：#81
- Saved/AI/What changed provenance：#82
- 持续 API 数据复跑：#83

