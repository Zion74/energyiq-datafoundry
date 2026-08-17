import type { LocalDataGateway } from "@datafoundry/data-gateway";
import type {
  EnergyIqOverviewAiArtifactIdentity,
  EnergyIqOverviewAiArtifactRecord,
  MetadataStore,
  UserRecord,
} from "@datafoundry/metadata";
import { isDeepStrictEqual } from "node:util";

import {
  createNgeeAnnOverviewAiExecutiveArtifactIdentity,
  createNgeeAnnOverviewAiSectionArtifactIdentity,
  createOverviewAiArtifactIdentity,
  resolveCurrentOverviewAiArtifactIdentity,
  type OverviewAiArtifactIdentityV13,
} from "./overview-ai-artifact.js";
import { ngeeAnnExecutiveTargetId } from "./ngee-ann-executive-synthesis.js";
import {
  NGEE_ANN_SECTION_IDS,
  type NgeeAnnSectionId,
} from "./ngee-ann-section-pack.js";
import {
  projectOverviewAiGenerationBinding,
  type ProjectOverviewAiAdapter,
  type ProjectOverviewAiReadModel,
  type ProjectOverviewAiUnitStatus,
} from "./project-overview-ai-adapter.js";

export const NGEE_ANN_OVERVIEW_AI_SECTIONS = [
  { id: "trend-and-demand", label: "Trend and demand" },
  { id: "time-behaviour", label: "Time behaviour" },
  { id: "circuit-concentration", label: "Circuit concentration" },
  { id: "decision-priorities", label: "Decision priorities" },
] as const;

type ResolveNgeeAnnBaseIdentity = (input: {
  projectId: string;
  scopeId: string;
  user: UserRecord;
  request: {
    kind: "current";
  } | {
    kind: "pinned";
    pin: { from: string; to: string; dataSnapshotId: string; projectReleaseId: string };
  };
}) => Promise<OverviewAiArtifactIdentityV13>;

export const createNgeeAnnProjectOverviewAiAdapter = (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  resolveBaseIdentity?: ResolveNgeeAnnBaseIdentity;
  executeMissing: (input: {
    identity: OverviewAiArtifactIdentityV13;
    user: UserRecord;
    retryTarget?: string;
  }) => Promise<void> | void;
}): ProjectOverviewAiAdapter => {
  const resolveBaseIdentity = input.resolveBaseIdentity ?? (async ({
    projectId,
    scopeId,
    user,
    request,
  }) => resolveCurrentOverviewAiArtifactIdentity({
    metadataStore: input.metadataStore,
    dataGateway: input.dataGateway,
    projectId,
    scopeId,
    user,
    ...(request.kind === "pinned" ? { pin: request.pin } : {}),
  }));

  const readExact = async ({
    identity,
  }: {
    identity: EnergyIqOverviewAiArtifactIdentity;
    user: UserRecord;
  }): Promise<ProjectOverviewAiReadModel> => {
    const baseIdentity = requireCurrentNgeeAnnBaseIdentity(identity);
    const store = input.metadataStore.energyIq.overviewAiArtifacts;
    const sectionRecords = NGEE_ANN_SECTION_IDS.map((sectionId) => {
      const sectionIdentity = createNgeeAnnOverviewAiSectionArtifactIdentity({
        baseIdentity,
        targetId: sectionId,
      });
      return { sectionId, record: store.find(sectionIdentity) };
    });
    const sections = Object.fromEntries(sectionRecords.map(({ sectionId, record }) => [
      sectionId,
      artifactUnit(record),
    ])) as Record<NgeeAnnSectionId, ProjectOverviewAiUnitStatus>;
    const executiveIdentity = createNgeeAnnOverviewAiExecutiveArtifactIdentity({
      baseIdentity,
      targetId: ngeeAnnExecutiveTargetId(sectionRecords.flatMap(({ record }) => record ? [record] : [])),
    });

    return {
      contract: "energyiq-project-overview-ai-read-model@1",
      rendererKey: "ngee-ann-overview",
      binding: {
        workspaceId: baseIdentity.workspaceId,
        projectId: baseIdentity.projectId,
        scopeId: baseIdentity.scopeId,
        dataSnapshotId: baseIdentity.dataSnapshotId,
        projectReleaseId: baseIdentity.projectReleaseId,
        analysisPeriod: {
          from: baseIdentity.analysisPeriodFrom,
          to: baseIdentity.analysisPeriodTo,
        },
        modelProfileId: baseIdentity.modelProfileId,
        modelProfileRevision: baseIdentity.modelProfileRevision,
        generation: projectOverviewAiGenerationBinding(baseIdentity),
      },
      keyFindings: artifactUnit(store.find(executiveIdentity)),
      sections,
      additionalInsights: { status: "missing" },
    };
  };

  return {
    rendererKey: "ngee-ann-overview",
    sections: NGEE_ANN_OVERVIEW_AI_SECTIONS,
    resolveIdentity: resolveBaseIdentity,
    readExact,
    async generateMissing({ identity, user, retryTarget }) {
      const baseIdentity = requireCurrentNgeeAnnBaseIdentity(identity);
      await input.executeMissing({
        identity: baseIdentity,
        user,
        ...(retryTarget ? { retryTarget } : {}),
      });
      return readExact({ identity: baseIdentity, user });
    },
  };
};

const requireCurrentNgeeAnnBaseIdentity = (
  identity: EnergyIqOverviewAiArtifactIdentity,
): OverviewAiArtifactIdentityV13 => {
  if (identity.rendererKey !== "ngee-ann-overview") {
    throw new Error("ENERGYIQ_NGEE_ANN_OVERVIEW_AI_IDENTITY_INVALID");
  }
  let current: OverviewAiArtifactIdentityV13;
  try {
    current = createOverviewAiArtifactIdentity({
      workspaceId: identity.workspaceId,
      projectId: identity.projectId,
      scopeId: identity.scopeId,
      dataSnapshotId: identity.dataSnapshotId,
      projectReleaseId: identity.projectReleaseId,
      analysisPeriodFrom: identity.analysisPeriodFrom,
      analysisPeriodTo: identity.analysisPeriodTo,
      rendererKey: identity.rendererKey,
      rendererVersion: identity.rendererVersion,
      modelProfileId: identity.modelProfileId,
      modelProfileRevision: identity.modelProfileRevision,
    });
  } catch {
    throw new Error("ENERGYIQ_NGEE_ANN_OVERVIEW_AI_IDENTITY_INVALID");
  }
  if (!isDeepStrictEqual(current, identity)) {
    throw new Error("ENERGYIQ_NGEE_ANN_OVERVIEW_AI_IDENTITY_INVALID");
  }
  return current;
};

const artifactUnit = (
  record: EnergyIqOverviewAiArtifactRecord | undefined,
): ProjectOverviewAiUnitStatus => {
  if (!record) return { status: "missing" };
  if (record.status === "queued" || record.status === "running") {
    return { status: record.status, artifactId: record.id };
  }
  if (record.status === "failed") {
    return {
      status: "failed",
      artifactId: record.id,
      reason: record.error_code ?? "ENERGYIQ_PROJECT_OVERVIEW_AI_ARTIFACT_FAILED",
      ...(record.completed_at ? { completedAt: record.completed_at } : {}),
    };
  }
  const result = parseStoredResult(record.result_json);
  if (!result) {
    return {
      status: "failed",
      artifactId: record.id,
      reason: "ENERGYIQ_PROJECT_OVERVIEW_AI_ARTIFACT_RESULT_INVALID",
      ...(record.completed_at ? { completedAt: record.completed_at } : {}),
    };
  }
  if (result.status === "empty") {
    return {
      status: "empty",
      artifactId: record.id,
      ...(record.completed_at ? { completedAt: record.completed_at } : {}),
    };
  }
  return {
    status: "available",
    artifactId: record.id,
    result,
    ...(record.completed_at ? { completedAt: record.completed_at } : {}),
  };
};

const parseStoredResult = (
  resultJson: string | undefined,
): Record<string, unknown> | null => {
  if (!resultJson) return null;
  try {
    const parsed = JSON.parse(resultJson) as unknown;
    return isRecord(parsed) && (parsed.status === "available" || parsed.status === "empty")
      ? parsed
      : null;
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
