---
title: "2026-08-17 开发记录：Preschool Stage 3 native submit unavailable"
summary: "定位 v22 真实 Provider 已完成调查但未调用正式提交工具，并以工具可见性修复和 v23 Artifact 身份旋转恢复可复跑边界。"
doc_type: runlog
tags: [Preschool, Stage3, AdditionalInsights, Provider, Artifact]
updated_at: "2026-08-17"
related:
  - "2026-08-16-AI输出审核边界二次验证结论与实施计划.md"
  - "2026-08-05-Overview用户价值与AI-Slot最小交付决策.md"
---

# 2026-08-17 开发记录：Preschool Stage 3 native submit unavailable

## 1. 目标与范围

- 解决 Current B 的 Additional AI Insights 显示 `unavailable`：真实 Provider Run 已完成调查，但 Artifact 以 `PRESCHOOL_ADDITIONAL_AI_DISCOVERY_RESULT_INVALID` 失败。
- 保留候选级 Evidence、价值审核、最多三条发布、历史 Artifact 只读和普通 Overview GET 零 Provider 的既有边界。
- 本次不调整 Ngee Ann 页面组织，不放宽事实校验，不用普通 Assistant 文本代替正式 Candidate 提交。

## 2. 代码改动

真实 Run 事件证明模型只看见五个只读调查工具，并明确表示 `energyiq_additional_insights_submit` 不在可用函数列表，因此查数完成后把候选写成普通 Assistant 文本。Runtime 正确拒绝了这段非正式提交。

本次修复：

1. Agent instructions 显式列出 native submit tool，说明它在五个只读工具之外可用；
2. 成功提交后立即结束，不再要求生成与 native submit 冲突的结尾 Assistant 文本；
3. Preschool current Artifact 旋转为 `additional-insights-v23` / `additional-insights-discovery-v12`；
4. v22 保持历史可读、所有 mutation fail closed；Evaluation 和 Method Governance 只允许 v23 继续写入。

| 文件组 | 改动类型 | 说明 |
|---|---|---|
| `packages/agent-runtime/src/index.ts` | 修改 | 正式声明 submit tool 与提交后终止语义 |
| `apps/api/src/energy/overview-ai-artifact.ts` | 修改 | 旋转 Preschool current identity/prompt |
| `apps/api/src/energy/preschool-additional-ai-insights-workflow.ts` | 修改 | 仅 current v23 采用 native submit 合同 |
| Metadata Artifact/Evaluation/Governance Stores | 修改 | v23 current-mutable，v22 historical-read-only |
| 对应测试 | 修改 | current fixture 迁移、提交工具提示、v22 历史回归 |

## 3. 验证证据

已完成：

```powershell
vitest run <9 个 Stage 3 / Store / API / Runtime 聚焦文件> --maxWorkers=2
```

结果：`9 files / 169 tests passed`。另已验证 Agent Runtime、Metadata、API 的定向 build；最终提交前仍需重新运行完整构建门。

尚未完成，不能提前宣称通过：

- 将修复合入本地主线并发布不可变 release；
- 对 Current B 运行一次 v23 真实 Provider；
- 人工审核 Summary/Insights 的新颖性、清晰度和思考价值；
- 浏览器验证 A→B、刷新零新增 Provider Run，以及 Charles/Ngee Ann 账户回归。

## 4. 问题与取舍

- **现象：** Provider Run completed，但 Stage 3 unavailable。
  **根因：** Run 完成只代表 Agent 协议结束；业务 Artifact 还要求一次 native Candidate submission。本次模型未被明确告知 submit tool 可用。
  **处理：** 修复工具可见性和终止协议，不降低业务校验。

- **取舍：** 不直接接受模型最后的 JSON 文本。否则会绕过一次提交、工具审计和候选级治理，A→B 无法证明结果来自当前合同。

- **身份旋转：** Prompt 与终止行为改变后必须生成 v23，防止旧 v22 失败或旧 Proposal 被当作修复后的 current。

## 5. 复现与排查

排查顺序：

1. 读取 exact Artifact 的 error code、Run id 和 Snapshot/Release pins；
2. 核对 Run 是否 completed，不把 Run completed 等同于 Artifact available；
3. 按事件顺序统计只读工具与 `energyiq_additional_insights_submit`；
4. 若 submit 次数为 0，检查最终 Assistant 文本是否明确报告工具不可见；
5. 修复后只用新 Artifact identity 重跑，禁止 retry 旧 v22 冒充 current。

## 6. 后续与关联

1. 完整 build/diff gate，精准提交并合入主线；
2. 部署后对同一 Current B 只运行一次真实 v23 Provider；
3. 若 Artifact available，按价值 Rubric 做人工审核；若仍失败，按新的精确 error/event 继续最小诊断，不盲目多跑；
4. Current B 通过后再验收 `What changed?` 与 Saved A；
5. Ngee Ann 页面组织属于后续独立切片。
