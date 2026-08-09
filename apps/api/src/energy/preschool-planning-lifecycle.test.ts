import type { EnergyIqSavedAnalysisRecord } from "@datafoundry/metadata";
import { describe, expect, it } from "vitest";

import {
  buildPreschoolJuneActualContext,
  buildPreschoolPlanningLifecycle,
  loadPreschoolPlanningLifecycleFromSavedAnalyses,
} from "./preschool-planning-lifecycle.js";

describe("buildPreschoolPlanningLifecycle", () => {
  it.each(["2", "3"] as const)(
    "recovers a legacy v%s Saved A plan without mutating it and withholds Day 7 variance",
    (operationalVersion) => {
      const compatible = savedAnalysis({ operationalVersion });
      const incompatible = {
        ...savedAnalysis({ operationalVersion }),
        id: "saved-newer-incompatible",
        scope_id: "centre-01",
        created_at: "2026-08-10T02:00:00.000Z",
      };
      const savedBytes = {
        analysis: compatible.analysis_json,
        snapshot: compatible.snapshot_json,
      };

      const result = buildPreschoolPlanningLifecycle({
        projectId: "preschool-demo",
        workspaceId: "workspace-preschool",
        scopeId: "project",
        resource: "electricity",
        templateRevisionId: "template-v1",
        projectReleaseId: "release-v1",
        currentDataSnapshotId: "snapshot-b",
        savedAnalyses: [incompatible, compatible],
        actualAnalysis: juneActualAnalysis(7),
      });

      expect(result).toMatchObject({
        status: "available",
        contract: {
          id: "preschool-saved-plan-current-actual",
          version: "1",
        },
        targetPeriod: {
          start: "2026-06-01",
          endExclusive: "2026-07-01",
          timezone: "Asia/Singapore",
          targetDayCount: 30,
        },
        plan: {
          status: "provisional",
          usageEstimate: { projectedKwh: 3525 },
          evidence: {
            dataSnapshotId: "snapshot-a",
            queryId: "daily_totals_v1",
            recipeId: "preschool-naive-weekly-planning-baseline-v1",
          },
        },
        actual: {
          status: "partial",
          usageKwh: 1400,
          completeDayCount: 7,
          targetDayCount: 30,
          varianceKwh: null,
          variancePct: null,
        },
        planProvenance: {
          savedAnalysisId: "saved-a",
          dataSnapshotId: "snapshot-a",
          projectReleaseId: "release-v1",
          templateRevisionId: "template-v1",
        },
        actualProvenance: {
          dataSnapshotId: "snapshot-b",
          projectReleaseId: "release-v1",
          queryId: "daily_totals_v1",
        },
      });
      expect(compatible.analysis_json).toBe(savedBytes.analysis);
      expect(compatible.snapshot_json).toBe(savedBytes.snapshot);
    },
  );

  it("recovers the formal current-overview Saved A from four complete May 4-31 weeks", () => {
    const compatible = savedAnalysis({
      operationalVersion: "3",
      firstMayDay: 4,
    });

    const result = buildPreschoolPlanningLifecycle({
      projectId: "preschool-demo",
      workspaceId: "workspace-preschool",
      scopeId: "project",
      resource: "electricity",
      templateRevisionId: "template-v1",
      projectReleaseId: "release-v1",
      currentDataSnapshotId: "snapshot-b",
      savedAnalyses: [compatible],
      actualAnalysis: juneActualAnalysis(7),
    });

    expect(result).toMatchObject({
      status: "available",
      plan: {
        status: "provisional",
        sourceWeeks: [
          { start: "2026-05-04", endInclusive: "2026-05-10", usageKwh: 749 },
          { start: "2026-05-11", endInclusive: "2026-05-17", usageKwh: 798 },
          { start: "2026-05-18", endInclusive: "2026-05-24", usageKwh: 847 },
          { start: "2026-05-25", endInclusive: "2026-05-31", usageKwh: 896 },
        ],
        usageEstimate: { projectedKwh: 3525 },
        costEstimate: { currentPeriodBeforeGstSgd: 897.183 },
        limitations: expect.arrayContaining([
          expect.stringContaining("May 4-31 source window"),
        ]),
      },
      actual: {
        status: "partial",
        completeDayCount: 7,
        varianceKwh: null,
        variancePct: null,
      },
    });
  });

  it("keeps Day 1 actual partial and withholds variance", () => {
    const result = buildLifecycle(juneActualAnalysis(1));

    expect(result).toMatchObject({
      status: "available",
      actual: {
        status: "partial",
        usageKwh: 200,
        completeDayCount: 1,
        targetDayCount: 30,
        varianceKwh: null,
        variancePct: null,
      },
    });
  });

  it("shows plan-versus-actual delta only after all 30 June days are complete", () => {
    const result = buildLifecycle(juneActualAnalysis(30));

    expect(result).toMatchObject({
      status: "available",
      actual: {
        status: "complete",
        usageKwh: 6000,
        completeDayCount: 30,
        targetDayCount: 30,
        varianceKwh: 2475,
        variancePct: 70.21,
      },
    });
  });

  it("fails closed when actual Evidence is not the current B Snapshot or fixed June window", () => {
    const wrongSnapshot = juneActualAnalysis(7);
    wrongSnapshot.provenance.dataSnapshotId = "snapshot-c";
    const rollingWindow = juneActualAnalysis(7);
    rollingWindow.context.from = "2026-06-03T16:00:00.000Z";

    expect(buildLifecycle(wrongSnapshot)).toMatchObject({
      status: "unavailable",
      reason: { code: "CURRENT_ACTUAL_UNAVAILABLE" },
    });
    expect(buildLifecycle(rollingWindow)).toMatchObject({
      status: "unavailable",
      reason: { code: "CURRENT_ACTUAL_UNAVAILABLE" },
    });
  });
});

describe("buildPreschoolJuneActualContext", () => {
  it("pins the existing current B Snapshot and release inputs to June 1-July 1", () => {
    const context = buildPreschoolJuneActualContext({
      userId: "user-admin",
      workspaceId: "workspace-preschool",
      projectId: "preschool-demo",
      projectName: "Preschool Portfolio",
      scopeId: "project",
      scopeName: "Preschool Portfolio",
      scopeType: "project",
      resource: "electricity",
      timezone: "Asia/Singapore",
      from: "2026-06-02T16:00:00.000Z",
      to: "2026-06-30T16:00:00.000Z",
      endExclusive: true,
      period: "Custom",
      hierarchyRevisionId: "hierarchy-v1",
      meterMappingRevisionId: "mapping-v1",
      meterFormulaRevisionId: "formula-v1",
      dataSnapshotId: "snapshot-b",
      metricVersion: "energy.total_usage_kwh@1",
      businessCalendarVersion: "calendar-v1",
      tariffScheduleVersion: "tariff-v1",
      resolvedAt: "2026-08-10T00:00:00.000Z",
    });

    expect(context).toMatchObject({
      from: "2026-05-31T16:00:00.000Z",
      to: "2026-06-30T16:00:00.000Z",
      period: "Custom",
      timezone: "Asia/Singapore",
      dataSnapshotId: "snapshot-b",
      hierarchyRevisionId: "hierarchy-v1",
      meterMappingRevisionId: "mapping-v1",
      meterFormulaRevisionId: "formula-v1",
    });
  });
});

describe("loadPreschoolPlanningLifecycleFromSavedAnalyses", () => {
  it("does not invoke the June Kernel callback without a compatible older Saved A", async () => {
    let actualLoadCount = 0;

    const result = await loadPreschoolPlanningLifecycleFromSavedAnalyses({
      projectId: "preschool-demo",
      workspaceId: "workspace-preschool",
      scopeId: "project",
      resource: "electricity",
      templateRevisionId: "template-v1",
      projectReleaseId: "release-v1",
      currentDataSnapshotId: "snapshot-b",
      savedAnalyses: [],
      loadActualAnalysis: async () => {
        actualLoadCount += 1;
        return juneActualAnalysis(30);
      },
    });

    expect(result).toMatchObject({
      status: "unavailable",
      reason: { code: "NO_COMPATIBLE_SAVED_ANALYSIS" },
    });
    expect(actualLoadCount).toBe(0);
  });
});

const buildLifecycle = (actualAnalysis: ReturnType<typeof juneActualAnalysis>) => (
  buildPreschoolPlanningLifecycle({
    projectId: "preschool-demo",
    workspaceId: "workspace-preschool",
    scopeId: "project",
    resource: "electricity",
    templateRevisionId: "template-v1",
    projectReleaseId: "release-v1",
    currentDataSnapshotId: "snapshot-b",
    savedAnalyses: [savedAnalysis({ operationalVersion: "3" })],
    actualAnalysis,
  })
);

const savedAnalysis = (input: {
  operationalVersion: "2" | "3";
  firstMayDay?: number;
}): EnergyIqSavedAnalysisRecord => {
  const analysis = mayAnalysis(input.firstMayDay ?? 1);
  return {
    id: "saved-a",
    series_id: "series-a",
    sequence: 1,
    project_id: "preschool-demo",
    workspace_id: "workspace-preschool",
    scope_id: "project",
    scope_name: "Preschool Portfolio",
    resource: "electricity",
    title: "Saved May Overview",
    query_json: JSON.stringify({
      projectId: "preschool-demo",
      scopeId: "project-alias",
      resource: "electricity",
      period: "Custom",
      from: "2026-05-01",
      to: "2026-05-31",
    }),
    analysis_json: JSON.stringify(analysis),
    snapshot_json: JSON.stringify({
      context: {
        projectId: "preschool-demo",
        workspaceId: "workspace-preschool",
        scopeId: "project",
        resource: "electricity",
        dataSnapshotId: "snapshot-a",
      },
      projectRelease: {
        id: "release-v1",
        templateRevisionId: "template-v1",
      },
      renderer: { key: "preschool-overview" },
      dataSnapshot: { id: "snapshot-a" },
      preschoolOperational: {
        status: "available",
        contract: {
          id: "preschool-may-2026-operational-behaviour",
          version: input.operationalVersion,
        },
      },
      analysis,
    }),
    template_revision_id: "template-v1",
    data_snapshot_id: "snapshot-a",
    created_by: "user-admin",
    created_at: "2026-08-10T01:00:00.000Z",
  };
};

const mayAnalysis = (firstMayDay: number) => ({
  context: { scopeId: "project" },
  offHours: {
    status: "available",
    operatingKwh: 1,
    standbyKwh: 1,
    usageKwh: 2,
    sharePct: 50,
    timezone: "Asia/Singapore",
    businessCalendarVersion: "calendar-v1",
  },
  provenance: {
    dataSnapshotId: "snapshot-a",
    hierarchyRevisionId: "hierarchy-v1",
    meterMappingRevisionId: "mapping-v1",
    meterFormulaRevisionId: "formula-v1",
    metricVersion: "energy.total_usage_kwh@1",
    ruleRevisionIds: [],
    aggregationRule: "designated_total",
    sourceView: "energy_interval_facts",
    queryIds: ["daily_totals_v1"],
  },
  dailyTotals: {
    metricId: "energy.total_usage_kwh@1",
    grain: "day",
    timezone: "Asia/Singapore",
    scopes: [{
      scopeId: "project",
      scopeName: "Preschool Portfolio",
      scopeType: "project",
      rows: Array.from({ length: 32 - firstMayDay }, (_, offset) => dailyRow({
        localDate: `2026-05-${String(offset + firstMayDay).padStart(2, "0")}`,
        usageKwh: 100 + firstMayDay + offset,
        status: "complete",
      })),
    }],
  },
});

const juneActualAnalysis = (completeDayCount: number) => ({
  context: {
    scopeId: "project",
    from: "2026-05-31T16:00:00.000Z",
    to: "2026-06-30T16:00:00.000Z",
    timezone: "Asia/Singapore",
  },
  provenance: {
    dataSnapshotId: "snapshot-b",
    queryIds: ["daily_totals_v1"],
  },
  dailyTotals: {
    timezone: "Asia/Singapore",
    scopes: [{
      scopeId: "project",
      rows: Array.from({ length: 30 }, (_, offset) => dailyRow({
        localDate: `2026-06-${String(offset + 1).padStart(2, "0")}`,
        usageKwh: offset < completeDayCount ? 200 : null,
        status: offset < completeDayCount ? "complete" : "unavailable",
      })),
    }],
  },
});

const dailyRow = (input: {
  localDate: string;
  usageKwh: number | null;
  status: "complete" | "partial" | "unavailable";
}) => ({
  localDate: input.localDate,
  from: `${input.localDate}T00:00:00.000Z`,
  to: `${input.localDate}T23:59:59.999Z`,
  usageKwh: input.usageKwh,
  dataHealth: {
    status: input.status,
    coveragePct: input.status === "complete" ? 100 : 0,
    expectedMeterIntervalCount: 48,
    validIntervalCount: input.status === "complete" ? 48 : 0,
    qualityEventCount: 0,
  },
});
