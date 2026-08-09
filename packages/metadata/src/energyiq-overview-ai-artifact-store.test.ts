import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createMetadataStore } from "./index.js";
import type { EnergyIqOverviewAiArtifactIdentity } from "./energyiq-overview-ai-artifact-store.js";

const identity = (
  dataSnapshotId: string,
): EnergyIqOverviewAiArtifactIdentity => ({
  workspaceId: "artifact-workspace",
  projectId: "artifact-project",
  scopeId: "artifact-project-scope",
  resource: "electricity",
  dataSnapshotId,
  projectReleaseId: "release-v1",
  rendererKey: "preschool-overview",
  rendererVersion: "v1",
  analysisPackId: "preschool-analysis-pack",
  analysisPackRevision: "v1",
  modelProfileId: "deepseek-v4-flash",
  modelProfileRevision: 3,
  outputContractRevision: "v13",
  validatorRevision: "preschool-ai-two-stage-fact-boundary-v1",
  workflowRevision: "preschool-two-stage-v1",
  investigatorPromptRevision: "preschool-investigator-v1",
  editorPromptRevision: "preschool-insight-editor-v1",
  methodSkillId: "energy-insight-investigation",
  methodSkillRevision: "1.0.0",
});

describe("EnergyIqOverviewAiArtifactStore", () => {
  it("single-flights one exact identity and keeps Snapshot A immutable when B is queued", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-overview-artifact-"));
    let metadata: ReturnType<typeof createMetadataStore> | undefined;
    try {
      const store = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata = store;
      store.workspaces.upsert({
        id: "artifact-workspace",
        owner_user_id: "dev-user",
        name: "Artifact",
        kind: "customer",
      });
      store.energyIq.upsertProject({
        id: "artifact-project",
        workspace_id: "artifact-workspace",
        name: "Artifact",
        status: "published",
      });

      const queuedA = store.energyIq.overviewAiArtifacts.queue({
        identity: identity("snapshot-a"),
        triggeredBy: "dev-user",
        now: "2026-08-08T12:00:00.000Z",
      });
      const duplicateA = store.energyIq.overviewAiArtifacts.queue({
        identity: identity("snapshot-a"),
        triggeredBy: "dev-user",
        now: "2026-08-08T12:00:01.000Z",
      });

      expect(duplicateA).toEqual(queuedA);
      expect(JSON.parse(queuedA.identity_json)).toMatchObject({
        workflowRevision: "preschool-two-stage-v1",
        investigatorPromptRevision: "preschool-investigator-v1",
        editorPromptRevision: "preschool-insight-editor-v1",
        methodSkillId: "energy-insight-investigation",
        methodSkillRevision: "1.0.0",
      });
      const firstClaim = store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-a"),
        workerId: "api-1",
        leaseMs: 60_000,
        now: "2026-08-08T12:00:02.000Z",
      });
      const competingClaim = store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-a"),
        workerId: "api-2",
        leaseMs: 60_000,
        now: "2026-08-08T12:00:03.000Z",
      });

      expect(firstClaim.claimed).toBe(true);
      expect(firstClaim.artifact).toMatchObject({ status: "running", attempt_count: 1 });
      expect(competingClaim.claimed).toBe(false);

      const resultA = JSON.stringify(acceptedResult(identity("snapshot-a"), "run-a"));
      const completedA = store.energyIq.overviewAiArtifacts.complete({
        identity: identity("snapshot-a"),
        workerId: "api-1",
        runId: "run-a",
        sessionId: "session-a",
        resultJson: resultA,
        now: "2026-08-08T12:00:04.000Z",
      });
      expect(completedA).toMatchObject({
        status: "available",
        data_snapshot_id: "snapshot-a",
        run_id: "run-a",
        result_json: resultA,
      });
      expect(store.energyIq.overviewAiArtifacts.complete({
        identity: identity("snapshot-a"),
        workerId: "api-1",
        runId: "run-a",
        sessionId: "session-a",
        resultJson: resultA,
        now: "2026-08-08T12:00:05.000Z",
      })).toEqual(completedA);
      expect(() => store.energyIq.overviewAiArtifacts.complete({
        identity: identity("snapshot-a"),
        workerId: "api-1",
        runId: "run-other",
        sessionId: "session-a",
        resultJson: JSON.stringify(acceptedResult(identity("snapshot-a"), "run-other")),
        now: "2026-08-08T12:00:06.000Z",
      })).toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_IMMUTABLE");

      const queuedB = store.energyIq.overviewAiArtifacts.queue({
        identity: identity("snapshot-b"),
        triggeredBy: "dev-user",
        now: "2026-08-08T12:00:07.000Z",
      });
      expect(queuedB).toMatchObject({ status: "queued", data_snapshot_id: "snapshot-b" });
      expect(queuedB.id).not.toBe(completedA.id);
      expect(store.energyIq.overviewAiArtifacts.get(identity("snapshot-a"))).toEqual(completedA);
      expect(store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-b"),
        workerId: "api-1",
        leaseMs: 60_000,
        now: "2026-08-08T12:00:08.000Z",
      }).claimed).toBe(true);
      const invalidResultB = acceptedResult(identity("snapshot-b"), "run-b");
      invalidResultB.findings[0]!.epistemicLevel = "hypothesis";
      invalidResultB.findings[0]!.evidence.deterministic = [];
      expect(() => store.energyIq.overviewAiArtifacts.complete({
        identity: identity("snapshot-b"),
        workerId: "api-1",
        runId: "run-b",
        sessionId: "session-b",
        resultJson: JSON.stringify(invalidResultB),
        now: "2026-08-08T12:00:09.000Z",
      })).toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
      const revisedEditor = store.energyIq.overviewAiArtifacts.queue({
        identity: { ...identity("snapshot-a"), editorPromptRevision: "preschool-insight-editor-v2" },
        triggeredBy: "dev-user",
        now: "2026-08-08T12:00:10.000Z",
      });
      expect(revisedEditor.id).not.toBe(completedA.id);
    } finally {
      metadata?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("allows an expired running lease to be reclaimed without creating another artifact", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-overview-artifact-reclaim-"));
    let metadata: ReturnType<typeof createMetadataStore> | undefined;
    try {
      const store = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata = store;
      store.workspaces.upsert({
        id: "artifact-workspace",
        owner_user_id: "dev-user",
        name: "Artifact",
        kind: "customer",
      });
      store.energyIq.upsertProject({
        id: "artifact-project",
        workspace_id: "artifact-workspace",
        name: "Artifact",
        status: "published",
      });
      store.energyIq.overviewAiArtifacts.queue({
        identity: identity("snapshot-a"),
        triggeredBy: "dev-user",
        now: "2026-08-08T12:00:00.000Z",
      });
      store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-a"),
        workerId: "dead-api",
        leaseMs: 1_000,
        now: "2026-08-08T12:00:01.000Z",
      });

      const reclaimed = store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-a"),
        workerId: "api-2",
        leaseMs: 60_000,
        now: "2026-08-08T12:00:03.000Z",
      });
      expect(reclaimed).toMatchObject({
        claimed: true,
        artifact: { status: "running", attempt_count: 2, lease_owner: "api-2" },
      });
    } finally {
      metadata?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("retries a failed exact identity once, fences stale leases, and keeps available immutable", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-overview-artifact-retry-"));
    let metadata: ReturnType<typeof createMetadataStore> | undefined;
    try {
      const store = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata = store;
      store.workspaces.upsert({
        id: "artifact-workspace",
        owner_user_id: "dev-user",
        name: "Artifact",
        kind: "customer",
      });
      store.energyIq.upsertProject({
        id: "artifact-project",
        workspace_id: "artifact-workspace",
        name: "Artifact",
        status: "published",
      });
      store.energyIq.overviewAiArtifacts.queue({
        identity: identity("snapshot-retry"),
        triggeredBy: "dev-user",
        now: "2026-08-08T12:00:00.000Z",
      });
      store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-retry"),
        workerId: "api-1",
        leaseMs: 60_000,
        now: "2026-08-08T12:00:01.000Z",
      });

      expect(() => store.energyIq.overviewAiArtifacts.fail({
        identity: identity("snapshot-retry"),
        workerId: "wrong-owner",
        errorCode: "PROVIDER_TEMPORARY",
        now: "2026-08-08T12:00:02.000Z",
      })).toThrow();
      const failed = store.energyIq.overviewAiArtifacts.fail({
        identity: identity("snapshot-retry"),
        workerId: "api-1",
        errorCode: "PROVIDER_TEMPORARY",
        now: "2026-08-08T12:00:03.000Z",
      });
      expect(failed).toMatchObject({ status: "failed", attempt_count: 1 });

      const retryOwner = store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-retry"),
        workerId: "api-2",
        leaseMs: 60_000,
        now: "2026-08-08T12:00:04.000Z",
      });
      const competingRetry = store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-retry"),
        workerId: "api-3",
        leaseMs: 60_000,
        now: "2026-08-08T12:00:04.000Z",
      });
      expect(retryOwner).toMatchObject({
        claimed: true,
        artifact: { status: "running", attempt_count: 2, lease_owner: "api-2" },
      });
      expect(competingRetry).toMatchObject({
        claimed: false,
        artifact: { status: "running", attempt_count: 2, lease_owner: "api-2" },
      });

      const result = JSON.stringify(acceptedResult(identity("snapshot-retry"), "run-retry"));
      expect(() => store.energyIq.overviewAiArtifacts.complete({
        identity: identity("snapshot-retry"),
        workerId: "api-1",
        runId: "run-retry",
        sessionId: "session-retry",
        resultJson: result,
        now: "2026-08-08T12:00:05.000Z",
      })).toThrow();
      expect(() => store.energyIq.overviewAiArtifacts.fail({
        identity: identity("snapshot-retry"),
        workerId: "api-1",
        errorCode: "STALE_OWNER",
        now: "2026-08-08T12:00:05.000Z",
      })).toThrow();
      const completed = store.energyIq.overviewAiArtifacts.complete({
        identity: identity("snapshot-retry"),
        workerId: "api-2",
        runId: "run-retry",
        sessionId: "session-retry",
        resultJson: result,
        now: "2026-08-08T12:00:06.000Z",
      });
      expect(completed).toMatchObject({ status: "available", attempt_count: 2 });
      expect(store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-retry"),
        workerId: "api-4",
        leaseMs: 60_000,
        now: "2026-08-08T12:00:07.000Z",
      })).toMatchObject({
        claimed: false,
        artifact: { status: "available", attempt_count: 2 },
      });
    } finally {
      metadata?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

const acceptedResult = (artifactIdentity: EnergyIqOverviewAiArtifactIdentity, runId: string) => {
  const binding = {
    projectId: artifactIdentity.projectId,
    scopeId: artifactIdentity.scopeId,
    dataSnapshotId: artifactIdentity.dataSnapshotId,
    projectReleaseId: artifactIdentity.projectReleaseId,
    dataCutoff: "2026-06-01T00:00:00.000Z",
    analysisPeriod: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
    outputContractRevision: artifactIdentity.outputContractRevision,
  };
  return {
    status: "available",
    providerProfileId: artifactIdentity.modelProfileId,
    runId,
    packId: artifactIdentity.analysisPackId,
    packRevision: artifactIdentity.analysisPackRevision,
    contract: { id: "preschool-ai-accepted-artifact", revision: artifactIdentity.outputContractRevision },
    binding,
    workflow: {
      id: "preschool-two-stage",
      revision: artifactIdentity.workflowRevision,
      methodSkill: { id: artifactIdentity.methodSkillId, revision: artifactIdentity.methodSkillRevision },
      stages: {
        investigator: { runId: "investigator-run", promptRevision: artifactIdentity.investigatorPromptRevision },
        editor: { runId, promptRevision: artifactIdentity.editorPromptRevision },
      },
    },
    findings: [{
      id: "benchmark-finding",
      binding,
      placementTargets: ["preschool.benchmark"],
      epistemicLevel: "verified",
      relationship: "supports",
      signalRefs: ["efficiency"],
      title: "Benchmark gap persists across normalisations",
      takeaway: "The current Snapshot supports a focused operating review.",
      evidence: {
        snapshotId: artifactIdentity.dataSnapshotId,
        period: binding.analysisPeriod,
        deterministic: [{
          id: "benchmark:portfolio",
          kind: "benchmark",
          label: "Portfolio benchmark",
          unit: "kWh/m2/year",
          values: { actual: 120 },
          queryIds: ["benchmark-query"],
          limitation: null,
        }],
        tools: [],
      },
    }],
  };
};
