import {
  getEnergyIqHarnessEvalSuite,
  type EnergyIqHarnessEvalCase,
} from "./energyiq-harness-eval-cases.js";

type EventRecord = Record<string, unknown>;

export type EnergyIqHarnessObservation = {
  events: unknown[];
  elapsedMs: number;
  runId?: string;
  threadId?: string;
};

export type EnergyIqHarnessCaseReport = {
  caseId: string;
  title: string;
  attempt: number;
  status: "passed" | "failed";
  hardFailure: boolean;
  answer: string;
  snapshotIds: string[];
  assertions: Array<{ id: string; passed: boolean; hard: boolean; detail: string }>;
  metrics: {
    elapsedMs: number;
    toolCalls: number;
    failedToolCalls: number;
    recoveredToolFailures: number;
    sqlCalls: number;
    reasoningRounds: number;
    inputTokens: number;
    outputTokens: number;
    correctnessRatio: number;
    insightQuality: number | null;
  };
  runId?: string;
  threadId?: string;
};

export type EnergyIqHarnessSuiteReport = {
  schemaVersion: 1;
  suiteId: string;
  profileId: string;
  candidateVersion: string;
  baseUrl: string;
  generatedAt: string;
  status: "passed" | "failed";
  summary: {
    totalRuns: number;
    passedRuns: number;
    hardFailures: number;
    passRate: number;
    p50ElapsedMs: number;
    p95ElapsedMs: number;
    averageSqlCalls: number;
    averageReasoningRounds: number;
    averageCorrectnessRatio: number;
    averageInsightQuality: number | null;
    totalFailedToolCalls: number;
    totalRecoveredToolFailures: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  };
  cases: EnergyIqHarnessCaseReport[];
};

export type RunEnergyIqHarnessEvalInput = {
  suiteId: string;
  profileId: string;
  candidateVersion: string;
  baseUrl: string;
  attemptsPerCase?: number;
  caseIds?: string[];
  runCase: (
    evalCase: EnergyIqHarnessEvalCase,
    context: { profileId: string; attempt: number },
  ) => Promise<EnergyIqHarnessObservation>;
};

export const runEnergyIqHarnessEval = async (
  input: RunEnergyIqHarnessEvalInput,
): Promise<EnergyIqHarnessSuiteReport> => {
  const suiteCases = getEnergyIqHarnessEvalSuite(input.suiteId);
  const requestedCaseIds = new Set(input.caseIds ?? []);
  const cases = requestedCaseIds.size > 0
    ? suiteCases.filter((evalCase) => requestedCaseIds.has(evalCase.id))
    : suiteCases;
  if (cases.length !== requestedCaseIds.size && requestedCaseIds.size > 0) {
    const known = new Set(suiteCases.map((evalCase) => evalCase.id));
    const unknown = [...requestedCaseIds].filter((caseId) => !known.has(caseId));
    throw new Error(`ENERGYIQ_HARNESS_EVAL_CASE_UNKNOWN:${unknown.join(",")}`);
  }
  const attempts = Math.max(1, Math.floor(input.attemptsPerCase ?? 1));
  const reports: EnergyIqHarnessCaseReport[] = [];

  for (const evalCase of cases) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const observation = await input.runCase(evalCase, { profileId: input.profileId, attempt });
        reports.push(evaluateEnergyIqHarnessObservation(evalCase, observation, attempt));
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        reports.push({
          caseId: evalCase.id,
          title: evalCase.title,
          attempt,
          status: "failed",
          hardFailure: true,
          answer: "",
          snapshotIds: [],
          assertions: [{ id: "runner.completed", passed: false, hard: true, detail }],
          metrics: {
            elapsedMs: 0,
            toolCalls: 0,
            failedToolCalls: 0,
            recoveredToolFailures: 0,
            sqlCalls: 0,
            reasoningRounds: 0,
            inputTokens: 0,
            outputTokens: 0,
            correctnessRatio: 0,
            insightQuality: null,
          },
        });
      }
    }
  }

  const elapsed = reports.map((report) => report.metrics.elapsedMs).sort((a, b) => a - b);
  const insightScores = reports
    .map((report) => report.metrics.insightQuality)
    .filter((score): score is number => score !== null);
  const passedRuns = reports.filter((report) => report.status === "passed").length;
  const hardFailures = reports.filter((report) => report.hardFailure).length;
  return {
    schemaVersion: 1,
    suiteId: input.suiteId,
    profileId: input.profileId,
    candidateVersion: input.candidateVersion,
    baseUrl: input.baseUrl,
    generatedAt: new Date().toISOString(),
    status: passedRuns === reports.length ? "passed" : "failed",
    summary: {
      totalRuns: reports.length,
      passedRuns,
      hardFailures,
      passRate: ratio(passedRuns, reports.length),
      p50ElapsedMs: percentile(elapsed, 0.5),
      p95ElapsedMs: percentile(elapsed, 0.95),
      averageSqlCalls: average(reports.map((report) => report.metrics.sqlCalls)),
      averageReasoningRounds: average(reports.map((report) => report.metrics.reasoningRounds)),
      averageCorrectnessRatio: average(reports.map((report) => report.metrics.correctnessRatio)),
      averageInsightQuality: insightScores.length > 0 ? average(insightScores) : null,
      totalFailedToolCalls: sum(reports.map((report) => report.metrics.failedToolCalls)),
      totalRecoveredToolFailures: sum(reports.map((report) => report.metrics.recoveredToolFailures)),
      totalInputTokens: sum(reports.map((report) => report.metrics.inputTokens)),
      totalOutputTokens: sum(reports.map((report) => report.metrics.outputTokens)),
    },
    cases: reports,
  };
};

export const evaluateEnergyIqHarnessObservation = (
  evalCase: EnergyIqHarnessEvalCase,
  observation: EnergyIqHarnessObservation,
  attempt = 1,
): EnergyIqHarnessCaseReport => {
  const events = observation.events.filter(isRecord);
  const toolNames = events
    .filter((event) => stringValue(event.type) === "TOOL_CALL_START")
    .map((event) => stringValue(event.toolCallName))
    .filter(Boolean);
  const toolNameByCallId = new Map(events
    .filter((event) => stringValue(event.type) === "TOOL_CALL_START")
    .map((event) => [stringValue(event.toolCallId), stringValue(event.toolCallName)] as const)
    .filter(([toolCallId, toolCallName]) => toolCallId.length > 0 && toolCallName.length > 0));
  const toolResults = events.flatMap((event, eventIndex) => {
    if (stringValue(event.type) !== "TOOL_CALL_RESULT") return [];
    const toolCallName = stringValue(event.toolCallName)
      || toolNameByCallId.get(stringValue(event.toolCallId))
      || "unknown";
    return [{ event, eventIndex, toolCallName, failed: toolResultFailed(event) }];
  });
  const successfulToolNames = toolResults
    .filter((result) => !result.failed)
    .map((result) => result.toolCallName);
  const failedTools = toolResults.filter((result) => result.failed);
  const recoveredToolFailures = failedTools.filter((failed) => toolResults.some((candidate) => (
    candidate.eventIndex > failed.eventIndex
    && candidate.toolCallName === failed.toolCallName
    && !candidate.failed
  ))).length;
  const sqlCalls = toolNames.filter((name) => name === "run_sql_readonly").length;
  const reasoningRounds = countReasoningRounds(events);
  const answer = extractFinalAnswer(events);
  const assertions: EnergyIqHarnessCaseReport["assertions"] = [];
  const assert = (id: string, passed: boolean, detail: string, hard = false) => {
    assertions.push({ id, passed, hard, detail });
  };

  const runError = findLastEvent(events, (event) => stringValue(event.type) === "RUN_ERROR");
  assert("run.no-error", runError === undefined, runError ? JSON.stringify(runError) : "No RUN_ERROR", true);
  const terminal = findLastEvent(events, (event) => (
    stringValue(event.type) === "RUN_FINISHED" || stringValue(event.type) === "RUN_ERROR"
  ));
  assert("run.finished", stringValue(terminal?.type) === "RUN_FINISHED", `terminal=${stringValue(terminal?.type) || "missing"}`, true);
  assert("answer.present", answer.length > 0, `answer_chars=${answer.length}`, true);

  for (const required of evalCase.contract.requiredTools) {
    const started = toolNames.filter((name) => name === required).length;
    const succeeded = successfulToolNames.filter((name) => name === required).length;
    assert(`tool.${required}`, succeeded >= 1, `started=${started}, succeeded=${succeeded}`);
  }
  for (const forbidden of evalCase.contract.forbiddenTools) {
    assert(`tool.forbidden.${forbidden}`, !toolNames.includes(forbidden), `present=${toolNames.includes(forbidden)}`, true);
  }
  const inspectIndex = toolNames.indexOf("inspect_schema");
  const sqlIndex = toolNames.indexOf("run_sql_readonly");
  assert("tools.inspect-before-sql", sqlIndex < 0 || (inspectIndex >= 0 && inspectIndex < sqlIndex), `tools=${toolNames.join(",")}`);

  const protocolActions = extractSucceededProtocolActions(events);
  for (const required of evalCase.contract.requiredProtocolActions ?? []) {
    const count = protocolActions.filter((actionName) => actionName === required).length;
    assert(`protocol.${required}`, count >= 1, `succeeded=${count}`);
  }
  for (const forbidden of evalCase.contract.forbiddenProtocolActions ?? []) {
    const count = protocolActions.filter((actionName) => actionName === forbidden).length;
    assert(`protocol.forbidden.${forbidden}`, count === 0, `succeeded=${count}`, true);
  }

  const snapshotIds = extractSnapshotIds(events);
  if (evalCase.contract.requireSingleSnapshot) {
    assert("context.single-snapshot", snapshotIds.length === 1, `snapshot_ids=${snapshotIds.join(",") || "missing"}`, true);
    const resolvedWorkspaceId = extractResolvedWorkspaceId(events);
    assert("context.workspace", resolvedWorkspaceId === evalCase.workspaceId, `actual=${resolvedWorkspaceId || "missing"}`, true);
    const expectedProjectSnapshotPrefix = `project-analysis-snapshot:${evalCase.projectId}:`;
    assert(
      "context.project-snapshot",
      events.some((event) => JSON.stringify(event).includes(expectedProjectSnapshotPrefix)),
      `expected_prefix=${expectedProjectSnapshotPrefix}`,
      true,
    );
  }

  for (const [index, pattern] of (evalCase.contract.answerAllOf ?? []).entries()) {
    assert(`answer.all.${index + 1}`, regex(pattern).test(answer), `/${pattern}/`);
  }
  const anyPatterns = evalCase.contract.answerAnyOf ?? [];
  if (anyPatterns.length > 0) {
    assert("answer.any", anyPatterns.some((pattern) => regex(pattern).test(answer)), anyPatterns.map((pattern) => `/${pattern}/`).join(" OR "));
  }
  for (const [index, pattern] of (evalCase.contract.answerNoneOf ?? []).entries()) {
    assert(`answer.none.${index + 1}`, !regex(pattern).test(answer), `must not match /${pattern}/`, true);
  }
  for (const pattern of [
    "energy-scope-",
    "requirements? committed",
    "protocol completed",
    "validation completed",
    "adapter_missing",
    "SECRET_MASTER_KEY_REQUIRED",
    "ENERGYIQ_PROJECT_FORBIDDEN",
  ]) {
    assert(`answer.no-internal.${pattern}`, !regex(pattern).test(answer), `must not match /${pattern}/`, true);
  }

  if (evalCase.contract.chart) {
    const chart = extractChart(events);
    assert("chart.present", chart !== null, "backend chart artifact", true);
    assert("chart.type", chart?.chartType === evalCase.contract.chart.type, `actual=${chart?.chartType ?? "missing"}`, true);
    assert("chart.point-count", chart?.points.length === evalCase.contract.chart.pointCount, `actual=${chart?.points.length ?? 0}`, true);
    const sqlPointSets = extractSqlChartPointSets(events);
    assert(
      "chart.matches-sql",
      chart !== null && sqlPointSets.some((points) => chartPointsEqual(chart.points, points)),
      `chart_points=${chart?.points.length ?? 0}, sql_candidates=${sqlPointSets.length}`,
      true,
    );
  }

  const insightQuality = evalCase.contract.insightSignals
    ? scoreInsight(answer, evalCase.contract.insightSignals)
    : null;
  if (insightQuality !== null) {
    assert("insight.quality", insightQuality >= 7, `${insightQuality}/10`);
    const evidenceScore = scoreSignal(answer, evalCase.contract.insightSignals?.evidence ?? []);
    const verifyScore = scoreSignal(answer, evalCase.contract.insightSignals?.verify ?? []);
    assert("insight.evidence", evidenceScore > 0, `${evidenceScore}/2`, true);
    assert("insight.verify", verifyScore > 0, `${verifyScore}/2`);
  }

  const tokenTotals = events
    .filter((event) => stringValue(event.type) === "CUSTOM" && stringValue(event.name) === "token_usage")
    .reduce<{ input: number; output: number }>((total, event) => {
      const value = isRecord(event.value) ? event.value : {};
      return {
        input: total.input + numberValue(value.input_tokens ?? value.inputTokens),
        output: total.output + numberValue(value.output_tokens ?? value.outputTokens),
      };
    }, { input: 0, output: 0 });
  const hardFailure = assertions.some((entry) => !entry.passed && entry.hard);
  const correctnessAssertions = assertions.filter((entry) => isCorrectnessAssertion(entry.id));
  const passedCorrectnessAssertions = correctnessAssertions.filter((entry) => entry.passed).length;
  return {
    caseId: evalCase.id,
    title: evalCase.title,
    attempt,
    status: assertions.every((entry) => entry.passed) ? "passed" : "failed",
    hardFailure,
    answer,
    snapshotIds,
    assertions,
    metrics: {
      elapsedMs: observation.elapsedMs,
      toolCalls: toolNames.length,
      failedToolCalls: failedTools.length,
      recoveredToolFailures,
      sqlCalls,
      reasoningRounds,
      inputTokens: tokenTotals.input,
      outputTokens: tokenTotals.output,
      correctnessRatio: ratio(passedCorrectnessAssertions, correctnessAssertions.length),
      insightQuality,
    },
    ...(observation.runId ? { runId: observation.runId } : {}),
    ...(observation.threadId ? { threadId: observation.threadId } : {}),
  };
};

export const compareEnergyIqHarnessReports = (
  baseline: EnergyIqHarnessSuiteReport,
  candidate: EnergyIqHarnessSuiteReport,
) => ({
  passRateDelta: candidate.summary.passRate - baseline.summary.passRate,
  p50ElapsedMsDelta: candidate.summary.p50ElapsedMs - baseline.summary.p50ElapsedMs,
  p95ElapsedMsDelta: candidate.summary.p95ElapsedMs - baseline.summary.p95ElapsedMs,
  averageSqlCallsDelta: candidate.summary.averageSqlCalls - baseline.summary.averageSqlCalls,
  averageReasoningRoundsDelta: candidate.summary.averageReasoningRounds - baseline.summary.averageReasoningRounds,
  averageCorrectnessRatioDelta: candidate.summary.averageCorrectnessRatio - baseline.summary.averageCorrectnessRatio,
  averageInsightQualityDelta:
    candidate.summary.averageInsightQuality === null || baseline.summary.averageInsightQuality === null
      ? null
      : candidate.summary.averageInsightQuality - baseline.summary.averageInsightQuality,
  hardFailureDelta: candidate.summary.hardFailures - baseline.summary.hardFailures,
});

const extractFinalAnswer = (events: EventRecord[]): string => {
  const messages = new Map<string, string>();
  for (const event of events) {
    if (!["TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_CHUNK"].includes(stringValue(event.type))
      || typeof event.delta !== "string") continue;
    const messageId = stringValue(event.messageId) || "unknown";
    messages.set(messageId, `${messages.get(messageId) ?? ""}${event.delta}`);
  }
  return [...messages.values()].at(-1)?.trim() ?? "";
};

const extractSucceededProtocolActions = (events: EventRecord[]): string[] => events.flatMap((event) => {
  if (stringValue(event.type) !== "CUSTOM" || stringValue(event.name) !== "protocol.action.succeeded") return [];
  if (!isRecord(event.value) || !isRecord(event.value.payload)) return [];
  const actionName = stringValue(event.value.payload.actionName);
  return actionName ? [actionName] : [];
});

const extractSnapshotIds = (events: EventRecord[]): string[] => [...new Set(events.flatMap((event) => (
  JSON.stringify(event).match(/energy-snapshot-[a-z0-9]+/giu) ?? []
)))].sort();

const extractResolvedWorkspaceId = (events: EventRecord[]): string => {
  const event = findLastEvent(events, (candidate) => (
    stringValue(candidate.type) === "CUSTOM" && stringValue(candidate.name) === "run.config.resolved"
  ));
  return isRecord(event?.value) ? stringValue(event.value.workspace_id) : "";
};

const countReasoningRounds = (events: EventRecord[]): number => {
  const reasoningEvents = events.filter((event) => (
    stringValue(event.type) === "REASONING_START"
    || stringValue(event.type) === "REASONING_MESSAGE_START"
  ));
  const identifiedRounds = new Set(reasoningEvents
    .map((event) => stringValue(event.messageId))
    .filter(Boolean));
  const anonymousStarts = reasoningEvents.filter((event) => (
    stringValue(event.type) === "REASONING_START"
    && !stringValue(event.messageId)
  )).length;
  const anonymousMessageStarts = reasoningEvents.some((event) => stringValue(event.type) === "REASONING_START")
    ? 0
    : reasoningEvents.filter((event) => !stringValue(event.messageId)).length;
  return identifiedRounds.size + anonymousStarts + anonymousMessageStarts;
};

type ChartPoint = { label: string; value: number };

const extractChart = (events: EventRecord[]): { chartType: string; points: ChartPoint[] } | null => {
  const event = events.find((entry) => (
    stringValue(entry.type) === "CUSTOM"
    && stringValue(entry.name) === "artifact"
    && isRecord(entry.value)
    && stringValue(entry.value.type) === "chart"
  ));
  if (!event || !isRecord(event.value)) return null;
  let preview: unknown = event.value.preview_json;
  if (typeof preview === "string") {
    try { preview = JSON.parse(preview); } catch { return null; }
  }
  if (!isRecord(preview)) return null;
  const directPoints = Array.isArray(preview.points) ? chartPoints(preview.points) : [];
  const firstSeries = Array.isArray(preview.series) && isRecord(preview.series[0]) ? preview.series[0] : null;
  const seriesPoints = firstSeries && Array.isArray(firstSeries.points) ? chartPoints(firstSeries.points) : [];
  return { chartType: stringValue(preview.chartType), points: directPoints.length > 0 ? directPoints : seriesPoints };
};

const extractSqlChartPointSets = (events: EventRecord[]): ChartPoint[][] => {
  const sqlCallIds = new Set(events
    .filter((event) => stringValue(event.type) === "TOOL_CALL_START" && stringValue(event.toolCallName) === "run_sql_readonly")
    .map((event) => stringValue(event.toolCallId))
    .filter(Boolean));
  const pointSets: ChartPoint[][] = [];
  for (const event of events) {
    if (stringValue(event.type) === "TOOL_CALL_RESULT") {
      const toolName = stringValue(event.toolCallName);
      const toolCallId = stringValue(event.toolCallId);
      if (toolName !== "run_sql_readonly" && !sqlCallIds.has(toolCallId)) continue;
      for (const candidate of eventPayloadCandidates(event)) {
        const points = tabularChartPoints(isRecord(candidate.result) ? candidate.result : candidate);
        if (points.length > 0) pointSets.push(points);
      }
      continue;
    }

    if (stringValue(event.type) !== "CUSTOM"
      || stringValue(event.name) !== "artifact"
      || !isRecord(event.value)
      || stringValue(event.value.type) !== "table"
      || !sqlCallIds.has(stringValue(event.value.tool_call_id))) continue;
    const points = tabularChartPoints(parseJsonRecord(event.value.preview_json));
    if (points.length > 0) pointSets.push(points);
  }
  return pointSets;
};

const tabularChartPoints = (payload: EventRecord | null): ChartPoint[] => {
  if (!payload || !Array.isArray(payload.columns) || payload.columns.length !== 2 || !Array.isArray(payload.rows)) return [];
  const points = payload.rows.flatMap((row) => {
    if (!Array.isArray(row) || row.length < 2) return [];
    const label = chartPointLabel(row[0]);
    const value = Number(row[1]);
    return label && Number.isFinite(value) ? [{ label, value }] : [];
  });
  return points.length === payload.rows.length && points.length > 0 ? points : [];
};

const parseJsonRecord = (value: unknown): EventRecord | null => {
  let parsed = value;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { return null; }
  }
  return isRecord(parsed) ? parsed : null;
};

const eventPayloadCandidates = (event: EventRecord): EventRecord[] => [event.result, event.content, event.value]
  .flatMap((candidate) => {
    let parsed = candidate;
    if (typeof parsed === "string" && parsed.trim().startsWith("{")) {
      try { parsed = JSON.parse(parsed); } catch { return []; }
    }
    return isRecord(parsed) ? [parsed] : [];
  });

const chartPoints = (values: unknown[]): ChartPoint[] => values.flatMap((value) => {
  if (!isRecord(value)) return [];
  const label = chartPointLabel(value.label);
  const numericValue = Number(value.value);
  return label && Number.isFinite(numericValue) ? [{ label, value: numericValue }] : [];
});

const chartPointLabel = (value: unknown): string => value instanceof Date
  ? value.toISOString()
  : typeof value === "string" || typeof value === "number" ? String(value) : "";

const chartPointsEqual = (left: ChartPoint[], right: ChartPoint[]): boolean => left.length === right.length
  && left.every((point, index) => {
    const comparison = right[index];
    return comparison !== undefined
      && point.label === comparison.label
      && Math.abs(point.value - comparison.value) <= 1e-9;
  });

const scoreInsight = (
  answer: string,
  signals: NonNullable<EnergyIqHarnessEvalCase["contract"]["insightSignals"]>,
) => sum([
  scoreSignal(answer, signals.what),
  scoreSignal(answer, signals.evidence),
  scoreSignal(answer, signals.why),
  scoreSignal(answer, signals.action),
  scoreSignal(answer, signals.verify),
]);

const scoreSignal = (answer: string, patterns: string[]): number => Math.min(
  2,
  patterns.filter((pattern) => regex(pattern).test(answer)).length,
);

const toolResultFailed = (event: EventRecord): boolean => {
  const candidates = [event.result, event.content, event.value];
  for (const candidate of candidates) {
    let parsed = candidate;
    if (typeof parsed === "string" && parsed.trim().startsWith("{")) {
      try { parsed = JSON.parse(parsed); } catch { continue; }
    }
    if (!isRecord(parsed)) continue;
    if (parsed.success === false || parsed.ok === false || parsed.isError === true) return true;
    if (typeof parsed.error === "string" && parsed.error.length > 0) return true;
  }
  return false;
};

const regex = (pattern: string): RegExp => new RegExp(pattern, "iu");
const isCorrectnessAssertion = (id: string): boolean => [
  "answer.all.",
  "answer.any",
  "answer.none.",
  "chart.",
  "insight.",
].some((prefix) => id.startsWith(prefix));
const findLastEvent = (
  events: EventRecord[],
  predicate: (event: EventRecord) => boolean,
): EventRecord | undefined => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event && predicate(event)) return event;
  }
  return undefined;
};
const isRecord = (value: unknown): value is EventRecord => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const stringValue = (value: unknown): string => typeof value === "string" ? value : "";
const numberValue = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);
const average = (values: number[]): number => values.length > 0 ? sum(values) / values.length : 0;
const ratio = (numerator: number, denominator: number): number => denominator > 0 ? numerator / denominator : 0;
const percentile = (sortedValues: number[], fraction: number): number => {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * fraction) - 1);
  return sortedValues[index] ?? 0;
};
