import { describe, expect, it } from "vitest";

import type { PreschoolSectionPackV2 } from "./preschool-section-pack-v2.js";
import {
  MAX_PRESCHOOL_SECTION_MODEL_PROJECTION_CHARS,
  parsePreschoolSectionDiscoveryV4,
  projectPreschoolSectionPackV2ForModel,
} from "./preschool-section-discovery.js";

describe("Preschool Section discovery", () => {
  it("projects every peer in a rich Pack v2 without legacy steering fields or Top-N truncation", () => {
    const pack = richPack("centre-benchmark", 30);
    const projection = projectPreschoolSectionPackV2ForModel(pack);
    const serialized = JSON.stringify(projection);

    expect(projection.capabilityBoundary).toEqual({
      sourcePackRevision: "preschool-section-pack-v2",
      factAccess: "inline-complete",
      omittedEvidenceCount: 0,
      tools: ["compare_centres", "inspect_related_section_signals"],
    });
    expect(projection.evidence).toHaveLength(30);
    for (let index = 1; index <= 30; index += 1) {
      expect(serialized).toContain(`Centre ${index}`);
    }
    expect(serialized).not.toContain("decisionQuestion");
    expect(serialized).not.toContain("allowedNextChecks");
    expect(serialized).not.toContain("pageCoverage");
  });

  it("keeps a Portfolio plus 30-Centre planning outlook model-projectable without dropping management rows", () => {
    const pack = portfolioScalePlanningPack();
    const projection = projectPreschoolSectionPackV2ForModel(pack);
    const serialized = JSON.stringify(projection);
    const planningValue = projection.evidence[0]?.value as {
      forecast: {
        scopes: {
          encoding: { id: string; revision: string };
          scopeCount: number;
          bucketCounts: Record<string, number>;
          scopeTables: unknown[];
          bucketTables: unknown[];
        };
      };
    };

    expect(serialized.length).toBeLessThanOrEqual(MAX_PRESCHOOL_SECTION_MODEL_PROJECTION_CHARS);
    expect(planningValue.forecast.scopes).toMatchObject({
      encoding: { id: "energyiq-lossless-columnar-json", revision: "v1" },
      scopeCount: 31,
      bucketCounts: { daily: 930, weekly: 155, monthly: 31 },
      scopeTables: expect.any(Array),
      bucketTables: expect.any(Array),
    });
    expect(projection.capabilityBoundary).toMatchObject({
      factAccess: "inline-complete",
      omittedEvidenceCount: 0,
    });
    expect(projection.evidence[0]?.evidenceRefs).toEqual(["evidence:planning-outlook:portfolio-scale"]);
    for (const scopeId of [
      "preschool-project",
      ...Array.from({ length: 30 }, (_, index) => `centre-${index + 1}`),
    ]) expect(serialized).toContain(JSON.stringify(scopeId));
  });

  it("assigns binding at runtime and preserves malformed candidates for local acceptance rejection", () => {
    const pack = richPack("standby-wastage", 1);
    const discovery = parsePreschoolSectionDiscoveryV4({
      answer: JSON.stringify({
        sectionId: "standby-wastage",
        status: "available",
        summary: { text: "One event is supported.", evidenceRefs: ["evidence:1"] },
        candidates: [{
          candidateId: "model-controlled",
          kind: "next-check",
          title: "Malformed candidate",
          epistemicStatus: "observed",
          text: "",
          evidenceRefs: [],
        }, {
          title: "A possible operating explanation",
          epistemicStatus: "speculative",
          text: "A manual override could be one explanation worth exploring.",
          evidenceRefs: ["evidence:1"],
        }],
      }),
      expectedSectionId: "standby-wastage",
      binding: pack.binding,
    });

    expect(discovery.binding).toEqual(pack.binding);
    expect(discovery.status).toBe("available");
    if (discovery.status !== "available") throw new Error("expected available discovery");
    expect(discovery.candidates).toHaveLength(2);
    expect(discovery.candidates[0]).toMatchObject({ title: "", text: "", evidenceRefs: [] });
    expect(discovery.candidates[0]).not.toHaveProperty("candidateId");
    expect(discovery.candidates[0]).not.toHaveProperty("kind");
    expect(discovery.candidates[1]).toMatchObject({
      title: "A possible operating explanation",
      epistemicStatus: "speculative",
    });
  });
});

const richPack = (
  sectionId: PreschoolSectionPackV2["sectionId"],
  evidenceCount: number,
): PreschoolSectionPackV2 => ({
  contract: { id: "preschool-section-pack", revision: "preschool-section-pack-v2" },
  sectionId,
  audience: "non-technical energy manager",
  analysisGoal: "Find the most useful supported patterns and lines of inquiry.",
  binding: {
    workspaceId: "workspace-1",
    projectId: "preschool-demo",
    scopeId: "project",
    dataSnapshotId: "snapshot-1",
    projectReleaseId: "release-1",
    analysisPeriod: { from: "2026-05-01", to: "2026-05-31" },
    modelProfileId: "profile-1",
    modelProfileRevision: 1,
  },
  evidence: Array.from({ length: evidenceCount }, (_, index) => ({
    id: `evidence:${index + 1}`,
    label: `Centre ${index + 1}`,
    value: {
      centreCode: `Centre ${index + 1}`,
      absoluteUsage: { value: 100 + index, rank: { position: index + 1, outOf: evidenceCount } },
      floorAreaNormalised: { value: 10 + index / 10, percentileRankPct: 90 - index },
      peopleNormalised: { value: 20 + index / 10, percentileRankPct: 80 - index },
      metadataQuality: { status: "provisional" },
    },
    unit: "kWh, kWh/m2/year, kWh/person/month",
    entityRefs: [`centre-${index + 1}`],
    evidenceRefs: [`evidence:${index + 1}`],
  })),
  alreadyPresentedFacts: [{
    id: "page:summary",
    label: "Visible summary",
    value: { sampleSize: evidenceCount },
    evidenceRefs: ["evidence:1"],
  }],
  crossSectionIndex: [],
  dataQuality: completeDataQuality,
  limitations: [],
  missingEvidence: [],
  capabilities: {
    revision: "scoped-read-only-v1",
    mode: "scoped-read-only",
    tools: sectionId === "centre-benchmark"
      ? ["compare_centres", "inspect_related_section_signals"]
      : sectionId === "standby-wastage" || sectionId === "operating-behaviour"
        ? ["inspect_time_pattern", "inspect_load_composition", "inspect_related_section_signals"]
        : ["inspect_related_section_signals"],
  },
});

const completeDataQuality: PreschoolSectionPackV2["dataQuality"] = {
  status: "complete",
  coveragePct: 100,
  expectedMeterIntervalCount: 1,
  validIntervalCount: 1,
  qualityEventCount: 0,
  cumulativeDeltaMismatchCount: 0,
  averageKwMismatchCount: 0,
  invalidIntervalDurationCount: 0,
  importBatchIds: [],
};

const portfolioScalePlanningPack = (): PreschoolSectionPackV2 => {
  const pack = richPack("planning-outlook", 1);
  const scopes = Array.from({ length: 31 }, (_, index) => {
    const portfolio = index === 0;
    const scopeId = portfolio ? "preschool-project" : `centre-${index}`;
    const buckets = {
      daily: Array.from({ length: 30 }, (_, day) => planningBucket(day + 1, "day")),
      weekly: Array.from({ length: 5 }, (_, week) => planningBucket(week + 1, "week")),
      monthly: [planningBucket(1, "month")],
    };
    return {
      scopeId,
      scopeName: portfolio ? "All centres" : `Centre ${index}`,
      scopeType: portfolio ? "project" : "centre",
      scopeRole: portfolio ? "portfolio" : "centre",
      estimatedKwh: 1_000 + index,
      estimatedCostBeforeGstSgd: 300 + index,
      expectedFullMonthKwh: 1_100 + index,
      expectedFullMonthCostBeforeGstSgd: 330 + index,
      actualKwh: 400 + index,
      actualCostBeforeGstSgd: 120 + index,
      actualCompleteDayCount: 10,
      actualTargetDayCount: 30,
      actualThroughLocalDate: "2026-06-10",
      pacePct: 110,
      outcome: "above_plan",
      originalEstimateIdentity: `estimate:${scopeId}`,
      actualIdentity: `actual:${scopeId}`,
      currentOutlookIdentity: `outlook:${scopeId}`,
      buckets,
      currentOutlookVsPlan: { status: "available", varianceKwh: 100, variancePct: 10 },
    };
  });
  pack.evidence[0] = {
    id: "evidence:planning-outlook:portfolio-scale",
    label: "Saved plan, current actual and monthly outlook",
    value: {
      targetPeriod: {
        start: "2026-06-01",
        endExclusive: "2026-07-01",
        timezone: "Asia/Singapore",
        targetDayCount: 30,
      },
      plan: {
        usageEstimate: { projectedKwh: 31_000, lowerKwh: 29_000, upperKwh: 33_000 },
        costEstimate: { projectedBeforeGstSgd: 9_300 },
      },
      actual: { status: "partial", usageKwh: 12_000, completeDayCount: 10, targetDayCount: 30 },
      forecast: { status: "partial", scopes },
    },
    unit: "kWh, %, SGD before GST",
    entityRefs: scopes.map(({ scopeId }) => scopeId),
    evidenceRefs: ["evidence:planning-outlook:portfolio-scale"],
  };
  return pack;
};

const planningBucket = (ordinal: number, grain: "day" | "week" | "month") => ({
  start: `2026-06-${String(Math.min(ordinal, 30)).padStart(2, "0")}`,
  endExclusive: `2026-07-${String(Math.min(ordinal, 30)).padStart(2, "0")}`,
  grain,
  estimatedKwh: 100 + ordinal,
  originalEstimateKwh: 100 + ordinal,
  actualKwh: null,
  currentOutlookKwh: null,
  futureOutlookKwh: null,
  actualCompleteDayCount: 0,
  actualTargetDayCount: 1,
  actualStatus: "waiting",
});
