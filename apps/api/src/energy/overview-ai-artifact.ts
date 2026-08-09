import type {
  EnergyIqOverviewAiArtifactIdentity,
  EnergyIqOverviewAiArtifactRecord,
  MetadataStore,
  UserRecord,
  WorkspaceDefaultModelProfileRecord,
} from "@datafoundry/metadata";
import type { LocalDataGateway } from "@datafoundry/data-gateway";

import {
  resolveProjectAnalysis,
  type ProjectAnalysisSnapshot,
} from "./project-analysis-resolver.js";

type OverviewAiContract = {
  analysisPackId: string;
  analysisPackRevision: string;
  outputContractRevision: string;
  validatorRevision: string;
  workflowRevision: string;
  investigatorPromptRevision: string;
  editorPromptRevision: string;
  methodSkillId: string;
  methodSkillRevision: string;
};

export type OverviewAiArtifactIdentityV13 = EnergyIqOverviewAiArtifactIdentity & OverviewAiContract;

const OVERVIEW_AI_CONTRACTS: Readonly<Record<string, OverviewAiContract>> = {
  "preschool-overview": {
    analysisPackId: "preschool-analysis-pack",
    analysisPackRevision: "v1",
    outputContractRevision: "v13",
    validatorRevision: "preschool-ai-two-stage-fact-boundary-v1",
    workflowRevision: "preschool-two-stage-v1",
    investigatorPromptRevision: "preschool-investigator-v2",
    editorPromptRevision: "preschool-insight-editor-v1",
    methodSkillId: "energy-insight-investigation",
    methodSkillRevision: "1.0.0",
  },
};

export const createOverviewAiArtifactIdentity = (input: {
  workspaceId: string;
  projectId: string;
  scopeId: string;
  dataSnapshotId: string;
  projectReleaseId: string;
  analysisPeriodFrom: string;
  analysisPeriodTo: string;
  rendererKey: string;
  rendererVersion: string;
  modelProfileId: string;
  modelProfileRevision: number;
}): OverviewAiArtifactIdentityV13 => {
  const contract = OVERVIEW_AI_CONTRACTS[input.rendererKey];
  if (!contract) throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_CONTRACT_NOT_FOUND");
  return {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    scopeId: input.scopeId,
    resource: "electricity",
    dataSnapshotId: input.dataSnapshotId,
    projectReleaseId: input.projectReleaseId,
    analysisPeriodFrom: input.analysisPeriodFrom,
    analysisPeriodTo: input.analysisPeriodTo,
    rendererKey: input.rendererKey,
    rendererVersion: input.rendererVersion,
    ...contract,
    modelProfileId: input.modelProfileId,
    modelProfileRevision: input.modelProfileRevision,
  };
};

export const overviewAiArtifactIdentityFromSnapshot = (input: {
  snapshot: ProjectAnalysisSnapshot;
  modelBinding: WorkspaceDefaultModelProfileRecord;
}): OverviewAiArtifactIdentityV13 => createOverviewAiArtifactIdentity({
  workspaceId: input.snapshot.context.workspaceId,
  projectId: input.snapshot.context.projectId,
  scopeId: input.snapshot.context.scopeId,
  dataSnapshotId: input.snapshot.dataSnapshot.id,
  projectReleaseId: input.snapshot.projectRelease.id,
  analysisPeriodFrom: input.snapshot.context.primaryPeriod.start,
  analysisPeriodTo: input.snapshot.context.primaryPeriod.endExclusive,
  rendererKey: input.snapshot.renderer.key,
  rendererVersion: input.snapshot.renderer.version,
  modelProfileId: input.modelBinding.profile_id,
  modelProfileRevision: input.modelBinding.revision,
});

export const overviewAiArtifactPinnedLocalPeriod = (input: {
  identity: Pick<EnergyIqOverviewAiArtifactIdentity, "analysisPeriodFrom" | "analysisPeriodTo">;
  timezone: string;
}): { from: string; to: string } => {
  const from = localDateAtTimezone(input.identity.analysisPeriodFrom, input.timezone);
  const endExclusive = localDateAtTimezone(input.identity.analysisPeriodTo, input.timezone);
  const to = shiftLocalDate(endExclusive, -1);
  if (from > to) throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_PERIOD_INVALID");
  return { from, to };
};

export const queueCurrentProjectOverviewAiArtifact = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  projectId: string;
  user: UserRecord;
}): Promise<EnergyIqOverviewAiArtifactRecord | null> => {
  const project = input.metadataStore.energyIq.getProject(input.projectId);
  if (project.status !== "published" || project.delivery_stage !== "published") return null;
  const modelBinding = input.metadataStore.workspaceDefaultModelProfiles.find(project.workspace_id);
  if (!modelBinding) return null;
  if (project.id !== "preschool-demo") return null;
  const resolution = await resolveProjectAnalysis({
    metadataStore: input.metadataStore,
    dataGateway: input.dataGateway,
    user: input.user,
    workspaceId: project.workspace_id,
    request: {
      projectId: project.id,
      scopeId: project.root_scope_id,
      resource: "electricity",
      analysisWindow: "current-overview-28d",
    },
  });
  if (resolution.status !== "ready" || resolution.snapshot.dataSnapshot.id !== project.data_snapshot_id) return null;
  const identity = overviewAiArtifactIdentityFromSnapshot({ snapshot: resolution.snapshot, modelBinding });
  return input.metadataStore.energyIq.overviewAiArtifacts.queue({
    identity,
    triggeredBy: input.user.id,
  });
};

export const resolveCurrentOverviewAiArtifactIdentity = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  projectId: string;
  scopeId: string;
  user: UserRecord;
}): Promise<OverviewAiArtifactIdentityV13> => {
  const project = input.metadataStore.energyIq.getProject(input.projectId);
  if (input.scopeId !== project.root_scope_id) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_PROJECT_SCOPE_REQUIRED");
  }
  const modelBinding = input.metadataStore.workspaceDefaultModelProfiles.get(project.workspace_id);
  const resolution = await resolveProjectAnalysis({
    metadataStore: input.metadataStore,
    dataGateway: input.dataGateway,
    user: input.user,
    workspaceId: project.workspace_id,
    request: {
      projectId: project.id,
      scopeId: input.scopeId,
      resource: "electricity",
      analysisWindow: "current-overview-28d",
    },
  });
  if (resolution.status !== "ready" || resolution.snapshot.dataSnapshot.id !== project.data_snapshot_id) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RELEASE_REQUIRED");
  }
  return overviewAiArtifactIdentityFromSnapshot({ snapshot: resolution.snapshot, modelBinding });
};

const localDateAtTimezone = (value: string, timezone: string): string => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_PERIOD_INVALID");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

const shiftLocalDate = (value: string, days: number): string => {
  const [year, month, day] = value.split("-").map(Number);
  const shifted = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
};
