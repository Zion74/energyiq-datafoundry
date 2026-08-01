---
title: "2026-08-01 开发记录：Admin Excel Import Batch"
summary: "记录真实 Excel 上传、检查、SHA 幂等、Mapping Draft 生成与浏览器验收，并明确事实物化仍未完成。"
doc_type: runlog
tags: [Admin, Excel, Import Batch, Meter Mapping, Data Quality]
updated_at: "2026-08-01"
related:
  - "开发计划-Admin与模板运行闭环.md"
  - "2026-08-01-Admin-Meter-Mapping与虚拟电表实施记录.md"
status: implemented
---

# 2026-08-01 开发记录：Admin Excel Import Batch

## 1. 目标与范围

正式 Admin 路径保持为 `Basics → Structure → Data & Meters → Analysis → Review & Publish`。本轮只补 `Data & Meters` 的真实输入前半段：管理员在 `Data Sources` 上传 Excel，系统保存原文件、检查数据契约、展示批次证据，再把精确源标签带到 `Meter Mapping`。Mapping 只能选择 Structure 已存在的 Scope，不会反向创建层级。

本次不包含上传批次的 Raw Reading / Interval Fact 物化、Tuya API、Metric/Rule/Template 和正式发布。

## 2. 代码改动

- 新增 Project 级 Excel Import Batch API 与 metadata 持久化；
- 使用现有文件资产服务保存原始 `.xlsx`，记录 SHA-256；
- 同一 Project 重复上传相同 SHA 时复用已有 Import Batch；
- 检查固定字段 `Device Name`、`Time`、`Active Energy`；
- 记录总行数、有效行数、精确 source labels、覆盖区间、典型采样间隔、重复键、无效行与负累计读数；
- Admin `Data Sources` 显示最新批次及 `ready / needs_review` 状态；
- `Use detected labels` 生成可编辑 Mapping Draft，原始 label 不被改写；
- Ngee Ann 的位置前缀与冒号后回路说明仅用于可解释的匹配建议，最终仍由管理员确认；
- Mapping Draft 保存后可刷新复用，不再在没有 Import Batch 时伪造 fixture labels。

| 文件 | 改动类型 | 说明 |
| --- | --- | --- |
| `apps/api/src/energy/energy-excel-import.ts` | 新增 | 解析并检查固定 Excel 契约 |
| `apps/api/src/energy/energy-api.ts` | 修改 | 增加 Import Batch 上传与列表 API |
| `packages/metadata/src/energyiq-store.ts` | 修改 | 持久化 Project 级 Import Batch 元数据 |
| `apps/web/src/app/energyiq/admin/project-setup-workbench.tsx` | 修改 | 连接 Data Sources、批次检查和 Mapping Draft |
| `apps/web/src/app/energyiq/admin/project-setup-model.ts` | 修改 | 以可解释规则建议既有 Scope，不创建层级 |

主要提交：

- `861783b feat(energyiq): persist inspected Excel import batches`
- `5bd7908 feat(energyiq): connect Admin Excel import to mapping`
- `ad8ed80 fix(energyiq): match detailed meter labels to scopes`

## 3. 验证证据

### 3.1 真实浏览器验收

文件：`Ngee Ann Poly Level 6 (21 April - 20 May).xlsx`

| 检查项 | 结果 |
| --- | --- |
| 有效行 | 25,919 / 25,919 |
| Source labels | 9 |
| 典型间隔 | 15 min |
| 覆盖区间 | 2026-04-21 至 2026-05-21 |
| SHA 展示 | `e4d788af0135281c…` |
| 重复上传 | 复用已有 Import Batch |
| Mapping 建议 | 9 Mapped / 0 Needs Scope |
| Draft 持久化 | 保存、刷新后仍为 9 / 0 |

### 3.2 自动化证据

~~~text
npx vitest run apps/api/src/energy/energy-excel-import.test.ts \
  packages/metadata/src/energyiq-store.test.ts \
  apps/web/src/app/energyiq/admin/project-setup-model.test.ts
~~~

结果：3 个测试文件、12 项测试通过。

~~~text
npm run build
~~~

结果：根 TypeScript project build 通过。

## 4. 问题与取舍

- 现象：带说明后缀的标签（如 `Lvl 6 Office Load 1: L1P1-L3P6`）最初无法匹配 `Office Load 1`。
- 根因：建议逻辑只允许完整名称相等，没有区分稳定业务名和冒号后的回路说明。
- 处理：精确名称优先；没有精确项时，使用冒号前业务名做同位置内的唯一前缀匹配。原始 label 保持不变，管理员仍需最终确认，没有引入自动建树或 LLM 猜测。

## 5. 复现与排查

前置条件：本地 API/Web 服务已启动，访问 `http://127.0.0.1:3001/energyiq/admin?section=data-sources`，Project 选择 Ngee Ann Polytechnic。

1. 上传 `data/raw_excel/Ngee Ann Poly Level 6 (21 April - 20 May).xlsx`；
2. 核对批次行数、标签数、15 分钟间隔和 SHA；
3. 重复上传并确认复用已有 Import Batch；
4. 点击 `Use detected labels` 与 `Open Meter Mapping`；
5. 确认 9 Mapped / 0 Needs Scope，保存 Draft 后刷新复查。

## 6. 后续与关联

当前上传会保存原文件并生成检查结果，但尚未把该批次正式物化为项目运行时使用的 `Raw Reading → Interval Fact → Quality Event`。离线 builder 已验证累计读数差分、实际区间平均功率、重叠冲突与 virtual meter 计算，但它还没有接到每次 UI Import Batch 上。

下一步按已冻结边界开发：

1. 从已保存 Import Batch 读取工作簿并写 Raw Reading；
2. 复用已保存 Meter Mapping 生成 15 分钟 Interval Fact；
3. 持久化重复、负差、缺口、不规则间隔和覆盖率质量事件；
4. 在 Admin 显示物化结果和 blocker；
5. 事实闭环通过后，再进入 Metric/Rule/Template。
