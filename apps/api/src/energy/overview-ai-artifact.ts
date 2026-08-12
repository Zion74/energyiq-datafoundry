import type {
  EnergyIqOverviewAiArtifactIdentity,
  EnergyIqOverviewAiArtifactRecord,
  MetadataStore,
  UserRecord,
  WorkspaceDefaultModelProfileRecord,
} from "@datafoundry/metadata";
import { WORKSPACE_DEFAULT_MODEL_PROFILE_ID } from "@datafoundry/metadata";
import type { LocalDataGateway } from "@datafoundry/data-gateway";

import { ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID } from "../workspace-model-profile-resolver.js";

import {
  resolveProjectAnalysis,
  resolveProjectOverviewProfile,
  type ProjectAnalysisSnapshot,
} from "./project-analysis-resolver.js";
import { resolveEnergyAccessContext } from "./energy-query-context.js";
import type { PreschoolSectionId } from "./preschool-overview-ai-contracts.js";

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

export type PreschoolOverviewAiValueArtifactIdentity = EnergyIqOverviewAiArtifactIdentity & {
  artifactKind: "section-interpretation" | "executive-synthesis";
  targetId: string;
};

const OVERVIEW_AI_CONTRACTS: Readonly<Record<string, OverviewAiContract>> = {
  "preschool-overview": {
    analysisPackId: "preschool-analysis-pack",
    analysisPackRevision: "v1",
    outputContractRevision: "v13",
    validatorRevision: "preschool-ai-two-stage-fact-boundary-v7",
    workflowRevision: "preschool-two-stage-v2",
    investigatorPromptRevision: "preschool-investigator-v15",
    editorPromptRevision: "preschool-insight-editor-v7",
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

export const createPreschoolOverviewAiValueArtifactIdentity = (input: {
  baseIdentity: OverviewAiArtifactIdentityV13;
  artifactKind: "section-interpretation" | "executive-synthesis";
  targetId?: PreschoolSectionId | string;
}): PreschoolOverviewAiValueArtifactIdentity => {
  if (!input.targetId?.trim()) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_TARGET_REQUIRED");
  }
  const section = input.artifactKind === "section-interpretation";
  const {
    artifactKind: _legacyArtifactKind,
    targetId: _legacyTargetId,
    ...baseIdentity
  } = input.baseIdentity;
  return {
    ...baseIdentity,
    artifactKind: input.artifactKind,
    targetId: input.targetId,
    outputContractRevision: section
      ? "preschool-section-interpretation-v3"
      : "preschool-executive-synthesis-v1",
    validatorRevision: section
      ? "preschool-section-interpreter-validator-v12"
      : "preschool-executive-synthesis-validator-v3",
    workflowRevision: section
      ? "preschool-section-interpreter-v14"
      : "preschool-executive-synthesis-v9",
    investigatorPromptRevision: section
      ? "preschool-section-interpreter-prompt-v14"
      : "preschool-executive-synthesis-prompt-v2",
    editorPromptRevision: "not-applicable-v1",
    methodSkillId: "none",
    methodSkillRevision: "not-applicable-v1",
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
  modelProfileId: WORKSPACE_DEFAULT_MODEL_PROFILE_ID,
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
  const modelBinding = input.metadataStore.workspaceDefaultModelProfiles.find(ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID);
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
  pin?: {
    from: string;
    to: string;
    dataSnapshotId: string;
    projectReleaseId: string;
  };
}): Promise<OverviewAiArtifactIdentityV13> => {
  const project = input.metadataStore.energyIq.getProject(input.projectId);
  if (input.scopeId !== project.root_scope_id) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_PROJECT_SCOPE_REQUIRED");
  }
  const modelBinding = input.metadataStore.workspaceDefaultModelProfiles.get(ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID);
  const resolution = await resolveProjectAnalysis({
    metadataStore: input.metadataStore,
    dataGateway: input.dataGateway,
    user: input.user,
    workspaceId: project.workspace_id,
    request: {
      projectId: project.id,
      scopeId: input.scopeId,
      resource: "electricity",
      ...(input.pin ? {
        period: "Custom" as const,
        from: input.pin.from,
        to: input.pin.to,
        expectedDataSnapshotId: input.pin.dataSnapshotId,
        expectedProjectReleaseId: input.pin.projectReleaseId,
      } : {
        analysisWindow: "current-overview-28d" as const,
      }),
    },
  });
  if (resolution.status !== "ready" || resolution.snapshot.dataSnapshot.id !== project.data_snapshot_id) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RELEASE_REQUIRED");
  }
  return overviewAiArtifactIdentityFromSnapshot({ snapshot: resolution.snapshot, modelBinding });
};

export const resolvePinnedOverviewAiArtifactReadIdentity = (input: {
  metadataStore: MetadataStore;
  projectId: string;
  scopeId: string;
  user: UserRecord;
  pin: {
    from: string;
    to: string;
    dataSnapshotId: string;
    projectReleaseId: string;
  };
}): OverviewAiArtifactIdentityV13 => {
  const project = input.metadataStore.energyIq.getProject(input.projectId);
  const access = resolveEnergyAccessContext({
    metadataStore: input.metadataStore,
    user: input.user,
    requestedWorkspaceId: project.workspace_id,
  });
  const accessibleProject = access.projects.find((candidate) => candidate.id === project.id);
  if (!accessibleProject || accessibleProject.workspaceId !== access.activeWorkspaceId) {
    throw new Error("ENERGYIQ_PROJECT_FORBIDDEN");
  }
  if (accessibleProject.status !== "published" && access.role !== "admin") {
    throw new Error("ENERGYIQ_PROJECT_FORBIDDEN");
  }
  if (input.scopeId !== project.root_scope_id) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_PROJECT_SCOPE_REQUIRED");
  }
  if (project.status !== "published") {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RELEASE_REQUIRED");
  }
  if (input.pin.dataSnapshotId !== project.data_snapshot_id) {
    throw new Error("ENERGYIQ_DATA_SNAPSHOT_MISMATCH");
  }

  const profile = resolveProjectOverviewProfile(project.id);
  if (!profile || profile.rendererKey !== "preschool-overview") {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_CONTRACT_NOT_FOUND");
  }
  const templateRevision = input.metadataStore.energyIq.templates.getLatestProjectRevision(project.id);
  const currentProjectReleaseId = templateRevision?.revision_id ?? `legacy-profile:${project.id}:1`;
  if (input.pin.projectReleaseId !== currentProjectReleaseId) {
    throw new Error("ENERGYIQ_PROJECT_RELEASE_MISMATCH");
  }

  const from = requireLocalDate(input.pin.from);
  const to = requireLocalDate(input.pin.to);
  if (from > to) throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_PERIOD_INVALID");
  const modelBinding = input.metadataStore.workspaceDefaultModelProfiles.get(ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID);
  return createOverviewAiArtifactIdentity({
    workspaceId: project.workspace_id,
    projectId: project.id,
    scopeId: project.root_scope_id,
    dataSnapshotId: project.data_snapshot_id,
    projectReleaseId: currentProjectReleaseId,
    analysisPeriodFrom: zonedStartOfLocalDate(from, project.timezone),
    analysisPeriodTo: zonedStartOfLocalDate(shiftLocalDate(to, 1), project.timezone),
    rendererKey: profile.rendererKey,
    rendererVersion: "1",
    modelProfileId: WORKSPACE_DEFAULT_MODEL_PROFILE_ID,
    modelProfileRevision: modelBinding.revision,
  });
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

const requireLocalDate = (value: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_PERIOD_INVALID");
  }
  const [year, month, day] = value.split("-").map(Number);
  const normalized = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)).toISOString().slice(0, 10);
  if (normalized !== value) throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_PERIOD_INVALID");
  return value;
};

const zonedStartOfLocalDate = (date: string, timezone: string): string => {
  const [year, month, day] = date.split("-").map(Number);
  const targetUtc = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1);
  let candidate = targetUtc;
  for (let index = 0; index < 3; index += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(candidate));
    const get = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((part) => part.type === type)?.value ?? 0);
    const observedAsUtc = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second"),
    );
    candidate += targetUtc - observedAsUtc;
  }
  return new Date(candidate).toISOString();
};
