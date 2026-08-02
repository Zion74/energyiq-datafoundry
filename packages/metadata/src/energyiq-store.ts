import type { DatabaseSync } from "node:sqlite";

import { EnergyIqMetricStore } from "./energyiq-metric-store.js";

import {
  EnergyIqProjectSetupStore,
  type EnergyIqDeliveryStage,
  type EnergyIqMetadataStatus,
  type EnergyIqTierDefinitionRecord
} from "./energyiq-project-setup-store.js";

export type EnergyIqRole = "user" | "admin";
export type EnergyIqProjectStatus = "draft" | "published" | "archived";
export type EnergyIqProjectAccessRole = "viewer" | "editor";

export type EnergyIqUserRoleRecord = {
  user_id: string;
  role: EnergyIqRole;
  created_at: string;
  updated_at: string;
};

export type EnergyIqProjectRecord = {
  id: string;
  workspace_id: string;
  name: string;
  status: EnergyIqProjectStatus;
  timezone: string;
  hierarchy_revision_id: string;
  meter_formula_revision_id: string;
  data_snapshot_id: string;
  metric_version: string;
  business_calendar_version: string;
  tariff_schedule_version: string;
  delivery_stage: EnergyIqDeliveryStage;
  root_scope_id: string;
  has_unpublished_changes: boolean;
  created_at: string;
  updated_at: string;
};

export type EnergyIqProjectNodeRecord = {
  id: string;
  project_id: string;
  parent_id?: string;
  name: string;
  node_type: string;
  tier_definition_id?: string;
  hierarchy_revision_id?: string;
  sort_order: number;
  area_sqm?: number;
  occupant_count?: number;
  metadata_json?: string;
  metadata_status: EnergyIqMetadataStatus;
  effective_from?: string;
  effective_to?: string;
  independent_reason?: string;
  created_at: string;
  updated_at: string;
};

export type EnergyIqProjectAccessRecord = {
  project_id: string;
  user_id: string;
  role: EnergyIqProjectAccessRole;
  created_at: string;
  updated_at: string;
};

export type EnergyIqImportBatchRecord = {
  id: string;
  workspace_id: string;
  project_id: string;
  source_kind: "excel" | "tuya";
  source_sha256: string;
  filename: string;
  file_asset_ref_id?: string;
  status: "inspected" | "materialized" | "failed";
  inspection_json: string;
  materialization_json?: string;
  materialized_at?: string;
  created_by: string;
  created_at: string;
};

export const initializeEnergyIqSchema = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS energyiq_user_roles (
      user_id TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('user', 'admin')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS energyiq_projects (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
      timezone TEXT NOT NULL,
      hierarchy_revision_id TEXT NOT NULL,
      meter_formula_revision_id TEXT NOT NULL,
      data_snapshot_id TEXT NOT NULL DEFAULT 'unavailable',
      metric_version TEXT NOT NULL,
      business_calendar_version TEXT NOT NULL,
      tariff_schedule_version TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );
    CREATE INDEX IF NOT EXISTS idx_energyiq_projects_workspace
      ON energyiq_projects(workspace_id, status, name);

    CREATE TABLE IF NOT EXISTS energyiq_project_nodes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      parent_id TEXT,
      name TEXT NOT NULL,
      node_type TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      area_sqm REAL,
      occupant_count INTEGER,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES energyiq_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES energyiq_project_nodes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_energyiq_project_nodes_parent
      ON energyiq_project_nodes(project_id, parent_id, sort_order, name);

    CREATE TABLE IF NOT EXISTS energyiq_project_access (
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (project_id, user_id),
      FOREIGN KEY (project_id) REFERENCES energyiq_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_energyiq_project_access_user
      ON energyiq_project_access(user_id, project_id);

    CREATE TABLE IF NOT EXISTS energyiq_import_batches (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      source_kind TEXT NOT NULL CHECK (source_kind IN ('excel', 'tuya')),
      source_sha256 TEXT NOT NULL,
      filename TEXT NOT NULL,
      file_asset_ref_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('inspected', 'materialized', 'failed')),
      inspection_json TEXT NOT NULL,
      materialization_json TEXT,
      materialized_at TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (project_id, source_sha256),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (project_id) REFERENCES energyiq_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (file_asset_ref_id) REFERENCES file_asset_refs(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_energyiq_import_batches_project
      ON energyiq_import_batches(project_id, created_at DESC);
  `);
  const projectColumns = db.prepare("PRAGMA table_info(energyiq_projects)").all();
  if (!projectColumns.some((column) => isRecord(column) && column.name === "data_snapshot_id")) {
    db.exec("ALTER TABLE energyiq_projects ADD COLUMN data_snapshot_id TEXT NOT NULL DEFAULT 'unavailable'");
  }
  const importBatchColumns = db.prepare("PRAGMA table_info(energyiq_import_batches)").all();
  if (!importBatchColumns.some((column) => isRecord(column) && column.name === "materialization_json")) {
    db.exec("ALTER TABLE energyiq_import_batches ADD COLUMN materialization_json TEXT");
  }
  if (!importBatchColumns.some((column) => isRecord(column) && column.name === "materialized_at")) {
    db.exec("ALTER TABLE energyiq_import_batches ADD COLUMN materialized_at TEXT");
  }
};

export class EnergyIqStore {
  readonly metrics: EnergyIqMetricStore;
  readonly projectSetup: EnergyIqProjectSetupStore;

  constructor(private readonly db: DatabaseSync) {
    this.metrics = new EnergyIqMetricStore(db);
    this.projectSetup = new EnergyIqProjectSetupStore(db);
  }

  upsertUserRole(input: { user_id: string; role: EnergyIqRole }): EnergyIqUserRoleRecord {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO energyiq_user_roles (user_id, role, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at
    `).run(input.user_id, input.role, now, now);
    return this.getUserRole(input.user_id);
  }

  getUserRole(userId: string): EnergyIqUserRoleRecord {
    const row = this.db.prepare(
      "SELECT * FROM energyiq_user_roles WHERE user_id = ?"
    ).get(userId);
    if (!isRecord(row)) {
      throw new Error(`ENERGYIQ_USER_ROLE_NOT_FOUND:${userId}`);
    }
    return mapUserRole(row);
  }

  findUserRole(userId: string): EnergyIqUserRoleRecord | undefined {
    const row = this.db.prepare(
      "SELECT * FROM energyiq_user_roles WHERE user_id = ?"
    ).get(userId);
    return isRecord(row) ? mapUserRole(row) : undefined;
  }

  upsertProject(input: {
    id: string;
    workspace_id: string;
    name: string;
    status: EnergyIqProjectStatus;
    timezone?: string;
    hierarchy_revision_id?: string;
    meter_formula_revision_id?: string;
    data_snapshot_id?: string;
    metric_version?: string;
    business_calendar_version?: string;
    tariff_schedule_version?: string;
    delivery_stage?: EnergyIqDeliveryStage;
    root_scope_id?: string;
    has_unpublished_changes?: boolean;
  }): EnergyIqProjectRecord {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO energyiq_projects (
        id, workspace_id, name, status, timezone, hierarchy_revision_id,
        meter_formula_revision_id, data_snapshot_id, metric_version, business_calendar_version,
        tariff_schedule_version, delivery_stage, root_scope_id,
        has_unpublished_changes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        workspace_id = excluded.workspace_id,
        name = excluded.name,
        status = excluded.status,
        timezone = excluded.timezone,
        hierarchy_revision_id = excluded.hierarchy_revision_id,
        meter_formula_revision_id = excluded.meter_formula_revision_id,
        data_snapshot_id = excluded.data_snapshot_id,
        metric_version = excluded.metric_version,
        business_calendar_version = excluded.business_calendar_version,
        tariff_schedule_version = excluded.tariff_schedule_version,
        delivery_stage = excluded.delivery_stage,
        root_scope_id = excluded.root_scope_id,
        has_unpublished_changes = excluded.has_unpublished_changes,
        updated_at = excluded.updated_at
    `).run(
      input.id,
      input.workspace_id,
      input.name,
      input.status,
      input.timezone ?? "Asia/Singapore",
      input.hierarchy_revision_id ?? "hierarchy-v1",
      input.meter_formula_revision_id ?? "meter-formula-v1",
      input.data_snapshot_id ?? "unavailable",
      input.metric_version ?? "energy-metrics-v1",
      input.business_calendar_version ?? "sg-calendar-v1",
      input.tariff_schedule_version ?? "sg-tariff-v1",
      input.delivery_stage ?? (input.status === "published" ? "published" : "draft"),
      input.root_scope_id ?? `${input.id}-project`,
      input.has_unpublished_changes ? 1 : 0,
      now,
      now
    );
    return this.getProject(input.id);
  }

  getProject(projectId: string): EnergyIqProjectRecord {
    const row = this.db.prepare("SELECT * FROM energyiq_projects WHERE id = ?").get(projectId);
    if (!isRecord(row)) {
      throw new Error(`ENERGYIQ_PROJECT_NOT_FOUND:${projectId}`);
    }
    return mapProject(row);
  }

  listProjectsByWorkspace(workspaceId: string): EnergyIqProjectRecord[] {
    return this.db.prepare(`
      SELECT * FROM energyiq_projects
      WHERE workspace_id = ?
      ORDER BY CASE status WHEN 'published' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, name
    `).all(workspaceId).filter(isRecord).map(mapProject);
  }

  listProjectsForUser(input: {
    user_id: string;
    workspace_id?: string;
    include_unpublished?: boolean;
  }): EnergyIqProjectRecord[] {
    const conditions = ["a.user_id = ?"];
    const parameters: Array<string | number | null> = [input.user_id];
    if (input.workspace_id) {
      conditions.push("p.workspace_id = ?");
      parameters.push(input.workspace_id);
    }
    if (!input.include_unpublished) {
      conditions.push("p.status = 'published'");
    }
    return this.db.prepare(`
      SELECT p.* FROM energyiq_projects p
      INNER JOIN energyiq_project_access a ON a.project_id = p.id
      WHERE ${conditions.join(" AND ")}
      ORDER BY p.name
    `).all(...parameters).filter(isRecord).map(mapProject);
  }

  listVisibleProjects(input: {
    user_id: string;
    workspace_id: string;
    is_admin: boolean;
    include_archived?: boolean;
  }): EnergyIqProjectRecord[] {
    if (!input.is_admin) {
      const membership = this.db.prepare(`
        SELECT 1 FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?
      `).get(input.workspace_id, input.user_id);
      if (!membership) return [];
    }
    const statuses = input.is_admin
      ? (input.include_archived ? ["published", "draft", "archived"] : ["published", "draft"])
      : ["published"];
    const placeholders = statuses.map(() => "?").join(", ");
    return this.db.prepare(`
      SELECT * FROM energyiq_projects
      WHERE workspace_id = ? AND status IN (${placeholders})
      ORDER BY CASE status WHEN 'published' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, name
    `).all(input.workspace_id, ...statuses).filter(isRecord).map(mapProject);
  }

  upsertProjectNode(input: {
    id: string;
    project_id: string;
    parent_id?: string;
    name: string;
    node_type: string;
    sort_order?: number;
    area_sqm?: number;
    occupant_count?: number;
    metadata?: unknown;
    tier_definition_id?: string;
    hierarchy_revision_id?: string;
    metadata_status?: EnergyIqMetadataStatus;
    effective_from?: string;
    effective_to?: string;
    independent_reason?: string;
  }): EnergyIqProjectNodeRecord {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO energyiq_project_nodes (
        id, project_id, parent_id, name, node_type, sort_order, area_sqm,
        occupant_count, metadata_json, tier_definition_id, hierarchy_revision_id,
        metadata_status, effective_from, effective_to, independent_reason,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id,
        parent_id = excluded.parent_id,
        name = excluded.name,
        node_type = excluded.node_type,
        sort_order = excluded.sort_order,
        area_sqm = excluded.area_sqm,
        occupant_count = excluded.occupant_count,
        metadata_json = excluded.metadata_json,
        tier_definition_id = excluded.tier_definition_id,
        hierarchy_revision_id = excluded.hierarchy_revision_id,
        metadata_status = excluded.metadata_status,
        effective_from = excluded.effective_from,
        effective_to = excluded.effective_to,
        independent_reason = excluded.independent_reason,
        updated_at = excluded.updated_at
    `).run(
      input.id,
      input.project_id,
      input.parent_id ?? null,
      input.name,
      input.node_type,
      input.sort_order ?? 0,
      input.area_sqm ?? null,
      input.occupant_count ?? null,
      input.metadata === undefined ? null : JSON.stringify(input.metadata),
      input.tier_definition_id ?? null,
      input.hierarchy_revision_id ?? null,
      input.metadata_status ?? "provisional",
      input.effective_from ?? null,
      input.effective_to ?? null,
      input.independent_reason ?? null,
      now,
      now
    );
    return this.getProjectNode(input.id);
  }

  getProjectNode(nodeId: string): EnergyIqProjectNodeRecord {
    const row = this.db.prepare("SELECT * FROM energyiq_project_nodes WHERE id = ?").get(nodeId);
    if (!isRecord(row)) {
      throw new Error(`ENERGYIQ_PROJECT_NODE_NOT_FOUND:${nodeId}`);
    }
    return mapProjectNode(row);
  }

  listProjectNodes(projectId: string): EnergyIqProjectNodeRecord[] {
    return this.db.prepare(`
      SELECT * FROM energyiq_project_nodes
      WHERE project_id = ?
      ORDER BY sort_order, name
    `).all(projectId).filter(isRecord).map(mapProjectNode);
  }

  listTierDefinitions(projectId: string): EnergyIqTierDefinitionRecord[] {
    return this.projectSetup.listTierDefinitions(projectId);
  }

  upsertProjectAccess(input: {
    project_id: string;
    user_id: string;
    role: EnergyIqProjectAccessRole;
  }): EnergyIqProjectAccessRecord {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO energyiq_project_access (project_id, user_id, role, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id, user_id) DO UPDATE SET
        role = excluded.role,
        updated_at = excluded.updated_at
    `).run(input.project_id, input.user_id, input.role, now, now);
    return this.getProjectAccess(input);
  }

  getProjectAccess(input: {
    project_id: string;
    user_id: string;
  }): EnergyIqProjectAccessRecord {
    const row = this.db.prepare(`
      SELECT * FROM energyiq_project_access WHERE project_id = ? AND user_id = ?
    `).get(input.project_id, input.user_id);
    if (!isRecord(row)) {
      throw new Error(`ENERGYIQ_PROJECT_ACCESS_NOT_FOUND:${input.project_id}:${input.user_id}`);
    }
    return mapProjectAccess(row);
  }

  findProjectAccess(input: {
    project_id: string;
    user_id: string;
  }): EnergyIqProjectAccessRecord | undefined {
    const row = this.db.prepare(`
      SELECT * FROM energyiq_project_access WHERE project_id = ? AND user_id = ?
    `).get(input.project_id, input.user_id);
    return isRecord(row) ? mapProjectAccess(row) : undefined;
  }

  createImportBatch(input: {
    id: string;
    workspace_id: string;
    project_id: string;
    source_kind: "excel" | "tuya";
    source_sha256: string;
    filename: string;
    file_asset_ref_id?: string;
    status: "inspected" | "materialized" | "failed";
    inspection: unknown;
    created_by: string;
  }): EnergyIqImportBatchRecord {
    const createdAt = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO energyiq_import_batches (
        id, workspace_id, project_id, source_kind, source_sha256, filename,
        file_asset_ref_id, status, inspection_json, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.workspace_id,
      input.project_id,
      input.source_kind,
      input.source_sha256,
      input.filename,
      input.file_asset_ref_id ?? null,
      input.status,
      JSON.stringify(input.inspection),
      input.created_by,
      createdAt,
    );
    return this.getImportBatch(input.id);
  }

  getImportBatch(batchId: string): EnergyIqImportBatchRecord {
    const row = this.db.prepare(
      "SELECT * FROM energyiq_import_batches WHERE id = ?",
    ).get(batchId);
    if (!isRecord(row)) throw new Error(`ENERGYIQ_IMPORT_BATCH_NOT_FOUND:${batchId}`);
    return mapImportBatch(row);
  }

  findImportBatchBySha(input: {
    project_id: string;
    source_sha256: string;
  }): EnergyIqImportBatchRecord | undefined {
    const row = this.db.prepare(`
      SELECT * FROM energyiq_import_batches
      WHERE project_id = ? AND source_sha256 = ?
    `).get(input.project_id, input.source_sha256);
    return isRecord(row) ? mapImportBatch(row) : undefined;
  }

  listImportBatches(projectId: string): EnergyIqImportBatchRecord[] {
    return this.db.prepare(`
      SELECT * FROM energyiq_import_batches
      WHERE project_id = ?
      ORDER BY created_at DESC
    `).all(projectId).filter(isRecord).map(mapImportBatch);
  }

  completeImportBatchMaterialization(input: {
    batch_id: string;
    project_id: string;
    snapshot_id: string;
    summary: unknown;
  }): EnergyIqImportBatchRecord {
    const materializedAt = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE energyiq_import_batches
      SET status = 'materialized', materialization_json = ?, materialized_at = ?
      WHERE id = ? AND project_id = ?
    `).run(JSON.stringify(input.summary), materializedAt, input.batch_id, input.project_id);
    if (result.changes !== 1) throw new Error(`ENERGYIQ_IMPORT_BATCH_NOT_FOUND:${input.batch_id}`);
    this.db.prepare(`
      UPDATE energyiq_projects
      SET data_snapshot_id = ?, updated_at = ?
      WHERE id = ?
    `).run(input.snapshot_id, materializedAt, input.project_id);
    return this.getImportBatch(input.batch_id);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requiredString = (row: Record<string, unknown>, key: string): string => {
  const value = row[key];
  if (typeof value !== "string") {
    throw new Error(`ENERGYIQ_INVALID_ROW:${key}`);
  }
  return value;
};

const optionalString = (row: Record<string, unknown>, key: string): string | undefined =>
  typeof row[key] === "string" ? row[key] : undefined;

const optionalNumber = (row: Record<string, unknown>, key: string): number | undefined =>
  typeof row[key] === "number" ? row[key] : undefined;

const mapUserRole = (row: Record<string, unknown>): EnergyIqUserRoleRecord => ({
  user_id: requiredString(row, "user_id"),
  role: requiredString(row, "role") as EnergyIqRole,
  created_at: requiredString(row, "created_at"),
  updated_at: requiredString(row, "updated_at")
});

const mapProject = (row: Record<string, unknown>): EnergyIqProjectRecord => ({
  id: requiredString(row, "id"),
  workspace_id: requiredString(row, "workspace_id"),
  name: requiredString(row, "name"),
  status: requiredString(row, "status") as EnergyIqProjectStatus,
  timezone: requiredString(row, "timezone"),
  hierarchy_revision_id: requiredString(row, "hierarchy_revision_id"),
  meter_formula_revision_id: requiredString(row, "meter_formula_revision_id"),
  data_snapshot_id: requiredString(row, "data_snapshot_id"),
  metric_version: requiredString(row, "metric_version"),
  business_calendar_version: requiredString(row, "business_calendar_version"),
  tariff_schedule_version: requiredString(row, "tariff_schedule_version"),
  delivery_stage: requiredString(row, "delivery_stage") as EnergyIqDeliveryStage,
  root_scope_id: requiredString(row, "root_scope_id"),
  has_unpublished_changes: Number(row.has_unpublished_changes) === 1,
  created_at: requiredString(row, "created_at"),
  updated_at: requiredString(row, "updated_at")
});

const mapProjectNode = (row: Record<string, unknown>): EnergyIqProjectNodeRecord => {
  const parentId = optionalString(row, "parent_id");
  const areaSqm = optionalNumber(row, "area_sqm");
  const occupantCount = optionalNumber(row, "occupant_count");
  const metadataJson = optionalString(row, "metadata_json");
  const tierDefinitionId = optionalString(row, "tier_definition_id");
  const hierarchyRevisionId = optionalString(row, "hierarchy_revision_id");
  const effectiveFrom = optionalString(row, "effective_from");
  const effectiveTo = optionalString(row, "effective_to");
  const independentReason = optionalString(row, "independent_reason");
  return {
    id: requiredString(row, "id"),
    project_id: requiredString(row, "project_id"),
    ...(parentId ? { parent_id: parentId } : {}),
    name: requiredString(row, "name"),
    node_type: requiredString(row, "node_type"),
    ...(tierDefinitionId ? { tier_definition_id: tierDefinitionId } : {}),
    ...(hierarchyRevisionId ? { hierarchy_revision_id: hierarchyRevisionId } : {}),
    sort_order: Number(row.sort_order),
    ...(areaSqm === undefined ? {} : { area_sqm: areaSqm }),
    ...(occupantCount === undefined ? {} : { occupant_count: occupantCount }),
    ...(metadataJson ? { metadata_json: metadataJson } : {}),
    metadata_status: (optionalString(row, "metadata_status") ?? "provisional") as EnergyIqMetadataStatus,
    ...(effectiveFrom ? { effective_from: effectiveFrom } : {}),
    ...(effectiveTo ? { effective_to: effectiveTo } : {}),
    ...(independentReason ? { independent_reason: independentReason } : {}),
    created_at: requiredString(row, "created_at"),
    updated_at: requiredString(row, "updated_at")
  };
};

const mapProjectAccess = (row: Record<string, unknown>): EnergyIqProjectAccessRecord => ({
  project_id: requiredString(row, "project_id"),
  user_id: requiredString(row, "user_id"),
  role: requiredString(row, "role") as EnergyIqProjectAccessRole,
  created_at: requiredString(row, "created_at"),
  updated_at: requiredString(row, "updated_at")
});

const mapImportBatch = (row: Record<string, unknown>): EnergyIqImportBatchRecord => {
  const fileAssetRefId = optionalString(row, "file_asset_ref_id");
  const materializationJson = optionalString(row, "materialization_json");
  const materializedAt = optionalString(row, "materialized_at");
  return {
    id: requiredString(row, "id"),
    workspace_id: requiredString(row, "workspace_id"),
    project_id: requiredString(row, "project_id"),
    source_kind: requiredString(row, "source_kind") as EnergyIqImportBatchRecord["source_kind"],
    source_sha256: requiredString(row, "source_sha256"),
    filename: requiredString(row, "filename"),
    ...(fileAssetRefId ? { file_asset_ref_id: fileAssetRefId } : {}),
    status: requiredString(row, "status") as EnergyIqImportBatchRecord["status"],
    inspection_json: requiredString(row, "inspection_json"),
    ...(materializationJson ? { materialization_json: materializationJson } : {}),
    ...(materializedAt ? { materialized_at: materializedAt } : {}),
    created_by: requiredString(row, "created_by"),
    created_at: requiredString(row, "created_at"),
  };
};
