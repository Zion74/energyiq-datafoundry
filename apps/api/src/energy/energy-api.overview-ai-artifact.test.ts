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
      metadata.runs.claim({
        id: "artifact-run",
        user_id: "dev-user",
        session_id: "artifact-session",
        status: "running",
        user_input: `Snapshot ${identity.dataSnapshotId} Release ${identity.projectReleaseId}`,
        model_name: "model-test",
      });
      metadata.runs.updateStatus({
        user_id: "dev-user",
        run_id: "artifact-run",
        status: "completed",
      });
      const context = {
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        workspaceId: PRESCHOOL_WORKSPACE_ID,
      } as Required<ConfigApiContext>;

      const before = await handleEnergyApiRequest(
        getRequest(`/api/v1/energy/projects/${project.id}/overview-ai-artifact?scopeId=${project.root_scope_id}`),
        ["projects", project.id, "overview-ai-artifact"],
        context,
      );
      expect(before).toMatchObject({
        status: 200,
        body: { success: true, data: { status: "missing", dataSnapshotId: identity.dataSnapshotId } },
      });

      const result = {
        status: "available",
        providerProfileId: "profile-test",
        runId: "artifact-run",
        packId: "preschool-analysis-pack",
        packRevision: "v1",
        findings: [{
          id: "finding-1",
          evidence: { snapshotId: identity.dataSnapshotId, deterministic: [], tools: [] },
        }],
      } as const;
      const completed = await handleEnergyApiRequest(
        jsonPost({ result }),
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
            runId: "artifact-run",
            result,
          },
        },
      });

      const restored = await handleEnergyApiRequest(
        getRequest(`/api/v1/energy/projects/${project.id}/overview-ai-artifact?scopeId=${project.root_scope_id}`),
        ["projects", project.id, "overview-ai-artifact"],
        context,
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
