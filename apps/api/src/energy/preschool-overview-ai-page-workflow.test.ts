import type { LocalDataGateway } from "@datafoundry/data-gateway";
import {
  WORKSPACE_DEFAULT_MODEL_PROFILE_ID,
  createMetadataStore,
  type EnergyIqOverviewAiArtifactIdentity,
} from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { PRESCHOOL_SECTION_IDS, type PreschoolSectionId } from "./preschool-overview-ai-contracts.js";
import {
  createOverviewAiArtifactIdentity,
  createPreschoolOverviewAiSectionArtifactIdentityV3,
  createPreschoolOverviewAiSectionArtifactIdentityV4,
} from "./overview-ai-artifact.js";
import {
  arePreschoolSectionArtifactsTerminal,
  createPreschoolOverviewAiPageWorkflow,
} from "./preschool-overview-ai-page-workflow.js";
import type { ProjectAnalysisSnapshot } from "./project-analysis-resolver.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Preschool Overview AI page workflow", () => {
  it("waits to synthesize while any independently claimed Section is queued or running", () => {
    expect(arePreschoolSectionArtifactsTerminal(statuses({ "standby-wastage": "running" }))).toBe(false);
    expect(arePreschoolSectionArtifactsTerminal(statuses({ "planning-outlook": "queued" }))).toBe(false);
  });

  it("allows synthesis after every Section reaches an available or failed terminal state", () => {
    expect(arePreschoolSectionArtifactsTerminal(statuses({}))).toBe(true);
    expect(arePreschoolSectionArtifactsTerminal(statuses({ "standby-wastage": "failed" }))).toBe(true);
  });

  it("reads only exact current-v4 Artifacts without ensuring or calling either Provider", async () => {
    const harness = createHarness();
    const legacy = completeSectionV3(harness, "centre-benchmark", "Legacy summary must not win.");
    const current = completeSectionV4(harness, "centre-benchmark", "Current v4 summary wins.");
    let sectionProviderCalls = 0;
    let executiveProviderCalls = 0;
    const workflow = createPreschoolOverviewAiPageWorkflow({
      metadataStore: harness.metadata,
      dataGateway: {} as LocalDataGateway,
      runSection: async () => {
        sectionProviderCalls += 1;
        throw new Error("READ_MUST_NOT_CALL_SECTION_PROVIDER");
      },
      runExecutiveSynthesis: async () => {
        executiveProviderCalls += 1;
        throw new Error("READ_MUST_NOT_CALL_EXECUTIVE_PROVIDER");
      },
    });

    const first = await workflow.read({ identity: harness.identity, user: harness.user });
    const second = await workflow.read({ identity: harness.identity, user: harness.user });
    const baseArtifact = harness.metadata.energyIq.overviewAiArtifacts.find(harness.identity);
    harness.close();

    expect(first).toEqual(second);
    expect(first?.sections["centre-benchmark"]).toMatchObject({
      status: "available",
      artifactId: current.id,
      result: {
        contract: { revision: "preschool-section-interpretation-v4" },
        packRevision: "v2",
        summary: { text: "Current v4 summary wins." },
      },
    });
    expect(first?.sections["centre-benchmark"]).not.toMatchObject({ artifactId: legacy.id });
    expect(sectionProviderCalls).toBe(0);
    expect(executiveProviderCalls).toBe(0);
    expect(baseArtifact).toBeUndefined();
  });

  it("executes four independent current-v4 Sections from complete Pack-v2 inputs before composing Key Findings", async () => {
    const harness = createHarness();
    const sectionCalls: Array<{
      identity: EnergyIqOverviewAiArtifactIdentity;
      prompt: string;
      structuredOutput: unknown;
    }> = [];
    let executiveProviderCalls = 0;
    const workflow = createPreschoolOverviewAiPageWorkflow({
      metadataStore: harness.metadata,
      dataGateway: {} as LocalDataGateway,
      resolveSnapshot: async () => emptySnapshot(),
      runSection: async ({ identity, prompt, structuredOutput, runId, sessionId }) => {
        sectionCalls.push({ identity, prompt, structuredOutput });
        return {
          answer: JSON.stringify({ sectionId: identity.targetId, status: "empty", candidates: [] }),
          runId,
          sessionId,
        };
      },
      runExecutiveSynthesis: async ({ runId, sessionId }) => {
        executiveProviderCalls += 1;
        return { answer: JSON.stringify({ status: "empty", findings: [] }), runId, sessionId };
      },
    });

    const result = await workflow.execute({
      identity: harness.identity,
      user: harness.user,
      retry: false,
    });
    harness.close();

    expect(sectionCalls).toHaveLength(4);
    expect(sectionCalls.map(({ identity }) => identity.targetId).sort()).toEqual([...PRESCHOOL_SECTION_IDS].sort());
    for (const call of sectionCalls) {
      expect(call.identity).toMatchObject({
        artifactKind: "section-interpretation",
        identityContractRevision: "v4",
        analysisPackId: "preschool-section-pack",
        analysisPackRevision: "v2",
        outputContractRevision: "preschool-section-interpretation-v4",
        capabilityRevision: "pack-only-v1",
        publicationRevision: "v1",
      });
      expect(call.structuredOutput).toBeDefined();
      expect(call.prompt).toContain('"sourcePackRevision":"preschool-section-pack-v2"');
      expect(call.prompt).not.toContain("allowedNextChecks");
    }
    expect(PRESCHOOL_SECTION_IDS.map((sectionId) => result.sections[sectionId].status)).toEqual([
      "empty",
      "empty",
      "empty",
      "empty",
    ]);
    expect(executiveProviderCalls).toBe(0);
  });
});

const statuses = (
  overrides: Partial<Record<PreschoolSectionId, "queued" | "running" | "available" | "failed">>,
) => Object.fromEntries(PRESCHOOL_SECTION_IDS.map((sectionId) => [
  sectionId,
  { status: overrides[sectionId] ?? "available" },
])) as Record<PreschoolSectionId, { status: "queued" | "running" | "available" | "failed" }>;

const createHarness = () => {
  const root = mkdtempSync(join(tmpdir(), "preschool-page-v4-red-"));
  roots.push(root);
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  metadata.users.upsertDevUser({ id: "dev-user", email: "dev@example.test", display_name: "Dev", dev_token: "dev" });
  metadata.workspaces.upsert({ id: "default", owner_user_id: "dev-user", name: "System", kind: "personal" });
  metadata.workspaces.upsert({ id: "preschool-workspace", owner_user_id: "dev-user", name: "Preschool", kind: "customer" });
  metadata.energyIq.upsertProject({
    id: "preschool-demo",
    workspace_id: "preschool-workspace",
    name: "Preschool",
    status: "published",
    root_scope_id: "preschool-project",
  });
  metadata.configResources.upsert({
    id: "profile-current",
    workspace_id: "default",
    user_id: "dev-user",
    kind: "model-profile",
    name: "Current model",
    payload: { provider: "openai-compatible", modelName: "test-model" },
    default_enabled: true,
    status: "connected",
  });
  metadata.workspaceDefaultModelProfiles.set({
    workspace_id: "default",
    profile_id: "profile-current",
    profile_owner_user_id: "dev-user",
    configured_by_user_id: "dev-user",
  });
  return {
    metadata,
    identity: createOverviewAiArtifactIdentity({
      workspaceId: "preschool-workspace",
      projectId: "preschool-demo",
      scopeId: "preschool-project",
      dataSnapshotId: "snapshot-current",
      projectReleaseId: "release-current",
      analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
      analysisPeriodTo: "2026-06-01T00:00:00.000Z",
      rendererKey: "preschool-overview",
      rendererVersion: "1",
      modelProfileId: WORKSPACE_DEFAULT_MODEL_PROFILE_ID,
      modelProfileRevision: 1,
    }),
    user: metadata.users.getById({ user_id: "dev-user" }),
    close: () => metadata.close(),
  };
};

const completeSectionV3 = (
  harness: ReturnType<typeof createHarness>,
  sectionId: PreschoolSectionId,
  summary: string,
) => {
  const identity = createPreschoolOverviewAiSectionArtifactIdentityV3({ baseIdentity: harness.identity, targetId: sectionId });
  return completeArtifact(harness, identity, {
    artifactKind: "section-interpretation",
    status: "available",
    providerProfileId: identity.modelProfileId,
    runId: `run:v3:${sectionId}`,
    contract: { id: "preschool-section-interpretation", revision: "preschool-section-interpretation-v3" },
    binding: binding(identity),
    sectionId,
    summary,
    keyPoints: [{ kind: "finding", text: "Legacy evidence.", evidenceRefs: [`evidence:v3:${sectionId}`] }],
  });
};

const completeSectionV4 = (
  harness: ReturnType<typeof createHarness>,
  sectionId: PreschoolSectionId,
  summary: string,
) => {
  const identity = createPreschoolOverviewAiSectionArtifactIdentityV4({ baseIdentity: harness.identity, targetId: sectionId });
  return completeArtifact(harness, identity, {
    artifactKind: "section-interpretation",
    status: "available",
    providerProfileId: identity.modelProfileId,
    runId: `run:v4:${sectionId}`,
    contract: { id: "preschool-section-interpretation", revision: "preschool-section-interpretation-v4" },
    binding: binding(identity),
    sectionId,
    packRevision: "v2",
    capability: { revision: "pack-only-v1", mode: "pack-only", tools: [] },
    summary: { text: summary, evidenceRefs: [`evidence:v4:${sectionId}`] },
    insights: [],
    publication: {
      policyId: "preschool-section-publication",
      policyRevision: "v1",
      discoveredCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      publishedCount: 0,
      suppressedCandidateIds: [],
    },
  });
};

const completeArtifact = (
  harness: ReturnType<typeof createHarness>,
  identity: EnergyIqOverviewAiArtifactIdentity,
  result: Record<string, unknown>,
) => {
  harness.metadata.energyIq.overviewAiArtifacts.queue({ identity, triggeredBy: harness.user.id });
  const workerId = `worker:${identity.outputContractRevision}:${identity.targetId}`;
  harness.metadata.energyIq.overviewAiArtifacts.claim({ identity, workerId, leaseMs: 60_000 });
  return harness.metadata.energyIq.overviewAiArtifacts.complete({
    identity,
    workerId,
    sessionId: `session:${identity.targetId}`,
    runId: String(result.runId),
    resultJson: JSON.stringify(result),
  });
};

const binding = (identity: EnergyIqOverviewAiArtifactIdentity) => ({
  workspaceId: identity.workspaceId,
  projectId: "preschool-demo",
  scopeId: identity.scopeId,
  dataSnapshotId: identity.dataSnapshotId,
  projectReleaseId: identity.projectReleaseId,
  analysisPeriod: { from: identity.analysisPeriodFrom, to: identity.analysisPeriodTo },
  modelProfileId: identity.modelProfileId,
  modelProfileRevision: identity.modelProfileRevision,
});

const emptySnapshot = (): ProjectAnalysisSnapshot => ({
  context: {
    userId: "dev-user",
    workspaceId: "preschool-workspace",
    projectId: "preschool-demo",
    projectName: "Preschool",
    scopeId: "preschool-project",
    scopeName: "All centres",
    scopeType: "project",
    resource: "electricity",
    timezone: "Asia/Singapore",
    from: "2026-05-01T00:00:00.000Z",
    to: "2026-06-01T00:00:00.000Z",
    endExclusive: true,
    period: "Custom",
    hierarchyRevisionId: "hierarchy-1",
    meterMappingRevisionId: "mapping-1",
    meterFormulaRevisionId: "formula-1",
    dataSnapshotId: "snapshot-current",
    metricVersion: "metrics-1",
    businessCalendarVersion: "calendar-1",
    tariffScheduleVersion: "tariff-1",
    primaryPeriod: { start: "2026-05-01T00:00:00.000Z", endExclusive: "2026-06-01T00:00:00.000Z" },
    projectReleaseId: "release-current",
  },
  projectRelease: {
    id: "release-current",
    renderer: { key: "preschool-overview", version: "1", contractVersion: "project-analysis-snapshot@1" },
  },
  renderer: { key: "preschool-overview", version: "1", contractVersion: "project-analysis-snapshot@1" },
  dataSnapshot: { id: "snapshot-current", importBatchIds: [], lastSeenAt: null },
  dataQuality: {
    status: "complete",
    coveragePct: 100,
    validIntervalCount: 0,
    expectedMeterIntervalCount: 0,
    qualityEventCount: 0,
  },
  analysis: { summary: { usageKwh: 0, averageDailyUsageKwh: 0 }, childScopes: [] },
} as unknown as ProjectAnalysisSnapshot);
