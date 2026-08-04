---
title: "2026-08-04 Published Meter Routing 实施记录"
summary: "GitHub Issue #24：把 Meter identity、导航挂载与官方汇总口径固化为 Mapping schema v2，并让可信分析只读取 Release-pinned route。"
doc_type: implementation
tags: [开发记录, Meter Mapping, Published Route, Release, Golden]
updated_at: "2026-08-04"
status: accepted
---

# Published Meter Routing 实施记录

## 1. 结论

Issue #24 的代码边界已完成：正式分析不再用 Fact 的 `scope_id + meter_role` 猜测 Meter 归属或汇总成员，而是只读取 Mapping schema v2 中已发布的 attachment 与 `scope + resource + category` routes。Mapping fingerprint 覆盖两类关系，并以 `meter_mapping_revision_id` 进入 Template Revision、Project Release、Analysis provenance 与 Saved analysis 冻结证据。

这项工作服务于 Overview 北极星：先证明 Project、Level 与 Circuit 下钻使用同一组可审计事实且不会 double count，再进入 Tariff/Calendar 与 Overview Renderer 验收。它没有修改 Integration metadata、SQLite 或 DuckDB，也没有代替 Project Publish、Overview UI 或客户 Release 切换。

## 2. 权威模型

Mapping schema v2 分开保存三件事：

1. Physical Meter identity：稳定 `meter_point_id` 与来源标签；
2. Published Meter Attachment：`meter_point_id → navigation_scope_id`，决定导航与 own-Circuit 查询；
3. Official Aggregation Route：每个 `scope + resource + category` 显式列出官方 `meter_point_ids`。

确认或运行时遇到旧 schema、缺失 route、重复 route/member、悬空 Meter、跨 Resource/Category/Scope member 或 Release pin mismatch，均拒绝运行。Datasource 只按已发布 Meter IDs 建立受限 view，并暴露 published attachment 与 `official_aggregation_eligible`；查询路径不会 UPDATE facts，也没有旧 heuristic fallback。

## 3. Ngee Ann 固定口径

- 4 个 total Circuit 均挂在自己的 Circuit Scope，可直接查询；
- 14 个 component Circuit 均可通过 own-Circuit route 查询，但不进入 Level/Project 官方汇总；
- Level 6、Level 7 与 Project 分别使用 light/load 分类 routes，官方成员只有 4 个 totals；
- Virtual `Load 12` 保持可追溯公式，但不进入官方 Project/Level totals；
- Level 6 Total Office Load 的 raw Golden 固定为 `366.009445 kWh`，现有 Analysis API 统一四位输出契约为 `366.0094 kWh`。测试分别对 raw 与 API 两层做精确断言，不用宽松 tolerance 混淆精度边界。

## 4. Release 与历史边界

Template Revision 发布时同时 pin：

- `hierarchy_revision_id`；
- `meter_mapping_revision_id`；
- `meter_formula_revision_id`；
- Metric/Rule、Calendar、Tariff 与 Data Snapshot 等既有版本。

运行先校验用户、Workspace 与 Project access，再按 Release-pinned Hierarchy 验证 Scope，随后解析同一个 Mapping Revision。当前 Draft 或当前 Project 指针漂移不能覆盖已发布 Release。Saved analysis GET 只返回已序列化历史结果和当时 Template Revision，不重新计算；rerun 才基于正式 Resolver 创建新记录。

## 5. 验收证据

代码提交：`c1ddf54`（branch `codex/t03b-meter-route`，baseline `d0915f4`）。

- `npm run typecheck`：通过；
- focused Vitest：7 files、35 tests 全部通过；
- Golden 覆盖 Project、Level、component Circuit、total Circuit；
- Mapping validation 覆盖 attachment/route fingerprint，以及 missing、duplicate、dangling、cross-resource 等 fail-closed 情形；
- `node --check scripts/smoke-energy-trusted-scope.mjs`：通过；
- `git diff --check`：通过。

## 6. 下一步

由主 Agent 在 Integration 先合入代码，再用权威 Excel materialization 的 Published Mapping 创建/验证 Project Release。随后执行 Tariff/Operating Calendar 与 Overview/Saved v1→v2 Golden acceptance；只有 Overview 的 finding、evidence、impact 与 action 能在同一 Release 下被业务人员验证，才说明北极星方法成立。
