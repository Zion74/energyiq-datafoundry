import { afterEach, describe, expect, it, vi } from "vitest";

import { configApi } from "../../../lib/config-api";
import {
  buildAgentRunBody,
  buildNgeeAnnAiRunInput,
  executeNgeeAnnAiRun,
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
    delete process.env.NEXT_PUBLIC_DATAFOUNDRY_AUTH_MODE;
    delete process.env.NEXT_PUBLIC_CONFIG_API_URL;
  });

  it("projects bounded cross-dimensional Discovery Evidence from one pinned Snapshot", () => {
    const input = requiredInput();
    const bundle = input.discoveryEvidence;
    const ids = bundle.items.map((item) => item.id);

    expect(bundle.identity).toEqual({
      snapshotId: "snapshot-ngee-ann-golden",
      dataCutoff: "2026-06-16",
      projectReleaseId: "release-ngee-ann-golden",
      hierarchyRevisionId: "hierarchy-v6",
      meterMappingRevisionId: "mapping-v1",
      meterFormulaRevisionId: "formula-v1",
      metricVersion: "metric-v1",
      businessCalendarVersion: "calendar-v1",
      timezone: "Asia/Singapore",
      primaryPeriod: {
        from: "2026-06-09T16:00:00.000Z",
        to: "2026-06-16T16:00:00.000Z",
      },
    });
    expect(bundle.items.length).toBeGreaterThan(0);
    expect(bundle.items.length).toBeLessThanOrEqual(20);
    expect(JSON.stringify(bundle).length).toBeLessThanOrEqual(6_000);
    expect(ids).toEqual(expect.arrayContaining([
      "horizon:1d",
      "horizon:7d",
      "horizon:28d",
      "level:level-7",
      "category:load",
      "circuit:mapping-lvl-7-office-load-4-l1p22-l3p25-fan-isol1-2-16",
      "peak:project",
      "operating:project",
      "quality:primary-period",
      "limitation:external-operational-evidence",
    ]));
    expect(ids.filter((id) => id.startsWith("level:"))).toEqual(["level:level-7"]);
    expect(ids.filter((id) => id.startsWith("category:"))).toEqual(["category:load"]);
    expect(ids.filter((id) => id.startsWith("circuit:"))).toEqual([
      "circuit:mapping-lvl-7-office-load-4-l1p22-l3p25-fan-isol1-2-16",
    ]);
    expect(bundle.items.find((item) => item.id === "category:load")?.period).toBe("primary");
    expect(bundle.items.find((item) => item.id === "category:load")?.values).toMatchObject({
      changeKwh: 352.2069,
      comparisonKind: "previous-primary-period",
    });
  });

  it("omits unavailable discovery dimensions and records Missing Evidence without zero filling", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const validatedPriorities = buildNgeeAnnOverviewViewModel(snapshot).decisionPriorities;
    snapshot.analysis.categories = [];
    snapshot.analysis.circuits = [];
    snapshot.analysis.topCircuits = [];
    snapshot.analysis.timeBehaviour = undefined;
    snapshot.analysis.peakBreakdown = {
      status: "unavailable",
      reason: { code: "PEAK_INTERVAL_FACTS_UNAVAILABLE", message: "Peak facts unavailable." },
    };
    snapshot.analysis.offHours = {
      status: "unavailable",
      reason: { code: "BUSINESS_CALENDAR_VERSION_NOT_FOUND", message: "Calendar unavailable." },
    };
    const input = buildNgeeAnnAiRunInput(snapshot, validatedPriorities);

    expect(input).not.toBeNull();
    const items = input!.discoveryEvidence.items;
    expect(items.some((item) => ["category", "circuit", "time", "peak", "operating"].includes(item.kind))).toBe(false);
    expect(items.find((item) => item.id === "limitation:external-operational-evidence")?.values)
      .toMatchObject({ evidenceStatus: "Missing Evidence" });
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
    expect(JSON.stringify(body)).toContain("choose the single most decision-useful cross-check");
    expect(JSON.stringify(body)).toContain("Bounded Ngee Ann Discovery Evidence Bundle");
    expect(JSON.stringify(body)).toContain("category:load");
    expect(JSON.stringify(body)).toContain("evidenceRefs");
    expect(JSON.stringify(body)).toContain(
      "1d requires horizon:1d, 7d requires horizon:7d, and 28d requires horizon:28d",
    );
    expect(JSON.stringify(body)).not.toContain("execute exactly the following concise cross-horizon Level query");
    expect(JSON.stringify(body)).not.toContain("Leave every additional dimension or follow-up query to Ask AI deeper");
    expect(JSON.stringify(body)).toContain("Do not use WITH/CTEs or EXTRACT syntax");
    expect(JSON.stringify(body)).toContain("official_aggregation_eligible=TRUE");
    expect(JSON.stringify(body)).toContain("include every runtime assertion_id");
    expect(JSON.stringify(body)).toContain("retry only once");
    expect(JSON.stringify(body)).toContain(
      "never invent a numeric threshold, target, tolerance, percentage, duration, or time window",
    );
    expect(JSON.stringify(body)).toContain(
      "only numeric values directly present in that Finding's cited Discovery Evidence items or cited SQL result",
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

  it("requires Findings to acknowledge every available deterministic Horizon value", () => {
    const body = buildAgentRunBody(requiredInput(), "profile-1", "run-1", "thread-1");
    const prompt = ((body.body as { messages: Array<{ content: string }> }).messages[0]?.content) ?? "";
    const bundleText = prompt
      .split("Bounded Ngee Ann Discovery Evidence Bundle:\n\n")[1]
      ?.split("\n\nOfficial deterministic projection:")[0];

    expect(prompt).toContain("check every supplied kind=horizon item");
    expect(prompt).toContain(
      "must not describe an available Horizon value as missing, unavailable, or not provided",
    );
    expect(prompt).toContain("may challenge its meaning or add an independent angle");
    expect(bundleText).toBeTruthy();
    expect(JSON.parse(bundleText ?? "{}").items).toContainEqual(expect.objectContaining({
      id: "horizon:28d",
      values: expect.objectContaining({ actualKwh: 4904.8659, baselineKwh: 4831.5555 }),
    }));
  });

  it("accepts three distinct Findings with Finding-specific deterministic and optional SQL Evidence", () => {
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
        deterministic: expect.arrayContaining([
          expect.objectContaining({ id: "horizon:1d" }),
          expect.objectContaining({ id: "level:level-7" }),
        ]),
        tools: [{ toolCallId: "sql-1" }],
      },
    });
    expect(result.findings[1]!.evidence.deterministic.map((item) => item.id)).toEqual([
      "horizon:7d",
      "horizon:28d",
      "category:load",
    ]);
    expect(result.findings[1]!.evidence.tools).toEqual([]);
    expect(result.findings[2]!.evidence.tools).toEqual([]);
    expect(new Set(result.findings.flatMap((finding) => finding.horizons))).toEqual(new Set(["1d", "7d", "28d"]));
  });

  it("rejects a Finding that cites Discovery Evidence outside the current bundle", () => {
    const findings = generatedFindings();
    findings[1]!.evidenceRefs = ["horizon:7d", "horizon:28d", "category:not-present"];

    const result = resolveNgeeAnnAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result).toEqual({
      status: "unavailable",
      reason: "A Finding cited deterministic Evidence that is not present in this Snapshot.",
    });
  });

  it("rejects a declared 28d Horizon without the matching deterministic Evidence", () => {
    const findings = generatedFindings();
    findings[2]!.evidenceRefs = ["peak:project", "limitation:external-operational-evidence"];

    const result = resolveNgeeAnnAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result).toEqual({
      status: "unavailable",
      reason: "A Finding declared a Horizon without its matching deterministic Evidence.",
    });
  });

  it("accepts a declared 28d Horizon with the exact matching deterministic Evidence", () => {
    const findings = generatedFindings();

    const result = resolveNgeeAnnAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result.status).toBe("available");
  });

  it("rejects a numeric claim copied from an uncited Discovery Evidence item", () => {
    const findings = generatedFindings();
    findings[0]!.what = "Category change was 352.2069 kWh.";

    const result = resolveNgeeAnnAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result).toEqual({
      status: "unavailable",
      reason: "The AI Analyst returned a numeric claim without Finding-specific Evidence.",
    });
  });

  it("fails closed when the Discovery Evidence pins drift from the Run Snapshot", () => {
    const input = requiredInput();
    input.discoveryEvidence.identity.snapshotId = "another-snapshot";

    const result = resolveNgeeAnnAiEventStream({
      eventStream: successfulEventStream(),
      input,
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result).toEqual({
      status: "unavailable",
      reason: "The deterministic Discovery Evidence does not match this Run identity.",
    });
  });

  it("rejects Horizon-only filler when below-Level or time/operating Evidence is available", () => {
    const findings = generatedFindings().map((finding) => ({
      ...finding,
      evidenceRefs: ["horizon:1d", "horizon:7d", "horizon:28d"],
    }));

    const result = resolveNgeeAnnAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result).toEqual({
      status: "unavailable",
      reason: "The AI response did not use the available below-Level or time/operating Evidence.",
    });
  });

  it("accepts digits that are part of a cited Level or Circuit identity", () => {
    const findings = generatedFindings();
    findings[1]!.what = "Office Load 4 Fan ISOL 1/2 is the leading changed Circuit.";
    findings[1]!.evidenceRefs = [
      "horizon:7d",
      "horizon:28d",
      "circuit:mapping-lvl-7-office-load-4-l1p22-l3p25-fan-isol1-2-16",
    ];

    const result = resolveNgeeAnnAiEventStream({
      eventStream: successfulEventStream(findings),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result.status).toBe("available");
  });

  it("maps raw runtime error codes to a customer-safe unavailable reason", () => {
    const eventStream = [
      { type: "RUN_ERROR", message: "SECRET_MASTER_KEY_REQUIRED" },
      { type: "RUN_FINISHED" },
    ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");

    const result = resolveNgeeAnnAiEventStream({
      eventStream,
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result).toEqual({
      status: "unavailable",
      reason: "AI analysis is temporarily unavailable. The verified Overview remains available.",
    });
  });

  it("extracts the final Findings object after reasoning that contains JSON and braces", () => {
    const findings = generatedFindings();
    findings[0]!.how = "Inspect the literal marker \"{level}\" before action.";
    const result = resolveNgeeAnnAiEventStream({
      eventStream: successfulEventStream(
        findings,
        [],
        [],
        undefined,
        undefined,
        [
          "Planning assertions: {\"assertions\":[{\"id\":\"R1.A1\"}]}\n",
          `Final answer: ${JSON.stringify({ findings })}`,
        ],
      ),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(result.findings[0].how).toBe("Inspect the literal marker \"{level}\" before action.");
  });

  it("extracts a valid Findings object before trailing model text", () => {
    const findings = generatedFindings();
    const result = resolveNgeeAnnAiEventStream({
      eventStream: successfulEventStream(
        findings,
        [],
        [],
        undefined,
        undefined,
        [`${JSON.stringify({ findings })}\nAnalysis complete.`],
      ),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result.status).toBe("available");
  });

  it("fails closed when the model text contains no valid Findings object", () => {
    const result = resolveNgeeAnnAiEventStream({
      eventStream: successfulEventStream(
        generatedFindings(),
        [],
        [],
        undefined,
        undefined,
        ["Planning assertions only: {\"assertions\":[{\"id\":\"R1.A1\"}]}"],
      ),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result).toEqual({
      status: "unavailable",
      reason: "The AI response could not be verified against this Snapshot.",
    });
  });

  it("selects the last Findings object when the model emits multiple valid candidates", () => {
    const earlierFindings = generatedFindings();
    earlierFindings[0]!.title = "Earlier candidate";
    const finalFindings = generatedFindings();
    finalFindings[0]!.title = "Final candidate";
    const result = resolveNgeeAnnAiEventStream({
      eventStream: successfulEventStream(
        finalFindings,
        [],
        [],
        undefined,
        undefined,
        [
          JSON.stringify({ findings: earlierFindings }),
          `\n${JSON.stringify({ findings: finalFindings })}`,
        ],
      ),
      input: requiredInput(),
      providerProfileId: "profile-1",
      runId: "run-1",
    });

    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(result.findings[0].title).toBe("Final candidate");
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
      reason: "The AI Analyst returned a numeric claim without Finding-specific Evidence.",
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

  it("reports only complete tool-event stages from chunked SSE and keeps the full verified result", async () => {
    const input = requiredInput();
    const stages: string[] = [];
    vi.spyOn(configApi, "getRunDefaults").mockResolvedValue({ activeLlmProfileId: "profile-1" } as never);
    const eventStream = successfulEventStream();
    const splitPoints = [13, 71, 149, 311, Math.floor(eventStream.length / 2), eventStream.length - 9];
    const chunks = splitTextAt(eventStream, splitPoints);
    const fetchMock = vi.fn().mockResolvedValue(chunkedSseResponse(chunks));
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeNgeeAnnAiRun(input, (stage) => stages.push(stage));

    expect(stages).toEqual(["inspecting", "querying", "drafting"]);
    expect(result).toMatchObject({
      status: "available",
      providerProfileId: "profile-1",
      findings: [
        { relationship: "supports" },
        { relationship: "challenges" },
        { relationship: "independent" },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to buffered text when the response body cannot be streamed", async () => {
    const input = requiredInput();
    const stages: string[] = [];
    const text = vi.fn().mockResolvedValue(successfulEventStream());
    vi.spyOn(configApi, "getRunDefaults").mockResolvedValue({ activeLlmProfileId: "profile-1" } as never);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
      text,
    } as Response));

    const result = await executeNgeeAnnAiRun(input, (stage) => stages.push(stage));

    expect(text).toHaveBeenCalledTimes(1);
    expect(stages).toEqual(["inspecting", "querying", "drafting"]);
    expect(result).toMatchObject({ status: "available", findings: expect.any(Array) });
  });

  it("shares progress with repeated callers without starting another request", async () => {
    const input = requiredInput();
    const firstStages: string[] = [];
    const secondStages: string[] = [];
    vi.spyOn(configApi, "getRunDefaults").mockResolvedValue({ activeLlmProfileId: "profile-1" } as never);
    let releaseResponse!: () => void;
    const responseReady = new Promise<Response>((resolve) => {
      releaseResponse = () => resolve(chunkedSseResponse(splitTextAt(successfulEventStream(), [97, 263])));
    });
    const fetchMock = vi.fn(() => responseReady);
    vi.stubGlobal("fetch", fetchMock);

    const first = getOrStartNgeeAnnAiRun(input, (stage) => firstStages.push(stage));
    const second = getOrStartNgeeAnnAiRun(input, (stage) => secondStages.push(stage));
    releaseResponse();

    expect(first).toBe(second);
    await expect(first).resolves.toMatchObject({ status: "available" });
    expect(firstStages).toEqual(["inspecting", "querying", "drafting"]);
    expect(secondStages).toEqual(["inspecting", "querying", "drafting"]);
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

  it("sends the password-auth CSRF token when starting an AI Run", async () => {
    process.env.NEXT_PUBLIC_DATAFOUNDRY_AUTH_MODE = "password";
    process.env.NEXT_PUBLIC_CONFIG_API_URL = "";
    vi.stubGlobal("document", { cookie: "df_csrf=csrf-token" });
    vi.spyOn(configApi, "getRunDefaults").mockResolvedValue({ activeLlmProfileId: "profile-1" } as never);
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await executeNgeeAnnAiRun(requiredInput());

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/copilotkit",
      expect.objectContaining({
        credentials: "same-origin",
        headers: expect.objectContaining({
          "X-CSRF-Token": "csrf-token",
        }),
      }),
    );
  });

  it("allows the background AI Run enough time for provider tool round trips", async () => {
    vi.spyOn(configApi, "getRunDefaults").mockResolvedValue({ activeLlmProfileId: "profile-1" } as never);
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));

    await executeNgeeAnnAiRun(requiredInput());

    expect(timeoutSpy).toHaveBeenCalledWith(300_000);
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
  textDeltas: string[] | undefined = undefined,
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
    ...(textDeltas ?? [JSON.stringify({ findings })]).map((delta) => ({
      type: "TEXT_MESSAGE_CONTENT",
      delta,
    })),
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

function splitTextAt(text: string, points: number[]): string[] {
  const positions = [0, ...points.filter((point) => point > 0 && point < text.length), text.length]
    .sort((left, right) => left - right);
  return positions.slice(1).map((end, index) => text.slice(positions[index], end));
}

function chunkedSseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
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
      evidenceRefs: ["horizon:1d", "horizon:7d", "level:level-7"],
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
      evidenceRefs: ["horizon:7d", "horizon:28d", "category:load"],
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
      evidenceRefs: ["horizon:28d", "peak:project", "limitation:external-operational-evidence"],
    },
  ];
}
