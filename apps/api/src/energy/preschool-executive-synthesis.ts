import type {
  EnergyIqOverviewAiArtifactIdentity,
  EnergyIqOverviewAiArtifactRecord,
  MetadataStore,
  UserRecord,
} from "@datafoundry/metadata";
import { createHash, randomUUID } from "node:crypto";

import {
  createPreschoolOverviewAiValueArtifactIdentity,
  type OverviewAiArtifactIdentityV13,
} from "./overview-ai-artifact.js";
import {
  PRESCHOOL_SECTION_IDS,
  isPreschoolSectionId,
  preschoolOverviewAiBindingFromIdentity,
  type PreschoolExecutiveKeyFinding,
  type PreschoolExecutiveSynthesisResult,
  type PreschoolSectionId,
  type PreschoolSectionInterpretationResult,
} from "./preschool-overview-ai-contracts.js";

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
  result: PreschoolSectionInterpretationResult & { status: "available" };
};

export const createPreschoolExecutiveSynthesizer = (input: {
  metadataStore: MetadataStore;
  runSynthesis: PreschoolExecutiveSynthesisRunner;
  assertRuntimeIdentity?: (identity: EnergyIqOverviewAiArtifactIdentity) => void;
}): PreschoolExecutiveSynthesizer => ({
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
    ? [{ artifactId: artifact.id, result: result as PreschoolSectionInterpretationResult & { status: "available" } }]
    : [];
});

const parseAcceptedSection = (
  resultJson: string,
  identity: EnergyIqOverviewAiArtifactIdentity,
): PreschoolSectionInterpretationResult | null => {
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
  return parsed as unknown as PreschoolSectionInterpretationResult;
};

const buildExecutivePrompt = (accepted: AcceptedSection[]): string => {
  const prompt = [
    "You are the Preschool Overview Executive Key Findings synthesizer, not an investigator.",
    "Use only the accepted Section Interpretations below. Do not read raw Facts, query SQL, add a number, or add a fact.",
    "Combine duplicate management messages instead of copying each Section verbatim.",
    "Return 0-4 concise plain-English findings for a non-technical manager.",
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
