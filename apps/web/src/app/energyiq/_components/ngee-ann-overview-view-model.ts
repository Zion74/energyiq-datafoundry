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
      levelName: string;
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
  evidence: {
    snapshotId: string;
    projectReleaseId: string;
    meterMappingRevisionId: string;
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

  const topCircuits = analysis.topCircuits.slice(0, 5);
  const circuitContractAvailable = unavailableReason === null
    && topCircuits.length === 5
    && topCircuits.every((circuit) =>
      circuit.includedInOfficialTotal === false
      && Boolean(circuit.scopeId)
      && Boolean(circuit.parentScopeId)
      && levelNames.has(circuit.parentScopeId!)
      && hasComparisonAndHealth(circuit),
    );
  const circuits: NgeeAnnEnergyCompositionViewModel["circuits"] = circuitContractAvailable
    ? {
      status: "available",
      reason: null,
      rows: topCircuits.map((circuit, index) => ({
        rank: index + 1,
        meterNodeId: circuit.meterNodeId,
        name: circuit.name,
        scopeId: circuit.scopeId!,
        parentScopeId: circuit.parentScopeId!,
        levelName: levelNames.get(circuit.parentScopeId!)!,
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
        ?? "This published Snapshot does not explicitly identify five component Circuit Scopes, parents, official-total markers, comparisons and quality.",
      rows: [],
    };

  const designatedTotals = analysis.designatedTotals ?? [];
  const reconciliation = analysis.componentReconciliation;
  const officialMeterIds = new Set(reconciliation?.officialMeterNodeIds ?? []);
  const componentMeterIds = new Set(reconciliation?.componentMeterNodeIds ?? []);
  const accountingContractAvailable = unavailableReason === null
    && designatedTotals.length === 4
    && Boolean(reconciliation)
    && reconciliation!.ratioPct !== null
    && officialMeterIds.size === designatedTotals.length
    && componentMeterIds.size === analysis.topCircuits.length
    && designatedTotals.every((circuit) =>
      circuit.includedInOfficialTotal === true
      && Boolean(circuit.scopeId)
      && Boolean(circuit.parentScopeId)
      && levelNames.has(circuit.parentScopeId!)
      && Boolean(circuit.dataHealth)
      && officialMeterIds.has(circuit.meterNodeId)
      && !componentMeterIds.has(circuit.meterNodeId),
    )
    && topCircuits.every((circuit) =>
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

  return {
    decisionQuestion: "What explains the official Project total?",
    categories,
    circuits,
    accounting,
    evidence,
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
