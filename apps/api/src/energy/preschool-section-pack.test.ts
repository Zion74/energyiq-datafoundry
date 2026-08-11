import { describe, expect, it } from "vitest";

import { createOverviewAiArtifactIdentity } from "./overview-ai-artifact.js";
import type { ProjectAnalysisSnapshot } from "./project-analysis-resolver.js";
import { assemblePreschoolSectionPacks } from "./preschool-section-pack.js";

describe("assemblePreschoolSectionPacks", () => {
  it("uses the pinned Snapshot projections for four bounded Section Packs", () => {
    const packs = assemblePreschoolSectionPacks({ identity: identity(), snapshot: snapshot() });

    expect(packs.map(({ sectionId }) => sectionId)).toEqual([
      "centre-benchmark",
      "standby-wastage",
      "operating-behaviour",
      "planning-outlook",
    ]);
    expect(packs.every(({ binding }) => binding.dataSnapshotId === "snapshot-current")).toBe(true);
    expect(packs.find(({ sectionId }) => sectionId === "centre-benchmark")).toMatchObject({
      evidence: [{
        entityRefs: ["centre-a1"],
        evidenceRefs: [
          "preschool:snapshot-current:section-2-benchmark",
          "query:benchmark-query",
        ],
      }],
    });
    expect(packs.find(({ sectionId }) => sectionId === "planning-outlook")).toMatchObject({
      evidence: [{
        value: {
          planDataSnapshotId: "snapshot-plan",
          actualDataSnapshotId: "snapshot-current",
        },
      }],
    });
    expect(JSON.stringify(packs)).not.toContain("schema");
  });

  it("rejects a stale Snapshot before building any Pack", () => {
    expect(() => assemblePreschoolSectionPacks({
      identity: identity(),
      snapshot: snapshot("snapshot-stale"),
    })).toThrow("PRESCHOOL_SECTION_PACK_IDENTITY_MISMATCH");
  });
});

const identity = () => createOverviewAiArtifactIdentity({
  workspaceId: "preschool-workspace",
  projectId: "preschool-demo",
  scopeId: "preschool-project",
  dataSnapshotId: "snapshot-current",
  projectReleaseId: "release-current",
  analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
  analysisPeriodTo: "2026-06-01T00:00:00.000Z",
  rendererKey: "preschool-overview",
  rendererVersion: "1",
  modelProfileId: "workspace-default-model-profile",
  modelProfileRevision: 1,
});

const snapshot = (dataSnapshotId = "snapshot-current"): ProjectAnalysisSnapshot => ({
  context: {
    workspaceId: "preschool-workspace",
    projectId: "preschool-demo",
    scopeId: "preschool-project",
    primaryPeriod: {
      start: "2026-05-01T00:00:00.000Z",
      endExclusive: "2026-06-01T00:00:00.000Z",
    },
  },
  projectRelease: { id: "release-current" },
  dataSnapshot: { id: dataSnapshotId },
  dataQuality: { status: "complete" },
  preschoolBenchmark: {
    status: "provisional",
    sampleSize: 30,
    portfolio: {
      eui: { p50: 80, p75: 100, unit: "kWh/m2/year" },
      perPax: { p50: 20, p75: 25, unit: "kWh/person/month" },
    },
    centres: [{
      scopeId: "centre-a1",
      centreCode: "A1",
      name: "Centre A1",
      cohort: "Childcare",
      usageKwh: 100,
      annualisedEuiKwhPerSqmYear: 120,
      mayKwhPerPerson: 30,
      quadrant: "priority",
      priority: true,
    }],
    evidence: {
      dataSnapshotId,
      projectReleaseId: "release-current",
      metadataStatus: "provisional",
      sourceQueryIds: ["benchmark-query"],
    },
  },
  preschoolOperational: {
    status: "available",
    energy: {
      totalKwh: 1000,
      standbyKwh: 200,
      standbySharePct: 20,
      operatingKwh: 800,
      operatingSharePct: 80,
      provisionalStandbyCostBeforeGstSgd: 60,
      provisionalOperatingCostBeforeGstSgd: 240,
    },
    standbyAppliances: { appliances: [] },
    operatingAppliances: { appliances: [] },
    spikes: {
      standby: { count: 3, centreCount: 1, centres: [] },
      operating: { count: 2, centreCount: 1, centres: [] },
    },
    sop: { breachingCentreCodes: ["A1"] },
    evidence: {
      dataSnapshotId,
      projectReleaseId: "release-current",
      sourceQueryIds: ["operational-query"],
    },
  },
  preschoolPlanningLifecycle: {
    status: "available",
    targetPeriod: { start: "2026-06-01", endExclusive: "2026-07-01", timezone: "Asia/Singapore", targetDayCount: 30 },
    plan: {
      usageEstimate: { projectedKwh: 1100, lowerKwh: 1000, upperKwh: 1200 },
      costEstimate: { projectedBeforeGstSgd: 330 },
      limitations: ["The estimate uses a simple weekly baseline."],
    },
    actual: { status: "partial", usageKwh: 400, completeDayCount: 10, targetDayCount: 30, varianceKwh: 20, variancePct: 5 },
    planProvenance: {
      savedAnalysisId: "saved-plan",
      dataSnapshotId: "snapshot-plan",
      projectReleaseId: "release-current",
      templateRevisionId: "template-current",
      queryId: "daily_totals_v1",
      recipeId: "preschool-naive-weekly-planning-baseline-v1",
    },
    actualProvenance: {
      dataSnapshotId,
      projectReleaseId: "release-current",
      queryId: "daily_totals_v1",
      period: { start: "2026-06-01", endExclusive: "2026-06-11", timezone: "Asia/Singapore" },
    },
  },
} as unknown as ProjectAnalysisSnapshot);
