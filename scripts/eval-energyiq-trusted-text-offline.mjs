import assert from "node:assert/strict";

import {
  compileTrustedEnergyTextQuery,
  createTrustedEnergyAnswerEnvelope,
  TRUSTED_ENERGY_TEXT_INTENT_METRICS,
  TRUSTED_ENERGY_TEXT_INTENTS,
  validateTrustedEnergyTextResult
} from "../packages/agent-runtime/dist/index.js";

const snapshotId = "ngee-ann-golden-2026-06-16";
const evidenceId = (intent) => `evidence:ngee-ann-golden:${intent}`;
const envelopes = [];

for (const intent of TRUSTED_ENERGY_TEXT_INTENTS) {
  const metricId = TRUSTED_ENERGY_TEXT_INTENT_METRICS[intent][0];
  assert.ok(metricId, `No allowlisted Metric for ${intent}`);
  const metric = metricDefinition(metricId);
  const contract = compileTrustedEnergyTextQuery({
    kind: "trusted-energy-text",
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
      metric,
      dataSnapshotId: snapshotId,
      dataAsOf: "2026-06-16T16:00:00.000Z",
      evidenceRefs: [{ id: evidenceId(intent), metricId, dataSnapshotId: snapshotId }]
    }
  });
  const result = validateTrustedEnergyTextResult(contract, {
    body: `Offline Golden contract validated for ${intent}.`,
    metricId,
    metricRevisionId: metric.revisionId,
    dataSnapshotId: snapshotId,
    evidenceRefIds: [evidenceId(intent)]
  });
  const envelope = createTrustedEnergyAnswerEnvelope(contract, result);
  for (const label of ["Scope:", "Period:", "Metric:", "Data as of:", "Evidence:"]) {
    assert.ok(envelope.includes(label), `${intent} is missing ${label}`);
  }
  envelopes.push(envelope);
}

assert.equal(envelopes.length, 10);
console.log(
  "EnergyIQ trusted text offline eval OK: consecutive=10/10, "
  + "source=ProjectAnalysisSnapshot-contract, liveProviderCalls=0, liveAcceptance=not-evaluated."
);

function metricDefinition(metricId) {
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
}
