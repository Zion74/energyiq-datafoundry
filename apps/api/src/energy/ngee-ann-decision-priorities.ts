import type { EnergyDailyUsageAnomalies } from "./energy-analysis.js";

type AvailableDailyUsageAnomalies = Extract<
  EnergyDailyUsageAnomalies,
  { status: "available" }
>;
type DailyUsageAnomalyScope = AvailableDailyUsageAnomalies["scopes"][number];
type DailyUsageAnomalyRow = DailyUsageAnomalyScope["rows"][number];

export type NgeeAnnDecisionPriorityEvidencePins =
  AvailableDailyUsageAnomalies["evidencePins"];

export type NgeeAnnDecisionPriorityLimitation = {
  code:
    | "DAILY_USAGE_ANOMALIES_ABSENT"
    | "DAILY_USAGE_ANOMALIES_UNAVAILABLE"
    | "DAILY_USAGE_ANOMALIES_CONTRACT_MISMATCH"
    | "EVIDENCE_PINS_MISMATCH"
    | "ALL_CANDIDATE_DATES_SUPPRESSED"
    | "SOME_CANDIDATE_DATES_SUPPRESSED"
    | "SUPPORTING_EVIDENCE_PARTIAL";
  message: string;
};

export type NgeeAnnDecisionPriority = {
  priorityId: string;
  rank: 1 | 2 | 3;
  source: "daily_usage_anomaly";
  finding: {
    code: "DAILY_USAGE_ABOVE_BASELINE";
    title: string;
    actualKwh: number;
    baselineKwh: number;
    relativePct: number;
  };
  evidence: {
    bundleId: string;
    metricId: "energy.total_usage_kwh@1";
    queryIds: ["time_slot_anomaly_v1"];
    ruleRevisionId: "comparison.daily_usage_above_baseline@1";
    period: {
      from: string;
      to: string;
    };
    occurrence: {
      scopeId: string;
      scopeName: string;
      scopeType: string;
      localDate: string;
      from: string;
      to: string;
    };
    primaryIncidentId: string;
    supportingIncidentIds: string[];
  };
  impact: {
    energy: {
      status: "available";
      deltaKwh: number;
    };
    cost: {
      status: "unavailable";
      reason: {
        code: "INCIDENT_COST_NOT_SUPPORTED_BY_CURRENT_EVIDENCE";
        message: string;
      };
    };
  };
  action: {
    code: "INSPECT_DAILY_USAGE_DRIVERS";
    label: string;
    targetIncidentId: string;
  };
  confidence: {
    status: "complete" | "partial";
    limitation: NgeeAnnDecisionPriorityLimitation | null;
  };
};

export type NgeeAnnDecisionPriorities = {
  status: "available" | "empty" | "partial" | "suppressed" | "unavailable";
  limitation: NgeeAnnDecisionPriorityLimitation | null;
  evidencePins: NgeeAnnDecisionPriorityEvidencePins;
  items: NgeeAnnDecisionPriority[];
};

type AnomalyOccurrence = {
  scope: Omit<DailyUsageAnomalyScope, "rows">;
  row: DailyUsageAnomalyRow;
};

type CompleteTriggeredOccurrence = AnomalyOccurrence & {
  row: DailyUsageAnomalyRow & {
    actualKwh: number;
    baselineKwh: number;
    impactKwh: number;
    relativePct: number;
  };
};

const DAILY_USAGE_RULE_REVISION_ID = "comparison.daily_usage_above_baseline@1" as const;
const DAILY_USAGE_METRIC_ID = "energy.total_usage_kwh@1" as const;
const DAILY_USAGE_QUERY_ID = "time_slot_anomaly_v1" as const;

export const buildNgeeAnnDecisionPriorities = (input: {
  selectedScopeId: string;
  primaryPeriod: {
    start: string;
    endExclusive: string;
  };
  expectedEvidencePins: NgeeAnnDecisionPriorityEvidencePins;
  dailyUsageAnomalies: EnergyDailyUsageAnomalies | undefined;
}): NgeeAnnDecisionPriorities => {
  const unavailable = (
    limitation: NgeeAnnDecisionPriorityLimitation,
  ): NgeeAnnDecisionPriorities => ({
    status: "unavailable",
    limitation,
    evidencePins: input.expectedEvidencePins,
    items: [],
  });

  const source = input.dailyUsageAnomalies;
  if (!source) {
    return unavailable({
      code: "DAILY_USAGE_ANOMALIES_ABSENT",
      message: "Decision priorities are unavailable because the trusted daily anomaly bundle is absent.",
    });
  }
  if (source.status === "unavailable") {
    return unavailable({
      code: "DAILY_USAGE_ANOMALIES_UNAVAILABLE",
      message: source.reason.message,
    });
  }
  if (!sameEvidencePins(source.evidencePins, input.expectedEvidencePins)) {
    return unavailable({
      code: "EVIDENCE_PINS_MISMATCH",
      message: "Decision priorities were withheld because the daily anomaly Evidence pins do not match this Snapshot.",
    });
  }
  if (!validSourceContract(source)) {
    return unavailable({
      code: "DAILY_USAGE_ANOMALIES_CONTRACT_MISMATCH",
      message: "Decision priorities were withheld because the daily anomaly bundle does not match the released rule contract.",
    });
  }

  const occurrences = source.scopes.flatMap<AnomalyOccurrence>((scope) => scope.rows.map((row) => ({
    scope: {
      scopeId: scope.scopeId,
      scopeName: scope.scopeName,
      scopeType: scope.scopeType,
    },
    row,
  })));
  const grouped = new Map<string, AnomalyOccurrence[]>();
  for (const occurrence of occurrences) {
    const key = [occurrence.row.ruleRevisionId, occurrence.row.metricId, occurrence.row.localDate]
      .join(":");
    grouped.set(key, [...(grouped.get(key) ?? []), occurrence]);
  }

  const candidates = [...grouped.values()].flatMap((group) => {
    const triggered = group.filter(isCompleteTriggeredOccurrence);
    if (triggered.length === 0) return [];
    const selectedOccurrence = triggered.find(
      (occurrence) => occurrence.scope.scopeId === input.selectedScopeId,
    );
    const highestImpactLevel = triggered
      .filter((occurrence) => occurrence.scope.scopeType.toLocaleLowerCase() === "level")
      .sort(compareOccurrenceImpact)[0];
    const primary = selectedOccurrence
      ?? highestImpactLevel;
    if (!primary) return [];
    const supporting = group
      .filter((occurrence) => occurrence.scope.scopeId !== primary.scope.scopeId)
      .sort(compareOccurrenceImpact);
    return [{ primary, supporting, group }];
  }).sort((left, right) => compareOccurrenceImpact(left.primary, right.primary));

  const items = candidates.slice(0, 3).map<NgeeAnnDecisionPriority>((candidate, index) => {
    const { primary } = candidate;
    const confidencePartial = candidate.group.some((occurrence) => (
      occurrence.row.outcome === "suppressed"
      || occurrence.row.detailSeries.some((series) => series.status !== "available")
    ));
    return {
      priorityId: [
        "decision-priority",
        source.bundleId,
        source.ruleRevisionId,
        source.metricId,
        primary.row.localDate,
      ].join(":"),
      rank: (index + 1) as 1 | 2 | 3,
      source: "daily_usage_anomaly",
      finding: {
        code: "DAILY_USAGE_ABOVE_BASELINE",
        title: `${primary.scope.scopeName} used ${primary.row.impactKwh} kWh above its comparable-day baseline on ${primary.row.localDate}.`,
        actualKwh: primary.row.actualKwh,
        baselineKwh: primary.row.baselineKwh,
        relativePct: primary.row.relativePct,
      },
      evidence: {
        bundleId: source.bundleId,
        metricId: DAILY_USAGE_METRIC_ID,
        queryIds: [DAILY_USAGE_QUERY_ID],
        ruleRevisionId: DAILY_USAGE_RULE_REVISION_ID,
        period: {
          from: input.primaryPeriod.start,
          to: input.primaryPeriod.endExclusive,
        },
        occurrence: {
          scopeId: primary.scope.scopeId,
          scopeName: primary.scope.scopeName,
          scopeType: primary.scope.scopeType,
          localDate: primary.row.localDate,
          from: primary.row.from,
          to: primary.row.to,
        },
        primaryIncidentId: primary.row.incidentId,
        supportingIncidentIds: candidate.supporting.map((occurrence) => occurrence.row.incidentId),
      },
      impact: {
        energy: {
          status: "available",
          deltaKwh: primary.row.impactKwh,
        },
        cost: {
          status: "unavailable",
          reason: {
            code: "INCIDENT_COST_NOT_SUPPORTED_BY_CURRENT_EVIDENCE",
            message: "The current daily anomaly Evidence does not calculate an incident-level cost delta.",
          },
        },
      },
      action: {
        code: "INSPECT_DAILY_USAGE_DRIVERS",
        label: "Review the hourly and Circuit Evidence for this date before changing schedules or equipment.",
        targetIncidentId: primary.row.incidentId,
      },
      confidence: confidencePartial
        ? {
            status: "partial",
            limitation: {
              code: "SUPPORTING_EVIDENCE_PARTIAL",
              message: "One or more supporting Scope or Circuit series is suppressed, partial or unavailable.",
            },
          }
        : { status: "complete", limitation: null },
    };
  });

  const suppressedCount = occurrences.filter((occurrence) => occurrence.row.outcome === "suppressed").length;
  if (items.length === 0) {
    if (occurrences.length > 0 && suppressedCount === occurrences.length) {
      return {
        status: "suppressed",
        limitation: {
          code: "ALL_CANDIDATE_DATES_SUPPRESSED",
          message: "All candidate dates were suppressed by the released Calendar, coverage, quality or baseline gates.",
        },
        evidencePins: input.expectedEvidencePins,
        items,
      };
    }
    if (suppressedCount > 0) {
      return {
        status: "partial",
        limitation: {
          code: "SOME_CANDIDATE_DATES_SUPPRESSED",
          message: "Some candidate dates were suppressed, so the absence of a priority is not a complete no-exception conclusion.",
        },
        evidencePins: input.expectedEvidencePins,
        items,
      };
    }
    return {
      status: "empty",
      limitation: null,
      evidencePins: input.expectedEvidencePins,
      items,
    };
  }

  if (suppressedCount > 0 || items.some((item) => item.confidence.status === "partial")) {
    return {
      status: "partial",
      limitation: suppressedCount > 0
        ? {
            code: "SOME_CANDIDATE_DATES_SUPPRESSED",
            message: "Some candidate dates were suppressed; available priorities remain limited to eligible Evidence.",
          }
        : {
            code: "SUPPORTING_EVIDENCE_PARTIAL",
            message: "One or more priorities has partial supporting Evidence.",
          },
      evidencePins: input.expectedEvidencePins,
      items,
    };
  }

  return {
    status: "available",
    limitation: null,
    evidencePins: input.expectedEvidencePins,
    items,
  };
};

const validSourceContract = (source: AvailableDailyUsageAnomalies): boolean => (
  source.metricId === DAILY_USAGE_METRIC_ID
  && source.queryId === DAILY_USAGE_QUERY_ID
  && source.ruleRevisionId === DAILY_USAGE_RULE_REVISION_ID
  && source.scopes.every((scope) => scope.rows.every((row) => (
    row.metricId === DAILY_USAGE_METRIC_ID
    && row.queryId === DAILY_USAGE_QUERY_ID
    && row.ruleRevisionId === DAILY_USAGE_RULE_REVISION_ID
    && (row.outcome !== "triggered" || hasCompleteTriggeredValues(row))
  )))
);

const hasCompleteTriggeredValues = (
  row: DailyUsageAnomalyRow,
): row is DailyUsageAnomalyRow & {
  actualKwh: number;
  baselineKwh: number;
  impactKwh: number;
  relativePct: number;
} => row.actualKwh !== null
  && row.baselineKwh !== null
  && row.impactKwh !== null
  && row.relativePct !== null;

const isCompleteTriggeredOccurrence = (
  occurrence: AnomalyOccurrence,
): occurrence is CompleteTriggeredOccurrence => occurrence.row.outcome === "triggered"
  && hasCompleteTriggeredValues(occurrence.row);

const compareOccurrenceImpact = (left: AnomalyOccurrence, right: AnomalyOccurrence): number => (
  (right.row.impactKwh ?? Number.NEGATIVE_INFINITY)
    - (left.row.impactKwh ?? Number.NEGATIVE_INFINITY)
  || right.row.localDate.localeCompare(left.row.localDate)
  || left.scope.scopeId.localeCompare(right.scope.scopeId)
);

const sameEvidencePins = (
  left: NgeeAnnDecisionPriorityEvidencePins,
  right: NgeeAnnDecisionPriorityEvidencePins,
): boolean => left.projectReleaseId === right.projectReleaseId
  && left.dataSnapshotId === right.dataSnapshotId
  && left.hierarchyRevisionId === right.hierarchyRevisionId
  && left.meterMappingRevisionId === right.meterMappingRevisionId
  && left.meterFormulaRevisionId === right.meterFormulaRevisionId
  && left.metricVersion === right.metricVersion
  && left.businessCalendarVersion === right.businessCalendarVersion
  && left.queryIds.length === right.queryIds.length
  && left.queryIds.every((queryId, index) => queryId === right.queryIds[index]);
