import type {
  AdapterExecutionInput,
  AdapterPreviewInput,
  AdapterSqlInput,
  DataSourceAdapter,
  SchemaSummary,
  TableResult
} from "../types.js";
import { DatabaseSync } from "node:sqlite";
import type * as DuckDbModule from "duckdb";
import { getDuckDbDatabase } from "../duckdb-database-cache.js";

export class SQLiteAdapter implements DataSourceAdapter {
  constructor(private readonly config: Record<string, unknown>) {}

  async inspectSchema(input: AdapterExecutionInput = {}): Promise<Omit<SchemaSummary, "datasource_id">> {
    throwIfAborted(input.signal);
    const database = this.open();

    try {
      const tables = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC")
        .all()
        .map((row) => requiredRecordString(row, "name"));

      return {
        tables: tables.map((table) => ({
          name: table,
          columns: database
            .prepare(`PRAGMA table_info(${quoteIdentifier(table)})`)
            .all()
            .map((row) => ({
              name: requiredRecordString(row, "name"),
              type: requiredRecordString(row, "type") || "TEXT",
              nullable: requiredRecordNumber(row, "notnull") === 0
            }))
        }))
      };
    } finally {
      database.close();
    }
  }

  async previewTable(input: AdapterPreviewInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    const database = this.open();

    try {
      const rows = database.prepare(`SELECT * FROM ${quoteIdentifier(input.table)} LIMIT ?`).all(input.limit);
      return rowsToTableResult(rows);
    } finally {
      database.close();
    }
  }

  async runSqlReadonly(input: AdapterSqlInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    // node:sqlite DatabaseSync is synchronous; cancellation is cooperative before
    // statement execution. Hard cancel would require worker-thread isolation.
    const database = this.open();

    try {
      const rows = database.prepare(applyStandardLimit(input.sql, input.limit)).all();
      return rowsToTableResult(rows);
    } finally {
      database.close();
    }
  }

  private open(): DatabaseSync {
    const path = stringConfig(this.config, "path");
    return new DatabaseSync(path);
  }
}

export class DuckDbAdapter implements DataSourceAdapter {
  constructor(private readonly config: Record<string, unknown>) {}

  async inspectSchema(input: AdapterExecutionInput = {}): Promise<Omit<SchemaSummary, "datasource_id">> {
    throwIfAborted(input.signal);
    const rows = await this.query(`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'main'
      ORDER BY table_name, ordinal_position
    `, input.signal);
    return schemaRowsToSummary(rows, "table_name", "column_name", "data_type", "is_nullable");
  }

  async previewTable(input: AdapterPreviewInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    return rowsToTableResult(await this.query(
      `SELECT * FROM ${quoteIdentifier(input.table)} LIMIT ${input.limit}`,
      input.signal
    ));
  }

  async runSqlReadonly(input: AdapterSqlInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    return rowsToTableResult(await this.query(applyStandardLimit(input.sql, input.limit), input.signal));
  }

  private async query(sql: string, signal?: AbortSignal | undefined): Promise<Record<string, unknown>[]> {
    const database = await getDuckDbDatabase(stringConfig(this.config, "path"));
    const connection = database.connect();
    const snapshotScope = energySnapshotScope(this.config.energyQueryScope);
    try {
      if (snapshotScope) {
        await duckDbAll(connection, "BEGIN TRANSACTION", signal);
        await assertEnergySnapshotState(connection, snapshotScope, signal);
      }
      const rows = await duckDbAll(connection, sql, signal);
      return rows.filter(isRecord);
    } finally {
      if (snapshotScope) await duckDbAll(connection, "ROLLBACK").catch(() => undefined);
      await duckDbClose(connection).catch(ignoreAlreadyClosed);
    }
  }
}

type EnergySnapshotScope = {
  workspaceId: string;
  projectId: string;
  dataSnapshotId: string;
  manifestFingerprint: string;
  sourceSha256: string[];
  factWriterContractVersion: string;
};

const energySnapshotScope = (value: unknown): EnergySnapshotScope | undefined => {
  if (!isRecord(value)) return undefined;
  const sourceSha256 = value.sourceSha256;
  if (typeof value.workspaceId !== "string"
    || typeof value.projectId !== "string"
    || typeof value.dataSnapshotId !== "string"
    || typeof value.manifestFingerprint !== "string"
    || typeof value.factWriterContractVersion !== "string"
    || !Array.isArray(sourceSha256)
    || !sourceSha256.every((source) => typeof source === "string")) {
    throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  }
  return {
    workspaceId: value.workspaceId,
    projectId: value.projectId,
    dataSnapshotId: value.dataSnapshotId,
    manifestFingerprint: value.manifestFingerprint,
    sourceSha256,
    factWriterContractVersion: value.factWriterContractVersion,
  };
};

const assertEnergySnapshotState = async (
  connection: DuckDbModule.Connection,
  scope: EnergySnapshotScope,
  signal?: AbortSignal,
): Promise<void> => {
  await duckDbAll(connection, `
    SELECT CASE
      WHEN COUNT(*) = 0 THEN error('ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE')
      WHEN bool_or(data_snapshot_id <> ${sqlLiteral(scope.dataSnapshotId)})
        THEN error('ENERGYIQ_SNAPSHOT_STALE')
      WHEN bool_and(
        workspace_id = ${sqlLiteral(scope.workspaceId)}
        AND manifest_fingerprint = ${sqlLiteral(scope.manifestFingerprint)}
        AND source_sha256_json = ${sqlLiteral(JSON.stringify(scope.sourceSha256))}
        AND fact_writer_contract_version = ${sqlLiteral(scope.factWriterContractVersion)}
      ) THEN TRUE
      ELSE error('ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE')
    END AS snapshot_valid
    FROM energy_project_fact_state
    WHERE project_id = ${sqlLiteral(scope.projectId)}
  `, signal);
};

const sqlLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`;

const duckDbAll = async (
  connection: DuckDbModule.Connection,
  sql: string,
  signal?: AbortSignal | undefined
): Promise<DuckDbModule.TableData> =>
  await new Promise((resolve, reject) => {
    const abort = (): void => {
      reject(signal?.reason instanceof Error ? signal.reason : new Error("RUN_CANCELLED"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    connection.all(sql, (error, rows) => {
      signal?.removeEventListener("abort", abort);
      if (error) {
        reject(error);
      } else {
        resolve(rows);
      }
    });
  });

const duckDbClose = async (connection: DuckDbModule.Connection): Promise<void> =>
  await new Promise((resolve, reject) => {
    connection.close((error) => error ? reject(error) : resolve());
  });

const ignoreAlreadyClosed = (error: unknown): void => {
  if (error instanceof Error && error.message.includes("already closed")) {
    return;
  }
  throw error;
};

const applyStandardLimit = (sql: string, limit: number): string => {
  if (/\bLIMIT\s+\d+\b/iu.test(sql)) {
    return sql;
  }

  return `SELECT * FROM (${sql}) AS readonly_query LIMIT ${limit}`;
};

const rowsToTableResult = (rows: unknown[]): TableResult => {
  const objectRows = rows.filter(isRecord);
  const columns = Array.from(new Set(objectRows.flatMap((row) => Object.keys(row))));

  return objectRowsToTableResult(objectRows, columns);
};

const objectRowsToTableResult = (rows: Record<string, unknown>[], columns: string[]): TableResult => ({
  columns,
  rows: rows.map((row) => columns.map((column) => row[column] ?? null)),
  row_count: rows.length
});

const schemaRowsToSummary = (
  rows: Record<string, unknown>[],
  tableKey: string,
  columnKey: string,
  typeKey: string,
  nullableKey: string
): Omit<SchemaSummary, "datasource_id"> => {
  const tables = new Map<string, SchemaSummary["tables"][number]>();
  rows.forEach((row) => {
    const tableName = requiredRecordStringLoose(row, tableKey);
    const table = tables.get(tableName) ?? { name: tableName, columns: [] };
    table.columns.push({
      name: requiredRecordStringLoose(row, columnKey),
      type: requiredRecordStringLoose(row, typeKey),
      nullable: requiredRecordStringLoose(row, nullableKey).toUpperCase() === "YES"
    });
    tables.set(tableName, table);
  });
  return { tables: [...tables.values()] };
};

const stringConfig = (config: Record<string, unknown>, key: string, defaultValue?: string): string => {
  const value = config[key];

  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (defaultValue !== undefined) {
    return defaultValue;
  }

  throw new Error(`Missing config value: ${key}`);
};

const quoteIdentifier = (identifier: string): string => `"${identifier.replaceAll('"', '""')}"`;

const requiredRecordString = (row: unknown, key: string): string => {
  if (!isRecord(row) || typeof row[key] !== "string") {
    throw new Error(`Expected string column: ${key}`);
  }

  return row[key];
};

const requiredRecordStringLoose = (row: unknown, key: string): string => {
  if (!isRecord(row)) {
    throw new Error(`Expected string column: ${key}`);
  }
  const value = row[key] ?? row[key.toUpperCase()] ?? row[key.toLowerCase()];
  if (typeof value !== "string") {
    throw new Error(`Expected string column: ${key}`);
  }
  return value;
};

const requiredRecordNumber = (row: unknown, key: string): number => {
  if (!isRecord(row) || typeof row[key] !== "number") {
    throw new Error(`Expected number column: ${key}`);
  }

  return row[key];
};

const throwIfAborted = (signal?: AbortSignal | undefined): void => {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("RUN_CANCELLED");
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
