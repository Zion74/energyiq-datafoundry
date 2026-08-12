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
const MAX_BATCH_PROMPT_CHARS = 12_000;
const BANNED_INTERNAL_TEXT = /\b(?:parent_node_id|dataSnapshotId|projectReleaseId|SQL)\b/i;
const SQL_STATEMENT = /\bSELECT\b[\s\S]{0,500}\b(?:FROM|JOIN)\b/i;
const NUMBER_TOKEN = /(?<![A-Za-z0-9_-])-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g;
const LOCAL_DATE_TOKEN = /\b\d{4}-\d{2}-\d{2}\b/g;
const LOCAL_TIME_TOKEN = /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g;
const LOCAL_DATE_VALUE = /^\d{4}-\d{2}-\d{2}$/;

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
  assertRuntimeIdentity?: (identity: EnergyIqOverviewAiArtifactIdentity) => void;
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
      claimed.push({ sectionId, identity: identities[sectionId], workerId });
    }
    if (claimed.length === 0) return current;

    const sessionId = `preschool-section-interpreter-${randomUUID()}`;
    const runId = `preschool-section-interpreter-${randomUUID()}`;
    try {
      const prompt = buildSectionInterpreterPrompt(claimed.map(({ sectionId }) => packBySection.get(sectionId)!));
      const response = await input.runBatch({
        prompt,
        identity: claimed[0]!.identity,
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
          input.assertRuntimeIdentity?.(unit.identity);
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
  const promptPacks = packs.map(projectPackForPrompt);
  const sharedBinding = packs[0]?.binding;
  if (!sharedBinding) throw new Error("PRESCHOOL_SECTION_PACK_SET_INCOMPLETE");
  const prompt = [
    "You are the Preschool Overview Section Interpreter, not an autonomous investigator.",
    "Use only the supplied Section Packs. Do not query SQL, infer new numbers, or add facts.",
    "Write plain English for a non-technical manager. Avoid internal field and revision names.",
    "For each section return status=available with a 1-2 sentence summary and 2-4 keyPoints, or status=empty when no useful interpretation is supported.",
    "Each keyPoint must use kind finding|meaning|next-check and copy one or more exact evidenceRefs from its own pack.",
    "When naming a Centre and its leading circuit, make only one Centre-to-circuit relationship per keyPoint and cite that Centre's exact Evidence item.",
    "Do not calculate, round, combine, or compare numbers beyond exact values already supplied. Do not hypothesize a cause.",
    "Do not create combined totals or shares from multiple Evidence items. Describe the items separately or without a synthesized number.",
    `The prompt contains exactly ${promptPacks.length} complete bounded Section Pack projections; none are truncated. Return exactly ${promptPacks.length} sections in the same order.`,
    `Required sectionId sequence: ${JSON.stringify(promptPacks.map(({ sectionId }) => sectionId))}. Do not substitute any other sectionId.`,
    `Artifact pin for runtime validation only; do not repeat it in customer text: ${JSON.stringify({
      workspaceId: sharedBinding.workspaceId,
      projectId: sharedBinding.projectId,
      scopeId: sharedBinding.scopeId,
      dataSnapshotId: sharedBinding.dataSnapshotId,
      projectReleaseId: sharedBinding.projectReleaseId,
      analysisPeriod: sharedBinding.analysisPeriod,
    })}`,
    "Return only one JSON object with no preface, afterword, or Markdown: {\"sections\":[{\"sectionId\":string,\"status\":\"available\"|\"empty\",\"summary\"?:string,\"keyPoints\"?:[{\"kind\":string,\"label\"?:string,\"text\":string,\"evidenceRefs\":string[]}],\"limitation\"?:string}]}",
    `Section Packs: ${JSON.stringify(promptPacks)}`,
  ].join("\n\n");
  if (prompt.length > MAX_BATCH_PROMPT_CHARS) throw new Error("PRESCHOOL_SECTION_INTERPRETER_PROMPT_TOO_LARGE");
  return prompt;
};

const parseBatchResponse = (answer: string): Map<PreschoolSectionId, unknown> => {
  const parsed = parseSectionsEnvelope(answer);
  if (!parsed) {
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

const projectPackForPrompt = (pack: PreschoolSectionPack) => ({
  sectionId: pack.sectionId,
  decisionQuestion: pack.decisionQuestion,
  evidence: pack.evidence.map((evidence) => ({
    value: projectEvidenceValue(pack.sectionId, evidence.value),
    ...(evidence.unit ? { unit: evidence.unit } : {}),
    evidenceRefs: [evidence.id],
  })),
  limitations: pack.limitations,
  allowedNextChecks: pack.allowedNextChecks,
});

const projectEvidenceValue = (sectionId: PreschoolSectionId, value: unknown): unknown => {
  if (!isRecord(value)) return value;
  if (sectionId === "centre-benchmark" || sectionId === "standby-wastage" || sectionId === "operating-behaviour") {
    if (isRecord(value.worstSpike)) {
      return roundPromptNumbers({
        ...pick(value, ["centreCode", "name", "spikeCount"]),
        worstSpike: pick(value.worstSpike, [
          "localDate",
          "localHour",
          "usageKwh",
          "impactKwh",
          "variancePct",
          "leadingCircuitName",
          "leadingCircuitKwh",
          "leadingCircuitSharePct",
        ]),
      });
    }
    return roundPromptNumbers(value);
  }
  const plan = isRecord(value.plan) ? value.plan : {};
  const actual = isRecord(value.actual) ? value.actual : {};
  const forecast = isRecord(value.forecast) ? value.forecast : {};
  const tariff = isRecord(forecast.tariffAssumption) ? forecast.tariffAssumption : {};
  const portfolio = isRecord(forecast.portfolio) ? forecast.portfolio : {};
  return roundPromptNumbers({
    targetPeriod: value.targetPeriod,
    plan: {
      usageEstimate: plan.usageEstimate,
      costEstimate: plan.costEstimate,
    },
    actual: pick(actual, ["status", "usageKwh", "completeDayCount", "targetDayCount", "varianceKwh", "variancePct"]),
    forecast: {
      status: forecast.status,
      tariffAssumption: pick(tariff, [
        "status",
        "beforeGstSgdPerKwh",
        "appliesFrom",
        "appliesTo",
        "notBill",
      ]),
      portfolio: pick(portfolio, [
        "estimatedKwh",
        "estimatedCostBeforeGstSgd",
        "expectedFullMonthKwh",
        "expectedFullMonthCostBeforeGstSgd",
        "actualKwh",
        "actualCostBeforeGstSgd",
        "actualThroughLocalDate",
        "pacePct",
        "outcome",
      ]),
    },
  });
};

const roundPromptNumbers = (value: unknown): unknown => {
  if (typeof value === "number" && Number.isFinite(value)) return Number(value.toFixed(4));
  if (Array.isArray(value)) return value.map(roundPromptNumbers);
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, roundPromptNumbers(item)]));
  return value;
};

const pick = (value: Record<string, unknown>, keys: string[]): Record<string, unknown> => Object.fromEntries(
  keys.flatMap((key) => value[key] === undefined ? [] : [[key, value[key]]]),
);

const parseSectionsEnvelope = (answer: string): (Record<string, unknown> & { sections: unknown[] }) | null => {
  const candidates = [stripJsonFence(answer), ...jsonObjectCandidates(answer)];
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (isRecord(parsed) && Array.isArray(parsed.sections)) {
        return parsed as Record<string, unknown> & { sections: unknown[] };
      }
    } catch {
      // A Provider may wrap the JSON object in brief prose; keep searching balanced objects.
    }
  }
  return null;
};

const jsonObjectCandidates = (value: string): string[] => {
  const candidates: string[] = [];
  for (let start = value.indexOf("{"); start >= 0; start = value.indexOf("{", start + 1)) {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < value.length; index += 1) {
      const character = value[index]!;
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          candidates.push(value.slice(start, index + 1));
          break;
        }
      }
    }
  }
  return candidates;
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
    const citedEvidence = input.pack.evidence.filter((evidence) =>
      point.evidenceRefs.some((reference) => evidence.id === reference || evidence.evidenceRefs.includes(reference)));
    const pointNarrative = point.label ? [point.label, point.text] : [point.text];
    if (citedEvidence.length === 0
      || pointNarrative.some((value) => hasUnsupportedTemporalClaim(value, citedEvidence))
      || pointNarrative.some((value) => hasUnsupportedNumber(value, citedEvidence))
      || pointNarrative.some((value) => hasUnsupportedUnit(value, citedEvidence))
      || pointNarrative.some((value) => hasUnsupportedCentre(value, citedEvidence))
      || pointNarrative.some((value) => hasUnsupportedRelation(value, citedEvidence, input.pack.evidence))) {
      throw new Error("PRESCHOOL_SECTION_INTERPRETATION_FACT_UNSUPPORTED");
    }
  }
  const narrative = [summary, limitation]
    .filter((value): value is string => Boolean(value));
  if (narrative.some(hasBannedCustomerText)
    || keyPoints.some(({ label, text }) => [label, text].some((value) => Boolean(value) && hasBannedCustomerText(value!)))
    || narrative.some((value) => hasUnsupportedTemporalClaim(value, input.pack.evidence))
    || narrative.some((value) => hasUnsupportedNumber(value, input.pack.evidence))
    || narrative.some((value) => hasUnsupportedUnit(value, input.pack.evidence))
    || narrative.some((value) => hasUnsupportedCentre(value, input.pack.evidence))
    || narrative.some((value) => hasUnsupportedRelation(value, input.pack.evidence))) {
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

const hasUnsupportedNumber = (text: string, evidence: PreschoolSectionPack["evidence"]): boolean => {
  const supported = collectNumbers(evidence.map(({ value }) => value));
  const numericText = text.replace(LOCAL_DATE_TOKEN, "").replace(LOCAL_TIME_TOKEN, "");
  const tokens = [...numericText.matchAll(NUMBER_TOKEN)];
  return tokens.some((match) => {
    const raw = match[0].replaceAll(",", "");
    const value = Number(raw);
    const precision = raw.includes(".") ? raw.length - raw.indexOf(".") - 1 : 0;
    const tolerance = 0.5 * (10 ** -precision);
    return !supported.some((candidate) => Math.abs(candidate - value) < tolerance
      || Math.abs(Number(candidate.toFixed(precision)) - value) < tolerance);
  });
};

const hasUnsupportedTemporalClaim = (
  text: string,
  evidence: PreschoolSectionPack["evidence"],
): boolean => {
  const supported = collectTemporalClaims(evidence.map(({ value }) => value));
  const dates = [...text.matchAll(LOCAL_DATE_TOKEN)].map(([value]) => value);
  if (dates.some((date) => !supported.dates.has(date))) return true;
  const times = [...text.matchAll(LOCAL_TIME_TOKEN)].map(([value]) => value);
  return times.some((time) => {
    const separator = time.indexOf(":");
    const hour = Number(time.slice(0, separator));
    const minute = Number(time.slice(separator + 1));
    return minute !== 0 || !supported.hours.has(hour);
  });
};

const hasUnsupportedUnit = (text: string, evidence: PreschoolSectionPack["evidence"]): boolean => {
  const supportedUnits = evidence.flatMap(({ unit }) => unit ? [unit.toLowerCase()] : []);
  const claimedUnits = [
    /(?:\bSGD\b|S\$)/iu.test(text) ? "sgd" : null,
    /\bkWh\b/iu.test(text) ? "kwh" : null,
    /\bkW\b/iu.test(text) ? "kw" : null,
    /(?:%|\bpercent(?:age)?\b)/iu.test(text) ? "%" : null,
  ].filter((unit): unit is string => unit !== null);
  return claimedUnits.some((claimed) => !supportedUnits.some((unit) => unit.includes(claimed)));
};

const collectNumbers = (value: unknown): number[] => {
  if (typeof value === "number" && Number.isFinite(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(collectNumbers);
  if (isRecord(value)) return Object.values(value).flatMap(collectNumbers);
  return [];
};

const collectTemporalClaims = (value: unknown): { dates: Set<string>; hours: Set<number> } => {
  const dates = new Set<string>();
  const hours = new Set<number>();
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (!isRecord(candidate)) return;
    for (const [key, item] of Object.entries(candidate)) {
      if ((key === "localDate" || key === "actualThroughLocalDate")
        && typeof item === "string" && LOCAL_DATE_VALUE.test(item)) dates.add(item);
      if (key === "localHour" && typeof item === "number"
        && Number.isInteger(item) && item >= 0 && item <= 23) hours.add(item);
      visit(item);
    }
  };
  visit(value);
  return { dates, hours };
};

const hasUnsupportedCentre = (text: string, evidence: PreschoolSectionPack["evidence"]): boolean => {
  const supportedText = JSON.stringify(evidence.map(({ value, entityRefs }) => ({ value, entityRefs }))).toLowerCase();
  const centres = [...text.matchAll(/\bCentre\s+[A-Z0-9][A-Z0-9-]*\b/gi)].map(([value]) => value.toLowerCase());
  return centres.some((centre) => !supportedText.includes(centre));
};

const hasUnsupportedRelation = (
  text: string,
  evidence: PreschoolSectionPack["evidence"],
  knownEvidence: PreschoolSectionPack["evidence"] = evidence,
): boolean => {
  const relations = evidence.flatMap(({ claimRelations }) => claimRelations ?? []);
  const knownRelations = knownEvidence.flatMap(({ claimRelations }) => claimRelations ?? []);
  if (knownRelations.length === 0) return false;
  const normalized = text.toLowerCase();
  const subjects = [...new Set(knownRelations
    .map(({ subject }) => subject)
    .filter((subject) => normalized.includes(subject.toLowerCase())))];
  const objects = [...new Set(knownRelations
    .map(({ object }) => object)
    .filter((object) => normalized.includes(object.toLowerCase())))];
  if (subjects.length === 0 || objects.length === 0) return false;
  const isSupported = (subject: string, object: string): boolean => relations.some((relation) =>
    relation.subject.toLowerCase() === subject.toLowerCase()
      && relation.object.toLowerCase() === object.toLowerCase());
  if (subjects.length === 1 && objects.length === 1) return !isSupported(subjects[0]!, objects[0]!);

  return normalized.split(/[.!?;,]|\b(?:while|whereas)\b/iu).some((clause) => {
    const clauseSubjects = subjects.filter((subject) => clause.includes(subject.toLowerCase()));
    const clauseObjects = objects.filter((object) => clause.includes(object.toLowerCase()));
    if (clauseSubjects.length === 0 || clauseObjects.length === 0) return false;
    return clauseSubjects.some((subject) => clauseObjects.some((object) => !isSupported(subject, object)));
  });
};

const hasBannedCustomerText = (text: string): boolean =>
  BANNED_INTERNAL_TEXT.test(text) || SQL_STATEMENT.test(text);

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
