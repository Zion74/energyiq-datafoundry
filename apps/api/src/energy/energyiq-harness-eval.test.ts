import { describe, expect, it } from "vitest";

import { ENERGYIQ_HARNESS_FAST_CASES } from "./energyiq-harness-eval-cases.js";
import { evaluateEnergyIqHarnessObservation } from "./energyiq-harness-eval.js";

describe("EnergyIQ Harness Eval", () => {
  it("keeps the fast suite small, product-specific, and uniquely named", () => {
    expect(ENERGYIQ_HARNESS_FAST_CASES).toHaveLength(10);
    expect(new Set(ENERGYIQ_HARNESS_FAST_CASES.map((evalCase) => evalCase.id)).size).toBe(10);
  });

  it("accepts an exact, evidenced Ngee Ann answer", () => {
    const evalCase = ENERGYIQ_HARNESS_FAST_CASES[0];
    expect(evalCase?.id).toBe("ngee-total-energy");
    const report = evaluateEnergyIqHarnessObservation(evalCase!, {
      elapsedMs: 25_000,
      events: successfulEvents(
        "The whole project used 1,531.1683 kWh from 2026-06-10 to 2026-06-16. The result is calculated from the scoped interval evidence.",
      ),
    });

    expect(report.status).toBe("passed");
    expect(report.hardFailure).toBe(false);
    expect(report.metrics.sqlCalls).toBe(1);
    expect(report.metrics.correctnessRatio).toBe(1);
  });

  it("records extra investigation as efficiency telemetry without failing a correct answer", () => {
    const evalCase = ENERGYIQ_HARNESS_FAST_CASES[0]!;
    const answer = "The whole project used 1,531.1683 kWh from 2026-06-10 to 2026-06-16. The result is calculated from the scoped interval evidence.";
    const baseEvents = successfulEvents(answer);
    const extraInvestigationEvents = Array.from({ length: 6 }, (_, index) => [
      { type: "REASONING_START" },
      { type: "TOOL_CALL_START", toolCallName: "run_sql_readonly", toolCallId: `follow-up-${index}` },
      { type: "TOOL_CALL_RESULT", toolCallName: "run_sql_readonly", toolCallId: `follow-up-${index}`, content: JSON.stringify({ success: true }) },
    ]).flat();
    const terminalIndex = baseEvents.findIndex((event) => event.type === "TEXT_MESSAGE_CONTENT");
    const report = evaluateEnergyIqHarnessObservation(evalCase, {
      elapsedMs: 180_000,
      events: [
        ...baseEvents.slice(0, terminalIndex),
        ...extraInvestigationEvents,
        ...baseEvents.slice(terminalIndex),
      ],
    });

    expect(report.status).toBe("passed");
    expect(report.metrics.sqlCalls).toBe(7);
    expect(report.metrics.reasoningRounds).toBe(7);
    expect(report.metrics.elapsedMs).toBe(180_000);
    expect(report.assertions.some((assertion) => assertion.id.startsWith("efficiency."))).toBe(false);
  });

  it("records a recovered tool failure without turning a correct completed run into a hard failure", () => {
    const evalCase = ENERGYIQ_HARNESS_FAST_CASES[0]!;
    const answer = "The whole project used 1,531.1683 kWh from 2026-06-10 to 2026-06-16. The result is calculated from the scoped interval evidence.";
    const events = successfulEvents(answer);
    const successfulCommitIndex = events.findIndex((event) => (
      event.type === "TOOL_CALL_START" && event.toolCallName === "analysis_requirements_commit"
    ));
    events.splice(successfulCommitIndex, 0,
      { type: "TOOL_CALL_START", toolCallName: "analysis_requirements_commit", toolCallId: "commit-rejected" },
      {
        type: "TOOL_CALL_RESULT",
        toolCallName: "analysis_requirements_commit",
        toolCallId: "commit-rejected",
        content: JSON.stringify({ ok: false, isError: true, error: { code: "ANALYSIS_CONTEXT_EVIDENCE_REQUIRED" } }),
      });

    const report = evaluateEnergyIqHarnessObservation(evalCase, { elapsedMs: 50_000, events });

    expect(report.status).toBe("passed");
    expect(report.hardFailure).toBe(false);
    expect(report.metrics.failedToolCalls).toBe(1);
    expect(report.metrics.recoveredToolFailures).toBe(1);
  });

  it("requires a released-only EUI answer to bind Context Evidence without SQL", () => {
    const evalCase = ENERGYIQ_HARNESS_FAST_CASES.find((entry) => entry.id === "preschool-released-eui")!;
    const answer = "Centre A's released EUI is 13.62 kWh/m²/year, provisional. Its Senior Care Center cohort P50 is 6.75 and P75 is 9.20 kWh/m²/year.";
    const report = evaluateEnergyIqHarnessObservation(evalCase, {
      elapsedMs: 45_000,
      events: contextEvidenceEvents(answer, ["analysis.context.evidence.bind", "analysis.requirements.commit"]),
    });

    expect(report.status).toBe("passed");
    expect(report.metrics.sqlCalls).toBe(0);
    expect(report.snapshotIds).toEqual(["energy-snapshot-52ca9611e48b0d71c2efe7b7"]);
    expect(report.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "protocol.analysis.context.evidence.bind", passed: true }),
      expect.objectContaining({ id: "protocol.forbidden.analysis.evidence.bind", passed: true }),
      expect.objectContaining({ id: "context.single-snapshot", passed: true, hard: true }),
    ]));
  });

  it("requires an autonomous investigation to combine Context and Query Evidence on one Snapshot", () => {
    const evalCase = ENERGYIQ_HARNESS_FAST_CASES.find((entry) => entry.id === "preschool-released-plus-query-investigation")!;
    const answer = "Investigate Centre G first: it is the priority pattern in the released evidence for the current snapshot, but the facts are provisional. This matters because area or occupant denominator uncertainty can distort the apparent load. Check area, occupancy, and operating hours; then verify them and compare the next week's trend before acting.";
    const events = contextEvidenceEvents(answer, [
      "analysis.evidence.bind",
      "analysis.context.evidence.bind",
      "analysis.requirements.commit",
    ], true);
    const report = evaluateEnergyIqHarnessObservation(evalCase, { elapsedMs: 95_000, events });

    expect(report.status).toBe("passed");
    expect(report.metrics.sqlCalls).toBe(1);
    expect(report.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "protocol.analysis.evidence.bind", passed: true }),
      expect.objectContaining({ id: "protocol.analysis.context.evidence.bind", passed: true }),
      expect.objectContaining({ id: "context.single-snapshot", passed: true, hard: true }),
    ]));
  });

  it("fails closed when the released Context crosses Workspace or Snapshot boundaries", () => {
    const evalCase = ENERGYIQ_HARNESS_FAST_CASES.find((entry) => entry.id === "preschool-released-eui")!;
    const events = contextEvidenceEvents(
      "Centre A's released EUI is 13.62 kWh/m²/year, provisional. Its Senior Care Center cohort P50 is 6.75 kWh/m²/year.",
      ["analysis.context.evidence.bind", "analysis.requirements.commit"],
    );
    events.splice(-2, 0,
      { type: "CUSTOM", name: "run.config.resolved", value: { workspace_id: "another-workspace" } },
      { type: "CUSTOM", name: "context.compiled", value: { item_id: "project-analysis-snapshot:preschool-demo:energy-snapshot-second" } },
    );

    const report = evaluateEnergyIqHarnessObservation(evalCase, { elapsedMs: 45_000, events });

    expect(report.status).toBe("failed");
    expect(report.hardFailure).toBe(true);
    expect(report.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "context.single-snapshot", passed: false, hard: true }),
      expect.objectContaining({ id: "context.workspace", passed: false, hard: true }),
    ]));
  });

  it("treats internal errors and forbidden execution tools as hard failures", () => {
    const evalCase = ENERGYIQ_HARNESS_FAST_CASES[0]!;
    const report = evaluateEnergyIqHarnessObservation(evalCase, {
      elapsedMs: 25_000,
      events: successfulEvents("SECRET_MASTER_KEY_REQUIRED", ["execute_command"]),
    });

    expect(report.status).toBe("failed");
    expect(report.hardFailure).toBe(true);
    expect(report.metrics.correctnessRatio).toBe(0);
    expect(report.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "tool.forbidden.execute_command", passed: false, hard: true }),
      expect.objectContaining({ id: "answer.no-internal.SECRET_MASTER_KEY_REQUIRED", passed: false, hard: true }),
    ]));
  });

  it("checks chart type and exact point count at the backend artifact boundary", () => {
    const evalCase = ENERGYIQ_HARNESS_FAST_CASES.find((entry) => entry.id === "ngee-hourly-chart")!;
    const points = Array.from({ length: 168 }, (_, index) => ({ label: String(index), value: index }));
    const events = successfulEvents("The period is 2026-06-03 to 2026-06-09. The peak is 9.1 kWh. Open Outputs for the chart preview.")
      .map((event) => event.type === "TOOL_CALL_RESULT"
        && (event as { toolCallName?: string }).toolCallName === "run_sql_readonly"
        ? {
            ...event,
            content: JSON.stringify({
              result: {
                columns: ["local_hour_start", "energy_kwh"],
                rows: points.map((point) => [point.label, point.value]),
              },
            }),
          }
        : event);
    const report = evaluateEnergyIqHarnessObservation(evalCase, {
      elapsedMs: 40_000,
      events: [
        ...events,
        { type: "CUSTOM", name: "artifact", value: { type: "chart", preview_json: { chartType: "line", points } } },
      ],
    });

    expect(report.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "chart.present", passed: true }),
      expect.objectContaining({ id: "chart.type", passed: true }),
      expect.objectContaining({ id: "chart.point-count", passed: true }),
      expect.objectContaining({ id: "chart.matches-sql", passed: true }),
    ]));
    expect(report.status).toBe("passed");
  });

  it("scores actionable insight across What, Evidence, Why, Action, and Verify", () => {
    const evalCase = ENERGYIQ_HARNESS_FAST_CASES.find((entry) => entry.id === "ngee-actionable-insight")!;
    const answer = [
      "The priority issue is Load 4: measured use was 439 kWh, the highest circuit in the 2026-06-10 to 2026-06-16 period.",
      "This matters because its share creates a material waste and demand risk, but the data does not prove a cause.",
      "Investigate the circuit schedule and inspect connected equipment with the operations team.",
      "Verify the hypothesis by monitoring the next week and comparing meter readings against the baseline after the check.",
    ].join(" ");
    const report = evaluateEnergyIqHarnessObservation(evalCase, {
      elapsedMs: 45_000,
      events: successfulEvents(answer),
    });

    expect(report.metrics.insightQuality).toBe(10);
    expect(report.status).toBe("passed");
  });
});

const successfulEvents = (answer: string, extraTools: string[] = []): Array<Record<string, unknown>> => {
  const tools = ["inspect_schema", "run_sql_readonly", "analysis_requirements_commit", ...extraTools];
  return [
    { type: "RUN_STARTED" },
    { type: "REASONING_START" },
    ...tools.flatMap((toolCallName, index) => [
      { type: "TOOL_CALL_START", toolCallName, toolCallId: `call-${index}` },
      { type: "TOOL_CALL_RESULT", toolCallName, toolCallId: `call-${index}`, content: JSON.stringify({ success: true }) },
    ]),
    { type: "TEXT_MESSAGE_CONTENT", messageId: "answer", delta: answer },
    { type: "CUSTOM", name: "token_usage", value: { input_tokens: 100, output_tokens: 40 } },
    { type: "RUN_FINISHED" },
  ];
};

const contextEvidenceEvents = (
  answer: string,
  protocolActions: string[],
  includeSql = false,
): Array<Record<string, unknown>> => {
  const snapshotId = "energy-snapshot-52ca9611e48b0d71c2efe7b7";
  const tools = ["inspect_schema", ...(includeSql ? ["run_sql_readonly"] : []), "analysis_requirements_commit"];
  return [
    { type: "RUN_STARTED" },
    { type: "REASONING_START" },
    {
      type: "CUSTOM",
      name: "run.config.resolved",
      value: { workspace_id: "preschool-demo-org" },
    },
    {
      type: "CUSTOM",
      name: "context.compiled",
      value: {
        selected_group_ids: ["energy-query-context", "project-analysis-snapshot"],
        selected_sources: [{
          group_id: "project-analysis-snapshot",
          item_ids: [`project-analysis-snapshot:preschool-demo:${snapshotId}`],
        }],
        decisions: [{ affectedItemIds: [`project-analysis-snapshot:preschool-demo:${snapshotId}`] }],
      },
    },
    ...tools.flatMap((toolCallName, index) => [
      { type: "TOOL_CALL_START", toolCallName, toolCallId: `context-call-${index}` },
      { type: "TOOL_CALL_RESULT", toolCallName, toolCallId: `context-call-${index}`, content: JSON.stringify({ success: true }) },
    ]),
    ...protocolActions.map((actionName, index) => ({
      type: "CUSTOM",
      name: "protocol.action.succeeded",
      value: { payload: { actionId: `protocol-${index}`, actionName } },
    })),
    { type: "TEXT_MESSAGE_CHUNK", messageId: "answer", delta: answer },
    { type: "RUN_FINISHED" },
  ];
};
