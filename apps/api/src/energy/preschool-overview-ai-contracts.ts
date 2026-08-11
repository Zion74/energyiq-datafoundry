import type { EnergyIqOverviewAiArtifactIdentity } from "@datafoundry/metadata";

export const PRESCHOOL_SECTION_IDS = [
  "centre-benchmark",
  "standby-wastage",
  "operating-behaviour",
  "planning-outlook",
] as const;

export type PreschoolSectionId = typeof PRESCHOOL_SECTION_IDS[number];

export type PreschoolOverviewAiBinding = {
  workspaceId: string;
  projectId: "preschool-demo";
  scopeId: string;
  dataSnapshotId: string;
  projectReleaseId: string;
  analysisPeriod: { from: string; to: string };
  modelProfileId: string;
  modelProfileRevision: number;
};

export type PreschoolSectionPackEvidence = {
  id: string;
  label: string;
  value: unknown;
  unit?: string;
  entityRefs: string[];
  evidenceRefs: string[];
};

export type PreschoolSectionPack = {
  sectionId: PreschoolSectionId;
  audience: "non-technical energy manager";
  decisionQuestion: string;
  binding: PreschoolOverviewAiBinding;
  evidence: PreschoolSectionPackEvidence[];
  dataQuality: { status: string; detail?: string };
  limitations: string[];
  missingEvidence: string[];
  pageCoverage: string[];
  allowedNextChecks: string[];
};

export type PreschoolSectionKeyPoint = {
  kind: "finding" | "meaning" | "next-check";
  label?: string;
  text: string;
  evidenceRefs: string[];
};

export type PreschoolSectionInterpretationResult = {
  artifactKind: "section-interpretation";
  status: "available" | "empty";
  providerProfileId: string;
  runId: string;
  contract: { id: "preschool-section-interpretation"; revision: "preschool-section-interpretation-v1" };
  binding: PreschoolOverviewAiBinding;
  sectionId: PreschoolSectionId;
  summary?: string;
  keyPoints: PreschoolSectionKeyPoint[];
  limitation?: string;
};

export type PreschoolExecutiveKeyFinding = {
  id: string;
  takeaway: string;
  sectionIds: PreschoolSectionId[];
  evidenceRefs: string[];
};

export type PreschoolExecutiveSynthesisResult = {
  artifactKind: "executive-synthesis";
  status: "available" | "empty";
  providerProfileId: string;
  runId: string;
  contract: { id: "preschool-executive-synthesis"; revision: "preschool-executive-synthesis-v1" };
  binding: PreschoolOverviewAiBinding;
  sourceSectionArtifactIds: string[];
  keyFindings: PreschoolExecutiveKeyFinding[];
};

export type PreschoolOverviewAiUnitStatus<T> =
  | { status: "queued" | "running" }
  | { status: "available"; artifactId: string; result: T }
  | { status: "empty"; artifactId: string; result: T }
  | { status: "unavailable"; artifactId?: string; reason: string };

export type PreschoolOverviewAiReadModel = {
  artifactKind: "preschool-overview-ai-read-model";
  status: "available";
  binding: PreschoolOverviewAiBinding;
  sections: Record<PreschoolSectionId, PreschoolOverviewAiUnitStatus<PreschoolSectionInterpretationResult>>;
  executive: PreschoolOverviewAiUnitStatus<PreschoolExecutiveSynthesisResult>;
  autonomous?: unknown;
};

export const isPreschoolSectionId = (value: string): value is PreschoolSectionId =>
  (PRESCHOOL_SECTION_IDS as readonly string[]).includes(value);

export const preschoolOverviewAiBindingFromIdentity = (
  identity: EnergyIqOverviewAiArtifactIdentity,
): PreschoolOverviewAiBinding => ({
  workspaceId: identity.workspaceId,
  projectId: "preschool-demo",
  scopeId: identity.scopeId,
  dataSnapshotId: identity.dataSnapshotId,
  projectReleaseId: identity.projectReleaseId,
  analysisPeriod: {
    from: identity.analysisPeriodFrom,
    to: identity.analysisPeriodTo,
  },
  modelProfileId: identity.modelProfileId,
  modelProfileRevision: identity.modelProfileRevision,
});
