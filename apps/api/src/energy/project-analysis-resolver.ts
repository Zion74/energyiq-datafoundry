import {
  resolveEnergyFactStorePath,
  type LocalDataGateway,
} from "@datafoundry/data-gateway";
import {
  createDefaultTemplateDocument,
  type EnergyIqComponentRevisionRecord,
  type EnergyIqTemplateDraftDocument,
  type EnergyIqTemplateRevisionRecord,
  type MetadataStore,
  type UserRecord,
} from "@datafoundry/metadata";
import type { ReportTimeContext, ReportTimePolicyRevision } from "@datafoundry/contracts";
import { existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

import {
  executeEnergyDailyTotalsProjection,
  executeEnergyScopeAnalysis,
  executeEnergyScopeAnalysisWithLatestAvailable,
  resolveEnergyCurrentOverviewPeriodBasis,
  selectEnergyCurrentOverviewPeriod,
  selectEnergyLatestCompleteDay,
  selectEnergyLatestCompletePeriod,
  type EnergyScopeAnalysis,
} from "./energy-analysis.js";
import {
  projectAnalysisPayload,
  resolveProjectAnalysisMetadata,
  type ProjectAnalysisMetadataProjection,
  type ProjectAnalysisPayload,
} from "./project-analysis-metadata.js";
import {
  buildNgeeAnnDecisionPriorities,
  type NgeeAnnDecisionPriorities,
} from "./ngee-ann-decision-priorities.js";
import {
  buildNgeeAnnDecisionLifecycle,
  type NgeeAnnDecisionLifecycle,
} from "./ngee-ann-decision-lifecycle.js";
import {
  hasCompletePreschoolBenchmarkWindow,
  resolvePreschoolBenchmarkProjection,
  type PreschoolBenchmarkProjection,
} from "./preschool-benchmark-projection.js";
import {
  buildPreschoolApplianceProjection,
  type PreschoolApplianceProjection,
} from "./preschool-appliance-projection.js";
import {
  loadPreschoolOperationalProjection,
  resolvePreschoolPlanningSourcePeriod,
  type PreschoolOperationalProjection,
} from "./preschool-operational-projection.js";
import {
  buildPreschoolMonthlyActualContext,
  loadPreschoolPlanningLifecycle,
  resolvePreschoolMonthlyTargetPeriod,
  type PreschoolMonthlyTargetPeriod,
  type PreschoolPlanningLifecycle,
} from "./preschool-planning-lifecycle.js";
import {
  buildPreschoolDecisionSignals,
  type PreschoolDecisionSignals,
} from "./preschool-decision-signals.js";
import {
  resolveEnergyAccessContext,
  resolveEnergyQueryContext,
  type EnergyQueryContext,
  type EnergyQueryContextRequest,
} from "./energy-query-context.js";
import {
  createProjectAnalysisCacheKey,
  createProjectAnalysisResultCache,
  type ProjectAnalysisResultCache,
} from "./project-analysis-result-cache.js";
import {
  reportTimePeriodDayCount,
  resolveReportTimeContext,
} from "./report-time-context.js";

export type ProjectRendererKey = "ngee-ann-overview" | "preschool-overview";

const PROJECT_ANALYSIS_RECIPE = {
  id: "energy-scope-analysis",
  version: "1",
} as const;

const PROJECT_RENDERER_VERSION = "1" as const;
const PROJECT_RENDERER_CONTRACT_VERSION = "project-analysis-snapshot@1" as const;

export type PublishedProjectRelease = {
  id: string;
  source: "template-revision" | "legacy-profile";
  projectId: string;
  templateRevisionId: string | null;
  templateRevisionSequence: number | null;
  recipe: {
    id: "energy-scope-analysis";
    version: "1";
  };
  renderer: {
    key: ProjectRendererKey;
    version: "1";
    contractVersion: "project-analysis-snapshot@1";
  };
  hierarchyRevisionId: string;
  meterMappingRevisionId: string;
  meterFormulaRevisionId: string;
  metricRevisionIds: string[];
  ruleRevisionIds: string[];
  businessCalendarVersion: string;
  tariffScheduleVersion: string;
  publishedAt: string | null;
  document: EnergyIqTemplateDraftDocument;
  catalog: EnergyIqComponentRevisionRecord[];
};

export type ProjectAnalysisSnapshot = {
  context: EnergyQueryContext & {
    primaryPeriod: {
      start: string;
      endExclusive: string;
    };
    projectReleaseId: string;
    latestCompleteLocalDay?: string | null;
    monthlyOutlookTargetPeriod?: PreschoolMonthlyTargetPeriod | null;
  };
  projectRelease: PublishedProjectRelease;
  reportTimeContext?: ReportTimeContext;
  reportWindowAnalyses?: ProjectReportWindowAnalysis[];
  reportWindowSegmentSummaries?: ProjectReportWindowSegmentSummary[];
  recipe: PublishedProjectRelease["recipe"];
  renderer: PublishedProjectRelease["renderer"];
  dataQuality: EnergyScopeAnalysis["dataHealth"];
  evidence: Array<{
    id: string;
    metricId: string;
    queryIds: EnergyScopeAnalysis["provenance"]["queryIds"];
    queryReceiptId?: string;
  }>;
  findings: EnergyScopeAnalysis["attention"];
  decisionPriorities?: NgeeAnnDecisionPriorities;
  decisionLifecycle?: NgeeAnnDecisionLifecycle;
  preschoolBenchmark?: PreschoolBenchmarkProjection;
  preschoolAppliances?: PreschoolApplianceProjection;
  preschoolOperational?: PreschoolOperationalProjection;
  preschoolPlanningLifecycle?: PreschoolPlanningLifecycle;
  preschoolDecisionSignals?: PreschoolDecisionSignals;
  dataSnapshot: {
    id: string;
    importBatchIds: string[];
    lastSeenAt: string | null;
  };
  latestAvailablePeriod?: {
    period: "Custom";
    from: string;
    to: string;
  };
  metadata: ProjectAnalysisMetadataProjection;
  analysis: ProjectAnalysisPayload;
};

export type ProjectReportWindowAnalysis = {
  windowId: string;
  period: {
    start: string;
    endExclusive: string;
  };
  status: "ready";
  analysis: {
    summary: ProjectAnalysisPayload["summary"];
    offHours: ProjectAnalysisPayload["offHours"];
    dailyTotals?: NonNullable<ProjectAnalysisPayload["dailyTotals"]>;
    timeBehaviour?: NonNullable<ProjectAnalysisPayload["timeBehaviour"]>;
    componentHourlyProfiles?: NonNullable<ProjectAnalysisPayload["componentHourlyProfiles"]>;
    composition?: Pick<ProjectAnalysisPayload,
      | "provenance"
      | "comparison"
      | "categories"
      | "childScopes"
      | "circuits"
      | "designatedTotals"
      | "componentReconciliation"
      | "virtualMeterTraces"
    >;
  };
};

export type ProjectReportWindowSegmentSummary = {
  windowId: string;
  status: "ready";
  segments: Array<{
    period: {
      start: string;
      endExclusive: string;
    };
    dataStatus: "complete" | "partial" | "unavailable";
    expectedDayCount: number;
    completeDayCount: number;
    summary: {
      usageKwh: number;
      averageDailyUsageKwh: number;
    } | null;
    evidence: {
      dataSnapshotId: string;
      queryId: "daily_totals_v1";
    };
  }>;
};

export type ProjectAnalysisResolution =
  | {
    status: "ready";
    snapshot: ProjectAnalysisSnapshot;
  }
  | {
    status: "configuration-required";
    context: EnergyQueryContext;
    projectId: string;
    title: "Project analysis is not configured";
    detail: string;
  };

type ReadyProjectAnalysisResolution = Extract<ProjectAnalysisResolution, { status: "ready" }>;
type PublishedRunContext = {
  context: EnergyQueryContext;
  projectRelease: PublishedProjectRelease | null;
  validatePinnedOverviewPeriod?: () => Promise<void>;
};

const PROJECT_ANALYSIS_CACHE_CAPACITY = 6;
// Snapshot and Release identity are immutable cache-key inputs. Keep the hot
// result for a working day; a data or release change naturally selects a new key.
const PROJECT_ANALYSIS_CACHE_TTL_MS = 24 * 60 * 60_000;
const PROJECT_PLANNING_LIFECYCLE_CACHE_CAPACITY = 12;
const PROJECT_PLANNING_LIFECYCLE_CACHE_TTL_MS = 24 * 60 * 60_000;
const PROJECT_ANALYSIS_CACHES = new WeakMap<
  MetadataStore,
  WeakMap<LocalDataGateway, ProjectAnalysisResultCache<ReadyProjectAnalysisResolution>>
>();
const PROJECT_PLANNING_LIFECYCLE_CACHES = new WeakMap<
  MetadataStore,
  WeakMap<LocalDataGateway, ProjectAnalysisResultCache<PreschoolPlanningLifecycle>>
>();

const projectAnalysisCacheFor = (
  metadataStore: MetadataStore,
  dataGateway: LocalDataGateway,
): ProjectAnalysisResultCache<ReadyProjectAnalysisResolution> => {
  let gatewayCaches = PROJECT_ANALYSIS_CACHES.get(metadataStore);
  if (!gatewayCaches) {
    gatewayCaches = new WeakMap();
    PROJECT_ANALYSIS_CACHES.set(metadataStore, gatewayCaches);
  }
  let cache = gatewayCaches.get(dataGateway);
  if (!cache) {
    cache = createProjectAnalysisResultCache({
      capacity: PROJECT_ANALYSIS_CACHE_CAPACITY,
      ttlMs: PROJECT_ANALYSIS_CACHE_TTL_MS,
    });
    gatewayCaches.set(dataGateway, cache);
  }
  return cache;
};

const projectPlanningLifecycleCacheFor = (
  metadataStore: MetadataStore,
  dataGateway: LocalDataGateway,
): ProjectAnalysisResultCache<PreschoolPlanningLifecycle> => {
  let gatewayCaches = PROJECT_PLANNING_LIFECYCLE_CACHES.get(metadataStore);
  if (!gatewayCaches) {
    gatewayCaches = new WeakMap();
    PROJECT_PLANNING_LIFECYCLE_CACHES.set(metadataStore, gatewayCaches);
  }
  let cache = gatewayCaches.get(dataGateway);
  if (!cache) {
    cache = createProjectAnalysisResultCache({
      capacity: PROJECT_PLANNING_LIFECYCLE_CACHE_CAPACITY,
      ttlMs: PROJECT_PLANNING_LIFECYCLE_CACHE_TTL_MS,
    });
    gatewayCaches.set(dataGateway, cache);
  }
  return cache;
};

export type ProjectOverviewProfile = {
  rendererKey: ProjectRendererKey;
  rendererVersion: "1";
  contractVersion: "project-analysis-snapshot@1";
  currentAnalysisWindow: "current-overview-28d" | "current-month-to-date";
  source: "overview-definition" | "legacy-profile";
  horizons: {
    latestStatus: "latest-complete-day";
    shortTermDays: 7;
    mainDays: 28;
  };
};

const LEGACY_PROJECT_OVERVIEW_PROFILES: Readonly<Record<string, ProjectOverviewProfile>> = {
  "ngee-ann-polytechnic": {
    rendererKey: "ngee-ann-overview",
    rendererVersion: "1",
    contractVersion: "project-analysis-snapshot@1",
    currentAnalysisWindow: "current-month-to-date",
    source: "legacy-profile",
    horizons: { latestStatus: "latest-complete-day", shortTermDays: 7, mainDays: 28 },
  },
  "preschool-demo": {
    rendererKey: "preschool-overview",
    rendererVersion: "1",
    contractVersion: "project-analysis-snapshot@1",
    currentAnalysisWindow: "current-overview-28d",
    source: "legacy-profile",
    horizons: { latestStatus: "latest-complete-day", shortTermDays: 7, mainDays: 28 },
  },
};

export const resolveProjectOverviewProfile = (
  metadataStore: MetadataStore,
  projectId: string,
): ProjectOverviewProfile | null => {
  const revision = metadataStore.energyIq.templates.getLatestProjectRevision(projectId);
  const definitionRecord = revision
    ? metadataStore.energyIq.overviewDefinitions.get(revision.revision_id)
    : null;
  if (definitionRecord) {
    const policy = metadataStore.energyIq.reportTimePolicies.get(
      projectId,
      definitionRecord.time_policy_revision_id,
    )?.policy;
    const primaryWindowId = definitionRecord.definition.sections[0]?.primaryWindowId;
    const primaryStrategy = policy?.windows.find((window) => window.windowId === primaryWindowId)?.strategy;
    const currentAnalysisWindow = primaryStrategy?.kind === "calendar_month_to_date"
      ? "current-month-to-date" as const
      : primaryStrategy?.kind === "rolling_complete_days" && primaryStrategy.days === 28
        ? "current-overview-28d" as const
        : null;
    if (!currentAnalysisWindow) throw new Error("ENERGYIQ_OVERVIEW_PRIMARY_WINDOW_UNSUPPORTED");
    return {
      rendererKey: definitionRecord.renderer_key,
      rendererVersion: PROJECT_RENDERER_VERSION,
      contractVersion: PROJECT_RENDERER_CONTRACT_VERSION,
      currentAnalysisWindow,
      source: "overview-definition",
      horizons: { latestStatus: "latest-complete-day", shortTermDays: 7, mainDays: 28 },
    };
  }
  return LEGACY_PROJECT_OVERVIEW_PROFILES[projectId] ?? null;
};

export const resolveProjectAnalysis = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  user: UserRecord;
  workspaceId: string;
  request: EnergyQueryContextRequest;
  databasePath?: string;
  bypassCache?: boolean;
  now?: Date;
  env?: Record<string, string | undefined>;
}): Promise<ProjectAnalysisResolution> => {
  const resolvedAt = (input.now ?? new Date()).toISOString();
  const access = resolveEnergyAccessContext({
    metadataStore: input.metadataStore,
    user: input.user,
    requestedWorkspaceId: input.workspaceId,
    ...(input.env ? { env: input.env } : {}),
  });
  const accessibleProject = access.projects.find((project) => project.id === input.request.projectId);
  if (!accessibleProject || accessibleProject.workspaceId !== access.activeWorkspaceId) {
    throw new Error("ENERGYIQ_PROJECT_FORBIDDEN");
  }
  const legacyProfile = resolveProjectOverviewProfile(input.metadataStore, input.request.projectId);
  if (!legacyProfile) {
    const context = resolveEnergyQueryContext({
      metadataStore: input.metadataStore,
      user: input.user,
      workspaceId: input.workspaceId,
      request: input.request,
      allowUnconfigured: true,
      ...(input.now ? { now: input.now } : {}),
      ...(input.env ? { env: input.env } : {}),
    });
    return {
      status: "configuration-required",
      context,
      projectId: context.projectId,
      title: "Project analysis is not configured",
      detail: "Publish a Project Template Revision and register its customer Renderer before opening the customer Overview.",
    };
  }
  const publishedRunContext: PublishedRunContext = input.request.analysisWindow === "latest-complete-day"
    || input.request.analysisWindow === "latest-complete-7d"
    || input.request.analysisWindow === "current-project-overview"
    || input.request.analysisWindow === "current-overview-28d"
    || input.request.analysisWindow === "current-month-to-date"
    ? await resolveCurrentOverviewContext(input)
    : resolvePublishedEnergyQueryContext({
        metadataStore: input.metadataStore,
        user: input.user,
        workspaceId: input.workspaceId,
        request: input.request,
        ...(input.now ? { now: input.now } : {}),
        ...(input.env ? { env: input.env } : {}),
      });
  const releasedContext = publishedRunContext.context;
  const projectRelease = publishedRunContext.projectRelease;
  if (!projectRelease) throw new Error("ENERGYIQ_PROJECT_RELEASE_REQUIRED");
  const analysisDatabasePath = input.databasePath === ":memory:"
    ? input.databasePath
    : input.databasePath
      ? resolvePath(input.databasePath)
      : resolveEnergyFactStorePath(releasedContext.workspaceId);
  if (analysisDatabasePath !== ":memory:" && !existsSync(analysisDatabasePath)) {
    throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  }
  const cacheKey = createProjectAnalysisCacheKey({
    userId: input.user.id,
    workspaceId: releasedContext.workspaceId,
    projectId: releasedContext.projectId,
    scopeId: releasedContext.scopeId,
    resource: releasedContext.resource,
    analysisWindow: input.request.analysisWindow ?? null,
    period: releasedContext.period,
    timezone: releasedContext.timezone,
    from: releasedContext.from,
    to: releasedContext.to,
    dataSnapshotId: releasedContext.dataSnapshotId,
    projectReleaseId: projectRelease.id,
    hierarchyRevisionId: projectRelease.hierarchyRevisionId,
    meterMappingRevisionId: projectRelease.meterMappingRevisionId,
    meterFormulaRevisionId: projectRelease.meterFormulaRevisionId,
    metricVersion: releasedContext.metricVersion,
    businessCalendarVersion: projectRelease.businessCalendarVersion,
    tariffScheduleVersion: projectRelease.tariffScheduleVersion,
    rendererKey: projectRelease.renderer.key,
    rendererVersion: projectRelease.renderer.version,
    rendererContractVersion: projectRelease.renderer.contractVersion,
    recipeId: projectRelease.recipe.id,
    recipeVersion: projectRelease.recipe.version,
    metricRevisionIds: projectRelease.metricRevisionIds,
    ruleRevisionIds: projectRelease.ruleRevisionIds,
    databasePath: analysisDatabasePath,
  });
  const resolution = await projectAnalysisCacheFor(input.metadataStore, input.dataGateway).resolve(
    cacheKey,
    async () => {
      await publishedRunContext.validatePinnedOverviewPeriod?.();
      const scopeAnalysis = await executeEnergyScopeAnalysisWithLatestAvailable({
        metadataStore: input.metadataStore,
        dataGateway: input.dataGateway,
        userId: input.user.id,
        context: releasedContext,
        projectReleaseId: projectRelease.id,
        includeTimeBehaviour: projectRelease.renderer.key === "ngee-ann-overview",
        includeMeterOperationalBreakdown: projectRelease.renderer.key !== "preschool-overview",
        ruleRevisions: input.metadataStore.energyIq.rules.listRevisions()
          .filter((rule) => projectRelease.ruleRevisionIds.includes(rule.revision_id)),
        databasePath: analysisDatabasePath,
      });
      const projectRoot = releasedContext.scopeId === input.metadataStore.energyIq
        .getProject(releasedContext.projectId).root_scope_id;
      const preschoolRoot = projectRelease.renderer.key === "preschool-overview" && projectRoot;
      const preschoolLatestCompleteLocalDay = preschoolRoot
        ? await selectPreschoolLatestCompleteLocalDay({
            metadataStore: input.metadataStore,
            dataGateway: input.dataGateway,
            userId: input.user.id,
            context: releasedContext,
            databasePath: analysisDatabasePath,
          })
        : null;
      const preschoolMonthlyOutlookTargetPeriod = preschoolLatestCompleteLocalDay
        ? resolvePreschoolMonthlyTargetPeriod(
            preschoolLatestCompleteLocalDay,
            releasedContext.timezone,
          )
        : null;
      const snapshotContext: ProjectAnalysisSnapshot["context"] = {
        ...releasedContext,
        primaryPeriod: {
          start: releasedContext.from,
          endExclusive: releasedContext.to,
        },
        projectReleaseId: projectRelease.id,
        ...(preschoolRoot ? {
          latestCompleteLocalDay: preschoolLatestCompleteLocalDay,
          monthlyOutlookTargetPeriod: preschoolMonthlyOutlookTargetPeriod,
        } : {}),
      };
      const evidenceMetricIds = [...(
        projectRelease.metricRevisionIds.length > 0
          ? projectRelease.metricRevisionIds
          : [scopeAnalysis.provenance.metricVersion]
      )].sort((left, right) => left.localeCompare(right));
      const metadata = resolveProjectAnalysisMetadata({
        metadataStore: input.metadataStore,
        projectId: releasedContext.projectId,
        hierarchyRevisionId: releasedContext.hierarchyRevisionId,
        timezone: releasedContext.timezone,
        period: snapshotContext.primaryPeriod,
        analysis: scopeAnalysis,
      });
      const analysis = projectAnalysisPayload({ analysis: scopeAnalysis, metadata });
      const decisionPriorities = projectRelease.renderer.key === "ngee-ann-overview"
        ? buildNgeeAnnDecisionPriorities({
            selectedScopeId: releasedContext.scopeId,
            primaryPeriod: snapshotContext.primaryPeriod,
            expectedEvidencePins: {
              projectReleaseId: projectRelease.id,
              dataSnapshotId: analysis.provenance.dataSnapshotId,
              hierarchyRevisionId: projectRelease.hierarchyRevisionId,
              meterMappingRevisionId: projectRelease.meterMappingRevisionId,
              meterFormulaRevisionId: projectRelease.meterFormulaRevisionId,
              metricVersion: releasedContext.metricVersion,
              businessCalendarVersion: projectRelease.businessCalendarVersion,
              queryIds: ["time_slot_anomaly_v1"],
            },
            dailyUsageAnomalies: analysis.dailyUsageAnomalies,
          })
        : undefined;
      const preschoolBenchmark = preschoolRoot
        && hasCompletePreschoolBenchmarkWindow(analysis, releasedContext.scopeId)
          ? resolvePreschoolBenchmarkProjection({
              metadataStore: input.metadataStore,
              projectRelease,
              dataSnapshotId: analysis.provenance.dataSnapshotId,
              period: snapshotContext.primaryPeriod,
              timezone: releasedContext.timezone,
              analysis,
            })
          : undefined;
      const preschoolAppliances = preschoolRoot
          ? buildPreschoolApplianceProjection({
              projectRelease,
              period: snapshotContext.primaryPeriod,
              timezone: releasedContext.timezone,
              analysis,
            })
          : undefined;
      let preschoolPlanningAnalysis: ProjectAnalysisPayload | undefined;
      if (preschoolRoot && preschoolMonthlyOutlookTargetPeriod) {
        try {
          const planningSourcePeriod = resolvePreschoolPlanningSourcePeriod(
            preschoolMonthlyOutlookTargetPeriod,
          );
          const planningContext = buildPreschoolMonthlyActualContext(
            releasedContext,
            planningSourcePeriod,
          );
          const planningScopeAnalysis = await executeEnergyScopeAnalysis({
            metadataStore: input.metadataStore,
            dataGateway: input.dataGateway,
            userId: input.user.id,
            context: planningContext,
            projectReleaseId: projectRelease.id,
            ruleRevisions: [],
            includeTimeBehaviour: false,
            includeMeterOperationalBreakdown: false,
            includeImmediateChildDailyTotals: true,
            profile: "explorer",
            databasePath: analysisDatabasePath,
          });
          preschoolPlanningAnalysis = projectAnalysisPayload({
            analysis: planningScopeAnalysis,
            metadata: resolveProjectAnalysisMetadata({
              metadataStore: input.metadataStore,
              projectId: planningContext.projectId,
              hierarchyRevisionId: planningContext.hierarchyRevisionId,
              timezone: planningContext.timezone,
              period: { start: planningContext.from, endExclusive: planningContext.to },
              analysis: planningScopeAnalysis,
            }),
          });
        } catch {
          // Planning is an independent deterministic projection. Missing
          // source weeks must not suppress Sections 3/4.
          preschoolPlanningAnalysis = undefined;
        }
      }
      const preschoolOperational = preschoolRoot
          ? await loadPreschoolOperationalProjection({
              metadataStore: input.metadataStore,
              dataGateway: input.dataGateway,
              userId: input.user.id,
              projectRelease,
              context: releasedContext,
              analysis,
              ...(preschoolPlanningAnalysis ? { planningAnalysis: preschoolPlanningAnalysis } : {}),
              ...(preschoolMonthlyOutlookTargetPeriod
                ? { planningTargetPeriod: preschoolMonthlyOutlookTargetPeriod }
                : {}),
              databasePath: analysisDatabasePath,
            })
          : undefined;
      const preschoolDecisionSignals = preschoolRoot
          ? buildPreschoolDecisionSignals({
              projectReleaseId: projectRelease.id,
              dataSnapshotId: analysis.provenance.dataSnapshotId,
              period: {
                ...snapshotContext.primaryPeriod,
                timezone: releasedContext.timezone,
              },
              dataQualityStatus: analysis.dataHealth.status,
              totalCentreCount: analysis.childScopes.length,
              ...(preschoolBenchmark ? { benchmark: preschoolBenchmark } : {}),
              ...(preschoolOperational ? { operational: preschoolOperational } : {}),
            })
          : undefined;
      const latestAvailablePeriod = scopeAnalysis.latestAvailablePeriod ?? null;
      const reportTimePolicy = resolveSnapshotReportTimePolicy({
        metadataStore: input.metadataStore,
        projectRelease,
      });
      const reportTimeContext = reportTimePolicy
        ? resolveReportTimeContext({
            binding: {
              workspaceId: releasedContext.workspaceId,
              projectId: releasedContext.projectId,
              scopeId: releasedContext.scopeId,
              resource: releasedContext.resource,
              dataSnapshotId: analysis.provenance.dataSnapshotId,
              projectReleaseId: projectRelease.id,
            },
            timezone: releasedContext.timezone,
            asOf: resolvedAt,
            acceptedDataEndExclusive: snapshotContext.primaryPeriod.endExclusive,
            lastRefreshedAt: resolvedAt,
            policy: reportTimePolicy,
          })
        : undefined;
      const reportWindowAnalyses = reportTimeContext && projectRoot
        ? await materializeReportWindowAnalyses({
            metadataStore: input.metadataStore,
            dataGateway: input.dataGateway,
            userId: input.user.id,
            projectRelease,
            releasedContext,
            primaryPeriod: snapshotContext.primaryPeriod,
            primaryAnalysis: analysis,
            reportTimeContext,
            databasePath: analysisDatabasePath,
          })
        : undefined;
      const reportWindowSegmentSummaries = reportTimeContext && projectRoot
        ? await materializeReportWindowSegmentSummaries({
            metadataStore: input.metadataStore,
            dataGateway: input.dataGateway,
            userId: input.user.id,
            projectRelease,
            releasedContext,
            reportTimeContext,
            databasePath: analysisDatabasePath,
          })
        : undefined;
      return {
        status: "ready",
        snapshot: {
          context: snapshotContext,
          projectRelease,
          ...(reportTimeContext ? { reportTimeContext } : {}),
          ...(reportWindowAnalyses ? { reportWindowAnalyses } : {}),
          ...(reportWindowSegmentSummaries?.length
            ? { reportWindowSegmentSummaries }
            : {}),
          recipe: projectRelease.recipe,
          renderer: projectRelease.renderer,
          dataQuality: analysis.dataHealth,
          evidence: evidenceMetricIds.map((metricId) => ({
            id: [
              "evidence",
              analysis.provenance.dataSnapshotId,
              releasedContext.scopeId,
              releasedContext.from,
              releasedContext.to,
              metricId,
            ].join(":"),
            metricId,
            queryIds: [...analysis.provenance.queryIds],
          })),
          findings: analysis.attention,
          ...(decisionPriorities ? { decisionPriorities } : {}),
          ...(preschoolBenchmark ? { preschoolBenchmark } : {}),
          ...(preschoolAppliances ? { preschoolAppliances } : {}),
          ...(preschoolOperational ? { preschoolOperational } : {}),
          ...(preschoolDecisionSignals ? { preschoolDecisionSignals } : {}),
          dataSnapshot: {
            id: analysis.provenance.dataSnapshotId,
            importBatchIds: analysis.dataHealth.importBatchIds,
            lastSeenAt: analysis.dataHealth.lastSeenAt ?? null,
          },
          ...(latestAvailablePeriod ? { latestAvailablePeriod } : {}),
          metadata,
          analysis,
        },
      };
    },
    { bypass: input.bypassCache === true || analysisDatabasePath === ":memory:" },
  );
  if (
    resolution.snapshot.renderer.key === "preschool-overview"
    && resolution.snapshot.context.resource === "electricity"
    && resolution.snapshot.context.scopeId === input.metadataStore.energyIq
      .getProject(resolution.snapshot.context.projectId).root_scope_id
  ) {
    const latestCompleteLocalDay = resolution.snapshot.context.latestCompleteLocalDay;
    const savedAnalyses = input.metadataStore.energyIq.savedAnalyses.listProject(
      releasedContext.projectId,
    );
    const lifecycleCacheKey = JSON.stringify({
      contract: "preschool-planning-lifecycle-cache@1",
      userId: input.user.id,
      workspaceId: releasedContext.workspaceId,
      projectId: releasedContext.projectId,
      scopeId: releasedContext.scopeId,
      dataSnapshotId: releasedContext.dataSnapshotId,
      projectReleaseId: projectRelease.id,
      templateRevisionId: projectRelease.templateRevisionId,
      latestCompleteLocalDay,
      databasePath: analysisDatabasePath,
      savedAnalyses: savedAnalyses.map((saved) => ({
        id: saved.id,
        sequence: saved.sequence,
        dataSnapshotId: saved.data_snapshot_id,
        templateRevisionId: saved.template_revision_id,
        createdAt: saved.created_at,
      })),
    });
    const preschoolPlanningLifecycle = latestCompleteLocalDay
      ? await projectPlanningLifecycleCacheFor(input.metadataStore, input.dataGateway).resolve(
        lifecycleCacheKey,
        () => loadPreschoolPlanningLifecycle({
          metadataStore: input.metadataStore,
          dataGateway: input.dataGateway,
          userId: input.user.id,
          context: releasedContext,
          projectRelease,
          latestCompleteLocalDay,
          savedAnalyses,
          databasePath: analysisDatabasePath,
        }),
        { bypass: input.bypassCache === true || analysisDatabasePath === ":memory:" },
      )
      : undefined;
    return {
      ...resolution,
      snapshot: {
        ...resolution.snapshot,
        ...(preschoolPlanningLifecycle ? { preschoolPlanningLifecycle } : {}),
      },
    };
  }
  if (resolution.snapshot.renderer.key !== "ngee-ann-overview"
    || !resolution.snapshot.decisionPriorities) return resolution;
  const decisionLifecycle = buildNgeeAnnDecisionLifecycle({
    projectId: resolution.snapshot.context.projectId,
    workspaceId: resolution.snapshot.context.workspaceId,
    scopeId: resolution.snapshot.context.scopeId,
    resource: "electricity",
    templateRevisionId: resolution.snapshot.projectRelease.templateRevisionId,
    currentDataSnapshotId: resolution.snapshot.dataSnapshot.id,
    currentPriorities: resolution.snapshot.decisionPriorities,
    currentDailyUsageAnomalies: resolution.snapshot.analysis.dailyUsageAnomalies,
    savedAnalyses: input.metadataStore.energyIq.savedAnalyses.listProject(
      resolution.snapshot.context.projectId,
    ),
  });
  return {
    ...resolution,
    snapshot: {
      ...resolution.snapshot,
      decisionLifecycle,
    },
  };
};

const materializeReportWindowAnalyses = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  userId: string;
  projectRelease: PublishedProjectRelease;
  releasedContext: EnergyQueryContext;
  primaryPeriod: ProjectAnalysisSnapshot["context"]["primaryPeriod"];
  primaryAnalysis: ProjectAnalysisPayload;
  reportTimeContext: ReportTimeContext;
  databasePath: string;
}): Promise<ProjectReportWindowAnalysis[]> => Promise.all(input.reportTimeContext.windows
  .filter((window) => (
    window.strategy.kind === "calendar_month_to_date"
    || window.strategy.kind === "rolling_complete_days"
  ))
  .map(async (window): Promise<ProjectReportWindowAnalysis> => {
    const period = {
      start: window.from,
      endExclusive: window.toExclusive,
    };
    if (
      period.start === input.primaryPeriod.start
      && period.endExclusive === input.primaryPeriod.endExclusive
    ) {
      return {
        windowId: window.windowId,
        period,
        status: "ready",
        analysis: reportWindowAnalysisProjection(input.primaryAnalysis, false),
      };
    }
    const context: EnergyQueryContext = {
      ...input.releasedContext,
      period: "Custom",
      from: period.start,
      to: period.endExclusive,
    };
    const scopeAnalysis = await executeEnergyScopeAnalysis({
      metadataStore: input.metadataStore,
      dataGateway: input.dataGateway,
      userId: input.userId,
      context,
      projectReleaseId: input.projectRelease.id,
      includeTimeBehaviour: input.projectRelease.renderer.key === "ngee-ann-overview",
      includeMeterOperationalBreakdown: input.projectRelease.renderer.key !== "preschool-overview",
      ruleRevisions: input.metadataStore.energyIq.rules.listRevisions()
        .filter((rule) => input.projectRelease.ruleRevisionIds.includes(rule.revision_id)),
      databasePath: input.databasePath,
    });
    const analysis = projectAnalysisPayload({
      analysis: scopeAnalysis,
      metadata: resolveProjectAnalysisMetadata({
        metadataStore: input.metadataStore,
        projectId: context.projectId,
        hierarchyRevisionId: context.hierarchyRevisionId,
        timezone: context.timezone,
        period,
        analysis: scopeAnalysis,
      }),
    });
    return {
      windowId: window.windowId,
      period,
      status: "ready",
      analysis: reportWindowAnalysisProjection(analysis, true),
    };
  }));

const reportWindowAnalysisProjection = (
  analysis: ProjectAnalysisPayload,
  includeHourly: boolean,
): ProjectReportWindowAnalysis["analysis"] => ({
  summary: analysis.summary,
  offHours: analysis.offHours,
  ...(analysis.dailyTotals ? { dailyTotals: analysis.dailyTotals } : {}),
  ...(includeHourly && analysis.timeBehaviour ? { timeBehaviour: analysis.timeBehaviour } : {}),
  ...(includeHourly && analysis.componentHourlyProfiles
    ? { componentHourlyProfiles: analysis.componentHourlyProfiles }
    : {}),
  ...(includeHourly ? {
    composition: {
      provenance: analysis.provenance,
      comparison: analysis.comparison,
      categories: analysis.categories,
      childScopes: analysis.childScopes,
      circuits: analysis.circuits,
      designatedTotals: analysis.designatedTotals,
      componentReconciliation: analysis.componentReconciliation,
      ...(analysis.virtualMeterTraces ? { virtualMeterTraces: analysis.virtualMeterTraces } : {}),
    },
  } : {}),
});

const materializeReportWindowSegmentSummaries = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  userId: string;
  projectRelease: PublishedProjectRelease;
  releasedContext: EnergyQueryContext;
  reportTimeContext: ReportTimeContext;
  databasePath: string;
}): Promise<ProjectReportWindowSegmentSummary[]> => {
  const windows = input.reportTimeContext.windows.filter((window) => (
    window.strategy.kind === "completed_calendar_months"
    || window.strategy.kind === "prior_equivalent_progress"
  ));
  const allSegments = windows.flatMap((window) => window.segments);
  if (allSegments.length === 0) return [];

  const context: EnergyQueryContext = {
    ...input.releasedContext,
    period: "Custom",
    from: allSegments.reduce(
      (earliest, segment) => segment.from < earliest ? segment.from : earliest,
      allSegments[0]!.from,
    ),
    to: allSegments.reduce(
      (latest, segment) => segment.toExclusive > latest ? segment.toExclusive : latest,
      allSegments[0]!.toExclusive,
    ),
  };
  const projection = await executeEnergyDailyTotalsProjection({
    metadataStore: input.metadataStore,
    dataGateway: input.dataGateway,
    userId: input.userId,
    context,
    databasePath: input.databasePath,
  });
  const selectedScopeRows = projection.dailyTotals.scopes.find(
    (scope) => scope.scopeId === input.releasedContext.scopeId,
  )?.rows ?? [];

  return windows.map((window) => ({
    windowId: window.windowId,
    status: "ready" as const,
    segments: [...window.segments]
      .sort((left, right) => left.from.localeCompare(right.from))
      .map((segment) => {
        const expectedDayCount = reportTimePeriodDayCount(
          segment,
          input.reportTimeContext.timezone,
        );
        const rows = selectedScopeRows.filter((row) => (
          row.from >= segment.from && row.to <= segment.toExclusive
        ));
        const completeRows = rows.filter((row) => row.dataHealth.status === "complete");
        const availableRows = rows.filter((row) => row.usageKwh !== null);
        const dataStatus = completeRows.length === expectedDayCount
          ? "complete" as const
          : availableRows.length === 0
            ? "unavailable" as const
            : "partial" as const;
        const usageKwh = completeRows.reduce((sum, row) => sum + (row.usageKwh ?? 0), 0);
        return {
          period: {
            start: segment.from,
            endExclusive: segment.toExclusive,
          },
          dataStatus,
          expectedDayCount,
          completeDayCount: completeRows.length,
          summary: dataStatus === "complete" ? {
            usageKwh: roundReportValue(usageKwh),
            averageDailyUsageKwh: roundReportValue(usageKwh / expectedDayCount),
          } : null,
          evidence: {
            dataSnapshotId: projection.provenance.dataSnapshotId,
            queryId: projection.provenance.queryId,
          },
        };
      }),
  }));
};

const roundReportValue = (value: number): number => Math.round(value * 10_000) / 10_000;

const resolveSnapshotReportTimePolicy = (input: {
  metadataStore: MetadataStore;
  projectRelease: PublishedProjectRelease;
}): ReportTimePolicyRevision | null => {
  const definition = input.projectRelease.templateRevisionId
    ? input.metadataStore.energyIq.overviewDefinitions.get(input.projectRelease.templateRevisionId)
    : null;
  if (definition && definition.renderer_key !== input.projectRelease.renderer.key) {
    throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_RENDERER_MISMATCH");
  }
  const policyRecord = definition
    ? input.metadataStore.energyIq.reportTimePolicies.get(
        input.projectRelease.projectId,
        definition.time_policy_revision_id,
      )
    : input.metadataStore.energyIq.reportTimePolicies.getLatest(input.projectRelease.projectId);
  if (definition && !policyRecord) {
    throw new Error("ENERGYIQ_REPORT_TIME_POLICY_NOT_FOUND");
  }
  return policyRecord?.policy ?? null;
};

const selectPreschoolLatestCompleteLocalDay = async (
  input: Parameters<typeof selectEnergyLatestCompleteDay>[0],
): Promise<string | null> => {
  try {
    return (await selectEnergyLatestCompleteDay(input)).period.localFrom;
  } catch (error) {
    if (
      error instanceof Error
      && (
        error.message === "ENERGYIQ_LATEST_COMPLETE_PERIOD_COVERAGE_NOT_FOUND"
        || error.message === "ENERGYIQ_LATEST_COMPLETE_DAY_NOT_FOUND"
      )
    ) return null;
    throw error;
  }
};

const resolveCurrentOverviewContext = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  user: UserRecord;
  workspaceId: string;
  request: EnergyQueryContextRequest;
  databasePath?: string;
  now?: Date;
  env?: Record<string, string | undefined>;
}): Promise<PublishedRunContext> => {
  const {
    analysisWindow,
    expectedDataSnapshotId,
    expectedProjectReleaseId,
    from,
    to,
    ...requestedContext
  } = input.request;
  const resolvedAnalysisWindow = analysisWindow === "current-project-overview"
    ? resolveProjectOverviewProfile(input.metadataStore, input.request.projectId)?.currentAnalysisWindow
    : analysisWindow;
  if (analysisWindow === "current-project-overview" && !resolvedAnalysisWindow) {
    throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_REQUIRED");
  }
  const selectOverviewPeriod = (
    selectionInput: Parameters<typeof selectEnergyLatestCompleteDay>[0],
  ) => resolvedAnalysisWindow === "latest-complete-day"
    ? selectEnergyLatestCompleteDay(selectionInput)
    : resolvedAnalysisWindow === "current-overview-28d" || resolvedAnalysisWindow === "current-month-to-date"
      ? selectEnergyCurrentOverviewPeriod({
          ...selectionInput,
          periodBasis: resolveEnergyCurrentOverviewPeriodBasis(resolvedAnalysisWindow),
        })
      : selectEnergyLatestCompletePeriod(selectionInput);
  const suppliedPinParts = [from, to, expectedDataSnapshotId, expectedProjectReleaseId]
    .filter((value) => value !== undefined).length;
  if (suppliedPinParts > 0 && suppliedPinParts < 4) {
    throw new Error("ENERGYIQ_CURRENT_OVERVIEW_PIN_INCOMPLETE");
  }
  if (suppliedPinParts === 4) {
    if (!from || !to || !expectedDataSnapshotId || !expectedProjectReleaseId) {
      throw new Error("ENERGYIQ_CURRENT_OVERVIEW_PIN_INCOMPLETE");
    }
    const pinnedProjectContext = resolvePublishedEnergyQueryContext({
      metadataStore: input.metadataStore,
      user: input.user,
      workspaceId: input.workspaceId,
      request: {
        ...requestedContext,
        scopeId: "project",
        period: "Last 7 days",
        expectedDataSnapshotId,
        expectedProjectReleaseId,
      },
      ...(input.now ? { now: input.now } : {}),
      ...(input.env ? { env: input.env } : {}),
    });
    if (!supportsCurrentOverviewWindow(pinnedProjectContext.projectRelease?.renderer.key)) {
      throw new Error("ENERGYIQ_ANALYSIS_WINDOW_UNSUPPORTED");
    }
    const releasedPinnedContext = resolvePublishedEnergyQueryContext({
      metadataStore: input.metadataStore,
      user: input.user,
      workspaceId: input.workspaceId,
      request: {
        ...requestedContext,
        period: "Custom",
        from,
        to,
        expectedDataSnapshotId,
        expectedProjectReleaseId,
      },
      ...(input.now ? { now: input.now } : {}),
      ...(input.env ? { env: input.env } : {}),
    });
    return {
      ...releasedPinnedContext,
      validatePinnedOverviewPeriod: async () => {
        const selected = await selectOverviewPeriod({
          metadataStore: input.metadataStore,
          dataGateway: input.dataGateway,
          userId: input.user.id,
          context: pinnedProjectContext.context,
          ...(input.databasePath ? { databasePath: input.databasePath } : {}),
        });
        if (from !== selected.period.localFrom
          || to !== inclusiveLocalDate(selected.period.localToExclusive)) {
          throw new Error("ENERGYIQ_CURRENT_OVERVIEW_WINDOW_MISMATCH");
        }
      },
    };
  }
  const projectContext = resolvePublishedEnergyQueryContext({
    metadataStore: input.metadataStore,
    user: input.user,
    workspaceId: input.workspaceId,
    request: {
      ...requestedContext,
      scopeId: "project",
      period: "Last 7 days",
    },
    ...(input.now ? { now: input.now } : {}),
    ...(input.env ? { env: input.env } : {}),
  });
  const projectRelease = projectContext.projectRelease;
  if (!projectRelease || !supportsCurrentOverviewWindow(projectRelease.renderer.key)) {
    throw new Error("ENERGYIQ_ANALYSIS_WINDOW_UNSUPPORTED");
  }
  const selected = await selectOverviewPeriod({
    metadataStore: input.metadataStore,
    dataGateway: input.dataGateway,
    userId: input.user.id,
    context: projectContext.context,
    ...(input.databasePath ? { databasePath: input.databasePath } : {}),
  });
  return resolvePublishedEnergyQueryContext({
    metadataStore: input.metadataStore,
    user: input.user,
    workspaceId: input.workspaceId,
    request: {
      ...requestedContext,
      period: "Custom",
      from: selected.period.localFrom,
      to: inclusiveLocalDate(selected.period.localToExclusive),
      expectedDataSnapshotId: projectContext.context.dataSnapshotId,
      expectedProjectReleaseId: projectRelease.id,
    },
    ...(input.now ? { now: input.now } : {}),
    ...(input.env ? { env: input.env } : {}),
  });
};

const supportsCurrentOverviewWindow = (rendererKey: string | undefined): boolean =>
  rendererKey === "ngee-ann-overview" || rendererKey === "preschool-overview";

const inclusiveLocalDate = (localToExclusive: string): string => {
  const exclusive = new Date(`${localToExclusive}T00:00:00.000Z`);
  if (Number.isNaN(exclusive.valueOf())) {
    throw new Error("ENERGYIQ_GOLDEN_PERIOD_DATE_INVALID");
  }
  exclusive.setUTCDate(exclusive.getUTCDate() - 1);
  return exclusive.toISOString().slice(0, 10);
};

export const bindPublishedReleaseContext = (
  context: EnergyQueryContext,
  release: PublishedProjectRelease,
): EnergyQueryContext => {
  if (context.projectId !== release.projectId) {
    throw new Error("ENERGYIQ_PROJECT_RELEASE_MISMATCH");
  }
  return {
    ...context,
    hierarchyRevisionId: release.hierarchyRevisionId,
    meterMappingRevisionId: release.meterMappingRevisionId,
    meterFormulaRevisionId: release.meterFormulaRevisionId,
    metricVersion: `metric-revisions:${[...release.metricRevisionIds]
      .sort((left, right) => left.localeCompare(right))
      .join(",") || "none"}`,
    businessCalendarVersion: release.businessCalendarVersion,
    tariffScheduleVersion: release.tariffScheduleVersion,
  };
};

export const resolvePublishedProjectRelease = (
  metadataStore: MetadataStore,
  context: EnergyQueryContext,
): PublishedProjectRelease | null => {
  const catalog = metadataStore.energyIq.templates.listComponentRevisions();
  const revision = metadataStore.energyIq.templates.getLatestProjectRevision(context.projectId);
  const legacyProfile = resolveProjectOverviewProfile(metadataStore, context.projectId);
  if (!legacyProfile) return null;
  return revision
    ? releaseFromTemplateRevision(revision, legacyProfile.rendererKey, catalog)
    : releaseFromLegacyProfile(metadataStore, context, legacyProfile, catalog);
};

export const resolvePublishedEnergyRunContext = (input: {
  metadataStore: MetadataStore;
  context: EnergyQueryContext;
  expectedProjectReleaseId?: string;
}): {
  context: EnergyQueryContext;
  projectRelease: PublishedProjectRelease | null;
} => {
  const projectRelease = resolvePublishedProjectRelease(input.metadataStore, input.context);
  if (input.expectedProjectReleaseId
    && input.expectedProjectReleaseId !== projectRelease?.id) {
    throw new Error("ENERGYIQ_PROJECT_RELEASE_MISMATCH");
  }
  return {
    context: projectRelease
      ? bindPublishedReleaseContext(input.context, projectRelease)
      : input.context,
    projectRelease,
  };
};

export const resolvePublishedEnergyQueryContext = (input: {
  metadataStore: MetadataStore;
  user: UserRecord;
  workspaceId: string;
  request: EnergyQueryContextRequest;
  now?: Date;
  env?: Record<string, string | undefined>;
}): {
  context: EnergyQueryContext;
  projectRelease: PublishedProjectRelease | null;
} => {
  const templateRevision = input.metadataStore.energyIq.templates
    .getLatestProjectRevision(input.request.projectId);
  const context = resolveEnergyQueryContext({
    metadataStore: input.metadataStore,
    user: input.user,
    workspaceId: input.workspaceId,
    request: input.request,
    ...(templateRevision ? {
      releasePins: {
        hierarchyRevisionId: templateRevision.hierarchy_revision_id,
        meterMappingRevisionId: templateRevision.meter_mapping_revision_id,
      },
    } : {}),
    ...(input.now ? { now: input.now } : {}),
    ...(input.env ? { env: input.env } : {}),
  });
  return resolvePublishedEnergyRunContext({
    metadataStore: input.metadataStore,
    context,
    ...(input.request.expectedProjectReleaseId
      ? { expectedProjectReleaseId: input.request.expectedProjectReleaseId }
      : {}),
  });
};

const releaseFromTemplateRevision = (
  revision: EnergyIqTemplateRevisionRecord,
  rendererKey: ProjectRendererKey,
  catalog: EnergyIqComponentRevisionRecord[],
): PublishedProjectRelease => buildPublishedProjectRelease({
  rendererKey,
  release: {
    id: revision.revision_id,
    source: "template-revision",
    projectId: revision.project_id,
    templateRevisionId: revision.revision_id,
    templateRevisionSequence: revision.sequence,
    hierarchyRevisionId: revision.hierarchy_revision_id,
    meterMappingRevisionId: revision.meter_mapping_revision_id,
    meterFormulaRevisionId: revision.meter_formula_revision_id,
    metricRevisionIds: revision.selected_metric_revision_ids,
    ruleRevisionIds: revision.selected_rule_revision_ids,
    businessCalendarVersion: revision.business_calendar_version,
    tariffScheduleVersion: revision.tariff_schedule_version,
    publishedAt: revision.published_at,
    document: revision.document,
    catalog,
  },
});

const releaseFromLegacyProfile = (
  metadataStore: MetadataStore,
  context: EnergyQueryContext,
  profile: ProjectOverviewProfile,
  catalog: EnergyIqComponentRevisionRecord[],
): PublishedProjectRelease => buildPublishedProjectRelease({
  rendererKey: profile.rendererKey,
  release: {
    id: `legacy-profile:${context.projectId}:1`,
    source: "legacy-profile",
    projectId: context.projectId,
    templateRevisionId: null,
    templateRevisionSequence: null,
    hierarchyRevisionId: context.hierarchyRevisionId,
    meterMappingRevisionId: context.meterMappingRevisionId,
    meterFormulaRevisionId: context.meterFormulaRevisionId,
    metricRevisionIds: metadataStore.energyIq.metrics
      .getProjectConfig(context.projectId).selected_metric_revision_ids,
    ruleRevisionIds: metadataStore.energyIq.rules
      .getProjectConfig(context.projectId).selected_rule_revision_ids,
    businessCalendarVersion: context.businessCalendarVersion,
    tariffScheduleVersion: context.tariffScheduleVersion,
    publishedAt: null,
    document: createDefaultTemplateDocument(
      catalog,
      [...metadataStore.energyIq.listTierDefinitions(context.projectId)]
        .sort((left, right) => right.ordinal - left.ordinal)
        .map((tier) => tier.id),
    ),
    catalog,
  },
});

const buildPublishedProjectRelease = (input: {
  rendererKey: ProjectRendererKey;
  release: Omit<PublishedProjectRelease, "recipe" | "renderer">;
}): PublishedProjectRelease => ({
  ...input.release,
  recipe: PROJECT_ANALYSIS_RECIPE,
  renderer: {
    key: input.rendererKey,
    version: PROJECT_RENDERER_VERSION,
    contractVersion: PROJECT_RENDERER_CONTRACT_VERSION,
  },
});
