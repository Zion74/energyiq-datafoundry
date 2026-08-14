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
      harness.metadata.energyIq.additionalInsightEvaluations.reserveEvaluation({
        evaluationId: "interrupted-evaluation",
        idempotencyKey: "interrupted-key",
        requestedBy: harness.user.id,
        target: evaluationTarget(identity),
        attempts,
      });
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
      expect(recovered.status).toBe("awaiting-human-review");
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
      const previousAttempt = previous.attempts[0]!;
      if (previousAttempt.status !== "completed") throw new Error("test fixture expected completed attempt");

      const transition = await workflow.executeTransition({
        baseIdentity: createBaseIdentity("snapshot-b", "release-b"),
        user: harness.user,
        idempotencyKey: "snapshot-a-to-b",
        previousEvaluationId: previous.evaluationId,
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

  it("persists and idempotently recovers a localized B Evidence validation failure without comparison or retry", async () => {
    const harness = createHarness();
    try {
      const runAttempt = vi.fn(async ({ identity, runId }: {
        identity: PreschoolAdditionalAiInsightArtifactIdentity;
        runId: string;
      }) => artifact(identity, runId, "evidence:a:1", identity.dataSnapshotId === "snapshot-a" ? "finding-a" : "finding-b"));
      const runTransition = vi.fn();
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
      const previousAttempt = previous.attempts[0]!;
      if (previousAttempt.status !== "completed") throw new Error("test fixture expected completed attempt");
      const request = {
        baseIdentity: createBaseIdentity("snapshot-b", "release-b"),
        user: harness.user,
        idempotencyKey: "snapshot-a-to-b-invalid",
        previousEvaluationId: previous.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
      };
      const failed = await workflow.executeTransition(request);
      expect(failed).toMatchObject({
        status: "failed",
        failureStage: "validation",
        errorCode: "PRESCHOOL_ADDITIONAL_TRANSITION_REUSES_PREVIOUS_EVIDENCE",
      });
      expect(runTransition).not.toHaveBeenCalled();
      expect(runAttempt).toHaveBeenCalledTimes(4);

      const replay = await workflow.executeTransition(request);
      expect(replay).toEqual(failed);
      expect(runAttempt).toHaveBeenCalledTimes(4);
      expect(runTransition).not.toHaveBeenCalled();
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
