import { describe, expect, it } from "vitest";

import type {
  PreschoolAcceptedSectionInsightV4,
  PreschoolAcceptedSectionValueV4,
  PreschoolOverviewAiBindingV4,
} from "../../../../packages/contracts/src/energyiq-preschool-overview-ai.js";
import { publishPreschoolSectionInterpretation } from "./preschool-section-publication.js";

const binding: PreschoolOverviewAiBindingV4 = {
  workspaceId: "workspace-1",
  projectId: "preschool-demo",
  scopeId: "project",
  dataSnapshotId: "snapshot-1",
  projectReleaseId: "release-1",
  analysisPeriod: { from: "2026-05-01", to: "2026-05-31" },
  modelProfileId: "profile-1",
  modelProfileRevision: 3,
};

const insight = (
  sourceIndex: number,
  title: string,
  text: string,
): PreschoolAcceptedSectionInsightV4 => ({
  candidateId: `preschool:standby-wastage:candidate:${sourceIndex + 1}`,
  sourceIndex,
  title,
  epistemicStatus: "inferred",
  text,
  evidenceRefs: ["closed-hours:events"],
});

describe("Preschool Section publication", () => {
  it("publishes an available summary with zero insights without changing it to empty", () => {
    const result = publishPreschoolSectionInterpretation({
      accepted: {
        sectionId: "centre-benchmark",
        binding,
        status: "available",
        summary: {
          text: "The peer matrix is available for this period.",
          evidenceRefs: ["benchmark:peer-matrix"],
        },
        acceptedCandidates: [],
        rejectedCandidates: [],
      },
      providerProfileId: "profile-1",
      runId: "run-1",
      capability: { revision: "pack-only-v1", mode: "pack-only", tools: [] },
    });

    expect(result).toMatchObject({
      status: "available",
      insights: [],
      capability: { revision: "pack-only-v1", mode: "pack-only", tools: [] },
      publication: {
        discoveredCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        publishedCount: 0,
        suppressedCandidateIds: [],
      },
    });
  });

  it("publishes the first three distinct insights in model order with stable IDs and an audit trail", () => {
    const first = insight(0, "Event pattern", "The spike looks event-like rather than persistent.");
    const exactDuplicate = insight(1, "Event pattern", "The spike looks event-like rather than persistent.");
    const second = insight(2, "Closing boundary", "Events cluster near the closing boundary.");
    const third = insight(3, "Peer contrast", "Comparable centres do not show the same recurrence.");
    const overBudget = insight(4, "Watch next month", "Watch whether the pattern repeats next month.");
    const accepted: PreschoolAcceptedSectionValueV4 = {
      sectionId: "standby-wastage",
      binding,
      status: "available",
      summary: {
        text: "Closed-hour use is concentrated in a small set of events.",
        evidenceRefs: ["closed-hours:events"],
      },
      acceptedCandidates: [first, exactDuplicate, second, third, overBudget],
      rejectedCandidates: [{
        candidateId: "preschool:standby-wastage:candidate:6",
        sourceIndex: 5,
        code: "DATE_UNSUPPORTED",
      }],
    };

    const publish = () => publishPreschoolSectionInterpretation({
      accepted,
      providerProfileId: "profile-1",
      runId: "run-1",
      capability: { revision: "pack-only-v1", mode: "pack-only", tools: [] },
    });

    const result = publish();
    expect(result).toMatchObject({
      artifactKind: "section-interpretation",
      sectionId: "standby-wastage",
      status: "available",
      contract: {
        id: "preschool-section-interpretation",
        revision: "preschool-section-interpretation-v4",
      },
      packRevision: "v2",
      capability: { revision: "pack-only-v1", mode: "pack-only", tools: [] },
      insights: [
        {
          id: "preschool:standby-wastage:candidate:1",
          title: "Event pattern",
        },
        {
          id: "preschool:standby-wastage:candidate:3",
          title: "Closing boundary",
        },
        {
          id: "preschool:standby-wastage:candidate:4",
          title: "Peer contrast",
        },
      ],
      publication: {
        policyId: "preschool-section-publication",
        policyRevision: "v1",
        discoveredCount: 6,
        acceptedCount: 5,
        rejectedCount: 1,
        publishedCount: 3,
        suppressedCandidateIds: [
          "preschool:standby-wastage:candidate:2",
          "preschool:standby-wastage:candidate:5",
        ],
      },
    });
    expect(publish().insights.map(({ id }) => id)).toEqual(result.insights.map(({ id }) => id));
  });
});
