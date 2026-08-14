import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ADDITIONAL_AI_INSIGHT_EVALUATION_MACHINE_CHECKS,
  ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1,
  canonicalInsightMethodSetJson,
  resolveCurrentAdditionalAiInsightMethodSet,
  type AdditionalAiInsightEvaluationTarget,
  type AdditionalAiInsightHumanScores,
  type AdditionalAiInsightsArtifact,
} from "@datafoundry/contracts";

import { createMetadataStore } from "./index.js";

describe("EnergyIqAdditionalInsightEvaluationStore", () => {
  it("reserves one pass@3 batch, persists three independent attempts, and recovers a blind pack", () => {
    const harness = createHarness();
    try {
      const target = evaluationTarget("snapshot-a", "release-a");
      const reserved = harness.store.reserveEvaluation({
        evaluationId: "evaluation-1",
        idempotencyKey: "evaluation-key-1",
        requestedBy: "admin-1",
        target,
        attempts: attemptReservations(),
        now: "2026-08-14T00:00:00.000Z",
      });
      expect(reserved.created).toBe(true);
      expect(reserved.record.attempts.map((attempt) => attempt.providerRunId)).toEqual([
        "provider-run-1", "provider-run-2", "provider-run-3",
      ]);

      const replay = harness.store.reserveEvaluation({
        evaluationId: "evaluation-other",
        idempotencyKey: "evaluation-key-1",
        requestedBy: "admin-1",
        target,
        attempts: attemptReservations("other"),
        now: "2026-08-14T00:00:01.000Z",
      });
      expect(replay).toMatchObject({ created: false, record: { evaluationId: "evaluation-1" } });

      for (const driftedTarget of [
        { ...target, dataSnapshotId: "snapshot-drift" },
        { ...target, projectReleaseId: "release-drift" },
        { ...target, analysisPeriod: { ...target.analysisPeriod, to: "2026-07-01T00:00:00.000Z" } },
        { ...target, modelProfileRevision: target.modelProfileRevision + 1 },
      ]) {
        expect(() => harness.store.reserveEvaluation({
          evaluationId: "evaluation-drift",
          idempotencyKey: "evaluation-key-1",
          requestedBy: "admin-1",
          target: driftedTarget,
          attempts: attemptReservations("drift"),
        })).toThrow(/ENERGYIQ_ADDITIONAL_EVALUATION_IDEMPOTENCY_CONFLICT/);
      }

      for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
        harness.store.completeAttempt({
          evaluationId: "evaluation-1",
          expectedWorkspaceId: "workspace-1",
          expectedProjectId: "project-1",
          attemptId: `attempt-${ordinal}`,
          artifact: artifact(target, `provider-run-${ordinal}`, `evidence:a:${ordinal}`, `finding-${ordinal}`),
          machineGate: passingMachineGate(),
          completedAt: `2026-08-14T00:0${ordinal}:00.000Z`,
        });
      }
      const finalized = harness.store.finalizeEvaluation({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        now: "2026-08-14T00:10:00.000Z",
      });
      expect(finalized.status).toBe("awaiting-human-review");
      expect(finalized.reviewPack.entries).toHaveLength(3);
      expect(finalized.reviewPack.entries).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ attemptId: expect.anything(), providerRunId: expect.anything() }),
      ]));
      expect(finalized.reviewAudit.map(({ attemptId }) => attemptId).sort()).toEqual([
        "attempt-1", "attempt-2", "attempt-3",
      ]);

      harness.reopen();
      expect(harness.store.getEvaluation({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      })).toEqual(finalized);
    } finally {
      harness.close();
    }
  });

  it("keeps human review separate, applies idempotent revision semantics, and only approves a candidate", () => {
    const harness = completedHarness();
    try {
      const batch = harness.store.getEvaluation({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      });
      const tokens = batch.reviewPack.entries.map(({ reviewToken }) => reviewToken);
      const first = harness.store.recordHumanReview({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        reviewToken: tokens[0]!,
        actorId: "reviewer-1",
        scores: PASSING_SCORES,
        contentUsefulness: contentUsefulness(batch, tokens[0]!),
        expectedRevision: 0,
        now: "2026-08-14T01:00:00.000Z",
      });
      const replay = harness.store.recordHumanReview({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        reviewToken: tokens[0]!,
        actorId: "reviewer-1",
        scores: PASSING_SCORES,
        contentUsefulness: contentUsefulness(batch, tokens[0]!),
        expectedRevision: 0,
        now: "2026-08-14T01:00:01.000Z",
      });
      expect(replay.attempts).toEqual(first.attempts);

      expect(() => harness.store.recordHumanReview({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        reviewToken: tokens[0]!,
        actorId: "reviewer-1",
        scores: { ...PASSING_SCORES, userValue: 1 },
        contentUsefulness: contentUsefulness(batch, tokens[0]!),
        expectedRevision: 0,
      })).toThrow(/ENERGYIQ_ADDITIONAL_EVALUATION_REVIEW_REVISION_CONFLICT/);

      for (const token of tokens.slice(1)) {
        harness.store.recordHumanReview({
          evaluationId: "evaluation-1",
          expectedWorkspaceId: "workspace-1",
          expectedProjectId: "project-1",
          reviewToken: token,
          actorId: "reviewer-1",
          scores: token === tokens[1] ? PASSING_SCORES : { ...PASSING_SCORES, userValue: 2 },
          contentUsefulness: contentUsefulness(batch, token),
          expectedRevision: 0,
        });
      }
      const reviewed = harness.store.getEvaluation({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      });
      expect(reviewed.status).toBe("passed");

      const approved = harness.store.approveEvaluationCandidate({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        reviewToken: tokens[0]!,
        actorId: "admin-1",
        expectedRevision: 0,
        now: "2026-08-14T02:00:00.000Z",
      });
      expect(approved).toMatchObject({
        status: "approved-candidate",
        approval: { disposition: "publication-candidate-only", actorId: "admin-1" },
      });
    } finally {
      harness.close();
    }
  });

  it("persists localized attempt failures and an evidence-bound A-to-B transition without cross-Snapshot refs", () => {
    const harness = createHarness();
    try {
      reserveAndComplete(harness, { failOrdinal: 3 });
      const recovered = harness.store.getEvaluation({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      });
      expect(recovered.attempts[2]).toMatchObject({ status: "failed", errorCode: "PROVIDER_FAILED" });
      expect(recovered.reviewPack.entries).toHaveLength(2);
      for (const entry of recovered.reviewPack.entries) {
        harness.store.recordHumanReview({
          evaluationId: "evaluation-1",
          expectedWorkspaceId: "workspace-1",
          expectedProjectId: "project-1",
          reviewToken: entry.reviewToken,
          actorId: "reviewer-1",
          scores: PASSING_SCORES,
          contentUsefulness: contentUsefulness(recovered, entry.reviewToken),
          expectedRevision: 0,
        });
      }
      expect(harness.store.getEvaluation({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      }).status).toBe("passed");

      const previousAttempt = recovered.attempts[0]!;
      if (previousAttempt.status !== "completed") throw new Error("test fixture expected completed attempt");
      const currentTarget = evaluationTarget("snapshot-b", "release-b");
      const reservation = harness.store.reserveTransition({
        transitionId: "transition-1",
        idempotencyKey: "transition-key-1",
        requestedBy: "admin-1",
        previousEvaluationId: "evaluation-1",
        previousAttemptId: previousAttempt.attemptId,
        currentTarget,
        generationProviderRunId: "transition-generation-run-1",
        generationProviderSessionId: "transition-generation-session-1",
        comparisonProviderRunId: "transition-comparison-run-1",
        comparisonProviderSessionId: "transition-comparison-session-1",
        now: "2026-08-14T03:00:00.000Z",
      });
      expect(reservation.created).toBe(true);
      const currentArtifact = artifact(currentTarget, "transition-generation-run-1", "evidence:b:1", "finding-b");
      const completed = harness.store.completeTransition({
        transitionId: "transition-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        currentArtifact,
        outcomes: [{
          transition: "changed",
          previous: {
            artifactId: previousAttempt.artifact.artifactId,
            artifactIdentityHash: previousAttempt.artifact.artifactIdentityHash,
            findingId: "finding-1",
            evidenceRefs: ["evidence:a:1"],
          },
          current: {
            artifactId: reservation.currentArtifactId,
            artifactIdentityHash: reservation.currentArtifactIdentityHash,
            findingId: "finding-b",
            evidenceRefs: ["evidence:b:1"],
          },
        }],
        completedAt: "2026-08-14T03:01:00.000Z",
      });
      expect(completed.status).toBe("completed");
      expect(completed.previousTarget.artifactIdentityHash).toBe(recovered.target.artifactIdentityHash);
      expect(completed.previousArtifact.artifactIdentityHash).toBe(previousAttempt.artifact.artifactIdentityHash);
      expect(completed.previousTarget.artifactIdentityHash).not.toBe(completed.previousArtifact.artifactIdentityHash);

      const replay = harness.store.reserveTransition({
        transitionId: "transition-other",
        idempotencyKey: "transition-key-1",
        requestedBy: "admin-1",
        previousEvaluationId: "evaluation-1",
        previousAttemptId: previousAttempt.attemptId,
        currentTarget,
        generationProviderRunId: "transition-generation-run-other",
        generationProviderSessionId: "transition-generation-session-other",
        comparisonProviderRunId: "transition-comparison-run-other",
        comparisonProviderSessionId: "transition-comparison-session-other",
      });
      expect(replay).toMatchObject({ created: false, transitionId: "transition-1" });

      expect(() => harness.store.completeTransition({
        transitionId: "transition-1",
        expectedWorkspaceId: "workspace-other",
        expectedProjectId: "project-1",
        currentArtifact,
        outcomes: [],
      })).toThrow(/ENERGYIQ_ADDITIONAL_EVALUATION_TENANT_MISMATCH/);
    } finally {
      harness.close();
    }
  });

  it("persists a localized transition failure with exact Provider identities and recovers it idempotently", () => {
    const harness = createHarness();
    try {
      reserveAndComplete(harness);
      const previous = harness.store.getEvaluation({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      });
      const previousAttempt = previous.attempts[0]!;
      if (previousAttempt.status !== "completed") throw new Error("test fixture expected completed attempt");
      harness.store.reserveTransition({
        transitionId: "transition-failed",
        idempotencyKey: "transition-failed-key",
        requestedBy: "admin-1",
        previousEvaluationId: previous.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
        currentTarget: evaluationTarget("snapshot-b", "release-b"),
        generationProviderRunId: "transition-generation-run-failed",
        generationProviderSessionId: "transition-generation-session-failed",
        comparisonProviderRunId: "transition-comparison-run-failed",
        comparisonProviderSessionId: "transition-comparison-session-failed",
      });
      const inFlightReplay = harness.store.reserveTransition({
        transitionId: "transition-other",
        idempotencyKey: "transition-failed-key",
        requestedBy: "admin-1",
        previousEvaluationId: previous.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
        currentTarget: evaluationTarget("snapshot-b", "release-b"),
        generationProviderRunId: "must-not-replace-generation-run",
        generationProviderSessionId: "must-not-replace-generation-session",
        comparisonProviderRunId: "must-not-replace-comparison-run",
        comparisonProviderSessionId: "must-not-replace-comparison-session",
      });
      expect(inFlightReplay).toMatchObject({
        created: false,
        transitionId: "transition-failed",
        generationProviderRunId: "transition-generation-run-failed",
        generationProviderSessionId: "transition-generation-session-failed",
        comparisonProviderRunId: "transition-comparison-run-failed",
        comparisonProviderSessionId: "transition-comparison-session-failed",
      });

      const failed = harness.store.failTransition({
        transitionId: "transition-failed",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        errorCode: "PRESCHOOL_ADDITIONAL_TRANSITION_REUSES_PREVIOUS_EVIDENCE",
        failureStage: "validation",
        completedAt: "2026-08-14T04:00:00.000Z",
      });
      expect(failed).toMatchObject({
        status: "failed",
        errorCode: "PRESCHOOL_ADDITIONAL_TRANSITION_REUSES_PREVIOUS_EVIDENCE",
        generationProviderRunId: "transition-generation-run-failed",
        comparisonProviderRunId: "transition-comparison-run-failed",
      });
      expect(harness.store.getTransition({
        transitionId: "transition-failed",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      })).toEqual(failed);
      expect(harness.store.failTransition({
        transitionId: "transition-failed",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        errorCode: "PRESCHOOL_ADDITIONAL_TRANSITION_REUSES_PREVIOUS_EVIDENCE",
        failureStage: "validation",
      })).toEqual(failed);
    } finally {
      harness.close();
    }
  });
});

const PASSING_SCORES: AdditionalAiInsightHumanScores = {
  newAngle: 4,
  relevance: 4,
  clarity: 4,
  worthExploring: 4,
  epistemicHonesty: 4,
  userValue: 4,
};

const contentUsefulness = (
  batch: ReturnType<ReturnType<typeof createHarness>["store"]["getEvaluation"]>,
  reviewToken: string,
) => {
  const entry = batch.reviewPack.entries.find((candidate) => candidate.reviewToken === reviewToken)!;
  return {
    summary: { applicable: false as const },
    insights: entry.findings.map(({ reviewFindingToken }) => ({ reviewFindingToken, score: 4 })),
  };
};

const passingMachineGate = () => ({
  status: "passed" as const,
  checks: ADDITIONAL_AI_INSIGHT_EVALUATION_MACHINE_CHECKS.map((check) => ({ check, passed: true })),
});

const attemptReservations = (suffix = ""): Array<{
  attemptId: string; ordinal: number; providerRunId: string; providerSessionId: string;
}> => [1, 2, 3].map((ordinal) => ({
  attemptId: `attempt-${ordinal}${suffix}`,
  ordinal,
  providerRunId: `provider-run-${ordinal}${suffix}`,
  providerSessionId: `provider-session-${ordinal}${suffix}`,
}));

const evaluationTarget = (
  dataSnapshotId: string,
  projectReleaseId: string,
): AdditionalAiInsightEvaluationTarget => {
  const methodSet = resolveCurrentAdditionalAiInsightMethodSet("workspace-1");
  const canonical = canonicalInsightMethodSetJson(methodSet.methods)!;
  return {
    workspaceId: "workspace-1",
    projectId: "project-1",
    scopeId: "scope-1",
    resource: "electricity",
    dataSnapshotId,
    projectReleaseId,
    analysisPeriod: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
    modelProfileId: "workspace-default",
    modelProfileRevision: 7,
    artifactIdentityRevision: "additional-insights-v3",
    artifactIdentityHash: `sha256:${createHash("sha256").update(`${dataSnapshotId}:${projectReleaseId}`).digest("hex")}`,
    outputContractRevision: "energyiq-additional-ai-insights-v2",
    validatorRevision: "additional-insights-acceptance-v3",
    workflowRevision: "additional-insights-discover-accept-publish-v3",
    promptRevision: "additional-insights-discovery-v3",
    capabilityRevision: "scoped-read-only-v1",
    publicationRevision: "additional-insights-v2",
    canvasRevision: "energyiq-insight-canvas-v2",
    methodSetId: methodSet.id,
    methodSetRevision: methodSet.revision,
    methodSetFingerprint: `sha256:${createHash("sha256").update(canonical).digest("hex")}`,
  };
};

const artifact = (
  target: AdditionalAiInsightEvaluationTarget,
  runId: string,
  evidenceId: string,
  findingId: string,
): AdditionalAiInsightsArtifact => {
  const methodSet = resolveCurrentAdditionalAiInsightMethodSet(target.workspaceId);
  const coreMethod = methodSet.methods[0]!;
  return {
    artifactKind: "autonomous-insights",
    status: "available",
    providerProfileId: target.modelProfileId,
    runId,
    contract: { id: "energyiq-additional-ai-insights", revision: target.outputContractRevision },
    binding: {
      workspaceId: target.workspaceId,
      projectId: target.projectId,
      scopeId: target.scopeId,
      dataSnapshotId: target.dataSnapshotId,
      projectReleaseId: target.projectReleaseId,
      analysisPeriod: { ...target.analysisPeriod },
      modelProfileId: target.modelProfileId,
      modelProfileRevision: target.modelProfileRevision,
    },
    methodExecution: {
      methodSetId: target.methodSetId,
      methodSetRevision: target.methodSetRevision,
      methodSetFingerprint: target.methodSetFingerprint,
      loadedMethods: [...methodSet.methods],
    },
    capability: {
      revision: target.capabilityRevision,
      mode: "scoped-read-only",
      allowedTools: [...ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1],
      usedTools: [],
    },
    toolAudits: [],
    evidenceLineage: {
      catalogContract: "analysis-context-evidence@1",
      sourceId: `catalog:${target.dataSnapshotId}`,
      pins: {
        workspaceId: target.workspaceId,
        projectId: target.projectId,
        scopeId: target.scopeId,
        dataSnapshotId: target.dataSnapshotId,
        dataCutoff: "2026-05-31T23:45:00.000Z",
        projectReleaseId: target.projectReleaseId,
        metricVersion: "metric-v1",
      },
      facts: [{
        id: evidenceId,
        label: "Evidence",
        metricId: "energy.additional",
        value: target.dataSnapshotId === "snapshot-a" ? 10 : 12,
        unit: "kWh",
        status: "confirmed",
        evidenceRefs: [`source:${evidenceId}`],
        dimensions: { scopeId: target.scopeId },
      }],
    },
    findings: [{
      id: findingId,
      title: `Finding ${findingId}`,
      text: "An incremental Evidence-bound angle.",
      epistemicStatus: "observed",
      origin: { kind: "ai-discovery", coreMethod, directionMethods: [] },
      evidenceRefs: [evidenceId],
      toolAuditIds: [],
    }],
    publication: {
      policyId: "energyiq-additional-ai-insights",
      policyRevision: target.publicationRevision,
      discoveredCount: 1,
      acceptedCount: 1,
      rejectedCount: 0,
      publishedCount: 1,
      sourceOrderCandidateIds: [findingId],
      acceptedCandidateIds: [findingId],
      rejectedCandidateIds: [],
      publishedCandidateIds: [findingId],
      suppressedCandidateIds: [],
    },
  };
};

const createHarness = () => {
  const root = mkdtempSync(join(tmpdir(), "energyiq-additional-evaluation-"));
  const databasePath = join(root, "metadata.sqlite");
  let metadata = createMetadataStore({ database_path: databasePath });
  const harness = {
    get metadata() { return metadata; },
    get store() { return metadata.energyIq.additionalInsightEvaluations; },
    reopen() {
      metadata.close();
      metadata = createMetadataStore({ database_path: databasePath });
    },
    close() {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
  return harness;
};

const reserveAndComplete = (
  harness: ReturnType<typeof createHarness>,
  input: { failOrdinal?: number } = {},
): void => {
  const target = evaluationTarget("snapshot-a", "release-a");
  harness.store.reserveEvaluation({
    evaluationId: "evaluation-1",
    idempotencyKey: "evaluation-key-1",
    requestedBy: "admin-1",
    target,
    attempts: attemptReservations(),
  });
  expect(harness.store.getEvaluation({
    evaluationId: "evaluation-1",
    expectedWorkspaceId: "workspace-1",
    expectedProjectId: "project-1",
  }).attempts.map(({ status }) => status)).toEqual(["running", "running", "running"]);
  for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
    if (ordinal === input.failOrdinal) {
      expect(harness.store.getEvaluation({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      }).attempts[ordinal - 1]).toMatchObject({ status: "running" });
      harness.store.failAttempt({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        attemptId: `attempt-${ordinal}`,
        errorCode: "PROVIDER_FAILED",
      });
    } else {
      harness.store.completeAttempt({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        attemptId: `attempt-${ordinal}`,
        artifact: artifact(target, `provider-run-${ordinal}`, `evidence:a:${ordinal}`, `finding-${ordinal}`),
        machineGate: passingMachineGate(),
      });
      expect(harness.store.getEvaluation({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      }).attempts.map(({ status }) => status)).toEqual(
        [1, 2, 3].map((candidate) => candidate <= ordinal ? "completed" : "running"),
      );
    }
  }
  harness.store.finalizeEvaluation({
    evaluationId: "evaluation-1",
    expectedWorkspaceId: "workspace-1",
    expectedProjectId: "project-1",
  });
};

const completedHarness = () => {
  const harness = createHarness();
  reserveAndComplete(harness);
  return harness;
};
