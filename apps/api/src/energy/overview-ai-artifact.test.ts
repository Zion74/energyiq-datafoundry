import { describe, expect, it } from "vitest";

import {
  createOverviewAiArtifactIdentity,
  createPreschoolOverviewAiSectionArtifactIdentityV4,
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

  it("uses the released v4 Section identity while leaving Executive and the legacy identity unchanged", () => {
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
    const benchmark = createPreschoolOverviewAiSectionArtifactIdentityV4({
      baseIdentity: legacy,
      targetId: "centre-benchmark",
    });
    const standby = createPreschoolOverviewAiSectionArtifactIdentityV4({
      baseIdentity: legacy,
      targetId: "standby-wastage",
    });
    const legacySection = createPreschoolOverviewAiValueArtifactIdentity({
      baseIdentity: legacy,
      artifactKind: "section-interpretation",
      targetId: "centre-benchmark",
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
      identityContractRevision: "v4",
      analysisPackId: "preschool-section-pack",
      analysisPackRevision: "v2",
      outputContractRevision: "preschool-section-interpretation-v4",
      validatorRevision: "acceptance-validator-v2",
      workflowRevision: "discover-tools-accept-publish-v1",
      investigatorPromptRevision: "discovery-prompt-v2",
      capabilityRevision: "scoped-read-only-v1",
      publicationRevision: "v1",
    });
    expect(standby).not.toEqual(benchmark);
    expect(legacySection).toMatchObject({
      outputContractRevision: "preschool-section-interpretation-v3",
      validatorRevision: "preschool-section-interpreter-validator-v12",
      workflowRevision: "preschool-section-interpreter-v14",
      investigatorPromptRevision: "preschool-section-interpreter-prompt-v14",
    });
    expect(legacySection).not.toHaveProperty("identityContractRevision");
    expect(executive).toMatchObject({
      artifactKind: "executive-synthesis",
      targetId: "sections:none",
      outputContractRevision: "preschool-executive-synthesis-v1",
      validatorRevision: "preschool-executive-synthesis-validator-v3",
      workflowRevision: "preschool-executive-synthesis-v9",
      investigatorPromptRevision: "preschool-executive-synthesis-prompt-v2",
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
