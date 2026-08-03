import { describe, expect, it } from "vitest";

import {
  compileTrustedEnergyTextQuery,
  createTrustedEnergyAnswerEnvelope,
  TRUSTED_ENERGY_TEXT_INTENT_METRICS,
  TRUSTED_ENERGY_TEXT_INTENTS,
  validateTrustedEnergyTextResult
} from "./trusted-energy-text.js";

const trustedRequest = (intent: typeof TRUSTED_ENERGY_TEXT_INTENTS[number] = "period-usage-vs-previous") => ({
  kind: "trusted-energy-text" as const,
  intent,
  context: {
    project: { id: "ngee-ann-polytechnic", name: "Ngee Ann Polytechnic" },
    scope: { id: "project", name: "Ngee Ann Polytechnic", type: "project" },
    period: {
      label: "Custom",
      start: "2026-06-09T16:00:00.000Z",
      endExclusive: "2026-06-16T16:00:00.000Z",
      timezone: "Asia/Singapore"
    },
    metric: metricForIntent(intent),
    dataSnapshotId: "ngee-ann-golden-2026-06-16",
    dataAsOf: "2026-06-16T16:00:00.000Z",
    evidenceRefs: [{
      id: "evidence:ngee-ann-golden:usage",
      metricId: metricForIntent(intent).id,
      dataSnapshotId: "ngee-ann-golden-2026-06-16"
    }]
  }
});

describe("trusted Energy text query contract", () => {
  it("compiles all ten approved Boss questions into allowlisted Snapshot selectors with immutable pins", () => {
    expect(TRUSTED_ENERGY_TEXT_INTENTS).toHaveLength(10);

    const contracts = TRUSTED_ENERGY_TEXT_INTENTS.map((intent) =>
      compileTrustedEnergyTextQuery(trustedRequest(intent))
    );

    expect(contracts.map((contract) => contract.intent)).toEqual(TRUSTED_ENERGY_TEXT_INTENTS);
    expect(contracts.every((contract) => contract.source === "project-analysis-snapshot")).toBe(true);
    expect(contracts.every((contract) => contract.pins.period.endExclusive === "2026-06-16T16:00:00.000Z"))
      .toBe(true);
    expect(contracts.every((contract) => contract.pins.period.timezone === "Asia/Singapore")).toBe(true);
    expect(contracts.every((contract) =>
      TRUSTED_ENERGY_TEXT_INTENT_METRICS[contract.intent]
        .some((metricId) => metricId === contract.pins.metric.id))).toBe(true);
    expect(new Set(contracts.map((contract) => contract.selector)).size).toBe(10);
  });

  it("rejects a Metric that is not allowlisted for the selected intent", () => {
    const request = trustedRequest("peak-and-contributors");
    expect(() => compileTrustedEnergyTextQuery({
      ...request,
      context: {
        ...request.context,
        metric: metricForIntent("period-usage-vs-previous"),
        evidenceRefs: [{
          id: "evidence:ngee-ann-golden:usage",
          metricId: "energy.total_usage_kwh",
          dataSnapshotId: request.context.dataSnapshotId
        }]
      }
    })).toThrow("TRUSTED_ENERGY_TEXT_REQUEST_INVALID:INTENT_METRIC_MISMATCH:peak-and-contributors");
  });

  it.each([
    ["missing Evidence", (request: ReturnType<typeof trustedRequest>) => ({
      ...request,
      context: { ...request.context, evidenceRefs: [] }
    })],
    ["reversed Period", (request: ReturnType<typeof trustedRequest>) => ({
      ...request,
      context: {
        ...request.context,
        period: {
          ...request.context.period,
          start: request.context.period.endExclusive,
          endExclusive: request.context.period.start
        }
      }
    })],
    ["unknown intent", (request: ReturnType<typeof trustedRequest>) => ({
      ...request,
      intent: "free-form-sql"
    })],
    ["secret-bearing input", (request: ReturnType<typeof trustedRequest>) => ({
      ...request,
      context: { ...request.context, apiKey: "sk-must-never-cross-the-adapter" }
    })]
  ])("fails closed for %s", (_label, mutate) => {
    expect(() => compileTrustedEnergyTextQuery(mutate(trustedRequest()) as unknown)).toThrow(
      /TRUSTED_ENERGY_TEXT_REQUEST_INVALID/u
    );
  });

  it("rejects result evidence that drifts from the pinned Metric or Data Snapshot", () => {
    const contract = compileTrustedEnergyTextQuery(trustedRequest());

    expect(() => validateTrustedEnergyTextResult(contract, {
      body: "The selected period used 1,531.1683 kWh.",
      metricId: "electricity.cost",
      metricRevisionId: contract.pins.metric.revisionId,
      dataSnapshotId: contract.pins.dataSnapshotId,
      evidenceRefIds: [contract.pins.evidenceRefs[0]!.id]
    })).toThrow("TRUSTED_ENERGY_TEXT_METRIC_MISMATCH");

    expect(() => validateTrustedEnergyTextResult(contract, {
      body: "The selected period used 1,531.1683 kWh.",
      metricId: contract.pins.metric.id,
      metricRevisionId: contract.pins.metric.revisionId,
      dataSnapshotId: "another-snapshot",
      evidenceRefIds: [contract.pins.evidenceRefs[0]!.id]
    })).toThrow("TRUSTED_ENERGY_TEXT_SNAPSHOT_MISMATCH");
  });

  it("renders the mandatory Scope, Period, Metric, Data as of and Evidence labels", () => {
    const contract = compileTrustedEnergyTextQuery(trustedRequest());
    const result = validateTrustedEnergyTextResult(contract, {
      body: "The selected period used 1,531.1683 kWh, 26.3677% above the previous period.",
      metricId: contract.pins.metric.id,
      metricRevisionId: contract.pins.metric.revisionId,
      dataSnapshotId: contract.pins.dataSnapshotId,
      evidenceRefIds: [contract.pins.evidenceRefs[0]!.id]
    });

    expect(createTrustedEnergyAnswerEnvelope(contract, result)).toBe([
      "The selected period used 1,531.1683 kWh, 26.3677% above the previous period.",
      "",
      "Scope: Ngee Ann Polytechnic",
      "Period: 2026-06-10 00:00 to 2026-06-17 00:00 (exclusive) · Asia/Singapore",
      "Metric: Electricity consumption (kWh) · energy.total_usage_kwh@1",
      "Data as of: 2026-06-17 00:00 · Asia/Singapore",
      "Evidence: evidence:ngee-ann-golden:usage"
    ].join("\n"));
  });

  it("does not render an answer that skipped result validation", () => {
    const contract = compileTrustedEnergyTextQuery(trustedRequest());
    expect(() => createTrustedEnergyAnswerEnvelope(contract, {
      body: "Unvalidated answer",
      metricId: contract.pins.metric.id,
      metricRevisionId: contract.pins.metric.revisionId,
      dataSnapshotId: contract.pins.dataSnapshotId,
      evidenceRefIds: [contract.pins.evidenceRefs[0]!.id]
    } as never)).toThrow("TRUSTED_ENERGY_TEXT_RESULT_NOT_VALIDATED");
  });
});

const metricForIntent = (intent: typeof TRUSTED_ENERGY_TEXT_INTENTS[number]) => {
  const metricId = TRUSTED_ENERGY_TEXT_INTENT_METRICS[intent][0]!;
  if (metricId === "energy.peak_demand_kw") {
    return {
      id: metricId,
      label: "Peak interval-average power",
      unit: "kW",
      revisionId: `${metricId}@1`
    };
  }
  if (metricId === "energy.usage_per_sqm") {
    return { id: metricId, label: "Energy use intensity", unit: "kWh/m²", revisionId: `${metricId}@1` };
  }
  if (metricId === "energy.off_hours_usage_kwh") {
    return { id: metricId, label: "Non-operating usage", unit: "kWh", revisionId: `${metricId}@1` };
  }
  return { id: metricId, label: "Electricity consumption", unit: "kWh", revisionId: `${metricId}@1` };
};
