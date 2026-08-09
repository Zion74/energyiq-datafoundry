import {
  filterAiFindingPresentationEvidence,
  parseAiFindingPresentation,
  type AiFindingPresentation,
} from "@datafoundry/contracts";
import type { LocalDataGateway } from "@datafoundry/data-gateway";
import type {
  EnergyIqOverviewAiArtifactIdentity,
  EnergyIqOverviewAiArtifactRecord,
  MetadataStore,
  UserRecord,
} from "@datafoundry/metadata";
import { createHash, randomUUID } from "node:crypto";

import {
  resolveProjectAnalysis,
  type ProjectAnalysisSnapshot,
} from "./project-analysis-resolver.js";
import { resolveCurrentOverviewAiArtifactIdentity } from "./overview-ai-artifact.js";

type PlacementTarget =
  | "preschool.overall-key-findings"
  | "preschool.benchmark"
  | "preschool.standby"
  | "preschool.operating-hours"
  | "preschool.forecast"
  | "cross-section";
type EpistemicLevel = "verified" | "hypothesis" | "exploration-idea";
type Relationship = "supports" | "challenges" | "independent";
type Stage = "investigator" | "editor";

export type PreschoolOverviewAiStageInput = {
  stage: Stage;
  prompt: string;
  runId: string;
  sessionId: string;
  user: UserRecord;
  workspaceId: string;
  identity: EnergyIqOverviewAiArtifactIdentity;
};

export type PreschoolOverviewAiStageRunner = (
  input: PreschoolOverviewAiStageInput,
) => Promise<{
  events: ReadonlyArray<Record<string, unknown>>;
  completedRun: { runId: string; sessionId: string };
}>;

export type PreschoolOverviewAiWorkflow = {
  resolveCurrentIdentity(input: {
    projectId: string;
    scopeId: string;
    user: UserRecord;
  }): Promise<EnergyIqOverviewAiArtifactIdentity>;
  execute(input: {
    identity: EnergyIqOverviewAiArtifactIdentity;
    user: UserRecord;
    retry: boolean;
  }): Promise<EnergyIqOverviewAiArtifactRecord>;
};

type EvidenceItem = {
  id: string;
  kind: string;
  label: string;
  unit: string | null;
  values: Record<string, string | number | boolean | null>;
  queryIds: string[];
  limitation: string | null;
};

type ToolEvidence = {
  evidenceIndex: number;
  toolCallId: string;
  sql: string | null;
  rowCount: number | null;
  auditLogId: string | null;
  elapsedMs: number | null;
  resultPreview: string;
  columns: string[];
  rows: unknown[];
};

type WorkflowContext = {
  binding: {
    projectId: "preschool-demo";
    scopeId: string;
    dataSnapshotId: string;
    projectReleaseId: string;
    dataCutoff: string;
    analysisPeriod: { from: string; to: string };
    outputContractRevision: string;
  };
  evidence: EvidenceItem[];
  coverage: unknown;
  decisionSignals: Array<{ id: string; label: string }>;
  projectName: string;
  scopeName: string;
  timezone: string;
};

type InvestigatorCandidate = {
  id: string;
  epistemicLevel: EpistemicLevel;
  title: string;
  takeaway: string;
  significance?: string;
  possibleExplanation?: string;
  nextCheck?: string;
  evidenceRefs: string[];
  evidenceSqlIndexes: number[];
  presentation?: AiFindingPresentation;
};

type EditorFinding = {
  sourceCandidateIds: string[];
  placementTargets: PlacementTarget[];
  epistemicLevel: EpistemicLevel;
  relationship: Relationship;
  signalRefs: string[];
  title: string;
  takeaway: string;
  interpretation?: string;
  action?: string;
  verification?: string;
  uncertainty?: string;
  evidenceRefs: string[];
  evidenceSqlIndexes: number[];
  presentation?: AiFindingPresentation;
};

type TraceDecision = {
  decision: "accepted" | "rejected" | "merged";
  sourceCandidateIds: string[];
  findingId?: string;
  reason?: string;
};

const LEASE_MS = 13 * 60 * 1_000;
const MAX_ANSWER_CHARS = 160_000;
const MAX_EVIDENCE_PREVIEW_CHARS = 2_000;

export function createPreschoolOverviewAiWorkflow(input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  runStage: PreschoolOverviewAiStageRunner;
  resolveSnapshot?: (args: {
    identity: EnergyIqOverviewAiArtifactIdentity;
    user: UserRecord;
  }) => Promise<ProjectAnalysisSnapshot>;
}): PreschoolOverviewAiWorkflow {
  const resolveSnapshot = input.resolveSnapshot ?? (async ({ identity, user }) => {
    const resolution = await resolveProjectAnalysis({
      metadataStore: input.metadataStore,
      dataGateway: input.dataGateway,
      user,
      workspaceId: identity.workspaceId,
      bypassCache: true,
      request: {
        projectId: identity.projectId,
        scopeId: identity.scopeId,
        resource: "electricity",
        analysisWindow: "current-overview-28d",
        period: "Custom",
        from: identity.analysisPeriodFrom,
        to: identity.analysisPeriodTo,
        expectedDataSnapshotId: identity.dataSnapshotId,
        expectedProjectReleaseId: identity.projectReleaseId,
      },
    });
    if (resolution.status !== "ready") {
      throw new Error("OVERVIEW_AI_SNAPSHOT_NOT_READY");
    }
    return resolution.snapshot;
  });

  return {
    resolveCurrentIdentity: ({ projectId, scopeId, user }) => resolveCurrentOverviewAiArtifactIdentity({
      metadataStore: input.metadataStore,
      dataGateway: input.dataGateway,
      projectId,
      scopeId,
      user,
    }),
    async execute({ identity, user, retry }) {
      requirePreschoolIdentity(identity);
      const store = input.metadataStore.energyIq.overviewAiArtifacts;
      const current = store.find(identity) ?? store.queue({
        identity,
        triggeredBy: user.id,
      });
      if (current.status === "available") return current;
      if (current.status === "failed" && !retry) return current;
      if (current.status === "running" && !retry) return current;

      const workerId = `overview-ai-server:${randomUUID()}`;
      const claim = store.claim({ identity, workerId, leaseMs: LEASE_MS });
      if (!claim.claimed) return claim.artifact;

      try {
        const snapshot = await resolveSnapshot({ identity, user });
        const context = buildWorkflowContext(snapshot, identity);
        const sessionId = workflowSessionId(identity, user.id, claim.artifact.attempt_count);
        const investigatorRunId = `overview-ai-investigator-${randomUUID()}`;
        const investigatorStage = await input.runStage({
          stage: "investigator",
          prompt: buildInvestigatorPrompt(context, identity),
          runId: investigatorRunId,
          sessionId,
          user,
          workspaceId: identity.workspaceId,
          identity,
        });
        requireCompletedStage(investigatorStage.completedRun, investigatorRunId, sessionId);
        const investigator = normalizeStageEvents(investigatorStage);
        const candidates = parseInvestigatorCandidates(investigator.answer);
        if (!candidates) throw new Error("OVERVIEW_AI_INVESTIGATOR_RESULT_INVALID");

        const editorRunId = `overview-ai-editor-${randomUUID()}`;
        const editorStage = await input.runStage({
          stage: "editor",
          prompt: buildEditorPrompt(context, identity, candidates, investigator.tools),
          runId: editorRunId,
          sessionId,
          user,
          workspaceId: identity.workspaceId,
          identity,
        });
        requireCompletedStage(editorStage.completedRun, editorRunId, sessionId);
        const editor = normalizeStageEvents(editorStage);
        const envelope = parseEditorEnvelope(editor.answer, new Set(candidates.map(({ id }) => id)));
        if (!envelope) throw new Error("OVERVIEW_AI_EDITOR_RESULT_INVALID");

        const tools = [...investigator.tools, ...editor.tools].map((tool, index) => ({
          ...tool,
          evidenceIndex: index + 1,
        }));
        if (tools.length > 0 && !investigator.schemaValid && !editor.schemaValid) {
          throw new Error("OVERVIEW_AI_SQL_SCHEMA_NOT_INSPECTED");
        }
        const result = materializeCanonicalArtifact({
          context,
          identity,
          investigatorRunId,
          editorRunId,
          envelope,
          tools,
        });
        return store.complete({
          identity,
          workerId,
          sessionId,
          runId: editorRunId,
          resultJson: JSON.stringify(result),
        });
      } catch (error) {
        const errorCode = workflowErrorCode(error);
        try {
          return store.fail({ identity, workerId, errorCode });
        } catch {
          return store.get(identity);
        }
      }
    },
  };
}

function requirePreschoolIdentity(identity: EnergyIqOverviewAiArtifactIdentity): void {
  if (identity.projectId !== "preschool-demo"
    || identity.rendererKey !== "preschool-overview"
    || identity.resource !== "electricity"
    || !identity.analysisPeriodFrom
    || !identity.analysisPeriodTo) {
    throw new Error("OVERVIEW_AI_PRESCHOOL_IDENTITY_REQUIRED");
  }
}

function requireCompletedStage(
  completed: { runId: string; sessionId: string },
  expectedRunId: string,
  expectedSessionId: string,
): void {
  if (completed.runId !== expectedRunId || completed.sessionId !== expectedSessionId) {
    throw new Error("OVERVIEW_AI_RUNTIME_RUN_IDENTITY_MISMATCH");
  }
}

function buildWorkflowContext(
  snapshot: ProjectAnalysisSnapshot,
  identity: EnergyIqOverviewAiArtifactIdentity,
): WorkflowContext {
  if (snapshot.context.projectId !== identity.projectId
    || snapshot.context.scopeId !== identity.scopeId
    || snapshot.dataSnapshot.id !== identity.dataSnapshotId
    || snapshot.projectRelease.id !== identity.projectReleaseId
    || snapshot.renderer.key !== identity.rendererKey
    || snapshot.renderer.version !== identity.rendererVersion
    || snapshot.context.primaryPeriod.start !== identity.analysisPeriodFrom
    || snapshot.context.primaryPeriod.endExclusive !== identity.analysisPeriodTo
    || snapshot.dataQuality.status !== "complete") {
    throw new Error("OVERVIEW_AI_SNAPSHOT_IDENTITY_MISMATCH");
  }
  const benchmark = snapshot.preschoolBenchmark;
  const appliances = snapshot.preschoolAppliances?.status === "available"
    ? snapshot.preschoolAppliances
    : null;
  const operational = snapshot.preschoolOperational?.status === "available"
    ? snapshot.preschoolOperational
    : null;
  const signals = snapshot.preschoolDecisionSignals;
  if (!benchmark || benchmark.status !== "provisional"
    || !appliances
    || !signals || signals.status !== "available"
    || signals.context.dataSnapshotId !== identity.dataSnapshotId
    || signals.context.projectReleaseId !== identity.projectReleaseId) {
    throw new Error("OVERVIEW_AI_PRESCHOOL_FACTS_UNAVAILABLE");
  }
  const evidence: EvidenceItem[] = [
    evidenceItem("portfolio:window", "portfolio", "Published current-window Portfolio energy", "kWh", {
      usageKwh: snapshot.analysis.summary.usageKwh,
      averageDailyUsageKwh: snapshot.analysis.summary.averageDailyUsageKwh,
      centreCount: snapshot.analysis.childScopes.length,
    }, ["scope_summary_v1", "child_scope_breakdown_v1"]),
    evidenceItem("benchmark:portfolio-p75", "benchmark", "Published Portfolio peer cross-hairs", null, {
      percentile: 75,
      sampleSize: benchmark.sampleSize,
      euiP50: benchmark.portfolio.eui.p50,
      euiP75: benchmark.portfolio.eui.p75,
      perPaxP50: benchmark.portfolio.perPax.p50,
      perPaxP75: benchmark.portfolio.perPax.p75,
      metadataStatus: benchmark.evidence.metadataStatus,
    }, benchmark.evidence.sourceQueryIds, "Provisional metadata screening; not a confirmed cause."),
    ...benchmark.priorityCentreCodes.slice(0, 6).flatMap((centreCode) => {
      const centre = benchmark.centres.find((candidate) => candidate.centreCode === centreCode);
      return centre ? [evidenceItem(
        `benchmark:priority-centre:${centreCode}`,
        "centre",
        `Priority Centre ${centreCode}`,
        null,
        {
          centreCode,
          cohort: centre.cohort,
          usageKwh: centre.usageKwh,
          eui: centre.annualisedEuiKwhPerSqmYear,
          perPax: centre.mayKwhPerPerson,
          quadrant: centre.quadrant,
        },
        benchmark.evidence.sourceQueryIds,
        "Provisional area and headcount.",
      )] : [];
    }),
    ...(operational ? [
      evidenceItem("operating:portfolio", "operating", "Published Calendar energy split", "kWh", {
        totalKwh: operational.energy.totalKwh,
        standbyKwh: operational.energy.standbyKwh,
        standbySharePct: operational.energy.standbySharePct,
        operatingKwh: operational.energy.operatingKwh,
      }, ["scope_summary_v1", "operational_policy_scope_intervals_v1"], "Closed hours do not prove waste."),
      evidenceItem("spike:standby-summary", "spike", "Closed-hour Spike summary", null, {
        spikeCount: operational.spikes.standby.count,
        centreCount: operational.spikes.standby.centreCount,
        centres: operational.spikes.standby.centres.map(({ centreCode }) => centreCode).join(", "),
      }, ["preschool-operational-spikes-v2"], "A Spike is a screening signal, not a confirmed fault."),
      evidenceItem("spike:operating-summary", "spike", "Opening-hour Spike summary", null, {
        spikeCount: operational.spikes.operating.count,
        centreCount: operational.spikes.operating.centreCount,
        centres: operational.spikes.operating.centres.map(({ centreCode }) => centreCode).join(", "),
      }, ["preschool-operational-spikes-v2"], "Activity and equipment state are not observed."),
      evidenceItem("operating:sop-signal", "operating", operational.sop.label, null, {
        status: operational.sop.status,
        breachingCentres: operational.sop.breachingCentreCodes.join(", "),
      }, ["preschool-after-hours-sop-signal-v1"], "Provisional signal; not confirmed SOP compliance."),
    ] : []),
    ...appliances.appliances.slice(0, 3).map((appliance) => evidenceItem(
      `circuit:appliance:${appliance.name}`,
      "circuit",
      `${appliance.name} Portfolio contribution`,
      "kWh",
      {
        appliance: appliance.name,
        applianceGroup: appliance.applianceGroup,
        usageKwh: appliance.usageKwh,
        sharePct: appliance.sharePct,
        centreCount: appliance.centreCount,
      },
      [appliances.evidence.projectionRecipeId],
      "Published Circuit aliases are used as the Project-specific Appliance contract.",
    )),
    evidenceItem("quality:window", "quality", "Published current-window data quality", null, {
      status: snapshot.dataQuality.status,
      coveragePct: snapshot.dataQuality.coveragePct,
      validIntervalCount: snapshot.dataQuality.validIntervalCount,
      expectedMeterIntervalCount: snapshot.dataQuality.expectedMeterIntervalCount,
      qualityEventCount: snapshot.dataQuality.qualityEventCount,
    }, ["scope_summary_v1"]),
    evidenceItem("limitation:external-operational-evidence", "limitation", "External operational Evidence is not present", null, {
      evidenceStatus: "Missing Evidence",
      missing: "equipment state, occupancy, maintenance, confirmed on-site procedure, savings, ROI, owner, commitment",
    }, [], "Use Hypothesis or Exploration Idea for causes."),
  ].slice(0, 20);
  const binding = {
    projectId: "preschool-demo" as const,
    scopeId: identity.scopeId,
    dataSnapshotId: identity.dataSnapshotId,
    projectReleaseId: identity.projectReleaseId,
    dataCutoff: identity.analysisPeriodTo,
    analysisPeriod: { from: identity.analysisPeriodFrom, to: identity.analysisPeriodTo },
    outputContractRevision: identity.outputContractRevision,
  };
  return {
    binding,
    evidence,
    coverage: buildCoverage(binding, signals.items, evidence, Boolean(operational), true),
    decisionSignals: signals.items.map(({ id, label }) => ({ id, label })),
    projectName: snapshot.context.projectName,
    scopeName: snapshot.context.scopeName,
    timezone: snapshot.context.timezone,
  };
}

function evidenceItem(
  id: string,
  kind: string,
  label: string,
  unit: string | null,
  values: EvidenceItem["values"],
  queryIds: string[],
  limitation: string | null = null,
): EvidenceItem {
  return { id, kind, label, unit, values, queryIds, limitation };
}

function buildCoverage(
  binding: WorkflowContext["binding"],
  signals: NonNullable<ProjectAnalysisSnapshot["preschoolDecisionSignals"]>["items"],
  evidence: EvidenceItem[],
  operationalAvailable: boolean,
  applianceAvailable: boolean,
): unknown {
  const sections: Array<{ target: PlacementTarget; decisionQuestion: string }> = [
    { target: "preschool.overall-key-findings", decisionQuestion: "What changes the Portfolio priority or next management decision?" },
    { target: "preschool.benchmark", decisionQuestion: "What explains or changes the priority implied by the peer benchmark?" },
    { target: "preschool.standby", decisionQuestion: "Where is closed-hour energy persistent enough to investigate or act on?" },
    { target: "preschool.operating-hours", decisionQuestion: "What operating-hour relationship needs attention beyond the visible spike counts?" },
    { target: "preschool.forecast", decisionQuestion: "What decision-relevant uncertainty or planning implication is supported by this Snapshot?" },
    { target: "cross-section", decisionQuestion: "What relationship across sections changes the order of action?" },
  ];
  return {
    contract: { id: "preschool-overview-coverage", revision: "v1" },
    binding,
    sections: sections.map(({ target, decisionQuestion }) => {
      const wholePage = target === "preschool.overall-key-findings" || target === "cross-section";
      const visibleSignals = wholePage ? signals : signals.filter(({ id }) => signalPlacement(id) === target);
      const visibleEvidence = evidence.filter(({ id }) => wholePage || evidenceVisibleAt(id, target));
      return {
        target,
        decisionQuestion,
        visibleSignalRefs: visibleSignals.map(({ id }) => id),
        visibleEvidenceRefs: visibleEvidence.map(({ id }) => id),
        visibleVisuals: visibleVisuals(target, operationalAvailable, applianceAvailable),
        visibleClaims: [
          ...visibleSignals.map((signal) => ({
            id: signal.id,
            label: signal.label,
            metrics: signal.metrics.map(({ id, metricId, value, unit }) => ({ id, metricId, value, unit })),
            limitations: signal.limitations.map(({ label }) => label),
          })),
          ...visibleEvidence.map((item) => ({
            id: `visible-evidence:${item.id}`,
            label: item.label,
            metrics: Object.entries(item.values).flatMap(([id, value]) => typeof value === "number"
              ? [{ id: `${item.id}:${id}`, metricId: id, value, unit: item.unit ?? "value" }]
              : []),
            limitations: item.limitation ? [item.limitation] : [],
          })),
        ],
      };
    }),
  };
}

function visibleVisuals(target: PlacementTarget, operational: boolean, appliances: boolean): unknown[] {
  const overview = [{ id: "preschool.overall:portfolio-kpis", type: "kpi", topic: "Portfolio consumption, average daily consumption, Centre count, and data quality", claimRefs: ["analysis.summary", "dataQuality"], evidenceRefs: ["portfolio:window", "quality:window"] }];
  const benchmark = [{ id: "preschool.benchmark:normalised-centre-ranking", type: "ranking", topic: "Centre ranking and quadrant under floor-area and headcount normalisation", claimRefs: ["preschoolBenchmark.priorityCentreCodes", "preschoolBenchmark.centres"], evidenceRefs: ["benchmark:portfolio-p75", "benchmark:priority-centre:*"] }];
  const standby = operational ? [{ id: "preschool.standby:calendar-energy-split", type: "chart", topic: "Operating versus standby energy split and Spike distribution", claimRefs: ["preschoolOperational.energy", "preschoolOperational.spikes.standby"], evidenceRefs: ["operating:portfolio", "spike:standby-summary"] }] : [];
  const operating = operational ? [{ id: "preschool.operating-hours:spike-and-sop-table", type: "table", topic: "Operating-hour Spikes and provisional SOP signal by Centre", claimRefs: ["preschoolOperational.spikes.operating", "preschoolOperational.sop"], evidenceRefs: ["spike:operating-summary", "operating:sop-signal"] }] : [];
  const forecast = appliances ? [{ id: "preschool.forecast:appliance-contribution", type: "ranking", topic: "Published Appliance contribution and planning projection", claimRefs: ["preschoolAppliances.appliances"], evidenceRefs: ["circuit:appliance:*"] }] : [];
  if (target === "preschool.benchmark") return benchmark;
  if (target === "preschool.standby") return standby;
  if (target === "preschool.operating-hours") return operating;
  if (target === "preschool.forecast") return forecast;
  return [...overview, ...benchmark, ...standby, ...operating, ...forecast];
}

function signalPlacement(id: string): PlacementTarget | null {
  if (id === "efficiency") return "preschool.benchmark";
  if (id === "after-hours") return "preschool.standby";
  if (id === "operating") return "preschool.operating-hours";
  return null;
}

function evidenceVisibleAt(id: string, target: PlacementTarget): boolean {
  if (target === "preschool.benchmark") return id.startsWith("benchmark:");
  if (target === "preschool.standby") return id === "operating:portfolio" || id.includes("standby") || id === "operating:sop-signal";
  if (target === "preschool.operating-hours") return id === "operating:portfolio" || id === "operating:sop-signal" || id.includes("operating") && !id.includes("standby");
  if (target === "preschool.forecast") return id.startsWith("circuit:appliance:");
  return false;
}

function buildInvestigatorPrompt(context: WorkflowContext, identity: EnergyIqOverviewAiArtifactIdentity): string {
  return [
    `You are the Investigator in a fixed two-stage EnergyIQ workflow for ${context.projectName}, Scope ${context.scopeName}.`,
    `Work only inside Snapshot ${identity.dataSnapshotId}, Release ${identity.projectReleaseId}, and ${identity.analysisPeriodFrom} through ${identity.analysisPeriodTo} in ${context.timezone}.`,
    `Use ${identity.methodSkillId}@${identity.methodSkillRevision} as a discovery method, not a question checklist.`,
    "The Coverage is what the manager already sees. Investigate relationships, drivers, concentration, timing, contradictions, likely explanations, consequences, or useful next checks that add material value beyond visible claims and visuals.",
    "Use read-only SQL only when it can materially change a conclusion, action, or uncertainty. Zero candidates is valid; there is no finding quota.",
    "Use verified only for supported observations. Preserve useful hypotheses and exploration ideas, but do not invent causes, equipment state, occupancy, savings, ROI, ownership, commitment, thresholds, or forecasts.",
    "Every displayed number or named entity must occur in that candidate's cited bounded Evidence or successful SQL result. Omit presentation for no-visual. Output only strict JSON.",
    `Prompt revision: ${identity.investigatorPromptRevision}.`,
    "Return: {\"candidates\":[{\"id\":\"candidate-1\",\"epistemicLevel\":\"verified|hypothesis|exploration-idea\",\"title\":\"...\",\"takeaway\":\"...\",\"significance\":\"optional\",\"possibleExplanation\":\"optional\",\"nextCheck\":\"optional\",\"evidenceRefs\":[],\"evidenceSqlIndexes\":[],\"presentation\":{\"version\":\"1\",\"blocks\":[]}}]}",
    "Overview Coverage:", JSON.stringify(context.coverage),
    "Bounded Snapshot Evidence:", JSON.stringify({ identity: context.binding, items: context.evidence }),
    "Project decision signals:", JSON.stringify({ items: context.decisionSignals }),
  ].join("\n\n");
}

function buildEditorPrompt(
  context: WorkflowContext,
  identity: EnergyIqOverviewAiArtifactIdentity,
  candidates: InvestigatorCandidate[],
  tools: Array<Omit<ToolEvidence, "evidenceIndex">>,
): string {
  return [
    `You are the Insight Editor in the final stage for ${context.projectName}. Accept content only for Snapshot ${identity.dataSnapshotId}, Release ${identity.projectReleaseId}, and ${identity.analysisPeriodFrom} through ${identity.analysisPeriodTo}.`,
    "Judge incremental manager value, non-repetition against visible claims and visuals, depth, epistemic honesty, page placement, and clarity. Reject, merge, or accept. Zero accepted findings is valid; never generate filler.",
    "The Benchmark target needs an interpretation, likely explanation, action, or verification beyond benchmark repetition. Leave it empty when no candidate clears that bar.",
    `Valid placementTargets: ${JSON.stringify(["preschool.overall-key-findings", "preschool.benchmark", "preschool.standby", "preschool.operating-hours", "preschool.forecast", "cross-section"])}.`,
    "Preserve no-visual. Hypothesis or exploration-idea must include at least one of uncertainty or verification. Every number and named entity must be supported by that finding's cited Evidence.",
    "Investigator SQL indexes retain their numbers. If you run more SQL, continue numbering after the last Investigator index. Trace accepted, rejected, or merged decisions separately from customer content.",
    `Output contract ${identity.outputContractRevision}; prompt revision ${identity.editorPromptRevision}. Output only strict JSON.`,
    "Return: {\"findings\":[{\"sourceCandidateIds\":[\"candidate-1\"],\"placementTargets\":[\"preschool.benchmark\"],\"epistemicLevel\":\"hypothesis\",\"relationship\":\"independent\",\"signalRefs\":[],\"title\":\"...\",\"takeaway\":\"...\",\"interpretation\":\"optional\",\"action\":\"optional\",\"verification\":\"optional\",\"uncertainty\":\"optional\",\"evidenceRefs\":[],\"evidenceSqlIndexes\":[],\"presentation\":{\"version\":\"1\",\"blocks\":[]}}],\"trace\":[{\"decision\":\"accepted|rejected|merged\",\"sourceCandidateIds\":[\"candidate-1\"],\"reason\":\"optional\"}]}",
    "Overview Coverage:", JSON.stringify(context.coverage),
    "Investigator candidates:", JSON.stringify(candidates),
    "Investigator SQL Evidence summaries:", JSON.stringify(tools.map((tool, index) => ({ evidenceIndex: index + 1, resultPreview: tool.resultPreview }))),
    "Bounded Snapshot Evidence:", JSON.stringify({ identity: context.binding, items: context.evidence }),
  ].join("\n\n");
}

function normalizeStageEvents(input: { events: ReadonlyArray<Record<string, unknown>> }): {
  answer: string;
  schemaValid: boolean;
  tools: Array<Omit<ToolEvidence, "evidenceIndex">>;
} {
  const runError = [...input.events].reverse().find(({ type }) => type === "RUN_ERROR");
  if (runError) throw new Error(typeof runError.message === "string" ? runError.message : "OVERVIEW_AI_STAGE_FAILED");
  if (!input.events.some(({ type }) => type === "RUN_FINISHED")) throw new Error("OVERVIEW_AI_STAGE_INCOMPLETE");
  const answer = input.events.filter(({ type }) => type === "TEXT_MESSAGE_CONTENT")
    .map(({ delta }) => typeof delta === "string" ? delta : "").join("").trim();
  const tools = collectTools(input.events);
  return { answer, ...tools };
}

function collectTools(events: ReadonlyArray<Record<string, unknown>>): {
  schemaValid: boolean;
  tools: Array<Omit<ToolEvidence, "evidenceIndex">>;
} {
  const attempts = new Map<string, { name: string; argsText: string; args: Record<string, unknown> | null; result: unknown }>();
  for (const event of events) {
    const id = stringValue(event.toolCallId) ?? stringValue(event.tool_call_id);
    if (!id) continue;
    const current = attempts.get(id) ?? { name: "unknown", argsText: "", args: null, result: undefined };
    current.name = stringValue(event.toolCallName) ?? stringValue(event.tool_call_name) ?? current.name;
    if (event.type === "TOOL_CALL_ARGS") current.argsText += stringValue(event.delta) ?? "";
    if (isRecord(event.args)) current.args = event.args;
    if (isRecord(event.parameters)) current.args = event.parameters;
    if (event.type === "TOOL_CALL_RESULT") current.result = event.result ?? event.content;
    attempts.set(id, current);
  }
  for (const attempt of attempts.values()) {
    if (attempt.argsText && !attempt.args) attempt.args = parseRecord(attempt.argsText);
  }
  const schemaValid = [...attempts.values()].some(({ name, result }) => name === "inspect_schema" && validSchemaResult(result));
  const tools = [...attempts.entries()].flatMap<Omit<ToolEvidence, "evidenceIndex">>(([toolCallId, attempt]) => {
    if (attempt.name !== "run_sql_readonly") return [];
    const result = parseSqlResult(attempt.result);
    if (!result) return [];
    const preview = typeof attempt.result === "string" ? attempt.result : JSON.stringify(attempt.result);
    return [{
      toolCallId,
      sql: typeof attempt.args?.sql === "string" && attempt.args.sql.trim() ? attempt.args.sql : result.sql,
      rowCount: result.rowCount,
      auditLogId: result.auditLogId,
      elapsedMs: result.elapsedMs,
      resultPreview: preview.slice(0, MAX_EVIDENCE_PREVIEW_CHARS),
      columns: result.columns,
      rows: result.rows,
    }];
  });
  return { schemaValid, tools };
}

function materializeCanonicalArtifact(input: {
  context: WorkflowContext;
  identity: EnergyIqOverviewAiArtifactIdentity;
  investigatorRunId: string;
  editorRunId: string;
  envelope: { findings: EditorFinding[]; trace: TraceDecision[] };
  tools: ToolEvidence[];
}): Record<string, unknown> {
  const evidenceById = new Map(input.context.evidence.map((item) => [item.id, item]));
  const signalIds = new Set(input.context.decisionSignals.map(({ id }) => id));
  const accepted = input.envelope.findings.flatMap((draft) => {
    if (draft.signalRefs.some((id) => !signalIds.has(id))) return [];
    const evidence = draft.evidenceRefs.flatMap((id) => {
      const item = evidenceById.get(id);
      return item ? [item] : [];
    });
    const tools = draft.evidenceSqlIndexes.flatMap((index) => {
      const tool = input.tools[index - 1];
      return tool ? [tool] : [];
    });
    if (evidence.length !== draft.evidenceRefs.length
      || tools.length !== draft.evidenceSqlIndexes.length
      || draft.epistemicLevel === "verified" && evidence.length === 0 && tools.length === 0) return [];
    const narrative = [draft.title, draft.takeaway, draft.interpretation, draft.action, draft.verification, draft.uncertainty]
      .filter((value): value is string => Boolean(value));
    if (narrative.some((text) => unsupportedNarrative(text, evidence, tools))) return [];
    const presentation = filterAiFindingPresentationEvidence(draft.presentation, {
      evidenceRefs: draft.evidenceRefs,
      evidenceSqlIndexes: draft.evidenceSqlIndexes,
    });
    const safePresentation = presentation && !unsupportedNarrative(JSON.stringify(presentation), evidence, tools)
      ? presentation
      : null;
    return [{ draft, evidence, tools, presentation: safePresentation }];
  });
  const findings = accepted.map(({ draft, evidence, tools, presentation }, index) => ({
    id: `preschool-ai-finding-${index + 1}`,
    binding: input.context.binding,
    placementTargets: draft.placementTargets,
    epistemicLevel: draft.epistemicLevel,
    relationship: draft.relationship,
    signalRefs: draft.signalRefs,
    title: draft.title,
    takeaway: draft.takeaway,
    ...(draft.interpretation ? { interpretation: draft.interpretation } : {}),
    ...(draft.action ? { action: draft.action } : {}),
    ...(draft.verification ? { verification: draft.verification } : {}),
    ...(draft.uncertainty ? { uncertainty: draft.uncertainty } : {}),
    ...(presentation ? { presentation } : {}),
    evidence: {
      snapshotId: input.identity.dataSnapshotId,
      period: input.context.binding.analysisPeriod,
      deterministic: evidence,
      tools: tools.map(({ columns: _, rows: __, ...tool }) => tool),
    },
  }));
  const findingIdBySources = new Map(accepted.map(({ draft }, index) => [
    sourceKey(draft.sourceCandidateIds),
    findings[index]!.id,
  ]));
  const trace = input.envelope.trace.map((decision) => {
    const findingId = findingIdBySources.get(sourceKey(decision.sourceCandidateIds));
    return findingId && decision.decision !== "rejected" ? { ...decision, findingId } : decision;
  });
  const traced = new Set(trace.filter(({ decision }) => decision !== "rejected").map(({ sourceCandidateIds }) => sourceKey(sourceCandidateIds)));
  for (const [index, { draft }] of accepted.entries()) {
    if (!traced.has(sourceKey(draft.sourceCandidateIds))) {
      trace.push({ decision: "accepted", sourceCandidateIds: draft.sourceCandidateIds, findingId: findings[index]!.id });
    }
  }
  return {
    status: "available",
    providerProfileId: input.identity.modelProfileId,
    runId: input.editorRunId,
    packId: input.identity.analysisPackId,
    packRevision: input.identity.analysisPackRevision,
    contract: { id: "preschool-ai-accepted-artifact", revision: input.identity.outputContractRevision },
    binding: input.context.binding,
    workflow: {
      id: "preschool-two-stage",
      revision: input.identity.workflowRevision,
      methodSkill: { id: input.identity.methodSkillId, revision: input.identity.methodSkillRevision },
      stages: {
        investigator: { runId: input.investigatorRunId, promptRevision: input.identity.investigatorPromptRevision },
        editor: { runId: input.editorRunId, promptRevision: input.identity.editorPromptRevision },
      },
      ...(trace.length > 0 ? { editorTrace: trace } : {}),
    },
    findings,
  };
}

function parseInvestigatorCandidates(answer: string): InvestigatorCandidate[] | null {
  const envelope = findEnvelope(answer, "candidates");
  if (!envelope || !Array.isArray(envelope.candidates)) return null;
  const candidates = envelope.candidates.flatMap<InvestigatorCandidate>((value) => {
    if (!isRecord(value)) return [];
    const id = cleanId(value.id);
    const epistemicLevel = epistemic(value.epistemicLevel);
    const title = cleanText(value.title);
    const takeaway = cleanText(value.takeaway);
    const evidenceSqlIndexes = positiveIntegers(value.evidenceSqlIndexes);
    if (!id || !epistemicLevel || !title || !takeaway || evidenceSqlIndexes === null) return [];
    const presentation = parseAiFindingPresentation(value.presentation);
    return [{
      id, epistemicLevel, title, takeaway,
      ...optionalText("significance", value.significance),
      ...optionalText("possibleExplanation", value.possibleExplanation),
      ...optionalText("nextCheck", value.nextCheck),
      evidenceRefs: strings(value.evidenceRefs),
      evidenceSqlIndexes,
      ...(presentation ? { presentation } : {}),
    }];
  });
  return candidates.length === envelope.candidates.length
    && new Set(candidates.map(({ id }) => id)).size === candidates.length ? candidates : null;
}

function parseEditorEnvelope(answer: string, candidateIds: ReadonlySet<string>): { findings: EditorFinding[]; trace: TraceDecision[] } | null {
  const envelope = findEnvelope(answer, "findings");
  if (!envelope || !Array.isArray(envelope.findings)) return null;
  const findings = envelope.findings.flatMap<EditorFinding>((value) => {
    if (!isRecord(value)) return [];
    const sourceCandidateIds = strings(value.sourceCandidateIds);
    const placementTargets = placements(value.placementTargets);
    const epistemicLevel = epistemic(value.epistemicLevel);
    const relationship = relation(value.relationship);
    const title = cleanText(value.title);
    const takeaway = cleanText(value.takeaway);
    const verification = cleanText(value.verification);
    const uncertainty = cleanText(value.uncertainty);
    const evidenceSqlIndexes = positiveIntegers(value.evidenceSqlIndexes);
    if (sourceCandidateIds.length === 0 || sourceCandidateIds.some((id) => !candidateIds.has(id))
      || !placementTargets?.length || !epistemicLevel || !relationship || !title || !takeaway
      || epistemicLevel !== "verified" && !verification && !uncertainty || evidenceSqlIndexes === null) return [];
    const presentation = parseAiFindingPresentation(value.presentation);
    return [{
      sourceCandidateIds, placementTargets, epistemicLevel, relationship,
      signalRefs: strings(value.signalRefs), title, takeaway,
      ...optionalText("interpretation", value.interpretation),
      ...optionalText("action", value.action),
      ...(verification ? { verification } : {}),
      ...(uncertainty ? { uncertainty } : {}),
      evidenceRefs: strings(value.evidenceRefs), evidenceSqlIndexes,
      ...(presentation ? { presentation } : {}),
    }];
  });
  if (findings.length !== envelope.findings.length) return null;
  const trace = Array.isArray(envelope.trace) ? envelope.trace.flatMap<TraceDecision>((value) => {
    if (!isRecord(value) || value.decision !== "accepted" && value.decision !== "rejected" && value.decision !== "merged") return [];
    const sourceCandidateIds = strings(value.sourceCandidateIds);
    if (!sourceCandidateIds.length || sourceCandidateIds.some((id) => !candidateIds.has(id))) return [];
    return [{
      decision: value.decision,
      sourceCandidateIds,
      ...optionalText("findingId", value.findingId),
      ...optionalText("reason", value.reason),
    }];
  }) : [];
  return Array.isArray(envelope.trace) && trace.length !== envelope.trace.length ? null : { findings, trace };
}

function unsupportedNarrative(text: string, evidence: EvidenceItem[], tools: ToolEvidence[]): boolean {
  const withoutDates = text.replace(/\b\d{4}-\d{2}-\d{2}(?:T[^\s,;)]*)?/gu, " ");
  const allowedNumbers = [...evidence.flatMap(({ values }) => collectNumbers(values)), ...tools.flatMap(({ rows }) => collectNumbers(rows))];
  const claims = [...withoutDates.matchAll(/(?<![A-Za-z0-9_-])-?\d+(?:,\d{3})*(?:\.\d+)?/gu)]
    .map(([raw]) => Number(raw.replace(/,/gu, ""))).filter(Number.isFinite);
  if (claims.some((claim) => !allowedNumbers.some((value) => numericMatches(claim, value)))) return true;
  const allowedEntities = new Set([
    ...evidence.flatMap(({ values }) => collectStrings(values)),
    ...tools.flatMap(({ rows }) => collectStrings(rows)),
  ].map((value) => value.toLowerCase()));
  const centreCodes = [...text.matchAll(/\bcent(?:re|er)\s+([A-Za-z0-9_-]+)\b/gu)]
    .map((match) => match[1]!).filter((value) => /\d/u.test(value) || /^[A-Z]{1,8}$/u.test(value));
  return centreCodes.some((code) => !allowedEntities.has(code.toLowerCase()));
}

function parseSqlResult(value: unknown): { columns: string[]; rows: unknown[]; rowCount: number | null; auditLogId: string | null; elapsedMs: number | null; sql: string | null } | null {
  const record = unwrapRecord(value);
  if (!record || !Array.isArray(record.columns) || !Array.isArray(record.rows)) return null;
  return {
    columns: record.columns.filter((item): item is string => typeof item === "string"),
    rows: record.rows,
    rowCount: typeof record.row_count === "number" && Number.isSafeInteger(record.row_count) ? record.row_count : null,
    auditLogId: stringValue(record.audit_log_id) ?? null,
    elapsedMs: typeof record.elapsed_ms === "number" && Number.isFinite(record.elapsed_ms) ? record.elapsed_ms : null,
    sql: stringValue(record.sql) ?? null,
  };
}

function validSchemaResult(value: unknown): boolean {
  const record = unwrapRecord(value);
  return Boolean(record && Array.isArray(record.tables) && record.tables.length > 0);
}

function unwrapRecord(value: unknown): Record<string, unknown> | null {
  let current = typeof value === "string" ? parseUnknown(value) : value;
  if (!isRecord(current)) return null;
  if (typeof current.observation === "string") current = parseUnknown(current.observation) ?? current.observation;
  if (!isRecord(current)) return null;
  return isRecord(current.result) ? current.result : current;
}

function findEnvelope(answer: string, key: "candidates" | "findings"): Record<string, unknown> | null {
  if (answer.length > MAX_ANSWER_CHARS) return null;
  for (let start = answer.lastIndexOf("{"); start >= 0; start = answer.lastIndexOf("{", start - 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < answer.length; index += 1) {
      const character = answer[index]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === "\"") inString = false;
      } else if (character === "\"") inString = true;
      else if (character === "{") depth += 1;
      else if (character === "}" && --depth === 0) {
        const parsed = parseUnknown(answer.slice(start, index + 1));
        if (isRecord(parsed) && Object.hasOwn(parsed, key)) return parsed;
        break;
      }
    }
  }
  return null;
}

function collectNumbers(value: unknown): number[] {
  if (typeof value === "number" && Number.isFinite(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(collectNumbers);
  if (isRecord(value)) return Object.values(value).flatMap(collectNumbers);
  return [];
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) return [value.trim(), ...value.split(/[,;]\s*/u).filter(Boolean)];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (isRecord(value)) return Object.values(value).flatMap(collectStrings);
  return [];
}

function numericMatches(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(1e-6, Math.abs(right) * 1e-9);
}

function placements(value: unknown): PlacementTarget[] | null {
  if (!Array.isArray(value)) return null;
  const unique = [...new Set(value)];
  return unique.every((item) => item === "preschool.overall-key-findings" || item === "preschool.benchmark"
    || item === "preschool.standby" || item === "preschool.operating-hours"
    || item === "preschool.forecast" || item === "cross-section") ? unique as PlacementTarget[] : null;
}

function epistemic(value: unknown): EpistemicLevel | null {
  return value === "verified" || value === "hypothesis" || value === "exploration-idea" ? value : null;
}

function relation(value: unknown): Relationship | null {
  return value === "supports" || value === "challenges" || value === "independent" ? value : null;
}

function positiveIntegers(value: unknown): number[] | null {
  if (value === undefined) return [];
  return Array.isArray(value) && value.every((item) => Number.isSafeInteger(item) && (item as number) > 0)
    ? [...new Set(value as number[])] : null;
}

function strings(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return [];
  const result = value.map(cleanText);
  return result.every(Boolean) ? [...new Set(result as string[])] : [];
}

function cleanId(value: unknown): string | null {
  const id = cleanText(value);
  return id && id.length <= 120 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(id) ? id : null;
}

function cleanText(value: unknown): string | null {
  const text = typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
  return text && text.length <= 1_200 ? text : null;
}

function optionalText<Key extends string>(key: Key, value: unknown): Partial<Record<Key, string>> {
  const text = cleanText(value);
  return text ? { [key]: text } as Record<Key, string> : {};
}

function sourceKey(ids: string[]): string {
  return ids.slice().sort().join("\u0000");
}

function workflowSessionId(identity: EnergyIqOverviewAiArtifactIdentity, userId: string, attempt: number): string {
  const hash = createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 24);
  return `energyiq-overview-ai-${identity.projectId}-${hash}-${userId}-${attempt}`;
}

function workflowErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const safe = message.toUpperCase().replace(/[^A-Z0-9_:-]+/gu, "_").replace(/^_+|_+$/gu, "").slice(0, 100);
  return safe || "OVERVIEW_AI_WORKFLOW_FAILED";
}

function parseUnknown(value: string): unknown {
  try { return JSON.parse(value) as unknown; } catch { return undefined; }
}

function parseRecord(value: string): Record<string, unknown> | null {
  const parsed = parseUnknown(value);
  return isRecord(parsed) ? parsed : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
