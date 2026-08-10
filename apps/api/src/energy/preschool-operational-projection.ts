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
import {
  PRESCHOOL_EXPECTED_APPLIANCE_ALIAS_COUNT,
  preschoolApplianceAliasForPublishedCircuit,
  preschoolApplianceContractForAlias,
} from "./preschool-appliance-projection.js";

const PRESCHOOL_PROJECT_ID = "preschool-demo";
const PRESCHOOL_MAY_PERIOD = {
  start: "2026-04-30T16:00:00.000Z",
  endExclusive: "2026-05-31T16:00:00.000Z",
  timezone: "Asia/Singapore",
} as const;
const SPIKE_THRESHOLD_PCT = 50;
const EXPECTED_CENTRE_COUNT = 30;
const PRESCHOOL_OPERATIONAL_ROLLING_DAY_COUNT = 28;
const PRESCHOOL_OPERATIONAL_FIXTURE_START = "2026-05-01";
const PRESCHOOL_OPERATIONAL_FIXTURE_END_EXCLUSIVE = "2026-07-01";
const CELL_QUERY_ID = "preschool_centre_hour_appliance_cells_v2" as const;
const DAILY_TOTALS_QUERY_ID = "daily_totals_v1" as const;
const RECONCILIATION_TOLERANCE_KWH = 0.01;
const PRESCHOOL_MAY_COMPLETE_WEEK_STARTS = [
  "2026-05-04",
  "2026-05-11",
  "2026-05-18",
  "2026-05-25",
] as const;
const PRESCHOOL_JUNE_PERIOD = {
  start: "2026-06-01",
  endInclusive: "2026-06-30",
  days: 30,
} as const;
const PRESCHOOL_DEMO_TARIFF_REFERENCE = {
  sourceName: "SP Group",
  sourceUrl: "https://www.spgroup.com.sg/about-us/media-resources/news-and-media-releases/Electricity-Tariff-Revision-for-the-Period-1-April-to-30-June-2026",
  appendixUrl: "https://www.spgroup.com.sg/dam/spgroup/images/news-media-releases/2026/Appendix-2---Q2-2026.png0",
  supplyClass: "Low tension, non-domestic",
  appliesFrom: "2026-04-01",
  appliesTo: "2026-06-30",
  beforeGstSgdPerKwh: 0.2727,
  withGstSgdPerKwh: 0.2972,
} as const;

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

export type PreschoolOperationalCircuitCell = {
  circuitId: string;
  name: string;
  category: string;
  usageKwh: number;
};

export type PreschoolOperationalApplianceComposition = {
  totalKwh: number;
  provisionalCostBeforeGstSgd: number;
  reconciliationGapKwh: number;
  applianceGroups: Array<{
    name: string;
    usageKwh: number;
    sharePct: number;
    provisionalCostBeforeGstSgd: number;
    sourceAliases: string[];
  }>;
  appliances: Array<{
    name: string;
    applianceGroup: string;
    usageKwh: number;
    sharePct: number;
    provisionalCostBeforeGstSgd: number;
    centreCount: number;
    sourceCircuitIds: string[];
  }>;
};

export type PreschoolOperationalProjection = {
  status: "available";
  contract: {
    id: "preschool-may-2026-operational-behaviour";
    version: "2" | "3";
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
    operatingSharePct: number;
    provisionalStandbyCostBeforeGstSgd: number;
    provisionalOperatingCostBeforeGstSgd: number;
  };
  tariffReference: typeof PRESCHOOL_DEMO_TARIFF_REFERENCE;
  standbyAppliances: PreschoolOperationalApplianceComposition;
  operatingAppliances: PreschoolOperationalApplianceComposition;
  hourlyProfile: {
    completeDayCount: number;
    unit: "mean kWh per complete day";
    rows: Array<{
      localHour: number;
      operatingKwh: number;
      closedHourKwh: number;
      totalKwh: number;
    }>;
  };
  planningOutlook: {
    status: "provisional";
    contract: {
      id: "preschool-june-2026-naive-weekly-baseline";
      version: "1";
      method: "mean of four complete Monday-Sunday weeks";
    };
    targetPeriod: typeof PRESCHOOL_JUNE_PERIOD;
    sourceWeeks: Array<{
      start: string;
      endInclusive: string;
      usageKwh: number;
    }>;
    weeklyBaseline: {
      averageKwh: number;
      minimumKwh: number;
      maximumKwh: number;
    };
    usageEstimate: {
      projectedKwh: number;
      lowerKwh: number;
      upperKwh: number;
    };
    costEstimate: {
      currency: "SGD";
      currentPeriodBeforeGstSgd: number;
      projectedBeforeGstSgd: number;
      lowerBeforeGstSgd: number;
      upperBeforeGstSgd: number;
    };
    tariffReference: typeof PRESCHOOL_DEMO_TARIFF_REFERENCE;
    evidence: {
      dataSnapshotId: string;
      queryId: "daily_totals_v1";
      recipeId: "preschool-naive-weekly-planning-baseline-v1";
    };
    estimateSeries?: PreschoolPlanningEstimateSeries;
    limitations: string[];
  } | {
    status: "unavailable";
    reason: {
      code: "PRESCHOOL_PLANNING_BASELINE_INCOMPLETE";
      message: string;
    };
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
      events: PreschoolOperationalSpike[];
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
    projectionQueryId: "preschool_centre_hour_appliance_cells_v2";
    projectionRecipeIds: [
      "preschool-hour-slot-spike-v1",
      "preschool-after-hours-sop-signal-v1",
      "preschool-operating-state-appliance-v1",
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
  circuits: PreschoolOperationalCircuitCell[];
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
  const periodContract = resolveOperationalPeriodContract(
    { start: input.context.from, endExclusive: input.context.to },
    input.context.timezone,
  );
  if (!centres || !periodContract || !supportedCalendar(calendar, periodContract)) {
    return unavailable(
      "PRESCHOOL_OPERATIONAL_CONTRACT_UNSUPPORTED",
      "This MVP module requires a release-pinned Project-wide, whole-hour Calendar covering the accepted period and 30 published Centres.",
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
      "Centre-hour Spike and provisional SOP signals are unavailable because the trusted accepted-window fact projection did not complete.",
      unavailableEvidence,
    );
  }
};

export const buildPreschoolOperationalProjection = (input: {
  projectRelease: PublishedProjectRelease;
  dataSnapshotId: string;
  period: { start: string; endExclusive: string };
  timezone: string;
  analysis: Pick<ProjectAnalysisPayload, "offHours" | "provenance"> & {
    context?: Pick<ProjectAnalysisPayload["context"], "scopeId">;
    dailyTotals?: ProjectAnalysisPayload["dailyTotals"];
  };
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
  const periodContract = resolveOperationalPeriodContract(input.period, input.timezone);
  if (
    !periodContract
    || !supportedCalendar(input.calendar, periodContract)
    || input.centres.length !== EXPECTED_CENTRE_COUNT
    || new Set(input.centres.map((centre) => centre.scopeId)).size !== EXPECTED_CENTRE_COUNT
  ) {
    return unavailable(
      "PRESCHOOL_OPERATIONAL_CONTRACT_UNSUPPORTED",
      "This MVP module only supports the published 30-Centre full-May Golden or a complete 28-day May/June accepted window.",
      evidence,
    );
  }
  const knownScopeIds = new Set(input.centres.map((centre) => centre.scopeId));
  if (
    input.cells.length !== periodContract.expectedCellCount
    || input.cells.some((cell) => !knownScopeIds.has(cell.scopeId)
      || !isCellInOperationalPeriod(cell, periodContract)
      || !Number.isFinite(cell.usageKwh)
      || cell.usageKwh < 0)
    || new Set(input.cells.map((cell) => `${cell.scopeId}:${cell.localDate}:${cell.localHour}`)).size
      !== periodContract.expectedCellCount
  ) {
    return unavailable(
      "PRESCHOOL_OPERATIONAL_FACTS_UNAVAILABLE",
      "Centre-hour Spike and provisional SOP signals require one complete accepted hourly cell for every published Centre and local day in the accepted period.",
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
  const standbyAppliances = buildOperatingStateApplianceComposition({
    cells: classified as Array<PreschoolOperationalCell & { operatingState: PreschoolOperatingState }>,
    centres: input.centres,
    operatingState: "standby",
    expectedKwh: input.analysis.offHours.standbyKwh,
  });
  const operatingAppliances = buildOperatingStateApplianceComposition({
    cells: classified as Array<PreschoolOperationalCell & { operatingState: PreschoolOperatingState }>,
    centres: input.centres,
    operatingState: "operating",
    expectedKwh: input.analysis.offHours.operatingKwh,
  });
  if (!standbyAppliances || !operatingAppliances) {
    return unavailable(
      "PRESCHOOL_OPERATIONAL_FACTS_UNAVAILABLE",
      "Operating-state Appliance evidence was withheld because published Circuit aliases were incomplete or did not reconcile to the accepted standby and operating totals.",
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
      leadingCircuitName: preschoolApplianceAliasForPublishedCircuit(
        cell.leadingCircuitName,
        cell.scopeId,
      ) ?? cell.leadingCircuitName,
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
        events: ordered.map(withoutInternalSpikeFields),
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
  const completeDayCount = new Set(classified.map((cell) => cell.localDate)).size;
  const hourlyProfile = Array.from({ length: 24 }, (_, localHour) => {
    const hourCells = classified.filter((cell) => cell.localHour === localHour);
    const operatingKwh = hourCells
      .filter((cell) => cell.operatingState === "operating")
      .reduce((total, cell) => total + cell.usageKwh, 0) / completeDayCount;
    const closedHourKwh = hourCells
      .filter((cell) => cell.operatingState === "standby")
      .reduce((total, cell) => total + cell.usageKwh, 0) / completeDayCount;
    return {
      localHour,
      operatingKwh: round(operatingKwh),
      closedHourKwh: round(closedHourKwh),
      totalKwh: round(operatingKwh + closedHourKwh),
    };
  });
  const planningOutlook = buildPreschoolPlanningOutlook(input.analysis);

  return {
    status: "available",
    contract: {
      id: "preschool-may-2026-operational-behaviour",
      version: "3",
      spikeThresholdPct: SPIKE_THRESHOLD_PCT,
    },
    period: { ...input.period, timezone: input.timezone },
    energy: {
      totalKwh: round(input.analysis.offHours.operatingKwh + input.analysis.offHours.standbyKwh),
      standbyKwh: input.analysis.offHours.standbyKwh,
      standbySharePct: input.analysis.offHours.sharePct,
      operatingKwh: input.analysis.offHours.operatingKwh,
      operatingSharePct: percent(
        input.analysis.offHours.operatingKwh,
        input.analysis.offHours.operatingKwh + input.analysis.offHours.standbyKwh,
      ),
      provisionalStandbyCostBeforeGstSgd: round(
        input.analysis.offHours.standbyKwh * PRESCHOOL_DEMO_TARIFF_REFERENCE.beforeGstSgdPerKwh,
      ),
      provisionalOperatingCostBeforeGstSgd: round(
        input.analysis.offHours.operatingKwh * PRESCHOOL_DEMO_TARIFF_REFERENCE.beforeGstSgdPerKwh,
      ),
    },
    tariffReference: PRESCHOOL_DEMO_TARIFF_REFERENCE,
    standbyAppliances,
    operatingAppliances,
    hourlyProfile: {
      completeDayCount,
      unit: "mean kWh per complete day",
      rows: hourlyProfile,
    },
    planningOutlook,
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
        "preschool-operating-state-appliance-v1",
      ],
      baseline: "same-centre same-hour-slot mean within operating state",
    },
  };
};

const buildOperatingStateApplianceComposition = (input: {
  cells: Array<PreschoolOperationalCell & { operatingState: PreschoolOperatingState }>;
  centres: PreschoolCentre[];
  operatingState: PreschoolOperatingState;
  expectedKwh: number;
}): PreschoolOperationalApplianceComposition | null => {
  const applianceRows = new Map<string, {
    applianceGroup: string;
    usageKwh: number;
    centreIds: Set<string>;
    sourceCircuitIds: Set<string>;
  }>();
  let stateCircuitTotalKwh = 0;
  for (const cell of input.cells) {
    if (cell.circuits.length === 0) return null;
    const cellCircuitTotalKwh = cell.circuits.reduce((sum, circuit) => sum + circuit.usageKwh, 0);
    if (Math.abs(cellCircuitTotalKwh - cell.usageKwh) > RECONCILIATION_TOLERANCE_KWH) return null;
    for (const circuit of cell.circuits) {
      const alias = preschoolApplianceAliasForPublishedCircuit(circuit.name, cell.scopeId);
      const aliasContract = alias ? preschoolApplianceContractForAlias(alias) : null;
      if (
        !alias
        || !aliasContract
        || aliasContract.category !== circuit.category
        || !circuit.circuitId
        || !Number.isFinite(circuit.usageKwh)
        || circuit.usageKwh < 0
      ) return null;
      if (cell.operatingState !== input.operatingState) continue;
      const row = applianceRows.get(alias) ?? {
        applianceGroup: aliasContract.applianceGroup,
        usageKwh: 0,
        centreIds: new Set<string>(),
        sourceCircuitIds: new Set<string>(),
      };
      row.usageKwh += circuit.usageKwh;
      row.centreIds.add(cell.scopeId);
      row.sourceCircuitIds.add(circuit.circuitId);
      applianceRows.set(alias, row);
      stateCircuitTotalKwh += circuit.usageKwh;
    }
  }
  if (
    applianceRows.size === 0
    || (input.operatingState === "standby"
      && applianceRows.size !== PRESCHOOL_EXPECTED_APPLIANCE_ALIAS_COUNT)
    || [...applianceRows.values()].some((row) => (
      row.centreIds.size !== input.centres.length
      || row.sourceCircuitIds.size !== input.centres.length
    ))
  ) return null;
  const roundedGapKwh = round(stateCircuitTotalKwh - input.expectedKwh);
  const reconciliationGapKwh = Object.is(roundedGapKwh, -0) ? 0 : roundedGapKwh;
  if (Math.abs(reconciliationGapKwh) > RECONCILIATION_TOLERANCE_KWH) return null;

  const appliances = [...applianceRows.entries()]
    .map(([name, row]) => ({
      name,
      applianceGroup: row.applianceGroup,
      usageKwh: round(row.usageKwh),
      sharePct: percent(row.usageKwh, input.expectedKwh),
      provisionalCostBeforeGstSgd: round(row.usageKwh * PRESCHOOL_DEMO_TARIFF_REFERENCE.beforeGstSgdPerKwh),
      centreCount: row.centreIds.size,
      sourceCircuitIds: [...row.sourceCircuitIds].sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => right.usageKwh - left.usageKwh || left.name.localeCompare(right.name));
  const groupRows = new Map<string, { usageKwh: number; sourceAliases: string[] }>();
  for (const appliance of appliances) {
    const row = groupRows.get(appliance.applianceGroup) ?? { usageKwh: 0, sourceAliases: [] };
    row.usageKwh += appliance.usageKwh;
    row.sourceAliases.push(appliance.name);
    groupRows.set(appliance.applianceGroup, row);
  }

  return {
    totalKwh: round(input.expectedKwh),
    provisionalCostBeforeGstSgd: round(
      input.expectedKwh * PRESCHOOL_DEMO_TARIFF_REFERENCE.beforeGstSgdPerKwh,
    ),
    reconciliationGapKwh,
    applianceGroups: [...groupRows.entries()]
      .map(([name, row]) => ({
        name,
        usageKwh: round(row.usageKwh),
        sharePct: percent(row.usageKwh, input.expectedKwh),
        provisionalCostBeforeGstSgd: round(
          row.usageKwh * PRESCHOOL_DEMO_TARIFF_REFERENCE.beforeGstSgdPerKwh,
        ),
        sourceAliases: row.sourceAliases.sort((left, right) => left.localeCompare(right)),
      }))
      .sort((left, right) => right.usageKwh - left.usageKwh || left.name.localeCompare(right.name)),
    appliances,
  };
};

export type PreschoolPlanningAnalysisInput = {
  offHours: { status: string };
  provenance: {
    dataSnapshotId: string;
    queryIds: readonly string[];
  };
  context?: { scopeId: string } | undefined;
  dailyTotals?: {
    timezone: string;
    scopes: Array<{
      scopeId: string;
      scopeName?: string;
      scopeType?: string;
      rows: Array<{
        localDate: string;
        usageKwh: number | null;
        dataHealth: { status: "complete" | "partial" | "unavailable" };
      }>;
    }>;
  } | undefined;
};

export type PreschoolPlanningEstimateBucket = {
  start: string;
  endExclusive: string;
  estimatedKwh: number;
};

export type PreschoolPlanningEstimateSeries = {
  contract: {
    id: "preschool-june-2026-estimate-series";
    version: "1";
    method: "same-weekday mean from four complete May weeks, scaled to the Saved Plan total";
  };
  scopes: Array<{
    scopeId: string;
    scopeName: string;
    scopeType: string;
    scopeRole: "portfolio" | "centre";
    estimatedKwh: number;
    buckets: Record<"daily" | "weekly" | "monthly", PreschoolPlanningEstimateBucket[]>;
  }>;
};

export const buildPreschoolPlanningOutlook = (
  analysis: PreschoolPlanningAnalysisInput,
): Extract<PreschoolOperationalProjection, { status: "available" }>["planningOutlook"] => (
  buildPreschoolPlanningOutlookFromCompleteMayRows({
    analysis,
    currentPeriodDates: Array.from({ length: 31 }, (_, offset) => (
      `2026-05-${String(offset + 1).padStart(2, "0")}`
    )),
    additionalLimitations: [],
  })
);

export const recoverPreschoolPlanningOutlookFromCompleteWeeks = (
  analysis: PreschoolPlanningAnalysisInput,
): Extract<PreschoolOperationalProjection, { status: "available" }>["planningOutlook"] => (
  buildPreschoolPlanningOutlookFromCompleteMayRows({
    analysis,
    currentPeriodDates: Array.from({ length: 28 }, (_, offset) => (
      `2026-05-${String(offset + 4).padStart(2, "0")}`
    )),
    additionalLimitations: [
      "Current-period cost uses the complete May 4-31 source window because May 1-3 are outside the Saved Overview period.",
    ],
  })
);

const buildPreschoolPlanningOutlookFromCompleteMayRows = (input: {
  analysis: PreschoolPlanningAnalysisInput;
  currentPeriodDates: string[];
  additionalLimitations: string[];
}): Extract<PreschoolOperationalProjection, { status: "available" }>["planningOutlook"] => {
  const { analysis } = input;
  const dailyTotals = analysis.dailyTotals;
  const scopeId = analysis.context?.scopeId;
  const unavailable = (): Extract<PreschoolOperationalProjection, { status: "available" }>["planningOutlook"] => ({
    status: "unavailable",
    reason: {
      code: "PRESCHOOL_PLANNING_BASELINE_INCOMPLETE",
      message: "June planning baseline needs four complete Monday-Sunday weeks from the same accepted May Snapshot.",
    },
  });
  if (analysis.offHours.status !== "available") return unavailable();
  if (
    !dailyTotals
    || !scopeId
    || dailyTotals.timezone !== PRESCHOOL_MAY_PERIOD.timezone
    || !analysis.provenance.queryIds.includes(DAILY_TOTALS_QUERY_ID)
  ) return unavailable();
  const scope = dailyTotals.scopes.find((candidate) => candidate.scopeId === scopeId);
  if (!scope) return unavailable();
  const rowByDate = new Map(scope.rows.map((row) => [row.localDate, row]));
  const currentPeriodRows = completePlanningRows(rowByDate, input.currentPeriodDates);
  if (!currentPeriodRows) return unavailable();
  const currentPeriodUsageKwh = currentPeriodRows
    .reduce((total, row) => total + (row.usageKwh ?? 0), 0);
  const sourceWeeks = PRESCHOOL_MAY_COMPLETE_WEEK_STARTS.flatMap((start) => {
    const dates = Array.from({ length: 7 }, (_, offset) => {
      const date = new Date(`${start}T00:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() + offset);
      return date.toISOString().slice(0, 10);
    });
    const rows = completePlanningRows(rowByDate, dates);
    if (!rows) return [];
    return [{
      start,
      endInclusive: rows[rows.length - 1]!.localDate,
      usageKwh: round(rows.reduce((total, row) => total + (row.usageKwh ?? 0), 0)),
    }];
  });
  if (sourceWeeks.length !== PRESCHOOL_MAY_COMPLETE_WEEK_STARTS.length) return unavailable();
  const weeklyValues = sourceWeeks.map((week) => week.usageKwh);
  const weeklyAverageKwh = weeklyValues.reduce((total, value) => total + value, 0) / weeklyValues.length;
  const targetScale = PRESCHOOL_JUNE_PERIOD.days / 7;
  const projectedKwh = weeklyAverageKwh * targetScale;
  const lowerKwh = Math.min(...weeklyValues) * targetScale;
  const upperKwh = Math.max(...weeklyValues) * targetScale;
  const rate = PRESCHOOL_DEMO_TARIFF_REFERENCE.beforeGstSgdPerKwh;
  const estimateSeries = buildPreschoolPlanningEstimateSeries(analysis, round(projectedKwh));
  return {
    status: "provisional",
    contract: {
      id: "preschool-june-2026-naive-weekly-baseline",
      version: "1",
      method: "mean of four complete Monday-Sunday weeks",
    },
    targetPeriod: PRESCHOOL_JUNE_PERIOD,
    sourceWeeks,
    weeklyBaseline: {
      averageKwh: round(weeklyAverageKwh),
      minimumKwh: round(Math.min(...weeklyValues)),
      maximumKwh: round(Math.max(...weeklyValues)),
    },
    usageEstimate: {
      projectedKwh: round(projectedKwh),
      lowerKwh: round(lowerKwh),
      upperKwh: round(upperKwh),
    },
    costEstimate: {
      currency: "SGD",
      currentPeriodBeforeGstSgd: round(currentPeriodUsageKwh * rate),
      projectedBeforeGstSgd: round(projectedKwh * rate),
      lowerBeforeGstSgd: round(lowerKwh * rate),
      upperBeforeGstSgd: round(upperKwh * rate),
    },
    tariffReference: PRESCHOOL_DEMO_TARIFF_REFERENCE,
    evidence: {
      dataSnapshotId: analysis.provenance.dataSnapshotId,
      queryId: DAILY_TOTALS_QUERY_ID,
      recipeId: "preschool-naive-weekly-planning-baseline-v1",
    },
    ...(estimateSeries ? { estimateSeries } : {}),
    limitations: [
      "Planning baseline only; it is not an AI or validated statistical forecast.",
      "Weather, occupancy, holidays, operational changes and tariff-plan differences are not modelled.",
      "Cost uses the SP regulated low-tension non-domestic reference before GST, not the customer's contract or bill.",
      ...input.additionalLimitations,
    ],
  };
};

export const buildPreschoolPlanningEstimateSeries = (
  analysis: PreschoolPlanningAnalysisInput,
  projectedKwh: number,
): PreschoolPlanningEstimateSeries | null => {
  const portfolioScopeId = analysis.context?.scopeId;
  const scopes = analysis.dailyTotals?.scopes;
  if (!portfolioScopeId || !scopes || analysis.dailyTotals?.timezone !== PRESCHOOL_MAY_PERIOD.timezone) return null;
  const portfolio = scopes.find((scope) => scope.scopeId === portfolioScopeId);
  const portfolioRaw = portfolio ? rawJunePlanningEstimate(portfolio.rows) : null;
  if (!portfolioRaw) return null;
  const portfolioRawTotal = sumPlanning(portfolioRaw.map((row) => row.estimatedKwh));
  if (portfolioRawTotal <= 0) return null;
  const scale = projectedKwh / portfolioRawTotal;
  const estimatedScopes = scopes.flatMap((scope) => {
    const raw = rawJunePlanningEstimate(scope.rows);
    if (!raw) return [];
    const estimatedTarget = scope.scopeId === portfolioScopeId
      ? projectedKwh
      : round(sumPlanning(raw.map((row) => row.estimatedKwh)) * scale);
    const daily = scalePlanningEstimate(raw, scale, estimatedTarget);
    return [{
      scopeId: scope.scopeId,
      scopeName: scope.scopeName ?? scope.scopeId,
      scopeType: scope.scopeType ?? (scope.scopeId === portfolioScopeId ? "project" : "centre"),
      scopeRole: scope.scopeId === portfolioScopeId ? "portfolio" as const : "centre" as const,
      estimatedKwh: estimatedTarget,
      buckets: {
        daily,
        weekly: aggregatePlanningEstimate(daily, 7),
        monthly: aggregatePlanningEstimate(daily, PRESCHOOL_JUNE_PERIOD.days),
      },
    }];
  });
  return estimatedScopes.some((scope) => scope.scopeRole === "portfolio")
    ? {
        contract: {
          id: "preschool-june-2026-estimate-series",
          version: "1",
          method: "same-weekday mean from four complete May weeks, scaled to the Saved Plan total",
        },
        scopes: estimatedScopes,
      }
    : null;
};

const rawJunePlanningEstimate = (
  rows: NonNullable<PreschoolPlanningAnalysisInput["dailyTotals"]>["scopes"][number]["rows"],
): PreschoolPlanningEstimateBucket[] | null => {
  const rowsByDate = new Map(rows.map((row) => [row.localDate, row]));
  const sourceDates = Array.from({ length: 28 }, (_, offset) => shiftPlanningDate("2026-05-04", offset));
  const sourceRows = sourceDates.flatMap((date) => {
    const row = rowsByDate.get(date);
    return row?.dataHealth.status === "complete" && typeof row.usageKwh === "number" ? [row] : [];
  });
  if (sourceRows.length !== sourceDates.length) return null;
  const meansByWeekday = new Map<number, number>();
  for (let weekday = 0; weekday < 7; weekday += 1) {
    const values = sourceRows
      .filter((row) => new Date(`${row.localDate}T00:00:00.000Z`).getUTCDay() === weekday)
      .map((row) => row.usageKwh!);
    if (values.length !== 4) return null;
    meansByWeekday.set(weekday, sumPlanning(values) / values.length);
  }
  return Array.from({ length: PRESCHOOL_JUNE_PERIOD.days }, (_, offset) => {
    const start = shiftPlanningDate(PRESCHOOL_JUNE_PERIOD.start, offset);
    return {
      start,
      endExclusive: shiftPlanningDate(start, 1),
      estimatedKwh: meansByWeekday.get(new Date(`${start}T00:00:00.000Z`).getUTCDay())!,
    };
  });
};

const scalePlanningEstimate = (
  rows: PreschoolPlanningEstimateBucket[],
  scale: number,
  target: number,
): PreschoolPlanningEstimateBucket[] => {
  const scaled = rows.map((row) => ({ ...row, estimatedKwh: round(row.estimatedKwh * scale) }));
  const last = scaled.at(-1);
  if (last) last.estimatedKwh = round(last.estimatedKwh + (target - sumPlanning(scaled.map((row) => row.estimatedKwh))));
  return scaled;
};

const aggregatePlanningEstimate = (
  daily: PreschoolPlanningEstimateBucket[],
  size: number,
): PreschoolPlanningEstimateBucket[] => {
  const buckets: PreschoolPlanningEstimateBucket[] = [];
  for (let offset = 0; offset < daily.length; offset += size) {
    const rows = daily.slice(offset, offset + size);
    buckets.push({
      start: rows[0]!.start,
      endExclusive: rows.at(-1)!.endExclusive,
      estimatedKwh: round(sumPlanning(rows.map((row) => row.estimatedKwh))),
    });
  }
  return buckets;
};

const shiftPlanningDate = (localDate: string, days: number): string => {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const sumPlanning = (values: number[]): number => values.reduce((total, value) => total + value, 0);

const completePlanningRows = (
  rowByDate: Map<string, NonNullable<PreschoolPlanningAnalysisInput["dailyTotals"]>["scopes"][number]["rows"][number]>,
  dates: string[],
): NonNullable<PreschoolPlanningAnalysisInput["dailyTotals"]>["scopes"][number]["rows"] | null => {
  const rows = dates.flatMap((date) => {
    const row = rowByDate.get(date);
    return row?.dataHealth.status === "complete" && typeof row.usageKwh === "number"
      ? [row]
      : [];
  });
  return rows.length === dates.length ? rows : null;
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

type OperationalPeriodContract = {
  firstLocalDate: string;
  endExclusiveLocalDate: string;
  completeDayCount: number;
  expectedCellCount: number;
};

const supportedCalendar = (
  calendar: EnergyIqOperatingCalendarRevision,
  period: OperationalPeriodContract,
): boolean => {
  if (
    calendar.project_id !== PRESCHOOL_PROJECT_ID
    || calendar.timezone !== PRESCHOOL_MAY_PERIOD.timezone
    || calendar.entries.length !== 1
    || calendar.entries[0]?.owner.kind !== "project"
  ) return false;
  const entry = calendar.entries[0];
  const effectiveFrom = entry.effective_from.slice(0, 10);
  const effectiveTo = entry.effective_to?.slice(0, 10);
  return effectiveFrom <= period.firstLocalDate
    && (!effectiveTo || effectiveTo >= period.endExclusiveLocalDate)
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
  && input.context.timezone === PRESCHOOL_MAY_PERIOD.timezone
  && resolveOperationalPeriodContract(
    { start: input.context.from, endExclusive: input.context.to },
    input.context.timezone,
  ) !== null
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

const resolveOperationalPeriodContract = (
  period: { start: string; endExclusive: string },
  timezone: string,
): OperationalPeriodContract | null => {
  if (timezone !== PRESCHOOL_MAY_PERIOD.timezone) return null;
  const startMs = Date.parse(period.start);
  const endExclusiveMs = Date.parse(period.endExclusive);
  const completeDayCount = (endExclusiveMs - startMs) / 86_400_000;
  if (!Number.isFinite(startMs)
    || !Number.isFinite(endExclusiveMs)
    || !Number.isInteger(completeDayCount)
    || completeDayCount <= 0) return null;

  const firstLocalDate = singaporeLocalDate(startMs);
  const endExclusiveLocalDate = singaporeLocalDate(endExclusiveMs);
  if (startMs !== singaporeLocalDayStart(firstLocalDate)
    || endExclusiveMs !== singaporeLocalDayStart(endExclusiveLocalDate)) return null;

  const isPublishedMay = period.start === PRESCHOOL_MAY_PERIOD.start
    && period.endExclusive === PRESCHOOL_MAY_PERIOD.endExclusive;
  const isSupportedRollingWindow = completeDayCount === PRESCHOOL_OPERATIONAL_ROLLING_DAY_COUNT
    && firstLocalDate >= PRESCHOOL_OPERATIONAL_FIXTURE_START
    && endExclusiveLocalDate <= PRESCHOOL_OPERATIONAL_FIXTURE_END_EXCLUSIVE;
  if (!isPublishedMay && !isSupportedRollingWindow) return null;

  return {
    firstLocalDate,
    endExclusiveLocalDate,
    completeDayCount,
    expectedCellCount: EXPECTED_CENTRE_COUNT * completeDayCount * 24,
  };
};

const singaporeLocalDate = (instantMs: number): string => new Date(
  instantMs + 8 * 60 * 60_000,
).toISOString().slice(0, 10);

const singaporeLocalDayStart = (localDate: string): number => Date.parse(`${localDate}T00:00:00.000+08:00`);

const isCellInOperationalPeriod = (
  cell: PreschoolOperationalCell,
  period: OperationalPeriodContract,
): boolean => cell.localDate >= period.firstLocalDate
  && cell.localDate < period.endExclusiveLocalDate
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
const percent = (part: number, total: number): number => total > 0 ? round((part / total) * 100) : 0;

const rowToCells = (row: unknown[]): PreschoolOperationalCell[] => {
  const scopeId = typeof row[0] === "string" ? row[0] : "";
  const json = typeof row[1] === "string" ? row[1] : "[]";
  const parsed = JSON.parse(json) as unknown;
  if (!scopeId || !Array.isArray(parsed)) throw new Error("PRESCHOOL_OPERATIONAL_CELL_ROW_INVALID");
  const grouped = new Map<string, {
    localDate: string;
    localHour: number;
    circuits: PreschoolOperationalCircuitCell[];
  }>();
  for (const item of parsed) {
    if (!isRecord(item)) throw new Error("PRESCHOOL_OPERATIONAL_CELL_INVALID");
    const localDate = String(item.local_date ?? "");
    const localHour = Number(item.local_hour);
    const circuitId = String(item.circuit_id ?? "");
    const name = String(item.circuit_name ?? "");
    const category = String(item.circuit_category ?? "");
    const usageKwh = Number(item.circuit_kwh);
    if (!localDate || !Number.isInteger(localHour) || !circuitId || !name || !category
      || !Number.isFinite(usageKwh)) {
      throw new Error("PRESCHOOL_OPERATIONAL_CELL_INVALID");
    }
    const key = `${localDate}:${localHour}`;
    const group = grouped.get(key) ?? { localDate, localHour, circuits: [] };
    group.circuits.push({ circuitId, name, category, usageKwh });
    grouped.set(key, group);
  }
  return [...grouped.values()]
    .map((group) => {
      const circuits = [...group.circuits]
        .sort((left, right) => right.usageKwh - left.usageKwh || left.name.localeCompare(right.name));
      const leading = circuits[0];
      if (!leading) throw new Error("PRESCHOOL_OPERATIONAL_CELL_INVALID");
      return {
        scopeId,
        localDate: group.localDate,
        localHour: group.localHour,
        usageKwh: circuits.reduce((sum, circuit) => sum + circuit.usageKwh, 0),
        leadingCircuitName: leading.name,
        leadingCircuitKwh: leading.usageKwh,
        circuits,
      };
    })
    .sort((left, right) => left.localDate.localeCompare(right.localDate) || left.localHour - right.localHour);
};

const preschoolCentreHourCellsSql = (viewName: string): string => `
  SELECT
    scope_id,
    TO_JSON(LIST(STRUCT_PACK(
      local_date := local_date,
      local_hour := local_hour,
      circuit_id := circuit_id,
      circuit_name := circuit_name,
      circuit_category := circuit_category,
      circuit_kwh := circuit_kwh
    ) ORDER BY local_date, local_hour, circuit_kwh DESC, circuit_name)) AS circuit_cells_json
  FROM (
    SELECT
      source.parent_node_id AS scope_id,
      STRFTIME(CAST(source.local_interval_start AS DATE), '%Y-%m-%d') AS local_date,
      source.local_hour,
      source.meter_node_id AS circuit_id,
      source.circuit_name,
      source.category AS circuit_category,
      SUM(source.usage_kwh) AS circuit_kwh
    FROM ${quoteIdentifier(viewName)} source
    WHERE source.quality_status = 'ok'
      AND source.official_aggregation_eligible = TRUE
    GROUP BY source.parent_node_id, CAST(source.local_interval_start AS DATE), source.local_hour,
      source.meter_node_id, source.circuit_name, source.category
  ) circuit_cells
  GROUP BY scope_id
  ORDER BY scope_id
`;

const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
