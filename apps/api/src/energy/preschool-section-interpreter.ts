import type {
  EnergyIqOverviewAiArtifactIdentity,
  EnergyIqOverviewAiArtifactRecord,
  MetadataStore,
  UserRecord,
} from "@datafoundry/metadata";
import { randomUUID } from "node:crypto";

import {
  createPreschoolOverviewAiSectionArtifactIdentityV3,
  createPreschoolOverviewAiSectionArtifactIdentityV4,
  type OverviewAiArtifactIdentityV13,
} from "./overview-ai-artifact.js";
import {
  PRESCHOOL_SECTION_IDS,
  preschoolOverviewAiBindingFromIdentity,
  type PreschoolSectionCandidateRejectionCodeV4,
  type PreschoolSectionId,
  type PreschoolSectionInterpretationResult,
  type PreschoolSectionInterpretationResultV4,
  type PreschoolSectionInsightCandidateV4,
  type PreschoolSectionInsightToolNameV4,
  type PreschoolSectionKeyPoint,
  type PreschoolSectionPack,
  type PreschoolSectionSummaryV4,
  type PreschoolSectionToolAuditV4,
} from "./preschool-overview-ai-contracts.js";
import { acceptPreschoolSectionInterpretation } from "./preschool-section-acceptance.js";
import {
  parsePreschoolSectionDiscoveryV4,
  projectPreschoolSectionPackV2ForModel,
} from "./preschool-section-discovery.js";
import type { PreschoolSectionPackV2 } from "./preschool-section-pack-v2.js";
import {
  createPreschoolSectionInsightRuntime,
  type PreschoolSectionInsightToolInvocation,
  type PreschoolSectionInsightToolResult,
} from "./preschool-section-insight-runtime.js";
import { publishPreschoolSectionInterpretation } from "./preschool-section-publication.js";
import { resolveOverviewAiStageStructuredOutputV4 } from "./preschool-overview-ai-structured-output.js";

const LEASE_MS = 4 * 60 * 1_000;
const MAX_SECTION_PROMPT_CHARS = 12_000;
const MAX_SECTION_DISCOVERY_PROMPT_CHARS = 110_000;
const MAX_CONCURRENT_SECTION_RUNS = 2;
const BANNED_INTERNAL_TEXT = /\b(?:parent_node_id|dataSnapshotId|projectReleaseId|SQL)\b/i;
const SQL_STATEMENT = /\bSELECT\b[\s\S]{0,500}\b(?:FROM|JOIN)\b/i;
const NUMBER_TOKEN = /(?<![A-Za-z0-9_-])-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g;
const LOCAL_DATE_TOKEN = /\b\d{4}-\d{2}-\d{2}\b/g;
const NATURAL_DATE_TOKEN = /\b(?:[1-9]|[12]\d|3[01])\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/giu;
const MONTH_YEAR_TOKEN = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/giu;
const LOCAL_TIME_TOKEN = /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g;
const LOCAL_DATE_VALUE = /^\d{4}-\d{2}-\d{2}$/;

export type PreschoolSectionInterpreterRunner = (input: {
  prompt: string;
  identity: EnergyIqOverviewAiArtifactIdentity;
  user: UserRecord;
  workspaceId: string;
  runId: string;
  sessionId: string;
  structuredOutput?: NonNullable<ReturnType<typeof resolveOverviewAiStageStructuredOutputV4>>;
  sectionInsightTools?: readonly PreschoolSectionInsightToolNameV4[];
  invokeSectionInsightTool?: (
    invocation: PreschoolSectionInsightToolInvocation,
  ) => Promise<PreschoolSectionInsightToolResult>;
}) => Promise<{ answer: string; runId: string; sessionId: string }>;

/** @deprecated Test/replay compatibility only; production uses one runner call per Section. */
export type PreschoolSectionInterpreterBatchRunner = PreschoolSectionInterpreterRunner;

export type PreschoolSectionInterpreter = {
  execute(input: {
    baseIdentity: OverviewAiArtifactIdentityV13;
    packs: PreschoolSectionPack[] | PreschoolSectionPackV2[];
    user: UserRecord;
    retryTargets?: PreschoolSectionId[];
  }): Promise<Record<PreschoolSectionId, EnergyIqOverviewAiArtifactRecord>>;
};

export const createPreschoolSectionInterpreter = (input: {
  metadataStore: MetadataStore;
  assertRuntimeIdentity?: (identity: EnergyIqOverviewAiArtifactIdentity) => void;
} & (
  | { runSection: PreschoolSectionInterpreterRunner; runBatch?: never }
  | { runSection?: never; runBatch: PreschoolSectionInterpreterBatchRunner }
)): PreschoolSectionInterpreter => {
  const runSection = input.runSection ?? input.runBatch;
  const withSectionRunSlot = createConcurrencyGate(MAX_CONCURRENT_SECTION_RUNS);
  return ({
  async execute({ baseIdentity, packs, user, retryTargets = [] }) {
    const usesPackV2 = packs.every(isPackV2);
    if (!usesPackV2 && packs.some(isPackV2)) {
      throw new Error("PRESCHOOL_SECTION_PACK_REVISIONS_MIXED");
    }
    const packBySection = new Map(packs.map((pack) => [pack.sectionId, pack]));
    if (packBySection.size !== PRESCHOOL_SECTION_IDS.length
      || PRESCHOOL_SECTION_IDS.some((sectionId) => !packBySection.has(sectionId))) {
      throw new Error("PRESCHOOL_SECTION_PACK_SET_INCOMPLETE");
    }
    for (const pack of packs) requirePackBinding(pack, baseIdentity);
    const store = input.metadataStore.energyIq.overviewAiArtifacts;
    const identities = Object.fromEntries(PRESCHOOL_SECTION_IDS.map((sectionId) => [
      sectionId,
      usesPackV2
        ? createPreschoolOverviewAiSectionArtifactIdentityV4({ baseIdentity, targetId: sectionId })
        : createPreschoolOverviewAiSectionArtifactIdentityV3({ baseIdentity, targetId: sectionId }),
    ])) as Record<PreschoolSectionId, EnergyIqOverviewAiArtifactIdentity>;
    const current = Object.fromEntries(PRESCHOOL_SECTION_IDS.map((sectionId) => [
      sectionId,
      store.find(identities[sectionId]) ?? store.queue({ identity: identities[sectionId], triggeredBy: user.id }),
    ])) as Record<PreschoolSectionId, EnergyIqOverviewAiArtifactRecord>;
    const retrySet = new Set(retryTargets);
    const candidates: Array<{
      sectionId: PreschoolSectionId;
      identity: EnergyIqOverviewAiArtifactIdentity;
      previousErrorCode?: string;
    }> = [];

    for (const sectionId of PRESCHOOL_SECTION_IDS) {
      const artifact = current[sectionId];
      const shouldTry = artifact.status === "queued"
        || (artifact.status === "failed" && retrySet.has(sectionId));
      if (!shouldTry) continue;
      candidates.push({
        sectionId,
        identity: identities[sectionId],
        ...(artifact.status === "failed" && artifact.error_code
          ? { previousErrorCode: artifact.error_code }
          : {}),
      });
    }
    if (candidates.length === 0) return current;

    const settlements = await Promise.allSettled(candidates.map((unit) => withSectionRunSlot(async () => {
      const workerId = `section-interpreter:${unit.sectionId}:${randomUUID()}`;
      const claim = store.claim({ identity: unit.identity, workerId, leaseMs: LEASE_MS });
      current[unit.sectionId] = claim.artifact;
      if (!claim.claimed) return;
      const pack = packBySection.get(unit.sectionId)!;
      const sessionId = `preschool-section-interpreter-${unit.sectionId}-${randomUUID()}`;
      const runId = `preschool-section-interpreter-${unit.sectionId}-${randomUUID()}`;
      const toolAudits: PreschoolSectionToolAuditV4[] = [];
      const insightRuntime = isPackV2(pack)
        ? createPreschoolSectionInsightRuntime({
            pack,
            runId,
            createAuditId: () => `preschool-section-tool-audit-${randomUUID()}`,
          })
        : undefined;
      try {
        const response = await runSection({
          prompt: isPackV2(pack)
            ? buildPreschoolSectionDiscoveryPrompt(pack, unit.previousErrorCode)
            : buildSectionInterpreterPrompt(pack, unit.previousErrorCode),
          identity: unit.identity,
          user,
          workspaceId: baseIdentity.workspaceId,
          runId,
          sessionId,
          ...(isPackV2(pack)
            ? {
                structuredOutput: resolveOverviewAiStageStructuredOutputV4("section-interpreter")!,
                sectionInsightTools: [...pack.capabilities.tools],
                invokeSectionInsightTool: async (invocation: PreschoolSectionInsightToolInvocation) => {
                  const result = await insightRuntime!.invoke(invocation);
                  toolAudits.push(structuredClone(result.audit));
                  return result;
                },
              }
            : {}),
        });
        if (response.runId !== runId || response.sessionId !== sessionId) {
          throw new Error("PRESCHOOL_SECTION_INTERPRETER_RUN_IDENTITY_MISMATCH");
        }
        const result = isPackV2(pack)
          ? materializePreschoolSectionResultV4({
              answer: response.answer,
              pack,
              identity: unit.identity,
              runId,
              toolAudits,
            })
          : materializeSectionResult({
              candidate: parseSectionResponse(response.answer, unit.sectionId),
              pack,
              identity: unit.identity,
              runId,
            });
        input.assertRuntimeIdentity?.(unit.identity);
        current[unit.sectionId] = store.complete({
          identity: unit.identity,
          workerId,
          sessionId,
          runId,
          resultJson: JSON.stringify(result),
        });
      } catch (error) {
        try {
          current[unit.sectionId] = store.fail({
            identity: unit.identity,
            workerId,
            errorCode: sectionErrorCode(error),
          });
        } catch {
          current[unit.sectionId] = store.get(unit.identity);
        }
      }
    })));
    const unexpected = settlements.find((settlement): settlement is PromiseRejectedResult =>
      settlement.status === "rejected");
    if (unexpected) throw unexpected.reason;
    return current;
  },
  });
};

const buildSectionInterpreterPrompt = (
  pack: PreschoolSectionPack,
  previousErrorCode?: string,
): string => {
  const promptPack = projectPackForPrompt(pack);
  const prompt = [
    "You are the Preschool Overview Section Interpreter, not an autonomous investigator.",
    "Use only the supplied Section Packs. Do not query SQL, infer new numbers, or add facts.",
    "Write plain English for a non-technical manager. Avoid internal field and revision names.",
    "Narrative string fields may use limited inline Markdown only: **bold** for the few words carrying the decision, and _italics_ for a caveat. Keep most text unformatted. Do not use headings, lists, links, images, code, HTML, or Markdown tables.",
    "Add management value instead of mechanically restating the pageCoverage labels or every visible KPI.",
    "Return status=empty with no keyPoints when this Pack supports no useful incremental interpretation.",
    "When status=available, return a 1-2 sentence summary and 1-4 useful keyPoints. Choose the number, kind, and order based on value; do not force one of each kind.",
    "A useful keyPoint adds at least one of: priority, business meaning, an Evidence-backed next check, or a material limitation. Do not invent an action to fill a slot.",
    "Each keyPoint must copy one or more exact evidenceRefs from its own pack. If it discusses multiple Evidence items, cite every Evidence item discussed; otherwise discuss only one.",
    "When naming a Centre and its leading circuit, make only one Centre-to-circuit relationship per keyPoint and cite that Centre's exact Evidence item.",
    "When mentioning a date, use the exact supplied YYYY-MM-DD or its equivalent D Month YYYY rendering. When mentioning an hour, copy localHour as HH:00; do not rewrite hours as 1am, 11pm, noon, or midday.",
    "Prefer useful qualitative wording over extra numbers. If a number is necessary, copy one exact supplied value; do not calculate, round, combine, derive a range, or compare values beyond an explicit supplied field.",
    "Do not create combined totals or shares from multiple Evidence items. Describe the items separately or without a synthesized number.",
    "A pacePct field describes energy usage pace only. Never apply it to cost, and never calculate its complement as an ahead/behind percentage.",
    "Do not claim a top, highest, largest, ahead, behind, likely cause, or combined contribution unless those exact meanings are explicit in the cited Evidence. A question about what to verify is allowed when it matches allowedNextChecks.",
    previousErrorCode
      ? `Previous attempt rejection: ${previousErrorCode}. Do not repeat that rejected output. Use fewer claims and numbers; keep every Key Point within only its cited Evidence.`
      : "This is the first attempt for this Artifact; no prior rejection feedback exists.",
    "The prompt contains exactly one complete bounded Section Pack projection; it is not truncated.",
    `Required sectionId: ${JSON.stringify(pack.sectionId)}. Do not substitute any other sectionId.`,
    `Artifact pin for runtime validation only; do not repeat it in customer text: ${JSON.stringify({
      workspaceId: pack.binding.workspaceId,
      projectId: pack.binding.projectId,
      scopeId: pack.binding.scopeId,
      dataSnapshotId: pack.binding.dataSnapshotId,
      projectReleaseId: pack.binding.projectReleaseId,
      analysisPeriod: pack.binding.analysisPeriod,
    })}`,
    "Return only one JSON object with no preface or afterword: {\"sectionId\":string,\"status\":\"available\"|\"empty\",\"summary\"?:string,\"keyPoints\"?:[{\"kind\":\"priority\"|\"finding\"|\"meaning\"|\"next-check\",\"label\"?:string,\"text\":string,\"evidenceRefs\":string[]}],\"limitation\"?:string}",
    `Section Pack: ${JSON.stringify(promptPack)}`,
  ].join("\n\n");
  if (prompt.length > MAX_SECTION_PROMPT_CHARS) throw new Error("PRESCHOOL_SECTION_INTERPRETER_PROMPT_TOO_LARGE");
  return prompt;
};

export const buildPreschoolSectionDiscoveryPrompt = (
  pack: PreschoolSectionPackV2,
  previousErrorCode?: string,
): string => {
  const projection = projectPreschoolSectionPackV2ForModel(pack);
  const prompt = [
    "You are producing a concise Summary plus optional Insight candidates for one Preschool Overview Section.",
    "Use the complete inline Pack projection. Scoped read-only tools may inspect only server-owned Pack Evidence; use them only when they add value.",
    `Available scoped read-only tools: ${JSON.stringify(pack.capabilities.tools)}. Tool arguments must contain only the documented controlled parameters; never submit Pack, binding, Section, Snapshot, Release, period, SQL, URL, network, or write instructions.`,
    "The Pack is a factual boundary, not a writing template: identify the most useful angles instead of filling fixed What, Why, or Action slots.",
    "You may connect supplied facts and propose relevant hypotheses. Mark direct Pack facts as observed, supported relationships as inferred, and plausible but unverified lines of inquiry as speculative.",
    "Do not invent observed facts, entities, numbers, dates, units, or relationships. A speculative explanation must remain clearly conditional and must not be presented as a confirmed safety alert.",
    "Keep the Summary short and useful. Candidates are optional; return zero when the Summary is sufficient, or several genuinely distinct candidates when the Pack supports them.",
    "Order candidates from highest to lowest incremental value for a non-technical energy manager. In your internal selection, consider novel angle, relevance, urgency, contrarian value, and verifiability together without returning a fixed lens or score.",
    "The server validates, safety-filters, exactly deduplicates, and publishes at most three candidates, but preserves that source order; put the most valuable supported candidates first.",
    "If the supplied Evidence supports a genuine alert, rank it according to its value and urgency. Do not invent an alert when the Evidence does not support one.",
    "Do not force a recommendation, next action, cause, or one candidate per category. A useful candidate may instead surface a pattern, contrast, connection, counterexample, hypothesis, experiment, watch signal, or question.",
    "Avoid repeating alreadyPresentedFacts unless the repetition is necessary to explain a new relationship or priority.",
    "Every Summary and candidate must copy the exact evidenceRefs supporting its factual basis. Cite every Evidence item discussed.",
    "Narrative fields may use limited inline Markdown: **bold** for a few decisive words and _italics_ for a caveat. Do not use headings, lists, links, images, code, HTML, or tables.",
    previousErrorCode
      ? `Previous attempt rejection: ${previousErrorCode}. Correct only the unsupported or malformed claims; retain any independently useful supported angles.`
      : "This is the first attempt for this Section Artifact.",
    "Candidate identity is runtime-owned. Do not return candidateId, sourceIndex, runId, sessionId, or binding.",
    `Required sectionId: ${JSON.stringify(pack.sectionId)}.`,
    "Return only one JSON object: {\"sectionId\":string,\"status\":\"available\"|\"empty\",\"summary\"?:{\"text\":string,\"evidenceRefs\":string[]},\"candidates\":[{\"title\":string,\"label\"?:string,\"epistemicStatus\":\"observed\"|\"inferred\"|\"speculative\",\"text\":string,\"evidenceRefs\":string[],\"deepDiveQuestion\"?:string}],\"limitation\"?:string}",
    "For status=empty, candidates must be [] and summary/limitation must be absent. status=available may contain zero candidates.",
    `Complete model projection: ${JSON.stringify(projection)}`,
  ].join("\n\n");
  if (prompt.length > MAX_SECTION_DISCOVERY_PROMPT_CHARS) {
    throw new Error("PRESCHOOL_SECTION_DISCOVERY_PROMPT_TOO_LARGE");
  }
  return prompt;
};

const projectPackForPrompt = (pack: PreschoolSectionPack) => ({
  sectionId: pack.sectionId,
  audience: pack.audience,
  decisionQuestion: pack.decisionQuestion,
  evidence: pack.evidence.map((evidence) => ({
    value: projectEvidenceValue(pack.sectionId, evidence.value),
    ...(evidence.unit ? { unit: evidence.unit } : {}),
    evidenceRefs: [evidence.id],
  })),
  dataQuality: pack.dataQuality,
  limitations: pack.limitations,
  missingEvidence: pack.missingEvidence,
  pageCoverage: pack.pageCoverage,
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

const parseSectionResponse = (answer: string, sectionId: PreschoolSectionId): unknown => {
  const candidates = [stripJsonFence(answer), ...jsonObjectCandidates(answer)];
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (isRecord(parsed) && parsed.sectionId === sectionId) return parsed;
      // Keep the old batch envelope readable in unit/replay fixtures. New Provider
      // identities emit one direct Section object per isolated Run.
      if (isRecord(parsed) && Array.isArray(parsed.sections)) {
        const matching = parsed.sections.find((item) => isRecord(item) && item.sectionId === sectionId);
        if (matching) return matching;
      }
    } catch {
      // A Provider may wrap the JSON object in brief prose; keep searching balanced objects.
    }
  }
  throw new Error("PRESCHOOL_SECTION_INTERPRETER_RESPONSE_MALFORMED");
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

export const materializePreschoolSectionResultV4 = (input: {
  answer: string;
  pack: PreschoolSectionPackV2;
  identity: EnergyIqOverviewAiArtifactIdentity;
  runId: string;
  toolAudits?: PreschoolSectionToolAuditV4[];
}): PreschoolSectionInterpretationResultV4 => {
  const binding = preschoolOverviewAiBindingFromIdentity(input.identity);
  const discovery = parsePreschoolSectionDiscoveryV4({
    answer: input.answer,
    expectedSectionId: input.pack.sectionId,
    binding,
  });
  if (discovery.status === "available" && discovery.limitation
    && !isSupportedNarrative(discovery.limitation, input.pack.evidence, input.pack.evidence)) {
    throw new Error("PRESCHOOL_SECTION_INTERPRETATION_SUMMARY_UNSUPPORTED");
  }
  const acceptance = acceptPreschoolSectionInterpretation({
    expectedSectionId: input.pack.sectionId,
    expectedBinding: binding,
    discovery,
    authority: createPackV2AcceptanceAuthority(input.pack),
  });
  if (acceptance.decision === "failed") throw new Error(acceptance.code);
  return publishPreschoolSectionInterpretation({
    accepted: acceptance.value,
    providerProfileId: input.identity.modelProfileId,
    runId: input.runId,
    capability: input.pack.capabilities,
    toolAudits: input.toolAudits ?? [],
  });
};

const createPackV2AcceptanceAuthority = (pack: PreschoolSectionPackV2) => ({
  validateSummary: (summary: PreschoolSectionSummaryV4) => {
    const citedEvidence = citedPackEvidence(summary.evidenceRefs, pack);
    return summary.evidenceRefs.length > 0
      && evidenceRefsAreSupported(summary.evidenceRefs, pack)
      && citedEvidence.length > 0
      && isSupportedNarrative(summary.text, citedEvidence, pack.evidence)
      ? { accepted: true as const }
      : { accepted: false as const };
  },
  validateCandidate: (candidate: PreschoolSectionInsightCandidateV4) => {
    const rejection = candidateRejectionCode(candidate, pack);
    return rejection
      ? { accepted: false as const, code: rejection }
      : { accepted: true as const };
  },
});

const candidateRejectionCode = (
  candidate: PreschoolSectionInsightCandidateV4,
  pack: PreschoolSectionPackV2,
): PreschoolSectionCandidateRejectionCodeV4 | null => {
  if (!candidate.title.trim()
    || !candidate.text.trim()
    || candidate.evidenceRefs.length === 0) return "CANDIDATE_MALFORMED";
  if (!evidenceRefsAreSupported(candidate.evidenceRefs, pack)) return "EVIDENCE_REF_UNSUPPORTED";
  const citedEvidence = citedPackEvidence(candidate.evidenceRefs, pack);
  if (citedEvidence.length === 0) return "EVIDENCE_REF_UNSUPPORTED";
  const narrative = [candidate.title, candidate.label, candidate.text, candidate.deepDiveQuestion]
    .filter((value): value is string => Boolean(value));
  if (narrative.some((value) => hasBannedCustomerText(value) || hasUnsafeMarkdown(value))) {
    return "MARKDOWN_UNSAFE";
  }
  if (narrative.some((value) => hasUnsupportedTemporalClaim(value, citedEvidence))) {
    return "DATE_UNSUPPORTED";
  }
  if (narrative.some((value) => hasUnsupportedNumber(value, citedEvidence)
    || hasUnsupportedUnit(value, citedEvidence)
    || hasUnsupportedMetricRelation(value, citedEvidence))) {
    return "NUMBER_OR_UNIT_UNSUPPORTED";
  }
  if (narrative.some((value) => hasUnsupportedCentre(value, citedEvidence)
    || hasUnsupportedRelation(value, citedEvidence, pack.evidence))) {
    return "ENTITY_RELATION_UNSUPPORTED";
  }
  if (narrative.some((value) => hasUnsupportedSafetyClaim(value, citedEvidence))) {
    return "SAFETY_CLAIM_UNSUPPORTED";
  }
  return null;
};

const evidenceRefsAreSupported = (
  refs: string[],
  pack: PreschoolSectionPackV2,
): boolean => {
  const allowed = new Set(pack.evidence.flatMap((evidence) => [evidence.id, ...evidence.evidenceRefs]));
  return refs.every((reference) => allowed.has(reference));
};

const citedPackEvidence = (
  refs: string[],
  pack: PreschoolSectionPackV2,
): PreschoolSectionPack["evidence"] => pack.evidence.filter((evidence) =>
  refs.some((reference) => evidence.id === reference || evidence.evidenceRefs.includes(reference)));

const isSupportedNarrative = (
  text: string,
  citedEvidence: PreschoolSectionPack["evidence"],
  knownEvidence: PreschoolSectionPack["evidence"],
): boolean => !hasBannedCustomerText(text)
  && !hasUnsafeMarkdown(text)
  && !hasUnsupportedTemporalClaim(text, citedEvidence)
  && !hasUnsupportedNumber(text, citedEvidence)
  && !hasUnsupportedUnit(text, citedEvidence)
  && !hasUnsupportedCentre(text, citedEvidence)
  && !hasUnsupportedMetricRelation(text, citedEvidence)
  && !hasUnsupportedRelation(text, citedEvidence, knownEvidence)
  && !hasUnsupportedSafetyClaim(text, citedEvidence);

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
    if (input.candidate.summary !== undefined
      || input.candidate.limitation !== undefined
      || (input.candidate.keyPoints !== undefined
        && (!Array.isArray(input.candidate.keyPoints) || input.candidate.keyPoints.length !== 0))) {
      throw new Error("PRESCHOOL_SECTION_INTERPRETATION_MALFORMED");
    }
    return {
      artifactKind: "section-interpretation",
      status: "empty",
      providerProfileId: input.identity.modelProfileId,
      runId: input.runId,
      contract: {
        id: "preschool-section-interpretation",
        revision: "preschool-section-interpretation-v3",
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
    || keyPoints.length < 1 || keyPoints.length > 4) {
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
      || pointNarrative.some((value) => hasUnsupportedMetricRelation(value, citedEvidence))
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
    || narrative.some((value) => hasUnsupportedMetricRelation(value, input.pack.evidence))
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
      revision: "preschool-section-interpretation-v3",
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
      || (candidate.kind !== "priority"
        && candidate.kind !== "finding"
        && candidate.kind !== "meaning"
        && candidate.kind !== "next-check")) return null;
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
  const numericText = text
    .replace(LOCAL_DATE_TOKEN, "")
    .replace(NATURAL_DATE_TOKEN, "")
    .replace(MONTH_YEAR_TOKEN, "")
    .replace(LOCAL_TIME_TOKEN, "");
  const tokens = [...numericText.matchAll(NUMBER_TOKEN)];
  return tokens.some((match) => {
    const raw = match[0].replaceAll(",", "");
    const value = Number(raw);
    const precision = raw.includes(".") ? raw.length - raw.indexOf(".") - 1 : 0;
    const tolerance = 0.5 * (10 ** -precision);
    const exactlySupported = supported.some((candidate) => Math.abs(candidate - value) < tolerance
      || Math.abs(Number(candidate.toFixed(precision)) - value) < tolerance);
    return !exactlySupported && !supportsBoundedIntegerApproximation({
      text: numericText,
      tokenIndex: match.index ?? 0,
      raw,
      value,
      supported,
    });
  });
};

const supportsBoundedIntegerApproximation = (input: {
  text: string;
  tokenIndex: number;
  raw: string;
  value: number;
  supported: number[];
}): boolean => {
  if (input.raw.includes(".")) return false;
  const qualifier = input.text
    .slice(Math.max(0, input.tokenIndex - 16), input.tokenIndex)
    .match(/\b(over|under)\s*$/iu)?.[1]?.toLowerCase();
  if (!qualifier) return false;
  const unsigned = input.raw.replace(/^-/, "");
  const trailingZeroCount = unsigned.match(/0+$/)?.[0].length ?? 0;
  if (trailingZeroCount === 0 || trailingZeroCount > 2) return false;
  const quantum = 10 ** trailingZeroCount;
  return input.supported.some((candidate) => qualifier === "over"
    ? candidate > input.value && candidate < input.value + quantum
    : candidate < input.value && candidate > input.value - quantum);
};

const hasUnsupportedTemporalClaim = (
  text: string,
  evidence: PreschoolSectionPack["evidence"],
): boolean => {
  const supported = collectTemporalClaims(evidence.map(({ value }) => value));
  const dates = [...text.matchAll(LOCAL_DATE_TOKEN)].map(([value]) => value);
  if (dates.some((date) => !supported.dates.has(date))) return true;
  const naturalDates = [...text.matchAll(NATURAL_DATE_TOKEN)].map(([value]) => naturalDateToIso(value));
  if (naturalDates.some((date) => date === null || !supported.dates.has(date))) return true;
  const monthYears = [...text.matchAll(MONTH_YEAR_TOKEN)].map(([value]) => monthYearToIsoPrefix(value));
  if (monthYears.some((prefix) => prefix === null
    || ![...supported.dates].some((date) => date.startsWith(`${prefix}-`)))) return true;
  const times = [...text.matchAll(LOCAL_TIME_TOKEN)].map(([value]) => value);
  return times.some((time) => {
    const separator = time.indexOf(":");
    const hour = Number(time.slice(0, separator));
    const minute = Number(time.slice(separator + 1));
    return minute !== 0 || !supported.hours.has(hour);
  });
};

const monthYearToIsoPrefix = (value: string): string | null => {
  const match = value.match(/^([A-Za-z]+)\s+(\d{4})$/u);
  if (!match) return null;
  const month = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ].indexOf(match[1]!.toLowerCase()) + 1;
  return month === 0 ? null : `${match[2]}-${month.toString().padStart(2, "0")}`;
};

const naturalDateToIso = (value: string): string | null => {
  const match = value.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/u);
  if (!match) return null;
  const month = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ].indexOf(match[2]!.toLowerCase()) + 1;
  const day = Number(match[1]);
  const year = Number(match[3]);
  if (month === 0 || !Number.isInteger(day) || !Number.isInteger(year)) return null;
  const iso = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(iso) ? iso : null;
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
      if (typeof item === "string" && LOCAL_DATE_VALUE.test(item)) dates.add(item);
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
  const centres = [...text.matchAll(/\b[Cc]entre\s+[A-Z0-9][A-Z0-9-]{0,3}\b/g)]
    .map(([value]) => value.toLowerCase());
  return centres.some((centre) => !supportedText.includes(centre));
};

const hasUnsupportedMetricRelation = (
  text: string,
  evidence: PreschoolSectionPack["evidence"],
): boolean => {
  const paceValues = evidence.flatMap(({ value }) => collectNumbersForKey(value, "pacePct"));
  if (paceValues.length === 0) return false;
  return text.split(/[!?;]|(?<!\d)\.(?!\d)|\b(?:but|while|whereas)\b/iu).some((clause) => {
    if (!/\bcost\b/iu.test(clause)) return false;
    const numericClause = clause
      .replace(LOCAL_DATE_TOKEN, "")
      .replace(NATURAL_DATE_TOKEN, "")
      .replace(MONTH_YEAR_TOKEN, "")
      .replace(LOCAL_TIME_TOKEN, "");
    return [...numericClause.matchAll(NUMBER_TOKEN)].some((match) => {
      const raw = match[0].replaceAll(",", "");
      const value = Number(raw);
      const precision = raw.includes(".") ? raw.length - raw.indexOf(".") - 1 : 0;
      const tolerance = 0.5 * (10 ** -precision);
      return paceValues.some((candidate) => Math.abs(candidate - value) < tolerance
        || Math.abs(Number(candidate.toFixed(precision)) - value) < tolerance);
    });
  });
};

const collectNumbersForKey = (value: unknown, targetKey: string): number[] => {
  if (Array.isArray(value)) return value.flatMap((item) => collectNumbersForKey(item, targetKey));
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, item]) => key === targetKey && typeof item === "number" && Number.isFinite(item)
    ? [item]
    : collectNumbersForKey(item, targetKey));
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

const hasUnsafeMarkdown = (text: string): boolean =>
  /(^|\n)\s{0,3}(?:#{1,6}\s|[-+*]\s|\d+[.)]\s|>\s)/u.test(text)
  || /```|`[^`]+`|!\[[^\]]*\]\([^)]*\)|\[[^\]]+\]\([^)]*\)|<\/?[A-Za-z][^>]*>|\|[^\n]*\|/u.test(text);

const hasUnsupportedSafetyClaim = (
  text: string,
  evidence: PreschoolSectionPack["evidence"],
): boolean => {
  const safetyTerms = text.match(/\b(?:water leak|leakage|electrical fault|short circuit|fire|overheating)\b/giu) ?? [];
  if (safetyTerms.length === 0) return false;
  const supportedText = JSON.stringify(evidence).toLowerCase();
  return safetyTerms.some((term) => !supportedText.includes(term.toLowerCase()));
};

const requirePackBinding = (
  pack: PreschoolSectionPack | PreschoolSectionPackV2,
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

const isPackV2 = (
  pack: PreschoolSectionPack | PreschoolSectionPackV2,
): pack is PreschoolSectionPackV2 => "contract" in pack
  && pack.contract.revision === "preschool-section-pack-v2";

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

const createConcurrencyGate = (limit: number) => {
  let active = 0;
  const waiters: Array<() => void> = [];
  const acquire = async (): Promise<void> => {
    if (active < limit) {
      active += 1;
      return;
    }
    await new Promise<void>((resolve) => waiters.push(resolve));
  };
  const release = (): void => {
    const next = waiters.shift();
    if (next) next();
    else active -= 1;
  };
  return async <T>(task: () => Promise<T>): Promise<T> => {
    await acquire();
    try {
      return await task();
    } finally {
      release();
    }
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
