import type { EnergyProjectAnalysisSnapshotDto } from "../../../lib/config-api";

export type PreschoolOverviewCentre = {
  id: string;
  rank: number;
  name: string;
  usageKwh: string;
  sharePct: string;
  eui: string | null;
  perPax: string | null;
  cohort: string | null;
  quadrant: "priority" | "eui-intensive" | "people-intensive" | "lower-intensity" | null;
  metadataStatus: "confirmed" | "provisional" | "missing";
  topCircuit: string | null;
};

export type PreschoolDecisionSummaryItem = {
  id: "after-hours" | "efficiency" | "operating";
  priority: 1 | 2 | 3;
  label: string;
  finding: string;
  signal: {
    label: string;
    value: number;
    max: number;
    valueLabel: string;
    referenceLabel: string;
  };
  what: string;
  why: string;
  action: string;
  ifActed: string;
  ifIgnored: string;
  verification: string;
  limitation: string;
  evidenceLabel: string;
};

export type PreschoolBenchmarkDistribution = {
  id: "eui" | "per-pax";
  label: string;
  unit: string;
  axis: { min: 0; max: number };
  cohorts: Array<{
    name: string;
    sampleSize: number;
    p50: string;
    p75: string;
    p50Value: number;
    p75Value: number;
    points: Array<{
      centreCode: string;
      name: string;
      value: number;
      aboveP75: boolean;
    }>;
  }>;
};

export type PreschoolOverviewViewModel = {
  context: {
    projectName: string;
    scopeName: string;
    period: string;
    timezone: string;
  };
  dataStatus: {
    status: "complete" | "partial" | "unavailable";
    label: string;
    coverage: string;
    intervals: string;
    qualityEvents: string;
  };
  highlights: Array<{
    id: "energy" | "daily" | "centres" | "off-hours" | "cost";
    label: string;
    value: string;
    detail: string;
    available: boolean;
  }>;
  decisionSummary: {
    items: PreschoolDecisionSummaryItem[];
    detail: string;
  };
  forecastReadiness: {
    demo: {
      status: "reference-only";
      label: "Reference demo only — not published";
      detail: string;
    };
    live: {
      status: "unavailable";
      label: "Unavailable";
      detail: string;
    };
  };
  centres: PreschoolOverviewCentre[];
  normalisation: {
    euiAvailableCount: number;
    perPaxAvailableCount: number;
    totalCentreCount: number;
    status: "confirmed" | "provisional" | "missing";
  };
  benchmark: {
    status: "provisional";
    sampleSize: number;
    eui: { p50: string; p75: string };
    perPax: { p50: string; p75: string };
    cohorts: Array<{
      name: string;
      sampleSize: number;
      euiP50: string;
      euiP75: string;
      perPaxP50: string;
      perPaxP75: string;
    }>;
    quadrants: Array<{
      id: "priority" | "eui-intensive" | "people-intensive" | "lower-intensity";
      label: string;
      centreCodes: string[];
    }>;
    priorityCentreCodes: string[];
    distributions: PreschoolBenchmarkDistribution[];
    scatter: {
      euiP75: number;
      perPaxP75: number;
      points: Array<{
        centreCode: string;
        name: string;
        cohort: string;
        eui: number;
        perPax: number;
        quadrant: "priority" | "eui-intensive" | "people-intensive" | "lower-intensity";
        priority: boolean;
      }>;
    };
    detail: string;
  } | {
    status: "unavailable";
    detail: string;
  };
  appliances: {
    status: "available";
    totalEnergy: string;
    rows: Array<{
      name: string;
      applianceGroup: string;
      usageKwh: number;
      energy: string;
      sharePct: number;
      share: string;
      centreCount: number;
      relativeToTopPct: number;
    }>;
    detail: string;
  } | {
    status: "unavailable";
    detail: string;
  };
  operational: {
    status: "available";
    standby: {
      energy: string;
      share: string;
      spikeCount: number;
      centreCount: number;
      centres: PreschoolOperationalCentre[];
    };
    operating: {
      energy: string;
      spikeCount: number;
      centreCount: number;
      centres: PreschoolOperationalCentre[];
    };
    sop: {
      label: "Provisional after-hours SOP signal";
      detail: string;
      breachingCentreCodes: string[];
      centres: Array<{
        centreCode: string;
        name: string;
        centreType: string | null;
        standbySpikeCount: number;
        score: string;
      }>;
    };
    calendarVersion: string;
    threshold: string;
  } | {
    status: "unavailable";
    detail: string;
  };
  evidence: {
    snapshotId: string;
    projectReleaseId: string;
    queryIds: string[];
    referenceCount: number;
    importBatchCount: number;
    benchmarkRecipeIds: string[];
    applianceRecipeIds: string[];
    operationalRecipeIds: string[];
  };
};

export type PreschoolOperationalCentre = {
  centreCode: string;
  name: string;
  centreType: string | null;
  spikeCount: number;
  worst: {
    when: string;
    dayType: "Weekday" | "Weekend" | "Calendar exception" | "Unavailable";
    usage: string;
    baseline: string;
    variance: string;
    leadingCircuit: string;
  };
};

export function buildPreschoolOverviewViewModel(
  snapshot: EnergyProjectAnalysisSnapshotDto,
): PreschoolOverviewViewModel {
  if (snapshot.renderer.key !== "preschool-overview") {
    throw new Error("PRESCHOOL_OVERVIEW_RENDERER_MISMATCH");
  }

  const { analysis } = snapshot;
  const benchmarkCentreByScopeId = new Map(
    snapshot.preschoolBenchmark?.centres.map((centre) => [centre.scopeId, centre]) ?? [],
  );
  const centres = analysis.childScopes.map((centre, index) => {
    const benchmarkCentre = benchmarkCentreByScopeId.get(centre.nodeId);
    return {
      id: centre.nodeId,
      rank: index + 1,
      name: centre.name,
      usageKwh: formatNumber(centre.usageKwh, 2),
      sharePct: `${formatNumber(centre.sharePct, 1)}%`,
      eui: benchmarkCentre
        ? `${formatNumber(benchmarkCentre.annualisedEuiKwhPerSqmYear, 2)} kWh/m²/yr`
        : null,
      perPax: benchmarkCentre
        ? `${formatNumber(benchmarkCentre.mayKwhPerPerson, 1)} kWh/person`
        : null,
      cohort: benchmarkCentre?.cohort ?? null,
      quadrant: benchmarkCentre?.quadrant ?? null,
      metadataStatus: centre.metadata.status,
      topCircuit: toCustomerCircuitName(centre.nodeId, centre.topCircuitName),
    } satisfies PreschoolOverviewCentre;
  });
  const euiAvailableCount = centres.filter((centre) => centre.eui !== null).length;
  const perPaxAvailableCount = centres.filter((centre) => centre.perPax !== null).length;
  const metadataStatus = euiAvailableCount === 0 && perPaxAvailableCount === 0
    ? "missing"
    : centres.some((centre) => centre.metadataStatus === "provisional")
      ? "provisional"
      : "confirmed";
  const queryIds = [...new Set(snapshot.evidence.flatMap((item) => item.queryIds))];
  const decisionSummary = buildPreschoolDecisionSummary(snapshot);

  return {
    context: {
      projectName: snapshot.context.projectName,
      scopeName: snapshot.context.scopeName,
      period: formatPeriod(snapshot.context.from, snapshot.context.to, snapshot.context.timezone),
      timezone: snapshot.context.timezone,
    },
    dataStatus: {
      status: snapshot.dataQuality.status,
      label: snapshot.dataQuality.status === "complete"
        ? "Complete data"
        : snapshot.dataQuality.status === "partial"
          ? "Partial data"
          : "Data unavailable",
      coverage: `${formatNumber(snapshot.dataQuality.coveragePct, 1)}% coverage`,
      intervals: `${formatNumber(snapshot.dataQuality.validIntervalCount, 0)} / ${formatNumber(snapshot.dataQuality.expectedMeterIntervalCount, 0)} intervals`,
      qualityEvents: `${formatNumber(snapshot.dataQuality.qualityEventCount, 0)} quality events`,
    },
    highlights: [
      {
        id: "energy",
        label: "Portfolio energy",
        value: `${formatNumber(analysis.summary.usageKwh, 2)} kWh`,
        detail: "Published Portfolio total for this Snapshot.",
        available: true,
      },
      {
        id: "daily",
        label: "Daily average",
        value: `${formatNumber(analysis.summary.averageDailyUsageKwh, 2)} kWh/day`,
        detail: "Average across the selected reporting window.",
        available: true,
      },
      {
        id: "centres",
        label: "Centres compared",
        value: formatNumber(centres.length, 0),
        detail: "Centre rows returned by the authoritative Project analysis.",
        available: centres.length > 0,
      },
      analysis.offHours.status === "available"
        ? {
            id: "off-hours",
            label: "Standby / off-hours",
            value: `${formatNumber(analysis.offHours.sharePct, 1)}%`,
            detail: `${formatNumber(analysis.offHours.standbyKwh, 2)} kWh outside published operating hours.`,
            available: true,
          }
        : {
            id: "off-hours",
            label: "Standby / off-hours",
            value: "Unavailable",
            detail: analysis.offHours.reason.message,
            available: false,
          },
      analysis.cost.status === "available"
        ? {
            id: "cost",
            label: "Estimated cost",
            value: `${currencySymbol(analysis.cost.currency)}${formatNumber(analysis.cost.amount, 2)}`,
            detail: `Tariff ${analysis.cost.tariffScheduleVersion}.`,
            available: true,
          }
        : {
            id: "cost",
            label: "Estimated cost",
            value: "Unavailable",
            detail: analysis.cost.reason.message,
            available: false,
        },
    ],
    decisionSummary,
    forecastReadiness: {
      demo: {
        status: "reference-only",
        label: "Reference demo only — not published",
        detail: "Reference demo inputs are outside the current published Snapshot and Release, so no demo value, chart or cost is rendered here.",
      },
      live: {
        status: "unavailable",
        label: "Unavailable",
        detail: "Live Forecast requires metered June actuals, a published Forecast Recipe, sufficient complete history and backtesting. No forecast value or cost is shown.",
      },
    },
    centres,
    normalisation: {
      euiAvailableCount,
      perPaxAvailableCount,
      totalCentreCount: centres.length,
      status: metadataStatus,
    },
    benchmark: snapshot.preschoolBenchmark
      ? {
          status: "provisional",
          sampleSize: snapshot.preschoolBenchmark.sampleSize,
          eui: {
            p50: formatNumber(snapshot.preschoolBenchmark.portfolio.eui.p50, 2),
            p75: formatNumber(snapshot.preschoolBenchmark.portfolio.eui.p75, 2),
          },
          perPax: {
            p50: formatNumber(snapshot.preschoolBenchmark.portfolio.perPax.p50, 1),
            p75: formatNumber(snapshot.preschoolBenchmark.portfolio.perPax.p75, 1),
          },
          cohorts: snapshot.preschoolBenchmark.cohorts.map((cohort) => ({
            name: cohort.name,
            sampleSize: cohort.sampleSize,
            euiP50: formatNumber(cohort.eui.p50, 2),
            euiP75: formatNumber(cohort.eui.p75, 2),
            perPaxP50: formatNumber(cohort.perPax.p50, 1),
            perPaxP75: formatNumber(cohort.perPax.p75, 1),
          })),
          quadrants: ([
            ["priority", "Priority"],
            ["eui-intensive", "High EUI"],
            ["people-intensive", "High per-pax"],
            ["lower-intensity", "Lower intensity"],
          ] as const).map(([id, label]) => ({
            id,
            label,
            centreCodes: snapshot.preschoolBenchmark!.centres
              .filter((centre) => centre.quadrant === id)
              .map((centre) => centre.centreCode),
          })),
          priorityCentreCodes: snapshot.preschoolBenchmark.priorityCentreCodes,
          distributions: buildBenchmarkDistributions(snapshot.preschoolBenchmark),
          scatter: {
            euiP75: snapshot.preschoolBenchmark.portfolio.eui.p75,
            perPaxP75: snapshot.preschoolBenchmark.portfolio.perPax.p75,
            points: snapshot.preschoolBenchmark.centres.map((centre) => ({
              centreCode: centre.centreCode,
              name: centre.name,
              cohort: centre.cohort,
              eui: centre.annualisedEuiKwhPerSqmYear,
              perPax: centre.mayKwhPerPerson,
              quadrant: centre.quadrant,
              priority: centre.priority,
            })),
          },
          detail: "Provisional May benchmark from the published 30-Centre cohort. EUI is annualised ×12; per-pax is May usage.",
        }
      : {
          status: "unavailable",
          detail: "The current Snapshot does not contain the published May benchmark projection. No client-side percentile is inferred.",
        },
    appliances: snapshot.preschoolAppliances?.status === "available"
      ? {
          status: "available",
          totalEnergy: `${formatNumber(snapshot.preschoolAppliances.totalKwh, 2)} kWh`,
          rows: snapshot.preschoolAppliances.appliances.map((appliance, _index, rows) => ({
            name: appliance.name,
            applianceGroup: appliance.applianceGroup,
            usageKwh: appliance.usageKwh,
            energy: `${formatNumber(appliance.usageKwh, 2)} kWh`,
            sharePct: appliance.sharePct,
            share: `${formatNumber(appliance.sharePct, 1)}%`,
            centreCount: appliance.centreCount,
            relativeToTopPct: rows[0]?.usageKwh
              ? (appliance.usageKwh / rows[0].usageKwh) * 100
              : 0,
          })),
          detail: "Customer Appliance names are project-specific aliases for published Circuit labels; the nine rows reconcile to the Portfolio total.",
        }
      : {
          status: "unavailable",
          detail: snapshot.preschoolAppliances?.reason.message
            ?? "The current Snapshot does not contain a server-authoritative Appliance ranking.",
        },
    operational: snapshot.preschoolOperational?.status === "available"
      ? {
          status: "available",
          standby: {
            energy: `${formatNumber(snapshot.preschoolOperational.energy.standbyKwh, 2)} kWh`,
            share: `${formatNumber(snapshot.preschoolOperational.energy.standbySharePct, 1)}%`,
            spikeCount: snapshot.preschoolOperational.spikes.standby.count,
            centreCount: snapshot.preschoolOperational.spikes.standby.centreCount,
            centres: snapshot.preschoolOperational.spikes.standby.centres.map(toOperationalCentre),
          },
          operating: {
            energy: `${formatNumber(snapshot.preschoolOperational.energy.operatingKwh, 2)} kWh`,
            spikeCount: snapshot.preschoolOperational.spikes.operating.count,
            centreCount: snapshot.preschoolOperational.spikes.operating.centreCount,
            centres: snapshot.preschoolOperational.spikes.operating.centres.map(toOperationalCentre),
          },
          sop: {
            label: snapshot.preschoolOperational.sop.label,
            detail: "Exploratory signal only: each +50% standby hour-slot Spike deducts one point from 100. Confirm the operating SOP before using this as compliance evidence.",
            breachingCentreCodes: snapshot.preschoolOperational.sop.breachingCentreCodes,
            centres: snapshot.preschoolOperational.sop.centres
              .filter((centre) => centre.standbySpikeCount > 0)
              .map((centre) => ({
                centreCode: centre.centreCode,
                name: centre.name,
                centreType: centre.centreType,
                standbySpikeCount: centre.standbySpikeCount,
                score: formatNumber(centre.score, 0),
              })),
          },
          calendarVersion: snapshot.preschoolOperational.evidence.businessCalendarVersion,
          threshold: `>${snapshot.preschoolOperational.contract.spikeThresholdPct}% above same Centre and hour-slot mean`,
        }
      : {
          status: "unavailable",
          detail: snapshot.preschoolOperational?.reason.message
            ?? "The current Snapshot does not contain release-pinned Calendar and Centre-hour Evidence for operational behaviour.",
        },
    evidence: {
      snapshotId: snapshot.dataSnapshot.id,
      projectReleaseId: snapshot.projectRelease.id,
      queryIds,
      referenceCount: snapshot.evidence.length,
      importBatchCount: snapshot.dataSnapshot.importBatchIds.length,
      benchmarkRecipeIds: snapshot.preschoolBenchmark?.evidence.projectionRecipeIds ?? [],
      applianceRecipeIds: snapshot.preschoolAppliances?.status === "available"
        ? [snapshot.preschoolAppliances.evidence.projectionRecipeId]
        : [],
      operationalRecipeIds: snapshot.preschoolOperational?.status === "available"
        ? snapshot.preschoolOperational.evidence.projectionRecipeIds
        : [],
    },
  };
}

function buildBenchmarkDistributions(
  benchmark: NonNullable<EnergyProjectAnalysisSnapshotDto["preschoolBenchmark"]>,
): PreschoolBenchmarkDistribution[] {
  const definitions = [
    {
      id: "eui",
      label: "Annualised May EUI estimate",
      unit: "kWh/m²/year",
      digits: 2,
      value: (centre: typeof benchmark.centres[number]) => centre.annualisedEuiKwhPerSqmYear,
      threshold: (cohort: typeof benchmark.cohorts[number]) => cohort.eui,
    },
    {
      id: "per-pax",
      label: "May energy per person",
      unit: "kWh/person",
      digits: 1,
      value: (centre: typeof benchmark.centres[number]) => centre.mayKwhPerPerson,
      threshold: (cohort: typeof benchmark.cohorts[number]) => cohort.perPax,
    },
  ] as const;

  return definitions.map((definition) => {
    const values = benchmark.centres.map(definition.value);
    const p75Values = benchmark.cohorts.map((cohort) => definition.threshold(cohort).p75);
    return {
      id: definition.id,
      label: definition.label,
      unit: definition.unit,
      axis: {
        min: 0,
        max: Math.max(1, Math.ceil(Math.max(...values, ...p75Values))),
      },
      cohorts: benchmark.cohorts.map((cohort) => {
        const threshold = definition.threshold(cohort);
        return {
          name: cohort.name,
          sampleSize: cohort.sampleSize,
          p50: formatNumber(threshold.p50, definition.digits),
          p75: formatNumber(threshold.p75, definition.digits),
          p50Value: threshold.p50,
          p75Value: threshold.p75,
          points: benchmark.centres
            .filter((centre) => centre.cohort === cohort.name)
            .map((centre) => ({
              centreCode: centre.centreCode,
              name: centre.name,
              value: definition.value(centre),
              aboveP75: definition.value(centre) > threshold.p75,
            })),
        };
      }),
    };
  });
}

function buildPreschoolDecisionSummary(
  snapshot: EnergyProjectAnalysisSnapshotDto,
): PreschoolOverviewViewModel["decisionSummary"] {
  if (snapshot.dataQuality.status !== "complete") {
    return {
      items: [],
      detail: "Priority findings and actions are withheld because this Snapshot is not complete.",
    };
  }

  const candidates: Array<Omit<PreschoolDecisionSummaryItem, "priority">> = [];
  const operational = snapshot.preschoolOperational?.status === "available"
    ? snapshot.preschoolOperational
    : null;
  if (
    operational
    && operational.spikes.standby.count > 0
    && operational.sop.breachingCentreCodes.length > 0
  ) {
    candidates.push({
      id: "after-hours",
      label: "After-hours energy",
      finding: `${operational.sop.breachingCentreCodes.join(" · ")} need after-hours checks first.`,
      signal: {
        label: "Outside published hours",
        value: operational.energy.standbySharePct,
        max: 100,
        valueLabel: `${formatNumber(operational.energy.standbySharePct, 1)}%`,
        referenceLabel: "of Portfolio energy",
      },
      what: `${formatNumber(operational.energy.standbyKwh, 2)} kWh fell outside published hours, with ${formatNumber(operational.spikes.standby.count, 0)} Spikes across ${formatNumber(operational.spikes.standby.centreCount, 0)} Centres.`,
      why: "Closed-hour load can persist without appearing in operating-hour checks.",
      action: `Check the worst time and leading Appliance at ${operational.sop.breachingCentreCodes.join(" · ")}; confirm the Calendar and local SOP.`,
      ifActed: "The review can separate Calendar errors, legitimate activity and controllable load.",
      ifIgnored: "The same closed-hour load may recur; avoidable savings are not yet proven.",
      verification: "Next complete period: compare standby kWh and same-hour Spike count.",
      limitation: "Meter data cannot confirm why equipment was on; Calendar and site checks are required.",
      evidenceLabel: operational.evidence.projectionRecipeIds.join(" · "),
    });
  }

  const benchmark = snapshot.preschoolBenchmark;
  if (benchmark && benchmark.priorityCentreCodes.length > 0 && benchmark.sampleSize > 0) {
    candidates.push({
      id: "efficiency",
      label: "Efficiency review",
      finding: `${benchmark.priorityCentreCodes.join(" · ")} need metadata and Appliance review first.`,
      signal: {
        label: "Above both Portfolio P75 lines",
        value: benchmark.priorityCentreCodes.length,
        max: benchmark.sampleSize,
        valueLabel: `${benchmark.priorityCentreCodes.length} / ${benchmark.sampleSize}`,
        referenceLabel: "Centres",
      },
      what: "Each sits above Portfolio P75 for both annualised EUI and May energy per person.",
      why: "Two normalisations point to the same Centres, reducing size-only bias.",
      action: "Confirm area and headcount, then compare cohort position and leading Appliances.",
      ifActed: "The review can separate building intensity, occupancy and Appliance priorities.",
      ifIgnored: "Priorities remain based on provisional metadata and may misclassify efficiency.",
      verification: "Next complete period: compare the same metrics against the same cohort after metadata confirmation and action.",
      limitation: "Area and headcount are provisional; this is a review priority, not confirmed inefficiency.",
      evidenceLabel: benchmark.evidence.projectionRecipeIds.join(" · "),
    });
  }

  if (operational && operational.spikes.operating.count > 0 && snapshot.analysis.childScopes.length > 0) {
    candidates.push({
      id: "operating",
      label: "Operating exceptions",
      finding: `${formatNumber(operational.spikes.operating.centreCount, 0)} Centres need operating-hour event review.`,
      signal: {
        label: "Centres with operating Spikes",
        value: operational.spikes.operating.centreCount,
        max: snapshot.analysis.childScopes.length,
        valueLabel: `${operational.spikes.operating.centreCount} / ${snapshot.analysis.childScopes.length}`,
        referenceLabel: "Portfolio Centres",
      },
      what: `${formatNumber(operational.spikes.operating.count, 0)} events exceeded each Centre's same-hour baseline during operating hours.`,
      why: "Repeated unexplained events justify checking for overrides or process drift; scheduled activity may also explain them.",
      action: "Start with the highest-variance events; record the operator explanation, time, baseline and leading Appliance.",
      ifActed: "Explained events can be closed; repeated unexplained events become targeted action candidates.",
      ifIgnored: "Recurring exceptions remain mixed with legitimate activity, weakening future priorities.",
      verification: "Next complete period: retain only repeated events without an operational explanation.",
      limitation: "Meter data alone cannot distinguish an override from legitimate activity.",
      evidenceLabel: operational.evidence.projectionRecipeIds[0],
    });
  }

  const items = candidates.slice(0, 3).map((item, index) => ({
    ...item,
    priority: (index + 1) as 1 | 2 | 3,
  }));

  return {
    items,
    detail: items.length > 0
      ? "Only themes supported by this complete Snapshot are shown."
      : "No Evidence-backed priority is shown because the current Snapshot has no available Benchmark or Operational exception projection.",
  };
}

function toOperationalCentre(
  centre: Extract<NonNullable<EnergyProjectAnalysisSnapshotDto["preschoolOperational"]>, { status: "available" }>["spikes"]["standby"]["centres"][number],
): PreschoolOperationalCentre {
  return {
    centreCode: centre.centreCode,
    name: centre.name,
    centreType: centre.centreType,
    spikeCount: centre.spikeCount,
    worst: {
      when: `${formatShortDate(centre.worstSpike.localDate)} · ${formatHourRange(centre.worstSpike.localHour)}`,
      dayType: operationalDayTypeLabel(centre.worstSpike.dayType),
      usage: `${formatNumber(centre.worstSpike.usageKwh, 3)} kWh`,
      baseline: `${formatNumber(centre.worstSpike.baselineKwh, 3)} kWh baseline`,
      variance: `+${formatNumber(centre.worstSpike.variancePct, 1)}%`,
      leadingCircuit: `${toCustomerCircuitName(centre.scopeId, centre.worstSpike.leadingCircuitName) ?? "Unavailable"} · ${formatNumber(centre.worstSpike.leadingCircuitSharePct, 0)}%`,
    },
  };
}

function operationalDayTypeLabel(
  dayType: "weekday" | "weekend" | "calendar_exception" | undefined,
): PreschoolOperationalCentre["worst"]["dayType"] {
  if (dayType === "calendar_exception") return "Calendar exception";
  if (dayType === "weekend") return "Weekend";
  return dayType === "weekday" ? "Weekday" : "Unavailable";
}

function formatShortDate(localDate: string): string {
  return new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(`${localDate}T00:00:00.000Z`));
}

function formatHourRange(localHour: number): string {
  const from = String(localHour).padStart(2, "0");
  const to = String((localHour + 1) % 24).padStart(2, "0");
  return `${from}:00–${to}:00`;
}

function formatPeriod(from: string, toExclusive: string, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  });
  return `${formatter.format(new Date(from))}–${formatter.format(new Date(Date.parse(toExclusive) - 1))}`;
}

function formatNumber(value: number, maximumFractionDigits: number): string {
  return value.toLocaleString("en-SG", {
    minimumFractionDigits: maximumFractionDigits,
    maximumFractionDigits,
  });
}

function currencySymbol(currency: string): string {
  return currency === "SGD" ? "S$" : `${currency} `;
}

function toCustomerCircuitName(nodeId: string, value: string | null | undefined): string | null {
  if (!value) return null;
  const internalPrefix = `${nodeId}:`;
  if (value.startsWith(internalPrefix)) return value.slice(internalPrefix.length);
  const importedRoute = /^preschool-centre-[^:]+:(.+)$/.exec(value);
  return importedRoute?.[1] ?? value;
}
