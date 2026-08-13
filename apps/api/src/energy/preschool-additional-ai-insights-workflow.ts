import type { AnalysisContextEvidenceCatalog } from "@datafoundry/agent-runtime";
import {
  ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1,
  additionalAiInsightsArtifactIsValid,
  ENERGYIQ_OPEN_DISCOVERY_METHOD_CONTENT_V1,
  resolveCurrentAdditionalAiInsightMethodSet,
  type AdditionalAiInsightFinding,
  type AdditionalAiInsightsArtifact,
} from "@datafoundry/contracts";
import type {
  EnergyIqOverviewAiArtifactRecord,
  MetadataStore,
  UserRecord,
} from "@datafoundry/metadata";
import { WORKSPACE_DEFAULT_MODEL_PROFILE_ID } from "@datafoundry/metadata";
import { createHash, randomUUID } from "node:crypto";

import {
  createPreschoolAdditionalAiInsightArtifactIdentity,
  type OverviewAiArtifactIdentityV13,
  type PreschoolAdditionalAiInsightArtifactIdentity,
} from "./overview-ai-artifact.js";
import {
  createPreschoolAdditionalAiInsightRuntime,
  type PreschoolAdditionalAiInsightToolInvocation,
  type PreschoolAdditionalAiInsightToolName,
  type PreschoolAdditionalAiInsightToolResult,
} from "./preschool-additional-ai-insight-runtime.js";
import { ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID } from "../workspace-model-profile-resolver.js";

const LEASE_MS = 13 * 60 * 1_000;
const MAX_DISCOVERY_ANSWER_CHARS = 160_000;
const MAX_CANDIDATE_TITLE_CHARS = 240;
const MAX_CANDIDATE_TEXT_CHARS = 1_200;
export const MAX_PRESCHOOL_ADDITIONAL_DISCOVERY_PROMPT_CHARS = 160_000;

export type PreschoolAdditionalAiInsightsDiscoveryRunner = (input: {
  prompt: string;
  runId: string;
  sessionId: string;
  user: UserRecord;
  workspaceId: string;
  identity: PreschoolAdditionalAiInsightArtifactIdentity;
  toolNames: readonly PreschoolAdditionalAiInsightToolName[];
  invokeTool(input: PreschoolAdditionalAiInsightToolInvocation): Promise<PreschoolAdditionalAiInsightToolResult>;
}) => Promise<{ answer: string; runId: string; sessionId: string }>;

export type PreschoolAdditionalAiInsightsWorkflow = {
  execute(input: {
    baseIdentity: OverviewAiArtifactIdentityV13;
    user: UserRecord;
  }): Promise<EnergyIqOverviewAiArtifactRecord>;
};

export const createPreschoolAdditionalAiInsightsWorkflow = (input: {
  metadataStore: MetadataStore;
  resolveEvidenceCatalog(args: {
    identity: PreschoolAdditionalAiInsightArtifactIdentity;
    user: UserRecord;
  }): Promise<AnalysisContextEvidenceCatalog>;
  runDiscovery: PreschoolAdditionalAiInsightsDiscoveryRunner;
}): PreschoolAdditionalAiInsightsWorkflow => ({
  async execute({ baseIdentity, user }) {
    const identity = createPreschoolAdditionalAiInsightArtifactIdentity({ baseIdentity });
    requireModelRuntimeIdentity(input.metadataStore, identity);
    const queued = input.metadataStore.energyIq.overviewAiArtifacts.queue({
      identity,
      triggeredBy: user.id,
    });
    if (queued.status === "available" || queued.status === "running") return queued;
    const workerId = `preschool-additional-ai-insights:${randomUUID()}`;
    const claim = input.metadataStore.energyIq.overviewAiArtifacts.claim({ identity, workerId, leaseMs: LEASE_MS });
    if (!claim.claimed) return claim.artifact;

    const runId = `preschool-additional-ai-insights-${randomUUID()}`;
    const sessionId = `preschool-additional-ai-insights-${randomUUID()}`;
    try {
      requireModelRuntimeIdentity(input.metadataStore, identity);
      const methodSet = requireMethodResources(identity.workspaceId);
      const catalog = await input.resolveEvidenceCatalog({ identity, user });
      const runtime = createPreschoolAdditionalAiInsightRuntime({
        binding: {
          workspaceId: identity.workspaceId,
          projectId: identity.projectId,
          scopeId: identity.scopeId,
          dataSnapshotId: identity.dataSnapshotId,
          projectReleaseId: identity.projectReleaseId,
        },
        catalog,
      });
      const completed = await input.runDiscovery({
        prompt: buildDiscoveryPrompt({ identity, catalog, methodContent: methodSet.resources[0]!.content }),
        runId,
        sessionId,
        user,
        workspaceId: identity.workspaceId,
        identity,
        toolNames: runtime.toolNames,
        invokeTool: runtime.invoke,
      });
      if (completed.runId !== runId || completed.sessionId !== sessionId) {
        throw new Error("PRESCHOOL_ADDITIONAL_AI_RUNTIME_IDENTITY_MISMATCH");
      }
      const candidates = parseDiscoveryCandidates(completed.answer);
      if (!candidates) throw new Error("PRESCHOOL_ADDITIONAL_AI_DISCOVERY_RESULT_INVALID");
      const artifact = publishAdditionalArtifact({
        identity,
        methodSet,
        catalog,
        candidates,
        toolAudits: runtime.audits(),
        runId,
      });
      const validation = {
        value: artifact,
        expectedMethods: methodSet.methods,
        expected: {
          workspaceId: identity.workspaceId,
          projectId: identity.projectId,
          scopeId: identity.scopeId,
          dataSnapshotId: identity.dataSnapshotId,
          projectReleaseId: identity.projectReleaseId,
          analysisPeriod: {
            from: identity.analysisPeriodFrom,
            to: identity.analysisPeriodTo,
          },
          modelProfileId: identity.modelProfileId,
          modelProfileRevision: identity.modelProfileRevision,
          methodSetId: identity.methodSetId,
          methodSetRevision: identity.methodSetRevision,
          methodSetFingerprint: identity.methodSetFingerprint,
          outputContractRevision: identity.outputContractRevision,
          capabilityRevision: identity.capabilityRevision,
          publicationRevision: identity.publicationRevision,
        },
      };
      if (!additionalAiInsightsArtifactIsValid(validation)) {
        throw new Error("PRESCHOOL_ADDITIONAL_AI_PUBLICATION_INVALID");
      }
      requireModelRuntimeIdentity(input.metadataStore, identity);
      return input.metadataStore.energyIq.overviewAiArtifacts.complete({
        identity,
        workerId,
        sessionId,
        runId,
        resultJson: JSON.stringify(artifact),
      });
    } catch (error) {
      return input.metadataStore.energyIq.overviewAiArtifacts.fail({
        identity,
        workerId,
        errorCode: boundedErrorCode(error),
      });
    }
  },
});

const requireModelRuntimeIdentity = (
  metadataStore: MetadataStore,
  identity: PreschoolAdditionalAiInsightArtifactIdentity,
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

type DiscoveryCandidate = {
  sourceId: string;
  value: unknown;
};

type AcceptedCandidate = {
  sourceId: string;
  finding: AdditionalAiInsightFinding;
};

const parseDiscoveryCandidates = (answer: string): DiscoveryCandidate[] | null => {
  if (typeof answer !== "string" || answer.length > MAX_DISCOVERY_ANSWER_CHARS) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(answer);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !hasExactKeys(parsed, ["candidates"]) || !Array.isArray(parsed.candidates)) return null;
  const seen = new Set<string>();
  return parsed.candidates.map((value, index) => {
    const proposed = isRecord(value) && nonEmptyString(value.id) ? value.id.trim() : `candidate-${index + 1}`;
    const sourceId = seen.has(proposed) ? `${proposed}#${index + 1}` : proposed;
    seen.add(proposed);
    return { sourceId, value };
  });
};

const publishAdditionalArtifact = (input: {
  identity: PreschoolAdditionalAiInsightArtifactIdentity;
  methodSet: ReturnType<typeof resolveCurrentAdditionalAiInsightMethodSet>;
  catalog: AnalysisContextEvidenceCatalog;
  candidates: DiscoveryCandidate[];
  toolAudits: ReturnType<ReturnType<typeof createPreschoolAdditionalAiInsightRuntime>["audits"]>;
  runId: string;
}): AdditionalAiInsightsArtifact => {
  const factsById = new Map(input.catalog.facts.map((fact) => [fact.id, fact]));
  const auditsById = new Map(input.toolAudits.map((audit) => [audit.auditId, audit]));
  const coreMethod = input.methodSet.methods.find(({ role }) => role === "core-method")!;
  const accepted: AcceptedCandidate[] = [];
  const rejectedCandidateIds: string[] = [];
  for (const candidate of input.candidates) {
    const finding = acceptCandidate(candidate, factsById, auditsById, coreMethod);
    if (finding) accepted.push({ sourceId: candidate.sourceId, finding });
    else rejectedCandidateIds.push(candidate.sourceId);
  }
  const published = accepted.slice(0, 3);
  const suppressed = accepted.slice(3);
  const findings = published.map(({ finding }) => finding);
  const usedFactIds = new Set([
    ...findings.flatMap(({ evidenceRefs }) => evidenceRefs),
    ...input.toolAudits.flatMap(({ evidenceRefs }) => evidenceRefs),
  ]);
  const evidenceFacts = input.catalog.facts
    .filter(({ id }) => usedFactIds.has(id))
    .map(({ id, status, evidenceRefs }) => ({ id, status, evidenceRefs: [...evidenceRefs] }));
  const usedTools = [...new Set(input.toolAudits.map(({ toolName }) => toolName) as PreschoolAdditionalAiInsightToolName[])];
  const artifactBase = {
    artifactKind: "autonomous-insights" as const,
    providerProfileId: input.identity.modelProfileId,
    runId: input.runId,
    contract: {
      id: "energyiq-additional-ai-insights" as const,
      revision: input.identity.outputContractRevision,
    },
    binding: {
      workspaceId: input.identity.workspaceId,
      projectId: input.identity.projectId,
      scopeId: input.identity.scopeId,
      dataSnapshotId: input.identity.dataSnapshotId,
      projectReleaseId: input.identity.projectReleaseId,
      analysisPeriod: {
        from: input.identity.analysisPeriodFrom,
        to: input.identity.analysisPeriodTo,
      },
      modelProfileId: input.identity.modelProfileId,
      modelProfileRevision: input.identity.modelProfileRevision,
    },
    methodExecution: {
      methodSetId: input.identity.methodSetId,
      methodSetRevision: input.identity.methodSetRevision,
      methodSetFingerprint: input.identity.methodSetFingerprint,
      loadedMethods: [...input.methodSet.methods],
    },
    capability: {
      revision: input.identity.capabilityRevision,
      mode: "scoped-read-only" as const,
      allowedTools: [...ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1],
      usedTools,
    },
    toolAudits: input.toolAudits,
    evidenceLineage: {
      catalogContract: input.catalog.contract,
      sourceId: input.catalog.sourceId,
      pins: { ...input.catalog.pins },
      facts: evidenceFacts,
    },
    findings,
    publication: {
      policyId: "energyiq-additional-ai-insights" as const,
      policyRevision: input.identity.publicationRevision,
      discoveredCount: input.candidates.length,
      acceptedCount: accepted.length,
      rejectedCount: rejectedCandidateIds.length,
      publishedCount: published.length,
      sourceOrderCandidateIds: input.candidates.map(({ sourceId }) => sourceId),
      acceptedCandidateIds: accepted.map(({ sourceId }) => sourceId),
      rejectedCandidateIds,
      publishedCandidateIds: published.map(({ sourceId }) => sourceId),
      suppressedCandidateIds: suppressed.map(({ sourceId }) => sourceId),
    },
  };
  return findings.length === 0
    ? { ...artifactBase, status: "empty", findings: [] }
    : { ...artifactBase, status: "available", findings };
};

const acceptCandidate = (
  candidate: DiscoveryCandidate,
  factsById: Map<string, AnalysisContextEvidenceCatalog["facts"][number]>,
  auditsById: Map<string, ReturnType<ReturnType<typeof createPreschoolAdditionalAiInsightRuntime>["audits"]>[number]>,
  coreMethod: ReturnType<typeof resolveCurrentAdditionalAiInsightMethodSet>["methods"][number],
): AdditionalAiInsightFinding | null => {
  const value = candidate.value;
  if (!isRecord(value)
    || !hasOnlyKeys(value, [
      "id", "title", "text", "epistemicStatus", "evidenceRefs", "toolAuditIds", "deepDiveQuestion", "alert",
    ])
    || value.id !== candidate.sourceId
    || !boundedSafeText(value.title, MAX_CANDIDATE_TITLE_CHARS)
    || !boundedSafeText(value.text, MAX_CANDIDATE_TEXT_CHARS)
    || (value.epistemicStatus !== "observed" && value.epistemicStatus !== "inferred" && value.epistemicStatus !== "speculative")
    || !Array.isArray(value.evidenceRefs)
    || value.evidenceRefs.length === 0
    || !uniqueStrings(value.evidenceRefs)
    || value.evidenceRefs.some((id) => !factsById.has(id))
    || !Array.isArray(value.toolAuditIds)
    || !uniqueStrings(value.toolAuditIds)
    || optionalBoundedSafeText(value.deepDiveQuestion, MAX_CANDIDATE_TEXT_CHARS) === false) return null;
  const evidenceRefs = value.evidenceRefs;
  const toolAuditIds = value.toolAuditIds;
  const audits = toolAuditIds.map((id) => auditsById.get(id));
  if (audits.some((audit) => !audit || audit.status !== "succeeded")
    || audits.some((audit) => audit!.evidenceRefs.some((ref) => !evidenceRefs.includes(ref)))) return null;
  if (!alertIsAcceptable(value.alert, value.epistemicStatus, evidenceRefs, factsById)) return null;
  return {
    id: `additional:${candidate.sourceId}`,
    title: value.title.trim(),
    text: value.text.trim(),
    epistemicStatus: value.epistemicStatus,
    origin: {
      kind: "ai-discovery",
      coreMethod,
      directionMethods: [],
    },
    evidenceRefs: [...evidenceRefs],
    toolAuditIds: [...toolAuditIds],
    ...(nonEmptyString(value.deepDiveQuestion) ? { deepDiveQuestion: value.deepDiveQuestion.trim() } : {}),
    ...(isRecord(value.alert)
      ? {
          alert: {
            severity: value.alert.severity as "attention" | "urgent",
            certainty: value.alert.certainty as "confirmed" | "anomaly" | "possible",
            evidenceRefs: [...value.alert.evidenceRefs as string[]],
          },
        }
      : {}),
  };
};

const alertIsAcceptable = (
  value: unknown,
  epistemicStatus: "observed" | "inferred" | "speculative",
  evidenceRefs: string[],
  factsById: Map<string, AnalysisContextEvidenceCatalog["facts"][number]>,
): boolean => {
  if (value === undefined) return true;
  if (!isRecord(value)
    || !hasExactKeys(value, ["severity", "certainty", "evidenceRefs"])
    || (value.severity !== "attention" && value.severity !== "urgent")
    || (value.certainty !== "confirmed" && value.certainty !== "anomaly" && value.certainty !== "possible")
    || !Array.isArray(value.evidenceRefs)
    || value.evidenceRefs.length === 0
    || !uniqueStrings(value.evidenceRefs)
    || value.evidenceRefs.some((ref) => !evidenceRefs.includes(ref))) return false;
  const facts = value.evidenceRefs.map((ref) => factsById.get(ref)!);
  const allConfirmed = facts.every(({ status }) => status === "confirmed");
  if (value.severity === "urgent" && (epistemicStatus !== "observed" || value.certainty !== "confirmed" || !allConfirmed)) {
    return false;
  }
  if (value.certainty === "confirmed" && (epistemicStatus !== "observed" || !allConfirmed)) return false;
  return value.certainty !== "anomaly" || epistemicStatus !== "speculative";
};

const buildDiscoveryPrompt = (input: {
  identity: PreschoolAdditionalAiInsightArtifactIdentity;
  catalog: AnalysisContextEvidenceCatalog;
  methodContent: string;
}): string => {
  const prompt = [
    "You are the Additional AI Insights discovery stage for EnergyIQ Preschool.",
    input.methodContent,
    "Return JSON only: {candidates:[{id,title,text,epistemicStatus:'observed|inferred|speculative',evidenceRefs:[exact fact id],toolAuditIds:[actual returned audit id],deepDiveQuestion?,alert?}]}.",
    "Candidates must already be ordered from highest to lowest incremental value. Zero candidates is valid.",
    `Server-owned identity: ${JSON.stringify({
      workspaceId: input.identity.workspaceId,
      projectId: input.identity.projectId,
      scopeId: input.identity.scopeId,
      dataSnapshotId: input.identity.dataSnapshotId,
      projectReleaseId: input.identity.projectReleaseId,
      analysisPeriod: { from: input.identity.analysisPeriodFrom, to: input.identity.analysisPeriodTo },
      modelProfileId: input.identity.modelProfileId,
      modelProfileRevision: input.identity.modelProfileRevision,
    })}`,
    `Current authoritative Evidence Catalog: ${JSON.stringify({
      contract: input.catalog.contract,
      sourceId: input.catalog.sourceId,
      pins: input.catalog.pins,
      facts: input.catalog.facts.map(({ evidenceRefs: _sourceRefs, ...fact }) => fact),
    })}`,
  ].join("\n\n");
  if (prompt.length > MAX_PRESCHOOL_ADDITIONAL_DISCOVERY_PROMPT_CHARS) {
    throw new Error(`PRESCHOOL_ADDITIONAL_AI_DISCOVERY_PROMPT_TOO_LARGE:${prompt.length}`);
  }
  return prompt;
};

const requireMethodResources = (workspaceId: string) => {
  const methodSet = resolveCurrentAdditionalAiInsightMethodSet(workspaceId);
  if (methodSet.resources.length !== methodSet.methods.length
    || methodSet.resources.some(({ method, content }) => (
      !methodSet.methods.some((candidate) => candidate === method)
      || !nonEmptyString(content)
      || createHash("sha256").update(content).digest("hex") !== method.contentSha256
    ))
    || methodSet.resources[0]?.content !== ENERGYIQ_OPEN_DISCOVERY_METHOD_CONTENT_V1) {
    throw new Error("PRESCHOOL_ADDITIONAL_AI_METHOD_RESOURCE_INVALID");
  }
  return methodSet;
};

const boundedErrorCode = (error: unknown): string => {
  const value = error instanceof Error ? error.message : "PRESCHOOL_ADDITIONAL_AI_FAILED";
  return /^[A-Z0-9_:.-]{1,160}$/u.test(value) ? value : "PRESCHOOL_ADDITIONAL_AI_FAILED";
};

const boundedSafeText = (value: unknown, max: number): value is string => nonEmptyString(value)
  && value.length <= max
  && !/(?:<\/?[a-z]|https?:\/\/|javascript:)/iu.test(value);

const optionalBoundedSafeText = (value: unknown, max: number): boolean =>
  value === undefined || boundedSafeText(value, max);

const uniqueStrings = (values: readonly unknown[]): values is string[] =>
  values.every(nonEmptyString) && new Set(values).size === values.length;

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && /\S/u.test(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean => {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
};

const hasExactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean =>
  Object.keys(value).length === expected.length && expected.every((key) => key in value);
