import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import { createEnergyIqTemplateChangeWorkflow } from "./energy-template-change-workflow.js";

describe("EnergyIQ template change model workflow", () => {
  it("pins the proposal to the current Snapshot and Release and accepts only the typed value output", async () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-template-workflow-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const project = metadata.energyIq.getProject("preschool-demo");
      const revision = metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
        project_id: project.id,
        tier_definition_ids: metadata.energyIq.listTierDefinitions(project.id).map((tier) => tier.id),
        hierarchy_revision_id: project.hierarchy_revision_id,
        meter_mapping_revision_id: "meter-routing-unavailable",
        published_by: "dev-user",
        published_at: "2026-08-13T00:00:00.000Z",
      });
      const identity = {
        workspaceId: project.workspace_id,
        projectId: project.id,
        scopeId: project.root_scope_id,
        resource: "electricity" as const,
        dataSnapshotId: project.data_snapshot_id,
        projectReleaseId: revision.revision_id,
        analysisPeriodFrom: "2026-04-30T16:00:00.000Z",
        analysisPeriodTo: "2026-05-31T16:00:00.000Z",
        rendererKey: "preschool-overview",
        rendererVersion: "1",
        analysisPackId: "preschool-analysis-pack",
        analysisPackRevision: "v1",
        modelProfileId: "workspace-default",
        modelProfileRevision: 1,
        outputContractRevision: "v1",
        validatorRevision: "v1",
        workflowRevision: "v1",
        investigatorPromptRevision: "v1",
        editorPromptRevision: "v1",
        methodSkillId: "none",
        methodSkillRevision: "v1",
        artifactKind: "section-interpretation" as const,
        targetId: "template-proposal",
      };
      const resolveIdentity = vi.fn(async () => identity);
      const runProposal = vi.fn(async (input: { prompt: string; runId: string; sessionId: string }) => ({
        answer: JSON.stringify({
          title: "Bring Monthly Outlook forward",
          rationale: "It contains the next planning decision.",
          operations: [{
            op: "move_placement",
            templateId: "project",
            placementId: revision.document.templates[0]?.components[0]?.placement_id,
          }],
        }),
        runId: input.runId,
        sessionId: input.sessionId,
      }));
      const workflow = createEnergyIqTemplateChangeWorkflow({ metadataStore: metadata, resolveIdentity, runProposal });
      const result = await workflow.propose({
        projectId: project.id,
        scopeId: project.root_scope_id,
        instruction: "Move the planning summary to the end.",
        user: metadata.users.getById({ user_id: "dev-user" }),
      });

      expect(result.identity).toBe(identity);
      expect(result.proposal.operations[0]?.op).toBe("move_placement");
      const prompt = JSON.parse(runProposal.mock.calls[0]![0].prompt) as Record<string, unknown>;
      expect(prompt).toMatchObject({
        fixed_identity: {
          dataSnapshotId: project.data_snapshot_id,
          projectReleaseId: revision.revision_id,
        },
        administrator_request: "Move the planning summary to the end.",
      });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
