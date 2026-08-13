import type {
  AnalysisContextEvidenceCatalog,
  AnalysisContextEvidenceFact,
} from "@datafoundry/agent-runtime";
import type {
  EnergyIqOverviewAiArtifactIdentity,
  EnergyIqOverviewAiArtifactRecord,
  MetadataStore,
  UserRecord,
} from "@datafoundry/metadata";
import { createHash, randomUUID } from "node:crypto";

import {
  createPreschoolOverviewAiExecutiveArtifactIdentityV4,
  createPreschoolOverviewAiSectionArtifactIdentityV4,
  createPreschoolOverviewAiValueArtifactIdentity,
  type OverviewAiArtifactIdentityV13,
} from "./overview-ai-artifact.js";
import {
  PRESCHOOL_SECTION_IDS,
  isPreschoolSectionId,
  preschoolOverviewAiBindingFromIdentity,
  type PreschoolExecutiveKeyFinding,
  type PreschoolExecutiveOverviewEvidenceLineage,
  type PreschoolExecutiveSynthesisResultV4,
  type PreschoolExecutiveSynthesisResult,
  type PreschoolOverviewAiBinding,
  type PreschoolOverviewKeyFinding,
  type PreschoolSectionId,
  type PreschoolSectionInterpretationResultV3,
  type PreschoolSectionInterpretationResultV4,
} from "./preschool-overview-ai-contracts.js";
import { resolveOverviewAiStageStructuredOutputV4 } from "./preschool-overview-ai-structured-output.js";

const LEASE_MS = 3 * 60 * 1_000;
export const MAX_PRESCHOOL_EXECUTIVE_PROMPT_CHARS = 64_000;
const BANNED_INTERNAL_TEXT = /\b(?:parent_node_id|dataSnapshotId|projectReleaseId|SQL)\b/i;
const SQL_STATEMENT = /\bSELECT\b[\s\S]{0,500}\b(?:FROM|JOIN)\b/i;
const NUMBER_TOKEN = /(?<![A-Za-z0-9_-])-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g;

export type PreschoolExecutiveSynthesisRunner = (input: {
  prompt: string;
  identity: EnergyIqOverviewAiArtifactIdentity;
  user: UserRecord;
  workspaceId: string;
  runId: string;
  sessionId: string;
  structuredOutput?: NonNullable<ReturnType<typeof resolveOverviewAiStageStructuredOutputV4>>;
}) => Promise<{ answer: string; runId: string; sessionId: string }>;

export type PreschoolExecutiveSynthesizer = {
  execute(input: {
    baseIdentity: OverviewAiArtifactIdentityV13;
    user: UserRecord;
    retry: boolean;
    authoritativeOverviewEvidence?: PreschoolAuthoritativeOverviewEvidence;
  }): Promise<EnergyIqOverviewAiArtifactRecord>;
};

type AcceptedSection = {
  artifactId: string;
  result: PreschoolSectionInterpretationResultV3 & { status: "available" };
};

type AcceptedSectionV4 = {
  artifactId: string;
  result: PreschoolSectionInterpretationResultV4 & { status: "available" };
};

export type PreschoolAuthoritativeOverviewEvidence = {
  binding: PreschoolOverviewAiBinding;
  catalog: AnalysisContextEvidenceCatalog;
};

export const createPreschoolExecutiveSynthesizer = (input: {
  metadataStore: MetadataStore;
  runSynthesis: PreschoolExecutiveSynthesisRunner;
  assertRuntimeIdentity?: (identity: EnergyIqOverviewAiArtifactIdentity) => void;
  revision?: "v3" | "v4";
  authoritativeOverviewEvidence?: PreschoolAuthoritativeOverviewEvidence;
}): PreschoolExecutiveSynthesizer => {
  if (input.revision === "v4") return createPreschoolExecutiveSynthesizerV4(input);
  return ({
  async execute({ baseIdentity, user, retry }) {
    const store = input.metadataStore.energyIq.overviewAiArtifacts;
    const accepted = acceptedSections(store, baseIdentity);
    const identity = createPreschoolOverviewAiValueArtifactIdentity({
      baseIdentity,
      artifactKind: "executive-synthesis",
      targetId: preschoolExecutiveSynthesisTargetId(accepted.map(({ artifactId }) => artifactId)),
    });
    const current = store.find(identity) ?? store.queue({ identity, triggeredBy: user.id });
    if (current.status === "available") return current;
    if (current.status === "running" && !retry) return current;
    if (current.status === "failed" && !retry) return current;

    const workerId = `executive-synthesis:${randomUUID()}`;
    const claim = store.claim({ identity, workerId, leaseMs: LEASE_MS });
    if (!claim.claimed) return claim.artifact;
    const sessionId = `preschool-executive-synthesis-${randomUUID()}`;
    const runId = `preschool-executive-synthesis-${randomUUID()}`;

    try {
      if (accepted.length === 0) {
        input.assertRuntimeIdentity?.(identity);
        return store.complete({
          identity,
          workerId,
          sessionId,
          runId,
          resultJson: JSON.stringify(emptyResult(identity, runId)),
        });
      }
      const prompt = buildExecutivePrompt(accepted);
      const response = await input.runSynthesis({
        prompt,
        identity,
        user,
        workspaceId: identity.workspaceId,
        runId,
        sessionId,
      });
      if (response.runId !== runId || response.sessionId !== sessionId) {
        throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_RUN_IDENTITY_MISMATCH");
      }
      const result = materializeExecutiveResult({
        answer: response.answer,
        accepted,
        identity,
        runId,
      });
      input.assertRuntimeIdentity?.(identity);
      return store.complete({
        identity,
        workerId,
        sessionId,
        runId,
        resultJson: JSON.stringify(result),
      });
    } catch (error) {
      try {
        return store.fail({
          identity,
          workerId,
          errorCode: synthesisErrorCode(error),
        });
      } catch {
        return store.get(identity);
      }
    }
  },
  });
};

const createPreschoolExecutiveSynthesizerV4 = (input: {
  metadataStore: MetadataStore;
  runSynthesis: PreschoolExecutiveSynthesisRunner;
  assertRuntimeIdentity?: (identity: EnergyIqOverviewAiArtifactIdentity) => void;
  authoritativeOverviewEvidence?: PreschoolAuthoritativeOverviewEvidence;
}): PreschoolExecutiveSynthesizer => ({
  async execute({ baseIdentity, user, retry, authoritativeOverviewEvidence: executionOverviewEvidence }) {
    const store = input.metadataStore.energyIq.overviewAiArtifacts;
    const accepted = acceptedSectionsV4(store, baseIdentity);
    const identity = createPreschoolOverviewAiExecutiveArtifactIdentityV4({
      baseIdentity,
      targetId: preschoolExecutiveSynthesisTargetId(accepted.map(({ artifactId }) => artifactId)),
    });
    const current = store.find(identity) ?? store.queue({ identity, triggeredBy: user.id });
    if (current.status === "available") return current;
    if (current.status === "running" && !retry) return current;
    if (current.status === "failed" && !retry) return current;

    const workerId = `executive-synthesis-v4:${randomUUID()}`;
    const claim = store.claim({ identity, workerId, leaseMs: LEASE_MS });
    if (!claim.claimed) return claim.artifact;
    const sessionId = `preschool-executive-synthesis-v4-${randomUUID()}`;
    const runId = `preschool-executive-synthesis-v4-${randomUUID()}`;

    try {
      if (accepted.length === 0) {
        input.assertRuntimeIdentity?.(identity);
        return store.complete({
          identity,
          workerId,
          sessionId,
          runId,
          resultJson: JSON.stringify(emptyResultV4(identity, runId)),
        });
      }
      const suppliedOverviewEvidence = executionOverviewEvidence ?? input.authoritativeOverviewEvidence;
      const authoritativeOverviewEvidence = suppliedOverviewEvidence
        ? requireAuthoritativeOverviewEvidence(suppliedOverviewEvidence, identity)
        : undefined;
      const response = await input.runSynthesis({
        prompt: buildExecutivePromptV4(accepted, authoritativeOverviewEvidence),
        identity,
        user,
        workspaceId: identity.workspaceId,
        runId,
        sessionId,
        structuredOutput: resolveOverviewAiStageStructuredOutputV4("executive-synthesis")!,
      });
      if (response.runId !== runId || response.sessionId !== sessionId) {
        throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_RUN_IDENTITY_MISMATCH");
      }
      const result = materializeExecutiveResultV4({
        answer: response.answer,
        accepted,
        identity,
        runId,
        ...(authoritativeOverviewEvidence
          ? { authoritativeOverviewEvidence }
          : {}),
      });
      input.assertRuntimeIdentity?.(identity);
      return store.complete({
        identity,
        workerId,
        sessionId,
        runId,
        resultJson: JSON.stringify(result),
      });
    } catch (error) {
      try {
        return store.fail({ identity, workerId, errorCode: synthesisErrorCode(error) });
      } catch {
        return store.get(identity);
      }
    }
  },
});

export const preschoolExecutiveSynthesisTargetId = (sourceSectionArtifactIds: string[]): string => {
  if (sourceSectionArtifactIds.length === 0) return "sections:none";
  const digest = createHash("sha256")
    .update([...sourceSectionArtifactIds].sort().join("\n"))
    .digest("hex");
  return `sections:${digest}`;
};

const acceptedSections = (
  store: MetadataStore["energyIq"]["overviewAiArtifacts"],
  baseIdentity: OverviewAiArtifactIdentityV13,
): AcceptedSection[] => PRESCHOOL_SECTION_IDS.flatMap((sectionId) => {
  const identity = createPreschoolOverviewAiValueArtifactIdentity({
    baseIdentity,
    artifactKind: "section-interpretation",
    targetId: sectionId,
  });
  const artifact = store.find(identity);
  if (!artifact || artifact.status !== "available" || !artifact.result_json) return [];
  const result = parseAcceptedSection(artifact.result_json, identity);
  return result?.status === "available"
    ? [{ artifactId: artifact.id, result: result as PreschoolSectionInterpretationResultV3 & { status: "available" } }]
    : [];
});

const acceptedSectionsV4 = (
  store: MetadataStore["energyIq"]["overviewAiArtifacts"],
  baseIdentity: OverviewAiArtifactIdentityV13,
): AcceptedSectionV4[] => PRESCHOOL_SECTION_IDS.flatMap((sectionId) => {
  const identity = createPreschoolOverviewAiSectionArtifactIdentityV4({ baseIdentity, targetId: sectionId });
  const artifact = store.find(identity);
  if (!artifact || artifact.status !== "available" || !artifact.result_json) return [];
  const result = parseAcceptedSectionV4(artifact.result_json, identity);
  return result?.status === "available" ? [{ artifactId: artifact.id, result }] : [];
});

const parseAcceptedSectionV4 = (
  resultJson: string,
  identity: EnergyIqOverviewAiArtifactIdentity,
): (PreschoolSectionInterpretationResultV4 & { status: "available" }) | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(resultJson) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed)
    || parsed.artifactKind !== "section-interpretation"
    || parsed.status !== "available"
    || parsed.sectionId !== identity.targetId
    || !isRecord(parsed.contract)
    || parsed.contract.revision !== "preschool-section-interpretation-v4"
    || parsed.contract.revision !== identity.outputContractRevision
    || parsed.packRevision !== "v2"
    || !sameBinding(parsed.binding, identity)
    || !isRecord(parsed.summary)
    || !cleanText(parsed.summary.text)
    || !stringArray(parsed.summary.evidenceRefs)
    || !Array.isArray(parsed.insights)
    || !parsed.insights.every(validSectionInsightV4)) return null;
  return parsed as unknown as PreschoolSectionInterpretationResultV4 & { status: "available" };
};

const parseAcceptedSection = (
  resultJson: string,
  identity: EnergyIqOverviewAiArtifactIdentity,
): PreschoolSectionInterpretationResultV3 | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(resultJson) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed)
    || parsed.artifactKind !== "section-interpretation"
    || (parsed.status !== "available" && parsed.status !== "empty")
    || parsed.sectionId !== identity.targetId
    || !isRecord(parsed.binding)
    || parsed.binding.dataSnapshotId !== identity.dataSnapshotId
    || parsed.binding.projectReleaseId !== identity.projectReleaseId
    || !Array.isArray(parsed.keyPoints)) return null;
  return parsed as unknown as PreschoolSectionInterpretationResultV3;
};

const buildExecutivePrompt = (accepted: AcceptedSection[]): string => {
  const prompt = [
    "You are the Preschool Overview Executive Key Findings synthesizer, not an investigator.",
    "Use only the accepted Section Interpretations below. Do not read raw Facts, query SQL, add a number, or add a fact.",
    "Combine duplicate management messages instead of copying each Section verbatim.",
    "Return 0-4 concise plain-English findings for a non-technical manager.",
    "Each takeaway may use limited inline Markdown only: **bold** for the few words carrying the decision, and _italics_ for a caveat. Keep most text unformatted. Do not use headings, lists, links, images, code, HTML, or Markdown tables.",
    "Each finding must cite one or more source sectionIds and exact evidenceRefs already present in those Sections.",
    "Return JSON only: {\"status\":\"available\"|\"empty\",\"keyFindings\":[{\"takeaway\":string,\"sectionIds\":string[],\"evidenceRefs\":string[]}]}",
    `Binding: ${JSON.stringify(accepted[0]!.result.binding)}`,
    `Accepted Sections: ${JSON.stringify(accepted.map(({ result }) => ({
      sectionId: result.sectionId,
      summary: result.summary,
      keyPoints: result.keyPoints,
      ...(result.limitation ? { limitation: result.limitation } : {}),
    })))}`,
  ].join("\n\n");
  if (prompt.length > MAX_PRESCHOOL_EXECUTIVE_PROMPT_CHARS) throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_PROMPT_TOO_LARGE");
  return prompt;
};

const buildExecutivePromptV4 = (
  accepted: AcceptedSectionV4[],
  authoritativeOverviewEvidence?: PreschoolAuthoritativeOverviewEvidence,
): string => {
  const prompt = [
    "You are the Preschool Overview Key Findings synthesizer, not a new investigator.",
    "Use only the accepted current-v4 Section summaries and insights below, plus any explicitly supplied authoritative Overview Evidence.",
    "Select the few cross-Section themes that matter most. Do not mechanically rewrite every Section or invent a cause, number, date, entity relationship, or action.",
    "Return one concise answer-first summary and 0-3 compact findings. A high-priority alert is optional and must be supported by the supplied Evidence.",
    "Narrative text may use only limited inline **bold** and _italics_; do not return headings, links, images, HTML, code, tables, or custom styling.",
    "Every summary and finding must cite exact evidenceRefs. Every finding must declare the exact contributing sectionIds.",
    "Compact projections are lossless: resolve evidenceRefIndexes through evidenceRefs, and read Overview fact rows using their declared dictionaries and columns. Every accepted Insight and Overview fact is present. For an Overview fact, cite its fact-row id as the evidenceRef; its evidence set is provenance only.",
    "sourceArtifactId and encoding indexes are provenance only; never repeat them in customer text.",
    "Return JSON only: {\"status\":\"available\"|\"empty\",\"summary\"?:{\"text\":string,\"evidenceRefs\":string[]},\"findings\":[{\"title\":string,\"text\":string,\"sectionIds\":string[],\"evidenceRefs\":string[],\"alert\"?:{\"severity\":\"attention\"|\"urgent\",\"certainty\":\"confirmed\"|\"anomaly\"|\"possible\"}}]}",
    `Binding: ${JSON.stringify(accepted[0]!.result.binding)}`,
    `Accepted Sections: ${JSON.stringify(projectAcceptedSectionsV4ForModel(accepted))}`,
    ...(authoritativeOverviewEvidence ? [
      `Authoritative Overview Evidence: ${JSON.stringify(projectPreschoolExecutiveOverviewEvidenceForModel(authoritativeOverviewEvidence.catalog))}`,
    ] : []),
  ].join("\n\n");
  if (prompt.length > MAX_PRESCHOOL_EXECUTIVE_PROMPT_CHARS) throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_PROMPT_TOO_LARGE");
  return prompt;
};

const projectAcceptedSectionsV4ForModel = (accepted: AcceptedSectionV4[]) => {
  const evidenceRefs = uniqueProjectionStrings(accepted.flatMap(({ result }) => [
    ...result.summary.evidenceRefs,
    ...result.insights.flatMap((insight) => insight.evidenceRefs),
  ]));
  const evidenceRefIndex = new Map(evidenceRefs.map((reference, index) => [reference, index]));
  const indexes = (references: string[]) => references.map((reference) => evidenceRefIndex.get(reference)!);
  return {
    encoding: { id: "preschool-executive-section-projection", revision: "v1" },
    evidenceRefs,
    sections: accepted.map(({ artifactId, result }) => ({
      sourceArtifactId: artifactId,
      sectionId: result.sectionId,
      summary: {
        text: result.summary.text,
        evidenceRefIndexes: indexes(result.summary.evidenceRefs),
      },
      insights: result.insights.map((insight) => ({
        id: insight.id,
        title: insight.title,
        epistemicStatus: insight.epistemicStatus,
        text: insight.text,
        evidenceRefIndexes: indexes(insight.evidenceRefs),
        ...(insight.label === undefined ? {} : { label: insight.label }),
        ...(insight.deepDiveQuestion === undefined ? {} : { deepDiveQuestion: insight.deepDiveQuestion }),
      })),
      ...(result.limitation ? { limitation: result.limitation } : {}),
    })),
  };
};

export const projectPreschoolExecutiveOverviewEvidenceForModel = (catalog: AnalysisContextEvidenceCatalog) => {
  const metricIds = uniqueProjectionStrings(catalog.facts.map((fact) => fact.metricId));
  const units = uniqueProjectionStrings(catalog.facts.flatMap((fact) => fact.unit === undefined ? [] : [fact.unit]));
  const statuses = uniqueProjectionStrings(catalog.facts.map((fact) => fact.status));
  const evidenceRefs = uniqueProjectionStrings(catalog.facts.flatMap((fact) => fact.evidenceRefs));
  const evidenceSets = uniqueJsonValues(catalog.facts.map((fact) =>
    fact.evidenceRefs.map((reference) => evidenceRefs.indexOf(reference))));
  const dimensions = uniqueJsonValues(catalog.facts.map((fact) => fact.dimensions));
  return {
    encoding: { id: "analysis-context-evidence-columnar-json", revision: "v1" },
    contract: catalog.contract,
    sourceId: catalog.sourceId,
    pins: catalog.pins,
    dictionaries: { metricIds, units, statuses, evidenceRefs, evidenceSets, dimensions },
    factTable: {
      columns: ["id", "label", "metricIdIndex", "value", "unitIndex", "statusIndex", "evidenceSetIndex", "dimensionsIndex"],
      rows: catalog.facts.map((fact) => [
        fact.id,
        fact.label,
        metricIds.indexOf(fact.metricId),
        fact.value,
        fact.unit === undefined ? -1 : units.indexOf(fact.unit),
        statuses.indexOf(fact.status),
        indexOfJsonValue(evidenceSets, fact.evidenceRefs.map((reference) => evidenceRefs.indexOf(reference))),
        indexOfJsonValue(dimensions, fact.dimensions),
      ]),
    },
  };
};

const uniqueProjectionStrings = (values: string[]): string[] => [...new Set(values)];

const uniqueJsonValues = <T>(values: T[]): T[] => {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const indexOfJsonValue = <T>(values: T[], value: T): number => {
  const key = JSON.stringify(value);
  return values.findIndex((candidate) => JSON.stringify(candidate) === key);
};

const materializeExecutiveResultV4 = (input: {
  answer: string;
  accepted: AcceptedSectionV4[];
  identity: EnergyIqOverviewAiArtifactIdentity;
  runId: string;
  authoritativeOverviewEvidence?: PreschoolAuthoritativeOverviewEvidence;
}): PreschoolExecutiveSynthesisResultV4 => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(input.answer));
  } catch {
    throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_MALFORMED");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.findings)) {
    throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_MALFORMED");
  }
  if (parsed.status === "empty") {
    if (parsed.summary !== undefined || parsed.findings.length !== 0) {
      throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_MALFORMED");
    }
    return emptyResultV4(input.identity, input.runId);
  }
  if (parsed.status !== "available"
    || !isRecord(parsed.summary)
    || parsed.findings.length > 3) {
    throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_MALFORMED");
  }
  const summaryText = cleanText(parsed.summary.text);
  const rawSummaryEvidenceRefs = stringArray(parsed.summary.evidenceRefs);
  if (!summaryText || !rawSummaryEvidenceRefs || rawSummaryEvidenceRefs.length === 0
    || hasBannedCustomerText(summaryText)) {
    throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_FACT_UNSUPPORTED");
  }
  const acceptedBySection = new Map(input.accepted.map((accepted) => [accepted.result.sectionId, accepted]));
  const evidenceOwners = sectionEvidenceOwners(input.accepted);
  const overviewFacts = input.authoritativeOverviewEvidence?.catalog.facts ?? [];
  const authoritativeEvidence = new Set(overviewFacts.map(({ id }) => id));
  const overviewFactIdsByProvenanceRef = new Map<string, Set<string>>();
  for (const fact of overviewFacts) {
    for (const reference of fact.evidenceRefs) {
      const factIds = overviewFactIdsByProvenanceRef.get(reference) ?? new Set<string>();
      factIds.add(fact.id);
      overviewFactIdsByProvenanceRef.set(reference, factIds);
    }
  }
  const usedOverviewFactIds = new Set<string>();
  const sourceNumbers = [
    ...collectNumbers(input.accepted.flatMap(({ result }) => [
      result.summary.text,
      ...result.insights.flatMap(({ title, label, text }) => label ? [title, label, text] : [title, text]),
      result.limitation,
    ])),
    ...overviewFacts.flatMap(({ value }) => typeof value === "number" ? [value] : []),
  ];
  const requireSupportedEvidence = (
    reference: string,
    usedFactIds: Set<string> = usedOverviewFactIds,
  ): {
    canonicalReference: string;
    owners: Set<PreschoolSectionId>;
  } => {
    const owners = evidenceOwners.get(reference);
    if (owners) return { canonicalReference: reference, owners };
    if (authoritativeEvidence.has(reference)) {
      usedFactIds.add(reference);
      return { canonicalReference: reference, owners: new Set() };
    }
    const aliasedFactIds = overviewFactIdsByProvenanceRef.get(reference);
    if (aliasedFactIds?.size === 1) {
      const [factId] = aliasedFactIds;
      usedFactIds.add(factId!);
      return { canonicalReference: factId!, owners: new Set() };
    }
    throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_EVIDENCE_UNSUPPORTED");
  };
  const contributingSections = new Set<PreschoolSectionId>();
  const summaryEvidenceRefs = [...new Set(rawSummaryEvidenceRefs.map((reference) => {
    const supported = requireSupportedEvidence(reference);
    for (const sectionId of supported.owners) contributingSections.add(sectionId);
    return supported.canonicalReference;
  }))];
  if (summaryEvidenceRefs.length === 0) {
    throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_EVIDENCE_UNSUPPORTED");
  }
  if (hasUnsupportedNumber(summaryText, sourceNumbers)) {
    throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_FACT_UNSUPPORTED");
  }
  const findings: PreschoolOverviewKeyFinding[] = parsed.findings.flatMap((candidate, index) => {
    if (!isRecord(candidate)) return [];
    const title = cleanText(candidate.title);
    const text = cleanText(candidate.text);
    const sectionIds = stringArray(candidate.sectionIds)?.filter(isPreschoolSectionId);
    const rawEvidenceRefs = stringArray(candidate.evidenceRefs);
    if (!title || !text || !sectionIds || sectionIds.length === 0
      || sectionIds.length !== (candidate.sectionIds as unknown[]).length
      || new Set(sectionIds).size !== sectionIds.length
      || sectionIds.some((sectionId) => !acceptedBySection.has(sectionId))
      || !rawEvidenceRefs || rawEvidenceRefs.length === 0
      || hasBannedCustomerText(title) || hasBannedCustomerText(text)
      || hasUnsupportedNumber(`${title} ${text}`, sourceNumbers)) {
      return [];
    }
    const declaredSections = new Set(sectionIds);
    const evidenceBackedSections = new Set<PreschoolSectionId>();
    const evidenceRefs: string[] = [];
    const candidateOverviewFactIds = new Set<string>();
    try {
      for (const reference of rawEvidenceRefs) {
        const supported = requireSupportedEvidence(reference, candidateOverviewFactIds);
        const { owners } = supported;
        if (owners.size > 0 && ![...owners].some((sectionId) => declaredSections.has(sectionId))) {
          return [];
        }
        for (const sectionId of owners) {
          if (declaredSections.has(sectionId)) evidenceBackedSections.add(sectionId);
        }
        evidenceRefs.push(supported.canonicalReference);
      }
    } catch (error) {
      if (error instanceof Error
        && error.message === "PRESCHOOL_EXECUTIVE_SYNTHESIS_EVIDENCE_UNSUPPORTED") return [];
      throw error;
    }
    if ([...declaredSections].some((sectionId) => !evidenceBackedSections.has(sectionId))) {
      return [];
    }
    let alert: PreschoolOverviewKeyFinding["alert"] | undefined;
    try {
      alert = parseAlert(candidate.alert);
    } catch {
      return [];
    }
    for (const sectionId of declaredSections) contributingSections.add(sectionId);
    for (const factId of candidateOverviewFactIds) usedOverviewFactIds.add(factId);
    return [{
      id: `overview-key-finding-${index + 1}`,
      title,
      text,
      sectionIds: [...declaredSections],
      evidenceRefs: [...new Set(evidenceRefs)],
      ...(alert ? { alert } : {}),
    }];
  });
  const sourceSectionArtifactIds = PRESCHOOL_SECTION_IDS.flatMap((sectionId) => {
    const accepted = acceptedBySection.get(sectionId);
    return contributingSections.has(sectionId) && accepted ? [accepted.artifactId] : [];
  });
  if (sourceSectionArtifactIds.length === 0) {
    throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_EVIDENCE_UNSUPPORTED");
  }
  return {
    artifactKind: "executive-synthesis",
    status: "available",
    providerProfileId: input.identity.modelProfileId,
    runId: input.runId,
    contract: { id: "preschool-executive-synthesis", revision: "preschool-executive-synthesis-v4" },
    binding: preschoolOverviewAiBindingFromIdentity(input.identity),
    sourceSectionArtifactIds,
    summary: { text: summaryText, evidenceRefs: summaryEvidenceRefs },
    ...(input.authoritativeOverviewEvidence && usedOverviewFactIds.size > 0 ? {
      overviewEvidence: overviewEvidenceLineage(
        input.authoritativeOverviewEvidence.catalog,
        usedOverviewFactIds,
      ),
    } : {}),
    findings,
  };
};

const materializeExecutiveResult = (input: {
  answer: string;
  accepted: AcceptedSection[];
  identity: EnergyIqOverviewAiArtifactIdentity;
  runId: string;
}): PreschoolExecutiveSynthesisResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(input.answer));
  } catch {
    throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_MALFORMED");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.keyFindings)) {
    throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_MALFORMED");
  }
  if (parsed.status === "empty") {
    if (parsed.keyFindings.length !== 0) throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_MALFORMED");
    return emptyResult(input.identity, input.runId, input.accepted.map(({ artifactId }) => artifactId));
  }
  if (parsed.status !== "available" || parsed.keyFindings.length < 1 || parsed.keyFindings.length > 4) {
    throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_MALFORMED");
  }
  const sourcesBySection = new Map(input.accepted.map(({ result }) => [result.sectionId, result]));
  const sourceNumbers = collectNumbers(input.accepted.flatMap(({ result }) => [
    result.summary,
    ...result.keyPoints.flatMap(({ label, text }) => label ? [label, text] : [text]),
    result.limitation,
  ]));
  const keyFindings: PreschoolExecutiveKeyFinding[] = parsed.keyFindings.map((candidate, index) => {
    if (!isRecord(candidate)) throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_MALFORMED");
    const takeaway = cleanText(candidate.takeaway);
    const sectionIds = stringArray(candidate.sectionIds)?.filter(isPreschoolSectionId);
    const evidenceRefs = stringArray(candidate.evidenceRefs);
    if (!takeaway || !sectionIds || sectionIds.length === 0 || !evidenceRefs || evidenceRefs.length === 0
      || sectionIds.length !== (candidate.sectionIds as unknown[]).length
      || hasBannedCustomerText(takeaway)
      || hasUnsupportedNumber(takeaway, sourceNumbers)) {
      throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_FACT_UNSUPPORTED");
    }
    const allowedEvidence = new Set(sectionIds.flatMap((sectionId) =>
      sourcesBySection.get(sectionId)?.keyPoints.flatMap(({ evidenceRefs: refs }) => refs) ?? []));
    if (evidenceRefs.some((reference) => !allowedEvidence.has(reference))) {
      throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_EVIDENCE_UNSUPPORTED");
    }
    return {
      id: `executive-key-finding-${index + 1}`,
      takeaway,
      sectionIds: [...new Set(sectionIds)],
      evidenceRefs: [...new Set(evidenceRefs)],
    };
  });
  return {
    artifactKind: "executive-synthesis",
    status: "available",
    providerProfileId: input.identity.modelProfileId,
    runId: input.runId,
    contract: {
      id: "preschool-executive-synthesis",
      revision: "preschool-executive-synthesis-v1",
    },
    binding: preschoolOverviewAiBindingFromIdentity(input.identity),
    sourceSectionArtifactIds: input.accepted.map(({ artifactId }) => artifactId),
    keyFindings,
  };
};

const emptyResult = (
  identity: EnergyIqOverviewAiArtifactIdentity,
  runId: string,
  sourceSectionArtifactIds: string[] = [],
): PreschoolExecutiveSynthesisResult => ({
  artifactKind: "executive-synthesis",
  status: "empty",
  providerProfileId: identity.modelProfileId,
  runId,
  contract: {
    id: "preschool-executive-synthesis",
    revision: "preschool-executive-synthesis-v1",
  },
  binding: preschoolOverviewAiBindingFromIdentity(identity),
  sourceSectionArtifactIds,
  keyFindings: [],
});

const emptyResultV4 = (
  identity: EnergyIqOverviewAiArtifactIdentity,
  runId: string,
): PreschoolExecutiveSynthesisResultV4 => ({
  artifactKind: "executive-synthesis",
  status: "empty",
  providerProfileId: identity.modelProfileId,
  runId,
  contract: { id: "preschool-executive-synthesis", revision: "preschool-executive-synthesis-v4" },
  binding: preschoolOverviewAiBindingFromIdentity(identity),
  sourceSectionArtifactIds: [],
  findings: [],
});

const requireAuthoritativeOverviewEvidence = (
  value: PreschoolAuthoritativeOverviewEvidence,
  identity: EnergyIqOverviewAiArtifactIdentity,
): PreschoolAuthoritativeOverviewEvidence => {
  const catalog = value.catalog;
  if (!sameBinding(value.binding, identity)
    || catalog.contract !== "analysis-context-evidence@1"
    || !cleanText(catalog.sourceId)
    || catalog.pins.workspaceId !== identity.workspaceId
    || catalog.pins.projectId !== identity.projectId
    || catalog.pins.scopeId !== identity.scopeId
    || catalog.pins.dataSnapshotId !== identity.dataSnapshotId
    || catalog.pins.projectReleaseId !== identity.projectReleaseId
    || !cleanText(catalog.pins.dataCutoff)
    || !cleanText(catalog.pins.metricVersion)
    || !Array.isArray(catalog.facts)
    || !catalog.facts.every(validAuthoritativeOverviewFact)
    || new Set(catalog.facts.map(({ id }) => id)).size !== catalog.facts.length) {
    throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_OVERVIEW_EVIDENCE_IDENTITY_MISMATCH");
  }
  return value;
};

const validAuthoritativeOverviewFact = (value: AnalysisContextEvidenceFact): boolean =>
  Boolean(cleanText(value.id))
  && Boolean(cleanText(value.label))
  && Boolean(cleanText(value.metricId))
  && (typeof value.value === "string"
    || typeof value.value === "number"
    || typeof value.value === "boolean"
    || value.value === null)
  && (value.unit === undefined || Boolean(cleanText(value.unit)))
  && (value.status === "confirmed" || value.status === "provisional" || value.status === "partial")
  && Array.isArray(value.evidenceRefs)
  && value.evidenceRefs.length > 0
  && value.evidenceRefs.every((reference) => Boolean(cleanText(reference)))
  && new Set(value.evidenceRefs).size === value.evidenceRefs.length
  && isRecord(value.dimensions)
  && Object.values(value.dimensions).every((dimension) => typeof dimension === "string");

const overviewEvidenceLineage = (
  catalog: AnalysisContextEvidenceCatalog,
  usedFactIds: ReadonlySet<string>,
): PreschoolExecutiveOverviewEvidenceLineage => ({
  contract: catalog.contract,
  sourceId: catalog.sourceId,
  pins: { ...catalog.pins },
  factIds: catalog.facts.flatMap(({ id }) => usedFactIds.has(id) ? [id] : []),
  facts: catalog.facts.filter(({ id }) => usedFactIds.has(id)).map((fact) => ({
    ...fact,
    evidenceRefs: [...fact.evidenceRefs],
    dimensions: { ...fact.dimensions },
  })),
});

const sectionEvidenceOwners = (
  accepted: AcceptedSectionV4[],
): Map<string, Set<PreschoolSectionId>> => {
  const owners = new Map<string, Set<PreschoolSectionId>>();
  for (const { result } of accepted) {
    for (const reference of [
      ...result.summary.evidenceRefs,
      ...result.insights.flatMap(({ evidenceRefs }) => evidenceRefs),
    ]) {
      const sections = owners.get(reference) ?? new Set<PreschoolSectionId>();
      sections.add(result.sectionId);
      owners.set(reference, sections);
    }
  }
  return owners;
};

const parseAlert = (value: unknown): PreschoolOverviewKeyFinding["alert"] | undefined => {
  if (value === undefined) return undefined;
  if (!isRecord(value) || (value.severity !== "attention" && value.severity !== "urgent")) {
    throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_FACT_UNSUPPORTED");
  }
  const certainty = value.certainty === "confirmed" || value.certainty === "anomaly" || value.certainty === "possible"
    ? value.certainty
    : value.certainty === "observed"
      ? "anomaly"
      : value.certainty === "inferred" || value.certainty === "speculative"
        ? "possible"
        : null;
  if (!certainty) throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_FACT_UNSUPPORTED");
  return { severity: value.severity, certainty };
};

const validSectionInsightV4 = (value: unknown): boolean => isRecord(value)
  && Boolean(cleanText(value.id))
  && Boolean(cleanText(value.title))
  && (value.label === undefined || Boolean(cleanText(value.label)))
  && (value.epistemicStatus === "observed"
    || value.epistemicStatus === "inferred"
    || value.epistemicStatus === "speculative")
  && Boolean(cleanText(value.text))
  && Boolean(stringArray(value.evidenceRefs))
  && (value.deepDiveQuestion === undefined || Boolean(cleanText(value.deepDiveQuestion)));

const sameBinding = (
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

const collectNumbers = (values: unknown[]): number[] => values.flatMap((value) => {
  if (typeof value !== "string") return [];
  return [...value.matchAll(NUMBER_TOKEN)].map(([raw]) => Number(raw.replaceAll(",", "")));
});

const hasUnsupportedNumber = (text: string, supported: number[]): boolean =>
  [...text.replaceAll("−", "-").matchAll(NUMBER_TOKEN)].some((match) => {
    const token = match[0];
    const raw = token.replaceAll(",", "");
    const value = Number(raw);
    const precision = raw.includes(".") ? raw.length - raw.indexOf(".") - 1 : 0;
    const exactlySupported = supported.some((candidate) => reportedNumberMatches(candidate, value, precision));
    const downwardMagnitudeSupported = value >= 0
      && /\b(?:below|under|lower|down|decrease|decreased|reduction)\b/iu.test(
        text.slice(Math.max(0, (match.index ?? 0) - 24), (match.index ?? 0) + token.length + 32),
      )
      && supported.some((candidate) => candidate < 0
        && reportedNumberMatches(Math.abs(candidate), value, precision));
    return !exactlySupported && !downwardMagnitudeSupported;
  });

const reportedNumberMatches = (sourceValue: number, reportedValue: number, precision: number): boolean => {
  const tolerance = 0.5 * (10 ** -precision);
  const floatingPointSlack = Number.EPSILON
    * Math.max(1, Math.abs(sourceValue), Math.abs(reportedValue))
    * 8;
  return Math.abs(sourceValue - reportedValue) <= tolerance + floatingPointSlack;
};

const hasBannedCustomerText = (text: string): boolean =>
  BANNED_INTERNAL_TEXT.test(text) || SQL_STATEMENT.test(text);

const stripJsonFence = (value: string): string => value.trim()
  .replace(/^```(?:json)?\s*/i, "")
  .replace(/\s*```$/, "");

const stringArray = (value: unknown): string[] | null => Array.isArray(value)
  && value.every((item) => typeof item === "string" && Boolean(item.trim()))
  ? value as string[]
  : null;

const cleanText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const synthesisErrorCode = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, "_");
  return normalized.slice(0, 160) || "PRESCHOOL_EXECUTIVE_SYNTHESIS_FAILED";
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
