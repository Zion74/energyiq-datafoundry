import type {
  EnergyIqOverviewAiArtifactIdentity,
  EnergyIqOverviewAiArtifactRecord,
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
const MAX_SUMMARY_CHARS = 480;
const MAX_TITLE_CHARS = 96;
const MAX_TEXT_CHARS = 480;
const MAX_DEEP_DIVE_CHARS = 220;
const MAX_PROMPT_CHARS = 105_000;
const LEASE_MS = 4 * 60 * 1_000;
const NUMBER_TOKEN = /(?<![A-Za-z0-9_-])-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/gu;

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
  packRevision: "v1";
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
}) => Promise<{ answer: string; runId: string; sessionId: string }>;

export const createNgeeAnnSectionInterpreter = (input: {
  metadataStore: MetadataStore;
  runSection: NgeeAnnSectionInterpreterRunner;
}) => ({
  async execute({
    baseIdentity,
    packs,
    user,
    retryTargets = [],
  }: {
    baseIdentity: OverviewAiArtifactIdentityV13;
    packs: NgeeAnnSectionPacks;
    user: UserRecord;
    retryTargets?: NgeeAnnSectionId[];
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
        const response = await input.runSection({
          prompt: buildNgeeAnnSectionPrompt(packs[sectionId]),
          identity,
          user,
          workspaceId: baseIdentity.workspaceId,
          runId,
          sessionId,
          structuredOutput: NGEE_ANN_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V1,
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
    "Use only the complete supplied Section Pack. Do not call tools, query SQL, or introduce factual numbers that are absent from the Pack.",
    "Write a concise Summary of what matters in this Section, then propose only genuinely useful Insights. Do not restate every visible metric.",
    "Insights may be observed, inferred, or speculative. Inference and speculation are encouraged when they offer a relevant new angle, but label them honestly and never present a possible cause as confirmed.",
    "Evidence refs anchor the observation beneath an Insight; they do not claim that a hypothesis has been proven.",
    "A speculative Insight may suggest a relationship, counterexample, question, or low-risk line of inquiry without inventing measurements.",
    "Each candidate must cite one or more exact Evidence IDs from the Pack. Keep the Summary under 480 characters, titles under 96, text under 480, and deep-dive questions under 220.",
    "Return status=empty only when the Pack supports no useful Summary or angle. One malformed candidate must not prevent other candidates from being useful.",
    `Required sectionId: ${JSON.stringify(pack.sectionId)}.`,
    "Return only one JSON object with no Markdown fence, preface or afterword: {\"sectionId\":string,\"status\":\"available\"|\"empty\",\"summary\"?:{\"text\":string,\"evidenceRefs\":string[]},\"candidates\":[{\"id\":string,\"title\":string,\"text\":string,\"epistemicStatus\":\"observed\"|\"inferred\"|\"speculative\",\"evidenceRefs\":string[],\"deepDiveQuestion\"?:string}],\"limitation\"?:string}",
    `Section Pack: ${JSON.stringify(pack)}`,
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
  const packText = JSON.stringify(input.pack);

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
  packRevision: "v1",
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
    || !numbersSupported(value.text, packText)) return null;
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
  if (!numbersSupported(narrative, packText)) return null;
  return {
    id: value.id,
    title: value.title,
    text: value.text,
    epistemicStatus: value.epistemicStatus,
    evidenceRefs: [...value.evidenceRefs],
    ...(typeof value.deepDiveQuestion === "string"
      ? { deepDiveQuestion: value.deepDiveQuestion }
      : {}),
  };
};

const validEvidenceRefs = (
  value: unknown,
  evidenceIds: Set<string>,
): value is string[] => Array.isArray(value)
  && value.length > 0
  && value.every((item) => nonEmptyString(item) && evidenceIds.has(item))
  && new Set(value).size === value.length;

const numbersSupported = (text: string, packText: string): boolean =>
  [...text.matchAll(NUMBER_TOKEN)].every(([token]) => packText.includes(token.replaceAll(",", ""))
    || packText.includes(token));

const requirePackIdentity = (
  pack: NgeeAnnSectionPack,
  identity: EnergyIqOverviewAiArtifactIdentity,
): void => {
  if (identity.identityContractRevision !== "ngee-ann-section-v1"
    || identity.targetId !== pack.sectionId
    || identity.workspaceId !== pack.binding.workspaceId
    || identity.projectId !== pack.binding.projectId
    || identity.scopeId !== pack.binding.scopeId
    || identity.dataSnapshotId !== pack.binding.dataSnapshotId
    || identity.projectReleaseId !== pack.binding.projectReleaseId
    || identity.analysisPeriodFrom !== pack.binding.analysisPeriod.from
    || identity.analysisPeriodTo !== pack.binding.analysisPeriod.to
    || identity.analysisPackRevision !== "v1") {
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
