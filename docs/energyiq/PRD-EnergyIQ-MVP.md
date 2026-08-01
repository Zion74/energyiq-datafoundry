---
title: "EnergyIQ MVP 产品需求文档"
summary: "面向客户确认与内部开发的当前 PRD，覆盖日级能源分析、动态 Tier、决策模板、可信问数与 Admin 发布闭环。"
doc_type: prd
tags: [MVP, PRD, 决策看板, Project Explorer, AI Analyst, Admin]
updated_at: "2026-08-01"
related:
  - "当前共识与新会话入口.md"
  - "三类核心界面设计.md"
  - "开发计划-Admin与模板运行闭环.md"
status: accepted
---

# EnergyIQ MVP 产品需求文档

## 1. 产品定义

EnergyIQ 将 Tuya/Excel 的能源数据转化为可复跑、可下钻、可追溯的决策建议。

它不是一个让客户自由搭建图表的 BI，也不是每次打开都重新设计页面的 Agent。MVP 将结构化决策模板与 DataFoundry 可信问数组合：

- 重复发生的管理问题由固定模板确定性计算；
- 未覆盖的问题由 AI Analyst 探索；
- 两者共用同一个 Energy Fact、Metric、Scope、Time Range 和 Evidence。

## 2. 已确认客户需求

1. 接入 Tuya API；API 暂不可用时使用 Excel；
2. 保存和处理 Raw Data；
3. 原始读数约 15 分钟一条，当前每天同步一次即可；
4. 用户按时间段运行分析，而不是只看瞬时值；
5. 结构化看板可由 admin 调整、发布、保存和复跑；
6. SQL、计算口径、数据批次和结论可追溯；
7. 支持 Workspace 多租户和多 Project；
8. Project 内层级按真实硬件/业务配置，不固定 Room/Floor/Block；
9. 支持总表、分表、父节点挂表和虚拟表；
10. 支持 Electricity，并预留 Water；
11. 展示应帮助决策，图表必须服务于异常、比较和行动建议；
12. 模板之外可继续使用 AI 问数。

## 3. MVP 目标

- admin 能从空 Project 配置 2–4 Tier、节点、属性和电表映射；
- admin 能导入现有 Excel，校验累计读数并生成区间事实；
- admin 能预览、校验和发布 Project/Tier Template；
- user 能切换 Project、Scope 和时间段复跑；
- Overview、Explorer 和 AI Analyst 对同一上下文给出一致数字；
- 每条重要结论有 Evidence；
- 跨 Workspace/Project 查询被服务端阻止。

## 4. 非目标

- 实时流、秒级分析；
- 客户自由 BI 编辑；
- 复杂角色和节点级 ACL；
- 自动 ML 异常；
- AI 自动发布模板；
- 正式 Forecast、Carbon；
- 5–7 Tier 的完整 UX；
- 跨 Workspace Portfolio。

## 5. 用户与权限

| 权限 | 人物 | 主要任务 |
| --- | --- | --- |
| user | FM、Boss | 看建议、下钻、复跑、问数 |
| admin | 我方与首期实施人员 | 创建账号/项目、配置数据与层级、发布模板、排错 |

FM/Boss 权限相同。Workspace 是客户隔离边界；Project 是 Workspace 内的配置和分析根。一个 user 可以属于多个 Workspace，首期默认可看 Workspace 内全部 Published Project。

## 6. 客户信息架构

顶部 Project selector 右侧：

1. Overview；
2. Project Explorer；
3. AI Analyst；
4. Data Map。

客户界面先全英文。Admin 只向 admin 显示。

### 6.1 Overview

目标：一分钟内回答“哪里值得关注、影响多大、下一步核查什么”。

页面顺序：

1. Project/Scope、Resource、Time Range、Run、Data Freshness；
2. Executive Action Summary；
3. Consumption、可选 Cost、Off-hours、Exceptions；
4. Benchmarks；
5. Standby Wastage；
6. Operating Hours；
7. Exceptions & Evidence；
8. Forecast Preview，仅条件满足时。

桌面左侧目录：

- Overview；
- Benchmarks；
- Standby wastage；
- Operating hours；
- Forecast preview。

支持 Yesterday、Last 7 days、Last 30 days 和 Custom。

### 6.2 Project Explorer

目标：按真实 Project Tier 找到 Scope/Meter，核查趋势、组成、同级比较、历史比较和质量。

桌面：

- 左：Tier Node + Meter Point 树；
- 中：当前选择的总量、趋势、子项、构成和计量详情；
- 右：异常、建议、质量、Evidence 与 AI 入口。

选择非叶子 Scope 时展示：

- 直接子 Tier 排名；
- 当前祖先范围内目标 Tier 的横向比较；
- 当前 Scope 自身历史；
- load/aircon/light/other；
- Tier × Tier、Tier × Time 或时间热区；
- 直接挂载总表、分表和虚拟表。

### 6.3 AI Analyst

直接复用 DataFoundry DataTasksApp：

- Chat、Session、Streaming；
- Artifact/Chart Preview；
- Task Console；
- Evidence、Trace；
- Files 与 Knowledge 引用。

Investigate with AI 从 Overview/Explorer 跳转并保留 Project、Scope、Tier、Resource、Period 和版本。后端重新解析可信 Energy Query Context。

### 6.4 Data Map

user 只读，可查看：

- Project/Tier/Scope；
- Meter Point 与 Source Binding；
- Metric 与业务分类；
- 数据来源和可信状态；
- configured 与 inferred 关系。

编辑只在 Admin。

## 7. Admin

Admin 是项目交付流水线：

~~~text
Draft → Data connected → Mapping valid → Template ready → Published
~~~

Project Tabs：

1. Profile；
2. Tiers & Nodes；
3. Meter Mapping & Virtual Meters；
4. Data Import & Quality；
5. Attributes, Calendar & Tariff；
6. Metrics & Rules；
7. Templates；
8. Preview & Publish；
9. Runs & Audit。

全局复用 DataFoundry：

- Accounts；
- Data Sources；
- Data Map；
- Knowledge；
- Assets；
- Models；
- Skills；
- Tools；
- MCP；
- Operations。

Draft 可未完成保存。Validate/Publish 才检查缺失、重复聚合、虚拟公式、数据覆盖、模板数据条件和 Evidence。

## 8. 动态 Tier

Project 在 Tier 外。每个 Project 自底向上定义：

- tier_definition_id；
- ordinal；
- alias；
- nodes；
- parent relationships；
- attributes。

Tier 1 不写死 Circuit。客户只看 alias 和 display_name。

增加层级的条件：它有独立分析、汇总、导航、权限、数据绑定或属性意义。单节点无意义 Tier 在发布时警告。MVP 重点 2–4 Tier，保留 5–7；不开放跳 Tier。

## 9. 计量

- Physical Meter 绑定 Excel label 或 Tuya device/DP；
- Meter 可以挂任意 Scope；
- business category：load、aircon、light、other；
- Meter Role 区分 total、component/submeter、standalone、virtual、official；
- 空间树与 Meter Topology 分开；
- 总表优先，不与分表重复相加；
- Virtual Meter 由已发布线性 +/- 公式计算；
- Electricity/Water 共用框架。

## 10. 数据

### 10.1 来源

Excel 当前主用；Tuya API 后续每日同步。两者统一输出 Raw Reading。

### 10.2 存储

同时保存：

- Raw Artifact；
- Import Batch；
- 累计 Meter Reading；
- 15 分钟或实际时长 Interval Fact；
- Utility Fact；
- Data Snapshot；
- Quality Event。

### 10.3 计算

~~~text
sort by meter/time
→ dedupe
→ delta cumulative reading
→ validate reset/gap/jump/interval
→ interval usage
→ average rate by actual elapsed time
→ virtual formula
→ official aggregation
~~~

累计 Active Energy 不可直接求和。重传必须幂等。

## 11. 指标与异常

首期指标：

- total usage、daily average；
- peak rate/time；
- own-history change；
- same-tier rank；
- kWh/m²、kWh/person；
- off-hours usage/share；
- coverage 和质量。

首期异常：

- 使用量异常；
- 人均异常；
- 单位面积异常；
- 非营业时段异常。

基线优先自身历史，之后是配置规则和归一化同级。四象限可用 kWh/person × kWh/m²；Bell curve 和复杂图表只在可比样本足够时出现。

## 12. 模板

- 一个 Project Overview Template；
- 每个 Tier Definition 一个 Tier Template；
- 同 Tier 节点共享，不做 per-node override；
- Preset 只作参考；
- 模板由受控 Component Catalog 组成；
- AI 可生成 Draft，admin 发布；
- 未来 AI 修改只生成 Proposal；
- 正式模板不含任意 SQL/HTML/React/Prompt。

缺面积、人数、Tariff、Calendar 或历史时隐藏/降级对应组件。Forecast 至少需要约 3 个月历史和回测，最好 6–12 个月。

## 13. Analysis Run 与追溯

每次 Run 固定：

- Workspace/Project/Scope/Tier；
- Resource/Time Range/Timezone；
- Hierarchy、Formula、Data Snapshot；
- Metric、Rule、Calendar、Tariff；
- Template Revision；
- Query/SQL、结果和 Evidence。

同 Snapshot 与版本复跑一致。新数据创建新 Run，不覆盖历史。

## 14. 样板

### Ngee Ann

目标：Project → Level → Circuit。移除历史 Block Test。正式聚合使用 Level 的总 Light/Load，不与分回路重复。

### Preschool

目标：Project → Block → Room → Circuit。Charles 数据当前只明确 Centre → Circuit；正式 Block/Room 映射必须由 admin 确认。当前 fixture 只能标 provisional。

## 15. 页面状态

| 状态 | 行为 |
| --- | --- |
| No data | 说明尚未完成首次导入 |
| Stale | 保留最近成功结果并标记日期 |
| Partial | 展示覆盖率，降低或隐藏结论 |
| Provisional | 明确说明属性/映射未确认 |
| Running | 防重复提交 |
| Failed | 保留上次成功结果并可重试 |
| Water not configured | 不显示水入口 |
| Insufficient evidence | 不生成数字或根因结论 |

## 16. 非功能要求

- 所有服务端查询重新校验 Membership/Project/Scope；
- SQL 只读且按 Energy Query Context 限制；
- 原始文件、批次和派生链可追溯；
- 模板和公式发布不可变；
- 客户 UI 不能暴露内部 Tier ordinal；
- Project 切换必须驱动全部客户页面更新；
- admin 查看客户会话正文必须审计；
- 每日 20 个表 × 96 点约 1,920 行只是当前小规模，模型不能依赖这个硬上限。

## 17. MVP 验收

1. admin 创建并发布一个 2 Tier Project；
2. admin 创建 3/4 Tier Draft；
3. 单节点无意义 Tier 发布时被提醒；
4. Excel 导入后累计读数正确差分；
5. 重复导入不重复；
6. total/component 不重复求和；
7. Virtual Meter 可算且错误可见；
8. user 不能进入 Admin 或其他 Workspace；
9. Project 切换后四个入口同步；
10. Overview、Explorer、AI 对同 Scope/Period 数字一致；
11. Template Revision 与 Analysis Run 可复跑；
12. Evidence 能回到 SQL/Query、批次和版本；
13. Ngee Ann golden total 与 Preschool golden total 通过；
14. 缺失元数据的模块正确隐藏或降级。

## 18. 外部待补输入

- Ngee Ann 正式营业时间、Tariff；
- 两个样板 Meter 角色和 Scope 映射；
- Preschool Block/Room；
- 面积、人数和有效期；
- Tuya API 合同；
-近期 Water 项目；
- DB schedule/现场反馈用于确认具体根因。

这些不阻塞 Admin/Tier 开发，但会阻塞相关 Project 的正式 Published 状态。
