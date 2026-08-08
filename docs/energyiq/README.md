# EnergyIQ 文档索引

本目录是 energyiq-datafoundry 中 EnergyIQ 二次开发的决策源。文档区分“当前有效决策”“待批准计划”“实现证据”和“历史文档”，避免新会话把旧方案当成现状。

## 新会话必读

按顺序：

1. [当前共识与新会话入口](当前共识与新会话入口.md)：截至 2026-08-03 的全部最终共识、现状、差距、开放输入和延期项；
2. [MVP 底座 + 双功能 + 协同架构](决策-MVP底座双功能协同架构.md)：当前最高优先级与复杂度边界；
3. [Overview 改造与 AI Analysis 打通最终方案](决策-Overview改造与AI-Analysis打通最终方案.md)：项目专属 Recipe/Renderer、DataFoundry AI 边界和最终实施顺序；
4. [Overview 用户价值与 AI Slot 最小交付决策](2026-08-05-Overview用户价值与AI-Slot最小交付决策.md)：统一 Snapshot/Facts、项目专属 Structured Signals、单次多 Section AI Interpretation，以及新 Snapshot 后预生成共享 Overview AI Artifact；
5. [Charles 系统价值复核与两批数据连续演示决策](2026-08-06-Charles系统价值复核与连续数据演示决策.md)：用连续 Snapshot、简洁洞察、图文协同和行动后果证明系统相对一次性 Claude HTML 的价值；
6. [项目 Renderer、Recipe 与时间上下文](决策-项目Renderer-Recipe与时间上下文.md)：全局主时间、Benchmark、四象限和 AI 上下文契约；
7. [Ngee Ann 首个试点路线与页面边界](决策-NgeeAnn首个试点路线与页面边界.md)：Ngee Ann 模块、交互/保存语义，以及 Overview/Explorer/AI 的最新边界；
8. [三 Agent MVP 最终执行与重置包](2026-08-03-三Agent-MVP最终执行与重置包.md)：唯一派工入口及三个可复制 Prompt；
9. [三 Agent MVP 执行手册](2026-08-03-三Agent-MVP执行手册.md)：Data Foundation、Structured Template 和 AI Analyst 的责任、并行依赖与验收；
10. [DataFoundry Agent Harness 复用边界](说明-DataFoundry-Agent-Harness与EnergyIQ复用边界.md)：解释已有 Runtime、Task Console、Knowledge/MCP/Tools 和受控图表，不重复建设；
11. [领域词汇表](CONTEXT.md)：Project、Tier、Scope、Meter、Fact、Template、Run 和 Data Health 的统一用语；
12. [开发计划：Admin 与模板运行闭环](开发计划-Admin与模板运行闭环.md)：已有 Admin/模板能力与当前 Ngee Ann MVP 批次；
13. [最新 MVP PRD](PRD-EnergyIQ-MVP.md)：客户页面、Admin、数据、模板与验收。

若旧聊天或旧文档冲突，以“当前共识与新会话入口”及其链接的 accepted 专题为准。

## 当前有效决策

| 文档 | 解决的问题 |
| --- | --- |
| [阶段技术选型](阶段技术选型-基于DataFoundry二次开发.md) | 为什么选择在 DataFoundry 内二次开发，不引入 Superset/Rill 作为 MVP 主底座 |
| [双角色、用户动线与管理后台](决策-双角色与管理后台.md) | user/admin 权限、Boss/FM 动线、Admin 信息架构与 DataFoundry 技术配置复用 |
| [三个核心任务界面与 Data Map](三类核心界面设计.md) | Overview、Explorer、AI Analyst、Data Map 的页面任务和交互 |
| [MVP 底座 + 双功能 + 协同架构](决策-MVP底座双功能协同架构.md) | 数据底座按需支撑双功能；结构化模板优先，AI Analyst 增强，最后做协同 |
| [Ngee Ann 首个试点路线与页面边界](决策-NgeeAnn首个试点路线与页面边界.md) | 首个试点、Ngee Ann Preset、时间与异常语义、Interactive/Saved Analysis、Rerun/Report、Explorer 数据健康和开发顺序 |
| [DataFoundry Agent Harness 复用边界](说明-DataFoundry-Agent-Harness与EnergyIQ复用边界.md) | 复用现有 Mastra/AG-UI、Task Console、Knowledge、MCP、Skills、模型配置和受控 Chart Artifact |
| [灵活 Tier、项目节点与计量点](灵活项目结构与计量点模型.md) | Project 外置、Tier alias/ordinal、加层判断、任意节点挂表、虚拟表和 Water |
| [领域模型](领域模型.md) | Tier Definition、Node、Meter、Fact、Metric、Template、Run 的字段和关系 |
| [项目专属模板与决策型分析](决策-项目专属模板与决策型分析.md) | EnergyIQ Template Schema、Component Catalog/Analysis Spec、开源复用边界、Agent 受控生成、证据与复跑 |
| [项目 Renderer、Recipe 与时间上下文](决策-项目Renderer-Recipe与时间上下文.md) | 已确认的统一主时间、受控局部时间、Benchmark 周期、正确四象限和 AI 上下文契约 |
| [Overview 改造与 AI Analysis 打通最终方案](决策-Overview改造与AI-Analysis打通最终方案.md) | 项目专属 Recipe + React Renderer、DataFoundry AI Runtime 边界、上下文跳转、AI Slot 与实施顺序 |
| [Overview 用户价值与 AI Slot 最小交付决策](2026-08-05-Overview用户价值与AI-Slot最小交付决策.md) | 以同一 Published Snapshot 和 Evidence Catalog 连接 Facts、Structured Signals、一次多 Section AI Run、嵌入式 Interpretation 与共享预生成 Artifact；不建设第二套 Runtime 或通用 Scheduler |
| [Charles 系统价值复核与两批数据连续演示决策](2026-08-06-Charles系统价值复核与连续数据演示决策.md) | 承认一次性 Claude HTML 的适用场景，并以两批数据连续更新、0–3 条精炼洞察、图文协同和行动后果定义下一项客户价值验收 |
| [四界面 UI/UX 一致性与功能保护决策](2026-08-08-四界面UI-UX一致性与功能保护决策.md) | 统一 Overview、AI Analyst、Project Explorer 与 Admin 的视觉语法、可读性和操作习惯，同时保留不同侧栏职责并保护现有功能 |
| [Project Explorer 性能、时间、指标与 Snapshot Health 决策](2026-08-08-Project-Explorer性能时间指标与Snapshot-Health决策.md) | 将 Explorer 收窄为快速的设备与数据核查界面，默认 Project 统一最新完整日，并按节点类型展示指标、自身平均线与诚实的 Snapshot Health |
| [项目配置、数据接入与模板发布流程](流程-项目配置与模板发布.md) | Admin 从 Project Draft 到 Published 的操作与发布门槛 |
| [Preschool 数据与三层目标结构](决策-Preschool-Portfolio数据集接入.md) | 区分 Centre×Circuit 现有事实与 Block→Room→Circuit 目标映射 |
| [Ngee Ann 模板吸收方案](评估-Ngee-Ann模板吸收方案.md) | 原型可直接吸收、需参数化、延期模块与 golden baseline |
| [NetZero Prototype 完整理解与复用审计](2026-08-03-NetZero-Prototype完整理解与复用审计.md) | 全量拆解 NetZero SaaS、Ngee Ann/EliteIOT 指标与图表、真实/Mock 边界，以及项目专属 Recipe + Renderer 路线 |

## 实施计划

| 文档 | 状态 |
| --- | --- |
| [AI Analyst Harness 与 AI Slot 执行路径](2026-08-08-AI-Analyst-Harness与AI-Slot执行路径.md) | in progress；当前以两项目 60 秒客户价值、AI Finding 首屏表达和分层验收为主线；v10 后的完整 submit/repair 延期，通用化只沉淀轻量 Analysis Pattern Cards |
| [2026-08-06 Overview 夜间执行清单与 Runlog](2026-08-06-Overview夜间执行清单与Runlog.md) | in progress；第 11 节为 2026-08-07 当前行动方案：Overview takeaway-first 阅读体验 → #31 Explorer 精准下钻与设备趋势 → Preschool 演示型图表 → #5/#19/#20/#21 收口；AI 侧线保持隔离 |
| [三 Agent MVP 最终执行与重置包](2026-08-03-三Agent-MVP最终执行与重置包.md) | accepted；唯一派工入口，含共同基线和三个最终 Prompt |
| [三 Agent MVP 执行手册](2026-08-03-三Agent-MVP执行手册.md) | accepted；三个 Agent 的责任、并行节奏、MVP 边界与验收 Owner 已确认 |
| [开发计划：Admin 与模板运行闭环](开发计划-Admin与模板运行闭环.md) | in progress；按 Ngee Ann MVP 路线收口，不再横向扩建平台 |

原来的三线责任文档、各 Agent Handoff 和纠正 Prompt 已标记为 `superseded`，只保留为历史入口；执行统一以“三 Agent MVP 执行手册”为准。

## 实现证据

| 文档 | 作用 |
| --- | --- |
| [2026-08-04 Ngee Ann 权威 Excel、Mapping 与 Facts Materialization 实施记录](2026-08-04-Ngee-Ann权威Excel-Mapping与Facts-Materialization实施记录.md) | 四份权威 workbook、18/18 Mapping、项目级 canonical interval rebuild、100,205 facts、固定 Golden、Admin readiness 与 #4/#24/#19 边界 |
| [可信查询范围与 Energy Fact 接入记录](2026-07-31-可信查询范围与Energy-Fact接入记录.md) | Ngee Ann/Preschool 事实接入、DuckDB Scope 约束、SQL allowlist 和验证证据 |
| [2026-08-01 Admin 与 Tier 批次 0–1 实施记录](2026-08-01-Admin-Tier-批次0-1实施记录.md) | Project/Tier/Node Draft、Validate、Publish、样板迁移、测试和本地复现证据 |
| [2026-08-01 Admin Meter Mapping 与虚拟电表实施记录](2026-08-01-Admin-Meter-Mapping与虚拟电表实施记录.md) | 物理表映射、官方汇总审查、可选加减法 Virtual Meter、Draft 保存与验证证据 |
| [2026-08-01 Admin Excel Import Batch 实施记录](2026-08-01-Admin-Excel-Import-Batch实施记录.md) | 真实 Excel 保存与检查、SHA 去重、精确标签到 Mapping Draft、浏览器与测试证据 |
| [2026-08-02 Admin Metric/Rule Registry 实施记录](2026-08-02-Admin-Metric-Rule-Registry实施记录.md) | 受控指标与规则版本、项目 Draft 选择、Ready 判定、确定性执行与 provenance 证据 |
| [2026-08-02 Admin Component Catalog 与 Template Draft 实施记录](2026-08-02-Admin-Component-Catalog与Template-Draft实施记录.md) | 受控组件目录、Project/Tier 模板草稿、真实事实预览、时区处理与双项目浏览器证据 |
| [2026-08-03 Admin Preview 与客户 Overview 统一渲染实施记录](2026-08-03-Admin-Preview与客户-Overview统一渲染实施记录.md) | Template Schema v2、共享 Render Plan、受控布局视觉协议、双端 Renderer 与兼容发布策略 |
| [2026-08-03 AI Analyst 可信问数与受控图表实施记录](2026-08-03-AI-Analyst可信问数与受控图表实施记录.md) | Qwen/DeepSeek Provider、权威 Energy Query Context、Ngee Ann 可信 SQL、Task Console completed 与 168 点后端 ChartPreview |
| [2026-08-04 Tariff 与营业日历持久化实施记录](2026-08-04-Tariff与营业日历持久化实施记录.md) | 不可变 Tariff/Calendar、Published Release Resolver、API/Web/Saved serialized 集成、显式 Unavailable，以及待完成的 Ngee Ann #24-first Golden |
| [2026-08-04 Published Meter Routing 实施记录](2026-08-04-Published-Meter-Routing实施记录.md) | Mapping schema v2、Meter attachment、按 Scope/Resource/Category 的官方 routes、Release pin 与四层 Golden |
| [2026-08-04 T03/T04/T13 集成实施记录](2026-08-04-T03-T04-T13集成实施记录.md) | Runtime policy、Period-effective metadata、Workspace 默认模型、公开 API/持久化契约，以及 T13 尚未通过的 live 产品门禁 |
| [Preschool Overview Interaction Matrix](2026-08-06-Preschool-Overview-Interaction-Matrix.md) | Preschool 对 Charles 模块的保留、适配、主动删除，以及 Evidence、降级、1440/1920 和人工验收边界 |
| [2026-08-03 DeepSeek V4 Flash 与 DataFoundry 实测记录](2026-08-03-DeepSeek-V4-Flash与DataFoundry实测记录.md) | Flash 连接和工具链可运行，但同一问数产生过两种结果；记录时区 SQL、图表触发、60 秒超时和用户级模型配置等真实缺口 |
| [2026-08-01 Ngee Ann 源到事实契约原型](2026-08-01-Ngee-Ann-源到事实契约原型记录.md) | 统一 Adapter、SHA 幂等、实际时长 Fact、Virtual Load 12、冲突与官方汇总排重的可运行证据 |
| [2026-08-01 Admin 首次数据源配置交互原型](2026-08-01-Admin-首次数据源配置交互原型记录.md) | 已废弃的 A/B/C 历史实验记录；正式路径已回归 Project Overview、Structure、Data Sources 与 Meter Mapping |

## 外部确认与参考

| 文档 | 作用 |
| --- | --- |
| [甲方确认稿](甲方确认稿-日级能源分析与AI问数MVP.md) | 客户已确认的日级分析与 AI 问数需求边界 |
| [Charles 静态能源报告](../template/Preschool/Energy_Report_May2026.html) | Preschool 模板种子，不是可运行模板 |
| [调研索引](research/README.md) | ChatBI 历史选型，以及 Explorer 对 CopilotKit、Superset、Recharts/ECharts 的当前评估 |

## 历史/已被替代

这些文档保留讨论与实现演进证据，不应直接作为新开发规格：

| 文档 | 被什么替代 |
| --- | --- |
| [早期 MVP 交互与分析架构](MVP-产品交互与分析架构.md) | 最新 PRD、动态 Tier 决策和开发计划 |
| [2026-07-31 DataFoundry 整合实施方案](实施方案-DataFoundry复用与EnergyIQ整合.md) | 当前共识与 2026-08-01 开发计划；其中 DataFoundry 复用原则仍有效 |

## 当前代码入口

- apps/web/src/app/energyiq：EnergyIQ Shell 与页面；
- apps/api/src/energy：Query Context、确定性分析和样板；
- packages/metadata/src/energyiq-project-setup-store.ts：Project/Tier/Node Draft、Validate、Publish 与不可变 Revision；
- packages/metadata/src/energyiq-template-store.ts：受控 Component Catalog、Project/Tier Template Draft、Schema v2 与不可变 Template Revision；
- packages/metadata/src/energyiq-operational-policy-store.ts：版本化 Tariff/Operating Calendar、Project/Scope 生效解析、active/Release-pinned 运行来源和显式 Unavailable；
- apps/web/src/app/energyiq/_components/energy-template-render-plan.ts：Admin Preview 与客户 Overview 共用的临时 Render Plan 编译入口；
- packages/metadata/src/energyiq-store.ts：Project/Node/Access 兼容读取与运行时存储；
- packages/data-gateway/src/energy-scoped-datasource.ts：受 Scope 限制的能源事实查询。

当前已有页面并不等于对应领域能力已经正式完成。具体“已验证/仍需开发”以[当前共识第 14 节](当前共识与新会话入口.md#14-当前实现与目标差距)和最新实施记录为准。
