import { LocalDataGateway } from "@datafoundry/data-gateway";
import { createMetadataStore, type EnergyIqOverviewAiArtifactIdentity } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ProjectAnalysisSnapshot } from "./project-analysis-resolver.js";
import {
  createPreschoolOverviewAiWorkflow,
  type PreschoolOverviewAiStageRunner,
} from "./preschool-overview-ai-workflow.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Preschool Overview AI server workflow", () => {
  it("single-flights two authorized callers and commits one canonical two-stage Artifact", async () => {
    const harness = createHarness();
    let releaseInvestigator!: () => void;
    const investigatorGate = new Promise<void>((resolve) => { releaseInvestigator = resolve; });
    const stages: string[] = [];
    const runStage: PreschoolOverviewAiStageRunner = async ({ stage, runId, sessionId }) => {
      stages.push(stage);
      if (stage === "investigator") await investigatorGate;
      return stageEvents(stage, runId, sessionId);
    };
    const workflow = createPreschoolOverviewAiWorkflow({
      metadataStore: harness.metadata,
      dataGateway: harness.gateway,
      runStage,
      resolveSnapshot: async () => snapshot(),
    });

    const owner = workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
    await until(() => harness.metadata.energyIq.overviewAiArtifacts.get(harness.identity).status === "running");
    const waiting = await workflow.execute({ identity: harness.identity, user: harness.secondUser, retry: false });
    expect(waiting).toMatchObject({ status: "running", attempt_count: 1 });
    expect(stages).toEqual(["investigator"]);

    releaseInvestigator();
    const available = await owner;
    expect(available).toMatchObject({ status: "available", attempt_count: 1 });
    expect(stages).toEqual(["investigator", "editor"]);
    const result = JSON.parse(available.result_json!) as Record<string, unknown>;
    expect(result).toMatchObject({
      status: "available",
      providerProfileId: harness.identity.modelProfileId,
      binding: {
        dataSnapshotId: harness.identity.dataSnapshotId,
        projectReleaseId: harness.identity.projectReleaseId,
        analysisPeriod: {
          from: harness.identity.analysisPeriodFrom,
          to: harness.identity.analysisPeriodTo,
        },
      },
      workflow: {
        revision: harness.identity.workflowRevision,
        stages: {
          investigator: { promptRevision: harness.identity.investigatorPromptRevision },
          editor: { promptRevision: harness.identity.editorPromptRevision },
        },
      },
      findings: [{ placementTargets: ["preschool.benchmark"], epistemicLevel: "hypothesis" }],
    });
    expect((result.workflow as { editorTrace: unknown[] }).editorTrace).toHaveLength(1);

    const restored = await workflow.execute({ identity: harness.identity, user: harness.secondUser, retry: true });
    expect(restored).toEqual(available);
    expect(stages).toHaveLength(2);
    harness.close();
  });

  it("requires an explicit retry, caps the identity at two attempts, and never reruns available", async () => {
    const harness = createHarness();
    let shouldFail = true;
    let calls = 0;
    const workflow = createPreschoolOverviewAiWorkflow({
      metadataStore: harness.metadata,
      dataGateway: harness.gateway,
      resolveSnapshot: async () => snapshot(),
      runStage: async ({ stage, runId, sessionId }) => {
        calls += 1;
        if (shouldFail) return {
          events: [{ type: "RUN_ERROR", message: "temporary provider failure" }],
          completedRun: { runId, sessionId },
        };
        return stageEvents(stage, runId, sessionId);
      },
    });

    const failed = await workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
    expect(failed).toMatchObject({ status: "failed", attempt_count: 1 });
    expect(calls).toBe(1);
    expect(await workflow.execute({ identity: harness.identity, user: harness.secondUser, retry: false }))
      .toEqual(failed);
    expect(calls).toBe(1);

    shouldFail = false;
    const retried = await workflow.execute({ identity: harness.identity, user: harness.secondUser, retry: true });
    expect(retried).toMatchObject({ status: "available", attempt_count: 2 });
    expect(calls).toBe(3);
    expect(await workflow.execute({ identity: harness.identity, user: harness.user, retry: true }))
      .toEqual(retried);
    expect(calls).toBe(3);
    harness.close();
  });

  it("fails closed for a stale Snapshot and accepts an empty Editor result without filler", async () => {
    const staleHarness = createHarness();
    let calls = 0;
    const staleWorkflow = createPreschoolOverviewAiWorkflow({
      metadataStore: staleHarness.metadata,
      dataGateway: staleHarness.gateway,
      resolveSnapshot: async () => snapshot({ dataSnapshotId: "snapshot-old" }),
      runStage: async ({ stage, runId, sessionId }) => { calls += 1; return stageEvents(stage, runId, sessionId); },
    });
    const stale = await staleWorkflow.execute({ identity: staleHarness.identity, user: staleHarness.user, retry: false });
    expect(stale).toMatchObject({ status: "failed", error_code: "OVERVIEW_AI_SNAPSHOT_IDENTITY_MISMATCH" });
    expect(calls).toBe(0);
    staleHarness.close();

    const emptyHarness = createHarness();
    const emptyWorkflow = createPreschoolOverviewAiWorkflow({
      metadataStore: emptyHarness.metadata,
      dataGateway: emptyHarness.gateway,
      resolveSnapshot: async () => snapshot(),
      runStage: async ({ stage, runId, sessionId }) => stage === "investigator"
        ? envelopeEvents({ candidates: [] }, runId, sessionId)
        : envelopeEvents({ findings: [], trace: [] }, runId, sessionId),
    });
    const empty = await emptyWorkflow.execute({ identity: emptyHarness.identity, user: emptyHarness.user, retry: false });
    expect(empty.status).toBe("available");
    expect(JSON.parse(empty.result_json!) as Record<string, unknown>).toMatchObject({ findings: [] });
    emptyHarness.close();
  });

  it("drops an unsupported finding instead of rewriting it and rejects unverified Runtime provenance", async () => {
    const validatorHarness = createHarness();
    const validatorWorkflow = createPreschoolOverviewAiWorkflow({
      metadataStore: validatorHarness.metadata,
      dataGateway: validatorHarness.gateway,
      resolveSnapshot: async () => snapshot(),
      runStage: async ({ stage, runId, sessionId }) => stage === "investigator"
        ? stageEvents(stage, runId, sessionId)
        : envelopeEvents({
            findings: [{
              sourceCandidateIds: ["candidate-1"],
              placementTargets: ["preschool.benchmark"],
              epistemicLevel: "hypothesis",
              relationship: "independent",
              signalRefs: ["efficiency"],
              title: "Unsupported savings claim",
              takeaway: "The intervention will save 37%.",
              verification: "Measure the result on a later Snapshot.",
              evidenceRefs: ["benchmark:portfolio-p75"],
              evidenceSqlIndexes: [],
            }],
            trace: [{ decision: "accepted", sourceCandidateIds: ["candidate-1"] }],
          }, runId, sessionId),
    });
    const validated = await validatorWorkflow.execute({ identity: validatorHarness.identity, user: validatorHarness.user, retry: false });
    expect(validated.status).toBe("available");
    expect(JSON.parse(validated.result_json!) as Record<string, unknown>).toMatchObject({ findings: [] });
    validatorHarness.close();

    const provenanceHarness = createHarness();
    const provenanceWorkflow = createPreschoolOverviewAiWorkflow({
      metadataStore: provenanceHarness.metadata,
      dataGateway: provenanceHarness.gateway,
      resolveSnapshot: async () => snapshot(),
      runStage: async ({ stage, runId, sessionId }) => ({
        ...stageEvents(stage, runId, sessionId),
        completedRun: { runId: "different-runtime-run", sessionId },
      }),
    });
    const rejected = await provenanceWorkflow.execute({ identity: provenanceHarness.identity, user: provenanceHarness.user, retry: false });
    expect(rejected).toMatchObject({ status: "failed", error_code: "OVERVIEW_AI_RUNTIME_RUN_IDENTITY_MISMATCH" });
    provenanceHarness.close();
  });

  it("does not let a Centre count authorize an energy claim with the same number", async () => {
    const harness = createHarness();
    const workflow = createPreschoolOverviewAiWorkflow({
      metadataStore: harness.metadata,
      dataGateway: harness.gateway,
      resolveSnapshot: async () => snapshot(),
      runStage: async ({ stage, runId, sessionId }) => stage === "investigator"
        ? stageEvents(stage, runId, sessionId)
        : envelopeEvents({
            findings: [{
              sourceCandidateIds: ["candidate-1"],
              placementTargets: ["preschool.forecast"],
              epistemicLevel: "verified",
              relationship: "independent",
              signalRefs: [],
              title: "Aircon uses 30 kWh",
              takeaway: "The current Snapshot shows 30 kWh for the Aircon contribution.",
              evidenceRefs: ["circuit:appliance:Aircon 1"],
              evidenceSqlIndexes: [],
            }],
            trace: [{ decision: "accepted", sourceCandidateIds: ["candidate-1"] }],
          }, runId, sessionId),
    });

    const artifact = await workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
    harness.close();

    expect(artifact.status).toBe("available");
    expect(JSON.parse(artifact.result_json!) as Record<string, unknown>).toMatchObject({ findings: [] });
  });

  it("binds a deterministic metric value to the same cited Centre", async () => {
    const harness = createHarness();
    const currentSnapshot = snapshot();
    const benchmark = currentSnapshot.preschoolBenchmark;
    if (!benchmark || benchmark.status !== "provisional") throw new Error("Expected benchmark fixture");
    benchmark.priorityCentreCodes = ["A1", "E"];
    benchmark.centres = [
      {
        scopeId: "centre-a1",
        centreCode: "A1",
        name: "Centre A1",
        cohort: "Childcare",
        usageKwh: 100,
        annualisedEuiKwhPerSqmYear: 120,
        mayKwhPerPerson: 30,
        quadrant: "priority",
        priority: true,
      },
      {
        scopeId: "centre-e",
        centreCode: "E",
        name: "Centre E",
        cohort: "Childcare",
        usageKwh: 300,
        annualisedEuiKwhPerSqmYear: 140,
        mayKwhPerPerson: 35,
        quadrant: "priority",
        priority: true,
      },
    ];
    const workflow = createPreschoolOverviewAiWorkflow({
      metadataStore: harness.metadata,
      dataGateway: harness.gateway,
      resolveSnapshot: async () => currentSnapshot,
      runStage: async ({ stage, runId, sessionId }) => stage === "investigator"
        ? stageEvents(stage, runId, sessionId)
        : envelopeEvents({
            findings: [{
              sourceCandidateIds: ["candidate-1"],
              placementTargets: ["preschool.benchmark"],
              epistemicLevel: "verified",
              relationship: "independent",
              signalRefs: [],
              title: "Centre A1 used 300 kWh",
              takeaway: "Centre A1 recorded 300 kWh in the current period.",
              evidenceRefs: ["benchmark:priority-centre:A1", "benchmark:priority-centre:E"],
              evidenceSqlIndexes: [],
            }],
            trace: [{ decision: "accepted", sourceCandidateIds: ["candidate-1"] }],
          }, runId, sessionId),
    });

    const artifact = await workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
    harness.close();

    expect(JSON.parse(artifact.result_json!) as Record<string, unknown>).toMatchObject({ findings: [] });
  });

  it("accepts manager-facing percentage rounding from the same typed metric", async () => {
    const harness = createHarness();
    const currentSnapshot = snapshot();
    const operational = currentSnapshot.preschoolOperational;
    if (!operational || operational.status !== "available") throw new Error("Expected operational fixture");
    operational.energy.standbySharePct = 51.96;
    const workflow = createPreschoolOverviewAiWorkflow({
      metadataStore: harness.metadata,
      dataGateway: harness.gateway,
      resolveSnapshot: async () => currentSnapshot,
      runStage: async ({ stage, runId, sessionId }) => stage === "investigator"
        ? stageEvents(stage, runId, sessionId)
        : envelopeEvents({
            findings: [{
              sourceCandidateIds: ["candidate-1"],
              placementTargets: ["preschool.standby"],
              epistemicLevel: "verified",
              relationship: "independent",
              signalRefs: [],
              title: "Standby accounts for 52% of energy",
              takeaway: "The current standby share rounds to 52%.",
              evidenceRefs: ["operating:portfolio"],
              evidenceSqlIndexes: [],
            }],
            trace: [{ decision: "accepted", sourceCandidateIds: ["candidate-1"] }],
          }, runId, sessionId),
    });

    const artifact = await workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
    harness.close();

    expect(JSON.parse(artifact.result_json!) as Record<string, unknown>).toMatchObject({
      findings: [{ title: "Standby accounts for 52% of energy" }],
    });
  });

  it("binds SQL metric values and Centre identity to the same returned row", async () => {
    const harness = createHarness();
    const workflow = createPreschoolOverviewAiWorkflow({
      metadataStore: harness.metadata,
      dataGateway: harness.gateway,
      resolveSnapshot: async () => snapshot(),
      runStage: async ({ stage, runId, sessionId }) => stage === "investigator"
        ? stageEvents(stage, runId, sessionId)
        : sqlEnvelopeEvents({
            findings: [
              {
                sourceCandidateIds: ["candidate-1"],
                placementTargets: ["preschool.benchmark"],
                epistemicLevel: "verified",
                relationship: "independent",
                signalRefs: [],
                title: "Centre A1 used 300 kWh",
                takeaway: "Centre A1 recorded 300 kWh in the scoped query.",
                evidenceRefs: [],
                evidenceSqlIndexes: [1],
              },
              {
                sourceCandidateIds: ["candidate-1"],
                placementTargets: ["preschool.benchmark"],
                epistemicLevel: "verified",
                relationship: "independent",
                signalRefs: [],
                title: "Centre E used 300 kWh",
                takeaway: "Centre E recorded 300 kWh in the scoped query.",
                evidenceRefs: [],
                evidenceSqlIndexes: [1],
              },
            ],
            trace: [{ decision: "accepted", sourceCandidateIds: ["candidate-1"] }],
          }, runId, sessionId),
    });

    const artifact = await workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
    harness.close();

    expect(JSON.parse(artifact.result_json!) as Record<string, unknown>).toMatchObject({
      findings: [{ title: "Centre E used 300 kWh" }],
    });
  });

  it("fails before Provider when model binding or Method Skill revision drifts", async () => {
    const modelHarness = createHarness();
    modelHarness.metadata.workspaceDefaultModelProfiles.set({
      workspace_id: modelHarness.identity.workspaceId,
      profile_id: modelHarness.identity.modelProfileId,
      profile_owner_user_id: modelHarness.user.id,
      configured_by_user_id: modelHarness.user.id,
      expected_revision: modelHarness.identity.modelProfileRevision,
    });
    let modelCalls = 0;
    const modelWorkflow = createPreschoolOverviewAiWorkflow({
      metadataStore: modelHarness.metadata,
      dataGateway: modelHarness.gateway,
      resolveSnapshot: async () => snapshot(),
      runStage: async ({ stage, runId, sessionId }) => { modelCalls += 1; return stageEvents(stage, runId, sessionId); },
    });
    const modelResult = await modelWorkflow.execute({ identity: modelHarness.identity, user: modelHarness.user, retry: false });
    modelHarness.close();
    expect(modelResult).toMatchObject({ status: "failed", error_code: "OVERVIEW_AI_MODEL_PROFILE_REVISION_MISMATCH" });
    expect(modelCalls).toBe(0);

    const skillHarness = createHarness();
    const skill = skillHarness.metadata.configResources.get({
      workspace_id: skillHarness.identity.workspaceId,
      user_id: skillHarness.user.id,
      kind: "skill",
      id: skillHarness.identity.methodSkillId,
    });
    skillHarness.metadata.configResources.upsert({
      workspace_id: skill.workspace_id,
      user_id: skill.user_id,
      kind: "skill",
      id: skill.id,
      name: skill.name,
      payload: { ...skill.payload, version: "2.0.0" },
      builtin: skill.builtin,
      default_enabled: skill.default_enabled,
      status: skill.status,
      expected_revision: skill.revision,
    });
    let skillCalls = 0;
    const skillWorkflow = createPreschoolOverviewAiWorkflow({
      metadataStore: skillHarness.metadata,
      dataGateway: skillHarness.gateway,
      resolveSnapshot: async () => snapshot(),
      runStage: async ({ stage, runId, sessionId }) => { skillCalls += 1; return stageEvents(stage, runId, sessionId); },
    });
    const skillResult = await skillWorkflow.execute({ identity: skillHarness.identity, user: skillHarness.user, retry: false });
    skillHarness.close();
    expect(skillResult).toMatchObject({ status: "failed", error_code: "OVERVIEW_AI_METHOD_SKILL_REVISION_MISMATCH" });
    expect(skillCalls).toBe(0);
  });
});

function createHarness() {
  const root = mkdtempSync(join(tmpdir(), "preschool-overview-ai-server-"));
  roots.push(root);
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  metadata.users.upsertDevUser({ id: "dev-user", email: "dev@example.test", display_name: "Dev", dev_token: "dev" });
  metadata.users.upsertDevUser({ id: "second-user", email: "second@example.test", display_name: "Second", dev_token: "second" });
  metadata.workspaces.upsert({ id: "preschool-workspace", owner_user_id: "dev-user", name: "Preschool", kind: "customer" });
  metadata.workspaceMemberships.upsert({ workspace_id: "preschool-workspace", user_id: "second-user", role: "member" });
  metadata.energyIq.upsertProject({
    id: "preschool-demo",
    workspace_id: "preschool-workspace",
    name: "Preschool",
    status: "published",
    root_scope_id: "preschool-project",
  });
  metadata.configResources.upsert({
    id: "profile-current",
    workspace_id: "preschool-workspace",
    user_id: "dev-user",
    kind: "model-profile",
    name: "Current model",
    payload: { provider: "openai-compatible", modelName: "test-model" },
    default_enabled: true,
    status: "connected",
  });
  metadata.workspaceDefaultModelProfiles.set({
    workspace_id: "preschool-workspace",
    profile_id: "profile-current",
    profile_owner_user_id: "dev-user",
    configured_by_user_id: "dev-user",
  });
  for (const userId of ["dev-user", "second-user"]) {
    metadata.configResources.upsert({
      id: "energy-insight-investigation",
      workspace_id: "preschool-workspace",
      user_id: userId,
      kind: "skill",
      name: "energy-insight-investigation",
      payload: { version: "1.0.0", userInvocable: true },
      builtin: true,
      default_enabled: false,
      status: "valid",
    });
  }
  const identity: EnergyIqOverviewAiArtifactIdentity = {
    workspaceId: "preschool-workspace",
    projectId: "preschool-demo",
    scopeId: "preschool-project",
    resource: "electricity",
    dataSnapshotId: "snapshot-current",
    projectReleaseId: "release-current",
    analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
    analysisPeriodTo: "2026-06-01T00:00:00.000Z",
    rendererKey: "preschool-overview",
    rendererVersion: "1",
    analysisPackId: "preschool-analysis-pack",
    analysisPackRevision: "v1",
    modelProfileId: "profile-current",
    modelProfileRevision: 1,
    outputContractRevision: "v13",
    validatorRevision: "preschool-ai-two-stage-fact-boundary-v1",
    workflowRevision: "preschool-two-stage-v1",
    investigatorPromptRevision: "preschool-investigator-v1",
    editorPromptRevision: "preschool-insight-editor-v1",
    methodSkillId: "energy-insight-investigation",
    methodSkillRevision: "1.0.0",
  };
  return {
    metadata,
    gateway: new LocalDataGateway(metadata),
    identity,
    user: metadata.users.getById({ user_id: "dev-user" }),
    secondUser: metadata.users.getById({ user_id: "second-user" }),
    close: () => metadata.close(),
  };
}

function snapshot(options: { dataSnapshotId?: string } = {}): ProjectAnalysisSnapshot {
  const dataSnapshotId = options.dataSnapshotId ?? "snapshot-current";
  return {
    context: {
      userId: "dev-user",
      workspaceId: "preschool-workspace",
      projectId: "preschool-demo",
      projectName: "Preschool",
      scopeId: "preschool-project",
      scopeName: "Portfolio",
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
      dataSnapshotId,
      metricVersion: "metric-revisions:metric-1",
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
    dataSnapshot: { id: dataSnapshotId, importBatchIds: ["batch-1"], lastSeenAt: null },
    dataQuality: { status: "complete", coveragePct: 100, validIntervalCount: 100, expectedMeterIntervalCount: 100, qualityEventCount: 0 },
    analysis: {
      summary: { usageKwh: 1000, averageDailyUsageKwh: 32.25 },
      childScopes: [{ nodeId: "centre-a1", name: "Centre A1", usageKwh: 100 }],
    },
    preschoolBenchmark: {
      status: "provisional",
      sampleSize: 30,
      portfolio: { eui: { p50: 80, p75: 100, unit: "kWh/m2/year" }, perPax: { p50: 20, p75: 25, unit: "kWh/person/month" } },
      priorityCentreCodes: ["A1"],
      centres: [{ centreCode: "A1", cohort: "Childcare", usageKwh: 100, annualisedEuiKwhPerSqmYear: 120, mayKwhPerPerson: 30, quadrant: "priority" }],
      evidence: { metadataStatus: "provisional", sourceQueryIds: ["benchmark-query"] },
    },
    preschoolAppliances: {
      status: "available",
      appliances: [{ name: "Aircon 1", applianceGroup: "Aircon", usageKwh: 400, sharePct: 40, centreCount: 30 }],
      evidence: { projectionRecipeId: "preschool-appliance-ranking-v1" },
    },
    preschoolOperational: {
      status: "available",
      energy: { totalKwh: 1000, standbyKwh: 200, standbySharePct: 20, operatingKwh: 800 },
      spikes: {
        standby: { count: 3, centreCount: 1, centres: [{ centreCode: "A1" }] },
        operating: { count: 2, centreCount: 1, centres: [{ centreCode: "A1" }] },
      },
      sop: { label: "Provisional after-hours SOP signal", status: "provisional", breachingCentreCodes: ["A1"] },
    },
    preschoolDecisionSignals: {
      status: "available",
      context: { dataSnapshotId, projectReleaseId: "release-current" },
      items: [{
        id: "efficiency",
        label: "High for both floor area and headcount",
        metrics: [{ id: "priority-centres", metricId: "priority_count", value: 1, unit: "count" }],
        limitations: [{ label: "Provisional metadata" }],
      }],
    },
  } as unknown as ProjectAnalysisSnapshot;
}

function stageEvents(stage: "investigator" | "editor", runId: string, sessionId: string) {
  return stage === "investigator"
    ? envelopeEvents({
        candidates: [{
          id: "candidate-1",
          epistemicLevel: "hypothesis",
          title: "The dual-normalisation outlier deserves an operating review",
          takeaway: "The same Centre remains a priority after both normalisations, so size alone is not a sufficient explanation.",
          evidenceRefs: ["benchmark:portfolio-p75", "benchmark:priority-centre:A1"],
          evidenceSqlIndexes: [],
        }],
      }, runId, sessionId)
    : envelopeEvents({
        findings: [{
          sourceCandidateIds: ["candidate-1"],
          placementTargets: ["preschool.benchmark"],
          epistemicLevel: "hypothesis",
          relationship: "independent",
          signalRefs: ["efficiency"],
          title: "Normalisation does not remove the priority signal",
          takeaway: "The same Centre remains a priority under both floor-area and headcount normalisation.",
          verification: "Compare its operating schedule and equipment state with lower-intensity peers before assigning a cause.",
          uncertainty: "The current Snapshot does not observe occupancy or equipment state.",
          evidenceRefs: ["benchmark:portfolio-p75", "benchmark:priority-centre:A1"],
          evidenceSqlIndexes: [],
        }],
        trace: [{ decision: "accepted", sourceCandidateIds: ["candidate-1"], reason: "Adds a decision-relevant interpretation." }],
      }, runId, sessionId);
}

function envelopeEvents(value: Record<string, unknown>, runId: string, sessionId: string) {
  return {
    events: [
      { type: "TEXT_MESSAGE_CONTENT", delta: JSON.stringify(value) },
      { type: "RUN_FINISHED" },
    ],
    completedRun: { runId, sessionId },
  };
}

function sqlEnvelopeEvents(value: Record<string, unknown>, runId: string, sessionId: string) {
  return {
    events: [
      { type: "TOOL_CALL_START", toolCallId: "schema-1", toolCallName: "inspect_schema", args: {} },
      { type: "TOOL_CALL_RESULT", toolCallId: "schema-1", toolCallName: "inspect_schema", result: { tables: [{ name: "energy_facts" }] } },
      { type: "TOOL_CALL_START", toolCallId: "sql-1", toolCallName: "run_sql_readonly", args: { sql: "SELECT centre_code, usage_kwh FROM energy_facts" } },
      {
        type: "TOOL_CALL_RESULT",
        toolCallId: "sql-1",
        toolCallName: "run_sql_readonly",
        result: {
          columns: ["centre_code", "usage_kwh"],
          rows: [["A1", 100], ["E", 300]],
          row_count: 2,
          audit_log_id: "audit-1",
        },
      },
      { type: "TEXT_MESSAGE_CONTENT", delta: JSON.stringify(value) },
      { type: "RUN_FINISHED" },
    ],
    completedRun: { runId, sessionId },
  };
}

async function until(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 50; index += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Timed out waiting for condition");
}
