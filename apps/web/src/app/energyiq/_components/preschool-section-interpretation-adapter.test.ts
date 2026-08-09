import { describe, expect, it } from "vitest";

import {
  PRESCHOOL_AI_ACCEPTED_CONTRACT_REVISION,
  PRESCHOOL_AI_EDITOR_PROMPT_REVISION,
  PRESCHOOL_AI_INVESTIGATOR_PROMPT_REVISION,
  PRESCHOOL_AI_METHOD_SKILL_ID,
  PRESCHOOL_AI_METHOD_SKILL_REVISION,
  PRESCHOOL_AI_WORKFLOW_REVISION,
  type PreschoolAiAcceptedArtifact,
  type PreschoolAiArtifactBinding,
} from "./preschool-ai-artifact";
import { adaptPreschoolAiArtifactToSectionInterpretation } from "./preschool-section-interpretation-adapter";

const binding: PreschoolAiArtifactBinding = {
  projectId: "preschool-demo",
  scopeId: "preschool-demo-project",
  dataSnapshotId: "snapshot-may",
  projectReleaseId: "release-may",
  dataCutoff: "2026-06-01T00:00:00.000Z",
  analysisPeriod: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
  outputContractRevision: PRESCHOOL_AI_ACCEPTED_CONTRACT_REVISION,
};

describe("Preschool section interpretation adapter", () => {
  it("maps the first exact section finding without generating a second template narrative", () => {
    expect(adaptPreschoolAiArtifactToSectionInterpretation({
      candidate: artifact(),
      expected: binding,
      target: "preschool.benchmark",
      mode: "live",
    })).toEqual({
      status: "available",
      dataSnapshotId: "snapshot-may",
      projectReleaseId: "release-may",
      period: { start: "2026-05-01T00:00:00.000Z", endExclusive: "2026-06-01T00:00:00.000Z" },
      headline: "Three Centres remain inefficient after normalisation",
      summary: "G, M and J need review first. The same Centres stay high under both normalisations.",
      actions: ["Ask the three Centre managers to check operating schedules.", "Compare their next complete month."],
      epistemicLevel: "verified",
    });
  });

  it("fails closed for a stale Snapshot and does not reuse its text", () => {
    expect(adaptPreschoolAiArtifactToSectionInterpretation({
      candidate: artifact(),
      expected: { ...binding, dataSnapshotId: "snapshot-june" },
      target: "preschool.benchmark",
      mode: "live",
    })).toMatchObject({ status: "unavailable" });
  });

  it("distinguishes a live pending result from a saved result with no Artifact", () => {
    expect(adaptPreschoolAiArtifactToSectionInterpretation({
      candidate: undefined,
      expected: binding,
      target: "preschool.standby",
      mode: "live",
    })).toMatchObject({ status: "pending", dataSnapshotId: "snapshot-may" });
    expect(adaptPreschoolAiArtifactToSectionInterpretation({
      candidate: undefined,
      expected: binding,
      target: "preschool.standby",
      mode: "saved",
    })).toEqual({ status: "unavailable", detail: "No completed AI interpretation was saved for this section." });
  });
});

function artifact(): PreschoolAiAcceptedArtifact {
  return {
    status: "available",
    providerProfileId: "profile-1",
    runId: "editor-run",
    packId: "preschool-analysis-pack",
    packRevision: "v1",
    contract: { id: "preschool-ai-accepted-artifact", revision: PRESCHOOL_AI_ACCEPTED_CONTRACT_REVISION },
    binding,
    workflow: {
      id: "preschool-two-stage",
      revision: PRESCHOOL_AI_WORKFLOW_REVISION,
      methodSkill: { id: PRESCHOOL_AI_METHOD_SKILL_ID, revision: PRESCHOOL_AI_METHOD_SKILL_REVISION },
      stages: {
        investigator: { runId: "investigator-run", promptRevision: PRESCHOOL_AI_INVESTIGATOR_PROMPT_REVISION },
        editor: { runId: "editor-run", promptRevision: PRESCHOOL_AI_EDITOR_PROMPT_REVISION },
      },
    },
    findings: [{
      id: "benchmark-priority",
      binding,
      placementTargets: ["preschool.benchmark"],
      epistemicLevel: "verified",
      relationship: "supports",
      signalRefs: ["efficiency"],
      title: "Three Centres remain inefficient after normalisation",
      takeaway: "G, M and J need review first.",
      interpretation: "The same Centres stay high under both normalisations.",
      action: "Ask the three Centre managers to check operating schedules.",
      verification: "Compare their next complete month.",
      evidence: {
        snapshotId: binding.dataSnapshotId,
        period: binding.analysisPeriod,
        deterministic: [{
          id: "benchmark:priority",
          kind: "benchmark",
          label: "Priority Centres",
          unit: "count",
          values: { count: 3 },
          queryIds: ["benchmark-query"],
          limitation: null,
        }],
        tools: [],
      },
    }],
  };
}
