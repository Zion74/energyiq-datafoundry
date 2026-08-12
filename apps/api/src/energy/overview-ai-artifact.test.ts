import { describe, expect, it } from "vitest";

import {
  createOverviewAiArtifactIdentity,
  createPreschoolOverviewAiValueArtifactIdentity,
  overviewAiArtifactPinnedLocalPeriod,
} from "./overview-ai-artifact.js";

describe("createOverviewAiArtifactIdentity", () => {
  it("is shared across users but changes with Snapshot or model binding revision", () => {
    const base = {
      workspaceId: "preschool-demo-org",
      projectId: "preschool-demo",
      scopeId: "preschool-project",
      dataSnapshotId: "snapshot-a",
      projectReleaseId: "release-v1",
      analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
      analysisPeriodTo: "2026-06-01T00:00:00.000Z",
      rendererKey: "preschool-overview" as const,
      rendererVersion: "1",
      modelProfileId: "deepseek-v4-flash",
      modelProfileRevision: 8,
    };

    expect(createOverviewAiArtifactIdentity(base)).toEqual({
      workspaceId: "preschool-demo-org",
      projectId: "preschool-demo",
      scopeId: "preschool-project",
      resource: "electricity",
      dataSnapshotId: "snapshot-a",
      projectReleaseId: "release-v1",
      analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
      analysisPeriodTo: "2026-06-01T00:00:00.000Z",
      rendererKey: "preschool-overview",
      rendererVersion: "1",
      analysisPackId: "preschool-analysis-pack",
      analysisPackRevision: "v1",
      modelProfileId: "deepseek-v4-flash",
      modelProfileRevision: 8,
      outputContractRevision: "v13",
      validatorRevision: "preschool-ai-two-stage-fact-boundary-v7",
      workflowRevision: "preschool-two-stage-v2",
      investigatorPromptRevision: "preschool-investigator-v15",
      editorPromptRevision: "preschool-insight-editor-v7",
      methodSkillId: "energy-insight-investigation",
      methodSkillRevision: "1.0.0",
    });
    expect(createOverviewAiArtifactIdentity({ ...base, dataSnapshotId: "snapshot-b" }))
      .not.toEqual(createOverviewAiArtifactIdentity(base));
    expect(createOverviewAiArtifactIdentity({ ...base, modelProfileRevision: 9 }))
      .not.toEqual(createOverviewAiArtifactIdentity(base));
    expect(createOverviewAiArtifactIdentity({ ...base, analysisPeriodTo: "2026-06-02T00:00:00.000Z" }))
      .not.toEqual(createOverviewAiArtifactIdentity(base));
  });

  it("fails closed for a Renderer without a released Overview AI contract", () => {
    expect(() => createOverviewAiArtifactIdentity({
      workspaceId: "workspace",
      projectId: "unknown-project",
      scopeId: "project",
      dataSnapshotId: "snapshot",
      projectReleaseId: "release",
      analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
      analysisPeriodTo: "2026-06-01T00:00:00.000Z",
      rendererKey: "unknown-overview",
      rendererVersion: "1",
      modelProfileId: "profile",
      modelProfileRevision: 1,
    })).toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_CONTRACT_NOT_FOUND");
  });

  it("isolates Section and Executive value identities without changing the legacy identity", () => {
    const legacy = createOverviewAiArtifactIdentity({
      workspaceId: "preschool-demo-org",
      projectId: "preschool-demo",
      scopeId: "preschool-project",
      dataSnapshotId: "snapshot-a",
      projectReleaseId: "release-v1",
      analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
      analysisPeriodTo: "2026-06-01T00:00:00.000Z",
      rendererKey: "preschool-overview",
      rendererVersion: "1",
      modelProfileId: "deepseek-v4-flash",
      modelProfileRevision: 8,
    });
    const benchmark = createPreschoolOverviewAiValueArtifactIdentity({
      baseIdentity: legacy,
      artifactKind: "section-interpretation",
      targetId: "centre-benchmark",
    });
    const standby = createPreschoolOverviewAiValueArtifactIdentity({
      baseIdentity: legacy,
      artifactKind: "section-interpretation",
      targetId: "standby-wastage",
    });
    const executive = createPreschoolOverviewAiValueArtifactIdentity({
      baseIdentity: legacy,
      artifactKind: "executive-synthesis",
      targetId: "sections:none",
    });

    expect(legacy).not.toHaveProperty("artifactKind");
    expect(benchmark).toMatchObject({
      artifactKind: "section-interpretation",
      targetId: "centre-benchmark",
      outputContractRevision: "preschool-section-interpretation-v1",
      validatorRevision: "preschool-section-interpreter-validator-v7",
      workflowRevision: "preschool-section-interpreter-v7",
      investigatorPromptRevision: "preschool-section-interpreter-prompt-v8",
    });
    expect(standby).not.toEqual(benchmark);
    expect(executive).toMatchObject({
      artifactKind: "executive-synthesis",
      targetId: "sections:none",
      outputContractRevision: "preschool-executive-synthesis-v1",
      validatorRevision: "preschool-executive-synthesis-validator-v3",
      workflowRevision: "preschool-executive-synthesis-v7",
    });
    expect(() => createPreschoolOverviewAiValueArtifactIdentity({
      baseIdentity: legacy,
      artifactKind: "section-interpretation",
    })).toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_TARGET_REQUIRED");
    expect(() => createPreschoolOverviewAiValueArtifactIdentity({
      baseIdentity: legacy,
      artifactKind: "executive-synthesis",
    })).toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_TARGET_REQUIRED");
  });
});

describe("overviewAiArtifactPinnedLocalPeriod", () => {
  it("converts Snapshot ISO boundaries to the Project-local inclusive date range", () => {
    expect(overviewAiArtifactPinnedLocalPeriod({
      identity: {
        analysisPeriodFrom: "2026-05-10T16:00:00.000Z",
        analysisPeriodTo: "2026-06-07T16:00:00.000Z",
      },
      timezone: "Asia/Singapore",
    })).toEqual({ from: "2026-05-11", to: "2026-06-07" });
  });

  it("fails closed when the exclusive boundary does not follow the start date", () => {
    expect(() => overviewAiArtifactPinnedLocalPeriod({
      identity: {
        analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
        analysisPeriodTo: "2026-05-01T00:00:00.000Z",
      },
      timezone: "UTC",
    })).toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_PERIOD_INVALID");
  });
});
