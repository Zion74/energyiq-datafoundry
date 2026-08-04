import {
  ensureEnergyScopedDataSource,
  readEnergyFactCoverage,
  type LocalDataGateway
} from "@datafoundry/data-gateway";
import type {
  EnergyIqAnalysisInterval,
  EnergyIqOperatingEvaluation,
  EnergyIqPolicyUnavailableReason,
  EnergyIqProjectSetupDocument,
  EnergyIqRuleRevisionRecord,
  EnergyIqTariffEvaluation,
  MetadataStore
} from "@datafoundry/metadata";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveEnergyPublishedMeterRoute,
  resolveEnergyPublishedHierarchyNodes,
  type EnergyQueryContext
} from "./energy-query-context.js";

export type EnergyScopeAnalysis = {
  context: EnergyQueryContext;
  summary: {
    usageKwh: number;
    averageDailyUsageKwh: number;
    peakKw: number;
    peakAt?: string;
    nonOperatingKwh?: number;
    nonOperatingSharePct?: number;
    areaSqm?: number;
    occupantCount?: number;
    kwhPerSqm?: number;
    kwhPerPerson?: number;
    validIntervalCount: number;
    qualityEventCount: number;
  };
  hourlyProfile: Array<{
    hour: number;
    usageKwh: number;
    averageKw: number;
    peakKw: number;
    observationCount: number;
  }>;
  comparison: {
    from: string;
    to: string;
    usageKwh: number;
    changeKwh: number;
    changePct: number | null;
  };
  categories: Array<{
    category: string;
    usageKwh: number;
    sharePct: number;
  }>;
  childScopes: Array<{
    nodeId: string;
    name: string;
    nodeType: string;
    usageKwh: number;
    sharePct: number;
    comparison: {
      usageKwh: number;
      changeKwh: number;
      changePct: number | null;
    };
    dataHealth: {
      coveragePct: number;
      expectedMeterIntervalCount: number;
      validIntervalCount: number;
      qualityEventCount: number;
    };
    areaSqm?: number;
    occupantCount?: number;
    kwhPerSqm?: number;
    kwhPerPerson?: number;
    topCircuitName?: string;
    topCircuitUsageKwh?: number;
  }>;
  circuits: Array<{
    meterNodeId: string;
    name: string;
    appliance: string;
    category: string;
    meterRole: string;
    usageKwh: number;
    sharePct: number;
    nonOperatingKwh?: number;
    peakKw: number;
    qualityEventCount: number;
  }>;
  topCircuits: EnergyScopeAnalysis["circuits"];
  virtualMeters: Array<{
    meterNodeId: string;
    name: string;
    scopeId: string;
    termMeterNodeIds: string[];
    usageKwh: number;
    includedInOfficialTotal: false;
  }>;
  offHours: {
    status: "available";
    operatingKwh: number;
    standbyKwh: number;
    usageKwh: number;
    sharePct: number;
    timezone: string;
    businessCalendarVersion: string;
  } | {
    status: "unavailable";
    reason: EnergyIqPolicyUnavailableReason;
    businessCalendarVersion?: string;
  };
  cost: {
    status: "available";
    amount: number;
    currency: string;
    tariffScheduleVersion: string;
    allocations: Array<{
      from: string;
      to: string;
      ratePerKwh: number;
      usageKwh: number;
      cost: number;
    }>;
  } | {
    status: "unavailable";
    reason: EnergyIqPolicyUnavailableReason;
    tariffScheduleVersion?: string;
  };
  dataHealth: {
    status: "complete" | "partial" | "unavailable";
    coveragePct: number;
    expectedMeterIntervalCount: number;
    validIntervalCount: number;
    qualityEventCount: number;
    cumulativeDeltaMismatchCount: number;
    averageKwMismatchCount: number;
    invalidIntervalDurationCount: number;
    lastSeenAt?: string;
    importBatchIds: string[];
  };
  units: {
    usage: "kWh";
    demand: "kW";
    intervalMinutes: number;
    timezone: string;
  };
  attention: Array<{
    code: string;
    severity: "info" | "warning";
    title: string;
    evidence: string;
    suggestedAction: string;
  }>;
  provenance: {
    dataSnapshotId: string;
    hierarchyRevisionId: string;
    meterMappingRevisionId: string;
    meterFormulaRevisionId: string;
    metricVersion: string;
    ruleRevisionIds: string[];
    aggregationRule: "designated_total" | "component" | "submeter" | "none";
    sourceView: string;
    queryIds: [
      "scope_summary_v1",
      "hourly_profile_v1",
      "meter_breakdown_v1",
      "operational_policy_scope_intervals_v1",
      "operational_policy_meter_intervals_v1",
    ];
  };
};

export type EnergyGoldenSelection = {
  periodDays: number;
  intervalMinutes: number;
  policy: "highest current coverage, then previous-period coverage, then fewest quality events, then latest";
  period: {
    localFrom: string;
    localToExclusive: string;
    from: string;
    to: string;
  };
  day: {
    localDate: string;
    from: string;
    to: string;
  };
};

export type EnergyLatestCompletePeriodSelection = {
  periodDays: 7;
  intervalMinutes: number;
  period: {
    localFrom: string;
    localToExclusive: string;
    from: string;
    to: string;
  };
};

type MeterAggregate = {
  meterNodeId: string;
  scopeId: string;
  name: string;
  appliance: string;
  category: string;
  meterRole: string;
  usageKwh: number;
  peakKw: number;
  validIntervalCount: number;
  qualityEventCount: number;
};

type OperationalIntervalSeries = {
  kind: "scope" | "meter";
  meterNodeId?: string;
  scopeId?: string;
  intervals: EnergyIqAnalysisInterval[];
};

const GOLDEN_SELECTION_POLICY =
  "highest current coverage, then previous-period coverage, then fewest quality events, then latest" as const;

const LATEST_COMPLETE_PERIOD_DAYS = 7 as const;

type EnergyPeriodSelectionInput = {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  userId: string;
  context: EnergyQueryContext;
  databasePath?: string;
};

type EnergyPeriodCoverageNotFoundCode =
  | "ENERGYIQ_GOLDEN_COVERAGE_NOT_FOUND"
  | "ENERGYIQ_LATEST_COMPLETE_PERIOD_COVERAGE_NOT_FOUND";

export const selectEnergyGoldenPeriod = async (input: EnergyPeriodSelectionInput & {
  periodDays?: number;
}): Promise<EnergyGoldenSelection> => {
  const periodDays = input.periodDays ?? 7;
  if (!Number.isInteger(periodDays) || periodDays < 1) {
    throw new Error("ENERGYIQ_GOLDEN_PERIOD_DAYS_INVALID");
  }
  const { scoped, aggregateMeterNodeIds } = await prepareEnergyPeriodSelection(
    input,
    "ENERGYIQ_GOLDEN_COVERAGE_NOT_FOUND",
  );
  const selected = await input.dataGateway.runSqlReadonly({
    user_id: input.userId,
    workspace_id: input.context.workspaceId,
    datasource_id: scoped.datasourceId,
    sql: goldenPeriodSelectionSql(
      scoped.viewName,
      aggregateMeterNodeIds,
      periodDays,
      input.context.timezone
    ),
    limit: 1
  });
  const row = selected.rows[0];
  if (!row) {
    throw new Error("ENERGYIQ_GOLDEN_PERIOD_NOT_FOUND");
  }
  const dayResult = await input.dataGateway.runSqlReadonly({
    user_id: input.userId,
    workspace_id: input.context.workspaceId,
    datasource_id: scoped.datasourceId,
    sql: goldenDaySelectionSql(
      scoped.viewName,
      aggregateMeterNodeIds,
      stringAt(row, 0),
      stringAt(row, 1),
      input.context.timezone
    ),
    limit: 1
  });
  const dayRow = dayResult.rows[0];
  if (!dayRow) {
    throw new Error("ENERGYIQ_GOLDEN_DAY_NOT_FOUND");
  }
  const intervalMinutes = numberAt(row, 4);
  return {
    periodDays,
    intervalMinutes,
    policy: GOLDEN_SELECTION_POLICY,
    period: {
      localFrom: stringAt(row, 0),
      localToExclusive: stringAt(row, 1),
      from: isoAt(row, 2),
      to: isoAt(row, 3)
    },
    day: {
      localDate: stringAt(dayRow, 0),
      from: isoAt(dayRow, 1),
      to: isoAt(dayRow, 2)
    }
  };
};

export const selectEnergyLatestCompletePeriod = async (
  input: EnergyPeriodSelectionInput,
): Promise<EnergyLatestCompletePeriodSelection> => {
  const { scoped, aggregateMeterNodeIds } = await prepareEnergyPeriodSelection(
    input,
    "ENERGYIQ_LATEST_COMPLETE_PERIOD_COVERAGE_NOT_FOUND",
  );
  const selected = await input.dataGateway.runSqlReadonly({
    user_id: input.userId,
    workspace_id: input.context.workspaceId,
    datasource_id: scoped.datasourceId,
    sql: latestCompletePeriodSelectionSql(
      scoped.viewName,
      aggregateMeterNodeIds,
      LATEST_COMPLETE_PERIOD_DAYS,
      input.context.timezone,
    ),
    limit: 1,
  });
  const row = selected.rows[0];
  if (!row) {
    throw new Error("ENERGYIQ_LATEST_COMPLETE_PERIOD_NOT_FOUND");
  }
  return {
    periodDays: LATEST_COMPLETE_PERIOD_DAYS,
    intervalMinutes: numberAt(row, 4),
    period: {
      localFrom: stringAt(row, 0),
      localToExclusive: stringAt(row, 1),
      from: isoAt(row, 2),
      to: isoAt(row, 3),
    },
  };
};

const prepareEnergyPeriodSelection = async (
  input: EnergyPeriodSelectionInput,
  coverageNotFoundCode: EnergyPeriodCoverageNotFoundCode,
) => {
  const databasePath = input.databasePath
    ?? process.env.ENERGYIQ_DUCKDB_PATH
    ?? join(resolve(dirname(fileURLToPath(import.meta.url)), "../../../.."), "storage", "energy", input.context.workspaceId, "energy.duckdb");
  const coverage = await readEnergyFactCoverage({
    metadataStore: input.metadataStore,
    workspaceId: input.context.workspaceId,
    projectId: input.context.projectId,
    dataSnapshotId: input.context.dataSnapshotId,
    resource: input.context.resource,
    databasePath,
  });
  if (!coverage) throw new Error(coverageNotFoundCode);
  const publishedMeterRoute = resolveEnergyPublishedMeterRoute({
    metadataStore: input.metadataStore,
    projectId: input.context.projectId,
    hierarchyRevisionId: input.context.hierarchyRevisionId,
    scopeId: input.context.scopeId,
    resource: input.context.resource,
    expectedMeterMappingRevisionId: input.context.meterMappingRevisionId,
  });
  const hierarchy = resolveEnergyPublishedHierarchyNodes(
    input.metadataStore,
    input.context.projectId,
    input.context.hierarchyRevisionId,
  );
  if (!hierarchy.some((node) => node.id === input.context.scopeId)) {
    throw new Error("ENERGYIQ_SCOPE_FORBIDDEN");
  }
  const scoped = await ensureEnergyScopedDataSource({
    metadataStore: input.metadataStore,
    userId: input.userId,
    context: {
      workspaceId: input.context.workspaceId,
      projectId: input.context.projectId,
      scopeId: input.context.scopeId,
      meterAttachments: publishedMeterRoute.attachments,
      resource: input.context.resource,
      from: coverage.from,
      to: coverage.to,
      timezone: input.context.timezone,
      hierarchyRevisionId: input.context.hierarchyRevisionId,
      meterMappingRevisionId: publishedMeterRoute.meterMappingRevisionId,
      meterFormulaRevisionId: input.context.meterFormulaRevisionId,
      dataSnapshotId: input.context.dataSnapshotId,
      metricVersion: input.context.metricVersion,
    },
    databasePath,
  });
  return {
    scoped,
    aggregateMeterNodeIds: publishedMeterRoute.officialMeterPointIds ?? [],
  };
};

export const executeEnergyScopeAnalysis = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  userId: string;
  context: EnergyQueryContext;
  databasePath?: string;
  ruleRevisions?: readonly EnergyIqRuleRevisionRecord[];
}): Promise<EnergyScopeAnalysis> => {
  const publishedMeterRoute = resolveEnergyPublishedMeterRoute({
    metadataStore: input.metadataStore,
    projectId: input.context.projectId,
    hierarchyRevisionId: input.context.hierarchyRevisionId,
    scopeId: input.context.scopeId,
    resource: input.context.resource,
    expectedMeterMappingRevisionId: input.context.meterMappingRevisionId
  });
  const scoped = await ensureEnergyScopedDataSource({
    metadataStore: input.metadataStore,
    userId: input.userId,
    context: {
      workspaceId: input.context.workspaceId,
      projectId: input.context.projectId,
      scopeId: input.context.scopeId,
      meterAttachments: publishedMeterRoute.attachments,
      resource: input.context.resource,
      from: input.context.from,
      to: input.context.to,
      timezone: input.context.timezone,
      hierarchyRevisionId: input.context.hierarchyRevisionId,
      meterMappingRevisionId: publishedMeterRoute.meterMappingRevisionId,
      meterFormulaRevisionId: input.context.meterFormulaRevisionId,
      dataSnapshotId: input.context.dataSnapshotId,
      metricVersion: input.context.metricVersion
    },
    databasePath: input.databasePath
      ?? process.env.ENERGYIQ_DUCKDB_PATH
      ?? join(resolve(dirname(fileURLToPath(import.meta.url)), "../../../.."), "storage", "energy", input.context.workspaceId, "energy.duckdb")
  });

  const meterResult = await input.dataGateway.runSqlReadonly({
    user_id: input.userId,
    workspace_id: input.context.workspaceId,
    datasource_id: scoped.datasourceId,
    sql: meterBreakdownSql(scoped.viewName),
    limit: 1000
  });
  const meterAggregates = meterResult.rows.map(rowToMeterAggregate);
  const hierarchy = resolveEnergyPublishedHierarchyNodes(
    input.metadataStore,
    input.context.projectId,
    input.context.hierarchyRevisionId
  );
  const selectedNode = hierarchy.find((node) => node.id === input.context.scopeId);
  if (!selectedNode) {
    throw new Error("ENERGYIQ_SCOPE_FORBIDDEN");
  }
  const aggregateMeterNodeIds = publishedMeterRoute.officialMeterPointIds ?? [];
  const aggregateMeterIds = new Set(aggregateMeterNodeIds);
  const aggregateMeters = meterAggregates.filter((meter) => aggregateMeterIds.has(meter.meterNodeId));
  const aggregationRule = publishedMeterRoute.officialMeterRoles
    ? aggregationRuleForRoles(publishedMeterRoute.officialMeterRoles)
    : aggregationRuleForMeters(aggregateMeters);
  const periodDurationMs = Date.parse(input.context.to) - Date.parse(input.context.from);
  const previousFrom = new Date(Date.parse(input.context.from) - periodDurationMs).toISOString();
  const previousTo = input.context.from;
  const previousScoped = await ensureEnergyScopedDataSource({
    metadataStore: input.metadataStore,
    userId: input.userId,
    context: {
      workspaceId: input.context.workspaceId,
      projectId: input.context.projectId,
      scopeId: input.context.scopeId,
      meterAttachments: publishedMeterRoute.attachments,
      resource: input.context.resource,
      from: previousFrom,
      to: previousTo,
      timezone: input.context.timezone,
      hierarchyRevisionId: input.context.hierarchyRevisionId,
      meterMappingRevisionId: publishedMeterRoute.meterMappingRevisionId,
      meterFormulaRevisionId: input.context.meterFormulaRevisionId,
      dataSnapshotId: input.context.dataSnapshotId,
      metricVersion: input.context.metricVersion
    },
    databasePath: scoped.databasePath
  });
  const [
    summaryResult,
    profileResult,
    healthResult,
    previousSummaryResult,
    previousMeterResult,
    operationalScopeIntervalResult,
    operationalMeterIntervalResult,
  ] = await Promise.all([
    input.dataGateway.runSqlReadonly({
      user_id: input.userId,
      workspace_id: input.context.workspaceId,
      datasource_id: scoped.datasourceId,
      sql: scopeSummarySql(scoped.viewName, aggregateMeterNodeIds)
    }),
    input.dataGateway.runSqlReadonly({
      user_id: input.userId,
      workspace_id: input.context.workspaceId,
      datasource_id: scoped.datasourceId,
      sql: hourlyProfileSql(scoped.viewName, aggregateMeterNodeIds)
    }),
    input.dataGateway.runSqlReadonly({
      user_id: input.userId,
      workspace_id: input.context.workspaceId,
      datasource_id: scoped.datasourceId,
      sql: scopeHealthSql(scoped.viewName, aggregateMeterNodeIds)
    }),
    input.dataGateway.runSqlReadonly({
      user_id: input.userId,
      workspace_id: input.context.workspaceId,
      datasource_id: previousScoped.datasourceId,
      sql: scopeSummarySql(previousScoped.viewName, aggregateMeterNodeIds)
    }),
    input.dataGateway.runSqlReadonly({
      user_id: input.userId,
      workspace_id: input.context.workspaceId,
      datasource_id: previousScoped.datasourceId,
      sql: meterBreakdownSql(previousScoped.viewName),
      limit: 1000,
    }),
    input.dataGateway.runSqlReadonly({
      user_id: input.userId,
      workspace_id: input.context.workspaceId,
      datasource_id: scoped.datasourceId,
      sql: operationalPolicyScopeIntervalsSql(scoped.viewName, aggregateMeterNodeIds),
      limit: 1,
    }),
    input.dataGateway.runSqlReadonly({
      user_id: input.userId,
      workspace_id: input.context.workspaceId,
      datasource_id: scoped.datasourceId,
      sql: operationalPolicyMeterIntervalsSql(
        scoped.viewName,
        meterAggregates.map((meter) => meter.meterNodeId),
      ),
      limit: Math.max(1, meterAggregates.length),
    }),
  ]);

  const summaryRow = summaryResult.rows[0] ?? [];
  const usageKwh = numberAt(summaryRow, 0);
  const peakKw = numberAt(summaryRow, 1);
  const peakAt = optionalStringAt(summaryRow, 2);
  const healthRow = healthResult.rows[0] ?? [];
  const validIntervalCount = numberAt(healthRow, 0);
  const qualityEventCount = numberAt(healthRow, 1);
  const intervalMinutes = numberAt(healthRow, 2) || 15;
  const lastSeenAt = optionalStringAt(healthRow, 3);
  const importBatchIds = stringAt(healthRow, 4)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .sort();
  const cumulativeDeltaMismatchCount = numberAt(healthRow, 5);
  const averageKwMismatchCount = numberAt(healthRow, 6);
  const invalidIntervalDurationCount = numberAt(healthRow, 7);
  const previousUsageKwh = numberAt(previousSummaryResult.rows[0] ?? [], 0);
  const previousMeterAggregates = previousMeterResult.rows.map(rowToMeterAggregate);
  const operationalSeries = [
    ...operationalScopeIntervalResult.rows,
    ...operationalMeterIntervalResult.rows,
  ].map(rowToOperationalIntervalSeries);
  const scopeOperationalSeries = operationalSeries.find((series) => series.kind === "scope");
  if (!scopeOperationalSeries) {
    throw new Error("ENERGYIQ_OPERATIONAL_POLICY_SCOPE_INTERVALS_MISSING");
  }
  const operationalPolicy = evaluateReleasePinnedOperationalPolicy({
    metadataStore: input.metadataStore,
    context: input.context,
    scopeId: input.context.scopeId,
    intervals: scopeOperationalSeries.intervals,
  });
  const circuitOperatingByMeterId = new Map<string, EnergyIqOperatingEvaluation>();
  if (operationalPolicy.operating.status === "available") {
    const meterSeriesByMeterId = new Map(
      operationalSeries
        .filter((series): series is OperationalIntervalSeries & { meterNodeId: string } =>
          series.kind === "meter" && series.meterNodeId !== undefined,
        )
        .map((series) => [series.meterNodeId, series]),
    );
    const missingMeterIds = meterAggregates
      .filter((meter) => meter.validIntervalCount > 0 && !meterSeriesByMeterId.has(meter.meterNodeId))
      .map((meter) => meter.meterNodeId);
    if (missingMeterIds.length > 0) {
      throw new Error(
        `ENERGYIQ_OPERATIONAL_POLICY_METER_INTERVALS_INCOMPLETE:${missingMeterIds.join(",")}`,
      );
    }
    for (const meter of meterAggregates) {
      const series = meterSeriesByMeterId.get(meter.meterNodeId);
      const evaluation = evaluateReleasePinnedOperationalPolicy({
        metadataStore: input.metadataStore,
        context: input.context,
        scopeId: series?.scopeId ?? meter.scopeId,
        intervals: series?.intervals ?? [],
      });
      circuitOperatingByMeterId.set(meter.meterNodeId, evaluation.operating);
    }
  }
  const expectedMeterIntervalCount = aggregateMeterNodeIds.length * Math.round(
    periodDurationMs / (intervalMinutes * 60_000)
  );
  const scopeDimensions = resolveScopeDimensions(selectedNode.id, hierarchy);
  const childScopes = buildChildScopes({
    metadataStore: input.metadataStore,
    projectId: input.context.projectId,
    hierarchyRevisionId: input.context.hierarchyRevisionId,
    meterMappingRevisionId: input.context.meterMappingRevisionId,
    resource: input.context.resource,
    scopeNodeId: selectedNode.id,
    hierarchy,
    meterAggregates,
    previousMeterAggregates,
    scopeUsageKwh: usageKwh,
    periodDurationMs,
    intervalMinutes,
  });
  const circuits = meterAggregates
    .map((meter) => {
      const meterOperating = circuitOperatingByMeterId.get(meter.meterNodeId);
      return {
        meterNodeId: meter.meterNodeId,
        name: meter.name,
        appliance: meter.appliance,
        category: meter.category,
        meterRole: meter.meterRole,
        usageKwh: round(meter.usageKwh, 4),
        sharePct: percent(meter.usageKwh, usageKwh),
        ...(meterOperating?.status === "available"
          ? { nonOperatingKwh: round(meterOperating.standby_kwh, 4) }
          : {}),
        peakKw: round(meter.peakKw, 4),
        qualityEventCount: meter.qualityEventCount
      };
    })
    .sort((left, right) => right.usageKwh - left.usageKwh);
  const topCircuits = circuits.filter((meter) => !aggregateMeterNodeIds.includes(meter.meterNodeId));
  const categoryUsage = new Map<string, number>();
  for (const meter of aggregateMeters) {
    categoryUsage.set(meter.category, (categoryUsage.get(meter.category) ?? 0) + meter.usageKwh);
  }
  const categories = [...categoryUsage.entries()]
    .map(([category, categoryUsageKwh]) => ({
      category,
      usageKwh: round(categoryUsageKwh, 4),
      sharePct: percent(categoryUsageKwh, usageKwh)
    }))
    .sort((left, right) => right.usageKwh - left.usageKwh);
  const virtualMeters = buildVirtualMeters({
    metadataStore: input.metadataStore,
    projectId: input.context.projectId,
    hierarchyRevisionId: input.context.hierarchyRevisionId,
    resource: input.context.resource,
    selectedScopeId: selectedNode.id,
    hierarchy,
    circuits
  });

  const summary: EnergyScopeAnalysis["summary"] = {
    usageKwh: round(usageKwh, 4),
    averageDailyUsageKwh: round(usageKwh / calendarDayCount(input.context.from, input.context.to), 4),
    peakKw: round(peakKw, 4),
    ...(peakAt ? { peakAt } : {}),
    ...(operationalPolicy.operating.status === "available" ? {
      nonOperatingKwh: round(operationalPolicy.operating.standby_kwh, 4),
      nonOperatingSharePct: percent(operationalPolicy.operating.standby_kwh, usageKwh),
    } : {}),
    ...(scopeDimensions.areaSqm > 0 ? {
      areaSqm: round(scopeDimensions.areaSqm, 2),
      kwhPerSqm: round(usageKwh / scopeDimensions.areaSqm, 4)
    } : {}),
    ...(scopeDimensions.occupantCount > 0 ? {
      occupantCount: scopeDimensions.occupantCount,
      kwhPerPerson: round(usageKwh / scopeDimensions.occupantCount, 4)
    } : {}),
    validIntervalCount,
    qualityEventCount
  };
  const comparison: EnergyScopeAnalysis["comparison"] = {
    from: previousFrom,
    to: previousTo,
    usageKwh: round(previousUsageKwh, 4),
    changeKwh: round(usageKwh - previousUsageKwh, 4),
    changePct: previousUsageKwh > 0
      ? round(((usageKwh - previousUsageKwh) / previousUsageKwh) * 100, 4)
      : null
  };
  const offHours = mapOperatingEvaluation(operationalPolicy.operating, usageKwh);
  const cost = mapTariffEvaluation(operationalPolicy.tariff);
  const coveragePct = expectedMeterIntervalCount > 0
    ? round(Math.min(validIntervalCount / expectedMeterIntervalCount, 1) * 100, 4)
    : 0;
  const dataHealth: EnergyScopeAnalysis["dataHealth"] = {
    status: expectedMeterIntervalCount === 0
      ? "unavailable"
      : validIntervalCount >= expectedMeterIntervalCount && qualityEventCount === 0
        ? "complete"
        : "partial",
    coveragePct,
    expectedMeterIntervalCount,
    validIntervalCount,
    qualityEventCount,
    cumulativeDeltaMismatchCount,
    averageKwMismatchCount,
    invalidIntervalDurationCount,
    ...(lastSeenAt ? { lastSeenAt } : {}),
    importBatchIds
  };
  const ruleRevisions = input.ruleRevisions ?? input.metadataStore.energyIq.rules.listRevisions();

  return {
    context: input.context,
    summary,
    comparison,
    hourlyProfile: profileResult.rows.map((row) => ({
      hour: numberAt(row, 0),
      usageKwh: round(numberAt(row, 1), 4),
      averageKw: round(numberAt(row, 2), 4),
      peakKw: round(numberAt(row, 3), 4),
      observationCount: numberAt(row, 4)
    })),
    categories,
    childScopes,
    circuits,
    topCircuits,
    virtualMeters,
    offHours,
    cost,
    dataHealth,
    units: {
      usage: "kWh",
      demand: "kW",
      intervalMinutes,
      timezone: operationalPolicy.operating.status === "available"
        ? operationalPolicy.operating.timezone
        : input.context.timezone
    },
    attention: evaluateEnergyAttention({ summary, childScopes, circuits, ruleRevisions }),
    provenance: {
      dataSnapshotId: input.context.dataSnapshotId,
      hierarchyRevisionId: input.context.hierarchyRevisionId,
      meterMappingRevisionId: publishedMeterRoute.meterMappingRevisionId,
      meterFormulaRevisionId: input.context.meterFormulaRevisionId,
      metricVersion: input.context.metricVersion,
      ruleRevisionIds: ruleRevisions.map((rule) => rule.revision_id),
      aggregationRule,
      sourceView: scoped.viewName,
      queryIds: [
        "scope_summary_v1",
        "hourly_profile_v1",
        "meter_breakdown_v1",
        "operational_policy_scope_intervals_v1",
        "operational_policy_meter_intervals_v1",
      ]
    }
  };
};

const calendarDayCount = (from: string, to: string): number =>
  Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000));

const evaluateReleasePinnedOperationalPolicy = (input: {
  metadataStore: MetadataStore;
  context: EnergyQueryContext;
  scopeId: string;
  intervals: EnergyIqAnalysisInterval[];
}) => input.metadataStore.energyIq.operationalPolicy.evaluateAnalysisPolicy({
  project_id: input.context.projectId,
  scope_id: input.scopeId,
  period: {
    from: input.context.from,
    to: input.context.to,
  },
  intervals: input.intervals,
  policy_source: {
    mode: "release-pinned",
    tariff_schedule_version: input.context.tariffScheduleVersion,
    business_calendar_version: input.context.businessCalendarVersion,
  },
});

const mapTariffEvaluation = (
  evaluation: EnergyIqTariffEvaluation,
): EnergyScopeAnalysis["cost"] => evaluation.status === "available"
  ? {
      status: "available",
      amount: evaluation.total_cost,
      currency: evaluation.currency,
      tariffScheduleVersion: evaluation.tariff_schedule_version,
      allocations: evaluation.allocations.map((allocation) => ({
        from: allocation.from,
        to: allocation.to,
        ratePerKwh: allocation.rate_per_kwh,
        usageKwh: allocation.usage_kwh,
        cost: allocation.cost,
      })),
    }
  : {
      status: "unavailable",
      reason: evaluation.reason,
      ...(evaluation.tariff_schedule_version
        ? { tariffScheduleVersion: evaluation.tariff_schedule_version }
        : {}),
    };

const mapOperatingEvaluation = (
  evaluation: EnergyIqOperatingEvaluation,
  usageKwh: number,
): EnergyScopeAnalysis["offHours"] => evaluation.status === "available"
  ? {
      status: "available",
      operatingKwh: evaluation.operating_kwh,
      standbyKwh: evaluation.standby_kwh,
      usageKwh: evaluation.standby_kwh,
      sharePct: percent(evaluation.standby_kwh, usageKwh),
      timezone: evaluation.timezone,
      businessCalendarVersion: evaluation.business_calendar_version,
    }
  : {
      status: "unavailable",
      reason: evaluation.reason,
      ...(evaluation.business_calendar_version
        ? { businessCalendarVersion: evaluation.business_calendar_version }
        : {}),
    };

const buildChildScopes = (input: {
  metadataStore: MetadataStore;
  projectId: string;
  hierarchyRevisionId: string;
  meterMappingRevisionId: string;
  resource: "electricity" | "water";
  scopeNodeId: string;
  hierarchy: ReturnType<MetadataStore["energyIq"]["listProjectNodes"]>;
  meterAggregates: MeterAggregate[];
  previousMeterAggregates: MeterAggregate[];
  scopeUsageKwh: number;
  periodDurationMs: number;
  intervalMinutes: number;
}): EnergyScopeAnalysis["childScopes"] => {
  const children = input.hierarchy.filter((node) => node.parent_id === input.scopeNodeId);
  return children.map((child) => {
    const descendantIds = collectDescendantIds(child.id, input.hierarchy);
    descendantIds.add(child.id);
    const meters = input.meterAggregates.filter((meter) => descendantIds.has(meter.scopeId));
    const publishedRoute = resolveEnergyPublishedMeterRoute({
      metadataStore: input.metadataStore,
      projectId: input.projectId,
      hierarchyRevisionId: input.hierarchyRevisionId,
      scopeId: child.id,
      resource: input.resource,
      expectedMeterMappingRevisionId: input.meterMappingRevisionId
    });
    const officialIds = publishedRoute.officialMeterPointIds
      ? new Set(publishedRoute.officialMeterPointIds)
      : undefined;
    const aggregateMeters = officialIds
      ? meters.filter((meter) => officialIds.has(meter.meterNodeId))
      : [];
    const usageKwh = aggregateMeters.reduce((sum, meter) => sum + meter.usageKwh, 0);
    const previousUsageKwh = officialIds
      ? input.previousMeterAggregates
        .filter((meter) => officialIds.has(meter.meterNodeId))
        .reduce((sum, meter) => sum + meter.usageKwh, 0)
      : 0;
    const expectedMeterIntervalCount = (officialIds?.size ?? 0) * Math.round(
      input.periodDurationMs / (input.intervalMinutes * 60_000),
    );
    const validIntervalCount = aggregateMeters.reduce((sum, meter) => sum + meter.validIntervalCount, 0);
    const qualityEventCount = aggregateMeters.reduce((sum, meter) => sum + meter.qualityEventCount, 0);
    const breakdownMeters = meters.filter((meter) => meter.scopeId !== child.id);
    const topCircuit = maxBy(breakdownMeters, (meter) => meter.usageKwh);
    const dimensions = resolveScopeDimensions(child.id, input.hierarchy);
    return {
      nodeId: child.id,
      name: child.name,
      nodeType: child.node_type,
      usageKwh: round(usageKwh, 4),
      sharePct: percent(usageKwh, input.scopeUsageKwh, 4),
      comparison: {
        usageKwh: round(previousUsageKwh, 4),
        changeKwh: round(usageKwh - previousUsageKwh, 4),
        changePct: previousUsageKwh > 0
          ? round(((usageKwh - previousUsageKwh) / previousUsageKwh) * 100, 4)
          : null,
      },
      dataHealth: {
        coveragePct: expectedMeterIntervalCount > 0
          ? round(Math.min(validIntervalCount / expectedMeterIntervalCount, 1) * 100, 4)
          : 0,
        expectedMeterIntervalCount,
        validIntervalCount,
        qualityEventCount,
      },
      ...(dimensions.areaSqm > 0 ? {
        areaSqm: round(dimensions.areaSqm, 2),
        kwhPerSqm: round(usageKwh / dimensions.areaSqm, 4)
      } : {}),
      ...(dimensions.occupantCount > 0 ? {
        occupantCount: dimensions.occupantCount,
        kwhPerPerson: round(usageKwh / dimensions.occupantCount, 4)
      } : {}),
      ...(topCircuit ? {
        topCircuitName: topCircuit.name,
        topCircuitUsageKwh: round(topCircuit.usageKwh, 4)
      } : {})
    };
  }).sort((left, right) => right.usageKwh - left.usageKwh);
};

const buildVirtualMeters = (input: {
  metadataStore: MetadataStore;
  projectId: string;
  hierarchyRevisionId: string;
  resource: "electricity" | "water";
  selectedScopeId: string;
  hierarchy: ReturnType<MetadataStore["energyIq"]["listProjectNodes"]>;
  circuits: EnergyScopeAnalysis["circuits"];
}): EnergyScopeAnalysis["virtualMeters"] => {
  const revision = input.metadataStore.energyIq.projectSetup
    .listHierarchyRevisions(input.projectId)
    .find((candidate) => candidate.id === input.hierarchyRevisionId);
  if (!revision) return [];
  const mapping = (JSON.parse(revision.snapshot_json) as EnergyIqProjectSetupDocument).meter_mapping;
  if (!mapping) return [];
  const includedScopeIds = collectDescendantIds(input.selectedScopeId, input.hierarchy);
  includedScopeIds.add(input.selectedScopeId);
  const circuitByMeterNodeId = new Map(input.circuits.map((circuit) => [circuit.meterNodeId, circuit]));
  return (mapping.virtual_meters ?? []).flatMap((virtualMeter) => {
    if (virtualMeter.resource !== input.resource || !includedScopeIds.has(virtualMeter.scope_id)) return [];
    const terms = virtualMeter.terms.map((term) => ({
      term,
      circuit: circuitByMeterNodeId.get(term.mapping_row_id)
    }));
    if (terms.some(({ circuit }) => !circuit)) return [];
    return [{
      meterNodeId: virtualMeter.id,
      name: virtualMeter.display_name,
      scopeId: virtualMeter.scope_id,
      termMeterNodeIds: terms.map(({ term }) => term.mapping_row_id),
      usageKwh: round(terms.reduce(
        (sum, { term, circuit }) => sum + (circuit?.usageKwh ?? 0) * term.coefficient,
        0
      ), 4),
      includedInOfficialTotal: false as const
    }];
  });
};

export const evaluateEnergyAttention = (input: {
  summary: EnergyScopeAnalysis["summary"];
  childScopes: EnergyScopeAnalysis["childScopes"];
  circuits: EnergyScopeAnalysis["circuits"];
  ruleRevisions: readonly EnergyIqRuleRevisionRecord[];
}): EnergyScopeAnalysis["attention"] => {
  const ruleByEvaluationKey = new Map(input.ruleRevisions.map((rule) => [rule.evaluation_key, rule]));
  if (input.summary.usageKwh <= 0) {
    return ruleByEvaluationKey.has("NO_DATA") ? [{
      code: "NO_DATA",
      severity: "info",
      title: "No validated consumption in this period",
      evidence: "The trusted scope returned zero valid interval consumption.",
      suggestedAction: "Check the selected period and latest import batch."
    }] : [];
  }
  const attention: EnergyScopeAnalysis["attention"] = [];
  const offHoursRule = ruleByEvaluationKey.get("NON_OPERATING_SHARE");
  const offHoursThreshold = numericRuleParameter(offHoursRule?.parameters.threshold_pct, 10);
  if (
    offHoursRule
    && input.summary.nonOperatingSharePct !== undefined
    && input.summary.nonOperatingKwh !== undefined
    && input.summary.nonOperatingSharePct >= offHoursThreshold
  ) {
    const availableCircuits = input.circuits.filter(
      (circuit): circuit is typeof circuit & { nonOperatingKwh: number } =>
        circuit.nonOperatingKwh !== undefined,
    );
    const breakdownCircuits = availableCircuits.filter((circuit) => circuit.meterRole !== "total");
    const topNonOperating = maxBy(
      breakdownCircuits.length > 0 ? breakdownCircuits : availableCircuits,
      (circuit) => circuit.nonOperatingKwh
    );
    attention.push({
      code: "NON_OPERATING_SHARE",
      severity: "warning",
      title: `${input.summary.nonOperatingSharePct.toFixed(1)}% of usage occurred outside operating hours`,
      evidence: topNonOperating
        ? `${topNonOperating.name} contributed ${topNonOperating.nonOperatingKwh.toLocaleString()} kWh outside operating hours.`
        : `${input.summary.nonOperatingKwh.toLocaleString()} kWh occurred outside operating hours.`,
      suggestedAction: "Review shutdown schedules and the highest non-operating circuit before changing equipment."
    });
  }
  const highestChild = input.childScopes[0];
  const highestChildRule = ruleByEvaluationKey.get("TOP_CHILD_SCOPE");
  const minimumChildren = numericRuleParameter(highestChildRule?.parameters.minimum_peers, 2);
  if (highestChildRule && highestChild && input.childScopes.length >= minimumChildren) {
    attention.push({
      code: "TOP_CHILD_SCOPE",
      severity: "info",
      title: `${highestChild.name} used the most energy in this scope`,
      evidence: `${highestChild.usageKwh.toLocaleString()} kWh, ${highestChild.sharePct.toFixed(1)}% of the selected scope.`,
      suggestedAction: "Open this child scope and compare its circuits and time profile."
    });
  }
  const normalised = input.childScopes.filter(
    (child): child is typeof child & { kwhPerSqm: number } => child.kwhPerSqm !== undefined
  );
  const areaRule = ruleByEvaluationKey.get("AREA_NORMALISED_OUTLIER");
  const minimumAreaPeers = numericRuleParameter(areaRule?.parameters.minimum_peers, 3);
  const areaMedianRatio = numericRuleParameter(areaRule?.parameters.median_ratio, 1.2);
  if (areaRule && normalised.length >= minimumAreaPeers) {
    const values = normalised.map((child) => child.kwhPerSqm).sort((left, right) => left - right);
    const median = values[Math.floor(values.length / 2)] ?? 0;
    const highest = maxBy(normalised, (child) => child.kwhPerSqm);
    if (highest && median > 0 && highest.kwhPerSqm >= median * areaMedianRatio) {
      attention.push({
        code: "AREA_NORMALISED_OUTLIER",
        severity: "warning",
        title: `${highest.name} has the highest area-normalised consumption`,
        evidence: `${highest.kwhPerSqm.toFixed(2)} kWh/m² versus a sibling median of ${median.toFixed(2)} kWh/m².`,
        suggestedAction: "Check operating hours and circuit composition before comparing absolute kWh alone."
      });
    }
  }

  const peopleNormalised = input.childScopes.filter(
    (child): child is typeof child & { kwhPerPerson: number } => child.kwhPerPerson !== undefined
  );
  const peopleRule = ruleByEvaluationKey.get("PEOPLE_NORMALISED_OUTLIER");
  const minimumPeoplePeers = numericRuleParameter(peopleRule?.parameters.minimum_peers, 3);
  const peopleMedianRatio = numericRuleParameter(peopleRule?.parameters.median_ratio, 1.2);
  if (peopleRule && peopleNormalised.length >= minimumPeoplePeers) {
    const values = peopleNormalised.map((child) => child.kwhPerPerson).sort((left, right) => left - right);
    const median = values[Math.floor(values.length / 2)] ?? 0;
    const highest = maxBy(peopleNormalised, (child) => child.kwhPerPerson);
    if (highest && median > 0 && highest.kwhPerPerson >= median * peopleMedianRatio) {
      attention.push({
        code: "PEOPLE_NORMALISED_OUTLIER",
        severity: "warning",
        title: `${highest.name} has the highest per-person consumption`,
        evidence: `${highest.kwhPerPerson.toFixed(2)} kWh/person versus a sibling median of ${median.toFixed(2)} kWh/person.`,
        suggestedAction: "Confirm typical occupancy and operating hours before comparing absolute kWh alone."
      });
    }
  }
  return attention;
};

const numericRuleParameter = (value: number | string | undefined, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const resolveScopeDimensions = (
  scopeNodeId: string,
  hierarchy: ReturnType<MetadataStore["energyIq"]["listProjectNodes"]>
): { areaSqm: number; occupantCount: number } => {
  const selected = hierarchy.find((node) => node.id === scopeNodeId);
  if (selected?.area_sqm || selected?.occupant_count) {
    return {
      areaSqm: selected.area_sqm ?? 0,
      occupantCount: selected.occupant_count ?? 0
    };
  }
  const descendants = collectDescendantIds(scopeNodeId, hierarchy);
  const dimensionNodes = hierarchy.filter((node) =>
    descendants.has(node.id)
    && (node.area_sqm !== undefined || node.occupant_count !== undefined)
    && !hierarchy.some((candidate) =>
      candidate.parent_id === node.id
      && (candidate.area_sqm !== undefined || candidate.occupant_count !== undefined)
    )
  );
  return {
    areaSqm: dimensionNodes.reduce((sum, node) => sum + (node.area_sqm ?? 0), 0),
    occupantCount: dimensionNodes.reduce((sum, node) => sum + (node.occupant_count ?? 0), 0)
  };
};

const collectDescendantIds = (
  nodeId: string,
  hierarchy: ReturnType<MetadataStore["energyIq"]["listProjectNodes"]>
): Set<string> => {
  const byParent = new Map<string, string[]>();
  for (const node of hierarchy) {
    if (!node.parent_id) continue;
    const children = byParent.get(node.parent_id) ?? [];
    children.push(node.id);
    byParent.set(node.parent_id, children);
  }
  const descendants = new Set<string>();
  const pending = [...(byParent.get(nodeId) ?? [])];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || descendants.has(current)) continue;
    descendants.add(current);
    pending.push(...(byParent.get(current) ?? []));
  }
  return descendants;
};

const rowToMeterAggregate = (row: unknown[]): MeterAggregate => ({
  meterNodeId: stringAt(row, 0),
  scopeId: stringAt(row, 1),
  name: stringAt(row, 2),
  appliance: stringAt(row, 3),
  category: stringAt(row, 4),
  meterRole: stringAt(row, 5),
  usageKwh: numberAt(row, 6),
  peakKw: numberAt(row, 7),
  validIntervalCount: numberAt(row, 8),
  qualityEventCount: numberAt(row, 9)
});

const rowToOperationalIntervalSeries = (row: unknown[]): OperationalIntervalSeries => {
  const kind = stringAt(row, 0);
  if (kind !== "scope" && kind !== "meter") {
    throw new Error(`ENERGYIQ_OPERATIONAL_POLICY_INTERVAL_KIND_INVALID:${kind}`);
  }
  const intervals = parseOperationalIntervals(stringAt(row, 3));
  return {
    kind,
    ...(kind === "meter" ? {
      meterNodeId: stringAt(row, 1),
      scopeId: stringAt(row, 2),
    } : {}),
    intervals,
  };
};

const parseOperationalIntervals = (value: string): EnergyIqAnalysisInterval[] => {
  if (!value) return [];
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("ENERGYIQ_OPERATIONAL_POLICY_INTERVALS_INVALID");
  }
  return parsed.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`ENERGYIQ_OPERATIONAL_POLICY_INTERVAL_INVALID:${index}`);
    }
    const fromMs = Number(item.from_ms);
    const toMs = Number(item.to_ms);
    const usageKwh = Number(item.usage_kwh);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || !Number.isFinite(usageKwh)) {
      throw new Error(`ENERGYIQ_OPERATIONAL_POLICY_INTERVAL_INVALID:${index}`);
    }
    return {
      start: new Date(fromMs).toISOString(),
      end_exclusive: new Date(toMs).toISOString(),
      usage_kwh: usageKwh,
    };
  });
};

const scopeSummarySql = (viewName: string, meterNodeIds: string[]): string => `
  SELECT
    COALESCE(SUM(usage_kwh), 0) AS usage_kwh,
    COALESCE(MAX(average_kw), 0) AS peak_kw,
    ARG_MAX(interval_start, average_kw) AS peak_at
  FROM (
    SELECT
      interval_start,
      local_interval_start,
      SUM(usage_kwh) FILTER (WHERE quality_status = 'ok') AS usage_kwh,
      SUM(average_kw) FILTER (WHERE quality_status = 'ok') AS average_kw
    FROM ${quoteIdentifier(viewName)} source
    WHERE ${meterNodeFilter(meterNodeIds)}
    GROUP BY interval_start, local_interval_start
  ) interval_totals
`;

const hourlyProfileSql = (viewName: string, meterNodeIds: string[]): string => `
  SELECT
    local_hour,
    SUM(scope_usage_kwh) AS usage_kwh,
    AVG(scope_kw) AS average_kw,
    MAX(scope_kw) AS peak_kw,
    COUNT(*) AS observation_count
  FROM (
    SELECT
      local_date,
      local_hour,
      local_interval_start,
      SUM(usage_kwh) AS scope_usage_kwh,
      SUM(average_kw) AS scope_kw
    FROM ${quoteIdentifier(viewName)} source
    WHERE ${meterNodeFilter(meterNodeIds)}
      AND source.quality_status = 'ok'
    GROUP BY local_date, local_hour, local_interval_start
  ) interval_totals
  GROUP BY local_hour
  ORDER BY local_hour
`;

const scopeHealthSql = (viewName: string, meterNodeIds: string[]): string => `
  SELECT
    COUNT(*) FILTER (WHERE quality_status = 'ok') AS valid_interval_count,
    COUNT(*) FILTER (WHERE quality_status <> 'ok') AS quality_event_count,
    COALESCE(MEDIAN(elapsed_minutes) FILTER (
      WHERE quality_status = 'ok' AND elapsed_minutes > 0
    ), 15) AS interval_minutes,
    MAX(interval_end) FILTER (WHERE quality_status = 'ok') AS last_seen_at,
    COALESCE(STRING_AGG(
      DISTINCT COALESCE(import_batch_id, '<legacy>'),
      ','
    ) FILTER (WHERE quality_status = 'ok'), '') AS import_batch_ids,
    COUNT(*) FILTER (
      WHERE source_reading_kind = 'cumulative_energy'
        AND quality_status = 'ok'
        AND ABS((active_energy_kwh - previous_active_energy_kwh) - raw_delta_kwh) > 0.000001
    ) AS cumulative_delta_mismatch_count,
    COUNT(*) FILTER (
      WHERE quality_status = 'ok'
        AND elapsed_minutes > 0
        AND ABS(average_kw - usage_kwh * 60 / elapsed_minutes) > 0.000001
    ) AS average_kw_mismatch_count,
    COUNT(*) FILTER (
      WHERE quality_status = 'ok' AND elapsed_minutes <> 15
    ) AS invalid_interval_duration_count
  FROM ${quoteIdentifier(viewName)} source
  WHERE ${meterNodeFilter(meterNodeIds)}
`;

const goldenPeriodSelectionSql = (
  viewName: string,
  meterNodeIds: string[],
  periodDays: number,
  timezone: string
): string => `
  SELECT
    STRFTIME(local_date, '%Y-%m-%d') AS local_from,
    STRFTIME(local_date + INTERVAL ${periodDays} DAY, '%Y-%m-%d') AS local_to_exclusive,
    EPOCH_MS(TIMEZONE(${sqlLiteral(timezone)}, CAST(local_date AS TIMESTAMP))) AS from_ms,
    EPOCH_MS(TIMEZONE(
      ${sqlLiteral(timezone)},
      CAST(local_date + INTERVAL ${periodDays} DAY AS TIMESTAMP)
    )) AS to_ms,
    interval_minutes
  FROM (
    SELECT
      daily_windows.*,
      LEAD(local_date, ${periodDays - 1}) OVER (ORDER BY local_date) AS current_end_date,
      LAG(local_date, ${periodDays}) OVER (ORDER BY local_date) AS previous_start_date,
      COUNT(*) OVER (
        ORDER BY local_date ROWS BETWEEN CURRENT ROW AND ${periodDays - 1} FOLLOWING
      ) AS current_day_count,
      COUNT(*) OVER (
        ORDER BY local_date ROWS BETWEEN ${periodDays} PRECEDING AND 1 PRECEDING
      ) AS previous_day_count,
      SUM(valid_interval_count) OVER (
        ORDER BY local_date ROWS BETWEEN CURRENT ROW AND ${periodDays - 1} FOLLOWING
      ) AS current_valid_count,
      SUM(expected_interval_count) OVER (
        ORDER BY local_date ROWS BETWEEN CURRENT ROW AND ${periodDays - 1} FOLLOWING
      ) AS current_expected_count,
      SUM(quality_event_count) OVER (
        ORDER BY local_date ROWS BETWEEN CURRENT ROW AND ${periodDays - 1} FOLLOWING
      ) AS current_quality_count,
      SUM(valid_interval_count) OVER (
        ORDER BY local_date ROWS BETWEEN ${periodDays} PRECEDING AND 1 PRECEDING
      ) AS previous_valid_count,
      SUM(expected_interval_count) OVER (
        ORDER BY local_date ROWS BETWEEN ${periodDays} PRECEDING AND 1 PRECEDING
      ) AS previous_expected_count
    FROM (
      SELECT
        local_date,
        COUNT(*) FILTER (WHERE quality_status = 'ok') AS valid_interval_count,
        COUNT(*) FILTER (WHERE quality_status <> 'ok') AS quality_event_count,
        COALESCE(MEDIAN(elapsed_minutes) FILTER (
          WHERE quality_status = 'ok' AND elapsed_minutes > 0
        ), 15) AS interval_minutes,
        ${meterNodeIds.length} * ROUND(1440 / COALESCE(MEDIAN(elapsed_minutes) FILTER (
          WHERE quality_status = 'ok' AND elapsed_minutes > 0
        ), 15)) AS expected_interval_count
      FROM ${quoteIdentifier(viewName)} source
      WHERE ${meterNodeFilter(meterNodeIds)}
      GROUP BY local_date
    ) daily_windows
  ) candidates
  WHERE current_day_count = ${periodDays}
    AND previous_day_count = ${periodDays}
    AND DATE_DIFF('day', local_date, current_end_date) = ${periodDays - 1}
    AND DATE_DIFF('day', previous_start_date, local_date) = ${periodDays}
  ORDER BY
    current_valid_count / NULLIF(current_expected_count, 0) DESC,
    previous_valid_count / NULLIF(previous_expected_count, 0) DESC,
    current_quality_count ASC,
    local_date DESC
  LIMIT 1
`;

const latestCompletePeriodSelectionSql = (
  viewName: string,
  meterNodeIds: string[],
  periodDays: number,
  timezone: string,
): string => `
  SELECT
    STRFTIME(local_date, '%Y-%m-%d') AS local_from,
    STRFTIME(local_date + INTERVAL ${periodDays} DAY, '%Y-%m-%d') AS local_to_exclusive,
    EPOCH_MS(TIMEZONE(${sqlLiteral(timezone)}, CAST(local_date AS TIMESTAMP))) AS from_ms,
    EPOCH_MS(TIMEZONE(
      ${sqlLiteral(timezone)},
      CAST(local_date + INTERVAL ${periodDays} DAY AS TIMESTAMP)
    )) AS to_ms,
    interval_minutes
  FROM (
    SELECT
      daily_windows.*,
      LEAD(local_date, ${periodDays - 1}) OVER (ORDER BY local_date) AS current_end_date,
      COUNT(*) OVER (
        ORDER BY local_date ROWS BETWEEN CURRENT ROW AND ${periodDays - 1} FOLLOWING
      ) AS current_day_count,
      SUM(CASE
        WHEN valid_interval_count = expected_interval_count AND quality_event_count = 0 THEN 1
        ELSE 0
      END) OVER (
        ORDER BY local_date ROWS BETWEEN CURRENT ROW AND ${periodDays - 1} FOLLOWING
      ) AS complete_day_count
    FROM (
      SELECT
        local_date,
        COUNT(*) FILTER (WHERE quality_status = 'ok') AS valid_interval_count,
        COUNT(*) FILTER (WHERE quality_status <> 'ok') AS quality_event_count,
        COALESCE(MEDIAN(elapsed_minutes) FILTER (
          WHERE quality_status = 'ok' AND elapsed_minutes > 0
        ), 15) AS interval_minutes,
        ${meterNodeIds.length} * ROUND(1440 / COALESCE(MEDIAN(elapsed_minutes) FILTER (
          WHERE quality_status = 'ok' AND elapsed_minutes > 0
        ), 15)) AS expected_interval_count
      FROM ${quoteIdentifier(viewName)} source
      WHERE ${meterNodeFilter(meterNodeIds)}
      GROUP BY local_date
    ) daily_windows
  ) candidates
  WHERE current_day_count = ${periodDays}
    AND DATE_DIFF('day', local_date, current_end_date) = ${periodDays - 1}
    AND complete_day_count = ${periodDays}
  ORDER BY local_date DESC
  LIMIT 1
`;

const goldenDaySelectionSql = (
  viewName: string,
  meterNodeIds: string[],
  localFrom: string,
  localToExclusive: string,
  timezone: string
): string => `
  SELECT
    STRFTIME(local_date, '%Y-%m-%d') AS local_date,
    EPOCH_MS(TIMEZONE(${sqlLiteral(timezone)}, CAST(local_date AS TIMESTAMP))) AS from_ms,
    EPOCH_MS(TIMEZONE(
      ${sqlLiteral(timezone)},
      CAST(local_date + INTERVAL 1 DAY AS TIMESTAMP)
    )) AS to_ms
  FROM (
    SELECT
      local_date,
      COUNT(*) FILTER (WHERE quality_status = 'ok') AS valid_interval_count,
      COUNT(*) FILTER (WHERE quality_status <> 'ok') AS quality_event_count,
      ${meterNodeIds.length} * ROUND(1440 / COALESCE(MEDIAN(elapsed_minutes) FILTER (
        WHERE quality_status = 'ok' AND elapsed_minutes > 0
      ), 15)) AS expected_interval_count
    FROM ${quoteIdentifier(viewName)} source
    WHERE ${meterNodeFilter(meterNodeIds)}
      AND local_date >= CAST(${sqlLiteral(localFrom)} AS DATE)
      AND local_date < CAST(${sqlLiteral(localToExclusive)} AS DATE)
    GROUP BY local_date
  ) candidate_days
  ORDER BY
    valid_interval_count / NULLIF(expected_interval_count, 0) DESC,
    quality_event_count ASC,
    local_date DESC
  LIMIT 1
`;

const meterBreakdownSql = (viewName: string): string => `
  SELECT
    meter_node_id,
    MAX(scope_id) AS scope_id,
    MAX(device_name) AS device_name,
    MAX(appliance) AS appliance,
    MAX(category) AS category,
    MAX(meter_role) AS meter_role,
    COALESCE(SUM(usage_kwh) FILTER (WHERE quality_status = 'ok'), 0) AS usage_kwh,
    COALESCE(MAX(average_kw) FILTER (WHERE quality_status = 'ok'), 0) AS peak_kw,
    COUNT(*) FILTER (WHERE quality_status = 'ok') AS valid_interval_count,
    COUNT(*) FILTER (WHERE quality_status <> 'ok') AS quality_event_count
  FROM ${quoteIdentifier(viewName)}
  GROUP BY meter_node_id
  ORDER BY meter_node_id
`;

const operationalPolicyScopeIntervalsSql = (
  viewName: string,
  aggregateMeterNodeIds: string[],
): string => `
  SELECT
    'scope' AS series_kind,
    '' AS meter_node_id,
    '' AS scope_id,
    COALESCE(TO_JSON(LIST(STRUCT_PACK(
      from_ms := EPOCH_MS(interval_start),
      to_ms := EPOCH_MS(interval_end),
      usage_kwh := usage_kwh
    ) ORDER BY interval_start, interval_end)), '[]') AS intervals_json
  FROM (
    SELECT
      interval_start,
      interval_end,
      SUM(usage_kwh) AS usage_kwh
    FROM ${quoteIdentifier(viewName)} source
    WHERE quality_status = 'ok'
      AND ${meterNodeFilter(aggregateMeterNodeIds)}
    GROUP BY interval_start, interval_end
  ) scope_intervals
`;

const operationalPolicyMeterIntervalsSql = (
  viewName: string,
  meterNodeIds: string[],
): string => `
  SELECT
    'meter' AS series_kind,
    meter_node_id,
    MAX(scope_id) AS scope_id,
    COALESCE(TO_JSON(LIST(STRUCT_PACK(
      from_ms := EPOCH_MS(interval_start),
      to_ms := EPOCH_MS(interval_end),
      usage_kwh := usage_kwh
    ) ORDER BY interval_start, interval_end)), '[]') AS intervals_json
  FROM (
    SELECT
      meter_node_id,
      MAX(scope_id) AS scope_id,
      interval_start,
      interval_end,
      SUM(usage_kwh) AS usage_kwh
    FROM ${quoteIdentifier(viewName)} source
    WHERE quality_status = 'ok'
      AND ${meterNodeFilter(meterNodeIds)}
    GROUP BY meter_node_id, interval_start, interval_end
  ) meter_intervals
  GROUP BY meter_node_id
  ORDER BY meter_node_id
`;

const aggregationRuleForMeters = (
  meters: MeterAggregate[]
): EnergyScopeAnalysis["provenance"]["aggregationRule"] => {
  return aggregationRuleForRoles(meters.map((meter) => meter.meterRole));
};

const aggregationRuleForRoles = (
  roles: string[]
): EnergyScopeAnalysis["provenance"]["aggregationRule"] => {
  if (roles.some((role) => role === "total")) return "designated_total";
  if (roles.some((role) => role === "component")) return "component";
  if (roles.some((role) => role === "submeter")) return "submeter";
  return "none";
};

const meterNodeFilter = (meterNodeIds: string[]): string =>
  meterNodeIds.length > 0
    ? `source.meter_node_id IN (${meterNodeIds.map(sqlLiteral).join(", ")})`
    : "FALSE";

const numberAt = (row: unknown[], index: number): number => {
  const value = Number(row[index] ?? 0);
  return Number.isFinite(value) ? value : 0;
};

const stringAt = (row: unknown[], index: number): string =>
  typeof row[index] === "string" ? row[index] : String(row[index] ?? "");

const optionalStringAt = (row: unknown[], index: number): string | undefined => {
  const value = row[index];
  if (typeof value === "string" && value.length > 0) return value;
  if (value instanceof Date) return value.toISOString();
  return undefined;
};

const isoAt = (row: unknown[], index: number): string => {
  const value = row[index];
  if (typeof value === "number" || typeof value === "bigint") {
    return new Date(Number(value)).toISOString();
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  throw new Error(`ENERGYIQ_GOLDEN_TIMESTAMP_INVALID:${index}`);
};

const percent = (part: number, total: number, digits = 2): number =>
  total > 0 ? round((part / total) * 100, digits) : 0;

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

const maxBy = <T>(values: T[], score: (value: T) => number): T | undefined => {
  let best: T | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    const current = score(value);
    if (current > bestScore) {
      best = value;
      bestScore = current;
    }
  }
  return best;
};

const quoteIdentifier = (value: string): string =>
  `"${value.replaceAll('"', '""')}"`;

const sqlLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
