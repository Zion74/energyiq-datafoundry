import type {
  EnergyIqOverviewAiArtifactIdentity,
  EnergyIqOverviewAiArtifactRecord,
  MetadataStore,
} from "@datafoundry/metadata";

import {
  createPreschoolOverviewAiExecutiveArtifactIdentityV4,
  createPreschoolOverviewAiSectionArtifactIdentityV3,
  createPreschoolOverviewAiSectionArtifactIdentityV4,
  createPreschoolOverviewAiValueArtifactIdentity,
  type OverviewAiArtifactIdentityV13,
} from "./overview-ai-artifact.js";
import { preschoolExecutiveSynthesisTargetId } from "./preschool-executive-synthesis.js";
import {
  PRESCHOOL_SECTION_IDS,
  preschoolOverviewAiBindingFromIdentity,
  type PreschoolExecutiveSynthesisResult,
  type PreschoolOverviewAiReadModel,
  type PreschoolOverviewAiUnitStatus,
  type PreschoolSectionId,
  type PreschoolSectionInterpretationResult,
} from "./preschool-overview-ai-contracts.js";

export const composePreschoolOverviewAiReadModel = (input: {
  metadataStore: MetadataStore;
  baseIdentity: OverviewAiArtifactIdentityV13;
}): PreschoolOverviewAiReadModel | null => composeReadModel({
  ...input,
  createSectionIdentity: createPreschoolOverviewAiSectionArtifactIdentityV4,
  parseSectionResult,
  createExecutiveIdentity: createPreschoolOverviewAiExecutiveArtifactIdentityV4,
  parseExecutiveResult: parseExecutiveResultV4,
});

export const composePreschoolOverviewAiReadModelV3 = (input: {
  metadataStore: MetadataStore;
  baseIdentity: OverviewAiArtifactIdentityV13;
}): PreschoolOverviewAiReadModel | null => composeReadModel({
  ...input,
  createSectionIdentity: createPreschoolOverviewAiSectionArtifactIdentityV3,
  parseSectionResult: parseSectionResultV3,
  createExecutiveIdentity: ({ baseIdentity, targetId }) => createPreschoolOverviewAiValueArtifactIdentity({
    baseIdentity,
    artifactKind: "executive-synthesis",
    targetId,
  }),
  parseExecutiveResult: parseExecutiveResultV3,
});

const composeReadModel = (input: {
  metadataStore: MetadataStore;
  baseIdentity: OverviewAiArtifactIdentityV13;
  createSectionIdentity: typeof createPreschoolOverviewAiSectionArtifactIdentityV4;
  parseSectionResult: typeof parseSectionResult;
  createExecutiveIdentity: (input: {
    baseIdentity: OverviewAiArtifactIdentityV13;
    targetId: string;
  }) => EnergyIqOverviewAiArtifactIdentity;
  parseExecutiveResult: typeof parseExecutiveResultV4;
}): PreschoolOverviewAiReadModel | null => {
  const store = input.metadataStore.energyIq.overviewAiArtifacts;
  const sectionArtifacts = Object.fromEntries(PRESCHOOL_SECTION_IDS.map((sectionId) => {
    const identity = input.createSectionIdentity({
      baseIdentity: input.baseIdentity,
      targetId: sectionId,
    });
    return [sectionId, { identity, artifact: store.find(identity) ?? null }];
  })) as Record<PreschoolSectionId, {
    identity: EnergyIqOverviewAiArtifactIdentity;
    artifact: EnergyIqOverviewAiArtifactRecord | null;
  }>;
  const acceptedSectionArtifactIds = PRESCHOOL_SECTION_IDS.flatMap((sectionId) => {
    const { artifact, identity } = sectionArtifacts[sectionId];
    const result = artifact?.status === "available" && artifact.result_json
      ? input.parseSectionResult(artifact.result_json, identity)
      : null;
    return result?.status === "available" && artifact ? [artifact.id] : [];
  });
  const executiveIdentity = input.createExecutiveIdentity({
    baseIdentity: input.baseIdentity,
    targetId: preschoolExecutiveSynthesisTargetId(acceptedSectionArtifactIds),
  });
  const executiveArtifact = store.find(executiveIdentity) ?? null;
  const autonomousArtifact = store.find(input.baseIdentity);
  const hasValueArtifacts = PRESCHOOL_SECTION_IDS.some((sectionId) => sectionArtifacts[sectionId].artifact !== null)
    || executiveArtifact !== null;
  if (!hasValueArtifacts) return null;

  return {
    artifactKind: "preschool-overview-ai-read-model",
    status: "available",
    binding: preschoolOverviewAiBindingFromIdentity(input.baseIdentity),
    sections: Object.fromEntries(PRESCHOOL_SECTION_IDS.map((sectionId) => {
      const { identity, artifact } = sectionArtifacts[sectionId];
      return [sectionId, sectionUnit(artifact, identity, input.parseSectionResult)];
    })) as PreschoolOverviewAiReadModel["sections"],
    executive: executiveUnit(executiveArtifact, executiveIdentity, input.parseExecutiveResult),
    ...(autonomousArtifact?.status === "available" && autonomousArtifact.result_json
      ? { autonomous: parseJson(autonomousArtifact.result_json) }
      : {}),
  };
};

const sectionUnit = (
  artifact: EnergyIqOverviewAiArtifactRecord | null,
  identity: EnergyIqOverviewAiArtifactIdentity,
  parseResult: typeof parseSectionResult,
): PreschoolOverviewAiUnitStatus<PreschoolSectionInterpretationResult> => {
  if (!artifact) return { status: "unavailable", reason: "Section interpretation has not been generated." };
  if (artifact.status === "queued" || artifact.status === "running") return { status: artifact.status };
  if (artifact.status === "failed") {
    return { status: "unavailable", artifactId: artifact.id, reason: artifact.error_code ?? "Section interpretation failed." };
  }
  const result = artifact.result_json ? parseResult(artifact.result_json, identity) : null;
  if (!result) return { status: "unavailable", artifactId: artifact.id, reason: "Section interpretation is invalid." };
  return result.status === "empty"
    ? { status: "empty", artifactId: artifact.id, result }
    : { status: "available", artifactId: artifact.id, result };
};

const executiveUnit = (
  artifact: EnergyIqOverviewAiArtifactRecord | null,
  identity: EnergyIqOverviewAiArtifactIdentity,
  parseResult: typeof parseExecutiveResultV4,
): PreschoolOverviewAiUnitStatus<PreschoolExecutiveSynthesisResult> => {
  if (!artifact) return { status: "unavailable", reason: "Executive synthesis has not been generated." };
  if (artifact.status === "queued" || artifact.status === "running") return { status: artifact.status };
  if (artifact.status === "failed") {
    return { status: "unavailable", artifactId: artifact.id, reason: artifact.error_code ?? "Executive synthesis failed." };
  }
  const result = artifact.result_json ? parseResult(artifact.result_json, identity) : null;
  if (!result) return { status: "unavailable", artifactId: artifact.id, reason: "Executive synthesis is invalid." };
  return result.status === "empty"
    ? { status: "empty", artifactId: artifact.id, result }
    : { status: "available", artifactId: artifact.id, result };
};

const parseSectionResult = (
  value: string,
  identity: EnergyIqOverviewAiArtifactIdentity,
): PreschoolSectionInterpretationResult | null => {
  const parsed = parseJson(value);
  if (!isRecord(parsed)
    || parsed.artifactKind !== "section-interpretation"
    || (parsed.status !== "available" && parsed.status !== "empty")
    || parsed.sectionId !== identity.targetId
    || !isRecord(parsed.contract)
    || parsed.contract.id !== "preschool-section-interpretation"
    || parsed.contract.revision !== identity.outputContractRevision
    || parsed.packRevision !== identity.analysisPackRevision
    || !isRecord(parsed.capability)
    || parsed.capability.revision !== identity.capabilityRevision
    || !sameValueArtifactBinding(parsed.binding, identity)
    || !Array.isArray(parsed.insights)
    || !isRecord(parsed.publication)
    || parsed.publication.policyId !== "preschool-section-publication"
    || parsed.publication.policyRevision !== identity.publicationRevision) return null;
  if (parsed.status === "empty") {
    if (parsed.summary !== undefined
      || parsed.insights.length !== 0
      || parsed.limitation !== undefined) return null;
  } else if (!isRecord(parsed.summary)
    || typeof parsed.summary.text !== "string"
    || !parsed.summary.text.trim()
    || !Array.isArray(parsed.summary.evidenceRefs)) return null;
  return parsed as unknown as PreschoolSectionInterpretationResult;
};

const parseSectionResultV3 = (
  value: string,
  identity: EnergyIqOverviewAiArtifactIdentity,
): PreschoolSectionInterpretationResult | null => {
  const parsed = parseJson(value);
  if (!isRecord(parsed)
    || parsed.artifactKind !== "section-interpretation"
    || (parsed.status !== "available" && parsed.status !== "empty")
    || parsed.sectionId !== identity.targetId
    || !isRecord(parsed.contract)
    || parsed.contract.id !== "preschool-section-interpretation"
    || parsed.contract.revision !== identity.outputContractRevision
    || !sameValueArtifactBinding(parsed.binding, identity)
    || !Array.isArray(parsed.keyPoints)) return null;
  return parsed as unknown as PreschoolSectionInterpretationResult;
};

const sameValueArtifactBinding = (
  value: unknown,
  identity: EnergyIqOverviewAiArtifactIdentity,
): boolean => isRecord(value)
  && value.workspaceId === identity.workspaceId
  && value.projectId === identity.projectId
  && value.scopeId === identity.scopeId
  && value.dataSnapshotId === identity.dataSnapshotId
  && value.projectReleaseId === identity.projectReleaseId
  && value.modelProfileId === identity.modelProfileId
  && value.modelProfileRevision === identity.modelProfileRevision
  && isRecord(value.analysisPeriod)
  && value.analysisPeriod.from === identity.analysisPeriodFrom
  && value.analysisPeriod.to === identity.analysisPeriodTo;

const parseExecutiveResultV3 = (
  value: string,
  identity: EnergyIqOverviewAiArtifactIdentity,
): PreschoolExecutiveSynthesisResult | null => {
  const parsed = parseJson(value);
  if (!isRecord(parsed)
    || parsed.artifactKind !== "executive-synthesis"
    || (parsed.status !== "available" && parsed.status !== "empty")
    || !isRecord(parsed.binding)
    || parsed.binding.dataSnapshotId !== identity.dataSnapshotId
    || parsed.binding.projectReleaseId !== identity.projectReleaseId
    || !Array.isArray(parsed.sourceSectionArtifactIds)
    || preschoolExecutiveSynthesisTargetId(parsed.sourceSectionArtifactIds.filter((id): id is string => typeof id === "string")) !== identity.targetId
    || !Array.isArray(parsed.keyFindings)) return null;
  return parsed as unknown as PreschoolExecutiveSynthesisResult;
};

const parseExecutiveResultV4 = (
  value: string,
  identity: EnergyIqOverviewAiArtifactIdentity,
): PreschoolExecutiveSynthesisResult | null => {
  const parsed = parseJson(value);
  if (!isRecord(parsed)
    || parsed.artifactKind !== "executive-synthesis"
    || (parsed.status !== "available" && parsed.status !== "empty")
    || !isRecord(parsed.contract)
    || parsed.contract.revision !== "preschool-executive-synthesis-v4"
    || parsed.contract.revision !== identity.outputContractRevision
    || !sameValueArtifactBinding(parsed.binding, identity)
    || !Array.isArray(parsed.sourceSectionArtifactIds)
    || !parsed.sourceSectionArtifactIds.every((id) => typeof id === "string" && Boolean(id.trim()))
    || !Array.isArray(parsed.findings)) return null;
  if (parsed.status === "empty") {
    if (parsed.sourceSectionArtifactIds.length !== 0
      || parsed.summary !== undefined
      || parsed.findings.length !== 0) return null;
  } else if (parsed.sourceSectionArtifactIds.length === 0
    || !isRecord(parsed.summary)
    || typeof parsed.summary.text !== "string"
    || !parsed.summary.text.trim()
    || !Array.isArray(parsed.summary.evidenceRefs)) return null;
  return parsed as unknown as PreschoolExecutiveSynthesisResult;
};

const parseJson = (value: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
