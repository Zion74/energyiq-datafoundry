import type { LocalDataGateway } from "@datafoundry/data-gateway";
import type { EnergyIqOverviewAiArtifactIdentity, MetadataStore, UserRecord } from "@datafoundry/metadata";
import { WORKSPACE_DEFAULT_MODEL_PROFILE_ID } from "@datafoundry/metadata";

import { ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID } from "../workspace-model-profile-resolver.js";
import {
  overviewAiArtifactPinnedLocalPeriod,
  resolveCurrentOverviewAiArtifactIdentity,
  type OverviewAiArtifactIdentityV13,
} from "./overview-ai-artifact.js";
import { createPreschoolExecutiveSynthesizer, type PreschoolExecutiveSynthesisRunner } from "./preschool-executive-synthesis.js";
import { composePreschoolOverviewAiReadModel } from "./preschool-overview-ai-read-model.js";
import {
  PRESCHOOL_SECTION_IDS,
  isPreschoolSectionId,
  type PreschoolOverviewAiReadModel,
  type PreschoolSectionId,
} from "./preschool-overview-ai-contracts.js";
import { createPreschoolSectionInterpreter, type PreschoolSectionInterpreterBatchRunner } from "./preschool-section-interpreter.js";
import { assemblePreschoolSectionPacks } from "./preschool-section-pack.js";
import { resolveProjectAnalysis, type ProjectAnalysisSnapshot } from "./project-analysis-resolver.js";

export type PreschoolOverviewAiRetryTarget = PreschoolSectionId | "executive-synthesis";

export type PreschoolOverviewAiPageWorkflow = {
  resolveCurrentIdentity(input: {
    projectId: string;
    scopeId: string;
    user: UserRecord;
    pin?: { from: string; to: string; dataSnapshotId: string; projectReleaseId: string };
  }): Promise<OverviewAiArtifactIdentityV13>;
  read(input: {
    identity: EnergyIqOverviewAiArtifactIdentity;
    user: UserRecord;
  }): Promise<PreschoolOverviewAiReadModel | null>;
  execute(input: {
    identity: EnergyIqOverviewAiArtifactIdentity;
    user: UserRecord;
    retry: boolean;
    retryTarget?: PreschoolOverviewAiRetryTarget;
  }): Promise<PreschoolOverviewAiReadModel>;
};

export const createPreschoolOverviewAiPageWorkflow = (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  runSectionBatch: PreschoolSectionInterpreterBatchRunner;
  runExecutiveSynthesis: PreschoolExecutiveSynthesisRunner;
  resolveSnapshot?: (args: {
    identity: EnergyIqOverviewAiArtifactIdentity;
    user: UserRecord;
  }) => Promise<ProjectAnalysisSnapshot>;
}): PreschoolOverviewAiPageWorkflow => {
  const resolveSnapshot = input.resolveSnapshot ?? (async ({ identity, user }) => {
    const project = input.metadataStore.energyIq.getProject(identity.projectId);
    const period = overviewAiArtifactPinnedLocalPeriod({ identity, timezone: project.timezone });
    const resolution = await resolveProjectAnalysis({
      metadataStore: input.metadataStore,
      dataGateway: input.dataGateway,
      user,
      workspaceId: identity.workspaceId,
      bypassCache: true,
      request: {
        projectId: identity.projectId,
        scopeId: identity.scopeId,
        resource: "electricity",
        period: "Custom",
        from: period.from,
        to: period.to,
        expectedDataSnapshotId: identity.dataSnapshotId,
        expectedProjectReleaseId: identity.projectReleaseId,
      },
    });
    if (resolution.status !== "ready") throw new Error("OVERVIEW_AI_SNAPSHOT_NOT_READY");
    return resolution.snapshot;
  });
  const interpreter = createPreschoolSectionInterpreter({
    metadataStore: input.metadataStore,
    runBatch: input.runSectionBatch,
    assertRuntimeIdentity: (identity) => requireModelRuntimeIdentity(input.metadataStore, identity),
  });
  const synthesizer = createPreschoolExecutiveSynthesizer({
    metadataStore: input.metadataStore,
    runSynthesis: input.runExecutiveSynthesis,
    assertRuntimeIdentity: (identity) => requireModelRuntimeIdentity(input.metadataStore, identity),
  });

  return {
    resolveCurrentIdentity: ({ projectId, scopeId, user, pin }) => resolveCurrentOverviewAiArtifactIdentity({
      metadataStore: input.metadataStore,
      dataGateway: input.dataGateway,
      projectId,
      scopeId,
      user,
      ...(pin ? { pin } : {}),
    }),
    async read({ identity }) {
      const baseIdentity = requireBaseIdentity(identity);
      return composePreschoolOverviewAiReadModel({ metadataStore: input.metadataStore, baseIdentity });
    },
    async execute({ identity, user, retry, retryTarget }) {
      const baseIdentity = requireBaseIdentity(identity);
      requireModelRuntimeIdentity(input.metadataStore, baseIdentity);
      const snapshot = await resolveSnapshot({ identity: baseIdentity, user });
      const packs = assemblePreschoolSectionPacks({ identity: baseIdentity, snapshot });
      const retryTargets = retry
        ? retryTarget && isPreschoolSectionId(retryTarget)
          ? [retryTarget]
          : retryTarget === "executive-synthesis"
            ? []
            : [...PRESCHOOL_SECTION_IDS]
        : [];
      await interpreter.execute({ baseIdentity, packs, user, retryTargets });
      requireModelRuntimeIdentity(input.metadataStore, baseIdentity);
      await synthesizer.execute({
        baseIdentity,
        user,
        retry: retry && (retryTarget === undefined || retryTarget === "executive-synthesis"),
      });
      requireModelRuntimeIdentity(input.metadataStore, baseIdentity);
      const readModel = composePreschoolOverviewAiReadModel({ metadataStore: input.metadataStore, baseIdentity });
      if (!readModel) throw new Error("PRESCHOOL_OVERVIEW_AI_READ_MODEL_MISSING");
      return readModel;
    },
  };
};

const requireBaseIdentity = (identity: EnergyIqOverviewAiArtifactIdentity): OverviewAiArtifactIdentityV13 => {
  if (identity.projectId !== "preschool-demo"
    || identity.rendererKey !== "preschool-overview"
    || identity.resource !== "electricity"
    || identity.artifactKind !== undefined
    || !identity.analysisPeriodFrom
    || !identity.analysisPeriodTo
    || !identity.outputContractRevision
    || !identity.validatorRevision
    || !identity.workflowRevision) {
    throw new Error("PRESCHOOL_OVERVIEW_AI_IDENTITY_INVALID");
  }
  return identity as OverviewAiArtifactIdentityV13;
};

const requireModelRuntimeIdentity = (
  metadataStore: MetadataStore,
  identity: EnergyIqOverviewAiArtifactIdentity,
): void => {
  const modelBinding = metadataStore.workspaceDefaultModelProfiles.find(ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID);
  if (!modelBinding
    || identity.modelProfileId !== WORKSPACE_DEFAULT_MODEL_PROFILE_ID
    || modelBinding.revision !== identity.modelProfileRevision) {
    throw new Error("OVERVIEW_AI_MODEL_PROFILE_REVISION_MISMATCH");
  }
  const modelResource = metadataStore.configResources.find({
    workspace_id: ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID,
    user_id: modelBinding.profile_owner_user_id,
    kind: "model-profile",
    id: modelBinding.profile_id,
  });
  if (!modelResource || modelResource.status !== "connected" || !modelResource.default_enabled) {
    throw new Error("OVERVIEW_AI_MODEL_PROFILE_REVISION_MISMATCH");
  }
};
