---
title: "EnergyIQ 开发计划：Admin 与模板运行闭环"
summary: "在 DataFoundry 现有代码上分批完成 Tier、计量映射、Excel 数据、项目模板、复跑和客户页面贯通。"
doc_type: playbook
tags: [开发计划, Admin, Tier, Excel, Template Revision, Analysis Run]
updated_at: "2026-08-02"
related:
  - "当前共识与新会话入口.md"
  - "领域模型.md"
  - "流程-项目配置与模板发布.md"
status: in_progress
---

# EnergyIQ 开发计划：Admin 与模板运行闭环

> 状态：**批次 0–3 与批次 4 的真实 Draft Preview 已完成，并通过 Ngee Ann/Preschool 双项目验证。下一步是不可变 Template Revision、Analysis Run、Rerun 与 Review & Publish。**

实施证据见：[2026-08-01 Admin 与 Tier 批次 0–1 实施记录](2026-08-01-Admin-Tier-批次0-1实施记录.md)、[Admin Meter Mapping 与虚拟电表实施记录](2026-08-01-Admin-Meter-Mapping与虚拟电表实施记录.md)、[Admin Excel Import Batch 实施记录](2026-08-01-Admin-Excel-Import-Batch实施记录.md)、[Admin Metric/Rule Registry 实施记录](2026-08-02-Admin-Metric-Rule-Registry实施记录.md)和 [Admin Component Catalog 与 Template Draft 实施记录](2026-08-02-Admin-Component-Catalog与Template-Draft实施记录.md)。

## 1. 目标

在现有 energyiq-datafoundry 上二次开发，不重做账户、聊天、技术配置和 Preview。先把 Admin 做成可完成一个项目交付的工具，再让 Overview、Explorer 和 AI Analyst 只消费已发布配置。

最终 MVP 闭环：

~~~text
admin creates Project
→ configures Tiers/Nodes
→ imports Excel
→ confirms Meter Mapping
→ validates facts and quality
→ configures metrics/rules/templates
→ previews and publishes
→ user selects Project/time/scope
→ reruns Overview
→ drills into Explorer
→ continues in AI Analyst with the same trusted context
~~~

## 2. 当前代码基线

开发应直接演进现有模块：

- Metadata：packages/metadata/src/energyiq-store.ts；
- 模板草稿：packages/metadata/src/energyiq-template-store.ts；
- 样板：apps/api/src/energy/energy-bootstrap.ts；
- Query Context：apps/api/src/energy/energy-query-context.ts；
- 确定性分析：apps/api/src/energy/energy-analysis.ts；
- 事实范围：packages/data-gateway/src/energy-scoped-datasource.ts；
- Admin：apps/web/src/app/energyiq/admin；
- 客户页面：apps/web/src/app/energyiq/_components；
- AI 工作台：现有 DataTasksApp。

现状限制：

- Preschool 现有可运行事实仍是 Project → Centre → Circuit，Block → Room → Circuit 目标映射等待客户输入；
- Tariff 0.2727 仍在分析代码中硬编码；
- Metric/Rule Revision 已持久化并驱动确定性计算，但当前 Project 选择仍是 Draft，尚未冻结为 Published Template Revision；
- Component Catalog、Project/Tier Template Draft 与真实 Project/Scope/Period Draft Preview 已实现；不可变 Template Revision、Analysis Run 与 Rerun 尚未实现；
- 客户 Overview/Explorer 尚未统一消费已发布模板。

## 3. 实施原则

1. **在现有 DataFoundry 深模块上增加 EnergyIQ 能力**，不复制 Auth、DataTasksApp、Knowledge 或模型配置。
2. **先做可用的 2–4 Tier**，仅在数据库/API 预留 5–7；不开发跳 Tier。
3. **采用可变 Draft + 不可变 Published Snapshot**。编辑时不为每次输入制造 Revision；发布时一次性冻结 Hierarchy、Formula、Metric/Rule 和 Template 引用。
4. **Excel 先跑通，API 复用同一 Adapter 合同**。
5. **运行时 Excel 解析优先使用现有 Node/TypeScript 技术栈**，减少部署环境；uv/pandas 只做离线复算和 golden validation，不成为生产服务依赖。
6. **先写不变量与合同测试，再迁移样板**。
7. **UI 全英文，文档可中文**。
8. **缺数据就隐藏/降级，不用 mock 伪装正式事实**。

## 4. 批次 0：冻结基线与迁移护栏

### 工作

- 给当前 Ngee Ann 与 Preschool 查询结果建立 golden fixture；
- 固定现有 Energy Query Context 和 Project Access 合同测试；
- 记录现有 SQLite/DuckDB schema、样板 SHA 和可回滚快照；
- 给后续 schema 变更建立明确 migration，不依赖 bootstrap upsert 偷改历史；
- 为旧 node_type API 定义兼容读取窗口，避免一次改坏所有页面。

### 验收

- 现有两个 Project 的总量、Scope 总量、峰值和事实行数可重复验证；
- typecheck、API energy tests、web energy tests 通过；
- 迁移前后可以回到同一数据快照；
- 未触碰无关 DataFoundry 功能。

## 5. 批次 1：Admin Project、Tier 与 Node

这是建议批准后最先开发的可见批次。

### 后端

- 增加 Tier Definition；
- Project Node 改为引用 tier_definition_id，不再用 node_type 做计算；
- Project 保留在 Tier 外；
- 增加 Draft/Validate/Publish 状态和 Hierarchy Snapshot；
- 增加 Node Metadata 的 provisional/confirmed 和有效期；
- 支持 Project 下多个顶层节点；
- 服务端校验 ordinal、父子归属、孤立节点、单节点无意义 Tier；
- 服务端权限继续以 user/admin 和 Membership 为准。

### Admin UI

- Project list + lifecycle status；
- Project Profile；
- Tiers & Nodes，自底向上 Add parent tier；
- Tier alias、说明、节点编辑和属性；
- Save Draft；
- Validate panel，区分 warning 与 blocking error；
- View as user；
- Published 项目才进入客户 Project selector。

### 样板迁移

- Ngee Ann：移除 Block Test，迁移为 Level → Circuit；
- Preschool：保留当前 Centre → Circuit 为 provisional fixture；
- 在没有真实映射前，不创建假的 Block/Room；
- 预建 Preschool 三 Tier Draft 只能作为空结构草稿，不能发布为真实层级。

### 验收

1. admin 可新建 2、3、4 Tier Project；
2. internal ordinal 与显示 alias 完全分离；
3. 单节点且无独立意义时能 Save Draft，但 Publish 警告；
4. user 无法访问 Admin CRUD；
5. 修改 URL 不能越权 Project/Workspace；
6. Ngee Ann 客户树从 Project 直接看到 Level 6/7；
7. 切换 Project 后 Overview、Explorer 和 AI Analyst 都获得新的 project_id。

## 6. 批次 2：Meter Mapping、Virtual Meter 与 Excel

> 实施状态：已完成。真实 `.xlsx` 可保存为带 SHA 的 Import Batch、检查固定字段/标签/覆盖区间/典型间隔并生成可编辑 Mapping Draft；确认 Mapping 后可显式构建 Raw/Normalized/Interval Fact 与质量事件。重复文件复用批次，重叠文件按覆盖结束时间裁决，Ngee Ann 与 Preschool golden 保持不变。

### 后端

- Meter Point 从 Project Node 分离；
- Source Binding 映射 Excel label 或 Tuya device/DP；
- 保存 resource、category、role 和 official aggregation source；
- Meter Topology 与受控线性 Virtual Formula；
- Import Batch、Raw Artifact、Meter Reading、Interval Fact 和质量事件；
- 文件 SHA 与同键幂等；
- 重叠批次冲突策略；
- average rate 按实际区间时长计算。

### Admin UI

- Data Import：文件预览、字段识别、admin 确认；
- Mapping：source label → Meter Point → Scope；
- 角色与分类：total/component/standalone，load/aircon/light/other；
- Virtual Meter 公式编辑器，只支持选择输入和 +/- 系数；
- Quality Summary：负差、缺口、重复、不规则时间、跳变和覆盖率；
- 未映射和重复聚合作为 Publish blocker。

### Excel 与 API 分工

- 先完成 Excel Adapter；
- 定义 Raw Reading Adapter interface；
- Tuya Adapter 在获得正式 API 契约后实现；
- 两种来源共用后续处理；
- 不使用 LLM 自动字段/节点映射。

### 验收

- 重复导入同一文件不增加重复事实；
- 15 分钟累计读数正确转换为 interval_kwh；
- 非 15 分钟区间的 average_kw 仍正确；
- 总表与分表不会重复计入总量；
- 虚拟表缺输入、负值、单位不一致和环依赖均有明确结果；
- Ngee Ann golden total 为约 5328.2073 kWh；
- Preschool May 2026 fixture 总量为约 24921.8123 kWh。

## 7. 批次 3：Metric、Rule、Component 与项目模板

> 实施状态：已完成。系统已有 9 个受控 Metric Revision、5 个受控 Rule Revision 和 10 个受控 Component Revision；Project 可在 Admin `Templates` 中配置一套 Project Overview Template 与每个 Tier 一套共享 Tier Template。Enabled 与 Ready 分开显示，模板可保存启用状态与顺序，并解释 Metric、Rule、Calendar、面积、人数、子节点和 Meter Mapping 缺口。正式 Preview/Publish 属于批次 4。

### 后端

- 建立 Metric Definition/Revision；
- 建立 Rule Revision；
- 建立 Component Catalog；
- 建立 Project Template 和 Tier Template Draft/Revision；
- Component 只引用注册 Metric 与 Query Spec；
- Tariff、Calendar 和 Node Metadata 按分析时间解析；
- 建议输出统一 Evidence Bundle。

### 初始内容

- total/daily average/peak/time；
- own-history comparison；
- same-tier rank；
- kWh/m²、kWh/person；
- off-hours usage/share；
- coverage/quality；
- 四类确定性异常；
- Charles Preschool Preset；
- Ngee Ann Level/Circuit Preset。

### Admin UI

- Metrics & Rules：有限表单，不暴露任意 SQL；
- Templates：模块启用、顺序和受控参数；
- 项目总览一个模板，每个 Tier 一个模板；
- 缺面积、人数、Calendar、Tariff 或历史时显示明确降级；
- Preview 使用真实 Project/Scope/Period。

### 验收

- alias 改名不影响 Metric 计算；
- 同 Tier 节点在指定祖先下比较；
- 只有两个节点时不生成 Bell curve；
- 缺面积/人数/费率时不显示误导指标；
- 硬编码 tariff 从 energy-analysis.ts 移除；
- Ngee Ann 与 Charles 模块都由同一 Component Catalog 渲染，但可选模块不同。

## 8. 批次 4：Template Revision、Analysis Run 与发布

### 工作

- 已完成：Draft Preview 与正式运行隔离；Preview 使用真实 Project/Scope/Period、canonical fact 覆盖、Project timezone 和受控 Component Renderer；
- Publish 产生不可变 Template Revision；
- 建立 Analysis Run 与运行状态；
- 固定 Context、Data Snapshot 和全部计算版本；
- 保存结果 Artifact、Evidence、SQL/Query Spec 和质量摘要；
- 历史列表、详情和 Rerun；
- 新数据运行产生新 Run，不覆盖旧结果；

### 验收

- 相同 Snapshot + Revision 复跑结果一致；
- 改模板、公式、指标或数据后生成新 Run/Revision；
- 历史报告仍能解释当时口径；
- 每条异常和建议可回到来源批次与查询；
- 失败 Run 不覆盖最后一次成功结果。

## 9. 批次 5：客户页面统一消费发布配置

### Overview

- 使用 Project Template；
- 保留 Charles 左侧 Overview/Benchmarks/Standby/Operating/Forecast Preview 目录；
- 决策建议优先；
- Project、Scope、Period 变化重新运行；
- Forecast 和费用按数据条件隐藏/标 Preview。

### Project Explorer

- 使用 Tier Template；
- 通用树支持 2–4 Tier；
- 节点与 Meter Point 分开表现；
- 同级横向、自身历史纵向、分类构成与时间切片；
- 水只在配置后出现。

### AI Analyst

- 继续复用 DataTasksApp；
- Investigate with AI 携带可信 Context；
- 会话中变更时间/范围后服务端重新解析；
- Task Console 展示数据选择、质量、计算与 Evidence，不展示模型私有推理。

### Data Map

- user 只读；
- 展示 Tier、Scope、Meter Binding、Metric 和数据来源；
- 关系标记 configured/inferred 和可信级别。

### 验收

- 切换 Project 四个入口同步变化；
- 同一 Scope/Period 在 Overview、Explorer 与 AI 的数字一致；
- 无数据、部分数据、过期、失败和 provisional 状态明确；
- 客户 UI 不出现 Tier 1/2 计算术语。

## 10. 批次 6：复用技术设置与轻量 Operations

### 直接挂接

- Accounts（Organisation/User Admin、邀请激活与登录已完成；后续只补生产邮件和运维细节）；
- Data Sources；
- Knowledge；
- Assets；
- Models/fallback；
- Skills；
- Tools；
- MCP；
- Data Map 技术配置。

不复制这些页面，只增加 EnergyIQ Shell、Workspace/Project scope 和 admin 导航。

### 轻量监测

- Import/Sync/Run 失败列表；
- Template 发布审计；
- 典型 query；
- 模型与 token 用量；
- Session Trace；
- admin 查看客户会话正文的审计。

复杂趋势大屏、告警平台和成本结算延期。

## 11. 批次 7：Tuya API Connector

仅在收到正式 API 契约后开发：

- 认证和密钥存储；
- 设备/DP 发现；
- 分页、限流和增量窗口；
- 每日同步；
- 重试与幂等；
- API label 与现有 Meter Mapping；
- Raw 响应和批次审计。

验收要求 API 和 Excel 对同一数据产生一致 Interval Fact 与指标。API 不改变模板与客户页面。

## 12. 测试与验证

每批至少执行与变更相关的：

- Metadata store 与 migration tests；
- Energy Query Context / Access tests；
- Energy analysis 和 data gateway tests；
- web Vitest；
- npm run typecheck；
- npm run build 或对应 workspace build；
- Ngee Ann / Preschool golden data regression；
- 本地浏览器对 user/admin、Project 切换、Draft/Publish 和跨页面 Context 做验收。

涉及 Next.js 页面前先读取仓库所用版本的 node_modules/next/dist/docs 中相关指南，不能依赖旧版本习惯。

## 13. 风险与控制

| 风险 | 控制 |
| --- | --- |
| 一次替换 node tree 导致现有页面全坏 | 保留兼容读取层，按批次迁移 |
| 版本表过多导致 Admin 难用 | Draft 可变，Publish 一次冻结 Snapshot |
| 把 meter 当 node 继续污染结构 | 批次 2 明确拆表和 API |
| 样板 mock 被当成客户事实 | provisional 状态贯穿 UI/Evidence |
| total/submeter 重复求和 | official aggregation source + 发布校验 |
| Excel 与 API 两套逻辑 | 统一 Raw Reading Adapter 和事实管线 |
| AI 给出正确-looking 错数字 | 服务端 Context、只读查询、Evidence 和 golden regression |
| 深 Tier 使 UI/模板组合爆炸 | 通用 ordinal/slice engine，MVP 只打磨 2–4 |

## 14. 不阻塞首批开发的外部输入

以下资料可以后补，不阻塞批次 0–1：

- Ngee Ann 正式营业时间与 Tariff；
- Preschool Block/Room 映射；
- 正式面积、人数及有效期；
- Tuya API 契约；
- Water 项目。

这些资料会阻塞对应模板正式 Published，但不阻塞 Admin Draft、Tier 模型和迁移框架。

## 15. 已批准并完成的范围

当前已完成 **批次 0 + 批次 1 + 批次 2**：

1. golden 基线与 migration 护栏；
2. Project/Tier/Node 正式领域模型；
3. Admin Profile 与 Tiers & Nodes；
4. Draft/Validate/Publish；
5. Ngee Ann 去掉 Block Test；
6. Preschool 保留 provisional fixture，不虚构 Block/Room。
7. Meter Mapping 只能绑定既有 Scope，并支持 Official Aggregation Review；
8. Virtual Meter 作为 Mapping 内可选项，默认不参与官方汇总；
9. 真实 Excel Import Batch、原文件保存、SHA 幂等、字段与标签检查；
10. 确认 Mapping 后的 Raw/Normalized/Interval Fact 物化与 Quality Event；
11. 重叠来源按覆盖结束时间裁决，Raw 证据不丢失；
12. Scope/Meter Point 分离和最近计量层聚合，防止总表与分表重复相加。
13. 精确保留 `Device Name`，并以可解释规则建议 Ngee Ann 的 9 个既有 Scope，管理员最终确认和保存。

这一步已做到可见、可验证，同时没有提前把 Metric Registry 和模板编辑器写死。

## 16. 批次 2 完成边界

批次 2 已按以下选择完成：

1. 先批准批次 0–1，其余作为已规划后续；
2. 生产运行时 Excel 解析使用 Node/TypeScript，uv/pandas 仅做复算；
3. Published Snapshot 简化版本管理，不做每字段事件溯源；
4. Preschool 不自动猜 Block/Room；
5. Admin 与客户 UI 均先英文。

数据事实闭环、批次 3 的 Metric/Rule/Component/Template Draft，以及真实 Project/Scope/Period Draft Preview 均已通过。Preschool Block/Room 仍保持待补输入，不自动猜测；下一步进入不可变 Template Revision、Analysis Run、Rerun 与发布。
