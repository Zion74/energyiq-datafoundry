import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createMetadataStore } from "./index.js";

describe("EnergyIqStore", () => {
  it("stores the controlled component catalog and one draft per Project and Tier", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-template-store-"));
    try {
      const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata.workspaces.upsert({ id: "template-workspace", owner_user_id: "dev-user", name: "Templates", kind: "customer" });
      metadata.energyIq.upsertProject({ id: "template-project", workspace_id: "template-workspace", name: "Templates", status: "draft" });

      const catalog = metadata.energyIq.templates.listComponentRevisions();
      expect(catalog.map((component) => component.revision_id)).toEqual(expect.arrayContaining([
        "decision.recommended_actions@1",
        "decision.executive_actions@1",
        "comparison.child_scope_ranking@1",
        "composition.meter_breakdown@1",
      ]));
      expect(catalog.find((component) => component.revision_id === "comparison.child_scope_ranking@1")?.allowed_presentation).toMatchObject({
        layout: { spans: [6, 8, 12] },
        visuals: {
          presets: ["bar", "list"],
          legend: { configurable: true, default: true },
          limit: { configurable: true, min: 1, max: 25, default: 10 },
        },
      });
      const initial = metadata.energyIq.templates.getProjectDraft({
        project_id: "template-project",
        tier_definition_ids: ["tier-circuit", "tier-level"],
      });
      expect(initial.revision).toBe(0);
      expect(initial.document.templates.map((template) => template.template_id)).toEqual([
        "project",
        "tier:tier-circuit",
        "tier:tier-level",
      ]);
      expect(initial.document.schema_version).toBe(2);
      expect(initial.document.templates[0]?.sections?.map((section) => section.section_id)).toEqual([
        "action-summary",
        "data-status",
        "energy-overview",
        "comparison",
        "time-pattern",
        "composition",
        "exceptions",
      ]);
      expect(initial.document.templates[0]?.components.map((item) => item.component_revision_id))
        .not.toContain("composition.meter_breakdown@1");
      expect(initial.document.templates[1]?.components.map((item) => item.component_revision_id))
        .toContain("composition.meter_breakdown@1");

      const projectTemplate = initial.document.templates[0]!;
      const saved = metadata.energyIq.templates.saveProjectDraft({
        project_id: "template-project",
        expected_revision: 0,
        tier_definition_ids: ["tier-circuit", "tier-level"],
        document: {
          templates: [
            {
              ...projectTemplate,
              components: projectTemplate.components.map((component, index) => ({
                ...component,
                enabled: index !== 0,
                ...(index === 0 ? {
                  layout: { span: 8 as const, height: "tall" as const },
                  presentation: {
                    ...component.presentation!,
                    tone: "highlight" as const,
                    title: "Project decision brief",
                  },
                } : {}),
              })),
            },
            ...initial.document.templates.slice(1),
          ],
        },
        updated_by: "dev-user",
      });
      expect(saved.revision).toBe(1);
      expect(saved.document.templates[0]?.components[0]?.enabled).toBe(false);
      expect(saved.document.templates[0]?.components[0]).toMatchObject({
        layout: { span: 8, height: "tall" },
        presentation: { tone: "highlight", title: "Project decision brief" },
      });
      expect(saved.document.templates[0]?.components[1]).toMatchObject({
        placement_id: expect.any(String),
        section_id: expect.any(String),
        layout: { span: expect.any(Number), height: expect.any(String) },
        presentation: { visual_preset: expect.any(String), density: expect.any(String), tone: expect.any(String) },
      });
      const reconciled = metadata.energyIq.templates.getProjectDraft({
        project_id: "template-project",
        tier_definition_ids: ["tier-circuit", "tier-room", "tier-level"],
      });
      expect(reconciled.revision).toBe(1);
      expect(reconciled.document.templates.map((template) => template.template_id)).toContain("tier:tier-room");
      expect(reconciled.document.templates[0]?.components[0]?.enabled).toBe(false);
      expect(() => metadata.energyIq.templates.saveProjectDraft({
        project_id: "template-project",
        expected_revision: 0,
        tier_definition_ids: ["tier-circuit", "tier-level"],
        document: saved.document,
        updated_by: "dev-user",
      })).toThrow("ENERGYIQ_TEMPLATE_DRAFT_REVISION_CONFLICT");
      expect(() => metadata.energyIq.templates.saveProjectDraft({
        project_id: "template-project",
        expected_revision: 1,
        tier_definition_ids: ["tier-circuit", "tier-level"],
        document: {
          templates: saved.document.templates.map((template) => template.template_id === "project"
            ? {
                ...template,
                components: [{ component_revision_id: "composition.meter_breakdown@1", enabled: true }],
              }
            : template),
        },
        updated_by: "dev-user",
      })).toThrow("ENERGYIQ_TEMPLATE_COMPONENT_TARGET_INVALID");
      expect(() => metadata.energyIq.templates.saveProjectDraft({
        project_id: "template-project",
        expected_revision: 1,
        tier_definition_ids: ["tier-circuit", "tier-level"],
        document: {
          ...saved.document,
          templates: saved.document.templates.map((template) => template.template_id === "project"
            ? {
                ...template,
                components: template.components.map((component, index) => index < 2
                  ? { ...component, placement_id: "duplicate-placement" }
                  : component),
              }
            : template),
        },
        updated_by: "dev-user",
      })).toThrow("ENERGYIQ_TEMPLATE_PLACEMENT_ID_INVALID");
      expect(() => metadata.energyIq.templates.saveProjectDraft({
        project_id: "template-project",
        expected_revision: 1,
        tier_definition_ids: ["tier-circuit", "tier-level"],
        document: {
          ...saved.document,
          templates: saved.document.templates.map((template) => template.template_id === "project"
            ? {
                ...template,
                components: template.components.map((component) => component.component_revision_id === "comparison.child_scope_ranking@1"
                  ? { ...component, presentation: { ...component.presentation!, visual_preset: "cards" as const } }
                  : component),
              }
            : template),
        },
        updated_by: "dev-user",
      })).toThrow("ENERGYIQ_TEMPLATE_COMPONENT_VISUAL_NOT_ALLOWED");
      expect(() => metadata.energyIq.templates.saveProjectDraft({
        project_id: "template-project",
        expected_revision: 1,
        tier_definition_ids: ["tier-circuit", "tier-level"],
        document: {
          ...saved.document,
          templates: saved.document.templates.map((template) => template.template_id === "project"
            ? {
                ...template,
                components: template.components.map((component) => component.component_revision_id === "overview.consumption@1"
                  ? { ...component, layout: { ...component.layout!, span: 4 as const } }
                  : component),
              }
            : template),
        },
        updated_by: "dev-user",
      })).toThrow("ENERGYIQ_TEMPLATE_COMPONENT_SPAN_NOT_ALLOWED");

      metadata.close();
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("stores immutable rule revisions and versioned project selections", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-rules-store-"));
    try {
      const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata.workspaces.upsert({ id: "rules-workspace", owner_user_id: "dev-user", name: "Rules", kind: "customer" });
      metadata.energyIq.upsertProject({ id: "rules-project", workspace_id: "rules-workspace", name: "Rules", status: "draft" });

      const catalog = metadata.energyIq.rules.listRevisions();
      expect(catalog.map((rule) => rule.revision_id)).toContain("time.high_off_hours_share@1");
      expect(catalog.map((rule) => rule.revision_id)).toContain("comparison.people_intensity_outlier@1");
      expect(metadata.energyIq.rules.getProjectConfig("rules-project")).toMatchObject({
        revision: 0,
        selected_rule_revision_ids: catalog.map((rule) => rule.revision_id),
      });

      const saved = metadata.energyIq.rules.saveProjectConfig({
        project_id: "rules-project",
        expected_revision: 0,
        selected_rule_revision_ids: ["quality.no_valid_data@1", "time.high_off_hours_share@1"],
        updated_by: "dev-user",
      });
      expect(saved).toMatchObject({
        revision: 1,
        selected_rule_revision_ids: ["quality.no_valid_data@1", "time.high_off_hours_share@1"],
      });
      expect(() => metadata.energyIq.rules.saveProjectConfig({
        project_id: "rules-project",
        expected_revision: 0,
        selected_rule_revision_ids: [],
        updated_by: "dev-user",
      })).toThrow("ENERGYIQ_RULE_CONFIG_REVISION_CONFLICT");
      expect(() => metadata.energyIq.rules.saveProjectConfig({
        project_id: "rules-project",
        expected_revision: 1,
        selected_rule_revision_ids: ["rule.unknown@1"],
        updated_by: "dev-user",
      })).toThrow("ENERGYIQ_RULE_REVISION_NOT_FOUND");

      metadata.close();
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("stores immutable metric revisions and versioned project selections", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-metrics-store-"));
    try {
      const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata.workspaces.upsert({
        id: "metrics-workspace",
        owner_user_id: "dev-user",
        name: "Metrics Workspace",
        kind: "customer"
      });
      metadata.energyIq.upsertProject({
        id: "metrics-project",
        workspace_id: "metrics-workspace",
        name: "Metrics Project",
        status: "draft"
      });

      const catalog = metadata.energyIq.metrics.listRevisions();
      expect(catalog.map((metric) => metric.revision_id)).toContain("energy.total_usage_kwh@1");
      expect(catalog.map((metric) => metric.revision_id)).toContain("energy.usage_per_person@1");

      const initial = metadata.energyIq.metrics.getProjectConfig("metrics-project");
      expect(initial.revision).toBe(0);
      expect(initial.selected_metric_revision_ids).toHaveLength(catalog.length);

      const saved = metadata.energyIq.metrics.saveProjectConfig({
        project_id: "metrics-project",
        expected_revision: 0,
        selected_metric_revision_ids: ["energy.total_usage_kwh@1", "energy.peak_demand_kw@1"],
        updated_by: "dev-user"
      });
      expect(saved.revision).toBe(1);
      expect(saved.selected_metric_revision_ids).toEqual([
        "energy.total_usage_kwh@1",
        "energy.peak_demand_kw@1"
      ]);

      expect(() => metadata.energyIq.metrics.saveProjectConfig({
        project_id: "metrics-project",
        expected_revision: 0,
        selected_metric_revision_ids: ["energy.total_usage_kwh@1"],
        updated_by: "dev-user"
      })).toThrow("ENERGYIQ_METRIC_CONFIG_REVISION_CONFLICT");
      expect(() => metadata.energyIq.metrics.saveProjectConfig({
        project_id: "metrics-project",
        expected_revision: 1,
        selected_metric_revision_ids: ["energy.unknown@1"],
        updated_by: "dev-user"
      })).toThrow("ENERGYIQ_METRIC_REVISION_NOT_FOUND");

      metadata.close();
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("uses customer Workspace membership as the published Project visibility boundary", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-access-store-"));
    try {
      const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata.users.upsertDevUser({
        id: "member-user",
        email: "member@example.com",
        display_name: "Member User",
        dev_token: "member-token"
      });
      metadata.workspaces.upsert({
        id: "customer-a",
        owner_user_id: "dev-user",
        name: "Customer A",
        kind: "customer"
      });
      metadata.workspaceMemberships.upsert({
        workspace_id: "customer-a",
        user_id: "member-user",
        role: "member"
      });
      metadata.energyIq.upsertProject({
        id: "published-a",
        workspace_id: "customer-a",
        name: "Published A",
        status: "published"
      });
      metadata.energyIq.upsertProject({
        id: "draft-a",
        workspace_id: "customer-a",
        name: "Draft A",
        status: "draft"
      });

      expect(metadata.energyIq.listVisibleProjects({
        user_id: "member-user",
        workspace_id: "customer-a",
        is_admin: false
      }).map((project) => project.id)).toEqual(["published-a"]);
      expect(metadata.energyIq.listVisibleProjects({
        user_id: "outsider",
        workspace_id: "customer-a",
        is_admin: false
      })).toEqual([]);
      expect(metadata.energyIq.listVisibleProjects({
        user_id: "dev-user",
        workspace_id: "customer-a",
        is_admin: true
      }).map((project) => project.id)).toEqual(["published-a", "draft-a"]);
      metadata.close();
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

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

      const templateDraft = metadata.energyIq.templates.getProjectDraft({
        project_id: "project-setup",
        tier_definition_ids: ["tier-level", "tier-circuit"],
      });
      const savedTemplateDraft = metadata.energyIq.templates.saveProjectDraft({
        project_id: "project-setup",
        expected_revision: templateDraft.revision,
        tier_definition_ids: ["tier-level", "tier-circuit"],
        document: {
          templates: templateDraft.document.templates.map((template) => template.template_id === "project"
            ? {
                ...template,
                components: template.components.map((component, index) => ({
                  ...component,
                  enabled: index !== 0,
                })),
              }
            : template),
        },
        updated_by: "dev-user",
      });
      const metricConfig = metadata.energyIq.metrics.saveProjectConfig({
        project_id: "project-setup",
        expected_revision: 0,
        selected_metric_revision_ids: ["energy.total_usage_kwh@1", "energy.peak_demand_kw@1"],
        updated_by: "dev-user",
      });
      const ruleConfig = metadata.energyIq.rules.saveProjectConfig({
        project_id: "project-setup",
        expected_revision: 0,
        selected_rule_revision_ids: ["quality.no_valid_data@1"],
        updated_by: "dev-user",
      });

      const published = metadata.energyIq.projectSetup.publishDraft({
        project_id: "project-setup",
        expected_revision: saved.revision,
        user_id: "dev-user",
        expected_template_draft_revision: savedTemplateDraft.revision,
        expected_metric_config_revision: metricConfig.revision,
        expected_rule_config_revision: ruleConfig.revision,
      });
      expect(published.hierarchy_revision_id).toBe("project-setup-hierarchy-v1");
      expect(published.template_revision_id).toBe("project-setup-template-v1");
      const publishedTemplate = metadata.energyIq.templates.getLatestProjectRevision("project-setup");
      expect(publishedTemplate).toMatchObject({
        revision_id: "project-setup-template-v1",
        hierarchy_revision_id: "project-setup-hierarchy-v1",
        source_template_draft_revision: 1,
        metric_config_revision: 1,
        selected_metric_revision_ids: ["energy.total_usage_kwh@1", "energy.peak_demand_kw@1"],
        rule_config_revision: 1,
        selected_rule_revision_ids: ["quality.no_valid_data@1"],
      });
      expect(publishedTemplate?.document.templates[0]?.components[0]?.enabled).toBe(false);
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
      metadata.energyIq.templates.saveProjectDraft({
        project_id: "project-setup",
        expected_revision: savedTemplateDraft.revision,
        tier_definition_ids: ["tier-level", "tier-circuit"],
        document: templateDraft.document,
        updated_by: "dev-user",
      });
      expect(metadata.energyIq.templates.getLatestProjectRevision("project-setup"))
        .toEqual(publishedTemplate);
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
