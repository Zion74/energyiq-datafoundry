import writeXlsxFile from "write-excel-file/node";
import { describe, expect, it } from "vitest";

import type { EnergyIqImportBatchRecord, EnergyIqProjectSetupDocument } from "@datafoundry/metadata";
import {
  buildEnergyExcelMaterialization,
  isEnergyImportMaterializationCurrent,
} from "./energy-import-materializer.js";

describe("buildEnergyExcelMaterialization", () => {
  it("turns mapped Singapore cumulative readings into traceable interval facts", async () => {
    const workbook = await writeXlsxFile([
      [text("Device Name"), text("Time"), text("Active Energy")],
      [text("Meter A"), date("2026-05-01T00:00:00Z"), number(100)],
      [text("Meter A"), date("2026-05-01T00:15:00Z"), number(100.5)],
      [text("Meter A"), date("2026-05-01T00:30:00Z"), number(101)],
    ]).toBuffer();
    const result = await buildEnergyExcelMaterialization({
      content: workbook,
      batch: batch(),
      document: document(),
      mappingRevision: 4,
      timezone: "Asia/Singapore",
      databasePath: "ignored.duckdb",
    });

    expect(result.write.rawReadings).toHaveLength(3);
    expect(result.write.normalizedReadings).toHaveLength(3);
    expect(result.write.normalizedReadings[0]?.eventTime).toBe("2026-04-30T16:00:00.000Z");
    expect(result.write.intervalFacts).toHaveLength(2);
    expect(result.write.intervalFacts[0]).toMatchObject({
      scopeId: "scope-a",
      usageKwh: 0.5,
      averageKw: 2,
      localDate: "2026-05-01",
      localHour: 0,
      qualityStatus: "ok",
    });
    expect(result.summary).toMatchObject({
      rawRowCount: 3,
      normalizedReadingCount: 3,
      intervalFactCount: 2,
      totalUsageKwh: 1,
      mappingRevision: 4,
      timezone: "Asia/Singapore",
      materializerContractVersion: "energy-excel-cumulative-v1",
    });
    expect(result.summary.mappingFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.summary.qualityCounts.boundary).toBe(1);

    expect(isEnergyImportMaterializationCurrent({
      batch: {
        ...batch(),
        status: "materialized",
        materialization_json: JSON.stringify(result.summary),
      },
      document: document(),
      timezone: "Asia/Singapore",
    })).toBe(true);
    expect(isEnergyImportMaterializationCurrent({
      batch: { ...batch(), status: "materialized", materialization_json: JSON.stringify({ intervalFactCount: 2 }) },
      document: document(),
      timezone: "Asia/Singapore",
    })).toBe(false);
    const changed = document();
    changed.meter_mapping!.rows[0]!.category = "other";
    expect(isEnergyImportMaterializationCurrent({
      batch: {
        ...batch(),
        status: "materialized",
        materialization_json: JSON.stringify(result.summary),
      },
      document: changed,
      timezone: "Asia/Singapore",
    })).toBe(false);
  });

  it("requires a confirmed Mapping", async () => {
    const workbook = await writeXlsxFile([
      [text("Device Name"), text("Time"), text("Active Energy")],
      [text("Meter A"), date("2026-05-01T00:00:00Z"), number(100)],
    ]).toBuffer();
    const unconfirmed = document();
    unconfirmed.meter_mapping!.confirmed = false;
    await expect(buildEnergyExcelMaterialization({
      content: workbook,
      batch: batch(),
      document: unconfirmed,
      mappingRevision: 4,
      timezone: "Asia/Singapore",
      databasePath: "ignored.duckdb",
    })).rejects.toThrow("ENERGYIQ_METER_MAPPING_NOT_CONFIRMED");
  });
});

const batch = (): EnergyIqImportBatchRecord => ({
  id: "batch-1",
  workspace_id: "workspace-1",
  project_id: "project-1",
  source_kind: "excel",
  source_sha256: "a".repeat(64),
  filename: "meter.xlsx",
  status: "inspected",
  inspection_json: "{}",
  created_by: "admin-1",
  created_at: "2026-05-01T00:00:00.000Z",
});

const document = (): EnergyIqProjectSetupDocument => ({
  project: { name: "Project", timezone: "Asia/Singapore" },
  tier_structure_locked: true,
  tiers: [{ id: "tier-1", ordinal: 1, alias: "Circuit" }],
  nodes: [{ id: "scope-a", tier_definition_id: "tier-1", name: "Circuit A", sort_order: 1, metadata_status: "confirmed" }],
  meter_mapping: {
    source_kind: "excel",
    confirmed: true,
    rows: [{
      id: "meter-a",
      source_label: "Meter A",
      scope_id: "scope-a",
      display_name: "Meter A",
      resource: "electricity",
      category: "load",
      coverage: "whole",
      meter_role: "total",
      aggregation_usage: "official",
    }],
  },
});

const text = (value: string) => ({ type: String, value });
const number = (value: number) => ({ type: Number, value });
const date = (value: string) => ({ type: Date, value: new Date(value), format: "yyyy-mm-dd hh:mm" });
