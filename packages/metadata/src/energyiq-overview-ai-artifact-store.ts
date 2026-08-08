import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type EnergyIqOverviewAiArtifactIdentity = {
  workspaceId: string;
  projectId: string;
  scopeId: string;
  resource: "electricity";
  dataSnapshotId: string;
  projectReleaseId: string;
  rendererKey: string;
  rendererVersion: string;
  analysisPackId: string;
  analysisPackRevision: string;
  modelProfileId: string;
  modelProfileRevision: number;
  outputContractRevision: string;
  validatorRevision: string;
};

export type EnergyIqOverviewAiArtifactStatus = "queued" | "running" | "available" | "failed";

export type EnergyIqOverviewAiArtifactRecord = {
  id: string;
  identity_hash: string;
  identity_json: string;
  workspace_id: string;
  project_id: string;
  scope_id: string;
  resource: "electricity";
  data_snapshot_id: string;
  project_release_id: string;
  renderer_key: string;
  renderer_version: string;
  analysis_pack_id: string;
  analysis_pack_revision: string;
  model_profile_id: string;
  model_profile_revision: number;
  output_contract_revision: string;
  validator_revision: string;
  status: EnergyIqOverviewAiArtifactStatus;
  attempt_count: number;
  triggered_by: string;
  lease_owner?: string;
  lease_expires_at?: string;
  session_id?: string;
  run_id?: string;
  result_json?: string;
  error_code?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
};

export const initializeEnergyIqOverviewAiArtifactSchema = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS energyiq_overview_ai_artifacts (
      id TEXT PRIMARY KEY,
      identity_hash TEXT NOT NULL UNIQUE,
      identity_json TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      resource TEXT NOT NULL CHECK (resource = 'electricity'),
      data_snapshot_id TEXT NOT NULL,
      project_release_id TEXT NOT NULL,
      renderer_key TEXT NOT NULL,
      renderer_version TEXT NOT NULL,
      analysis_pack_id TEXT NOT NULL,
      analysis_pack_revision TEXT NOT NULL,
      model_profile_id TEXT NOT NULL,
      model_profile_revision INTEGER NOT NULL,
      output_contract_revision TEXT NOT NULL,
      validator_revision TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'available', 'failed')),
      attempt_count INTEGER NOT NULL DEFAULT 0,
      triggered_by TEXT NOT NULL,
      lease_owner TEXT,
      lease_expires_at TEXT,
      session_id TEXT,
      run_id TEXT,
      result_json TEXT,
      error_code TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (project_id) REFERENCES energyiq_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (triggered_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_energyiq_overview_ai_artifacts_project
      ON energyiq_overview_ai_artifacts(project_id, data_snapshot_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_energyiq_overview_ai_artifacts_status
      ON energyiq_overview_ai_artifacts(status, lease_expires_at, updated_at);
  `);
};

export class EnergyIqOverviewAiArtifactStore {
  constructor(private readonly db: DatabaseSync) {}

  queue(input: {
    identity: EnergyIqOverviewAiArtifactIdentity;
    triggeredBy: string;
    now?: string;
  }): EnergyIqOverviewAiArtifactRecord {
    const canonical = canonicalIdentity(input.identity);
    const identityJson = JSON.stringify(canonical);
    const identityHash = hashIdentity(identityJson);
    const id = `overview-ai-artifact-${identityHash.slice(0, 24)}`;
    const now = input.now ?? new Date().toISOString();
    this.db.prepare(`
      INSERT OR IGNORE INTO energyiq_overview_ai_artifacts (
        id, identity_hash, identity_json, workspace_id, project_id, scope_id,
        resource, data_snapshot_id, project_release_id, renderer_key,
        renderer_version, analysis_pack_id, analysis_pack_revision,
        model_profile_id, model_profile_revision, output_contract_revision,
        validator_revision, status, attempt_count, triggered_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?)
    `).run(
      id,
      identityHash,
      identityJson,
      canonical.workspaceId,
      canonical.projectId,
      canonical.scopeId,
      canonical.resource,
      canonical.dataSnapshotId,
      canonical.projectReleaseId,
      canonical.rendererKey,
      canonical.rendererVersion,
      canonical.analysisPackId,
      canonical.analysisPackRevision,
      canonical.modelProfileId,
      canonical.modelProfileRevision,
      canonical.outputContractRevision,
      canonical.validatorRevision,
      input.triggeredBy,
      now,
      now,
    );
    const record = this.get(canonical);
    if (record.identity_json !== identityJson) {
      throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_IDENTITY_CONFLICT");
    }
    return record;
  }

  get(identity: EnergyIqOverviewAiArtifactIdentity): EnergyIqOverviewAiArtifactRecord {
    const record = this.find(identity);
    if (!record) throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_NOT_FOUND");
    return record;
  }

  find(identity: EnergyIqOverviewAiArtifactIdentity): EnergyIqOverviewAiArtifactRecord | undefined {
    const identityJson = JSON.stringify(canonicalIdentity(identity));
    const row = this.db.prepare(`
      SELECT * FROM energyiq_overview_ai_artifacts WHERE identity_hash = ?
    `).get(hashIdentity(identityJson));
    if (!isRecord(row)) return undefined;
    const record = mapArtifact(row);
    if (record.identity_json !== identityJson) {
      throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_IDENTITY_CONFLICT");
    }
    return record;
  }

  claim(input: {
    identity: EnergyIqOverviewAiArtifactIdentity;
    workerId: string;
    leaseMs: number;
    now?: string;
  }): { claimed: boolean; artifact: EnergyIqOverviewAiArtifactRecord } {
    if (!input.workerId.trim() || !Number.isSafeInteger(input.leaseMs) || input.leaseMs <= 0) {
      throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_CLAIM_INVALID");
    }
    const now = input.now ?? new Date().toISOString();
    const leaseExpiresAt = new Date(Date.parse(now) + input.leaseMs).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.get(input.identity);
      const reclaimable = current.status === "running"
        && Boolean(current.lease_expires_at)
        && Date.parse(current.lease_expires_at!) <= Date.parse(now);
      if (current.status !== "queued" && !reclaimable) {
        this.db.exec("COMMIT");
        return { claimed: false, artifact: current };
      }
      this.db.prepare(`
        UPDATE energyiq_overview_ai_artifacts
        SET status = 'running', attempt_count = attempt_count + 1,
            lease_owner = ?, lease_expires_at = ?, error_code = NULL, updated_at = ?
        WHERE id = ?
      `).run(input.workerId, leaseExpiresAt, now, current.id);
      const artifact = this.get(input.identity);
      this.db.exec("COMMIT");
      return { claimed: true, artifact };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  complete(input: {
    identity: EnergyIqOverviewAiArtifactIdentity;
    workerId: string;
    sessionId: string;
    runId: string;
    resultJson: string;
    now?: string;
  }): EnergyIqOverviewAiArtifactRecord {
    requireArtifactResult(input.resultJson, input.identity.dataSnapshotId);
    const now = input.now ?? new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.get(input.identity);
      if (current.status === "available") {
        if (current.session_id !== input.sessionId
          || current.run_id !== input.runId
          || current.result_json !== input.resultJson) {
          throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_IMMUTABLE");
        }
        this.db.exec("COMMIT");
        return current;
      }
      if (current.status !== "running" || current.lease_owner !== input.workerId) {
        throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_NOT_CLAIMED");
      }
      this.db.prepare(`
        UPDATE energyiq_overview_ai_artifacts
        SET status = 'available', session_id = ?, run_id = ?, result_json = ?,
            error_code = NULL, lease_owner = NULL, lease_expires_at = NULL,
            completed_at = ?, updated_at = ?
        WHERE id = ?
      `).run(input.sessionId, input.runId, input.resultJson, now, now, current.id);
      const artifact = this.get(input.identity);
      this.db.exec("COMMIT");
      return artifact;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  fail(input: {
    identity: EnergyIqOverviewAiArtifactIdentity;
    workerId: string;
    errorCode: string;
    now?: string;
  }): EnergyIqOverviewAiArtifactRecord {
    if (!input.errorCode.trim()) throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_ERROR_REQUIRED");
    const now = input.now ?? new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.get(input.identity);
      if (current.status !== "running" || current.lease_owner !== input.workerId) {
        throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_NOT_CLAIMED");
      }
      this.db.prepare(`
        UPDATE energyiq_overview_ai_artifacts
        SET status = 'failed', error_code = ?, lease_owner = NULL,
            lease_expires_at = NULL, updated_at = ?
        WHERE id = ?
      `).run(input.errorCode, now, current.id);
      const artifact = this.get(input.identity);
      this.db.exec("COMMIT");
      return artifact;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

const canonicalIdentity = (
  identity: EnergyIqOverviewAiArtifactIdentity,
): EnergyIqOverviewAiArtifactIdentity => {
  for (const [key, value] of Object.entries(identity)) {
    if (key === "modelProfileRevision") continue;
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`ENERGYIQ_OVERVIEW_AI_ARTIFACT_IDENTITY_INVALID:${key}`);
    }
  }
  if (identity.resource !== "electricity"
    || !Number.isSafeInteger(identity.modelProfileRevision)
    || identity.modelProfileRevision < 1) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_IDENTITY_INVALID");
  }
  return {
    workspaceId: identity.workspaceId,
    projectId: identity.projectId,
    scopeId: identity.scopeId,
    resource: identity.resource,
    dataSnapshotId: identity.dataSnapshotId,
    projectReleaseId: identity.projectReleaseId,
    rendererKey: identity.rendererKey,
    rendererVersion: identity.rendererVersion,
    analysisPackId: identity.analysisPackId,
    analysisPackRevision: identity.analysisPackRevision,
    modelProfileId: identity.modelProfileId,
    modelProfileRevision: identity.modelProfileRevision,
    outputContractRevision: identity.outputContractRevision,
    validatorRevision: identity.validatorRevision,
  };
};

const hashIdentity = (identityJson: string): string =>
  createHash("sha256").update(identityJson).digest("hex");

const requireArtifactResult = (resultJson: string, snapshotId: string): void => {
  if (Buffer.byteLength(resultJson, "utf8") > 262_144) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_TOO_LARGE");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(resultJson) as unknown;
  } catch {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
  }
  if (!isRecord(parsed) || parsed.status !== "available" || !Array.isArray(parsed.findings)
    || !parsed.findings.every((finding) => isRecord(finding)
      && isRecord(finding.evidence)
      && finding.evidence.snapshotId === snapshotId)) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
  }
};

const mapArtifact = (row: Record<string, unknown>): EnergyIqOverviewAiArtifactRecord => ({
  id: stringField(row, "id"),
  identity_hash: stringField(row, "identity_hash"),
  identity_json: stringField(row, "identity_json"),
  workspace_id: stringField(row, "workspace_id"),
  project_id: stringField(row, "project_id"),
  scope_id: stringField(row, "scope_id"),
  resource: "electricity",
  data_snapshot_id: stringField(row, "data_snapshot_id"),
  project_release_id: stringField(row, "project_release_id"),
  renderer_key: stringField(row, "renderer_key"),
  renderer_version: stringField(row, "renderer_version"),
  analysis_pack_id: stringField(row, "analysis_pack_id"),
  analysis_pack_revision: stringField(row, "analysis_pack_revision"),
  model_profile_id: stringField(row, "model_profile_id"),
  model_profile_revision: numberField(row, "model_profile_revision"),
  output_contract_revision: stringField(row, "output_contract_revision"),
  validator_revision: stringField(row, "validator_revision"),
  status: stringField(row, "status") as EnergyIqOverviewAiArtifactStatus,
  attempt_count: numberField(row, "attempt_count"),
  triggered_by: stringField(row, "triggered_by"),
  ...optionalStringFields(row, [
    "lease_owner",
    "lease_expires_at",
    "session_id",
    "run_id",
    "result_json",
    "error_code",
    "completed_at",
  ]),
  created_at: stringField(row, "created_at"),
  updated_at: stringField(row, "updated_at"),
});

const optionalStringFields = (
  row: Record<string, unknown>,
  keys: string[],
): Partial<EnergyIqOverviewAiArtifactRecord> => Object.fromEntries(
  keys.flatMap((key) => typeof row[key] === "string" ? [[key, row[key]]] : []),
) as Partial<EnergyIqOverviewAiArtifactRecord>;

const stringField = (row: Record<string, unknown>, key: string): string => {
  if (typeof row[key] !== "string") throw new Error(`ENERGYIQ_OVERVIEW_AI_ARTIFACT_ROW_INVALID:${key}`);
  return row[key];
};

const numberField = (row: Record<string, unknown>, key: string): number => {
  if (typeof row[key] !== "number") throw new Error(`ENERGYIQ_OVERVIEW_AI_ARTIFACT_ROW_INVALID:${key}`);
  return row[key];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
