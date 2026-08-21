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
  readEnergyFactProjectState,
} from "./energy-fact-writer.js";
import {
  assertEnergySnapshotReceipt,
  energySnapshotGuardSql,
  type EnergySnapshotGuardScope,
  type EnergySnapshotIdentityScope,
} from "./energy-snapshot-guard.js";

export type EnergyScopedDataSourceContext = {
  workspaceId: string;
  projectId: string;
  scopeId: string;
  /** Published Meter identities and their navigation attachment for this Scope. */
  meterAttachments: Array<{ meterPointId: string; scopeId: string; officialAggregation: boolean }>;
  /** Published, hierarchy-pinned business dimensions visible inside this authorized Scope. */
  scopeDimensions?: EnergyScopedScopeDimension[];
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

export type EnergyScopedScopeDimension = {
  scopeId: string;
  parentScopeId?: string;
  scopeName: string;
  scopeType: string;
  tierDefinitionId?: string;
  centreCode?: string;
  facilityType?: string;
  areaSqm?: number;
  occupantCount?: number;
  metadataStatus: "provisional" | "confirmed";
  hierarchyRevisionId: string;
};

export type EnergyScopedDataSource = {
  datasourceId: string;
  revision: number;
  viewName: string;
  metadataViewName?: string;
  databasePath: string;
};

export type EnergyPreparedScopedDataSource = Omit<EnergyScopedDataSource, "revision"> & {
  context: EnergyScopedDataSourceContext;
  expectedSnapshotScope: EnergySnapshotIdentityScope;
  sessionDatasourceId: string;
};

export type EnergyFactCoverage = {
  from: string;
  to: string;
  intervalCount: number;
};

export const resolveEnergyFactStorePath = (
  workspaceId: string,
  configuredPath = process.env.ENERGYIQ_DUCKDB_PATH,
  storageRoot = process.env.STORAGE_ROOT_DIR,
): string => resolve(
  configuredPath
    ?? storageRoot
    ?? dirname(fileURLToPath(import.meta.url)),
  ...(configuredPath
    ? []
    : storageRoot
      ? ["energy", workspaceId, "energy.duckdb"]
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
  const prepared = await prepareEnergyScopedDataSource(input);
  const factScope = await resolveValidatedSnapshotFactScope({
    metadataStore: input.metadataStore,
    workspaceId: input.context.workspaceId,
    projectId: input.context.projectId,
    dataSnapshotId: input.context.dataSnapshotId,
    databasePath: prepared.databasePath,
  });
  return registerPreparedEnergyScopedDataSource({
    metadataStore: input.metadataStore,
    userId: input.userId,
    prepared,
    factScope,
  });
};

export const prepareEnergyScopedDataSource = async (input: {
  metadataStore: MetadataStore;
  userId: string;
  context: EnergyScopedDataSourceContext;
  databasePath?: string;
}): Promise<EnergyPreparedScopedDataSource> => {
  const databasePath = normalizeEnergyFactStorePath(
    input.databasePath ?? resolveEnergyFactStorePath(input.context.workspaceId),
  );
  if (databasePath !== ":memory:" && !existsSync(databasePath)) {
    throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  }
  const expectedSnapshotScope = resolveSnapshotIdentityScope({
    metadataStore: input.metadataStore,
    workspaceId: input.context.workspaceId,
    projectId: input.context.projectId,
    dataSnapshotId: input.context.dataSnapshotId,
  });

  const canonicalContext = {
    ...input.context,
    meterAttachments: [...(input.context.meterAttachments ?? [])]
      .sort((left, right) => left.meterPointId.localeCompare(right.meterPointId)),
    ...(input.context.scopeDimensions === undefined
      ? {}
      : {
          scopeDimensions: [...input.context.scopeDimensions]
            .sort((left, right) => left.scopeId.localeCompare(right.scopeId)),
        }),
  };
  const signature = createHash("sha256")
    .update(JSON.stringify(canonicalContext))
    .digest("hex")
    .slice(0, 20);
  const viewName = `energy_scope_${signature}`;
  const metadataViewName = input.context.scopeDimensions === undefined
    ? undefined
    : `${viewName}_metadata`;
  const datasourceId = `energy-scope-${signature}`;
  const sessionSignature = createHash("sha256")
    .update(JSON.stringify({ databasePath, expectedSnapshotScope }))
    .digest("hex")
    .slice(0, 20);
  const sessionDatasourceId = `energy-snapshot-session-${sessionSignature}`;
  try {
    await createScopedViews(
      databasePath,
      viewName,
      metadataViewName,
      input.context,
      expectedSnapshotScope,
    );
  } catch {
    throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  }
  const sessionConfig = {
    path: databasePath,
    mode: "readonly",
    defaultEnabled: false,
    queryPolicy: { maxRows: 1, timeoutMs: 10000 },
    introspection: { tableAllowlist: [] },
    energyQueryScope: expectedSnapshotScope,
  };
  const existingSession = input.metadataStore.dataSources.find({
    user_id: input.userId,
    datasource_id: sessionDatasourceId,
  });
  if (existingSession?.config_json !== JSON.stringify(sessionConfig)) {
    input.metadataStore.dataSources.create({
      user_id: input.userId,
      id: sessionDatasourceId,
      name: `EnergyIQ snapshot session · ${input.context.projectId}`,
      type: "duckdb",
      config: sessionConfig,
      description: "Server-resolved bootstrap for one trusted EnergyIQ Snapshot read session.",
    });
  }

  return {
    datasourceId,
    viewName,
    ...(metadataViewName ? { metadataViewName } : {}),
    databasePath,
    context: input.context,
    expectedSnapshotScope,
    sessionDatasourceId,
  };
};

export const registerPreparedEnergyScopedDataSource = (input: {
  metadataStore: MetadataStore;
  userId: string;
  prepared: EnergyPreparedScopedDataSource;
  factScope: EnergySnapshotGuardScope;
}): EnergyScopedDataSource => {
  assertEnergySnapshotReceipt(input.prepared.expectedSnapshotScope, input.factScope);
  const { context, databasePath, datasourceId, viewName, metadataViewName } = input.prepared;

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
      tableAllowlist: [viewName, ...(metadataViewName ? [metadataViewName] : [])]
    },
    energyQueryScope: {
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      scopeId: context.scopeId,
      resource: context.resource,
      from: context.from,
      to: context.to,
      endExclusive: true,
      hierarchyRevisionId: context.hierarchyRevisionId,
      meterMappingRevisionId: context.meterMappingRevisionId,
      meterFormulaRevisionId: context.meterFormulaRevisionId,
      dataSnapshotId: context.dataSnapshotId,
      manifestFingerprint: input.factScope.manifestFingerprint,
      sourceSha256: input.factScope.sourceSha256,
      factWriterContractVersion: input.factScope.factWriterContractVersion,
      canonicalIntervalCount: input.factScope.canonicalIntervalCount,
      canonicalIntervalDigest: input.factScope.canonicalIntervalDigest,
      metricVersion: context.metricVersion
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
        name: `EnergyIQ trusted scope · ${context.projectId}`,
        type: "duckdb",
        config,
        description: "Server-resolved EnergyIQ project, hierarchy, resource, and time scope."
      });

  return {
    datasourceId,
    revision: record.revision,
    viewName,
    ...(metadataViewName ? { metadataViewName } : {}),
    databasePath
  };
};

const createScopedViews = async (
  databasePath: string,
  viewName: string,
  metadataViewName: string | undefined,
  context: EnergyScopedDataSourceContext,
  factScope: Pick<EnergySnapshotIdentityScope, "sourceSha256">,
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
        elapsed_minutes,
        active_energy_kwh,
        previous_active_energy_kwh,
        raw_delta_kwh,
        usage_kwh,
        average_kw,
        quality_status,
        source_file,
        source_sha256
      FROM energy_interval_facts
      WHERE workspace_id = ${sqlLiteral(context.workspaceId)}
        AND project_id = ${sqlLiteral(context.projectId)}
        AND resource = ${sqlLiteral(context.resource)}
        AND lower(source_sha256) IN (${factScope.sourceSha256.map(sqlLiteral).join(", ")})
        AND interval_start >= CAST(${sqlLiteral(context.from)} AS TIMESTAMPTZ)
        AND interval_start < CAST(${sqlLiteral(context.to)} AS TIMESTAMPTZ)
        AND ${nodeFilter}
    `);
    if (metadataViewName) {
      await duckDbRun(connection, scopeDimensionsViewSql(
        metadataViewName,
        context.scopeDimensions ?? [],
      ));
    }
  } finally {
    await duckDbClose(connection).catch(ignoreAlreadyClosed);
  }
};

const scopeDimensionsViewSql = (
  viewName: string,
  dimensions: EnergyScopedScopeDimension[],
): string => {
  const columns = [
    "scope_id",
    "parent_scope_id",
    "scope_name",
    "scope_type",
    "tier_definition_id",
    "centre_code",
    "facility_type",
    "area_sqm",
    "occupant_count",
    "metadata_status",
    "hierarchy_revision_id",
  ];
  const rows = dimensions.map((dimension) => `(
    ${sqlLiteral(dimension.scopeId)},
    ${sqlNullableLiteral(dimension.parentScopeId)},
    ${sqlLiteral(dimension.scopeName)},
    ${sqlLiteral(dimension.scopeType)},
    ${sqlNullableLiteral(dimension.tierDefinitionId)},
    ${sqlNullableLiteral(dimension.centreCode)},
    ${sqlNullableLiteral(dimension.facilityType)},
    ${sqlNullableNumber(dimension.areaSqm)},
    ${sqlNullableNumber(dimension.occupantCount)},
    ${sqlLiteral(dimension.metadataStatus)},
    ${sqlLiteral(dimension.hierarchyRevisionId)}
  )`).join(",\n");
  const values = rows || "(NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)";
  return `
    CREATE OR REPLACE VIEW ${quoteIdentifier(viewName)} AS
    SELECT
      CAST(scope_id AS VARCHAR) AS scope_id,
      CAST(parent_scope_id AS VARCHAR) AS parent_scope_id,
      CAST(scope_name AS VARCHAR) AS scope_name,
      CAST(scope_type AS VARCHAR) AS scope_type,
      CAST(tier_definition_id AS VARCHAR) AS tier_definition_id,
      CAST(centre_code AS VARCHAR) AS centre_code,
      CAST(facility_type AS VARCHAR) AS facility_type,
      CAST(area_sqm AS DOUBLE) AS area_sqm,
      CAST(occupant_count AS DOUBLE) AS occupant_count,
      CAST(metadata_status AS VARCHAR) AS metadata_status,
      CAST(hierarchy_revision_id AS VARCHAR) AS hierarchy_revision_id
    FROM (VALUES ${values}) AS dimensions(${columns.join(", ")})
    ${rows ? "" : "WHERE FALSE"}
  `;
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
  if (databasePath !== ":memory:" && !existsSync(databasePath)) {
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
  const expected = resolveSnapshotIdentityScope(input);
  const state = await readEnergyFactProjectState({ databasePath: input.databasePath, projectId: input.projectId });
  if (!state) throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  assertEnergySnapshotReceipt(expected, state);
  return state;
};

const resolveSnapshotIdentityScope = (input: {
  metadataStore: MetadataStore;
  workspaceId: string;
  projectId: string;
  dataSnapshotId: string;
}): EnergySnapshotIdentityScope => {
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
  return {
    ...factScope,
    factWriterContractVersion: factScope.factWriterContractVersion,
  };
};

const normalizeEnergyFactStorePath = (databasePath: string): string =>
  databasePath === ":memory:" ? databasePath : resolve(databasePath);

const snapshotGuardSql = (scope: EnergySnapshotGuardScope): string => energySnapshotGuardSql(scope);

const sqlLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const sqlNullableLiteral = (value: string | undefined): string =>
  value === undefined ? "NULL" : sqlLiteral(value);
const sqlNullableNumber = (value: number | undefined): string =>
  value === undefined ? "NULL" : String(value);
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
