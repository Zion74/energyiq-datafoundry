import { describe, expect, it } from "vitest";

import { createEnergyQueryContextItem } from "./energy-context-item.js";

describe("createEnergyQueryContextItem", () => {
  it("pins the authoritative scope and versions in model context", () => {
    const item = createEnergyQueryContextItem({
      userId: "user-1",
      workspaceId: "workspace-1",
      projectId: "project-1",
      projectName: "Project One",
      scopeId: "level-7",
      scopeName: "Level 7",
      scopeType: "level",
      resource: "electricity",
      timezone: "Asia/Singapore",
      from: "2026-07-01T16:00:00.000Z",
      to: "2026-07-08T16:00:00.000Z",
      endExclusive: true,
      period: "Last 7 days",
      hierarchyRevisionId: "hierarchy-v1",
      meterFormulaRevisionId: "formula-v1",
      dataSnapshotId: "snapshot-v1",
      metricVersion: "metrics-v1",
      businessCalendarVersion: "calendar-v1",
      tariffScheduleVersion: "tariff-v1",
      resolvedAt: "2026-07-09T00:00:00.000Z"
    }, "session-1");
    expect(item.trust).toBe("tool");
    expect(String(item.content)).toContain("to_exclusive=2026-07-08T16:00:00.000Z");
    expect(String(item.content)).toContain("meter_formula_revision_id=formula-v1");
  });
});
