import {
  parseAiFindingPresentation,
  type AiFindingPresentation,
} from "./ai-finding-presentation";
import {
  PRESCHOOL_AI_ACCEPTED_CONTRACT_REVISION,
  PRESCHOOL_AI_EDITOR_PROMPT_REVISION,
  PRESCHOOL_AI_INVESTIGATOR_PROMPT_REVISION,
  PRESCHOOL_AI_METHOD_SKILL_ID,
  PRESCHOOL_AI_METHOD_SKILL_REVISION,
  type PreschoolAiEditorTraceDecision,
  type PreschoolAiEpistemicLevel,
  type PreschoolAiPlacementTarget,
  type PreschoolAiRelationship,
} from "./preschool-ai-artifact";
import type { PreschoolOverviewCoverageV1 } from "./preschool-ai-coverage";
import type { PreschoolDiscoveryEvidenceBundleV1 } from "./preschool-ai-discovery-evidence";

export type PreschoolAiWorkflowContext = {
  projectName: string;
  scopeName: string;
  timezone: string;
  snapshotId: string;
  projectReleaseId: string;
  analysisFrom: string;
  analysisTo: string;
  coverage: PreschoolOverviewCoverageV1;
  discoveryEvidence: PreschoolDiscoveryEvidenceBundleV1;
  decisionSignals: {
    items: Array<{ id: string; label: string }>;
  };
};

export type PreschoolAiInvestigatorCandidate = {
  id: string;
  epistemicLevel: PreschoolAiEpistemicLevel;
  title: string;
  takeaway: string;
  significance?: string;
  possibleExplanation?: string;
  nextCheck?: string;
  evidenceRefs: string[];
  evidenceSqlIndexes: number[];
  presentation?: AiFindingPresentation;
};

export type PreschoolAiEditorFindingDraft = {
  sourceCandidateIds: string[];
  placementTargets: PreschoolAiPlacementTarget[];
  epistemicLevel: PreschoolAiEpistemicLevel;
  relationship: PreschoolAiRelationship;
  signalRefs: string[];
  title: string;
  takeaway: string;
  interpretation?: string;
  action?: string;
  verification?: string;
  uncertainty?: string;
  evidenceRefs: string[];
  evidenceSqlIndexes: number[];
  presentation?: AiFindingPresentation;
};

export type PreschoolAiEditorEnvelope = {
  findings: PreschoolAiEditorFindingDraft[];
  trace: PreschoolAiEditorTraceDecision[];
};

const MAX_INVESTIGATOR_ANSWER_CHARS = 96_000;
const MAX_EDITOR_ANSWER_CHARS = 160_000;

export function buildPreschoolInvestigatorPrompt(input: PreschoolAiWorkflowContext): string {
  return [
    `You are the Investigator in a fixed two-stage EnergyIQ workflow for ${input.projectName}, Scope ${input.scopeName}.`,
    `Work only inside Snapshot ${input.snapshotId}, Release ${input.projectReleaseId}, and ${input.analysisFrom} through ${input.analysisTo} in ${input.timezone}.`,
    `The active Method Skill is ${PRESCHOOL_AI_METHOD_SKILL_ID}@${PRESCHOOL_AI_METHOD_SKILL_REVISION}. Follow it as a discovery method, not a question checklist.`,
    "The Overview Coverage below is what the manager can already see. Its visibleClaims and visibleVisuals encode existing KPI, table, ranking, distribution, and chart meaning. Investigate relationships, drivers, concentration, timing, contradictions, likely explanations, consequences, or useful next checks that add material value beyond it.",
    "Use inspect_schema and run_sql_readonly only when another query can materially change a conclusion, action, or uncertainty. Number successful SQL results from 1. Zero candidates is valid. There is no candidate count target or global finding quota.",
    "Use epistemicLevel verified for observations supported by cited Snapshot or SQL Evidence, hypothesis for a plausible explanation that remains unconfirmed, and exploration-idea for a worthwhile question or check. Do not delete a useful hypothesis or exploration idea merely because complete causal Evidence is absent.",
    "Every displayed number or named entity must occur in that candidate's cited bounded Evidence or successful SQL result. Never invent causes, equipment state, occupancy, savings, ROI, ownership, commitment, threshold, or forecast.",
    "A candidate may suggest an existing supported presentation only when it materially helps. Omit presentation for no-visual. Output only strict JSON.",
    `Prompt revision: ${PRESCHOOL_AI_INVESTIGATOR_PROMPT_REVISION}.`,
    "Return: {\"candidates\":[{\"id\":\"candidate-1\",\"epistemicLevel\":\"verified|hypothesis|exploration-idea\",\"title\":\"...\",\"takeaway\":\"...\",\"significance\":\"optional\",\"possibleExplanation\":\"optional\",\"nextCheck\":\"optional\",\"evidenceRefs\":[],\"evidenceSqlIndexes\":[],\"presentation\":{\"version\":\"1\",\"blocks\":[]}}]}",
    "Overview Coverage:",
    JSON.stringify(input.coverage),
    "Bounded Snapshot Evidence:",
    JSON.stringify(input.discoveryEvidence),
    "Project decision signals:",
    JSON.stringify(input.decisionSignals),
  ].join("\n\n");
}

export function buildPreschoolInsightEditorPrompt(
  input: PreschoolAiWorkflowContext,
  candidates: PreschoolAiInvestigatorCandidate[],
  investigatorEvidenceSummary: Array<{ evidenceIndex: number; resultPreview: string }>,
): string {
  return [
    `You are the Insight Editor in the second and final stage of a fixed EnergyIQ workflow for ${input.projectName}.`,
    `Accept content only for Snapshot ${input.snapshotId}, Release ${input.projectReleaseId}, and ${input.analysisFrom} through ${input.analysisTo}.`,
    "Judge each Investigator candidate for incremental manager value, non-repetition against Coverage visibleClaims and visibleVisuals, depth, epistemic honesty, best page placement, and clearest expression. You may reject, merge, or accept. Zero accepted findings is valid; never generate filler for an empty section.",
    "The Benchmark target specifically needs a useful interpretation, likely explanation, action, or verification beyond repeating benchmark values. Leave preschool.benchmark empty if no candidate clears that bar.",
    `Valid placementTargets: ${JSON.stringify(["preschool.overall-key-findings", "preschool.benchmark", "preschool.standby", "preschool.operating-hours", "preschool.forecast", "cross-section"] satisfies PreschoolAiPlacementTarget[])}. Use one or more exact targets; this is not a general page-layout language.`,
    "Use existing supported Presentation blocks only when they improve comprehension. Preserve no-visual. Do not add a chart merely to decorate a finding.",
    "Keep title and takeaway concise. interpretation, action, verification, and uncertainty are optional and should exist only when useful. A hypothesis or exploration idea may survive without complete causal Evidence, but it must include at least one of uncertainty or verification so the user knows what remains unknown or how to check it quickly.",
    "Citations refer to the bounded Snapshot evidence IDs or successful SQL Evidence. Investigator SQL indexes below retain their numbers. If you run additional SQL, continue numbering after the last Investigator index. Every number and named entity in accepted customer text or a Presentation block must be supported by that finding's citations.",
    "Engineering trace is separate from the customer finding. Record accepted, rejected, or merged plus sourceCandidateIds and an optional short reason. Do not add legacy overlap-audit fields.",
    `Output contract ${PRESCHOOL_AI_ACCEPTED_CONTRACT_REVISION}; prompt revision ${PRESCHOOL_AI_EDITOR_PROMPT_REVISION}. Output only strict JSON.`,
    "Return: {\"findings\":[{\"sourceCandidateIds\":[\"candidate-1\"],\"placementTargets\":[\"preschool.benchmark\"],\"epistemicLevel\":\"hypothesis\",\"relationship\":\"independent\",\"signalRefs\":[],\"title\":\"...\",\"takeaway\":\"...\",\"interpretation\":\"optional\",\"action\":\"optional\",\"verification\":\"optional\",\"uncertainty\":\"optional\",\"evidenceRefs\":[],\"evidenceSqlIndexes\":[],\"presentation\":{\"version\":\"1\",\"blocks\":[]}}],\"trace\":[{\"decision\":\"accepted|rejected|merged\",\"sourceCandidateIds\":[\"candidate-1\"],\"findingId\":\"optional\",\"reason\":\"optional\"}]}",
    "Overview Coverage:",
    JSON.stringify(input.coverage),
    "Investigator candidates:",
    JSON.stringify(candidates),
    "Investigator SQL Evidence summaries:",
    JSON.stringify(investigatorEvidenceSummary),
    "Bounded Snapshot Evidence:",
    JSON.stringify(input.discoveryEvidence),
  ].join("\n\n");
}

export function parsePreschoolInvestigatorCandidates(answer: string): PreschoolAiInvestigatorCandidate[] | null {
  if (answer.length > MAX_INVESTIGATOR_ANSWER_CHARS) return null;
  const envelope = findLastEnvelope(answer, "candidates");
  if (!envelope || !Array.isArray(envelope.candidates)) return null;
  const candidates = envelope.candidates.flatMap<PreschoolAiInvestigatorCandidate>((value) => {
    if (!isRecord(value)) return [];
    const id = cleanId(value.id);
    const epistemicLevel = parseEpistemicLevel(value.epistemicLevel);
    const title = cleanText(value.title);
    const takeaway = cleanText(value.takeaway);
    const evidenceRefs = stringArray(value.evidenceRefs);
    const evidenceSqlIndexes = positiveIntegerArray(value.evidenceSqlIndexes);
    const presentation = parseAiFindingPresentation(value.presentation);
    if (!id || !epistemicLevel || !title || !takeaway || evidenceSqlIndexes === null) return [];
    return [{
      id,
      epistemicLevel,
      title,
      takeaway,
      ...optionalText("significance", value.significance),
      ...optionalText("possibleExplanation", value.possibleExplanation),
      ...optionalText("nextCheck", value.nextCheck),
      evidenceRefs,
      evidenceSqlIndexes,
      ...(presentation ? { presentation } : {}),
    }];
  });
  if (candidates.length !== envelope.candidates.length) return null;
  return new Set(candidates.map((candidate) => candidate.id)).size === candidates.length ? candidates : null;
}

export function parsePreschoolEditorEnvelope(
  answer: string,
  candidateIds: ReadonlySet<string>,
): PreschoolAiEditorEnvelope | null {
  if (answer.length > MAX_EDITOR_ANSWER_CHARS) return null;
  const envelope = findLastEnvelope(answer, "findings");
  if (!envelope || !Array.isArray(envelope.findings)) return null;
  const findings = envelope.findings.flatMap<PreschoolAiEditorFindingDraft>((value) => {
    if (!isRecord(value)) return [];
    const sourceCandidateIds = stringArray(value.sourceCandidateIds);
    const placementTargets = placementArray(value.placementTargets);
    const epistemicLevel = parseEpistemicLevel(value.epistemicLevel);
    const relationship = parseRelationship(value.relationship);
    const signalRefs = stringArray(value.signalRefs);
    const title = cleanText(value.title);
    const takeaway = cleanText(value.takeaway);
    const evidenceRefs = stringArray(value.evidenceRefs);
    const evidenceSqlIndexes = positiveIntegerArray(value.evidenceSqlIndexes);
    const presentation = parseAiFindingPresentation(value.presentation);
    const verification = cleanText(value.verification);
    const uncertainty = cleanText(value.uncertainty);
    if (sourceCandidateIds.length === 0
      || sourceCandidateIds.some((id) => !candidateIds.has(id))
      || placementTargets === null || placementTargets.length === 0
      || !epistemicLevel || !relationship || !title || !takeaway
      || (epistemicLevel !== "verified" && !verification && !uncertainty)
      || evidenceSqlIndexes === null) return [];
    return [{
      sourceCandidateIds,
      placementTargets,
      epistemicLevel,
      relationship,
      signalRefs,
      title,
      takeaway,
      ...optionalText("interpretation", value.interpretation),
      ...optionalText("action", value.action),
      ...(verification ? { verification } : {}),
      ...(uncertainty ? { uncertainty } : {}),
      evidenceRefs,
      evidenceSqlIndexes,
      ...(presentation ? { presentation } : {}),
    }];
  });
  if (findings.length !== envelope.findings.length) return null;
  const trace = Array.isArray(envelope.trace)
    ? envelope.trace.flatMap<PreschoolAiEditorTraceDecision>((value) => parseTraceDecision(value, candidateIds))
    : [];
  if (Array.isArray(envelope.trace) && trace.length !== envelope.trace.length) return null;
  return { findings, trace };
}

function parseTraceDecision(
  value: unknown,
  candidateIds: ReadonlySet<string>,
): PreschoolAiEditorTraceDecision[] {
  if (!isRecord(value)
    || (value.decision !== "accepted" && value.decision !== "rejected" && value.decision !== "merged")) return [];
  const sourceCandidateIds = stringArray(value.sourceCandidateIds);
  if (sourceCandidateIds.length === 0 || sourceCandidateIds.some((id) => !candidateIds.has(id))) return [];
  const findingId = cleanId(value.findingId);
  const reason = cleanText(value.reason);
  return [{
    decision: value.decision,
    sourceCandidateIds,
    ...(findingId ? { findingId } : {}),
    ...(reason ? { reason } : {}),
  }];
}

function findLastEnvelope(answer: string, key: "candidates" | "findings"): Record<string, unknown> | null {
  for (let start = answer.lastIndexOf("{"); start >= 0; start = answer.lastIndexOf("{", start - 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < answer.length; index += 1) {
      const character = answer[index]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === "\"") inString = false;
        continue;
      }
      if (character === "\"") inString = true;
      else if (character === "{") depth += 1;
      else if (character === "}" && --depth === 0) {
        try {
          const parsed: unknown = JSON.parse(answer.slice(start, index + 1));
          if (isRecord(parsed) && Object.hasOwn(parsed, key)) return parsed;
        } catch {}
        break;
      }
    }
  }
  return null;
}

function placementArray(value: unknown): PreschoolAiPlacementTarget[] | null {
  if (!Array.isArray(value)) return null;
  const values = [...new Set(value)];
  return values.every(isPlacementTarget) ? values as PreschoolAiPlacementTarget[] : null;
}

function isPlacementTarget(value: unknown): value is PreschoolAiPlacementTarget {
  return value === "preschool.overall-key-findings"
    || value === "preschool.benchmark"
    || value === "preschool.standby"
    || value === "preschool.operating-hours"
    || value === "preschool.forecast"
    || value === "cross-section";
}

function parseEpistemicLevel(value: unknown): PreschoolAiEpistemicLevel | null {
  return value === "verified" || value === "hypothesis" || value === "exploration-idea" ? value : null;
}

function parseRelationship(value: unknown): PreschoolAiRelationship | null {
  return value === "supports" || value === "challenges" || value === "independent" ? value : null;
}

function positiveIntegerArray(value: unknown): number[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => Number.isSafeInteger(item) && (item as number) > 0)) return null;
  return [...new Set(value as number[])];
}

function stringArray(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return [];
  const values = value.map(cleanText);
  return values.every(Boolean) ? [...new Set(values as string[])] : [];
}

function optionalText<Key extends string>(key: Key, value: unknown): Partial<Record<Key, string>> {
  const text = cleanText(value);
  return text ? { [key]: text } as Record<Key, string> : {};
}

function cleanId(value: unknown): string | null {
  const id = typeof value === "string" ? value.trim() : "";
  return id && id.length <= 120 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(id) ? id : null;
}

function cleanText(value: unknown): string | null {
  const text = typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
  return text && text.length <= 1_200 ? text : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
