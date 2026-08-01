import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createMetadataStore } from "./index.js";

describe("EnergyIqStore", () => {
  it("stores customer workspace, project hierarchy, access and version pins", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-store-"));
    try {
      const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata.workspaces.upsert({
        id: "workspace-1",
        owner_user_id: "dev-user",
        name: "Customer Workspace",
        kind: "customer"
      });
      metadata.workspaceMemberships.upsert({
        workspace_id: "workspace-1",
        user_id: "dev-user",
        role: "owner"
      });
      metadata.energyIq.upsertUserRole({ user_id: "dev-user", role: "admin" });
      const project = metadata.energyIq.upsertProject({
        id: "project-1",
        workspace_id: "workspace-1",
        name: "Project One",
        status: "published",
        hierarchy_revision_id: "hierarchy-7"
      });
      metadata.energyIq.upsertProjectNode({
        id: "project-1-root",
        project_id: project.id,
        name: "Project One",
        node_type: "project",
        sort_order: 0
      });
      metadata.energyIq.upsertProjectNode({
        id: "level-7",
        project_id: project.id,
        parent_id: "project-1-root",
        name: "Level 7",
        node_type: "level",
        sort_order: 10,
        area_sqm: 1_200,
        occupant_count: 80
      });
      metadata.energyIq.upsertProjectAccess({
        project_id: project.id,
        user_id: "dev-user",
        role: "editor"
      });

      expect(metadata.energyIq.getUserRole("dev-user").role).toBe("admin");
      expect(metadata.workspaces.listByUser({ user_id: "dev-user" })[0]?.kind).toBe("customer");
      expect(metadata.energyIq.listProjectsForUser({
        user_id: "dev-user",
        workspace_id: "workspace-1"
      })).toHaveLength(1);
      expect(metadata.energyIq.listProjectNodes(project.id)).toMatchObject([
        { id: "project-1-root", node_type: "project" },
        { id: "level-7", parent_id: "project-1-root", area_sqm: 1_200 }
      ]);
      metadata.close();
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("keeps project setup edits in a draft until an immutable hierarchy revision is published", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-project-setup-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({
        id: "workspace-1",
        owner_user_id: "dev-user",
        name: "Customer Workspace",
        kind: "customer"
      });
      metadata.energyIq.upsertProject({
        id: "project-setup",
        workspace_id: "workspace-1",
        name: "Draft Project",
        status: "draft",
        root_scope_id: "project-setup-root"
      });

      const initial = metadata.energyIq.projectSetup.getDraft({
        project_id: "project-setup",
        user_id: "dev-user"
      });
      expect(initial).toMatchObject({
        project_id: "project-setup",
        revision: 1,
        document: {
          project: { name: "Draft Project", timezone: "Asia/Singapore" },
          tier_structure_locked: false,
          tiers: [],
          nodes: []
        }
      });

      const saved = metadata.energyIq.projectSetup.saveDraft({
        project_id: "project-setup",
        expected_revision: initial.revision,
        user_id: "dev-user",
        document: {
          project: { name: "Ngee Ann Test", timezone: "Asia/Singapore" },
          tier_structure_locked: true,
          tiers: [
            { id: "tier-circuit", ordinal: 1, alias: "Circuit" },
            { id: "tier-level", ordinal: 2, alias: "Level" }
          ],
          nodes: [
            {
              id: "level-6",
              tier_definition_id: "tier-level",
              name: "Level 6",
              sort_order: 10,
              metadata_status: "confirmed",
              area_sqm: 1_180,
              occupant_count: 76
            },
            {
              id: "level-7",
              tier_definition_id: "tier-level",
              name: "Level 7",
              sort_order: 20,
              metadata_status: "confirmed",
              area_sqm: 1_220,
              occupant_count: 82
            },
            {
              id: "level-6-light",
              tier_definition_id: "tier-circuit",
              parent_id: "level-6",
              name: "Total Office Light",
              sort_order: 30,
              metadata_status: "provisional"
            },
            {
              id: "level-7-light",
              tier_definition_id: "tier-circuit",
              parent_id: "level-7",
              name: "Total Office Light",
              sort_order: 40,
              metadata_status: "provisional"
            }
          ]
        }
      });
      expect(saved.revision).toBe(2);
      expect(metadata.energyIq.listProjectNodes("project-setup")).toEqual([]);
      expect(metadata.energyIq.getProject("project-setup")).toMatchObject({
        status: "draft",
        has_unpublished_changes: true
      });

      const validation = metadata.energyIq.projectSetup.validateDraft("project-setup");
      expect(validation.blocking).toBe(false);

      const published = metadata.energyIq.projectSetup.publishDraft({
        project_id: "project-setup",
        expected_revision: saved.revision,
        user_id: "dev-user"
      });
      expect(published.hierarchy_revision_id).toBe("project-setup-hierarchy-v1");
      expect(metadata.energyIq.getProject("project-setup")).toMatchObject({
        name: "Ngee Ann Test",
        status: "published",
        delivery_stage: "published",
        hierarchy_revision_id: "project-setup-hierarchy-v1",
        has_unpublished_changes: false
      });
      expect(metadata.energyIq.listTierDefinitions("project-setup")).toMatchObject([
        { id: "tier-circuit", ordinal: 1, alias: "Circuit" },
        { id: "tier-level", ordinal: 2, alias: "Level" }
      ]);
      expect(metadata.energyIq.listProjectNodes("project-setup")).toMatchObject([
        {
          id: "project-setup-root",
          node_type: "project"
        },
        {
          id: "level-6",
          tier_definition_id: "tier-level",
          parent_id: "project-setup-root",
          node_type: "level"
        },
        {
          id: "level-7",
          tier_definition_id: "tier-level",
          parent_id: "project-setup-root",
          node_type: "level"
        },
        {
          id: "level-6-light",
          tier_definition_id: "tier-circuit",
          parent_id: "level-6",
          node_type: "circuit"
        },
        {
          id: "level-7-light",
          tier_definition_id: "tier-circuit",
          parent_id: "level-7",
          node_type: "circuit"
        }
      ]);

      const postPublishDraft = metadata.energyIq.projectSetup.getDraft({
        project_id: "project-setup",
        user_id: "dev-user"
      });
      expect(postPublishDraft.revision).toBe(3);
      const changed = metadata.energyIq.projectSetup.saveDraft({
        project_id: "project-setup",
        expected_revision: postPublishDraft.revision,
        user_id: "dev-user",
        document: {
          ...postPublishDraft.document,
          project: { ...postPublishDraft.document.project, name: "Unpublished rename" }
        }
      });
      expect(changed.revision).toBe(4);
      expect(metadata.energyIq.getProject("project-setup").name).toBe("Ngee Ann Test");
      expect(() => metadata.energyIq.projectSetup.saveDraft({
        project_id: "project-setup",
        expected_revision: 3,
        user_id: "dev-user",
        document: changed.document
      })).toThrow("ENERGYIQ_SETUP_REVISION_CONFLICT");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("allows incomplete drafts but blocks skipped tiers and reports meaningless single-node tiers", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-project-validation-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({
        id: "workspace-1",
        owner_user_id: "dev-user",
        name: "Customer Workspace",
        kind: "customer"
      });
      metadata.energyIq.upsertProject({
        id: "project-validation",
        workspace_id: "workspace-1",
        name: "Validation Project",
        status: "draft"
      });
      const initial = metadata.energyIq.projectSetup.getDraft({
        project_id: "project-validation",
        user_id: "dev-user"
      });
      const saved = metadata.energyIq.projectSetup.saveDraft({
        project_id: "project-validation",
        expected_revision: initial.revision,
        user_id: "dev-user",
        document: {
          project: { name: "Validation Project", timezone: "Asia/Singapore" },
          tier_structure_locked: true,
          tiers: [
            { id: "tier-circuit", ordinal: 1, alias: "Circuit" },
            { id: "tier-block", ordinal: 3, alias: "Block" }
          ],
          nodes: [
            {
              id: "only-block",
              tier_definition_id: "tier-block",
              name: "Only Block",
              sort_order: 10,
              metadata_status: "provisional"
            },
            {
              id: "circuit-1",
              tier_definition_id: "tier-circuit",
              parent_id: "only-block",
              name: "Circuit 1",
              sort_order: 20,
              metadata_status: "provisional"
            }
          ]
        }
      });
      const validation = metadata.energyIq.projectSetup.validateDraft("project-validation");
      expect(validation.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "TIER_ORDINAL_GAP", severity: "error" }),
        expect.objectContaining({ code: "NODE_SKIPS_TIER", severity: "error" }),
        expect.objectContaining({ code: "SINGLE_NODE_TIER_NEEDS_REASON", severity: "warning" })
      ]));
      expect(() => metadata.energyIq.projectSetup.publishDraft({
        project_id: "project-validation",
        expected_revision: saved.revision,
        user_id: "dev-user"
      })).toThrow("ENERGYIQ_SETUP_INVALID");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("stores immutable import inspections and finds repeated file hashes", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-import-batch-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({
        id: "workspace-1",
        owner_user_id: "dev-user",
        name: "Customer Workspace",
        kind: "customer",
      });
      metadata.energyIq.upsertProject({
        id: "project-import",
        workspace_id: "workspace-1",
        name: "Import Project",
        status: "draft",
      });
      const created = metadata.energyIq.createImportBatch({
        id: "batch-1",
        workspace_id: "workspace-1",
        project_id: "project-import",
        source_kind: "excel",
        source_sha256: "sha-1",
        filename: "meter.xlsx",
        status: "inspected",
        inspection: { rowCount: 10, sourceLabels: ["Meter 1"] },
        created_by: "dev-user",
      });

      expect(JSON.parse(created.inspection_json)).toMatchObject({ rowCount: 10 });
      expect(metadata.energyIq.findImportBatchBySha({
        project_id: "project-import",
        source_sha256: "sha-1",
      })?.id).toBe("batch-1");
      expect(metadata.energyIq.listImportBatches("project-import")).toHaveLength(1);
      const materialized = metadata.energyIq.completeImportBatchMaterialization({
        batch_id: "batch-1",
        project_id: "project-import",
        snapshot_id: "snapshot-1",
        summary: { intervalFactCount: 9 },
      });
      expect(materialized.status).toBe("materialized");
      expect(JSON.parse(materialized.materialization_json ?? "{}")).toMatchObject({ intervalFactCount: 9 });
      expect(metadata.energyIq.getProject("project-import").data_snapshot_id).toBe("snapshot-1");
      expect(() => metadata.energyIq.createImportBatch({
        ...created,
        id: "batch-2",
        inspection: {},
      })).toThrow();
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
