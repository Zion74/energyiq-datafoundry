import type { AnalysisContextEvidenceCatalog } from "@datafoundry/agent-runtime";
import {
  ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1,
  acceptInsightCanvasPlan,
  additionalAiInsightsArtifactIsValid,
  energyAiNarrativeClaimsSupported,
  ENERGYIQ_OPEN_DISCOVERY_METHOD_CONTENT_V1,
  resolveAdditionalAiInsightMethodSet,
  resolveCurrentAdditionalAiInsightMethodSet,
  type AdditionalAiInsightMethodResource,
  type AdditionalAiInsightFinding,
  type AdditionalAiInsightsArtifact,
  type InsightCanvasEvidenceFact,
  type InsightCanvasRejection,
} from "@datafoundry/contracts";
import type {
  EnergyIqAdditionalInsightModelProfileSnapshot,
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
import { PRESCHOOL_ADDITIONAL_INSIGHT_TITLE_MAX_CHARS } from "./preschool-overview-ai-structured-output.js";

const LEASE_MS = 13 * 60 * 1_000;
const MAX_DISCOVERY_ANSWER_CHARS = 160_000;
const MAX_CANDIDATE_TEXT_CHARS = 1_200;
const MAX_NOVEL_CONTRIBUTION_CHARS = 800;
export const MAX_PRESCHOOL_ADDITIONAL_DISCOVERY_PROMPT_CHARS = 192_000;

export type PreschoolAdditionalAiInsightsDiscoveryRunner = (input: {
  prompt: string;
  runId: string;
  sessionId: string;
  user: UserRecord;
  workspaceId: string;
  identity: PreschoolAdditionalAiInsightArtifactIdentity;
  toolNames: readonly PreschoolAdditionalAiInsightToolName[];
  invokeTool(input: PreschoolAdditionalAiInsightToolInvocation): Promise<PreschoolAdditionalAiInsightToolResult>;
  modelProfileSnapshot?: EnergyIqAdditionalInsightModelProfileSnapshot;
}) => Promise<{ answer: string; runId: string; sessionId: string }>;

export type PreschoolAdditionalAiPresentedClaim = {
  id: string;
  source: "deterministic-overview" | "key-finding" | "section-summary" | "section-insight";
  sectionId?: string;
  artifactId?: string;
  text: string;
  sourceEvidenceRefs: string[];
};

export type PreschoolAdditionalAiPresentedClaims = {
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
  claims: PreschoolAdditionalAiPresentedClaim[];
};

export const createPreschoolAdditionalAiPresentedClaims = (input: {
  identity: PreschoolAdditionalAiInsightArtifactIdentity;
  catalog: AnalysisContextEvidenceCatalog;
  readModel: unknown;
}): PreschoolAdditionalAiPresentedClaims => {
  const binding = {
    workspaceId: input.identity.workspaceId,
    projectId: input.identity.projectId,
    scopeId: input.identity.scopeId,
    dataSnapshotId: input.identity.dataSnapshotId,
    projectReleaseId: input.identity.projectReleaseId,
    analysisPeriod: { from: input.identity.analysisPeriodFrom, to: input.identity.analysisPeriodTo },
    modelProfileId: input.identity.modelProfileId,
    modelProfileRevision: input.identity.modelProfileRevision,
  };
  const claims: PreschoolAdditionalAiPresentedClaim[] = input.catalog.facts.map((fact) => ({
    id: `deterministic-overview:${fact.id}`,
    source: "deterministic-overview",
    text: `${fact.label}: ${String(fact.value)}${fact.unit ? ` ${fact.unit}` : ""}`,
    sourceEvidenceRefs: [fact.id],
  }));
  if (input.readModel === null || input.readModel === undefined) return { binding, claims };
  if (!isRecord(input.readModel)
    || !readModelBindingMatches(input.readModel.binding, binding)
    || !isRecord(input.readModel.sections)) {
    throw new Error("PRESCHOOL_ADDITIONAL_AI_PRESENTED_READ_MODEL_INVALID");
  }
  for (const [sectionId, unit] of Object.entries(input.readModel.sections)) {
    if (!isAvailablePresentedSectionUnit(unit, sectionId, binding)) continue;
    pushPresentedClaim(claims, {
      id: `section:${sectionId}:summary`,
      source: "section-summary",
      sectionId,
      artifactId: unit.artifactId,
      value: unit.result.summary,
    });
    for (const insight of unit.result.insights) {
      if (!isRecord(insight) || !nonEmptyString(insight.id)) continue;
      pushPresentedClaim(claims, {
        id: `section:${sectionId}:insight:${insight.id}`,
        source: "section-insight",
        sectionId,
        artifactId: unit.artifactId,
        value: insight,
      });
    }
  }
  const executive = input.readModel.executive;
  if (isAvailablePresentedExecutiveUnit(executive, binding)) {
    pushPresentedClaim(claims, {
      id: "key-findings:summary",
      source: "key-finding",
      artifactId: executive.artifactId,
      value: executive.result.summary,
    });
    for (const finding of executive.result.findings) {
      if (!isRecord(finding) || !nonEmptyString(finding.id)) continue;
      pushPresentedClaim(claims, {
        id: `key-finding:${finding.id}`,
        source: "key-finding",
        artifactId: executive.artifactId,
        value: finding,
      });
    }
  }
  return { binding, claims };
};

const pushPresentedClaim = (
  target: PreschoolAdditionalAiPresentedClaim[],
  input: {
    id: string;
    source: PreschoolAdditionalAiPresentedClaim["source"];
    sectionId?: string;
    artifactId: string;
    value: unknown;
  },
): void => {
  if (!isPresentedClaimValue(input.value)) return;
  target.push({
    id: input.id,
    source: input.source,
    ...(input.sectionId ? { sectionId: input.sectionId } : {}),
    artifactId: input.artifactId,
    text: [nonEmptyString(input.value.title) ? input.value.title.trim() : "", input.value.text.trim()]
      .filter(Boolean).join(": "),
    sourceEvidenceRefs: [...input.value.evidenceRefs],
  });
};

const isAvailablePresentedSectionUnit = (
  value: unknown,
  sectionId: string,
  binding: PreschoolAdditionalAiPresentedClaims["binding"],
): value is {
  status: "available";
  artifactId: string;
  result: { summary: unknown; insights: unknown[] };
} => isRecord(value)
  && value.status === "available"
  && nonEmptyString(value.artifactId)
  && isRecord(value.result)
  && value.result.artifactKind === "section-interpretation"
  && value.result.status === "available"
  && value.result.sectionId === sectionId
  && readModelBindingMatches(value.result.binding, binding)
  && isPresentedClaimValue(value.result.summary)
  && Array.isArray(value.result.insights);

const isAvailablePresentedExecutiveUnit = (
  value: unknown,
  binding: PreschoolAdditionalAiPresentedClaims["binding"],
): value is {
  status: "available";
  artifactId: string;
  result: { summary: unknown; findings: unknown[] };
} => isRecord(value)
  && value.status === "available"
  && nonEmptyString(value.artifactId)
  && isRecord(value.result)
  && value.result.artifactKind === "executive-synthesis"
  && value.result.status === "available"
  && readModelBindingMatches(value.result.binding, binding)
  && isPresentedClaimValue(value.result.summary)
  && Array.isArray(value.result.findings);

const isPresentedClaimValue = (value: unknown): value is Record<string, unknown> & {
  text: string;
  evidenceRefs: string[];
} => isRecord(value)
  && nonEmptyString(value.text)
  && Array.isArray(value.evidenceRefs)
  && value.evidenceRefs.length > 0
  && uniqueStrings(value.evidenceRefs);

const readModelBindingMatches = (
  value: unknown,
  expected: PreschoolAdditionalAiPresentedClaims["binding"],
): boolean => isRecord(value)
  && value.workspaceId === expected.workspaceId
  && value.projectId === expected.projectId
  && value.scopeId === expected.scopeId
  && value.dataSnapshotId === expected.dataSnapshotId
  && value.projectReleaseId === expected.projectReleaseId
  && value.modelProfileId === expected.modelProfileId
  && value.modelProfileRevision === expected.modelProfileRevision
  && isRecord(value.analysisPeriod)
  && value.analysisPeriod.from === expected.analysisPeriod.from
  && value.analysisPeriod.to === expected.analysisPeriod.to;

export type PreschoolAdditionalAiInsightsWorkflow = {
  execute(input: {
    baseIdentity: OverviewAiArtifactIdentityV13;
    user: UserRecord;
  }): Promise<EnergyIqOverviewAiArtifactRecord>;
  evaluateAttempt(input: {
    identity: PreschoolAdditionalAiInsightArtifactIdentity;
    user: UserRecord;
    runId: string;
    sessionId: string;
    methodResources?: readonly AdditionalAiInsightMethodResource[];
    modelProfileSnapshot?: EnergyIqAdditionalInsightModelProfileSnapshot;
  }): Promise<AdditionalAiInsightsArtifact>;
};

export const createPreschoolAdditionalAiInsightsWorkflow = (input: {
  metadataStore: MetadataStore;
  resolveEvidenceCatalog(args: {
    identity: PreschoolAdditionalAiInsightArtifactIdentity;
    user: UserRecord;
  }): Promise<AnalysisContextEvidenceCatalog>;
  resolvePresentedClaims(args: {
    identity: PreschoolAdditionalAiInsightArtifactIdentity;
    catalog: AnalysisContextEvidenceCatalog;
    user: UserRecord;
  }): Promise<PreschoolAdditionalAiPresentedClaims>;
  runDiscovery: PreschoolAdditionalAiInsightsDiscoveryRunner;
}): PreschoolAdditionalAiInsightsWorkflow => {
  const evaluateAttempt: PreschoolAdditionalAiInsightsWorkflow["evaluateAttempt"] = async ({
    identity,
    user,
    runId,
    sessionId,
    methodResources,
    modelProfileSnapshot,
  }) => {
    const methodSet = requireMethodResources(methodResources
      ? resolveAdditionalAiInsightMethodSet({
        workspaceId: identity.workspaceId,
        methodSetId: identity.methodSetId,
        methodSetRevision: identity.methodSetRevision,
        workspaceMethodResources: methodResources.filter(({ method }) => method.scope === "workspace"),
      }) ?? (() => { throw new Error("PRESCHOOL_ADDITIONAL_AI_METHOD_RESOURCE_INVALID"); })()
      : resolveCurrentAdditionalAiInsightMethodSet(
        identity.workspaceId,
        input.metadataStore.energyIq.insightMethodGovernance.listPublishedWorkspaceMethodResources({
          workspaceId: identity.workspaceId,
        }),
      ));
    if (methodResources && JSON.stringify(methodSet.resources) !== JSON.stringify(methodResources)) {
      throw new Error("PRESCHOOL_ADDITIONAL_AI_METHOD_RESOURCE_INVALID");
    }
    if (identity.methodSetId !== methodSet.id
      || identity.methodSetRevision !== methodSet.revision
      || identity.methodSetFingerprint !== createPreschoolAdditionalAiInsightArtifactIdentity({
        baseIdentity: identity,
        methodSet,
      }).methodSetFingerprint) {
      throw new Error("PRESCHOOL_ADDITIONAL_AI_EVALUATION_IDENTITY_MISMATCH");
    }
    requireModelRuntimeIdentity(input.metadataStore, identity, modelProfileSnapshot);
    const catalog = await input.resolveEvidenceCatalog({ identity, user });
    const presentedClaims = requirePresentedClaims(
      await input.resolvePresentedClaims({ identity, catalog, user }),
      identity,
    );
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
      prompt: buildDiscoveryPrompt({ identity, catalog, presentedClaims, methodResources: methodSet.resources }),
      runId,
      sessionId,
      user,
      workspaceId: identity.workspaceId,
      identity,
      toolNames: runtime.toolNames,
      invokeTool: runtime.invoke,
      ...(modelProfileSnapshot ? { modelProfileSnapshot } : {}),
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
      presentedClaims,
      candidates,
      toolAudits: runtime.audits(),
      runId,
    });
    if (!additionalAiInsightsArtifactIsValid({
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
        canvasRevision: identity.canvasRevision,
      },
    })) {
      throw new Error("PRESCHOOL_ADDITIONAL_AI_PUBLICATION_INVALID");
    }
    requireModelRuntimeIdentity(input.metadataStore, identity, modelProfileSnapshot);
    return artifact;
  };

  return {
    evaluateAttempt,
    async execute({ baseIdentity, user }) {
    const methodSet = requireMethodResources(resolveCurrentAdditionalAiInsightMethodSet(
      baseIdentity.workspaceId,
      input.metadataStore.energyIq.insightMethodGovernance.listPublishedWorkspaceMethodResources({
        workspaceId: baseIdentity.workspaceId,
      }),
    ));
    const identity = createPreschoolAdditionalAiInsightArtifactIdentity({ baseIdentity, methodSet });
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
      const artifact = await evaluateAttempt({ identity, user, runId, sessionId });
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
  };
};

const requireModelRuntimeIdentity = (
  metadataStore: MetadataStore,
  identity: PreschoolAdditionalAiInsightArtifactIdentity,
  trustedSnapshot?: EnergyIqAdditionalInsightModelProfileSnapshot,
): void => {
  if (trustedSnapshot) {
    const profile = trustedSnapshot.profiles[0];
    if (trustedSnapshot.bindingRevision !== identity.modelProfileRevision
      || identity.modelProfileId !== WORKSPACE_DEFAULT_MODEL_PROFILE_ID
      || trustedSnapshot.profiles.length !== 1
      || profile?.exposedId !== WORKSPACE_DEFAULT_MODEL_PROFILE_ID
      || profile.resource.kind !== "model-profile"
      || profile.resource.status !== "connected"
      || !profile.resource.default_enabled) {
      throw new Error("OVERVIEW_AI_MODEL_PROFILE_REVISION_MISMATCH");
    }
    return;
  }
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
  presentedClaims: PreschoolAdditionalAiPresentedClaims;
  candidates: DiscoveryCandidate[];
  toolAudits: ReturnType<ReturnType<typeof createPreschoolAdditionalAiInsightRuntime>["audits"]>;
  runId: string;
}): AdditionalAiInsightsArtifact => {
  const factsById = new Map(input.catalog.facts.map((fact) => [fact.id, fact]));
  const auditsById = new Map(input.toolAudits.map((audit) => [audit.auditId, audit]));
  const coreMethod = input.methodSet.methods.find(({ role }) => role === "core-method")!;
  const directionMethods = input.methodSet.methods.filter(({ role }) => role === "expert-direction");
  const canvasEvidenceFacts = projectCanvasEvidenceFacts(input.identity, input.catalog);
  const knownCentreCodes = collectCatalogCentreCodes(input.catalog);
  const accepted: AcceptedCandidate[] = [];
  const rejectedCandidateIds: string[] = [];
  for (const candidate of input.candidates) {
    const normalizedCandidate = input.toolAudits.length === 0
      && isRecord(candidate.value)
      && candidate.value.toolAuditIds === undefined
      ? { ...candidate, value: { ...candidate.value, toolAuditIds: [] } }
      : candidate;
    const finding = acceptCandidate(
      normalizedCandidate,
      factsById,
      input.presentedClaims.claims,
      auditsById,
      coreMethod,
      directionMethods,
      input.identity,
      canvasEvidenceFacts,
      knownCentreCodes,
    );
    if (finding) accepted.push({ sourceId: candidate.sourceId, finding });
    else rejectedCandidateIds.push(candidate.sourceId);
  }
  const published = accepted.slice(0, 3);
  const suppressed = accepted.slice(3);
  const findings = published.map(({ finding }) => finding);
  const usedFactIds = new Set([
    ...findings.flatMap(({ evidenceRefs }) => evidenceRefs),
    ...findings.flatMap(({ canvas }) => canvas?.contractRevision === "energyiq-insight-canvas-v2"
      ? [
          ...canvas.acceptedBlocks.flatMap(({ bindings }) => bindings.map(({ evidenceRef }) => evidenceRef)),
          ...canvas.gaps.flatMap(({ evidenceRefs }) => evidenceRefs),
        ]
      : []),
    ...input.toolAudits.flatMap(({ evidenceRefs }) => evidenceRefs),
  ]);
  const evidenceFacts = input.catalog.facts
    .filter(({ id }) => usedFactIds.has(id))
    .map(({ id, label, metricId, value, unit, status, evidenceRefs, dimensions }) => ({
      id,
      label,
      metricId,
      value,
      ...(unit ? { unit } : {}),
      status,
      evidenceRefs: [...evidenceRefs],
      dimensions: { ...dimensions },
    }));
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
  presentedClaims: readonly PreschoolAdditionalAiPresentedClaim[],
  auditsById: Map<string, ReturnType<ReturnType<typeof createPreschoolAdditionalAiInsightRuntime>["audits"]>[number]>,
  coreMethod: ReturnType<typeof resolveCurrentAdditionalAiInsightMethodSet>["methods"][number],
  directionMethods: ReturnType<typeof resolveCurrentAdditionalAiInsightMethodSet>["methods"],
  identity: PreschoolAdditionalAiInsightArtifactIdentity,
  canvasEvidenceFacts: readonly InsightCanvasEvidenceFact[],
  knownCentreCodes: readonly string[],
): AdditionalAiInsightFinding | null => {
  const value = candidate.value;
  if (!isRecord(value)
    || !hasOnlyKeys(value, [
      "id", "title", "text", "epistemicStatus", "origin", "incrementalContext", "evidenceRefs", "toolAuditIds", "deepDiveQuestion", "alert", "canvas",
    ])
    || value.id !== candidate.sourceId
    || !conciseSummaryTitle(value.title)
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
  const citedFacts = evidenceRefs.map((reference) => factsById.get(reference)!);
  if (!energyAiNarrativeClaimsSupported({
    narrative: [value.title, value.text, nonEmptyString(value.deepDiveQuestion) ? value.deepDiveQuestion : ""].join(" "),
    evidence: citedFacts.map((fact) => ({
      id: fact.id,
      label: fact.label,
      unit: fact.unit ?? null,
      values: { [fact.metricId]: fact.value, ...fact.dimensions },
    })),
    sqlEvidence: [],
    knownCentreCodes,
  })) return null;
  const origin = resolveCandidateOrigin(value.origin, coreMethod, directionMethods);
  const incrementalContext = resolveIncrementalContext(
    value.incrementalContext,
    evidenceRefs,
    presentedClaims,
    { title: value.title, text: value.text },
  );
  if (!origin || !incrementalContext) return null;
  const epistemicStatus = resolveAcceptedEpistemicStatus({
    title: value.title,
    text: value.text,
    ...(nonEmptyString(value.deepDiveQuestion) ? { deepDiveQuestion: value.deepDiveQuestion } : {}),
    epistemicStatus: value.epistemicStatus,
    originKind: origin.kind,
    relationshipAssertion: incrementalContext.relationshipAssertion,
  });
  if (!epistemicStatus) return null;
  const audits = toolAuditIds.map((id) => auditsById.get(id));
  if (audits.some((audit) => !audit || audit.status !== "succeeded")) return null;
  const auditedEvidenceRefs = new Set(audits.flatMap((audit) => audit!.evidenceRefs));
  if (audits.length > 0 && (
    evidenceRefs.some((ref) => !auditedEvidenceRefs.has(ref))
    || audits.some((audit) => !audit!.evidenceRefs.some((ref) => evidenceRefs.includes(ref)))
  )) return null;
  if (isRecord(value.alert)
    && !alertIsAcceptable(value.alert, epistemicStatus, evidenceRefs, factsById)) return null;
  const finding: AdditionalAiInsightFinding = {
    id: `additional:${candidate.sourceId}`,
    title: value.title.trim(),
    text: value.text.trim(),
    epistemicStatus,
    origin,
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
  const canvas = acceptCandidateCanvas({
    candidate,
    candidateValue: value,
    identity,
    evidenceFacts: canvasEvidenceFacts,
  });
  return canvas ? { ...finding, canvas } : finding;
};

const resolveCandidateOrigin = (
  value: unknown,
  coreMethod: ReturnType<typeof resolveCurrentAdditionalAiInsightMethodSet>["methods"][number],
  loadedDirectionMethods: ReturnType<typeof resolveCurrentAdditionalAiInsightMethodSet>["methods"],
): AdditionalAiInsightFinding["origin"] | null => {
  if (!isRecord(value)
    || !nonEmptyString(value.kind)
    || !Array.isArray(value.directionMethodResourceIds)
    || !uniqueStrings(value.directionMethodResourceIds)) return null;
  const resourceIds = value.directionMethodResourceIds;
  if (value.kind === "ai-discovery") {
    return hasExactKeys(value, ["kind", "directionMethodResourceIds"])
      && resourceIds.length === 0
      ? { kind: "ai-discovery", coreMethod, directionMethods: [] }
      : null;
  }
  const resolved = resourceIds.map((resourceId) =>
    loadedDirectionMethods.filter((method) => method.resourceId === resourceId));
  if (resourceIds.length === 0 || resolved.some((matches) => matches.length !== 1)) return null;
  const directionMethods = resolved.map(([method]) => method!);
  const [firstDirectionMethod, ...remainingDirectionMethods] = directionMethods;
  if (!firstDirectionMethod) return null;
  if (value.kind === "expert-sop") {
    return hasExactKeys(value, ["kind", "directionMethodResourceIds"])
      ? {
          kind: "expert-sop",
          coreMethod,
          directionMethods: [firstDirectionMethod, ...remainingDirectionMethods],
        }
      : null;
  }
  if (value.kind === "hybrid"
    && hasExactKeys(value, ["kind", "directionMethodResourceIds", "novelContribution"])
    && boundedSafeText(value.novelContribution, MAX_NOVEL_CONTRIBUTION_CHARS)) {
    return {
      kind: "hybrid",
      coreMethod,
      directionMethods: [firstDirectionMethod, ...remainingDirectionMethods],
      novelContribution: value.novelContribution.trim(),
    };
  }
  return null;
};

const resolveIncrementalContext = (
  value: unknown,
  evidenceRefs: readonly string[],
  presentedClaims: readonly PreschoolAdditionalAiPresentedClaim[],
  publishedNarrative: { title: string; text: string },
): { relatedPresentedClaimIds: string[]; novelConclusion: string; relationshipAssertion: boolean } | null => {
  if (!isRecord(value)
    || !hasExactKeys(value, ["relatedPresentedClaimIds", "novelConclusion"])
    || !Array.isArray(value.relatedPresentedClaimIds)
    || !uniqueStrings(value.relatedPresentedClaimIds)
    || !boundedSafeText(value.novelConclusion, MAX_NOVEL_CONTRIBUTION_CHARS)) return null;
  const claimsById = new Map(presentedClaims.map((claim) => [claim.id, claim]));
  const deterministicBaselineIds = evidenceRefs.map((reference) => `deterministic-overview:${reference}`);
  const relatedPresentedClaimIds = [...new Set([
    ...value.relatedPresentedClaimIds,
    ...deterministicBaselineIds,
  ])];
  const related = relatedPresentedClaimIds.map((id) => claimsById.get(id));
  if (related.some((claim) => !claim)) return null;
  const novelConclusion = value.novelConclusion.trim();
  const combinedNarrative = `${publishedNarrative.title} ${publishedNarrative.text}`;
  if (related.some((claim) => claimTextIsRestatement(claim!.text, publishedNarrative.title)
      || claimTextIsRestatement(claim!.text, publishedNarrative.text)
      || claimTextIsRestatement(claim!.text, combinedNarrative))) return null;
  return {
    relatedPresentedClaimIds,
    novelConclusion,
    relationshipAssertion: evidenceRefs.length > 1
      || value.relatedPresentedClaimIds.some((id) => !deterministicBaselineIds.includes(id)),
  };
};

const resolveAcceptedEpistemicStatus = (input: {
  title: string;
  text: string;
  deepDiveQuestion?: string;
  epistemicStatus: "observed" | "inferred" | "speculative";
  originKind: AdditionalAiInsightFinding["origin"]["kind"];
  relationshipAssertion: boolean;
}): "observed" | "inferred" | "speculative" | null => {
  const narrative = `${input.title}\n${input.text}\n${input.deepDiveQuestion ?? ""}`;
  const explicitCausal = /\b(?:cause(?:s|d)?|driv(?:e|es|en)|explain(?:s|ed)?)(?:\s+\w+){0,3}\s+(?:by|the\s+variance)|\bdue\s+to\b/iu.test(narrative);
  const explicitAction = /\b(?:highest[- ]leverage|best|optimal|most\s+effective)\b[^.!?\n]{0,80}\b(?:target|action|intervention)\b/iu.test(narrative);
  const externalBenchmark = /\b(?:typical\s+(?:learning\s+)?environments?|industry\s+benchmarks?|tropical\s+preschools?)\b|\bshould\s+dominate\b/iu.test(narrative);
  if (input.epistemicStatus === "observed" && (explicitCausal || explicitAction || externalBenchmark)) return null;
  if (externalBenchmark && input.originKind === "ai-discovery" && input.epistemicStatus !== "speculative") return null;
  if (input.originKind === "ai-discovery"
    && input.epistemicStatus === "observed"
    && input.relationshipAssertion) return "inferred";
  return input.epistemicStatus;
};

const acceptCandidateCanvas = (input: {
  candidate: DiscoveryCandidate;
  candidateValue: Record<string, unknown>;
  identity: PreschoolAdditionalAiInsightArtifactIdentity;
  evidenceFacts: readonly InsightCanvasEvidenceFact[];
}): Extract<AdditionalAiInsightFinding["canvas"], { contractRevision: "energyiq-insight-canvas-v2" }> | undefined => {
  if (input.candidateValue.canvas === undefined) return undefined;
  const accepted = acceptInsightCanvasPlan({
    expectedIdentity: {
      workspaceId: input.identity.workspaceId,
      projectId: input.identity.projectId,
      scopeId: input.identity.scopeId,
      dataSnapshotId: input.identity.dataSnapshotId,
      projectReleaseId: input.identity.projectReleaseId,
    },
    evidenceFacts: input.evidenceFacts,
    plan: input.candidateValue.canvas,
  });
  const findingMatches = accepted.acceptedFinding?.id === input.candidate.sourceId
    && accepted.acceptedFinding.title === input.candidateValue.title
    && accepted.acceptedFinding.text === input.candidateValue.text
    && Array.isArray(input.candidateValue.evidenceRefs)
    && sameStringOrder(accepted.acceptedFinding.evidenceRefs, input.candidateValue.evidenceRefs);
  const acceptedBlocks = findingMatches ? accepted.acceptedBlocks.slice(0, 3) : [];
  const rejections: InsightCanvasRejection[] = [
    ...accepted.rejections,
    ...(findingMatches
      ? accepted.acceptedBlocks.slice(3).map(({ id }) => ({
          code: "PRESENTATION_BUDGET_EXCEEDED" as const,
          subjectId: id,
        }))
      : []),
  ];
  if (!findingMatches && !rejections.some(({ code }) => code === "FINDING_INVALID")) {
    rejections.push({ code: "FINDING_INVALID", subjectId: "finding" });
  }
  return {
    contractRevision: "energyiq-insight-canvas-v2",
    planId: `canvas-plan:additional:${input.candidate.sourceId}`,
    acceptedBlockIds: acceptedBlocks.map(({ id }) => id),
    acceptedBlocks,
    rejections,
    gaps: accepted.gaps,
  };
};

const projectCanvasEvidenceFacts = (
  identity: PreschoolAdditionalAiInsightArtifactIdentity,
  catalog: AnalysisContextEvidenceCatalog,
): InsightCanvasEvidenceFact[] => catalog.facts.flatMap((fact) => {
  if (typeof fact.value !== "number" || !Number.isFinite(fact.value) || !nonEmptyString(fact.unit)) return [];
  const entityId = fact.dimensions.entityId ?? fact.dimensions.scopeId ?? identity.scopeId;
  return [{
    identity: {
      workspaceId: identity.workspaceId,
      projectId: identity.projectId,
      scopeId: identity.scopeId,
      dataSnapshotId: identity.dataSnapshotId,
      projectReleaseId: identity.projectReleaseId,
    },
    evidenceRef: fact.id,
    entityId,
    metricId: fact.metricId,
    value: fact.value,
    unit: fact.unit,
  }];
});

const collectCatalogCentreCodes = (catalog: AnalysisContextEvidenceCatalog): string[] => [...new Set(
  catalog.facts.flatMap(({ dimensions }) => Object.entries(dimensions).flatMap(([key, value]) => {
    if (key === "centreCode") return [value];
    if (key === "centreCodes") return value.split(/[\s,;|]+/u);
    return [];
  }))
    .map((code) => code.trim())
    .filter((code) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,15}$/u.test(code)),
)];

const sameStringOrder = (left: readonly string[], right: readonly unknown[]): boolean => left.length === right.length
  && left.every((value, index) => value === right[index]);

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
  presentedClaims: PreschoolAdditionalAiPresentedClaims;
  methodResources: ReturnType<typeof resolveCurrentAdditionalAiInsightMethodSet>["resources"];
}): string => {
  const prompt = [
    "You are the Additional AI Insights discovery stage for EnergyIQ Preschool.",
    ...input.methodResources.map(({ method, content }) => [
      `Server-approved Method ${method.role} ${method.resourceId}@${method.resourceRevision}:`,
      content,
    ].join("\n")),
    "Return JSON only: {candidates:[{id,title,text,epistemicStatus:'observed|inferred|speculative',origin:{kind:'ai-discovery|expert-sop|hybrid',directionMethodResourceIds:[exact server-approved Method resourceId],novelContribution?:string},incrementalContext:{relatedPresentedClaimIds:[exact claim id],novelConclusion:string},evidenceRefs:[exact fact id],toolAuditIds:[actual returned audit id],deepDiveQuestion?,alert?,canvas?}]}.",
    "The first character must be { and the last character must be }. Do not add a preamble, scratch work, Markdown fence, or trailing commentary.",
    "Each title must be 100 characters or fewer. toolAuditIds is required; use [] when no tool was called. When a tool was called, cite only succeeded audit IDs actually used by that candidate; candidate Evidence may be a relevant subset of the audit Evidence.",
    "For page readability, text should be 1 to 3 short sentences and no more than 500 characters. deepDiveQuestion should be one short question and no more than 200 characters. These are generation instructions; the server keeps its wider safety ceiling for local candidate isolation.",
    "ai-discovery must contain exactly kind and directionMethodResourceIds, with directionMethodResourceIds=[]. Do not add novelContribution to ai-discovery. If alert cannot match the exact object shape {severity:'attention|urgent',certainty:'confirmed|anomaly|possible',evidenceRefs:[exact candidate Evidence ref]}, omit it.",
    "A relationship across multiple Evidence facts cannot be observed; label it inferred or speculative. Do not calculate or state new numeric values that are not directly present in the candidate's cited Evidence; qualitative relationships, counterexamples, and testable hypotheses remain valid.",
    "For core-only discovery use origin.kind='ai-discovery' and directionMethodResourceIds=[]. Cite only the exact loaded expert-direction resourceIds actually used. expert-sop requires one or more such refs. hybrid additionally requires a concise bounded novelContribution. Never invent or duplicate Method refs.",
    "Optional canvas must be an energyiq-insight-canvas plan using only quantitative metric, comparison, or trend blocks bound exactly to supplied Evidence facts. The server may reject blocks locally without rejecting the Finding.",
    "Candidates must already be ordered from highest to lowest incremental value. Zero candidates is valid.",
    "Use the structured already-presented claim digests below. Their sourceEvidenceRefs preserve source provenance and are not candidate Evidence authority. Cite exact related claim IDs and state only the genuinely new conclusion; related claims need not share an Evidence namespace with the candidate. Candidate evidenceRefs must still be exact IDs from the Current authoritative Evidence Catalog. A restatement is not a candidate; the same or different Evidence may support a new relationship, counterexample, or testable hypothesis.",
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
    `Already-presented claim digests: ${JSON.stringify(input.presentedClaims.claims)}`,
  ].join("\n\n");
  if (prompt.length > MAX_PRESCHOOL_ADDITIONAL_DISCOVERY_PROMPT_CHARS) {
    throw new Error(`PRESCHOOL_ADDITIONAL_AI_DISCOVERY_PROMPT_TOO_LARGE:${prompt.length}`);
  }
  return prompt;
};

const requireMethodResources = (
  methodSet: ReturnType<typeof resolveCurrentAdditionalAiInsightMethodSet>,
) => {
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

const requirePresentedClaims = (
  value: PreschoolAdditionalAiPresentedClaims,
  identity: PreschoolAdditionalAiInsightArtifactIdentity,
): PreschoolAdditionalAiPresentedClaims => {
  const expected = {
    workspaceId: identity.workspaceId,
    projectId: identity.projectId,
    scopeId: identity.scopeId,
    dataSnapshotId: identity.dataSnapshotId,
    projectReleaseId: identity.projectReleaseId,
    analysisPeriod: { from: identity.analysisPeriodFrom, to: identity.analysisPeriodTo },
    modelProfileId: identity.modelProfileId,
    modelProfileRevision: identity.modelProfileRevision,
  };
  if (!isRecord(value)
    || JSON.stringify(value.binding) !== JSON.stringify(expected)
    || !Array.isArray(value.claims)
    || !uniqueStrings(value.claims.map(({ id }) => id))
    || value.claims.some((claim) => !presentedClaimIsValid(claim))) {
    throw new Error("PRESCHOOL_ADDITIONAL_AI_PRESENTED_CLAIMS_INVALID");
  }
  return value;
};

const presentedClaimIsValid = (value: unknown): value is PreschoolAdditionalAiPresentedClaim => {
  if (!isRecord(value)
    || !nonEmptyString(value.id)
    || !nonEmptyString(value.text)
    || !Array.isArray(value.sourceEvidenceRefs)
    || value.sourceEvidenceRefs.length === 0
    || !uniqueStrings(value.sourceEvidenceRefs)) return false;
  if (value.source === "deterministic-overview") {
    return hasExactKeys(value, ["id", "source", "text", "sourceEvidenceRefs"])
      && value.sourceEvidenceRefs.length === 1
      && value.id === `deterministic-overview:${value.sourceEvidenceRefs[0]}`;
  }
  if (value.source === "key-finding") {
    return hasExactKeys(value, ["id", "source", "artifactId", "text", "sourceEvidenceRefs"])
      && nonEmptyString(value.artifactId);
  }
  if (value.source === "section-summary" || value.source === "section-insight") {
    return hasExactKeys(value, ["id", "source", "sectionId", "artifactId", "text", "sourceEvidenceRefs"])
      && nonEmptyString(value.sectionId)
      && nonEmptyString(value.artifactId);
  }
  return false;
};

const canonicalClaimText = (value: string): string => value
  .normalize("NFKC")
  .toLocaleLowerCase("en")
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .trim();

const CLAIM_FUNCTION_WORDS = new Set([
  "a", "an", "and", "at", "by", "during", "for", "from", "in", "is", "of", "on", "the", "to", "was",
]);

const claimTextIsRestatement = (presented: string, proposed: string): boolean => {
  const left = canonicalClaimText(presented);
  const right = canonicalClaimText(proposed);
  if (left === right) return true;
  const tokens = (value: string): Set<string> => new Set(value.split(" ")
    .filter((token) => token.length > 1 && !CLAIM_FUNCTION_WORDS.has(token)));
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  const smaller = Math.min(leftTokens.size, rightTokens.size);
  if (smaller < 4) return false;
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  const larger = Math.max(leftTokens.size, rightTokens.size);
  return shared / union >= 0.6 && smaller / larger >= 0.65;
};

const boundedErrorCode = (error: unknown): string => {
  const value = error instanceof Error ? error.message : "PRESCHOOL_ADDITIONAL_AI_FAILED";
  return /^[A-Z0-9_:.-]{1,160}$/u.test(value) ? value : "PRESCHOOL_ADDITIONAL_AI_FAILED";
};

const boundedSafeText = (value: unknown, max: number): value is string => nonEmptyString(value)
  && value.length <= max
  && !/(?:<\/?[a-z]|https?:\/\/|javascript:)/iu.test(value);

const conciseSummaryTitle = (value: unknown): value is string =>
  boundedSafeText(value, PRESCHOOL_ADDITIONAL_INSIGHT_TITLE_MAX_CHARS)
  && !/[;\r\n]/u.test(value)
  && !/[.!?]\s+\S/u.test(value.trim());

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
