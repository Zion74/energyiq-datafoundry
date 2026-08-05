import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createMetadataStore } from "@datafoundry/metadata";
import { LocalDataGateway } from "./index.js";
import { getDuckDbDatabase } from "./duckdb-database-cache.js";
import {
  ENERGY_FACT_WRITER_CONTRACT_VERSION,
  writeEnergyFactProjectMaterialization,
  type EnergyFactMaterializationBatchWrite,
} from "./energy-fact-writer.js";
import {
  ensureEnergyScopedDataSource,
  readEnergyFactCoverage,
} from "./energy-scoped-datasource.js";

describe("Energy scoped datasource Snapshot guard", () => {
  it("fails closed with the stable facts-unavailable code when the fact store is missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-scoped-missing-store-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      await expect(ensureEnergyScopedDataSource({
        metadataStore: metadata,
        userId: "dev-user",
        databasePath: join(root, "missing.duckdb"),
        context: {
          workspaceId: "workspace-1",
          projectId: "project-1",
          scopeId: "scope-a",
          meterAttachments: [],
          resource: "electricity",
          from: "2026-05-01T00:00:00.000Z",
          to: "2026-05-02T00:00:00.000Z",
          timezone: "Asia/Singapore",
          hierarchyRevisionId: "hierarchy-v1",
          meterMappingRevisionId: "mapping-v1",
          meterFormulaRevisionId: "formula-v1",
          dataSnapshotId: "snapshot-a",
          metricVersion: "metrics-v1",
        },
      })).rejects.toThrow("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects every query from an old datasource after the DuckDB fact state advances", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-scoped-snapshot-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({ id: "workspace-1", owner_user_id: "dev-user", name: "Workspace", kind: "customer" });
      metadata.energyIq.upsertProject({ id: "project-1", workspace_id: "workspace-1", name: "Project", status: "draft" });
      createBatch(metadata, "batch-a", "sha-a");
      createBatch(metadata, "batch-b", "sha-b");
      const materializationsA = [{ batch_id: "batch-a", summary: summary("sha-a") }];
      const preparedA = metadata.energyIq.prepareProjectManifestMaterialization({
        project_id: "project-1",
        materializations: materializationsA,
        source_manifest_sha256: ["sha-a"],
      });
      const writeA = projectBatch(factWrite(
        "batch-a",
        "sha-a",
        "2026-05-01T00:00:00.000Z",
      ));
      const persistedA = await writeEnergyFactProjectMaterialization({
        databasePath,
        projectId: "project-1",
        timezone: "Asia/Singapore",
        expectedPreviousDataSnapshotId: preparedA.expected_previous_snapshot_id,
        snapshotFactScope: preparedA.fact_scope,
        batches: [writeA],
      });
      metadata.energyIq.completeProjectManifestMaterialization({
        project_id: "project-1",
        materializations: materializationsA,
        project_audit: persistedA.projectAudit,
        source_manifest_sha256: ["sha-a"],
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
      const gateway = new LocalDataGateway(metadata);

      const [scopedView] = await queryDuckDbSql(databasePath, `
        SELECT sql
        FROM duckdb_views()
        WHERE view_name = '${scopedA.viewName}'
      `);
      expect(String(scopedView?.sql ?? "")).not.toContain("energy_project_fact_state");
      expect(String(scopedView?.sql ?? "")).not.toContain("canonical_interval_digest");
      const scopedRecord = metadata.dataSources.get({
        user_id: "dev-user",
        datasource_id: scopedA.datasourceId,
      });
      const scopedConfig = JSON.parse(scopedRecord.config_json) as Record<string, unknown>;
      const scopedEnergyQueryScope = scopedConfig.energyQueryScope as Record<string, unknown>;
      metadata.dataSources.create({
        user_id: "dev-user",
        id: "energy-scope-different-snapshot",
        name: "Different snapshot scope",
        type: "duckdb",
        config: {
          ...scopedConfig,
          energyQueryScope: {
            ...scopedEnergyQueryScope,
            dataSnapshotId: "snapshot-other",
          },
        },
      });
      await expect(gateway.withEnergySnapshotReadSession({
        user_id: "dev-user",
        workspace_id: "workspace-1",
        datasource_id: scopedA.datasourceId,
      }, async () => {
        const results = await Promise.all([
          gateway.runSqlReadonly({
            user_id: "dev-user",
            workspace_id: "workspace-1",
            datasource_id: scopedA.datasourceId,
            sql: `SELECT COUNT(*) AS interval_count FROM ${scopedA.viewName}`,
          }),
          gateway.withEnergySnapshotReadSession({
            user_id: "dev-user",
            workspace_id: "workspace-1",
            datasource_id: scopedEmptyA.datasourceId,
          }, async () => await gateway.runSqlReadonly({
            user_id: "dev-user",
            workspace_id: "workspace-1",
            datasource_id: scopedEmptyA.datasourceId,
            sql: `SELECT COUNT(*) AS interval_count FROM ${scopedEmptyA.viewName}`,
          })),
        ]);
        await expect(gateway.withEnergySnapshotReadSession({
          user_id: "dev-user",
          workspace_id: "workspace-1",
          datasource_id: "energy-scope-different-snapshot",
        }, async () => undefined)).rejects.toThrow("ENERGYIQ_SNAPSHOT_STALE:snapshot-other");
        return results;
      })).resolves.toMatchObject([
        { rows: [[1]] },
        { rows: [[0]] },
      ]);

      await runDuckDbSql(databasePath, `
        DELETE FROM energy_interval_facts
        WHERE project_id = 'project-1'
          AND interval_start = TIMESTAMPTZ '2026-05-01T00:00:00.000Z'
      `);
      await expect(gateway.runSqlReadonly({
        user_id: "dev-user",
        datasource_id: scopedA.datasourceId,
        sql: `SELECT COUNT(*) AS interval_count FROM ${scopedA.viewName}`,
      })).rejects.toThrow("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
      await expect(readEnergyFactCoverage({
        metadataStore: metadata,
        databasePath,
        workspaceId: "workspace-1",
        projectId: "project-1",
        dataSnapshotId: preparedA.expected_snapshot_id,
        resource: "electricity",
      })).rejects.toThrow("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");

      await writeEnergyFactProjectMaterialization({
        databasePath,
        projectId: "project-1",
        timezone: "Asia/Singapore",
        expectedPreviousDataSnapshotId: preparedA.expected_snapshot_id,
        snapshotFactScope: preparedA.fact_scope,
        batches: [writeA],
      });
      await runDuckDbSql(databasePath, `
        UPDATE energy_interval_facts
        SET usage_kwh = usage_kwh + 1
        WHERE project_id = 'project-1'
      `);
      await expect(gateway.runSqlReadonly({
        user_id: "dev-user",
        datasource_id: scopedA.datasourceId,
        sql: `SELECT SUM(usage_kwh) AS usage_kwh FROM ${scopedA.viewName}`,
      })).rejects.toThrow("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
      await expect(readEnergyFactCoverage({
        metadataStore: metadata,
        databasePath,
        workspaceId: "workspace-1",
        projectId: "project-1",
        dataSnapshotId: preparedA.expected_snapshot_id,
        resource: "electricity",
      })).rejects.toThrow("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");

      await writeEnergyFactProjectMaterialization({
        databasePath,
        projectId: "project-1",
        timezone: "Asia/Singapore",
        expectedPreviousDataSnapshotId: preparedA.expected_snapshot_id,
        snapshotFactScope: preparedA.fact_scope,
        batches: [writeA],
      });

      const materializationsB = [
        { batch_id: "batch-a", summary: summary("sha-a") },
        { batch_id: "batch-b", summary: summary("sha-b") },
      ];
      const preparedB = metadata.energyIq.prepareProjectManifestMaterialization({
        project_id: "project-1",
        materializations: materializationsB,
        source_manifest_sha256: ["sha-a", "sha-b"],
      });
      await writeEnergyFactProjectMaterialization({
        databasePath,
        projectId: "project-1",
        timezone: "Asia/Singapore",
        expectedPreviousDataSnapshotId: preparedB.expected_previous_snapshot_id,
        snapshotFactScope: preparedB.fact_scope,
        batches: [
          projectBatch(factWrite("batch-a", "sha-a", "2026-05-01T00:00:00.000Z")),
          projectBatch(factWrite("batch-b", "sha-b", "2026-05-01T00:15:00.000Z")),
        ],
      });

      await expect(gateway.runSqlReadonly({
        user_id: "dev-user",
        datasource_id: scopedA.datasourceId,
        sql: `SELECT COUNT(*) AS interval_count FROM ${scopedA.viewName}`,
      })).rejects.toThrow("ENERGYIQ_SNAPSHOT_STALE");
      await expect(gateway.withEnergySnapshotReadSession({
        user_id: "dev-user",
        workspace_id: "workspace-1",
        datasource_id: scopedA.datasourceId,
      }, async () => await gateway.runSqlReadonly({
        user_id: "dev-user",
        workspace_id: "workspace-1",
        datasource_id: scopedA.datasourceId,
        sql: `SELECT COUNT(*) AS interval_count FROM ${scopedA.viewName}`,
      }))).rejects.toThrow("ENERGYIQ_SNAPSHOT_STALE");
      for (const aggregate of ["COUNT(*)", "SUM(usage_kwh)"]) {
        await expect(gateway.runSqlReadonly({
          user_id: "dev-user",
          datasource_id: scopedEmptyA.datasourceId,
          sql: `SELECT ${aggregate} AS aggregate_value FROM ${scopedEmptyA.viewName}`,
        })).rejects.toThrow("ENERGYIQ_SNAPSHOT_STALE");
      }
      await runDuckDbSql(databasePath, `
        DELETE FROM energy_project_fact_state
        WHERE project_id = 'project-1'
      `);
      await expect(gateway.withEnergySnapshotReadSession({
        user_id: "dev-user",
        workspace_id: "workspace-1",
        datasource_id: scopedA.datasourceId,
      }, async () => undefined)).rejects.toThrow("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
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

const createBatch = (
  metadata: ReturnType<typeof createMetadataStore>,
  batchId: string,
  sourceSha256: string,
): void => {
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
  importBatchId: string,
  sourceSha256: string,
  intervalStart: string,
): EnergyFactMaterializationBatchWrite => ({
  importBatchId,
  sourceSha256,
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
});

const projectBatch = (input: EnergyFactMaterializationBatchWrite): EnergyFactMaterializationBatchWrite => ({
  importBatchId: input.importBatchId,
  sourceSha256: input.sourceSha256,
  rawReadings: input.rawReadings,
  normalizedReadings: input.normalizedReadings,
  intervalFacts: input.intervalFacts,
  qualityEvents: input.qualityEvents,
});

const runDuckDbSql = async (databasePath: string, sql: string): Promise<void> => {
  const database = await getDuckDbDatabase(databasePath);
  const connection = database.connect();
  try {
    await new Promise<void>((resolve, reject) => {
      connection.run(sql, (error) => error ? reject(error) : resolve());
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      connection.close((error) => error ? reject(error) : resolve());
    });
  }
};

const queryDuckDbSql = async (
  databasePath: string,
  sql: string,
): Promise<Array<Record<string, unknown>>> => {
  const database = await getDuckDbDatabase(databasePath);
  const connection = database.connect();
  try {
    return await new Promise((resolve, reject) => {
      connection.all(sql, (error, rows) => error
        ? reject(error)
        : resolve(rows as Array<Record<string, unknown>>));
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      connection.close((error) => error ? reject(error) : resolve());
    });
  }
};
