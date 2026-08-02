# EnergyIQ 文档索引

本目录是 energyiq-datafoundry 中 EnergyIQ 二次开发的决策源。文档区分“当前有效决策”“待批准计划”“实现证据”和“历史文档”，避免新会话把旧方案当成现状。

## 新会话必读

按顺序：

1. [当前共识与新会话入口](当前共识与新会话入口.md)：截至 2026-08-01 的全部最终共识、现状、差距、开放输入和延期项；
2. [领域词汇表](CONTEXT.md)：Project、Tier、Scope、Meter、Fact、Template 和 Run 的统一用语；
3. [开发计划：Admin 与模板运行闭环](开发计划-Admin与模板运行闭环.md)：批次 0–2 与批次 3 的 Metric/Rule Registry 已完成，下一步是 Component Catalog 与 Project/Tier Template Draft；
4. [最新 MVP PRD](PRD-EnergyIQ-MVP.md)：客户页面、Admin、数据、模板与验收。

若旧聊天或旧文档冲突，以“当前共识与新会话入口”及其链接的 accepted 专题为准。

## 当前有效决策

| 文档 | 解决的问题 |
| --- | --- |
| [阶段技术选型](阶段技术选型-基于DataFoundry二次开发.md) | 为什么选择在 DataFoundry 内二次开发，不引入 Superset/Rill 作为 MVP 主底座 |
| [双角色、用户动线与管理后台](决策-双角色与管理后台.md) | user/admin 权限、Boss/FM 动线、Admin 信息架构与 DataFoundry 技术配置复用 |
| [三个核心任务界面与 Data Map](三类核心界面设计.md) | Overview、Explorer、AI Analyst、Data Map 的页面任务和交互 |
| [灵活 Tier、项目节点与计量点](灵活项目结构与计量点模型.md) | Project 外置、Tier alias/ordinal、加层判断、任意节点挂表、虚拟表和 Water |
| [领域模型](领域模型.md) | Tier Definition、Node、Meter、Fact、Metric、Template、Run 的字段和关系 |
| [项目专属模板与决策型分析](决策-项目专属模板与决策型分析.md) | Project/Tier Template、Component Catalog、建议证据与复跑 |
| [项目配置、数据接入与模板发布流程](流程-项目配置与模板发布.md) | Admin 从 Project Draft 到 Published 的操作与发布门槛 |
| [Preschool 数据与三层目标结构](决策-Preschool-Portfolio数据集接入.md) | 区分 Centre×Circuit 现有事实与 Block→Room→Circuit 目标映射 |
| [Ngee Ann 模板吸收方案](评估-Ngee-Ann模板吸收方案.md) | 原型可直接吸收、需参数化、延期模块与 golden baseline |

## 实施计划

| 文档 | 状态 |
| --- | --- |
| [开发计划：Admin 与模板运行闭环](开发计划-Admin与模板运行闭环.md) | in progress；批次 0–2、Metric/Rule Registry 已完成 |

## 实现证据

| 文档 | 作用 |
| --- | --- |
| [可信查询范围与 Energy Fact 接入记录](2026-07-31-可信查询范围与Energy-Fact接入记录.md) | Ngee Ann/Preschool 事实接入、DuckDB Scope 约束、SQL allowlist 和验证证据 |
| [2026-08-01 Admin 与 Tier 批次 0–1 实施记录](2026-08-01-Admin-Tier-批次0-1实施记录.md) | Project/Tier/Node Draft、Validate、Publish、样板迁移、测试和本地复现证据 |
| [2026-08-01 Admin Meter Mapping 与虚拟电表实施记录](2026-08-01-Admin-Meter-Mapping与虚拟电表实施记录.md) | 物理表映射、官方汇总审查、可选加减法 Virtual Meter、Draft 保存与验证证据 |
| [2026-08-01 Admin Excel Import Batch 实施记录](2026-08-01-Admin-Excel-Import-Batch实施记录.md) | 真实 Excel 保存与检查、SHA 去重、精确标签到 Mapping Draft、浏览器与测试证据 |
| [2026-08-02 Admin Metric/Rule Registry 实施记录](2026-08-02-Admin-Metric-Rule-Registry实施记录.md) | 受控指标与规则版本、项目 Draft 选择、Ready 判定、确定性执行与 provenance 证据 |
| [2026-08-01 Ngee Ann 源到事实契约原型](2026-08-01-Ngee-Ann-源到事实契约原型记录.md) | 统一 Adapter、SHA 幂等、实际时长 Fact、Virtual Load 12、冲突与官方汇总排重的可运行证据 |
| [2026-08-01 Admin 首次数据源配置交互原型](2026-08-01-Admin-首次数据源配置交互原型记录.md) | 已废弃的 A/B/C 历史实验记录；正式路径已回归 Project Overview、Structure、Data Sources 与 Meter Mapping |

## 外部确认与参考

| 文档 | 作用 |
| --- | --- |
| [甲方确认稿](甲方确认稿-日级能源分析与AI问数MVP.md) | 客户已确认的日级分析与 AI 问数需求边界 |
| [Charles 静态能源报告](../Energy_Report_May2026.html) | Preschool 模板种子，不是可运行模板 |
| [历史调研索引](research/README.md) | 选型收敛前的 ChatBI、Rill、Superset 等调研 |

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
- packages/metadata/src/energyiq-store.ts：Project/Node/Access 兼容读取与运行时存储；
- packages/data-gateway/src/energy-scoped-datasource.ts：受 Scope 限制的能源事实查询。

当前已有页面并不等于对应领域能力已经正式完成。具体“已验证/仍需开发”以[当前共识第 14 节](当前共识与新会话入口.md#14-当前实现与目标差距)和最新实施记录为准。
