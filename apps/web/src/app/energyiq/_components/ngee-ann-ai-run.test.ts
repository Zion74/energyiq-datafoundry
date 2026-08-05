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
          },
        },
      },
    });
    expect(JSON.stringify(body)).toContain("at most two successful high-information read-only SQL calls");
    expect(JSON.stringify(body)).toContain("the current validator rejects CTE and EXTRACT syntax");
    expect(JSON.stringify(body)).toContain("Do not execute a third SQL call");
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
        tools: [{ toolCallId: "sql-1" }],
      },
    });
    expect(result.findings[1]!.evidence.tools.map((tool) => tool.toolCallId)).toEqual(["sql-2"]);
    expect(result.findings[2]!.evidence.tools.map((tool) => tool.toolCallId)).toEqual(["sql-2"]);
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

  it("does not accept attaching every completed SQL call to every Finding", () => {
    const input = requiredInput();
    const findings = generatedFindings().map((finding) => ({
      ...finding,
      evidenceSqlIndexes: [1, 2],
    }));
    const result = resolveNgeeAnnAiEventStream({
      eventStream: successfulEventStream(findings),
      input,
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result).toEqual({
      status: "unavailable",
      reason: "The AI Analyst did not associate SQL Evidence with individual Findings.",
    });
  });

  it("rejects a Run that continues to a third SQL call", () => {
    const input = requiredInput();
    const result = resolveNgeeAnnAiEventStream({
      eventStream: successfulEventStream(
        generatedFindings(),
        sqlEvents("sql-3", "SELECT MAX(usage_kwh) AS peak_kwh FROM energy_intervals", 34.2),
      ),
      input,
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result).toEqual({
      status: "unavailable",
      reason: "The AI Analyst did not complete schema and read-only SQL Evidence.",
    });
  });

  it("numbers Evidence by successful SQL calls and ignores rejected attempts", () => {
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
});

function requiredInput(): NgeeAnnAiRunInput {
  const input = buildNgeeAnnAiRunInput(ngeeAnnGoldenSnapshot());
  if (!input) throw new Error("Expected the Golden Snapshot to support an AI Run");
  return input;
}

function successfulEventStream(
  findings = generatedFindings(),
  extraSqlEvents: Array<Record<string, unknown>> = [],
  beforeSqlEvents: Array<Record<string, unknown>> = [],
): string {
  const events: Array<Record<string, unknown>> = [
    { type: "TOOL_CALL_START", toolCallId: "schema-1", toolCallName: "inspect_schema" },
    {
      type: "TOOL_CALL_RESULT",
      toolCallId: "schema-1",
      toolCallName: "inspect_schema",
      result: { tables: [{ name: "energy_intervals", columns: [{ name: "usage_kwh", type: "DOUBLE" }] }] },
    },
    ...beforeSqlEvents,
    ...sqlEvents("sql-1", "SELECT SUM(usage_kwh) AS usage_kwh FROM energy_intervals", 150),
    ...sqlEvents("sql-2", "SELECT AVG(usage_kwh) AS average_kwh FROM energy_intervals", 21.4),
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
      evidenceSqlIndexes: [2],
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
      evidenceSqlIndexes: [2],
    },
  ];
}
