import type {
  EnergyIqOverviewAiArtifactIdentity,
  EnergyIqOverviewAiArtifactRecord,
  EnergyIqAdditionalInsightModelProfileSnapshot,
  MetadataStore,
  UserRecord,
} from "@datafoundry/metadata";
import { randomUUID } from "node:crypto";

import { NGEE_ANN_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V1 } from "./ngee-ann-overview-ai-structured-output.js";
import { createNgeeAnnOverviewAiSectionArtifactIdentity, type OverviewAiArtifactIdentityV13 } from "./overview-ai-artifact.js";
import type {
  NgeeAnnSectionPacks,
  NgeeAnnSectionId,
  NgeeAnnSectionPack,
} from "./ngee-ann-section-pack.js";
import { NGEE_ANN_SECTION_IDS } from "./ngee-ann-section-pack.js";

const MAX_ANSWER_CHARS = 160_000;
const MAX_SUMMARY_CHARS = 600;
const MAX_TITLE_CHARS = 120;
const MAX_TEXT_CHARS = 720;
const MAX_DEEP_DIVE_CHARS = 220;
export const NGEE_ANN_SECTION_MESSAGE_MAX_CHARS = 220_000;
const MAX_PROMPT_CHARS = NGEE_ANN_SECTION_MESSAGE_MAX_CHARS;
const LEASE_MS = 4 * 60 * 1_000;
const NUMBER_TOKEN = /(?<![A-Za-z0-9_-])-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/gu;
const CLOCK_TIME_TOKEN = /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/gu;

export type NgeeAnnSectionSummary = {
  text: string;
  evidenceRefs: string[];
};

export type NgeeAnnSectionInsight = {
  id: string;
  title: string;
  text: string;
  epistemicStatus: "observed" | "inferred" | "speculative";
  evidenceRefs: string[];
  deepDiveQuestion?: string;
};

export type NgeeAnnSectionInterpretationResult = {
  artifactKind: "section-interpretation";
  status: "available" | "empty";
  providerProfileId: string;
  runId: string;
  contract: {
    id: "energyiq-project-section-interpretation";
    revision: "energyiq-project-section-interpretation-v1";
  };
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
  sectionId: NgeeAnnSectionId;
  packRevision: "v2";
  capability: {
    revision: "pack-only-v1";
    mode: "pack-only";
    tools: [];
  };
  summary?: NgeeAnnSectionSummary;
  insights: NgeeAnnSectionInsight[];
  limitation?: string;
  publication: {
    policyId: "energyiq-project-section-publication";
    policyRevision: "energyiq-project-section-publication-v1";
    discoveredCount: number;
    acceptedCount: number;
    rejectedCount: number;
    publishedCount: number;
    suppressedCandidateIds: string[];
    rejectedCandidateIds: string[];
  };
};

export type NgeeAnnSectionInterpreterRunner = (input: {
  prompt: string;
  identity: EnergyIqOverviewAiArtifactIdentity;
  user: UserRecord;
  workspaceId: string;
  runId: string;
  sessionId: string;
  structuredOutput: typeof NGEE_ANN_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V1;
  modelProfileSnapshot?: EnergyIqAdditionalInsightModelProfileSnapshot;
}) => Promise<{ answer: string; runId: string; sessionId: string }>;

export const createNgeeAnnSectionInterpreter = (input: {
  metadataStore: MetadataStore;
  runSection: NgeeAnnSectionInterpreterRunner;
  assertRuntimeIdentity?: (identity: EnergyIqOverviewAiArtifactIdentity) => void;
}) => ({
  async execute({
    baseIdentity,
    packs,
    user,
    retryTargets = [],
    modelProfileSnapshot,
  }: {
    baseIdentity: OverviewAiArtifactIdentityV13;
    packs: NgeeAnnSectionPacks;
    user: UserRecord;
    retryTargets?: NgeeAnnSectionId[];
    modelProfileSnapshot?: EnergyIqAdditionalInsightModelProfileSnapshot;
  }): Promise<Record<NgeeAnnSectionId, EnergyIqOverviewAiArtifactRecord>> {
    const store = input.metadataStore.energyIq.overviewAiArtifacts;
    const identities = Object.fromEntries(NGEE_ANN_SECTION_IDS.map((sectionId) => [
      sectionId,
      createNgeeAnnOverviewAiSectionArtifactIdentity({ baseIdentity, targetId: sectionId }),
    ])) as Record<NgeeAnnSectionId, EnergyIqOverviewAiArtifactIdentity>;
    for (const sectionId of NGEE_ANN_SECTION_IDS) {
      requirePackIdentity(packs[sectionId], identities[sectionId]);
    }
    const current = Object.fromEntries(NGEE_ANN_SECTION_IDS.map((sectionId) => [
      sectionId,
      store.find(identities[sectionId])
        ?? store.queue({ identity: identities[sectionId], triggeredBy: user.id }),
    ])) as Record<NgeeAnnSectionId, EnergyIqOverviewAiArtifactRecord>;
    const retrySet = new Set(retryTargets);
    const pending = NGEE_ANN_SECTION_IDS.filter((sectionId) => current[sectionId].status === "queued"
      || (current[sectionId].status === "failed" && retrySet.has(sectionId)));

    await mapWithConcurrency(pending, 2, async (sectionId) => {
      const identity = identities[sectionId];
      const workerId = `ngee-ann-section:${sectionId}:${randomUUID()}`;
      const claim = store.claim({ identity, workerId, leaseMs: LEASE_MS });
      current[sectionId] = claim.artifact;
      if (!claim.claimed) return;
      const sessionId = `ngee-ann-section-${sectionId}-${randomUUID()}`;
      const runId = `ngee-ann-section-${sectionId}-${randomUUID()}`;
      try {
        input.assertRuntimeIdentity?.(identity);
        const response = await input.runSection({
          prompt: buildNgeeAnnSectionPrompt(packs[sectionId]),
          identity,
          user,
          workspaceId: baseIdentity.workspaceId,
          runId,
          sessionId,
          structuredOutput: NGEE_ANN_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V1,
          ...(modelProfileSnapshot ? { modelProfileSnapshot } : {}),
        });
        if (response.runId !== runId || response.sessionId !== sessionId) {
          throw new Error("ENERGYIQ_NGEE_ANN_SECTION_RUN_IDENTITY_MISMATCH");
        }
        const result = materializeNgeeAnnSectionResult({
          answer: response.answer,
          pack: packs[sectionId],
          identity,
          runId,
        });
        input.assertRuntimeIdentity?.(identity);
        current[sectionId] = store.complete({
          identity,
          workerId,
          sessionId,
          runId,
          resultJson: JSON.stringify(result),
        });
      } catch (error) {
        try {
          current[sectionId] = store.fail({
            identity,
            workerId,
            errorCode: sectionErrorCode(error),
          });
        } catch {
          current[sectionId] = store.get(identity);
        }
      }
    });
    return current;
  },
});

export const buildNgeeAnnSectionPrompt = (
  pack: NgeeAnnSectionPack,
): string => {
  const prompt = [
    "You interpret one Ngee Ann energy Overview Section for facilities and energy managers.",
    "Use only the supplied Section analysis projection. Do not call tools, query SQL, or introduce factual numbers that are absent from the projection.",
    "The projection preserves every Section-level row in a compact field-order representation while omitting repeated low-level detail owned by another Section. Do not infer omitted detail.",
    "Report dates and clock times must use reportTime and fields ending in Local. They are authoritative Project-local values; do not reconstruct or narrate UTC boundaries.",
    "Write a concise Summary of what matters in this Section, then propose only genuinely useful Insights. Do not restate every visible metric.",
    "Insights may be observed, inferred, or speculative. Inference and speculation are encouraged when they offer a relevant new angle, but label them honestly and never present a possible cause as confirmed.",
    "The epistemicStatus applies to the whole title and text. If any sentence proposes a cause, possibility or action that is not directly observed, use inferred or speculative rather than observed.",
    "Evidence refs anchor the observation beneath an Insight; they do not claim that a hypothesis has been proven.",
    "A speculative Insight may suggest a relationship, counterexample, question, or low-risk line of inquiry without inventing measurements.",
    "Each candidate must cite one or more exact Evidence IDs from the Pack. Aim for Summary under 480 characters, titles under 96, text under 480, and deep-dive questions under 220; preserve a useful explanation when it needs a little more room.",
    "Return status=empty only when the Pack supports no useful Summary or angle. One malformed candidate must not prevent other candidates from being useful.",
    `Required sectionId: ${JSON.stringify(pack.sectionId)}.`,
    "Return only one JSON object with no Markdown fence, preface or afterword: {\"sectionId\":string,\"status\":\"available\"|\"empty\",\"summary\"?:{\"text\":string,\"evidenceRefs\":string[]},\"candidates\":[{\"id\":string,\"title\":string,\"text\":string,\"epistemicStatus\":\"observed\"|\"inferred\"|\"speculative\",\"evidenceRefs\":string[],\"deepDiveQuestion\"?:string}],\"limitation\"?:string}",
    `Section analysis projection: ${JSON.stringify(projectSectionPackForPrompt(pack))}`,
  ].join("\n\n");
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new Error("ENERGYIQ_NGEE_ANN_SECTION_PROMPT_TOO_LARGE");
  }
  return prompt;
};

export const materializeNgeeAnnSectionResult = <SectionId extends NgeeAnnSectionId>(input: {
  answer: string;
  pack: NgeeAnnSectionPack<SectionId>;
  identity: EnergyIqOverviewAiArtifactIdentity;
  runId: string;
}): NgeeAnnSectionInterpretationResult => {
  requirePackIdentity(input.pack, input.identity);
  const proposal = parseProposal(input.answer, input.pack.sectionId);
  const evidenceIds = new Set(input.pack.evidence.map(({ id }) => id));
  const packText = JSON.stringify(projectSectionPackForPrompt(input.pack));

  if (proposal.status === "empty") {
    if (proposal.summary !== undefined || proposal.candidates.length !== 0) {
      throw new Error("ENERGYIQ_NGEE_ANN_SECTION_RESULT_INVALID");
    }
    return resultBase(input, "empty", [], [], 0);
  }

  const summary = parseSummary(proposal.summary, evidenceIds, packText);
  if (!summary) throw new Error("ENERGYIQ_NGEE_ANN_SECTION_RESULT_INVALID");
  const accepted: NgeeAnnSectionInsight[] = [];
  const rejectedCandidateIds: string[] = [];
  const seenCandidateIds = new Set<string>();
  for (let index = 0; index < proposal.candidates.length; index += 1) {
    const candidate = proposal.candidates[index];
    const candidateId = isRecord(candidate) && nonEmptyString(candidate.id)
      ? candidate.id
      : `candidate:${index + 1}`;
    if (seenCandidateIds.has(candidateId)) {
      rejectedCandidateIds.push(candidateId);
      continue;
    }
    seenCandidateIds.add(candidateId);
    const insight = parseInsight(candidate, evidenceIds, packText);
    if (!insight) {
      rejectedCandidateIds.push(candidateId);
      continue;
    }
    accepted.push(insight);
  }
  const published = accepted.slice(0, 3);
  const suppressedCandidateIds = accepted.slice(3).map(({ id }) => id);
  return {
    ...resultBase(
      input,
      "available",
      published,
      rejectedCandidateIds,
      proposal.candidates.length,
      suppressedCandidateIds,
    ),
    summary,
    ...(nonEmptyString(proposal.limitation) && proposal.limitation.length <= 320
      ? { limitation: proposal.limitation }
      : {}),
  };
};

const resultBase = <SectionId extends NgeeAnnSectionId>(
  input: {
    pack: NgeeAnnSectionPack<SectionId>;
    identity: EnergyIqOverviewAiArtifactIdentity;
    runId: string;
  },
  status: "available" | "empty",
  insights: NgeeAnnSectionInsight[],
  rejectedCandidateIds: string[],
  discoveredCount: number,
  suppressedCandidateIds: string[] = [],
): NgeeAnnSectionInterpretationResult => ({
  artifactKind: "section-interpretation",
  status,
  providerProfileId: input.identity.modelProfileId,
  runId: input.runId,
  contract: {
    id: "energyiq-project-section-interpretation",
    revision: "energyiq-project-section-interpretation-v1",
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
  sectionId: input.pack.sectionId,
  packRevision: "v2",
  capability: { revision: "pack-only-v1", mode: "pack-only", tools: [] },
  insights,
  publication: {
    policyId: "energyiq-project-section-publication",
    policyRevision: "energyiq-project-section-publication-v1",
    discoveredCount,
    acceptedCount: insights.length + suppressedCandidateIds.length,
    rejectedCount: rejectedCandidateIds.length,
    publishedCount: insights.length,
    suppressedCandidateIds,
    rejectedCandidateIds,
  },
});

const parseProposal = (
  answer: string,
  sectionId: NgeeAnnSectionId,
): {
  status: "available" | "empty";
  summary?: unknown;
  candidates: unknown[];
  limitation?: unknown;
} => {
  if (answer.length === 0 || answer.length > MAX_ANSWER_CHARS || !answer.startsWith("{")) {
    throw new Error("ENERGYIQ_NGEE_ANN_SECTION_RESULT_INVALID");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(answer) as unknown;
  } catch {
    throw new Error("ENERGYIQ_NGEE_ANN_SECTION_RESULT_INVALID");
  }
  if (!isRecord(parsed)
    || parsed.sectionId !== sectionId
    || (parsed.status !== "available" && parsed.status !== "empty")
    || !Array.isArray(parsed.candidates)) {
    throw new Error("ENERGYIQ_NGEE_ANN_SECTION_RESULT_INVALID");
  }
  return {
    status: parsed.status,
    candidates: parsed.candidates,
    ...(parsed.summary !== undefined ? { summary: parsed.summary } : {}),
    ...(parsed.limitation !== undefined ? { limitation: parsed.limitation } : {}),
  };
};

const parseSummary = (
  value: unknown,
  evidenceIds: Set<string>,
  packText: string,
): NgeeAnnSectionSummary | null => {
  if (!isRecord(value)
    || !boundedString(value.text, MAX_SUMMARY_CHARS)
    || !validEvidenceRefs(value.evidenceRefs, evidenceIds)
    || !narrativeFactsSupported(value.text, packText)) return null;
  return { text: value.text, evidenceRefs: [...value.evidenceRefs] };
};

const parseInsight = (
  value: unknown,
  evidenceIds: Set<string>,
  packText: string,
): NgeeAnnSectionInsight | null => {
  if (!isRecord(value)
    || Object.keys(value).some((key) => ![
      "id", "title", "text", "epistemicStatus", "evidenceRefs", "deepDiveQuestion",
    ].includes(key))
    || !nonEmptyString(value.id)
    || !boundedString(value.title, MAX_TITLE_CHARS)
    || !boundedString(value.text, MAX_TEXT_CHARS)
    || (value.epistemicStatus !== "observed"
      && value.epistemicStatus !== "inferred"
      && value.epistemicStatus !== "speculative")
    || !validEvidenceRefs(value.evidenceRefs, evidenceIds)
    || (value.deepDiveQuestion !== undefined
      && !boundedString(value.deepDiveQuestion, MAX_DEEP_DIVE_CHARS))) return null;
  const narrative = [value.title, value.text, value.deepDiveQuestion ?? ""].join(" ");
  if (!narrativeFactsSupported(narrative, packText)) return null;
  return {
    id: value.id,
    title: value.title,
    text: value.text,
    epistemicStatus: lowerSectionEpistemicStatus(value.epistemicStatus, `${value.title} ${value.text}`),
    evidenceRefs: [...value.evidenceRefs],
    ...(typeof value.deepDiveQuestion === "string"
      ? { deepDiveQuestion: value.deepDiveQuestion }
      : {}),
  };
};

const lowerSectionEpistemicStatus = (
  proposed: NgeeAnnSectionInsight["epistemicStatus"],
  narrative: string,
): NgeeAnnSectionInsight["epistemicStatus"] => proposed === "observed"
  && /\b(?:may|might|could|likely|possibly|suggest(?:s|ing|ed)?|indicat(?:e|es|ing|ed)|points?\s+to|warrants?|investigat\w*|recommends?|reviews?|verif(?:y|ies)|focus(?:es|ed|ing)?|treat(?:s|ed|ing)?|opportunit\w*|should|would)\b/iu.test(narrative)
  ? "inferred"
  : proposed;

const validEvidenceRefs = (
  value: unknown,
  evidenceIds: Set<string>,
): value is string[] => Array.isArray(value)
  && value.length > 0
  && value.every((item) => nonEmptyString(item) && evidenceIds.has(item))
  && new Set(value).size === value.length;

const numbersSupported = (text: string, packText: string): boolean =>
  [...text.matchAll(NUMBER_TOKEN)].every(([token]) => numericTokenSupported(token, packText));

const narrativeFactsSupported = (text: string, packText: string): boolean =>
  numbersSupported(text, packText)
  && [...text.matchAll(CLOCK_TIME_TOKEN)].every(([token]) => packText.includes(token));

const numericTokenSupported = (token: string, packText: string): boolean => {
  const normalized = token.replaceAll(",", "");
  if (packText.includes(normalized) || packText.includes(token)) return true;
  const reportedValue = Number(normalized);
  if (!Number.isFinite(reportedValue)) return false;
  const decimal = normalized.split(".")[1];
  const precision = decimal?.length ?? 0;
  const tolerance = 0.5 * (10 ** -precision);
  const floatingPointSlack = Number.EPSILON * Math.max(1, Math.abs(reportedValue)) * 4;
  return [...packText.matchAll(NUMBER_TOKEN)].some(([sourceToken]) => {
    const sourceValue = Number(sourceToken.replaceAll(",", ""));
    return Number.isFinite(sourceValue)
      && Math.abs(sourceValue - reportedValue) <= tolerance + floatingPointSlack;
  });
};

const projectSectionPackForPrompt = (pack: NgeeAnnSectionPack): Record<string, unknown> => {
  const { analysisPeriod: _analysisPeriod, ...bindingWithoutUtcPeriod } = pack.binding;
  const common = {
    contract: pack.contract,
    sectionId: pack.sectionId,
    audience: pack.audience,
    analysisGoal: pack.analysisGoal,
    binding: bindingWithoutUtcPeriod,
    reportTime: pack.reportTime,
    evidence: pack.evidence.map(({ id, metricId }) => ({ id, metricId })),
    dataQuality: pack.dataQuality,
    limitations: pack.limitations,
    missingEvidence: pack.missingEvidence,
    capabilities: pack.capabilities,
  };
  if (pack.sectionId === "trend-and-demand") {
    const facts = (pack as NgeeAnnSectionPack<"trend-and-demand">).facts;
    return {
      ...common,
      projection: {
        revision: "ngee-ann-section-prompt-projection-v2",
        rowPolicy: "all-section-rows",
        omittedRepeatedFields: ["baselineSamples", "hourlyComparison", "detailSeries"],
        projectedRowCount: facts.dailyUsageAnomalies?.status === "available"
          ? facts.dailyUsageAnomalies.scopes.reduce((sum, scope) => sum + scope.rows.length, 0)
          : 0,
      },
      facts: {
        summary: projectSummary(facts.summary, pack.reportTime.timezone),
        comparison: projectComparison(facts.comparison, pack.reportTime.timezone),
        dailyTotals: facts.dailyTotals,
        dailyUsageAnomalies: projectDailyUsageAnomalies(facts.dailyUsageAnomalies),
        peakBreakdown: projectPeakBreakdown(facts.peakBreakdown, pack.reportTime.timezone),
      },
    };
  }
  if (pack.sectionId === "time-behaviour") {
    const facts = (pack as NgeeAnnSectionPack<"time-behaviour">).facts;
    const projectedRowCount = facts.timeBehaviour?.scopes
      .reduce((sum, scope) => sum + scope.cells.length, 0) ?? 0;
    return {
      ...common,
      projection: {
        revision: "ngee-ann-section-prompt-projection-v2",
        rowPolicy: "all-section-rows",
        projectedRowCount,
        valueSemantics: {
          cellUsageKwh: "energy in one local-date/hour bucket, expressed in kWh; never label it kWh/h",
          dayProfileUsageKwh: "mean energy per complete classified day for that local-hour bucket, expressed in kWh",
          componentProfileUsageKwh: "mean component energy per complete classified day for that local-hour bucket, expressed in kWh",
          publicHoliday: "unavailable unless the supplied profile status is available; do not infer public-holiday behaviour",
        },
      },
      facts: {
        timeBehaviour: projectTimeBehaviour(facts.timeBehaviour),
        componentHourlyProfiles: projectComponentHourlyProfiles(facts.componentHourlyProfiles),
        offHours: facts.offHours,
      },
    };
  }
  return {
    ...common,
    projection: {
      revision: "ngee-ann-section-prompt-projection-v2",
      rowPolicy: "all-section-rows",
    },
    facts: pack.sectionId === "circuit-concentration"
      ? {
          ...pack.facts,
          peakBreakdown: projectPeakBreakdown(
            (pack as NgeeAnnSectionPack<"circuit-concentration">).facts.peakBreakdown,
            pack.reportTime.timezone,
          ),
        }
      : pack.facts,
  };
};

const projectSummary = (
  value: NgeeAnnSectionPack<"trend-and-demand">["facts"]["summary"],
  timezone: string,
): Record<string, unknown> => {
  const { peakAt, ...withoutUtcPeak } = value;
  return {
    ...withoutUtcPeak,
    ...(peakAt ? { peakAtLocal: localDateTime(peakAt, timezone) } : {}),
  };
};

const projectComparison = (
  value: NgeeAnnSectionPack<"trend-and-demand">["facts"]["comparison"],
  timezone: string,
): Record<string, unknown> => {
  const { from, to, ...withoutUtcPeriod } = value;
  return {
    ...withoutUtcPeriod,
    fromLocalDate: localDate(from, timezone),
    toExclusiveLocalDate: localDate(to, timezone),
  };
};

const projectPeakBreakdown = (
  value: NgeeAnnSectionPack<"trend-and-demand">["facts"]["peakBreakdown"],
  timezone: string,
): unknown => {
  if (!value || value.status !== "available") return value;
  return {
    ...value,
    peak: {
      ...value.peak,
      fromLocal: localDateTime(value.peak.from, timezone),
      toLocal: localDateTime(value.peak.to, timezone),
      from: undefined,
      to: undefined,
    },
  };
};

const localDate = (value: string, timezone: string): string => localDateTime(value, timezone).slice(0, 10);

const localDateTime = (value: string, timezone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  const result = `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/u.test(result)) {
    throw new Error("ENERGYIQ_NGEE_ANN_SECTION_REPORT_TIME_INVALID");
  }
  return result;
};

const projectDailyUsageAnomalies = (
  value: NgeeAnnSectionPack<"trend-and-demand">["facts"]["dailyUsageAnomalies"],
): unknown => {
  if (!value || value.status !== "available") return value;
  return {
    ...value,
    rowFieldOrder: [
      "anomalyId", "incidentId", "localDate", "dayType", "baselineDates", "baselineSampleCount",
      "actualKwh", "baselineKwh", "impactKwh", "relativePct", "coveragePct",
      "expectedMeterIntervalCount", "validIntervalCount", "qualityEventCount", "outcome",
      "suppressionCode",
    ],
    scopes: value.scopes.map((scope) => ({
      scopeId: scope.scopeId,
      scopeName: scope.scopeName,
      scopeType: scope.scopeType,
      rollingComparisons: scope.rollingComparisons,
      rows: scope.rows.map((row) => [
        row.anomalyId,
        row.incidentId,
        row.localDate,
        row.dayType,
        row.baselineDates,
        row.baselineSampleCount,
        row.actualKwh,
        row.baselineKwh,
        row.impactKwh,
        row.relativePct,
        row.coveragePct,
        row.expectedMeterIntervalCount,
        row.validIntervalCount,
        row.qualityEventCount,
        row.outcome,
        row.suppressionReason?.code ?? null,
      ]),
    })),
  };
};

const projectTimeBehaviour = (
  value: NgeeAnnSectionPack<"time-behaviour">["facts"]["timeBehaviour"],
): unknown => {
  if (!value) return value;
  return {
    metricId: value.metricId,
    grain: value.grain,
    unit: value.unit,
    timezone: value.timezone,
    queryId: value.queryId,
    cellFieldOrder: [
      "localDate", "localHour", "usageKwh", "coveragePct",
      "expectedMeterIntervalCount", "validIntervalCount", "qualityEventCount",
    ],
    scopes: value.scopes.map((scope) => ({
      scopeId: scope.scopeId,
      scopeName: scope.scopeName,
      scopeType: scope.scopeType,
      cells: scope.cells.map((cell) => [
        cell.localDate,
        cell.localHour,
        cell.usageKwh,
        cell.dataHealth.coveragePct,
        cell.dataHealth.expectedMeterIntervalCount,
        cell.dataHealth.validIntervalCount,
        cell.dataHealth.qualityEventCount,
      ]),
    })),
    dayProfiles: value.dayProfiles.map((profile) => profile.status === "available"
      ? {
          dayType: profile.dayType,
          scopeId: profile.scopeId,
          scopeName: profile.scopeName,
          status: profile.status,
          sampleDayCount: profile.sampleDayCount,
          valueFieldOrder: ["localHour", "usageKwh"],
          values: profile.values.map(({ localHour, usageKwh }) => [localHour, usageKwh]),
        }
      : profile),
  };
};

const projectComponentHourlyProfiles = (
  value: NgeeAnnSectionPack<"time-behaviour">["facts"]["componentHourlyProfiles"],
): unknown => {
  if (!value) return value;
  return {
    metricId: value.metricId,
    queryId: value.queryId,
    accountingBasis: value.accountingBasis,
    grain: value.grain,
    unit: value.unit,
    timezone: value.timezone,
    valueFieldOrder: ["localHour", "usageKwh"],
    scopes: value.scopes.map((scope) => ({
      scopeId: scope.scopeId,
      scopeName: scope.scopeName,
      scopeType: scope.scopeType,
      profiles: scope.profiles.map((profile) => profile.status === "available"
        ? {
            dayType: profile.dayType,
            status: profile.status,
            sampleDayCount: profile.sampleDayCount,
            categories: profile.categories.map((category) => ({
              category: category.category,
              values: category.values.map(({ localHour, usageKwh }) => [localHour, usageKwh]),
            })),
            circuits: profile.circuits.map((circuit) => ({
              meterNodeId: circuit.meterNodeId,
              name: circuit.name,
              category: circuit.category,
              values: circuit.values.map(({ localHour, usageKwh }) => [localHour, usageKwh]),
            })),
          }
        : profile),
    })),
  };
};

const requirePackIdentity = (
  pack: NgeeAnnSectionPack,
  identity: EnergyIqOverviewAiArtifactIdentity,
): void => {
  const expectedPromptRevision = "energyiq-project-section-discovery-v4";
  if (identity.identityContractRevision !== "ngee-ann-section-v7"
    || identity.targetId !== pack.sectionId
    || identity.workspaceId !== pack.binding.workspaceId
    || identity.projectId !== pack.binding.projectId
    || identity.scopeId !== pack.binding.scopeId
    || identity.dataSnapshotId !== pack.binding.dataSnapshotId
    || identity.projectReleaseId !== pack.binding.projectReleaseId
    || identity.analysisPeriodFrom !== pack.binding.analysisPeriod.from
    || identity.analysisPeriodTo !== pack.binding.analysisPeriod.to
    || identity.investigatorPromptRevision !== expectedPromptRevision
    || identity.analysisPackRevision !== "v2") {
    throw new Error("ENERGYIQ_NGEE_ANN_SECTION_PACK_IDENTITY_MISMATCH");
  }
};

const boundedString = (value: unknown, maxLength: number): value is string =>
  nonEmptyString(value) && value.length <= maxLength;

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sectionErrorCode = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.trim().toUpperCase().replace(/[^A-Z0-9_]+/gu, "_");
  return normalized.slice(0, 160) || "ENERGYIQ_NGEE_ANN_SECTION_INTERPRETER_FAILED";
};

const mapWithConcurrency = async <Item>(
  items: readonly Item[],
  limit: number,
  task: (item: Item) => Promise<void>,
): Promise<void> => {
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await task(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
};
