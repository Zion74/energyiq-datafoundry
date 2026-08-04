import { describe, expect, it } from "vitest";
import {
  createEnergyIqSourceManifest,
  type EnergyIqImportBatchRecord,
  type EnergyIqProjectSetupDocument,
} from "@datafoundry/metadata";

import {
  requireEnergyImportMaterializationPreconditions,
  toEnergyApiErrorResponse,
} from "./energy-api.js";

describe("Energy API business error mapping", () => {
  it("returns a diagnosable 409 when Project publication is blocked by data readiness", () => {
    expect(toEnergyApiErrorResponse(new Error(
      "ENERGYIQ_PROJECT_DATA_NOT_READY:IMPORT_BATCH_NOT_MATERIALIZED,SNAPSHOT_MAPPING_MISMATCH",
    ))).toEqual({
      status: 409,
      body: {
        success: false,
        error: {
          code: "CONFLICT",
          message: "ENERGYIQ_PROJECT_DATA_NOT_READY:IMPORT_BATCH_NOT_MATERIALIZED,SNAPSHOT_MAPPING_MISMATCH",
        },
      },
    });
  });

  it.each([
    "ENERGYIQ_SOURCE_MANIFEST_NOT_CONFIRMED",
    "ENERGYIQ_SOURCE_MANIFEST_MISMATCH",
    "ENERGYIQ_IMPORT_BATCH_NOT_PINNED",
    "ENERGYIQ_IMPORT_BATCH_NOT_PINNED:batch-1",
    "ENERGYIQ_DATA_SNAPSHOT_IMMUTABLE_CONFLICT:energy-snapshot-test",
  ])("returns a diagnosable 409 for materialization precondition %s", (message) => {
    expect(toEnergyApiErrorResponse(new Error(message))).toMatchObject({
      status: 409,
      body: { success: false, error: { code: "CONFLICT", message } },
    });
  });

  it.each([
    "ENERGYIQ_SOURCE_MANIFEST_INVALID",
    "ENERGYIQ_SOURCE_MANIFEST_REQUIRED",
    "ENERGYIQ_SOURCE_MANIFEST_SHA_INVALID:0",
  ])("keeps malformed Source Manifest input as a 400 for %s", (message) => {
    expect(toEnergyApiErrorResponse(new Error(message))).toMatchObject({
      status: 400,
      body: { success: false, error: { code: "BAD_REQUEST", message } },
    });
  });

  it("returns 409 before materialization when a confirmed saved Mapping covers only part of the registered labels", () => {
    let error: unknown;
    try {
      requireEnergyImportMaterializationPreconditions(importBatches(), setupDocument(["Meter A"]));
    } catch (reason) {
      error = reason;
    }
    expect(toEnergyApiErrorResponse(error)).toMatchObject({
      status: 409,
      body: {
        success: false,
        error: {
          code: "CONFLICT",
          message: "ENERGYIQ_IMPORT_MATERIALIZATION_NOT_READY:SOURCE_LABEL_UNMAPPED",
        },
      },
    });
    expect(() => requireEnergyImportMaterializationPreconditions(
      importBatches(),
      setupDocument(["Meter A", "Meter B"]),
    )).not.toThrow();
    expect(() => requireEnergyImportMaterializationPreconditions(
      importBatches(),
      setupDocument(["Meter A", "Meter B", "Inactive source"]),
    )).toThrow("ENERGYIQ_IMPORT_MATERIALIZATION_NOT_READY:MAPPING_SOURCE_INACTIVE");
    expect(() => requireEnergyImportMaterializationPreconditions(
      importBatches(),
      setupDocument(["Meter A", "Meter B", " meter a "]),
    )).toThrow("ENERGYIQ_IMPORT_MATERIALIZATION_NOT_READY:SOURCE_LABEL_DUPLICATE");
  });
});

const importBatches = (): EnergyIqImportBatchRecord[] => [
  importBatch("batch-a", "a".repeat(64), "Meter A"),
  importBatch("batch-b", "b".repeat(64), "Meter B"),
];

const importBatch = (id: string, sha256: string, label: string): EnergyIqImportBatchRecord => ({
  id,
  workspace_id: "workspace-1",
  project_id: "project-1",
  source_kind: "excel",
  source_sha256: sha256,
  filename: `${id}.xlsx`,
  status: "inspected",
  inspection_json: JSON.stringify({ sourceLabels: [{ label, rowCount: 10 }] }),
  created_by: "dev-user",
  created_at: "2026-08-04T00:00:00.000Z",
});

const setupDocument = (mappingLabels: string[]): EnergyIqProjectSetupDocument => ({
  project: { name: "Project", timezone: "Asia/Singapore" },
  tier_structure_locked: true,
  tiers: [{ id: "circuit", ordinal: 1, alias: "Circuit" }],
  nodes: [{
    id: "scope-a",
    tier_definition_id: "circuit",
    name: "Scope A",
    sort_order: 1,
    metadata_status: "confirmed",
  }],
  source_manifest: createEnergyIqSourceManifest(importBatches().map((batch) => batch.source_sha256), true),
  meter_mapping: {
    schema_version: 2,
    source_kind: "excel",
    confirmed: true,
    rows: mappingLabels.map((label, index) => ({
      id: `mapping-${index}`,
      source_label: label,
      scope_id: "scope-a",
      display_name: label,
      resource: "electricity",
      category: "load",
      coverage: "whole",
      meter_role: "total",
      aggregation_usage: "official",
    })),
  },
});
