import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import {
  additionalAiInsightEvaluationBatchIsValid,
  additionalAiInsightEvaluationTargetsCanTransition,
  additionalAiInsightHumanReviewIsPassing,
  additionalAiInsightTransitionRecordIsValid,
  additionalAiInsightTransitionIsValid,
  additionalAiInsightsArtifactIsValid,
  canonicalInsightMethodSetJson,
  evaluateAdditionalAiInsightPassAt3,
  resolveCurrentAdditionalAiInsightMethodSet,
  type AdditionalAiInsightEvaluationAttempt,
  type AdditionalAiInsightEvaluationBatch,
  type AdditionalAiInsightEvaluationHumanReview,
  type AdditionalAiInsightEvaluationTarget,
  type AdditionalAiInsightFailedTransitionRecord,
  type AdditionalAiInsightHumanScores,
  type AdditionalAiInsightTransitionArtifactAudit,
  type AdditionalAiInsightTransitionOutcome,
  type AdditionalAiInsightTransitionEvaluationRecord,
  type AdditionalAiInsightTransitionRecord,
  type AdditionalAiInsightsArtifact,
} from "@datafoundry/contracts";

import { EnergyIqInsightMethodGovernanceStore } from "./energyiq-insight-method-governance-store.js";

export const initializeEnergyIqAdditionalInsightEvaluationSchema = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS energyiq_additional_insight_evaluations (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      record_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(workspace_id, project_id, idempotency_key),
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY(project_id) REFERENCES energyiq_projects(id) ON DELETE CASCADE,
      FOREIGN KEY(requested_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_energyiq_additional_evaluations_target
      ON energyiq_additional_insight_evaluations(workspace_id, project_id, scope_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS energyiq_additional_insight_evaluation_artifacts (
      evaluation_id TEXT NOT NULL,
      attempt_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      result_json TEXT NOT NULL,
      PRIMARY KEY(evaluation_id, attempt_id),
      FOREIGN KEY(evaluation_id) REFERENCES energyiq_additional_insight_evaluations(id) ON DELETE CASCADE,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY(project_id) REFERENCES energyiq_projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS energyiq_additional_insight_transitions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      reservation_json TEXT NOT NULL,
      record_json TEXT,
      current_artifact_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(workspace_id, project_id, idempotency_key),
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY(project_id) REFERENCES energyiq_projects(id) ON DELETE CASCADE,
      FOREIGN KEY(requested_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS energyiq_additional_insight_evaluation_claims (
      evaluation_id TEXT NOT NULL,
      attempt_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      claim_token TEXT NOT NULL,
      lease_expires_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(evaluation_id, attempt_id),
      FOREIGN KEY(evaluation_id) REFERENCES energyiq_additional_insight_evaluations(id) ON DELETE CASCADE,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY(project_id) REFERENCES energyiq_projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS energyiq_additional_insight_transition_claims (
      transition_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      claim_token TEXT NOT NULL,
      lease_expires_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(transition_id) REFERENCES energyiq_additional_insight_transitions(id) ON DELETE CASCADE,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY(project_id) REFERENCES energyiq_projects(id) ON DELETE CASCADE
    );
  `);
};

export const ensureEnergyIqAdditionalInsightEvaluationHardeningSchema = (db: DatabaseSync): void => {
  const columns = db.prepare("PRAGMA table_info(energyiq_additional_insight_evaluations)").all();
  const alreadyHardened = columns.some((row) => isRecord(row) && row.name === "requested_by");
  if (alreadyHardened) {
    initializeEnergyIqAdditionalInsightEvaluationSchema(db);
    return;
  }
  const tableExists = columns.length > 0;
  if (!tableExists) {
    initializeEnergyIqAdditionalInsightEvaluationSchema(db);
    return;
  }
  for (const row of db.prepare(`
    SELECT id, record_json FROM energyiq_additional_insight_evaluations
  `).all()) {
    if (!isRecord(row) || !nonEmpty(row.id) || !nonEmpty(row.record_json)) {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_0033_RECORD_INVALID");
    }
    let record: unknown;
    try { record = JSON.parse(row.record_json); } catch {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_0033_RECORD_INVALID");
    }
    if (!isRecord(record) || !isRecord(record.target) || !Array.isArray(record.attempts)) {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_0033_RECORD_INVALID");
    }
    for (const attempt of record.attempts) {
      if (!isRecord(attempt) || !nonEmpty(attempt.attemptId)) {
        throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_0033_RECORD_INVALID");
      }
      if (!isRecord(attempt.artifact)) {
        attempt.artifact = evaluationArtifactIdentity(
          record.target as AdditionalAiInsightEvaluationTarget,
          row.id,
          attempt.attemptId,
        );
      }
    }
    db.prepare(`
      UPDATE energyiq_additional_insight_evaluations SET record_json = ? WHERE id = ?
    `).run(JSON.stringify(record), row.id);
  }
  const invalidParents = db.prepare(`
    SELECT COUNT(*) AS count FROM (
      SELECT e.id
      FROM energyiq_additional_insight_evaluations e
      LEFT JOIN workspaces w ON w.id = e.workspace_id
      LEFT JOIN energyiq_projects p ON p.id = e.project_id AND p.workspace_id = e.workspace_id
      LEFT JOIN users u ON u.id = json_extract(e.record_json, '$.requestedBy')
      WHERE w.id IS NULL OR p.id IS NULL OR u.id IS NULL
        OR (e.scope_id <> p.root_scope_id AND NOT EXISTS (
          SELECT 1 FROM energyiq_project_nodes n WHERE n.project_id = e.project_id AND n.id = e.scope_id
        ))
      UNION ALL
      SELECT t.id
      FROM energyiq_additional_insight_transitions t
      LEFT JOIN workspaces w ON w.id = t.workspace_id
      LEFT JOIN energyiq_projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
      LEFT JOIN users u ON u.id = json_extract(t.reservation_json, '$.requestedBy')
      WHERE w.id IS NULL OR p.id IS NULL OR u.id IS NULL
    )
  `).get();
  if (!isRecord(invalidParents) || invalidParents.count !== 0) {
    throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_0033_PARENT_INVALID");
  }
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.exec(`
      BEGIN IMMEDIATE;
      ALTER TABLE energyiq_additional_insight_evaluation_artifacts
        RENAME TO energyiq_additional_insight_evaluation_artifacts_0033;
      ALTER TABLE energyiq_additional_insight_evaluations
        RENAME TO energyiq_additional_insight_evaluations_0033;
      ALTER TABLE energyiq_additional_insight_transitions
        RENAME TO energyiq_additional_insight_transitions_0033;
      COMMIT;
    `);
    initializeEnergyIqAdditionalInsightEvaluationSchema(db);
    db.exec(`
      BEGIN IMMEDIATE;
      INSERT INTO energyiq_additional_insight_evaluations (
        id, workspace_id, project_id, scope_id, requested_by, idempotency_key,
        record_json, created_at, updated_at
      )
      SELECT id, workspace_id, project_id, scope_id,
        json_extract(record_json, '$.requestedBy'), idempotency_key,
        record_json, created_at, updated_at
      FROM energyiq_additional_insight_evaluations_0033;

      INSERT INTO energyiq_additional_insight_evaluation_artifacts (
        evaluation_id, attempt_id, workspace_id, project_id, result_json
      )
      SELECT a.evaluation_id, a.attempt_id, e.workspace_id, e.project_id, a.result_json
      FROM energyiq_additional_insight_evaluation_artifacts_0033 a
      JOIN energyiq_additional_insight_evaluations_0033 e ON e.id = a.evaluation_id;

      INSERT INTO energyiq_additional_insight_transitions (
        id, workspace_id, project_id, scope_id, requested_by, idempotency_key,
        reservation_json, record_json, current_artifact_json, created_at, updated_at
      )
      SELECT id, workspace_id, project_id,
        json_extract(reservation_json, '$.currentTarget.scopeId'),
        json_extract(reservation_json, '$.requestedBy'), idempotency_key,
        reservation_json, record_json, current_artifact_json, created_at, updated_at
      FROM energyiq_additional_insight_transitions_0033;

      DROP TABLE energyiq_additional_insight_evaluation_artifacts_0033;
      DROP TABLE energyiq_additional_insight_evaluations_0033;
      DROP TABLE energyiq_additional_insight_transitions_0033;
      COMMIT;
    `);
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* no active transaction */ }
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
  initializeEnergyIqAdditionalInsightEvaluationSchema(db);
  const violations = db.prepare("PRAGMA foreign_key_check").all();
  if (violations.length > 0) {
    throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_0034_FOREIGN_KEY_INVALID");
  }
};

type AttemptReservation = {
  attemptId: string;
  ordinal: number;
  providerRunId: string;
  providerSessionId: string;
};

type TransitionReservation = {
  transitionId: string;
  idempotencyKey: string;
  requestedBy: string;
  previousEvaluationId: string;
  previousAttemptId: string;
  previousArtifactId: string;
  previousArtifactIdentityHash: string;
  previousTarget: AdditionalAiInsightEvaluationTarget;
  currentTarget: AdditionalAiInsightEvaluationTarget;
  currentArtifactId: string;
  currentArtifactIdentityHash: string;
  generationProviderRunId: string;
  generationProviderSessionId: string;
  comparisonProviderRunId: string;
  comparisonProviderSessionId: string;
  createdAt: string;
};

export class EnergyIqAdditionalInsightEvaluationStore {
  constructor(private readonly db: DatabaseSync) {}

  reserveEvaluation(input: {
    evaluationId: string;
    idempotencyKey: string;
    requestedBy: string;
    target: AdditionalAiInsightEvaluationTarget;
    attempts: readonly AttemptReservation[];
    now?: string;
  }): { created: boolean; record: AdditionalAiInsightEvaluationBatch } {
    requireTarget(input.target, this.db);
    requireNonEmpty(input.evaluationId, "ENERGYIQ_ADDITIONAL_EVALUATION_ID_REQUIRED");
    requireNonEmpty(input.idempotencyKey, "ENERGYIQ_ADDITIONAL_EVALUATION_IDEMPOTENCY_KEY_REQUIRED");
    requireNonEmpty(input.requestedBy, "ENERGYIQ_ADDITIONAL_EVALUATION_ACTOR_REQUIRED");
    requireActor(input.requestedBy, this.db);
    const existing = this.db.prepare(`
      SELECT record_json FROM energyiq_additional_insight_evaluations
      WHERE workspace_id = ? AND project_id = ? AND idempotency_key = ?
    `).get(input.target.workspaceId, input.target.projectId, input.idempotencyKey);
    if (isRecord(existing)) {
      const record = parseEvaluation(existing.record_json);
      if (JSON.stringify(record.target) !== JSON.stringify(input.target)) {
        throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_IDEMPOTENCY_CONFLICT");
      }
      return { created: false, record };
    }
    if (input.attempts.length !== 3
      || !sameNumbers(input.attempts.map(({ ordinal }) => ordinal), [1, 2, 3])
      || !unique(input.attempts.map(({ attemptId }) => attemptId))
      || !unique(input.attempts.map(({ providerRunId }) => providerRunId))
      || !unique(input.attempts.map(({ providerSessionId }) => providerSessionId))
      || input.attempts.some((attempt) => !attemptReservationIsValid(attempt))) {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ATTEMPTS_INVALID");
    }
    const now = input.now ?? new Date().toISOString();
    const record: AdditionalAiInsightEvaluationBatch = {
      contractRevision: "energyiq-additional-insight-evaluation-v1",
      evaluationId: input.evaluationId,
      idempotencyKey: input.idempotencyKey,
      requestedBy: input.requestedBy,
      status: "running",
      target: clone(input.target),
      attempts: input.attempts.map((attempt) => ({
        ...attempt,
        artifact: evaluationArtifactIdentity(input.target, input.evaluationId, attempt.attemptId),
        status: "running" as const,
        startedAt: now,
      })),
      reviewPack: { revision: "additional-insight-blind-review-v1", entries: [] },
      reviewAudit: [],
      createdAt: now,
      updatedAt: now,
    };
    requireEvaluation(record);
    this.db.prepare(`
      INSERT INTO energyiq_additional_insight_evaluations (
        id, workspace_id, project_id, scope_id, requested_by, idempotency_key, record_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.evaluationId,
      record.target.workspaceId,
      record.target.projectId,
      record.target.scopeId,
      record.requestedBy,
      record.idempotencyKey,
      JSON.stringify(record),
      now,
      now,
    );
    return { created: true, record };
  }

  claimEvaluationAttempt(input: {
    evaluationId: string;
    expectedWorkspaceId: string;
    expectedProjectId: string;
    attemptId: string;
    now?: string;
    leaseMs?: number;
  }): {
    acquired: boolean;
    claimToken?: string;
    attempt: AdditionalAiInsightEvaluationBatch["attempts"][number];
    record: AdditionalAiInsightEvaluationBatch;
  } {
    return immediateTransaction(this.db, () => {
      const record = this.getEvaluation(input);
      const attempt = record.attempts.find(({ attemptId }) => attemptId === input.attemptId);
      if (!attempt) throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ATTEMPT_NOT_FOUND");
      if (attempt.status !== "running") return { acquired: false, attempt, record };
      const now = input.now ?? new Date().toISOString();
      const leaseExpiresAt = leaseExpiry(now, input.leaseMs);
      const claimToken = randomUUID();
      const existing = this.db.prepare(`
        SELECT claim_token, lease_expires_at
        FROM energyiq_additional_insight_evaluation_claims
        WHERE evaluation_id = ? AND attempt_id = ? AND workspace_id = ? AND project_id = ?
      `).get(
        record.evaluationId,
        attempt.attemptId,
        record.target.workspaceId,
        record.target.projectId,
      );
      if (isRecord(existing) && typeof existing.lease_expires_at === "string"
        && existing.lease_expires_at > now) {
        return { acquired: false, attempt, record };
      }
      this.db.prepare(`
        INSERT INTO energyiq_additional_insight_evaluation_claims (
          evaluation_id, attempt_id, workspace_id, project_id, claim_token, lease_expires_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(evaluation_id, attempt_id) DO UPDATE SET
          claim_token = excluded.claim_token,
          lease_expires_at = excluded.lease_expires_at,
          updated_at = excluded.updated_at
      `).run(
        record.evaluationId,
        attempt.attemptId,
        record.target.workspaceId,
        record.target.projectId,
        claimToken,
        leaseExpiresAt,
        now,
      );
      return { acquired: true, claimToken, attempt, record };
    });
  }

  completeAttempt(input: {
    evaluationId: string;
    expectedWorkspaceId: string;
    expectedProjectId: string;
    attemptId: string;
    claimToken: string;
    artifact: AdditionalAiInsightsArtifact;
    machineGate: AdditionalAiInsightEvaluationAttempt["machineGate"];
    completedAt?: string;
  }): AdditionalAiInsightEvaluationBatch {
    return immediateTransaction(this.db, () => {
      const record = this.getEvaluation({
      evaluationId: input.evaluationId,
      expectedWorkspaceId: input.expectedWorkspaceId,
      expectedProjectId: input.expectedProjectId,
      });
      const index = record.attempts.findIndex(({ attemptId }) => attemptId === input.attemptId);
      const reserved = record.attempts[index];
      if (!reserved) throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ATTEMPT_NOT_FOUND");
      requireEvaluationClaim(this.db, record, reserved.attemptId, input.claimToken);
      const resultJson = JSON.stringify(input.artifact);
      if (reserved.status === "completed") {
        if (reserved.artifact.resultHash !== sha256(resultJson)
          || reserved.providerRunId !== input.artifact.runId
          || JSON.stringify(reserved.machineGate) !== JSON.stringify(input.machineGate)) {
          throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ATTEMPT_COMPLETION_CONFLICT");
        }
        return record;
      }
      if (reserved.status !== "running") throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ATTEMPT_TERMINAL");
      if (input.artifact.runId !== reserved.providerRunId) {
        throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_PROVIDER_RUN_MISMATCH");
      }
      requireArtifactMatchesTarget(input.artifact, record.target, this.db);
      const evidenceRefs = uniqueStrings(input.artifact.findings.flatMap(({ evidenceRefs }) => evidenceRefs));
      const completed: AdditionalAiInsightEvaluationAttempt = {
      attemptId: reserved.attemptId,
      ordinal: reserved.ordinal,
      status: "completed",
      providerRunId: reserved.providerRunId,
      providerSessionId: reserved.providerSessionId,
      artifact: {
        ...reserved.artifact,
        resultHash: sha256(resultJson),
        resultStatus: input.artifact.status,
      },
      statistics: {
        discoveredCount: input.artifact.publication.discoveredCount,
        acceptedCount: input.artifact.publication.acceptedCount,
        rejectedCount: input.artifact.publication.rejectedCount,
        publishedCount: input.artifact.publication.publishedCount,
      },
      evidenceRefs,
      methodResourceIds: input.artifact.methodExecution.loadedMethods.map(({ resourceId }) => resourceId),
      toolAuditIds: input.artifact.toolAudits.map(({ auditId }) => auditId),
      machineGate: clone(input.machineGate),
      startedAt: reserved.startedAt,
      completedAt: input.completedAt ?? new Date().toISOString(),
      };
      record.attempts[index] = completed;
      record.updatedAt = completed.completedAt;
      record.status = "running";
      requireEvaluation(record);
      this.db.prepare(`
        INSERT INTO energyiq_additional_insight_evaluation_artifacts (
          evaluation_id, attempt_id, workspace_id, project_id, result_json
        ) VALUES (?, ?, ?, ?, ?)
      `).run(
        record.evaluationId,
        completed.attemptId,
        record.target.workspaceId,
        record.target.projectId,
        resultJson,
      );
      this.writeEvaluation(record);
      return clone(record);
    });
  }

  failAttempt(input: {
    evaluationId: string;
    expectedWorkspaceId: string;
    expectedProjectId: string;
    attemptId: string;
    claimToken: string;
    errorCode: string;
    failureStage?: "provider" | "structured-output" | "machine-gate";
    completedAt?: string;
  }): AdditionalAiInsightEvaluationBatch {
    return immediateTransaction(this.db, () => {
      const record = this.getEvaluation(input);
      const index = record.attempts.findIndex(({ attemptId }) => attemptId === input.attemptId);
      const reserved = record.attempts[index];
      if (!reserved) throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ATTEMPT_NOT_FOUND");
      requireEvaluationClaim(this.db, record, reserved.attemptId, input.claimToken);
      const errorCode = boundedCode(input.errorCode);
      const failureStage = input.failureStage ?? "provider";
      if (reserved.status === "failed") {
        if (reserved.errorCode !== errorCode || reserved.failureStage !== failureStage) {
          throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ATTEMPT_FAILURE_CONFLICT");
        }
        return record;
      }
      if (reserved.status !== "running") throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ATTEMPT_TERMINAL");
      const completedAt = input.completedAt ?? new Date().toISOString();
      record.attempts[index] = {
      attemptId: reserved.attemptId,
      ordinal: reserved.ordinal,
      status: "failed",
      providerRunId: reserved.providerRunId,
      providerSessionId: reserved.providerSessionId,
      artifact: reserved.artifact,
      errorCode,
      failureStage,
      startedAt: reserved.startedAt,
      completedAt,
      };
      record.updatedAt = completedAt;
      requireEvaluation(record);
      this.writeEvaluation(record);
      return clone(record);
    });
  }

  finalizeEvaluation(input: {
    evaluationId: string;
    expectedWorkspaceId: string;
    expectedProjectId: string;
    now?: string;
  }): AdditionalAiInsightEvaluationBatch {
    const record = this.getEvaluation(input);
    if (record.attempts.some(({ status }) => status === "running")) {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ATTEMPTS_NOT_TERMINAL");
    }
    const completed = record.attempts.filter((attempt): attempt is AdditionalAiInsightEvaluationAttempt => (
      attempt.status === "completed"
    ));
    const shuffled = [...completed].sort((left, right) => blindSortKey(record.evaluationId, left.attemptId)
      .localeCompare(blindSortKey(record.evaluationId, right.attemptId)));
    record.reviewPack = {
      revision: "additional-insight-blind-review-v1",
      entries: shuffled.map((attempt, index) => {
        const artifact = this.readAttemptArtifact(record, attempt.attemptId);
        return {
          label: (["Review A", "Review B", "Review C"] as const)[index]!,
          reviewToken: blindToken(record.evaluationId, attempt.attemptId),
          findings: artifact.findings.map((finding) => ({
            reviewFindingToken: blindFindingToken(record.evaluationId, attempt.attemptId, finding.id),
            title: finding.title,
            text: finding.text,
            epistemicStatus: finding.epistemicStatus,
            evidenceRefs: [...finding.evidenceRefs],
            originKind: finding.origin.kind,
            directionMethodResourceIds: finding.origin.directionMethods.map(({ resourceId }) => resourceId),
            ...(finding.alert
              ? { alert: { severity: finding.alert.severity, certainty: finding.alert.certainty } }
              : {}),
          })),
        };
      }),
    };
    record.reviewAudit = shuffled.map((attempt) => ({
      reviewToken: blindToken(record.evaluationId, attempt.attemptId),
      attemptId: attempt.attemptId,
    }));
    record.status = completed.length > 0 ? "awaiting-human-review" : "failed";
    record.updatedAt = input.now ?? new Date().toISOString();
    requireEvaluation(record);
    this.writeEvaluation(record);
    return clone(record);
  }

  recordHumanReview(input: {
    evaluationId: string;
    expectedWorkspaceId: string;
    expectedProjectId: string;
    reviewToken: string;
    actorId: string;
    scores: AdditionalAiInsightHumanScores;
    contentUsefulness: AdditionalAiInsightEvaluationHumanReview["contentUsefulness"];
    expectedRevision: number;
    now?: string;
  }): AdditionalAiInsightEvaluationBatch {
    const record = this.getEvaluation(input);
    const audit = record.reviewAudit.find(({ reviewToken }) => reviewToken === input.reviewToken);
    if (!audit) throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_REVIEW_TOKEN_INVALID");
    const attempt = record.attempts.find((candidate): candidate is AdditionalAiInsightEvaluationAttempt => (
      candidate.attemptId === audit.attemptId && candidate.status === "completed"
    ));
    if (!attempt) throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_REVIEW_ATTEMPT_INVALID");
    const current = attempt.humanReview;
    if (current
      && current.actorId === input.actorId
      && JSON.stringify(current.scores) === JSON.stringify(input.scores)
      && JSON.stringify(current.contentUsefulness) === JSON.stringify(input.contentUsefulness)) {
      return record;
    }
    const currentRevision = current?.revision ?? 0;
    if (input.expectedRevision !== currentRevision) {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_REVIEW_REVISION_CONFLICT");
    }
    requireScores(input.scores);
    const packEntry = record.reviewPack.entries.find(({ reviewToken }) => reviewToken === input.reviewToken)!;
    requireContentUsefulness(input.contentUsefulness, packEntry);
    requireNonEmpty(input.actorId, "ENERGYIQ_ADDITIONAL_EVALUATION_REVIEW_ACTOR_REQUIRED");
    const reviewedAt = input.now ?? new Date().toISOString();
    const humanReview: AdditionalAiInsightEvaluationHumanReview = {
      actorId: input.actorId,
      reviewedAt,
      scores: clone(input.scores),
      contentUsefulness: clone(input.contentUsefulness),
      passed: false,
      revision: currentRevision + 1,
    };
    humanReview.passed = additionalAiInsightHumanReviewIsPassing(humanReview);
    attempt.humanReview = humanReview;
    record.updatedAt = reviewedAt;
    const completed = record.attempts.filter((candidate): candidate is AdditionalAiInsightEvaluationAttempt => (
      candidate.status === "completed"
    ));
    if (record.attempts.every(({ status }) => status !== "running")
      && completed.every(({ humanReview: review }) => review !== undefined)) {
      record.status = evaluateAdditionalAiInsightPassAt3(record) === "passed" ? "passed" : "failed";
    } else {
      record.status = "awaiting-human-review";
    }
    requireEvaluation(record);
    this.writeEvaluation(record);
    return clone(record);
  }

  approveEvaluationCandidate(input: {
    evaluationId: string;
    expectedWorkspaceId: string;
    expectedProjectId: string;
    reviewToken: string;
    actorId: string;
    expectedRevision: number;
    now?: string;
  }): AdditionalAiInsightEvaluationBatch {
    const record = this.getEvaluation(input);
    const audit = record.reviewAudit.find(({ reviewToken }) => reviewToken === input.reviewToken);
    if (!audit) throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_REVIEW_TOKEN_INVALID");
    const selected = record.attempts.find((attempt): attempt is AdditionalAiInsightEvaluationAttempt => (
      attempt.attemptId === audit.attemptId && attempt.status === "completed"
    ));
    if (record.status !== "passed"
      || !selected
      || selected.machineGate.status !== "passed"
      || !selected.humanReview?.passed) {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_APPROVAL_NOT_ALLOWED");
    }
    if (record.approval) {
      if (record.approval.selectedAttemptId === selected.attemptId && record.approval.actorId === input.actorId) return record;
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_APPROVAL_CONFLICT");
    }
    if (input.expectedRevision !== 0) throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_APPROVAL_REVISION_CONFLICT");
    const approvedAt = input.now ?? new Date().toISOString();
    record.approval = {
      selectedAttemptId: selected.attemptId,
      actorId: input.actorId,
      approvedAt,
      revision: 1,
      disposition: "publication-candidate-only",
    };
    record.status = "approved-candidate";
    record.updatedAt = approvedAt;
    requireEvaluation(record);
    this.writeEvaluation(record);
    return clone(record);
  }

  getEvaluation(input: {
    evaluationId: string;
    expectedWorkspaceId: string;
    expectedProjectId: string;
  }): AdditionalAiInsightEvaluationBatch {
    const row = this.db.prepare(`
      SELECT record_json FROM energyiq_additional_insight_evaluations
      WHERE id = ? AND workspace_id = ? AND project_id = ?
    `).get(input.evaluationId, input.expectedWorkspaceId, input.expectedProjectId);
    if (!isRecord(row)) throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_NOT_FOUND");
    const record = parseEvaluation(row.record_json);
    for (const attempt of record.attempts) {
      if (attempt.status === "completed") this.readAttemptArtifact(record, attempt.attemptId);
    }
    return record;
  }

  reserveTransition(input: {
    transitionId: string;
    idempotencyKey: string;
    requestedBy: string;
    previousEvaluationId: string;
    previousAttemptId: string;
    currentTarget: AdditionalAiInsightEvaluationTarget;
    generationProviderRunId: string;
    generationProviderSessionId: string;
    comparisonProviderRunId: string;
    comparisonProviderSessionId: string;
    now?: string;
  }): {
    created: boolean;
    transitionId: string;
    currentArtifactId: string;
    currentArtifactIdentityHash: string;
    generationProviderRunId: string;
    generationProviderSessionId: string;
    comparisonProviderRunId: string;
    comparisonProviderSessionId: string;
    record?: AdditionalAiInsightTransitionEvaluationRecord;
  } {
    requireTarget(input.currentTarget, this.db);
    requireActor(input.requestedBy, this.db);
    const existing = this.db.prepare(`
      SELECT id, reservation_json, record_json FROM energyiq_additional_insight_transitions
      WHERE workspace_id = ? AND project_id = ? AND idempotency_key = ?
    `).get(input.currentTarget.workspaceId, input.currentTarget.projectId, input.idempotencyKey);
    if (isRecord(existing)) {
      const reservation = parseTransitionReservation(existing.reservation_json);
      if (reservation.previousEvaluationId !== input.previousEvaluationId
        || reservation.previousAttemptId !== input.previousAttemptId
        || JSON.stringify(reservation.currentTarget) !== JSON.stringify(input.currentTarget)) {
        throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_IDEMPOTENCY_CONFLICT");
      }
      return {
        created: false,
        transitionId: reservation.transitionId,
        currentArtifactId: reservation.currentArtifactId,
        currentArtifactIdentityHash: reservation.currentArtifactIdentityHash,
        generationProviderRunId: reservation.generationProviderRunId,
        generationProviderSessionId: reservation.generationProviderSessionId,
        comparisonProviderRunId: reservation.comparisonProviderRunId,
        comparisonProviderSessionId: reservation.comparisonProviderSessionId,
        ...(typeof existing.record_json === "string"
          ? { record: this.getTransition({
            transitionId: reservation.transitionId,
            expectedWorkspaceId: input.currentTarget.workspaceId,
            expectedProjectId: input.currentTarget.projectId,
          }) }
          : {}),
      };
    }
    const previous = this.getEvaluation({
      evaluationId: input.previousEvaluationId,
      expectedWorkspaceId: input.currentTarget.workspaceId,
      expectedProjectId: input.currentTarget.projectId,
    });
    const previousAttempt = previous.attempts.find((attempt): attempt is AdditionalAiInsightEvaluationAttempt => (
      attempt.attemptId === input.previousAttemptId && attempt.status === "completed"
    ));
    if (!previousAttempt) throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_PREVIOUS_ATTEMPT_INVALID");
    if (previous.status !== "passed" && previous.status !== "approved-candidate") {
      throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_PREVIOUS_EVALUATION_NOT_PASSED");
    }
    if (previousAttempt.machineGate.status !== "passed" || previousAttempt.humanReview?.passed !== true) {
      throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_PREVIOUS_ATTEMPT_NOT_PASSED");
    }
    if (previous.status === "approved-candidate"
      && previous.approval?.selectedAttemptId !== previousAttempt.attemptId) {
      throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_PREVIOUS_ATTEMPT_NOT_APPROVED");
    }
    if (!additionalAiInsightEvaluationTargetsCanTransition(previous.target, input.currentTarget)) {
      throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_TARGET_INVALID");
    }
    const currentArtifactIdentityHash = sha256(JSON.stringify({
      contractRevision: "additional-insight-transition-artifact-v1",
      target: input.currentTarget,
      transitionId: input.transitionId,
    }));
    const now = input.now ?? new Date().toISOString();
    const reservation: TransitionReservation = {
      transitionId: input.transitionId,
      idempotencyKey: input.idempotencyKey,
      requestedBy: input.requestedBy,
      previousEvaluationId: input.previousEvaluationId,
      previousAttemptId: input.previousAttemptId,
      previousArtifactId: previousAttempt.artifact.artifactId,
      previousArtifactIdentityHash: previousAttempt.artifact.artifactIdentityHash,
      previousTarget: previous.target,
      currentTarget: clone(input.currentTarget),
      currentArtifactId: `additional-transition-artifact-${currentArtifactIdentityHash.slice(7, 31)}`,
      currentArtifactIdentityHash,
      generationProviderRunId: input.generationProviderRunId,
      generationProviderSessionId: input.generationProviderSessionId,
      comparisonProviderRunId: input.comparisonProviderRunId,
      comparisonProviderSessionId: input.comparisonProviderSessionId,
      createdAt: now,
    };
    this.db.prepare(`
      INSERT INTO energyiq_additional_insight_transitions (
        id, workspace_id, project_id, scope_id, requested_by, idempotency_key, reservation_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.transitionId,
      input.currentTarget.workspaceId,
      input.currentTarget.projectId,
      input.currentTarget.scopeId,
      input.requestedBy,
      input.idempotencyKey,
      JSON.stringify(reservation),
      now,
      now,
    );
    return {
      created: true,
      transitionId: reservation.transitionId,
      currentArtifactId: reservation.currentArtifactId,
      currentArtifactIdentityHash,
      generationProviderRunId: reservation.generationProviderRunId,
      generationProviderSessionId: reservation.generationProviderSessionId,
      comparisonProviderRunId: reservation.comparisonProviderRunId,
      comparisonProviderSessionId: reservation.comparisonProviderSessionId,
    };
  }

  claimTransition(input: {
    transitionId: string;
    expectedWorkspaceId: string;
    expectedProjectId: string;
    now?: string;
    leaseMs?: number;
  }): { acquired: boolean; claimToken?: string } {
    return immediateTransaction(this.db, () => {
      const row = this.db.prepare(`
        SELECT record_json FROM energyiq_additional_insight_transitions
        WHERE id = ? AND workspace_id = ? AND project_id = ?
      `).get(input.transitionId, input.expectedWorkspaceId, input.expectedProjectId);
      if (!isRecord(row)) throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_NOT_FOUND");
      if (typeof row.record_json === "string") return { acquired: false };
      const now = input.now ?? new Date().toISOString();
      const leaseExpiresAt = leaseExpiry(now, input.leaseMs);
      const claimToken = randomUUID();
      const existing = this.db.prepare(`
        SELECT claim_token, lease_expires_at FROM energyiq_additional_insight_transition_claims
        WHERE transition_id = ? AND workspace_id = ? AND project_id = ?
      `).get(input.transitionId, input.expectedWorkspaceId, input.expectedProjectId);
      if (isRecord(existing) && typeof existing.lease_expires_at === "string"
        && existing.lease_expires_at > now) {
        return { acquired: false };
      }
      this.db.prepare(`
        INSERT INTO energyiq_additional_insight_transition_claims (
          transition_id, workspace_id, project_id, claim_token, lease_expires_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(transition_id) DO UPDATE SET
          claim_token = excluded.claim_token,
          lease_expires_at = excluded.lease_expires_at,
          updated_at = excluded.updated_at
      `).run(
        input.transitionId,
        input.expectedWorkspaceId,
        input.expectedProjectId,
        claimToken,
        leaseExpiresAt,
        now,
      );
      return { acquired: true, claimToken };
    });
  }

  completeTransition(input: {
    transitionId: string;
    expectedWorkspaceId: string;
    expectedProjectId: string;
    claimToken: string;
    currentArtifact: AdditionalAiInsightsArtifact;
    outcomes: AdditionalAiInsightTransitionOutcome[];
    completedAt?: string;
  }): AdditionalAiInsightTransitionRecord {
    return immediateTransaction(this.db, () => {
      const row = this.db.prepare(`
      SELECT reservation_json, record_json, current_artifact_json
      FROM energyiq_additional_insight_transitions
      WHERE id = ? AND workspace_id = ? AND project_id = ?
    `).get(input.transitionId, input.expectedWorkspaceId, input.expectedProjectId);
      if (!isRecord(row)) throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_NOT_FOUND");
      requireTransitionClaim(this.db, input.transitionId, input.expectedWorkspaceId, input.expectedProjectId, input.claimToken);
      if (typeof row.record_json === "string") {
        const existing = parseTransition(row.record_json);
        if (existing.status !== "completed") throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_ALREADY_FAILED");
        if (typeof row.current_artifact_json !== "string"
          || sha256(row.current_artifact_json) !== sha256(JSON.stringify(input.currentArtifact))
          || JSON.stringify(existing.outcomes) !== JSON.stringify(input.outcomes)) {
          throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_COMPLETION_CONFLICT");
        }
        return existing;
      }
      const reservation = parseTransitionReservation(row.reservation_json);
      if (input.currentArtifact.runId !== reservation.generationProviderRunId) {
        throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_PROVIDER_RUN_MISMATCH");
      }
      requireArtifactMatchesTarget(input.currentArtifact, reservation.currentTarget, this.db);
      const previousArtifact = this.getAttemptArtifact({
      evaluationId: reservation.previousEvaluationId,
      attemptId: reservation.previousAttemptId,
      expectedWorkspaceId: reservation.previousTarget.workspaceId,
      expectedProjectId: reservation.previousTarget.projectId,
    });
      const record: AdditionalAiInsightTransitionRecord = {
      contractRevision: "energyiq-additional-insight-transition-v1",
      transitionId: reservation.transitionId,
      idempotencyKey: reservation.idempotencyKey,
      requestedBy: reservation.requestedBy,
      status: "completed",
      previousTarget: clone(reservation.previousTarget),
      currentTarget: clone(reservation.currentTarget),
      previousArtifact: transitionArtifactAudit(
        previousArtifact,
        reservation.previousArtifactId,
        reservation.previousArtifactIdentityHash,
      ),
      currentArtifact: transitionArtifactAudit(
        input.currentArtifact,
        reservation.currentArtifactId,
        reservation.currentArtifactIdentityHash,
      ),
      generationProviderRunId: reservation.generationProviderRunId,
      generationProviderSessionId: reservation.generationProviderSessionId,
      comparisonProviderRunId: reservation.comparisonProviderRunId,
      comparisonProviderSessionId: reservation.comparisonProviderSessionId,
      outcomes: clone(input.outcomes),
      createdAt: reservation.createdAt,
      completedAt: input.completedAt ?? new Date().toISOString(),
      };
      if (!additionalAiInsightTransitionIsValid(record)) {
        throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_INVALID");
      }
      this.db.prepare(`
        UPDATE energyiq_additional_insight_transitions
        SET record_json = ?, current_artifact_json = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ? AND project_id = ?
      `).run(
        JSON.stringify(record),
        JSON.stringify(input.currentArtifact),
        record.completedAt,
        record.transitionId,
        record.currentTarget.workspaceId,
        record.currentTarget.projectId,
      );
      return clone(record);
    });
  }

  failTransition(input: {
    transitionId: string;
    expectedWorkspaceId: string;
    expectedProjectId: string;
    claimToken: string;
    errorCode: string;
    failureStage: "generation" | "validation" | "comparison";
    completedAt?: string;
  }): AdditionalAiInsightFailedTransitionRecord {
    return immediateTransaction(this.db, () => {
      const row = this.db.prepare(`
      SELECT reservation_json, record_json FROM energyiq_additional_insight_transitions
      WHERE id = ? AND workspace_id = ? AND project_id = ?
    `).get(input.transitionId, input.expectedWorkspaceId, input.expectedProjectId);
      if (!isRecord(row)) throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_NOT_FOUND");
      requireTransitionClaim(this.db, input.transitionId, input.expectedWorkspaceId, input.expectedProjectId, input.claimToken);
      if (typeof row.record_json === "string") {
        const existing = parseTransition(row.record_json);
        if (existing.status !== "failed") throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_ALREADY_COMPLETED");
        if (existing.errorCode !== boundedCode(input.errorCode)
          || existing.failureStage !== input.failureStage) {
          throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_FAILURE_CONFLICT");
        }
        return existing;
      }
      const reservation = parseTransitionReservation(row.reservation_json);
      const previousArtifact = this.getAttemptArtifact({
      evaluationId: reservation.previousEvaluationId,
      attemptId: reservation.previousAttemptId,
      expectedWorkspaceId: reservation.previousTarget.workspaceId,
      expectedProjectId: reservation.previousTarget.projectId,
    });
      const record: AdditionalAiInsightFailedTransitionRecord = {
      contractRevision: "energyiq-additional-insight-transition-v1",
      transitionId: reservation.transitionId,
      idempotencyKey: reservation.idempotencyKey,
      requestedBy: reservation.requestedBy,
      status: "failed",
      previousTarget: clone(reservation.previousTarget),
      currentTarget: clone(reservation.currentTarget),
      previousArtifact: transitionArtifactAudit(
        previousArtifact,
        reservation.previousArtifactId,
        reservation.previousArtifactIdentityHash,
      ),
      generationProviderRunId: reservation.generationProviderRunId,
      generationProviderSessionId: reservation.generationProviderSessionId,
      comparisonProviderRunId: reservation.comparisonProviderRunId,
      comparisonProviderSessionId: reservation.comparisonProviderSessionId,
      errorCode: boundedCode(input.errorCode),
      failureStage: input.failureStage,
      createdAt: reservation.createdAt,
      completedAt: input.completedAt ?? new Date().toISOString(),
      };
      if (!additionalAiInsightTransitionRecordIsValid(record)) {
        throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_RECORD_INVALID");
      }
      this.db.prepare(`
        UPDATE energyiq_additional_insight_transitions
        SET record_json = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ? AND project_id = ?
      `).run(
        JSON.stringify(record),
        record.completedAt,
        record.transitionId,
        record.currentTarget.workspaceId,
        record.currentTarget.projectId,
      );
      return clone(record);
    });
  }

  getTransition(input: {
    transitionId: string;
    expectedWorkspaceId: string;
    expectedProjectId: string;
  }): AdditionalAiInsightTransitionEvaluationRecord {
    const row = this.db.prepare(`
      SELECT reservation_json, record_json, current_artifact_json FROM energyiq_additional_insight_transitions
      WHERE id = ? AND workspace_id = ? AND project_id = ?
    `).get(input.transitionId, input.expectedWorkspaceId, input.expectedProjectId);
    if (!isRecord(row)) {
      throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_NOT_FOUND");
    }
    if (typeof row.record_json === "string") {
      const record = parseTransition(row.record_json);
      const previousArtifact = this.getAttemptArtifact({
        evaluationId: parseTransitionReservation(row.reservation_json).previousEvaluationId,
        attemptId: parseTransitionReservation(row.reservation_json).previousAttemptId,
        expectedWorkspaceId: record.previousTarget.workspaceId,
        expectedProjectId: record.previousTarget.projectId,
      });
      const expectedPreviousAudit = transitionArtifactAudit(
        previousArtifact,
        record.previousArtifact.artifactId,
        record.previousArtifact.artifactIdentityHash,
      );
      if (JSON.stringify(expectedPreviousAudit) !== JSON.stringify(record.previousArtifact)) {
        throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_PREVIOUS_ARTIFACT_INVALID");
      }
      if (record.status === "completed") {
        if (typeof row.current_artifact_json !== "string") {
          throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_CURRENT_ARTIFACT_INVALID");
        }
        let parsedCurrent: unknown;
        try { parsedCurrent = JSON.parse(row.current_artifact_json); } catch {
          throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_CURRENT_ARTIFACT_INVALID");
        }
        const currentArtifact = parsedCurrent as AdditionalAiInsightsArtifact;
        requireArtifactMatchesTarget(currentArtifact, record.currentTarget, this.db);
        if (currentArtifact.runId !== record.generationProviderRunId
          || JSON.stringify(transitionArtifactAudit(
            currentArtifact,
            record.currentArtifact.artifactId,
            record.currentArtifact.artifactIdentityHash,
          )) !== JSON.stringify(record.currentArtifact)) {
          throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_CURRENT_ARTIFACT_INVALID");
        }
      }
      return record;
    }
    const reservation = parseTransitionReservation(row.reservation_json);
    const previousArtifact = this.getAttemptArtifact({
      evaluationId: reservation.previousEvaluationId,
      attemptId: reservation.previousAttemptId,
      expectedWorkspaceId: reservation.previousTarget.workspaceId,
      expectedProjectId: reservation.previousTarget.projectId,
    });
    const running: AdditionalAiInsightTransitionEvaluationRecord = {
      contractRevision: "energyiq-additional-insight-transition-v1",
      transitionId: reservation.transitionId,
      idempotencyKey: reservation.idempotencyKey,
      requestedBy: reservation.requestedBy,
      status: "running",
      previousTarget: clone(reservation.previousTarget),
      currentTarget: clone(reservation.currentTarget),
      previousArtifact: transitionArtifactAudit(
        previousArtifact,
        reservation.previousArtifactId,
        reservation.previousArtifactIdentityHash,
      ),
      generationProviderRunId: reservation.generationProviderRunId,
      generationProviderSessionId: reservation.generationProviderSessionId,
      comparisonProviderRunId: reservation.comparisonProviderRunId,
      comparisonProviderSessionId: reservation.comparisonProviderSessionId,
      createdAt: reservation.createdAt,
    };
    if (!additionalAiInsightTransitionRecordIsValid(running)) {
      throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_RECORD_INVALID");
    }
    return running;
  }

  getAttemptArtifact(input: {
    evaluationId: string;
    attemptId: string;
    expectedWorkspaceId: string;
    expectedProjectId: string;
  }): AdditionalAiInsightsArtifact {
    const record = this.getEvaluation(input);
    return this.readAttemptArtifact(record, input.attemptId);
  }

  private readAttemptArtifact(
    record: AdditionalAiInsightEvaluationBatch,
    attemptId: string,
  ): AdditionalAiInsightsArtifact {
    const attempt = record.attempts.find((candidate): candidate is AdditionalAiInsightEvaluationAttempt => (
      candidate.attemptId === attemptId && candidate.status === "completed"
    ));
    if (!attempt) throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ARTIFACT_NOT_FOUND");
    const row = this.db.prepare(`
      SELECT result_json FROM energyiq_additional_insight_evaluation_artifacts
      WHERE evaluation_id = ? AND attempt_id = ? AND workspace_id = ? AND project_id = ?
    `).get(record.evaluationId, attemptId, record.target.workspaceId, record.target.projectId);
    if (!isRecord(row) || typeof row.result_json !== "string") {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ARTIFACT_NOT_FOUND");
    }
    if (sha256(row.result_json) !== attempt.artifact.resultHash) {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ARTIFACT_HASH_MISMATCH");
    }
    let value: unknown;
    try {
      value = JSON.parse(row.result_json);
    } catch {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ARTIFACT_INVALID");
    }
    if (!isRecord(value) || value.artifactKind !== "autonomous-insights") {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ARTIFACT_INVALID");
    }
    const artifact = value as AdditionalAiInsightsArtifact;
    requireArtifactMatchesTarget(artifact, record.target, this.db);
    if (artifact.runId !== attempt.providerRunId || artifact.status !== attempt.artifact.resultStatus) {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ARTIFACT_IDENTITY_MISMATCH");
    }
    return artifact;
  }

  private writeEvaluation(record: AdditionalAiInsightEvaluationBatch): void {
    const result = this.db.prepare(`
      UPDATE energyiq_additional_insight_evaluations
      SET record_json = ?, updated_at = ?
      WHERE id = ? AND workspace_id = ? AND project_id = ?
    `).run(
      JSON.stringify(record),
      record.updatedAt,
      record.evaluationId,
      record.target.workspaceId,
      record.target.projectId,
    );
    if (result.changes !== 1) throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_NOT_FOUND");
  }
}

const requireTarget = (target: AdditionalAiInsightEvaluationTarget, db: DatabaseSync): void => {
  const project = db.prepare(`
    SELECT root_scope_id FROM energyiq_projects WHERE id = ? AND workspace_id = ?
  `).get(target.projectId, target.workspaceId);
  if (!isRecord(project)
    || !nonEmpty(project.root_scope_id)
    || (target.scopeId !== project.root_scope_id
      && !isRecord(db.prepare(`
        SELECT id FROM energyiq_project_nodes WHERE project_id = ? AND id = ?
      `).get(target.projectId, target.scopeId)))) {
    throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_TARGET_NOT_FOUND");
  }
  const methodSet = resolveCurrentAdditionalAiInsightMethodSet(
    target.workspaceId,
    new EnergyIqInsightMethodGovernanceStore(db).listPublishedWorkspaceMethodResources({
      workspaceId: target.workspaceId,
    }),
  );
  const canonical = canonicalInsightMethodSetJson(methodSet.methods);
  if (!canonical
    || target.methodSetId !== methodSet.id
    || target.methodSetRevision !== methodSet.revision
    || target.methodSetFingerprint !== sha256(canonical)
    || target.artifactIdentityRevision !== "additional-insights-v3"
    || target.outputContractRevision !== "energyiq-additional-ai-insights-v2"
    || target.validatorRevision !== "additional-insights-acceptance-v3"
    || target.workflowRevision !== "additional-insights-discover-accept-publish-v3"
    || target.promptRevision !== "additional-insights-discovery-v3"
    || target.capabilityRevision !== "scoped-read-only-v1"
    || target.publicationRevision !== "additional-insights-v2"
    || target.canvasRevision !== "energyiq-insight-canvas-v2") {
    throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_TARGET_INVALID");
  }
};

const requireActor = (actorId: string, db: DatabaseSync): void => {
  if (!isRecord(db.prepare("SELECT id FROM users WHERE id = ?").get(actorId))) {
    throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ACTOR_NOT_FOUND");
  }
};

const requireArtifactMatchesTarget = (
  artifact: AdditionalAiInsightsArtifact,
  target: AdditionalAiInsightEvaluationTarget,
  db: DatabaseSync,
): void => {
  requireTarget(target, db);
  const methodSet = resolveCurrentAdditionalAiInsightMethodSet(
    target.workspaceId,
    new EnergyIqInsightMethodGovernanceStore(db).listPublishedWorkspaceMethodResources({ workspaceId: target.workspaceId }),
  );
  if (!additionalAiInsightsArtifactIsValid({
    value: artifact,
    expectedMethods: methodSet.methods,
    expected: {
      workspaceId: target.workspaceId,
      projectId: target.projectId,
      scopeId: target.scopeId,
      dataSnapshotId: target.dataSnapshotId,
      projectReleaseId: target.projectReleaseId,
      analysisPeriod: target.analysisPeriod,
      modelProfileId: target.modelProfileId,
      modelProfileRevision: target.modelProfileRevision,
      methodSetId: target.methodSetId,
      methodSetRevision: target.methodSetRevision,
      methodSetFingerprint: target.methodSetFingerprint,
      outputContractRevision: target.outputContractRevision,
      capabilityRevision: target.capabilityRevision,
      publicationRevision: target.publicationRevision,
      canvasRevision: target.canvasRevision,
    },
  })) throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ARTIFACT_INVALID");
};

const transitionArtifactAudit = (
  artifact: AdditionalAiInsightsArtifact,
  artifactId: string,
  artifactIdentityHash: string,
): AdditionalAiInsightTransitionArtifactAudit => {
  const findingEvidence = Object.fromEntries(artifact.findings.map(({ id, evidenceRefs }) => [id, [...evidenceRefs]]));
  return {
    artifactId,
    artifactIdentityHash,
    resultHash: sha256(JSON.stringify(artifact)),
    findingEvidence,
    evidenceRefs: uniqueStrings(artifact.findings.flatMap(({ evidenceRefs }) => evidenceRefs)),
  };
};

const parseEvaluation = (value: unknown): AdditionalAiInsightEvaluationBatch => {
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  if (!additionalAiInsightEvaluationBatchIsValid(parsed)) {
    throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_RECORD_INVALID");
  }
  return clone(parsed);
};

const parseTransition = (value: unknown): AdditionalAiInsightTransitionEvaluationRecord => {
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  if (!additionalAiInsightTransitionRecordIsValid(parsed)) {
    throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_RECORD_INVALID");
  }
  return clone(parsed);
};

const parseTransitionReservation = (value: unknown): TransitionReservation => {
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  if (!isRecord(parsed)
    || !nonEmpty(parsed.transitionId)
    || !nonEmpty(parsed.previousEvaluationId)
    || !nonEmpty(parsed.previousAttemptId)
    || !nonEmpty(parsed.currentArtifactId)
    || !hashValid(parsed.currentArtifactIdentityHash)) {
    throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_RESERVATION_INVALID");
  }
  return parsed as TransitionReservation;
};

const requireEvaluation = (record: AdditionalAiInsightEvaluationBatch): void => {
  if (!additionalAiInsightEvaluationBatchIsValid(record)) {
    throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_RECORD_INVALID");
  }
};

const attemptReservationIsValid = (value: AttemptReservation): boolean => nonEmpty(value.attemptId)
  && Number.isSafeInteger(value.ordinal)
  && value.ordinal > 0
  && nonEmpty(value.providerRunId)
  && nonEmpty(value.providerSessionId);

const evaluationArtifactIdentity = (
  target: AdditionalAiInsightEvaluationTarget,
  evaluationId: string,
  attemptId: string,
) => {
  const artifactIdentityHash = sha256(JSON.stringify({
    contractRevision: "additional-insight-evaluation-artifact-v1",
    target,
    evaluationId,
    attemptId,
  }));
  return {
    artifactId: `additional-evaluation-artifact-${artifactIdentityHash.slice(7, 31)}`,
    artifactIdentityHash,
    artifactIdentityRevision: "additional-insight-evaluation-artifact-v1" as const,
  };
};

const leaseExpiry = (now: string, leaseMs = 5 * 60_000): string => {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)
    || !Number.isSafeInteger(leaseMs)
    || leaseMs < 1_000
    || leaseMs > 30 * 60_000) {
    throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_CLAIM_LEASE_INVALID");
  }
  return new Date(nowMs + leaseMs).toISOString();
};

const requireEvaluationClaim = (
  db: DatabaseSync,
  record: AdditionalAiInsightEvaluationBatch,
  attemptId: string,
  claimToken: string,
): void => {
  const claim = db.prepare(`
    SELECT claim_token FROM energyiq_additional_insight_evaluation_claims
    WHERE evaluation_id = ? AND attempt_id = ? AND workspace_id = ? AND project_id = ?
  `).get(record.evaluationId, attemptId, record.target.workspaceId, record.target.projectId);
  if (!isRecord(claim) || !nonEmpty(claimToken) || claim.claim_token !== claimToken) {
    throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_CLAIM_CONFLICT");
  }
};

const requireTransitionClaim = (
  db: DatabaseSync,
  transitionId: string,
  workspaceId: string,
  projectId: string,
  claimToken: string,
): void => {
  const claim = db.prepare(`
    SELECT claim_token FROM energyiq_additional_insight_transition_claims
    WHERE transition_id = ? AND workspace_id = ? AND project_id = ?
  `).get(transitionId, workspaceId, projectId);
  if (!isRecord(claim) || !nonEmpty(claimToken) || claim.claim_token !== claimToken) {
    throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_CLAIM_CONFLICT");
  }
};

const immediateTransaction = <T>(db: DatabaseSync, action: () => T): T => {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};

const requireScores = (scores: AdditionalAiInsightHumanScores): void => {
  if (Object.values(scores).length !== 6
    || Object.values(scores).some((score) => !Number.isSafeInteger(score) || score < 1 || score > 5)) {
    throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_REVIEW_SCORES_INVALID");
  }
};

const requireContentUsefulness = (
  value: AdditionalAiInsightEvaluationHumanReview["contentUsefulness"],
  entry: AdditionalAiInsightEvaluationBatch["reviewPack"]["entries"][number],
): void => {
  const summaryMatches = entry.summary === undefined ? value.summary.applicable === false : value.summary.applicable === true;
  const expectedTokens = entry.findings.map(({ reviewFindingToken }) => reviewFindingToken);
  const actualTokens = value.insights.map(({ reviewFindingToken }) => reviewFindingToken);
  if (!summaryMatches
    || !sameStrings(actualTokens, expectedTokens)
    || value.insights.some(({ score }) => !Number.isSafeInteger(score) || score < 1 || score > 5)
    || (value.summary.applicable && (!Number.isSafeInteger(value.summary.score) || value.summary.score < 1 || value.summary.score > 5))) {
    throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_CONTENT_USEFULNESS_INVALID");
  }
};

const blindSortKey = (evaluationId: string, attemptId: string): string => sha256(`${evaluationId}:${attemptId}:sort`);
const blindToken = (evaluationId: string, attemptId: string): string => `blind-${sha256(`${evaluationId}:${attemptId}:token`).slice(7, 31)}`;
const blindFindingToken = (evaluationId: string, attemptId: string, findingId: string): string => (
  `blind-finding-${sha256(`${evaluationId}:${attemptId}:${findingId}:finding`).slice(7, 31)}`
);
const sha256 = (value: string): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const hashValid = (value: unknown): boolean => typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
const nonEmpty = (value: unknown): value is string => typeof value === "string" && /\S/u.test(value);
const requireNonEmpty = (value: unknown, code: string): void => { if (!nonEmpty(value)) throw new Error(code); };
const boundedCode = (value: string): string => nonEmpty(value) ? value.trim().slice(0, 160) : "UNKNOWN";
const unique = (values: readonly unknown[]): boolean => new Set(values).size === values.length;
const uniqueStrings = (values: readonly string[]): string[] => [...new Set(values)];
const sameNumbers = (left: readonly number[], right: readonly number[]): boolean => left.length === right.length
  && left.every((entry) => right.includes(entry));
const sameStrings = (left: readonly string[], right: readonly string[]): boolean => left.length === right.length
  && left.every((entry) => right.includes(entry));
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object"
  && value !== null
  && !Array.isArray(value);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
