import { describe, expect, it } from "vitest";

import type { EnergyScopeAnalysisDto } from "../../../lib/config-api";

import {
  buildExplorerAnalysisRequest,
  explorerTrendSeries,
  explorerUrlWithView,
  explorerViewStateFromSearchParams,
  formatDateInput,
  hasExplorerFacts,
} from "./project-explorer";

describe("Project Explorer trusted view state", () => {
  it("uses the Project timezone for inclusive Custom dates", () => {
    expect(formatDateInput("2026-06-09T16:00:00.000Z", "Asia/Singapore")).toBe("2026-06-10");
    expect(formatDateInput("2026-06-16T15:59:59.999Z", "Asia/Singapore")).toBe("2026-06-16");
  });

  it("restores the fixed Overview handoff Project, Scope, resource, Period and evidence pins", () => {
    const view = explorerViewStateFromSearchParams(new URLSearchParams(
      "projectId=ngee-ann-polytechnic&scopeId=l7-load-4&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16&dataSnapshotId=snapshot-a&projectReleaseId=release-a&grain=day&comparison=selected&category=load",
    ));

    expect(view).toEqual({
      projectId: "ngee-ann-polytechnic",
      scopeId: "l7-load-4",
      resource: "electricity",
      period: "Custom",
      from: "2026-06-10",
      to: "2026-06-16",
      dataSnapshotId: "snapshot-a",
      projectReleaseId: "release-a",
    });

    expect(buildExplorerAnalysisRequest(view)).toEqual({
      projectId: "ngee-ann-polytechnic",
      scopeId: "l7-load-4",
      resource: "electricity",
      period: "Custom",
      from: "2026-06-10",
      to: "2026-06-16",
      expectedDataSnapshotId: "snapshot-a",
      expectedProjectReleaseId: "release-a",
    });
  });

  it("preserves supported previous Periods and rejects an invalid Custom range", () => {
    expect(explorerViewStateFromSearchParams(new URLSearchParams("period=Previous+month"))).toMatchObject({
      period: "Previous month",
      from: "",
      to: "",
    });
    expect(explorerViewStateFromSearchParams(new URLSearchParams(
      "period=Custom&from=2026-06-17&to=2026-06-16&resource=unknown",
    ))).toMatchObject({
      resource: "electricity",
      period: "Custom",
      from: "",
      to: "",
    });
  });

  it("serializes the selected Scope and Period so refresh restores the Explorer view", () => {
    expect(explorerUrlWithView({
      projectId: "preschool-demo",
      scopeId: "centre-12",
      resource: "electricity",
      period: "Previous month",
      from: "",
      to: "",
      dataSnapshotId: "snapshot-p",
      projectReleaseId: "release-p",
    })).toBe(
      "/energyiq/explorer?projectId=preschool-demo&scopeId=centre-12&resource=electricity&period=Previous+month&dataSnapshotId=snapshot-p&projectReleaseId=release-p",
    );
  });

  it("does not present an empty trusted response as zero consumption", () => {
    const empty = analysisFixture({
      usageKwh: 0,
      validIntervalCount: 0,
      expectedMeterIntervalCount: 672,
      coveragePct: 0,
      dailyRows: [],
    });

    expect(hasExplorerFacts(empty)).toBe(false);
    expect(explorerTrendSeries(empty)).toEqual([]);
  });

  it("uses server-provided daily totals for the selected Scope trend", () => {
    const analysis = analysisFixture({
      usageKwh: 30,
      validIntervalCount: 288,
      expectedMeterIntervalCount: 288,
      coveragePct: 100,
      dailyRows: [
        { localDate: "2026-06-14", usageKwh: 12, coveragePct: 100 },
        { localDate: "2026-06-15", usageKwh: null, coveragePct: 0 },
        { localDate: "2026-06-16", usageKwh: 18, coveragePct: 100 },
      ],
    });

    expect(explorerTrendSeries(analysis)).toEqual([
      { date: "2026-06-14", usageKwh: 12, coveragePct: 100 },
      { date: "2026-06-15", usageKwh: null, coveragePct: 0 },
      { date: "2026-06-16", usageKwh: 18, coveragePct: 100 },
    ]);
  });
});

function analysisFixture(input: {
  usageKwh: number;
  validIntervalCount: number;
  expectedMeterIntervalCount: number;
  coveragePct: number;
  dailyRows: Array<{ localDate: string; usageKwh: number | null; coveragePct: number }>;
}): EnergyScopeAnalysisDto {
  return {
    context: {
      userId: "dev-user",
      workspaceId: "default",
      projectId: "ngee-ann-polytechnic",
      projectName: "Ngee Ann Polytechnic",
      scopeId: "project",
      scopeName: "Ngee Ann Polytechnic",
      scopeType: "project",
      resource: "electricity",
      timezone: "Asia/Singapore",
      from: "2026-06-13T16:00:00.000Z",
      to: "2026-06-16T16:00:00.000Z",
      endExclusive: true,
      period: "Custom",
      hierarchyRevisionId: "hierarchy-v1",
      meterMappingRevisionId: "mapping-v1",
      meterFormulaRevisionId: "formula-v1",
      dataSnapshotId: "snapshot-v1",
      metricVersion: "metric-v1",
      businessCalendarVersion: "calendar-v1",
      tariffScheduleVersion: "tariff-v1",
      resolvedAt: "2026-06-17T00:00:00.000Z",
    },
    summary: {
      usageKwh: input.usageKwh,
      averageDailyUsageKwh: input.usageKwh / Math.max(input.dailyRows.length, 1),
      peakKw: 5,
      validIntervalCount: input.validIntervalCount,
      qualityEventCount: 0,
    },
    hourlyProfile: [],
    comparison: {
      from: "2026-06-10T16:00:00.000Z",
      to: "2026-06-13T16:00:00.000Z",
      usageKwh: 20,
      changeKwh: 10,
      changePct: 50,
    },
    categories: [],
    childScopes: [],
    circuits: [],
    topCircuits: [],
    virtualMeters: [],
    dailyTotals: {
      metricId: "energy.total_usage_kwh@1",
      grain: "day",
      timezone: "Asia/Singapore",
      scopes: [{
        scopeId: "project",
        scopeName: "Ngee Ann Polytechnic",
        scopeType: "project",
        rows: input.dailyRows.map((row) => ({
          localDate: row.localDate,
          from: `${row.localDate}T00:00:00.000Z`,
          to: `${row.localDate}T23:59:59.999Z`,
          usageKwh: row.usageKwh,
          dataHealth: {
            status: row.usageKwh === null ? "unavailable" : "complete",
            coveragePct: row.coveragePct,
            expectedMeterIntervalCount: 96,
            validIntervalCount: row.usageKwh === null ? 0 : 96,
            qualityEventCount: 0,
          },
        })),
      }],
    },
    offHours: {
      status: "unavailable",
      reason: { code: "OPERATING_FACTS_UNAVAILABLE", message: "Unavailable" },
    },
    cost: {
      status: "unavailable",
      reason: { code: "COST_FACTS_UNAVAILABLE", message: "Unavailable" },
    },
    dataHealth: {
      status: input.validIntervalCount === 0 ? "unavailable" : "complete",
      coveragePct: input.coveragePct,
      expectedMeterIntervalCount: input.expectedMeterIntervalCount,
      validIntervalCount: input.validIntervalCount,
      qualityEventCount: 0,
      cumulativeDeltaMismatchCount: 0,
      averageKwMismatchCount: 0,
      invalidIntervalDurationCount: 0,
      importBatchIds: [],
    },
    units: {
      usage: "kWh",
      demand: "kW",
      intervalMinutes: 15,
      timezone: "Asia/Singapore",
    },
    attention: [],
    provenance: {
      dataSnapshotId: "snapshot-v1",
      hierarchyRevisionId: "hierarchy-v1",
      meterMappingRevisionId: "mapping-v1",
      meterFormulaRevisionId: "formula-v1",
      metricVersion: "metric-v1",
      ruleRevisionIds: [],
      aggregationRule: "designated_total",
      sourceView: "energy_facts",
      queryIds: ["scope_summary_v1", "daily_totals_v1", "hourly_profile_v1"],
    },
  };
}
