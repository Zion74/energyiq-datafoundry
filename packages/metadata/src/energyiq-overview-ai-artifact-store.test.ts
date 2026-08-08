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
  outputContractRevision: "v12",
  validatorRevision: "preschool-finding-validator-v1",
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

      const resultA = JSON.stringify({
        status: "available",
        runId: "run-a",
        findings: [{ evidence: { snapshotId: "snapshot-a" } }],
      });
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
        resultJson: JSON.stringify({ status: "available", runId: "run-other", findings: [] }),
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
});
