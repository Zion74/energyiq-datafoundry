import { afterEach, describe, expect, it, vi } from "vitest";

import { configApi } from "../../../lib/config-api";
import {
  buildPreschoolAgentRunBody,
  buildPreschoolAiRunInput,
  executePreschoolAiRun,
  getOrStartPreschoolAiRun,
  resetPreschoolAiRunsForTests,
  resolvePreschoolAiEventStream,
  type PreschoolAiRunInput,
} from "./preschool-ai-run";
import { preschoolGoldenSnapshot } from "./preschool-overview.test-fixture";
import { buildPreschoolOverviewViewModel } from "./preschool-overview-view-model";

describe("Preschool AI Run", () => {
  afterEach(() => {
    resetPreschoolAiRunsForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("builds one bounded Run pinned to the published Preschool Snapshot", () => {
    const input = requiredInput();
    const body = buildPreschoolAgentRunBody(input, "profile-1", "run-1", "thread-1");
    const serialized = JSON.stringify(body);

    expect(input).toMatchObject({
      projectId: "preschool-demo",
      snapshotId: "preschool-26b85b9c0b95e090",
      projectReleaseId: "legacy-profile:preschool-demo:1",
      analysisFrom: "2026-05-01",
      analysisTo: "2026-05-31",
    });
    for (const pin of [
      "preschool-26b85b9c0b95e090",
      "legacy-profile:preschool-demo:1",
      "preschool-overview",
      "preschool-hierarchy-v4",
      "preschool-mapping-v4",
      "preschool-formula-v1",
      "metric-revisions:energy.total_usage_kwh@1,energy.usage_per_person,energy.usage_per_sqm",
      "sg-preschool-calendar-v1",
    ]) expect(input.identityKey).toContain(pin);
    expect(body).toMatchObject({
      method: "agent/run",
      params: { agentId: "dataFoundry" },
      body: {
        forwardedProps: {
          externalContext: {
            source: "energyiq",
            projectId: "preschool-demo",
            scopeId: "preschool-project",
            resource: "electricity",
            period: "Custom",
            from: "2026-05-01",
            to: "2026-05-31",
            expectedDataSnapshotId: input.snapshotId,
            expectedProjectReleaseId: input.projectReleaseId,
          },
          run_config: {
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
    });
    expect(serialized).toContain("Return zero to three distinct Findings");
    expect(serialized).toContain(
      "Your first action must be an immediate inspect_schema Tool call",
    );
    expect(serialized).toContain(
      "do not restate, explain, plan, summarize, or precompute the task or contract",
    );
    expect(serialized).toContain("Each displayed Finding must cite the first successful SQL observation and the final successful validation");
    expect(serialized).toContain(
      "include every runtime assertion_id listed for each requirement_id, including manual assertions",
    );
    expect(serialized).toContain("Make at most four total run_sql_readonly attempts");
    expect(serialized).toContain(
      "observation scan, a targeted drill-down, and a validation or contradiction check",
    );
    expect(serialized).toContain(
      "stating 100% coverage requires citing quality:may in that same Finding",
    );
    expect(serialized).toContain(
      "This is an Evidence-binding example, not a required Finding or theme",
    );
    expect(serialized).toContain("Do not call analysis_requirements_commit");
    expect(serialized).toContain(
      "A successful SQL may return one aggregate row or a bounded grouped, ranked, or Top-N result",
    );
    expect(serialized).toContain(
      "Do not request more than 10 rows from one SQL Evidence operation",
    );
    expect(serialized).toContain(
      "Never use row position, rank, Top N size, LIMIT value, or row count in a Finding as Evidence or a numeric claim unless that quantity is returned as a real named SQL column value",
    );
    expect(serialized).not.toContain("must return exactly one row");
    expect(serialized).toContain(
      "Never estimate, sum, extrapolate, approximate, or infer values from truncated, previewed, omitted, or remaining rows",
    );
    expect(serialized).toContain(
      "Every number in a Finding must appear directly in that Finding's cited bundle item values or cited SQL row",
    );
    expect(serialized).toContain(
      "Do not use digits copied from artifact ids, audit ids, query ids, version strings, Snapshot ids, or dates as Finding numbers",
    );
    expect(serialized).toContain(
      "Exact pinned Period, Snapshot, Release, and derived full-period presentation may appear only as structural context",
    );
    expect(serialized).toContain("Return zero Findings when no directly cited Evidence supports a useful candidate");
    expect(serialized).toContain("parent_node_id");
    expect(serialized).toContain("official_aggregation_eligible=TRUE");
    expect(serialized).toContain("quality_status='ok'");
    expect(serialized).toContain("Bounded Preschool Discovery Evidence Bundle");
    expect(serialized).toContain("evidenceRefs may be empty for an independent SQL-only angle");
    expect(serialized).not.toContain("exactly three Findings");
    expect(serialized).not.toContain("horizons");
    expect(serialized).not.toContain("forecastKwh");
    expect(serialized).not.toContain("costAmount");
    expect(serialized.length).toBeLessThan(16_000);
  });

  it("keeps autonomous discovery available when no deterministic theme is publishable", () => {
    const snapshot = preschoolGoldenSnapshot();
    const emptyThemes = {
      ...buildPreschoolOverviewViewModel(snapshot).decisionSummary,
      items: [],
    };

    expect(buildPreschoolAiRunInput(snapshot, emptyThemes)).not.toBeNull();
  });

  it("accepts zero Findings after one governed observation when no useful path survives", () => {
    const result = resolvePreschoolAiEventStream({
      eventStream: successfulEventStream([], sqlEvents("sql-1", 843.0985)),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result).toEqual({
      status: "available",
      providerProfileId: "profile-1",
      runId: "run-1",
      packId: "preschool-analysis-pack",
      packRevision: "v1",
      findings: [],
    });
  });

  it("accepts distinct autonomous Findings and exposes only Finding-specific Evidence", () => {
    const input = requiredInput();
    const result = resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(generatedFindings()),
      input,
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0]).toMatchObject({
      relationship: "supports",
      why: { kind: "Evidence" },
      evidence: {
        snapshotId: input.snapshotId,
        deterministic: [expect.objectContaining({ id: "benchmark:priority-centre:G" })],
        tools: [
          expect.objectContaining({ toolCallId: "sql-1" }),
          expect.objectContaining({ toolCallId: "sql-2" }),
        ],
      },
    });
    expect(result.findings[1]!.evidence.tools).toHaveLength(2);
  });

  it("accepts an independent SQL-only angle without forcing an official bundle theme", () => {
    const finding = generatedFindings()[0]!;
    finding.relationship = "independent";
    finding.title = "A separate operating pattern warrants review";
    finding.what = "The observation and validation queries expose a separate operating pattern.";
    finding.evidenceRefs = [];
    const result = resolvePreschoolAiEventStream({
      eventStream: successfulEventStream([finding]),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(result.findings[0]!.evidence.deterministic).toEqual([]);
    expect(result.findings[0]!.evidence.tools).toHaveLength(2);
  });

  it("rejects a displayed Finding that does not cite at least two investigation operations", () => {
    const findings = generatedFindings();
    findings[0]!.evidenceSqlIndexes = [1];
    const result = resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result).toEqual({
      status: "unavailable",
      reason: "Each displayed Preschool Finding must cite at least two successful SQL Evidence operations.",
    });
  });

  it.each([
    ["a duplicated Evidence index", [1, 1]],
    ["only one Evidence index", [1]],
  ])("rejects %s after unique-index normalization", (_name, evidenceSqlIndexes) => {
    const findings = generatedFindings();
    findings[0]!.evidenceSqlIndexes = evidenceSqlIndexes;
    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    })).toEqual({
      status: "unavailable",
      reason: "Each displayed Preschool Finding must cite at least two successful SQL Evidence operations.",
    });
  });

  it("rejects two Evidence indexes when they repeat the same normalized SQL", () => {
    const repeatedSql = [
      ...sqlEvents("sql-1", 843.0985),
      ...sqlEvents("sql-2", 62.4),
    ];
    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(generatedFindings(), repeatedSql),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    })).toEqual({
      status: "unavailable",
      reason: "Each displayed Preschool Finding must cite at least two distinct SQL queries.",
    });
  });

  it.each([
    ["declared row count", oversizedSqlEvents("sql-2", 11, 1)],
    ["returned rows", oversizedSqlEvents("sql-2", 1, 11)],
  ])("rejects SQL Evidence whose %s exceeds ten", (_name, oversized) => {
    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(generatedFindings(), [
        ...sqlEvents("sql-1", 843.0985),
        ...oversized,
      ]),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    })).toEqual({
      status: "unavailable",
      reason: "The AI Analyst exceeded the ten-row SQL Evidence limit.",
    });
  });

  it("rejects unsupported numeric claims and Snapshot pin drift", () => {
    const findings = generatedFindings();
    findings[0]!.what = "Centre G used 999 kWh.";
    const unsupported = resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });
    expect(unsupported).toEqual({
      status: "unavailable",
      reason: "The AI Analyst returned a numeric claim without Finding-specific Evidence.",
    });

    const drifted = requiredInput();
    drifted.discoveryEvidence.identity.snapshotId = "another-snapshot";
    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(),
      input: drifted,
      providerProfileId: "profile-1",
      runId: "run-1",
    })).toEqual({
      status: "unavailable",
      reason: "The Preschool Discovery Evidence does not match this Run identity.",
    });
  });

  it("binds an SQL-only numeric claim to the cited column meaning", () => {
    const valid = generatedFindings();
    valid[0]!.relationship = "independent";
    valid[0]!.evidenceRefs = [];
    valid[0]!.what = "The drill-down returned 62.4 kWh for the selected hour.";
    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(valid),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    }).status).toBe("available");

    const mismatched = generatedFindings();
    mismatched[0]!.relationship = "independent";
    mismatched[0]!.evidenceRefs = [];
    mismatched[0]!.what = "The drill-down returned 62.4 Centres.";
    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(mismatched),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    })).toEqual({
      status: "unavailable",
      reason: "The AI Analyst returned a numeric claim without Finding-specific Evidence.",
    });
  });

  it("accepts the exact pinned Run dates and an actually cited SQL Evidence index as structural references", () => {
    const findings = generatedFindings();
    findings[0]!.what = "From 2026-05-01 through 2026-05-31, SQL Evidence index 1 supports the same Centre direction.";

    const result = resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result.status).toBe("available");
  });

  it("accepts the verified Discovery Period in exact and equivalent UTC ISO presentations", () => {
    const input = requiredInput();
    const findings = generatedFindings();
    findings[0]!.what = [
      "The verified Discovery Period runs from",
      "2026-04-30T16:00:00Z through 2026-05-31T16:00:00.000Z.",
    ].join(" ");

    const result = resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input,
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result.status).toBe("available");
  });

  it("rejects a nearby UTC instant that is not the verified Discovery Period", () => {
    const findings = generatedFindings();
    findings[0]!.what = "The Discovery Period began at 2026-04-30T17:00:00Z.";

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    })).toEqual({
      status: "unavailable",
      reason: "The AI Analyst returned a numeric claim without Finding-specific Evidence.",
    });
  });

  it("accepts only the pinned Period, Snapshot, and Release digits as structural context", () => {
    const input = requiredInput();
    input.snapshotId = "energy-snapshot-52ca";
    input.projectReleaseId = "preschool-demo-template-v2";
    input.discoveryEvidence.identity.snapshotId = input.snapshotId;
    input.discoveryEvidence.identity.projectReleaseId = input.projectReleaseId;
    const findings = generatedFindings();
    findings[0] = {
      ...findings[0]!,
      title: "May 2026 analysis context",
      what: "The verified period is 2026-05-01 through 2026-05-31.",
      why: "The result is pinned to Snapshot energy-snapshot-52ca.",
      how: "Review the 31 days as one analysis period.",
      howToVerify: "Re-run against Snapshot energy-snapshot-52ca.",
      evidenceNote: "Structural context only; Release preschool-demo-template-v2.",
    };

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input,
      providerProfileId: "profile-1",
      runId: "run-1",
    }).status).toBe("available");
  });

  it.each([
    ["a business value equal to the period day count", "The energy target is 31 kWh during May 2026."],
    ["a different Snapshot", "The result is pinned to Snapshot energy-snapshot-52cb."],
    ["a different Release", "The result is pinned to Release preschool-demo-template-v3."],
  ])("rejects %s despite the authorized structural context", (_name, what) => {
    const input = requiredInput();
    input.snapshotId = "energy-snapshot-52ca";
    input.projectReleaseId = "preschool-demo-template-v2";
    input.discoveryEvidence.identity.snapshotId = input.snapshotId;
    input.discoveryEvidence.identity.projectReleaseId = input.projectReleaseId;
    const findings = generatedFindings();
    findings[0]!.what = what;

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input,
      providerProfileId: "profile-1",
      runId: "run-1",
    })).toEqual({
      status: "unavailable",
      reason: "The AI Analyst returned a numeric claim without Finding-specific Evidence.",
    });
  });

  it("rejects an SQL Evidence index that the same Finding did not cite", () => {
    const findings = generatedFindings();
    findings[0]!.what = "SQL Evidence index 1 supports the same Centre direction.";
    findings[0]!.evidenceSqlIndexes = [2, 3];
    findings[1]!.evidenceSqlIndexes = [1, 2];

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings, [
        ...sqlEvents("sql-1", 843.0985),
        ...multiRowSqlEvents("sql-2"),
        ...sqlEvents("sql-3", 42),
      ]),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    })).toEqual({
      status: "unavailable",
      reason: "The AI Analyst returned a numeric claim without Finding-specific Evidence.",
    });
  });

  it.each([
    ["an arbitrary date", "The pattern was visible on 2026-05-30."],
    ["a UUID", "The artifact was 550e8400-e29b-41d4-a716-446655440000."],
  ])("rejects %s even when the Finding cites valid SQL", (_name, what) => {
    const findings = generatedFindings();
    findings[0]!.what = what;

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    })).toEqual({
      status: "unavailable",
      reason: "The AI Analyst returned a numeric claim without Finding-specific Evidence.",
    });
  });

  it("does not let a version string in cited values authorize an unrelated percentage", () => {
    const findings = generatedFindings();
    findings[0]!.what = "Estimated savings are 1%.";
    findings[0]!.evidenceRefs = ["operating:portfolio"];

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    })).toEqual({
      status: "unavailable",
      reason: "The AI Analyst returned a numeric claim without Finding-specific Evidence.",
    });
  });

  it("does not remove an authorized date embedded inside an artifact id", () => {
    const findings = generatedFindings();
    findings[0]!.what = "Artifact artifact_2026-05-01 was selected.";

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    })).toEqual({
      status: "unavailable",
      reason: "The AI Analyst returned a numeric claim without Finding-specific Evidence.",
    });
  });

  it("does not remove a cited Evidence index phrase that is only a prefix of a longer numeric token", () => {
    const findings = generatedFindings();
    findings[0]!.what = "SQL Evidence index 1843.0985 was selected.";

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    })).toEqual({
      status: "unavailable",
      reason: "The AI Analyst returned a numeric claim without Finding-specific Evidence.",
    });
  });

  it("fails closed when the bundled Period drifts from the authorized Run window", () => {
    const input = requiredInput();
    input.discoveryEvidence.identity.period.from = "2026-04-29T16:00:00.000Z";

    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(),
      input,
      providerProfileId: "profile-1",
      runId: "run-1",
    })).toEqual({
      status: "unavailable",
      reason: "The Preschool Discovery Evidence does not match this Run identity.",
    });
  });

  it("accepts two to four successful bounded operations, including multi-row drill-down Evidence", () => {
    const findings = generatedFindings();
    findings[0]!.evidenceSqlIndexes = [1, 2, 3, 4];
    const sqlEvidence = [
      ...sqlEvents("sql-1", 843.0985),
      ...multiRowSqlEvents("sql-2"),
      ...sqlEvents("sql-3", 42),
      ...sqlEvents("sql-4", 24),
    ];
    const result = resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(findings, sqlEvidence),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });
    expect(result.status).toBe("available");
    if (result.status === "available") expect(result.findings[0]!.evidence.tools).toHaveLength(4);
  });

  it("counts rejected SQL calls toward the four-attempt investigation budget", () => {
    const rejected = [
      { type: "TOOL_CALL_START", toolCallId: "sql-bad", toolCallName: "run_sql_readonly", args: { sql: "WITH bad AS (...)" } },
      { type: "TOOL_CALL_RESULT", toolCallId: "sql-bad", toolCallName: "run_sql_readonly", result: { error: "QUERY_VALIDATION_FAILED" } },
      { type: "TOOL_CALL_START", toolCallId: "sql-third", toolCallName: "run_sql_readonly", args: { sql: "SELECT 3" } },
      { type: "TOOL_CALL_RESULT", toolCallId: "sql-third", toolCallName: "run_sql_readonly", result: { error: "QUERY_VALIDATION_FAILED" } },
      { type: "TOOL_CALL_START", toolCallId: "sql-fourth", toolCallName: "run_sql_readonly", args: { sql: "SELECT 4" } },
      { type: "TOOL_CALL_RESULT", toolCallId: "sql-fourth", toolCallName: "run_sql_readonly", result: { error: "QUERY_VALIDATION_FAILED" } },
    ];
    expect(resolvePreschoolAiEventStream({
      eventStream: successfulEventStream(generatedFindings(), undefined, rejected),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    })).toEqual({
      status: "unavailable",
      reason: "The AI Analyst exceeded the four-attempt SQL limit.",
    });
  });

  it("single-flights identical page identities and fails soft", async () => {
    const input = requiredInput();
    vi.spyOn(configApi, "getRunDefaults").mockResolvedValue({ activeLlmProfileId: "profile-1" } as never);
    const fetchMock = vi.fn().mockResolvedValue(new Response(successfulEventStream(), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const progress: PreschoolAiProgress[] = [];
    const first = getOrStartPreschoolAiRun(input, (stage) => progress.push(stage));
    const second = getOrStartPreschoolAiRun(input);
    expect(first).toBe(second);
    await expect(first).resolves.toMatchObject({ status: "available" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(progress).toEqual(["inspecting", "querying", "validating", "drafting"]);

    resetPreschoolAiRunsForTests();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
    await expect(executePreschoolAiRun(input)).resolves.toEqual({
      status: "unavailable",
      reason: "AI Analyst request failed (503).",
    });
  });
});

function requiredInput(): PreschoolAiRunInput {
  const snapshot = preschoolGoldenSnapshot();
  const input = buildPreschoolAiRunInput(snapshot, buildPreschoolOverviewViewModel(snapshot).decisionSummary);
  if (!input) throw new Error("Expected the Preschool Golden Snapshot to support an AI Run");
  return input;
}

function successfulEventStream(
  findings = generatedFindings(),
  sqlEvidenceEvents: Array<Record<string, unknown>> = [
    ...sqlEvents("sql-1", 843.0985),
    ...multiRowSqlEvents("sql-2"),
  ],
  beforeSqlEvents: Array<Record<string, unknown>> = [],
): string {
  const events = [
    { type: "TOOL_CALL_START", toolCallId: "schema-1", toolCallName: "inspect_schema" },
    { type: "TOOL_CALL_RESULT", toolCallId: "schema-1", toolCallName: "inspect_schema", result: { tables: [{ name: "energy_intervals", columns: [{ name: "usage_kwh", type: "DOUBLE" }] }] } },
    ...beforeSqlEvents,
    ...sqlEvidenceEvents,
    { type: "TEXT_MESSAGE_CONTENT", delta: JSON.stringify({ findings }) },
    { type: "RUN_FINISHED" },
  ];
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

function multiRowSqlEvents(toolCallId: string): Array<Record<string, unknown>> {
  const sql = "SELECT hour_of_day, SUM(usage_kwh) AS usage_kwh FROM energy_intervals WHERE quality_status='ok' AND official_aggregation_eligible=TRUE GROUP BY hour_of_day ORDER BY usage_kwh DESC LIMIT 3";
  return [
    { type: "TOOL_CALL_START", toolCallId, toolCallName: "run_sql_readonly", args: { sql } },
    { type: "TOOL_CALL_RESULT", toolCallId, toolCallName: "run_sql_readonly", result: { sql, columns: ["hour_of_day", "usage_kwh"], rows: [[9, 62.4], [10, 59.1], [8, 57.8]], row_count: 3, audit_log_id: `audit-${toolCallId}`, elapsed_ms: 14 } },
  ];
}

function oversizedSqlEvents(toolCallId: string, rowCount: number, returnedRows: number): Array<Record<string, unknown>> {
  const sql = "SELECT hour_of_day, usage_kwh FROM energy_intervals ORDER BY usage_kwh DESC LIMIT 11";
  const rows = Array.from({ length: returnedRows }, (_, index) => [index, 100 - index]);
  return [
    { type: "TOOL_CALL_START", toolCallId, toolCallName: "run_sql_readonly", args: { sql } },
    { type: "TOOL_CALL_RESULT", toolCallId, toolCallName: "run_sql_readonly", result: { sql, columns: ["hour_of_day", "usage_kwh"], rows, row_count: rowCount, audit_log_id: `audit-${toolCallId}`, elapsed_ms: 14 } },
  ];
}

function sqlEvents(toolCallId: string, value: number): Array<Record<string, unknown>> {
  const sql = "SELECT parent_node_id, SUM(usage_kwh) FROM energy_intervals WHERE quality_status='ok' AND official_aggregation_eligible=TRUE GROUP BY parent_node_id";
  return [
    { type: "TOOL_CALL_START", toolCallId, toolCallName: "run_sql_readonly", args: { sql } },
    { type: "TOOL_CALL_RESULT", toolCallId, toolCallName: "run_sql_readonly", result: { sql, columns: ["parent_node_id", "usage_kwh"], rows: [["preschool-centre-7", value]], row_count: 1, audit_log_id: `audit-${toolCallId}`, elapsed_ms: 12 } },
  ];
}

function generatedFindings() {
  return [
    {
      relationship: "supports",
      title: "Centre G remains a priority investigation",
      what: "The peer comparison and SQL cross-check point to the same Centre.",
      whyKind: "Evidence",
      why: "The published EUI and per-pax quadrant makes the pattern decision-relevant.",
      how: "Inspect the Centre schedule and the highest contributing Circuit.",
      howToVerify: "Repeat the same scoped comparison after the operating review.",
      evidenceNote: "This supports prioritisation, not a confirmed root cause.",
      expectedIfAct: "The next review should isolate the operating condition behind the pattern.",
      ifIgnored: "The unresolved pattern may continue without an accountable investigation.",
      evidenceRefs: ["benchmark:priority-centre:G"],
      evidenceSqlIndexes: [1, 2],
    },
    {
      relationship: "independent",
      title: "Standby should be separated from operating Spikes",
      what: "The Calendar split exposes a separate after-hours investigation path.",
      whyKind: "Hypothesis",
      why: "Closed-hour energy can reflect schedule or equipment-state differences.",
      how: "Compare the leading standby Circuit with the published operating schedule.",
      howToVerify: "Check whether the same pattern recurs under the same Calendar classification.",
      evidenceNote: "The Evidence identifies a pattern but cannot prove waste.",
      expectedIfAct: "The review should distinguish scheduled use from avoidable standby.",
      ifIgnored: "Standby and operating use will remain mixed in the same decision path.",
      evidenceRefs: ["operating:portfolio", "circuit:standby:L"],
      evidenceSqlIndexes: [1, 2],
    },
  ];
}
