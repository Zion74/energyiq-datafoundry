import { afterEach, describe, expect, it, vi } from "vitest";

import { configApi } from "../../../lib/config-api";
import {
  buildAgentRunBody,
  buildNgeeAnnAiRunInput,
  getOrStartNgeeAnnAiRun,
  resetNgeeAnnAiRunsForTests,
  resolveNgeeAnnAiEventStream,
  type NgeeAnnAiRunInput,
} from "./ngee-ann-ai-run";
import { ngeeAnnGoldenSnapshot } from "./ngee-ann-overview.test-fixture";
import { buildNgeeAnnOverviewViewModel } from "./ngee-ann-overview-view-model";

describe("Ngee Ann AI Run", () => {
  afterEach(() => {
    resetNgeeAnnAiRunsForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("pins the real Run to the current user, Snapshot and cutoff identity", () => {
    const input = requiredInput();
    const body = buildAgentRunBody(input, "profile-1", "run-1", "thread-1");

    expect(input.identityKey).toContain(input.snapshotId);
    expect(input.identityKey).toContain(input.dataCutoff);
    for (const identityPart of [
      input.projectReleaseId,
      "ngee-ann-overview",
      "hierarchy-v6",
      "mapping-v1",
      "formula-v1",
      "metric-v1",
      "calendar-v1",
      "tariff-v1",
    ]) {
      expect(input.identityKey).toContain(identityPart);
    }
    expect(body).toMatchObject({
      method: "agent/run",
      params: { agentId: "dataFoundry" },
      body: {
        threadId: "thread-1",
        runId: "run-1",
        forwardedProps: {
          externalContext: {
            source: "energyiq",
            projectId: input.projectId,
            scopeId: input.scopeId,
            resource: "electricity",
            period: "Custom",
            from: input.analysisFrom,
            to: input.analysisTo,
            expectedDataSnapshotId: input.snapshotId,
            expectedProjectReleaseId: input.projectReleaseId,
          },
        },
      },
    });
    expect(JSON.stringify(body)).toContain("at most two total run_sql_readonly attempts");
    expect(JSON.stringify(body)).toContain("rejected or failed calls count toward this limit");
    expect(JSON.stringify(body)).toContain("Stop after the first successful SQL call");
    expect(JSON.stringify(body)).toContain("execute exactly the following concise cross-horizon Level query");
    expect(JSON.stringify(body)).toContain("FROM <INSPECTED_TABLE>");
    expect(JSON.stringify(body)).toContain("Leave every additional dimension or follow-up query to Ask AI deeper");
    expect(JSON.stringify(body)).toContain("Do not use WITH/CTEs or EXTRACT syntax");
    expect(JSON.stringify(body)).toContain("official_aggregation_eligible=TRUE");
    expect(JSON.stringify(body)).toContain("include every runtime assertion_id");
    expect(JSON.stringify(body)).toContain("retry only once");
    expect(JSON.stringify(body)).toContain(
      "never invent a numeric threshold, target, tolerance, percentage, duration, or time window",
    );
    expect(JSON.stringify(body)).toContain(
      "only numeric values directly present in the successful SQL result or authoritative deterministic context",
    );
    expect(JSON.stringify(body)).toContain(
      "a single-step sum, difference, ratio, or percentage",
    );
    expect(JSON.stringify(body)).toContain("Never report a multi-step derived number");
    expect(JSON.stringify(body)).toContain(
      "Verification may name the metric or dimension to monitor, but it must not introduce a new number.",
    );
  });

  it("requires How to be a next investigation or action instead of a repeated summary", () => {
    const prompt = JSON.stringify(buildAgentRunBody(requiredInput(), "profile-1", "run-1", "thread-1"));

    expect(prompt).toContain("How must state the next investigation or operational action");
    expect(prompt).toContain("It must not restate What, Why, or the numeric Evidence in different words");
    expect(prompt).toContain(
      "How to verify must name the observed outcome, metric, or dimension that would confirm or challenge the Finding",
    );
  });

  it("accepts three distinct Findings with collective horizon coverage and Finding-specific SQL Evidence", () => {
    const input = requiredInput();
    const result = resolveNgeeAnnAiEventStream({
      eventStream: successfulEventStream(),
      input,
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(result.findings).toHaveLength(3);
    expect(result.findings[0]).toMatchObject({
      relationship: "supports",
      horizons: ["1d", "7d"],
      howToVerify: "Check the next complete day after the operating review.",
      evidence: {
        snapshotId: input.snapshotId,
        dataCutoff: input.dataCutoff,
        dataQuality: {
          status: "complete",
          scope: "deterministic-overview-period",
          period: {
            from: "2026-06-09T16:00:00.000Z",
            to: "2026-06-16T16:00:00.000Z",
          },
          coveragePct: 100,
          qualityEventCount: 0,
        },
        tools: [{ toolCallId: "sql-1" }],
      },
    });
    expect(result.findings[1]!.evidence.tools.map((tool) => tool.toolCallId)).toEqual(["sql-1"]);
    expect(result.findings[2]!.evidence.tools.map((tool) => tool.toolCallId)).toEqual(["sql-1"]);
    expect(new Set(result.findings.flatMap((finding) => finding.horizons))).toEqual(new Set(["1d", "7d", "28d"]));
  });

  it("fails the AI layer closed when a numeric claim is absent from that Finding's SQL result", () => {
    const input = requiredInput();
    const findings = generatedFindings();
    findings[0]!.what = "Usage rose by 999 kWh.";
    const eventStream = successfulEventStream(findings).replaceAll(
      "SELECT SUM(usage_kwh) AS usage_kwh FROM energy_intervals",
      "SELECT 999 AS decoy FROM energy_intervals",
    );
    const result = resolveNgeeAnnAiEventStream({
      eventStream,
      input,
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result).toEqual({
      status: "unavailable",
      reason: "The AI Analyst returned a numeric claim without Finding-specific SQL Evidence.",
    });
  });

  it("accepts display rounding of a number that is present in Finding-specific SQL Evidence", () => {
    const input = requiredInput();
    const findings = generatedFindings();
    findings[0]!.what = "Usage reached 168.96 kWh.";
    const result = resolveNgeeAnnAiEventStream({
      eventStream: successfulEventStream(
        findings,
        [],
        [],
        sqlEvents("sql-1", "SELECT SUM(usage_kwh) AS usage_kwh FROM energy_intervals", 168.9645),
      ),
      input,
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result.status).toBe("available");
  });

  it("accepts server-recomputed arithmetic from pinned Horizon facts", () => {
    const input = requiredInput();
    const findings = generatedFindings();
    findings[0]!.what = "The rolling window increased by 319.49 kWh and 26.4%.";
    const result = resolveNgeeAnnAiEventStream({
      eventStream: successfulEventStream(findings),
      input,
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result.status).toBe("available");
  });

  it("accepts one-last-place display rounding for a server-recomputed percentage", () => {
    const input = requiredInput();
    const findings = generatedFindings();
    findings[0]!.what = "Level 7 accounts for 68.9% of the rolling total.";
    const result = resolveNgeeAnnAiEventStream({
      eventStream: successfulEventStream(
        findings,
        [],
        [],
        sqlEvents(
          "sql-1",
          "SELECT SUM(usage_kwh) AS level_usage_kwh FROM energy_intervals",
          1054.184497,
        ),
      ),
      input,
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result.status).toBe("available");
  });

  it("rejects a second successful SQL query even when every Finding cites the first", () => {
    const input = requiredInput();
    const result = resolveNgeeAnnAiEventStream({
      eventStream: successfulEventStream(
        generatedFindings(),
        sqlEvents("sql-2", "SELECT AVG(usage_kwh) AS average_kwh FROM energy_intervals", 21.4),
      ),
      input,
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result).toEqual({
      status: "unavailable",
      reason: "The AI Analyst did not complete exactly one successful read-only SQL Evidence query.",
    });
  });

  it("rejects a Run that continues to a third SQL call", () => {
    const input = requiredInput();
    const result = resolveNgeeAnnAiEventStream({
      eventStream: successfulEventStream(
        generatedFindings(),
        [
          ...sqlEvents("sql-2", "SELECT AVG(usage_kwh) AS average_kwh FROM energy_intervals", 21.4),
          ...sqlEvents("sql-3", "SELECT MAX(usage_kwh) AS peak_kwh FROM energy_intervals", 34.2),
        ],
      ),
      input,
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result).toEqual({
      status: "unavailable",
      reason: "The AI Analyst exceeded the two-attempt SQL limit.",
    });
  });

  it("counts a rejected SQL toward the limit while numbering Evidence only by the successful SQL", () => {
    const input = requiredInput();
    const rejectedAttempt = [
      { type: "TOOL_CALL_START", toolCallId: "sql-rejected", toolCallName: "run_sql_readonly", args: { sql: "WITH invalid AS (...)" } },
      {
        type: "TOOL_CALL_RESULT",
        toolCallId: "sql-rejected",
        toolCallName: "run_sql_readonly",
        result: { error: "QUERY_VALIDATION_FAILED" },
      },
    ];
    const result = resolveNgeeAnnAiEventStream({
      eventStream: successfulEventStream(
        generatedFindings().map((finding) => ({ ...finding, evidenceSqlIndexes: [1] })),
        [],
        rejectedAttempt,
        sqlEvents("sql-1", "SELECT SUM(usage_kwh) AS usage_kwh FROM energy_intervals", 150),
      ),
      input,
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(result.findings.flatMap((finding) => finding.evidence.tools))
      .not.toContainEqual(expect.objectContaining({ toolCallId: "sql-rejected" }));
  });

  it("fails closed when one rejected SQL is followed by two successful SQL calls", () => {
    const input = requiredInput();
    const rejectedAttempt = [
      { type: "TOOL_CALL_START", toolCallId: "sql-rejected", toolCallName: "run_sql_readonly", args: { sql: "WITH invalid AS (...)" } },
      {
        type: "TOOL_CALL_RESULT",
        toolCallId: "sql-rejected",
        toolCallName: "run_sql_readonly",
        result: { error: "QUERY_VALIDATION_FAILED" },
      },
    ];
    const result = resolveNgeeAnnAiEventStream({
      eventStream: successfulEventStream(
        generatedFindings(),
        [],
        rejectedAttempt,
        [
          ...sqlEvents("sql-1", "SELECT SUM(usage_kwh) AS usage_kwh FROM energy_intervals", 150),
          ...sqlEvents("sql-2", "SELECT AVG(usage_kwh) AS average_kwh FROM energy_intervals", 21.4),
        ],
      ),
      input,
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result).toEqual({
      status: "unavailable",
      reason: "The AI Analyst exceeded the two-attempt SQL limit.",
    });
  });

  it("fails closed when inspect_schema returns an error payload", () => {
    const input = requiredInput();
    const result = resolveNgeeAnnAiEventStream({
      eventStream: successfulEventStream(
        generatedFindings(),
        [],
        [],
        undefined,
        { ok: false, error: { code: "SCHEMA_UNAVAILABLE" } },
      ),
      input,
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result).toEqual({
      status: "unavailable",
      reason: "The AI Analyst did not complete exactly one successful read-only SQL Evidence query.",
    });
  });

  it("does not start from a Renderer-validated unavailable decision priority ViewModel", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    snapshot.decisionPriorities!.items[0]!.rank = 2;
    const decisionPriorities = buildNgeeAnnOverviewViewModel(snapshot).decisionPriorities;

    expect(decisionPriorities.status).toBe("unavailable");
    expect(buildNgeeAnnAiRunInput(snapshot, decisionPriorities)).toBeNull();
  });

  it("starts only one actual request for repeated callers with the same identity", async () => {
    const input = requiredInput();
    vi.spyOn(configApi, "getRunDefaults").mockResolvedValue({ activeLlmProfileId: "profile-1" } as never);
    const fetchMock = vi.fn().mockResolvedValue(new Response(successfulEventStream(), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const first = getOrStartNgeeAnnAiRun(input);
    const second = getOrStartNgeeAnnAiRun(input);

    expect(first).toBe(second);
    await expect(first).resolves.toMatchObject({ status: "available" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps an unavailable result idempotent for the same page identity", async () => {
    const input = requiredInput();
    vi.spyOn(configApi, "getRunDefaults").mockResolvedValue({ activeLlmProfileId: "profile-1" } as never);
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getOrStartNgeeAnnAiRun(input)).resolves.toEqual({
      status: "unavailable",
      reason: "AI Analyst request failed (503).",
    });
    await expect(getOrStartNgeeAnnAiRun(input)).resolves.toEqual({
      status: "unavailable",
      reason: "AI Analyst request failed (503).",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function requiredInput(): NgeeAnnAiRunInput {
  const snapshot = ngeeAnnGoldenSnapshot();
  const input = buildNgeeAnnAiRunInput(
    snapshot,
    buildNgeeAnnOverviewViewModel(snapshot).decisionPriorities,
  );
  if (!input) throw new Error("Expected the Golden Snapshot to support an AI Run");
  return input;
}

function successfulEventStream(
  findings = generatedFindings(),
  extraSqlEvents: Array<Record<string, unknown>> = [],
  beforeSqlEvents: Array<Record<string, unknown>> = [],
  successfulSqlEvents: Array<Record<string, unknown>> | undefined = undefined,
  schemaResult: unknown = { tables: [{ name: "energy_intervals", columns: [{ name: "usage_kwh", type: "DOUBLE" }] }] },
): string {
  const events: Array<Record<string, unknown>> = [
    { type: "TOOL_CALL_START", toolCallId: "schema-1", toolCallName: "inspect_schema" },
    {
      type: "TOOL_CALL_RESULT",
      toolCallId: "schema-1",
      toolCallName: "inspect_schema",
      result: schemaResult,
    },
    ...beforeSqlEvents,
    ...(successfulSqlEvents ?? sqlEvents(
      "sql-1",
      "SELECT SUM(usage_kwh) AS usage_kwh FROM energy_intervals",
      150,
    )),
    ...extraSqlEvents,
    { type: "TEXT_MESSAGE_CONTENT", delta: JSON.stringify({ findings }) },
    { type: "RUN_FINISHED" },
  ];
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

function sqlEvents(toolCallId: string, sql: string, value: number): Array<Record<string, unknown>> {
  return [
    { type: "TOOL_CALL_START", toolCallId, toolCallName: "run_sql_readonly", args: { sql } },
    {
      type: "TOOL_CALL_RESULT",
      toolCallId,
      toolCallName: "run_sql_readonly",
      result: {
        sql,
        columns: ["value"],
        rows: [[value]],
        row_count: 1,
        audit_log_id: `audit-${toolCallId}`,
        elapsed_ms: 12,
      },
    },
  ];
}

function generatedFindings() {
  return [
    {
      relationship: "supports",
      horizons: ["1d", "7d"],
      title: "A recent operating pattern deserves attention",
      what: "The latest pattern is above its comparison.",
      whyKind: "Evidence",
      why: "The daily aggregation supports the direction of the deterministic theme.",
      how: "Inspect operations that overlap the elevated period.",
      howToVerify: "Check the next complete day after the operating review.",
      evidenceNote: "The cited aggregation supports the direction, not the root cause.",
      evidenceSqlIndexes: [1],
    },
    {
      relationship: "challenges",
      horizons: ["7d", "28d"],
      title: "The average shape is less pronounced",
      what: "The broader average tempers the recent movement.",
      whyKind: "Hypothesis",
      why: "A broader window may contain different operating conditions.",
      how: "Separate occupied and unoccupied periods for investigation.",
      howToVerify: "Compare the segmented averages using the same cutoff.",
      evidenceNote: "The cited average challenges magnitude, while causality is unproven.",
      evidenceSqlIndexes: [1],
    },
    {
      relationship: "independent",
      horizons: ["28d"],
      title: "A peak-focused investigation is independently useful",
      what: "The maximum interval points to a separate operational check.",
      whyKind: "Missing Evidence",
      why: "The interval value alone does not identify equipment state.",
      how: "Review the coincident circuit and operating context.",
      howToVerify: "Re-run the peak query after the suspected condition is changed.",
      evidenceNote: "The cited maximum identifies timing, not a confirmed driver.",
      evidenceSqlIndexes: [1],
    },
  ];
}
