import type {
  EnergyIqOverviewAiArtifactIdentity,
  EnergyIqOverviewAiArtifactRecord,
  MetadataStore,
  UserRecord,
} from "@datafoundry/metadata";
import { randomUUID } from "node:crypto";

import {
  createPreschoolOverviewAiValueArtifactIdentity,
  type OverviewAiArtifactIdentityV13,
} from "./overview-ai-artifact.js";
import {
  PRESCHOOL_SECTION_IDS,
  preschoolOverviewAiBindingFromIdentity,
  type PreschoolSectionId,
  type PreschoolSectionInterpretationResult,
  type PreschoolSectionKeyPoint,
  type PreschoolSectionPack,
} from "./preschool-overview-ai-contracts.js";

const LEASE_MS = 4 * 60 * 1_000;
const MAX_BATCH_PROMPT_CHARS = 48_000;
const BANNED_CUSTOMER_TEXT = /\b(?:parent_node_id|dataSnapshotId|projectReleaseId|SELECT|FROM|JOIN|SQL)\b/i;

export type PreschoolSectionInterpreterBatchRunner = (input: {
  prompt: string;
  identity: EnergyIqOverviewAiArtifactIdentity;
  user: UserRecord;
  workspaceId: string;
  runId: string;
  sessionId: string;
}) => Promise<{ answer: string; runId: string; sessionId: string }>;

export type PreschoolSectionInterpreter = {
  execute(input: {
    baseIdentity: OverviewAiArtifactIdentityV13;
    packs: PreschoolSectionPack[];
    user: UserRecord;
    retryTargets?: PreschoolSectionId[];
  }): Promise<Record<PreschoolSectionId, EnergyIqOverviewAiArtifactRecord>>;
};

export const createPreschoolSectionInterpreter = (input: {
  metadataStore: MetadataStore;
  runBatch: PreschoolSectionInterpreterBatchRunner;
}): PreschoolSectionInterpreter => ({
  async execute({ baseIdentity, packs, user, retryTargets = [] }) {
    const packBySection = new Map(packs.map((pack) => [pack.sectionId, pack]));
    if (packBySection.size !== PRESCHOOL_SECTION_IDS.length
      || PRESCHOOL_SECTION_IDS.some((sectionId) => !packBySection.has(sectionId))) {
      throw new Error("PRESCHOOL_SECTION_PACK_SET_INCOMPLETE");
    }
    for (const pack of packs) requirePackBinding(pack, baseIdentity);
    const store = input.metadataStore.energyIq.overviewAiArtifacts;
    const identities = Object.fromEntries(PRESCHOOL_SECTION_IDS.map((sectionId) => [
      sectionId,
      createPreschoolOverviewAiValueArtifactIdentity({
        baseIdentity,
        artifactKind: "section-interpretation",
        targetId: sectionId,
      }),
    ])) as Record<PreschoolSectionId, EnergyIqOverviewAiArtifactIdentity>;
    const current = Object.fromEntries(PRESCHOOL_SECTION_IDS.map((sectionId) => [
      sectionId,
      store.find(identities[sectionId]) ?? store.queue({ identity: identities[sectionId], triggeredBy: user.id }),
    ])) as Record<PreschoolSectionId, EnergyIqOverviewAiArtifactRecord>;
    const retrySet = new Set(retryTargets);
    const claimed: Array<{
      sectionId: PreschoolSectionId;
      identity: EnergyIqOverviewAiArtifactIdentity;
      workerId: string;
    }> = [];

    for (const sectionId of PRESCHOOL_SECTION_IDS) {
      const artifact = current[sectionId];
      const shouldTry = artifact.status === "queued"
        || (artifact.status === "failed" && retrySet.has(sectionId));
      if (!shouldTry) continue;
      const workerId = `section-interpreter:${sectionId}:${randomUUID()}`;
      const claim = store.claim({ identity: identities[sectionId], workerId, leaseMs: LEASE_MS });
      current[sectionId] = claim.artifact;
      if (!claim.claimed) continue;
      if (packBySection.get(sectionId)!.evidence.length === 0) {
        current[sectionId] = store.fail({
          identity: identities[sectionId],
          workerId,
          errorCode: "PRESCHOOL_SECTION_PACK_EVIDENCE_UNAVAILABLE",
        });
        continue;
      }
      claimed.push({ sectionId, identity: identities[sectionId], workerId });
    }
    if (claimed.length === 0) return current;

    const sessionId = `preschool-section-interpreter-${randomUUID()}`;
    const runId = `preschool-section-interpreter-${randomUUID()}`;
    try {
      const prompt = buildSectionInterpreterPrompt(claimed.map(({ sectionId }) => packBySection.get(sectionId)!));
      const response = await input.runBatch({
        prompt,
        identity: baseIdentity,
        user,
        workspaceId: baseIdentity.workspaceId,
        runId,
        sessionId,
      });
      if (response.runId !== runId || response.sessionId !== sessionId) {
        throw new Error("PRESCHOOL_SECTION_INTERPRETER_RUN_IDENTITY_MISMATCH");
      }
      const parsed = parseBatchResponse(response.answer);
      for (const unit of claimed) {
        const pack = packBySection.get(unit.sectionId)!;
        const candidate = parsed.get(unit.sectionId);
        try {
          const result = materializeSectionResult({ candidate, pack, identity: unit.identity, runId });
          current[unit.sectionId] = store.complete({
            identity: unit.identity,
            workerId: unit.workerId,
            sessionId,
            runId,
            resultJson: JSON.stringify(result),
          });
        } catch (error) {
          current[unit.sectionId] = store.fail({
            identity: unit.identity,
            workerId: unit.workerId,
            errorCode: sectionErrorCode(error),
          });
        }
      }
      return current;
    } catch (error) {
      for (const unit of claimed) {
        try {
          current[unit.sectionId] = store.fail({
            identity: unit.identity,
            workerId: unit.workerId,
            errorCode: sectionErrorCode(error),
          });
        } catch {
          current[unit.sectionId] = store.get(unit.identity);
        }
      }
      return current;
    }
  },
});

const buildSectionInterpreterPrompt = (packs: PreschoolSectionPack[]): string => {
  const prompt = [
    "You are the Preschool Overview Section Interpreter, not an autonomous investigator.",
    "Use only the supplied Section Packs. Do not query SQL, infer new numbers, or add facts.",
    "Write plain English for a non-technical manager. Avoid internal field and revision names.",
    "For each section return status=available with a 1-2 sentence summary and 2-4 keyPoints, or status=empty when no useful interpretation is supported.",
    "Each keyPoint must use kind finding|meaning|next-check and copy one or more exact evidenceRefs from its own pack.",
    "Return JSON only: {\"sections\":[{\"sectionId\":string,\"status\":\"available\"|\"empty\",\"summary\"?:string,\"keyPoints\"?:[{\"kind\":string,\"label\"?:string,\"text\":string,\"evidenceRefs\":string[]}],\"limitation\"?:string}]}",
    `Section Packs: ${JSON.stringify(packs)}`,
  ].join("\n\n");
  if (prompt.length > MAX_BATCH_PROMPT_CHARS) throw new Error("PRESCHOOL_SECTION_INTERPRETER_PROMPT_TOO_LARGE");
  return prompt;
};

const parseBatchResponse = (answer: string): Map<PreschoolSectionId, unknown> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(answer));
  } catch {
    throw new Error("PRESCHOOL_SECTION_INTERPRETER_BATCH_MALFORMED");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.sections)) {
    throw new Error("PRESCHOOL_SECTION_INTERPRETER_BATCH_MALFORMED");
  }
  const bySection = new Map<PreschoolSectionId, unknown>();
  for (const candidate of parsed.sections) {
    if (!isRecord(candidate) || typeof candidate.sectionId !== "string"
      || !PRESCHOOL_SECTION_IDS.includes(candidate.sectionId as PreschoolSectionId)) continue;
    const sectionId = candidate.sectionId as PreschoolSectionId;
    if (!bySection.has(sectionId)) bySection.set(sectionId, candidate);
  }
  return bySection;
};

const materializeSectionResult = (input: {
  candidate: unknown;
  pack: PreschoolSectionPack;
  identity: EnergyIqOverviewAiArtifactIdentity;
  runId: string;
}): PreschoolSectionInterpretationResult => {
  if (!isRecord(input.candidate) || input.candidate.sectionId !== input.pack.sectionId) {
    throw new Error("PRESCHOOL_SECTION_INTERPRETATION_MISSING");
  }
  const binding = preschoolOverviewAiBindingFromIdentity(input.identity);
  if (input.candidate.status === "empty") {
    return {
      artifactKind: "section-interpretation",
      status: "empty",
      providerProfileId: input.identity.modelProfileId,
      runId: input.runId,
      contract: {
        id: "preschool-section-interpretation",
        revision: "preschool-section-interpretation-v1",
      },
      binding,
      sectionId: input.pack.sectionId,
      keyPoints: [],
    };
  }
  const summary = cleanText(input.candidate.summary);
  const keyPoints = parseKeyPoints(input.candidate.keyPoints);
  const limitation = optionalText(input.candidate.limitation);
  if (input.candidate.status !== "available" || !summary || !keyPoints
    || keyPoints.length < 2 || keyPoints.length > 4) {
    throw new Error("PRESCHOOL_SECTION_INTERPRETATION_MALFORMED");
  }
  const allowedEvidenceRefs = new Set(input.pack.evidence.flatMap(({ evidenceRefs }) => evidenceRefs));
  for (const point of keyPoints) {
    if (point.evidenceRefs.length === 0
      || point.evidenceRefs.some((reference) => !allowedEvidenceRefs.has(reference))) {
      throw new Error("PRESCHOOL_SECTION_INTERPRETATION_EVIDENCE_UNSUPPORTED");
    }
  }
  const narrative = [summary, ...keyPoints.flatMap(({ label, text }) => label ? [label, text] : [text]), limitation]
    .filter((value): value is string => Boolean(value));
  if (narrative.some((value) => BANNED_CUSTOMER_TEXT.test(value))
    || narrative.some((value) => hasUnsupportedNumber(value, input.pack))
    || narrative.some((value) => hasUnsupportedCentre(value, input.pack))) {
    throw new Error("PRESCHOOL_SECTION_INTERPRETATION_FACT_UNSUPPORTED");
  }
  return {
    artifactKind: "section-interpretation",
    status: "available",
    providerProfileId: input.identity.modelProfileId,
    runId: input.runId,
    contract: {
      id: "preschool-section-interpretation",
      revision: "preschool-section-interpretation-v1",
    },
    binding,
    sectionId: input.pack.sectionId,
    summary,
    keyPoints,
    ...(limitation ? { limitation } : {}),
  };
};

const parseKeyPoints = (value: unknown): PreschoolSectionKeyPoint[] | null => {
  if (!Array.isArray(value)) return null;
  const result: PreschoolSectionKeyPoint[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)
      || (candidate.kind !== "finding" && candidate.kind !== "meaning" && candidate.kind !== "next-check")) return null;
    const text = cleanText(candidate.text);
    const label = optionalText(candidate.label);
    if (!text || !Array.isArray(candidate.evidenceRefs)
      || !candidate.evidenceRefs.every((reference) => typeof reference === "string" && Boolean(reference.trim()))) return null;
    result.push({
      kind: candidate.kind,
      ...(label ? { label } : {}),
      text,
      evidenceRefs: [...new Set(candidate.evidenceRefs as string[])],
    });
  }
  return result;
};

const hasUnsupportedNumber = (text: string, pack: PreschoolSectionPack): boolean => {
  const supported = collectNumbers(pack.evidence.map(({ value }) => value));
  const tokens = [...text.matchAll(/(?<![A-Za-z0-9_-])-?\d+(?:\.\d+)?/g)];
  return tokens.some((match) => {
    const raw = match[0];
    const value = Number(raw);
    const precision = raw.includes(".") ? raw.length - raw.indexOf(".") - 1 : 0;
    const tolerance = 0.5 * (10 ** -precision);
    return !supported.some((candidate) => Math.abs(candidate - value) < tolerance
      || Math.abs(Number(candidate.toFixed(precision)) - value) < tolerance);
  });
};

const collectNumbers = (value: unknown): number[] => {
  if (typeof value === "number" && Number.isFinite(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(collectNumbers);
  if (isRecord(value)) return Object.values(value).flatMap(collectNumbers);
  return [];
};

const hasUnsupportedCentre = (text: string, pack: PreschoolSectionPack): boolean => {
  const supportedText = JSON.stringify(pack.evidence.map(({ value, entityRefs }) => ({ value, entityRefs }))).toLowerCase();
  const centres = [...text.matchAll(/\bCentre\s+[A-Z0-9][A-Z0-9-]*\b/gi)].map(([value]) => value.toLowerCase());
  return centres.some((centre) => !supportedText.includes(centre));
};

const requirePackBinding = (
  pack: PreschoolSectionPack,
  identity: EnergyIqOverviewAiArtifactIdentity,
): void => {
  if (pack.binding.workspaceId !== identity.workspaceId
    || pack.binding.projectId !== identity.projectId
    || pack.binding.scopeId !== identity.scopeId
    || pack.binding.dataSnapshotId !== identity.dataSnapshotId
    || pack.binding.projectReleaseId !== identity.projectReleaseId
    || pack.binding.analysisPeriod.from !== identity.analysisPeriodFrom
    || pack.binding.analysisPeriod.to !== identity.analysisPeriodTo
    || pack.binding.modelProfileId !== identity.modelProfileId
    || pack.binding.modelProfileRevision !== identity.modelProfileRevision) {
    throw new Error("PRESCHOOL_SECTION_PACK_IDENTITY_MISMATCH");
  }
};

const stripJsonFence = (value: string): string => value.trim()
  .replace(/^```(?:json)?\s*/i, "")
  .replace(/\s*```$/, "");

const cleanText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const optionalText = (value: unknown): string | undefined =>
  value === undefined ? undefined : cleanText(value) ?? undefined;

const sectionErrorCode = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, "_");
  return normalized.slice(0, 160) || "PRESCHOOL_SECTION_INTERPRETER_FAILED";
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
