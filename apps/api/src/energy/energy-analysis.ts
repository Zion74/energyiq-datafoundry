import {
  ensureEnergyScopedDataSource,
  readEnergyFactCoverage,
  type LocalDataGateway
} from "@datafoundry/data-gateway";
import type {
  EnergyIqAnalysisInterval,
  EnergyIqMeterMappingRow,
  EnergyIqOperatingEvaluation,
  EnergyIqPolicyUnavailableReason,
  EnergyIqProjectSetupDocument,
  EnergyIqRuleRevisionRecord,
  EnergyIqTariffEvaluation,
  EnergyIqVirtualMeter,
  MetadataStore
} from "@datafoundry/metadata";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveEnergyPublishedMeterRoute,
  resolveEnergyPublishedHierarchyNodes,
  type EnergyQueryContext
} from "./energy-query-context.js";

export type EnergyDailyUsageAnomalies = {
  status: "available";
  bundleId: string;
  metricId: "energy.total_usage_kwh@1";
  queryId: "time_slot_anomaly_v1";
  ruleRevisionId: string;
  timezone: string;
  baselineCutoff: string;
  rule: {
    relativeThresholdPct: number;
    absoluteImpactKwh: number;
    minimumCoveragePct: number;
    minimumSampleCount: number;
    maximumQualityEventCount: number;
    maximumLookbackDays: number;
    direction: "above";
    baselineMethod: "mean_of_complete_comparable_days_by_local_hour";
  };
  evidencePins: {
    dataSnapshotId: string;
    hierarchyRevisionId: string;
    meterMappingRevisionId: string;
    meterFormulaRevisionId: string;
    metricVersion: string;
    queryIds: ["time_slot_anomaly_v1"];
  };
  scopes: Array<{
    scopeId: string;
    scopeName: string;
    scopeType: string;
    rows: Array<{
      anomalyId: string;
      incidentId: string;
      ruleRevisionId: string;
      metricId: "energy.total_usage_kwh@1";
      queryId: "time_slot_anomaly_v1";
      localDate: string;
      from: string;
      to: string;
      dayType: "weekday" | "weekend" | null;
      baselineDates: string[];
      baselineSampleCount: number;
      baselineSamples: Array<{
        localDate: string;
        coveragePct: number;
        expectedMeterIntervalCount: number;
        validIntervalCount: number;
        qualityEventCount: number;
        eligible: true;
      }>;
      actualKwh: number | null;
      baselineKwh: number | null;
      impactKwh: number | null;
      relativePct: number | null;
      thresholds: {
        relativeThresholdPct: number;
        absoluteImpactKwh: number;
        minimumCoveragePct: number;
        maximumQualityEventCount: number;
      };
      coveragePct: number;
      expectedMeterIntervalCount: number;
      validIntervalCount: number;
      qualityEventCount: number;
      outcome: "triggered" | "within_threshold" | "suppressed";
      suppressionReason?: {
        code: DailyUsageAnomalySuppressionCode;
        message: string;
      };
      hourlyComparison: Array<{
        localHour: number;
        actualKwh: number | null;
        baselineKwh: number | null;
        impactKwh: number | null;
        relativePct: number | null;
      }>;
      detailSeries: Array<{
        seriesId: string;
        relationship: "selected_scope" | "immediate_level" | "component_circuit";
        kind: "official_scope" | "component_circuit";
        scopeId: string;
        scopeName: string;
        meterNodeId?: string;
        category?: string;
        includedInOfficialTotal: boolean;
        status: "available" | "partial" | "unavailable";
        selectedTotalKwh: number | null;
        baselineTotalKwh: number | null;
        impactKwh: number | null;
        relativePct: number | null;
        coveragePct: number;
        expectedMeterIntervalCount: number;
        validIntervalCount: number;
        qualityEventCount: number;
        points: Array<{
          localHour: number;
          selectedKwh: number | null;
          baselineKwh: number | null;
          impactKwh: number | null;
        }>;
      }>;
    }>;
  }>;
} | {
  status: "unavailable";
  ruleRevisionId: string;
  reason: {
    code: "BUSINESS_CALENDAR_VERSION_MISSING"
      | "BUSINESS_CALENDAR_VERSION_NOT_FOUND"
      | "DAILY_USAGE_ANOMALY_RULE_INVALID";
    message: string;
  };
};

type DailyUsageAnomalySuppressionCode =
  | "CALENDAR_EXCEPTION_DATE"
  | "DAILY_FACTS_UNAVAILABLE"
  | "DAY_TYPE_CLASSIFICATION_UNAVAILABLE"
  | "COVERAGE_BELOW_THRESHOLD"
  | "QUALITY_EVENT_PRESENT"
  | "BASELINE_SAMPLE_COUNT_INSUFFICIENT"
  | "BASELINE_VALUE_UNAVAILABLE";

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
  dailyTotals?: {
    metricId: "energy.total_usage_kwh@1";
    grain: "day";
    timezone: string;
    scopes: Array<{
      scopeId: string;
      scopeName: string;
      scopeType: string;
      rows: Array<{
        localDate: string;
        from: string;
        to: string;
        usageKwh: number | null;
        dataHealth: {
          status: "complete" | "partial" | "unavailable";
          coveragePct: number;
          expectedMeterIntervalCount: number;
          validIntervalCount: number;
          qualityEventCount: number;
        };
      }>;
    }>;
  };
  timeBehaviour?: {
    metricId: "energy.total_usage_kwh@1";
    grain: "hour";
    unit: "kWh";
    timezone: string;
    queryId: "time_bucket_grid_v1";
    scopes: Array<{
      scopeId: string;
      scopeName: string;
      scopeType: string;
      cells: Array<{
        localDate: string;
        localHour: number;
        from: string;
        to: string;
        usageKwh: number | null;
        dataHealth: TimeBucketDataHealth;
      }>;
    }>;
    dayProfiles: Array<{
      dayType: "weekday" | "weekend";
      scopeId: string;
      scopeName: string;
      status: "available";
      sampleDayCount: number;
      values: Array<{
        localHour: number;
        usageKwh: number;
      }>;
    } | {
      dayType: "weekday" | "weekend" | "public_holiday";
      scopeId: string;
      scopeName: string;
      status: "unavailable";
      reason: {
        code: "COMPLETE_DAY_SAMPLE_UNAVAILABLE" | "DAY_TYPE_CLASSIFICATION_UNAVAILABLE";
        message: string;
      };
    }>;
  };
  dailyUsageAnomalies?: EnergyDailyUsageAnomalies;
  peakBreakdown?: {
    status: "available";
    metricId: "energy.peak_demand_kw@1";
    intervalMinutes: number;
    timezone: string;
    unit: "kW";
    periodStatus: "complete" | "partial";
    coveragePct: number;
    peak: {
      from: string;
      to: string;
      averageKw: number;
      dataHealth: PeakIntervalDataHealth;
    };
    levels: Array<{
      scopeId: string;
      scopeName: string;
      averageKw: number;
      sharePct: number;
      dataHealth: PeakIntervalDataHealth;
      circuits: Array<{
        meterNodeId: string;
        name: string;
        category: string;
        averageKw: number | null;
        sharePct: number | null;
        includedInOfficialTotal: false;
        dataHealth: PeakIntervalDataHealth;
      }>;
    }>;
  } | {
    status: "unavailable";
    reason: {
      code: "PEAK_AT_MISSING"
        | "PEAK_INTERVAL_FACTS_UNAVAILABLE"
        | "PEAK_INTERVAL_FACTS_AMBIGUOUS"
        | "PEAK_INTERVAL_FACTS_REJECTED";
      message: string;
    };
  };
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
    scopeId: string;
    parentScopeId?: string;
    name: string;
    appliance: string;
    category: string;
    meterRole: string;
    includedInOfficialTotal: boolean;
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
    nonOperatingKwh?: number;
    peakKw: number;
    qualityEventCount: number;
  }>;
  topCircuits: EnergyScopeAnalysis["circuits"];
  designatedTotals: EnergyScopeAnalysis["circuits"];
  componentReconciliation: {
    officialUsageKwh: number;
    componentUsageKwh: number;
    gapKwh: number;
    ratioPct: number | null;
    officialMeterNodeIds: string[];
    componentMeterNodeIds: string[];
  };
  virtualMeters: Array<{
    meterNodeId: string;
    name: string;
    scopeId: string;
    termMeterNodeIds: string[];
    usageKwh: number;
    includedInOfficialTotal: false;
  }>;
  virtualMeterTraces?: Array<{
    meterNodeId: string;
    name: string;
    scopeId: string;
    status: "available" | "partial";
    usageKwh: number | null;
    includedInOfficialTotal: false;
    terms: Array<{
      meterNodeId: string;
      name: string;
      coefficient: 1 | -1;
      inputUsageKwh: number | null;
      contributionKwh: number | null;
      dataHealth: {
        coveragePct: number;
        expectedMeterIntervalCount: number;
        validIntervalCount: number;
        qualityEventCount: number;
      } | null;
    }>;
    missingTermMeterNodeIds: string[];
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
    queryIds: Array<
      | "scope_summary_v1"
      | "hourly_profile_v1"
      | "daily_totals_v1"
      | "time_bucket_grid_v1"
      | "peak_breakdown_v1"
      | "meter_breakdown_v1"
      | "previous_meter_usage_v1"
      | "operational_policy_scope_intervals_v1"
      | "operational_policy_meter_intervals_v1"
      | "time_slot_anomaly_v1"
    >;
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

type PeakIntervalDataHealth = {
  status: "complete" | "unavailable";
  coveragePct: number;
  expectedMeterIntervalCount: number;
  validIntervalCount: number;
  qualityEventCount: number;
};

type TimeBucketDataHealth = {
  status: "complete" | "partial" | "unavailable";
  coveragePct: number;
  expectedMeterIntervalCount: number;
  validIntervalCount: number;
  qualityEventCount: number;
};

type DailyTotalScope = {
  scopeId: string;
  scopeName: string;
  scopeType: string;
  meterNodeIds: string[];
};

type DailyDateBucket = {
  localDate: string;
  from: string;
  to: string;
};

type PeakIntervalFact = {
  meterNodeId: string;
  intervalStart: string;
  intervalEnd: string;
  elapsedMinutes: number;
  averageKw: number | null;
  qualityStatus: string;
};

type OperationalIntervalSeries = {
  kind: "scope" | "meter";
  meterNodeId?: string;
  scopeId?: string;
  intervals: EnergyIqAnalysisInterval[];
};

type DailyUsageAnomalyRule = Extract<EnergyDailyUsageAnomalies, { status: "available" }>["rule"];

type DailyUsageAnomalySeriesDefinition = {
  seriesOrder: number;
  seriesId: string;
  kind: "official_scope" | "component_circuit";
  ownerScopeId: string;
  scopeId: string;
  scopeName: string;
  scopeType: string;
  meterNodeIds: string[];
  meterNodeId?: string;
  category?: string;
  includedInOfficialTotal: boolean;
};

type DailyUsageAnomalyHourFact = {
  localDate: string;
  localHour: number;
  usageKwh: number | null;
  validIntervalCount: number;
  qualityEventCount: number;
  dayType: string | null;
  dayTypeCount: number;
};

type DailyUsageAnomalyLoadResult = {
  status: "absent";
} | {
  status: "unavailable";
  bundle: Extract<EnergyDailyUsageAnomalies, { status: "unavailable" }>;
} | {
  status: "loaded";
  ruleRevisionId: string;
  rule: DailyUsageAnomalyRule;
  exceptionDates: Set<string>;
  series: DailyUsageAnomalySeriesDefinition[];
  rows: unknown[][];
};

type DailyUsageAnomalyDayFact = {
  localDate: string;
  dayType: "weekday" | "weekend" | null;
  coveragePct: number;
  validIntervalCount: number;
  expectedMeterIntervalCount: number;
  qualityEventCount: number;
  hours: Array<{
    localHour: number;
    usageKwh: number | null;
  }>;
  totalKwh: number | null;
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
  includeTimeBehaviour?: boolean;
}): Promise<EnergyScopeAnalysis> => {
  const ruleRevisions = input.ruleRevisions
    ?? input.metadataStore.energyIq.rules.listRevisions()
      .filter((rule) => rule.requirement !== "historical_baseline");
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
  const dailyTotalScopes = resolveDailyTotalScopes({
    metadataStore: input.metadataStore,
    projectId: input.context.projectId,
    hierarchyRevisionId: input.context.hierarchyRevisionId,
    meterMappingRevisionId: input.context.meterMappingRevisionId,
    resource: input.context.resource,
    selectedNode,
    hierarchy,
    meterAggregates,
    aggregateMeterNodeIds,
  });
  const dailyDateBuckets = buildDailyDateBuckets(input.context);
  const dailyUsageAnomalyLoadInput = {
    metadataStore: input.metadataStore,
    dataGateway: input.dataGateway,
    userId: input.userId,
    context: input.context,
    databasePath: scoped.databasePath,
    meterAttachments: publishedMeterRoute.attachments,
    ruleRevisions,
    dailyTotalScopes,
    hierarchy,
    meterAggregates,
  };
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
  // Keep Snapshot-backed scans in explicit bounded batches. The optional anomaly query runs in
  // its own final batch so enabling it cannot push the shared DuckDB connection fan-out above 3.
  const [summaryResult, profileResult, healthResult] = await Promise.all([
    input.dataGateway.runSqlReadonly({
      user_id: input.userId,
      workspace_id: input.context.workspaceId,
      datasource_id: scoped.datasourceId,
      sql: scopeSummarySql(scoped.viewName, aggregateMeterNodeIds),
    }),
    input.dataGateway.runSqlReadonly({
      user_id: input.userId,
      workspace_id: input.context.workspaceId,
      datasource_id: scoped.datasourceId,
      sql: hourlyProfileSql(scoped.viewName, aggregateMeterNodeIds),
    }),
    input.dataGateway.runSqlReadonly({
      user_id: input.userId,
      workspace_id: input.context.workspaceId,
      datasource_id: scoped.datasourceId,
      sql: scopeHealthSql(scoped.viewName, aggregateMeterNodeIds),
    }),
  ]);
  const [dailyTotalsResult, timeBucketGridResult, previousMeterUsageResult] = await Promise.all([
    input.dataGateway.runSqlReadonly({
      user_id: input.userId,
      workspace_id: input.context.workspaceId,
      datasource_id: scoped.datasourceId,
      sql: dailyTotalsSql(scoped.viewName, dailyTotalScopes),
      limit: Math.max(1, dailyTotalScopes.length * dailyDateBuckets.length),
    }),
    input.includeTimeBehaviour === false
      ? Promise.resolve(undefined)
      : input.dataGateway.runSqlReadonly({
          user_id: input.userId,
          workspace_id: input.context.workspaceId,
          datasource_id: scoped.datasourceId,
          sql: timeBucketGridSql(scoped.viewName, dailyTotalScopes),
          limit: Math.max(1, dailyTotalScopes.length),
        }),
    input.dataGateway.runSqlReadonly({
      user_id: input.userId,
      workspace_id: input.context.workspaceId,
      datasource_id: previousScoped.datasourceId,
      sql: previousMeterUsageSql(
        previousScoped.viewName,
        meterAggregates.map((meter) => meter.meterNodeId),
      ),
      limit: 1000,
    }),
  ]);
  const peakAtForBreakdown = optionalStringAt(summaryResult.rows[0] ?? [], 2);
  const [
    peakBreakdownResult,
    operationalScopeIntervalResult,
    operationalMeterIntervalResult,
  ] = await Promise.all([
    input.dataGateway.runSqlReadonly({
      user_id: input.userId,
      workspace_id: input.context.workspaceId,
      datasource_id: scoped.datasourceId,
      sql: peakBreakdownSql(scoped.viewName, peakAtForBreakdown),
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
  const dailyUsageAnomalyLoad = await loadDailyUsageAnomalyFacts(dailyUsageAnomalyLoadInput);
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
  const dailyFactsByScopeAndDate = new Map(
    dailyTotalsResult.rows.map((row) => [`${stringAt(row, 0)}:${stringAt(row, 3)}`, row]),
  );
  const dailyTotals: NonNullable<EnergyScopeAnalysis["dailyTotals"]> = {
    metricId: "energy.total_usage_kwh@1",
    grain: "day",
    timezone: input.context.timezone,
    scopes: dailyTotalScopes.map((scope) => ({
      scopeId: scope.scopeId,
      scopeName: scope.scopeName,
      scopeType: scope.scopeType,
      rows: dailyDateBuckets.map((bucket) => {
        const row = dailyFactsByScopeAndDate.get(`${scope.scopeId}:${bucket.localDate}`);
        const validIntervalCount = row ? numberAt(row, 5) : 0;
        const qualityEventCount = row ? numberAt(row, 6) : 0;
        const expectedMeterIntervalCount = scope.meterNodeIds.length * Math.round(
          (Date.parse(bucket.to) - Date.parse(bucket.from)) / (intervalMinutes * 60_000),
        );
        const status = validIntervalCount === 0
          ? "unavailable" as const
          : validIntervalCount === expectedMeterIntervalCount && qualityEventCount === 0
            ? "complete" as const
            : "partial" as const;
        return {
          localDate: bucket.localDate,
          from: bucket.from,
          to: bucket.to,
          usageKwh: row && row[4] !== null && row[4] !== undefined
            ? round(numberAt(row, 4), 4)
            : null,
          dataHealth: {
            status,
            coveragePct: expectedMeterIntervalCount > 0
              ? round(Math.min(validIntervalCount / expectedMeterIntervalCount, 1) * 100, 4)
              : 0,
            expectedMeterIntervalCount,
            validIntervalCount,
            qualityEventCount,
          },
        };
      }),
    })),
  };
  const timeBehaviour = timeBucketGridResult
    ? buildTimeBehaviour({
        timezone: input.context.timezone,
        scopes: dailyTotalScopes,
        dateBuckets: dailyDateBuckets,
        intervalMinutes,
        rows: timeBucketGridResult.rows,
      })
    : undefined;
  const dailyUsageAnomalies = buildDailyUsageAnomalies({
    load: dailyUsageAnomalyLoad,
    context: input.context,
    dateBuckets: dailyDateBuckets,
    intervalMinutes,
  });
  const previousMeterUsageById = new Map(
    previousMeterUsageResult.rows.map((row) => [stringAt(row, 0), numberAt(row, 1)]),
  );
  const previousUsageKwh = aggregateMeterNodeIds
    .reduce((sum, meterNodeId) => sum + (previousMeterUsageById.get(meterNodeId) ?? 0), 0);
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
  const expectedIntervalCountPerMeter = Math.round(
    periodDurationMs / (intervalMinutes * 60_000),
  );
  const expectedMeterIntervalCount = aggregateMeterNodeIds.length * expectedIntervalCountPerMeter;
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
    previousMeterUsageById,
    scopeUsageKwh: usageKwh,
    periodDurationMs,
    intervalMinutes,
  });
  const hierarchyById = new Map(hierarchy.map((node) => [node.id, node]));
  const circuits = meterAggregates
    .map((meter) => {
      const meterOperating = circuitOperatingByMeterId.get(meter.meterNodeId);
      const parentScopeId = hierarchyById.get(meter.scopeId)?.parent_id;
      const previousMeterUsageKwh = previousMeterUsageById.get(meter.meterNodeId) ?? 0;
      const changeKwh = meter.usageKwh - previousMeterUsageKwh;
      const expectedCircuitIntervalCount = expectedIntervalCountPerMeter;
      return {
        meterNodeId: meter.meterNodeId,
        scopeId: meter.scopeId,
        ...(parentScopeId ? { parentScopeId } : {}),
        name: meter.name,
        appliance: meter.appliance,
        category: meter.category,
        meterRole: meter.meterRole,
        includedInOfficialTotal: aggregateMeterIds.has(meter.meterNodeId),
        usageKwh: round(meter.usageKwh, 4),
        sharePct: percent(meter.usageKwh, usageKwh, 4),
        comparison: {
          usageKwh: round(previousMeterUsageKwh, 4),
          changeKwh: round(changeKwh, 4),
          changePct: previousMeterUsageKwh > 0
            ? round((changeKwh / previousMeterUsageKwh) * 100, 4)
            : null,
        },
        dataHealth: {
          coveragePct: expectedCircuitIntervalCount > 0
            ? round(Math.min(meter.validIntervalCount / expectedCircuitIntervalCount, 1) * 100, 4)
            : 0,
          expectedMeterIntervalCount: expectedCircuitIntervalCount,
          validIntervalCount: meter.validIntervalCount,
          qualityEventCount: meter.qualityEventCount,
        },
        ...(meterOperating?.status === "available"
          ? { nonOperatingKwh: round(meterOperating.standby_kwh, 4) }
          : {}),
        peakKw: round(meter.peakKw, 4),
        qualityEventCount: meter.qualityEventCount
      };
    })
    .sort((left, right) => right.usageKwh - left.usageKwh);
  const designatedTotals = circuits.filter((meter) => meter.includedInOfficialTotal);
  const topCircuits = circuits.filter((meter) => !meter.includedInOfficialTotal);
  const categoryMeters = new Map<string, MeterAggregate[]>();
  for (const meter of aggregateMeters) {
    categoryMeters.set(meter.category, [...(categoryMeters.get(meter.category) ?? []), meter]);
  }
  const categories = [...categoryMeters.entries()]
    .map(([category, meters]) => {
      const categoryUsageKwh = meters.reduce((sum, meter) => sum + meter.usageKwh, 0);
      const previousCategoryUsageKwh = meters.reduce(
        (sum, meter) => sum + (previousMeterUsageById.get(meter.meterNodeId) ?? 0),
        0,
      );
      const changeKwh = categoryUsageKwh - previousCategoryUsageKwh;
      const expectedCategoryIntervalCount = meters.length * expectedIntervalCountPerMeter;
      const validCategoryIntervalCount = meters.reduce(
        (sum, meter) => sum + meter.validIntervalCount,
        0,
      );
      const categoryQualityEventCount = meters.reduce(
        (sum, meter) => sum + meter.qualityEventCount,
        0,
      );
      return {
        category,
        usageKwh: round(categoryUsageKwh, 4),
        sharePct: percent(categoryUsageKwh, usageKwh, 4),
        comparison: {
          usageKwh: round(previousCategoryUsageKwh, 4),
          changeKwh: round(changeKwh, 4),
          changePct: previousCategoryUsageKwh > 0
            ? round((changeKwh / previousCategoryUsageKwh) * 100, 4)
            : null,
        },
        dataHealth: {
          coveragePct: expectedCategoryIntervalCount > 0
            ? round(
              Math.min(validCategoryIntervalCount / expectedCategoryIntervalCount, 1) * 100,
              4,
            )
            : 0,
          expectedMeterIntervalCount: expectedCategoryIntervalCount,
          validIntervalCount: validCategoryIntervalCount,
          qualityEventCount: categoryQualityEventCount,
        },
      };
    })
    .sort((left, right) => right.usageKwh - left.usageKwh);
  const officialUsageKwh = aggregateMeters.reduce((sum, meter) => sum + meter.usageKwh, 0);
  const componentUsageKwh = meterAggregates
    .filter((meter) => !aggregateMeterIds.has(meter.meterNodeId))
    .reduce((sum, meter) => sum + meter.usageKwh, 0);
  const componentReconciliation: EnergyScopeAnalysis["componentReconciliation"] = {
    officialUsageKwh: round(officialUsageKwh, 4),
    componentUsageKwh: round(componentUsageKwh, 4),
    gapKwh: round(officialUsageKwh - componentUsageKwh, 4),
    ratioPct: officialUsageKwh > 0
      ? round((componentUsageKwh / officialUsageKwh) * 100, 4)
      : null,
    officialMeterNodeIds: [...aggregateMeterNodeIds].sort(),
    componentMeterNodeIds: meterAggregates
      .filter((meter) => !aggregateMeterIds.has(meter.meterNodeId))
      .map((meter) => meter.meterNodeId)
      .sort(),
  };
  const virtualMeters = buildVirtualMeters({
    metadataStore: input.metadataStore,
    projectId: input.context.projectId,
    hierarchyRevisionId: input.context.hierarchyRevisionId,
    resource: input.context.resource,
    selectedScopeId: selectedNode.id,
    hierarchy,
    circuits
  });
  const virtualMeterTraces = buildVirtualMeterTraces({
    metadataStore: input.metadataStore,
    projectId: input.context.projectId,
    hierarchyRevisionId: input.context.hierarchyRevisionId,
    resource: input.context.resource,
    selectedScopeId: selectedNode.id,
    hierarchy,
    circuits,
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
  const peakBreakdown = selectedNode.node_type === "project"
    ? buildPeakBreakdown({
        ...(peakAt ? { peakAt } : {}),
        peakKw,
        intervalMinutes,
        timezone: input.context.timezone,
        periodStatus: dataHealth.status === "complete" ? "complete" : "partial",
        coveragePct: dataHealth.coveragePct,
        projectOfficialMeterNodeIds: aggregateMeterNodeIds,
        levelScopes: dailyTotalScopes.slice(1),
        hierarchy,
        meterAggregates,
        facts: peakBreakdownResult.rows.map(rowToPeakIntervalFact),
      })
    : undefined;
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
    dailyTotals,
    ...(timeBehaviour ? { timeBehaviour } : {}),
    ...(dailyUsageAnomalies ? { dailyUsageAnomalies } : {}),
    ...(peakBreakdown ? { peakBreakdown } : {}),
    categories,
    childScopes,
    circuits,
    topCircuits,
    designatedTotals,
    componentReconciliation,
    virtualMeters,
    ...(virtualMeterTraces.length > 0 ? { virtualMeterTraces } : {}),
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
        "daily_totals_v1",
        ...(timeBucketGridResult ? ["time_bucket_grid_v1" as const] : []),
        "peak_breakdown_v1",
        "meter_breakdown_v1",
        "previous_meter_usage_v1",
        "operational_policy_scope_intervals_v1",
        "operational_policy_meter_intervals_v1",
        ...(dailyUsageAnomalyLoad.status === "loaded" ? ["time_slot_anomaly_v1" as const] : []),
      ]
    }
  };
};

const loadDailyUsageAnomalyFacts = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  userId: string;
  context: EnergyQueryContext;
  databasePath: string;
  meterAttachments: Array<{
    meterPointId: string;
    scopeId: string;
    officialAggregation: boolean;
  }>;
  ruleRevisions: readonly EnergyIqRuleRevisionRecord[];
  dailyTotalScopes: DailyTotalScope[];
  hierarchy: ReturnType<MetadataStore["energyIq"]["listProjectNodes"]>;
  meterAggregates: MeterAggregate[];
}): Promise<DailyUsageAnomalyLoadResult> => {
  const matchingRules = input.ruleRevisions.filter(
    (rule) => rule.evaluation_key === "DAILY_USAGE_ABOVE_BASELINE",
  );
  if (matchingRules.length === 0) return { status: "absent" };
  const ruleRevision = matchingRules[0]!;
  if (matchingRules.length !== 1) {
    return dailyUsageAnomalyRuleUnavailable(
      ruleRevision.revision_id,
      "Daily usage anomaly evaluation requires exactly one pinned Rule Revision.",
    );
  }
  const rule = parseDailyUsageAnomalyRule(ruleRevision);
  if (!rule) {
    return dailyUsageAnomalyRuleUnavailable(
      ruleRevision.revision_id,
      "The pinned daily usage anomaly Rule Revision has invalid parameters.",
    );
  }
  const calendarVersion = input.context.businessCalendarVersion.trim();
  if (!calendarVersion) {
    return {
      status: "unavailable",
      bundle: {
        status: "unavailable",
        ruleRevisionId: ruleRevision.revision_id,
        reason: {
          code: "BUSINESS_CALENDAR_VERSION_MISSING",
          message: "A release-pinned Business Calendar is required for daily usage anomalies.",
        },
      },
    };
  }
  const calendar = input.metadataStore.energyIq.operationalPolicy
    .listOperatingCalendars(input.context.projectId)
    .find((candidate) => candidate.version_id === calendarVersion);
  if (!calendar) {
    return {
      status: "unavailable",
      bundle: {
        status: "unavailable",
        ruleRevisionId: ruleRevision.revision_id,
        reason: {
          code: "BUSINESS_CALENDAR_VERSION_NOT_FOUND",
          message: `Business Calendar ${calendarVersion} is not published for this Project.`,
        },
      },
    };
  }
  const series = buildDailyUsageAnomalySeries({
    dailyTotalScopes: input.dailyTotalScopes,
    hierarchy: input.hierarchy,
    meterAggregates: input.meterAggregates,
  });
  if (series.length === 0) return { status: "absent" };
  const baselineCutoff = formatLocalDate(input.context.from, input.context.timezone);
  const historicalFrom = zonedStartOfLocalDay(
    shiftLocalDate(baselineCutoff, -rule.maximumLookbackDays),
    input.context.timezone,
  );
  const historicalScoped = await ensureEnergyScopedDataSource({
    metadataStore: input.metadataStore,
    userId: input.userId,
    context: {
      workspaceId: input.context.workspaceId,
      projectId: input.context.projectId,
      scopeId: input.context.scopeId,
      meterAttachments: input.meterAttachments,
      resource: input.context.resource,
      from: historicalFrom,
      to: input.context.to,
      timezone: input.context.timezone,
      hierarchyRevisionId: input.context.hierarchyRevisionId,
      meterMappingRevisionId: input.context.meterMappingRevisionId,
      meterFormulaRevisionId: input.context.meterFormulaRevisionId,
      dataSnapshotId: input.context.dataSnapshotId,
      metricVersion: input.context.metricVersion,
    },
    databasePath: input.databasePath,
  });
  const result = await input.dataGateway.runSqlReadonly({
    user_id: input.userId,
    workspace_id: input.context.workspaceId,
    datasource_id: historicalScoped.datasourceId,
    sql: dailyUsageAnomalySql(historicalScoped.viewName, series),
    limit: Math.max(1, series.length),
  });
  return {
    status: "loaded",
    ruleRevisionId: ruleRevision.revision_id,
    rule,
    exceptionDates: new Set(calendar.entries.flatMap(
      (entry) => (entry.exceptions ?? []).map((exception) => exception.date),
    )),
    series,
    rows: result.rows,
  };
};

const dailyUsageAnomalyRuleUnavailable = (
  ruleRevisionId: string,
  message: string,
): Extract<DailyUsageAnomalyLoadResult, { status: "unavailable" }> => ({
  status: "unavailable",
  bundle: {
    status: "unavailable",
    ruleRevisionId,
    reason: { code: "DAILY_USAGE_ANOMALY_RULE_INVALID", message },
  },
});

const parseDailyUsageAnomalyRule = (
  revision: EnergyIqRuleRevisionRecord,
): DailyUsageAnomalyRule | null => {
  const numberParameter = (key: string): number | null => {
    const value = revision.parameters[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  const relativeThresholdPct = numberParameter("relative_threshold_pct");
  const absoluteImpactKwh = numberParameter("absolute_impact_kwh");
  const minimumCoveragePct = numberParameter("minimum_coverage_pct");
  const minimumSampleCount = numberParameter("minimum_sample_count");
  const maximumQualityEventCount = numberParameter("maximum_quality_event_count");
  const maximumLookbackDays = numberParameter("maximum_lookback_days");
  if (relativeThresholdPct === null
    || absoluteImpactKwh === null
    || minimumCoveragePct === null
    || minimumSampleCount === null
    || maximumQualityEventCount === null
    || maximumLookbackDays === null
    || relativeThresholdPct < 0
    || absoluteImpactKwh < 0
    || minimumCoveragePct < 0
    || minimumCoveragePct > 100
    || !Number.isSafeInteger(minimumSampleCount)
    || minimumSampleCount < 1
    || !Number.isSafeInteger(maximumQualityEventCount)
    || maximumQualityEventCount < 0
    || !Number.isSafeInteger(maximumLookbackDays)
    || maximumLookbackDays < 1
    || revision.parameters.direction !== "above"
    || revision.parameters.baseline_method !== "mean_of_complete_comparable_days_by_local_hour") {
    return null;
  }
  return {
    relativeThresholdPct,
    absoluteImpactKwh,
    minimumCoveragePct,
    minimumSampleCount,
    maximumQualityEventCount,
    maximumLookbackDays,
    direction: "above",
    baselineMethod: "mean_of_complete_comparable_days_by_local_hour",
  };
};

const buildDailyUsageAnomalySeries = (input: {
  dailyTotalScopes: DailyTotalScope[];
  hierarchy: ReturnType<MetadataStore["energyIq"]["listProjectNodes"]>;
  meterAggregates: MeterAggregate[];
}): DailyUsageAnomalySeriesDefinition[] => {
  const hierarchyById = new Map(input.hierarchy.map((node) => [node.id, node]));
  const levelScopeIds = new Set(
    input.dailyTotalScopes
      .filter((scope) => scope.scopeType === "level")
      .map((scope) => scope.scopeId),
  );
  const officialMeterNodeIds = new Set(
    input.dailyTotalScopes.flatMap((scope) => scope.meterNodeIds),
  );
  const official = input.dailyTotalScopes
    .filter((scope) => scope.scopeType === "project" || scope.scopeType === "level")
    .sort((left, right) => {
      if (left.scopeId === right.scopeId) return 0;
      if (left.scopeId === input.dailyTotalScopes[0]?.scopeId) return -1;
      if (right.scopeId === input.dailyTotalScopes[0]?.scopeId) return 1;
      return (hierarchyById.get(left.scopeId)?.sort_order ?? 0)
        - (hierarchyById.get(right.scopeId)?.sort_order ?? 0)
        || left.scopeId.localeCompare(right.scopeId);
    })
    .map((scope): DailyUsageAnomalySeriesDefinition => ({
      seriesOrder: 0,
      seriesId: `scope:${scope.scopeId}`,
      kind: "official_scope",
      ownerScopeId: scope.scopeId,
      scopeId: scope.scopeId,
      scopeName: scope.scopeName,
      scopeType: scope.scopeType,
      meterNodeIds: scope.meterNodeIds,
      includedInOfficialTotal: true,
    }));
  const components = input.meterAggregates
    .filter((meter) => {
      const parentScopeId = hierarchyById.get(meter.scopeId)?.parent_id;
      return !officialMeterNodeIds.has(meter.meterNodeId)
        && parentScopeId !== undefined
        && levelScopeIds.has(parentScopeId);
    })
    .sort((left, right) => {
      const leftNode = hierarchyById.get(left.scopeId);
      const rightNode = hierarchyById.get(right.scopeId);
      const leftParent = leftNode?.parent_id ? hierarchyById.get(leftNode.parent_id) : undefined;
      const rightParent = rightNode?.parent_id ? hierarchyById.get(rightNode.parent_id) : undefined;
      return (leftParent?.sort_order ?? 0) - (rightParent?.sort_order ?? 0)
        || (leftNode?.sort_order ?? 0) - (rightNode?.sort_order ?? 0)
        || left.meterNodeId.localeCompare(right.meterNodeId);
    })
    .map((meter): DailyUsageAnomalySeriesDefinition => {
      const parentScopeId = hierarchyById.get(meter.scopeId)?.parent_id;
      if (!parentScopeId) throw new Error(`ENERGYIQ_ANOMALY_COMPONENT_PARENT_MISSING:${meter.scopeId}`);
      return {
        seriesOrder: 0,
        seriesId: `meter:${meter.meterNodeId}`,
        kind: "component_circuit",
        ownerScopeId: parentScopeId,
        scopeId: meter.scopeId,
        scopeName: meter.name,
        scopeType: "circuit",
        meterNodeIds: [meter.meterNodeId],
        meterNodeId: meter.meterNodeId,
        category: meter.category,
        includedInOfficialTotal: false,
      };
    });
  return official.flatMap((scope) => [
    scope,
    ...components.filter((component) => component.ownerScopeId === scope.scopeId),
  ]).map((series, seriesOrder) => ({ ...series, seriesOrder }));
};

const buildDailyUsageAnomalies = (input: {
  load: DailyUsageAnomalyLoadResult;
  context: EnergyQueryContext;
  dateBuckets: DailyDateBucket[];
  intervalMinutes: number;
}): EnergyDailyUsageAnomalies | undefined => {
  if (input.load.status === "absent") return undefined;
  if (input.load.status === "unavailable") return input.load.bundle;
  const load = input.load;
  const factsBySeriesId = new Map<string, DailyUsageAnomalyHourFact[]>(load.rows.map((row) => [
    stringAt(row, 0),
    parseDailyUsageAnomalyFacts(stringAt(row, 1)),
  ]));
  const daysBySeriesId = new Map<string, Map<string, DailyUsageAnomalyDayFact>>(
    load.series.map((series) => [
    series.seriesId,
    buildDailyUsageAnomalyDays({
      facts: factsBySeriesId.get(series.seriesId) ?? [],
      meterCount: series.meterNodeIds.length,
      intervalMinutes: input.intervalMinutes,
    }),
    ]),
  );
  const baselineCutoff = formatLocalDate(input.context.from, input.context.timezone);
  const earliestBaselineDate = shiftLocalDate(
    baselineCutoff,
    -load.rule.maximumLookbackDays,
  );
  const officialSeries = load.series.filter((series) => series.kind === "official_scope");
  return {
    status: "available",
    bundleId: [
      "daily-usage-anomalies",
      input.context.dataSnapshotId,
      input.context.scopeId,
      input.context.from,
      input.context.to,
      load.ruleRevisionId,
    ].join(":"),
    metricId: "energy.total_usage_kwh@1",
    queryId: "time_slot_anomaly_v1",
    ruleRevisionId: load.ruleRevisionId,
    timezone: input.context.timezone,
    baselineCutoff,
    rule: load.rule,
    evidencePins: {
      dataSnapshotId: input.context.dataSnapshotId,
      hierarchyRevisionId: input.context.hierarchyRevisionId,
      meterMappingRevisionId: input.context.meterMappingRevisionId,
      meterFormulaRevisionId: input.context.meterFormulaRevisionId,
      metricVersion: input.context.metricVersion,
      queryIds: ["time_slot_anomaly_v1"],
    },
    scopes: officialSeries.map((series) => {
      const days = daysBySeriesId.get(series.seriesId)
        ?? new Map<string, DailyUsageAnomalyDayFact>();
      const baselineDatesByDayType = new Map<"weekday" | "weekend", string[]>(
        (["weekday", "weekend"] as const).map((dayType) => [
          dayType,
          [...days.values()]
            .filter((day) => day.localDate >= earliestBaselineDate
              && day.localDate < baselineCutoff
              && day.dayType === dayType
              && !load.exceptionDates.has(day.localDate)
              && day.coveragePct >= load.rule.minimumCoveragePct
              && day.qualityEventCount <= load.rule.maximumQualityEventCount
              && day.totalKwh !== null
              && day.hours.every((hour) => hour.usageKwh !== null))
            .sort((left, right) => right.localDate.localeCompare(left.localDate))
            .slice(0, load.rule.minimumSampleCount)
            .map((day) => day.localDate)
            .sort((left, right) => left.localeCompare(right)),
        ]),
      );
      return {
        scopeId: series.scopeId,
        scopeName: series.scopeName,
        scopeType: series.scopeType,
        rows: input.dateBuckets.map((bucket) => buildDailyUsageAnomalyRow({
          dateBucket: bucket,
          series,
          allSeries: load.series,
          daysBySeriesId,
          baselineDatesByDayType,
          exceptionDates: load.exceptionDates,
          rule: load.rule,
          ruleRevisionId: load.ruleRevisionId,
          context: input.context,
        })),
      };
    }),
  };
};

const buildDailyUsageAnomalyRow = (input: {
  dateBucket: DailyDateBucket;
  series: DailyUsageAnomalySeriesDefinition;
  allSeries: DailyUsageAnomalySeriesDefinition[];
  daysBySeriesId: Map<string, Map<string, DailyUsageAnomalyDayFact>>;
  baselineDatesByDayType: Map<"weekday" | "weekend", string[]>;
  exceptionDates: Set<string>;
  rule: DailyUsageAnomalyRule;
  ruleRevisionId: string;
  context: EnergyQueryContext;
}): Extract<EnergyDailyUsageAnomalies, { status: "available" }>["scopes"][number]["rows"][number] => {
  const days = input.daysBySeriesId.get(input.series.seriesId)
    ?? new Map<string, DailyUsageAnomalyDayFact>();
  const selectedDay = days.get(input.dateBucket.localDate)
    ?? emptyDailyUsageAnomalyDay(input.dateBucket.localDate);
  const baselineDates = selectedDay.dayType
    ? input.baselineDatesByDayType.get(selectedDay.dayType) ?? []
    : [];
  const baselineHours = meanDailyUsageAnomalyHours(days, baselineDates);
  const baselineKwh = baselineHours.every((value) => value !== null)
    ? baselineHours.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null;
  const actualKwh = selectedDay.totalKwh;
  const impactKwh = actualKwh !== null && baselineKwh !== null
    ? actualKwh - baselineKwh
    : null;
  const relativePct = impactKwh !== null && baselineKwh !== null && baselineKwh > 0
    ? impactKwh / baselineKwh * 100
    : null;
  const suppressionReason = dailyUsageAnomalySuppressionReason({
    localDate: input.dateBucket.localDate,
    selectedDay,
    baselineDates,
    baselineKwh,
    exceptionDates: input.exceptionDates,
    rule: input.rule,
  });
  const outcome = suppressionReason
    ? "suppressed" as const
    : impactKwh !== null
      && relativePct !== null
      && actualKwh !== null
      && baselineKwh !== null
      && actualKwh > baselineKwh
      && impactKwh >= input.rule.absoluteImpactKwh
      && relativePct >= input.rule.relativeThresholdPct
      ? "triggered" as const
      : "within_threshold" as const;
  return {
    anomalyId: [
      "daily-usage-above-baseline",
      input.series.scopeId,
      input.dateBucket.localDate,
    ].join(":"),
    incidentId: [
      "daily-usage-above-baseline",
      input.context.dataSnapshotId,
      input.ruleRevisionId,
      input.series.scopeId,
      formatLocalDate(input.context.from, input.context.timezone),
      input.dateBucket.localDate,
    ].join(":"),
    ruleRevisionId: input.ruleRevisionId,
    metricId: "energy.total_usage_kwh@1",
    queryId: "time_slot_anomaly_v1",
    localDate: input.dateBucket.localDate,
    from: input.dateBucket.from,
    to: input.dateBucket.to,
    dayType: selectedDay.dayType,
    baselineDates,
    baselineSampleCount: baselineDates.length,
    baselineSamples: baselineDates.map((localDate) => {
      const sample = days.get(localDate) ?? emptyDailyUsageAnomalyDay(localDate);
      return {
        localDate,
        coveragePct: round(sample.coveragePct, 4),
        expectedMeterIntervalCount: sample.expectedMeterIntervalCount,
        validIntervalCount: sample.validIntervalCount,
        qualityEventCount: sample.qualityEventCount,
        eligible: true as const,
      };
    }),
    actualKwh: nullableRound(actualKwh),
    baselineKwh: nullableRound(baselineKwh),
    impactKwh: nullableRound(impactKwh),
    relativePct: nullableRound(relativePct),
    thresholds: {
      relativeThresholdPct: input.rule.relativeThresholdPct,
      absoluteImpactKwh: input.rule.absoluteImpactKwh,
      minimumCoveragePct: input.rule.minimumCoveragePct,
      maximumQualityEventCount: input.rule.maximumQualityEventCount,
    },
    coveragePct: round(selectedDay.coveragePct, 4),
    expectedMeterIntervalCount: selectedDay.expectedMeterIntervalCount,
    validIntervalCount: selectedDay.validIntervalCount,
    qualityEventCount: selectedDay.qualityEventCount,
    outcome,
    ...(suppressionReason ? { suppressionReason } : {}),
    hourlyComparison: Array.from({ length: 24 }, (_, localHour) => {
      const actual = selectedDay.hours[localHour]?.usageKwh ?? null;
      const baseline = baselineHours[localHour] ?? null;
      const impact = actual !== null && baseline !== null ? actual - baseline : null;
      return {
        localHour,
        actualKwh: nullableRound(actual),
        baselineKwh: nullableRound(baseline),
        impactKwh: nullableRound(impact),
        relativePct: impact !== null && baseline !== null && baseline > 0
          ? round(impact / baseline * 100, 4)
          : null,
      };
    }),
    detailSeries: input.allSeries
      .filter((series) => input.series.scopeType === "project"
        || series.ownerScopeId === input.series.scopeId)
      .map((series) => buildDailyUsageAnomalyDetailSeries({
        series,
        selectedScopeId: input.series.scopeId,
        localDate: input.dateBucket.localDate,
        baselineDates,
        days: input.daysBySeriesId.get(series.seriesId) ?? new Map(),
        rule: input.rule,
      })),
  };
};

const dailyUsageAnomalySuppressionReason = (input: {
  localDate: string;
  selectedDay: DailyUsageAnomalyDayFact;
  baselineDates: string[];
  baselineKwh: number | null;
  exceptionDates: Set<string>;
  rule: DailyUsageAnomalyRule;
}): { code: DailyUsageAnomalySuppressionCode; message: string } | undefined => {
  if (input.exceptionDates.has(input.localDate)) {
    return {
      code: "CALENDAR_EXCEPTION_DATE",
      message: "The release-pinned Business Calendar marks this local date as an exception.",
    };
  }
  if (input.selectedDay.validIntervalCount === 0 || input.selectedDay.totalKwh === null) {
    return {
      code: "DAILY_FACTS_UNAVAILABLE",
      message: "Accepted interval facts are unavailable for this local date.",
    };
  }
  if (input.selectedDay.dayType === null) {
    return {
      code: "DAY_TYPE_CLASSIFICATION_UNAVAILABLE",
      message: "Accepted facts do not provide one consistent weekday or weekend classification.",
    };
  }
  if (input.selectedDay.coveragePct < input.rule.minimumCoveragePct) {
    return {
      code: "COVERAGE_BELOW_THRESHOLD",
      message: `Daily coverage is below ${input.rule.minimumCoveragePct}%.`,
    };
  }
  if (input.selectedDay.qualityEventCount > input.rule.maximumQualityEventCount) {
    return {
      code: "QUALITY_EVENT_PRESENT",
      message: "Daily quality events exceed the pinned Rule threshold.",
    };
  }
  if (input.baselineDates.length < input.rule.minimumSampleCount) {
    return {
      code: "BASELINE_SAMPLE_COUNT_INSUFFICIENT",
      message: `Fewer than ${input.rule.minimumSampleCount} complete comparable dates are available.`,
    };
  }
  if (input.baselineKwh === null || input.baselineKwh <= 0) {
    return {
      code: "BASELINE_VALUE_UNAVAILABLE",
      message: "The frozen hourly baseline is unavailable or non-positive.",
    };
  }
  return undefined;
};

const buildDailyUsageAnomalyDetailSeries = (input: {
  series: DailyUsageAnomalySeriesDefinition;
  selectedScopeId: string;
  localDate: string;
  baselineDates: string[];
  days: Map<string, DailyUsageAnomalyDayFact>;
  rule: DailyUsageAnomalyRule;
}): Extract<EnergyDailyUsageAnomalies, { status: "available" }>["scopes"][number]["rows"][number]["detailSeries"][number] => {
  const selectedDay = input.days.get(input.localDate) ?? emptyDailyUsageAnomalyDay(input.localDate);
  const baselineHours = meanDailyUsageAnomalyHours(input.days, input.baselineDates);
  const baselineTotal = baselineHours.every((value) => value !== null)
    ? baselineHours.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null;
  const selectedTotal = selectedDay.totalKwh;
  const impact = selectedTotal !== null && baselineTotal !== null
    ? selectedTotal - baselineTotal
    : null;
  const relativePct = impact !== null && baselineTotal !== null && baselineTotal > 0
    ? impact / baselineTotal * 100
    : null;
  const selectedHoursAvailable = selectedDay.hours.every((hour) => hour.usageKwh !== null);
  const baselineAvailable = input.baselineDates.length === input.rule.minimumSampleCount
    && baselineHours.every((value) => value !== null);
  const status = selectedDay.validIntervalCount === 0
    ? "unavailable" as const
    : selectedHoursAvailable
      && baselineAvailable
      && selectedDay.coveragePct >= input.rule.minimumCoveragePct
      && selectedDay.qualityEventCount <= input.rule.maximumQualityEventCount
      ? "available" as const
      : "partial" as const;
  return {
    seriesId: input.series.seriesId,
    relationship: input.series.kind === "component_circuit"
      ? "component_circuit"
      : input.series.scopeId === input.selectedScopeId
        ? "selected_scope"
        : "immediate_level",
    kind: input.series.kind,
    scopeId: input.series.scopeId,
    scopeName: input.series.scopeName,
    ...(input.series.meterNodeId ? { meterNodeId: input.series.meterNodeId } : {}),
    ...(input.series.category ? { category: input.series.category } : {}),
    includedInOfficialTotal: input.series.includedInOfficialTotal,
    status,
    selectedTotalKwh: nullableRound(selectedTotal),
    baselineTotalKwh: nullableRound(baselineTotal),
    impactKwh: nullableRound(impact),
    relativePct: nullableRound(relativePct),
    coveragePct: round(selectedDay.coveragePct, 4),
    expectedMeterIntervalCount: selectedDay.expectedMeterIntervalCount,
    validIntervalCount: selectedDay.validIntervalCount,
    qualityEventCount: selectedDay.qualityEventCount,
    points: Array.from({ length: 24 }, (_, localHour) => {
      const selectedKwh = selectedDay.hours[localHour]?.usageKwh ?? null;
      const baselineKwh = baselineHours[localHour] ?? null;
      return {
        localHour,
        selectedKwh: nullableRound(selectedKwh),
        baselineKwh: nullableRound(baselineKwh),
        impactKwh: selectedKwh !== null && baselineKwh !== null
          ? round(selectedKwh - baselineKwh, 4)
          : null,
      };
    }),
  };
};

const buildDailyUsageAnomalyDays = (input: {
  facts: DailyUsageAnomalyHourFact[];
  meterCount: number;
  intervalMinutes: number;
}): Map<string, DailyUsageAnomalyDayFact> => {
  const factsByDate = new Map<string, DailyUsageAnomalyHourFact[]>();
  for (const fact of input.facts) {
    factsByDate.set(fact.localDate, [...(factsByDate.get(fact.localDate) ?? []), fact]);
  }
  return new Map([...factsByDate.entries()].map(([localDate, facts]) => {
    const factByHour = new Map(facts.map((fact) => [fact.localHour, fact]));
    const hours = Array.from({ length: 24 }, (_, localHour) => ({
      localHour,
      usageKwh: factByHour.get(localHour)?.usageKwh ?? null,
    }));
    const validIntervalCount = facts.reduce((sum, fact) => sum + fact.validIntervalCount, 0);
    const qualityEventCount = facts.reduce((sum, fact) => sum + fact.qualityEventCount, 0);
    const expectedMeterIntervalCount = input.meterCount * Math.round(24 * 60 / input.intervalMinutes);
    const classifiedFacts = facts.filter((fact) => fact.validIntervalCount > 0);
    const classifiedDayTypes = new Set(classifiedFacts.map((fact) => fact.dayType));
    const dayType = classifiedFacts.length > 0
      && classifiedFacts.every((fact) => fact.dayTypeCount === 1)
      && classifiedDayTypes.size === 1
      && (classifiedFacts[0]?.dayType === "weekday" || classifiedFacts[0]?.dayType === "weekend")
      ? classifiedFacts[0].dayType
      : null;
    return [localDate, {
      localDate,
      dayType,
      coveragePct: expectedMeterIntervalCount > 0
        ? Math.min(validIntervalCount / expectedMeterIntervalCount, 1) * 100
        : 0,
      validIntervalCount,
      expectedMeterIntervalCount,
      qualityEventCount,
      hours,
      totalKwh: validIntervalCount > 0
        ? hours.reduce((sum, hour) => sum + (hour.usageKwh ?? 0), 0)
        : null,
    }];
  }));
};

const emptyDailyUsageAnomalyDay = (localDate: string): DailyUsageAnomalyDayFact => ({
  localDate,
  dayType: null,
  coveragePct: 0,
  validIntervalCount: 0,
  expectedMeterIntervalCount: 0,
  qualityEventCount: 0,
  hours: Array.from({ length: 24 }, (_, localHour) => ({ localHour, usageKwh: null })),
  totalKwh: null,
});

const meanDailyUsageAnomalyHours = (
  days: Map<string, DailyUsageAnomalyDayFact>,
  baselineDates: string[],
): Array<number | null> => Array.from({ length: 24 }, (_, localHour) => {
  const values = baselineDates.map(
    (localDate) => days.get(localDate)?.hours[localHour]?.usageKwh ?? null,
  );
  return values.length === 0 || values.some((value) => value === null)
    ? null
    : values.reduce<number>((sum, value) => sum + (value ?? 0), 0) / values.length;
});

const parseDailyUsageAnomalyFacts = (value: string): DailyUsageAnomalyHourFact[] => {
  if (!value) return [];
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error("ENERGYIQ_DAILY_USAGE_ANOMALY_FACTS_INVALID");
  return parsed.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`ENERGYIQ_DAILY_USAGE_ANOMALY_FACT_INVALID:${index}`);
    }
    const localHour = Number(item.local_hour);
    if (typeof item.local_date !== "string"
      || !Number.isSafeInteger(localHour)
      || localHour < 0
      || localHour > 23) {
      throw new Error(`ENERGYIQ_DAILY_USAGE_ANOMALY_FACT_INVALID:${index}`);
    }
    return {
      localDate: item.local_date,
      localHour,
      usageKwh: item.usage_kwh === null || item.usage_kwh === undefined
        ? null
        : finiteNumber(item.usage_kwh, `ENERGYIQ_DAILY_USAGE_ANOMALY_USAGE_INVALID:${index}`),
      validIntervalCount: finiteNumber(
        item.valid_interval_count,
        `ENERGYIQ_DAILY_USAGE_ANOMALY_VALID_COUNT_INVALID:${index}`,
      ),
      qualityEventCount: finiteNumber(
        item.quality_event_count,
        `ENERGYIQ_DAILY_USAGE_ANOMALY_QUALITY_COUNT_INVALID:${index}`,
      ),
      dayType: typeof item.day_type === "string" ? item.day_type : null,
      dayTypeCount: finiteNumber(
        item.day_type_count,
        `ENERGYIQ_DAILY_USAGE_ANOMALY_DAY_TYPE_COUNT_INVALID:${index}`,
      ),
    };
  });
};

const nullableRound = (value: number | null): number | null => value === null
  ? null
  : round(value, 4);

const finiteNumber = (value: unknown, errorCode: string): number => {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(errorCode);
  return number;
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
  previousMeterUsageById: ReadonlyMap<string, number>;
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
      ? [...officialIds]
        .reduce((sum, meterNodeId) => sum + (input.previousMeterUsageById.get(meterNodeId) ?? 0), 0)
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

const resolveDailyTotalScopes = (input: {
  metadataStore: MetadataStore;
  projectId: string;
  hierarchyRevisionId: string;
  meterMappingRevisionId: string;
  resource: "electricity" | "water";
  selectedNode: ReturnType<MetadataStore["energyIq"]["listProjectNodes"]>[number];
  hierarchy: ReturnType<MetadataStore["energyIq"]["listProjectNodes"]>;
  meterAggregates: MeterAggregate[];
  aggregateMeterNodeIds: string[];
}): DailyTotalScope[] => {
  const children = input.hierarchy
    .filter((node) => node.parent_id === input.selectedNode.id)
    .map((child) => {
      const publishedRoute = resolveEnergyPublishedMeterRoute({
        metadataStore: input.metadataStore,
        projectId: input.projectId,
        hierarchyRevisionId: input.hierarchyRevisionId,
        scopeId: child.id,
        resource: input.resource,
        expectedMeterMappingRevisionId: input.meterMappingRevisionId,
      });
      const meterNodeIds = publishedRoute.officialMeterPointIds ?? [];
      const officialIds = new Set(meterNodeIds);
      const usageKwh = input.meterAggregates
        .filter((meter) => officialIds.has(meter.meterNodeId))
        .reduce((sum, meter) => sum + meter.usageKwh, 0);
      return {
        scopeId: child.id,
        scopeName: child.name,
        scopeType: child.node_type,
        meterNodeIds,
        usageKwh,
      };
    })
    .sort((left, right) => right.usageKwh - left.usageKwh)
    .map(({ usageKwh: _usageKwh, ...scope }) => scope);
  return [{
    scopeId: input.selectedNode.id,
    scopeName: input.selectedNode.name,
    scopeType: input.selectedNode.node_type,
    meterNodeIds: input.aggregateMeterNodeIds,
  }, ...children];
};

const buildDailyDateBuckets = (context: EnergyQueryContext): DailyDateBucket[] => {
  const firstDate = formatLocalDate(context.from, context.timezone);
  const endDateExclusive = formatLocalDate(context.to, context.timezone);
  const buckets: DailyDateBucket[] = [];
  for (let localDate = firstDate; localDate < endDateExclusive; localDate = shiftLocalDate(localDate, 1)) {
    buckets.push({
      localDate,
      from: zonedStartOfLocalDay(localDate, context.timezone),
      to: zonedStartOfLocalDay(shiftLocalDate(localDate, 1), context.timezone),
    });
  }
  return buckets;
};

const buildTimeBehaviour = (input: {
  timezone: string;
  scopes: DailyTotalScope[];
  dateBuckets: DailyDateBucket[];
  intervalMinutes: number;
  rows: unknown[][];
}): NonNullable<EnergyScopeAnalysis["timeBehaviour"]> => {
  const factsByScopeDateHour = new Map(
    input.rows.flatMap((row) => parseTimeBucketFacts(
      stringAt(row, 0),
      stringAt(row, 3),
    )).map((fact) => [
      `${fact.scopeId}:${fact.localDate}:${fact.localHour}`,
      fact,
    ]),
  );
  const scopes = input.scopes.map((scope) => ({
    scopeId: scope.scopeId,
    scopeName: scope.scopeName,
    scopeType: scope.scopeType,
    cells: input.dateBuckets.flatMap((dateBucket) => Array.from(
      { length: 24 },
      (_, localHour) => {
        const from = zonedStartOfLocalHour(
          dateBucket.localDate,
          localHour,
          input.timezone,
        );
        const to = localHour === 23
          ? dateBucket.to
          : zonedStartOfLocalHour(dateBucket.localDate, localHour + 1, input.timezone);
        const row = factsByScopeDateHour.get(
          `${scope.scopeId}:${dateBucket.localDate}:${localHour}`,
        );
        const validIntervalCount = row?.validIntervalCount ?? 0;
        const qualityEventCount = row?.qualityEventCount ?? 0;
        const expectedMeterIntervalCount = scope.meterNodeIds.length * Math.round(
          (Date.parse(to) - Date.parse(from)) / (input.intervalMinutes * 60_000),
        );
        const status = validIntervalCount === 0
          ? "unavailable" as const
          : validIntervalCount >= expectedMeterIntervalCount && qualityEventCount === 0
            ? "complete" as const
            : "partial" as const;
        return {
          localDate: dateBucket.localDate,
          localHour,
          from,
          to,
          usageKwh: row?.usageKwh !== null && row?.usageKwh !== undefined
            ? round(row.usageKwh, 4)
            : null,
          dataHealth: {
            status,
            coveragePct: expectedMeterIntervalCount > 0
              ? round(Math.min(validIntervalCount / expectedMeterIntervalCount, 1) * 100, 4)
              : 0,
            expectedMeterIntervalCount,
            validIntervalCount,
            qualityEventCount,
          },
        };
      },
    )),
  }));
  const dayProfiles: NonNullable<EnergyScopeAnalysis["timeBehaviour"]>["dayProfiles"] = [];
  for (const scope of scopes) {
    const classifiedCompleteDates = new Map<string, "weekday" | "weekend">();
    let classificationUnavailable = false;
    for (const dateBucket of input.dateBuckets) {
      const dateCells = scope.cells.filter((cell) => cell.localDate === dateBucket.localDate);
      const isCompleteDate = dateCells.length === 24
        && dateCells.every((cell) => (
          cell.dataHealth.status === "complete" && cell.usageKwh !== null
        ));
      if (!isCompleteDate) continue;
      const dayTypes = new Set<"weekday" | "weekend">();
      for (const cell of dateCells) {
        const fact = factsByScopeDateHour.get(
          `${scope.scopeId}:${cell.localDate}:${cell.localHour}`,
        );
        if (
          fact?.dayTypeCount !== 1
          || (fact.dayType !== "weekday" && fact.dayType !== "weekend")
        ) {
          classificationUnavailable = true;
          break;
        }
        dayTypes.add(fact.dayType);
      }
      if (classificationUnavailable || dayTypes.size !== 1) {
        classificationUnavailable = true;
        break;
      }
      classifiedCompleteDates.set(dateBucket.localDate, [...dayTypes][0]!);
    }
    for (const dayType of ["weekday", "weekend"] as const) {
      if (classificationUnavailable) {
        dayProfiles.push({
          dayType,
          scopeId: scope.scopeId,
          scopeName: scope.scopeName,
          status: "unavailable",
          reason: {
            code: "DAY_TYPE_CLASSIFICATION_UNAVAILABLE",
            message: `Accepted facts do not provide one consistent Day Type per complete local day for ${scope.scopeName}.`,
          },
        });
        continue;
      }
      const completeDates = [...classifiedCompleteDates.entries()]
        .filter(([, classifiedDayType]) => classifiedDayType === dayType)
        .map(([localDate]) => localDate);
      if (completeDates.length === 0) {
        dayProfiles.push({
          dayType,
          scopeId: scope.scopeId,
          scopeName: scope.scopeName,
          status: "unavailable",
          reason: {
            code: "COMPLETE_DAY_SAMPLE_UNAVAILABLE",
            message: `No complete ${dayType} local-day sample is available for ${scope.scopeName}.`,
          },
        });
        continue;
      }
      const completeDateSet = new Set(completeDates);
      dayProfiles.push({
        dayType,
        scopeId: scope.scopeId,
        scopeName: scope.scopeName,
        status: "available",
        sampleDayCount: completeDates.length,
        values: Array.from({ length: 24 }, (_, localHour) => {
          const samples = scope.cells.filter((cell) => (
            cell.localHour === localHour
            && completeDateSet.has(cell.localDate)
            && cell.usageKwh !== null
          ));
          return {
            localHour,
            usageKwh: round(
              samples.reduce((sum, cell) => sum + (cell.usageKwh ?? 0), 0) / samples.length,
              4,
            ),
          };
        }),
      });
    }
  }
  for (const scope of scopes) {
    dayProfiles.push({
      dayType: "public_holiday",
      scopeId: scope.scopeId,
      scopeName: scope.scopeName,
      status: "unavailable",
      reason: {
        code: "DAY_TYPE_CLASSIFICATION_UNAVAILABLE",
        message: "Public Holiday profile requires an authoritative release-pinned Calendar classification.",
      },
    });
  }
  return {
    metricId: "energy.total_usage_kwh@1",
    grain: "hour",
    unit: "kWh",
    timezone: input.timezone,
    queryId: "time_bucket_grid_v1",
    scopes,
    dayProfiles,
  };
};

const parseTimeBucketFacts = (
  scopeId: string,
  value: string,
): Array<{
  scopeId: string;
  localDate: string;
  localHour: number;
  usageKwh: number | null;
  validIntervalCount: number;
  qualityEventCount: number;
  dayType: string | null;
  dayTypeCount: number;
}> => {
  const parsed = JSON.parse(value || "[]") as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`ENERGYIQ_TIME_BUCKET_GRID_INVALID:${scopeId}`);
  }
  return parsed.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`ENERGYIQ_TIME_BUCKET_GRID_CELL_INVALID:${scopeId}:${index}`);
    }
    const localDate = String(item.local_date ?? "");
    const localHour = Number(item.local_hour);
    const usageKwh = item.usage_kwh === null || item.usage_kwh === undefined
      ? null
      : Number(item.usage_kwh);
    const validIntervalCount = Number(item.valid_interval_count);
    const qualityEventCount = Number(item.quality_event_count);
    const dayType = item.day_type === null || item.day_type === undefined
      ? null
      : String(item.day_type);
    const dayTypeCount = Number(item.day_type_count);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(localDate)
      || !Number.isInteger(localHour)
      || localHour < 0
      || localHour > 23
      || (usageKwh !== null && !Number.isFinite(usageKwh))
      || !Number.isFinite(validIntervalCount)
      || !Number.isFinite(qualityEventCount)
      || !Number.isInteger(dayTypeCount)
      || dayTypeCount < 0
    ) {
      throw new Error(`ENERGYIQ_TIME_BUCKET_GRID_CELL_INVALID:${scopeId}:${index}`);
    }
    return {
      scopeId,
      localDate,
      localHour,
      usageKwh,
      validIntervalCount,
      qualityEventCount,
      dayType,
      dayTypeCount,
    };
  });
};

const formatLocalDate = (value: string, timezone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

const shiftLocalDate = (value: string, days: number): string => {
  const [year, month, day] = value.split("-").map(Number);
  const shifted = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
};

const zonedStartOfLocalDay = (value: string, timezone: string): string =>
  zonedStartOfLocalHour(value, 0, timezone);

const zonedStartOfLocalHour = (
  value: string,
  hour: number,
  timezone: string,
): string => {
  const [year, month, day] = value.split("-").map(Number);
  const targetUtc = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hour);
  let candidate = targetUtc;
  for (let index = 0; index < 3; index += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(candidate));
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((item) => item.type === type)?.value ?? 0);
    candidate += targetUtc - Date.UTC(
      part("year"),
      part("month") - 1,
      part("day"),
      part("hour"),
      part("minute"),
      part("second"),
    );
  }
  return new Date(candidate).toISOString();
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

const buildVirtualMeterTraces = (input: {
  metadataStore: MetadataStore;
  projectId: string;
  hierarchyRevisionId: string;
  resource: "electricity" | "water";
  selectedScopeId: string;
  hierarchy: ReturnType<MetadataStore["energyIq"]["listProjectNodes"]>;
  circuits: EnergyScopeAnalysis["circuits"];
}): NonNullable<EnergyScopeAnalysis["virtualMeterTraces"]> => {
  const revision = input.metadataStore.energyIq.projectSetup
    .listHierarchyRevisions(input.projectId)
    .find((candidate) => candidate.id === input.hierarchyRevisionId);
  if (!revision) return [];
  const mapping = (JSON.parse(revision.snapshot_json) as EnergyIqProjectSetupDocument).meter_mapping;
  if (!mapping) return [];
  const includedScopeIds = collectDescendantIds(input.selectedScopeId, input.hierarchy);
  includedScopeIds.add(input.selectedScopeId);
  return buildEnergyVirtualMeterTraces({
    virtualMeters: mapping.virtual_meters ?? [],
    mappingRows: mapping.rows,
    includedScopeIds,
    resource: input.resource,
    circuits: input.circuits,
  });
};

export const buildEnergyVirtualMeterTraces = (input: {
  virtualMeters: readonly EnergyIqVirtualMeter[];
  mappingRows: readonly EnergyIqMeterMappingRow[];
  includedScopeIds: ReadonlySet<string>;
  resource: "electricity" | "water";
  circuits: EnergyScopeAnalysis["circuits"];
}): NonNullable<EnergyScopeAnalysis["virtualMeterTraces"]> => {
  const mappingRowByMeterNodeId = new Map(input.mappingRows.map((row) => [row.id, row]));
  const circuitByMeterNodeId = new Map(
    input.circuits.map((circuit) => [circuit.meterNodeId, circuit]),
  );
  return input.virtualMeters.flatMap((virtualMeter) => {
    if (
      virtualMeter.resource !== input.resource
      || !input.includedScopeIds.has(virtualMeter.scope_id)
    ) {
      return [];
    }
    const terms = virtualMeter.terms.map((term) => {
      const mappingRow = mappingRowByMeterNodeId.get(term.mapping_row_id);
      const circuit = circuitByMeterNodeId.get(term.mapping_row_id);
      const available = mappingRow !== undefined && circuit !== undefined;
      return {
        meterNodeId: term.mapping_row_id,
        name: mappingRow?.display_name ?? circuit?.name ?? term.mapping_row_id,
        coefficient: term.coefficient,
        inputUsageKwh: available ? circuit.usageKwh : null,
        contributionKwh: available
          ? round(circuit.usageKwh * term.coefficient, 4)
          : null,
        dataHealth: available ? circuit.dataHealth : null,
      };
    });
    const missingTermMeterNodeIds = terms
      .filter((term) => term.inputUsageKwh === null)
      .map((term) => term.meterNodeId);
    const contributionTotalKwh = terms.reduce<number | null>(
      (sum, term) => sum === null || term.contributionKwh === null
        ? null
        : sum + term.contributionKwh,
      0,
    );
    return [{
      meterNodeId: virtualMeter.id,
      name: virtualMeter.display_name,
      scopeId: virtualMeter.scope_id,
      status: missingTermMeterNodeIds.length > 0 ? "partial" as const : "available" as const,
      usageKwh: contributionTotalKwh === null ? null : round(contributionTotalKwh, 4),
      includedInOfficialTotal: false as const,
      terms,
      missingTermMeterNodeIds,
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

const rowToPeakIntervalFact = (row: unknown[]): PeakIntervalFact => ({
  meterNodeId: stringAt(row, 0),
  intervalStart: isoAt(row, 1),
  intervalEnd: isoAt(row, 2),
  elapsedMinutes: numberAt(row, 3),
  averageKw: optionalNumberAt(row, 4),
  qualityStatus: stringAt(row, 5),
});

const buildPeakBreakdown = (input: {
  peakAt?: string;
  peakKw: number;
  intervalMinutes: number;
  timezone: string;
  periodStatus: "complete" | "partial";
  coveragePct: number;
  projectOfficialMeterNodeIds: string[];
  levelScopes: DailyTotalScope[];
  hierarchy: ReturnType<MetadataStore["energyIq"]["listProjectNodes"]>;
  meterAggregates: MeterAggregate[];
  facts: PeakIntervalFact[];
}): NonNullable<EnergyScopeAnalysis["peakBreakdown"]> => {
  if (!input.peakAt) {
    return peakBreakdownUnavailable(
      "PEAK_AT_MISSING",
      "Peak interval start is unavailable for the selected period.",
    );
  }
  const peakTo = new Date(
    Date.parse(input.peakAt) + input.intervalMinutes * 60_000,
  ).toISOString();
  const factsByMeterId = new Map<string, PeakIntervalFact[]>();
  for (const fact of input.facts) {
    factsByMeterId.set(fact.meterNodeId, [
      ...(factsByMeterId.get(fact.meterNodeId) ?? []),
      fact,
    ]);
  }
  const officialFacts = input.projectOfficialMeterNodeIds.map(
    (meterNodeId) => factsByMeterId.get(meterNodeId) ?? [],
  );
  if (officialFacts.some((facts) => facts.length === 0)) {
    return peakBreakdownUnavailable(
      "PEAK_INTERVAL_FACTS_UNAVAILABLE",
      "Peak breakdown requires one same-interval fact for every Project official Meter Point.",
    );
  }
  if (officialFacts.some((facts) => facts.length !== 1)) {
    return peakBreakdownUnavailable(
      "PEAK_INTERVAL_FACTS_AMBIGUOUS",
      "Peak breakdown requires exactly one same-interval fact for every Project official Meter Point.",
    );
  }
  if (officialFacts.some((facts) => !isAcceptedPeakFact(
    facts[0]!,
    input.peakAt!,
    peakTo,
    input.intervalMinutes,
  ))) {
    return peakBreakdownUnavailable(
      "PEAK_INTERVAL_FACTS_REJECTED",
      "Peak breakdown requires accepted same-interval facts for every Project official Meter Point.",
    );
  }

  const projectAverageKw = officialFacts.reduce(
    (sum, facts) => sum + facts[0]!.averageKw!,
    0,
  );
  if (round(projectAverageKw, 4) !== round(input.peakKw, 4)) {
    return peakBreakdownUnavailable(
      "PEAK_INTERVAL_FACTS_AMBIGUOUS",
      "Peak interval official facts do not reconcile with the Project Peak.",
    );
  }
  const levelOfficialFacts = input.levelScopes.flatMap((level) => level.meterNodeIds.map(
    (meterNodeId) => factsByMeterId.get(meterNodeId) ?? [],
  ));
  if (levelOfficialFacts.some((facts) => facts.length === 0)) {
    return peakBreakdownUnavailable(
      "PEAK_INTERVAL_FACTS_UNAVAILABLE",
      "Peak breakdown requires one same-interval fact for every Level official Meter Point.",
    );
  }
  if (levelOfficialFacts.some((facts) => facts.length !== 1)) {
    return peakBreakdownUnavailable(
      "PEAK_INTERVAL_FACTS_AMBIGUOUS",
      "Peak breakdown requires exactly one same-interval fact for every Level official Meter Point.",
    );
  }
  if (levelOfficialFacts.some((facts) => !isAcceptedPeakFact(
    facts[0]!,
    input.peakAt!,
    peakTo,
    input.intervalMinutes,
  ))) {
    return peakBreakdownUnavailable(
      "PEAK_INTERVAL_FACTS_REJECTED",
      "Peak breakdown requires accepted same-interval facts for every Level official Meter Point.",
    );
  }
  const hierarchyById = new Map(input.hierarchy.map((node) => [node.id, node]));
  const projectOfficialIds = new Set(input.projectOfficialMeterNodeIds);
  const completeHealth = (expectedMeterIntervalCount: number): PeakIntervalDataHealth => ({
    status: "complete",
    coveragePct: 100,
    expectedMeterIntervalCount,
    validIntervalCount: expectedMeterIntervalCount,
    qualityEventCount: 0,
  });
  const levels = input.levelScopes.map((level) => {
    const levelFacts = level.meterNodeIds.map((meterNodeId) => factsByMeterId.get(meterNodeId)![0]!);
    const levelAverageKw = levelFacts.reduce((sum, fact) => sum + fact.averageKw!, 0);
    const circuits = input.meterAggregates
      .filter((meter) => !projectOfficialIds.has(meter.meterNodeId)
        && hierarchyById.get(meter.scopeId)?.parent_id === level.scopeId)
      .map((meter) => {
        const facts = factsByMeterId.get(meter.meterNodeId) ?? [];
        const accepted = facts.length === 1 && isAcceptedPeakFact(
          facts[0]!,
          input.peakAt!,
          peakTo,
          input.intervalMinutes,
        );
        const averageKw = accepted ? facts[0]!.averageKw! : null;
        const qualityEventCount = facts.filter((fact) => fact.qualityStatus !== "ok").length;
        return {
          meterNodeId: meter.meterNodeId,
          name: meter.name,
          category: meter.category,
          averageKw: averageKw === null ? null : round(averageKw, 4),
          sharePct: averageKw === null ? null : percent(averageKw, levelAverageKw, 4),
          includedInOfficialTotal: false as const,
          dataHealth: accepted
            ? completeHealth(1)
            : {
                status: "unavailable" as const,
                coveragePct: 0,
                expectedMeterIntervalCount: 1,
                validIntervalCount: 0,
                qualityEventCount,
              },
        };
      })
      .sort((left, right) => (right.averageKw ?? Number.NEGATIVE_INFINITY)
        - (left.averageKw ?? Number.NEGATIVE_INFINITY)
        || left.meterNodeId.localeCompare(right.meterNodeId));
    return {
      scopeId: level.scopeId,
      scopeName: level.scopeName,
      averageKw: round(levelAverageKw, 4),
      sharePct: percent(levelAverageKw, projectAverageKw, 4),
      dataHealth: completeHealth(level.meterNodeIds.length),
      circuits,
      rawAverageKw: levelAverageKw,
    };
  }).sort((left, right) => right.averageKw - left.averageKw);
  const levelAverageKw = levels.reduce((sum, level) => sum + level.rawAverageKw, 0);
  if (round(levelAverageKw, 4) !== round(projectAverageKw, 4)) {
    return peakBreakdownUnavailable(
      "PEAK_INTERVAL_FACTS_AMBIGUOUS",
      "Level official Peak contributions do not reconcile with the Project Peak.",
    );
  }

  return {
    status: "available",
    metricId: "energy.peak_demand_kw@1",
    intervalMinutes: input.intervalMinutes,
    timezone: input.timezone,
    unit: "kW",
    periodStatus: input.periodStatus,
    coveragePct: input.coveragePct,
    peak: {
      from: input.peakAt,
      to: peakTo,
      averageKw: round(projectAverageKw, 4),
      dataHealth: completeHealth(input.projectOfficialMeterNodeIds.length),
    },
    levels: levels.map(({ rawAverageKw: _rawAverageKw, ...level }) => level),
  };
};

const peakBreakdownUnavailable = (
  code: Extract<NonNullable<EnergyScopeAnalysis["peakBreakdown"]>, { status: "unavailable" }>["reason"]["code"],
  message: string,
): NonNullable<EnergyScopeAnalysis["peakBreakdown"]> => ({
  status: "unavailable",
  reason: { code, message },
});

const isAcceptedPeakFact = (
  fact: PeakIntervalFact,
  peakFrom: string,
  peakTo: string,
  intervalMinutes: number,
): boolean => fact.qualityStatus === "ok"
  && fact.averageKw !== null
  && fact.intervalStart === peakFrom
  && fact.intervalEnd === peakTo
  && fact.elapsedMinutes === intervalMinutes;

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

const dailyTotalsSql = (
  viewName: string,
  scopes: DailyTotalScope[],
): string => scopes.map((scope, index) => `
  SELECT
    ${sqlLiteral(scope.scopeId)} AS scope_id,
    ${sqlLiteral(scope.scopeName)} AS scope_name,
    ${sqlLiteral(scope.scopeType)} AS scope_type,
    STRFTIME(CAST(source.local_interval_start AS DATE), '%Y-%m-%d') AS local_date,
    SUM(source.usage_kwh) FILTER (WHERE source.quality_status = 'ok') AS usage_kwh,
    COUNT(*) FILTER (WHERE source.quality_status = 'ok') AS valid_interval_count,
    COUNT(*) FILTER (WHERE source.quality_status <> 'ok') AS quality_event_count,
    ${index} AS scope_order
  FROM ${quoteIdentifier(viewName)} source
  WHERE ${meterNodeFilter(scope.meterNodeIds)}
  GROUP BY CAST(source.local_interval_start AS DATE)
`).join(" UNION ALL ") + " ORDER BY scope_order, local_date";

const dailyUsageAnomalySql = (
  viewName: string,
  series: DailyUsageAnomalySeriesDefinition[],
): string => `
  SELECT
    series_definitions.series_id,
    COALESCE(TO_JSON(LIST(STRUCT_PACK(
      local_date := time_cells.local_date,
      local_hour := time_cells.local_hour,
      usage_kwh := time_cells.usage_kwh,
      valid_interval_count := time_cells.valid_interval_count,
      quality_event_count := time_cells.quality_event_count,
      day_type := time_cells.day_type,
      day_type_count := time_cells.day_type_count
    ) ORDER BY time_cells.local_date, time_cells.local_hour) FILTER (
      WHERE time_cells.local_date IS NOT NULL
    )), '[]') AS cells_json,
    series_definitions.series_order
  FROM (VALUES ${series.map((definition) => `(
    ${definition.seriesOrder},
    ${sqlLiteral(definition.seriesId)}
  )`).join(", ")}) AS series_definitions(series_order, series_id)
  LEFT JOIN (
    SELECT
      routes.series_order,
      routes.series_id,
      STRFTIME(CAST(source.local_interval_start AS DATE), '%Y-%m-%d') AS local_date,
      source.local_hour,
      SUM(source.usage_kwh) FILTER (WHERE source.quality_status = 'ok') AS usage_kwh,
      COUNT(*) FILTER (WHERE source.quality_status = 'ok') AS valid_interval_count,
      COUNT(*) FILTER (WHERE source.quality_status <> 'ok') AS quality_event_count,
      MAX(source.day_type) FILTER (WHERE source.quality_status = 'ok') AS day_type,
      COUNT(DISTINCT source.day_type) FILTER (WHERE source.quality_status = 'ok') AS day_type_count
    FROM ${quoteIdentifier(viewName)} source
    JOIN (VALUES ${series.flatMap((definition) => definition.meterNodeIds.map((meterNodeId) => `(
      ${definition.seriesOrder},
      ${sqlLiteral(definition.seriesId)},
      ${sqlLiteral(meterNodeId)}
    )`)).join(", ")}) AS routes(series_order, series_id, meter_node_id)
      ON routes.meter_node_id = source.meter_node_id
    GROUP BY
      routes.series_order,
      routes.series_id,
      CAST(source.local_interval_start AS DATE),
      source.local_hour
  ) time_cells ON time_cells.series_order = series_definitions.series_order
  GROUP BY series_definitions.series_order, series_definitions.series_id
  ORDER BY series_definitions.series_order
`;

const timeBucketGridSql = (
  viewName: string,
  scopes: DailyTotalScope[],
): string => `
  SELECT
    scope_definitions.scope_id,
    scope_definitions.scope_name,
    scope_definitions.scope_type,
    COALESCE(TO_JSON(LIST(STRUCT_PACK(
      local_date := time_cells.local_date,
      local_hour := time_cells.local_hour,
      usage_kwh := time_cells.usage_kwh,
      valid_interval_count := time_cells.valid_interval_count,
      quality_event_count := time_cells.quality_event_count,
      day_type := time_cells.day_type,
      day_type_count := time_cells.day_type_count
    ) ORDER BY time_cells.local_date, time_cells.local_hour) FILTER (
      WHERE time_cells.local_date IS NOT NULL
    )), '[]') AS cells_json,
    scope_definitions.scope_order
  FROM (VALUES ${scopes.map((scope, index) => `(
    ${index},
    ${sqlLiteral(scope.scopeId)},
    ${sqlLiteral(scope.scopeName)},
    ${sqlLiteral(scope.scopeType)}
  )`).join(", ")}) AS scope_definitions(
    scope_order,
    scope_id,
    scope_name,
    scope_type
  )
  LEFT JOIN (
    SELECT
      routes.scope_order,
      routes.scope_id,
      routes.scope_name,
      routes.scope_type,
      STRFTIME(CAST(source.local_interval_start AS DATE), '%Y-%m-%d') AS local_date,
      source.local_hour,
      SUM(source.usage_kwh) FILTER (WHERE source.quality_status = 'ok') AS usage_kwh,
      COUNT(*) FILTER (WHERE source.quality_status = 'ok') AS valid_interval_count,
      COUNT(*) FILTER (WHERE source.quality_status <> 'ok') AS quality_event_count,
      MAX(source.day_type) FILTER (WHERE source.quality_status = 'ok') AS day_type,
      COUNT(DISTINCT source.day_type) FILTER (WHERE source.quality_status = 'ok') AS day_type_count
    FROM ${quoteIdentifier(viewName)} source
    JOIN (VALUES ${scopes.flatMap((scope, index) => scope.meterNodeIds.map((meterNodeId) => `(
      ${index},
      ${sqlLiteral(scope.scopeId)},
      ${sqlLiteral(scope.scopeName)},
      ${sqlLiteral(scope.scopeType)},
      ${sqlLiteral(meterNodeId)}
    )`)).join(", ")}) AS routes(
      scope_order,
      scope_id,
      scope_name,
      scope_type,
      meter_node_id
    ) ON routes.meter_node_id = source.meter_node_id
    GROUP BY
      routes.scope_order,
      routes.scope_id,
      routes.scope_name,
      routes.scope_type,
      CAST(source.local_interval_start AS DATE),
      source.local_hour
  ) time_cells
    ON time_cells.scope_order = scope_definitions.scope_order
  GROUP BY
    scope_definitions.scope_order,
    scope_definitions.scope_id,
    scope_definitions.scope_name,
    scope_definitions.scope_type
  ORDER BY scope_definitions.scope_order
`;

const peakBreakdownSql = (viewName: string, peakAt?: string): string => `
  SELECT
    source.meter_node_id,
    EPOCH_MS(source.interval_start) AS interval_start_ms,
    EPOCH_MS(source.interval_end) AS interval_end_ms,
    source.elapsed_minutes,
    source.average_kw,
    source.quality_status
  FROM ${quoteIdentifier(viewName)} source
  WHERE ${peakAt
    ? `source.interval_start = CAST(${sqlLiteral(peakAt)} AS TIMESTAMPTZ)`
    : "FALSE"}
  ORDER BY source.meter_node_id, source.interval_end, source.quality_status
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

const previousMeterUsageSql = (viewName: string, meterNodeIds: string[]): string => `
  SELECT
    meter_node_id,
    COALESCE(SUM(usage_kwh) FILTER (WHERE quality_status = 'ok'), 0) AS usage_kwh
  FROM ${quoteIdentifier(viewName)} source
  WHERE ${meterNodeFilter(meterNodeIds)}
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

const optionalNumberAt = (row: unknown[], index: number): number | null => {
  const value = row[index];
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
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
