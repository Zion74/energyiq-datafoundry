import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createMetadataStore } from "@datafoundry/metadata";
import { LocalDataGateway } from "./index.js";
import {
  ENERGY_FACT_WRITER_CONTRACT_VERSION,
  writeEnergyFactMaterialization,
  type EnergyFactMaterializationWrite,
} from "./energy-fact-writer.js";
import { ensureEnergyScopedDataSource } from "./energy-scoped-datasource.js";

describe("Energy scoped datasource Snapshot guard", () => {
  it("rejects every query from an old datasource after the DuckDB fact state advances", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-scoped-snapshot-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({ id: "workspace-1", owner_user_id: "dev-user", name: "Workspace", kind: "customer" });
      metadata.energyIq.upsertProject({ id: "project-1", workspace_id: "workspace-1", name: "Project", status: "draft" });
      const preparedA = prepareBatch(metadata, "batch-a", "sha-a");
      const persistedA = await writeEnergyFactMaterialization({
        ...factWrite(databasePath, "batch-a", "sha-a", "2026-05-01T00:00:00.000Z"),
        snapshotFactScope: preparedA.fact_scope,
      });
      metadata.energyIq.completeImportBatchMaterialization({
        batch_id: "batch-a",
        project_id: "project-1",
        summary: summary("sha-a"),
        project_audit: persistedA.projectAudit,
        source_manifest_sha256: ["sha-a", "sha-b"],
        expected_snapshot_id: preparedA.expected_snapshot_id,
        expected_previous_snapshot_id: preparedA.expected_previous_snapshot_id,
      });

      const scopedA = await ensureEnergyScopedDataSource({
        metadataStore: metadata,
        userId: "dev-user",
        databasePath,
        context: {
          workspaceId: "workspace-1",
          projectId: "project-1",
          scopeId: "scope-a",
          meterAttachments: [{ meterPointId: "meter-a", scopeId: "scope-a", officialAggregation: true }],
          resource: "electricity",
          from: "2026-05-01T00:00:00.000Z",
          to: "2026-05-02T00:00:00.000Z",
          timezone: "Asia/Singapore",
          hierarchyRevisionId: "hierarchy-v1",
          meterMappingRevisionId: "mapping-v1",
          meterFormulaRevisionId: "formula-v1",
          dataSnapshotId: preparedA.expected_snapshot_id,
          metricVersion: "metrics-v1",
        },
      });
      const scopedEmptyA = await ensureEnergyScopedDataSource({
        metadataStore: metadata,
        userId: "dev-user",
        databasePath,
        context: {
          workspaceId: "workspace-1",
          projectId: "project-1",
          scopeId: "scope-with-no-meters",
          meterAttachments: [],
          resource: "electricity",
          from: "2026-05-01T00:00:00.000Z",
          to: "2026-05-02T00:00:00.000Z",
          timezone: "Asia/Singapore",
          hierarchyRevisionId: "hierarchy-v1",
          meterMappingRevisionId: "mapping-v1",
          meterFormulaRevisionId: "formula-v1",
          dataSnapshotId: preparedA.expected_snapshot_id,
          metricVersion: "metrics-v1",
        },
      });

      const preparedB = prepareBatch(metadata, "batch-b", "sha-b");
      await writeEnergyFactMaterialization({
        ...factWrite(databasePath, "batch-b", "sha-b", "2026-05-01T00:15:00.000Z"),
        snapshotFactScope: preparedB.fact_scope,
      });

      const gateway = new LocalDataGateway(metadata);
      await expect(gateway.runSqlReadonly({
        user_id: "dev-user",
        datasource_id: scopedA.datasourceId,
        sql: `SELECT COUNT(*) AS interval_count FROM ${scopedA.viewName}`,
      })).rejects.toThrow("ENERGYIQ_SNAPSHOT_STALE");
      for (const aggregate of ["COUNT(*)", "SUM(usage_kwh)"]) {
        await expect(gateway.runSqlReadonly({
          user_id: "dev-user",
          datasource_id: scopedEmptyA.datasourceId,
          sql: `SELECT ${aggregate} AS aggregate_value FROM ${scopedEmptyA.viewName}`,
        })).rejects.toThrow("ENERGYIQ_SNAPSHOT_STALE");
      }
    } finally {
      metadata.close();
      try {
        rmSync(root, { recursive: true, force: true });
      } catch (error) {
        if (!(process.platform === "win32" && error instanceof Error && "code" in error
          && (error.code === "EPERM" || error.code === "EBUSY"))) throw error;
      }
    }
  });
});

const prepareBatch = (
  metadata: ReturnType<typeof createMetadataStore>,
  batchId: string,
  sourceSha256: string,
) => {
  metadata.energyIq.createImportBatch({
    id: batchId,
    workspace_id: "workspace-1",
    project_id: "project-1",
    source_kind: "excel",
    source_sha256: sourceSha256,
    filename: `${batchId}.xlsx`,
    status: "inspected",
    inspection: { sheetName: "Sheet1" },
    created_by: "dev-user",
  });
  return metadata.energyIq.prepareImportBatchMaterialization({
    batch_id: batchId,
    project_id: "project-1",
    summary: summary(sourceSha256),
    source_manifest_sha256: ["sha-a", "sha-b"],
  });
};

const summary = (sourceSha256: string) => ({
  sourceSheetName: "Sheet1",
  sourceCoverageFrom: "2026-05-01T00:00:00.000Z",
  sourceCoverageTo: sourceSha256 === "sha-a" ? "2026-05-01T00:15:00.000Z" : "2026-05-01T00:30:00.000Z",
  mappingFingerprint: "mapping-v1",
  timezone: "Asia/Singapore",
  materializerContractVersion: "test-materializer-v1",
  factWriterContractVersion: ENERGY_FACT_WRITER_CONTRACT_VERSION,
});

const factWrite = (
  databasePath: string,
  importBatchId: string,
  sourceSha256: string,
  intervalStart: string,
): EnergyFactMaterializationWrite => ({
  databasePath,
  projectId: "project-1",
  importBatchId,
  sourceSha256,
  timezone: "Asia/Singapore",
  rawReadings: [],
  normalizedReadings: [],
  intervalFacts: [{
    workspaceId: "workspace-1",
    projectId: "project-1",
    importBatchId,
    resource: "electricity",
    meterPointId: "meter-a",
    scopeId: "scope-a",
    sourceLabel: "Meter A",
    category: "load",
    meterRole: "total",
    intervalStart,
    intervalEnd: new Date(Date.parse(intervalStart) + 900_000).toISOString(),
    elapsedMinutes: 15,
    activeEnergyKwh: 101,
    previousActiveEnergyKwh: 100,
    rawDeltaKwh: 1,
    usageKwh: 1,
    averageKw: 4,
    qualityStatus: "ok",
    localDate: "2026-05-01",
    localHour: 8,
    dayType: "weekday",
    sourceFile: `${importBatchId}.xlsx`,
    sourceSha256,
    sourceReadingKind: "interval_usage",
  }],
  qualityEvents: [],
  snapshotFactScope: {
    workspaceId: "workspace-1",
    projectId: "project-1",
    dataSnapshotId: `placeholder-${importBatchId}`,
    manifestFingerprint: `placeholder-${importBatchId}`,
    sourceSha256: [sourceSha256],
  },
});
