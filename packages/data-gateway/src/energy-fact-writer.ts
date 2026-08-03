import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type * as DuckDbModule from "duckdb";

import { getDuckDbDatabase } from "./duckdb-database-cache.js";

export type EnergyRawReadingWrite = {
  workspaceId: string;
  projectId: string;
  importBatchId: string;
  resource: "electricity" | "water";
  sourceLabel: string;
  meterPointId?: string;
  scopeId?: string;
  eventTime?: string;
  activeEnergyKwh?: number;
  sourceFile: string;
  sourceSha256: string;
  sourceRowNumber: number;
  isValid: boolean;
  validationError?: string;
  isOverlapConflict: boolean;
};

export type EnergyNormalizedReadingWrite = {
  workspaceId: string;
  projectId: string;
  importBatchId: string;
  resource: "electricity" | "water";
  meterPointId: string;
  scopeId: string;
  parentNodeId?: string;
  sourceLabel: string;
  category: string;
  meterRole: string;
  eventTime: string;
  activeEnergyKwh: number;
  sourceFile: string;
  sourceSha256: string;
  sourceRowNumber: number;
};

export type EnergyIntervalFactWrite = {
  workspaceId: string;
  projectId: string;
  importBatchId: string;
  resource: "electricity" | "water";
  meterPointId: string;
  scopeId: string;
  parentNodeId?: string;
  sourceLabel: string;
  category: string;
  meterRole: string;
  intervalStart: string;
  intervalEnd: string;
  elapsedMinutes: number;
  activeEnergyKwh: number;
  previousActiveEnergyKwh: number;
  rawDeltaKwh: number;
  usageKwh?: number;
  averageKw?: number;
  qualityStatus: string;
  localDate: string;
  localHour: number;
  dayType: string;
  isOperating?: boolean;
  sourceFile: string;
  sourceSha256: string;
};

export type EnergyQualityEventWrite = {
  workspaceId: string;
  projectId: string;
  importBatchId: string;
  meterPointId?: string;
  sourceLabel?: string;
  eventTime?: string;
  code: string;
  severity: "warning" | "error";
  details: unknown;
};

export type EnergyFactMaterializationWrite = {
  databasePath: string;
  projectId: string;
  importBatchId: string;
  sourceSha256: string;
  rawReadings: EnergyRawReadingWrite[];
  normalizedReadings: EnergyNormalizedReadingWrite[];
  intervalFacts: EnergyIntervalFactWrite[];
  qualityEvents: EnergyQualityEventWrite[];
};

export type EnergyFactMaterializationStats = {
  rawRows: number;
  normalizedRows: number;
  intervalFacts: number;
  qualityEvents: number;
};

export const writeEnergyFactMaterialization = async (
  input: EnergyFactMaterializationWrite,
): Promise<EnergyFactMaterializationStats> => {
  const databasePath = input.databasePath === ":memory:" ? input.databasePath : resolve(input.databasePath);
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
  const database = await getDuckDbDatabase(databasePath);
  const connection = database.connect();
  try {
    await ensureFactSchema(connection);
    await duckDbRun(connection, "BEGIN TRANSACTION");
    await deleteExistingBatch(connection, input);
    await updateHistoricalMappings(connection, input.normalizedReadings);
    await insertRows(connection, "raw_meter_readings", RAW_COLUMNS, input.rawReadings.map(rawValues));
    await insertRows(connection, "normalized_meter_readings", NORMALIZED_COLUMNS, input.normalizedReadings.map(normalizedValues));
    await insertRows(connection, "energy_interval_facts", FACT_COLUMNS, input.intervalFacts.map(factValues));
    await insertRows(connection, "energy_quality_events", QUALITY_COLUMNS, input.qualityEvents.map(qualityValues));
    await markRawOverlapConflicts(connection, input.projectId);
    await deduplicateCanonicalRows(connection, input.projectId);
    await duckDbRun(connection, "COMMIT");
    await duckDbRun(connection, "CHECKPOINT");
    return await readMaterializationStats(connection, input.importBatchId);
  } catch (error) {
    await duckDbRun(connection, "ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await duckDbClose(connection).catch(ignoreAlreadyClosed);
  }
};

const updateHistoricalMappings = async (
  connection: DuckDbModule.Connection,
  readings: EnergyNormalizedReadingWrite[],
): Promise<void> => {
  const mappingByLabel = new Map<string, EnergyNormalizedReadingWrite>();
  for (const reading of readings) mappingByLabel.set(reading.sourceLabel, reading);
  for (const mapped of mappingByLabel.values()) {
    await duckDbRun(connection, `
      UPDATE raw_meter_readings
      SET meter_node_id = ?, scope_id = ?
      WHERE project_id = ? AND device_name = ?
    `, [mapped.meterPointId, mapped.scopeId, mapped.projectId, mapped.sourceLabel]);
    await duckDbRun(connection, `
      UPDATE normalized_meter_readings
      SET meter_node_id = ?, scope_id = ?, level_node_id = ?, category = ?, meter_role = ?
      WHERE project_id = ? AND device_name = ?
    `, [
      mapped.meterPointId,
      mapped.scopeId,
      mapped.parentNodeId ?? null,
      mapped.category,
      mapped.meterRole,
      mapped.projectId,
      mapped.sourceLabel,
    ]);
    await duckDbRun(connection, `
      UPDATE energy_interval_facts
      SET meter_node_id = ?, scope_id = ?, parent_node_id = ?, level_node_id = ?,
          appliance = ?, circuit_name = device_name, category = ?, meter_role = ?
      WHERE project_id = ? AND device_name = ?
    `, [
      mapped.meterPointId,
      mapped.scopeId,
      mapped.parentNodeId ?? null,
      mapped.parentNodeId ?? null,
      mapped.category,
      mapped.category,
      mapped.meterRole,
      mapped.projectId,
      mapped.sourceLabel,
    ]);
  }
};

export const readEnergyFactMaterializationStats = async (input: {
  databasePath: string;
  importBatchId: string;
}): Promise<EnergyFactMaterializationStats> => {
  const databasePath = input.databasePath === ":memory:" ? input.databasePath : resolve(input.databasePath);
  const database = await getDuckDbDatabase(databasePath);
  const connection = database.connect();
  try {
    return await readMaterializationStats(connection, input.importBatchId);
  } finally {
    await duckDbClose(connection).catch(ignoreAlreadyClosed);
  }
};

const readMaterializationStats = async (
  connection: DuckDbModule.Connection,
  importBatchId: string,
): Promise<EnergyFactMaterializationStats> => {
  const row = await duckDbGet(connection, `
    SELECT
      (SELECT COUNT(*) FROM raw_meter_readings WHERE import_batch_id = ?) AS raw_rows,
      (SELECT COUNT(*) FROM normalized_meter_readings WHERE import_batch_id = ?) AS normalized_rows,
      (SELECT COUNT(*) FROM energy_interval_facts WHERE import_batch_id = ?) AS interval_facts,
      (SELECT COUNT(*) FROM energy_quality_events WHERE import_batch_id = ?) AS quality_events
  `, [importBatchId, importBatchId, importBatchId, importBatchId]);
  return {
    rawRows: Number(row.raw_rows ?? 0),
    normalizedRows: Number(row.normalized_rows ?? 0),
    intervalFacts: Number(row.interval_facts ?? 0),
    qualityEvents: Number(row.quality_events ?? 0),
  };
};

const ensureFactSchema = async (connection: DuckDbModule.Connection): Promise<void> => {
  await duckDbRun(connection, `
    CREATE TABLE IF NOT EXISTS raw_meter_readings (
      workspace_id VARCHAR, project_id VARCHAR, resource VARCHAR, device_name VARCHAR,
      event_time TIMESTAMPTZ, active_energy_kwh DOUBLE, source_file VARCHAR,
      source_sha256 VARCHAR, source_row_number INTEGER, is_valid BOOLEAN,
      validation_error VARCHAR, is_overlap_conflict BOOLEAN
    );
    CREATE TABLE IF NOT EXISTS normalized_meter_readings (
      workspace_id VARCHAR, project_id VARCHAR, resource VARCHAR, meter_node_id VARCHAR,
      level_node_id VARCHAR, device_name VARCHAR, category VARCHAR, meter_role VARCHAR,
      event_time TIMESTAMPTZ, active_energy_kwh DOUBLE, source_file VARCHAR,
      source_sha256 VARCHAR, source_row_number INTEGER
    );
    CREATE TABLE IF NOT EXISTS energy_interval_facts (
      workspace_id VARCHAR, project_id VARCHAR, resource VARCHAR, meter_node_id VARCHAR,
      parent_node_id VARCHAR, level_node_id VARCHAR, device_name VARCHAR, appliance VARCHAR,
      circuit_name VARCHAR, category VARCHAR, meter_role VARCHAR, source_reading_kind VARCHAR,
      interval_start TIMESTAMPTZ, interval_end TIMESTAMPTZ, elapsed_minutes DOUBLE,
      active_energy_kwh DOUBLE, previous_active_energy_kwh DOUBLE, raw_delta_kwh DOUBLE,
      usage_kwh DOUBLE, average_kw DOUBLE, quality_status VARCHAR, local_date DATE,
      local_hour INTEGER, day_type VARCHAR, is_operating BOOLEAN, source_file VARCHAR,
      source_sha256 VARCHAR
    );
    ALTER TABLE raw_meter_readings ADD COLUMN IF NOT EXISTS import_batch_id VARCHAR;
    ALTER TABLE raw_meter_readings ADD COLUMN IF NOT EXISTS meter_node_id VARCHAR;
    ALTER TABLE raw_meter_readings ADD COLUMN IF NOT EXISTS scope_id VARCHAR;
    ALTER TABLE normalized_meter_readings ADD COLUMN IF NOT EXISTS import_batch_id VARCHAR;
    ALTER TABLE normalized_meter_readings ADD COLUMN IF NOT EXISTS scope_id VARCHAR;
    ALTER TABLE energy_interval_facts ADD COLUMN IF NOT EXISTS import_batch_id VARCHAR;
    ALTER TABLE energy_interval_facts ADD COLUMN IF NOT EXISTS scope_id VARCHAR;
    UPDATE normalized_meter_readings SET scope_id = meter_node_id WHERE scope_id IS NULL;
    UPDATE energy_interval_facts SET scope_id = meter_node_id WHERE scope_id IS NULL;
    CREATE TABLE IF NOT EXISTS energy_quality_events (
      workspace_id VARCHAR NOT NULL,
      project_id VARCHAR NOT NULL,
      import_batch_id VARCHAR NOT NULL,
      meter_node_id VARCHAR,
      source_label VARCHAR,
      event_time TIMESTAMPTZ,
      code VARCHAR NOT NULL,
      severity VARCHAR NOT NULL,
      details_json JSON NOT NULL
    );
    CREATE OR REPLACE VIEW energy_daily_facts AS
    SELECT
      workspace_id, project_id, resource, meter_node_id, scope_id,
      parent_node_id, level_node_id, device_name, appliance, circuit_name,
      category, meter_role, local_date,
      SUM(usage_kwh) FILTER (WHERE quality_status = 'ok') AS usage_kwh,
      MAX(average_kw) FILTER (WHERE quality_status = 'ok') AS peak_average_kw,
      COUNT(*) FILTER (WHERE quality_status = 'ok') AS valid_interval_count,
      COUNT(*) FILTER (WHERE quality_status <> 'ok') AS quality_event_count
    FROM energy_interval_facts
    GROUP BY ALL;
  `);
};

const deleteExistingBatch = async (
  connection: DuckDbModule.Connection,
  input: EnergyFactMaterializationWrite,
): Promise<void> => {
  for (const table of ["raw_meter_readings", "normalized_meter_readings", "energy_interval_facts"]) {
    await duckDbRun(connection, `DELETE FROM ${table} WHERE project_id = ? AND (import_batch_id = ? OR source_sha256 = ?)`, [
      input.projectId,
      input.importBatchId,
      input.sourceSha256,
    ]);
  }
  await duckDbRun(connection, "DELETE FROM energy_quality_events WHERE project_id = ? AND import_batch_id = ?", [
    input.projectId,
    input.importBatchId,
  ]);
};

const markRawOverlapConflicts = async (
  connection: DuckDbModule.Connection,
  projectId: string,
): Promise<void> => {
  await duckDbRun(connection, `
    UPDATE raw_meter_readings target
    SET is_overlap_conflict = TRUE
    WHERE target.project_id = ?
      AND target.event_time IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM raw_meter_readings candidate
        WHERE candidate.project_id = target.project_id
          AND candidate.meter_node_id = target.meter_node_id
          AND candidate.event_time = target.event_time
          AND candidate.active_energy_kwh <> target.active_energy_kwh
      )
  `, [projectId]);
};

const deduplicateCanonicalRows = async (
  connection: DuckDbModule.Connection,
  projectId: string,
): Promise<void> => {
  await replaceProjectRowsWithPreferredSource(connection, {
    table: "normalized_meter_readings",
    columns: NORMALIZED_COLUMNS,
    projectId,
    timestampColumn: "event_time",
  });
  await replaceProjectRowsWithPreferredSource(connection, {
    table: "energy_interval_facts",
    columns: FACT_COLUMNS,
    projectId,
    timestampColumn: "interval_start",
    coverageColumn: "interval_end",
  });
};

const replaceProjectRowsWithPreferredSource = async (
  connection: DuckDbModule.Connection,
  input: {
    table: string;
    columns: readonly string[];
    projectId: string;
    timestampColumn: string;
    coverageColumn?: string;
  },
): Promise<void> => {
  const tempTable = `preferred_${input.table}`;
  const coverageColumn = input.coverageColumn ?? input.timestampColumn;
  await duckDbRun(connection, `
    CREATE OR REPLACE TEMP TABLE ${tempTable} AS
    WITH ranked_sources AS (
      SELECT *,
        MAX(${coverageColumn}) OVER (
          PARTITION BY project_id, meter_node_id, source_sha256
        ) AS source_coverage_end
      FROM ${input.table}
      WHERE project_id = ?
    ), ranked_rows AS (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY project_id, meter_node_id, ${input.timestampColumn}
        ORDER BY source_coverage_end DESC, source_file DESC, COALESCE(import_batch_id, '') DESC
      ) AS source_rank
      FROM ranked_sources
    )
    SELECT ${input.columns.join(", ")}
    FROM ranked_rows
    WHERE source_rank = 1
  `, [input.projectId]);
  await duckDbRun(connection, `DELETE FROM ${input.table} WHERE project_id = ?`, [input.projectId]);
  await duckDbRun(connection, `
    INSERT INTO ${input.table} (${input.columns.join(", ")})
    SELECT ${input.columns.join(", ")} FROM ${tempTable}
  `);
  await duckDbRun(connection, `DROP TABLE ${tempTable}`);
};

const RAW_COLUMNS = [
  "workspace_id", "project_id", "import_batch_id", "resource", "device_name", "meter_node_id", "scope_id",
  "event_time", "active_energy_kwh", "source_file", "source_sha256", "source_row_number",
  "is_valid", "validation_error", "is_overlap_conflict",
] as const;
const NORMALIZED_COLUMNS = [
  "workspace_id", "project_id", "import_batch_id", "resource", "meter_node_id", "scope_id", "level_node_id",
  "device_name", "category", "meter_role", "event_time", "active_energy_kwh", "source_file", "source_sha256", "source_row_number",
] as const;
const FACT_COLUMNS = [
  "workspace_id", "project_id", "import_batch_id", "resource", "meter_node_id", "scope_id", "parent_node_id", "level_node_id",
  "device_name", "appliance", "circuit_name", "category", "meter_role", "source_reading_kind",
  "interval_start", "interval_end", "elapsed_minutes", "active_energy_kwh", "previous_active_energy_kwh",
  "raw_delta_kwh", "usage_kwh", "average_kw", "quality_status", "local_date", "local_hour", "day_type",
  "is_operating", "source_file", "source_sha256",
] as const;
const QUALITY_COLUMNS = [
  "workspace_id", "project_id", "import_batch_id", "meter_node_id", "source_label", "event_time", "code", "severity", "details_json",
] as const;

const rawValues = (row: EnergyRawReadingWrite): unknown[] => [
  row.workspaceId, row.projectId, row.importBatchId, row.resource, row.sourceLabel,
  row.meterPointId ?? null, row.scopeId ?? null, row.eventTime ?? null,
  row.activeEnergyKwh ?? null, row.sourceFile, row.sourceSha256, row.sourceRowNumber,
  row.isValid, row.validationError ?? null, row.isOverlapConflict,
];
const normalizedValues = (row: EnergyNormalizedReadingWrite): unknown[] => [
  row.workspaceId, row.projectId, row.importBatchId, row.resource, row.meterPointId,
  row.scopeId, row.parentNodeId ?? null, row.sourceLabel, row.category, row.meterRole,
  row.eventTime, row.activeEnergyKwh, row.sourceFile, row.sourceSha256, row.sourceRowNumber,
];
const factValues = (row: EnergyIntervalFactWrite): unknown[] => [
  row.workspaceId, row.projectId, row.importBatchId, row.resource, row.meterPointId, row.scopeId,
  row.parentNodeId ?? null, row.parentNodeId ?? null, row.sourceLabel, row.category, row.sourceLabel,
  row.category, row.meterRole, "cumulative_energy", row.intervalStart, row.intervalEnd,
  row.elapsedMinutes, row.activeEnergyKwh, row.previousActiveEnergyKwh, row.rawDeltaKwh,
  row.usageKwh ?? null, row.averageKw ?? null, row.qualityStatus, row.localDate, row.localHour,
  row.dayType, row.isOperating ?? null, row.sourceFile, row.sourceSha256,
];
const qualityValues = (row: EnergyQualityEventWrite): unknown[] => [
  row.workspaceId, row.projectId, row.importBatchId, row.meterPointId ?? null,
  row.sourceLabel ?? null, row.eventTime ?? null, row.code, row.severity, JSON.stringify(row.details),
];

const insertRows = async (
  connection: DuckDbModule.Connection,
  table: string,
  columns: readonly string[],
  rows: unknown[][],
): Promise<void> => {
  const chunkSize = Math.max(1, Math.min(1_000, Math.floor(30_000 / columns.length)));
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    const placeholders = chunk.map(() => `(${columns.map(() => "?").join(",")})`).join(",");
    await duckDbRun(
      connection,
      `INSERT INTO ${table} (${columns.join(",")}) VALUES ${placeholders}`,
      chunk.flat(),
    );
  }
};

const duckDbRun = async (
  connection: DuckDbModule.Connection,
  sql: string,
  params: unknown[] = [],
): Promise<void> => await new Promise((resolvePromise, reject) => {
  connection.run(sql, ...params, (error) => error ? reject(error) : resolvePromise());
});

const duckDbClose = async (connection: DuckDbModule.Connection): Promise<void> =>
  await new Promise((resolvePromise, reject) => {
    connection.close((error) => error ? reject(error) : resolvePromise());
  });

const duckDbGet = async (
  connection: DuckDbModule.Connection,
  sql: string,
  params: unknown[] = [],
): Promise<Record<string, unknown>> => await new Promise((resolvePromise, reject) => {
  connection.all(sql, ...params, (error: DuckDbModule.DuckDbError | null, rows: DuckDbModule.TableData) => error
    ? reject(error)
    : resolvePromise((rows[0] ?? {}) as Record<string, unknown>));
});

const ignoreAlreadyClosed = (error: unknown): void => {
  if (error instanceof Error && error.message.includes("already closed")) return;
  throw error;
};
