import type { EnergyProjectAnalysisSnapshotDto } from "../../../lib/config-api";

const COMPARISON_EVIDENCE_METRIC_IDS = new Set([
  "energy.total_usage_kwh",
  "energy.comparison_change_kwh",
  "energy.comparison_change_pct",
]);

export type NgeeAnnOverviewDataStatus = "ready" | "partial" | "unavailable";

export type NgeeAnnOverviewHighlight = {
  id: "total" | "daily" | "peak" | "comparison" | "cost";
  label: string;
  value: string;
  unit?: string;
  detail: string;
  available: boolean;
};

export type NgeeAnnLatestAvailableRange = {
  from: string;
  to: string;
};

export type NgeeAnnEnergyTrendViewModel = {
  status: "available" | "unavailable";
  grain: "day" | "hour";
  decisionQuestion: string;
  reason: string | null;
  scopes: Array<{
    id: string;
    name: string;
    limitation: string | null;
    points: Array<{
      id: string;
      localDate: string;
      localHour: number | null;
      dateLabel: string;
      weekday: string;
      range: string;
      acceptedUsageKwh: number | null;
      usageKwh: string | null;
      status: "complete" | "partial" | "unavailable";
      statusLabel: "Complete" | "Partial" | "Unavailable";
      coverage: string;
      intervals: string;
      qualityEvents: string;
    }>;
  }>;
  evidence: {
    snapshotId: string;
    projectReleaseId: string;
    meterMappingRevisionId: string;
    meterFormulaRevisionId: string;
    metricId: "energy.total_usage_kwh@1";
    period: string;
    timezone: string;
    unit: "kWh";
    queryIds: ["daily_totals_v1"] | ["time_bucket_grid_v1"];
  };
};

type TimeBehaviourEvidence = {
  snapshotId: string;
  projectReleaseId: string;
  meterMappingRevisionId: string;
  meterFormulaRevisionId: string;
  metricId: "energy.total_usage_kwh@1";
  period: string;
  timezone: string;
  unit: "kWh";
  queryIds: ["time_bucket_grid_v1"];
};

type TimePointQuality = {
  status: "complete" | "partial" | "unavailable";
  statusLabel: "Complete" | "Partial" | "Unavailable";
  coverage: string;
  intervals: string;
  qualityEvents: string;
};

export type NgeeAnnDayProfileViewModel = {
  status: "available" | "unavailable";
  decisionQuestion: string;
  reason: string | null;
  scopes: Array<{ id: string; name: string }>;
  profiles: Array<{
    id: string;
    dayType: "weekday" | "weekend" | "public_holiday";
    dayTypeLabel: "Weekday" | "Weekend" | "Public Holiday";
    scopeId: string;
    scopeName: string;
    status: "available" | "unavailable";
    sampleDayCount: number | null;
    reason: string | null;
    values: Array<{
      id: string;
      localHour: number;
      hourLabel: string;
      acceptedUsageKwh: number;
      usageKwh: string;
    }>;
  }>;
  evidence: TimeBehaviourEvidence;
};

export type NgeeAnnUsageHeatmapViewModel = {
  status: "available" | "unavailable";
  decisionQuestion: string;
  reason: string | null;
  defaultView: "date-hour" | "level-hour";
  dates: Array<{ id: string; label: string; weekday: string }>;
  scopes: Array<{
    id: string;
    name: string;
    cells: Array<{
      id: string;
      scopeId: string;
      localDate: string;
      dateLabel: string;
      weekday: string;
      localHour: number;
      hourLabel: string;
      range: string;
      acceptedUsageKwh: number | null;
      usageKwh: string | null;
      quality: TimePointQuality;
    }>;
  }>;
  evidence: TimeBehaviourEvidence;
};

export type NgeeAnnDailyAnomalyViewModel = {
  status: "available" | "unavailable";
  decisionQuestion: string;
  reason: string | null;
  allSuppressed: boolean;
  incidents: Array<{
    anomalyId: string;
    incidentId: string;
    scopeId: string;
    scopeName: string;
    localDate: string;
    dateLabel: string;
    weekday: string;
    dayType: "Weekday" | "Weekend";
    range: string;
    actualKwh: string;
    baselineKwh: string;
    impactKwh: string;
    relativePct: string;
    coverage: string;
    intervals: string;
    qualityEvents: string;
    baselineDates: string[];
    baselineSamples: Array<{
      localDate: string;
      coverage: string;
      intervals: string;
      qualityEvents: string;
    }>;
    hourlyComparison: Array<{
      localHour: number;
      actualKwh: number;
      baselineKwh: number;
      impactKwh: number;
      relativePct: number;
    }>;
    series: Array<{
      seriesId: string;
      relationship: "selected_scope" | "immediate_level" | "component_circuit";
      kind: "official_scope" | "component_circuit";
      scopeId: string;
      scopeName: string;
      meterNodeId: string | null;
      category: string | null;
      categoryLabel: string | null;
      includedInOfficialTotal: boolean;
      status: "available" | "partial" | "unavailable";
      statusLabel: "Available" | "Partial" | "Unavailable";
      selectedTotalKwh: string | null;
      baselineTotalKwh: string | null;
      impactKwh: string | null;
      relativePct: string | null;
      coverage: string;
      intervals: string;
      qualityEvents: string;
      points: Array<{
        localHour: number;
        hourLabel: string;
        selectedKwh: number | null;
        baselineKwh: number | null;
        impactKwh: number | null;
      }>;
    }>;
  }>;
  rule: {
    ruleRevisionId: string;
    baselineCutoff: string;
    baselineMethod: "mean_of_complete_comparable_days_by_local_hour";
    relativeThresholdPct: string;
    absoluteImpactKwh: string;
    minimumCoveragePct: string;
    minimumSampleCount: number;
    maximumQualityEventCount: number;
    maximumLookbackDays: number;
  } | null;
  evidence: {
    bundleId: string | null;
    snapshotId: string;
    projectReleaseId: string;
    hierarchyRevisionId: string;
    meterMappingRevisionId: string;
    meterFormulaRevisionId: string;
    metricVersion: string;
    metricId: "energy.total_usage_kwh@1";
    period: string;
    timezone: string;
    queryIds: ["time_slot_anomaly_v1"];
  };
};

type PeakBreakdownQuality = {
  status: "complete" | "unavailable";
  statusLabel: "Complete" | "Unavailable";
  coverage: string;
  intervals: string;
  qualityEvents: string;
};

export type NgeeAnnPeakBreakdownViewModel = {
  status: "available" | "unavailable";
  decisionQuestion: string;
  reason: string | null;
  periodStatus: "complete" | "partial" | null;
  periodCoverage: string | null;
  peakLabel: string;
  peakAt: string | null;
  peakInterval: string | null;
  averageKw: string | null;
  quality: PeakBreakdownQuality | null;
  levels: Array<{
    scopeId: string;
    scopeName: string;
    averageKw: string;
    sharePct: string;
    quality: PeakBreakdownQuality;
    circuits: Array<{
      meterNodeId: string;
      name: string;
      category: string;
      averageKw: string | null;
      sharePct: string | null;
      includedInOfficialTotal: false;
      quality: PeakBreakdownQuality;
    }>;
  }>;
  evidence: {
    snapshotId: string;
    projectReleaseId: string;
    meterMappingRevisionId: string;
    meterFormulaRevisionId: string;
    metricId: "energy.peak_demand_kw@1";
    period: string;
    timezone: string;
    unit: "kW";
    queryIds: ["peak_breakdown_v1"];
  };
};

export type NgeeAnnLevelComparisonViewModel = {
  status: "available" | "unavailable";
  decisionQuestion: string;
  reason: string | null;
  rows: Array<{
    id: string;
    name: string;
    currentUsageKwh: string;
    projectShare: string;
    projectShareBar: string;
    previousUsageKwh: string;
    changeKwh: string;
    changePct: string;
    coverage: string;
    intervals: string;
    qualityEvents: string;
  }>;
  evidence: {
    snapshotId: string;
    projectReleaseId: string;
    meterMappingRevisionId: string;
    queryIds: string[];
  };
};

type CompositionStatus = {
  status: "available" | "unavailable";
  reason: string | null;
};

type CompositionQuality = {
  coverage: string;
  intervals: string;
  qualityEvents: string;
};

type DerivedMeterTraceTerm = {
  meterNodeId: string;
  name: string;
  coefficient: string;
  inputUsageKwh: string;
  contributionKwh: string;
  quality: CompositionQuality;
};

type DerivedMeterTraceInput = {
  meterNodeId: string;
  name: string;
};

export type NgeeAnnEnergyCompositionViewModel = {
  decisionQuestion: string;
  categories: CompositionStatus & {
    rows: Array<{
      id: string;
      name: string;
      currentUsageKwh: string;
      projectShare: string;
      previousUsageKwh: string;
      changeKwh: string;
      changePct: string;
      quality: CompositionQuality;
    }>;
  };
  circuits: CompositionStatus & {
    rows: Array<{
      rank: number;
      meterNodeId: string;
      name: string;
      scopeId: string;
      parentScopeId: string;
      levelId: string;
      levelName: string;
      categoryId: string;
      category: string;
      currentUsageKwh: string;
      projectShare: string;
      previousUsageKwh: string;
      changeKwh: string;
      changePct: string;
      includedInOfficialTotal: false;
      quality: CompositionQuality;
    }>;
  };
  accounting: CompositionStatus & {
    designatedTotals: Array<{
      meterNodeId: string;
      name: string;
      scopeId: string;
      parentScopeId: string;
      levelName: string;
      category: string;
      currentUsageKwh: string;
      includedInOfficialTotal: true;
      quality: CompositionQuality;
    }>;
    reconciliation: null | {
      officialUsageKwh: string;
      componentUsageKwh: string;
      gapKwh: string;
      ratioPct: string;
      officialMeterCount: number;
      componentMeterCount: number;
    };
  };
  derivedMeterTrace: {
    status: "available" | "partial" | "unavailable";
    reason: string | null;
    meterNodeId: string | null;
    name: string | null;
    scopeId: string | null;
    scopeName: string | null;
    meterKind: "Derived" | null;
    resultUsageKwh: string | null;
    includedInOfficialTotal: false | null;
    terms: DerivedMeterTraceTerm[];
    impactedInputs: DerivedMeterTraceInput[];
  };
  evidence: {
    snapshotId: string;
    projectReleaseId: string;
    meterMappingRevisionId: string;
    meterFormulaRevisionId: string;
    queryIds: string[];
    period: string;
    unit: "kWh";
  };
};

export type NgeeAnnOverviewViewModel = {
  context: {
    projectName: string;
    scopeName: string;
    scopeType: string;
    period: string;
    periodRange: string;
    timezone: string;
  };
  dataStatus: {
    status: NgeeAnnOverviewDataStatus;
    label: string;
    summary: string;
    recovery: string | null;
    coverage: string;
    intervals: string;
    qualityEvents: string;
    lastSeen: string;
  };
  highlights: NgeeAnnOverviewHighlight[];
  peakBreakdown: NgeeAnnPeakBreakdownViewModel;
  energyTrend: NgeeAnnEnergyTrendViewModel;
  dailyAnomalies: NgeeAnnDailyAnomalyViewModel;
  dayProfile: NgeeAnnDayProfileViewModel;
  usageHeatmap: NgeeAnnUsageHeatmapViewModel;
  levelComparison: NgeeAnnLevelComparisonViewModel;
  energyComposition: NgeeAnnEnergyCompositionViewModel;
  evidence: {
    snapshotId: string;
    projectReleaseId: string;
    projectRelease: string;
    queryIds: string[];
    references: Array<{
      id: string;
      metricId: string;
      queryIds: string[];
      queryReceiptId?: string;
    }>;
    importBatchCount: number;
    metadataStatus: string;
    comparison: {
      status: "available" | "unavailable";
      from: string;
      to: string;
      range: string;
      currentUsageKwh: string;
      previousUsageKwh: string;
      changeKwh: string;
      changePct: string;
      queryIds: string[];
      referenceIds: string[];
    };
    cost:
      | {
        status: "available";
        amount: string;
        currency: string;
        tariffScheduleVersion: string;
        allocations: Array<{
          from: string;
          to: string;
          range: string;
          ratePerKwh: string;
          usageKwh: string;
          cost: string;
        }>;
        queryIds: string[];
        referenceIds: string[];
      }
      | {
        status: "unavailable";
        reason: string;
        tariffScheduleVersion: string | null;
        allocations: [];
        queryIds: string[];
        referenceIds: string[];
      };
  };
  latestAvailableRange: NgeeAnnLatestAvailableRange | null;
};

export function buildNgeeAnnOverviewViewModel(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  hint: {
    latestAvailableRange?: NgeeAnnLatestAvailableRange | null;
  } = {},
): NgeeAnnOverviewViewModel {
  const { analysis, context, dataQuality } = snapshot;
  const hasTrustedIntervals = dataQuality.validIntervalCount > 0;
  const status = resolveDataStatus(dataQuality.status, hasTrustedIntervals);
  const unavailable = status === "unavailable";
  const comparisonAvailable = !unavailable && analysis.comparison.changePct !== null;
  const costAvailable = !unavailable && analysis.cost.status === "available";
  const latestSeenAt = snapshot.dataSnapshot.lastSeenAt
    ?? dataQuality.lastSeenAt
    ?? null;

  const latestAvailableRange = unavailable ? hint.latestAvailableRange ?? null : null;
  const evidenceQueryIds = [...analysis.provenance.queryIds];
  const comparisonReferenceIds = comparisonEvidenceReferences(snapshot);

  return {
    context: {
      projectName: context.projectName,
      scopeName: context.scopeName,
      scopeType: context.scopeType,
      period: context.period ?? "Custom",
      periodRange: formatPeriodRange(
        context.primaryPeriod.start,
        context.primaryPeriod.endExclusive,
        context.timezone,
      ),
      timezone: context.timezone,
    },
    dataStatus: buildDataStatus(snapshot, status, latestSeenAt, Boolean(latestAvailableRange)),
    highlights: [
      {
        id: "total",
        label: "Total energy",
        value: unavailable ? "Unavailable" : formatDecimal(analysis.summary.usageKwh, 4),
        unit: unavailable ? undefined : "kWh",
        detail: "Official usage for this Project and Scope",
        available: !unavailable,
      },
      {
        id: "daily",
        label: "Daily average",
        value: unavailable ? "Unavailable" : formatDecimal(analysis.summary.averageDailyUsageKwh, 4),
        unit: unavailable ? undefined : "kWh/day",
        detail: "Primary Period daily average",
        available: !unavailable,
      },
      {
        id: "peak",
        label: "Peak interval-average power",
        value: unavailable ? "Unavailable" : formatDecimal(analysis.summary.peakKw, 4),
        unit: unavailable ? undefined : "kW",
        detail: unavailable
          ? "No accepted interval supports a peak"
          : analysis.summary.peakAt
            ? `Observed ${formatTimestamp(analysis.summary.peakAt, context.timezone)}`
            : `${analysis.units.intervalMinutes}-minute interval average`,
        available: !unavailable,
      },
      {
        id: "comparison",
        label: "Comparison",
        value: comparisonAvailable
          ? `${analysis.comparison.changePct! >= 0 ? "+" : ""}${formatDecimal(analysis.comparison.changePct!, 4)}%`
          : "Unavailable",
        detail: comparisonAvailable
          ? `Previous ${formatDecimal(analysis.comparison.usageKwh, 4)} kWh / ${signedDecimal(analysis.comparison.changeKwh, 4)} kWh`
          : "No validated comparable-period usage",
        available: comparisonAvailable,
      },
      {
        id: "cost",
        label: "Cost",
        value: analysis.cost.status === "available" && !unavailable
          ? `${formatDecimal(analysis.cost.amount, 6)} ${analysis.cost.currency}`
          : "Unavailable",
        detail: analysis.cost.status === "available" && !unavailable
          ? `Tariff ${analysis.cost.tariffScheduleVersion} / ${analysis.cost.allocations.length} allocation${analysis.cost.allocations.length === 1 ? "" : "s"}`
          : analysis.cost.status === "unavailable"
            ? analysis.cost.reason.message
            : "No effective Tariff",
        available: costAvailable,
      },
    ],
    peakBreakdown: buildPeakBreakdown(snapshot, unavailable),
    energyTrend: buildEnergyTrend(snapshot, unavailable),
    dailyAnomalies: buildDailyAnomalies(snapshot, unavailable),
    dayProfile: buildDayProfile(snapshot, unavailable),
    usageHeatmap: buildUsageHeatmap(snapshot, unavailable),
    levelComparison: buildLevelComparison(snapshot, unavailable),
    energyComposition: buildEnergyComposition(snapshot, unavailable),
    evidence: {
      snapshotId: snapshot.dataSnapshot.id,
      projectReleaseId: snapshot.projectRelease.id,
      projectRelease: snapshot.projectRelease.templateRevisionSequence === null
        ? snapshot.projectRelease.id
        : `Revision ${snapshot.projectRelease.templateRevisionSequence}`,
      queryIds: evidenceQueryIds,
      references: snapshot.evidence.map((item) => ({
        id: item.id,
        metricId: item.metricId,
        queryIds: [...item.queryIds],
        ...(item.queryReceiptId ? { queryReceiptId: item.queryReceiptId } : {}),
      })),
      importBatchCount: snapshot.dataSnapshot.importBatchIds.length,
      metadataStatus: snapshot.metadata.status,
      comparison: {
        status: comparisonAvailable ? "available" : "unavailable",
        from: analysis.comparison.from,
        to: analysis.comparison.to,
        range: formatEvidenceRange(
          analysis.comparison.from,
          analysis.comparison.to,
          context.timezone,
        ),
        currentUsageKwh: formatDecimal(analysis.summary.usageKwh, 4),
        previousUsageKwh: formatDecimal(analysis.comparison.usageKwh, 4),
        changeKwh: signedDecimal(analysis.comparison.changeKwh, 4),
        changePct: analysis.comparison.changePct === null
          ? "Unavailable"
          : `${analysis.comparison.changePct >= 0 ? "+" : ""}${formatDecimal(analysis.comparison.changePct, 4)}%`,
        queryIds: evidenceQueryIds,
        referenceIds: comparisonReferenceIds,
      },
      cost: analysis.cost.status === "available" && !unavailable
        ? {
          status: "available",
          amount: formatDecimal(analysis.cost.amount, 6),
          currency: analysis.cost.currency,
          tariffScheduleVersion: analysis.cost.tariffScheduleVersion,
          allocations: analysis.cost.allocations.map((allocation) => ({
            from: allocation.from,
            to: allocation.to,
            range: formatEvidenceRange(allocation.from, allocation.to, context.timezone),
            ratePerKwh: formatDecimal(allocation.ratePerKwh, 6),
            usageKwh: formatDecimal(allocation.usageKwh, 6),
            cost: formatDecimal(allocation.cost, 6),
          })),
          queryIds: evidenceQueryIds,
          referenceIds: [],
        }
        : {
          status: "unavailable",
          reason: unavailable
            ? "No trusted intervals support a Cost for this Period."
            : analysis.cost.status === "unavailable"
              ? analysis.cost.reason.message
              : "No effective Tariff covers this Period.",
          tariffScheduleVersion: analysis.cost.tariffScheduleVersion ?? null,
          allocations: [],
          queryIds: evidenceQueryIds,
          referenceIds: [],
        },
    },
    latestAvailableRange,
  };
}

function buildEnergyComposition(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  overviewUnavailable: boolean,
): NgeeAnnEnergyCompositionViewModel {
  const analysis = snapshot.analysis;
  const evidence: NgeeAnnEnergyCompositionViewModel["evidence"] = {
    snapshotId: snapshot.dataSnapshot.id,
    projectReleaseId: snapshot.projectRelease.id,
    meterMappingRevisionId: analysis.provenance.meterMappingRevisionId,
    meterFormulaRevisionId: analysis.provenance.meterFormulaRevisionId,
    queryIds: [...analysis.provenance.queryIds],
    period: `[${snapshot.context.primaryPeriod.start}, ${snapshot.context.primaryPeriod.endExclusive})`,
    unit: "kWh",
  };
  const unavailableReason = overviewUnavailable
    ? "No trusted intervals support energy composition for this Period."
    : snapshot.context.scopeType !== "project"
      ? "Select the Project Scope to explain the official Project total."
      : null;
  const levelNames = new Map(
    analysis.childScopes
      .filter((scope) => scope.nodeType === "level")
      .map((scope) => [scope.nodeId, scope.name]),
  );

  const expectedCategories = new Set(["load", "light"]);
  const categoryContractAvailable = unavailableReason === null
    && analysis.categories.length === expectedCategories.size
    && analysis.categories.every((category) =>
      expectedCategories.has(category.category)
      && hasComparisonAndHealth(category),
    );
  const categories: NgeeAnnEnergyCompositionViewModel["categories"] = categoryContractAvailable
    ? {
      status: "available",
      reason: null,
      rows: analysis.categories.map((category) => ({
        id: category.category,
        name: compositionCategoryName(category.category),
        currentUsageKwh: formatDecimal(category.usageKwh, 4),
        projectShare: `${formatDecimal(category.sharePct, 4)}%`,
        previousUsageKwh: formatDecimal(category.comparison!.usageKwh, 4),
        changeKwh: `${signedDecimal(category.comparison!.changeKwh, 4)} kWh`,
        changePct: category.comparison!.changePct === null
          ? "Rate unavailable"
          : `${category.comparison!.changePct! >= 0 ? "+" : ""}${formatDecimal(category.comparison!.changePct!, 4)}%`,
        quality: compositionQuality(category.dataHealth!),
      })),
    }
    : {
      status: "unavailable",
      reason: unavailableReason
        ?? "This published Snapshot does not include complete official Load and Light comparison facts.",
      rows: [],
    };

  const designatedTotals = analysis.designatedTotals ?? [];
  const reconciliation = analysis.componentReconciliation;
  const officialMeterIds = new Set(reconciliation?.officialMeterNodeIds ?? []);
  const componentMeterNodeIds = reconciliation?.componentMeterNodeIds ?? [];
  const componentMeterIds = new Set(componentMeterNodeIds);
  const explanatoryCircuits = analysis.circuits.filter((circuit) =>
    circuit.includedInOfficialTotal === false,
  );
  const componentCircuits = analysis.circuits.filter((circuit) =>
    componentMeterIds.has(circuit.meterNodeId),
  );
  const circuitContractAvailable = unavailableReason === null
    && componentMeterIds.size > 0
    && componentMeterIds.size === componentMeterNodeIds.length
    && componentCircuits.length === componentMeterIds.size
    && componentCircuits.length === explanatoryCircuits.length
    && componentCircuits.every((circuit) =>
      circuit.includedInOfficialTotal === false
      && Boolean(circuit.scopeId)
      && Boolean(circuit.parentScopeId)
      && levelNames.has(circuit.parentScopeId!)
      && expectedCategories.has(circuit.category)
      && hasComparisonAndHealth(circuit),
    );
  const circuits: NgeeAnnEnergyCompositionViewModel["circuits"] = circuitContractAvailable
    ? {
      status: "available",
      reason: null,
      rows: componentCircuits.map((circuit, index) => ({
        rank: index + 1,
        meterNodeId: circuit.meterNodeId,
        name: circuit.name,
        scopeId: circuit.scopeId!,
        parentScopeId: circuit.parentScopeId!,
        levelId: circuit.parentScopeId!,
        levelName: levelNames.get(circuit.parentScopeId!)!,
        categoryId: circuit.category,
        category: compositionCategoryName(circuit.category),
        currentUsageKwh: formatDecimal(circuit.usageKwh, 4),
        projectShare: `${formatDecimal(circuit.sharePct, 4)}%`,
        previousUsageKwh: formatDecimal(circuit.comparison!.usageKwh, 4),
        changeKwh: `${signedDecimal(circuit.comparison!.changeKwh, 4)} kWh`,
        changePct: circuit.comparison!.changePct === null
          ? "Rate unavailable"
          : `${circuit.comparison!.changePct! >= 0 ? "+" : ""}${formatDecimal(circuit.comparison!.changePct!, 4)}%`,
        includedInOfficialTotal: false,
        quality: compositionQuality(circuit.dataHealth!),
      })),
    }
    : {
      status: "unavailable",
      reason: unavailableReason
        ?? "This published Snapshot does not explicitly identify the complete component Circuit set, Scopes, parents, categories, official-total markers, comparisons and quality.",
      rows: [],
    };

  const accountingContractAvailable = unavailableReason === null
    && designatedTotals.length === 4
    && Boolean(reconciliation)
    && reconciliation!.ratioPct !== null
    && officialMeterIds.size === designatedTotals.length
    && componentMeterIds.size === componentMeterNodeIds.length
    && componentMeterIds.size === componentCircuits.length
    && componentCircuits.length === explanatoryCircuits.length
    && designatedTotals.every((circuit) =>
      circuit.includedInOfficialTotal === true
      && Boolean(circuit.scopeId)
      && Boolean(circuit.parentScopeId)
      && levelNames.has(circuit.parentScopeId!)
      && Boolean(circuit.dataHealth)
      && officialMeterIds.has(circuit.meterNodeId)
      && !componentMeterIds.has(circuit.meterNodeId),
    )
    && componentCircuits.every((circuit) =>
      componentMeterIds.has(circuit.meterNodeId)
      && !officialMeterIds.has(circuit.meterNodeId),
    );
  const accounting: NgeeAnnEnergyCompositionViewModel["accounting"] = accountingContractAvailable
    ? {
      status: "available",
      reason: null,
      designatedTotals: designatedTotals.map((circuit) => ({
        meterNodeId: circuit.meterNodeId,
        name: circuit.name,
        scopeId: circuit.scopeId!,
        parentScopeId: circuit.parentScopeId!,
        levelName: levelNames.get(circuit.parentScopeId!)!,
        category: compositionCategoryName(circuit.category),
        currentUsageKwh: formatDecimal(circuit.usageKwh, 4),
        includedInOfficialTotal: true,
        quality: compositionQuality(circuit.dataHealth!),
      })),
      reconciliation: {
        officialUsageKwh: formatDecimal(reconciliation!.officialUsageKwh, 4),
        componentUsageKwh: formatDecimal(reconciliation!.componentUsageKwh, 4),
        gapKwh: formatDecimal(reconciliation!.gapKwh, 4),
        ratioPct: `${formatDecimal(reconciliation!.ratioPct!, 4)}%`,
        officialMeterCount: reconciliation!.officialMeterNodeIds.length,
        componentMeterCount: reconciliation!.componentMeterNodeIds.length,
      },
    }
    : {
      status: "unavailable",
      reason: unavailableReason
        ?? "This published Snapshot does not include an explicit, non-overlapping designated-total and component reconciliation contract.",
      designatedTotals: [],
      reconciliation: null,
    };
  const derivedMeterTrace = buildDerivedMeterTrace(analysis, unavailableReason, levelNames);

  return {
    decisionQuestion: "What explains the official Project total?",
    categories,
    circuits,
    accounting,
    derivedMeterTrace,
    evidence,
  };
}

function buildDerivedMeterTrace(
  analysis: EnergyProjectAnalysisSnapshotDto["analysis"],
  unavailableReason: string | null,
  levelNames: Map<string, string>,
): NgeeAnnEnergyCompositionViewModel["derivedMeterTrace"] {
  const unavailable = (reason: string): NgeeAnnEnergyCompositionViewModel["derivedMeterTrace"] => ({
    status: "unavailable",
    reason,
    meterNodeId: null,
    name: null,
    scopeId: null,
    scopeName: null,
    meterKind: null,
    resultUsageKwh: null,
    includedInOfficialTotal: null,
    terms: [],
    impactedInputs: [],
  });

  if (unavailableReason) return unavailable(unavailableReason);

  const traces = analysis.virtualMeterTraces;
  if (!traces) {
    return unavailable("This published Snapshot does not include the server-derived meter trace contract.");
  }

  const matchingTraces = traces.filter((trace) => trace.meterNodeId === "ngee-ann-load-12-v1");
  if (matchingTraces.length !== 1) {
    return unavailable("This published Snapshot does not identify one authoritative Load 12 trace.");
  }

  const trace = matchingTraces[0]!;
  const scopeName = levelNames.get(trace.scopeId);
  const termIds = trace.terms.map((term) => term.meterNodeId);
  const uniqueTermIds = new Set(termIds);
  const hasValidIdentities = Boolean(trace.name)
    && Boolean(trace.scopeId)
    && Boolean(scopeName)
    && trace.terms.length === 2
    && uniqueTermIds.size === trace.terms.length
    && trace.terms.every((term) =>
      Boolean(term.meterNodeId)
      && Boolean(term.name)
      && (term.coefficient === 1 || term.coefficient === -1),
    );

  if (trace.includedInOfficialTotal !== false || !hasValidIdentities) {
    return unavailable("The Load 12 trace is missing a unique identity, Level, term identity or exclusion marker.");
  }

  if (trace.status === "partial") {
    const missingTermIds = trace.missingTermMeterNodeIds;
    const uniqueMissingTermIds = new Set(missingTermIds);
    const missingTerms = trace.terms.filter((term) => uniqueMissingTermIds.has(term.meterNodeId));
    const hasValidMissingInputs = trace.usageKwh === null
      && missingTermIds.length > 0
      && uniqueMissingTermIds.size === missingTermIds.length
      && missingTermIds.every((meterNodeId) => uniqueTermIds.has(meterNodeId))
      && missingTerms.length === missingTermIds.length
      && missingTerms.every((term) =>
        term.inputUsageKwh === null
        && term.contributionKwh === null
        && term.dataHealth === null,
      );

    if (!hasValidMissingInputs) {
      return unavailable("The partial Load 12 trace does not identify every affected input.");
    }

    return {
      status: "partial",
      reason: "Derived result unavailable because required inputs are missing.",
      meterNodeId: trace.meterNodeId,
      name: trace.name,
      scopeId: trace.scopeId,
      scopeName: scopeName!,
      meterKind: "Derived",
      resultUsageKwh: null,
      includedInOfficialTotal: false,
      terms: [],
      impactedInputs: missingTerms.map((term) => ({
        meterNodeId: term.meterNodeId,
        name: term.name,
      })),
    };
  }

  const hasCompleteValues = trace.status === "available"
    && trace.missingTermMeterNodeIds.length === 0
    && trace.usageKwh !== null
    && Number.isFinite(trace.usageKwh)
    && trace.terms.every((term) =>
      term.inputUsageKwh !== null
      && Number.isFinite(term.inputUsageKwh)
      && term.contributionKwh !== null
      && Number.isFinite(term.contributionKwh)
      && Boolean(term.dataHealth),
    );

  if (!hasCompleteValues) {
    return unavailable("The authoritative Load 12 result, term values or data quality is incomplete.");
  }

  return {
    status: "available",
    reason: null,
    meterNodeId: trace.meterNodeId,
    name: trace.name,
    scopeId: trace.scopeId,
    scopeName: scopeName!,
    meterKind: "Derived",
    resultUsageKwh: formatDecimal(trace.usageKwh!, 4),
    includedInOfficialTotal: false,
    terms: trace.terms.map((term) => ({
      meterNodeId: term.meterNodeId,
      name: term.name,
      coefficient: signedDecimal(term.coefficient, 4),
      inputUsageKwh: formatDecimal(term.inputUsageKwh!, 4),
      contributionKwh: formatDecimal(term.contributionKwh!, 4),
      quality: compositionQuality(term.dataHealth!),
    })),
    impactedInputs: [],
  };
}

function hasComparisonAndHealth(value: {
  comparison?: unknown;
  dataHealth?: unknown;
}): boolean {
  return Boolean(value.comparison) && Boolean(value.dataHealth);
}

function compositionCategoryName(category: string): string {
  if (category === "load") return "Load";
  if (category === "light") return "Light";
  return category;
}

function compositionQuality(quality: {
  coveragePct: number;
  expectedMeterIntervalCount: number;
  validIntervalCount: number;
  qualityEventCount: number;
}): CompositionQuality {
  return {
    coverage: `${formatDecimal(quality.coveragePct, 1)}% coverage`,
    intervals: `${quality.validIntervalCount.toLocaleString("en-SG")} / ${quality.expectedMeterIntervalCount.toLocaleString("en-SG")}`,
    qualityEvents: `${quality.qualityEventCount.toLocaleString("en-SG")} quality events`,
  };
}

function buildPeakBreakdown(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  overviewUnavailable: boolean,
): NgeeAnnPeakBreakdownViewModel {
  const { analysis, context } = snapshot;
  const breakdown = analysis.peakBreakdown;
  const evidence: NgeeAnnPeakBreakdownViewModel["evidence"] = {
    snapshotId: snapshot.dataSnapshot.id,
    projectReleaseId: snapshot.projectRelease.id,
    meterMappingRevisionId: analysis.provenance.meterMappingRevisionId,
    meterFormulaRevisionId: analysis.provenance.meterFormulaRevisionId,
    metricId: "energy.peak_demand_kw@1",
    period: `[${context.primaryPeriod.start}, ${context.primaryPeriod.endExclusive})`,
    timezone: context.timezone,
    unit: "kW",
    queryIds: ["peak_breakdown_v1"],
  };
  const unavailable = (reason: string): NgeeAnnPeakBreakdownViewModel => ({
    status: "unavailable",
    decisionQuestion: "Which Level drove the highest accepted 15-minute interval-average Project load?",
    reason,
    periodStatus: null,
    periodCoverage: null,
    peakLabel: "Peak breakdown unavailable",
    peakAt: null,
    peakInterval: null,
    averageKw: null,
    quality: null,
    levels: [],
    evidence,
  });

  if (overviewUnavailable) {
    return unavailable("No trusted intervals support a Peak breakdown for this Period.");
  }
  if (context.scopeType !== "project") {
    return unavailable("Select the Project Scope to inspect the Project Peak breakdown.");
  }
  if (!breakdown) {
    return unavailable("This published Snapshot does not include the Peak breakdown contract.");
  }
  if (breakdown.status === "unavailable") {
    return unavailable(breakdown.reason.message);
  }
  if (!validPeakEvidencePins(snapshot)) {
    return unavailable("The Peak Snapshot, Release or revision evidence pins are inconsistent.");
  }

  const expectedPeriodStatus = analysis.dataHealth.status === "complete" ? "complete" : "partial";
  const peakFromMs = Date.parse(breakdown.peak.from);
  const peakToMs = Date.parse(breakdown.peak.to);
  const validIdentity = breakdown.metricId === "energy.peak_demand_kw@1"
    && breakdown.unit === analysis.units.demand
    && breakdown.timezone === context.timezone
    && analysis.units.timezone === context.timezone
    && breakdown.intervalMinutes === analysis.units.intervalMinutes
    && breakdown.intervalMinutes === 15
    && breakdown.periodStatus === expectedPeriodStatus
    && Number.isFinite(breakdown.coveragePct)
    && breakdown.coveragePct >= 0
    && breakdown.coveragePct <= 100
    && formatDecimal(breakdown.coveragePct, 4) === formatDecimal(analysis.dataHealth.coveragePct, 4)
    && analysis.provenance.queryIds.includes("peak_breakdown_v1");
  const validPeak = analysis.summary.peakAt === breakdown.peak.from
    && Number.isFinite(peakFromMs)
    && Number.isFinite(peakToMs)
    && peakToMs - peakFromMs === breakdown.intervalMinutes * 60_000
    && peakFromMs >= Date.parse(context.primaryPeriod.start)
    && peakToMs <= Date.parse(context.primaryPeriod.endExclusive)
    && finiteNonNegative(breakdown.peak.averageKw)
    && formatDecimal(breakdown.peak.averageKw, 4) === formatDecimal(analysis.summary.peakKw, 4)
    && validCompletePeakHealth(breakdown.peak.dataHealth);
  if (!validIdentity || !validPeak) {
    return unavailable("The Peak identity, interval, Project value, quality or query evidence is invalid.");
  }

  const expectedLevels = analysis.childScopes
    .filter((scope) => scope.nodeType === "level")
    .map((scope) => ({ scopeId: scope.nodeId, scopeName: scope.name }));
  const uniqueLevelIds = new Set<string>();
  const uniqueCircuitIds = new Set<string>();
  const validLevels = expectedLevels.length === 2
    && breakdown.levels.length === expectedLevels.length
    && breakdown.levels.every((level) => {
      const expectedLevel = expectedLevels.find((candidate) => candidate.scopeId === level.scopeId);
      if (
        !expectedLevel
        || level.scopeName !== expectedLevel.scopeName
        || uniqueLevelIds.has(level.scopeId)
        || !finiteNonNegative(level.averageKw)
        || !validPercentage(level.sharePct)
        || !validCompletePeakHealth(level.dataHealth)
      ) {
        return false;
      }
      uniqueLevelIds.add(level.scopeId);
      return level.circuits.every((circuit) => {
        if (
          !circuit.meterNodeId
          || uniqueCircuitIds.has(circuit.meterNodeId)
          || !circuit.name
          || !circuit.category
          || circuit.includedInOfficialTotal !== false
          || (circuit.dataHealth.status !== "complete" && circuit.dataHealth.status !== "unavailable")
          || !validPeakHealth(circuit.dataHealth)
        ) {
          return false;
        }
        uniqueCircuitIds.add(circuit.meterNodeId);
        return circuit.dataHealth.status === "complete"
          ? validCompletePeakHealth(circuit.dataHealth)
            && finiteNonNegative(circuit.averageKw)
            && validPercentage(circuit.sharePct)
          : circuit.averageKw === null && circuit.sharePct === null;
      });
    });
  if (!validLevels) {
    return unavailable("The Level or Circuit Peak breakdown contract is incomplete or invalid.");
  }

  return {
    status: "available",
    decisionQuestion: "Which Level drove the highest accepted 15-minute interval-average Project load?",
    reason: null,
    periodStatus: breakdown.periodStatus,
    periodCoverage: `${formatDecimal(breakdown.coveragePct, 1)}% coverage`,
    peakLabel: breakdown.periodStatus === "partial"
      ? "Highest complete observed interval"
      : "Highest accepted interval",
    peakAt: formatTimestamp(breakdown.peak.from, breakdown.timezone),
    peakInterval: formatEvidenceRange(breakdown.peak.from, breakdown.peak.to, breakdown.timezone),
    averageKw: formatDecimal(breakdown.peak.averageKw, 4),
    quality: peakBreakdownQuality(breakdown.peak.dataHealth),
    levels: breakdown.levels.map((level) => ({
      scopeId: level.scopeId,
      scopeName: level.scopeName,
      averageKw: formatDecimal(level.averageKw, 4),
      sharePct: `${formatDecimal(level.sharePct, 4)}%`,
      quality: peakBreakdownQuality(level.dataHealth),
      circuits: level.circuits.map((circuit) => ({
        meterNodeId: circuit.meterNodeId,
        name: circuit.name,
        category: circuit.category,
        averageKw: circuit.averageKw === null ? null : formatDecimal(circuit.averageKw, 4),
        sharePct: circuit.sharePct === null ? null : `${formatDecimal(circuit.sharePct, 4)}%`,
        includedInOfficialTotal: false,
        quality: peakBreakdownQuality(circuit.dataHealth),
      })),
    })),
    evidence,
  };
}

function validCompletePeakHealth(health: {
  status: string;
  coveragePct: number;
  expectedMeterIntervalCount: number;
  validIntervalCount: number;
  qualityEventCount: number;
}): boolean {
  return health.status === "complete"
    && health.coveragePct === 100
    && health.qualityEventCount === 0
    && validPeakHealth(health)
    && health.expectedMeterIntervalCount > 0
    && health.validIntervalCount === health.expectedMeterIntervalCount;
}

function validPeakEvidencePins(snapshot: EnergyProjectAnalysisSnapshotDto): boolean {
  const { analysis, context, projectRelease } = snapshot;
  const peakMetricId = "energy.peak_demand_kw@1";
  const peakQueryId = "peak_breakdown_v1";
  const hasPeakEvidence = snapshot.evidence.some((reference) =>
    reference.metricId === peakMetricId
    && reference.queryIds.includes(peakQueryId)
  );

  return context.projectReleaseId === projectRelease.id
    && context.projectId === projectRelease.projectId
    && analysis.context.projectId === projectRelease.projectId
    && analysis.provenance.dataSnapshotId === snapshot.dataSnapshot.id
    && context.dataSnapshotId === snapshot.dataSnapshot.id
    && analysis.context.dataSnapshotId === snapshot.dataSnapshot.id
    && analysis.provenance.hierarchyRevisionId === projectRelease.hierarchyRevisionId
    && context.hierarchyRevisionId === projectRelease.hierarchyRevisionId
    && analysis.context.hierarchyRevisionId === projectRelease.hierarchyRevisionId
    && analysis.provenance.meterMappingRevisionId === projectRelease.meterMappingRevisionId
    && context.meterMappingRevisionId === projectRelease.meterMappingRevisionId
    && analysis.context.meterMappingRevisionId === projectRelease.meterMappingRevisionId
    && analysis.provenance.meterFormulaRevisionId === projectRelease.meterFormulaRevisionId
    && context.meterFormulaRevisionId === projectRelease.meterFormulaRevisionId
    && analysis.context.meterFormulaRevisionId === projectRelease.meterFormulaRevisionId
    && projectRelease.metricRevisionIds.includes(peakMetricId)
    && hasPeakEvidence;
}

function validPeakHealth(health: {
  status: string;
  coveragePct: number;
  expectedMeterIntervalCount: number;
  validIntervalCount: number;
  qualityEventCount: number;
}): boolean {
  return Number.isFinite(health.coveragePct)
    && health.coveragePct >= 0
    && health.coveragePct <= 100
    && Number.isInteger(health.expectedMeterIntervalCount)
    && health.expectedMeterIntervalCount >= 0
    && Number.isInteger(health.validIntervalCount)
    && health.validIntervalCount >= 0
    && health.validIntervalCount <= health.expectedMeterIntervalCount
    && Number.isInteger(health.qualityEventCount)
    && health.qualityEventCount >= 0;
}

function finiteNonNegative(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0;
}

function validPercentage(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0 && value <= 100;
}

function peakBreakdownQuality(quality: {
  status: "complete" | "unavailable";
  coveragePct: number;
  expectedMeterIntervalCount: number;
  validIntervalCount: number;
  qualityEventCount: number;
}): PeakBreakdownQuality {
  return {
    status: quality.status,
    statusLabel: quality.status === "complete" ? "Complete" : "Unavailable",
    coverage: `${formatDecimal(quality.coveragePct, 1)}% coverage`,
    intervals: `${quality.validIntervalCount.toLocaleString("en-SG")} / ${quality.expectedMeterIntervalCount.toLocaleString("en-SG")} valid intervals`,
    qualityEvents: `${quality.qualityEventCount.toLocaleString("en-SG")} quality events`,
  };
}

type TimeBehaviour = NonNullable<EnergyProjectAnalysisSnapshotDto["analysis"]["timeBehaviour"]>;
type TimeScope = TimeBehaviour["scopes"][number];
type TimeCell = TimeScope["cells"][number];
type DailyAnomalyBundle = Extract<
  NonNullable<EnergyProjectAnalysisSnapshotDto["analysis"]["dailyUsageAnomalies"]>,
  { status: "available" }
>;
type DailyAnomalyRow = DailyAnomalyBundle["scopes"][number]["rows"][number];

const DAILY_ANOMALY_SUPPRESSION_CODES = new Set([
  "CALENDAR_EXCEPTION_DATE",
  "DAILY_FACTS_UNAVAILABLE",
  "DAY_TYPE_CLASSIFICATION_UNAVAILABLE",
  "COVERAGE_BELOW_THRESHOLD",
  "QUALITY_EVENT_PRESENT",
  "BASELINE_SAMPLE_COUNT_INSUFFICIENT",
  "BASELINE_VALUE_UNAVAILABLE",
]);

function buildDailyAnomalies(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  overviewUnavailable: boolean,
): NgeeAnnDailyAnomalyViewModel {
  const bundle = snapshot.analysis.dailyUsageAnomalies;
  const evidence: NgeeAnnDailyAnomalyViewModel["evidence"] = {
    bundleId: bundle?.status === "available" ? bundle.bundleId : null,
    snapshotId: snapshot.dataSnapshot.id,
    projectReleaseId: snapshot.projectRelease.id,
    hierarchyRevisionId: snapshot.analysis.provenance.hierarchyRevisionId,
    meterMappingRevisionId: snapshot.analysis.provenance.meterMappingRevisionId,
    meterFormulaRevisionId: snapshot.analysis.provenance.meterFormulaRevisionId,
    metricVersion: snapshot.analysis.provenance.metricVersion,
    metricId: "energy.total_usage_kwh@1",
    period: `[${snapshot.context.primaryPeriod.start}, ${snapshot.context.primaryPeriod.endExclusive})`,
    timezone: bundle?.status === "available" ? bundle.timezone : snapshot.context.timezone,
    queryIds: ["time_slot_anomaly_v1"],
  };
  const unavailable = (reason: string): NgeeAnnDailyAnomalyViewModel => ({
    status: "unavailable",
    decisionQuestion: "Which complete local days crossed the pinned usage rule and need investigation?",
    reason,
    allSuppressed: false,
    incidents: [],
    rule: null,
    evidence,
  });
  if (overviewUnavailable) {
    return unavailable("No trusted intervals support a daily anomaly conclusion for this Period.");
  }
  if (snapshot.context.scopeType !== "project") {
    return unavailable("Select the Project Scope to review Project and Level daily incidents.");
  }
  if (!bundle) {
    return unavailable("This published Snapshot does not include the authoritative daily anomaly contract.");
  }
  if (bundle.status === "unavailable") {
    return unavailable(bundle.reason.message);
  }
  const invalidReason = invalidDailyAnomalyBundleReason(snapshot, bundle);
  if (invalidReason) return unavailable(invalidReason);

  const allRows = bundle.scopes.flatMap((scope) => scope.rows);
  const incidents = bundle.scopes.flatMap((scope) => scope.rows
    .filter((row) => row.outcome === "triggered")
    .map((row) => ({
      anomalyId: row.anomalyId,
      incidentId: row.incidentId,
      scopeId: scope.scopeId,
      scopeName: scope.scopeType === "project" ? "Project" : scope.scopeName,
      localDate: row.localDate,
      dateLabel: formatLocalDate(row.localDate),
      weekday: formatLocalWeekday(row.localDate),
      dayType: row.dayType === "weekday" ? "Weekday" as const : "Weekend" as const,
      range: formatEvidenceRange(row.from, row.to, bundle.timezone),
      actualKwh: formatDecimal(row.actualKwh!, 4),
      baselineKwh: formatDecimal(row.baselineKwh!, 4),
      impactKwh: signedDecimal(row.impactKwh!, 4),
      relativePct: `${signedDecimal(row.relativePct!, 4)}%`,
      coverage: `${formatDecimal(row.coveragePct, 1)}% coverage`,
      intervals: `${row.validIntervalCount.toLocaleString("en-SG")} / ${row.expectedMeterIntervalCount.toLocaleString("en-SG")} valid intervals`,
      qualityEvents: `${row.qualityEventCount.toLocaleString("en-SG")} quality events`,
      baselineDates: [...row.baselineDates],
      baselineSamples: row.baselineSamples.map((sample) => ({
        localDate: sample.localDate,
        coverage: `${formatDecimal(sample.coveragePct, 1)}% coverage`,
        intervals: `${sample.validIntervalCount.toLocaleString("en-SG")} / ${sample.expectedMeterIntervalCount.toLocaleString("en-SG")} valid intervals`,
        qualityEvents: `${sample.qualityEventCount.toLocaleString("en-SG")} quality events`,
      })),
      hourlyComparison: row.hourlyComparison.map((point) => ({
        localHour: point.localHour,
        actualKwh: point.actualKwh!,
        baselineKwh: point.baselineKwh!,
        impactKwh: point.impactKwh!,
        relativePct: point.relativePct!,
      })),
      series: row.detailSeries.map((series) => ({
        seriesId: series.seriesId,
        relationship: series.relationship,
        kind: series.kind,
        scopeId: series.scopeId,
        scopeName: series.scopeName,
        meterNodeId: series.meterNodeId ?? null,
        category: series.category ?? null,
        categoryLabel: series.category ? formatCategoryLabel(series.category) : null,
        includedInOfficialTotal: series.includedInOfficialTotal,
        status: series.status,
        statusLabel: series.status === "available"
          ? "Available" as const
          : series.status === "partial"
            ? "Partial" as const
            : "Unavailable" as const,
        selectedTotalKwh: series.selectedTotalKwh === null ? null : formatDecimal(series.selectedTotalKwh, 4),
        baselineTotalKwh: series.baselineTotalKwh === null ? null : formatDecimal(series.baselineTotalKwh, 4),
        impactKwh: series.impactKwh === null ? null : signedDecimal(series.impactKwh, 4),
        relativePct: series.relativePct === null ? null : `${signedDecimal(series.relativePct, 4)}%`,
        coverage: `${formatDecimal(series.coveragePct, 1)}% coverage`,
        intervals: `${series.validIntervalCount.toLocaleString("en-SG")} / ${series.expectedMeterIntervalCount.toLocaleString("en-SG")} valid intervals`,
        qualityEvents: `${series.qualityEventCount.toLocaleString("en-SG")} quality events`,
        points: series.points.map((point) => ({
          localHour: point.localHour,
          hourLabel: formatLocalHour(point.localHour),
          selectedKwh: point.selectedKwh,
          baselineKwh: point.baselineKwh,
          impactKwh: point.impactKwh,
        })),
      })),
    })));

  return {
    status: "available",
    decisionQuestion: "Which complete local days crossed the pinned usage rule and need investigation?",
    reason: null,
    allSuppressed: allRows.length > 0 && allRows.every((row) => row.outcome === "suppressed"),
    incidents,
    rule: {
      ruleRevisionId: bundle.ruleRevisionId,
      baselineCutoff: bundle.baselineCutoff,
      baselineMethod: bundle.rule.baselineMethod,
      relativeThresholdPct: `${formatDecimal(bundle.rule.relativeThresholdPct, 4)}%`,
      absoluteImpactKwh: `${formatDecimal(bundle.rule.absoluteImpactKwh, 4)} kWh`,
      minimumCoveragePct: `${formatDecimal(bundle.rule.minimumCoveragePct, 4)}%`,
      minimumSampleCount: bundle.rule.minimumSampleCount,
      maximumQualityEventCount: bundle.rule.maximumQualityEventCount,
      maximumLookbackDays: bundle.rule.maximumLookbackDays,
    },
    evidence,
  };
}

function invalidDailyAnomalyBundleReason(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  bundle: DailyAnomalyBundle,
): string | null {
  if (!validDailyAnomalyEvidencePins(snapshot, bundle)) {
    return "The anomaly Snapshot, Release, Rule or revision evidence pins are inconsistent.";
  }
  if (
    !bundle.bundleId
    || bundle.metricId !== "energy.total_usage_kwh@1"
    || bundle.queryId !== "time_slot_anomaly_v1"
    || bundle.timezone !== snapshot.context.timezone
    || !/^\d{4}-\d{2}-\d{2}$/u.test(bundle.baselineCutoff)
    || !validDailyAnomalyRule(bundle.rule)
  ) {
    return "The anomaly bundle identity, timezone, cutoff or pinned Rule is invalid.";
  }
  const expectedScopes = [
    { id: snapshot.context.scopeId, name: snapshot.context.scopeName, type: "project" },
    ...snapshot.analysis.childScopes
      .filter((scope) => scope.nodeType === "level")
      .map((scope) => ({ id: scope.nodeId, name: scope.name, type: scope.nodeType })),
  ];
  if (
    expectedScopes.length !== 3
    || bundle.scopes.length !== expectedScopes.length
    || bundle.scopes.some((scope, index) => {
      const expected = expectedScopes[index];
      return !expected
        || scope.scopeId !== expected.id
        || scope.scopeName !== expected.name
        || scope.scopeType !== expected.type;
    })
  ) {
    return "The anomaly Scope contract is incomplete or out of order.";
  }
  const projectRows = bundle.scopes[0]?.rows;
  if (!projectRows || !validDailyAnomalySpine(projectRows, snapshot.context.primaryPeriod)) {
    return "The anomaly local-date spine is incomplete or invalid.";
  }
  const spine = projectRows.map((row) => `${row.localDate}|${row.from}|${row.to}`);
  const anomalyIds = new Set<string>();
  const incidentIds = new Set<string>();
  const rowsValid = bundle.scopes.every((scope) => (
    scope.rows.length === spine.length
    && scope.rows.every((row, index) => {
      if (`${row.localDate}|${row.from}|${row.to}` !== spine[index]) return false;
      if (!row.anomalyId || anomalyIds.has(row.anomalyId) || !row.incidentId || incidentIds.has(row.incidentId)) return false;
      anomalyIds.add(row.anomalyId);
      incidentIds.add(row.incidentId);
      return validDailyAnomalyRow(row, scope.scopeId, bundle);
    })
  ));
  return rowsValid ? null : "The anomaly rows, baseline samples, outcomes or detail series are invalid.";
}

function validDailyAnomalyEvidencePins(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  bundle: DailyAnomalyBundle,
): boolean {
  const { analysis, context, projectRelease } = snapshot;
  const hasReference = snapshot.evidence.some((item) => (
    item.metricId === "energy.total_usage_kwh@1"
    && item.queryIds.includes("time_slot_anomaly_v1")
  ));
  return context.projectReleaseId === projectRelease.id
    && context.projectId === projectRelease.projectId
    && analysis.context.projectId === projectRelease.projectId
    && bundle.evidencePins.dataSnapshotId === snapshot.dataSnapshot.id
    && analysis.provenance.dataSnapshotId === snapshot.dataSnapshot.id
    && context.dataSnapshotId === snapshot.dataSnapshot.id
    && analysis.context.dataSnapshotId === snapshot.dataSnapshot.id
    && bundle.evidencePins.hierarchyRevisionId === projectRelease.hierarchyRevisionId
    && analysis.provenance.hierarchyRevisionId === projectRelease.hierarchyRevisionId
    && context.hierarchyRevisionId === projectRelease.hierarchyRevisionId
    && analysis.context.hierarchyRevisionId === projectRelease.hierarchyRevisionId
    && bundle.evidencePins.meterMappingRevisionId === projectRelease.meterMappingRevisionId
    && analysis.provenance.meterMappingRevisionId === projectRelease.meterMappingRevisionId
    && context.meterMappingRevisionId === projectRelease.meterMappingRevisionId
    && analysis.context.meterMappingRevisionId === projectRelease.meterMappingRevisionId
    && bundle.evidencePins.meterFormulaRevisionId === projectRelease.meterFormulaRevisionId
    && analysis.provenance.meterFormulaRevisionId === projectRelease.meterFormulaRevisionId
    && context.meterFormulaRevisionId === projectRelease.meterFormulaRevisionId
    && analysis.context.meterFormulaRevisionId === projectRelease.meterFormulaRevisionId
    && bundle.evidencePins.metricVersion === analysis.provenance.metricVersion
    && bundle.evidencePins.metricVersion === context.metricVersion
    && bundle.evidencePins.metricVersion === analysis.context.metricVersion
    && bundle.evidencePins.queryIds.length === 1
    && bundle.evidencePins.queryIds[0] === "time_slot_anomaly_v1"
    && projectRelease.metricRevisionIds.includes("energy.total_usage_kwh@1")
    && projectRelease.ruleRevisionIds.includes(bundle.ruleRevisionId)
    && analysis.provenance.ruleRevisionIds.includes(bundle.ruleRevisionId)
    && context.businessCalendarVersion === projectRelease.businessCalendarVersion
    && analysis.provenance.queryIds.includes("time_slot_anomaly_v1")
    && hasReference;
}

function validDailyAnomalyRule(rule: DailyAnomalyBundle["rule"]): boolean {
  return finiteNonNegative(rule.relativeThresholdPct)
    && finiteNonNegative(rule.absoluteImpactKwh)
    && validPercentage(rule.minimumCoveragePct)
    && Number.isInteger(rule.minimumSampleCount)
    && rule.minimumSampleCount > 0
    && Number.isInteger(rule.maximumQualityEventCount)
    && rule.maximumQualityEventCount >= 0
    && Number.isInteger(rule.maximumLookbackDays)
    && rule.maximumLookbackDays > 0
    && rule.direction === "above"
    && rule.baselineMethod === "mean_of_complete_comparable_days_by_local_hour";
}

function validDailyAnomalySpine(
  rows: DailyAnomalyRow[],
  period: EnergyProjectAnalysisSnapshotDto["context"]["primaryPeriod"],
): boolean {
  if (rows.length === 0 || rows[0]?.from !== period.start || rows.at(-1)?.to !== period.endExclusive) return false;
  return rows.every((row, index) => {
    const previous = rows[index - 1];
    return /^\d{4}-\d{2}-\d{2}$/u.test(row.localDate)
      && Number.isFinite(Date.parse(row.from))
      && Number.isFinite(Date.parse(row.to))
      && Date.parse(row.to) - Date.parse(row.from) === 86_400_000
      && (!previous || (previous.to === row.from && previous.localDate < row.localDate));
  });
}

function validDailyAnomalyRow(
  row: DailyAnomalyRow,
  scopeId: string,
  bundle: DailyAnomalyBundle,
): boolean {
  const baselineDatesValid = row.baselineSampleCount === row.baselineDates.length
    && row.baselineSamples.length === row.baselineDates.length
    && row.baselineDates.every((date, index) => (
      /^\d{4}-\d{2}-\d{2}$/u.test(date)
      && date < bundle.baselineCutoff
      && (index === 0 || row.baselineDates[index - 1]! < date)
      && validEligibleBaselineSample(row.baselineSamples[index], date)
    ));
  const thresholdsValid = row.thresholds.relativeThresholdPct === bundle.rule.relativeThresholdPct
    && row.thresholds.absoluteImpactKwh === bundle.rule.absoluteImpactKwh
    && row.thresholds.minimumCoveragePct === bundle.rule.minimumCoveragePct
    && row.thresholds.maximumQualityEventCount === bundle.rule.maximumQualityEventCount;
  const identityValid = row.ruleRevisionId === bundle.ruleRevisionId
    && row.metricId === bundle.metricId
    && row.queryId === bundle.queryId
    && (row.dayType === "weekday" || row.dayType === "weekend" || row.dayType === null)
    && (row.outcome === "triggered" || row.outcome === "within_threshold" || row.outcome === "suppressed");
  if (!identityValid || !baselineDatesValid || !thresholdsValid || !validAnomalyHealth(row)) return false;
  if (
    row.hourlyComparison.length !== 24
    || !row.hourlyComparison.every((point, index) => (
      point.localHour === index
      && finiteNonNegativeOrNull(point.actualKwh)
      && finiteNonNegativeOrNull(point.baselineKwh)
      && finiteOrNull(point.impactKwh)
      && finiteOrNull(point.relativePct)
    ))
  ) return false;
  const suppressed = row.outcome === "suppressed";
  const validSuppression = suppressed
    ? Boolean(row.suppressionReason?.message)
      && DAILY_ANOMALY_SUPPRESSION_CODES.has(row.suppressionReason!.code)
    : row.suppressionReason === undefined;
  if (!validSuppression) return false;
  if (row.outcome === "triggered" || row.outcome === "within_threshold") {
    if (
      row.dayType === null
      || !finiteNonNegative(row.actualKwh)
      || !finiteNonNegative(row.baselineKwh)
      || row.baselineKwh <= 0
      || !Number.isFinite(row.impactKwh)
      || !Number.isFinite(row.relativePct)
    ) return false;
  } else if (
    !finiteNonNegativeOrNull(row.actualKwh)
    || !finiteNonNegativeOrNull(row.baselineKwh)
    || !finiteOrNull(row.impactKwh)
    || !finiteOrNull(row.relativePct)
  ) return false;
  if (row.outcome !== "triggered") return true;
  if (
    row.impactKwh === null
    || row.relativePct === null
    || row.hourlyComparison.some((point) => (
      point.actualKwh === null || point.baselineKwh === null || point.impactKwh === null
    ))
  ) return false;
  return validTriggeredDetailSeries(row, scopeId);
}

function validEligibleBaselineSample(
  sample: DailyAnomalyRow["baselineSamples"][number] | undefined,
  localDate: string,
): boolean {
  return Boolean(sample)
    && sample!.localDate === localDate
    && sample!.eligible === true
    && validAnomalyHealth(sample!);
}

function validAnomalyHealth(health: {
  coveragePct: number;
  expectedMeterIntervalCount: number;
  validIntervalCount: number;
  qualityEventCount: number;
}): boolean {
  return validPercentage(health.coveragePct)
    && Number.isInteger(health.expectedMeterIntervalCount)
    && health.expectedMeterIntervalCount > 0
    && Number.isInteger(health.validIntervalCount)
    && health.validIntervalCount >= 0
    && health.validIntervalCount <= health.expectedMeterIntervalCount
    && Number.isInteger(health.qualityEventCount)
    && health.qualityEventCount >= 0;
}

function validTriggeredDetailSeries(
  row: DailyAnomalyRow,
  scopeId: string,
): boolean {
  const ids = new Set<string>();
  const selected = row.detailSeries.filter((series) => series.relationship === "selected_scope");
  if (selected.length !== 1 || selected[0]?.scopeId !== scopeId) return false;
  return row.detailSeries.length > 0 && row.detailSeries.every((series) => {
    if (!series.seriesId || ids.has(series.seriesId) || !series.scopeId || !series.scopeName) return false;
    ids.add(series.seriesId);
    const relationshipValid = series.relationship === "component_circuit"
      ? series.kind === "component_circuit"
        && series.includedInOfficialTotal === false
        && Boolean(series.meterNodeId)
        && (series.category === "load" || series.category === "light")
      : (series.relationship === "selected_scope" || series.relationship === "immediate_level")
        && series.kind === "official_scope"
        && series.includedInOfficialTotal === true;
    const pointsValid = series.points.length === 24 && series.points.every((point, index) => (
      point.localHour === index
      && finiteNonNegativeOrNull(point.selectedKwh)
      && finiteNonNegativeOrNull(point.baselineKwh)
      && finiteOrNull(point.impactKwh)
    ));
    if (
      !relationshipValid
      || !pointsValid
      || !validAnomalyHealth(series)
      || (series.status !== "available" && series.status !== "partial" && series.status !== "unavailable")
    ) return false;
    if (series.status === "available") {
      return finiteNonNegative(series.selectedTotalKwh)
        && finiteNonNegative(series.baselineTotalKwh)
        && Number.isFinite(series.impactKwh)
        && finiteOrNull(series.relativePct)
        && series.points.every((point) => point.selectedKwh !== null && point.baselineKwh !== null && point.impactKwh !== null);
    }
    return finiteNonNegativeOrNull(series.selectedTotalKwh)
      && finiteNonNegativeOrNull(series.baselineTotalKwh)
      && finiteOrNull(series.impactKwh)
      && finiteOrNull(series.relativePct);
  }) && selected[0]!.points.every((point, index) => {
    const comparison = row.hourlyComparison[index]!;
    return point.selectedKwh === comparison.actualKwh
      && point.baselineKwh === comparison.baselineKwh
      && point.impactKwh === comparison.impactKwh;
  });
}

function finiteOrNull(value: number | null): boolean {
  return value === null || Number.isFinite(value);
}

function finiteNonNegativeOrNull(value: number | null): boolean {
  return value === null || finiteNonNegative(value);
}

function timeBehaviourEvidence(snapshot: EnergyProjectAnalysisSnapshotDto): TimeBehaviourEvidence {
  return {
    snapshotId: snapshot.dataSnapshot.id,
    projectReleaseId: snapshot.projectRelease.id,
    meterMappingRevisionId: snapshot.analysis.provenance.meterMappingRevisionId,
    meterFormulaRevisionId: snapshot.analysis.provenance.meterFormulaRevisionId,
    metricId: "energy.total_usage_kwh@1",
    period: `[${snapshot.context.primaryPeriod.start}, ${snapshot.context.primaryPeriod.endExclusive})`,
    timezone: snapshot.analysis.timeBehaviour?.timezone ?? snapshot.context.timezone,
    unit: "kWh",
    queryIds: ["time_bucket_grid_v1"],
  };
}

function buildDayProfile(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  overviewUnavailable: boolean,
): NgeeAnnDayProfileViewModel {
  const evidence = timeBehaviourEvidence(snapshot);
  const unavailable = (reason: string): NgeeAnnDayProfileViewModel => ({
    status: "unavailable",
    decisionQuestion: "How does the typical 24-hour energy shape change by Day Type and Scope?",
    reason,
    scopes: [],
    profiles: [],
    evidence,
  });
  if (overviewUnavailable) {
    return unavailable("No trusted intervals support a Day Profile for this Period.");
  }
  if (snapshot.context.scopeType !== "project") {
    return unavailable("Select the Project Scope to compare Project and Level Day Profiles.");
  }
  const grid = validTimeGrid(snapshot);
  if (!grid.valid) {
    return unavailable(grid.reason);
  }
  const profiles = snapshot.analysis.timeBehaviour!.dayProfiles;
  const expectedKeys = new Set(grid.scopes.flatMap((scope) => (
    ["weekday", "weekend", "public_holiday"].map((dayType) => `${scope.scopeId}:${dayType}`)
  )));
  const seenKeys = new Set<string>();
  const validProfiles = profiles.length === expectedKeys.size && profiles.every((profile) => {
    const scope = grid.scopes.find((candidate) => candidate.scopeId === profile.scopeId);
    const key = `${profile.scopeId}:${profile.dayType}`;
    if (!scope || profile.scopeName !== scope.scopeName || !expectedKeys.has(key) || seenKeys.has(key)) {
      return false;
    }
    seenKeys.add(key);
    if (profile.status === "unavailable") {
      return Boolean(profile.reason.message)
        && (profile.reason.code === "COMPLETE_DAY_SAMPLE_UNAVAILABLE"
          || profile.reason.code === "DAY_TYPE_CLASSIFICATION_UNAVAILABLE")
        && (profile.dayType !== "public_holiday"
          || profile.reason.code === "DAY_TYPE_CLASSIFICATION_UNAVAILABLE");
    }
    return Number.isInteger(profile.sampleDayCount)
      && profile.sampleDayCount > 0
      && profile.values.length === 24
      && profile.values.every((value, index) => (
        value.localHour === index && finiteNonNegative(value.usageKwh)
      ));
  });
  if (!validProfiles || seenKeys.size !== expectedKeys.size) {
    return unavailable("The server Day Profile contract is incomplete or invalid.");
  }

  return {
    status: "available",
    decisionQuestion: "How does the typical 24-hour energy shape change by Day Type and Scope?",
    reason: null,
    scopes: grid.scopes.map((scope) => ({
      id: scope.scopeId,
      name: scope.scopeType === "project" ? "Project" : scope.scopeName,
    })),
    profiles: profiles.map((profile) => ({
      id: `${profile.scopeId}:${profile.dayType}`,
      dayType: profile.dayType,
      dayTypeLabel: dayTypeLabel(profile.dayType),
      scopeId: profile.scopeId,
      scopeName: profile.scopeId === snapshot.context.scopeId ? "Project" : profile.scopeName,
      status: profile.status,
      sampleDayCount: profile.status === "available" ? profile.sampleDayCount : null,
      reason: profile.status === "unavailable" ? profile.reason.message : null,
      values: profile.status === "available"
        ? profile.values.map((value) => ({
          id: `${profile.scopeId}:${profile.dayType}:${value.localHour}`,
          localHour: value.localHour,
          hourLabel: formatLocalHour(value.localHour),
          acceptedUsageKwh: value.usageKwh,
          usageKwh: formatDecimal(value.usageKwh, 4),
        }))
        : [],
    })),
    evidence,
  };
}

function buildUsageHeatmap(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  overviewUnavailable: boolean,
): NgeeAnnUsageHeatmapViewModel {
  const evidence = timeBehaviourEvidence(snapshot);
  const unavailable = (reason: string): NgeeAnnUsageHeatmapViewModel => ({
    status: "unavailable",
    decisionQuestion: "Which local date, Level and hour cell needs inspection?",
    reason,
    defaultView: "date-hour",
    dates: [],
    scopes: [],
    evidence,
  });
  if (overviewUnavailable) {
    return unavailable("No trusted intervals support an hourly Usage heatmap for this Period.");
  }
  if (snapshot.context.scopeType !== "project") {
    return unavailable("Select the Project Scope to inspect Project and Level hourly cells.");
  }
  const grid = validTimeGrid(snapshot);
  if (!grid.valid) {
    return unavailable(grid.reason);
  }
  const firstScope = grid.scopes[0]!;
  const dates = firstScope.cells
    .filter((cell) => cell.localHour === 0)
    .map((cell) => ({
      id: cell.localDate,
      label: formatLocalDate(cell.localDate),
      weekday: formatLocalWeekday(cell.localDate),
    }));

  return {
    status: "available",
    decisionQuestion: "Which local date, Level and hour cell needs inspection?",
    reason: null,
    defaultView: dates.length === 1 ? "level-hour" : "date-hour",
    dates,
    scopes: grid.scopes.map((scope) => ({
      id: scope.scopeId,
      name: scope.scopeType === "project" ? "Project" : scope.scopeName,
      cells: scope.cells.map((cell) => ({
        id: `${scope.scopeId}:${cell.localDate}:${cell.localHour}`,
        scopeId: scope.scopeId,
        localDate: cell.localDate,
        dateLabel: formatLocalDate(cell.localDate),
        weekday: formatLocalWeekday(cell.localDate),
        localHour: cell.localHour,
        hourLabel: formatLocalHour(cell.localHour),
        range: formatEvidenceRange(cell.from, cell.to, snapshot.analysis.timeBehaviour!.timezone),
        acceptedUsageKwh: cell.usageKwh,
        usageKwh: cell.usageKwh === null ? null : formatDecimal(cell.usageKwh, 4),
        quality: timePointQuality(cell.dataHealth),
      })),
    })),
    evidence,
  };
}

function validTimeGrid(snapshot: EnergyProjectAnalysisSnapshotDto):
  | { valid: true; scopes: TimeScope[] }
  | { valid: false; reason: string } {
  const { analysis, context, projectRelease } = snapshot;
  const timeBehaviour = analysis.timeBehaviour;
  if (!timeBehaviour) {
    return { valid: false, reason: "This published Snapshot does not include the authoritative hourly time grid." };
  }
  const hasEvidence = snapshot.evidence.some((reference) => (
    reference.metricId === "energy.total_usage_kwh@1"
    && reference.queryIds.includes("time_bucket_grid_v1")
  ));
  const pinsValid = context.projectReleaseId === projectRelease.id
    && context.projectId === projectRelease.projectId
    && analysis.context.projectId === projectRelease.projectId
    && analysis.provenance.dataSnapshotId === snapshot.dataSnapshot.id
    && context.dataSnapshotId === snapshot.dataSnapshot.id
    && analysis.context.dataSnapshotId === snapshot.dataSnapshot.id
    && analysis.provenance.hierarchyRevisionId === projectRelease.hierarchyRevisionId
    && context.hierarchyRevisionId === projectRelease.hierarchyRevisionId
    && analysis.context.hierarchyRevisionId === projectRelease.hierarchyRevisionId
    && analysis.provenance.meterMappingRevisionId === projectRelease.meterMappingRevisionId
    && context.meterMappingRevisionId === projectRelease.meterMappingRevisionId
    && analysis.context.meterMappingRevisionId === projectRelease.meterMappingRevisionId
    && analysis.provenance.meterFormulaRevisionId === projectRelease.meterFormulaRevisionId
    && context.meterFormulaRevisionId === projectRelease.meterFormulaRevisionId
    && analysis.context.meterFormulaRevisionId === projectRelease.meterFormulaRevisionId
    && projectRelease.metricRevisionIds.includes("energy.total_usage_kwh@1")
    && hasEvidence;
  if (!pinsValid) {
    return { valid: false, reason: "The hourly grid Snapshot, Release or revision evidence pins are inconsistent." };
  }
  if (
    timeBehaviour.metricId !== "energy.total_usage_kwh@1"
    || timeBehaviour.grain !== "hour"
    || timeBehaviour.unit !== "kWh"
    || timeBehaviour.timezone !== context.timezone
    || timeBehaviour.queryId !== "time_bucket_grid_v1"
    || !analysis.provenance.queryIds.includes("time_bucket_grid_v1")
  ) {
    return { valid: false, reason: "The hourly grid metric, grain, timezone, unit or query evidence is invalid." };
  }
  const expectedScopes = [
    { id: context.scopeId, name: context.scopeName, type: "project" },
    ...analysis.childScopes
      .filter((scope) => scope.nodeType === "level")
      .map((scope) => ({ id: scope.nodeId, name: scope.name, type: scope.nodeType })),
  ];
  if (
    expectedScopes.length !== 3
    || timeBehaviour.scopes.length !== expectedScopes.length
    || timeBehaviour.scopes.some((scope, index) => {
      const expected = expectedScopes[index];
      return !expected
        || scope.scopeId !== expected.id
        || scope.scopeName !== expected.name
        || scope.scopeType !== expected.type;
    })
  ) {
    return { valid: false, reason: "The hourly grid Scope contract is incomplete or out of order." };
  }
  const projectCells = timeBehaviour.scopes[0]?.cells;
  if (!projectCells || !validTimeSpine(projectCells, context.primaryPeriod)) {
    return { valid: false, reason: "The hourly grid time spine is incomplete or invalid." };
  }
  const spine = projectCells.map((cell) => `${cell.localDate}|${cell.localHour}|${cell.from}|${cell.to}`);
  if (timeBehaviour.scopes.some((scope) => (
    scope.cells.length !== spine.length
    || scope.cells.some((cell, index) => (
      `${cell.localDate}|${cell.localHour}|${cell.from}|${cell.to}` !== spine[index]
      || !validTimeCell(cell)
    ))
  ))) {
    return { valid: false, reason: "The hourly grid cells do not share one valid authoritative time spine." };
  }
  return { valid: true, scopes: timeBehaviour.scopes };
}

function validTimeSpine(
  cells: TimeCell[],
  period: EnergyProjectAnalysisSnapshotDto["context"]["primaryPeriod"],
): boolean {
  if (
    cells.length === 0
    || cells.length % 24 !== 0
    || cells[0]?.from !== period.start
    || cells.at(-1)?.to !== period.endExclusive
  ) {
    return false;
  }
  return cells.every((cell, index) => {
    const previous = cells[index - 1];
    return /^\d{4}-\d{2}-\d{2}$/u.test(cell.localDate)
      && Number.isInteger(cell.localHour)
      && cell.localHour === index % 24
      && Number.isFinite(Date.parse(cell.from))
      && Number.isFinite(Date.parse(cell.to))
      && Date.parse(cell.from) < Date.parse(cell.to)
      && Date.parse(cell.to) - Date.parse(cell.from) === 3_600_000
      && (!previous || previous.to === cell.from)
      && (cell.localHour !== 0 || index === 0 || previous?.localDate < cell.localDate);
  });
}

function validTimeCell(cell: TimeCell): boolean {
  const health = cell.dataHealth;
  const countsValid = Number.isFinite(health.coveragePct)
    && health.coveragePct >= 0
    && health.coveragePct <= 100
    && Number.isInteger(health.expectedMeterIntervalCount)
    && health.expectedMeterIntervalCount >= 0
    && Number.isInteger(health.validIntervalCount)
    && health.validIntervalCount >= 0
    && health.validIntervalCount <= health.expectedMeterIntervalCount
    && Number.isInteger(health.qualityEventCount)
    && health.qualityEventCount >= 0;
  if (!countsValid) return false;
  if (health.status === "complete") {
    return health.coveragePct === 100
      && health.expectedMeterIntervalCount > 0
      && health.validIntervalCount === health.expectedMeterIntervalCount
      && health.qualityEventCount === 0
      && finiteNonNegative(cell.usageKwh);
  }
  if (health.status === "partial") {
    return health.expectedMeterIntervalCount > 0
      && health.validIntervalCount > 0
      && (health.validIntervalCount < health.expectedMeterIntervalCount || health.qualityEventCount > 0)
      && finiteNonNegative(cell.usageKwh);
  }
  return cell.usageKwh === null;
}

function timePointQuality(health: TimeCell["dataHealth"]): TimePointQuality {
  return {
    status: health.status,
    statusLabel: health.status === "complete" ? "Complete" : health.status === "partial" ? "Partial" : "Unavailable",
    coverage: `${formatDecimal(health.coveragePct, 1)}% coverage`,
    intervals: `${health.validIntervalCount.toLocaleString("en-SG")} / ${health.expectedMeterIntervalCount.toLocaleString("en-SG")} valid intervals`,
    qualityEvents: `${health.qualityEventCount.toLocaleString("en-SG")} quality events`,
  };
}

function timeScopeLimitation(cells: TimeCell[]): string | null {
  if (cells.some((cell) => cell.dataHealth.status === "unavailable")) {
    return "At least one hour has no accepted facts. The hour remains visible and is not zero-filled.";
  }
  if (cells.some((cell) => cell.dataHealth.status === "partial")) {
    return "At least one hour is partial. Accepted usage remains visible with its coverage.";
  }
  return null;
}

function dayTypeLabel(dayType: "weekday" | "weekend" | "public_holiday"):
  "Weekday" | "Weekend" | "Public Holiday" {
  return dayType === "weekday" ? "Weekday" : dayType === "weekend" ? "Weekend" : "Public Holiday";
}

function formatCategoryLabel(value: string): string {
  return value
    .split(/[_\s-]+/u)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(" ");
}

function formatLocalHour(localHour: number): string {
  return `${String(localHour).padStart(2, "0")}:00`;
}

function buildEnergyTrend(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  overviewUnavailable: boolean,
): NgeeAnnEnergyTrendViewModel {
  const { analysis, context } = snapshot;
  const dailyTotals = analysis.dailyTotals;
  const timeBehaviour = analysis.timeBehaviour;
  const singleDay = isSingleLocalDayPeriod(context.primaryPeriod, context.timezone);
  const queryId = singleDay ? "time_bucket_grid_v1" : "daily_totals_v1";
  const evidence: NgeeAnnEnergyTrendViewModel["evidence"] = {
    snapshotId: snapshot.dataSnapshot.id,
    projectReleaseId: snapshot.projectRelease.id,
    meterMappingRevisionId: analysis.provenance.meterMappingRevisionId,
    meterFormulaRevisionId: analysis.provenance.meterFormulaRevisionId,
    metricId: "energy.total_usage_kwh@1",
    period: `[${context.primaryPeriod.start}, ${context.primaryPeriod.endExclusive})`,
    timezone: singleDay ? timeBehaviour?.timezone ?? context.timezone : dailyTotals?.timezone ?? context.timezone,
    unit: "kWh",
    queryIds: [queryId],
  };
  const unavailable = (reason: string): NgeeAnnEnergyTrendViewModel => ({
    status: "unavailable",
    grain: singleDay ? "hour" : "day",
    decisionQuestion: "When did accepted energy use change inside the selected Period?",
    reason,
    scopes: [],
    evidence,
  });

  if (overviewUnavailable) {
    return unavailable("No trusted intervals support an Energy trend for this Period.");
  }
  if (context.scopeType !== "project") {
    return unavailable("Select the Project Scope to compare the Project, Level 7 and Level 6 trend.");
  }
  if (singleDay) {
    const grid = validTimeGrid(snapshot);
    if (!grid.valid) {
      return unavailable(grid.reason);
    }
    return {
      status: "available",
      grain: "hour",
      decisionQuestion: "Which accepted local hours drove energy use on the selected day?",
      reason: null,
      scopes: grid.scopes.map((scope) => ({
        id: scope.scopeId,
        name: scope.scopeType === "project" ? "Project" : scope.scopeName,
        limitation: timeScopeLimitation(scope.cells),
        points: scope.cells.map((cell) => ({
          id: `${scope.scopeId}:${cell.localDate}:${cell.localHour}`,
          localDate: cell.localDate,
          localHour: cell.localHour,
          dateLabel: formatLocalHour(cell.localHour),
          weekday: formatLocalDate(cell.localDate),
          range: formatEvidenceRange(cell.from, cell.to, timeBehaviour!.timezone),
          acceptedUsageKwh: cell.usageKwh,
          usageKwh: cell.usageKwh === null ? null : formatDecimal(cell.usageKwh, 4),
          ...timePointQuality(cell.dataHealth),
        })),
      })),
      evidence,
    };
  }
  if (!dailyTotals) {
    return unavailable("This published Snapshot does not include the authoritative daily totals contract.");
  }
  if (
    dailyTotals.metricId !== "energy.total_usage_kwh@1"
    || dailyTotals.grain !== "day"
    || dailyTotals.timezone !== context.timezone
    || !analysis.provenance.queryIds.includes("daily_totals_v1")
  ) {
    return unavailable("The daily totals identity, grain, timezone or query evidence is invalid.");
  }

  const expectedScopes = [
    { id: context.scopeId, name: context.scopeName, type: "project" },
    ...analysis.childScopes
      .filter((scope) => scope.nodeType === "level")
      .map((scope) => ({ id: scope.nodeId, name: scope.name, type: scope.nodeType })),
  ];
  if (
    expectedScopes.length !== 3
    || dailyTotals.scopes.length !== expectedScopes.length
    || dailyTotals.scopes.some((scope, index) => {
      const expected = expectedScopes[index];
      return !expected
        || scope.scopeId !== expected.id
        || scope.scopeName !== expected.name
        || scope.scopeType !== expected.type;
    })
  ) {
    return unavailable("The daily totals Scope contract is incomplete or out of order.");
  }

  const projectRows = dailyTotals.scopes[0]?.rows;
  if (!projectRows || !validDailySpine(projectRows, context.primaryPeriod)) {
    return unavailable("The daily totals date spine is incomplete or invalid.");
  }
  const spine = projectRows.map((row) => `${row.localDate}|${row.from}|${row.to}`);
  if (dailyTotals.scopes.some((scope) =>
    scope.rows.length !== spine.length
    || scope.rows.some((row, index) => `${row.localDate}|${row.from}|${row.to}` !== spine[index])
    || scope.rows.some((row) => !validDailyPoint(row))
  )) {
    return unavailable("The daily totals rows do not share one valid authoritative date spine.");
  }

  return {
    status: "available",
    grain: "day",
    decisionQuestion: "When did accepted energy use change inside the selected Period?",
    reason: null,
    scopes: dailyTotals.scopes.map((scope) => {
      const hasUnavailable = scope.rows.some((row) => row.dataHealth.status === "unavailable");
      const hasPartial = scope.rows.some((row) => row.dataHealth.status === "partial");
      return {
        id: scope.scopeId,
        name: scope.scopeType === "project" ? "Project" : scope.scopeName,
        limitation: hasUnavailable
          ? "At least one day has no accepted facts. The date remains visible and is not zero-filled."
          : hasPartial
            ? "At least one day is partial. Accepted usage remains visible with its coverage."
            : null,
        points: scope.rows.map((row) => ({
          id: `${scope.scopeId}:${row.localDate}`,
          localDate: row.localDate,
          localHour: null,
          dateLabel: formatLocalDate(row.localDate),
          weekday: formatLocalWeekday(row.localDate),
          range: formatEvidenceRange(row.from, row.to, dailyTotals.timezone),
          acceptedUsageKwh: row.usageKwh,
          usageKwh: row.usageKwh === null ? null : formatDecimal(row.usageKwh, 4),
          status: row.dataHealth.status,
          statusLabel: row.dataHealth.status === "complete"
            ? "Complete"
            : row.dataHealth.status === "partial"
              ? "Partial"
              : "Unavailable",
          coverage: `${formatDecimal(row.dataHealth.coveragePct, 1)}% coverage`,
          intervals: `${row.dataHealth.validIntervalCount.toLocaleString("en-SG")} / ${row.dataHealth.expectedMeterIntervalCount.toLocaleString("en-SG")} valid intervals`,
          qualityEvents: `${row.dataHealth.qualityEventCount.toLocaleString("en-SG")} quality events`,
        })),
      };
    }),
    evidence,
  };
}

function isSingleLocalDayPeriod(
  period: EnergyProjectAnalysisSnapshotDto["context"]["primaryPeriod"],
  timezone: string,
): boolean {
  const start = Date.parse(period.start);
  const end = Date.parse(period.endExclusive);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return false;
  const startDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(start));
  const endDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(end - 1));
  return startDate === endDate;
}

function validDailySpine(
  rows: NonNullable<EnergyProjectAnalysisSnapshotDto["analysis"]["dailyTotals"]>["scopes"][number]["rows"],
  period: EnergyProjectAnalysisSnapshotDto["context"]["primaryPeriod"],
): boolean {
  if (rows.length === 0 || rows[0]?.from !== period.start || rows.at(-1)?.to !== period.endExclusive) {
    return false;
  }
  return rows.every((row, index) => {
    const previous = rows[index - 1];
    return /^\d{4}-\d{2}-\d{2}$/u.test(row.localDate)
      && Number.isFinite(Date.parse(row.from))
      && Number.isFinite(Date.parse(row.to))
      && Date.parse(row.from) < Date.parse(row.to)
      && (!previous || (previous.to === row.from && previous.localDate < row.localDate));
  });
}

function validDailyPoint(
  row: NonNullable<EnergyProjectAnalysisSnapshotDto["analysis"]["dailyTotals"]>["scopes"][number]["rows"][number],
): boolean {
  const health = row.dataHealth;
  const countsValid = Number.isInteger(health.expectedMeterIntervalCount)
    && Number.isInteger(health.validIntervalCount)
    && Number.isInteger(health.qualityEventCount)
    && health.expectedMeterIntervalCount >= 0
    && health.validIntervalCount >= 0
    && health.validIntervalCount <= health.expectedMeterIntervalCount
    && health.qualityEventCount >= 0;
  const coverageValid = Number.isFinite(health.coveragePct)
    && health.coveragePct >= 0
    && health.coveragePct <= 100;
  const usageValid = health.status === "unavailable"
    ? row.usageKwh === null
    : row.usageKwh !== null && Number.isFinite(row.usageKwh) && row.usageKwh >= 0;
  return countsValid && coverageValid && usageValid;
}

function formatLocalDate(localDate: string): string {
  return new Intl.DateTimeFormat("en-SG", { day: "2-digit", month: "short", timeZone: "UTC" })
    .format(new Date(`${localDate}T00:00:00.000Z`));
}

function formatLocalWeekday(localDate: string): string {
  return new Intl.DateTimeFormat("en-SG", { weekday: "short", timeZone: "UTC" })
    .format(new Date(`${localDate}T00:00:00.000Z`));
}

function buildLevelComparison(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  overviewUnavailable: boolean,
): NgeeAnnLevelComparisonViewModel {
  const evidence = {
    snapshotId: snapshot.dataSnapshot.id,
    projectReleaseId: snapshot.projectRelease.id,
    meterMappingRevisionId: snapshot.analysis.provenance.meterMappingRevisionId,
    queryIds: [...snapshot.analysis.provenance.queryIds],
  };
  const levelRows = snapshot.analysis.childScopes.filter((scope) => scope.nodeType === "level");
  const hasCompleteContract = levelRows.length > 0
    && levelRows.every((scope) => scope.comparison && scope.dataHealth);

  if (overviewUnavailable || snapshot.context.scopeType !== "project" || !hasCompleteContract) {
    return {
      status: "unavailable",
      decisionQuestion: "Which Level needs attention first?",
      reason: overviewUnavailable
        ? "No trusted intervals support a Level comparison for this Period."
        : snapshot.context.scopeType !== "project"
          ? "Select the Project Scope to compare Level 6 and Level 7."
          : "This published Snapshot does not include the Level comparison and quality contract.",
      rows: [],
      evidence,
    };
  }

  return {
    status: "available",
    decisionQuestion: "Which Level needs attention first?",
    reason: null,
    rows: levelRows.map((scope) => ({
      id: scope.nodeId,
      name: scope.name,
      currentUsageKwh: formatDecimal(scope.usageKwh, 4),
      projectShare: `${formatDecimal(scope.sharePct, 4)}%`,
      projectShareBar: `${Math.min(Math.max(scope.sharePct, 0), 100)}%`,
      previousUsageKwh: formatDecimal(scope.comparison!.usageKwh, 4),
      changeKwh: `${signedDecimal(scope.comparison!.changeKwh, 4)} kWh`,
      changePct: scope.comparison!.changePct === null
        ? "Unavailable"
        : `${scope.comparison!.changePct! >= 0 ? "+" : ""}${formatDecimal(scope.comparison!.changePct!, 4)}%`,
      coverage: `${formatDecimal(scope.dataHealth!.coveragePct, 1)}% coverage`,
      intervals: `${scope.dataHealth!.validIntervalCount.toLocaleString("en-SG")} / ${scope.dataHealth!.expectedMeterIntervalCount.toLocaleString("en-SG")}`,
      qualityEvents: `${scope.dataHealth!.qualityEventCount.toLocaleString("en-SG")} quality events`,
    })),
    evidence,
  };
}

function resolveDataStatus(
  sourceStatus: EnergyProjectAnalysisSnapshotDto["dataQuality"]["status"],
  hasTrustedIntervals: boolean,
): NgeeAnnOverviewDataStatus {
  if (!hasTrustedIntervals || sourceStatus === "unavailable") return "unavailable";
  return sourceStatus === "complete" ? "ready" : "partial";
}

function buildDataStatus(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  status: NgeeAnnOverviewDataStatus,
  latestSeenAt: string | null,
  hasLatestAvailableRange: boolean,
): NgeeAnnOverviewViewModel["dataStatus"] {
  const quality = snapshot.dataQuality;
  const labels = {
    ready: "Ready",
    partial: "Partial data",
    unavailable: "Unavailable",
  } as const;
  const summaries = {
    ready: "Trusted facts cover the selected period.",
    partial: "Results use accepted intervals, but the selected period is incomplete.",
    unavailable: "No trusted intervals are available for the selected period.",
  } as const;
  const recoveries = {
    ready: null,
    partial: "Restore the missing source intervals, materialize the Project again, then refresh this same Period.",
    unavailable: hasLatestAvailableRange
      ? "No trusted intervals cover this Period. Keep it to investigate the gap, or view the latest available data."
      : "Check source Mapping and materialization, then refresh this same Period. The latest complete range is not currently available.",
  } as const;
  return {
    status,
    label: labels[status],
    summary: summaries[status],
    recovery: recoveries[status],
    coverage: `${formatDecimal(quality.coveragePct, 1)}% coverage`,
    intervals: `${quality.validIntervalCount.toLocaleString("en-SG")} / ${quality.expectedMeterIntervalCount.toLocaleString("en-SG")} valid intervals`,
    qualityEvents: `${quality.qualityEventCount.toLocaleString("en-SG")} quality events`,
    lastSeen: latestSeenAt
      ? `Last seen ${formatTimestamp(latestSeenAt, snapshot.context.timezone)}`
      : "Last seen unavailable",
  };
}

function formatDecimal(value: number, maximumFractionDigits: number): string {
  if (!Number.isFinite(value)) return "Unavailable";
  return value.toFixed(maximumFractionDigits).replace(/\.?0+$/u, "");
}

function signedDecimal(value: number, maximumFractionDigits: number): string {
  return `${value >= 0 ? "+" : ""}${formatDecimal(value, maximumFractionDigits)}`;
}

function formatPeriodRange(start: string, endExclusive: string, timezone: string): string {
  const endInclusive = new Date(Date.parse(endExclusive) - 1);
  const formatter = new Intl.DateTimeFormat("en-SG", {
    timeZone: timezone,
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  return `${formatter.format(new Date(start))} - ${formatter.format(endInclusive)}`;
}

function formatTimestamp(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: timezone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatEvidenceRange(from: string, to: string, timezone: string): string {
  return `[${formatTimestamp(from, timezone)}, ${formatTimestamp(to, timezone)})`;
}

function comparisonEvidenceReferences(
  snapshot: EnergyProjectAnalysisSnapshotDto,
): string[] {
  return snapshot.evidence
    .filter((reference) => Array.from(COMPARISON_EVIDENCE_METRIC_IDS)
      .some((metricId) => isMetricOrRevision(reference.metricId, metricId)))
    .map((reference) => reference.id);
}

function isMetricOrRevision(candidate: string, metricId: string): boolean {
  if (candidate === metricId) return true;

  const revisionPrefix = `${metricId}@`;
  if (!candidate.startsWith(revisionPrefix)) return false;

  const revision = candidate.slice(revisionPrefix.length);
  return revision.length > 0 && !revision.includes("@") && !/\s/u.test(revision);
}
