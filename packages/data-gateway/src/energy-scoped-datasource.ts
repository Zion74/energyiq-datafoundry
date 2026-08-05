import {
  resolveEnergyIqSnapshotFactScope,
  type MetadataStore,
} from "@datafoundry/metadata";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type * as DuckDbModule from "duckdb";
import { getDuckDbDatabase } from "./duckdb-database-cache.js";
import {
  ENERGY_FACT_WRITER_CONTRACT_VERSION,
  readEnergyFactProjectState,
} from "./energy-fact-writer.js";
import {
  energySnapshotGuardSql,
  type EnergySnapshotGuardScope,
} from "./energy-snapshot-guard.js";

export type EnergyScopedDataSourceContext = {
  workspaceId: string;
  projectId: string;
  scopeId: string;
  /** Published Meter identities and their navigation attachment for this Scope. */
  meterAttachments: Array<{ meterPointId: string; scopeId: string; officialAggregation: boolean }>;
  resource: "electricity" | "water";
  from: string;
  to: string;
  timezone: string;
  hierarchyRevisionId: string;
  meterMappingRevisionId: string;
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

export type EnergyFactCoverage = {
  from: string;
  to: string;
  intervalCount: number;
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

export const readEnergyFactCoverage = async (input: {
  metadataStore: MetadataStore;
  workspaceId: string;
  projectId: string;
  dataSnapshotId: string;
  resource: "electricity" | "water";
  databasePath?: string;
}): Promise<EnergyFactCoverage | null> => {
  const databasePath = input.databasePath
    ? input.databasePath === ":memory:" ? input.databasePath : resolve(input.databasePath)
    : resolveEnergyFactStorePath(input.workspaceId);
  if (databasePath !== ":memory:" && !existsSync(databasePath)) {
    throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  }
  const factScope = await resolveValidatedSnapshotFactScope({
    metadataStore: input.metadataStore,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    dataSnapshotId: input.dataSnapshotId,
    databasePath,
  });

  const database = await getDuckDbDatabase(databasePath);
  const connection = database.connect();
  try {
    const row = await duckDbGet(connection, `
      WITH snapshot_guard AS MATERIALIZED (
        SELECT ${snapshotGuardSql(factScope)} AS snapshot_valid
      )
      SELECT
        epoch_ms(MIN(interval_start)) AS from_ms,
        epoch_ms(MAX(interval_end)) AS to_ms,
        COUNT(*) AS interval_count
      FROM snapshot_guard
      CROSS JOIN energy_interval_facts
      WHERE snapshot_guard.snapshot_valid
        AND workspace_id = ${sqlLiteral(input.workspaceId)}
        AND project_id = ${sqlLiteral(input.projectId)}
        AND resource = ${sqlLiteral(input.resource)}
        AND lower(source_sha256) IN (${factScope.sourceSha256.map(sqlLiteral).join(", ")})
    `);
    const fromMs = numericValue(row.from_ms);
    const toMs = numericValue(row.to_ms);
    if (fromMs === null || toMs === null) return null;
    return {
      from: new Date(fromMs).toISOString(),
      to: new Date(toMs).toISOString(),
      intervalCount: numericValue(row.interval_count) ?? 0,
    };
  } finally {
    await duckDbClose(connection).catch(ignoreAlreadyClosed);
  }
};

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
    throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  }
  const factScope = await resolveValidatedSnapshotFactScope({
    metadataStore: input.metadataStore,
    workspaceId: input.context.workspaceId,
    projectId: input.context.projectId,
    dataSnapshotId: input.context.dataSnapshotId,
    databasePath,
  });

  const signature = createHash("sha256")
    .update(JSON.stringify({
      ...input.context,
      meterAttachments: [...(input.context.meterAttachments ?? [])]
        .sort((left, right) => left.meterPointId.localeCompare(right.meterPointId)),
    }))
    .digest("hex")
    .slice(0, 20);
  const viewName = `energy_scope_${signature}`;
  const datasourceId = `energy-scope-${signature}`;
  await createScopedView(databasePath, viewName, input.context, factScope);

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
      meterMappingRevisionId: input.context.meterMappingRevisionId,
      meterFormulaRevisionId: input.context.meterFormulaRevisionId,
      dataSnapshotId: input.context.dataSnapshotId,
      manifestFingerprint: factScope.manifestFingerprint,
      sourceSha256: factScope.sourceSha256,
      factWriterContractVersion: ENERGY_FACT_WRITER_CONTRACT_VERSION,
      canonicalIntervalCount: factScope.canonicalIntervalCount,
      canonicalIntervalDigest: factScope.canonicalIntervalDigest,
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
  context: EnergyScopedDataSourceContext,
  factScope: EnergySnapshotGuardScope,
): Promise<void> => {
  const attachments = [...new Map((context.meterAttachments ?? []).map((attachment) => [
    attachment.meterPointId,
    attachment
  ])).values()];
  const meterPointIds = attachments.map((attachment) => attachment.meterPointId);
  const nodeFilter = meterPointIds.length > 0
    ? `meter_node_id IN (${meterPointIds.map(sqlLiteral).join(", ")})`
    : "FALSE";
  const navigationScope = attachments.length > 0
    ? `CASE meter_node_id ${attachments.map((attachment) =>
        `WHEN ${sqlLiteral(attachment.meterPointId)} THEN ${sqlLiteral(attachment.scopeId)}`).join(" ")} ELSE scope_id END`
    : "scope_id";
  const officialAggregation = attachments.length > 0
    ? `CASE meter_node_id ${attachments.map((attachment) =>
        `WHEN ${sqlLiteral(attachment.meterPointId)} THEN ${attachment.officialAggregation ? "TRUE" : "FALSE"}`).join(" ")} ELSE FALSE END`
    : "FALSE";
  const database = await getDuckDbDatabase(databasePath);
  const connection = database.connect();
  try {
    await duckDbRun(connection, `
      CREATE OR REPLACE VIEW ${quoteIdentifier(viewName)} AS
      SELECT
        project_id,
        resource,
        meter_node_id,
        ${navigationScope} AS scope_id,
        ${officialAggregation} AS official_aggregation_eligible,
        parent_node_id,
        level_node_id,
        device_name,
        appliance,
        circuit_name,
        category,
        meter_role,
        source_reading_kind,
        interval_start,
        interval_end,
        import_batch_id,
        timezone(${sqlLiteral(context.timezone)}, interval_start) AS local_interval_start,
        timezone(${sqlLiteral(context.timezone)}, interval_end) AS local_interval_end,
        local_date,
        local_hour,
        day_type,
        is_operating,
        elapsed_minutes,
        active_energy_kwh,
        previous_active_energy_kwh,
        raw_delta_kwh,
        usage_kwh,
        average_kw,
        quality_status
      FROM energy_interval_facts
      WHERE workspace_id = ${sqlLiteral(context.workspaceId)}
        AND project_id = ${sqlLiteral(context.projectId)}
        AND resource = ${sqlLiteral(context.resource)}
        AND lower(source_sha256) IN (${factScope.sourceSha256.map(sqlLiteral).join(", ")})
        AND interval_start >= CAST(${sqlLiteral(context.from)} AS TIMESTAMPTZ)
        AND interval_start < CAST(${sqlLiteral(context.to)} AS TIMESTAMPTZ)
        AND ${nodeFilter}
    `);
  } finally {
    await duckDbClose(connection).catch(ignoreAlreadyClosed);
  }
};

export const assertEnergyCurrentSnapshotFacts = async (input: {
  metadataStore: MetadataStore;
  workspaceId: string;
  projectId: string;
  dataSnapshotId: string;
  databasePath?: string;
}): Promise<void> => {
  const databasePath = input.databasePath === ":memory:"
    ? input.databasePath
    : input.databasePath
      ? resolve(input.databasePath)
      : resolveEnergyFactStorePath(input.workspaceId);
  if (!existsSync(databasePath)) {
    throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  }
  await resolveValidatedSnapshotFactScope({
    metadataStore: input.metadataStore,
    databasePath,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    dataSnapshotId: input.dataSnapshotId,
  });
};

const resolveValidatedSnapshotFactScope = async (input: {
  metadataStore: MetadataStore;
  workspaceId: string;
  projectId: string;
  dataSnapshotId: string;
  databasePath: string;
}): Promise<EnergySnapshotGuardScope> => {
  const project = input.metadataStore.energyIq.getProject(input.projectId);
  if (project.workspace_id !== input.workspaceId || project.data_snapshot_id !== input.dataSnapshotId) {
    throw new Error(`ENERGYIQ_SNAPSHOT_STALE:${project.data_snapshot_id}`);
  }
  let snapshot;
  try {
    snapshot = input.metadataStore.energyIq.getDataSnapshot(input.dataSnapshotId);
  } catch {
    throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  }
  if (snapshot.workspace_id !== input.workspaceId || snapshot.project_id !== input.projectId) {
    throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  }
  let factScope: ReturnType<typeof resolveEnergyIqSnapshotFactScope>;
  try {
    factScope = resolveEnergyIqSnapshotFactScope(snapshot);
  } catch {
    throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  }
  const state = await readEnergyFactProjectState({ databasePath: input.databasePath, projectId: input.projectId });
  if (!state) throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  if (state.dataSnapshotId !== input.dataSnapshotId) {
    throw new Error(`ENERGYIQ_SNAPSHOT_STALE:${state.dataSnapshotId}`);
  }
  if (state.workspaceId !== factScope.workspaceId
    || state.projectId !== factScope.projectId
    || state.manifestFingerprint !== factScope.manifestFingerprint
    || state.factWriterContractVersion !== ENERGY_FACT_WRITER_CONTRACT_VERSION
    || JSON.stringify(state.sourceSha256) !== JSON.stringify(factScope.sourceSha256)) {
    throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  }
  return {
    ...factScope,
    factWriterContractVersion: ENERGY_FACT_WRITER_CONTRACT_VERSION,
    canonicalIntervalCount: state.canonicalIntervalCount,
    canonicalIntervalDigest: state.canonicalIntervalDigest,
  };
};

const snapshotGuardSql = (scope: EnergySnapshotGuardScope): string => energySnapshotGuardSql(scope);

const sqlLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`;

const duckDbRun = async (
  connection: DuckDbModule.Connection,
  sql: string
): Promise<void> =>
  await new Promise((resolvePromise, reject) => {
    connection.run(sql, (error) => error ? reject(error) : resolvePromise());
  });

const duckDbGet = async (
  connection: DuckDbModule.Connection,
  sql: string,
): Promise<Record<string, unknown>> => await new Promise((resolvePromise, reject) => {
  connection.all(sql, (error, rows) => error
    ? reject(error)
    : resolvePromise((rows[0] ?? {}) as Record<string, unknown>));
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

const numericValue = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
};
