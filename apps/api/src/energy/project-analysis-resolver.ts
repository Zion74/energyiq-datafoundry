import type { LocalDataGateway } from "@datafoundry/data-gateway";
import {
  createDefaultTemplateDocument,
  type EnergyIqComponentRevisionRecord,
  type EnergyIqTemplateDraftDocument,
  type EnergyIqTemplateRevisionRecord,
  type MetadataStore,
  type UserRecord,
} from "@datafoundry/metadata";

import {
  executeEnergyScopeAnalysis,
  type EnergyScopeAnalysis,
} from "./energy-analysis.js";
import {
  projectAnalysisPayload,
  resolveProjectAnalysisMetadata,
  type ProjectAnalysisMetadataProjection,
  type ProjectAnalysisPayload,
} from "./project-analysis-metadata.js";
import {
  resolveEnergyAccessContext,
  resolveEnergyQueryContext,
  type EnergyQueryContext,
  type EnergyQueryContextRequest,
} from "./energy-query-context.js";

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
  dataSnapshot: {
    id: string;
    importBatchIds: string[];
    lastSeenAt: string | null;
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

type LegacyProjectProfile = {
  rendererKey: ProjectRendererKey;
};

const LEGACY_PROJECT_PROFILES: Readonly<Record<string, LegacyProjectProfile>> = {
  "ngee-ann-polytechnic": { rendererKey: "ngee-ann-overview" },
  "preschool-demo": { rendererKey: "preschool-overview" },
};

export const resolveProjectAnalysis = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  user: UserRecord;
  workspaceId: string;
  request: EnergyQueryContextRequest;
  databasePath?: string;
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
  const templateRevision = input.metadataStore.energyIq.templates.getLatestProjectRevision(input.request.projectId);
  const legacyProfile = LEGACY_PROJECT_PROFILES[input.request.projectId];
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
  const context = resolveEnergyQueryContext({
    metadataStore: input.metadataStore,
    user: input.user,
    workspaceId: input.workspaceId,
    request: input.request,
    ...(templateRevision ? {
      releasePins: {
        hierarchyRevisionId: templateRevision.hierarchy_revision_id,
        meterMappingRevisionId: templateRevision.meter_mapping_revision_id,
      }
    } : {}),
    ...(input.now ? { now: input.now } : {}),
    ...(input.env ? { env: input.env } : {}),
  });
  const projectRelease = resolvePublishedProjectRelease(input.metadataStore, context);
  if (!projectRelease) throw new Error("ENERGYIQ_PROJECT_RELEASE_REQUIRED");
  const releasedContext = bindPublishedReleaseContext(context, projectRelease);
  const scopeAnalysis = await executeEnergyScopeAnalysis({
    metadataStore: input.metadataStore,
    dataGateway: input.dataGateway,
    userId: input.user.id,
    context: releasedContext,
    ruleRevisions: input.metadataStore.energyIq.rules.listRevisions()
      .filter((rule) => projectRelease.ruleRevisionIds.includes(rule.revision_id)),
    ...(input.databasePath ? { databasePath: input.databasePath } : {}),
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
      dataSnapshot: {
        id: analysis.provenance.dataSnapshotId,
        importBatchIds: analysis.dataHealth.importBatchIds,
        lastSeenAt: analysis.dataHealth.lastSeenAt ?? null,
      },
      metadata,
      analysis,
    },
  };
};

const bindPublishedReleaseContext = (
  context: EnergyQueryContext,
  release: PublishedProjectRelease,
): EnergyQueryContext => ({
  ...context,
  hierarchyRevisionId: release.hierarchyRevisionId,
  meterMappingRevisionId: release.meterMappingRevisionId,
  meterFormulaRevisionId: release.meterFormulaRevisionId,
  metricVersion: `metric-revisions:${[...release.metricRevisionIds]
    .sort((left, right) => left.localeCompare(right))
    .join(",") || "none"}`,
  businessCalendarVersion: release.businessCalendarVersion,
  tariffScheduleVersion: release.tariffScheduleVersion,
});

const resolvePublishedProjectRelease = (
  metadataStore: MetadataStore,
  context: EnergyQueryContext,
): PublishedProjectRelease | null => {
  const catalog = metadataStore.energyIq.templates.listComponentRevisions();
  const revision = metadataStore.energyIq.templates.getLatestProjectRevision(context.projectId);
  const legacyProfile = LEGACY_PROJECT_PROFILES[context.projectId];
  if (!legacyProfile) return null;
  return revision
    ? releaseFromTemplateRevision(revision, legacyProfile.rendererKey, catalog)
    : releaseFromLegacyProfile(metadataStore, context, legacyProfile, catalog);
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
  profile: LegacyProjectProfile,
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
