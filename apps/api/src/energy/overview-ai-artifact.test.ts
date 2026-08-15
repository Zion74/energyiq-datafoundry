import { describe, expect, it } from "vitest";

import {
  createOverviewAiArtifactIdentity,
  createPreschoolOverviewAiExecutiveArtifactIdentityV4,
  createPreschoolAdditionalAiInsightArtifactIdentity,
  createPreschoolOverviewAiSectionArtifactIdentityV4,
  createPreschoolOverviewAiValueArtifactIdentity,
  isCurrentPreschoolAdditionalAiInsightArtifactIdentity,
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

  it("uses the released current Section and Executive identities while leaving legacy history unchanged", () => {
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
      validatorRevision: "acceptance-validator-v12",
      workflowRevision: "discover-tools-accept-publish-v2",
      investigatorPromptRevision: "discovery-prompt-v11",
      capabilityRevision: "scoped-read-only-v1",
      publicationRevision: "v1",
    });
    expect(standby).not.toEqual(benchmark);
    expect(createPreschoolOverviewAiExecutiveArtifactIdentityV4({
      baseIdentity: legacy,
      targetId: "sections:current-v4",
    })).toMatchObject({
      validatorRevision: "preschool-executive-synthesis-validator-v19",
      workflowRevision: "preschool-executive-synthesis-v10",
      investigatorPromptRevision: "preschool-executive-synthesis-prompt-v11",
      capabilityRevision: "section-artifacts-and-overview-evidence-v2",
    });
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

  it("derives the current Additional Insight identity from the server-owned Method Set", () => {
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
    const identity = createPreschoolAdditionalAiInsightArtifactIdentity({
      baseIdentity: legacy,
    });

    expect(identity).toMatchObject({
      artifactKind: "autonomous-insights",
      identityContractRevision: "additional-insights-v14",
      analysisPackId: "preschool-additional-insights-pack",
      analysisPackRevision: "v1",
      outputContractRevision: "energyiq-additional-ai-insights-v2",
      validatorRevision: "additional-insights-acceptance-v11",
      workflowRevision: "additional-insights-discover-accept-publish-v14",
      investigatorPromptRevision: "additional-insights-discovery-v10",
      editorPromptRevision: "additional-insights-publication-v2",
      methodSkillId: "energyiq-open-discovery",
      methodSkillRevision: "1.0.0",
      methodSetId: "preschool-additional-insights-current",
      methodSetRevision: "v1",
      methodSetFingerprint: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      capabilityRevision: "scoped-read-only-v1",
      publicationRevision: "additional-insights-v2",
      canvasRevision: "energyiq-insight-canvas-v2",
    });
    expect(identity).not.toHaveProperty("targetId");
    expect(identity.methodSetFingerprint).not.toBe(identity.methodSkillRevision);
    expect(isCurrentPreschoolAdditionalAiInsightArtifactIdentity(identity)).toBe(true);
    expect(isCurrentPreschoolAdditionalAiInsightArtifactIdentity({
      ...identity,
      identityContractRevision: "additional-insights-v8",
      workflowRevision: "additional-insights-discover-accept-publish-v8",
    })).toBe(false);
    for (const [field, value] of [
      ["analysisPackId", "other-pack"],
      ["analysisPackRevision", "v99"],
      ["editorPromptRevision", "additional-insights-publication-v99"],
      ["methodSkillId", "other-method"],
      ["methodSkillRevision", "99.0.0"],
      ["methodSetId", "other-method-set"],
      ["methodSetRevision", "v99"],
      ["methodSetFingerprint", "sha256:invalid"],
    ] as const) {
      expect(isCurrentPreschoolAdditionalAiInsightArtifactIdentity({
        ...identity,
        [field]: value,
      })).toBe(false);
    }

    const callerAttempt = {
      baseIdentity: legacy,
      methods: [{
        skillId: "caller-forged-method",
        semanticVersion: "99.0.0",
        resourceId: "skill:caller-forged-method",
        resourceRevision: 99,
        contentSha256: "f".repeat(64),
        scope: "user",
        workspaceId: "other-workspace",
        userId: "attacker",
        role: "core-method",
      }],
    } as unknown as Parameters<typeof createPreschoolAdditionalAiInsightArtifactIdentity>[0];
    expect(createPreschoolAdditionalAiInsightArtifactIdentity(callerAttempt)).toEqual(identity);
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
