import { describe, expect, it } from "vitest";

import {
  createOverviewAiArtifactIdentity,
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
      validatorRevision: "preschool-ai-two-stage-fact-boundary-v1",
      workflowRevision: "preschool-two-stage-v1",
      investigatorPromptRevision: "preschool-investigator-v2",
      editorPromptRevision: "preschool-insight-editor-v1",
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
