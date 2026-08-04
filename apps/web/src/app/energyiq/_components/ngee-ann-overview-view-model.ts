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
  decisionQuestion: string;
  reason: string | null;
  scopes: Array<{
    id: string;
    name: string;
    limitation: string | null;
    points: Array<{
      id: string;
      localDate: string;
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
    queryIds: ["daily_totals_v1"];
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

function buildEnergyTrend(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  overviewUnavailable: boolean,
): NgeeAnnEnergyTrendViewModel {
  const { analysis, context } = snapshot;
  const dailyTotals = analysis.dailyTotals;
  const evidence: NgeeAnnEnergyTrendViewModel["evidence"] = {
    snapshotId: snapshot.dataSnapshot.id,
    projectReleaseId: snapshot.projectRelease.id,
    meterMappingRevisionId: analysis.provenance.meterMappingRevisionId,
    meterFormulaRevisionId: analysis.provenance.meterFormulaRevisionId,
    metricId: "energy.total_usage_kwh@1",
    period: `[${context.primaryPeriod.start}, ${context.primaryPeriod.endExclusive})`,
    timezone: dailyTotals?.timezone ?? context.timezone,
    unit: "kWh",
    queryIds: ["daily_totals_v1"],
  };
  const unavailable = (reason: string): NgeeAnnEnergyTrendViewModel => ({
    status: "unavailable",
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

function validDailySpine(
  rows: NonNullable<EnergyProjectAnalysisSnapshotDto["analysis"]["dailyTotals"]>["scopes"][number]["rows"],
  period: EnergyProjectAnalysisSnapshotDto["context"]["primaryPeriod"],
): boolean {
  if (rows.length !== 7 || rows[0]?.from !== period.start || rows.at(-1)?.to !== period.endExclusive) {
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
