import { describe, expect, it } from "vitest";

import type {
  EnergyMetricRevisionDto,
  EnergyProjectSetupDocumentDto,
  EnergyRuleRevisionDto,
} from "../../../lib/config-api";
import { resolveMetricReadiness, resolveRuleReadiness } from "./analysis-configuration-model";

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

const rule = (
  requirement: EnergyRuleRevisionDto["requirement"],
  metricRevisionIds = ["energy.total_usage_kwh@1"],
): EnergyRuleRevisionDto => ({
  revision_id: `rule.${requirement}@1`,
  rule_id: `rule.${requirement}`,
  version: 1,
  display_name: requirement,
  description: requirement,
  family: "comparison",
  severity: "warning",
  evaluation_key: requirement,
  metric_revision_ids: metricRevisionIds,
  parameters: { minimum_peers: 3 },
  requirement,
  created_at: "2026-08-02T00:00:00.000Z",
});

describe("resolveRuleReadiness", () => {
  const selectedMetrics = new Set(["energy.total_usage_kwh@1"]);

  it("requires every referenced metric to be enabled", () => {
    expect(resolveRuleReadiness(rule("always", ["energy.missing@1"]), document([]), selectedMetrics, "sg-calendar-v1"))
      .toMatchObject({ status: "missing", detail: "Enable 1 required metric first" });
  });

  it("requires a configured operating-hours calendar", () => {
    expect(resolveRuleReadiness(rule("operating_hours"), document([]), selectedMetrics, ""))
      .toMatchObject({ status: "missing", detail: "Missing operating-hours calendar" });
    expect(resolveRuleReadiness(rule("operating_hours"), document([]), selectedMetrics, "sg-calendar-v1"))
      .toMatchObject({ status: "ready", detail: "Uses sg-calendar-v1" });
  });

  it("checks comparable sibling groups rather than counting unrelated nodes", () => {
    const comparable = document([
      { id: "level-1", tier_definition_id: "level", name: "Level 1", sort_order: 1, area_sqm: 500, metadata_status: "confirmed" },
      { id: "level-2", tier_definition_id: "level", name: "Level 2", sort_order: 2, area_sqm: 600, metadata_status: "confirmed" },
      { id: "level-3", tier_definition_id: "level", name: "Level 3", sort_order: 3, area_sqm: 700, metadata_status: "confirmed" },
      { id: "circuit-1", tier_definition_id: "circuit", parent_id: "level-1", name: "Circuit 1", sort_order: 1, area_sqm: 50, metadata_status: "confirmed" },
    ]);
    expect(resolveRuleReadiness(rule("area_peers"), comparable, selectedMetrics, "sg-calendar-v1"))
      .toMatchObject({ status: "ready", detail: "3 area-comparable sibling scopes available" });
  });

  it("does not combine nodes from different sibling groups", () => {
    const separated = document([
      { id: "level-1", tier_definition_id: "level", name: "Level 1", sort_order: 1, metadata_status: "confirmed" },
      { id: "room-1", tier_definition_id: "level", parent_id: "parent-a", name: "Room 1", sort_order: 1, occupant_count: 10, metadata_status: "confirmed" },
      { id: "room-2", tier_definition_id: "level", parent_id: "parent-b", name: "Room 2", sort_order: 1, occupant_count: 10, metadata_status: "confirmed" },
      { id: "room-3", tier_definition_id: "level", parent_id: "parent-c", name: "Room 3", sort_order: 1, occupant_count: 10, metadata_status: "confirmed" },
    ]);
    expect(resolveRuleReadiness(rule("people_peers"), separated, selectedMetrics, "sg-calendar-v1"))
      .toMatchObject({ status: "missing", detail: "1/3 required siblings with people metadata" });
  });
});
