---
title: "Preschool Section 5 Charles 复刻执行方案"
summary: "在不伪造 Forecast 或 Actual 的前提下，把现有 Planning Baseline 升级为 Charles 的状态、四 KPI、Estimate-vs-Actual 与局部切换结构。"
doc_type: playbook
tags: [Preschool, Overview, Charles, Forecast, Task-A]
updated_at: "2026-08-10"
related:
  - "2026-08-10-Overview夜间执行路线与Runlog.md"
  - "2026-08-10-Preschool连续数据A-B实施记录.md"
  - "2026-08-06-Preschool-Overview-Interaction-Matrix.md"
  - "../template/Preschool/Energy_Report_May2026.html"
---

# Preschool Section 5 Charles 复刻执行方案

## 1. 适用与不适用

**何时用**

- Task A 继续实现 Preschool Overview A5；
- 对照 Charles `June 2026 Forecast`，补齐客户可见的信息结构和局部交互；
- 验证 May Plan 与后续 June Actual 能在同一 Section 中诚实对照。

**何时不用**

- 不用于优化 AI Finding、Prompt 或 Provider；这些属于 Task B；
- 不建设通用 Forecast、Scheduler、Dashboard DSL 或机器学习平台；
- 不把 Charles HTML 内的 simulated actual、固定状态、硬编码日期或浏览器计算搬进正式 Renderer。

## 2. 当前事实与角色

- **Task A**：制定并实现 A5，维护独立提交和测试证据。
- **主 Agent**：审核数据边界、代码、回归和合并；不得把自动化验收冒充 Charles 人工验收。
- **当前真实实现**：仍是 `Planning baseline → May 四周横条 → June Energy/Cost → Method`，不是 Charles Forecast 复刻。
- **Charles 参考**：`docs/template/Preschool/reference-screenshots/charles/05-june-forecast.png`。
- **当前截图**：用户 2026-08-10 提供的 `codex-clipboard-0a56d1c1-f86a-4e3a-9b1d-49dc13d1c803.png`。
- **已存在的确定性能力**：May 完整周 Plan；A/B 链可提供 June Actual、coverage 和完整期 variance；Plan 与 Actual 分别 pin 自己的 Snapshot/Evidence。

## 3. 必须先做的反证检查

1. 核对 Task A 工作树与权威集成基线 `origin/codex/t35-presentation-clean@214c51b` 的分叉；不得 reset、clean 或覆盖其他 Agent WIP。
2. 核对 `preschoolPlanningLifecycle` 当前是否已经提供：Plan、Actual、coverage、variance、Project/Centre series、daily/weekly/monthly buckets。
3. 若缺少趋势或 Centre 数据，不得在 React 重算；先写出最小 DTO/Projection 缺口和测试，再做窄范围服务端补充。
4. 核对当前共享 3102 是 May-only 还是已含 June B；May-only 页面只能验收 waiting state，不能冒充 Actual 状态。
5. 不因 Charles 使用 simulated actual 而复制模拟曲线；正式页面只显示当前 Snapshot 可证明的 Actual。

## 4. A5 客户阅读结构

按以下顺序实现：

1. **Section 标题**：`June 2026 Forecast`；必要时用副标题说明这是 transparent planning estimate。
2. **状态条**：显示 `Awaiting actual / Partial / On plan / Above plan / Below plan` 等确定性状态；没有 Actual 时明确 `Actual not available yet`。
3. **四个 KPI**：
   - Estimated Energy；
   - Estimated Cost；
   - Consumed So Far；
   - Pace vs Estimate。
4. **主图**：Estimate 与 Actual 时间序列；Estimate 用虚线，Actual 用实线。无 Actual 时保留 Estimate，并给局部空态，不隐藏整个 Section。
5. **局部时间粒度**：Daily / Weekly / Monthly，只影响 Section 5，不改整页、不重跑 AI。
6. **局部范围**：Portfolio / 单个 Centre；使用同一 Project cutoff、Release 和授权 Snapshot。
7. **方法与 Evidence**：May 四周柱状基线、Tariff、区间和限制移入折叠区，不再作为主视觉。
8. **AI Slot**：沿用 Section 级插槽，不在本切片改生成逻辑。

## 5. 数据与降级合同

- Plan 和 Actual 必须分别携带 `dataSnapshotId / period / sourceRef`，不得合并成无法追溯的单一数字。
- 只有完整 June 才显示最终 variance；Day 1/7 显示 partial coverage 和 pace，不冒充 full-month outcome。
- 没有 Actual：Consumed So Far、Pace 和 Actual line 显示局部 Unavailable。
- 没有 Centre series：Portfolio 仍可用；Centre selector 局部禁用并解释原因。
- 没有可证明的 saving、weather、occupancy 或 customer tariff：不显示、不推断。
- `Estimated Cost` 必须继续标识公开参考费率、before GST、not customer bill。

## 6. 执行步骤

- [ ] 产出 Charles/Current 差异矩阵，并把每项标成 `retain / adapt / unavailable / drop`。
- [ ] 为 waiting、partial、complete 三种状态先补 ViewModel/Renderer 红测。
- [ ] 若 DTO 缺趋势/范围数据，补最小服务端 Projection 测试和字段；不得在前端复制公式。
- [ ] 实现状态条、四 KPI、Estimate-vs-Actual 和局部切换。
- [ ] 把旧 May 四周横条降级到 Method/Evidence 折叠区。
- [ ] 验证切换不会修改整页 URL 主 Period、不会触发 AI、不会混用 Snapshot。
- [ ] 完成聚焦测试、typecheck、production build 和 `git diff --check`。
- [ ] 使用 Chrome 验收 1440×900、1920×1080、tablet；至少覆盖 waiting 与 available/partial 状态。
- [ ] 独立提交并回报 SHA、变更文件、测试、浏览器证据和未完成边界。

## 7. 验收标准

- 用户在 10 秒内能回答：预计多少、目前用了多少、进度是否偏离、哪个范围、下一步看哪里。
- 主路径外观和信息顺序与 Charles 一致，但不复制假数据。
- Daily/Weekly/Monthly 和 Portfolio/Centre 是 Section-local。
- waiting/partial/complete 均有自动测试，且没有全页横向溢出或 console error。
- A/B 验收继续满足：Saved A fixed、Current B updated、A/B Snapshot/Evidence 不混。
- 最终状态只能是 `DONE-ENGINEERING` 或 `READY-FOR-HUMAN`；Charles 尚未检查时不得写“已验收完成”。

## 8. 失败模式

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| 页面仍只有 May 四周横条 | 只调整了旧 fallback 样式 | 停止验收，按第 4 节重构阅读结构 |
| Actual 与 Plan 数字都存在但无曲线 | DTO 只有聚合值，没有时间序列 | 补最小 Projection 字段，不在 React 推导 |
| Centre 切换后日期或 Snapshot 改变 | 错把局部范围当整页 Context | 保持统一 cutoff/Snapshot，只切 series |
| May-only 页面显示 On Track | 把 Estimate 当 Actual | fail closed 为 `Actual not available yet` |
| 为对齐 Charles 写入 simulated actual | 复制了原型数据 | 删除假数据，只使用正式 A/B 链 |
| 复刻过程中修改 AI Runtime | Task A/B 越界 | 回退该部分并交由 Task B |

## 9. 明确停止项

- 通用 Forecast 平台、ML Forecast、Scheduler/DSL；
- 浏览器端重算权威 Forecast/Actual；
- 静态写死状态、Centre、日期或数值；
- 为了有图而伪造 June actual；
- 与 Section 5 无关的全页 redesign；
- Task B 的 Prompt、Harness、Provider 和 Evidence Validator。
