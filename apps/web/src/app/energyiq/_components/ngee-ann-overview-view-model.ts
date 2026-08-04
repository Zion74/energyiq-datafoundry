import type { EnergyProjectAnalysisSnapshotDto } from "../../../lib/config-api";

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
    evidence: {
      snapshotId: snapshot.dataSnapshot.id,
      projectReleaseId: snapshot.projectRelease.id,
      projectRelease: snapshot.projectRelease.templateRevisionSequence === null
        ? snapshot.projectRelease.id
        : `Revision ${snapshot.projectRelease.templateRevisionSequence}`,
      queryIds: [...analysis.provenance.queryIds],
      references: snapshot.evidence.map((item) => ({
        id: item.id,
        metricId: item.metricId,
        queryIds: [...item.queryIds],
        ...(item.queryReceiptId ? { queryReceiptId: item.queryReceiptId } : {}),
      })),
      importBatchCount: snapshot.dataSnapshot.importBatchIds.length,
      metadataStatus: snapshot.metadata.status,
    },
    latestAvailableRange,
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
