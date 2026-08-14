import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1,
  resolveCurrentAdditionalAiInsightMethodSet,
  type AdditionalAiInsightEvaluationTarget,
  type AdditionalAiInsightsArtifact,
} from "@datafoundry/contracts";
import { createMetadataStore, type UserRecord } from "@datafoundry/metadata";

import {
  createOverviewAiArtifactIdentity,
  createPreschoolAdditionalAiInsightArtifactIdentity,
  type OverviewAiArtifactIdentityV13,
  type PreschoolAdditionalAiInsightArtifactIdentity,
} from "./overview-ai-artifact.js";
import { createPreschoolAdditionalAiInsightsEvaluationWorkflow } from "./preschool-additional-ai-insights-evaluation.js";

describe("Preschool Additional AI Insights evaluation workflow", () => {
  it("runs pass@3 with three independent Provider identities, no current Artifact reuse, and idempotent replay", async () => {
    const harness = createHarness();
    try {
      const calls: Array<{ runId: string; sessionId: string }> = [];
      const runAttempt = vi.fn(async ({ identity, runId, sessionId }) => {
        const persisted = harness.metadata.db.prepare(`
          SELECT record_json FROM energyiq_additional_insight_evaluations
          WHERE workspace_id = ? AND project_id = ? AND idempotency_key = ?
        `).get(identity.workspaceId, identity.projectId, "pass-at-3-key") as { record_json: string };
        const reserved = JSON.parse(persisted.record_json) as { attempts: Array<{ artifact?: unknown }> };
        expect(reserved.attempts.every(({ artifact }) => artifact !== undefined)).toBe(true);
        calls.push({ runId, sessionId });
        return artifact(identity, runId, `evidence:${calls.length}`, `finding-${calls.length}`);
      });
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition: vi.fn(),
      });

      const first = await workflow.executePassAt3({
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "pass-at-3-key",
      });
      expect(first.status).toBe("awaiting-human-review");
      expect(runAttempt).toHaveBeenCalledTimes(3);
      expect(new Set(calls.map(({ runId }) => runId))).toHaveLength(3);
      expect(new Set(calls.map(({ sessionId }) => sessionId))).toHaveLength(3);
      expect(first.attempts.map(({ ordinal }) => ordinal)).toEqual([1, 2, 3]);
      expect(new Set(first.attempts.map(({ artifact }) => artifact.artifactId))).toHaveLength(3);
      expect(first.reviewPack.entries).toHaveLength(3);
      expect(harness.metadata.energyIq.overviewAiArtifacts.find(
        createPreschoolAdditionalAiInsightArtifactIdentity({ baseIdentity: harness.baseIdentity }),
      )).toBeUndefined();

      const replay = await workflow.executePassAt3({
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "pass-at-3-key",
      });
      expect(replay).toEqual(first);
      expect(runAttempt).toHaveBeenCalledTimes(3);
    } finally {
      harness.close();
    }
  });

  it("persists one transient Provider/schema failure without retrying or collapsing sibling attempts", async () => {
    const harness = createHarness();
    try {
      let invocation = 0;
      const runAttempt = vi.fn(async ({ identity, runId }: {
        identity: PreschoolAdditionalAiInsightArtifactIdentity;
        runId: string;
      }) => {
        invocation += 1;
        if (invocation === 2) throw new Error("PRESCHOOL_ADDITIONAL_AI_DISCOVERY_RESULT_INVALID");
        return artifact(identity, runId, `evidence:${invocation}`, `finding-${invocation}`);
      });
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition: vi.fn(),
      });
      const result = await workflow.executePassAt3({
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "failure-key",
      });
      expect(runAttempt).toHaveBeenCalledTimes(3);
      expect(result.attempts).toEqual([
        expect.objectContaining({ ordinal: 1, status: "completed" }),
        expect.objectContaining({
          ordinal: 2,
          status: "failed",
          failureStage: "structured-output",
          errorCode: "PRESCHOOL_ADDITIONAL_AI_DISCOVERY_RESULT_INVALID",
        }),
        expect.objectContaining({ ordinal: 3, status: "completed" }),
      ]);
      expect(result.attempts[1]).toMatchObject({
        artifact: expect.objectContaining({ artifactIdentityRevision: "additional-insight-evaluation-artifact-v1" }),
      });
      expect(result.reviewPack.entries).toHaveLength(2);
    } finally {
      harness.close();
    }
  });

  it("resumes the same three reserved attempt identities after interruption without creating a fourth attempt", async () => {
    const harness = createHarness();
    try {
      const identity = createPreschoolAdditionalAiInsightArtifactIdentity({ baseIdentity: harness.baseIdentity });
      const attempts = [1, 2, 3].map((ordinal) => ({
        attemptId: `reserved-attempt-${ordinal}`,
        ordinal,
        providerRunId: `reserved-run-${ordinal}`,
        providerSessionId: `reserved-session-${ordinal}`,
      }));
      const interrupted = harness.metadata.energyIq.additionalInsightEvaluations.reserveEvaluation({
        evaluationId: "interrupted-evaluation",
        idempotencyKey: "interrupted-key",
        requestedBy: harness.user.id,
        target: evaluationTarget(identity),
        attempts,
      });
      const reservedArtifactIds = interrupted.record.attempts.map(({ artifact }) => artifact.artifactId);
      const runAttempt = vi.fn(async ({ identity, runId }: {
        identity: PreschoolAdditionalAiInsightArtifactIdentity;
        runId: string;
      }) => artifact(identity, runId, `evidence:${runId}`, `finding-${runId}`));
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition: vi.fn(),
      });

      const recovered = await workflow.executePassAt3({
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "interrupted-key",
      });
      expect(runAttempt.mock.calls.map(([call]) => call.runId)).toEqual([
        "reserved-run-1", "reserved-run-2", "reserved-run-3",
      ]);
      expect(recovered.attempts.map(({ attemptId }) => attemptId)).toEqual([
        "reserved-attempt-1", "reserved-attempt-2", "reserved-attempt-3",
      ]);
      expect(recovered.attempts.map(({ artifact }) => artifact.artifactId)).toEqual(reservedArtifactIds);
      expect(recovered.status).toBe("awaiting-human-review");
    } finally {
      harness.close();
    }
  });

  it("restores the exact reserved Method/Profile identity before resolving current rotations", async () => {
    const harness = createHarness();
    try {
      const originalIdentity = createPreschoolAdditionalAiInsightArtifactIdentity({ baseIdentity: harness.baseIdentity });
      const originalMethodSet = resolveCurrentAdditionalAiInsightMethodSet(harness.baseIdentity.workspaceId);
      const attempts = [1, 2, 3].map((ordinal) => ({
        attemptId: `rotation-attempt-${ordinal}`,
        ordinal,
        providerRunId: `rotation-run-${ordinal}`,
        providerSessionId: `rotation-session-${ordinal}`,
      }));
      const reserved = harness.metadata.energyIq.additionalInsightEvaluations.reserveEvaluation({
        evaluationId: "rotation-evaluation",
        idempotencyKey: "rotation-key",
        requestedBy: harness.user.id,
        target: evaluationTarget(originalIdentity),
        attempts,
        runtimeIdentity: originalIdentity,
        methodResources: originalMethodSet.resources,
      });
      const originalArtifactIds = reserved.record.attempts.map(({ artifact }) => artifact.artifactId);
      const runAttempt = vi.fn(async ({ identity, runId, methodResources }) => {
        expect(identity.modelProfileRevision).toBe(originalIdentity.modelProfileRevision);
        expect(identity.methodSetFingerprint).toBe(originalIdentity.methodSetFingerprint);
        expect(methodResources).toEqual(originalMethodSet.resources);
        return artifact(identity, runId, `evidence:${runId}`, `finding-${runId}`);
      });
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition: vi.fn(),
      });
      const rotatedBaseIdentity = {
        ...harness.baseIdentity,
        modelProfileRevision: harness.baseIdentity.modelProfileRevision + 1,
      };
      const recovered = await workflow.executePassAt3({
        baseIdentity: rotatedBaseIdentity,
        user: harness.user,
        idempotencyKey: "rotation-key",
      });
      expect(runAttempt).toHaveBeenCalledTimes(3);
      expect(recovered.target).toEqual(evaluationTarget(originalIdentity));
      expect(recovered.attempts.map(({ artifact }) => artifact.artifactId)).toEqual(originalArtifactIds);
    } finally {
      harness.close();
    }
  });

  it("resumes an interrupted transition with its reserved identity after Method/Profile rotation", async () => {
    const harness = createHarness();
    try {
      const runAttempt = vi.fn(async ({ identity, runId }: {
        identity: PreschoolAdditionalAiInsightArtifactIdentity;
        runId: string;
      }) => artifact(identity, runId, `evidence:${identity.dataSnapshotId}`, `finding-${identity.dataSnapshotId}`));
      const runTransition = vi.fn(async ({ runId, sessionId }: { runId: string; sessionId: string }) => ({
        answer: JSON.stringify({ outcomes: [{ transition: "no-material-change" }] }),
        runId,
        sessionId,
      }));
      let generatedId = 0;
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition,
        createId: () => `new-request-id-${generatedId += 1}`,
      });
      const previous = reviewAllPassing(harness, await workflow.executePassAt3({
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "transition-rotation-previous",
      }));
      const previousAttempt = previous.attempts.find((attempt) => attempt.status === "completed")!;
      const currentBaseIdentity = createBaseIdentity("snapshot-b", "release-b");
      const currentIdentity = createPreschoolAdditionalAiInsightArtifactIdentity({ baseIdentity: currentBaseIdentity });
      const methodSet = resolveCurrentAdditionalAiInsightMethodSet(currentBaseIdentity.workspaceId);
      harness.metadata.energyIq.additionalInsightEvaluations.reserveTransition({
        transitionId: "reserved-transition-id",
        idempotencyKey: "transition-rotation-key",
        requestedBy: harness.user.id,
        previousEvaluationId: previous.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
        currentTarget: evaluationTarget(currentIdentity),
        generationProviderRunId: "reserved-transition-generation-run",
        generationProviderSessionId: "reserved-transition-generation-session",
        comparisonProviderRunId: "reserved-transition-comparison-run",
        comparisonProviderSessionId: "reserved-transition-comparison-session",
        runtimeIdentity: currentIdentity,
        methodResources: methodSet.resources,
      });
      runAttempt.mockClear();
      runTransition.mockClear();

      const recovered = await workflow.executeTransition({
        baseIdentity: { ...currentBaseIdentity, modelProfileRevision: currentBaseIdentity.modelProfileRevision + 1 },
        user: harness.user,
        idempotencyKey: "transition-rotation-key",
        previousEvaluationId: previous.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
      });

      expect(recovered).toMatchObject({ status: "completed", transitionId: "reserved-transition-id" });
      expect(runAttempt).toHaveBeenCalledTimes(1);
      expect(runAttempt.mock.calls[0]![0]).toMatchObject({
        identity: currentIdentity,
        runId: "reserved-transition-generation-run",
        sessionId: "reserved-transition-generation-session",
        methodResources: methodSet.resources,
      });
      expect(runTransition).toHaveBeenCalledWith(expect.objectContaining({
        runId: "reserved-transition-comparison-run",
        sessionId: "reserved-transition-comparison-session",
      }));
    } finally {
      harness.close();
    }
  });

  it("regenerates B once, runs an Evidence-bound comparison, and persists No material change without A Evidence reuse", async () => {
    const harness = createHarness();
    try {
      const runAttempt = vi.fn(async ({ identity, runId }: {
        identity: PreschoolAdditionalAiInsightArtifactIdentity;
        runId: string;
      }) => artifact(
        identity,
        runId,
        identity.dataSnapshotId === "snapshot-a" ? "evidence:a:1" : "evidence:b:1",
        identity.dataSnapshotId === "snapshot-a" ? "finding-a" : "finding-b",
      ));
      const runTransition = vi.fn(async ({ runId, sessionId }: { runId: string; sessionId: string }) => ({
        answer: JSON.stringify({ outcomes: [{ transition: "no-material-change" }] }),
        runId,
        sessionId,
      }));
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition,
      });
      const previous = await workflow.executePassAt3({
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "snapshot-a-evaluation",
      });
      const reviewedPrevious = reviewAllPassing(harness, previous);
      const previousAttempt = reviewedPrevious.attempts[0]!;
      if (previousAttempt.status !== "completed") throw new Error("test fixture expected completed attempt");

      const transition = await workflow.executeTransition({
        baseIdentity: createBaseIdentity("snapshot-b", "release-b"),
        user: harness.user,
        idempotencyKey: "snapshot-a-to-b",
        previousEvaluationId: reviewedPrevious.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
      });
      expect(transition).toMatchObject({
        status: "completed",
        previousTarget: { dataSnapshotId: "snapshot-a" },
        currentTarget: { dataSnapshotId: "snapshot-b" },
        outcomes: [{ transition: "no-material-change" }],
      });
      expect(runAttempt).toHaveBeenCalledTimes(4);
      expect(runTransition).toHaveBeenCalledTimes(1);
      const transitionInput = runTransition.mock.calls[0]![0] as { prompt: string; runId: string; sessionId: string };
      expect(transitionInput.prompt).toContain("evidence:a:1");
      expect(transitionInput.prompt).toContain("evidence:b:1");
      expect(transitionInput.prompt).toContain("Evidence-bound");
      expect(transitionInput.prompt).not.toMatch(/What-Why-Action|fixed lens/i);
      expect(transition.generationProviderRunId).not.toBe(transition.comparisonProviderRunId);
    } finally {
      harness.close();
    }
  });

  it("allows stable Snapshot-bound fact IDs and rejects unsupported A numbers in B", async () => {
    const harness = createHarness();
    try {
      const runAttempt = vi.fn(async ({ identity, runId }: {
        identity: PreschoolAdditionalAiInsightArtifactIdentity;
        runId: string;
      }) => artifact(identity, runId, "analysis.summary.usage_kwh", identity.dataSnapshotId === "snapshot-a" ? "finding-a" : "finding-b"));
      const runTransition = vi.fn(async ({ runId, sessionId }: { runId: string; sessionId: string }) => ({
        answer: JSON.stringify({
          outcomes: [{
            transition: "changed",
            previousFindingId: "finding-a",
            previousEvidenceRefs: ["analysis.summary.usage_kwh"],
            currentFindingId: "finding-b",
            currentEvidenceRefs: ["analysis.summary.usage_kwh"],
          }],
        }),
        runId,
        sessionId,
      }));
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition,
      });
      const previous = await workflow.executePassAt3({
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "snapshot-a-evaluation",
      });
      const reviewedPrevious = reviewAllPassing(harness, previous);
      const previousAttempt = reviewedPrevious.attempts[0]!;
      if (previousAttempt.status !== "completed") throw new Error("test fixture expected completed attempt");
      const request = {
        baseIdentity: createBaseIdentity("snapshot-b", "release-b"),
        user: harness.user,
        idempotencyKey: "snapshot-a-to-b-invalid",
        previousEvaluationId: reviewedPrevious.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
      };
      const changed = await workflow.executeTransition(request);
      expect(changed).toMatchObject({
        status: "completed",
        outcomes: [{ transition: "changed" }],
      });
      expect(runTransition).toHaveBeenCalledTimes(1);
      expect(runAttempt).toHaveBeenCalledTimes(4);

      const replay = await workflow.executeTransition(request);
      expect(replay).toEqual(changed);
      expect(runAttempt).toHaveBeenCalledTimes(4);
      expect(runTransition).toHaveBeenCalledTimes(1);
    } finally {
      harness.close();
    }
  });

  it("uses DB claims so concurrent idempotent requests execute each Provider stage once", async () => {
    const harness = createHarness();
    try {
      const runAttempt = vi.fn(async ({ identity, runId }: {
        identity: PreschoolAdditionalAiInsightArtifactIdentity;
        runId: string;
      }) => {
        await Promise.resolve();
        return artifact(identity, runId, "analysis.summary.usage_kwh", `finding-${runId}`);
      });
      const runTransition = vi.fn(async ({ runId, sessionId }: { runId: string; sessionId: string }) => {
        await Promise.resolve();
        return { answer: JSON.stringify({ outcomes: [{ transition: "no-material-change" }] }), runId, sessionId };
      });
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition,
      });
      const evaluationInput = {
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "concurrent-pass-at-3",
      };
      const evaluations = await Promise.all([
        workflow.executePassAt3(evaluationInput),
        workflow.executePassAt3(evaluationInput),
      ]);
      expect(runAttempt).toHaveBeenCalledTimes(3);
      expect(new Set(evaluations.map(({ evaluationId }) => evaluationId))).toHaveLength(1);
      const reviewed = reviewAllPassing(harness, harness.metadata.energyIq.additionalInsightEvaluations.getEvaluation({
        evaluationId: evaluations[0]!.evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      }));
      const previousAttempt = reviewed.attempts.find((attempt) => attempt.status === "completed")!;
      const transitionInput = {
        baseIdentity: createBaseIdentity("snapshot-b", "release-b"),
        user: harness.user,
        idempotencyKey: "concurrent-transition",
        previousEvaluationId: reviewed.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
      };
      const transitions = await Promise.all([
        workflow.executeTransition(transitionInput),
        workflow.executeTransition(transitionInput),
      ]);
      expect(runAttempt).toHaveBeenCalledTimes(4);
      expect(runTransition).toHaveBeenCalledTimes(1);
      expect(new Set(transitions.map(({ transitionId }) => transitionId))).toHaveLength(1);
    } finally {
      harness.close();
    }
  });

  it("heartbeats long Provider claims so Promise.all replays do not duplicate attempts or transition stages", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T00:00:00.000Z"));
    const harness = createHarness();
    try {
      const pendingAttempts = new Map<string, () => void>();
      const runAttempt = vi.fn(({ identity, runId }: {
        identity: PreschoolAdditionalAiInsightArtifactIdentity;
        runId: string;
      }) => new Promise<AdditionalAiInsightsArtifact>((resolve) => {
        pendingAttempts.set(runId, () => {
          pendingAttempts.delete(runId);
          resolve(artifact(identity, runId, "analysis.summary.usage_kwh", `finding-${runId}`));
        });
      }));
      let resolveComparison: (() => void) | undefined;
      const runTransition = vi.fn(({ runId, sessionId }: { runId: string; sessionId: string }) => (
        new Promise<{ answer: string; runId: string; sessionId: string }>((resolve) => {
          resolveComparison = () => resolve({
            answer: JSON.stringify({ outcomes: [{ transition: "no-material-change" }] }),
            runId,
            sessionId,
          });
        })
      ));
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition,
      });
      const evaluationInput = {
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "long-running-evaluation",
      };
      const firstEvaluation = workflow.executePassAt3(evaluationInput);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(6 * 60_000);
      const secondEvaluation = workflow.executePassAt3(evaluationInput);
      await vi.advanceTimersByTimeAsync(0);
      expect(runAttempt.mock.calls.map(([call]) => call.runId)).toEqual([
        expect.any(String),
        expect.any(String),
      ]);
      expect(new Set(runAttempt.mock.calls.map(([call]) => call.runId))).toHaveLength(2);
      for (const release of [...pendingAttempts.values()]) release();
      await vi.advanceTimersByTimeAsync(0);
      for (const release of [...pendingAttempts.values()]) release();
      await vi.advanceTimersByTimeAsync(0);
      const evaluations = await Promise.all([firstEvaluation, secondEvaluation]);
      expect(runAttempt).toHaveBeenCalledTimes(3);
      expect(new Set(runAttempt.mock.calls.map(([call]) => call.runId))).toHaveLength(3);

      const reviewed = reviewAllPassing(harness, evaluations.find(({ status }) => status === "awaiting-human-review")!);
      const previousAttempt = reviewed.attempts.find((attempt) => attempt.status === "completed")!;
      const transitionInput = {
        baseIdentity: createBaseIdentity("snapshot-b", "release-b"),
        user: harness.user,
        idempotencyKey: "long-running-transition",
        previousEvaluationId: reviewed.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
      };
      const firstTransition = workflow.executeTransition(transitionInput);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(6 * 60_000);
      const transitionReplayDuringGeneration = workflow.executeTransition(transitionInput);
      await vi.advanceTimersByTimeAsync(0);
      expect(runAttempt).toHaveBeenCalledTimes(4);
      for (const release of [...pendingAttempts.values()]) release();
      await vi.advanceTimersByTimeAsync(0);
      expect(runTransition).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(6 * 60_000);
      const transitionReplayDuringComparison = workflow.executeTransition(transitionInput);
      await vi.advanceTimersByTimeAsync(0);
      expect(runTransition).toHaveBeenCalledTimes(1);
      resolveComparison?.();
      await vi.advanceTimersByTimeAsync(0);
      const transitions = await Promise.all([
        firstTransition,
        transitionReplayDuringGeneration,
        transitionReplayDuringComparison,
      ]);
      expect(transitions[0]).toMatchObject({ status: "completed" });
      expect(runAttempt).toHaveBeenCalledTimes(4);
      expect(runTransition).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      harness.close();
    }
  });

  it("rejects unsupported A numbers and malformed B lineage before comparison", async () => {
    const harness = createHarness();
    try {
      let invalidCurrentLineage = false;
      const runAttempt = vi.fn(async ({ identity, runId }: {
        identity: PreschoolAdditionalAiInsightArtifactIdentity;
        runId: string;
      }) => {
        const value = artifact(identity, runId, "analysis.summary.usage_kwh", identity.dataSnapshotId === "snapshot-a"
          ? "finding-a"
          : "finding-b");
        if (identity.dataSnapshotId === "snapshot-b") {
          if (invalidCurrentLineage) value.findings[0]!.evidenceRefs = ["analysis.summary.forged"];
          else value.findings[0]!.text = "The old 10 kWh value still applies.";
        }
        return value;
      });
      const runTransition = vi.fn();
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition,
      });
      const previous = reviewAllPassing(harness, await workflow.executePassAt3({
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "snapshot-a-number-evaluation",
      }));
      const previousAttempt = previous.attempts.find((attempt) => attempt.status === "completed")!;
      const leakedNumber = await workflow.executeTransition({
        baseIdentity: createBaseIdentity("snapshot-b", "release-b"),
        user: harness.user,
        idempotencyKey: "snapshot-number-leak",
        previousEvaluationId: previous.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
      });
      expect(leakedNumber).toMatchObject({
        status: "failed",
        failureStage: "validation",
        errorCode: "PRESCHOOL_ADDITIONAL_TRANSITION_REUSES_PREVIOUS_NUMBER",
      });
      expect(runTransition).not.toHaveBeenCalled();

      invalidCurrentLineage = true;
      const forged = await workflow.executeTransition({
        baseIdentity: createBaseIdentity("snapshot-b", "release-b"),
        user: harness.user,
        idempotencyKey: "snapshot-forged-lineage",
        previousEvaluationId: previous.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
      });
      expect(forged).toMatchObject({
        status: "failed",
        failureStage: "validation",
        errorCode: "PRESCHOOL_ADDITIONAL_TRANSITION_CURRENT_ARTIFACT_INVALID",
      });
      expect(runTransition).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("normalizes lineage-bound numbers, scans all Finding fields, and allows unrelated B facts", async () => {
    const harness = createHarness();
    try {
      let mode: "supported" | "unrelated" = "supported";
      const runAttempt = vi.fn(async ({ identity, runId }: {
        identity: PreschoolAdditionalAiInsightArtifactIdentity;
        runId: string;
      }) => {
        const value = artifact(identity, runId, "analysis.summary.usage_kwh", identity.dataSnapshotId === "snapshot-a"
          ? "finding-a"
          : "finding-b");
        if (identity.dataSnapshotId === "snapshot-b") {
          const primaryFact = value.evidenceLineage.facts[0]!;
          if (!("value" in primaryFact)) throw new Error("test fixture expected value fact");
          primaryFact.value = mode === "supported" ? 10 : 12;
          value.evidenceLineage.facts.push({
            ...value.evidenceLineage.facts[0]!,
            id: "analysis.unrelated.same_number",
            value: 10,
          });
          value.findings[0]!.title = "10.0 kWh remains material";
          value.findings[0]!.text = "The supported value is 1e1 kWh.";
          value.findings[0]!.deepDiveQuestion = "Should we verify 10 kWh again?";
        }
        return value;
      });
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition: vi.fn(async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ outcomes: [{ transition: "still-supported", previousFindingId: "finding-a", previousEvidenceRefs: ["analysis.summary.usage_kwh"], currentFindingId: "finding-b", currentEvidenceRefs: ["analysis.summary.usage_kwh"] }] }),
          runId,
          sessionId,
        })),
      });
      const previous = reviewAllPassing(harness, await workflow.executePassAt3({
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "numeric-lineage-a",
      }));
      const previousAttempt = previous.attempts.find((attempt) => attempt.status === "completed")!;
      const supported = await workflow.executeTransition({
        baseIdentity: createBaseIdentity("snapshot-b", "release-b"),
        user: harness.user,
        idempotencyKey: "numeric-lineage-supported",
        previousEvaluationId: previous.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
      });
      expect(supported.status).toBe("completed");

      mode = "unrelated";
      const unrelated = await workflow.executeTransition({
        baseIdentity: createBaseIdentity("snapshot-b", "release-b"),
        user: harness.user,
        idempotencyKey: "numeric-lineage-unrelated",
        previousEvaluationId: previous.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
      });
      expect(unrelated).toMatchObject({
        status: "failed",
        errorCode: "PRESCHOOL_ADDITIONAL_TRANSITION_REUSES_PREVIOUS_NUMBER",
      });
    } finally {
      harness.close();
    }
  });

  it("accepts a Resolved outcome with only the disappeared A Finding lineage", async () => {
    const harness = createHarness();
    try {
      const runAttempt = vi.fn(async ({ identity, runId }: { identity: PreschoolAdditionalAiInsightArtifactIdentity; runId: string }) => (
        artifact(identity, runId, identity.dataSnapshotId === "snapshot-a" ? "evidence:a" : "evidence:b", identity.dataSnapshotId === "snapshot-a" ? "finding-a" : "finding-b")
      ));
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition: vi.fn(async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ outcomes: [{ transition: "resolved", previousFindingId: "finding-a", previousEvidenceRefs: ["evidence:a"] }] }),
          runId,
          sessionId,
        })),
      });
      const previous = reviewAllPassing(harness, await workflow.executePassAt3({
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "resolved-a",
      }));
      const previousAttempt = previous.attempts.find((attempt) => attempt.status === "completed")!;
      const resolved = await workflow.executeTransition({
        baseIdentity: createBaseIdentity("snapshot-b", "release-b"),
        user: harness.user,
        idempotencyKey: "resolved-a-b",
        previousEvaluationId: previous.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
      });
      expect(resolved).toMatchObject({
        status: "completed",
        outcomes: [{ transition: "resolved", previous: { findingId: "finding-a" } }],
      });
    } finally {
      harness.close();
    }
  });
});

const createHarness = () => {
  const root = mkdtempSync(join(tmpdir(), "preschool-additional-evaluation-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  metadata.users.upsertDevUser({
    id: "admin-1",
    email: "admin@example.test",
    display_name: "Admin",
    dev_token: "admin-token",
  });
  const user = metadata.users.getById({ user_id: "admin-1" }) as UserRecord;
  metadata.workspaces.upsert({
    id: "workspace-1",
    owner_user_id: user.id,
    name: "Workspace 1",
    kind: "customer",
  });
  metadata.energyIq.upsertProject({
    id: "project-1",
    workspace_id: "workspace-1",
    name: "Project 1",
    status: "published",
    root_scope_id: "scope-1",
  });
  return {
    metadata,
    user,
    baseIdentity: createBaseIdentity("snapshot-a", "release-a"),
    close: () => {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
};

const reviewAllPassing = (
  harness: ReturnType<typeof createHarness>,
  batch: Awaited<ReturnType<ReturnType<typeof createPreschoolAdditionalAiInsightsEvaluationWorkflow>["executePassAt3"]>>,
) => {
  let current = batch;
  for (const entry of batch.reviewPack.entries) {
    current = harness.metadata.energyIq.additionalInsightEvaluations.recordHumanReview({
      evaluationId: batch.evaluationId,
      expectedWorkspaceId: batch.target.workspaceId,
      expectedProjectId: batch.target.projectId,
      reviewToken: entry.reviewToken,
      actorId: harness.user.id,
      scores: {
        newAngle: 4,
        relevance: 4,
        clarity: 4,
        worthExploring: 4,
        epistemicHonesty: 4,
        userValue: 4,
      },
      contentUsefulness: {
        summary: entry.summary === undefined
          ? { applicable: false }
          : { applicable: true, score: 4 },
        insights: entry.findings.map(({ reviewFindingToken }) => ({ reviewFindingToken, score: 4 })),
      },
      expectedRevision: 0,
    });
  }
  return current;
};

const createBaseIdentity = (
  dataSnapshotId: string,
  projectReleaseId: string,
): OverviewAiArtifactIdentityV13 => createOverviewAiArtifactIdentity({
  workspaceId: "workspace-1",
  projectId: "project-1",
  scopeId: "scope-1",
  dataSnapshotId,
  projectReleaseId,
  analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
  analysisPeriodTo: "2026-06-01T00:00:00.000Z",
  rendererKey: "preschool-overview",
  rendererVersion: "1",
  modelProfileId: "workspace-default",
  modelProfileRevision: 7,
});

const evaluationTarget = (
  identity: PreschoolAdditionalAiInsightArtifactIdentity,
): AdditionalAiInsightEvaluationTarget => ({
  workspaceId: identity.workspaceId,
  projectId: identity.projectId,
  scopeId: identity.scopeId,
  resource: identity.resource,
  dataSnapshotId: identity.dataSnapshotId,
  projectReleaseId: identity.projectReleaseId,
  analysisPeriod: { from: identity.analysisPeriodFrom, to: identity.analysisPeriodTo },
  modelProfileId: identity.modelProfileId,
  modelProfileRevision: identity.modelProfileRevision,
  artifactIdentityRevision: identity.identityContractRevision,
  artifactIdentityHash: `sha256:${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`,
  outputContractRevision: identity.outputContractRevision,
  validatorRevision: identity.validatorRevision,
  workflowRevision: identity.workflowRevision,
  promptRevision: identity.investigatorPromptRevision,
  capabilityRevision: identity.capabilityRevision,
  publicationRevision: identity.publicationRevision,
  canvasRevision: identity.canvasRevision,
  methodSetId: identity.methodSetId,
  methodSetRevision: identity.methodSetRevision,
  methodSetFingerprint: identity.methodSetFingerprint,
});

const artifact = (
  identity: PreschoolAdditionalAiInsightArtifactIdentity,
  runId: string,
  evidenceId: string,
  findingId: string,
): AdditionalAiInsightsArtifact => {
  const methodSet = resolveCurrentAdditionalAiInsightMethodSet(identity.workspaceId);
  return {
    artifactKind: "autonomous-insights",
    status: "available",
    providerProfileId: identity.modelProfileId,
    runId,
    contract: { id: "energyiq-additional-ai-insights", revision: identity.outputContractRevision },
    binding: {
      workspaceId: identity.workspaceId,
      projectId: identity.projectId,
      scopeId: identity.scopeId,
      dataSnapshotId: identity.dataSnapshotId,
      projectReleaseId: identity.projectReleaseId,
      analysisPeriod: { from: identity.analysisPeriodFrom, to: identity.analysisPeriodTo },
      modelProfileId: identity.modelProfileId,
      modelProfileRevision: identity.modelProfileRevision,
    },
    methodExecution: {
      methodSetId: identity.methodSetId,
      methodSetRevision: identity.methodSetRevision,
      methodSetFingerprint: identity.methodSetFingerprint,
      loadedMethods: [...methodSet.methods],
    },
    capability: {
      revision: identity.capabilityRevision,
      mode: "scoped-read-only",
      allowedTools: [...ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1],
      usedTools: [],
    },
    toolAudits: [],
    evidenceLineage: {
      catalogContract: "analysis-context-evidence@1",
      sourceId: `catalog:${identity.dataSnapshotId}`,
      pins: {
        workspaceId: identity.workspaceId,
        projectId: identity.projectId,
        scopeId: identity.scopeId,
        dataSnapshotId: identity.dataSnapshotId,
        dataCutoff: "2026-05-31T23:45:00.000Z",
        projectReleaseId: identity.projectReleaseId,
        metricVersion: "metric-v1",
      },
      facts: [{
        id: evidenceId,
        label: "Evidence",
        metricId: "energy.additional",
        value: identity.dataSnapshotId === "snapshot-a" ? 10 : 12,
        unit: "kWh",
        status: "confirmed",
        evidenceRefs: [`source:${evidenceId}`],
        dimensions: { scopeId: identity.scopeId },
      }],
    },
    findings: [{
      id: findingId,
      title: `Finding ${findingId}`,
      text: "An incremental Evidence-bound angle.",
      epistemicStatus: "observed",
      origin: { kind: "ai-discovery", coreMethod: methodSet.methods[0]!, directionMethods: [] },
      evidenceRefs: [evidenceId],
      toolAuditIds: [],
    }],
    publication: {
      policyId: "energyiq-additional-ai-insights",
      policyRevision: identity.publicationRevision,
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
