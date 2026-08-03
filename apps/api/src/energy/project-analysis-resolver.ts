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
  resolveEnergyQueryContext,
  type EnergyQueryContext,
  type EnergyQueryContextRequest,
} from "./energy-query-context.js";

export type ProjectRendererKey = "ngee-ann-overview" | "preschool-overview";

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
  context: EnergyQueryContext;
  projectRelease: PublishedProjectRelease;
  recipe: PublishedProjectRelease["recipe"];
  renderer: PublishedProjectRelease["renderer"];
  dataQuality: EnergyScopeAnalysis["dataHealth"];
  evidence: {
    queryIds: EnergyScopeAnalysis["provenance"]["queryIds"];
    ruleRevisionIds: string[];
    findings: EnergyScopeAnalysis["attention"];
  };
  dataSnapshot: {
    id: string;
    importBatchIds: string[];
    lastSeenAt: string | null;
  };
  analysis: EnergyScopeAnalysis;
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
  const context = resolveEnergyQueryContext({
    metadataStore: input.metadataStore,
    user: input.user,
    workspaceId: input.workspaceId,
    request: input.request,
    ...(input.now ? { now: input.now } : {}),
    ...(input.env ? { env: input.env } : {}),
  });
  const projectRelease = resolvePublishedProjectRelease(input.metadataStore, context);
  if (!projectRelease) {
    return {
      status: "configuration-required",
      context,
      projectId: context.projectId,
      title: "Project analysis is not configured",
      detail: "Publish a Project Template Revision and register its customer Renderer before opening the customer Overview.",
    };
  }
  const analysis = await executeEnergyScopeAnalysis({
    metadataStore: input.metadataStore,
    dataGateway: input.dataGateway,
    userId: input.user.id,
    context,
    ruleRevisions: input.metadataStore.energyIq.rules.listRevisions()
      .filter((rule) => projectRelease.ruleRevisionIds.includes(rule.revision_id)),
    ...(input.databasePath ? { databasePath: input.databasePath } : {}),
  });
  return {
    status: "ready",
    snapshot: {
      context,
      projectRelease,
      recipe: projectRelease.recipe,
      renderer: projectRelease.renderer,
      dataQuality: analysis.dataHealth,
      evidence: {
        queryIds: analysis.provenance.queryIds,
        ruleRevisionIds: analysis.provenance.ruleRevisionIds,
        findings: analysis.attention,
      },
      dataSnapshot: {
        id: analysis.provenance.dataSnapshotId,
        importBatchIds: analysis.dataHealth.importBatchIds,
        lastSeenAt: analysis.dataHealth.lastSeenAt ?? null,
      },
      analysis,
    },
  };
};

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
): PublishedProjectRelease => ({
  id: revision.revision_id,
  source: "template-revision",
  projectId: revision.project_id,
  templateRevisionId: revision.revision_id,
  templateRevisionSequence: revision.sequence,
  recipe: { id: "energy-scope-analysis", version: "1" },
  renderer: {
    key: rendererKey,
    version: "1",
    contractVersion: "project-analysis-snapshot@1",
  },
  hierarchyRevisionId: revision.hierarchy_revision_id,
  meterFormulaRevisionId: revision.meter_formula_revision_id,
  metricRevisionIds: revision.selected_metric_revision_ids,
  ruleRevisionIds: revision.selected_rule_revision_ids,
  businessCalendarVersion: revision.business_calendar_version,
  tariffScheduleVersion: revision.tariff_schedule_version,
  publishedAt: revision.published_at,
  document: revision.document,
  catalog,
});

const releaseFromLegacyProfile = (
  metadataStore: MetadataStore,
  context: EnergyQueryContext,
  profile: LegacyProjectProfile,
  catalog: EnergyIqComponentRevisionRecord[],
): PublishedProjectRelease => ({
  id: `legacy-profile:${context.projectId}:1`,
  source: "legacy-profile",
  projectId: context.projectId,
  templateRevisionId: null,
  templateRevisionSequence: null,
  recipe: { id: "energy-scope-analysis", version: "1" },
  renderer: {
    key: profile.rendererKey,
    version: "1",
    contractVersion: "project-analysis-snapshot@1",
  },
  hierarchyRevisionId: context.hierarchyRevisionId,
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
});
