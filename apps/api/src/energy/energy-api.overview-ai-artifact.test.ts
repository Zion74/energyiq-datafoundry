import { LocalDataGateway } from "@datafoundry/data-gateway";
import { WORKSPACE_DEFAULT_MODEL_PROFILE_ID } from "@datafoundry/metadata";
import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import type { ConfigApiContext } from "../routes/types.js";
import { ensureEnergyIqBootstrap, PRESCHOOL_WORKSPACE_ID } from "./energy-bootstrap.js";
import { handleEnergyApiRequest } from "./energy-api.js";
import {
  createOverviewAiArtifactIdentity,
  resolvePinnedOverviewAiArtifactReadIdentity,
} from "./overview-ai-artifact.js";

describe("Overview AI Artifact API", () => {
  it("accepts the current published Snapshot and Release while delivery configuration has moved on", async () => {
    const harness = await createHarness();
    try {
      const project = harness.metadata.energyIq.upsertProject({
        id: harness.project.id,
        workspace_id: harness.project.workspace_id,
        name: harness.project.name,
        status: harness.project.status,
        timezone: harness.project.timezone,
        hierarchy_revision_id: harness.project.hierarchy_revision_id,
        meter_formula_revision_id: harness.project.meter_formula_revision_id,
        data_snapshot_id: harness.project.data_snapshot_id,
        metric_version: harness.project.metric_version,
        business_calendar_version: harness.project.business_calendar_version,
        tariff_schedule_version: harness.project.tariff_schedule_version,
        delivery_stage: "configured",
        root_scope_id: harness.project.root_scope_id,
        has_unpublished_changes: true,
      });
      expect(project.delivery_stage).toBe("configured");
      const identity = resolvePinnedOverviewAiArtifactReadIdentity({
        metadataStore: harness.metadata,
        projectId: project.id,
        scopeId: project.root_scope_id,
        user: harness.metadata.users.getById({ user_id: "dev-user" }),
        pin: {
          from: "2026-05-01",
          to: "2026-05-31",
          dataSnapshotId: project.data_snapshot_id,
          projectReleaseId: harness.identity.projectReleaseId,
        },
      });

      expect(identity).toMatchObject({
        dataSnapshotId: project.data_snapshot_id,
        projectReleaseId: harness.identity.projectReleaseId,
        analysisPeriodFrom: "2026-04-30T16:00:00.000Z",
        analysisPeriodTo: "2026-05-31T16:00:00.000Z",
      });
    } finally {
      harness.close();
    }
  });

  it("returns the aggregate read model read-only and forwards only a validated Section retry target", async () => {
    const harness = await createHarness();
    try {
      const aggregate = aggregateResultFor(harness.identity);
      const read = vi.fn().mockResolvedValue(aggregate);
      const execute = vi.fn().mockResolvedValue(aggregate);
      const resolveCurrentIdentity = vi.fn().mockResolvedValue(harness.identity);
      const context = {
        ...harness.context,
        overviewAiWorkflow: { execute, read, resolveCurrentIdentity },
      } as unknown as Required<ConfigApiContext>;
      const path = ["projects", harness.project.id, "overview-ai-artifact"];

      const restored = await handleEnergyApiRequest(
        getRequest(`/api/v1/energy/projects/${harness.project.id}/overview-ai-artifact?scopeId=${harness.project.root_scope_id}`),
        path,
        context,
      );
      expect(restored).toMatchObject({
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
        body: {
          success: true,
          data: {
            status: "available",
            result: {
              artifactKind: "preschool-overview-ai-read-model",
              sections: {
                "centre-benchmark": { status: "available" },
                "standby-wastage": { status: "unavailable" },
              },
              executive: { status: "unavailable" },
            },
          },
        },
      });
      expect(execute).not.toHaveBeenCalled();

      await handleEnergyApiRequest(jsonPost({ targetId: "standby-wastage" }), [...path, "retry"], context);
      expect(execute).toHaveBeenCalledWith(expect.objectContaining({
        retry: true,
        retryTarget: "standby-wastage",
      }));
    } finally {
      harness.close();
    }
  });

  it("keeps GET read-only and no-store while POST ensure and retry execute server-owned work", async () => {
    const harness = await createHarness();
    try {
      const execute = vi.fn(async ({ identity, user, retry }) => {
        const store = harness.metadata.energyIq.overviewAiArtifacts;
        const current = store.find(identity) ?? store.queue({ identity, triggeredBy: user.id });
        if (current.status === "available") return current;
        const workerId = retry ? "server-retry" : "server-first";
        const claim = store.claim({ identity, workerId, leaseMs: 60_000 });
        if (!claim.claimed) return claim.artifact;
        return store.complete({
          identity,
          workerId,
          sessionId: "server-session",
          runId: retry ? "server-editor-retry" : "server-editor-first",
          resultJson: JSON.stringify(resultFor(identity, retry ? "server-editor-retry" : "server-editor-first")),
        });
      });
      const resolveCurrentIdentity = vi.fn().mockResolvedValue(harness.identity);
      const context = { ...harness.context, overviewAiWorkflow: { execute, resolveCurrentIdentity } } as unknown as Required<ConfigApiContext>;
      const secondContext = { ...context, userId: "second-user" };
      const path = ["projects", harness.project.id, "overview-ai-artifact"];

      const before = await handleEnergyApiRequest(
        getRequest(`/api/v1/energy/projects/${harness.project.id}/overview-ai-artifact?scopeId=${harness.project.root_scope_id}`),
        path,
        context,
      );
      expect(before).toMatchObject({
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
        body: { success: true, data: { status: "missing" } },
      });
      expect(execute).not.toHaveBeenCalled();

      const started = await handleEnergyApiRequest(jsonPost({}), [...path, "ensure"], context);
      expect(started).toMatchObject({
        status: 200,
        body: {
          success: true,
          data: {
            status: "available",
            dataSnapshotId: harness.identity.dataSnapshotId,
            projectReleaseId: harness.identity.projectReleaseId,
            attemptCount: 1,
            result: { runId: "server-editor-first" },
          },
        },
      });
      expect((started.body as { data: Record<string, unknown> }).data).not.toHaveProperty("leaseToken");
      expect(execute).toHaveBeenCalledWith(expect.objectContaining({
        identity: harness.identity,
        user: expect.objectContaining({ id: "dev-user" }),
        retry: false,
      }));

      const restored = await handleEnergyApiRequest(
        getRequest(`/api/v1/energy/projects/${harness.project.id}/overview-ai-artifact?scopeId=${harness.project.root_scope_id}`),
        path,
        secondContext,
      );
      expect(restored).toMatchObject({
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
        body: started.body,
      });
      expect(execute).toHaveBeenCalledTimes(1);

      const retry = await handleEnergyApiRequest(jsonPost({}), [...path, "retry"], secondContext);
      expect(retry).toEqual(started);
      expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ retry: true }));
      expect(resolveCurrentIdentity).toHaveBeenCalledTimes(4);
    } finally {
      harness.close();
    }
  });

  it("resolves the Artifact against the exact Overview period, Snapshot, and Release pin", async () => {
    const harness = await createHarness();
    try {
      const execute = vi.fn(async () => { throw new Error("not expected"); });
      const resolveCurrentIdentity = vi.fn(async () => { throw new Error("analysis resolver must not run for an exact read pin"); });
      const resolveReadIdentity = vi.fn().mockResolvedValue(harness.identity);
      const context = {
        ...harness.context,
        overviewAiWorkflow: { execute, resolveCurrentIdentity, resolveReadIdentity },
      } as unknown as Required<ConfigApiContext>;
      const path = ["projects", harness.project.id, "overview-ai-artifact"];

      await handleEnergyApiRequest(
        getRequest(`/api/v1/energy/projects/${harness.project.id}/overview-ai-artifact?scopeId=${harness.project.root_scope_id}&from=2026-05-01&to=2026-05-31&dataSnapshotId=snapshot-may&projectReleaseId=release-may`),
        path,
        context,
      );

      expect(resolveReadIdentity).toHaveBeenCalledWith(expect.objectContaining({
        projectId: harness.project.id,
        scopeId: harness.project.root_scope_id,
        pin: {
          from: "2026-05-01",
          to: "2026-05-31",
          dataSnapshotId: "snapshot-may",
          projectReleaseId: "release-may",
        },
      }));
      expect(resolveCurrentIdentity).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("returns 403 for deprecated claim/complete/fail payloads and revalidates exact identity", async () => {
    const harness = await createHarness();
    try {
      const execute = vi.fn(async () => { throw new Error("not expected"); });
      const resolveCurrentIdentity = vi.fn().mockResolvedValue(harness.identity);
      const context = { ...harness.context, overviewAiWorkflow: { execute, resolveCurrentIdentity } } as unknown as Required<ConfigApiContext>;
      const path = ["projects", harness.project.id, "overview-ai-artifact"];
      for (const action of ["claim", "complete", "fail"]) {
        const response = await handleEnergyApiRequest(
          jsonPost({ leaseToken: "browser-lease", result: { findings: [] }, errorCode: "CLIENT_FAILED" }),
          [...path, action],
          context,
        );
        expect(response).toMatchObject({
          status: 403,
          body: { success: false, error: { code: "FORBIDDEN", message: "Overview AI Artifact browser orchestration is forbidden." } },
        });
      }
      expect(execute).not.toHaveBeenCalled();
      expect(resolveCurrentIdentity).toHaveBeenCalledTimes(3);
    } finally {
      harness.close();
    }
  });
});

async function createHarness() {
  const root = mkdtempSync(join(tmpdir(), "energy-api-overview-artifact-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  const gateway = new LocalDataGateway(metadata);
  ensureEnergyIqBootstrap(metadata);
  metadata.configResources.upsert({
    id: "profile-test",
    workspace_id: "default",
    user_id: "dev-user",
    kind: "model-profile",
    name: "Test profile",
    payload: { provider: "openai-compatible", modelName: "model-test" },
    default_enabled: true,
    status: "connected",
  });
  metadata.workspaceDefaultModelProfiles.set({
    workspace_id: "default",
    profile_id: "profile-test",
    profile_owner_user_id: "dev-user",
    configured_by_user_id: "dev-user",
  });
  metadata.users.upsertDevUser({ id: "second-user", email: "second-user@example.test", display_name: "Second User", dev_token: "second-user-token" });
  metadata.workspaceMemberships.upsert({ workspace_id: PRESCHOOL_WORKSPACE_ID, user_id: "second-user", role: "member" });
  const project = metadata.energyIq.getProject("preschool-demo");
  const identity = createOverviewAiArtifactIdentity({
    workspaceId: PRESCHOOL_WORKSPACE_ID,
    projectId: project.id,
    scopeId: project.root_scope_id,
    dataSnapshotId: project.data_snapshot_id,
    projectReleaseId: "legacy-profile:preschool-demo:1",
    analysisPeriodFrom: "2026-04-30T16:00:00.000Z",
    analysisPeriodTo: "2026-05-31T16:00:00.000Z",
    rendererKey: "preschool-overview",
    rendererVersion: "1",
    modelProfileId: WORKSPACE_DEFAULT_MODEL_PROFILE_ID,
    modelProfileRevision: 1,
  });
  return {
    metadata,
    gateway,
    project,
    identity,
    context: {
      metadataStore: metadata,
      dataGateway: gateway,
      userId: "dev-user",
      workspaceId: PRESCHOOL_WORKSPACE_ID,
    },
    close: () => {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

function aggregateResultFor(identity: ReturnType<typeof createOverviewAiArtifactIdentity>) {
  const binding = {
    workspaceId: identity.workspaceId,
    projectId: "preschool-demo" as const,
    scopeId: identity.scopeId,
    dataSnapshotId: identity.dataSnapshotId,
    projectReleaseId: identity.projectReleaseId,
    analysisPeriod: { from: identity.analysisPeriodFrom, to: identity.analysisPeriodTo },
    modelProfileId: identity.modelProfileId,
    modelProfileRevision: identity.modelProfileRevision,
  };
  return {
    artifactKind: "preschool-overview-ai-read-model" as const,
    status: "available" as const,
    binding,
    sections: {
      "centre-benchmark": {
        status: "available" as const,
        artifactId: "section-benchmark",
        result: {
          artifactKind: "section-interpretation" as const,
          status: "available" as const,
          providerProfileId: identity.modelProfileId,
          runId: "run-benchmark",
          binding,
          sectionId: "centre-benchmark" as const,
          summary: "Benchmark evidence supports a focused review.",
          keyPoints: [],
        },
      },
      "standby-wastage": { status: "unavailable" as const, artifactId: "section-standby", reason: "SECTION_FAILED" },
      "operating-behaviour": { status: "unavailable" as const, reason: "Not generated." },
      "planning-outlook": { status: "unavailable" as const, reason: "Not generated." },
    },
    executive: { status: "unavailable" as const, artifactId: "executive", reason: "SYNTHESIS_FAILED" },
  };
}

function resultFor(identity: ReturnType<typeof createOverviewAiArtifactIdentity>, runId: string) {
  const binding = {
    projectId: identity.projectId,
    scopeId: identity.scopeId,
    dataSnapshotId: identity.dataSnapshotId,
    projectReleaseId: identity.projectReleaseId,
    dataCutoff: identity.analysisPeriodTo,
    analysisPeriod: { from: identity.analysisPeriodFrom, to: identity.analysisPeriodTo },
    outputContractRevision: identity.outputContractRevision,
  };
  return {
    status: "available",
    providerProfileId: identity.modelProfileId,
    runId,
    packId: identity.analysisPackId,
    packRevision: identity.analysisPackRevision,
    contract: { id: "preschool-ai-accepted-artifact", revision: identity.outputContractRevision },
    binding,
    workflow: {
      id: "preschool-two-stage",
      revision: identity.workflowRevision,
      methodSkill: { id: identity.methodSkillId, revision: identity.methodSkillRevision },
      stages: {
        investigator: { runId: `${runId}-investigator`, promptRevision: identity.investigatorPromptRevision },
        editor: { runId, promptRevision: identity.editorPromptRevision },
      },
    },
    findings: [],
  };
}

function jsonPost(body: unknown): IncomingMessage {
  const request = new PassThrough();
  Object.assign(request, { method: "POST", headers: { "content-type": "application/json" }, url: "/api/v1/energy/projects/preschool-demo/overview-ai-artifact" });
  request.end(JSON.stringify(body));
  return request as unknown as IncomingMessage;
}

function getRequest(url: string): IncomingMessage {
  const request = new PassThrough();
  Object.assign(request, { method: "GET", headers: {}, url });
  request.end();
  return request as unknown as IncomingMessage;
}
