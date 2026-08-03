import { describe, expect, it } from "vitest";

import { createEnergyQueryContextItem } from "./energy-context-item.js";

const baseContext = {
  userId: "user-1",
  workspaceId: "workspace-1",
  projectId: "project-1",
  projectName: "Project One",
  scopeId: "level-7",
  scopeName: "Level 7",
  scopeType: "level",
  resource: "electricity" as const,
  timezone: "Asia/Singapore",
  from: "2026-07-01T16:00:00.000Z",
  to: "2026-07-08T16:00:00.000Z",
  endExclusive: true as const,
  period: "Last 7 days" as const,
  hierarchyRevisionId: "hierarchy-v1",
  meterFormulaRevisionId: "formula-v1",
  dataSnapshotId: "snapshot-v1",
  metricVersion: "metrics-v1",
  businessCalendarVersion: "calendar-v1",
  tariffScheduleVersion: "tariff-v1",
  resolvedAt: "2026-07-09T00:00:00.000Z"
};

describe("createEnergyQueryContextItem", () => {
  it("pins the authoritative scope and versions in model context", () => {
    const item = createEnergyQueryContextItem(baseContext, "session-1");
    expect(item.trust).toBe("tool");
    expect(String(item.content)).toContain("to_exclusive=2026-07-08T16:00:00.000Z");
    expect(String(item.content)).toContain("meter_formula_revision_id=formula-v1");
  });

  it("adds evidence-bound Ngee Ann analysis rules without changing other projects", () => {
    const item = createEnergyQueryContextItem({
      ...baseContext,
      projectId: "ngee-ann-polytechnic",
      projectName: "Ngee Ann Polytechnic"
    }, "session-1");
    const content = String(item.content);

    expect(content).toContain("Ngee Ann analysis policy");
    expect(content).toContain("group by local_interval_start");
    expect(content).toContain("comparison is unavailable");
    expect(content).toContain("never create new chart values");
    expect(content).toContain("Never generate mock figures");

    const otherProject = createEnergyQueryContextItem(baseContext, "session-1");
    expect(String(otherProject.content)).not.toContain("Ngee Ann analysis policy");
  });
});
