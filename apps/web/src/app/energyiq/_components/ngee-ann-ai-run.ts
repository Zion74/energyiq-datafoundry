import type { EnergyProjectAnalysisSnapshotDto } from "../../../lib/config-api";
import { configApi, getAgentRuntimeUrl } from "../../../lib/config-api";
import { configApiIdentityHeaders, isPasswordAuthMode } from "../../../lib/config-api/client";
import { parseSchemaToolResult, parseSqlToolResult, sqlFromToolPayload } from "../../data-tasks/tool-result-normalize";
import type { NgeeAnnDecisionPrioritiesViewModel } from "./ngee-ann-overview-view-model";

export type NgeeAnnAiHorizon = "1d" | "7d" | "28d";
export type NgeeAnnAiWhyKind = "Evidence" | "Hypothesis" | "Missing Evidence";
export type NgeeAnnAiRelationship = "supports" | "challenges" | "independent";

export type NgeeAnnAiToolEvidence = {
  toolCallId: string;
  toolName: "inspect_schema" | "run_sql_readonly";
  sql: string | null;
  rowCount: number | null;
  auditLogId: string | null;
  elapsedMs: number | null;
  resultPreview: string;
};

export type NgeeAnnAiFinding = {
  id: string;
  relationship: NgeeAnnAiRelationship;
  horizons: NgeeAnnAiHorizon[];
  title: string;
  what: string;
  why: { kind: NgeeAnnAiWhyKind; text: string };
  how: string;
  howToVerify: string;
  evidenceNote: string;
  evidence: {
    snapshotId: string;
    dataCutoff: string;
    dataQuality: NgeeAnnAiDataQuality;
    tools: NgeeAnnAiToolEvidence[];
  };
};

export type NgeeAnnAiDataQuality = {
  status: "complete" | "partial" | "unavailable";
  scope: "deterministic-overview-period";
  period: { from: string; to: string };
  coveragePct: number;
  validIntervalCount: number;
  expectedMeterIntervalCount: number;
  qualityEventCount: number;
  limitation: string;
};

export type NgeeAnnAiRunResult = {
  status: "available";
  providerProfileId: string;
  runId: string;
  findings: [NgeeAnnAiFinding, NgeeAnnAiFinding, NgeeAnnAiFinding];
} | {
  status: "unavailable";
  reason: string;
};

type HorizonEvidence = {
  horizon: NgeeAnnAiHorizon;
  period: { fromLocalDate: string; toLocalDate: string };
  actualKwh: number;
  baselineKwh: number;
  deltaKwh: number;
  relativePct: number;
};

export type NgeeAnnAiRunInput = {
  identityKey: string;
  projectId: string;
  projectName: string;
  scopeId: string;
  scopeName: string;
  resource: "electricity";
  timezone: string;
  snapshotId: string;
  projectReleaseId: string;
  dataCutoff: string;
  analysisFrom: string;
  analysisTo: string;
  deterministicProjection: unknown;
  dataQuality: NgeeAnnAiDataQuality;
  horizons: [HorizonEvidence, HorizonEvidence, HorizonEvidence];
};

type AgUiEvent = Record<string, unknown> & { type?: string };
type ToolAccumulator = {
  id: string;
  name: string;
  argsText: string;
  args: Record<string, unknown> | null;
  result: unknown;
};
type CollectedToolEvidence = NgeeAnnAiToolEvidence & {
  numericEvidence: string;
};

const currentRuns = new Map<string, Promise<NgeeAnnAiRunResult>>();

export function resetNgeeAnnAiRunsForTests(): void {
  currentRuns.clear();
}

export function buildNgeeAnnAiRunInput(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  decisionPriorities: NgeeAnnDecisionPrioritiesViewModel,
): NgeeAnnAiRunInput | null {
  if (snapshot.context.resource !== "electricity" || decisionPriorities.status === "unavailable") return null;
  const item = snapshot.decisionPriorities?.items[0];
  if (!item || !decisionPriorities.items[0]) return null;
  const horizonMap = new Map(item.horizons.map((horizon) => [horizon.horizon, horizon]));
  const latest = horizonMap.get("latest_complete_day");
  const rolling7 = horizonMap.get("rolling_7d");
  const rolling28 = horizonMap.get("rolling_28d");
  if (!latest || !rolling7 || !rolling28
    || latest.status !== "available"
    || rolling7.status !== "available"
    || rolling28.status !== "available"
    || latest.actualKwh === null || latest.baselineKwh === null
    || latest.deltaKwh === null || latest.relativePct === null
    || rolling7.actualKwh === null || rolling7.baselineKwh === null
    || rolling7.deltaKwh === null || rolling7.relativePct === null
    || rolling28.actualKwh === null || rolling28.baselineKwh === null
    || rolling28.deltaKwh === null || rolling28.relativePct === null) return null;
  const dataCutoff = rolling28.period.toLocalDate;
  const horizons: NgeeAnnAiRunInput["horizons"] = [
    {
      horizon: "1d",
      period: latest.period,
      actualKwh: latest.actualKwh,
      baselineKwh: latest.baselineKwh,
      deltaKwh: latest.deltaKwh,
      relativePct: latest.relativePct,
    },
    {
      horizon: "7d",
      period: rolling7.period,
      actualKwh: rolling7.actualKwh,
      baselineKwh: rolling7.baselineKwh,
      deltaKwh: rolling7.deltaKwh,
      relativePct: rolling7.relativePct,
    },
    {
      horizon: "28d",
      period: rolling28.period,
      actualKwh: rolling28.actualKwh,
      baselineKwh: rolling28.baselineKwh,
      deltaKwh: rolling28.deltaKwh,
      relativePct: rolling28.relativePct,
    },
  ];
  const identityKey = [
    snapshot.context.userId,
    snapshot.context.workspaceId,
    snapshot.context.projectId,
    snapshot.context.scopeId,
    snapshot.context.resource,
    snapshot.dataSnapshot.id,
    dataCutoff,
    snapshot.projectRelease.id,
    snapshot.renderer.key,
    snapshot.renderer.version,
    snapshot.context.hierarchyRevisionId,
    snapshot.context.meterMappingRevisionId,
    snapshot.context.meterFormulaRevisionId,
    snapshot.context.metricVersion,
    snapshot.context.businessCalendarVersion,
    snapshot.context.tariffScheduleVersion,
  ].join(":");
  return {
    identityKey,
    projectId: snapshot.context.projectId,
    projectName: snapshot.context.projectName,
    scopeId: snapshot.context.scopeId,
    scopeName: snapshot.context.scopeName,
    resource: "electricity",
    timezone: snapshot.context.timezone,
    snapshotId: snapshot.dataSnapshot.id,
    projectReleaseId: snapshot.projectRelease.id,
    dataCutoff,
    analysisFrom: shiftLocalDate(dataCutoff, -55),
    analysisTo: dataCutoff,
    deterministicProjection: decisionPriorities,
    dataQuality: buildAiDataQuality(snapshot),
    horizons,
  };
}

export function getOrStartNgeeAnnAiRun(input: NgeeAnnAiRunInput): Promise<NgeeAnnAiRunResult> {
  const existing = currentRuns.get(input.identityKey);
  if (existing) return existing;
  const current = executeNgeeAnnAiRun(input).catch((error: unknown) => ({
    status: "unavailable" as const,
    reason: readableError(error),
  }));
  currentRuns.set(input.identityKey, current);
  return current;
}

export async function executeNgeeAnnAiRun(input: NgeeAnnAiRunInput): Promise<NgeeAnnAiRunResult> {
  const defaults = await configApi.getRunDefaults();
  if (!defaults.activeLlmProfileId) {
    return { status: "unavailable", reason: "No current Workspace model profile is configured." };
  }
  const runId = `ngee-ann-overview-${crypto.randomUUID()}`;
  const threadId = `ngee-ann-overview-${crypto.randomUUID()}`;
  const response = await fetch(getAgentRuntimeUrl(), {
    method: "POST",
    ...(isPasswordAuthMode() ? { credentials: "same-origin" as RequestCredentials } : {}),
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      ...configApiIdentityHeaders(),
    },
    body: JSON.stringify(buildAgentRunBody(input, defaults.activeLlmProfileId, runId, threadId)),
    signal: AbortSignal.timeout(200_000),
  });
  const eventStream = await response.text();
  if (!response.ok) {
    return { status: "unavailable", reason: `AI Analyst request failed (${response.status}).` };
  }
  return resolveNgeeAnnAiEventStream({
    eventStream,
    input,
    providerProfileId: defaults.activeLlmProfileId,
    runId,
  });
}

export function buildAgentRunBody(
  input: NgeeAnnAiRunInput,
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
      messages: [{ id: `${runId}:user`, role: "user", content: buildAgentPrompt(input) }],
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
        },
      },
    },
  };
}

function buildAgentPrompt(input: NgeeAnnAiRunInput): string {
  const latest = input.horizons.find((horizon) => horizon.horizon === "1d")!;
  const rolling7 = input.horizons.find((horizon) => horizon.horizon === "7d")!;
  const rolling28 = input.horizons.find((horizon) => horizon.horizon === "28d")!;
  const recommendedSql = [
    "SELECT level_node_id,",
    `SUM(CASE WHEN local_date BETWEEN DATE '${latest.period.fromLocalDate}' AND DATE '${latest.period.toLocalDate}' THEN usage_kwh ELSE 0 END) AS usage_1d_kwh,`,
    `SUM(CASE WHEN local_date BETWEEN DATE '${rolling7.period.fromLocalDate}' AND DATE '${rolling7.period.toLocalDate}' THEN usage_kwh ELSE 0 END) AS usage_7d_kwh,`,
    `SUM(CASE WHEN local_date BETWEEN DATE '${rolling28.period.fromLocalDate}' AND DATE '${rolling28.period.toLocalDate}' THEN usage_kwh ELSE 0 END) AS usage_28d_kwh`,
    "FROM <INSPECTED_TABLE>",
    `WHERE local_date BETWEEN DATE '${rolling28.period.fromLocalDate}' AND DATE '${rolling28.period.toLocalDate}'`,
    "AND quality_status='ok' AND official_aggregation_eligible=TRUE",
    "GROUP BY level_node_id ORDER BY usage_28d_kwh DESC",
  ].join(" ");
  return [
    `Act as an autonomous energy analyst for ${input.projectName}, Scope ${input.scopeName}.`,
    `The governed analysis window is ${input.analysisFrom} through ${input.analysisTo} in ${input.timezone}; data cutoff is ${input.dataCutoff}.`,
    "Inspect the scoped schema first, then query the inspected physical table directly with conditional aggregation. Do not call list_data_sources or preview_table. Do not use WITH/CTEs or EXTRACT syntax.",
    "Make at most two total run_sql_readonly attempts; rejected or failed calls count toward this limit. Stop after the first successful SQL call and number it 1. Do not run a second successful query or inspect the schema again after success.",
    "The supplied deterministic Horizon facts are the authoritative official totals and comparison baselines; do not query or replace them. Never report an unfiltered SUM(usage_kwh) as a Project total and never add total and component rows together.",
    "On the first SQL plan, include every runtime assertion_id listed for each requirement_id, including manual assertions. If the first SQL is rejected, simplify it and retry only once. After the first successful SQL result, immediately produce the final JSON and never make another tool call.",
    "Use the official deterministic projection as context, not as a script. Independently inspect the data and return exactly three useful, semantically different Findings.",
    "Across the three Findings, collectively cover the 1d, 7d and 28d horizons. A Finding can cover more than one horizon; do not force one Finding per horizon and do not repeat the same angle or action.",
    "For every Finding state whether it supports, challenges, or is independent of the deterministic projection. Answer What, Why, How, and How to verify.",
    "whyKind must be Evidence, Hypothesis, or Missing Evidence. Do not invent a cause, owner, saving, ROI, device state, or commitment.",
    "Every numeric claim must be verifiable from either the successful SQL result or the supplied deterministic Horizon, quality, and projection facts. Cite evidenceSqlIndexes [1] for each Finding and state whether its number comes from the SQL driver result or the authoritative deterministic context.",
    "Finding text may use only numeric values directly present in the successful SQL result or authoritative deterministic context, or a single-step sum, difference, ratio, or percentage computed from those values. Never report a multi-step derived number such as normalizing values and then comparing the normalized results.",
    "In how and howToVerify, never invent a numeric threshold, target, tolerance, percentage, duration, or time window that is absent from the successful SQL result and authoritative deterministic context. Verification may name the metric or dimension to monitor, but it must not introduce a new number.",
    "Include the relevant quality status or coverage fields in the SQL result used as Evidence. The supplied deterministic Overview quality summary covers only its primary period and must not be claimed as the quality of the full AI lookback.",
    "After inspect_schema, replace <INSPECTED_TABLE> with the inspected physical table name and execute exactly the following concise cross-horizon Level query without redesigning or expanding it:",
    recommendedSql,
    "Use that result together with the authoritative Horizon facts for three semantically different cross-horizon Findings and immediately return the required strict JSON. Leave every additional dimension or follow-up query to Ask AI deeper; do not execute a second successful SQL.",
    "Return only strict JSON with no markdown or commentary using this shape:",
    '{"findings":[{"relationship":"supports","horizons":["1d","7d"],"title":"...","what":"...","whyKind":"Evidence","why":"...","how":"...","howToVerify":"...","evidenceNote":"what the cited SQL supports or cannot prove","evidenceSqlIndexes":[1]}]}',
    "Official deterministic projection:",
    JSON.stringify(input.deterministicProjection),
  ].join("\n\n");
}

export function parseAgUiEventStream(text: string): AgUiEvent[] {
  return text
    .split(/\r?\n\r?\n/u)
    .map((chunk) => chunk
      .split(/\r?\n/u)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      .join("\n")
      .trim())
    .filter((data) => data && data !== "[DONE]")
    .flatMap((data) => {
      try {
        const parsed: unknown = JSON.parse(data);
        return isRecord(parsed) ? [parsed] : [];
      } catch {
        return [];
      }
    });
}

export function resolveNgeeAnnAiEventStream(input: {
  eventStream: string;
  input: NgeeAnnAiRunInput;
  providerProfileId: string;
  runId: string;
}): NgeeAnnAiRunResult {
  const events = parseAgUiEventStream(input.eventStream);
  const runError = events.findLast((event) => event.type === "RUN_ERROR");
  if (runError) {
    return { status: "unavailable", reason: stringValue(runError.message) ?? "The AI Analyst Run failed." };
  }
  if (!events.some((event) => event.type === "RUN_FINISHED")) {
    return { status: "unavailable", reason: "The AI Analyst Run did not finish." };
  }
  const collected = collectToolEvidence(events);
  if (collected.sqlAttemptCount > 2) {
    return { status: "unavailable", reason: "The AI Analyst exceeded the two-attempt SQL limit." };
  }
  const tools = collected.tools;
  const sqlTools = tools.filter((tool) => tool.toolName === "run_sql_readonly");
  if (!collected.schemaValid || sqlTools.length !== 1) {
    return { status: "unavailable", reason: "The AI Analyst did not complete exactly one successful read-only SQL Evidence query." };
  }
  const answer = events
    .filter((event) => event.type === "TEXT_MESSAGE_CONTENT")
    .map((event) => stringValue(event.delta) ?? "")
    .join("")
    .trim();
  const generated = parseGeneratedFindings(answer);
  if (!generated) {
    return { status: "unavailable", reason: "The AI Analyst returned an invalid three-Finding result." };
  }
  const selectedTools = generated.map((finding) => finding.evidenceSqlIndexes
    .map((index) => sqlTools[index - 1])
    .filter((tool): tool is CollectedToolEvidence => Boolean(tool)));
  if (selectedTools.some((selection, index) => selection.length !== generated[index]!.evidenceSqlIndexes.length)) {
    return { status: "unavailable", reason: "A Finding cited SQL Evidence that is not present in this Run." };
  }
  if (generated.some((finding, index) => narrativeHasUnsupportedNumber(
    finding,
    selectedTools[index]!,
    input.input,
  ))) {
    return { status: "unavailable", reason: "The AI Analyst returned a numeric claim without Finding-specific SQL Evidence." };
  }
  const findings = generated.map<NgeeAnnAiFinding>((finding, index) => ({
    id: `ai-finding-${index + 1}`,
    relationship: finding.relationship,
    horizons: finding.horizons,
    title: finding.title,
    what: finding.what,
    why: { kind: finding.whyKind, text: finding.why },
    how: finding.how,
    howToVerify: finding.howToVerify,
    evidenceNote: finding.evidenceNote,
    evidence: {
      snapshotId: input.input.snapshotId,
      dataCutoff: input.input.dataCutoff,
      dataQuality: input.input.dataQuality,
      tools: selectedTools[index]!.map(toPublicToolEvidence),
    },
  })) as [NgeeAnnAiFinding, NgeeAnnAiFinding, NgeeAnnAiFinding];
  return {
    status: "available",
    providerProfileId: input.providerProfileId,
    runId: input.runId,
    findings,
  };
}

function collectToolEvidence(events: AgUiEvent[]): {
  tools: CollectedToolEvidence[];
  schemaValid: boolean;
  sqlAttemptCount: number;
} {
  const accumulators = new Map<string, ToolAccumulator>();
  for (const event of events) {
    const id = stringValue(event.toolCallId) ?? stringValue(event.tool_call_id);
    if (!id) continue;
    const existing = accumulators.get(id) ?? {
      id,
      name: stringValue(event.toolCallName) ?? stringValue(event.tool_call_name) ?? "unknown",
      argsText: "",
      args: null,
      result: undefined,
    };
    existing.name = stringValue(event.toolCallName) ?? stringValue(event.tool_call_name) ?? existing.name;
    if (event.type === "TOOL_CALL_ARGS") {
      existing.argsText += stringValue(event.delta) ?? "";
    }
    if (isRecord(event.args)) existing.args = event.args;
    if (isRecord(event.parameters)) existing.args = event.parameters;
    if (event.type === "TOOL_CALL_RESULT") {
      existing.result = event.result ?? event.content;
    }
    accumulators.set(id, existing);
  }
  const attempts = [...accumulators.values()];
  const tools = attempts.flatMap<CollectedToolEvidence>((tool) => {
    if (tool.name !== "inspect_schema" && tool.name !== "run_sql_readonly") return [];
    if (tool.argsText && !tool.args) {
      try {
        const parsed: unknown = JSON.parse(tool.argsText);
        if (isRecord(parsed)) tool.args = parsed;
      } catch {}
    }
    if (tool.result === undefined) return [];
    const parsedSchema = tool.name === "inspect_schema" ? parseSchemaToolResult(tool.result) : null;
    const parsedSql = tool.name === "run_sql_readonly" ? parseSqlToolResult(tool.result) : null;
    if (tool.name === "inspect_schema" && !parsedSchema) return [];
    if (tool.name === "run_sql_readonly" && !parsedSql) return [];
    const preview = typeof tool.result === "string" ? tool.result : JSON.stringify(tool.result);
    return [{
      toolCallId: tool.id,
      toolName: tool.name,
      sql: tool.name === "run_sql_readonly" ? sqlFromToolPayload(tool.args, tool.result) ?? null : null,
      rowCount: parsedSql?.row_count ?? null,
      auditLogId: parsedSql?.audit_log_id ?? null,
      elapsedMs: parsedSql?.elapsed_ms ?? null,
      resultPreview: preview.slice(0, 2_000),
      numericEvidence: parsedSql ? JSON.stringify(parsedSql.rows) : "",
    }];
  });
  return {
    tools,
    schemaValid: tools.some((tool) => tool.toolName === "inspect_schema"),
    sqlAttemptCount: attempts.filter((tool) => tool.name === "run_sql_readonly").length,
  };
}

function toPublicToolEvidence(tool: CollectedToolEvidence): NgeeAnnAiToolEvidence {
  return {
    toolCallId: tool.toolCallId,
    toolName: tool.toolName,
    sql: tool.sql,
    rowCount: tool.rowCount,
    auditLogId: tool.auditLogId,
    elapsedMs: tool.elapsedMs,
    resultPreview: tool.resultPreview,
  };
}

type GeneratedFinding = {
  relationship: NgeeAnnAiRelationship;
  horizons: NgeeAnnAiHorizon[];
  title: string;
  what: string;
  whyKind: NgeeAnnAiWhyKind;
  why: string;
  how: string;
  howToVerify: string;
  evidenceNote: string;
  evidenceSqlIndexes: number[];
};

function parseGeneratedFindings(answer: string): [GeneratedFinding, GeneratedFinding, GeneratedFinding] | null {
  const firstBrace = answer.indexOf("{");
  const lastBrace = answer.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(answer.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.findings) || parsed.findings.length !== 3) return null;
  const findings = parsed.findings.flatMap<GeneratedFinding>((value) => {
    if (!isRecord(value)) return [];
    const relationship = stringValue(value.relationship);
    const whyKind = stringValue(value.whyKind);
    const horizons = parseHorizons(value.horizons);
    const evidenceSqlIndexes = parseEvidenceIndexes(value.evidenceSqlIndexes);
    const title = cleanText(value.title);
    const what = cleanText(value.what);
    const why = cleanText(value.why);
    const how = cleanText(value.how);
    const howToVerify = cleanText(value.howToVerify);
    const evidenceNote = cleanText(value.evidenceNote);
    if ((relationship !== "supports" && relationship !== "challenges" && relationship !== "independent")
      || (whyKind !== "Evidence" && whyKind !== "Hypothesis" && whyKind !== "Missing Evidence")
      || horizons.length === 0 || evidenceSqlIndexes.length === 0
      || !title || !what || !why || !how || !howToVerify || !evidenceNote) return [];
    return [{
      relationship,
      horizons,
      title,
      what,
      whyKind,
      why,
      how,
      howToVerify,
      evidenceNote,
      evidenceSqlIndexes,
    }];
  });
  if (findings.length !== 3) return null;
  const coveredHorizons = new Set(findings.flatMap((finding) => finding.horizons));
  if (!coveredHorizons.has("1d") || !coveredHorizons.has("7d") || !coveredHorizons.has("28d")) return null;
  const semanticKeys = findings.map((finding) => `${finding.title} ${finding.what}`
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim());
  if (new Set(semanticKeys).size !== semanticKeys.length) return null;
  return findings as [GeneratedFinding, GeneratedFinding, GeneratedFinding];
}

function parseHorizons(value: unknown): NgeeAnnAiHorizon[] {
  if (!Array.isArray(value)) return [];
  const horizons = value.filter((candidate): candidate is NgeeAnnAiHorizon => (
    candidate === "1d" || candidate === "7d" || candidate === "28d"
  ));
  return horizons.length === value.length ? [...new Set(horizons)] : [];
}

function parseEvidenceIndexes(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const indexes = value.filter((candidate): candidate is number => (
    typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate > 0
  ));
  return indexes.length === value.length ? [...new Set(indexes)] : [];
}

function narrativeHasUnsupportedNumber(
  finding: GeneratedFinding,
  tools: CollectedToolEvidence[],
  input: NgeeAnnAiRunInput,
): boolean {
  const narrative = [
    finding.title,
    finding.what,
    finding.why,
    finding.how,
    finding.howToVerify,
    finding.evidenceNote,
  ].join(" ");
  const evidenceNumbers = toNumericTokens([
    ...tools.map((tool) => tool.numericEvidence),
    JSON.stringify(input.horizons),
    JSON.stringify(input.dataQuality),
    JSON.stringify(input.deterministicProjection),
  ].join(" "))
    .map((token) => token.value);
  return toNumericTokens(narrative).some((token) => !numericClaimIsVerified(token, evidenceNumbers));
}

function numericClaimIsVerified(
  claim: { precision: number; value: number },
  evidence: number[],
): boolean {
  if (evidence.some((value) => numericValuesMatch(claim, value))) return true;
  for (const left of evidence) {
    for (const right of evidence) {
      const candidates = [
        left + right,
        left - right,
        right - left,
        ...(right !== 0 ? [left / right, (left / right) * 100, ((left - right) / right) * 100] : []),
      ];
      if (candidates.some((value) => Number.isFinite(value) && derivedNumericValueMatches(claim, value))) {
        return true;
      }
    }
  }
  return false;
}

function numericValuesMatch(
  claim: { precision: number; value: number },
  evidence: number,
): boolean {
  const tolerance = (0.5 * (10 ** -claim.precision)) + Number.EPSILON;
  return Math.abs(evidence - claim.value) <= tolerance;
}

function derivedNumericValueMatches(
  claim: { precision: number; value: number },
  evidence: number,
): boolean {
  const tolerance = 10 ** -claim.precision;
  // A candidate exactly one displayed unit away is not supporting Evidence.
  return Math.abs(evidence - claim.value) < tolerance;
}

function toNumericTokens(value: string): Array<{ precision: number; value: number }> {
  return (value.match(/[-+]?\d[\d,]*(?:\.\d+)?/gu) ?? []).flatMap((token) => {
    const normalized = token.replace(/,/gu, "");
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return [];
    return [{
      precision: normalized.includes(".") ? normalized.split(".")[1]!.length : 0,
      value: parsed,
    }];
  });
}

function buildAiDataQuality(snapshot: EnergyProjectAnalysisSnapshotDto): NgeeAnnAiDataQuality {
  const quality = snapshot.dataQuality;
  const limitation = quality.status === "complete"
    ? "No data-quality limitation is declared for this Snapshot."
    : quality.status === "partial"
      ? "Coverage or quality events make this Snapshot partial; interpret AI Findings within that limitation."
      : "Snapshot data quality is unavailable; AI Findings cannot be treated as complete Evidence.";
  return {
    status: quality.status,
    scope: "deterministic-overview-period",
    period: {
      from: snapshot.context.primaryPeriod.start,
      to: snapshot.context.primaryPeriod.endExclusive,
    },
    coveragePct: quality.coveragePct,
    validIntervalCount: quality.validIntervalCount,
    expectedMeterIntervalCount: quality.expectedMeterIntervalCount,
    qualityEventCount: quality.qualityEventCount,
    limitation: `${limitation} This summary covers only the deterministic Overview primary period, not the full AI lookback; use each cited SQL result for query-specific quality.`,
  };
}

function shiftLocalDate(localDate: string, days: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function cleanText(value: unknown): string | null {
  const text = stringValue(value)?.replace(/\s+/gu, " ").trim();
  return text && text.length <= 800 ? text : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readableError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "The AI Analyst is unavailable for this Snapshot.";
}
