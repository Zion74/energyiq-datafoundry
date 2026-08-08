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
import { existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

import {
  executeEnergyScopeAnalysisWithLatestAvailable,
  selectEnergyCurrentOverviewPeriod,
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
  type PreschoolOperationalProjection,
} from "./preschool-operational-projection.js";
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
  };
  projectRelease: PublishedProjectRelease;
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
const PROJECT_ANALYSIS_CACHE_TTL_MS = 120_000;
const PROJECT_ANALYSIS_CACHES = new WeakMap<
  MetadataStore,
  WeakMap<LocalDataGateway, ProjectAnalysisResultCache<ReadyProjectAnalysisResolution>>
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

export type ProjectOverviewProfile = {
  rendererKey: ProjectRendererKey;
  rendererVersion: "1";
  contractVersion: "project-analysis-snapshot@1";
  horizons: {
    latestStatus: "latest-complete-day";
    shortTermDays: 7;
    mainDays: 28;
  };
};

const PROJECT_OVERVIEW_PROFILES: Readonly<Record<string, ProjectOverviewProfile>> = {
  "ngee-ann-polytechnic": {
    rendererKey: "ngee-ann-overview",
    rendererVersion: "1",
    contractVersion: "project-analysis-snapshot@1",
    horizons: { latestStatus: "latest-complete-day", shortTermDays: 7, mainDays: 28 },
  },
  "preschool-demo": {
    rendererKey: "preschool-overview",
    rendererVersion: "1",
    contractVersion: "project-analysis-snapshot@1",
    horizons: { latestStatus: "latest-complete-day", shortTermDays: 7, mainDays: 28 },
  },
};

export const resolveProjectOverviewProfile = (projectId: string): ProjectOverviewProfile | null =>
  PROJECT_OVERVIEW_PROFILES[projectId] ?? null;

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
  const legacyProfile = resolveProjectOverviewProfile(input.request.projectId);
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
  const publishedRunContext: PublishedRunContext = input.request.analysisWindow === "latest-complete-7d"
    || input.request.analysisWindow === "current-overview-28d"
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
      const snapshotContext: ProjectAnalysisSnapshot["context"] = {
        ...releasedContext,
        primaryPeriod: {
          start: releasedContext.from,
          endExclusive: releasedContext.to,
        },
        projectReleaseId: projectRelease.id,
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
      const preschoolBenchmark = projectRelease.renderer.key === "preschool-overview"
        && releasedContext.scopeId === input.metadataStore.energyIq.getProject(releasedContext.projectId).root_scope_id
        && snapshotContext.primaryPeriod.start === "2026-04-30T16:00:00.000Z"
        && snapshotContext.primaryPeriod.endExclusive === "2026-05-31T16:00:00.000Z"
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
      const preschoolAppliances = projectRelease.renderer.key === "preschool-overview"
        && releasedContext.scopeId === input.metadataStore.energyIq.getProject(releasedContext.projectId).root_scope_id
        && snapshotContext.primaryPeriod.start === "2026-04-30T16:00:00.000Z"
        && snapshotContext.primaryPeriod.endExclusive === "2026-05-31T16:00:00.000Z"
          ? buildPreschoolApplianceProjection({
              projectRelease,
              period: snapshotContext.primaryPeriod,
              timezone: releasedContext.timezone,
              analysis,
            })
          : undefined;
      const preschoolOperational = projectRelease.renderer.key === "preschool-overview"
        && releasedContext.scopeId === input.metadataStore.energyIq.getProject(releasedContext.projectId).root_scope_id
        && snapshotContext.primaryPeriod.start === "2026-04-30T16:00:00.000Z"
        && snapshotContext.primaryPeriod.endExclusive === "2026-05-31T16:00:00.000Z"
          ? await loadPreschoolOperationalProjection({
              metadataStore: input.metadataStore,
              dataGateway: input.dataGateway,
              userId: input.user.id,
              projectRelease,
              context: releasedContext,
              analysis,
              databasePath: analysisDatabasePath,
            })
          : undefined;
      const preschoolDecisionSignals = projectRelease.renderer.key === "preschool-overview"
        && releasedContext.scopeId === input.metadataStore.energyIq.getProject(releasedContext.projectId).root_scope_id
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
      return {
        status: "ready",
        snapshot: {
          context: snapshotContext,
          projectRelease,
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
  const selectOverviewPeriod = analysisWindow === "current-overview-28d"
    ? selectEnergyCurrentOverviewPeriod
    : selectEnergyLatestCompletePeriod;
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
    if (pinnedProjectContext.projectRelease?.renderer.key !== "ngee-ann-overview") {
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
  if (projectContext.projectRelease?.renderer.key !== "ngee-ann-overview") {
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
      expectedProjectReleaseId: projectContext.projectRelease.id,
    },
    ...(input.now ? { now: input.now } : {}),
    ...(input.env ? { env: input.env } : {}),
  });
};

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
  const legacyProfile = resolveProjectOverviewProfile(context.projectId);
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
