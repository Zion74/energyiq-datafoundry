import { LocalDataGateway } from "@datafoundry/data-gateway";
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

describe("EnergyIQ template change API", () => {
  it("keeps proposal and preview read-only until an administrator publishes a new immutable revision", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-template-change-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const project = metadata.energyIq.getProject("preschool-demo");
      const base = metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
        project_id: project.id,
        tier_definition_ids: metadata.energyIq.listTierDefinitions(project.id).map((tier) => tier.id),
        hierarchy_revision_id: project.hierarchy_revision_id,
        meter_mapping_revision_id: "meter-routing-unavailable",
        published_by: "dev-user",
        published_at: "2026-08-13T00:00:00.000Z",
      });
      const placement = base.document.templates[0]!.components[0]!;
      const templateChangeWorkflow = {
        propose: vi.fn(async () => ({
          proposal: {
            title: "Highlight the first decision card",
            rationale: "It should be visually prominent for managers.",
            operations: [{
              op: "update_presentation" as const,
              templateId: "project",
              placementId: placement.placement_id!,
              presentation: { tone: "highlight" as const },
            }],
          },
          identity: {
            workspaceId: project.workspace_id,
            projectId: project.id,
            scopeId: project.root_scope_id,
            dataSnapshotId: project.data_snapshot_id,
            projectReleaseId: base.revision_id,
          },
          runId: "template-proposal-run",
          sessionId: "template-proposal-session",
        })),
      };
      const context = {
        metadataStore: metadata,
        dataGateway: new LocalDataGateway(metadata),
        userId: "dev-user",
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        templateChangeWorkflow,
      } as unknown as Required<ConfigApiContext>;

      const proposalResponse = await handleEnergyApiRequest(
        jsonRequest("POST", {
          instruction: "Make the first decision card more prominent.",
          scopeId: project.root_scope_id,
        }),
        ["projects", project.id, "template-change-proposals"],
        context,
      );
      expect(proposalResponse).toMatchObject({
        status: 201,
        body: { success: true, data: { proposal: { status: "pending_review", base_revision_id: base.revision_id } } },
      });
      expect(metadata.energyIq.templates.getLatestProjectRevision(project.id)).toEqual(base);
      const proposalId = ((proposalResponse.body as { data: { proposal: { id: string } } }).data.proposal.id);

      const previewResponse = await handleEnergyApiRequest(
        jsonRequest("GET"),
        ["projects", project.id, "template-change-proposals", proposalId, "preview"],
        context,
      );
      expect(previewResponse).toMatchObject({
        status: 200,
        body: {
          success: true,
          data: {
            fixedIdentity: {
              dataSnapshotId: project.data_snapshot_id,
              projectReleaseId: base.revision_id,
            },
            proposal: { diff: [{ kind: "presentation_updated" }] },
          },
        },
      });
      expect(metadata.energyIq.templates.getLatestProjectRevision(project.id)).toEqual(base);

      metadata.users.upsertDevUser({
        id: "template-viewer",
        email: "template-viewer@example.test",
        display_name: "Template Viewer",
        dev_token: "template-viewer-token",
      });
      metadata.workspaceMemberships.upsert({
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        user_id: "template-viewer",
        role: "member",
      });
      metadata.energyIq.upsertUserRole({ user_id: "template-viewer", role: "user" });
      metadata.energyIq.upsertProjectAccess({
        project_id: project.id,
        user_id: "template-viewer",
        role: "viewer",
      });
      const forbidden = await handleEnergyApiRequest(
        jsonRequest("POST", {}),
        ["projects", project.id, "template-change-proposals", proposalId, "publish"],
        { ...context, userId: "template-viewer" },
      );
      expect(forbidden.status).toBe(403);
      expect(metadata.energyIq.templates.getLatestProjectRevision(project.id)).toEqual(base);

      const published = await handleEnergyApiRequest(
        jsonRequest("POST", {}),
        ["projects", project.id, "template-change-proposals", proposalId, "publish"],
        context,
      );
      expect(published).toMatchObject({
        status: 200,
        body: {
          success: true,
          data: {
            proposal: { status: "published" },
            revision: { revision_id: "preschool-demo-template-v2" },
          },
        },
      });
      expect(metadata.energyIq.templates.getProjectRevision(base.revision_id)).toEqual(base);
      expect(metadata.energyIq.templates.getLatestProjectRevision(project.id)?.document.templates[0]
        ?.components[0]?.presentation?.tone).toBe("highlight");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists nothing when the model workflow fails or returns an invalid proposal", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-template-change-failure-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const project = metadata.energyIq.getProject("preschool-demo");
      metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
        project_id: project.id,
        tier_definition_ids: metadata.energyIq.listTierDefinitions(project.id).map((tier) => tier.id),
        hierarchy_revision_id: project.hierarchy_revision_id,
        meter_mapping_revision_id: "meter-routing-unavailable",
        published_by: "dev-user",
        published_at: "2026-08-13T00:00:00.000Z",
      });
      const propose = vi.fn(async () => { throw new Error("ENERGYIQ_TEMPLATE_CHANGE_MODEL_OUTPUT_INVALID"); });
      const context = {
        metadataStore: metadata,
        dataGateway: new LocalDataGateway(metadata),
        userId: "dev-user",
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        templateChangeWorkflow: {
          propose,
        },
      } as unknown as Required<ConfigApiContext>;

      const response = await handleEnergyApiRequest(
        jsonRequest("POST", { instruction: "Replace the page with HTML." }),
        ["projects", project.id, "template-change-proposals"],
        context,
      );
      expect(response.status).toBe(400);
      expect(propose).toHaveBeenCalledTimes(1);
      expect(metadata.energyIq.templateChanges.listProject(project.id)).toEqual([]);
      expect(metadata.energyIq.templates.listProjectRevisions(project.id)).toHaveLength(1);

      const oversized = await handleEnergyApiRequest(
        jsonRequest("POST", { instruction: "x".repeat(2_001) }),
        ["projects", project.id, "template-change-proposals"],
        context,
      );
      expect(oversized.status).toBe(400);
      expect(propose).toHaveBeenCalledTimes(1);
      expect(metadata.energyIq.templateChanges.listProject(project.id)).toEqual([]);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

const jsonRequest = (method: "GET" | "POST", body?: unknown): IncomingMessage => {
  const request = new PassThrough();
  Object.assign(request, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
  });
  request.end(body === undefined ? undefined : JSON.stringify(body));
  return request as unknown as IncomingMessage;
};
