import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ensureEnergyIqBootstrap,
} from "./energy-bootstrap.js";
import { resolveEnergyPublishedMeterRoute } from "./energy-query-context.js";

describe("ensureEnergyIqBootstrap", () => {
  it("does not replace a customer-edited Preschool Draft while repairing the legacy demo", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-bootstrap-preschool-routing-user-draft-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.energyIq.upsertUserRole({ user_id: "dev-user", role: "admin" });
      metadata.workspaces.upsert({
        id: "preschool-demo-org",
        owner_user_id: "dev-user",
        name: "Preschool Demo",
        kind: "customer",
      });
      metadata.workspaceMemberships.upsert({
        workspace_id: "preschool-demo-org",
        user_id: "dev-user",
        role: "owner",
      });
      metadata.energyIq.projectSetup.bootstrapPublished({
        project: {
          id: "preschool-demo",
          workspace_id: "preschool-demo-org",
          name: "Preschool Portfolio",
          hierarchy_revision_id: "preschool-hierarchy-v4",
          meter_formula_revision_id: "preschool-meter-formula-v2",
          root_scope_id: "preschool-project",
        },
        document: {
          project: { name: "Preschool Portfolio", timezone: "Asia/Singapore" },
          tier_structure_locked: true,
          tiers: [{ id: "preschool-tier-centre", ordinal: 1, alias: "Centre" }],
          nodes: [{
            id: "preschool-centre-a",
            tier_definition_id: "preschool-tier-centre",
            name: "Centre A",
            sort_order: 1,
            metadata_status: "confirmed",
          }],
        },
        published_by: "dev-user",
      });
      const draft = metadata.energyIq.projectSetup.getDraft({
        project_id: "preschool-demo",
        user_id: "dev-user",
      });
      metadata.energyIq.projectSetup.saveDraft({
        project_id: "preschool-demo",
        expected_revision: draft.revision,
        user_id: "dev-user",
        document: {
          ...draft.document,
          project: { ...draft.document.project, name: "Customer-edited Preschool" },
        },
      });

      ensureEnergyIqBootstrap(metadata);

      expect(metadata.energyIq.getProject("preschool-demo")).toMatchObject({
        hierarchy_revision_id: "preschool-hierarchy-v4",
        has_unpublished_changes: true,
      });
      expect(metadata.energyIq.projectSetup.getDraft({
        project_id: "preschool-demo",
        user_id: "dev-user",
      }).document.project.name).toBe("Customer-edited Preschool");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("resumes the exact bootstrap-owned Preschool route migration after a saved Draft", () => {
    const referenceRoot = mkdtempSync(join(tmpdir(), "energy-bootstrap-preschool-routing-reference-"));
    const legacyRoot = mkdtempSync(join(tmpdir(), "energy-bootstrap-preschool-routing-resume-"));
    const reference = createMetadataStore({ database_path: join(referenceRoot, "metadata.sqlite") });
    const metadata = createMetadataStore({ database_path: join(legacyRoot, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(reference);
      const referenceProject = reference.energyIq.getProject("preschool-demo");
      const referenceRevision = reference.energyIq.projectSetup
        .listHierarchyRevisions("preschool-demo")
        .find((revision) => revision.id === referenceProject.hierarchy_revision_id)!;
      const migrationDocument = JSON.parse(referenceRevision.snapshot_json);

      metadata.energyIq.upsertUserRole({ user_id: "dev-user", role: "admin" });
      metadata.workspaces.upsert({
        id: "preschool-demo-org",
        owner_user_id: "dev-user",
        name: "Preschool Demo",
        kind: "customer",
      });
      metadata.workspaceMemberships.upsert({
        workspace_id: "preschool-demo-org",
        user_id: "dev-user",
        role: "owner",
      });
      metadata.energyIq.projectSetup.bootstrapPublished({
        project: {
          id: "preschool-demo",
          workspace_id: "preschool-demo-org",
          name: "Preschool Portfolio",
          hierarchy_revision_id: "preschool-hierarchy-v4",
          meter_formula_revision_id: "preschool-meter-formula-v2",
          data_snapshot_id: "legacy-preschool-snapshot",
          business_calendar_version: "legacy-preschool-calendar",
          tariff_schedule_version: "legacy-preschool-tariff",
          root_scope_id: "preschool-project",
        },
        document: {
          project: { name: "Preschool Portfolio", timezone: "Asia/Singapore" },
          tier_structure_locked: true,
          tiers: [{ id: "preschool-tier-centre", ordinal: 1, alias: "Centre" }],
          nodes: [{
            id: "preschool-centre-a",
            tier_definition_id: "preschool-tier-centre",
            name: "Centre A",
            sort_order: 1,
            metadata_status: "confirmed",
          }],
        },
        published_by: "dev-user",
      });
      const draft = metadata.energyIq.projectSetup.getDraft({
        project_id: "preschool-demo",
        user_id: "dev-user",
      });
      metadata.energyIq.projectSetup.saveDraft({
        project_id: "preschool-demo",
        expected_revision: draft.revision,
        user_id: "dev-user",
        document: migrationDocument,
      });

      ensureEnergyIqBootstrap(metadata);

      expect(metadata.energyIq.getProject("preschool-demo")).toMatchObject({
        hierarchy_revision_id: "preschool-demo-hierarchy-v5",
        has_unpublished_changes: false,
      });
    } finally {
      reference.close();
      metadata.close();
      rmSync(referenceRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      rmSync(legacyRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("publishes explicit Meter Routes once for the exact legacy Preschool demo revision", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-bootstrap-preschool-routing-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.energyIq.upsertUserRole({ user_id: "dev-user", role: "admin" });
      metadata.workspaces.upsert({
        id: "preschool-demo-org",
        owner_user_id: "dev-user",
        name: "Preschool Demo",
        kind: "customer",
      });
      metadata.workspaceMemberships.upsert({
        workspace_id: "preschool-demo-org",
        user_id: "dev-user",
        role: "owner",
      });
      metadata.energyIq.projectSetup.bootstrapPublished({
        project: {
          id: "preschool-demo",
          workspace_id: "preschool-demo-org",
          name: "Preschool Portfolio",
          timezone: "Asia/Singapore",
          hierarchy_revision_id: "preschool-hierarchy-v4",
          meter_formula_revision_id: "preschool-meter-formula-v2",
          data_snapshot_id: "legacy-preschool-snapshot",
          metric_version: "energy-metrics-v1",
          business_calendar_version: "legacy-preschool-calendar",
          tariff_schedule_version: "legacy-preschool-tariff",
          root_scope_id: "preschool-project",
        },
        document: {
          project: { name: "Preschool Portfolio", timezone: "Asia/Singapore" },
          tier_structure_locked: true,
          tiers: [{ id: "preschool-tier-centre", ordinal: 1, alias: "Centre" }],
          nodes: [{
            id: "preschool-centre-a",
            tier_definition_id: "preschool-tier-centre",
            name: "Centre A",
            sort_order: 1,
            metadata_status: "confirmed",
          }],
        },
        published_by: "dev-user",
      });

      expect(() => resolveEnergyPublishedMeterRoute({
        metadataStore: metadata,
        projectId: "preschool-demo",
        hierarchyRevisionId: "preschool-hierarchy-v4",
        scopeId: "preschool-project",
        resource: "electricity",
      })).toThrow("ENERGYIQ_PUBLISHED_MAPPING_ROUTE_REQUIRED:preschool-hierarchy-v4");

      ensureEnergyIqBootstrap(metadata);

      const migrated = metadata.energyIq.getProject("preschool-demo");
      expect(migrated).toMatchObject({
        hierarchy_revision_id: "preschool-demo-hierarchy-v5",
        data_snapshot_id: "legacy-preschool-snapshot",
        business_calendar_version: "legacy-preschool-calendar",
        tariff_schedule_version: "legacy-preschool-tariff",
      });
      expect(resolveEnergyPublishedMeterRoute({
        metadataStore: metadata,
        projectId: "preschool-demo",
        hierarchyRevisionId: migrated.hierarchy_revision_id,
        scopeId: migrated.root_scope_id,
        resource: "electricity",
      })).toMatchObject({
        source: "published",
        officialMeterPointIds: expect.arrayContaining(["preschool-centre-a-aircon-1"]),
      });

      const firstRevision = metadata.energyIq.templates.getLatestProjectRevision("preschool-demo");
      const firstHierarchyCount = metadata.energyIq.projectSetup
        .listHierarchyRevisions("preschool-demo").length;
      ensureEnergyIqBootstrap(metadata);
      expect(metadata.energyIq.getProject("preschool-demo").hierarchy_revision_id)
        .toBe("preschool-demo-hierarchy-v5");
      expect(metadata.energyIq.projectSetup.listHierarchyRevisions("preschool-demo"))
        .toHaveLength(firstHierarchyCount);
      expect(metadata.energyIq.templates.getLatestProjectRevision("preschool-demo")?.revision_id)
        .toBe(firstRevision?.revision_id);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("enables the release-pinned daily anomaly Rule for a new Ngee Ann Project only", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-bootstrap-rules-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);

      expect(metadata.energyIq.rules.getProjectConfig("ngee-ann-polytechnic"))
        .toMatchObject({
          revision: 1,
          selected_rule_revision_ids: expect.arrayContaining([
            "comparison.daily_usage_above_baseline@1",
          ]),
        });
      expect(metadata.energyIq.rules.getProjectConfig("preschool-demo")
        .selected_rule_revision_ids)
        .not.toContain("comparison.daily_usage_above_baseline@1");

      ensureEnergyIqBootstrap(metadata);
      expect(metadata.energyIq.rules.getProjectConfig("ngee-ann-polytechnic").revision).toBe(1);

      const configured = metadata.energyIq.rules.getProjectConfig("ngee-ann-polytechnic");
      metadata.energyIq.rules.saveProjectConfig({
        project_id: "ngee-ann-polytechnic",
        expected_revision: configured.revision,
        selected_rule_revision_ids: configured.selected_rule_revision_ids.filter(
          (id) => id !== "comparison.daily_usage_above_baseline@1",
        ),
        updated_by: "dev-user",
      });
      ensureEnergyIqBootstrap(metadata);
      expect(metadata.energyIq.rules.getProjectConfig("ngee-ann-polytechnic"))
        .toMatchObject({
          revision: 2,
          selected_rule_revision_ids: expect.not.arrayContaining([
            "comparison.daily_usage_above_baseline@1",
          ]),
        });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("attaches immutable Overview Definitions to existing pilot Template Revisions", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-bootstrap-overview-definition-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      for (const projectId of ["ngee-ann-polytechnic", "preschool-demo"] as const) {
        const project = metadata.energyIq.getProject(projectId);
        const revision = metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
          project_id: projectId,
          tier_definition_ids: metadata.energyIq.listTierDefinitions(projectId).map((tier) => tier.id),
          hierarchy_revision_id: project.hierarchy_revision_id,
          meter_mapping_revision_id: resolveEnergyPublishedMeterRoute({
            metadataStore: metadata,
            projectId,
            hierarchyRevisionId: project.hierarchy_revision_id,
            scopeId: project.root_scope_id,
            resource: "electricity",
          }).meterMappingRevisionId,
          published_by: "dev-user",
          published_at: "2026-08-19T00:00:00.000Z",
        });
        expect(metadata.energyIq.overviewDefinitions.get(revision.revision_id)).toBeNull();
      }

      ensureEnergyIqBootstrap(metadata);

      const ngeeRevision = metadata.energyIq.templates.getLatestProjectRevision("ngee-ann-polytechnic");
      const preschoolRevision = metadata.energyIq.templates.getLatestProjectRevision("preschool-demo");
      const ngeeDefinition = metadata.energyIq.overviewDefinitions.get(ngeeRevision!.revision_id);
      expect(ngeeDefinition).toMatchObject({
        renderer_key: "ngee-ann-overview",
        time_policy_revision_id: "ngee-ann-report-time@1",
        definition: { sections: expect.arrayContaining([expect.objectContaining({ primaryWindowId: "current-month-progress" })]) },
      });
      expect(ngeeDefinition?.definition.sections
        .find((section) => section.key === "circuit-analysis")
        ?.blocks.find((block) => block.key === "ngee-recommendations"))
        .toMatchObject({ windowId: "current-month-progress" });
      expect(metadata.energyIq.overviewDefinitions.get(preschoolRevision!.revision_id)).toMatchObject({
        renderer_key: "preschool-overview",
        time_policy_revision_id: "preschool-report-time@1",
        definition: { sections: expect.arrayContaining([expect.objectContaining({ primaryWindowId: "current-overview" })]) },
      });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
