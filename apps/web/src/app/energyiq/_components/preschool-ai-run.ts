import type { EnergyProjectAnalysisSnapshotDto } from "../../../lib/config-api";
import { configApi, getAgentRuntimeUrl } from "../../../lib/config-api";
import {
  configApiCsrfHeaders,
  configApiIdentityHeaders,
  isPasswordAuthMode,
} from "../../../lib/config-api/client";
import { parseSchemaToolResult, parseSqlToolResult, sqlFromToolPayload } from "../../data-tasks/tool-result-normalize";
import {
  buildPreschoolDiscoveryEvidenceBundle,
  type PreschoolDiscoveryEvidenceBundleV1,
  type PreschoolDiscoveryEvidenceItem,
} from "./preschool-ai-discovery-evidence";
import type { PreschoolOverviewViewModel } from "./preschool-overview-view-model";

export type PreschoolAiProgress = "inspecting" | "querying" | "drafting";
export type PreschoolAiRelationship = "supports" | "challenges" | "independent";
export type PreschoolAiWhyKind = "Evidence" | "Hypothesis" | "Missing Evidence";

export type PreschoolAiToolEvidence = {
  toolCallId: string;
  sql: string | null;
  rowCount: number | null;
  auditLogId: string | null;
  elapsedMs: number | null;
  resultPreview: string;
};

export type PreschoolAiFinding = {
  id: string;
  relationship: PreschoolAiRelationship;
  title: string;
  what: string;
  why: { kind: PreschoolAiWhyKind; text: string };
  how: string;
  howToVerify: string;
  evidenceNote: string;
  evidence: {
    snapshotId: string;
    period: { from: string; to: string };
    deterministic: PreschoolDiscoveryEvidenceItem[];
    tools: PreschoolAiToolEvidence[];
  };
};

export type PreschoolAiRunResult = {
  status: "available";
  providerProfileId: string;
  runId: string;
  packId: "preschool-analysis-pack";
  packRevision: "v1";
  findings: PreschoolAiFinding[];
} | {
  status: "unavailable";
  reason: string;
};

export type PreschoolAiRunInput = {
  identityKey: string;
  projectId: "preschool-demo";
  projectName: string;
  scopeId: string;
  scopeName: string;
  resource: "electricity";
  timezone: string;
  snapshotId: string;
  projectReleaseId: string;
  analysisFrom: string;
  analysisTo: string;
  officialThemes: PreschoolOverviewViewModel["decisionSummary"];
  discoveryEvidence: PreschoolDiscoveryEvidenceBundleV1;
};

type AgUiEvent = Record<string, unknown> & { type?: string };
type ToolAccumulator = {
  id: string;
  name: string;
  args: Record<string, unknown> | null;
  argsText: string;
  result: unknown;
};
type CollectedSqlEvidence = PreschoolAiToolEvidence & { numericEvidence: number[] };
type ProgressCallback = (progress: PreschoolAiProgress) => void;
type CurrentRun = {
  promise: Promise<PreschoolAiRunResult>;
  progress: PreschoolAiProgress;
  listeners: Set<ProgressCallback>;
  settled: boolean;
};

const currentRuns = new Map<string, CurrentRun>();
const FRIENDLY_UNAVAILABLE = "AI analysis is temporarily unavailable. The verified Overview remains available.";

export function resetPreschoolAiRunsForTests(): void {
  currentRuns.clear();
}

export function buildPreschoolAiRunInput(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  officialThemes: PreschoolOverviewViewModel["decisionSummary"],
): PreschoolAiRunInput | null {
  const discoveryEvidence = buildPreschoolDiscoveryEvidenceBundle(snapshot);
  if (!discoveryEvidence || officialThemes.items.length === 0 || snapshot.context.resource !== "electricity") return null;
  const analysisFrom = localDate(new Date(discoveryEvidence.identity.period.from), snapshot.context.timezone);
  const analysisTo = localDate(new Date(Date.parse(discoveryEvidence.identity.period.to) - 1), snapshot.context.timezone);
  const identityKey = [
    snapshot.context.userId,
    snapshot.context.workspaceId,
    snapshot.context.projectId,
    snapshot.context.scopeId,
    snapshot.context.resource,
    snapshot.dataSnapshot.id,
    snapshot.projectRelease.id,
    snapshot.renderer.key,
    snapshot.renderer.version,
    snapshot.context.hierarchyRevisionId,
    snapshot.context.meterMappingRevisionId,
    snapshot.context.meterFormulaRevisionId,
    snapshot.context.metricVersion,
    snapshot.context.businessCalendarVersion,
    snapshot.context.tariffScheduleVersion,
    analysisFrom,
    analysisTo,
  ].join(":");
  return {
    identityKey,
    projectId: "preschool-demo",
    projectName: snapshot.context.projectName,
    scopeId: snapshot.context.scopeId,
    scopeName: snapshot.context.scopeName,
    resource: "electricity",
    timezone: snapshot.context.timezone,
    snapshotId: snapshot.dataSnapshot.id,
    projectReleaseId: snapshot.projectRelease.id,
    analysisFrom,
    analysisTo,
    officialThemes,
    discoveryEvidence,
  };
}

export function getOrStartPreschoolAiRun(
  input: PreschoolAiRunInput,
  onProgress?: ProgressCallback,
): Promise<PreschoolAiRunResult> {
  const existing = currentRuns.get(input.identityKey);
  if (existing) {
    onProgress?.(existing.progress);
    if (onProgress && !existing.settled) existing.listeners.add(onProgress);
    return existing.promise;
  }
  const listeners = new Set<ProgressCallback>();
  if (onProgress) listeners.add(onProgress);
  const run: CurrentRun = {
    promise: Promise.resolve({ status: "unavailable", reason: "The AI Analyst did not start." }),
    progress: "inspecting",
    listeners,
    settled: false,
  };
  const report = (progress: PreschoolAiProgress) => {
    run.progress = progress;
    for (const listener of run.listeners) listener(progress);
  };
  run.promise = executePreschoolAiRun(input, report).catch((error: unknown) => ({
    status: "unavailable" as const,
    reason: friendlyReason(error instanceof Error ? error.message : "AI Analyst unavailable."),
  })).finally(() => {
    run.settled = true;
    run.listeners.clear();
  });
  currentRuns.set(input.identityKey, run);
  return run.promise;
}

export async function executePreschoolAiRun(
  input: PreschoolAiRunInput,
  onProgress?: ProgressCallback,
): Promise<PreschoolAiRunResult> {
  let last: PreschoolAiProgress | null = null;
  const report = (progress: PreschoolAiProgress) => {
    const rank = { inspecting: 0, querying: 1, drafting: 2 } satisfies Record<PreschoolAiProgress, number>;
    if (last && rank[progress] <= rank[last]) return;
    last = progress;
    onProgress?.(progress);
  };
  report("inspecting");
  const defaults = await configApi.getRunDefaults();
  if (!defaults.activeLlmProfileId) return { status: "unavailable", reason: "No current Workspace model profile is configured." };
  const runId = `preschool-overview-${crypto.randomUUID()}`;
  const threadId = `preschool-overview-${crypto.randomUUID()}`;
  const response = await fetch(getAgentRuntimeUrl(), {
    method: "POST",
    ...(isPasswordAuthMode() ? { credentials: "same-origin" as RequestCredentials } : {}),
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      ...configApiIdentityHeaders(),
      ...configApiCsrfHeaders("POST"),
    },
    body: JSON.stringify(buildPreschoolAgentRunBody(input, defaults.activeLlmProfileId, runId, threadId)),
    signal: AbortSignal.timeout(300_000),
  });
  if (!response.ok) return { status: "unavailable", reason: `AI Analyst request failed (${response.status}).` };
  const eventStream = await readEventStream(response, (event) => {
    const toolName = stringValue(event.toolCallName) ?? stringValue(event.tool_call_name);
    if (event.type === "TOOL_CALL_START" && toolName === "run_sql_readonly") report("querying");
    if (event.type === "TOOL_CALL_RESULT" && toolName === "run_sql_readonly" && parseSqlToolResult(event.result ?? event.content)) report("drafting");
  });
  return resolvePreschoolAiEventStream({ eventStream, input, providerProfileId: defaults.activeLlmProfileId, runId });
}

export function buildPreschoolAgentRunBody(
  input: PreschoolAiRunInput,
  profileId: string,
  runId: string,
  threadId: string,
): Record<string, unknown> {
  return {
    method: "agent/run",
    params: { agentId: "dataFoundry" },
    body: {
      threadId,
      runId,
      state: {},
      messages: [{ id: `${runId}:user`, role: "user", content: buildPrompt(input) }],
      tools: [],
      context: [],
      forwardedProps: {
        externalContext: {
          source: "energyiq",
          projectId: input.projectId,
          scopeId: input.scopeId,
          resource: input.resource,
          period: "Custom",
          from: input.analysisFrom,
          to: input.analysisTo,
          expectedDataSnapshotId: input.snapshotId,
          expectedProjectReleaseId: input.projectReleaseId,
        },
        run_config: {
          protocol: { id: "data-analysis", version: "1" },
          activeLlmProfileId: profileId,
          activeSkillId: "data-analysis",
          enabledDatasourceIds: [],
          enabledKnowledgeIds: [],
          enabledMcpServerIds: [],
          enabledSkillIds: ["data-analysis"],
          skillPolicy: {
            allowedToolNames: ["inspect_schema", "run_sql_readonly"],
            deniedToolNames: ["list_data_sources", "preview_table", "skill", "skill_search", "skill_read"],
            maxSkills: 1,
            requireUserInvocable: true,
            strictSkillTools: true,
          },
        },
      },
    },
  };
}

function buildPrompt(input: PreschoolAiRunInput): string {
  return [
    `Act as an autonomous energy analyst for ${input.projectName}, Scope ${input.scopeName}.`,
    `Analyse only ${input.analysisFrom} through ${input.analysisTo} in ${input.timezone}, pinned to Snapshot ${input.snapshotId} and Release ${input.projectReleaseId}.`,
    "Your first action must be an immediate inspect_schema Tool call. Before that call, do not restate, explain, plan, summarize, or precompute the task or contract, and do not output prose. After inspect_schema returns, choose the single most decision-useful SQL cross-check autonomously. Make at most two total run_sql_readonly attempts; rejected or failed calls count toward this limit. Stop after the first successful SQL and number it Evidence index 1.",
    "On the first SQL plan, include every runtime assertion_id listed for each requirement_id, including manual assertions. Do not call analysis_requirements_commit; satisfy the Runtime gate through the required assertions attached to the SQL plan. If the first SQL is rejected, simplify it and retry only once. After the first successful SQL result, immediately produce the final JSON and never make another tool call. Do not add an explanation or task plan around the final JSON.",
    "The successful SQL must return exactly one row produced by a decision-useful aggregate that you choose autonomously. A ranked row, Top N result, LIMIT 1 selection, or preview is not an aggregate.",
    "Never use row position, rank, Top N size, LIMIT value, or row count in a Finding as Evidence or a numeric claim unless that quantity is returned as a real named SQL column value in the cited one-row result.",
    "Never estimate, sum, extrapolate, approximate, or infer values from truncated, previewed, omitted, or remaining rows. Every number in a Finding must appear directly in that Finding's cited bundle item values or cited SQL row; derived numbers and near matches are forbidden even when the arithmetic seems obvious.",
    "Except for the exact authorized structural references below, every non-SQL number must appear in the actual values of a bundle item cited by that same Finding. For example, stating 100% coverage requires citing quality:may in that same Finding. This is an Evidence-binding example, not a required Finding or theme.",
    "Do not use digits copied from artifact ids, audit ids, query ids, version strings, Snapshot ids, or dates as Finding numbers. Exact pinned Period, Snapshot, Release, and derived full-period presentation may appear only as structural context. Return zero Findings when no directly cited Evidence supports a useful candidate.",
    "For Centre aggregation use parent_node_id, not scope_id. Only include quality_status='ok' and official_aggregation_eligible=TRUE. Do not add Project totals to component rows.",
    "The Bounded Preschool Discovery Evidence Bundle is authoritative for published Portfolio, Centre, Benchmark, Calendar, Spike and Circuit values. SQL is one independent cross-check, not a replacement truth source.",
    "Return zero to three distinct Findings. Do not force novelty and do not repeat the official themes as prose. If Findings is non-empty, at least one Finding must cite SQL Evidence index 1.",
    "A Finding may support, challenge, or be independent of the official themes. Each must answer What, Why, How, and How to verify. whyKind must be Evidence, Hypothesis, or Missing Evidence.",
    "Every Finding must cite exact bundle item ids in evidenceRefs. Cite evidenceSqlIndexes [1] only when that Finding uses the SQL result. Use numbers only from that Finding's cited bundle items or cited SQL. Do not invent causes, equipment state, tariff, cost, savings, ROI, forecast, owner, commitment, target, threshold, duration, or time window.",
    "Return only strict JSON: {\"findings\":[{\"relationship\":\"supports\",\"title\":\"...\",\"what\":\"...\",\"whyKind\":\"Evidence\",\"why\":\"...\",\"how\":\"...\",\"howToVerify\":\"...\",\"evidenceNote\":\"...\",\"evidenceRefs\":[\"benchmark:priority-centre:G\"],\"evidenceSqlIndexes\":[1]}]}",
    "Bounded Preschool Discovery Evidence Bundle:",
    JSON.stringify(input.discoveryEvidence),
    "Official deterministic themes (context, not a script):",
    JSON.stringify(input.officialThemes),
  ].join("\n\n");
}

export function resolvePreschoolAiEventStream(args: {
  eventStream: string;
  input: PreschoolAiRunInput;
  providerProfileId: string;
  runId: string;
}): PreschoolAiRunResult {
  const events = parseEventStream(args.eventStream);
  const runError = events.findLast((event) => event.type === "RUN_ERROR");
  if (runError) return { status: "unavailable", reason: friendlyReason(stringValue(runError.message) ?? "AI Analyst Run failed.") };
  if (!events.some((event) => event.type === "RUN_FINISHED")) return { status: "unavailable", reason: "The AI Analyst Run did not finish." };
  const collected = collectTools(events);
  if (collected.sqlAttemptCount > 2) return { status: "unavailable", reason: "The AI Analyst exceeded the two-attempt SQL limit." };
  if (!collected.schemaValid || collected.sql.length !== 1) {
    return { status: "unavailable", reason: "The AI Analyst did not complete exactly one successful read-only SQL Evidence query." };
  }
  if (!discoveryMatchesInput(args.input)) return { status: "unavailable", reason: "The Preschool Discovery Evidence does not match this Run identity." };
  const answer = events.filter((event) => event.type === "TEXT_MESSAGE_CONTENT")
    .map((event) => stringValue(event.delta) ?? "").join("").trim();
  const generated = parseFindings(answer);
  if (!generated) return { status: "unavailable", reason: "The AI response could not be verified against this Snapshot." };
  if (generated.length > 0 && !generated.some((finding) => finding.evidenceSqlIndexes.includes(1))) {
    return { status: "unavailable", reason: "At least one Preschool Finding must cite the successful SQL Evidence." };
  }
  const evidenceById = new Map(args.input.discoveryEvidence.items.map((item) => [item.id, item]));
  const selectedEvidence = generated.map((finding) => finding.evidenceRefs
    .map((id) => evidenceById.get(id)).filter((item): item is PreschoolDiscoveryEvidenceItem => Boolean(item)));
  if (selectedEvidence.some((items, index) => items.length !== generated[index]!.evidenceRefs.length)) {
    return { status: "unavailable", reason: "A Preschool Finding cited Evidence that is not present in this Snapshot." };
  }
  const selectedTools = generated.map((finding) => finding.evidenceSqlIndexes
    .map((index) => collected.sql[index - 1]).filter((tool): tool is CollectedSqlEvidence => Boolean(tool)));
  if (selectedTools.some((items, index) => items.length !== generated[index]!.evidenceSqlIndexes.length)) {
    return { status: "unavailable", reason: "A Preschool Finding cited SQL Evidence that is not present in this Run." };
  }
  if (generated.some((finding, index) => unsupportedNumber(
    finding,
    selectedEvidence[index]!,
    selectedTools[index]!,
    args.input,
  ))) {
    return { status: "unavailable", reason: "The AI Analyst returned a numeric claim without Finding-specific Evidence." };
  }
  return {
    status: "available",
    providerProfileId: args.providerProfileId,
    runId: args.runId,
    packId: "preschool-analysis-pack",
    packRevision: "v1",
    findings: generated.map((finding, index) => ({
      id: `preschool-ai-finding-${index + 1}`,
      relationship: finding.relationship,
      title: finding.title,
      what: finding.what,
      why: { kind: finding.whyKind, text: finding.why },
      how: finding.how,
      howToVerify: finding.howToVerify,
      evidenceNote: finding.evidenceNote,
      evidence: {
        snapshotId: args.input.snapshotId,
        period: { from: args.input.analysisFrom, to: args.input.analysisTo },
        deterministic: selectedEvidence[index]!,
        tools: selectedTools[index]!.map(({ numericEvidence: _, ...tool }) => tool),
      },
    })),
  };
}

type GeneratedFinding = {
  relationship: PreschoolAiRelationship;
  title: string;
  what: string;
  whyKind: PreschoolAiWhyKind;
  why: string;
  how: string;
  howToVerify: string;
  evidenceNote: string;
  evidenceRefs: string[];
  evidenceSqlIndexes: number[];
};

function parseFindings(answer: string): GeneratedFinding[] | null {
  const envelope = findLastFindingsEnvelope(answer);
  if (!envelope || !Array.isArray(envelope.findings) || envelope.findings.length > 3) return null;
  const findings = envelope.findings.flatMap<GeneratedFinding>((candidate) => {
    if (!isRecord(candidate)) return [];
    const relationship = stringValue(candidate.relationship);
    const whyKind = stringValue(candidate.whyKind);
    const evidenceRefs = stringArray(candidate.evidenceRefs);
    const evidenceSqlIndexes = positiveIntegerArray(candidate.evidenceSqlIndexes);
    const title = cleanText(candidate.title);
    const what = cleanText(candidate.what);
    const why = cleanText(candidate.why);
    const how = cleanText(candidate.how);
    const howToVerify = cleanText(candidate.howToVerify);
    const evidenceNote = cleanText(candidate.evidenceNote);
    if ((relationship !== "supports" && relationship !== "challenges" && relationship !== "independent")
      || (whyKind !== "Evidence" && whyKind !== "Hypothesis" && whyKind !== "Missing Evidence")
      || !title || !what || !why || !how || !howToVerify || !evidenceNote
      || evidenceRefs.length === 0 || evidenceSqlIndexes === null) return [];
    return [{ relationship, title, what, whyKind, why, how, howToVerify, evidenceNote, evidenceRefs, evidenceSqlIndexes }];
  });
  if (findings.length !== envelope.findings.length) return null;
  const semantic = findings.map((finding) => `${finding.title} ${finding.what}`.toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim());
  return new Set(semantic).size === semantic.length ? findings : null;
}

function collectTools(events: AgUiEvent[]): { schemaValid: boolean; sqlAttemptCount: number; sql: CollectedSqlEvidence[] } {
  const tools = new Map<string, ToolAccumulator>();
  for (const event of events) {
    const id = stringValue(event.toolCallId) ?? stringValue(event.tool_call_id);
    if (!id) continue;
    const current = tools.get(id) ?? { id, name: "unknown", args: null, argsText: "", result: undefined };
    current.name = stringValue(event.toolCallName) ?? stringValue(event.tool_call_name) ?? current.name;
    if (event.type === "TOOL_CALL_ARGS") current.argsText += stringValue(event.delta) ?? "";
    if (isRecord(event.args)) current.args = event.args;
    if (isRecord(event.parameters)) current.args = event.parameters;
    if (event.type === "TOOL_CALL_RESULT") current.result = event.result ?? event.content;
    tools.set(id, current);
  }
  for (const tool of tools.values()) {
    if (tool.argsText && !tool.args) {
      try { const parsed: unknown = JSON.parse(tool.argsText); if (isRecord(parsed)) tool.args = parsed; } catch {}
    }
  }
  const attempts = [...tools.values()];
  const schemaValid = attempts.some((tool) => tool.name === "inspect_schema" && Boolean(parseSchemaToolResult(tool.result)));
  const sql = attempts.flatMap<CollectedSqlEvidence>((tool) => {
    if (tool.name !== "run_sql_readonly") return [];
    const parsed = parseSqlToolResult(tool.result);
    if (!parsed) return [];
    const preview = typeof tool.result === "string" ? tool.result : JSON.stringify(tool.result);
    return [{
      toolCallId: tool.id,
      sql: sqlFromToolPayload(tool.args, tool.result) ?? null,
      rowCount: parsed.row_count ?? null,
      auditLogId: parsed.audit_log_id ?? null,
      elapsedMs: parsed.elapsed_ms ?? null,
      resultPreview: preview.slice(0, 2_000),
      numericEvidence: collectNumericValues(parsed.rows),
    }];
  });
  return { schemaValid, sqlAttemptCount: attempts.filter((tool) => tool.name === "run_sql_readonly").length, sql };
}

function unsupportedNumber(
  finding: GeneratedFinding,
  evidence: PreschoolDiscoveryEvidenceItem[],
  tools: CollectedSqlEvidence[],
  input: PreschoolAiRunInput,
): boolean {
  const narrative = removeAllowedStructuralReferences(
    [finding.title, finding.what, finding.why, finding.how, finding.howToVerify, finding.evidenceNote].join(" "),
    input,
    finding.evidenceSqlIndexes,
  );
  const permitted = [
    ...evidence.flatMap((item) => collectNumericValues(item.values)),
    ...tools.flatMap((tool) => tool.numericEvidence),
  ];
  return numericTokens(narrative).some((claim) => !permitted.some((value) => numericMatches(claim, value)));
}

function removeAllowedStructuralReferences(
  narrative: string,
  input: PreschoolAiRunInput,
  evidenceSqlIndexes: number[],
): string {
  let remaining = replaceCompleteStructuralReference(narrative, input.analysisFrom, "");
  remaining = replaceCompleteStructuralReference(remaining, input.analysisTo, "");
  remaining = replaceCompleteStructuralReference(remaining, input.snapshotId, "");
  remaining = replaceCompleteStructuralReference(remaining, input.projectReleaseId, "");
  for (const reference of structuralPeriodPresentations(input)) {
    remaining = replaceCompleteStructuralReference(remaining, reference, "");
  }
  for (const reference of structuralDiscoveryPeriodPresentations(input)) {
    remaining = replaceCompleteStructuralReference(remaining, reference, "");
  }
  for (const index of evidenceSqlIndexes) {
    remaining = replaceCompleteStructuralReference(
      remaining,
      `SQL Evidence index ${index}`,
      "SQL Evidence",
    );
    remaining = replaceCompleteStructuralReference(
      remaining,
      `Evidence index ${index}`,
      "Evidence",
    );
  }
  return remaining;
}

function structuralPeriodPresentations(input: PreschoolAiRunInput): string[] {
  const from = parseIsoLocalDate(input.analysisFrom);
  const to = parseIsoLocalDate(input.analysisTo);
  if (!from || !to || from.valueOf() > to.valueOf()) return [];
  const dayCount = Math.round((to.valueOf() - from.valueOf()) / 86_400_000) + 1;
  const references = [`${dayCount}-day analysis period`, `${dayCount} days`];
  const isFullMonth = from.getUTCDate() === 1
    && from.getUTCFullYear() === to.getUTCFullYear()
    && from.getUTCMonth() === to.getUTCMonth()
    && to.getUTCDate() === new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 0)).getUTCDate();
  if (!isFullMonth) return references;
  const month = new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(from);
  return [...references, `${month} ${from.getUTCFullYear()}`, `${dayCount} ${month} days`];
}

function structuralDiscoveryPeriodPresentations(input: PreschoolAiRunInput): string[] {
  const period = input.discoveryEvidence.identity.period;
  if (!evidencePeriodMatchesInput(period, input)) return [];
  return [...new Set([period.from, period.to].flatMap(strictIsoPresentations))];
}

function strictIsoPresentations(value: string): string[] {
  const instant = new Date(value);
  if (Number.isNaN(instant.valueOf())) return [];
  const canonical = instant.toISOString();
  return [value, canonical, canonical.replace(/\.000Z$/u, "Z")];
}

function parseIsoLocalDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function replaceCompleteStructuralReference(
  value: string,
  reference: string,
  replacement: string,
): string {
  if (!reference) return value;
  let output = "";
  let cursor = 0;
  while (cursor < value.length) {
    const matchIndex = value.indexOf(reference, cursor);
    if (matchIndex < 0) return output + value.slice(cursor);
    const before = matchIndex > 0 ? value[matchIndex - 1] : undefined;
    const afterIndex = matchIndex + reference.length;
    const after = afterIndex < value.length ? value[afterIndex] : undefined;
    const isComplete = !isStructuralIdentifierCharacter(before)
      && !isStructuralIdentifierCharacter(after);
    output += value.slice(cursor, matchIndex);
    output += isComplete ? replacement : reference;
    cursor = afterIndex;
  }
  return output;
}

function isStructuralIdentifierCharacter(value: string | undefined): boolean {
  return Boolean(value && /[A-Za-z0-9_-]/u.test(value));
}

function collectNumericValues(value: unknown): number[] {
  if (typeof value === "number") return Number.isFinite(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(collectNumericValues);
  if (isRecord(value)) return Object.values(value).flatMap(collectNumericValues);
  return [];
}

function numericTokens(value: string): Array<{ precision: number; value: number }> {
  return (value.match(/[-+]?\d[\d,]*(?:\.\d+)?/gu) ?? []).flatMap((token) => {
    const normalized = token.replaceAll(",", "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? [{ precision: normalized.includes(".") ? normalized.split(".")[1]!.length : 0, value: parsed }] : [];
  });
}

function numericMatches(claim: { precision: number; value: number }, evidence: number): boolean {
  return Math.abs(claim.value - evidence) <= (0.5 * (10 ** -claim.precision)) + Number.EPSILON;
}

function discoveryMatchesInput(input: PreschoolAiRunInput): boolean {
  const identity = input.discoveryEvidence.identity;
  return identity.projectId === input.projectId
    && identity.scopeId === input.scopeId
    && identity.snapshotId === input.snapshotId
    && identity.projectReleaseId === input.projectReleaseId
    && identity.timezone === input.timezone
    && evidencePeriodMatchesInput(identity.period, input)
    && [identity.rendererKey, identity.hierarchyRevisionId, identity.meterMappingRevisionId,
      identity.meterFormulaRevisionId, identity.metricVersion, identity.businessCalendarVersion]
      .every((pin) => input.identityKey.includes(pin));
}

function evidencePeriodMatchesInput(
  period: { from: string; to: string },
  input: PreschoolAiRunInput,
): boolean {
  try {
    const from = new Date(period.from);
    const toExclusive = new Date(period.to);
    if (Number.isNaN(from.valueOf()) || Number.isNaN(toExclusive.valueOf())) return false;
    return localDate(from, input.timezone) === input.analysisFrom
      && localDate(new Date(toExclusive.valueOf() - 1), input.timezone) === input.analysisTo;
  } catch {
    return false;
  }
}

function parseEventStream(text: string): AgUiEvent[] {
  return text.split(/\r?\n\r?\n/u).flatMap((chunk) => {
    const data = chunk.split(/\r?\n/u).filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart()).join("\n").trim();
    if (!data || data === "[DONE]") return [];
    try { const parsed: unknown = JSON.parse(data); return isRecord(parsed) ? [parsed] : []; } catch { return []; }
  });
}

async function readEventStream(response: Response, onEvent: (event: AgUiEvent) => void): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    for (const event of parseEventStream(text)) onEvent(event);
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let pending = "";
  const consume = (flush = false) => {
    while (pending) {
      const separator = /\r?\n\r?\n/u.exec(pending);
      if (!separator && !flush) return;
      const end = separator ? separator.index + separator[0].length : pending.length;
      const chunk = pending.slice(0, end);
      pending = pending.slice(end);
      for (const event of parseEventStream(chunk)) onEvent(event);
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    full += text;
    pending += text;
    consume();
  }
  const tail = decoder.decode();
  full += tail;
  pending += tail;
  consume(true);
  return full;
}

function findLastFindingsEnvelope(answer: string): Record<string, unknown> | null {
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
          if (isRecord(parsed) && Object.hasOwn(parsed, "findings")) return parsed;
        } catch {}
        break;
      }
    }
  }
  return null;
}

function localDate(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function positiveIntegerArray(value: unknown): number[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => Number.isSafeInteger(item) && (item as number) > 0)) return null;
  return [...new Set(value as number[])];
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const values = value.map(cleanText);
  return values.every(Boolean) ? [...new Set(values as string[])] : [];
}

function cleanText(value: unknown): string | null {
  const text = stringValue(value)?.replace(/\s+/gu, " ").trim();
  return text && text.length <= 800 ? text : null;
}

function friendlyReason(reason: string): string {
  const trimmed = reason.trim();
  return /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/u.test(trimmed)
    || /\b(?:timeout|timed out|network error|failed to fetch)\b/iu.test(trimmed)
    ? FRIENDLY_UNAVAILABLE
    : trimmed || FRIENDLY_UNAVAILABLE;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
