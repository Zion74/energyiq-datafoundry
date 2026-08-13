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
  type PreschoolExecutiveSynthesisResultV4,
  type PreschoolExecutiveSynthesisResult,
  type PreschoolOverviewKeyFinding,
  type PreschoolSectionId,
  type PreschoolSectionInterpretationResultV3,
  type PreschoolSectionInterpretationResultV4,
} from "./preschool-overview-ai-contracts.js";
import { resolveOverviewAiStageStructuredOutputV4 } from "./preschool-overview-ai-structured-output.js";

const LEASE_MS = 3 * 60 * 1_000;
const MAX_PROMPT_CHARS = 24_000;
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

type AuthoritativeOverviewEvidence = {
  evidenceRefs: string[];
  promptContext?: unknown;
};

export const createPreschoolExecutiveSynthesizer = (input: {
  metadataStore: MetadataStore;
  runSynthesis: PreschoolExecutiveSynthesisRunner;
  assertRuntimeIdentity?: (identity: EnergyIqOverviewAiArtifactIdentity) => void;
  revision?: "v3" | "v4";
  authoritativeOverviewEvidence?: AuthoritativeOverviewEvidence;
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
  authoritativeOverviewEvidence?: AuthoritativeOverviewEvidence;
}): PreschoolExecutiveSynthesizer => ({
  async execute({ baseIdentity, user, retry }) {
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
      const response = await input.runSynthesis({
        prompt: buildExecutivePromptV4(accepted, input.authoritativeOverviewEvidence),
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
        ...(input.authoritativeOverviewEvidence
          ? { authoritativeOverviewEvidence: input.authoritativeOverviewEvidence }
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
  if (prompt.length > MAX_PROMPT_CHARS) throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_PROMPT_TOO_LARGE");
  return prompt;
};

const buildExecutivePromptV4 = (
  accepted: AcceptedSectionV4[],
  authoritativeOverviewEvidence?: AuthoritativeOverviewEvidence,
): string => {
  const prompt = [
    "You are the Preschool Overview Key Findings synthesizer, not a new investigator.",
    "Use only the accepted current-v4 Section summaries and insights below, plus any explicitly supplied authoritative Overview Evidence.",
    "Select the few cross-Section themes that matter most. Do not mechanically rewrite every Section or invent a cause, number, date, entity relationship, or action.",
    "Return one concise answer-first summary and 0-3 compact findings. A high-priority alert is optional and must be supported by the supplied Evidence.",
    "Narrative text may use only limited inline **bold** and _italics_; do not return headings, links, images, HTML, code, tables, or custom styling.",
    "Every summary and finding must cite exact evidenceRefs. Every finding must declare the exact contributing sectionIds.",
    "Return JSON only: {\"status\":\"available\"|\"empty\",\"summary\"?:{\"text\":string,\"evidenceRefs\":string[]},\"findings\":[{\"title\":string,\"text\":string,\"sectionIds\":string[],\"evidenceRefs\":string[],\"alert\"?:{\"severity\":\"attention\"|\"urgent\",\"certainty\":\"confirmed\"|\"anomaly\"|\"possible\"}}]}",
    `Binding: ${JSON.stringify(accepted[0]!.result.binding)}`,
    `Accepted Sections: ${JSON.stringify(accepted.map(({ result }) => ({
      sectionId: result.sectionId,
      summary: result.summary,
      insights: result.insights,
      ...(result.limitation ? { limitation: result.limitation } : {}),
    })))}`,
    ...(authoritativeOverviewEvidence ? [
      `Authoritative Overview Evidence: ${JSON.stringify(authoritativeOverviewEvidence)}`,
    ] : []),
  ].join("\n\n");
  if (prompt.length > MAX_PROMPT_CHARS) throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_PROMPT_TOO_LARGE");
  return prompt;
};

const materializeExecutiveResultV4 = (input: {
  answer: string;
  accepted: AcceptedSectionV4[];
  identity: EnergyIqOverviewAiArtifactIdentity;
  runId: string;
  authoritativeOverviewEvidence?: AuthoritativeOverviewEvidence;
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
  const summaryEvidenceRefs = stringArray(parsed.summary.evidenceRefs);
  if (!summaryText || !summaryEvidenceRefs || summaryEvidenceRefs.length === 0
    || hasBannedCustomerText(summaryText)) {
    throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_FACT_UNSUPPORTED");
  }
  const acceptedBySection = new Map(input.accepted.map((accepted) => [accepted.result.sectionId, accepted]));
  const evidenceOwners = sectionEvidenceOwners(input.accepted);
  const authoritativeEvidence = new Set(input.authoritativeOverviewEvidence?.evidenceRefs ?? []);
  const sourceNumbers = collectNumbers(input.accepted.flatMap(({ result }) => [
    result.summary.text,
    ...result.insights.flatMap(({ title, label, text }) => label ? [title, label, text] : [title, text]),
    result.limitation,
  ]));
  const requireSupportedEvidence = (reference: string): Set<PreschoolSectionId> => {
    const owners = evidenceOwners.get(reference);
    if (owners) return owners;
    if (authoritativeEvidence.has(reference)) return new Set();
    throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_EVIDENCE_UNSUPPORTED");
  };
  const contributingSections = new Set<PreschoolSectionId>();
  for (const reference of summaryEvidenceRefs) {
    for (const sectionId of requireSupportedEvidence(reference)) contributingSections.add(sectionId);
  }
  if (hasUnsupportedNumber(summaryText, sourceNumbers)) {
    throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_FACT_UNSUPPORTED");
  }
  const findings: PreschoolOverviewKeyFinding[] = parsed.findings.map((candidate, index) => {
    if (!isRecord(candidate)) throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_MALFORMED");
    const title = cleanText(candidate.title);
    const text = cleanText(candidate.text);
    const sectionIds = stringArray(candidate.sectionIds)?.filter(isPreschoolSectionId);
    const evidenceRefs = stringArray(candidate.evidenceRefs);
    if (!title || !text || !sectionIds || sectionIds.length === 0
      || sectionIds.length !== (candidate.sectionIds as unknown[]).length
      || sectionIds.some((sectionId) => !acceptedBySection.has(sectionId))
      || !evidenceRefs || evidenceRefs.length === 0
      || hasBannedCustomerText(title) || hasBannedCustomerText(text)
      || hasUnsupportedNumber(`${title} ${text}`, sourceNumbers)) {
      throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_FACT_UNSUPPORTED");
    }
    const declaredSections = new Set(sectionIds);
    for (const reference of evidenceRefs) {
      const owners = requireSupportedEvidence(reference);
      if (owners.size > 0 && ![...owners].some((sectionId) => declaredSections.has(sectionId))) {
        throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_EVIDENCE_UNSUPPORTED");
      }
    }
    for (const sectionId of declaredSections) contributingSections.add(sectionId);
    const alert = parseAlert(candidate.alert);
    return {
      id: `overview-key-finding-${index + 1}`,
      title,
      text,
      sectionIds: [...declaredSections],
      evidenceRefs: [...new Set(evidenceRefs)],
      ...(alert ? { alert } : {}),
    };
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
    summary: { text: summaryText, evidenceRefs: [...new Set(summaryEvidenceRefs)] },
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
  if (!isRecord(value)
    || (value.severity !== "attention" && value.severity !== "urgent")
    || (value.certainty !== "confirmed" && value.certainty !== "anomaly" && value.certainty !== "possible")) {
    throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_FACT_UNSUPPORTED");
  }
  return { severity: value.severity, certainty: value.certainty };
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
  [...text.matchAll(NUMBER_TOKEN)].some(([token]) => {
    const raw = token.replaceAll(",", "");
    const value = Number(raw);
    const precision = raw.includes(".") ? raw.length - raw.indexOf(".") - 1 : 0;
    const tolerance = 0.5 * (10 ** -precision);
    return !supported.some((candidate) => Math.abs(candidate - value) < tolerance
      || Math.abs(Number(candidate.toFixed(precision)) - value) < tolerance);
  });

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
