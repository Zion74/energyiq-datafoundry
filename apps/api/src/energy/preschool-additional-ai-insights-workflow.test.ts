import type { AnalysisContextEvidenceCatalog } from "@datafoundry/agent-runtime";
import {
  ENERGYIQ_OPEN_DISCOVERY_METHOD_CONTENT_V1,
  type AdditionalAiInsightsArtifact,
} from "@datafoundry/contracts";
import { createMetadataStore, type UserRecord } from "@datafoundry/metadata";
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

describe("Preschool Additional AI Insights workflow", () => {
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
