import type { DatabaseSync } from "node:sqlite";

import { EnergyIqTemplateStore } from "./energyiq-template-store.js";

export type EnergyIqMetadataStatus = "provisional" | "confirmed";
export type EnergyIqDeliveryStage = "draft" | "configured" | "published";
export type EnergyIqSetupIssueSeverity = "error" | "warning";

export type EnergyIqTierDefinition = {
  id: string;
  ordinal: number;
  alias: string;
  description?: string;
};

export type EnergyIqProjectSetupNode = {
  id: string;
  tier_definition_id: string;
  parent_id?: string;
  name: string;
  sort_order: number;
  area_sqm?: number;
  occupant_count?: number;
  metadata_status: EnergyIqMetadataStatus;
  effective_from?: string;
  effective_to?: string;
  independent_reason?: string;
  metadata?: Record<string, unknown>;
};

export type EnergyIqMeterCategory = "overall" | "load" | "light" | "aircon" | "other";
export type EnergyIqMeterCoverage = "whole" | "partial" | "reference";
export type EnergyIqMeterRole = "total" | "component" | "standalone";
export type EnergyIqAggregationUsage = "official" | "excluded";

export type EnergyIqMeterMappingRow = {
  id: string;
  source_label: string;
  scope_id: string;
  display_name: string;
  resource: "electricity" | "water";
  category: EnergyIqMeterCategory;
  coverage: EnergyIqMeterCoverage;
  meter_role: EnergyIqMeterRole;
  aggregation_usage: EnergyIqAggregationUsage;
};

export type EnergyIqVirtualMeterTerm = {
  mapping_row_id: string;
  coefficient: 1 | -1;
};

export type EnergyIqVirtualMeter = {
  id: string;
  display_name: string;
  scope_id: string;
  resource: "electricity" | "water";
  category: EnergyIqMeterCategory;
  terms: EnergyIqVirtualMeterTerm[];
};

export type EnergyIqMeterMappingDraft = {
  source_kind: "excel" | "tuya";
  rows: EnergyIqMeterMappingRow[];
  virtual_meters?: EnergyIqVirtualMeter[];
  confirmed: boolean;
};

export type EnergyIqProjectSetupDocument = {
  project: {
    name: string;
    timezone: string;
  };
  tier_structure_locked: boolean;
  tiers: EnergyIqTierDefinition[];
  nodes: EnergyIqProjectSetupNode[];
  meter_mapping?: EnergyIqMeterMappingDraft;
};

export type EnergyIqProjectSetupDraft = {
  project_id: string;
  revision: number;
  based_on_hierarchy_revision_id?: string;
  document: EnergyIqProjectSetupDocument;
  updated_by: string;
  updated_at: string;
};

export type EnergyIqProjectSetupIssue = {
  code: string;
  severity: EnergyIqSetupIssueSeverity;
  message: string;
  path?: string;
};

export type EnergyIqProjectSetupValidation = {
  blocking: boolean;
  issues: EnergyIqProjectSetupIssue[];
};

export type EnergyIqTierDefinitionRecord = EnergyIqTierDefinition & {
  project_id: string;
  hierarchy_revision_id: string;
  created_at: string;
  updated_at: string;
};

export type EnergyIqHierarchyRevisionRecord = {
  id: string;
  project_id: string;
  sequence: number;
  snapshot_json: string;
  validation_json: string;
  published_by: string;
  published_at: string;
};

export type EnergyIqProjectBootstrapInput = {
  project: {
    id: string;
    workspace_id: string;
    name: string;
    timezone?: string;
    hierarchy_revision_id: string;
    meter_formula_revision_id: string;
    data_snapshot_id?: string;
    metric_version?: string;
    business_calendar_version?: string;
    tariff_schedule_version?: string;
    root_scope_id: string;
  };
  document: EnergyIqProjectSetupDocument;
  published_by: string;
};

export const initializeEnergyIqProjectSetupSchema = (db: DatabaseSync): void => {
  ensureColumn(db, "energyiq_projects", "delivery_stage", "TEXT NOT NULL DEFAULT 'draft'");
  ensureColumn(db, "energyiq_projects", "root_scope_id", "TEXT");
  ensureColumn(db, "energyiq_projects", "has_unpublished_changes", "INTEGER NOT NULL DEFAULT 0");

  ensureColumn(db, "energyiq_project_nodes", "tier_definition_id", "TEXT");
  ensureColumn(db, "energyiq_project_nodes", "hierarchy_revision_id", "TEXT");
  ensureColumn(db, "energyiq_project_nodes", "metadata_status", "TEXT NOT NULL DEFAULT 'provisional'");
  ensureColumn(db, "energyiq_project_nodes", "effective_from", "TEXT");
  ensureColumn(db, "energyiq_project_nodes", "effective_to", "TEXT");
  ensureColumn(db, "energyiq_project_nodes", "independent_reason", "TEXT");

  db.exec(`
    UPDATE energyiq_projects
    SET root_scope_id = COALESCE(
      (
        SELECT n.id
        FROM energyiq_project_nodes n
        WHERE n.project_id = energyiq_projects.id AND n.parent_id IS NULL
        ORDER BY n.sort_order, n.name
        LIMIT 1
      ),
      id || '-project'
    )
    WHERE root_scope_id IS NULL OR root_scope_id = '';

    UPDATE energyiq_projects
    SET delivery_stage = CASE
      WHEN status = 'published' THEN 'published'
      ELSE 'draft'
    END
    WHERE delivery_stage IS NULL OR delivery_stage = '';

    CREATE TABLE IF NOT EXISTS energyiq_hierarchy_revisions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      validation_json TEXT NOT NULL,
      published_by TEXT NOT NULL,
      published_at TEXT NOT NULL,
      UNIQUE(project_id, sequence),
      FOREIGN KEY (project_id) REFERENCES energyiq_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (published_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_energyiq_hierarchy_revisions_project
      ON energyiq_hierarchy_revisions(project_id, sequence DESC);

    CREATE TABLE IF NOT EXISTS energyiq_tier_definitions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      hierarchy_revision_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 1 AND 7),
      alias TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, ordinal),
      FOREIGN KEY (project_id) REFERENCES energyiq_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (hierarchy_revision_id) REFERENCES energyiq_hierarchy_revisions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_energyiq_tier_definitions_project
      ON energyiq_tier_definitions(project_id, ordinal);

    CREATE TABLE IF NOT EXISTS energyiq_project_setup_drafts (
      project_id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL,
      based_on_hierarchy_revision_id TEXT,
      document_json TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES energyiq_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (updated_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS energyiq_node_metadata_revisions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      hierarchy_revision_id TEXT NOT NULL,
      area_sqm REAL,
      occupant_count INTEGER,
      metadata_status TEXT NOT NULL,
      effective_from TEXT,
      effective_to TEXT,
      independent_reason TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES energyiq_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (hierarchy_revision_id) REFERENCES energyiq_hierarchy_revisions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_energyiq_node_metadata_revisions_node
      ON energyiq_node_metadata_revisions(project_id, node_id, created_at DESC);
  `);
};

export class EnergyIqProjectSetupStore {
  constructor(private readonly db: DatabaseSync) {}

  getDraft(input: {
    project_id: string;
    user_id: string;
  }): EnergyIqProjectSetupDraft {
    const existing = this.db.prepare(
      "SELECT * FROM energyiq_project_setup_drafts WHERE project_id = ?"
    ).get(input.project_id);
    if (isRecord(existing)) {
      return mapDraft(existing);
    }

    const project = this.requireProject(input.project_id);
    const document = this.buildDocumentFromPublished(input.project_id, project);
    const now = new Date().toISOString();
    const basedOn = asString(project.hierarchy_revision_id);
    this.db.prepare(`
      INSERT INTO energyiq_project_setup_drafts (
        project_id, revision, based_on_hierarchy_revision_id,
        document_json, updated_by, updated_at
      ) VALUES (?, 1, ?, ?, ?, ?)
    `).run(
      input.project_id,
      basedOn || null,
      JSON.stringify(document),
      input.user_id,
      now
    );
    return this.requireDraft(input.project_id);
  }

  saveDraft(input: {
    project_id: string;
    expected_revision: number;
    user_id: string;
    document: EnergyIqProjectSetupDocument;
  }): EnergyIqProjectSetupDraft {
    const current = this.getDraft({
      project_id: input.project_id,
      user_id: input.user_id
    });
    if (current.revision !== input.expected_revision) {
      throw new Error("ENERGYIQ_SETUP_REVISION_CONFLICT");
    }

    const document = canonicalizeDocument(input.document);
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE energyiq_project_setup_drafts
      SET revision = revision + 1,
          document_json = ?,
          updated_by = ?,
          updated_at = ?
      WHERE project_id = ? AND revision = ?
    `).run(
      JSON.stringify(document),
      input.user_id,
      now,
      input.project_id,
      input.expected_revision
    );
    if (Number(result.changes) !== 1) {
      throw new Error("ENERGYIQ_SETUP_REVISION_CONFLICT");
    }
    this.db.prepare(`
      UPDATE energyiq_projects
      SET has_unpublished_changes = 1,
          delivery_stage = CASE WHEN status = 'published' THEN 'configured' ELSE 'draft' END,
          updated_at = ?
      WHERE id = ?
    `).run(now, input.project_id);
    return this.requireDraft(input.project_id);
  }

  validateDraft(projectId: string): EnergyIqProjectSetupValidation {
    return validateProjectSetupDocument(this.requireDraft(projectId).document);
  }

  publishDraft(input: {
    project_id: string;
    expected_revision: number;
    user_id: string;
    expected_template_draft_revision?: number;
    expected_metric_config_revision?: number;
    expected_rule_config_revision?: number;
  }): {
    hierarchy_revision_id: string;
    template_revision_id: string;
    validation: EnergyIqProjectSetupValidation;
  } {
    const draft = this.requireDraft(input.project_id);
    if (draft.revision !== input.expected_revision) {
      throw new Error("ENERGYIQ_SETUP_REVISION_CONFLICT");
    }
    const validation = validateProjectSetupDocument(draft.document);
    if (validation.blocking) {
      const codes = validation.issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => issue.code)
        .join(",");
      throw new Error(`ENERGYIQ_SETUP_INVALID:${codes}`);
    }

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const sequence = this.nextHierarchySequence(input.project_id);
      const hierarchyRevisionId = `${input.project_id}-hierarchy-v${sequence}`;
      const now = new Date().toISOString();
      this.insertHierarchyRevision({
        id: hierarchyRevisionId,
        project_id: input.project_id,
        sequence,
        document: draft.document,
        validation,
        published_by: input.user_id,
        published_at: now
      });
      this.materializePublishedDocument({
        project_id: input.project_id,
        hierarchy_revision_id: hierarchyRevisionId,
        document: draft.document,
        now
      });
      const pendingPolicies = this.resolvePendingOperationalPolicies(input.project_id);
      this.db.prepare(`
        UPDATE energyiq_projects
        SET business_calendar_version = ?,
            tariff_schedule_version = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        pendingPolicies.business_calendar_version,
        pendingPolicies.tariff_schedule_version,
        now,
        input.project_id,
      );
      const templateRevision = new EnergyIqTemplateStore(this.db).publishProjectRevisionWithinTransaction({
        project_id: input.project_id,
        tier_definition_ids: [...draft.document.tiers]
          .sort((left, right) => right.ordinal - left.ordinal)
          .map((tier) => tier.id),
        hierarchy_revision_id: hierarchyRevisionId,
        published_by: input.user_id,
        published_at: now,
        ...(input.expected_template_draft_revision !== undefined
          ? { expected_template_draft_revision: input.expected_template_draft_revision }
          : {}),
        ...(input.expected_metric_config_revision !== undefined
          ? { expected_metric_config_revision: input.expected_metric_config_revision }
          : {}),
        ...(input.expected_rule_config_revision !== undefined
          ? { expected_rule_config_revision: input.expected_rule_config_revision }
          : {}),
      });
      this.db.prepare(`
        UPDATE energyiq_projects
        SET name = ?,
            timezone = ?,
            status = 'published',
            delivery_stage = 'published',
            hierarchy_revision_id = ?,
            has_unpublished_changes = 0,
            updated_at = ?
        WHERE id = ?
      `).run(
        draft.document.project.name,
        draft.document.project.timezone,
        hierarchyRevisionId,
        now,
        input.project_id
      );
      this.db.prepare(`
        UPDATE energyiq_project_setup_drafts
        SET revision = revision + 1,
            based_on_hierarchy_revision_id = ?,
            updated_by = ?,
            updated_at = ?
        WHERE project_id = ? AND revision = ?
      `).run(
        hierarchyRevisionId,
        input.user_id,
        now,
        input.project_id,
        input.expected_revision
      );
      this.db.exec("COMMIT");
      return {
        hierarchy_revision_id: hierarchyRevisionId,
        template_revision_id: templateRevision.revision_id,
        validation,
      };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private resolvePendingOperationalPolicies(projectId: string): {
    business_calendar_version: string;
    tariff_schedule_version: string;
  } {
    const row = this.db.prepare(`
      SELECT
        COALESCE(binding.business_calendar_version, project.business_calendar_version) AS business_calendar_version,
        COALESCE(binding.tariff_schedule_version, project.tariff_schedule_version) AS tariff_schedule_version
      FROM energyiq_projects project
      LEFT JOIN energyiq_operational_policy_bindings binding
        ON binding.project_id = project.id
      WHERE project.id = ?
    `).get(projectId);
    if (!isRecord(row)) throw new Error(`ENERGYIQ_PROJECT_NOT_FOUND:${projectId}`);
    return {
      business_calendar_version: requiredString(row, "business_calendar_version"),
      tariff_schedule_version: requiredString(row, "tariff_schedule_version"),
    };
  }

  bootstrapPublished(input: EnergyIqProjectBootstrapInput): string {
    const now = new Date().toISOString();
    const timezone = input.project.timezone ?? "Asia/Singapore";
    this.db.prepare(`
      INSERT INTO energyiq_projects (
        id, workspace_id, name, status, timezone, hierarchy_revision_id,
        meter_formula_revision_id, data_snapshot_id, metric_version,
        business_calendar_version, tariff_schedule_version,
        delivery_stage, root_scope_id, has_unpublished_changes,
        created_at, updated_at
      ) VALUES (?, ?, ?, 'published', ?, ?, ?, ?, ?, ?, ?, 'published', ?, 0, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(
      input.project.id,
      input.project.workspace_id,
      input.project.name,
      timezone,
      input.project.hierarchy_revision_id,
      input.project.meter_formula_revision_id,
      input.project.data_snapshot_id ?? "unavailable",
      input.project.metric_version ?? "energy-metrics-v1",
      input.project.business_calendar_version ?? "sg-calendar-v1",
      input.project.tariff_schedule_version ?? "sg-tariff-v1",
      input.project.root_scope_id,
      now,
      now
    );

    const latest = this.db.prepare(`
      SELECT * FROM energyiq_hierarchy_revisions
      WHERE project_id = ?
      ORDER BY sequence DESC
      LIMIT 1
    `).get(input.project.id);
    if (isRecord(latest)) {
      return requiredString(latest, "id");
    }

    const document = canonicalizeDocument(input.document);
    const validation = validateProjectSetupDocument(document);
    if (validation.blocking) {
      throw new Error(`ENERGYIQ_BOOTSTRAP_INVALID:${input.project.id}`);
    }

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const hierarchyRevisionId = input.project.hierarchy_revision_id;
      this.insertHierarchyRevision({
        id: hierarchyRevisionId,
        project_id: input.project.id,
        sequence: hierarchySequenceFromId(hierarchyRevisionId),
        document,
        validation,
        published_by: input.published_by,
        published_at: now
      });
      this.materializePublishedDocument({
        project_id: input.project.id,
        hierarchy_revision_id: hierarchyRevisionId,
        document,
        now
      });
      this.db.prepare(`
        UPDATE energyiq_projects
        SET name = ?,
            timezone = ?,
            status = 'published',
            delivery_stage = 'published',
            hierarchy_revision_id = ?,
            root_scope_id = ?,
            has_unpublished_changes = 0,
            updated_at = ?
        WHERE id = ?
      `).run(
        document.project.name,
        document.project.timezone,
        hierarchyRevisionId,
        input.project.root_scope_id,
        now,
        input.project.id
      );
      this.db.exec("COMMIT");
      return hierarchyRevisionId;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listTierDefinitions(projectId: string): EnergyIqTierDefinitionRecord[] {
    return this.db.prepare(`
      SELECT * FROM energyiq_tier_definitions
      WHERE project_id = ?
      ORDER BY ordinal
    `).all(projectId).filter(isRecord).map(mapTierDefinition);
  }

  listHierarchyRevisions(projectId: string): EnergyIqHierarchyRevisionRecord[] {
    return this.db.prepare(`
      SELECT * FROM energyiq_hierarchy_revisions
      WHERE project_id = ?
      ORDER BY sequence DESC
    `).all(projectId).filter(isRecord).map(mapHierarchyRevision);
  }

  private buildDocumentFromPublished(
    projectId: string,
    project: Record<string, unknown>
  ): EnergyIqProjectSetupDocument {
    const tiers = this.listTierDefinitions(projectId).map((tier) => ({
      id: tier.id,
      ordinal: tier.ordinal,
      alias: tier.alias,
      ...(tier.description ? { description: tier.description } : {})
    }));
    const rootScopeId = asString(project.root_scope_id);
    const nodes = this.db.prepare(`
      SELECT * FROM energyiq_project_nodes
      WHERE project_id = ? AND tier_definition_id IS NOT NULL
      ORDER BY sort_order, name
    `).all(projectId).filter(isRecord).map((row) => {
      const parentId = asString(row.parent_id);
      const metadataJson = asString(row.metadata_json);
      return {
        id: requiredString(row, "id"),
        tier_definition_id: requiredString(row, "tier_definition_id"),
        ...(parentId && parentId !== rootScopeId ? { parent_id: parentId } : {}),
        name: requiredString(row, "name"),
        sort_order: Number(row.sort_order),
        ...(typeof row.area_sqm === "number" ? { area_sqm: row.area_sqm } : {}),
        ...(typeof row.occupant_count === "number"
          ? { occupant_count: row.occupant_count }
          : {}),
        metadata_status: (asString(row.metadata_status) || "provisional") as EnergyIqMetadataStatus,
        ...(asString(row.effective_from) ? { effective_from: asString(row.effective_from) } : {}),
        ...(asString(row.effective_to) ? { effective_to: asString(row.effective_to) } : {}),
        ...(asString(row.independent_reason)
          ? { independent_reason: asString(row.independent_reason) }
          : {}),
        ...(metadataJson ? { metadata: parseRecord(metadataJson) } : {})
      } satisfies EnergyIqProjectSetupNode;
    });
    return canonicalizeDocument({
      project: {
        name: requiredString(project, "name"),
        timezone: requiredString(project, "timezone")
      },
      tier_structure_locked: tiers.length > 0,
      tiers,
      nodes
    });
  }

  private materializePublishedDocument(input: {
    project_id: string;
    hierarchy_revision_id: string;
    document: EnergyIqProjectSetupDocument;
    now: string;
  }): void {
    const project = this.requireProject(input.project_id);
    const rootScopeId = asString(project.root_scope_id) || `${input.project_id}-project`;
    this.db.prepare("DELETE FROM energyiq_project_nodes WHERE project_id = ?").run(input.project_id);
    this.db.prepare("DELETE FROM energyiq_tier_definitions WHERE project_id = ?").run(input.project_id);

    const insertTier = this.db.prepare(`
      INSERT INTO energyiq_tier_definitions (
        id, project_id, hierarchy_revision_id, ordinal, alias,
        description, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const tier of input.document.tiers) {
      insertTier.run(
        tier.id,
        input.project_id,
        input.hierarchy_revision_id,
        tier.ordinal,
        tier.alias,
        tier.description ?? null,
        input.now,
        input.now
      );
    }

    this.db.prepare(`
      INSERT INTO energyiq_project_nodes (
        id, project_id, parent_id, name, node_type, sort_order,
        area_sqm, occupant_count, metadata_json, tier_definition_id,
        hierarchy_revision_id, metadata_status, effective_from,
        effective_to, independent_reason, created_at, updated_at
      ) VALUES (?, ?, NULL, ?, 'project', 0, NULL, NULL, NULL, NULL, ?, 'confirmed', NULL, NULL, NULL, ?, ?)
    `).run(
      rootScopeId,
      input.project_id,
      input.document.project.name,
      input.hierarchy_revision_id,
      input.now,
      input.now
    );

    const tiersById = new Map(input.document.tiers.map((tier) => [tier.id, tier]));
    const highestOrdinal = Math.max(...input.document.tiers.map((tier) => tier.ordinal));
    const nodes = [...input.document.nodes].sort((left, right) => {
      const leftTier = tiersById.get(left.tier_definition_id)?.ordinal ?? 0;
      const rightTier = tiersById.get(right.tier_definition_id)?.ordinal ?? 0;
      return rightTier - leftTier || left.sort_order - right.sort_order || left.name.localeCompare(right.name);
    });
    const insertNode = this.db.prepare(`
      INSERT INTO energyiq_project_nodes (
        id, project_id, parent_id, name, node_type, sort_order,
        area_sqm, occupant_count, metadata_json, tier_definition_id,
        hierarchy_revision_id, metadata_status, effective_from,
        effective_to, independent_reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMetadataRevision = this.db.prepare(`
      INSERT INTO energyiq_node_metadata_revisions (
        id, project_id, node_id, hierarchy_revision_id,
        area_sqm, occupant_count, metadata_status, effective_from,
        effective_to, independent_reason, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const node of nodes) {
      const tier = tiersById.get(node.tier_definition_id);
      if (!tier) {
        throw new Error(`ENERGYIQ_UNKNOWN_TIER:${node.tier_definition_id}`);
      }
      const parentId = tier.ordinal === highestOrdinal ? rootScopeId : node.parent_id;
      const metadataJson = node.metadata ? JSON.stringify(node.metadata) : null;
      insertNode.run(
        node.id,
        input.project_id,
        parentId ?? null,
        node.name,
        normalizeNodeType(tier.alias),
        node.sort_order,
        node.area_sqm ?? null,
        node.occupant_count ?? null,
        metadataJson,
        node.tier_definition_id,
        input.hierarchy_revision_id,
        node.metadata_status,
        node.effective_from ?? null,
        node.effective_to ?? null,
        node.independent_reason ?? null,
        input.now,
        input.now
      );
      insertMetadataRevision.run(
        `${input.hierarchy_revision_id}:${node.id}`,
        input.project_id,
        node.id,
        input.hierarchy_revision_id,
        node.area_sqm ?? null,
        node.occupant_count ?? null,
        node.metadata_status,
        node.effective_from ?? null,
        node.effective_to ?? null,
        node.independent_reason ?? null,
        metadataJson,
        input.now
      );
    }
  }

  private insertHierarchyRevision(input: {
    id: string;
    project_id: string;
    sequence: number;
    document: EnergyIqProjectSetupDocument;
    validation: EnergyIqProjectSetupValidation;
    published_by: string;
    published_at: string;
  }): void {
    this.db.prepare(`
      INSERT INTO energyiq_hierarchy_revisions (
        id, project_id, sequence, snapshot_json, validation_json,
        published_by, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.project_id,
      input.sequence,
      JSON.stringify(input.document),
      JSON.stringify(input.validation),
      input.published_by,
      input.published_at
    );
  }

  private nextHierarchySequence(projectId: string): number {
    const row = this.db.prepare(`
      SELECT COALESCE(MAX(sequence), 0) AS sequence
      FROM energyiq_hierarchy_revisions
      WHERE project_id = ?
    `).get(projectId);
    return isRecord(row) ? Number(row.sequence) + 1 : 1;
  }

  private requireProject(projectId: string): Record<string, unknown> {
    const row = this.db.prepare("SELECT * FROM energyiq_projects WHERE id = ?").get(projectId);
    if (!isRecord(row)) {
      throw new Error(`ENERGYIQ_PROJECT_NOT_FOUND:${projectId}`);
    }
    return row;
  }

  private requireDraft(projectId: string): EnergyIqProjectSetupDraft {
    const row = this.db.prepare(
      "SELECT * FROM energyiq_project_setup_drafts WHERE project_id = ?"
    ).get(projectId);
    if (!isRecord(row)) {
      throw new Error(`ENERGYIQ_SETUP_DRAFT_NOT_FOUND:${projectId}`);
    }
    return mapDraft(row);
  }
}

export const validateProjectSetupDocument = (
  rawDocument: EnergyIqProjectSetupDocument
): EnergyIqProjectSetupValidation => {
  const document = canonicalizeDocument(rawDocument);
  const issues: EnergyIqProjectSetupIssue[] = [];
  const push = (
    code: string,
    severity: EnergyIqSetupIssueSeverity,
    message: string,
    path?: string
  ): void => {
    issues.push({ code, severity, message, ...(path ? { path } : {}) });
  };

  if (!document.project.name) {
    push("PROJECT_NAME_REQUIRED", "error", "Project name is required.", "project.name");
  }
  if (!document.project.timezone) {
    push("PROJECT_TIMEZONE_REQUIRED", "error", "Project timezone is required.", "project.timezone");
  }
  if (!document.tier_structure_locked) {
    push(
      "TIER_STRUCTURE_NOT_LOCKED",
      "error",
      "Review and lock the Tier Structure before validating the hierarchy.",
      "tier_structure_locked"
    );
  }
  if (document.tiers.length === 0) {
    push("TIER_REQUIRED", "error", "Add at least one analytical tier.", "tiers");
  }
  if (document.tiers.length > 7) {
    push("TIER_LIMIT_EXCEEDED", "error", "A project can contain at most seven tiers.", "tiers");
  }
  if (document.tiers.length > 4) {
    push("DEEP_HIERARCHY", "warning", "Five or more tiers require additional navigation review.", "tiers");
  }

  const tierIds = new Set<string>();
  const ordinals = new Set<number>();
  const aliases = new Set<string>();
  for (const [index, tier] of document.tiers.entries()) {
    if (!tier.id || tierIds.has(tier.id)) {
      push("TIER_ID_DUPLICATE", "error", "Tier IDs must be present and unique.", `tiers[${index}].id`);
    }
    tierIds.add(tier.id);
    if (!Number.isInteger(tier.ordinal) || tier.ordinal < 1 || tier.ordinal > 7 || ordinals.has(tier.ordinal)) {
      push("TIER_ORDINAL_INVALID", "error", "Tier ordinals must be unique integers from 1 to 7.", `tiers[${index}].ordinal`);
    }
    ordinals.add(tier.ordinal);
    const aliasKey = tier.alias.toLocaleLowerCase();
    if (!tier.alias || aliases.has(aliasKey)) {
      push("TIER_ALIAS_DUPLICATE", "error", "Tier display names must be present and unique.", `tiers[${index}].alias`);
    }
    aliases.add(aliasKey);
  }
  const sortedOrdinals = [...ordinals].sort((left, right) => left - right);
  if (sortedOrdinals.some((ordinal, index) => ordinal !== index + 1)) {
    push("TIER_ORDINAL_GAP", "error", "Tier ordinals must be contiguous from Tier 1.", "tiers");
  }

  const tiersById = new Map(document.tiers.map((tier) => [tier.id, tier]));
  const nodesById = new Map<string, EnergyIqProjectSetupNode>();
  const nodesByTier = new Map<string, EnergyIqProjectSetupNode[]>();
  const siblingNames = new Set<string>();
  const highestOrdinal = Math.max(0, ...document.tiers.map((tier) => tier.ordinal));
  for (const [index, node] of document.nodes.entries()) {
    if (!node.id || nodesById.has(node.id)) {
      push("NODE_ID_DUPLICATE", "error", "Node IDs must be present and unique.", `nodes[${index}].id`);
    }
    nodesById.set(node.id, node);
    const tier = tiersById.get(node.tier_definition_id);
    if (!tier) {
      push("NODE_TIER_INVALID", "error", "Each node must reference a configured tier.", `nodes[${index}].tier_definition_id`);
      continue;
    }
    nodesByTier.set(tier.id, [...(nodesByTier.get(tier.id) ?? []), node]);
    if (!node.name) {
      push("NODE_NAME_REQUIRED", "error", "Node name is required.", `nodes[${index}].name`);
    }
    if (tier.ordinal === highestOrdinal && node.parent_id) {
      push("TOP_TIER_PARENT_NOT_ALLOWED", "error", "Top-tier nodes attach directly to the Project.", `nodes[${index}].parent_id`);
    }
    if (tier.ordinal < highestOrdinal && !node.parent_id) {
      push("NODE_PARENT_REQUIRED", "error", "Non-top-tier nodes require a parent.", `nodes[${index}].parent_id`);
    }
    if (node.area_sqm !== undefined && node.area_sqm <= 0) {
      push("AREA_INVALID", "error", "Area must be greater than zero.", `nodes[${index}].area_sqm`);
    }
    if (node.occupant_count !== undefined && node.occupant_count < 0) {
      push("OCCUPANT_COUNT_INVALID", "error", "Occupant count cannot be negative.", `nodes[${index}].occupant_count`);
    }
    if (node.effective_from && node.effective_to && node.effective_from >= node.effective_to) {
      push("EFFECTIVE_RANGE_INVALID", "error", "Effective from must be earlier than effective to.", `nodes[${index}]`);
    }
    const siblingKey = `${tier.id}:${node.parent_id ?? "__project__"}:${normaliseDisplayName(node.name)}`;
    if (siblingNames.has(siblingKey)) {
      push("SIBLING_NAME_DUPLICATE", "error", "Sibling node names must be unique.", `nodes[${index}].name`);
    }
    siblingNames.add(siblingKey);
  }

  for (const [index, node] of document.nodes.entries()) {
    if (!node.parent_id) {
      continue;
    }
    const childTier = tiersById.get(node.tier_definition_id);
    const parent = nodesById.get(node.parent_id);
    if (!parent) {
      push("NODE_PARENT_NOT_FOUND", "error", "Parent node does not exist.", `nodes[${index}].parent_id`);
      continue;
    }
    const parentTier = tiersById.get(parent.tier_definition_id);
    if (childTier && parentTier && parentTier.ordinal !== childTier.ordinal + 1) {
      push("NODE_SKIPS_TIER", "error", "Nodes must attach to the next configured tier.", `nodes[${index}].parent_id`);
    }
  }

  for (const tier of document.tiers) {
    const tierNodes = nodesByTier.get(tier.id) ?? [];
    if (tierNodes.length === 0) {
      push("TIER_HAS_NO_NODES", "error", `${tier.alias} has no nodes.`, `tiers.${tier.id}`);
    }
    if (tierNodes.length === 1) {
      const node = tierNodes[0];
      if (!node?.independent_reason && node?.area_sqm === undefined && node?.occupant_count === undefined) {
        push(
          "SINGLE_NODE_TIER_NEEDS_REASON",
          "warning",
          `${tier.alias} contains one node without an independent analytical property.`,
          `tiers.${tier.id}`
        );
      }
    }
  }

  if (document.meter_mapping) {
    const rowIds = new Set<string>();
    const sourceLabels = new Set<string>();
    const wholeCoverage = new Map<string, number>();
    for (const [index, row] of document.meter_mapping.rows.entries()) {
      if (!row.id || rowIds.has(row.id)) {
        push("METER_MAPPING_ID_DUPLICATE", "error", "Meter Mapping row IDs must be unique.", `meter_mapping.rows[${index}].id`);
      }
      rowIds.add(row.id);
      const sourceKey = normaliseDisplayName(row.source_label);
      if (!sourceKey || sourceLabels.has(sourceKey)) {
        push("SOURCE_LABEL_DUPLICATE", "error", "Each source label can be mapped only once.", `meter_mapping.rows[${index}].source_label`);
      }
      sourceLabels.add(sourceKey);
      if (!nodesById.has(row.scope_id)) {
        push("METER_SCOPE_NOT_FOUND", "error", "Mapped Scope must already exist in Structure.", `meter_mapping.rows[${index}].scope_id`);
      }
      if (row.meter_role === "standalone" && row.aggregation_usage === "official") {
        push("STANDALONE_METER_OFFICIAL", "error", "A standalone meter cannot enter the official aggregation route.", `meter_mapping.rows[${index}].aggregation_usage`);
      }
      if (row.meter_role === "total" && row.aggregation_usage === "official") {
        const routeKey = `${row.scope_id}:${row.resource}:${row.category}`;
        wholeCoverage.set(routeKey, (wholeCoverage.get(routeKey) ?? 0) + 1);
      }
    }
    for (const [routeKey, count] of wholeCoverage) {
      if (count > 1) {
        push("MULTIPLE_DIRECT_TOTALS", "error", `More than one whole-scope meter is configured for ${routeKey}.`, "meter_mapping.rows");
      }
    }
    const virtualIds = new Set<string>();
    const virtualNames = new Set<string>();
    const mappingRowsById = new Map(document.meter_mapping.rows.map((row) => [row.id, row]));
    for (const [index, virtualMeter] of (document.meter_mapping.virtual_meters ?? []).entries()) {
      if (!virtualMeter.id || virtualIds.has(virtualMeter.id)) {
        push("VIRTUAL_METER_ID_DUPLICATE", "error", "Virtual Meter IDs must be unique.", `meter_mapping.virtual_meters[${index}].id`);
      }
      virtualIds.add(virtualMeter.id);
      const nameKey = `${virtualMeter.scope_id}:${normaliseDisplayName(virtualMeter.display_name)}`;
      if (!virtualMeter.display_name.trim() || virtualNames.has(nameKey)) {
        push("VIRTUAL_METER_NAME_DUPLICATE", "error", "Virtual Meter names must be unique inside a Scope.", `meter_mapping.virtual_meters[${index}].display_name`);
      }
      virtualNames.add(nameKey);
      if (!nodesById.has(virtualMeter.scope_id)) {
        push("VIRTUAL_METER_SCOPE_NOT_FOUND", "error", "Virtual Meter Scope must already exist in Structure.", `meter_mapping.virtual_meters[${index}].scope_id`);
      }
      if (virtualMeter.terms.length < 2) {
        push("VIRTUAL_METER_TERMS_REQUIRED", "error", "A Virtual Meter formula needs at least two physical meter inputs.", `meter_mapping.virtual_meters[${index}].terms`);
      }
      const termIds = new Set<string>();
      for (const [termIndex, term] of virtualMeter.terms.entries()) {
        const source = mappingRowsById.get(term.mapping_row_id);
        if (!source || termIds.has(term.mapping_row_id)) {
          push("VIRTUAL_METER_TERM_INVALID", "error", "Each Virtual Meter input must reference one unique mapped physical meter.", `meter_mapping.virtual_meters[${index}].terms[${termIndex}]`);
        } else if (source.resource !== virtualMeter.resource) {
          push("VIRTUAL_METER_RESOURCE_MISMATCH", "error", "Virtual Meter inputs must use the same resource.", `meter_mapping.virtual_meters[${index}].terms[${termIndex}]`);
        }
        termIds.add(term.mapping_row_id);
      }
    }
    if (document.meter_mapping.rows.length === 0) {
      push("METER_MAPPING_EMPTY", "warning", "No source labels have been mapped yet.", "meter_mapping.rows");
    } else if (!document.meter_mapping.confirmed) {
      push("METER_MAPPING_NOT_CONFIRMED", "warning", "Review aggregation routes and confirm Meter Mapping.", "meter_mapping.confirmed");
    }
  }

  return {
    blocking: issues.some((issue) => issue.severity === "error"),
    issues
  };
};

const normaliseDisplayName = (value: string): string =>
  value.trim().replace(/\s+/g, " ").toLocaleLowerCase();

const normaliseDisplayNameForStorage = (value: string): string =>
  value.trim().replace(/\s+/g, " ");

const canonicalizeDocument = (
  document: EnergyIqProjectSetupDocument
): EnergyIqProjectSetupDocument => {
  const nodes = Array.isArray(document.nodes)
    ? document.nodes.map((node) => ({
        id: String(node.id ?? "").trim(),
        tier_definition_id: String(node.tier_definition_id ?? "").trim(),
        ...(node.parent_id?.trim() ? { parent_id: node.parent_id.trim() } : {}),
        name: normaliseDisplayNameForStorage(String(node.name ?? "")),
        sort_order: Number.isFinite(node.sort_order) ? Number(node.sort_order) : 0,
        ...(node.area_sqm === undefined ? {} : { area_sqm: Number(node.area_sqm) }),
        ...(node.occupant_count === undefined
          ? {}
          : { occupant_count: Number(node.occupant_count) }),
        metadata_status: (node.metadata_status === "confirmed" ? "confirmed" : "provisional") as EnergyIqMetadataStatus,
        ...(node.effective_from?.trim() ? { effective_from: node.effective_from.trim() } : {}),
        ...(node.effective_to?.trim() ? { effective_to: node.effective_to.trim() } : {}),
        ...(node.independent_reason?.trim()
          ? { independent_reason: node.independent_reason.trim() }
          : {}),
        ...(node.metadata ? { metadata: node.metadata } : {})
      }))
    : [];
  return {
    project: {
      name: String(document.project?.name ?? "").trim(),
      timezone: String(document.project?.timezone ?? "").trim()
    },
    tier_structure_locked: typeof document.tier_structure_locked === "boolean"
      ? document.tier_structure_locked
      : nodes.length > 0,
    tiers: Array.isArray(document.tiers)
      ? document.tiers.map((tier) => ({
          id: String(tier.id ?? "").trim(),
          ordinal: Number(tier.ordinal),
          alias: String(tier.alias ?? "").trim(),
          ...(tier.description?.trim() ? { description: tier.description.trim() } : {})
        }))
      : [],
    nodes,
    ...(document.meter_mapping ? {
      meter_mapping: {
        source_kind: document.meter_mapping.source_kind === "tuya" ? "tuya" as const : "excel" as const,
        confirmed: document.meter_mapping.confirmed === true,
        rows: Array.isArray(document.meter_mapping.rows)
          ? document.meter_mapping.rows.map((row) => ({
              id: String(row.id ?? "").trim(),
              source_label: normaliseDisplayNameForStorage(String(row.source_label ?? "")),
              scope_id: String(row.scope_id ?? "").trim(),
              display_name: normaliseDisplayNameForStorage(String(row.display_name ?? "")),
              resource: row.resource === "water" ? "water" as const : "electricity" as const,
              category: normalizeMeterCategory(row.category),
              coverage: normalizeMeterCoverage(row.coverage),
              meter_role: normalizeMeterRole(row.meter_role),
              aggregation_usage: row.aggregation_usage === "official" ? "official" as const : "excluded" as const
            }))
          : [],
        ...(Array.isArray(document.meter_mapping.virtual_meters) ? {
          virtual_meters: document.meter_mapping.virtual_meters.map((virtualMeter) => ({
            id: String(virtualMeter.id ?? "").trim(),
            display_name: normaliseDisplayNameForStorage(String(virtualMeter.display_name ?? "")),
            scope_id: String(virtualMeter.scope_id ?? "").trim(),
            resource: virtualMeter.resource === "water" ? "water" as const : "electricity" as const,
            category: normalizeMeterCategory(virtualMeter.category),
            terms: Array.isArray(virtualMeter.terms)
              ? virtualMeter.terms.map((term) => ({
                  mapping_row_id: String(term.mapping_row_id ?? "").trim(),
                  coefficient: term.coefficient === -1 ? -1 as const : 1 as const
                }))
              : []
          }))
        } : {})
      }
    } : {})
  };
};

const normalizeMeterCategory = (value: unknown): EnergyIqMeterCategory =>
  value === "overall" || value === "load" || value === "light" || value === "aircon"
    ? value
    : "other";

const normalizeMeterCoverage = (value: unknown): EnergyIqMeterCoverage =>
  value === "whole" || value === "partial" ? value : "reference";

const normalizeMeterRole = (value: unknown): EnergyIqMeterRole =>
  value === "total" || value === "component" ? value : "standalone";

const ensureColumn = (
  db: DatabaseSync,
  table: string,
  column: string,
  definition: string
): void => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((entry) => isRecord(entry) && entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
};

const normalizeNodeType = (alias: string): string =>
  alias
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "scope";

const hierarchySequenceFromId = (revisionId: string): number => {
  const match = revisionId.match(/-v(\d+)$/);
  return match ? Number(match[1]) : 1;
};

const mapDraft = (row: Record<string, unknown>): EnergyIqProjectSetupDraft => {
  const basedOn = asString(row.based_on_hierarchy_revision_id);
  return {
    project_id: requiredString(row, "project_id"),
    revision: Number(row.revision),
    ...(basedOn ? { based_on_hierarchy_revision_id: basedOn } : {}),
    document: parseDocument(requiredString(row, "document_json")),
    updated_by: requiredString(row, "updated_by"),
    updated_at: requiredString(row, "updated_at")
  };
};

const mapTierDefinition = (row: Record<string, unknown>): EnergyIqTierDefinitionRecord => {
  const description = asString(row.description);
  return {
    id: requiredString(row, "id"),
    project_id: requiredString(row, "project_id"),
    hierarchy_revision_id: requiredString(row, "hierarchy_revision_id"),
    ordinal: Number(row.ordinal),
    alias: requiredString(row, "alias"),
    ...(description ? { description } : {}),
    created_at: requiredString(row, "created_at"),
    updated_at: requiredString(row, "updated_at")
  };
};

const mapHierarchyRevision = (
  row: Record<string, unknown>
): EnergyIqHierarchyRevisionRecord => ({
  id: requiredString(row, "id"),
  project_id: requiredString(row, "project_id"),
  sequence: Number(row.sequence),
  snapshot_json: requiredString(row, "snapshot_json"),
  validation_json: requiredString(row, "validation_json"),
  published_by: requiredString(row, "published_by"),
  published_at: requiredString(row, "published_at")
});

const parseDocument = (json: string): EnergyIqProjectSetupDocument => {
  const parsed = JSON.parse(json) as EnergyIqProjectSetupDocument;
  return canonicalizeDocument(parsed);
};

const parseRecord = (json: string): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(json);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown): string =>
  typeof value === "string" ? value : "";

const requiredString = (row: Record<string, unknown>, key: string): string => {
  const value = row[key];
  if (typeof value !== "string") {
    throw new Error(`ENERGYIQ_INVALID_ROW:${key}`);
  }
  return value;
};
