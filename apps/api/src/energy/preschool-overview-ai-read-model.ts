import type {
  EnergyIqOverviewAiArtifactIdentity,
  EnergyIqOverviewAiArtifactRecord,
  MetadataStore,
} from "@datafoundry/metadata";

import {
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
}): PreschoolOverviewAiReadModel | null => {
  const store = input.metadataStore.energyIq.overviewAiArtifacts;
  const sectionArtifacts = Object.fromEntries(PRESCHOOL_SECTION_IDS.map((sectionId) => {
    const identity = createPreschoolOverviewAiValueArtifactIdentity({
      baseIdentity: input.baseIdentity,
      artifactKind: "section-interpretation",
      targetId: sectionId,
    });
    return [sectionId, { identity, artifact: store.find(identity) }];
  })) as Record<PreschoolSectionId, {
    identity: EnergyIqOverviewAiArtifactIdentity;
    artifact: EnergyIqOverviewAiArtifactRecord | null;
  }>;
  const acceptedSectionArtifactIds = PRESCHOOL_SECTION_IDS.flatMap((sectionId) => {
    const { artifact, identity } = sectionArtifacts[sectionId];
    const result = artifact?.status === "available" && artifact.result_json
      ? parseSectionResult(artifact.result_json, identity)
      : null;
    return result?.status === "available" && artifact ? [artifact.id] : [];
  });
  const executiveIdentity = createPreschoolOverviewAiValueArtifactIdentity({
    baseIdentity: input.baseIdentity,
    artifactKind: "executive-synthesis",
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
      return [sectionId, sectionUnit(artifact, identity)];
    })) as PreschoolOverviewAiReadModel["sections"],
    executive: executiveUnit(executiveArtifact, executiveIdentity),
    ...(autonomousArtifact?.status === "available" && autonomousArtifact.result_json
      ? { autonomous: parseJson(autonomousArtifact.result_json) }
      : {}),
  };
};

const sectionUnit = (
  artifact: EnergyIqOverviewAiArtifactRecord | null,
  identity: EnergyIqOverviewAiArtifactIdentity,
): PreschoolOverviewAiUnitStatus<PreschoolSectionInterpretationResult> => {
  if (!artifact) return { status: "unavailable", reason: "Section interpretation has not been generated." };
  if (artifact.status === "queued" || artifact.status === "running") return { status: artifact.status };
  if (artifact.status === "failed") {
    return { status: "unavailable", artifactId: artifact.id, reason: artifact.error_code ?? "Section interpretation failed." };
  }
  const result = artifact.result_json ? parseSectionResult(artifact.result_json, identity) : null;
  if (!result) return { status: "unavailable", artifactId: artifact.id, reason: "Section interpretation is invalid." };
  return result.status === "empty"
    ? { status: "empty", artifactId: artifact.id, result }
    : { status: "available", artifactId: artifact.id, result };
};

const executiveUnit = (
  artifact: EnergyIqOverviewAiArtifactRecord | null,
  identity: EnergyIqOverviewAiArtifactIdentity,
): PreschoolOverviewAiUnitStatus<PreschoolExecutiveSynthesisResult> => {
  if (!artifact) return { status: "unavailable", reason: "Executive synthesis has not been generated." };
  if (artifact.status === "queued" || artifact.status === "running") return { status: artifact.status };
  if (artifact.status === "failed") {
    return { status: "unavailable", artifactId: artifact.id, reason: artifact.error_code ?? "Executive synthesis failed." };
  }
  const result = artifact.result_json ? parseExecutiveResult(artifact.result_json, identity) : null;
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
    || !isRecord(parsed.binding)
    || parsed.binding.dataSnapshotId !== identity.dataSnapshotId
    || parsed.binding.projectReleaseId !== identity.projectReleaseId
    || !Array.isArray(parsed.keyPoints)) return null;
  return parsed as unknown as PreschoolSectionInterpretationResult;
};

const parseExecutiveResult = (
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

const parseJson = (value: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
