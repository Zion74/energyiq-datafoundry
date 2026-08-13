import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type EnergyIqOverviewAiArtifactKind =
  | "section-interpretation"
  | "executive-synthesis"
  | "autonomous-insights";

export type EnergyIqOverviewAiArtifactIdentity = {
  workspaceId: string;
  projectId: string;
  scopeId: string;
  resource: "electricity";
  dataSnapshotId: string;
  projectReleaseId: string;
  analysisPeriodFrom: string;
  analysisPeriodTo: string;
  rendererKey: string;
  rendererVersion: string;
  analysisPackId: string;
  analysisPackRevision: string;
  modelProfileId: string;
  modelProfileRevision: number;
  outputContractRevision: string;
  validatorRevision: string;
  workflowRevision: string;
  investigatorPromptRevision: string;
  editorPromptRevision: string;
  methodSkillId: string;
  methodSkillRevision: string;
  /** Explicit discriminator for revised value-artifact identity contracts. */
  identityContractRevision?: string;
  /** Exact server-owned capability set used to create the artifact. */
  capabilityRevision?: string;
  /** Exact publication policy used to select customer-visible results. */
  publicationRevision?: string;
  /**
   * Absent only for legacy autonomous artifacts whose canonical identity and
   * hash must remain readable. New artifacts always set an explicit kind.
   */
  artifactKind?: EnergyIqOverviewAiArtifactKind;
  /** Section target, or deterministic Executive source-set target. */
  targetId?: string;
};

export type EnergyIqOverviewAiArtifactStatus = "queued" | "running" | "available" | "failed";

const MAX_OVERVIEW_AI_ARTIFACT_ATTEMPTS = 2;

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
      const leaseExpired = current.status === "running"
        && Boolean(current.lease_expires_at)
        && Date.parse(current.lease_expires_at!) <= Date.parse(now);
      const hasAttemptsRemaining = current.attempt_count < MAX_OVERVIEW_AI_ARTIFACT_ATTEMPTS;
      if (leaseExpired && !hasAttemptsRemaining) {
        this.db.prepare(`
          UPDATE energyiq_overview_ai_artifacts
          SET status = 'failed', lease_owner = NULL, lease_expires_at = NULL,
              error_code = 'ATTEMPT_LIMIT_EXCEEDED', updated_at = ?
          WHERE id = ?
        `).run(now, current.id);
        const artifact = this.get(input.identity);
        this.db.exec("COMMIT");
        return { claimed: false, artifact };
      }
      const reclaimable = hasAttemptsRemaining
        && leaseExpired;
      const retryable = hasAttemptsRemaining && current.status === "failed";
      if (current.status !== "queued" && !reclaimable && !retryable) {
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
    requireArtifactResult(input.resultJson, input.identity, this.db);
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
  if (identity.artifactKind !== undefined
    && identity.artifactKind !== "section-interpretation"
    && identity.artifactKind !== "executive-synthesis"
    && identity.artifactKind !== "autonomous-insights") {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_KIND_INVALID");
  }
  if ((identity.artifactKind === "section-interpretation" || identity.artifactKind === "executive-synthesis")
    && !identity.targetId?.trim()) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_TARGET_REQUIRED");
  }
  if (identity.artifactKind !== "section-interpretation"
    && identity.artifactKind !== "executive-synthesis"
    && identity.targetId !== undefined) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_TARGET_FORBIDDEN");
  }
  return {
    workspaceId: identity.workspaceId,
    projectId: identity.projectId,
    scopeId: identity.scopeId,
    resource: identity.resource,
    dataSnapshotId: identity.dataSnapshotId,
    projectReleaseId: identity.projectReleaseId,
    analysisPeriodFrom: identity.analysisPeriodFrom,
    analysisPeriodTo: identity.analysisPeriodTo,
    rendererKey: identity.rendererKey,
    rendererVersion: identity.rendererVersion,
    analysisPackId: identity.analysisPackId,
    analysisPackRevision: identity.analysisPackRevision,
    modelProfileId: identity.modelProfileId,
    modelProfileRevision: identity.modelProfileRevision,
    outputContractRevision: identity.outputContractRevision,
    validatorRevision: identity.validatorRevision,
    workflowRevision: identity.workflowRevision,
    investigatorPromptRevision: identity.investigatorPromptRevision,
    editorPromptRevision: identity.editorPromptRevision,
    methodSkillId: identity.methodSkillId,
    methodSkillRevision: identity.methodSkillRevision,
    ...(identity.identityContractRevision
      ? { identityContractRevision: identity.identityContractRevision }
      : {}),
    ...(identity.capabilityRevision
      ? { capabilityRevision: identity.capabilityRevision }
      : {}),
    ...(identity.publicationRevision
      ? { publicationRevision: identity.publicationRevision }
      : {}),
    ...(identity.artifactKind ? { artifactKind: identity.artifactKind } : {}),
    ...(identity.targetId ? { targetId: identity.targetId } : {}),
  };
};

const hashIdentity = (identityJson: string): string =>
  createHash("sha256").update(identityJson).digest("hex");

const requireArtifactResult = (
  resultJson: string,
  identity: EnergyIqOverviewAiArtifactIdentity,
  db: DatabaseSync,
): void => {
  if (Buffer.byteLength(resultJson, "utf8") > 262_144) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_TOO_LARGE");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(resultJson) as unknown;
  } catch {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
  }
  if (!isRecord(parsed)) throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
  if (identity.artifactKind === "section-interpretation") {
    requireSectionInterpretationResult(parsed, identity);
    return;
  }
  if (identity.artifactKind === "executive-synthesis") {
    requireExecutiveSynthesisResult(parsed, identity, db);
    return;
  }
  const artifactBinding = parsed.binding;
  if (parsed.status !== "available"
    || !nonEmptyString(parsed.providerProfileId)
    || parsed.providerProfileId !== identity.modelProfileId
    || !nonEmptyString(parsed.runId)
    || parsed.packId !== identity.analysisPackId
    || parsed.packRevision !== identity.analysisPackRevision
    || !isRecord(parsed.contract)
    || parsed.contract.id !== "preschool-ai-accepted-artifact"
    || parsed.contract.revision !== identity.outputContractRevision
    || !isRecord(artifactBinding)
    || artifactBinding.projectId !== identity.projectId
    || artifactBinding.scopeId !== identity.scopeId
    || artifactBinding.dataSnapshotId !== identity.dataSnapshotId
    || artifactBinding.projectReleaseId !== identity.projectReleaseId
    || !nonEmptyString(artifactBinding.dataCutoff)
    || !isRecord(artifactBinding.analysisPeriod)
    || artifactBinding.analysisPeriod.from !== identity.analysisPeriodFrom
    || artifactBinding.analysisPeriod.to !== identity.analysisPeriodTo
    || artifactBinding.dataCutoff !== artifactBinding.analysisPeriod.to
    || artifactBinding.outputContractRevision !== identity.outputContractRevision
    || !isRecord(parsed.workflow)
    || parsed.workflow.id !== "preschool-two-stage"
    || parsed.workflow.revision !== identity.workflowRevision
    || !isRecord(parsed.workflow.methodSkill)
    || parsed.workflow.methodSkill.id !== identity.methodSkillId
    || parsed.workflow.methodSkill.revision !== identity.methodSkillRevision
    || !isRecord(parsed.workflow.stages)
    || !isRecord(parsed.workflow.stages.investigator)
    || !isRecord(parsed.workflow.stages.editor)
    || !nonEmptyString(parsed.workflow.stages.investigator.runId)
    || !nonEmptyString(parsed.workflow.stages.editor.runId)
    || parsed.workflow.stages.investigator.runId === parsed.workflow.stages.editor.runId
    || parsed.workflow.stages.editor.runId !== parsed.runId
    || parsed.workflow.stages.investigator.promptRevision !== identity.investigatorPromptRevision
    || parsed.workflow.stages.editor.promptRevision !== identity.editorPromptRevision
    || !validEditorTrace(parsed.workflow.editorTrace)) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
  }
  if (!Array.isArray(parsed.findings)
    || !parsed.findings.every((finding) => validAcceptedFinding(finding, artifactBinding))) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
  }
};

const requireSectionInterpretationResult = (
  parsed: Record<string, unknown>,
  identity: EnergyIqOverviewAiArtifactIdentity,
): void => {
  if (identity.identityContractRevision !== undefined
    || identity.outputContractRevision === "preschool-section-interpretation-v4") {
    requireSectionInterpretationResultV4(parsed, identity);
    return;
  }
  requireSectionInterpretationResultV3(parsed, identity);
};

const requireSectionInterpretationResultV3 = (
  parsed: Record<string, unknown>,
  identity: EnergyIqOverviewAiArtifactIdentity,
): void => {
  const binding = parsed.binding;
  const keyPoints = parsed.keyPoints;
  if (identity.outputContractRevision !== "preschool-section-interpretation-v3"
    || identity.identityContractRevision !== undefined
    || identity.capabilityRevision !== undefined
    || identity.publicationRevision !== undefined
    || parsed.artifactKind !== "section-interpretation"
    || (parsed.status !== "available" && parsed.status !== "empty")
    || !nonEmptyString(parsed.providerProfileId)
    || parsed.providerProfileId !== identity.modelProfileId
    || !nonEmptyString(parsed.runId)
    || !isRecord(parsed.contract)
    || parsed.contract.id !== "preschool-section-interpretation"
    || parsed.contract.revision !== identity.outputContractRevision
    || !isRecord(binding)
    || binding.workspaceId !== identity.workspaceId
    || binding.projectId !== identity.projectId
    || binding.scopeId !== identity.scopeId
    || binding.dataSnapshotId !== identity.dataSnapshotId
    || binding.projectReleaseId !== identity.projectReleaseId
    || binding.modelProfileId !== identity.modelProfileId
    || binding.modelProfileRevision !== identity.modelProfileRevision
    || !isRecord(binding.analysisPeriod)
    || binding.analysisPeriod.from !== identity.analysisPeriodFrom
    || binding.analysisPeriod.to !== identity.analysisPeriodTo
    || parsed.sectionId !== identity.targetId
    || !Array.isArray(keyPoints)) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
  }
  if (parsed.status === "empty") {
    if (keyPoints.length !== 0 || parsed.summary !== undefined || parsed.limitation !== undefined) {
      throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
    }
    return;
  }
  if (!nonEmptyString(parsed.summary)
    || keyPoints.length < 1
    || keyPoints.length > 4
    || !keyPoints.every(validSectionKeyPoint)
    || !optionalString(parsed.limitation)) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
  }
};

const requireSectionInterpretationResultV4 = (
  parsed: Record<string, unknown>,
  identity: EnergyIqOverviewAiArtifactIdentity,
): void => {
  const summary = parsed.summary;
  const insights = parsed.insights;
  const capability = parsed.capability;
  const publication = parsed.publication;
  if (identity.identityContractRevision !== "v4"
    || identity.analysisPackId !== "preschool-section-pack"
    || identity.analysisPackRevision !== "v2"
    || identity.outputContractRevision !== "preschool-section-interpretation-v4"
    || identity.validatorRevision !== "acceptance-validator-v1"
    || identity.workflowRevision !== "discover-accept-publish-v1"
    || identity.investigatorPromptRevision !== "discovery-prompt-v1"
    || identity.capabilityRevision !== "pack-only-v1"
    || identity.publicationRevision !== "v1"
    || parsed.artifactKind !== "section-interpretation"
    || (parsed.status !== "available" && parsed.status !== "empty")
    || !nonEmptyString(parsed.providerProfileId)
    || parsed.providerProfileId !== identity.modelProfileId
    || !nonEmptyString(parsed.runId)
    || !isRecord(parsed.contract)
    || parsed.contract.id !== "preschool-section-interpretation"
    || parsed.contract.revision !== identity.outputContractRevision
    || !sameValueArtifactBinding(parsed.binding, identity)
    || parsed.sectionId !== identity.targetId
    || parsed.packRevision !== identity.analysisPackRevision
    || !isRecord(capability)
    || capability.revision !== identity.capabilityRevision
    || capability.mode !== "pack-only"
    || !Array.isArray(capability.tools)
    || capability.tools.length !== 0
    || !Array.isArray(insights)
    || insights.length > 3
    || !insights.every(validSectionInsightV4)
    || !validSectionPublicationV4(publication, identity, insights.length)) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
  }
  if (parsed.status === "empty") {
    if (summary !== undefined || insights.length !== 0 || parsed.limitation !== undefined) {
      throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
    }
    return;
  }
  if (!validSectionSummaryV4(summary) || !optionalString(parsed.limitation)) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
  }
};

const validSectionSummaryV4 = (value: unknown): boolean => isRecord(value)
  && nonEmptyString(value.text)
  && Array.isArray(value.evidenceRefs)
  && value.evidenceRefs.length > 0
  && value.evidenceRefs.every(nonEmptyString)
  && new Set(value.evidenceRefs).size === value.evidenceRefs.length;

const validSectionInsightV4 = (value: unknown): boolean => isRecord(value)
  && nonEmptyString(value.id)
  && nonEmptyString(value.title)
  && optionalString(value.label)
  && (value.epistemicStatus === "observed"
    || value.epistemicStatus === "inferred"
    || value.epistemicStatus === "speculative")
  && nonEmptyString(value.text)
  && Array.isArray(value.evidenceRefs)
  && value.evidenceRefs.length > 0
  && value.evidenceRefs.every(nonEmptyString)
  && new Set(value.evidenceRefs).size === value.evidenceRefs.length
  && optionalString(value.deepDiveQuestion);

const validSectionPublicationV4 = (
  value: unknown,
  identity: EnergyIqOverviewAiArtifactIdentity,
  insightCount: number,
): boolean => isRecord(value)
  && value.policyId === "preschool-section-publication"
  && value.policyRevision === identity.publicationRevision
  && nonNegativeInteger(value.discoveredCount)
  && nonNegativeInteger(value.acceptedCount)
  && nonNegativeInteger(value.rejectedCount)
  && nonNegativeInteger(value.publishedCount)
  && value.publishedCount === insightCount
  && (value.acceptedCount as number) >= insightCount
  && (value.discoveredCount as number) === (value.acceptedCount as number) + (value.rejectedCount as number)
  && Array.isArray(value.suppressedCandidateIds)
  && value.suppressedCandidateIds.every(nonEmptyString)
  && new Set(value.suppressedCandidateIds).size === value.suppressedCandidateIds.length
  && value.suppressedCandidateIds.length === (value.acceptedCount as number) - insightCount;

const nonNegativeInteger = (value: unknown): boolean =>
  Number.isSafeInteger(value) && (value as number) >= 0;

const validSectionKeyPoint = (value: unknown): boolean => isRecord(value)
  && (value.kind === "priority"
    || value.kind === "finding"
    || value.kind === "meaning"
    || value.kind === "next-check")
  && optionalString(value.label)
  && nonEmptyString(value.text)
  && Array.isArray(value.evidenceRefs)
  && value.evidenceRefs.length > 0
  && value.evidenceRefs.every(nonEmptyString);

const requireExecutiveSynthesisResult = (
  parsed: Record<string, unknown>,
  identity: EnergyIqOverviewAiArtifactIdentity,
  db: DatabaseSync,
): void => {
  if (identity.identityContractRevision === "v4"
    || identity.outputContractRevision === "preschool-executive-synthesis-v4") {
    requireExecutiveSynthesisResultV4(parsed, identity, db);
    return;
  }
  requireExecutiveSynthesisResultV3(parsed, identity);
};

const requireExecutiveSynthesisResultV3 = (
  parsed: Record<string, unknown>,
  identity: EnergyIqOverviewAiArtifactIdentity,
): void => {
  const binding = parsed.binding;
  const findings = parsed.keyFindings;
  if (parsed.artifactKind !== "executive-synthesis"
    || (parsed.status !== "available" && parsed.status !== "empty")
    || !nonEmptyString(parsed.providerProfileId)
    || parsed.providerProfileId !== identity.modelProfileId
    || !nonEmptyString(parsed.runId)
    || !isRecord(parsed.contract)
    || parsed.contract.id !== "preschool-executive-synthesis"
    || parsed.contract.revision !== identity.outputContractRevision
    || !sameValueArtifactBinding(binding, identity)
    || !Array.isArray(parsed.sourceSectionArtifactIds)
    || !parsed.sourceSectionArtifactIds.every(nonEmptyString)
    || !Array.isArray(findings)) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
  }
  if (parsed.status === "empty") {
    if (findings.length !== 0) throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
    return;
  }
  if (findings.length < 1 || findings.length > 4 || !findings.every(validExecutiveKeyFinding)) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
  }
};

const requireExecutiveSynthesisResultV4 = (
  parsed: Record<string, unknown>,
  identity: EnergyIqOverviewAiArtifactIdentity,
  db: DatabaseSync,
): void => {
  const sourceIds = parsed.sourceSectionArtifactIds;
  const findings = parsed.findings;
  if (identity.identityContractRevision !== "v4"
    || identity.analysisPackId !== "preschool-executive-section-artifacts"
    || identity.analysisPackRevision !== "section-interpretation-v4"
    || identity.outputContractRevision !== "preschool-executive-synthesis-v4"
    || identity.validatorRevision !== "preschool-executive-synthesis-validator-v4"
    || identity.workflowRevision !== "preschool-executive-synthesis-v4"
    || identity.investigatorPromptRevision !== "preschool-executive-synthesis-prompt-v4"
    || identity.capabilityRevision !== "section-artifacts-only-v1"
    || identity.publicationRevision !== "key-findings-v1"
    || parsed.artifactKind !== "executive-synthesis"
    || (parsed.status !== "available" && parsed.status !== "empty")
    || !nonEmptyString(parsed.providerProfileId)
    || parsed.providerProfileId !== identity.modelProfileId
    || !nonEmptyString(parsed.runId)
    || !isRecord(parsed.contract)
    || parsed.contract.id !== "preschool-executive-synthesis"
    || parsed.contract.revision !== identity.outputContractRevision
    || !sameValueArtifactBinding(parsed.binding, identity)
    || !Array.isArray(sourceIds)
    || !sourceIds.every(nonEmptyString)
    || new Set(sourceIds).size !== sourceIds.length
    || sourceIds.length > 4
    || !Array.isArray(findings)) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
  }
  if (parsed.status === "empty") {
    if (sourceIds.length !== 0 || parsed.summary !== undefined || findings.length !== 0) {
      throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
    }
    return;
  }
  if (sourceIds.length === 0
    || !validExecutiveSummaryV4(parsed.summary)
    || findings.length > 3
    || !findings.every(validExecutiveKeyFindingV4)) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
  }
  requireExecutiveSourceLineageV4({ parsed, identity, sourceIds, db });
};

const requireExecutiveSourceLineageV4 = (input: {
  parsed: Record<string, unknown>;
  identity: EnergyIqOverviewAiArtifactIdentity;
  sourceIds: string[];
  db: DatabaseSync;
}): void => {
  const evidenceOwners = new Map<string, Set<string>>();
  const artifactIdBySection = new Map<string, string>();
  for (const sourceId of input.sourceIds) {
    const row = input.db.prepare(`
      SELECT id, status, identity_json, result_json
      FROM energyiq_overview_ai_artifacts
      WHERE id = ?
    `).get(sourceId);
    if (!isRecord(row) || row.status !== "available" || typeof row.identity_json !== "string"
      || typeof row.result_json !== "string") {
      throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
    }
    let sourceIdentity: unknown;
    let sourceResult: unknown;
    try {
      sourceIdentity = JSON.parse(row.identity_json);
      sourceResult = JSON.parse(row.result_json);
    } catch {
      throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
    }
    if (!isRecord(sourceIdentity)
      || sourceIdentity.artifactKind !== "section-interpretation"
      || sourceIdentity.identityContractRevision !== "v4"
      || sourceIdentity.outputContractRevision !== "preschool-section-interpretation-v4"
      || sourceIdentity.workspaceId !== input.identity.workspaceId
      || sourceIdentity.projectId !== input.identity.projectId
      || sourceIdentity.scopeId !== input.identity.scopeId
      || sourceIdentity.dataSnapshotId !== input.identity.dataSnapshotId
      || sourceIdentity.projectReleaseId !== input.identity.projectReleaseId
      || sourceIdentity.analysisPeriodFrom !== input.identity.analysisPeriodFrom
      || sourceIdentity.analysisPeriodTo !== input.identity.analysisPeriodTo
      || sourceIdentity.modelProfileId !== input.identity.modelProfileId
      || sourceIdentity.modelProfileRevision !== input.identity.modelProfileRevision
      || !nonEmptyString(sourceIdentity.targetId)
      || !isRecord(sourceResult)
      || sourceResult.status !== "available"
      || sourceResult.sectionId !== sourceIdentity.targetId
      || !isRecord(sourceResult.summary)
      || !Array.isArray(sourceResult.summary.evidenceRefs)
      || !Array.isArray(sourceResult.insights)) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
    }
    artifactIdBySection.set(sourceIdentity.targetId, sourceId);
    const references = [
      ...sourceResult.summary.evidenceRefs,
      ...sourceResult.insights.flatMap((insight) => isRecord(insight) && Array.isArray(insight.evidenceRefs)
        ? insight.evidenceRefs
        : []),
    ];
    for (const reference of references) {
      if (!nonEmptyString(reference)) throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
      const owners = evidenceOwners.get(reference) ?? new Set<string>();
      owners.add(sourceIdentity.targetId);
      evidenceOwners.set(reference, owners);
    }
  }
  const usedSections = new Set<string>();
  const summary = input.parsed.summary as Record<string, unknown>;
  for (const reference of summary.evidenceRefs as string[]) {
    const owners = evidenceOwners.get(reference);
    if (!owners) throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
    for (const owner of owners) usedSections.add(owner);
  }
  for (const finding of input.parsed.findings as Record<string, unknown>[]) {
    const declared = new Set(finding.sectionIds as string[]);
    for (const sectionId of declared) {
      if (!artifactIdBySection.has(sectionId)) throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
      usedSections.add(sectionId);
    }
    for (const reference of finding.evidenceRefs as string[]) {
      const owners = evidenceOwners.get(reference);
      if (!owners || ![...owners].some((owner) => declared.has(owner))) {
        throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
      }
    }
  }
  const expectedSourceIds = [...usedSections].map((sectionId) => artifactIdBySection.get(sectionId)!).sort();
  if (expectedSourceIds.length !== input.sourceIds.length
    || expectedSourceIds.some((sourceId, index) => sourceId !== [...input.sourceIds].sort()[index])) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
  }
};

const validExecutiveSummaryV4 = (value: unknown): boolean => isRecord(value)
  && nonEmptyString(value.text)
  && Array.isArray(value.evidenceRefs)
  && value.evidenceRefs.length > 0
  && value.evidenceRefs.every(nonEmptyString);

const validExecutiveKeyFindingV4 = (value: unknown): boolean => isRecord(value)
  && nonEmptyString(value.id)
  && nonEmptyString(value.title)
  && nonEmptyString(value.text)
  && Array.isArray(value.sectionIds)
  && value.sectionIds.length > 0
  && value.sectionIds.every(nonEmptyString)
  && Array.isArray(value.evidenceRefs)
  && value.evidenceRefs.length > 0
  && value.evidenceRefs.every(nonEmptyString)
  && (value.alert === undefined || validExecutiveAlertV4(value.alert));

const validExecutiveAlertV4 = (value: unknown): boolean => isRecord(value)
  && (value.severity === "attention" || value.severity === "urgent")
  && (value.certainty === "confirmed" || value.certainty === "anomaly" || value.certainty === "possible");

const validExecutiveKeyFinding = (value: unknown): boolean => isRecord(value)
  && nonEmptyString(value.id)
  && nonEmptyString(value.takeaway)
  && Array.isArray(value.sectionIds)
  && value.sectionIds.length > 0
  && value.sectionIds.every(nonEmptyString)
  && Array.isArray(value.evidenceRefs)
  && value.evidenceRefs.length > 0
  && value.evidenceRefs.every(nonEmptyString);

const sameValueArtifactBinding = (
  value: unknown,
  identity: EnergyIqOverviewAiArtifactIdentity,
): boolean => isRecord(value)
  && value.workspaceId === identity.workspaceId
  && value.projectId === identity.projectId
  && value.scopeId === identity.scopeId
  && value.dataSnapshotId === identity.dataSnapshotId
  && value.projectReleaseId === identity.projectReleaseId
  && value.modelProfileId === identity.modelProfileId
  && value.modelProfileRevision === identity.modelProfileRevision
  && isRecord(value.analysisPeriod)
  && value.analysisPeriod.from === identity.analysisPeriodFrom
  && value.analysisPeriod.to === identity.analysisPeriodTo;

const validAcceptedFinding = (value: unknown, binding: Record<string, unknown>): boolean => {
  if (!isRecord(value)
    || !nonEmptyString(value.id)
    || !isRecord(value.binding)
    || !sameArtifactBinding(value.binding, binding)
    || !Array.isArray(value.placementTargets)
    || value.placementTargets.length === 0
    || !value.placementTargets.every(isPreschoolPlacementTarget)
    || (value.epistemicLevel !== "verified"
      && value.epistemicLevel !== "hypothesis"
      && value.epistemicLevel !== "exploration-idea")
    || (value.relationship !== "supports"
      && value.relationship !== "challenges"
      && value.relationship !== "independent")
    || !stringArray(value.signalRefs)
    || !nonEmptyString(value.title)
    || !nonEmptyString(value.takeaway)
    || !optionalString(value.interpretation)
    || !optionalString(value.action)
    || !optionalString(value.verification)
    || !optionalString(value.uncertainty)
    || (value.epistemicLevel !== "verified"
      && !nonEmptyString(value.verification)
      && !nonEmptyString(value.uncertainty))
    || (value.presentation !== undefined
      && (!isRecord(value.presentation)
        || value.presentation.version !== "1"
        || !Array.isArray(value.presentation.blocks)))
    || !isRecord(value.evidence)
    || value.evidence.snapshotId !== binding.dataSnapshotId
    || !isRecord(value.evidence.period)
    || !isRecord(binding.analysisPeriod)
    || value.evidence.period.from !== binding.analysisPeriod.from
    || value.evidence.period.to !== binding.analysisPeriod.to
    || !Array.isArray(value.evidence.deterministic)
    || !value.evidence.deterministic.every(validDeterministicEvidence)
    || !Array.isArray(value.evidence.tools)
    || !value.evidence.tools.every(validToolEvidence)) return false;
  return value.epistemicLevel !== "verified"
    || value.evidence.deterministic.length > 0
    || value.evidence.tools.length > 0;
};

const sameArtifactBinding = (left: Record<string, unknown>, right: Record<string, unknown>): boolean =>
  left.projectId === right.projectId
  && left.scopeId === right.scopeId
  && left.dataSnapshotId === right.dataSnapshotId
  && left.projectReleaseId === right.projectReleaseId
  && left.dataCutoff === right.dataCutoff
  && left.outputContractRevision === right.outputContractRevision
  && isRecord(left.analysisPeriod)
  && isRecord(right.analysisPeriod)
  && left.analysisPeriod.from === right.analysisPeriod.from
  && left.analysisPeriod.to === right.analysisPeriod.to;

const validDeterministicEvidence = (value: unknown): boolean => isRecord(value)
  && nonEmptyString(value.id)
  && nonEmptyString(value.label)
  && isRecord(value.values)
  && Array.isArray(value.queryIds)
  && value.queryIds.every(nonEmptyString);

const validToolEvidence = (value: unknown): boolean => isRecord(value)
  && Number.isSafeInteger(value.evidenceIndex)
  && (value.evidenceIndex as number) > 0
  && nonEmptyString(value.toolCallId)
  && (value.sql === null || nonEmptyString(value.sql))
  && (value.rowCount === null || (Number.isSafeInteger(value.rowCount) && (value.rowCount as number) >= 0))
  && (value.auditLogId === null || nonEmptyString(value.auditLogId))
  && (value.elapsedMs === null
    || (typeof value.elapsedMs === "number" && Number.isFinite(value.elapsedMs) && value.elapsedMs >= 0))
  && typeof value.resultPreview === "string";

const validEditorTrace = (value: unknown): boolean => value === undefined
  || (Array.isArray(value) && value.every((decision) => isRecord(decision)
    && (decision.decision === "accepted" || decision.decision === "rejected" || decision.decision === "merged")
    && Array.isArray(decision.sourceCandidateIds)
    && decision.sourceCandidateIds.length > 0
    && decision.sourceCandidateIds.every(nonEmptyString)
    && optionalString(decision.findingId)
    && optionalString(decision.reason)));

const isPreschoolPlacementTarget = (value: unknown): boolean =>
  value === "preschool.overall-key-findings"
  || value === "preschool.benchmark"
  || value === "preschool.standby"
  || value === "preschool.operating-hours"
  || value === "preschool.forecast"
  || value === "cross-section";

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && Boolean(value.trim());

const optionalString = (value: unknown): boolean => value === undefined || nonEmptyString(value);

const stringArray = (value: unknown): boolean => Array.isArray(value) && value.every(nonEmptyString);

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
