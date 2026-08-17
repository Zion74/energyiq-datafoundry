import type { ProjectAnalysisSnapshot } from "./project-analysis-resolver.js";

export const NGEE_ANN_SECTION_IDS = [
  "trend-and-demand",
  "time-behaviour",
  "circuit-concentration",
  "decision-priorities",
] as const;

export type NgeeAnnSectionId = typeof NGEE_ANN_SECTION_IDS[number];

type NgeeAnnSectionPackBinding = {
  workspaceId: string;
  projectId: string;
  scopeId: string;
  dataSnapshotId: string;
  projectReleaseId: string;
  analysisPeriod: { from: string; to: string };
  rendererKey: ProjectAnalysisSnapshot["renderer"]["key"];
};

type NgeeAnnSectionPackFacts = {
  "trend-and-demand": {
    summary: ProjectAnalysisSnapshot["analysis"]["summary"];
    comparison: ProjectAnalysisSnapshot["analysis"]["comparison"];
    dailyTotals: ProjectAnalysisSnapshot["analysis"]["dailyTotals"];
    dailyUsageAnomalies: ProjectAnalysisSnapshot["analysis"]["dailyUsageAnomalies"];
    peakBreakdown: ProjectAnalysisSnapshot["analysis"]["peakBreakdown"];
  };
  "time-behaviour": {
    hourlyProfile: ProjectAnalysisSnapshot["analysis"]["hourlyProfile"];
    timeBehaviour: ProjectAnalysisSnapshot["analysis"]["timeBehaviour"];
    componentHourlyProfiles: ProjectAnalysisSnapshot["analysis"]["componentHourlyProfiles"];
    offHours: ProjectAnalysisSnapshot["analysis"]["offHours"];
  };
  "circuit-concentration": {
    categories: ProjectAnalysisSnapshot["analysis"]["categories"];
    levels: ProjectAnalysisSnapshot["analysis"]["childScopes"];
    circuits: ProjectAnalysisSnapshot["analysis"]["circuits"];
    topCircuits: ProjectAnalysisSnapshot["analysis"]["topCircuits"];
    componentReconciliation: ProjectAnalysisSnapshot["analysis"]["componentReconciliation"];
    peakBreakdown: ProjectAnalysisSnapshot["analysis"]["peakBreakdown"];
  };
  "decision-priorities": {
    decisionPriorities: ProjectAnalysisSnapshot["decisionPriorities"];
    decisionLifecycle: ProjectAnalysisSnapshot["decisionLifecycle"];
    attention: ProjectAnalysisSnapshot["analysis"]["attention"];
  };
};

export type NgeeAnnSectionPack<SectionId extends NgeeAnnSectionId = NgeeAnnSectionId> = {
  contract: {
    id: "ngee-ann-section-pack";
    revision: "ngee-ann-section-pack-v1";
  };
  sectionId: SectionId;
  audience: "facilities and energy managers";
  analysisGoal: string;
  binding: NgeeAnnSectionPackBinding;
  evidence: ProjectAnalysisSnapshot["evidence"];
  facts: NgeeAnnSectionPackFacts[SectionId];
  dataQuality: ProjectAnalysisSnapshot["dataQuality"];
  limitations: string[];
  missingEvidence: string[];
  capabilities: {
    revision: "pack-only-v1";
    mode: "pack-only";
    tools: [];
  };
};

export type NgeeAnnSectionPacks = {
  [SectionId in NgeeAnnSectionId]: NgeeAnnSectionPack<SectionId>;
};

const ANALYSIS_GOALS: Record<NgeeAnnSectionId, string> = {
  "trend-and-demand": "Identify decision-relevant changes in total use, daily demand, peak demand and unusual days without assuming their cause.",
  "time-behaviour": "Identify decision-relevant hourly, day-type and off-hours patterns, including recurrence and counterexamples.",
  "circuit-concentration": "Identify where energy use and demand are concentrated across Levels and Circuits, including reconciliation boundaries.",
  "decision-priorities": "Identify the most decision-relevant current signals, their lifecycle and the evidence still needed before action.",
};

export const assembleNgeeAnnSectionPacks = (
  snapshot: ProjectAnalysisSnapshot,
): NgeeAnnSectionPacks => {
  if (snapshot.renderer.key !== "ngee-ann-overview") {
    throw new Error("ENERGYIQ_NGEE_ANN_SECTION_PACK_RENDERER_REQUIRED");
  }
  const binding: NgeeAnnSectionPackBinding = {
    workspaceId: snapshot.context.workspaceId,
    projectId: snapshot.context.projectId,
    scopeId: snapshot.context.scopeId,
    dataSnapshotId: snapshot.dataSnapshot.id,
    projectReleaseId: snapshot.projectRelease.id,
    analysisPeriod: {
      from: snapshot.context.primaryPeriod.start,
      to: snapshot.context.primaryPeriod.endExclusive,
    },
    rendererKey: snapshot.renderer.key,
  };
  const common = <SectionId extends NgeeAnnSectionId>(
    sectionId: SectionId,
  ): Omit<NgeeAnnSectionPack<SectionId>, "facts"> => ({
    contract: {
      id: "ngee-ann-section-pack" as const,
      revision: "ngee-ann-section-pack-v1" as const,
    },
    sectionId,
    audience: "facilities and energy managers" as const,
    analysisGoal: ANALYSIS_GOALS[sectionId],
    binding: { ...binding, analysisPeriod: { ...binding.analysisPeriod } },
    evidence: snapshot.evidence.map((item) => ({ ...item, queryIds: [...item.queryIds] })),
    dataQuality: { ...snapshot.dataQuality, importBatchIds: [...snapshot.dataQuality.importBatchIds] },
    limitations: limitations(snapshot, sectionId),
    missingEvidence: missingEvidence(snapshot, sectionId),
    capabilities: {
      revision: "pack-only-v1" as const,
      mode: "pack-only" as const,
      tools: [] as [],
    },
  });

  return {
    "trend-and-demand": {
      ...common("trend-and-demand"),
      facts: {
        summary: snapshot.analysis.summary,
        comparison: snapshot.analysis.comparison,
        dailyTotals: snapshot.analysis.dailyTotals,
        dailyUsageAnomalies: snapshot.analysis.dailyUsageAnomalies,
        peakBreakdown: snapshot.analysis.peakBreakdown,
      },
    },
    "time-behaviour": {
      ...common("time-behaviour"),
      facts: {
        hourlyProfile: snapshot.analysis.hourlyProfile,
        timeBehaviour: snapshot.analysis.timeBehaviour,
        componentHourlyProfiles: snapshot.analysis.componentHourlyProfiles,
        offHours: snapshot.analysis.offHours,
      },
    },
    "circuit-concentration": {
      ...common("circuit-concentration"),
      facts: {
        categories: snapshot.analysis.categories,
        levels: snapshot.analysis.childScopes,
        circuits: snapshot.analysis.circuits,
        topCircuits: snapshot.analysis.topCircuits,
        componentReconciliation: snapshot.analysis.componentReconciliation,
        peakBreakdown: snapshot.analysis.peakBreakdown,
      },
    },
    "decision-priorities": {
      ...common("decision-priorities"),
      facts: {
        decisionPriorities: snapshot.decisionPriorities,
        decisionLifecycle: snapshot.decisionLifecycle,
        attention: snapshot.analysis.attention,
      },
    },
  };
};

const limitations = (
  snapshot: ProjectAnalysisSnapshot,
  sectionId: NgeeAnnSectionId,
): string[] => {
  const result: string[] = [];
  if (snapshot.dataQuality.status !== "complete") {
    result.push(`Published interval coverage is ${snapshot.dataQuality.coveragePct}%.`);
  }
  if (sectionId === "time-behaviour" && snapshot.analysis.offHours.status === "unavailable") {
    result.push(snapshot.analysis.offHours.reason.message);
  }
  if (sectionId === "circuit-concentration"
    && snapshot.analysis.componentReconciliation.ratioPct !== 100) {
    result.push("Published component Circuits do not exactly reconcile to the official project total.");
  }
  if (sectionId === "decision-priorities" && snapshot.decisionPriorities?.status === "unavailable") {
    result.push("The deterministic decision-priority projection is unavailable for this Snapshot.");
  }
  if (sectionId === "decision-priorities"
    && (snapshot.decisionPriorities?.status === "partial"
      || snapshot.decisionPriorities?.status === "suppressed")
    && snapshot.decisionPriorities.limitation) {
    result.push(snapshot.decisionPriorities.limitation.message);
  }
  return result;
};

const missingEvidence = (
  snapshot: ProjectAnalysisSnapshot,
  sectionId: NgeeAnnSectionId,
): string[] => {
  const result: string[] = [];
  if (sectionId === "trend-and-demand" && (!snapshot.analysis.dailyUsageAnomalies
    || snapshot.analysis.dailyUsageAnomalies.status === "unavailable")) {
    result.push("Daily anomaly classification is unavailable.");
  }
  if (sectionId === "trend-and-demand" && (!snapshot.analysis.peakBreakdown
    || snapshot.analysis.peakBreakdown.status === "unavailable")) {
    result.push("Peak-interval contributor evidence is unavailable.");
  }
  if (sectionId === "time-behaviour" && !snapshot.analysis.timeBehaviour?.scopes.length) {
    result.push("No scoped time-behaviour series is available.");
  }
  if (sectionId === "circuit-concentration" && snapshot.analysis.circuits.length === 0) {
    result.push("No published Circuit series is available.");
  }
  if (sectionId === "decision-priorities" && !snapshot.decisionLifecycle) {
    result.push("No prior decision lifecycle is available for comparison.");
  }
  return result;
};
