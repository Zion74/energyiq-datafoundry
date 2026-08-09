import type { LocalDataGateway } from "@datafoundry/data-gateway";
import type { EnergyIqSavedAnalysisRecord, MetadataStore } from "@datafoundry/metadata";

import { executeEnergyScopeAnalysis } from "./energy-analysis.js";
import type { EnergyQueryContext } from "./energy-query-context.js";
import {
  recoverPreschoolPlanningOutlookFromCompleteWeeks,
  type PreschoolOperationalProjection,
  type PreschoolPlanningAnalysisInput,
} from "./preschool-operational-projection.js";
import type { PublishedProjectRelease } from "./project-analysis-resolver.js";

const TARGET_PERIOD = {
  start: "2026-06-01",
  endExclusive: "2026-07-01",
  timezone: "Asia/Singapore",
  targetDayCount: 30,
} as const;
const DAILY_TOTALS_QUERY_ID = "daily_totals_v1" as const;

type PlanningOutlook = Extract<
  Extract<PreschoolOperationalProjection, { status: "available" }>["planningOutlook"],
  { status: "provisional" }
>;

export type PreschoolPlanningActualAnalysis = {
  context: {
    scopeId: string;
    from: string;
    to: string;
    timezone: string;
  };
  provenance: {
    dataSnapshotId: string;
    queryIds: readonly string[];
  };
  dailyTotals?: {
    timezone: string;
    scopes: Array<{
      scopeId: string;
      rows: Array<{
        localDate: string;
        usageKwh: number | null;
        dataHealth: { status: "complete" | "partial" | "unavailable" };
      }>;
    }>;
  };
};

export type PreschoolPlanningLifecycle = {
  status: "available";
  contract: {
    id: "preschool-saved-plan-current-actual";
    version: "1";
  };
  targetPeriod: typeof TARGET_PERIOD;
  plan: PlanningOutlook;
  actual: {
    status: "partial" | "complete";
    usageKwh: number | null;
    completeDayCount: number;
    targetDayCount: 30;
    varianceKwh: number | null;
    variancePct: number | null;
  };
  planProvenance: {
    savedAnalysisId: string;
    dataSnapshotId: string;
    projectReleaseId: string;
    templateRevisionId: string;
    queryId: "daily_totals_v1";
    recipeId: "preschool-naive-weekly-planning-baseline-v1";
  };
  actualProvenance: {
    dataSnapshotId: string;
    projectReleaseId: string;
    queryId: "daily_totals_v1";
    period: {
      start: string;
      endExclusive: string;
      timezone: string;
    };
  };
} | {
  status: "unavailable";
  reason: {
    code: "NO_COMPATIBLE_SAVED_ANALYSIS" | "CURRENT_ACTUAL_UNAVAILABLE";
    message: string;
  };
};

type PreschoolPlanningIdentityInput = {
  projectId: string;
  workspaceId: string;
  scopeId: string;
  resource: "electricity";
  templateRevisionId: string;
  projectReleaseId: string;
  currentDataSnapshotId: string;
  savedAnalyses: readonly EnergyIqSavedAnalysisRecord[];
};

export const buildPreschoolJuneActualContext = (
  context: EnergyQueryContext,
): EnergyQueryContext => ({
  ...context,
  from: "2026-05-31T16:00:00.000Z",
  to: "2026-06-30T16:00:00.000Z",
  period: "Custom",
});

export const loadPreschoolPlanningLifecycle = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  userId: string;
  context: EnergyQueryContext;
  projectRelease: PublishedProjectRelease;
  databasePath?: string;
}): Promise<PreschoolPlanningLifecycle> => {
  if (
    input.context.resource !== "electricity"
    || input.projectRelease.templateRevisionId === null
  ) {
    return {
      status: "unavailable",
      reason: {
        code: "NO_COMPATIBLE_SAVED_ANALYSIS",
        message: "A compatible older Saved Analysis with a recoverable June plan is unavailable.",
      },
    };
  }
  return loadPreschoolPlanningLifecycleFromSavedAnalyses({
    projectId: input.context.projectId,
    workspaceId: input.context.workspaceId,
    scopeId: input.context.scopeId,
    resource: "electricity",
    templateRevisionId: input.projectRelease.templateRevisionId,
    projectReleaseId: input.projectRelease.id,
    currentDataSnapshotId: input.context.dataSnapshotId,
    savedAnalyses: input.metadataStore.energyIq.savedAnalyses.listProject(input.context.projectId),
    loadActualAnalysis: () => executeEnergyScopeAnalysis({
      metadataStore: input.metadataStore,
      dataGateway: input.dataGateway,
      userId: input.userId,
      context: buildPreschoolJuneActualContext(input.context),
      projectReleaseId: input.projectRelease.id,
      ruleRevisions: [],
      includeTimeBehaviour: false,
      includeMeterOperationalBreakdown: false,
      profile: "explorer",
      ...(input.databasePath ? { databasePath: input.databasePath } : {}),
    }),
  });
};

export const loadPreschoolPlanningLifecycleFromSavedAnalyses = async (
  input: PreschoolPlanningIdentityInput & {
    loadActualAnalysis: () => Promise<PreschoolPlanningActualAnalysis>;
  },
): Promise<PreschoolPlanningLifecycle> => {
  const reference = findSavedPlanReference(input);
  if (!reference) return noCompatibleSavedAnalysis();
  const actualAnalysis = await input.loadActualAnalysis();
  return buildPreschoolPlanningLifecycle({
    ...input,
    savedAnalyses: [reference.savedAnalysis],
    actualAnalysis,
  });
};

export const buildPreschoolPlanningLifecycle = (input: PreschoolPlanningIdentityInput & {
  actualAnalysis: PreschoolPlanningActualAnalysis;
}): PreschoolPlanningLifecycle => {
  const reference = findSavedPlanReference(input);
  if (!reference) return noCompatibleSavedAnalysis();

  const actual = buildActual({
    analysis: input.actualAnalysis,
    plan: reference.planningOutlook,
    currentDataSnapshotId: input.currentDataSnapshotId,
  });
  if (!actual) {
    return {
      status: "unavailable",
      reason: {
        code: "CURRENT_ACTUAL_UNAVAILABLE",
        message: "Current June daily-total Evidence does not match the active Snapshot.",
      },
    };
  }

  return {
    status: "available",
    contract: {
      id: "preschool-saved-plan-current-actual",
      version: "1",
    },
    targetPeriod: TARGET_PERIOD,
    plan: reference.planningOutlook,
    actual,
    planProvenance: {
      savedAnalysisId: reference.savedAnalysis.id,
      dataSnapshotId: reference.savedAnalysis.data_snapshot_id,
      projectReleaseId: input.projectReleaseId,
      templateRevisionId: input.templateRevisionId,
      queryId: DAILY_TOTALS_QUERY_ID,
      recipeId: "preschool-naive-weekly-planning-baseline-v1",
    },
    actualProvenance: {
      dataSnapshotId: input.currentDataSnapshotId,
      projectReleaseId: input.projectReleaseId,
      queryId: DAILY_TOTALS_QUERY_ID,
      period: {
        start: TARGET_PERIOD.start,
        endExclusive: TARGET_PERIOD.endExclusive,
        timezone: TARGET_PERIOD.timezone,
      },
    },
  };
};

const findSavedPlanReference = (input: PreschoolPlanningIdentityInput) => (
  [...input.savedAnalyses]
    .sort((left, right) => (
      right.created_at.localeCompare(left.created_at)
      || right.sequence - left.sequence
    ))
    .flatMap((savedAnalysis) => {
      const snapshot = compatibleSavedSnapshot(input, savedAnalysis);
      if (!snapshot) return [];
      const planningOutlook = savedPlanningOutlook(snapshot, savedAnalysis.data_snapshot_id);
      return planningOutlook ? [{ savedAnalysis, planningOutlook }] : [];
    })[0]
  ?? null
);

const noCompatibleSavedAnalysis = (): PreschoolPlanningLifecycle => ({
  status: "unavailable",
  reason: {
    code: "NO_COMPATIBLE_SAVED_ANALYSIS",
    message: "A compatible older Saved Analysis with a recoverable June plan is unavailable.",
  },
});

const compatibleSavedSnapshot = (
  input: PreschoolPlanningIdentityInput,
  savedAnalysis: EnergyIqSavedAnalysisRecord,
): Record<string, unknown> | null => {
  if (
    savedAnalysis.project_id !== input.projectId
    || savedAnalysis.workspace_id !== input.workspaceId
    || savedAnalysis.scope_id !== input.scopeId
    || savedAnalysis.resource !== input.resource
    || savedAnalysis.template_revision_id !== input.templateRevisionId
    || savedAnalysis.data_snapshot_id === input.currentDataSnapshotId
    || !savedAnalysis.snapshot_json
  ) return null;
  const query = parseRecord(savedAnalysis.query_json);
  if (!query) return null;
  const snapshot = parseRecord(savedAnalysis.snapshot_json);
  if (!snapshot) return null;
  const context = recordField(snapshot, "context");
  const projectRelease = recordField(snapshot, "projectRelease");
  const renderer = recordField(snapshot, "renderer");
  const dataSnapshot = recordField(snapshot, "dataSnapshot");
  const analysis = recordField(snapshot, "analysis");
  const provenance = analysis ? recordField(analysis, "provenance") : null;
  if (
    !context
    || context.projectId !== input.projectId
    || context.workspaceId !== input.workspaceId
    || context.scopeId !== input.scopeId
    || context.resource !== input.resource
    || context.dataSnapshotId !== savedAnalysis.data_snapshot_id
    || !projectRelease
    || projectRelease.id !== input.projectReleaseId
    || projectRelease.templateRevisionId !== input.templateRevisionId
    || !renderer
    || renderer.key !== "preschool-overview"
    || !dataSnapshot
    || dataSnapshot.id !== savedAnalysis.data_snapshot_id
    || !provenance
    || provenance.dataSnapshotId !== savedAnalysis.data_snapshot_id
  ) return null;
  return snapshot;
};

const savedPlanningOutlook = (
  snapshot: Record<string, unknown>,
  dataSnapshotId: string,
): PlanningOutlook | null => {
  const operational = recordField(snapshot, "preschoolOperational");
  const candidate = operational?.planningOutlook;
  if (candidate !== undefined) {
    return isPlanningOutlook(candidate, dataSnapshotId) ? candidate : null;
  }
  const analysis = planningAnalysisInput(recordField(snapshot, "analysis"));
  if (!analysis) return null;
  const derived = recoverPreschoolPlanningOutlookFromCompleteWeeks(analysis);
  return derived.status === "provisional" && derived.evidence.dataSnapshotId === dataSnapshotId
    ? derived
    : null;
};

const planningAnalysisInput = (
  analysis: Record<string, unknown> | null,
): PreschoolPlanningAnalysisInput | null => {
  const context = analysis ? recordField(analysis, "context") : null;
  const offHours = analysis ? recordField(analysis, "offHours") : null;
  const provenance = analysis ? recordField(analysis, "provenance") : null;
  const dailyTotals = analysis ? recordField(analysis, "dailyTotals") : null;
  const scopes = dailyTotals?.scopes;
  if (
    !context
    || typeof context.scopeId !== "string"
    || !offHours
    || typeof offHours.status !== "string"
    || !provenance
    || typeof provenance.dataSnapshotId !== "string"
    || !isStringArray(provenance.queryIds)
    || !dailyTotals
    || typeof dailyTotals.timezone !== "string"
    || !Array.isArray(scopes)
  ) return null;
  const parsedScopes = scopes.flatMap((scope) => {
    if (!isRecord(scope) || typeof scope.scopeId !== "string" || !Array.isArray(scope.rows)) return [];
    const rows = scope.rows.flatMap((row) => {
      const dataHealth = isRecord(row) ? recordField(row, "dataHealth") : null;
      if (
        !isRecord(row)
        || typeof row.localDate !== "string"
        || !(typeof row.usageKwh === "number" || row.usageKwh === null)
        || !dataHealth
        || !isDailyStatus(dataHealth.status)
      ) return [];
      return [{
        localDate: row.localDate,
        usageKwh: row.usageKwh,
        dataHealth: { status: dataHealth.status },
      }];
    });
    if (rows.length !== scope.rows.length) return [];
    return [{ scopeId: scope.scopeId, rows }];
  });
  if (parsedScopes.length !== scopes.length) return null;
  return {
    context: { scopeId: context.scopeId },
    offHours: { status: offHours.status },
    provenance: {
      dataSnapshotId: provenance.dataSnapshotId,
      queryIds: provenance.queryIds,
    },
    dailyTotals: {
      timezone: dailyTotals.timezone,
      scopes: parsedScopes,
    },
  };
};

const buildActual = (
  input: {
    analysis: PreschoolPlanningActualAnalysis;
    plan: PlanningOutlook;
    currentDataSnapshotId: string;
  },
): Extract<PreschoolPlanningLifecycle, { status: "available" }>["actual"] | null => {
  const { analysis, plan } = input;
  if (
    analysis.context.from !== "2026-05-31T16:00:00.000Z"
    || analysis.context.to !== "2026-06-30T16:00:00.000Z"
    || analysis.context.timezone !== TARGET_PERIOD.timezone
    || analysis.provenance.dataSnapshotId !== input.currentDataSnapshotId
    || analysis.dailyTotals?.timezone !== TARGET_PERIOD.timezone
    || !analysis.provenance.queryIds.includes(DAILY_TOTALS_QUERY_ID)
  ) return null;
  const scope = analysis.dailyTotals.scopes.find((candidate) => (
    candidate.scopeId === analysis.context.scopeId
  ));
  if (!scope) return null;
  const rowsByDate = new Map(scope.rows.map((row) => [row.localDate, row]));
  const targetRows = Array.from({ length: TARGET_PERIOD.targetDayCount }, (_, offset) => (
    rowsByDate.get(`2026-06-${String(offset + 1).padStart(2, "0")}`)
  ));
  const completeRows = targetRows.flatMap((row) => (
    row?.dataHealth.status === "complete" && typeof row.usageKwh === "number"
      ? [row]
      : []
  ));
  const usageKwh = completeRows.length === 0
    ? null
    : round(completeRows.reduce((total, row) => total + (row.usageKwh ?? 0), 0));
  const complete = completeRows.length === TARGET_PERIOD.targetDayCount;
  const varianceKwh = complete && usageKwh !== null
    ? round(usageKwh - plan.usageEstimate.projectedKwh)
    : null;
  return {
    status: complete ? "complete" : "partial",
    usageKwh,
    completeDayCount: completeRows.length,
    targetDayCount: TARGET_PERIOD.targetDayCount,
    varianceKwh,
    variancePct: varianceKwh !== null && plan.usageEstimate.projectedKwh > 0
      ? round((varianceKwh / plan.usageEstimate.projectedKwh) * 100)
      : null,
  };
};

const isPlanningOutlook = (value: unknown, dataSnapshotId: string): value is PlanningOutlook => {
  if (!isRecord(value)) return false;
  const contract = recordField(value, "contract");
  const targetPeriod = recordField(value, "targetPeriod");
  const usageEstimate = recordField(value, "usageEstimate");
  const evidence = recordField(value, "evidence");
  return value.status === "provisional"
    && contract?.id === "preschool-june-2026-naive-weekly-baseline"
    && contract.version === "1"
    && targetPeriod?.start === "2026-06-01"
    && targetPeriod.endInclusive === "2026-06-30"
    && targetPeriod.days === 30
    && typeof usageEstimate?.projectedKwh === "number"
    && typeof usageEstimate.lowerKwh === "number"
    && typeof usageEstimate.upperKwh === "number"
    && evidence?.dataSnapshotId === dataSnapshotId
    && evidence.queryId === DAILY_TOTALS_QUERY_ID
    && evidence.recipeId === "preschool-naive-weekly-planning-baseline-v1"
    && Array.isArray(value.sourceWeeks)
    && isRecord(value.weeklyBaseline)
    && isRecord(value.costEstimate)
    && isRecord(value.tariffReference)
    && Array.isArray(value.limitations);
};

const parseRecord = (json: string): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(json);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
};

const recordField = (
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null => isRecord(value[key]) ? value[key] : null;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const isStringArray = (value: unknown): value is string[] => (
  Array.isArray(value) && value.every((item) => typeof item === "string")
);

const isDailyStatus = (value: unknown): value is "complete" | "partial" | "unavailable" => (
  value === "complete" || value === "partial" || value === "unavailable"
);

const round = (value: number): number => Math.round(value * 100) / 100;
