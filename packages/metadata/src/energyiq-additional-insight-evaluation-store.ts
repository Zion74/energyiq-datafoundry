import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import {
  additionalAiInsightEvaluationBatchIsValid,
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
      idempotency_key TEXT NOT NULL,
      record_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(workspace_id, project_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS idx_energyiq_additional_evaluations_target
      ON energyiq_additional_insight_evaluations(workspace_id, project_id, scope_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS energyiq_additional_insight_evaluation_artifacts (
      evaluation_id TEXT NOT NULL,
      attempt_id TEXT NOT NULL,
      result_json TEXT NOT NULL,
      PRIMARY KEY(evaluation_id, attempt_id),
      FOREIGN KEY(evaluation_id) REFERENCES energyiq_additional_insight_evaluations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS energyiq_additional_insight_transitions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      reservation_json TEXT NOT NULL,
      record_json TEXT,
      current_artifact_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(workspace_id, project_id, idempotency_key)
    );
  `);
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
        id, workspace_id, project_id, scope_id, idempotency_key, record_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.evaluationId,
      record.target.workspaceId,
      record.target.projectId,
      record.target.scopeId,
      record.idempotencyKey,
      JSON.stringify(record),
      now,
      now,
    );
    return { created: true, record };
  }

  completeAttempt(input: {
    evaluationId: string;
    expectedWorkspaceId: string;
    expectedProjectId: string;
    attemptId: string;
    artifact: AdditionalAiInsightsArtifact;
    machineGate: AdditionalAiInsightEvaluationAttempt["machineGate"];
    completedAt?: string;
  }): AdditionalAiInsightEvaluationBatch {
    const record = this.getEvaluation({
      evaluationId: input.evaluationId,
      expectedWorkspaceId: input.expectedWorkspaceId,
      expectedProjectId: input.expectedProjectId,
    });
    const index = record.attempts.findIndex(({ attemptId }) => attemptId === input.attemptId);
    const reserved = record.attempts[index];
    if (!reserved) throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ATTEMPT_NOT_FOUND");
    if (reserved.status === "completed") return record;
    if (reserved.status !== "running") throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ATTEMPT_TERMINAL");
    if (input.artifact.runId !== reserved.providerRunId) {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_PROVIDER_RUN_MISMATCH");
    }
    requireArtifactMatchesTarget(input.artifact, record.target, this.db);
    const resultJson = JSON.stringify(input.artifact);
    const artifactIdentityHash = sha256(JSON.stringify({
      contractRevision: "additional-insight-evaluation-artifact-v1",
      target: record.target,
      evaluationId: record.evaluationId,
      attemptId: reserved.attemptId,
    }));
    const artifactId = `additional-evaluation-artifact-${artifactIdentityHash.slice(7, 31)}`;
    const evidenceRefs = uniqueStrings(input.artifact.findings.flatMap(({ evidenceRefs }) => evidenceRefs));
    const completed: AdditionalAiInsightEvaluationAttempt = {
      attemptId: reserved.attemptId,
      ordinal: reserved.ordinal,
      status: "completed",
      providerRunId: reserved.providerRunId,
      providerSessionId: reserved.providerSessionId,
      artifact: {
        artifactId,
        artifactIdentityHash,
        artifactIdentityRevision: "additional-insight-evaluation-artifact-v1",
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
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        INSERT INTO energyiq_additional_insight_evaluation_artifacts (evaluation_id, attempt_id, result_json)
        VALUES (?, ?, ?)
      `).run(record.evaluationId, completed.attemptId, resultJson);
      this.writeEvaluation(record);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return clone(record);
  }

  failAttempt(input: {
    evaluationId: string;
    expectedWorkspaceId: string;
    expectedProjectId: string;
    attemptId: string;
    errorCode: string;
    failureStage?: "provider" | "structured-output" | "machine-gate";
    completedAt?: string;
  }): AdditionalAiInsightEvaluationBatch {
    const record = this.getEvaluation(input);
    const index = record.attempts.findIndex(({ attemptId }) => attemptId === input.attemptId);
    const reserved = record.attempts[index];
    if (!reserved) throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ATTEMPT_NOT_FOUND");
    if (reserved.status === "failed") return record;
    if (reserved.status !== "running") throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ATTEMPT_TERMINAL");
    const completedAt = input.completedAt ?? new Date().toISOString();
    record.attempts[index] = {
      attemptId: reserved.attemptId,
      ordinal: reserved.ordinal,
      status: "failed",
      providerRunId: reserved.providerRunId,
      providerSessionId: reserved.providerSessionId,
      errorCode: boundedCode(input.errorCode),
      failureStage: input.failureStage ?? "provider",
      startedAt: reserved.startedAt,
      completedAt,
    };
    record.updatedAt = completedAt;
    requireEvaluation(record);
    this.writeEvaluation(record);
    return clone(record);
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
        const artifact = this.getAttemptArtifact(record.evaluationId, attempt.attemptId);
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
      passed: Object.values(input.scores).every((score) => score >= 3),
      revision: currentRevision + 1,
    };
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
      SELECT workspace_id, project_id, record_json
      FROM energyiq_additional_insight_evaluations WHERE id = ?
    `).get(input.evaluationId);
    if (!isRecord(row)) throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_NOT_FOUND");
    if (row.workspace_id !== input.expectedWorkspaceId || row.project_id !== input.expectedProjectId) {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_TENANT_MISMATCH");
    }
    return parseEvaluation(row.record_json);
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
          ? { record: parseTransition(existing.record_json) }
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
    if (!transitionTargetPairIsValid(previous.target, input.currentTarget)) {
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
        id, workspace_id, project_id, idempotency_key, reservation_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.transitionId,
      input.currentTarget.workspaceId,
      input.currentTarget.projectId,
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

  completeTransition(input: {
    transitionId: string;
    expectedWorkspaceId: string;
    expectedProjectId: string;
    currentArtifact: AdditionalAiInsightsArtifact;
    outcomes: AdditionalAiInsightTransitionOutcome[];
    completedAt?: string;
  }): AdditionalAiInsightTransitionRecord {
    const row = this.db.prepare(`
      SELECT workspace_id, project_id, reservation_json, record_json
      FROM energyiq_additional_insight_transitions WHERE id = ?
    `).get(input.transitionId);
    if (!isRecord(row)) throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_NOT_FOUND");
    if (row.workspace_id !== input.expectedWorkspaceId || row.project_id !== input.expectedProjectId) {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_TENANT_MISMATCH");
    }
    if (typeof row.record_json === "string") {
      const existing = parseTransition(row.record_json);
      if (existing.status !== "completed") throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_ALREADY_FAILED");
      return existing;
    }
    const reservation = parseTransitionReservation(row.reservation_json);
    if (input.currentArtifact.runId !== reservation.generationProviderRunId) {
      throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_PROVIDER_RUN_MISMATCH");
    }
    requireArtifactMatchesTarget(input.currentArtifact, reservation.currentTarget, this.db);
    const previousArtifact = this.getAttemptArtifact(
      reservation.previousEvaluationId,
      reservation.previousAttemptId,
    );
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
      SET record_json = ?, current_artifact_json = ?, updated_at = ? WHERE id = ?
    `).run(JSON.stringify(record), JSON.stringify(input.currentArtifact), record.completedAt, record.transitionId);
    return clone(record);
  }

  failTransition(input: {
    transitionId: string;
    expectedWorkspaceId: string;
    expectedProjectId: string;
    errorCode: string;
    failureStage: "generation" | "validation" | "comparison";
    completedAt?: string;
  }): AdditionalAiInsightFailedTransitionRecord {
    const row = this.db.prepare(`
      SELECT workspace_id, project_id, reservation_json, record_json
      FROM energyiq_additional_insight_transitions WHERE id = ?
    `).get(input.transitionId);
    if (!isRecord(row)) throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_NOT_FOUND");
    if (row.workspace_id !== input.expectedWorkspaceId || row.project_id !== input.expectedProjectId) {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_TENANT_MISMATCH");
    }
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
    const previousArtifact = this.getAttemptArtifact(
      reservation.previousEvaluationId,
      reservation.previousAttemptId,
    );
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
      SET record_json = ?, updated_at = ? WHERE id = ?
    `).run(JSON.stringify(record), record.completedAt, record.transitionId);
    return clone(record);
  }

  getTransition(input: {
    transitionId: string;
    expectedWorkspaceId: string;
    expectedProjectId: string;
  }): AdditionalAiInsightTransitionEvaluationRecord {
    const row = this.db.prepare(`
      SELECT workspace_id, project_id, record_json FROM energyiq_additional_insight_transitions WHERE id = ?
    `).get(input.transitionId);
    if (!isRecord(row) || typeof row.record_json !== "string") {
      throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_NOT_FOUND");
    }
    if (row.workspace_id !== input.expectedWorkspaceId || row.project_id !== input.expectedProjectId) {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_TENANT_MISMATCH");
    }
    return parseTransition(row.record_json);
  }

  getAttemptArtifact(evaluationId: string, attemptId: string): AdditionalAiInsightsArtifact {
    const row = this.db.prepare(`
      SELECT result_json FROM energyiq_additional_insight_evaluation_artifacts
      WHERE evaluation_id = ? AND attempt_id = ?
    `).get(evaluationId, attemptId);
    if (!isRecord(row) || typeof row.result_json !== "string") {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ARTIFACT_NOT_FOUND");
    }
    const value: unknown = JSON.parse(row.result_json);
    if (!isRecord(value) || value.artifactKind !== "autonomous-insights") {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ARTIFACT_INVALID");
    }
    return value as AdditionalAiInsightsArtifact;
  }

  private writeEvaluation(record: AdditionalAiInsightEvaluationBatch): void {
    this.db.prepare(`
      UPDATE energyiq_additional_insight_evaluations
      SET record_json = ?, updated_at = ? WHERE id = ?
    `).run(JSON.stringify(record), record.updatedAt, record.evaluationId);
  }
}

const requireTarget = (target: AdditionalAiInsightEvaluationTarget, db: DatabaseSync): void => {
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
    findingEvidence,
    evidenceRefs: uniqueStrings(artifact.findings.flatMap(({ evidenceRefs }) => evidenceRefs)),
  };
};

const transitionTargetPairIsValid = (
  previous: AdditionalAiInsightEvaluationTarget,
  current: AdditionalAiInsightEvaluationTarget,
): boolean => previous.workspaceId === current.workspaceId
  && previous.projectId === current.projectId
  && previous.scopeId === current.scopeId
  && previous.resource === current.resource
  && previous.modelProfileId === current.modelProfileId
  && previous.modelProfileRevision === current.modelProfileRevision
  && previous.artifactIdentityRevision === current.artifactIdentityRevision
  && previous.outputContractRevision === current.outputContractRevision
  && previous.validatorRevision === current.validatorRevision
  && previous.workflowRevision === current.workflowRevision
  && previous.promptRevision === current.promptRevision
  && previous.capabilityRevision === current.capabilityRevision
  && previous.publicationRevision === current.publicationRevision
  && previous.canvasRevision === current.canvasRevision
  && previous.methodSetId === current.methodSetId
  && previous.methodSetRevision === current.methodSetRevision
  && previous.methodSetFingerprint === current.methodSetFingerprint
  && previous.dataSnapshotId !== current.dataSnapshotId;

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
