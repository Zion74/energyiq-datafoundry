import type { AnalysisContextEvidenceCatalog } from "@datafoundry/agent-runtime";
import {
  ENERGYIQ_OPEN_DISCOVERY_METHOD_CONTENT_V1,
  type AdditionalAiInsightsArtifact,
} from "@datafoundry/contracts";
import { createMetadataStore, type UserRecord } from "@datafoundry/metadata";
import { toStandardSchema } from "@mastra/core/schema";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  createOverviewAiArtifactIdentity,
  createPreschoolAdditionalAiInsightArtifactIdentity,
} from "./overview-ai-artifact.js";
import { ensureEnergyIqBootstrap, PRESCHOOL_WORKSPACE_ID } from "./energy-bootstrap.js";
import { createPreschoolAdditionalAiInsightsWorkflow } from "./preschool-additional-ai-insights-workflow.js";
import { composePreschoolOverviewAiReadModel } from "./preschool-overview-ai-read-model.js";
import { PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V2 } from "./preschool-overview-ai-structured-output.js";

describe("Preschool Additional AI Insights workflow", () => {
  it("runs independent evaluation attempts through the real acceptance seam without current Artifact queue/cache", async () => {
    const harness = createHarness();
    try {
      const runDiscovery = vi.fn(async ({ runId, sessionId }) => ({
        answer: JSON.stringify({ candidates: [candidate(`candidate-${runId}`, "fact:standby-share")] }),
        runId,
        sessionId,
      }));
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        runDiscovery,
      });
      const first = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "evaluation-run-1",
        sessionId: "evaluation-session-1",
      });
      const second = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "evaluation-run-2",
        sessionId: "evaluation-session-2",
      });
      expect(runDiscovery).toHaveBeenCalledTimes(2);
      expect([first.runId, second.runId]).toEqual(["evaluation-run-1", "evaluation-run-2"]);
      expect(harness.metadata.energyIq.overviewAiArtifacts.find(harness.additionalIdentity)).toBeUndefined();
    } finally {
      harness.close();
    }
  });

  it("carries the prompt origin declaration through strict schema parsing and server acceptance", async () => {
    const harness = createHarness();
    try {
      const proposed = {
        candidates: [candidate("candidate-origin-contract", "fact:standby-share", {
          origin: { kind: "ai-discovery", directionMethodResourceIds: [] },
        })],
      };
      const strictSchema = toStandardSchema(PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V2.schema as never);
      const runDiscovery = vi.fn(async ({ prompt, runId, sessionId }) => {
        expect(prompt).toContain("origin:{kind:'ai-discovery|expert-sop|hybrid'");
        const validation = await strictSchema["~standard"].validate(proposed);
        expect(validation).not.toEqual(expect.objectContaining({ issues: expect.anything() }));
        return { answer: JSON.stringify(proposed), runId, sessionId };
      });
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        runDiscovery,
      });

      const artifact = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "origin-contract-run",
        sessionId: "origin-contract-session",
      });

      expect(artifact).toMatchObject({
        status: "available",
        publication: { discoveredCount: 1, acceptedCount: 1, rejectedCount: 0 },
        findings: [{
          id: "additional:candidate-origin-contract",
          origin: { kind: "ai-discovery", directionMethods: [] },
        }],
      });
    } finally {
      harness.close();
    }
  });

  it("maps each candidate's stable Method refs to truthful Finding provenance and rejects bad refs locally", async () => {
    const harness = createHarness();
    try {
      const prompts: string[] = [];
      let discoveryCall = 0;
      let publishedMethodResourceId = "";
      const runDiscovery = vi.fn(async ({ prompt, runId, sessionId }) => {
        prompts.push(prompt);
        discoveryCall += 1;
        return {
          answer: JSON.stringify({ candidates: discoveryCall === 1
            ? [candidate("candidate-source", "fact:standby-share", {
                origin: { kind: "ai-discovery", directionMethodResourceIds: [] },
              })]
            : [
                candidate("candidate-core", "fact:standby-share", {
                  origin: { kind: "ai-discovery", directionMethodResourceIds: [] },
                }),
                candidate("candidate-sop", "fact:operating-share", {
                  origin: { kind: "expert-sop", directionMethodResourceIds: [publishedMethodResourceId] },
                }),
                candidate("candidate-unknown", "fact:standby-share", {
                  origin: { kind: "expert-sop", directionMethodResourceIds: ["insight-method:unloaded"] },
                }),
                candidate("candidate-duplicate", "fact:standby-share", {
                  origin: {
                    kind: "expert-sop",
                    directionMethodResourceIds: [publishedMethodResourceId, publishedMethodResourceId],
                  },
                }),
                candidate("candidate-hybrid-too-long", "fact:operating-share", {
                  origin: {
                    kind: "hybrid",
                    directionMethodResourceIds: [publishedMethodResourceId],
                    novelContribution: "x".repeat(801),
                  },
                }),
                candidate("candidate-hybrid", "fact:operating-share", {
                  origin: {
                    kind: "hybrid",
                    directionMethodResourceIds: [publishedMethodResourceId],
                    novelContribution: "Connect the repeated event shape to a separately evidenced operating pattern.",
                  },
                }),
              ] }),
          runId,
          sessionId,
        };
      });
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        runDiscovery,
      });
      const first = await workflow.execute({ baseIdentity: harness.baseIdentity, user: harness.user });
      const guidance = "Compare repeated event shape and timing before treating an isolated spike as a reusable pattern.";
      const provisional = harness.metadata.energyIq.insightMethodGovernance.createProposal({
        expectedWorkspaceId: PRESCHOOL_WORKSPACE_ID,
        expectedProjectId: "preschool-demo",
        artifactId: first.id,
        findingId: "additional:candidate-source",
        actorId: harness.user.id,
        idempotencyKey: "proposal:workflow-method",
        title: "Repeated event shape",
        guidance,
      });
      const inReview = harness.metadata.energyIq.insightMethodGovernance.submitProposal({
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        projectId: "preschool-demo",
        proposalId: provisional.id,
        actorId: harness.user.id,
        expectedRevision: provisional.revision,
      });
      const approved = harness.metadata.energyIq.insightMethodGovernance.approveProposal({
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        projectId: "preschool-demo",
        proposalId: provisional.id,
        actorId: harness.user.id,
        expectedRevision: inReview.revision,
      });
      const published = harness.metadata.energyIq.insightMethodGovernance.publishProposal({
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        projectId: "preschool-demo",
        proposalId: provisional.id,
        actorId: harness.user.id,
        expectedRevision: approved.revision,
      });
      publishedMethodResourceId = published.publication!.method.resourceId;

      const second = await workflow.execute({ baseIdentity: harness.baseIdentity, user: harness.user });
      const result = JSON.parse(second.result_json!) as AdditionalAiInsightsArtifact;

      expect(runDiscovery).toHaveBeenCalledTimes(2);
      expect(second.id).not.toBe(first.id);
      expect(prompts[1]).toContain(guidance);
      expect(prompts[1]).toContain("directionMethodResourceIds");
      expect(result.methodExecution.loadedMethods).toHaveLength(2);
      expect(result.findings.map(({ id }) => id)).toEqual([
        "additional:candidate-core",
        "additional:candidate-sop",
        "additional:candidate-hybrid",
      ]);
      expect(result.findings[0]?.origin).toEqual({
        kind: "ai-discovery",
        coreMethod: result.methodExecution.loadedMethods[0],
        directionMethods: [],
      });
      expect(result.findings[1]?.origin).toMatchObject({
        kind: "expert-sop",
        directionMethods: [expect.objectContaining({
          resourceId: publishedMethodResourceId,
          scope: "workspace",
          workspaceId: PRESCHOOL_WORKSPACE_ID,
          role: "expert-direction",
        })],
      });
      expect(result.findings[2]?.origin).toMatchObject({
        kind: "hybrid",
        directionMethods: [expect.objectContaining({ resourceId: publishedMethodResourceId })],
        novelContribution: "Connect the repeated event shape to a separately evidenced operating pattern.",
      });
      expect(result.publication.rejectedCandidateIds).toEqual([
        "candidate-unknown",
        "candidate-duplicate",
        "candidate-hybrid-too-long",
      ]);
      expect(composePreschoolOverviewAiReadModel({
        metadataStore: harness.metadata,
        baseIdentity: harness.baseIdentity,
      })?.additional).toMatchObject({
        status: "available",
        artifactId: second.id,
      });
    } finally {
      harness.close();
    }
  });

  it("discovers openly, rejects bad candidates locally and publishes at most three in model source order", async () => {
    const harness = createHarness();
    try {
      let receivedPrompt = "";
      const runDiscovery = vi.fn(async ({ prompt, invokeTool, runId, sessionId }) => {
        receivedPrompt = prompt;
        const tool = await invokeTool({
          toolName: "energy.evidence.read",
          toolCallId: "tool-call:discovery:1",
          input: { factIds: ["fact:standby-share"] },
        });
        return {
          answer: JSON.stringify({ candidates: [
            candidate("candidate-pattern", "fact:standby-share", { toolAuditIds: [tool.auditId] }),
            candidate("candidate-forged", "fact:forged"),
            candidate("candidate-compare", "fact:operating-share", { epistemicStatus: "observed" }),
            candidate("candidate-overstated-alert", "fact:partial", {
              epistemicStatus: "speculative",
              alert: { severity: "urgent", certainty: "confirmed", evidenceRefs: ["fact:partial"] },
            }),
            candidate("candidate-counterexample", "fact:standby-share"),
            candidate("candidate-low-risk-test", "fact:operating-share", { epistemicStatus: "speculative" }),
          ] }),
          runId,
          sessionId,
        };
      });
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        runDiscovery,
      });

      const artifact = await workflow.execute({ baseIdentity: harness.baseIdentity, user: harness.user });
      expect(artifact.error_code).toBeUndefined();
      expect(artifact).toMatchObject({ status: "available" });
      expect(receivedPrompt).toContain(ENERGYIQ_OPEN_DISCOVERY_METHOD_CONTENT_V1);
      expect(receivedPrompt).toContain("Zero candidates is valid");
      expect(receivedPrompt).not.toContain("fill every lens");
      expect(receivedPrompt).not.toContain("snapshot-evidence:");
      const result = JSON.parse(artifact.result_json!) as AdditionalAiInsightsArtifact;

      expect(artifact).toMatchObject({
        status: "available",
        attempt_count: 1,
        run_id: expect.stringMatching(/^preschool-additional-ai-insights-/u),
      });
      expect(result.status).toBe("available");
      expect(result.findings.map(({ id }) => id)).toEqual([
        "additional:candidate-pattern",
        "additional:candidate-compare",
        "additional:candidate-counterexample",
      ]);
      expect(result.publication).toMatchObject({
        discoveredCount: 6,
        acceptedCount: 4,
        rejectedCount: 2,
        publishedCount: 3,
        sourceOrderCandidateIds: [
          "candidate-pattern", "candidate-forged", "candidate-compare",
          "candidate-overstated-alert", "candidate-counterexample", "candidate-low-risk-test",
        ],
        acceptedCandidateIds: [
          "candidate-pattern", "candidate-compare", "candidate-counterexample", "candidate-low-risk-test",
        ],
        rejectedCandidateIds: ["candidate-forged", "candidate-overstated-alert"],
        publishedCandidateIds: ["candidate-pattern", "candidate-compare", "candidate-counterexample"],
        suppressedCandidateIds: ["candidate-low-risk-test"],
      });
      expect(result.evidenceLineage.facts.map(({ id }) => id).sort()).toEqual([
        "fact:operating-share", "fact:standby-share",
      ]);
      expect(result.methodExecution.loadedMethods).toHaveLength(1);
      expect(result.toolAudits).toEqual([
        expect.objectContaining({
          auditId: "additional-tool-audit:tool-call:discovery:1",
          status: "succeeded",
        }),
      ]);
    } finally {
      harness.close();
    }
  });

  it("persists a truthful empty result when discovery yields no accepted candidate", async () => {
    const harness = createHarness();
    try {
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [] }),
          runId,
          sessionId,
        }),
      });

      const artifact = await workflow.execute({ baseIdentity: harness.baseIdentity, user: harness.user });
      expect(artifact.error_code).toBeUndefined();
      const result = JSON.parse(artifact.result_json!) as AdditionalAiInsightsArtifact;
      expect(result).toMatchObject({
        status: "empty",
        findings: [],
        publication: {
          discoveredCount: 0,
          acceptedCount: 0,
          rejectedCount: 0,
          publishedCount: 0,
        },
      });
    } finally {
      harness.close();
    }
  });

  it("persists server-accepted Canvas blocks while rejecting a bad sibling block locally", async () => {
    const harness = createHarness();
    try {
      const canvasCandidate = candidate("candidate-canvas", "fact:standby-share", {
        canvas: canvasPlan({
          candidateId: "candidate-canvas",
          title: "Title for candidate-canvas",
          text: "Incremental observation for candidate-canvas.",
        }),
      });
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [canvasCandidate] }),
          runId,
          sessionId,
        }),
      });

      const artifact = await workflow.execute({ baseIdentity: harness.baseIdentity, user: harness.user });
      expect(artifact.error_code).toBeUndefined();
      expect(artifact).toMatchObject({ status: "available" });
      const result = JSON.parse(artifact.result_json!) as AdditionalAiInsightsArtifact;
      expect(result.status).toBe("available");
      if (result.status !== "available") throw new Error("available Additional fixture required");
      expect(result.findings[0]?.canvas).toMatchObject({
        contractRevision: "energyiq-insight-canvas-v2",
        planId: "canvas-plan:additional:candidate-canvas",
        acceptedBlockIds: ["canvas-block:standby-share"],
        acceptedBlocks: [{
          id: "canvas-block:standby-share",
          visualization: "comparison",
          bindings: [{ evidenceRef: "fact:standby-share", value: 31, unit: "%" }],
        }],
        rejections: [{
          code: "EVIDENCE_BINDING_MISMATCH",
          subjectId: "canvas-block:forged",
        }],
      });
      expect(result.evidenceLineage.facts).toContainEqual(expect.objectContaining({
        id: "fact:standby-share",
        metricId: "energy.standby-share",
        value: 31,
        unit: "%",
      }));
    } finally {
      harness.close();
    }
  });

  it("keeps the first three accepted Canvas blocks and records a local rejection for the presentation budget", async () => {
    const harness = createHarness();
    try {
      const plan = canvasPlan({
        candidateId: "candidate-budget",
        title: "Title for candidate-budget",
        text: "Incremental observation for candidate-budget.",
      });
      const acceptedTemplate = plan.investigatorBlocks[0]!;
      plan.investigatorBlocks = Array.from({ length: 4 }, (_, index) => ({
        ...structuredClone(acceptedTemplate),
        id: `canvas-block:accepted-${index + 1}`,
        title: `Accepted block ${index + 1}`,
      }));
      plan.editorPlan.orderedBlockIds = plan.investigatorBlocks.map(({ id }) => id);
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({
            candidates: [candidate("candidate-budget", "fact:standby-share", { canvas: plan })],
          }),
          runId,
          sessionId,
        }),
      });

      const artifact = await workflow.execute({ baseIdentity: harness.baseIdentity, user: harness.user });
      expect(artifact).toMatchObject({ status: "available" });
      const result = JSON.parse(artifact.result_json!) as AdditionalAiInsightsArtifact;
      if (result.status !== "available") throw new Error("available Additional fixture required");
      expect(result.findings[0]?.canvas).toMatchObject({
        acceptedBlockIds: [
          "canvas-block:accepted-1",
          "canvas-block:accepted-2",
          "canvas-block:accepted-3",
        ],
        rejections: [{
          code: "PRESENTATION_BUDGET_EXCEEDED",
          subjectId: "canvas-block:accepted-4",
        }],
      });
    } finally {
      harness.close();
    }
  });

  it("rejects a forged tool audit locally without losing its valid sibling", async () => {
    const harness = createHarness();
    try {
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [
            candidate("candidate-audit-forged", "fact:standby-share", { toolAuditIds: ["audit:forged"] }),
            candidate("candidate-valid", "fact:operating-share"),
          ] }),
          runId,
          sessionId,
        }),
      });

      const artifact = await workflow.execute({ baseIdentity: harness.baseIdentity, user: harness.user });
      const result = JSON.parse(artifact.result_json!) as AdditionalAiInsightsArtifact;
      expect(result.findings.map(({ id }) => id)).toEqual(["additional:candidate-valid"]);
      expect(result.publication.rejectedCandidateIds).toEqual(["candidate-audit-forged"]);
    } finally {
      harness.close();
    }
  });

  it("single-flights exact concurrent and repeated generation without adding Provider runs", async () => {
    const harness = createHarness();
    try {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let started!: () => void;
      const hasStarted = new Promise<void>((resolve) => { started = resolve; });
      const runDiscovery = vi.fn(async ({ runId, sessionId }) => {
        started();
        await gate;
        return {
          answer: JSON.stringify({ candidates: [candidate("candidate-once", "fact:standby-share")] }),
          runId,
          sessionId,
        };
      });
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        runDiscovery,
      });

      const first = workflow.execute({ baseIdentity: harness.baseIdentity, user: harness.user });
      await hasStarted;
      const concurrent = await workflow.execute({ baseIdentity: harness.baseIdentity, user: harness.user });
      expect(concurrent.status).toBe("running");
      expect(runDiscovery).toHaveBeenCalledTimes(1);
      release();
      const completed = await first;
      const repeated = await workflow.execute({ baseIdentity: harness.baseIdentity, user: harness.user });

      expect(completed.status).toBe("available");
      expect(repeated).toEqual(completed);
      expect(runDiscovery).toHaveBeenCalledTimes(1);
    } finally {
      harness.close();
    }
  });

  it("recovers a failed exact Artifact on the next authorized generation attempt", async () => {
    const harness = createHarness();
    try {
      const runDiscovery = vi.fn()
        .mockRejectedValueOnce(new Error("PRESCHOOL_ADDITIONAL_AI_PROVIDER_FAILED"))
        .mockImplementationOnce(async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [candidate("candidate-recovered", "fact:standby-share")] }),
          runId,
          sessionId,
        }));
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        runDiscovery,
      });

      const failed = await workflow.execute({ baseIdentity: harness.baseIdentity, user: harness.user });
      const recovered = await workflow.execute({ baseIdentity: harness.baseIdentity, user: harness.user });

      expect(failed).toMatchObject({
        status: "failed",
        attempt_count: 1,
        error_code: "PRESCHOOL_ADDITIONAL_AI_PROVIDER_FAILED",
      });
      expect(recovered).toMatchObject({ status: "available", attempt_count: 2 });
      expect(runDiscovery).toHaveBeenCalledTimes(2);
    } finally {
      harness.close();
    }
  });
});

const createHarness = () => {
  const root = mkdtempSync(join(tmpdir(), "preschool-additional-workflow-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  metadata.users.upsertDevUser({
    id: "dev-user",
    email: "admin@example.test",
    display_name: "Admin",
    dev_token: "dev-token",
  });
  ensureEnergyIqBootstrap(metadata);
  metadata.configResources.upsert({
    id: "profile-test",
    workspace_id: "default",
    user_id: "dev-user",
    kind: "model-profile",
    name: "Test profile",
    payload: { provider: "openai-compatible", modelName: "model-test" },
    default_enabled: true,
    status: "connected",
  });
  metadata.workspaceDefaultModelProfiles.set({
    workspace_id: "default",
    profile_id: "profile-test",
    profile_owner_user_id: "dev-user",
    configured_by_user_id: "dev-user",
  });
  const user = metadata.users.getById({ user_id: "dev-user" }) as UserRecord;
  const project = metadata.energyIq.getProject("preschool-demo");
  const baseIdentity = createOverviewAiArtifactIdentity({
    workspaceId: PRESCHOOL_WORKSPACE_ID,
    projectId: "preschool-demo",
    scopeId: project.root_scope_id,
    dataSnapshotId: "snapshot-current",
    projectReleaseId: "release-current",
    analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
    analysisPeriodTo: "2026-06-01T00:00:00.000Z",
    rendererKey: "preschool-overview",
    rendererVersion: "1",
    modelProfileId: "workspace-default",
    modelProfileRevision: 1,
  });
  return {
    metadata,
    user,
    baseIdentity,
    additionalIdentity: createPreschoolAdditionalAiInsightArtifactIdentity({ baseIdentity }),
    close: () => {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
};

const candidate = (
  id: string,
  evidenceRef: string,
  overrides: Record<string, unknown> = {},
) => ({
  id,
  title: `Title for ${id}`,
  text: `Incremental observation for ${id}.`,
  epistemicStatus: "inferred",
  origin: { kind: "ai-discovery", directionMethodResourceIds: [] },
  evidenceRefs: [evidenceRef],
  toolAuditIds: [],
  ...overrides,
});

const canvasPlan = (input: { candidateId: string; title: string; text: string }) => ({
  identity: {
    workspaceId: PRESCHOOL_WORKSPACE_ID,
    projectId: "preschool-demo",
    scopeId: "preschool-project",
    dataSnapshotId: "snapshot-current",
    projectReleaseId: "release-current",
  },
  finding: {
    id: input.candidateId,
    title: input.title,
    text: input.text,
    evidenceRefs: ["fact:standby-share"],
    visualNeeded: true,
  },
  investigatorBlocks: [{
    id: "canvas-block:standby-share",
    kind: "quantitative",
    visualization: "comparison",
    title: "Standby share",
    bindings: [{
      evidenceRef: "fact:standby-share",
      entityId: "preschool-project",
      metricId: "energy.standby-share",
      value: 31,
      unit: "%",
    }],
  }, {
    id: "canvas-block:forged",
    kind: "quantitative",
    visualization: "trend",
    title: "Forged trend",
    bindings: [{
      evidenceRef: "fact:standby-share",
      entityId: "preschool-project",
      metricId: "energy.standby-share",
      value: 999,
      unit: "%",
    }],
  }],
  presentationGapRequests: [],
  editorPlan: { orderedBlockIds: ["canvas-block:standby-share", "canvas-block:forged"] },
});

const catalog = (): AnalysisContextEvidenceCatalog => ({
  contract: "analysis-context-evidence@1",
  sourceId: "project-analysis-snapshot:preschool-demo:snapshot-current",
  pins: {
    workspaceId: PRESCHOOL_WORKSPACE_ID,
    projectId: "preschool-demo",
    scopeId: "preschool-project",
    dataSnapshotId: "snapshot-current",
    dataCutoff: "2026-06-01T00:00:00.000Z",
    projectReleaseId: "release-current",
    metricVersion: "energy-metrics-v1",
  },
  facts: [
    fact("fact:standby-share", "confirmed", 31),
    fact("fact:operating-share", "confirmed", 69),
    fact("fact:partial", "partial", 12),
  ],
});

const fact = (
  id: string,
  status: "confirmed" | "provisional" | "partial",
  value: number,
) => ({
  id,
  label: id,
  metricId: id.replace("fact:", "energy."),
  value,
  unit: "%",
  status,
  evidenceRefs: [`snapshot-evidence:${id}`],
  dimensions: {},
});
