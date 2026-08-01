import { describe, expect, it } from "vitest";

import type { EnergyScopeAnalysisDto } from "../../../lib/config-api";
import { buildDecisionDashboardModel } from "./decision-dashboard-model";

describe("buildDecisionDashboardModel", () => {
  it("changes the complete Overview model when the selected project changes", () => {
    const ngeeAnn = buildDecisionDashboardModel(
      analysisFixture({
        projectId: "ngee-ann-polytechnic",
        projectName: "Ngee Ann Polytechnic",
        usageKwh: 5_328.21,
        childName: "Level 7"
      })
    );
    const preschool = buildDecisionDashboardModel(
      analysisFixture({
        projectId: "preschool-demo",
        projectName: "Preschool Portfolio",
        usageKwh: 24_921.8123,
        childName: "Centre E"
      })
    );

    expect(ngeeAnn.projectName).toBe("Ngee Ann Polytechnic");
    expect(preschool.projectName).toBe("Preschool Portfolio");
    expect(ngeeAnn.summary[0]?.value).toBe("5,328.21 kWh");
    expect(preschool.summary[0]?.value).toBe("24,921.81 kWh");
    expect(ngeeAnn.ranking[0]?.scope).toBe("Level 7");
    expect(preschool.ranking[0]?.scope).toBe("Centre E");
    expect(ngeeAnn.insights[0]?.title).not.toBe(preschool.insights[0]?.title);
  });
});

function analysisFixture(input: {
  projectId: string;
  projectName: string;
  usageKwh: number;
  childName: string;
}): EnergyScopeAnalysisDto {
  return {
    context: {
      userId: "dev-user",
      workspaceId: "default",
      projectId: input.projectId,
      projectName: input.projectName,
      scopeId: "project",
      scopeName: input.projectName,
      scopeType: "project",
      resource: "electricity",
      timezone: "Asia/Singapore",
      from: "2026-05-01T00:00:00.000Z",
      to: "2026-06-01T00:00:00.000Z",
      endExclusive: true,
      period: "Custom",
      hierarchyRevisionId: "hierarchy-v1",
      meterFormulaRevisionId: "formula-v1",
      dataSnapshotId: `${input.projectId}-snapshot`,
      metricVersion: "energy-metrics-v1",
      businessCalendarVersion: "sg-calendar-v1",
      tariffScheduleVersion: "sg-tariff-v1",
      resolvedAt: "2026-07-31T00:00:00.000Z"
    },
    summary: {
      usageKwh: input.usageKwh,
      costSgd: input.usageKwh * 0.2727,
      peakKw: 100,
      nonOperatingKwh: input.usageKwh * 0.12,
      nonOperatingSharePct: 12,
      areaSqm: 1000,
      occupantCount: 100,
      kwhPerSqm: input.usageKwh / 1000,
      kwhPerPerson: input.usageKwh / 100,
      validIntervalCount: 1000,
      qualityEventCount: 0
    },
    hourlyProfile: [{ hour: 0, averageKw: 10, peakKw: 14 }],
    childScopes: [{
      nodeId: "top-child",
      name: input.childName,
      nodeType: "scope",
      usageKwh: input.usageKwh * 0.6,
      sharePct: 60
    }],
    circuits: [],
    attention: [{
      code: "TOP_CHILD_SCOPE",
      severity: "info",
      title: `${input.childName} used the most energy`,
      evidence: `${input.childName} represented 60% of the project.`,
      suggestedAction: `Inspect ${input.childName}.`
    }],
    provenance: {
      dataSnapshotId: `${input.projectId}-snapshot`,
      hierarchyRevisionId: "hierarchy-v1",
      meterFormulaRevisionId: "formula-v1",
      metricVersion: "energy-metrics-v1",
      aggregationRule: "component",
      sourceView: "energy_scope_test",
      queryIds: ["scope_summary_v1", "hourly_profile_v1", "meter_breakdown_v1"]
    }
  };
}
