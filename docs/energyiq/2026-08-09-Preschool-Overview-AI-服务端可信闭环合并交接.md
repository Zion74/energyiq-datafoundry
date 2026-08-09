---
title: "Preschool Overview AI 服务端可信闭环合并交接"
summary: "记录路线 B 从浏览器编排迁移到既有服务端 Run Runtime、Validator 与共享 Artifact Store 的最小闭环、验证证据和后续验收边界。"
doc_type: implementation-handoff
tags: [Overview, Preschool, AI-Insight, Artifact, Runtime]
updated_at: "2026-08-09"
---

# Preschool Overview AI 服务端可信闭环合并交接

## 合并基线与范围

- 基线：`codex/t35-presentation-clean` / `2395bc5816d62d6cfbc6a0d1bdf867ccc2e83ed3`。
- 开发分支：`codex/overview-ai-server-workflow`。
- 仅完成 Preschool 路线 B；没有扩到 Ngee Ann，没有建设 Scheduler、Queue、Worker 或第二套 Agent Runtime。
- 未修改路线 A 的 `preschool-overview-renderer.tsx`、`preschool-overview-view-model.ts` 及其测试。

## 已完成的可信闭环

1. API 在读取当前 AI Artifact 时重新解析用户 Membership、Project access 和当前 Project/Scope/Snapshot/Release/Period；缺失或 queued 的 Artifact 由服务器 read-through 取得 lease。
2. 服务器复用现有 `DataFoundryAgUiAgent` 和 Run Store，顺序执行 Investigator、Insight Editor，再执行确定性 Validator；只有 Validator 通过的内容才能写入 canonical shared Artifact。
3. 浏览器只 GET 当前状态/结果并展示；失败后只能调用一次显式 retry。浏览器不再持有 lease，也没有 claim、complete 或 fail canonical Artifact 的客户端方法；对应旧 API 写入口返回 forbidden。
4. exact identity 保留 Workspace、Project、Scope、Snapshot、Release、分析 Period、Renderer、模型 Profile 与 revision、Analysis Pack、Workflow、两个 Prompt、Method Skill、输出合同和 Validator revision。
5. Runtime 完成证据同时校验两个 Stage 的 Run ID、Session ID、completed 状态，以及 Run 输入中的 Snapshot、Release 和 Period；随后才进入 Validator 和 Store commit。
6. Validator 逐条过滤非法 Finding/Block，不用固定模板补写：verified 必须有 Evidence；hypothesis/exploration-idea 至少有 uncertainty 或 verification；未被引用 Evidence 支持的数字和 Centre 实体被拒绝；合法 no-visual 与零 Finding 保留。
7. Store 保持 exact-identity single-flight、`available` 不可变、错误 lease token 不可 complete/fail；同一 identity 仅首次执行加一次显式 retry，最多两次 attempt。旧 Snapshot 不会回退到当前页面。

## API 与恢复语义

- `GET /api/v1/energy/projects/:projectId/overview-ai-artifact?scopeId=...`：服务端 exact-identity read-through ensure；available 直接恢复，running/failed 诚实返回。
- `POST .../overview-ai-artifact/retry`：仅显式重试；Store 决定是否仍有 attempt，竞争请求只有一个 owner。
- `POST .../overview-ai-artifact/claim|complete|fail`：浏览器编排/提交被拒绝。
- Provider 或 Runtime 失败后返回 failed；当前 Snapshot 页面显示 unavailable。不会把旧 Snapshot Artifact 与当前结构化数字混合。

## 自动化验证

- 路线 B 聚焦：`9 files / 114 tests` 通过。
- EnergyIQ seams：`7 files / 89 tests` 通过。
- `npm run typecheck`：通过。
- `git diff --check`：通过（仅 Git 的 LF/CRLF 工作区提示）。

覆盖重点包括：两个授权用户并发仅产生一套两阶段 Run、服务器 canonical commit、Runtime Run/Session provenance 拒绝、旧 Snapshot 在 Provider 前 fail closed、失败后仅一次重试、并发 retry 单 owner、available 不可重跑、错误 lease token 被 fence、零高价值 Finding 不补固定废话。

## 合并与复测提示

- 建议以本提交整体 cherry-pick；`apps/api/src/server.ts`、`apps/api/src/energy/energy-api.ts`、Web Config API 和 AI Slot 是最可能与后续 Integration 改动相交的文件，应做窄冲突处理。
- Integration 合并后至少复跑本交接中的两组测试和 typecheck；若独立 worktree 缺少 `duckdb.node`，先执行 `npm rebuild duckdb`，这只修复本地原生依赖，不是业务改动。
- 路线 A 的 Section composition 继续使用已有 Benchmark/Standby 薄适配；本切片不改 Renderer/ViewModel。

## 明确未完成

- 未执行真实 Provider 固定 Snapshot pass@3，因此尚无 `2/3 useful` 人工价值证据。
- 未完成 1440/1920 Chrome、页面恢复、retry 交互和新旧 Snapshot 视觉验收。
- 未完成 Charles 最终产品验收，也未开始 Ngee Ann。
- 本地自动化通过不等于 Provider、Chrome 或最终产品验收通过。
