import { describe, expect, it } from "vitest";

import type { PreschoolSectionPackV2 } from "./preschool-section-pack-v2.js";
import {
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
      tools: [],
    });
    expect(projection.evidence).toHaveLength(30);
    for (let index = 1; index <= 30; index += 1) {
      expect(serialized).toContain(`Centre ${index}`);
    }
    expect(serialized).not.toContain("decisionQuestion");
    expect(serialized).not.toContain("allowedNextChecks");
    expect(serialized).not.toContain("pageCoverage");
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
  capabilities: { revision: "pack-only-v1", mode: "pack-only", tools: [] },
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
