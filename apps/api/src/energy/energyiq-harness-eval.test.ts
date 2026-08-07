import { describe, expect, it } from "vitest";

import { ENERGYIQ_HARNESS_FAST_CASES } from "./energyiq-harness-eval-cases.js";
import { evaluateEnergyIqHarnessObservation } from "./energyiq-harness-eval.js";

describe("EnergyIQ Harness Eval", () => {
  it("keeps the fast suite small, product-specific, and uniquely named", () => {
    expect(ENERGYIQ_HARNESS_FAST_CASES).toHaveLength(8);
    expect(new Set(ENERGYIQ_HARNESS_FAST_CASES.map((evalCase) => evalCase.id)).size).toBe(8);
  });

  it("accepts an exact, bounded Ngee Ann answer", () => {
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

const successfulEvents = (answer: string, extraTools: string[] = []) => {
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
