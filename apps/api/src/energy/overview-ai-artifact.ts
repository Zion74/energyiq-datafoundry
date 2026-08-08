import type {
  EnergyIqOverviewAiArtifactIdentity,
  EnergyIqOverviewAiArtifactRecord,
  MetadataStore,
  UserRecord,
  WorkspaceDefaultModelProfileRecord,
} from "@datafoundry/metadata";

import {
  type ProjectAnalysisSnapshot,
} from "./project-analysis-resolver.js";
import { resolvePublishedEnergyQueryContext } from "./project-analysis-resolver.js";

type OverviewAiContract = {
  analysisPackId: string;
  analysisPackRevision: string;
  outputContractRevision: string;
  validatorRevision: string;
};

const OVERVIEW_AI_CONTRACTS: Readonly<Record<string, OverviewAiContract>> = {
  "preschool-overview": {
    analysisPackId: "preschool-analysis-pack",
    analysisPackRevision: "v1",
    outputContractRevision: "v12",
    validatorRevision: "preschool-ai-event-stream-v1",
  },
};

export const createOverviewAiArtifactIdentity = (input: {
  workspaceId: string;
  projectId: string;
  scopeId: string;
  dataSnapshotId: string;
  projectReleaseId: string;
  rendererKey: string;
  rendererVersion: string;
  modelProfileId: string;
  modelProfileRevision: number;
}): EnergyIqOverviewAiArtifactIdentity => {
  const contract = OVERVIEW_AI_CONTRACTS[input.rendererKey];
  if (!contract) throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_CONTRACT_NOT_FOUND");
  return {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    scopeId: input.scopeId,
    resource: "electricity",
    dataSnapshotId: input.dataSnapshotId,
    projectReleaseId: input.projectReleaseId,
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
}): EnergyIqOverviewAiArtifactIdentity => createOverviewAiArtifactIdentity({
  workspaceId: input.snapshot.context.workspaceId,
  projectId: input.snapshot.context.projectId,
  scopeId: input.snapshot.context.scopeId,
  dataSnapshotId: input.snapshot.dataSnapshot.id,
  projectReleaseId: input.snapshot.projectRelease.id,
  rendererKey: input.snapshot.renderer.key,
  rendererVersion: input.snapshot.renderer.version,
  modelProfileId: input.modelBinding.profile_id,
  modelProfileRevision: input.modelBinding.revision,
});

export const queueCurrentProjectOverviewAiArtifact = async (input: {
  metadataStore: MetadataStore;
  projectId: string;
  user: UserRecord;
}): Promise<EnergyIqOverviewAiArtifactRecord | null> => {
  const project = input.metadataStore.energyIq.getProject(input.projectId);
  if (project.status !== "published" || project.delivery_stage !== "published") return null;
  const modelBinding = input.metadataStore.workspaceDefaultModelProfiles.find(project.workspace_id);
  if (!modelBinding) return null;
  if (project.id !== "preschool-demo") return null;
  const published = resolvePublishedEnergyQueryContext({
    metadataStore: input.metadataStore,
    user: input.user,
    workspaceId: project.workspace_id,
    request: {
      projectId: project.id,
      scopeId: project.root_scope_id,
      resource: "electricity",
      analysisWindow: "current-overview-28d",
      expectedDataSnapshotId: project.data_snapshot_id,
    },
  });
  if (!published.projectRelease) return null;
  const identity = createOverviewAiArtifactIdentity({
    workspaceId: project.workspace_id,
    projectId: project.id,
    scopeId: project.root_scope_id,
    dataSnapshotId: project.data_snapshot_id,
    projectReleaseId: published.projectRelease.id,
    rendererKey: published.projectRelease.renderer.key,
    rendererVersion: published.projectRelease.renderer.version,
    modelProfileId: modelBinding.profile_id,
    modelProfileRevision: modelBinding.revision,
  });
  return input.metadataStore.energyIq.overviewAiArtifacts.queue({
    identity,
    triggeredBy: input.user.id,
  });
};

export const resolveCurrentOverviewAiArtifactIdentity = (input: {
  metadataStore: MetadataStore;
  projectId: string;
  scopeId: string;
  user: UserRecord;
}): EnergyIqOverviewAiArtifactIdentity => {
  const project = input.metadataStore.energyIq.getProject(input.projectId);
  if (input.scopeId !== project.root_scope_id) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_PROJECT_SCOPE_REQUIRED");
  }
  const modelBinding = input.metadataStore.workspaceDefaultModelProfiles.get(project.workspace_id);
  const published = resolvePublishedEnergyQueryContext({
    metadataStore: input.metadataStore,
    user: input.user,
    workspaceId: project.workspace_id,
    request: {
      projectId: project.id,
      scopeId: input.scopeId,
      resource: "electricity",
      expectedDataSnapshotId: project.data_snapshot_id,
    },
  });
  if (!published.projectRelease) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RELEASE_REQUIRED");
  }
  return createOverviewAiArtifactIdentity({
    workspaceId: project.workspace_id,
    projectId: project.id,
    scopeId: input.scopeId,
    dataSnapshotId: project.data_snapshot_id,
    projectReleaseId: published.projectRelease.id,
    rendererKey: published.projectRelease.renderer.key,
    rendererVersion: published.projectRelease.renderer.version,
    modelProfileId: modelBinding.profile_id,
    modelProfileRevision: modelBinding.revision,
  });
};
