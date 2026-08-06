---
title: "Preschool Overview Interaction Matrix"
summary: "记录 Preschool Overview 对 Charles 报告模块的保留、适配与主动删除，以及数据所有权、Evidence、降级和浏览器验收边界。"
doc_type: implementation_record
tags: [Overview, Preschool, Interaction, Evidence, Chrome]
updated_at: "2026-08-06"
related:
  - "2026-08-05-Ngee-Ann-Overview-Interaction-Matrix.md"
  - "2026-08-05-Overview用户价值与AI-Slot最小交付决策.md"
  - "决策-Preschool-Portfolio数据集接入.md"
status: provisional
---

# Preschool Overview Interaction Matrix

## 1. 用途与边界

本矩阵落实 GitHub Issues `#10`、`#11`、`#12`、`#13` 和 `#18` 的 Preschool 页面合同。它不是新的通用 Renderer、Dashboard DSL、Forecast 平台或 Evidence 平台。

- 页面统一使用 Published Project Release、Hierarchy、Mapping、Calendar、Snapshot、Period 和 timezone。
- Deterministic Projection 是 KPI、Benchmark、Spike、Ranking 和 Evidence 的权威来源；React 只组织与显示。
- AI Slot 是可选增强层。模型失败不得阻塞确定性 Overview，也不得改写确定性数值。
- 全局 Period 选择器不恢复。Preschool 首版固定使用已发布的完整 May 2026 Portfolio Snapshot。
- Charles 静态报告是需求与表达参考，不是事实源；Mock、未发布或推断内容必须适配、降级或删除。

## 2. 保留、适配与删除矩阵

| 模块 / 交互 | 处理 | 决策问题与结果 | 权威数据 / 状态所有者 | Evidence | Partial / Unavailable | 浏览器验收 |
| --- | --- | --- | --- | --- | --- | --- |
| Portfolio 总览 | 保留并适配 | 当前总量、日均、覆盖率、Centre 数、Standby 占比与成本可用性 | Project Analysis Snapshot；服务端 KPI | Snapshot、Release、Period、coverage | Tariff 未发布时 Cost 为 `Unavailable`；不以零代替 | 1440/1920 首屏、无横向溢出 |
| Key findings & top actions | 保留并适配 | 显示 0–3 项真正有决策价值的主题，逐项回答 Finding、Why、Action、做与不做的预期后果、Verify | 服务端 Benchmark/Operational Projection 组装结果 | 点击后展开并聚焦同一 Snapshot Evidence | 子 Projection 不可用时撤下相关结论，不伪造替代 Finding 或机械凑满三项 | 键盘可达；Evidence 一击可见 |
| AI energy analyst | 保留为可选增强 | 通过观察、下钻和验证/反证发现额外 Evidence-backed 调查角度，而不是复述当前图表 | 当前用户授权的只读 Agent Run | Finding-specific SQL / tool evidence；允许有界 Top-N/多行结果 | Thinking、Available、Unavailable 均不阻塞确定性页面；证据不足时允许 0 条 | 状态可见；无 silent fallback |
| EUI × Per-pax 四象限 | 保留并适配 | 识别同时高于 Portfolio P75 的 Priority Centres | Published Benchmark Projection | `preschool-eui-benchmark-v1`、`preschool-per-pax-benchmark-v1`、`preschool-quadrant-v1` | Area/Headcount 为 Provisional 时明确标记，不下正式效率结论 | 30 点、P75 轴、G/M/J、颜色＋形状＋文字 Legend |
| Peer benchmark distributions | 新增适配 | 用户看懂“与同类型谁比较、位于 cohort P50/P75 哪一侧” | 服务端三 cohort 的 Centre 点、P50、P75、n | 同一 Benchmark recipes 与 Snapshot pins | 不在浏览器重算 percentile；缺失 Projection 时局部 Unavailable | 1440 单列、1920 双列；2 metrics × 3 cohort lanes |
| Standby / Operating split | 保留并适配 | 区分关闭时段与营业时段能源及异常事件 | Published Calendar + Preschool Operational Projection | Calendar version、hour-slot recipe、Snapshot | Calendar 或 facts 不可用时整个 Operational 模块诚实 Unavailable | Golden 数值、Centre type、无横向溢出 |
| Spike / SOP signal | 保留并降级表述 | 显示同 Centre、同 hour-slot 基线偏差及调查优先级 | 服务端 `>50%` Spike 与 provisional SOP projection | 日期、小时、Day Type、usage、baseline、variance、Leading Circuit | Spike 不是浪费结论；SOP score 不是正式 Compliance | Standby/Operating/Centre Type/Day Type 可读 |
| Appliance Ranking | 保留并项目化适配 | 用 9 个客户可读 Appliance 标签回答 Portfolio 能源主要流向；底层实体仍是 Circuit | 服务端 `preschool-appliance-ranking-v1` Projection；项目专属 published alias contract | Snapshot、Release、Hierarchy、Mapping、source query、raw Circuit IDs | 9 标签/30 Centres/official total 任一不满足时局部 Unavailable；不按字符串猜测 | 9 条横向排名可读、总量对账、Evidence 披露 Circuit 来源 |
| Centre ranking | 新增适配 | 展示 Portfolio contribution、Share、Cohort、EUI、Per-pax、Quadrant、Leading Appliance | 服务端排序与 Benchmark Projection | Snapshot、Benchmark recipes、published metadata；原始 Circuit 在 Evidence | Normalisation 缺失时单元格 Unavailable / Provisional | 30 行可达；表头与横向阅读可用 |
| Forecast | 主动纠正 | 只显示 readiness 与限制，不展示未发布预测值 | Published Forecast Recipe（当前不存在） | 当前 Snapshot/Release 中无 Forecast recipe | Demo 为 `Reference demo only — not published`；Live 为 `Unavailable` | 不出现 Mock June actual、cost 或虚假精度 |
| Snapshot & Evidence | 保留并适配 | 让 FM 查看 Period、Snapshot、Release、Query 和 Recipe IDs | 服务器返回的 Evidence pins | 折叠区；决策卡一键展开并聚焦 | 缺少引用时显示 `Unavailable`，不编造 ID | 鼠标与键盘均可进入；焦点可见 |

## 3. 明确停止项

- 不恢复 Charles 报告里的 Mock June Forecast、模拟 actual、未发布 cost。
- 不将电表事件推断成现场 Main cause，也不把 Leading Circuit 写成已确认根因。
- 不把 `100 - Spike count` 称为正式 SOP Compliance。
- 不新增 Bell Curve、浏览器端 mean/std/percentile、通用 Benchmark 平台。
- 不在 React 汇总 Appliance Ranking，不新增第二套 SQL/统计栈；只从当前权威分析结果形成项目专属服务端 Projection。
- 不把 `preschool-demo` 的 Circuit-as-Appliance 别名合同推广到缺少等价 Published Mapping 的真实项目。
- 不以自动化、截图或 Provider 工具调用替代 Charles 的信息价值与行动价值验收。

## 4. 当前工程证据与剩余门槛

当前新版页面的 Chrome 证据位于 `.scratch/overview-acceptance/`：

- `preschool-current-1440-top.png`
- `preschool-current-1440-benchmark.png`
- `preschool-current-1440-distributions.png`
- `preschool-current-1920-top.png`
- `preschool-current-1920-benchmark.png`
- `preschool-current-1920-distributions.png`
- `preschool-current-1440-operating.png`
- `preschool-current-1920-operating.png`
- `preschool-current-1440-evidence.png`
- `preschool-current-1920-evidence.png`

最新自动化和真实 Chrome 已确认 Day Type、Centre Type、Evidence 一击展开、1440 单列/1920 双列、无横向溢出及零 Console error。`#12` 的服务端 Appliance Ranking、客户侧别名、数值对账和宽屏验收已完成。Preschool 当前只剩：

1. `#13` 按 Charles 的信息价值、分析深度、可读性、图文配合和行动后果标准完成工程改造与最终人工验收；
2. `#18` 在不阻塞确定性页面的前提下，把 AI Slot 从单次聚合响应升级为有界的多步调查。
