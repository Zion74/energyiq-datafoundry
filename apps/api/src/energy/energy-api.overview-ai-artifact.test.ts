import { LocalDataGateway } from "@datafoundry/data-gateway";
import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import type { ConfigApiContext } from "../routes/types.js";
import { ensureEnergyIqBootstrap, PRESCHOOL_WORKSPACE_ID } from "./energy-bootstrap.js";
import { handleEnergyApiRequest } from "./energy-api.js";
import { resolveCurrentOverviewAiArtifactIdentity } from "./overview-ai-artifact.js";

describe("Overview AI Artifact API", () => {
  it("persists one validated current result and restores it through the Project-scoped interface", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-overview-artifact-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      metadata.configResources.upsert({
        id: "profile-test",
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        user_id: "dev-user",
        kind: "model-profile",
        name: "Test profile",
        payload: { provider: "openai-compatible", modelName: "model-test" },
        default_enabled: true,
        status: "connected",
      });
      metadata.workspaceDefaultModelProfiles.set({
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        profile_id: "profile-test",
        profile_owner_user_id: "dev-user",
        configured_by_user_id: "dev-user",
      });
      metadata.users.upsertDevUser({
        id: "second-user",
        email: "second-user@example.test",
        display_name: "Second User",
        dev_token: "second-user-token",
      });
      metadata.workspaceMemberships.upsert({
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        user_id: "second-user",
        role: "member",
      });
      const project = metadata.energyIq.getProject("preschool-demo");
      const identity = resolveCurrentOverviewAiArtifactIdentity({
        metadataStore: metadata,
        projectId: project.id,
        scopeId: project.root_scope_id,
        user: metadata.users.getById({ user_id: "dev-user" }),
      });
      metadata.sessions.create({
        id: "artifact-session",
        user_id: "dev-user",
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        project_id: project.id,
      });
      for (const runId of ["artifact-investigator-run", "artifact-editor-run"]) {
        metadata.runs.claim({
          id: runId,
          user_id: "dev-user",
          session_id: "artifact-session",
          status: "running",
          user_input: `Snapshot ${identity.dataSnapshotId} Release ${identity.projectReleaseId}`,
          model_name: "model-test",
        });
        metadata.runs.updateStatus({
          user_id: "dev-user",
          run_id: runId,
          status: "completed",
        });
      }
      const context = {
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        workspaceId: PRESCHOOL_WORKSPACE_ID,
      } as Required<ConfigApiContext>;
      const secondContext = { ...context, userId: "second-user" } as Required<ConfigApiContext>;

      const before = await handleEnergyApiRequest(
        getRequest(`/api/v1/energy/projects/${project.id}/overview-ai-artifact?scopeId=${project.root_scope_id}`),
        ["projects", project.id, "overview-ai-artifact"],
        context,
      );
      expect(before).toMatchObject({
        status: 200,
        body: { success: true, data: { status: "missing", dataSnapshotId: identity.dataSnapshotId } },
      });

      const firstClaim = await handleEnergyApiRequest(
        jsonPost({}),
        ["projects", project.id, "overview-ai-artifact", "claim"],
        context,
      );
      expect(firstClaim).toMatchObject({
        status: 200,
        body: { success: true, data: { status: "owner", leaseToken: expect.any(String) } },
      });
      const leaseToken = (firstClaim.body as { data: { leaseToken: string } }).data.leaseToken;
      const secondClaim = await handleEnergyApiRequest(
        jsonPost({}),
        ["projects", project.id, "overview-ai-artifact", "claim"],
        secondContext,
      );
      expect(secondClaim).toMatchObject({
        status: 200,
        body: {
          success: true,
          data: {
            status: "waiting",
            artifact: { id: (firstClaim.body as { data: { artifact: { id: string } } }).data.artifact.id },
          },
        },
      });

      const wrongFail = await handleEnergyApiRequest(
        jsonPost({ leaseToken: "wrong-owner", errorCode: "PROVIDER_TEMPORARY" }),
        ["projects", project.id, "overview-ai-artifact", "fail"],
        context,
      );
      expect(wrongFail.status).not.toBe(200);
      expect(wrongFail).toMatchObject({ body: { success: false } });
      const failed = await handleEnergyApiRequest(
        jsonPost({ leaseToken, errorCode: "PROVIDER_TEMPORARY" }),
        ["projects", project.id, "overview-ai-artifact", "fail"],
        context,
      );
      expect(failed).toMatchObject({
        status: 200,
        body: { success: true, data: { status: "failed", attemptCount: 1 } },
      });
      const retryClaim = await handleEnergyApiRequest(
        jsonPost({}),
        ["projects", project.id, "overview-ai-artifact", "claim"],
        secondContext,
      );
      expect(retryClaim).toMatchObject({
        status: 200,
        body: { success: true, data: { status: "owner", leaseToken: expect.any(String) } },
      });
      const retryLeaseToken = (retryClaim.body as { data: { leaseToken: string } }).data.leaseToken;
      const competingRetry = await handleEnergyApiRequest(
        jsonPost({}),
        ["projects", project.id, "overview-ai-artifact", "claim"],
        context,
      );
      expect(competingRetry).toMatchObject({
        status: 200,
        body: { success: true, data: { status: "waiting", artifact: { attemptCount: 2 } } },
      });

      const binding = {
        projectId: identity.projectId,
        scopeId: identity.scopeId,
        dataSnapshotId: identity.dataSnapshotId,
        projectReleaseId: identity.projectReleaseId,
        dataCutoff: "2026-06-01T00:00:00.000Z",
        analysisPeriod: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
        outputContractRevision: identity.outputContractRevision,
      };
      const result = {
        status: "available",
        providerProfileId: "profile-test",
        runId: "artifact-editor-run",
        packId: "preschool-analysis-pack",
        packRevision: "v1",
        contract: { id: "preschool-ai-accepted-artifact", revision: identity.outputContractRevision },
        binding,
        workflow: {
          id: "preschool-two-stage",
          revision: identity.workflowRevision,
          methodSkill: { id: identity.methodSkillId, revision: identity.methodSkillRevision },
          stages: {
            investigator: { runId: "artifact-investigator-run", promptRevision: identity.investigatorPromptRevision },
            editor: { runId: "artifact-editor-run", promptRevision: identity.editorPromptRevision },
          },
          editorTrace: [{ decision: "accepted", sourceCandidateIds: ["candidate-1"], findingId: "finding-1" }],
        },
        findings: [{
          id: "finding-1",
          binding,
          placementTargets: ["preschool.benchmark"],
          epistemicLevel: "verified",
          relationship: "supports",
          signalRefs: ["efficiency"],
          title: "Benchmark gap persists across normalisations",
          takeaway: "The current Snapshot supports a focused operating review.",
          evidence: {
            snapshotId: identity.dataSnapshotId,
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
      } as const;
      const missingInvestigator = await handleEnergyApiRequest(
        jsonPost({
          leaseToken: retryLeaseToken,
          result: {
            ...result,
            workflow: {
              ...result.workflow,
              stages: {
                ...result.workflow.stages,
                investigator: { ...result.workflow.stages.investigator, runId: "missing-investigator-run" },
              },
            },
          },
        }),
        ["projects", project.id, "overview-ai-artifact", "complete"],
        context,
      );
      expect(missingInvestigator).toMatchObject({
        status: 400,
        body: { success: false, error: { message: "ENERGYIQ_OVERVIEW_AI_ARTIFACT_RUN_INVALID" } },
      });

      const wrongComplete = await handleEnergyApiRequest(
        jsonPost({ leaseToken, result }),
        ["projects", project.id, "overview-ai-artifact", "complete"],
        context,
      );
      expect(wrongComplete.status).not.toBe(200);
      expect(wrongComplete).toMatchObject({ body: { success: false } });

      const completed = await handleEnergyApiRequest(
        jsonPost({ leaseToken: retryLeaseToken, result }),
        ["projects", project.id, "overview-ai-artifact", "complete"],
        context,
      );
      expect(completed).toMatchObject({
        status: 200,
        body: {
          success: true,
          data: {
            status: "available",
            dataSnapshotId: identity.dataSnapshotId,
            runId: "artifact-editor-run",
            result: {
              status: "available",
              runId: "artifact-editor-run",
              workflow: { stages: result.workflow.stages },
            },
          },
        },
      });
      expect((completed.body as { data: { result: { workflow: Record<string, unknown> } } }).data.result.workflow)
        .not.toHaveProperty("editorTrace");

      const availableClaim = await handleEnergyApiRequest(
        jsonPost({}),
        ["projects", project.id, "overview-ai-artifact", "claim"],
        context,
      );
      expect(availableClaim).toMatchObject({
        status: 200,
        body: { success: true, data: { status: "available", artifact: { attemptCount: 2 } } },
      });
      expect((availableClaim.body as { data: Record<string, unknown> }).data).not.toHaveProperty("leaseToken");

      const restored = await handleEnergyApiRequest(
        getRequest(`/api/v1/energy/projects/${project.id}/overview-ai-artifact?scopeId=${project.root_scope_id}`),
        ["projects", project.id, "overview-ai-artifact"],
        secondContext,
      );
      expect(restored).toEqual(completed);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

const jsonPost = (body: unknown): IncomingMessage => {
  const request = new PassThrough();
  Object.assign(request, {
    method: "POST",
    headers: { "content-type": "application/json" },
    url: "/api/v1/energy/projects/preschool-demo/overview-ai-artifact/complete",
  });
  request.end(JSON.stringify(body));
  return request as unknown as IncomingMessage;
};

const getRequest = (url: string): IncomingMessage => {
  const request = new PassThrough();
  Object.assign(request, { method: "GET", headers: {}, url });
  request.end();
  return request as unknown as IncomingMessage;
};
