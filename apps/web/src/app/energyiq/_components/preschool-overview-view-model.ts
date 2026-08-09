import type { EnergyProjectAnalysisSnapshotDto } from "../../../lib/config-api";

export type PreschoolOverviewCentre = {
  id: string;
  rank: number;
  name: string;
  usageKwh: string;
  usageKwhValue: number;
  sharePct: string;
  sharePctValue: number;
  eui: string | null;
  perPax: string | null;
  cohort: string | null;
  quadrant: "priority" | "eui-intensive" | "people-intensive" | "lower-intensity" | null;
  metadataStatus: "confirmed" | "provisional" | "missing";
  topCircuit: string | null;
};

export type PreschoolDecisionSummaryItem = {
  id: "after-hours" | "efficiency" | "operating" | "planning";
  sectionId: "overall-summary" | "centre-benchmark" | "operating-behaviour" | "appliance-contribution" | "planning-outlook";
  priority: 1 | 2 | 3 | null;
  sectionNumber: 2 | 3 | 4 | 5;
  targetId: "preschool-benchmark-analysis" | "preschool-standby-wastage" | "preschool-operating-hours" | "preschool-june-planning";
  label: string;
  primaryMetric: {
    label: string;
    value: number;
    valueLabel: string;
  };
  supportingMetrics: Array<{ label: string; valueLabel: string }>;
  centreCodes: string[];
  limitation: string;
  evidenceRefs: string[];
};

export type PreschoolBenchmarkDistribution = {
  id: "eui" | "per-pax";
  label: string;
  question: string;
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
      valueLabel: string;
      aboveP75: boolean;
      priority: boolean;
    }>;
  }>;
  ranking: Array<{
    rank: number;
    centreCode: string;
    name: string;
    cohort: string;
    value: number;
    valueLabel: string;
    p75: string;
    p75Value: number;
    aboveP75: boolean;
    priority: boolean;
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
  overallSummary: {
    periodLabel: string;
    metrics: Array<{
      id: "centres" | "energy" | "cost";
      label: string;
      value: string;
      available: boolean;
    }>;
    centreTypes: Array<{
      centreType: string;
      centreCount: number;
      energy: string;
      estimatedCost: string;
      share: string;
    }>;
    total: {
      centreCount: number;
      energy: string;
      estimatedCost: string;
      share: string;
    };
    costAssumption: {
      rate: string;
      label: string;
      sourceUrl: string;
    } | null;
  };
  decisionSummary: {
    items: PreschoolDecisionSummaryItem[];
    detail: string;
  };
  planningOutlook: {
    status: "provisional";
    targetPeriod: string;
    method: string;
    sourceWeeks: Array<{
      label: string;
      usageKwh: number;
      usage: string;
    }>;
    weeklyAverageKwh: number;
    weeklyAverage: string;
    projectedUsage: string;
    projectedRange: string;
    currentPeriodCost: string;
    projectedCost: string;
    projectedCostRange: string;
    tariffRate: string;
    tariffLabel: string;
    tariffSourceUrl: string;
    tariffAppendixUrl: string;
    evidenceLabel: string;
    limitations: string[];
  } | {
    status: "unavailable";
    detail: string;
  };
  liveForecast: {
    status: "unavailable";
    label: "Unavailable";
    detail: string;
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
    priorityCentres: Array<{
      rank: number;
      centreCode: string;
      name: string;
      cohort: string;
      eui: string;
      perPax: string;
    }>;
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
        actionRank: number | null;
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
    hourlyProfile: {
      completeDayCount: number;
      unit: string;
      peakHourLabel: string;
      rows: Array<{
        hour: number;
        label: string;
        operatingKwh: number;
        closedHourKwh: number;
        totalKwh: number;
      }>;
    };
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
    planningRecipeIds: string[];
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
      usageKwhValue: centre.usageKwh,
      sharePct: `${formatNumber(centre.sharePct, 1)}%`,
      sharePctValue: centre.sharePct,
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
  const benchmark = buildPreschoolBenchmarkView(snapshot);
  const periodLabel = formatAnalysisWindowLabel(
    snapshot.context.from,
    snapshot.context.to,
    snapshot.context.timezone,
  );
  const planningReference = snapshot.preschoolOperational?.status === "available"
    && snapshot.preschoolOperational.planningOutlook.status === "provisional"
    ? snapshot.preschoolOperational.planningOutlook
    : null;
  const provisionalRate = planningReference?.tariffReference.beforeGstSgdPerKwh ?? null;
  const estimatedCost = analysis.cost.status === "available"
    ? `${currencySymbol(analysis.cost.currency)}${formatNumber(analysis.cost.amount, 2)}`
    : planningReference
      ? `S$${formatNumber(planningReference.costEstimate.currentPeriodBeforeGstSgd, 2)}`
      : "Unavailable";
  const centreTypeOrder = ["Senior Care Center", "Active Aging Center", "Preschool"];
  const centreTypes = centreTypeOrder.flatMap((centreType) => {
    const rows = centres.filter((centre) => centre.cohort === centreType);
    if (rows.length === 0) return [];
    const usageKwh = rows.reduce((sum, centre) => sum + centre.usageKwhValue, 0);
    return [{
      centreType,
      centreCount: rows.length,
      energy: `${formatNumber(usageKwh, 2)} kWh`,
      estimatedCost: provisionalRate === null
        ? "Unavailable"
        : `S$${formatNumber(usageKwh * provisionalRate, 2)}`,
      share: `${formatNumber((usageKwh / analysis.summary.usageKwh) * 100, 1)}%`,
    }];
  });

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
    overallSummary: {
      periodLabel,
      metrics: [
        {
          id: "centres",
          label: "Total centres",
          value: formatNumber(centres.length, 0),
          available: centres.length > 0,
        },
        {
          id: "energy",
          label: `Total energy · ${periodLabel}`,
          value: `${formatNumber(analysis.summary.usageKwh, 2)} kWh`,
          available: true,
        },
        {
          id: "cost",
          label: `Estimated total cost · ${periodLabel}`,
          value: estimatedCost,
          available: estimatedCost !== "Unavailable",
        },
      ],
      centreTypes,
      total: {
        centreCount: centres.length,
        energy: `${formatNumber(analysis.summary.usageKwh, 2)} kWh`,
        estimatedCost,
        share: analysis.summary.usageKwh > 0 ? "100.0%" : "Unavailable",
      },
      costAssumption: planningReference
        ? {
            rate: `S$${formatNumber(planningReference.tariffReference.beforeGstSgdPerKwh, 4)}/kWh before GST`,
            label: "SP Group Q2 2026 low-tension non-domestic reference",
            sourceUrl: planningReference.tariffReference.sourceUrl,
          }
        : null,
    },
    decisionSummary,
    planningOutlook: snapshot.preschoolOperational?.status === "available"
      && snapshot.preschoolOperational.planningOutlook.status === "provisional"
      ? {
          status: "provisional",
          targetPeriod: "1–30 Jun 2026",
          method: "Average of four complete Monday–Sunday weeks from the accepted May Snapshot.",
          sourceWeeks: snapshot.preschoolOperational.planningOutlook.sourceWeeks.map((week) => ({
            label: `${formatShortDate(week.start)}–${formatShortDate(week.endInclusive)}`,
            usageKwh: week.usageKwh,
            usage: `${formatNumber(week.usageKwh, 0)} kWh`,
          })),
          weeklyAverageKwh: snapshot.preschoolOperational.planningOutlook.weeklyBaseline.averageKwh,
          weeklyAverage: `${formatNumber(snapshot.preschoolOperational.planningOutlook.weeklyBaseline.averageKwh, 0)} kWh/week`,
          projectedUsage: `${formatNumber(snapshot.preschoolOperational.planningOutlook.usageEstimate.projectedKwh, 0)} kWh`,
          projectedRange: `${formatNumber(snapshot.preschoolOperational.planningOutlook.usageEstimate.lowerKwh, 0)}–${formatNumber(snapshot.preschoolOperational.planningOutlook.usageEstimate.upperKwh, 0)} kWh`,
          currentPeriodCost: `S$${formatNumber(snapshot.preschoolOperational.planningOutlook.costEstimate.currentPeriodBeforeGstSgd, 0)}`,
          projectedCost: `S$${formatNumber(snapshot.preschoolOperational.planningOutlook.costEstimate.projectedBeforeGstSgd, 0)}`,
          projectedCostRange: `S$${formatNumber(snapshot.preschoolOperational.planningOutlook.costEstimate.lowerBeforeGstSgd, 0)}–S$${formatNumber(snapshot.preschoolOperational.planningOutlook.costEstimate.upperBeforeGstSgd, 0)}`,
          tariffRate: `${formatNumber(snapshot.preschoolOperational.planningOutlook.tariffReference.beforeGstSgdPerKwh * 100, 2)}¢/kWh before GST`,
          tariffLabel: `${snapshot.preschoolOperational.planningOutlook.tariffReference.sourceName} regulated ${snapshot.preschoolOperational.planningOutlook.tariffReference.supplyClass.toLowerCase()} reference · 1 Apr–30 Jun 2026`,
          tariffSourceUrl: snapshot.preschoolOperational.planningOutlook.tariffReference.sourceUrl,
          tariffAppendixUrl: snapshot.preschoolOperational.planningOutlook.tariffReference.appendixUrl,
          evidenceLabel: `${snapshot.preschoolOperational.planningOutlook.evidence.queryId} · ${snapshot.preschoolOperational.planningOutlook.evidence.recipeId}`,
          limitations: snapshot.preschoolOperational.planningOutlook.limitations,
        }
      : {
          status: "unavailable",
          detail: snapshot.preschoolOperational?.status === "available"
            && snapshot.preschoolOperational.planningOutlook.status === "unavailable"
            ? snapshot.preschoolOperational.planningOutlook.reason.message
            : "June planning baseline is unavailable because the release-pinned May operational projection is unavailable.",
        },
    liveForecast: {
      status: "unavailable",
      label: "Unavailable",
      detail: "A validated live Forecast still requires more history, a published Forecast Recipe and backtesting. The planning baseline above is not an AI forecast.",
    },
    centres,
    normalisation: {
      euiAvailableCount,
      perPaxAvailableCount,
      totalCentreCount: centres.length,
      status: metadataStatus,
    },
    benchmark,
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
          hourlyProfile: {
            completeDayCount: snapshot.preschoolOperational.hourlyProfile.completeDayCount,
            unit: snapshot.preschoolOperational.hourlyProfile.unit,
            peakHourLabel: formatHourRange(snapshot.preschoolOperational.hourlyProfile.rows
              .reduce((peak, row) => row.totalKwh > peak.totalKwh ? row : peak).localHour),
            rows: snapshot.preschoolOperational.hourlyProfile.rows.map((row) => ({
              hour: row.localHour,
              label: formatHourRange(row.localHour),
              operatingKwh: row.operatingKwh,
              closedHourKwh: row.closedHourKwh,
              totalKwh: row.totalKwh,
            })),
          },
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
      planningRecipeIds: snapshot.preschoolOperational?.status === "available"
        && snapshot.preschoolOperational.planningOutlook.status === "provisional"
        ? [snapshot.preschoolOperational.planningOutlook.evidence.recipeId]
        : [],
    },
  };
}

function buildPreschoolBenchmarkView(
  snapshot: EnergyProjectAnalysisSnapshotDto,
): PreschoolOverviewViewModel["benchmark"] {
  const projection = snapshot.preschoolBenchmark;
  if (!projection) {
    return {
      status: "unavailable",
      detail: "The current Snapshot does not contain a server-authoritative benchmark projection. No client-side percentile is inferred.",
    };
  }

  const priorityIndex = new Map(
    projection.priorityCentreCodes.map((centreCode, index) => [centreCode, index]),
  );
  type BenchmarkQuadrant = typeof projection.centres[number]["quadrant"];
  const actionScore = (centre: typeof projection.centres[number], quadrant: BenchmarkQuadrant) => {
    if (quadrant === "priority") return -(priorityIndex.get(centre.centreCode) ?? Number.MAX_SAFE_INTEGER);
    if (quadrant === "eui-intensive") return centre.annualisedEuiKwhPerSqmYear / projection.portfolio.eui.p75;
    if (quadrant === "people-intensive") return centre.mayKwhPerPerson / projection.portfolio.perPax.p75;
    return Math.max(
      centre.annualisedEuiKwhPerSqmYear / projection.portfolio.eui.p75,
      centre.mayKwhPerPerson / projection.portfolio.perPax.p75,
    );
  };
  const sortedQuadrantCodes = (quadrant: BenchmarkQuadrant) => projection.centres
    .filter((centre) => centre.quadrant === quadrant)
    .sort((left, right) => actionScore(right, quadrant) - actionScore(left, quadrant)
      || left.centreCode.localeCompare(right.centreCode))
    .map((centre) => centre.centreCode);
  const priorityCentres = projection.priorityCentreCodes.flatMap((centreCode, index) => {
    const centre = projection.centres.find((candidate) => candidate.centreCode === centreCode);
    if (!centre) return [];
    return [{
      rank: index + 1,
      centreCode,
      name: centre.name,
      cohort: centre.cohort,
      eui: `${formatNumber(centre.annualisedEuiKwhPerSqmYear, 2)} kWh/m²/yr`,
      perPax: `${formatNumber(centre.mayKwhPerPerson, 1)} kWh/person/month`,
    }];
  });
  const scatterPoints = projection.centres
    .map((centre) => ({
      centreCode: centre.centreCode,
      name: centre.name,
      cohort: centre.cohort,
      eui: centre.annualisedEuiKwhPerSqmYear,
      perPax: centre.mayKwhPerPerson,
      quadrant: centre.quadrant,
      priority: centre.priority,
      actionRank: priorityIndex.has(centre.centreCode)
        ? priorityIndex.get(centre.centreCode)! + 1
        : null,
    }))
    .sort((left, right) => Number(left.priority) - Number(right.priority)
      || (right.actionRank ?? 0) - (left.actionRank ?? 0));

  return {
    status: "provisional",
    sampleSize: projection.sampleSize,
    eui: {
      p50: formatNumber(projection.portfolio.eui.p50, 2),
      p75: formatNumber(projection.portfolio.eui.p75, 2),
    },
    perPax: {
      p50: formatNumber(projection.portfolio.perPax.p50, 1),
      p75: formatNumber(projection.portfolio.perPax.p75, 1),
    },
    cohorts: projection.cohorts.map((cohort) => ({
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
      centreCodes: sortedQuadrantCodes(id),
    })),
    priorityCentreCodes: projection.priorityCentreCodes,
    priorityCentres,
    distributions: buildBenchmarkDistributions(projection),
    scatter: {
      euiP75: projection.portfolio.eui.p75,
      perPaxP75: projection.portfolio.perPax.p75,
      points: scatterPoints,
    },
    detail: isCompleteCalendarMonth(
      snapshot.context.from,
      snapshot.context.to,
      snapshot.context.timezone,
    )
      ? "Provisional comparison across the published 30-Centre cohort. EUI is annualised from this complete month; energy per person uses the same month."
      : "Provisional comparison across the published 30-Centre cohort. EUI is annualised from the current window; energy per person is normalised to an average month.",
  };
}

function buildBenchmarkDistributions(
  benchmark: NonNullable<EnergyProjectAnalysisSnapshotDto["preschoolBenchmark"]>,
): PreschoolBenchmarkDistribution[] {
  const cohortDisplayOrder = new Map([
    ["Senior Care Center", 0],
    ["Active Aging Center", 1],
    ["Preschool", 2],
  ]);
  const orderedCohorts = [...benchmark.cohorts].sort((left, right) => (
    (cohortDisplayOrder.get(left.name) ?? Number.MAX_SAFE_INTEGER)
      - (cohortDisplayOrder.get(right.name) ?? Number.MAX_SAFE_INTEGER)
      || left.name.localeCompare(right.name)
  ));
  const definitions = [
    {
      id: "eui",
      label: "Annualised EUI estimate",
      question: "Which Outlets use more energy than peers after adjusting for floor area?",
      unit: "kWh/m²/year",
      digits: 2,
      value: (centre: typeof benchmark.centres[number]) => centre.annualisedEuiKwhPerSqmYear,
      threshold: (cohort: typeof benchmark.cohorts[number]) => cohort.eui,
    },
    {
      id: "per-pax",
      label: "Energy per person",
      question: "Which Outlets use more energy per person than peers of the same Centre type?",
      unit: "kWh/person/month",
      digits: 1,
      value: (centre: typeof benchmark.centres[number]) => centre.mayKwhPerPerson,
      threshold: (cohort: typeof benchmark.cohorts[number]) => cohort.perPax,
    },
  ] as const;

  return definitions.map((definition) => {
    const values = benchmark.centres.map(definition.value);
    const p75Values = benchmark.cohorts.map((cohort) => definition.threshold(cohort).p75);
    const cohortByName = new Map(benchmark.cohorts.map((cohort) => [cohort.name, cohort]));
    const ranking = benchmark.centres.map((centre) => {
      const cohort = cohortByName.get(centre.cohort);
      if (!cohort) throw new Error(`PRESCHOOL_BENCHMARK_COHORT_MISMATCH:${centre.cohort}`);
      const threshold = definition.threshold(cohort);
      const value = definition.value(centre);
      return {
        centreCode: centre.centreCode,
        name: centre.name,
        cohort: centre.cohort,
        value,
        valueLabel: formatNumber(value, definition.digits),
        p75: formatNumber(threshold.p75, definition.digits),
        p75Value: threshold.p75,
        aboveP75: value > threshold.p75,
        priority: centre.priority,
        relativeToP75: threshold.p75 > 0 ? value / threshold.p75 : 0,
      };
    }).sort((left, right) => Number(right.aboveP75) - Number(left.aboveP75)
      || right.relativeToP75 - left.relativeToP75
      || right.value - left.value
      || left.centreCode.localeCompare(right.centreCode));
    return {
      id: definition.id,
      label: definition.label,
      question: definition.question,
      unit: definition.unit,
      axis: {
        min: 0,
        max: Math.max(1, Math.ceil(Math.max(...values, ...p75Values))),
      },
      cohorts: orderedCohorts.map((cohort) => {
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
              valueLabel: formatNumber(definition.value(centre), definition.digits),
              aboveP75: definition.value(centre) > threshold.p75,
              priority: centre.priority,
            }))
            .sort((left, right) => Number(right.aboveP75) - Number(left.aboveP75)
              || right.value - left.value
              || left.centreCode.localeCompare(right.centreCode)),
        };
      }),
      ranking: ranking.map(({ relativeToP75: _relativeToP75, ...row }, index) => ({
        ...row,
        rank: index + 1,
      })),
    };
  });
}

function buildPreschoolDecisionSummary(
  snapshot: EnergyProjectAnalysisSnapshotDto,
): PreschoolOverviewViewModel["decisionSummary"] {
  const signals = snapshot.preschoolDecisionSignals;
  const signalItems = signals?.status === "available"
    ? signals.items.flatMap<PreschoolDecisionSummaryItem>((signal) => {
        const primary = signal.metrics.find((metric) => metric.role === "primary");
        if (!primary) return [];
        const destination = signal.id === "efficiency"
          ? { sectionNumber: 2 as const, targetId: "preschool-benchmark-analysis" as const }
          : signal.id === "after-hours"
            ? { sectionNumber: 3 as const, targetId: "preschool-standby-wastage" as const }
            : { sectionNumber: 4 as const, targetId: "preschool-operating-hours" as const };
        return [{
          id: signal.id,
          sectionId: signal.sectionId,
          priority: signal.priority,
          ...destination,
          label: signal.label,
          primaryMetric: {
            label: primary.label,
            value: primary.value,
            valueLabel: formatDecisionSignalMetric(primary.value, primary.precision, primary.unit),
          },
          supportingMetrics: signal.metrics
            .filter((metric) => metric.role === "supporting")
            .map((metric) => ({
              label: metric.label,
              valueLabel: formatDecisionSignalMetric(metric.value, metric.precision, metric.unit),
            })),
          centreCodes: signal.entities.map((entity) => entity.code),
          limitation: signal.limitations.map((limitation) => limitation.label).join(" "),
          evidenceRefs: signal.evidenceRefs,
        }];
      })
    : [];
  const planning = snapshot.preschoolOperational?.status === "available"
    && snapshot.preschoolOperational.planningOutlook.status === "provisional"
    ? snapshot.preschoolOperational.planningOutlook
    : null;
  const planningItem: PreschoolDecisionSummaryItem[] = planning
    ? [{
        id: "planning",
        sectionId: "planning-outlook",
        priority: null,
        sectionNumber: 5,
        targetId: "preschool-june-planning",
        label: "June planning baseline",
        primaryMetric: {
          label: "Estimated June energy",
          value: planning.usageEstimate.projectedKwh,
          valueLabel: `${formatNumber(planning.usageEstimate.projectedKwh, 0)} kWh`,
        },
        supportingMetrics: [
          {
            label: "Estimated June cost",
            valueLabel: `S$${formatNumber(planning.costEstimate.projectedBeforeGstSgd, 0)}`,
          },
          {
            label: "Source window",
            valueLabel: `${planning.sourceWeeks.length} complete weeks`,
          },
        ],
        centreCodes: [],
        limitation: planning.limitations.join(" "),
        evidenceRefs: [planning.evidence.queryId, planning.evidence.recipeId],
      }]
    : [];
  const items = [...signalItems, ...planningItem]
    .sort((left, right) => left.sectionNumber - right.sectionNumber);

  return {
    items,
    detail: items.length > 0
      ? "Snapshot-bound findings for Sections 2–5. AI interpretation is shown after this structured summary and beside the relevant analysis section."
      : signals?.reason?.message
        ?? "Verified decision signals and the June planning baseline are unavailable for this Snapshot.",
  };
}

function formatDecisionSignalMetric(value: number, precision: number, unit: "kWh" | "%" | "count"): string {
  const formatted = formatNumber(value, precision);
  if (unit === "%") return `${formatted}%`;
  if (unit === "kWh") return `${formatted} kWh`;
  return formatted;
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

function formatMonthYear(from: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-SG", {
    month: "long",
    year: "numeric",
    timeZone,
  }).format(new Date(from));
}

function formatAnalysisWindowLabel(from: string, toExclusive: string, timeZone: string): string {
  return isCompleteCalendarMonth(from, toExclusive, timeZone)
    ? formatMonthYear(from, timeZone)
    : formatPeriod(from, toExclusive, timeZone);
}

function isCompleteCalendarMonth(from: string, toExclusive: string, timeZone: string): boolean {
  const start = localDateParts(new Date(from), timeZone);
  const end = localDateParts(new Date(toExclusive), timeZone);
  if (start.day !== 1 || end.day !== 1) return false;
  return end.year === start.year
    ? end.month === start.month + 1
    : start.month === 12 && end.year === start.year + 1 && end.month === 1;
}

function localDateParts(value: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-SG", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone,
  }).formatToParts(value);
  const numberPart = (type: "year" | "month" | "day") => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: numberPart("year"),
    month: numberPart("month"),
    day: numberPart("day"),
  };
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
