import type {
  EnergyIqOverviewAiArtifactIdentity,
  UserRecord,
} from "@datafoundry/metadata";

import type { ProjectRendererKey } from "./project-analysis-resolver.js";

export type ProjectOverviewAiSectionDefinition = {
  id: string;
  label: string;
};

export type ProjectOverviewAiUnitStatus =
  | { status: "queued" | "running"; artifactId?: string }
  | { status: "available"; artifactId: string; completedAt?: string; result: unknown }
  | { status: "empty"; artifactId: string; completedAt?: string }
  | { status: "unavailable"; reason: string; artifactId?: string; completedAt?: string };

export type ProjectOverviewAiReadModel = {
  contract: "energyiq-project-overview-ai-read-model@1";
  rendererKey: ProjectRendererKey;
  binding: {
    workspaceId: string;
    projectId: string;
    scopeId: string;
    dataSnapshotId: string;
    projectReleaseId: string;
    analysisPeriod: { from: string; to: string };
    modelProfileId: string;
    modelProfileRevision: number;
  };
  keyFindings: ProjectOverviewAiUnitStatus;
  sections: Record<string, ProjectOverviewAiUnitStatus>;
  additionalInsights: ProjectOverviewAiUnitStatus;
};

export type ProjectOverviewAiAdapter = {
  rendererKey: ProjectRendererKey;
  sections: readonly ProjectOverviewAiSectionDefinition[];
  resolveIdentity(input: {
    projectId: string;
    scopeId: string;
    user: UserRecord;
    request: {
      kind: "current";
    } | {
      kind: "pinned";
      pin: { from: string; to: string; dataSnapshotId: string; projectReleaseId: string };
    };
  }): Promise<EnergyIqOverviewAiArtifactIdentity>;
  readExact(input: {
    identity: EnergyIqOverviewAiArtifactIdentity;
    user: UserRecord;
  }): Promise<ProjectOverviewAiReadModel | null>;
  generateMissing(input: {
    identity: EnergyIqOverviewAiArtifactIdentity;
    user: UserRecord;
    retryTarget?: string;
  }): Promise<ProjectOverviewAiReadModel>;
};

export const findProjectOverviewAiAdapter = (
  adapters: readonly ProjectOverviewAiAdapter[] | undefined,
  rendererKey: ProjectRendererKey | null,
): ProjectOverviewAiAdapter | null => rendererKey
  ? adapters?.find((adapter) => adapter.rendererKey === rendererKey) ?? null
  : null;

export const projectOverviewAiReadModelMatchesIdentity = (
  readModel: ProjectOverviewAiReadModel,
  identity: EnergyIqOverviewAiArtifactIdentity,
): boolean => readModel.rendererKey === identity.rendererKey
  && readModel.binding.workspaceId === identity.workspaceId
  && readModel.binding.projectId === identity.projectId
  && readModel.binding.scopeId === identity.scopeId
  && readModel.binding.dataSnapshotId === identity.dataSnapshotId
  && readModel.binding.projectReleaseId === identity.projectReleaseId
  && readModel.binding.analysisPeriod.from === identity.analysisPeriodFrom
  && readModel.binding.analysisPeriod.to === identity.analysisPeriodTo
  && readModel.binding.modelProfileId === identity.modelProfileId
  && readModel.binding.modelProfileRevision === identity.modelProfileRevision;
