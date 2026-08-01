import {
  ensureEnergyScopedDataSource,
  type LocalDataGateway
} from "@datafoundry/data-gateway";
import type { MetadataStore } from "@datafoundry/metadata";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveEnergyScopeMeterNodeIds,
  type EnergyQueryContext
} from "./energy-query-context.js";

const SINGAPORE_TARIFF_SGD_PER_KWH = 0.2727;

export type EnergyScopeAnalysis = {
  context: EnergyQueryContext;
  summary: {
    usageKwh: number;
    costSgd: number;
    peakKw: number;
    nonOperatingKwh: number;
    nonOperatingSharePct: number;
    areaSqm?: number;
    occupantCount?: number;
    kwhPerSqm?: number;
    kwhPerPerson?: number;
    validIntervalCount: number;
    qualityEventCount: number;
  };
  hourlyProfile: Array<{
    hour: number;
    averageKw: number;
    peakKw: number;
  }>;
  childScopes: Array<{
    nodeId: string;
    name: string;
    nodeType: string;
    usageKwh: number;
    sharePct: number;
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
    nonOperatingKwh: number;
    peakKw: number;
    qualityEventCount: number;
  }>;
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
    meterFormulaRevisionId: string;
    metricVersion: string;
    aggregationRule: "designated_total" | "component" | "submeter" | "none";
    sourceView: string;
    queryIds: ["scope_summary_v1", "hourly_profile_v1", "meter_breakdown_v1"];
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
  nonOperatingKwh: number;
  peakKw: number;
  validIntervalCount: number;
  qualityEventCount: number;
};

export const executeEnergyScopeAnalysis = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  userId: string;
  context: EnergyQueryContext;
  databasePath?: string;
}): Promise<EnergyScopeAnalysis> => {
  const scopeNodeIds = resolveEnergyScopeMeterNodeIds(
    input.metadataStore,
    input.context.projectId,
    input.context.scopeId
  );
  const scoped = await ensureEnergyScopedDataSource({
    metadataStore: input.metadataStore,
    userId: input.userId,
    context: {
      workspaceId: input.context.workspaceId,
      projectId: input.context.projectId,
      scopeId: input.context.scopeId,
      scopeNodeIds,
      resource: input.context.resource,
      from: input.context.from,
      to: input.context.to,
      timezone: input.context.timezone,
      hierarchyRevisionId: input.context.hierarchyRevisionId,
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
  const hierarchy = input.metadataStore.energyIq.listProjectNodes(input.context.projectId);
  const selectedNode = hierarchy.find((node) => node.id === input.context.scopeId);
  if (!selectedNode) {
    throw new Error("ENERGYIQ_SCOPE_FORBIDDEN");
  }
  const aggregateMeters = selectAggregateMetersForScope(
    selectedNode.id,
    meterAggregates,
    hierarchy
  );
  const aggregateMeterNodeIds = aggregateMeters.map((meter) => meter.meterNodeId);
  const aggregationRule = aggregationRuleForMeters(aggregateMeters);
  const [summaryResult, profileResult] = await Promise.all([
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
    })
  ]);

  const summaryRow = summaryResult.rows[0] ?? [];
  const usageKwh = numberAt(summaryRow, 0);
  const peakKw = numberAt(summaryRow, 1);
  const nonOperatingKwh = numberAt(summaryRow, 2);
  const validIntervalCount = numberAt(summaryRow, 3);
  const qualityEventCount = numberAt(summaryRow, 4);
  const scopeDimensions = resolveScopeDimensions(selectedNode.id, hierarchy);
  const childScopes = buildChildScopes({
    scopeNodeId: selectedNode.id,
    hierarchy,
    meterAggregates,
    scopeUsageKwh: usageKwh
  });
  const circuits = meterAggregates
    .map((meter) => ({
      meterNodeId: meter.meterNodeId,
      name: meter.name,
      appliance: meter.appliance,
      category: meter.category,
      meterRole: meter.meterRole,
      usageKwh: round(meter.usageKwh, 4),
      sharePct: percent(meter.usageKwh, usageKwh),
      nonOperatingKwh: round(meter.nonOperatingKwh, 4),
      peakKw: round(meter.peakKw, 4),
      qualityEventCount: meter.qualityEventCount
    }))
    .sort((left, right) => right.usageKwh - left.usageKwh);

  const summary: EnergyScopeAnalysis["summary"] = {
    usageKwh: round(usageKwh, 4),
    costSgd: round(usageKwh * SINGAPORE_TARIFF_SGD_PER_KWH, 2),
    peakKw: round(peakKw, 4),
    nonOperatingKwh: round(nonOperatingKwh, 4),
    nonOperatingSharePct: percent(nonOperatingKwh, usageKwh),
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

  return {
    context: input.context,
    summary,
    hourlyProfile: profileResult.rows.map((row) => ({
      hour: numberAt(row, 0),
      averageKw: round(numberAt(row, 1), 4),
      peakKw: round(numberAt(row, 2), 4)
    })),
    childScopes,
    circuits,
    attention: buildAttention({ summary, childScopes, circuits }),
    provenance: {
      dataSnapshotId: input.context.dataSnapshotId,
      hierarchyRevisionId: input.context.hierarchyRevisionId,
      meterFormulaRevisionId: input.context.meterFormulaRevisionId,
      metricVersion: input.context.metricVersion,
      aggregationRule,
      sourceView: scoped.viewName,
      queryIds: ["scope_summary_v1", "hourly_profile_v1", "meter_breakdown_v1"]
    }
  };
};

const buildChildScopes = (input: {
  scopeNodeId: string;
  hierarchy: ReturnType<MetadataStore["energyIq"]["listProjectNodes"]>;
  meterAggregates: MeterAggregate[];
  scopeUsageKwh: number;
}): EnergyScopeAnalysis["childScopes"] => {
  const children = input.hierarchy.filter((node) => node.parent_id === input.scopeNodeId);
  return children.map((child) => {
    const descendantIds = collectDescendantIds(child.id, input.hierarchy);
    descendantIds.add(child.id);
    const meters = input.meterAggregates.filter((meter) => descendantIds.has(meter.scopeId));
    const aggregateMeters = selectAggregateMetersForScope(child.id, meters, input.hierarchy);
    const usageKwh = aggregateMeters.reduce((sum, meter) => sum + meter.usageKwh, 0);
    const breakdownMeters = meters.filter((meter) => meter.scopeId !== child.id);
    const topCircuit = maxBy(breakdownMeters, (meter) => meter.usageKwh);
    const dimensions = resolveScopeDimensions(child.id, input.hierarchy);
    return {
      nodeId: child.id,
      name: child.name,
      nodeType: child.node_type,
      usageKwh: round(usageKwh, 4),
      sharePct: percent(usageKwh, input.scopeUsageKwh),
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

const buildAttention = (input: {
  summary: EnergyScopeAnalysis["summary"];
  childScopes: EnergyScopeAnalysis["childScopes"];
  circuits: EnergyScopeAnalysis["circuits"];
}): EnergyScopeAnalysis["attention"] => {
  if (input.summary.usageKwh <= 0) {
    return [{
      code: "NO_DATA",
      severity: "info",
      title: "No validated consumption in this period",
      evidence: "The trusted scope returned zero valid interval consumption.",
      suggestedAction: "Check the selected period and latest import batch."
    }];
  }
  const attention: EnergyScopeAnalysis["attention"] = [];
  if (input.summary.nonOperatingSharePct >= 10) {
    const breakdownCircuits = input.circuits.filter((circuit) => circuit.meterRole !== "total");
    const topNonOperating = maxBy(
      breakdownCircuits.length > 0 ? breakdownCircuits : input.circuits,
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
  if (highestChild && input.childScopes.length > 1) {
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
  if (normalised.length >= 3) {
    const values = normalised.map((child) => child.kwhPerSqm).sort((left, right) => left - right);
    const median = values[Math.floor(values.length / 2)] ?? 0;
    const highest = maxBy(normalised, (child) => child.kwhPerSqm);
    if (highest && median > 0 && highest.kwhPerSqm >= median * 1.2) {
      attention.push({
        code: "AREA_NORMALISED_OUTLIER",
        severity: "warning",
        title: `${highest.name} has the highest area-normalised consumption`,
        evidence: `${highest.kwhPerSqm.toFixed(2)} kWh/m² versus a sibling median of ${median.toFixed(2)} kWh/m².`,
        suggestedAction: "Check operating hours and circuit composition before comparing absolute kWh alone."
      });
    }
  }
  return attention;
};

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

const selectMetersWithinScope = (meters: MeterAggregate[]): MeterAggregate[] => {
  const totals = meters.filter((meter) => meter.meterRole === "total");
  if (totals.length > 0) return totals;
  const components = meters.filter((meter) => meter.meterRole === "component");
  if (components.length > 0) return components;
  return meters.filter((meter) => meter.meterRole === "submeter");
};

const selectAggregateMetersForScope = (
  scopeId: string,
  meters: MeterAggregate[],
  hierarchy: ReturnType<MetadataStore["energyIq"]["listProjectNodes"]>
): MeterAggregate[] => {
  const parentById = new Map(hierarchy.map((node) => [node.id, node.parent_id]));
  const candidates = meters.flatMap((meter) => {
    const path = pathFromScope(scopeId, meter.scopeId, parentById);
    return path ? [{ meter, depth: path.length - 1, branchId: path[1] ?? scopeId }] : [];
  });
  const direct = candidates.filter((candidate) => candidate.depth === 0).map((candidate) => candidate.meter);
  if (direct.length > 0) return selectMetersWithinScope(direct);

  const byBranch = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const branch = byBranch.get(candidate.branchId) ?? [];
    branch.push(candidate);
    byBranch.set(candidate.branchId, branch);
  }
  const selected: MeterAggregate[] = [];
  for (const branch of byBranch.values()) {
    const minimumDepth = Math.min(...branch.map((candidate) => candidate.depth));
    const nearest = branch.filter((candidate) => candidate.depth === minimumDepth);
    const byScope = new Map<string, MeterAggregate[]>();
    for (const candidate of nearest) {
      const scopeMeters = byScope.get(candidate.meter.scopeId) ?? [];
      scopeMeters.push(candidate.meter);
      byScope.set(candidate.meter.scopeId, scopeMeters);
    }
    for (const scopeMeters of byScope.values()) {
      selected.push(...selectMetersWithinScope(scopeMeters));
    }
  }
  return selected;
};

const pathFromScope = (
  ancestorId: string,
  nodeId: string,
  parentById: Map<string, string | undefined>
): string[] | undefined => {
  const reversed = [nodeId];
  let current = nodeId;
  while (current !== ancestorId) {
    const parent = parentById.get(current);
    if (!parent) return undefined;
    reversed.push(parent);
    current = parent;
  }
  return reversed.reverse();
};

const rowToMeterAggregate = (row: unknown[]): MeterAggregate => ({
  meterNodeId: stringAt(row, 0),
  scopeId: stringAt(row, 1),
  name: stringAt(row, 2),
  appliance: stringAt(row, 3),
  category: stringAt(row, 4),
  meterRole: stringAt(row, 5),
  usageKwh: numberAt(row, 6),
  nonOperatingKwh: numberAt(row, 7),
  peakKw: numberAt(row, 8),
  validIntervalCount: numberAt(row, 9),
  qualityEventCount: numberAt(row, 10)
});

const scopeSummarySql = (viewName: string, meterNodeIds: string[]): string => `
  SELECT
    COALESCE(SUM(usage_kwh), 0) AS usage_kwh,
    COALESCE(MAX(average_kw), 0) AS peak_kw,
    COALESCE(SUM(non_operating_kwh), 0) AS non_operating_kwh,
    COALESCE(SUM(valid_interval_count), 0) AS valid_interval_count,
    COALESCE(SUM(quality_event_count), 0) AS quality_event_count
  FROM (
    SELECT
      local_interval_start,
      SUM(usage_kwh) FILTER (WHERE quality_status = 'ok') AS usage_kwh,
      SUM(average_kw) FILTER (WHERE quality_status = 'ok') AS average_kw,
      SUM(usage_kwh) FILTER (WHERE quality_status = 'ok' AND is_operating = FALSE) AS non_operating_kwh,
      COUNT(*) FILTER (WHERE quality_status = 'ok') AS valid_interval_count,
      COUNT(*) FILTER (WHERE quality_status <> 'ok') AS quality_event_count
    FROM ${quoteIdentifier(viewName)} source
    WHERE ${meterNodeFilter(meterNodeIds)}
    GROUP BY local_interval_start
  ) interval_totals
`;

const hourlyProfileSql = (viewName: string, meterNodeIds: string[]): string => `
  SELECT local_hour, AVG(scope_kw) AS average_kw, MAX(scope_kw) AS peak_kw
  FROM (
    SELECT local_date, local_hour, local_interval_start, SUM(average_kw) AS scope_kw
    FROM ${quoteIdentifier(viewName)} source
    WHERE ${meterNodeFilter(meterNodeIds)}
      AND source.quality_status = 'ok'
    GROUP BY local_date, local_hour, local_interval_start
  ) interval_totals
  GROUP BY local_hour
  ORDER BY local_hour
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
    COALESCE(SUM(usage_kwh) FILTER (WHERE quality_status = 'ok' AND is_operating = FALSE), 0) AS non_operating_kwh,
    COALESCE(MAX(average_kw) FILTER (WHERE quality_status = 'ok'), 0) AS peak_kw,
    COUNT(*) FILTER (WHERE quality_status = 'ok') AS valid_interval_count,
    COUNT(*) FILTER (WHERE quality_status <> 'ok') AS quality_event_count
  FROM ${quoteIdentifier(viewName)}
  GROUP BY meter_node_id
  ORDER BY meter_node_id
`;

const aggregationRuleForMeters = (
  meters: MeterAggregate[]
): EnergyScopeAnalysis["provenance"]["aggregationRule"] => {
  if (meters.some((meter) => meter.meterRole === "total")) return "designated_total";
  if (meters.some((meter) => meter.meterRole === "component")) return "component";
  if (meters.some((meter) => meter.meterRole === "submeter")) return "submeter";
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

const percent = (part: number, total: number): number =>
  total > 0 ? round((part / total) * 100, 2) : 0;

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
