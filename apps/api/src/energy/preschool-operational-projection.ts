import {
  ensureEnergyScopedDataSource,
  type LocalDataGateway,
} from "@datafoundry/data-gateway";
import type {
  EnergyIqOperatingCalendarRevision,
  EnergyIqOperatingTimeRange,
  MetadataStore,
} from "@datafoundry/metadata";

import type { ProjectAnalysisPayload } from "./project-analysis-metadata.js";
import type { PublishedProjectRelease } from "./project-analysis-resolver.js";
import {
  resolveEnergyPublishedMeterRoute,
  type EnergyQueryContext,
} from "./energy-query-context.js";

const PRESCHOOL_PROJECT_ID = "preschool-demo";
const PRESCHOOL_MAY_PERIOD = {
  start: "2026-04-30T16:00:00.000Z",
  endExclusive: "2026-05-31T16:00:00.000Z",
  timezone: "Asia/Singapore",
} as const;
const SPIKE_THRESHOLD_PCT = 50;
const EXPECTED_CENTRE_COUNT = 30;
const EXPECTED_CELL_COUNT = EXPECTED_CENTRE_COUNT * 31 * 24;
const CELL_QUERY_ID = "preschool_centre_hour_cells_v1" as const;

type PreschoolOperatingState = "standby" | "operating";
export type PreschoolOperationalDayType = "weekday" | "weekend" | "calendar_exception";

export type PreschoolOperationalSpike = {
  localDate: string;
  localHour: number;
  dayType: PreschoolOperationalDayType;
  usageKwh: number;
  baselineKwh: number;
  impactKwh: number;
  variancePct: number;
  leadingCircuitName: string;
  leadingCircuitKwh: number;
  leadingCircuitSharePct: number;
};

export type PreschoolOperationalProjection = {
  status: "available";
  contract: {
    id: "preschool-may-2026-operational-behaviour";
    version: "1";
    spikeThresholdPct: 50;
  };
  period: {
    start: string;
    endExclusive: string;
    timezone: string;
  };
  energy: {
    totalKwh: number;
    standbyKwh: number;
    standbySharePct: number;
    operatingKwh: number;
  };
  spikes: Record<PreschoolOperatingState, {
    count: number;
    centreCount: number;
    centres: Array<{
      scopeId: string;
      centreCode: string;
      name: string;
      centreType: string | null;
      spikeCount: number;
      worstSpike: PreschoolOperationalSpike;
    }>;
  }>;
  sop: {
    status: "provisional";
    label: "Provisional after-hours SOP signal";
    baselineScore: 100;
    deductionPerStandbySpike: 1;
    breachingCentreCodes: string[];
    centres: Array<{
      scopeId: string;
      centreCode: string;
      name: string;
      centreType: string | null;
      standbySpikeCount: number;
      score: number;
    }>;
  };
  evidence: {
    projectReleaseId: string;
    dataSnapshotId: string;
    hierarchyRevisionId: string;
    meterMappingRevisionId: string;
    metricRevisionIds: string[];
    businessCalendarVersion: string;
    sourceQueryIds: string[];
    projectionQueryId: "preschool_centre_hour_cells_v1";
    projectionRecipeIds: [
      "preschool-hour-slot-spike-v1",
      "preschool-after-hours-sop-signal-v1",
    ];
    baseline: "same-centre same-hour-slot mean within operating state";
  };
} | {
  status: "unavailable";
  reason: {
    code: "PRESCHOOL_OPERATING_CALENDAR_UNAVAILABLE"
      | "PRESCHOOL_OPERATIONAL_CONTRACT_UNSUPPORTED"
      | "PRESCHOOL_OPERATIONAL_FACTS_UNAVAILABLE"
      | "PRESCHOOL_OPERATIONAL_EVIDENCE_MISMATCH";
    message: string;
  };
  evidence: {
    projectReleaseId: string;
    dataSnapshotId: string;
    businessCalendarVersion: string;
  };
};

export type PreschoolOperationalCell = {
  scopeId: string;
  localDate: string;
  localHour: number;
  usageKwh: number;
  leadingCircuitName: string;
  leadingCircuitKwh: number;
};

type PreschoolCentre = {
  scopeId: string;
  centreCode: string;
  name: string;
  centreType: string | null;
};

export const loadPreschoolOperationalProjection = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  userId: string;
  projectRelease: PublishedProjectRelease;
  context: EnergyQueryContext;
  analysis: ProjectAnalysisPayload;
  databasePath?: string;
}): Promise<PreschoolOperationalProjection> => {
  const unavailableEvidence = unavailableEvidenceFor(input);
  if (input.analysis.offHours.status !== "available") {
    return unavailable(
      "PRESCHOOL_OPERATING_CALENDAR_UNAVAILABLE",
      input.analysis.offHours.reason.message,
      unavailableEvidence,
    );
  }
  if (!hasExpectedEvidencePins(input)) {
    return unavailable(
      "PRESCHOOL_OPERATIONAL_EVIDENCE_MISMATCH",
      "Operational behaviour was withheld because the Calendar, Snapshot, Release, Hierarchy or Mapping pins do not match the current analysis.",
      unavailableEvidence,
    );
  }

  let calendar: EnergyIqOperatingCalendarRevision;
  try {
    calendar = input.metadataStore.energyIq.operationalPolicy
      .getOperatingCalendar(input.projectRelease.businessCalendarVersion);
  } catch {
    return unavailable(
      "PRESCHOOL_OPERATING_CALENDAR_UNAVAILABLE",
      "The release-pinned operating calendar is unavailable for this Project.",
      unavailableEvidence,
    );
  }
  const centres = resolveCentres(input.analysis, input.metadataStore, input.projectRelease);
  if (!centres || !supportedCalendar(calendar)) {
    return unavailable(
      "PRESCHOOL_OPERATIONAL_CONTRACT_UNSUPPORTED",
      "This MVP module requires the published May Calendar to use one Project-wide, whole-hour schedule and 30 published Centres.",
      unavailableEvidence,
    );
  }

  try {
    const publishedRoute = resolveEnergyPublishedMeterRoute({
      metadataStore: input.metadataStore,
      projectId: input.context.projectId,
      hierarchyRevisionId: input.context.hierarchyRevisionId,
      scopeId: input.context.scopeId,
      resource: input.context.resource,
      expectedMeterMappingRevisionId: input.projectRelease.meterMappingRevisionId,
    });
    const scoped = await ensureEnergyScopedDataSource({
      metadataStore: input.metadataStore,
      userId: input.userId,
      context: {
        workspaceId: input.context.workspaceId,
        projectId: input.context.projectId,
        scopeId: input.context.scopeId,
        meterAttachments: publishedRoute.attachments,
        resource: input.context.resource,
        from: input.context.from,
        to: input.context.to,
        timezone: input.context.timezone,
        hierarchyRevisionId: input.context.hierarchyRevisionId,
        meterMappingRevisionId: input.context.meterMappingRevisionId,
        meterFormulaRevisionId: input.context.meterFormulaRevisionId,
        dataSnapshotId: input.context.dataSnapshotId,
        metricVersion: input.context.metricVersion,
      },
      ...(input.databasePath ? { databasePath: input.databasePath } : {}),
    });
    const result = await input.dataGateway.runSqlReadonly({
      user_id: input.userId,
      workspace_id: input.context.workspaceId,
      datasource_id: scoped.datasourceId,
      sql: preschoolCentreHourCellsSql(scoped.viewName),
      limit: EXPECTED_CENTRE_COUNT,
      timeout_ms: 20_000,
    });
    const cells = result.rows.flatMap(rowToCells);
    return buildPreschoolOperationalProjection({
      projectRelease: input.projectRelease,
      dataSnapshotId: input.analysis.provenance.dataSnapshotId,
      period: { start: input.context.from, endExclusive: input.context.to },
      timezone: input.context.timezone,
      analysis: input.analysis,
      calendar,
      centres,
      cells,
    });
  } catch {
    return unavailable(
      "PRESCHOOL_OPERATIONAL_FACTS_UNAVAILABLE",
      "Centre-hour Spike and provisional SOP signals are unavailable because the trusted May fact projection did not complete.",
      unavailableEvidence,
    );
  }
};

export const buildPreschoolOperationalProjection = (input: {
  projectRelease: PublishedProjectRelease;
  dataSnapshotId: string;
  period: { start: string; endExclusive: string };
  timezone: string;
  analysis: Pick<ProjectAnalysisPayload, "offHours" | "provenance">;
  calendar: EnergyIqOperatingCalendarRevision;
  centres: PreschoolCentre[];
  cells: PreschoolOperationalCell[];
}): PreschoolOperationalProjection => {
  const evidence = {
    projectReleaseId: input.projectRelease.id,
    dataSnapshotId: input.dataSnapshotId,
    businessCalendarVersion: input.projectRelease.businessCalendarVersion,
  };
  if (input.analysis.offHours.status !== "available") {
    return unavailable(
      "PRESCHOOL_OPERATING_CALENDAR_UNAVAILABLE",
      input.analysis.offHours.reason.message,
      evidence,
    );
  }
  if (
    input.projectRelease.projectId !== PRESCHOOL_PROJECT_ID
    || input.dataSnapshotId !== input.analysis.provenance.dataSnapshotId
    || input.projectRelease.hierarchyRevisionId !== input.analysis.provenance.hierarchyRevisionId
    || input.projectRelease.meterMappingRevisionId !== input.analysis.provenance.meterMappingRevisionId
    || input.analysis.offHours.businessCalendarVersion !== input.projectRelease.businessCalendarVersion
    || input.calendar.version_id !== input.projectRelease.businessCalendarVersion
    || input.calendar.project_id !== PRESCHOOL_PROJECT_ID
  ) {
    return unavailable(
      "PRESCHOOL_OPERATIONAL_EVIDENCE_MISMATCH",
      "Operational behaviour was withheld because its Evidence pins do not match the current analysis.",
      evidence,
    );
  }
  if (
    input.period.start !== PRESCHOOL_MAY_PERIOD.start
    || input.period.endExclusive !== PRESCHOOL_MAY_PERIOD.endExclusive
    || input.timezone !== PRESCHOOL_MAY_PERIOD.timezone
    || !supportedCalendar(input.calendar)
    || input.centres.length !== EXPECTED_CENTRE_COUNT
    || new Set(input.centres.map((centre) => centre.scopeId)).size !== EXPECTED_CENTRE_COUNT
  ) {
    return unavailable(
      "PRESCHOOL_OPERATIONAL_CONTRACT_UNSUPPORTED",
      "This MVP module only supports the published 30-Centre May 2026 Calendar contract.",
      evidence,
    );
  }
  const knownScopeIds = new Set(input.centres.map((centre) => centre.scopeId));
  if (
    input.cells.length !== EXPECTED_CELL_COUNT
    || input.cells.some((cell) => !knownScopeIds.has(cell.scopeId)
      || !isMayCell(cell)
      || !Number.isFinite(cell.usageKwh)
      || cell.usageKwh < 0)
    || new Set(input.cells.map((cell) => `${cell.scopeId}:${cell.localDate}:${cell.localHour}`)).size
      !== EXPECTED_CELL_COUNT
  ) {
    return unavailable(
      "PRESCHOOL_OPERATIONAL_FACTS_UNAVAILABLE",
      "Centre-hour Spike and provisional SOP signals require one complete accepted hourly cell for every published Centre in May.",
      evidence,
    );
  }

  const calendarEntry = input.calendar.entries[0]!;
  const classified = input.cells.map((cell) => ({
    ...cell,
    operatingState: operatingStateForCell(calendarEntry.weekly, calendarEntry.exceptions ?? [], cell),
  }));
  if (classified.some((cell) => cell.operatingState === null)) {
    return unavailable(
      "PRESCHOOL_OPERATIONAL_CONTRACT_UNSUPPORTED",
      "The current operating calendar contains a partial-hour or overnight window that this hourly MVP projection cannot classify without ambiguity.",
      evidence,
    );
  }

  const baselines = new Map<string, { total: number; count: number }>();
  for (const cell of classified) {
    const key = `${cell.scopeId}:${cell.localHour}:${cell.operatingState}`;
    const current = baselines.get(key) ?? { total: 0, count: 0 };
    current.total += cell.usageKwh;
    current.count += 1;
    baselines.set(key, current);
  }
  const spikes = classified.flatMap((cell) => {
    const operatingState = cell.operatingState as PreschoolOperatingState;
    const baselineGroup = baselines.get(`${cell.scopeId}:${cell.localHour}:${operatingState}`);
    if (!baselineGroup || baselineGroup.count === 0) return [];
    const baselineKwh = baselineGroup.total / baselineGroup.count;
    if (!(baselineKwh > 0) || cell.usageKwh <= baselineKwh * (1 + SPIKE_THRESHOLD_PCT / 100)) return [];
    return [{
      scopeId: cell.scopeId,
      operatingState,
      localDate: cell.localDate,
      localHour: cell.localHour,
      dayType: dayTypeForDate(calendarEntry.exceptions ?? [], cell.localDate),
      usageKwh: round(cell.usageKwh),
      baselineKwh: round(baselineKwh),
      impactKwh: round(cell.usageKwh - baselineKwh),
      variancePct: round(((cell.usageKwh - baselineKwh) / baselineKwh) * 100),
      leadingCircuitName: cell.leadingCircuitName,
      leadingCircuitKwh: round(cell.leadingCircuitKwh),
      leadingCircuitSharePct: cell.usageKwh > 0
        ? round((cell.leadingCircuitKwh / cell.usageKwh) * 100)
        : 0,
    }];
  });
  const centreByScopeId = new Map(input.centres.map((centre) => [centre.scopeId, centre]));
  const segment = (operatingState: PreschoolOperatingState) => {
    const segmentSpikes = spikes.filter((spike) => spike.operatingState === operatingState);
    const grouped = new Map<string, typeof segmentSpikes>();
    for (const spike of segmentSpikes) {
      const rows = grouped.get(spike.scopeId) ?? [];
      rows.push(spike);
      grouped.set(spike.scopeId, rows);
    }
    const centres = [...grouped].map(([scopeId, rows]) => {
      const centre = centreByScopeId.get(scopeId);
      if (!centre) throw new Error(`PRESCHOOL_OPERATIONAL_CENTRE_MISSING:${scopeId}`);
      const ordered = [...rows].sort(compareSpikes);
      const worst = ordered[0]!;
      return {
        ...centre,
        spikeCount: ordered.length,
        worstSpike: withoutInternalSpikeFields(worst),
      };
    }).sort((left, right) => right.spikeCount - left.spikeCount
      || right.worstSpike.variancePct - left.worstSpike.variancePct
      || left.centreCode.localeCompare(right.centreCode));
    return { count: segmentSpikes.length, centreCount: centres.length, centres };
  };
  const standby = segment("standby");
  const operating = segment("operating");
  const standbyCountByScopeId = new Map(standby.centres.map((centre) => [centre.scopeId, centre.spikeCount]));
  const sopCentres = input.centres.map((centre) => {
    const standbySpikeCount = standbyCountByScopeId.get(centre.scopeId) ?? 0;
    return {
      ...centre,
      standbySpikeCount,
      score: Math.max(0, 100 - standbySpikeCount),
    };
  }).sort((left, right) => left.score - right.score
    || right.standbySpikeCount - left.standbySpikeCount
    || left.centreCode.localeCompare(right.centreCode));

  return {
    status: "available",
    contract: {
      id: "preschool-may-2026-operational-behaviour",
      version: "1",
      spikeThresholdPct: SPIKE_THRESHOLD_PCT,
    },
    period: { ...input.period, timezone: input.timezone },
    energy: {
      totalKwh: input.analysis.offHours.usageKwh,
      standbyKwh: input.analysis.offHours.standbyKwh,
      standbySharePct: input.analysis.offHours.sharePct,
      operatingKwh: input.analysis.offHours.operatingKwh,
    },
    spikes: { standby, operating },
    sop: {
      status: "provisional",
      label: "Provisional after-hours SOP signal",
      baselineScore: 100,
      deductionPerStandbySpike: 1,
      breachingCentreCodes: sopCentres
        .filter((centre) => centre.standbySpikeCount > 0)
        .map((centre) => centre.centreCode),
      centres: sopCentres,
    },
    evidence: {
      projectReleaseId: input.projectRelease.id,
      dataSnapshotId: input.dataSnapshotId,
      hierarchyRevisionId: input.projectRelease.hierarchyRevisionId,
      meterMappingRevisionId: input.projectRelease.meterMappingRevisionId,
      metricRevisionIds: [...input.projectRelease.metricRevisionIds].sort((left, right) => left.localeCompare(right)),
      businessCalendarVersion: input.projectRelease.businessCalendarVersion,
      sourceQueryIds: [...input.analysis.provenance.queryIds],
      projectionQueryId: CELL_QUERY_ID,
      projectionRecipeIds: [
        "preschool-hour-slot-spike-v1",
        "preschool-after-hours-sop-signal-v1",
      ],
      baseline: "same-centre same-hour-slot mean within operating state",
    },
  };
};

const resolveCentres = (
  analysis: ProjectAnalysisPayload,
  metadataStore: MetadataStore,
  projectRelease: PublishedProjectRelease,
): PreschoolCentre[] | null => {
  const hierarchy = metadataStore.energyIq.projectSetup
    .listHierarchyRevisions(PRESCHOOL_PROJECT_ID)
    .find((revision) => revision.id === projectRelease.hierarchyRevisionId);
  if (!hierarchy) return null;
  const document = JSON.parse(hierarchy.snapshot_json) as {
    nodes: Array<{ id: string; metadata?: Record<string, unknown> }>;
  };
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]));
  const centres = analysis.childScopes.map((scope) => {
    const metadata = nodesById.get(scope.nodeId)?.metadata;
    const centreCode = metadata?.centreCode;
    const facilityType = metadata?.facilityType;
    return typeof centreCode === "string" && centreCode.trim()
      ? {
          scopeId: scope.nodeId,
          centreCode: centreCode.trim(),
          name: scope.name,
          centreType: typeof facilityType === "string" && facilityType.trim()
            ? facilityType.trim()
            : null,
        }
      : null;
  });
  return centres.every((centre): centre is PreschoolCentre => centre !== null) ? centres : null;
};

const supportedCalendar = (calendar: EnergyIqOperatingCalendarRevision): boolean => {
  if (
    calendar.project_id !== PRESCHOOL_PROJECT_ID
    || calendar.timezone !== PRESCHOOL_MAY_PERIOD.timezone
    || calendar.entries.length !== 1
    || calendar.entries[0]?.owner.kind !== "project"
  ) return false;
  const entry = calendar.entries[0];
  const effectiveFrom = entry.effective_from.slice(0, 10);
  const effectiveTo = entry.effective_to?.slice(0, 10);
  return effectiveFrom <= "2026-05-01"
    && (!effectiveTo || effectiveTo >= "2026-06-01")
    && Object.values(entry.weekly).flat().every(supportedTimeRange)
    && (entry.exceptions ?? []).every((exception) => exception.operating.every(supportedTimeRange));
};

const supportedTimeRange = (range: EnergyIqOperatingTimeRange): boolean => {
  const from = minutesOfDay(range.from);
  const to = minutesOfDay(range.to);
  return from !== null && to !== null && from % 60 === 0 && to % 60 === 0 && from < to;
};

const operatingStateForCell = (
  weekly: EnergyIqOperatingCalendarRevision["entries"][number]["weekly"],
  exceptions: NonNullable<EnergyIqOperatingCalendarRevision["entries"][number]["exceptions"]>,
  cell: PreschoolOperationalCell,
): PreschoolOperatingState | null => {
  const exception = exceptions.find((candidate) => candidate.date === cell.localDate);
  const ranges = exception?.operating ?? weekly[dayName(cell.localDate)];
  const cellFrom = cell.localHour * 60;
  const cellTo = cellFrom + 60;
  const overlap = ranges.reduce((total, range) => {
    const from = minutesOfDay(range.from);
    const to = minutesOfDay(range.to);
    if (from === null || to === null) return total;
    return total + Math.max(0, Math.min(cellTo, to) - Math.max(cellFrom, from));
  }, 0);
  return overlap === 60 ? "operating" : overlap === 0 ? "standby" : null;
};

const dayName = (localDate: string): keyof EnergyIqOperatingCalendarRevision["entries"][number]["weekly"] => {
  const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
  return names[new Date(`${localDate}T00:00:00.000Z`).getUTCDay()]!;
};

const dayTypeForDate = (
  exceptions: NonNullable<EnergyIqOperatingCalendarRevision["entries"][number]["exceptions"]>,
  localDate: string,
): PreschoolOperationalDayType => {
  if (exceptions.some((exception) => exception.date === localDate)) return "calendar_exception";
  const localDay = dayName(localDate);
  return localDay === "saturday" || localDay === "sunday" ? "weekend" : "weekday";
};

const minutesOfDay = (value: string): number | null => {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  if (hour === 24 && minute === 0) return 24 * 60;
  return hour >= 0 && hour <= 23 ? hour * 60 + minute : null;
};

const hasExpectedEvidencePins = (input: {
  projectRelease: PublishedProjectRelease;
  context: EnergyQueryContext;
  analysis: ProjectAnalysisPayload;
}): boolean => input.projectRelease.projectId === PRESCHOOL_PROJECT_ID
  && input.context.projectId === PRESCHOOL_PROJECT_ID
  && input.context.scopeId === "preschool-project"
  && input.context.from === PRESCHOOL_MAY_PERIOD.start
  && input.context.to === PRESCHOOL_MAY_PERIOD.endExclusive
  && input.context.timezone === PRESCHOOL_MAY_PERIOD.timezone
  && input.context.dataSnapshotId === input.analysis.provenance.dataSnapshotId
  && input.context.hierarchyRevisionId === input.projectRelease.hierarchyRevisionId
  && input.context.meterMappingRevisionId === input.projectRelease.meterMappingRevisionId
  && input.analysis.provenance.hierarchyRevisionId === input.projectRelease.hierarchyRevisionId
  && input.analysis.provenance.meterMappingRevisionId === input.projectRelease.meterMappingRevisionId
  && input.analysis.offHours.status === "available"
  && input.analysis.offHours.businessCalendarVersion === input.projectRelease.businessCalendarVersion;

const unavailableEvidenceFor = (input: {
  projectRelease: PublishedProjectRelease;
  context: EnergyQueryContext;
  analysis: ProjectAnalysisPayload;
}) => ({
  projectReleaseId: input.projectRelease.id,
  dataSnapshotId: input.analysis.provenance.dataSnapshotId,
  businessCalendarVersion: input.projectRelease.businessCalendarVersion,
});

const unavailable = (
  code: Extract<PreschoolOperationalProjection, { status: "unavailable" }>["reason"]["code"],
  message: string,
  evidence: Extract<PreschoolOperationalProjection, { status: "unavailable" }>["evidence"],
): PreschoolOperationalProjection => ({ status: "unavailable", reason: { code, message }, evidence });

const isMayCell = (cell: PreschoolOperationalCell): boolean => cell.localDate >= "2026-05-01"
  && cell.localDate <= "2026-05-31"
  && Number.isInteger(cell.localHour)
  && cell.localHour >= 0
  && cell.localHour <= 23;

const compareSpikes = (
  left: { variancePct: number; localDate: string; localHour: number },
  right: { variancePct: number; localDate: string; localHour: number },
): number => right.variancePct - left.variancePct
  || left.localDate.localeCompare(right.localDate)
  || left.localHour - right.localHour;

const withoutInternalSpikeFields = (spike: {
  scopeId: string;
  operatingState: PreschoolOperatingState;
} & PreschoolOperationalSpike): PreschoolOperationalSpike => {
  const { scopeId: _scopeId, operatingState: _operatingState, ...publicSpike } = spike;
  return publicSpike;
};

const round = (value: number): number => Math.round((value + Number.EPSILON) * 10_000) / 10_000;

const rowToCells = (row: unknown[]): PreschoolOperationalCell[] => {
  const scopeId = typeof row[0] === "string" ? row[0] : "";
  const json = typeof row[1] === "string" ? row[1] : "[]";
  const parsed = JSON.parse(json) as unknown;
  if (!scopeId || !Array.isArray(parsed)) throw new Error("PRESCHOOL_OPERATIONAL_CELL_ROW_INVALID");
  return parsed.map((item) => {
    if (!isRecord(item)) throw new Error("PRESCHOOL_OPERATIONAL_CELL_INVALID");
    const localDate = String(item.local_date ?? "");
    const localHour = Number(item.local_hour);
    const usageKwh = Number(item.usage_kwh);
    const leadingCircuitName = String(item.leading_circuit_name ?? "");
    const leadingCircuitKwh = Number(item.leading_circuit_kwh);
    if (!localDate || !Number.isInteger(localHour) || !Number.isFinite(usageKwh)
      || !leadingCircuitName || !Number.isFinite(leadingCircuitKwh)) {
      throw new Error("PRESCHOOL_OPERATIONAL_CELL_INVALID");
    }
    return { scopeId, localDate, localHour, usageKwh, leadingCircuitName, leadingCircuitKwh };
  });
};

const preschoolCentreHourCellsSql = (viewName: string): string => `
  SELECT
    scope_id,
    TO_JSON(LIST(STRUCT_PACK(
      local_date := local_date,
      local_hour := local_hour,
      usage_kwh := usage_kwh,
      leading_circuit_name := circuit_name,
      leading_circuit_kwh := circuit_kwh
    ) ORDER BY local_date, local_hour)) AS cells_json
  FROM (
    SELECT
      circuit_cells.*,
      SUM(circuit_kwh) OVER (PARTITION BY scope_id, local_date, local_hour) AS usage_kwh,
      ROW_NUMBER() OVER (
        PARTITION BY scope_id, local_date, local_hour
        ORDER BY circuit_kwh DESC, circuit_name ASC
      ) AS driver_rank
    FROM (
      SELECT
        source.parent_node_id AS scope_id,
        STRFTIME(CAST(source.local_interval_start AS DATE), '%Y-%m-%d') AS local_date,
        source.local_hour,
        source.circuit_name,
        SUM(source.usage_kwh) AS circuit_kwh
      FROM ${quoteIdentifier(viewName)} source
      WHERE source.quality_status = 'ok'
        AND source.official_aggregation_eligible = TRUE
      GROUP BY source.parent_node_id, CAST(source.local_interval_start AS DATE), source.local_hour, source.circuit_name
    ) circuit_cells
  ) ranked
  WHERE driver_rank = 1
  GROUP BY scope_id
  ORDER BY scope_id
`;

const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
