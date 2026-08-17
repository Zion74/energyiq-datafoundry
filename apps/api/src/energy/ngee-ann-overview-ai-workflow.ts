import type { LocalDataGateway } from "@datafoundry/data-gateway";
import type {
  EnergyIqOverviewAiArtifactIdentity,
  EnergyIqOverviewAiArtifactRecord,
  MetadataStore,
  UserRecord,
} from "@datafoundry/metadata";

import { overviewAiArtifactPinnedLocalPeriod, type OverviewAiArtifactIdentityV13 } from "./overview-ai-artifact.js";
import { createNgeeAnnExecutiveSynthesizer, type NgeeAnnExecutiveRunner } from "./ngee-ann-executive-synthesis.js";
import { requireCurrentNgeeAnnBaseIdentity } from "./ngee-ann-overview-ai-adapter.js";
import { createNgeeAnnSectionInterpreter, type NgeeAnnSectionInterpreterRunner } from "./ngee-ann-section-interpreter.js";
import {
  assembleNgeeAnnSectionPacks,
  NGEE_ANN_SECTION_IDS,
  type NgeeAnnSectionId,
  type NgeeAnnSectionPacks,
} from "./ngee-ann-section-pack.js";
import { resolveProjectAnalysis } from "./project-analysis-resolver.js";

export type NgeeAnnOverviewAiRetryTarget = NgeeAnnSectionId | "executive-synthesis";

export const createNgeeAnnOverviewAiWorkflow = (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  runSection: NgeeAnnSectionInterpreterRunner;
  runExecutive: NgeeAnnExecutiveRunner;
  resolvePacks?: (args: {
    identity: OverviewAiArtifactIdentityV13;
    user: UserRecord;
  }) => Promise<NgeeAnnSectionPacks>;
}) => {
  const interpreter = createNgeeAnnSectionInterpreter({
    metadataStore: input.metadataStore,
    runSection: input.runSection,
  });
  const synthesizer = createNgeeAnnExecutiveSynthesizer({
    metadataStore: input.metadataStore,
    runExecutive: input.runExecutive,
  });
  const resolvePacks = input.resolvePacks ?? (async ({ identity, user }) => {
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
    return assembleNgeeAnnSectionPacks(resolution.snapshot);
  });

  return {
    async execute({
      identity,
      user,
      retryTarget,
    }: {
      identity: EnergyIqOverviewAiArtifactIdentity;
      user: UserRecord;
      retryTarget?: string;
    }): Promise<{
      sections: Record<NgeeAnnSectionId, EnergyIqOverviewAiArtifactRecord>;
      executive?: EnergyIqOverviewAiArtifactRecord;
    }> {
      const baseIdentity = requireCurrentNgeeAnnBaseIdentity(identity);
      const packs = await resolvePacks({ identity: baseIdentity, user });
      const retryTargets = retryTarget && isNgeeAnnSectionId(retryTarget) ? [retryTarget] : [];
      const sections = await interpreter.execute({ baseIdentity, packs, user, retryTargets });
      if (!areNgeeAnnSectionArtifactsTerminal(sections)) return { sections };
      const executive = await synthesizer.execute({
        baseIdentity,
        sectionRecords: NGEE_ANN_SECTION_IDS.map((sectionId) => sections[sectionId]),
        user,
        retry: retryTarget === "executive-synthesis",
      });
      return { sections, executive };
    },
  };
};

export const areNgeeAnnSectionArtifactsTerminal = (
  sections: Record<NgeeAnnSectionId, Pick<EnergyIqOverviewAiArtifactRecord, "status">>,
): boolean => NGEE_ANN_SECTION_IDS.every((sectionId) =>
  sections[sectionId].status === "available" || sections[sectionId].status === "failed");

const isNgeeAnnSectionId = (value: string): value is NgeeAnnSectionId =>
  (NGEE_ANN_SECTION_IDS as readonly string[]).includes(value);
