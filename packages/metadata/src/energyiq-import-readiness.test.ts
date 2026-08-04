import { describe, expect, it } from "vitest";

import {
  fingerprintEnergyIqMeterMapping,
  resolveEnergyIqProjectDataReadiness,
  sourceLabelsAcrossEnergyIqImportBatches,
  type EnergyIqDataSnapshotRecord,
  type EnergyIqImportBatchRecord,
  type EnergyIqMeterMappingDraft,
  type EnergyIqProjectRecord,
  type EnergyIqProjectSetupDocument,
} from "./index.js";

describe("resolveEnergyIqProjectDataReadiness", () => {
  it("treats a pure structure publication without Mapping or imports as not requiring the data gate", () => {
    expect(resolveEnergyIqProjectDataReadiness({
      project: project("unavailable"),
      batches: [],
      document: document(),
      expectedMaterializerContractVersion: "energy-excel-cumulative-v1",
    })).toMatchObject({ status: "not_required", ready: true, requiresFormalData: false });
  });

  it("requires the union of all source labels and one current composite snapshot", () => {
    const mapping = meterMapping();
    const batches = [
      batch("batch-l6-old", "sha-l6-old", NGEE_ANN_LABELS.slice(0, 9)),
      batch("batch-l6-new", "sha-l6-new", NGEE_ANN_LABELS.slice(0, 9)),
      batch("batch-l7-old", "sha-l7-old", NGEE_ANN_LABELS.slice(9)),
      batch("batch-l7-new", "sha-l7-new", NGEE_ANN_LABELS.slice(9)),
    ];
    const snapshot = dataSnapshot(batches);
    const readiness = resolveEnergyIqProjectDataReadiness({
      project: project(snapshot.id),
      batches,
      document: { ...document(), meter_mapping: mapping },
      snapshot,
      expectedMaterializerContractVersion: "energy-excel-cumulative-v1",
    });

    expect(sourceLabelsAcrossEnergyIqImportBatches(batches)).toHaveLength(18);
    expect(readiness).toMatchObject({
      status: "ready",
      ready: true,
      importBatchCount: 4,
      materializedBatchCount: 4,
      sourceLabelCount: 18,
      mappedSourceLabelCount: 18,
      blockingReasons: [],
    });
    expect(readiness.warnings).toEqual(["RAW_OVERLAP_CONFLICTS_RESOLVED_BY_LATER_COVERAGE:32"]);
  });

  it("blocks stale Mapping materialization, incomplete batches, inactive rows and legacy canonical facts", () => {
    const mapping = meterMapping();
    const batches = [
      batch("batch-l6", "sha-l6", NGEE_ANN_LABELS.slice(0, 9), "inspected"),
      batch("batch-l7", "sha-l7", NGEE_ANN_LABELS.slice(9), "materialized", "stale-fingerprint"),
    ];
    mapping.rows.push({ ...mapping.rows[0]!, id: "inactive", source_label: "Inactive meter" });
    const snapshot = dataSnapshot(batches.filter((candidate) => candidate.status === "materialized"), {
      legacyCanonicalRowCount: 10,
    });
    const readiness = resolveEnergyIqProjectDataReadiness({
      project: project(snapshot.id),
      batches,
      document: { ...document(), meter_mapping: mapping },
      snapshot,
      expectedMaterializerContractVersion: "energy-excel-cumulative-v1",
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.blockingReasons).toEqual(expect.arrayContaining([
      "IMPORT_BATCH_NOT_MATERIALIZED",
      "MAPPING_SOURCE_INACTIVE",
      "SNAPSHOT_MAPPING_MISMATCH",
      "LEGACY_CANONICAL_ROWS",
    ]));
  });
});

const document = (): EnergyIqProjectSetupDocument => ({
  project: { name: "Ngee Ann Polytechnic", timezone: "Asia/Singapore" },
  tier_structure_locked: true,
  tiers: [{ id: "circuit", ordinal: 1, alias: "Circuit" }],
  nodes: [{ id: "level-6", tier_definition_id: "circuit", name: "Level 6", sort_order: 1, metadata_status: "confirmed" }],
});

const meterMapping = (): EnergyIqMeterMappingDraft => ({
  source_kind: "excel",
  confirmed: true,
  rows: NGEE_ANN_LABELS.map((label, index) => ({
    id: `meter-${index + 1}`,
    source_label: label,
    scope_id: "level-6",
    display_name: label,
    resource: "electricity",
    category: label.toLowerCase().includes("light") ? "light" : "load",
    coverage: "whole",
    meter_role: label.includes("Total") ? "total" : "component",
    aggregation_usage: label.includes("Total") ? "official" : "excluded",
  })),
});

const batch = (
  id: string,
  sha: string,
  labels: string[],
  status: EnergyIqImportBatchRecord["status"] = "materialized",
  mappingFingerprint = fingerprintEnergyIqMeterMapping(meterMapping()),
): EnergyIqImportBatchRecord => ({
  id,
  workspace_id: "default",
  project_id: "ngee-ann-polytechnic",
  source_kind: "excel",
  source_sha256: sha,
  filename: `${id}.xlsx`,
  status,
  inspection_json: JSON.stringify({
    sheetName: "Sheet1",
    sourceLabels: labels.map((label) => ({ label, rowCount: 2_880 })),
    coverageFrom: "2026-04-21T00:00:00.000Z",
    coverageTo: "2026-06-17T23:45:00.000Z",
  }),
  ...(status === "materialized" ? {
    materialization_json: JSON.stringify({
      mappingFingerprint,
      mappingRevision: 4,
      timezone: "Asia/Singapore",
      materializerContractVersion: "energy-excel-cumulative-v1",
    }),
    materialized_at: "2026-08-04T00:00:00.000Z",
  } : {}),
  created_by: "dev-user",
  created_at: "2026-08-04T00:00:00.000Z",
});

const dataSnapshot = (
  batches: EnergyIqImportBatchRecord[],
  auditOverrides: Record<string, number> = {},
): EnergyIqDataSnapshotRecord => ({
  id: "energy-snapshot-test",
  workspace_id: "default",
  project_id: "ngee-ann-polytechnic",
  manifest_json: JSON.stringify({
    version: 1,
    projectId: "ngee-ann-polytechnic",
    batches: batches.map((candidate) => ({ sourceSha256: candidate.source_sha256 })),
  }),
  audit_json: JSON.stringify({
    invalidRawRowCount: 0,
    unmappedRawRowCount: 0,
    rawOverlapConflictCount: 32,
    duplicateNormalizedReadingCount: 0,
    duplicateIntervalFactCount: 0,
    invalidIntervalDurationCount: 0,
    legacyCanonicalRowCount: 0,
    ...auditOverrides,
  }),
  created_at: "2026-08-04T00:00:00.000Z",
});

const project = (dataSnapshotId: string): EnergyIqProjectRecord => ({
  id: "ngee-ann-polytechnic",
  workspace_id: "default",
  name: "Ngee Ann Polytechnic",
  status: "published",
  timezone: "Asia/Singapore",
  hierarchy_revision_id: "hierarchy-v1",
  meter_formula_revision_id: "formula-v1",
  data_snapshot_id: dataSnapshotId,
  metric_version: "metric-v1",
  business_calendar_version: "calendar-v1",
  tariff_schedule_version: "tariff-v1",
  delivery_stage: "published",
  root_scope_id: "project",
  has_unpublished_changes: false,
  created_at: "2026-08-04T00:00:00.000Z",
  updated_at: "2026-08-04T00:00:00.000Z",
});

const NGEE_ANN_LABELS = [
  "Lvl 6 Total Office Light",
  "Lvl 6 Office Light-Left: External",
  "Lvl 6 Office Light-Right: Internal",
  "Lvl 6 Total Office Load",
  "Lvl 6 Office Load 1: L1P1-L3P6",
  "Lvl 6 Office Load 2: L1P7-L3P12",
  "Lvl 6 Office Load 3: L1P13-L3P18",
  "Lvl 6 Office Load 4: L1P19-L3P24",
  "Lvl 6 Office Load 5: L1P25-L3P29 Fan Isol 1/2",
  "Lvl 7 Middle Row Office Light",
  "Lvl 7 Back Row Office Light",
  "Lvl 7 Front Row Office Light",
  "Lvl 7 Total Office Light",
  "Lvl 7 Total Office Load",
  "Lvl 7 Office Load 1: L1P1-L3P6",
  "Lvl 7 Office Load 2: L1P7-L3P15",
  "Lvl 7 Office Load 3: L1P16-L3P21",
  "Lvl 7 Office Load 4: L1P22-L3P25 Fan ISOL1/2",
];
