---
title: "Preschool Overview AI 路线 B 集成记录"
summary: "记录两阶段 AI Artifact、失败重试边界及 Benchmark/Standby 薄适配的 Integration 证据与未完成验收。"
doc_type: implementation-record
tags: [Overview, Preschool, AI-Insight, Artifact]
updated_at: "2026-08-09"
---

# Preschool Overview AI 路线 B 集成记录

## 本次完成

- 当前 Integration 已包含路线 A `7a3295a`，因此没有重复合并；路线 B `81c03ee` 已精确集成。
- Metadata 与 API 已在 Integration 依赖环境重建；此前受跨工作树 Junction 影响的 failed-retry API 测试已通过。
- 同一 Artifact 最多执行两次：首次执行失败后允许一次显式重试；并发 claim 仍只有一个 owner，错误 lease token 不能 complete/fail，`available` 结果继续不可变。
- 新增薄适配，将与当前 Project、Scope、Snapshot、Release、Period 和输出合同完全一致的 `preschool.benchmark`、`preschool.standby` Finding 映射到路线 A 的 Key Recommendation / Next Step。
- 适配只复用 AI Artifact 已接受的标题、解释、行动和验证方式，不生成第二套固定 AI 文案；旧 Snapshot、不匹配合同和没有章节 Finding 的结果均 fail closed。
- `verified`、`hypothesis`、`exploration-idea` 在章节解释中保留可见状态；Standby Finding 不再重复进入 Operating-hours 的旧 Slot。

## 自动化证据

- Metadata/API build：通过。
- failed-retry API + Store 聚焦测试：`4/4` 通过。
- 路线 A/B 及薄适配聚焦回归：`13 files / 140 tests` 通过。
- 全仓 `npm run typecheck`：通过。

以上均为本地自动化证据，不等于真实 Provider、Chrome 或 Charles 产品验收。

## 明确未完成

- 发布后由服务器自动执行两阶段 Workflow；当前页面仍负责触发 claim 和受控 Run。
- 服务端对最终 Artifact 内容的完整语义复核。API 已核对精确 identity、Workflow/Prompt/Skill 版本及两个已完成 Run，但最终内容校验仍主要来自当前 Workflow validator；在该边界收口前不能把本切片称为最终可信执行闭环。
- 固定 Preschool Snapshot 的真实 Provider 三次验收（至少 `2/3 useful`）。
- 1440/1920 Chrome 章节位置、恢复、无旧 Snapshot 混入的视觉验收。
- Charles 人工产品验收。

## 后续顺序

1. 在不建设 Scheduler/Job 平台的前提下，把发布后的单次执行 owner 移至既有 API/Run Runtime。
2. 复用同一受控 Run 结果完成服务端 commit，不接受浏览器自报的未验证内容。
3. 跑真实 Provider 三次，再做 Chrome 与人工验收；各层证据分开记录。
