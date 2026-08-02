import { describe, expect, it } from "vitest";

import type {
  EnergyMetricRevisionDto,
  EnergyProjectSetupDocumentDto,
} from "../../../lib/config-api";
import { resolveMetricReadiness } from "./analysis-configuration-model";

const metric = (requirement: EnergyMetricRevisionDto["requirement"]): EnergyMetricRevisionDto => ({
  revision_id: `metric.${requirement}@1`,
  metric_id: `metric.${requirement}`,
  version: 1,
  display_name: requirement,
  description: requirement,
  family: requirement === "always" ? "aggregate" : "normalised",
  unit: "kWh",
  value_type: "number",
  calculation_key: "summary.value",
  requirement,
  created_at: "2026-08-01T00:00:00.000Z",
});

const document = (nodes: EnergyProjectSetupDocumentDto["nodes"]): EnergyProjectSetupDocumentDto => ({
  project: { name: "Test", timezone: "Asia/Singapore" },
  tier_structure_locked: true,
  tiers: [
    { id: "circuit", ordinal: 1, alias: "Circuit" },
    { id: "level", ordinal: 2, alias: "Level" },
  ],
  nodes,
});

describe("resolveMetricReadiness", () => {
  it("marks fact-only metrics ready without structure metadata", () => {
    expect(resolveMetricReadiness(metric("always"), document([]))).toMatchObject({
      status: "ready",
      label: "Ready",
    });
  });

  it("ignores lowest-tier circuit nodes when checking area readiness", () => {
    expect(resolveMetricReadiness(metric("area"), document([
      { id: "level-1", tier_definition_id: "level", name: "Level 1", sort_order: 1, area_sqm: 500, metadata_status: "confirmed" },
      { id: "circuit-1", tier_definition_id: "circuit", parent_id: "level-1", name: "Circuit 1", sort_order: 1, metadata_status: "confirmed" },
    ]))).toEqual({
      status: "ready",
      label: "Ready",
      detail: "1/1 analytical scopes have area metadata",
    });
  });

  it("reports partial and missing metadata without disabling the metric", () => {
    const partial = document([
      { id: "level-1", tier_definition_id: "level", name: "Level 1", sort_order: 1, occupant_count: 20, metadata_status: "confirmed" },
      { id: "level-2", tier_definition_id: "level", name: "Level 2", sort_order: 2, metadata_status: "provisional" },
    ]);
    expect(resolveMetricReadiness(metric("people"), partial)).toEqual({
      status: "partial",
      label: "Partially ready",
      detail: "1/2 analytical scopes have 24-hour people metadata",
    });
    expect(resolveMetricReadiness(metric("area"), partial)).toMatchObject({
      status: "missing",
      label: "Not ready",
    });
  });
});
