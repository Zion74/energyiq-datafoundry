import type {
  EnergyProjectAnalysisMetadataDto,
  EnergyProjectAnalysisSnapshotDto,
} from "../../../lib/config-api";

export function ngeeAnnGoldenSnapshot(input: {
  dataStatus?: "complete" | "partial" | "unavailable";
  coveragePct?: number;
  validIntervalCount?: number;
  expectedMeterIntervalCount?: number;
  lastSeenAt?: string | null;
  costAvailable?: boolean;
} = {}): EnergyProjectAnalysisSnapshotDto {
  const dataStatus = input.dataStatus ?? "complete";
  const coveragePct = input.coveragePct ?? (dataStatus === "complete" ? 100 : dataStatus === "partial" ? 50 : 0);
  const expectedMeterIntervalCount = input.expectedMeterIntervalCount ?? 2_688;
  const validIntervalCount = input.validIntervalCount
    ?? (dataStatus === "complete" ? expectedMeterIntervalCount : dataStatus === "partial" ? 1_344 : 0);
  const lastSeenAt = input.lastSeenAt === undefined ? "2026-06-17T15:45:00.000Z" : input.lastSeenAt;
  const metadata = missingMetadata();
  const queryIds = [
    "scope_summary_v1",
    "hourly_profile_v1",
    "meter_breakdown_v1",
    "operational_policy_scope_intervals_v1",
    "operational_policy_meter_intervals_v1",
  ] as const;

  const analysis: EnergyProjectAnalysisSnapshotDto["analysis"] = {
    context: {
      userId: "user-1",
      workspaceId: "workspace-1",
      projectId: "ngee-ann-polytechnic",
      projectName: "Ngee Ann Polytechnic",
      scopeId: "project",
      scopeName: "Ngee Ann Polytechnic",
      scopeType: "project",
      resource: "electricity",
      timezone: "Asia/Singapore",
      from: "2026-06-09T16:00:00.000Z",
      to: "2026-06-16T16:00:00.000Z",
      endExclusive: true,
      period: "Custom",
      hierarchyRevisionId: "hierarchy-v6",
      meterMappingRevisionId: "mapping-v1",
      meterFormulaRevisionId: "formula-v1",
      dataSnapshotId: "snapshot-ngee-ann-golden",
      metricVersion: "metric-v1",
      businessCalendarVersion: "calendar-v1",
      tariffScheduleVersion: "tariff-v1",
      resolvedAt: "2026-08-04T00:00:00.000Z",
    },
    summary: {
      usageKwh: 1531.168324,
      averageDailyUsageKwh: 218.738332,
      peakKw: 20.673108,
      peakAt: "2026-06-16T06:00:00.000Z",
      validIntervalCount,
      qualityEventCount: 0,
    },
    hourlyProfile: [],
    comparison: {
      from: "2026-06-02T16:00:00.000Z",
      to: "2026-06-09T16:00:00.000Z",
      usageKwh: 1211.6773,
      changeKwh: 319.4911,
      changePct: 26.3677,
    },
    categories: [],
    childScopes: [],
    circuits: [],
    topCircuits: [],
    virtualMeters: [],
    offHours: {
      status: "available",
      operatingKwh: 1_200,
      standbyKwh: 331.168324,
      usageKwh: 1531.168324,
      sharePct: 21.63,
      timezone: "Asia/Singapore",
      businessCalendarVersion: "calendar-v1",
    },
    cost: input.costAvailable === false
      ? {
        status: "unavailable",
        reason: { code: "TARIFF_VERSION_MISSING", message: "No effective Tariff covers the selected period." },
        tariffScheduleVersion: "tariff-v1",
      }
      : {
        status: "available",
        amount: 489.973864,
        currency: "SGD",
        tariffScheduleVersion: "tariff-v1",
        allocations: [{
          from: "2026-06-09T16:00:00.000Z",
          to: "2026-06-16T16:00:00.000Z",
          ratePerKwh: 0.32,
          usageKwh: 1531.168324,
          cost: 489.973864,
        }],
      },
    dataHealth: {
      status: dataStatus,
      coveragePct,
      expectedMeterIntervalCount,
      validIntervalCount,
      qualityEventCount: 0,
      cumulativeDeltaMismatchCount: 0,
      averageKwMismatchCount: 0,
      invalidIntervalDurationCount: 0,
      ...(lastSeenAt ? { lastSeenAt } : {}),
      importBatchIds: ["batch-1", "batch-2", "batch-3", "batch-4"],
    },
    units: {
      usage: "kWh",
      demand: "kW",
      intervalMinutes: 15,
      timezone: "Asia/Singapore",
    },
    attention: [{
      code: "PEAK_FOCUS",
      severity: "info",
      title: "Review the Level 7 contribution to the recorded peak",
      evidence: "The trusted Project result identifies Level 7 as the largest child Scope.",
      suggestedAction: "Open Level 7 in the Scope selector and verify its leading Circuits.",
    }],
    provenance: {
      dataSnapshotId: "snapshot-ngee-ann-golden",
      hierarchyRevisionId: "hierarchy-v6",
      meterMappingRevisionId: "mapping-v1",
      meterFormulaRevisionId: "formula-v1",
      metricVersion: "metric-v1",
      ruleRevisionIds: ["rule-v1"],
      aggregationRule: "designated_total",
      sourceView: "energy_scope_intervals",
      queryIds: [...queryIds],
    },
    metadata,
  };

  return {
    context: {
      ...analysis.context,
      primaryPeriod: {
        start: "2026-06-09T16:00:00.000Z",
        endExclusive: "2026-06-16T16:00:00.000Z",
      },
      projectReleaseId: "release-ngee-ann-golden",
    },
    projectRelease: {
      id: "release-ngee-ann-golden",
      source: "template-revision",
      projectId: "ngee-ann-polytechnic",
      templateRevisionId: "template-v1",
      templateRevisionSequence: 1,
      recipe: { id: "energy-scope-analysis", version: "1" },
      renderer: {
        key: "ngee-ann-overview",
        version: "1",
        contractVersion: "project-analysis-snapshot@1",
      },
      hierarchyRevisionId: "hierarchy-v6",
      meterMappingRevisionId: "mapping-v1",
      meterFormulaRevisionId: "formula-v1",
      metricRevisionIds: ["metric-v1"],
      ruleRevisionIds: ["rule-v1"],
      businessCalendarVersion: "calendar-v1",
      tariffScheduleVersion: "tariff-v1",
      publishedAt: "2026-08-04T00:00:00.000Z",
      document: { schema_version: 2, templates: [] },
      catalog: [],
    },
    recipe: { id: "energy-scope-analysis", version: "1" },
    renderer: {
      key: "ngee-ann-overview",
      version: "1",
      contractVersion: "project-analysis-snapshot@1",
    },
    dataQuality: analysis.dataHealth,
    evidence: [{
      id: "evidence:ngee-ann-golden:energy.total_usage_kwh",
      metricId: "energy.total_usage_kwh",
      queryIds: [...queryIds],
      queryReceiptId: "receipt-ngee-ann-golden",
    }],
    findings: analysis.attention,
    dataSnapshot: {
      id: "snapshot-ngee-ann-golden",
      importBatchIds: ["batch-1", "batch-2", "batch-3", "batch-4"],
      lastSeenAt,
    },
    metadata,
    analysis,
  };
}

function missingMetadata(): EnergyProjectAnalysisMetadataDto {
  const missingValue = (unit: "m2" | "people") => ({
    status: "missing" as const,
    value: null,
    unit,
    reason: "not-configured" as const,
    guidance: `Configure ${unit === "m2" ? "area" : "headcount"} metadata.`,
    metadataRevisionIds: [],
    hierarchyRevisionIds: ["hierarchy-v6"],
    evidence: [],
  });
  const missingNormalisation = (
    metricId: "energy.usage_per_sqm" | "energy.usage_per_person",
    unit: "kWh/m2" | "kWh/person",
  ) => ({
    status: "missing" as const,
    metricId,
    value: null,
    unit,
    reason: "not-configured" as const,
    guidance: "Configure the required Scope metadata.",
    metadataRevisionIds: [],
    hierarchyRevisionIds: ["hierarchy-v6"],
    evidence: [],
  });
  return {
    status: "missing",
    hierarchyRevisionId: "hierarchy-v6",
    timezone: "Asia/Singapore",
    period: {
      start: "2026-06-09T16:00:00.000Z",
      endExclusive: "2026-06-16T16:00:00.000Z",
    },
    selectedScope: {
      scopeId: "project",
      scopeName: "Ngee Ann Polytechnic",
      usageKwh: 1531.168324,
      status: "missing",
      area: missingValue("m2"),
      headcount: missingValue("people"),
      normalisations: {
        eui: missingNormalisation("energy.usage_per_sqm", "kWh/m2"),
        perPax: missingNormalisation("energy.usage_per_person", "kWh/person"),
      },
      evidence: [],
    },
    comparisonScopes: [],
    evidence: [],
  };
}
