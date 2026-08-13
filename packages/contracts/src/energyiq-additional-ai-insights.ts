import {
  autonomousInsightOriginIsValid,
  insightMethodRevisionRefIsValid,
  type AutonomousInsightOrigin,
  type InsightMethodRevisionRef,
} from "./energyiq-autonomous-insights.js";

export const ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1 = [
  "energy.evidence.read",
  "energy.metrics.compare",
  "energy.timeseries.analyze",
  "energy.snapshot-history.read",
  "energy.project-knowledge.read",
] as const;

export const CURRENT_ADDITIONAL_AI_INSIGHT_METHOD_SET_ID = "preschool-additional-insights-current";
export const CURRENT_ADDITIONAL_AI_INSIGHT_METHOD_SET_REVISION = "v1";

export type AdditionalAiInsightMethodSet = {
  id: string;
  revision: string;
  methods: readonly InsightMethodRevisionRef[];
};

export const resolveAdditionalAiInsightMethodSet = (input: {
  workspaceId: string;
  methodSetId: string;
  methodSetRevision: string;
}): AdditionalAiInsightMethodSet | null => {
  if (!nonEmptyString(input.workspaceId)
    || input.methodSetId !== CURRENT_ADDITIONAL_AI_INSIGHT_METHOD_SET_ID
    || input.methodSetRevision !== CURRENT_ADDITIONAL_AI_INSIGHT_METHOD_SET_REVISION) return null;
  return {
    id: CURRENT_ADDITIONAL_AI_INSIGHT_METHOD_SET_ID,
    revision: CURRENT_ADDITIONAL_AI_INSIGHT_METHOD_SET_REVISION,
    methods: [{
      skillId: "energyiq-open-discovery",
      semanticVersion: "1.0.0",
      resourceId: "builtin:energyiq-open-discovery",
      resourceRevision: 1,
      contentSha256: "e2492b021782065c04832a0b1c54f1fb00217a58f8c9830c46907d9cc8884465",
      scope: "builtin",
      workspaceId: input.workspaceId,
      userId: "energyiq-system",
      role: "core-method",
    }],
  };
};

export const resolveCurrentAdditionalAiInsightMethodSet = (
  workspaceId: string,
): AdditionalAiInsightMethodSet => {
  const resolved = resolveAdditionalAiInsightMethodSet({
    workspaceId,
    methodSetId: CURRENT_ADDITIONAL_AI_INSIGHT_METHOD_SET_ID,
    methodSetRevision: CURRENT_ADDITIONAL_AI_INSIGHT_METHOD_SET_REVISION,
  });
  if (!resolved) throw new Error("ENERGYIQ_ADDITIONAL_INSIGHT_METHOD_SET_NOT_FOUND");
  return resolved;
};

export type AdditionalAiInsightEpistemicStatus = "observed" | "inferred" | "speculative";

export type AdditionalAiInsightsBinding = {
  workspaceId: string;
  projectId: string;
  scopeId: string;
  dataSnapshotId: string;
  projectReleaseId: string;
  analysisPeriod: {
    from: string;
    to: string;
  };
  modelProfileId: string;
  modelProfileRevision: number;
};

export type AdditionalAiInsightFinding = {
  id: string;
  title: string;
  text: string;
  epistemicStatus: AdditionalAiInsightEpistemicStatus;
  origin: AutonomousInsightOrigin;
  evidenceRefs: string[];
  toolAuditIds: string[];
  deepDiveQuestion?: string;
  alert?: {
    severity: "attention" | "urgent";
    certainty: "confirmed" | "anomaly" | "possible";
    evidenceRefs: string[];
  };
  canvas?: {
    contractRevision: "energyiq-insight-canvas-v1";
    planId: string;
    acceptedBlockIds: string[];
  };
};

export type AdditionalAiInsightToolAudit = {
  auditId: string;
  toolCallId: string;
  toolName: string;
  evidenceRefs: string[];
};

export type AdditionalAiInsightsSnapshotComparison = {
  previousArtifactId: string;
  previousDataSnapshotId: string;
  outcomes: Array<{
    transition: "new";
    currentFindingId: string;
  } | {
    transition: "changed" | "still-supported";
    currentFindingId: string;
    previousFindingId: string;
  } | {
    transition: "resolved";
    previousFindingId: string;
  } | {
    transition: "no-material-change";
  }>;
};

export type AdditionalAiInsightsMethodExecution = {
  methodSetId: string;
  methodSetRevision: string;
  methodSetFingerprint: string;
  loadedMethods: InsightMethodRevisionRef[];
};

export type AdditionalAiInsightsPublication = {
  policyId: "energyiq-additional-ai-insights";
  policyRevision: string;
  discoveredCount: number;
  acceptedCount: number;
  rejectedCount: number;
  publishedCount: number;
  suppressedCandidateIds: string[];
};

type AdditionalAiInsightsArtifactBase = {
  artifactKind: "autonomous-insights";
  providerProfileId: string;
  runId: string;
  contract: {
    id: "energyiq-additional-ai-insights";
    revision: string;
  };
  binding: AdditionalAiInsightsBinding;
  methodExecution: AdditionalAiInsightsMethodExecution;
  capability: {
    revision: string;
    mode: "scoped-read-only";
    allowedTools: string[];
    usedTools: string[];
  };
  toolAudits: AdditionalAiInsightToolAudit[];
  publication: AdditionalAiInsightsPublication;
  snapshotComparison?: AdditionalAiInsightsSnapshotComparison;
};

export type AdditionalAiInsightsArtifact = AdditionalAiInsightsArtifactBase & ({
  status: "available";
  findings: AdditionalAiInsightFinding[];
} | {
  status: "empty";
  findings: [];
});

export type AdditionalAiInsightsArtifactExpectation = AdditionalAiInsightsBinding & {
  methodSetId: string;
  methodSetRevision: string;
  methodSetFingerprint: string;
  outputContractRevision: string;
  capabilityRevision: string;
  publicationRevision: string;
};

export type AdditionalAiInsightsArtifactValidationInput = {
  value: unknown;
  expected: AdditionalAiInsightsArtifactExpectation;
  expectedMethods: readonly unknown[];
};

export const canonicalInsightMethodSetJson = (
  methods: readonly unknown[],
): string | null => {
  if (!methodListIsValid(methods) || !validMethodSet(methods)) return null;
  return JSON.stringify([...methods]
    .sort((left, right) => methodSortKey(left).localeCompare(methodSortKey(right)))
    .map((method) => ({
      skillId: method.skillId,
      semanticVersion: method.semanticVersion,
      resourceId: method.resourceId,
      resourceRevision: method.resourceRevision,
      contentSha256: method.contentSha256,
      scope: method.scope,
      workspaceId: method.workspaceId,
      userId: method.userId,
      role: method.role,
    })));
};

export const additionalAiInsightMethodSetIsValidForSharedOverview = (
  methods: readonly InsightMethodRevisionRef[],
  workspaceId: string,
): boolean => {
  if (!nonEmptyString(workspaceId) || canonicalInsightMethodSetJson(methods) === null) return false;
  const coreMethods = methods.filter(({ role }) => role === "core-method");
  if (coreMethods.length !== 1 || coreMethods[0]!.scope !== "builtin") return false;
  return methods.every((method) => method.scope === "builtin"
    || (method.scope === "workspace" && method.workspaceId === workspaceId));
};

export const additionalAiInsightsArtifactIsValid = (
  input: AdditionalAiInsightsArtifactValidationInput,
): input is AdditionalAiInsightsArtifactValidationInput & { value: AdditionalAiInsightsArtifact } => {
  const { value, expected, expectedMethods } = input;
  if (!isRecord(value)) return false;
  if (!methodListIsValid(expectedMethods)) return false;
  const methodExecution = value.methodExecution;
  const findings = value.findings;
  const toolAudits = value.toolAudits;
  if (!hasOnlyKeys(value, [
    "artifactKind",
    "status",
    "providerProfileId",
    "runId",
    "contract",
    "binding",
    "methodExecution",
    "capability",
    "toolAudits",
    "findings",
    "publication",
    "snapshotComparison",
  ])
    || !additionalAiInsightMethodSetIsValidForSharedOverview(expectedMethods, expected.workspaceId)
    || value.artifactKind !== "autonomous-insights"
    || (value.status !== "available" && value.status !== "empty")
    || value.providerProfileId !== expected.modelProfileId
    || !nonEmptyString(value.runId)
    || !isRecord(value.contract)
    || !hasOnlyKeys(value.contract, ["id", "revision"])
    || value.contract.id !== "energyiq-additional-ai-insights"
    || value.contract.revision !== expected.outputContractRevision
    || !bindingMatches(value.binding, expected)
    || !methodExecutionMatches(methodExecution, expected, expectedMethods)
    || !capabilityMatches(value.capability, expected)
    || !Array.isArray(toolAudits)
    || !toolAuditsAreValid(toolAudits, value.capability)
    || !Array.isArray(findings)
    || findings.length > 3
    || !findings.every((finding) => validFinding(
      finding,
      expectedMethods,
      methodExecution.loadedMethods,
      toolAudits,
    ))
    || !uniqueStrings(findings.map((finding) => isRecord(finding) ? finding.id : undefined))
    || !snapshotComparisonIsValid(value.snapshotComparison, expected, findings)
    || !publicationMatches(value.publication, expected, findings.length)) return false;

  if (value.status === "empty") return findings.length === 0;
  return findings.length > 0;
};

const validMethodSet = (methods: readonly InsightMethodRevisionRef[]): boolean => {
  if (methods.length === 0 || !methods.every(insightMethodRevisionRefIsValid)) return false;
  const canonical = methods.map(methodSortKey);
  return new Set(canonical).size === canonical.length
    && methods.filter(({ role }) => role === "core-method").length === 1;
};

const methodListIsValid = (
  methods: readonly unknown[],
): methods is readonly InsightMethodRevisionRef[] => methods.every((method) => isRecord(method)
  && hasOnlyKeys(method, [
    "skillId",
    "semanticVersion",
    "resourceId",
    "resourceRevision",
    "contentSha256",
    "scope",
    "workspaceId",
    "userId",
    "role",
  ])
  && insightMethodRevisionRefIsValid(method));

const methodSortKey = (method: InsightMethodRevisionRef): string => [
  method.role,
  method.scope,
  method.workspaceId,
  method.userId,
  method.skillId,
  method.semanticVersion,
  method.resourceId,
  String(method.resourceRevision),
  method.contentSha256,
].join("\u0000");

const sameMethodSet = (
  left: readonly InsightMethodRevisionRef[],
  right: readonly InsightMethodRevisionRef[],
): boolean => {
  const leftCanonical = canonicalInsightMethodSetJson(left);
  return leftCanonical !== null && leftCanonical === canonicalInsightMethodSetJson(right);
};

const bindingMatches = (
  value: unknown,
  expected: AdditionalAiInsightsArtifactExpectation,
): boolean => isRecord(value)
  && hasOnlyKeys(value, [
    "workspaceId",
    "projectId",
    "scopeId",
    "dataSnapshotId",
    "projectReleaseId",
    "analysisPeriod",
    "modelProfileId",
    "modelProfileRevision",
  ])
  && value.workspaceId === expected.workspaceId
  && value.projectId === expected.projectId
  && value.scopeId === expected.scopeId
  && value.dataSnapshotId === expected.dataSnapshotId
  && value.projectReleaseId === expected.projectReleaseId
  && value.modelProfileId === expected.modelProfileId
  && value.modelProfileRevision === expected.modelProfileRevision
  && isRecord(value.analysisPeriod)
  && hasOnlyKeys(value.analysisPeriod, ["from", "to"])
  && value.analysisPeriod.from === expected.analysisPeriod.from
  && value.analysisPeriod.to === expected.analysisPeriod.to;

const methodExecutionMatches = (
  value: unknown,
  expected: AdditionalAiInsightsArtifactExpectation,
  expectedMethods: readonly InsightMethodRevisionRef[],
): value is AdditionalAiInsightsMethodExecution => isRecord(value)
  && hasOnlyKeys(value, ["methodSetId", "methodSetRevision", "methodSetFingerprint", "loadedMethods"])
  && value.methodSetId === expected.methodSetId
  && value.methodSetRevision === expected.methodSetRevision
  && value.methodSetFingerprint === expected.methodSetFingerprint
  && Array.isArray(value.loadedMethods)
  && sameMethodSet(value.loadedMethods, expectedMethods);

const capabilityMatches = (
  value: unknown,
  expected: AdditionalAiInsightsArtifactExpectation,
): boolean => {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["revision", "mode", "allowedTools", "usedTools"])
    || value.revision !== expected.capabilityRevision
    || value.mode !== "scoped-read-only"
    || !Array.isArray(value.allowedTools)
    || !Array.isArray(value.usedTools)
    || !uniqueStrings(value.allowedTools)
    || !uniqueStrings(value.usedTools)) return false;
  const allowed = new Set(value.allowedTools);
  return sameStrings(value.allowedTools, ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1)
    && value.usedTools.every((tool) => allowed.has(tool));
};

const validFinding = (
  value: unknown,
  approvedMethods: readonly InsightMethodRevisionRef[],
  loadedMethods: readonly InsightMethodRevisionRef[],
  toolAudits: readonly unknown[],
): boolean => isRecord(value)
  && hasOnlyKeys(value, [
    "id",
    "title",
    "text",
    "epistemicStatus",
    "origin",
    "evidenceRefs",
    "toolAuditIds",
    "deepDiveQuestion",
    "alert",
    "canvas",
  ])
  && nonEmptyString(value.id)
  && nonEmptyString(value.title)
  && nonEmptyString(value.text)
  && (value.epistemicStatus === "observed"
    || value.epistemicStatus === "inferred"
    || value.epistemicStatus === "speculative")
  && Array.isArray(value.evidenceRefs)
  && value.evidenceRefs.length > 0
  && uniqueStrings(value.evidenceRefs)
  && Array.isArray(value.toolAuditIds)
  && uniqueStrings(value.toolAuditIds)
  && value.toolAuditIds.every((auditId) => toolAudits.some((audit) => isRecord(audit) && audit.auditId === auditId))
  && optionalString(value.deepDiveQuestion)
  && alertIsValid(value.alert, value.evidenceRefs)
  && canvasIsValid(value.canvas)
  && originHasKnownShape(value.origin)
  && autonomousInsightOriginIsValid({
    origin: value.origin,
    approvedMethods,
    loadedMethods,
  });

const publicationMatches = (
  value: unknown,
  expected: AdditionalAiInsightsArtifactExpectation,
  findingCount: number,
): boolean => isRecord(value)
  && hasOnlyKeys(value, [
    "policyId",
    "policyRevision",
    "discoveredCount",
    "acceptedCount",
    "rejectedCount",
    "publishedCount",
    "suppressedCandidateIds",
  ])
  && value.policyId === "energyiq-additional-ai-insights"
  && value.policyRevision === expected.publicationRevision
  && nonNegativeInteger(value.discoveredCount)
  && nonNegativeInteger(value.acceptedCount)
  && nonNegativeInteger(value.rejectedCount)
  && nonNegativeInteger(value.publishedCount)
  && value.publishedCount === findingCount
  && (value.acceptedCount as number) >= findingCount
  && (value.discoveredCount as number) === (value.acceptedCount as number) + (value.rejectedCount as number)
  && Array.isArray(value.suppressedCandidateIds)
  && uniqueStrings(value.suppressedCandidateIds)
  && value.suppressedCandidateIds.length === (value.acceptedCount as number) - findingCount;

const toolAuditsAreValid = (
  value: readonly unknown[],
  capability: unknown,
): boolean => {
  if (!isRecord(capability) || !Array.isArray(capability.allowedTools) || !Array.isArray(capability.usedTools)) {
    return false;
  }
  const allowedTools = capability.allowedTools;
  const usedTools = capability.usedTools;
  if (!uniqueStrings(allowedTools) || !uniqueStrings(usedTools)) return false;
  const audits = value.filter(isRecord);
  return audits.length === value.length
    && audits.every((audit) => hasOnlyKeys(audit, [
      "auditId",
      "toolCallId",
      "toolName",
      "evidenceRefs",
    ])
      && nonEmptyString(audit.auditId)
      && nonEmptyString(audit.toolCallId)
      && nonEmptyString(audit.toolName)
      && allowedTools.includes(audit.toolName)
      && Array.isArray(audit.evidenceRefs)
      && audit.evidenceRefs.length > 0
      && uniqueStrings(audit.evidenceRefs))
    && uniqueStrings(audits.map(({ auditId }) => auditId))
    && uniqueStrings(audits.map(({ toolCallId }) => toolCallId))
    && sameStrings(
      [...new Set(audits.map(({ toolName }) => toolName))],
      usedTools,
    );
};

const alertIsValid = (value: unknown, findingEvidenceRefs: readonly string[]): boolean => value === undefined
  || (isRecord(value)
    && hasOnlyKeys(value, ["severity", "certainty", "evidenceRefs"])
    && (value.severity === "attention" || value.severity === "urgent")
    && (value.certainty === "confirmed" || value.certainty === "anomaly" || value.certainty === "possible")
    && Array.isArray(value.evidenceRefs)
    && value.evidenceRefs.length > 0
    && uniqueStrings(value.evidenceRefs)
    && value.evidenceRefs.every((evidenceRef) => findingEvidenceRefs.includes(evidenceRef)));

const canvasIsValid = (value: unknown): boolean => value === undefined
  || (isRecord(value)
    && hasOnlyKeys(value, ["contractRevision", "planId", "acceptedBlockIds"])
    && value.contractRevision === "energyiq-insight-canvas-v1"
    && nonEmptyString(value.planId)
    && Array.isArray(value.acceptedBlockIds)
    && value.acceptedBlockIds.length > 0
    && uniqueStrings(value.acceptedBlockIds));

const originHasKnownShape = (value: unknown): boolean => {
  if (!isRecord(value)
    || !isRecord(value.coreMethod)
    || !methodListIsValid([value.coreMethod])
    || !Array.isArray(value.directionMethods)
    || !methodListIsValid(value.directionMethods)) return false;
  if (value.kind === "ai-discovery" || value.kind === "expert-sop") {
    return hasOnlyKeys(value, ["kind", "coreMethod", "directionMethods"]);
  }
  return value.kind === "hybrid"
    && hasOnlyKeys(value, ["kind", "coreMethod", "directionMethods", "novelContribution"]);
};

const snapshotComparisonIsValid = (
  value: unknown,
  expected: AdditionalAiInsightsArtifactExpectation,
  findings: readonly unknown[],
): boolean => {
  if (value === undefined) return true;
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["previousArtifactId", "previousDataSnapshotId", "outcomes"])
    || !nonEmptyString(value.previousArtifactId)
    || !nonEmptyString(value.previousDataSnapshotId)
    || value.previousDataSnapshotId === expected.dataSnapshotId
    || !Array.isArray(value.outcomes)
    || value.outcomes.length === 0) return false;
  const findingIds = new Set(findings.filter(isRecord).map(({ id }) => id).filter(nonEmptyString));
  const canonicalOutcomes: string[] = [];
  for (const outcome of value.outcomes) {
    if (!isRecord(outcome) || !nonEmptyString(outcome.transition)) return false;
    if (outcome.transition === "new") {
      if (!hasOnlyKeys(outcome, ["transition", "currentFindingId"])
        || !nonEmptyString(outcome.currentFindingId)
        || !findingIds.has(outcome.currentFindingId)) return false;
    } else if (outcome.transition === "changed" || outcome.transition === "still-supported") {
      if (!hasOnlyKeys(outcome, ["transition", "currentFindingId", "previousFindingId"])
        || !nonEmptyString(outcome.currentFindingId)
        || !findingIds.has(outcome.currentFindingId)
        || !nonEmptyString(outcome.previousFindingId)) return false;
    } else if (outcome.transition === "resolved") {
      if (!hasOnlyKeys(outcome, ["transition", "previousFindingId"])
        || !nonEmptyString(outcome.previousFindingId)) return false;
    } else if (outcome.transition === "no-material-change") {
      if (!hasOnlyKeys(outcome, ["transition"]) || findings.length !== 0 || value.outcomes.length !== 1) return false;
    } else {
      return false;
    }
    canonicalOutcomes.push(JSON.stringify(outcome));
  }
  return new Set(canonicalOutcomes).size === canonicalOutcomes.length;
};

const sameStrings = (left: readonly unknown[], right: readonly string[]): boolean =>
  left.length === right.length && right.every((entry) => left.includes(entry));

const uniqueStrings = (values: readonly unknown[]): values is string[] =>
  values.every(nonEmptyString) && new Set(values).size === values.length;

const optionalString = (value: unknown): boolean => value === undefined || nonEmptyString(value);

const nonNegativeInteger = (value: unknown): boolean =>
  Number.isSafeInteger(value) && (value as number) >= 0;

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && /\S/u.test(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean => {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
};
