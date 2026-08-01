import type { MetadataStore } from "@datafoundry/metadata";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type * as DuckDbModule from "duckdb";
import { getDuckDbDatabase } from "./duckdb-database-cache.js";

export type EnergyScopedDataSourceContext = {
  workspaceId: string;
  projectId: string;
  scopeId: string;
  scopeNodeIds: string[];
  resource: "electricity" | "water";
  from: string;
  to: string;
  timezone: string;
  hierarchyRevisionId: string;
  meterFormulaRevisionId: string;
  dataSnapshotId: string;
  metricVersion: string;
};

export type EnergyScopedDataSource = {
  datasourceId: string;
  revision: number;
  viewName: string;
  databasePath: string;
};

export const resolveEnergyFactStorePath = (
  workspaceId: string,
  configuredPath = process.env.ENERGYIQ_DUCKDB_PATH,
): string => resolve(
  configuredPath
    ?? dirname(fileURLToPath(import.meta.url)),
  ...(configuredPath
    ? []
    : ["../../..", "storage", "energy", workspaceId, "energy.duckdb"]),
);

/**
 * Materialize a run-safe, read-only EnergyIQ view and register only that view
 * with Data Gateway.  The table allowlist is the actual security boundary:
 * model-generated SQL cannot reach the workspace base tables.
 */
export const ensureEnergyScopedDataSource = async (input: {
  metadataStore: MetadataStore;
  userId: string;
  context: EnergyScopedDataSourceContext;
  databasePath?: string;
}): Promise<EnergyScopedDataSource> => {
  const databasePath = input.databasePath
    ? resolve(input.databasePath)
    : resolveEnergyFactStorePath(input.context.workspaceId);
  if (!existsSync(databasePath)) {
    throw new Error(`ENERGYIQ_FACT_STORE_NOT_FOUND:${databasePath}`);
  }

  const signature = createHash("sha256")
    .update(JSON.stringify({
      ...input.context,
      scopeNodeIds: [...new Set(input.context.scopeNodeIds)].sort()
    }))
    .digest("hex")
    .slice(0, 20);
  const viewName = `energy_scope_${signature}`;
  const datasourceId = `energy-scope-${signature}`;
  await createScopedView(databasePath, viewName, input.context);

  const config = {
    path: databasePath,
    mode: "readonly",
    defaultEnabled: false,
    queryPolicy: {
      maxRows: 1000,
      timeoutMs: 10000
    },
    samplePolicy: {
      allowSample: true,
      maxSampleRows: 100
    },
    introspection: {
      tableAllowlist: [viewName]
    },
    energyQueryScope: {
      workspaceId: input.context.workspaceId,
      projectId: input.context.projectId,
      scopeId: input.context.scopeId,
      resource: input.context.resource,
      from: input.context.from,
      to: input.context.to,
      endExclusive: true,
      hierarchyRevisionId: input.context.hierarchyRevisionId,
      meterFormulaRevisionId: input.context.meterFormulaRevisionId,
      dataSnapshotId: input.context.dataSnapshotId,
      metricVersion: input.context.metricVersion
    }
  };
  const existing = input.metadataStore.dataSources.find({
    user_id: input.userId,
    datasource_id: datasourceId
  });
  const record = existing?.config_json === JSON.stringify(config)
    ? existing
    : input.metadataStore.dataSources.create({
        user_id: input.userId,
        id: datasourceId,
        name: `EnergyIQ trusted scope · ${input.context.projectId}`,
        type: "duckdb",
        config,
        description: "Server-resolved EnergyIQ project, hierarchy, resource, and time scope."
      });

  return {
    datasourceId,
    revision: record.revision,
    viewName,
    databasePath
  };
};

const createScopedView = async (
  databasePath: string,
  viewName: string,
  context: EnergyScopedDataSourceContext
): Promise<void> => {
  const meterNodeIds = [...new Set(context.scopeNodeIds)];
  const nodeFilter = meterNodeIds.length > 0
    ? `scope_id IN (${meterNodeIds.map(sqlLiteral).join(", ")})`
    : "FALSE";
  const database = await getDuckDbDatabase(databasePath);
  const connection = database.connect();
  try {
    await duckDbRun(connection, "ALTER TABLE energy_interval_facts ADD COLUMN IF NOT EXISTS scope_id VARCHAR");
    await duckDbRun(connection, "ALTER TABLE energy_interval_facts ADD COLUMN IF NOT EXISTS import_batch_id VARCHAR");
    await duckDbRun(connection, "UPDATE energy_interval_facts SET scope_id = meter_node_id WHERE scope_id IS NULL");
    await duckDbRun(connection, `
      UPDATE energy_interval_facts
      SET scope_id = level_node_id
      WHERE import_batch_id IS NULL
        AND meter_role = 'total'
        AND meter_node_id NOT LIKE 'mapping-%'
        AND level_node_id IS NOT NULL
    `);
    await duckDbRun(connection, `
      CREATE OR REPLACE VIEW ${quoteIdentifier(viewName)} AS
      SELECT
        project_id,
        resource,
        meter_node_id,
        scope_id,
        parent_node_id,
        level_node_id,
        device_name,
        appliance,
        circuit_name,
        category,
        meter_role,
        source_reading_kind,
        timezone(${sqlLiteral(context.timezone)}, interval_start) AS local_interval_start,
        timezone(${sqlLiteral(context.timezone)}, interval_end) AS local_interval_end,
        local_date,
        local_hour,
        day_type,
        is_operating,
        elapsed_minutes,
        usage_kwh,
        average_kw,
        quality_status
      FROM energy_interval_facts
      WHERE workspace_id = ${sqlLiteral(context.workspaceId)}
        AND project_id = ${sqlLiteral(context.projectId)}
        AND resource = ${sqlLiteral(context.resource)}
        AND interval_start >= CAST(${sqlLiteral(context.from)} AS TIMESTAMPTZ)
        AND interval_start < CAST(${sqlLiteral(context.to)} AS TIMESTAMPTZ)
        AND ${nodeFilter}
    `);
  } finally {
    await duckDbClose(connection).catch(ignoreAlreadyClosed);
  }
};

const sqlLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`;

const duckDbRun = async (
  connection: DuckDbModule.Connection,
  sql: string
): Promise<void> =>
  await new Promise((resolvePromise, reject) => {
    connection.run(sql, (error) => error ? reject(error) : resolvePromise());
  });

const duckDbClose = async (connection: DuckDbModule.Connection): Promise<void> =>
  await new Promise((resolvePromise, reject) => {
    connection.close((error) => error ? reject(error) : resolvePromise());
  });

const ignoreAlreadyClosed = (error: unknown): void => {
  if (error instanceof Error && error.message.includes("already closed")) {
    return;
  }
  throw error;
};
