import { describe, expect, it } from "vitest";

import { ngeeAnnGoldenSnapshot, ngeeAnnSingleDaySnapshot } from "./ngee-ann-overview.test-fixture";
import { buildNgeeAnnOverviewViewModel } from "./ngee-ann-overview-view-model";

type GoldenSnapshot = ReturnType<typeof ngeeAnnGoldenSnapshot>;
type AvailableDailyAnomalies = Extract<
  NonNullable<GoldenSnapshot["analysis"]["dailyUsageAnomalies"]>,
  { status: "available" }
>;

function dailyAnomalyBundle(snapshot: GoldenSnapshot): AvailableDailyAnomalies {
  const bundle = snapshot.analysis.dailyUsageAnomalies;
  if (bundle?.status !== "available") throw new Error("Expected the Golden daily anomaly bundle.");
  return bundle;
}

const peakEvidencePinMismatchCases: Array<{
  name: string;
  mutate: (snapshot: GoldenSnapshot) => void;
}> = [
  {
    name: "Context Release",
    mutate: (snapshot) => { snapshot.context.projectReleaseId = "release-mismatch"; },
  },
  {
    name: "Context Project",
    mutate: (snapshot) => { snapshot.context.projectId = "project-mismatch"; },
  },
  {
    name: "Analysis Context Project",
    mutate: (snapshot) => { snapshot.analysis.context.projectId = "project-mismatch"; },
  },
  {
    name: "provenance Snapshot",
    mutate: (snapshot) => { snapshot.analysis.provenance.dataSnapshotId = "snapshot-mismatch"; },
  },
  {
    name: "Context Snapshot",
    mutate: (snapshot) => { snapshot.context.dataSnapshotId = "snapshot-mismatch"; },
  },
  {
    name: "Analysis Context Snapshot",
    mutate: (snapshot) => { snapshot.analysis.context.dataSnapshotId = "snapshot-mismatch"; },
  },
  {
    name: "provenance Hierarchy",
    mutate: (snapshot) => { snapshot.analysis.provenance.hierarchyRevisionId = "hierarchy-mismatch"; },
  },
  {
    name: "Context Hierarchy",
    mutate: (snapshot) => { snapshot.context.hierarchyRevisionId = "hierarchy-mismatch"; },
  },
  {
    name: "Analysis Context Hierarchy",
    mutate: (snapshot) => { snapshot.analysis.context.hierarchyRevisionId = "hierarchy-mismatch"; },
  },
  {
    name: "provenance Mapping",
    mutate: (snapshot) => { snapshot.analysis.provenance.meterMappingRevisionId = "mapping-mismatch"; },
  },
  {
    name: "Context Mapping",
    mutate: (snapshot) => { snapshot.context.meterMappingRevisionId = "mapping-mismatch"; },
  },
  {
    name: "Analysis Context Mapping",
    mutate: (snapshot) => { snapshot.analysis.context.meterMappingRevisionId = "mapping-mismatch"; },
  },
  {
    name: "provenance Formula",
    mutate: (snapshot) => { snapshot.analysis.provenance.meterFormulaRevisionId = "formula-mismatch"; },
  },
  {
    name: "Context Formula",
    mutate: (snapshot) => { snapshot.context.meterFormulaRevisionId = "formula-mismatch"; },
  },
  {
    name: "Analysis Context Formula",
    mutate: (snapshot) => { snapshot.analysis.context.meterFormulaRevisionId = "formula-mismatch"; },
  },
  {
    name: "Release Peak Metric",
    mutate: (snapshot) => {
      snapshot.projectRelease.metricRevisionIds = snapshot.projectRelease.metricRevisionIds
        .filter((metricId) => metricId !== "energy.peak_demand_kw@1");
    },
  },
  {
    name: "Peak Evidence Metric",
    mutate: (snapshot) => {
      snapshot.evidence = snapshot.evidence
        .filter((reference) => reference.metricId !== "energy.peak_demand_kw@1");
    },
  },
  {
    name: "Peak Evidence Query",
    mutate: (snapshot) => {
      const reference = snapshot.evidence
        .find((candidate) => candidate.metricId === "energy.peak_demand_kw@1")!;
      reference.queryIds = reference.queryIds.filter((queryId) => queryId !== "peak_breakdown_v1");
    },
  },
];

const timeEvidencePinMismatchCases: Array<{
  name: string;
  mutate: (snapshot: GoldenSnapshot) => void;
}> = [
  ...peakEvidencePinMismatchCases.slice(0, 15),
  {
    name: "Release ID",
    mutate: (snapshot) => { snapshot.projectRelease.id = "release-mismatch"; },
  },
  {
    name: "Release Usage Metric",
    mutate: (snapshot) => {
      snapshot.projectRelease.metricRevisionIds = snapshot.projectRelease.metricRevisionIds
        .filter((metricId) => metricId !== "energy.total_usage_kwh@1");
    },
  },
  {
    name: "Usage Evidence Metric",
    mutate: (snapshot) => {
      snapshot.evidence = snapshot.evidence
        .filter((reference) => reference.metricId !== "energy.total_usage_kwh@1");
    },
  },
  {
    name: "Usage Evidence Query",
    mutate: (snapshot) => {
      const reference = snapshot.evidence
        .find((candidate) => candidate.metricId === "energy.total_usage_kwh@1")!;
      reference.queryIds = reference.queryIds.filter((queryId) => queryId !== "time_bucket_grid_v1");
    },
  },
];

const anomalyEvidencePinMismatchCases: Array<{
  name: string;
  mutate: (snapshot: GoldenSnapshot) => void;
}> = [
  ...peakEvidencePinMismatchCases.slice(0, 15),
  {
    name: "Bundle Snapshot",
    mutate: (snapshot) => { dailyAnomalyBundle(snapshot).evidencePins.dataSnapshotId = "snapshot-mismatch"; },
  },
  {
    name: "Bundle Project Release",
    mutate: (snapshot) => { dailyAnomalyBundle(snapshot).evidencePins.projectReleaseId = "release-mismatch"; },
  },
  {
    name: "Bundle Hierarchy",
    mutate: (snapshot) => { dailyAnomalyBundle(snapshot).evidencePins.hierarchyRevisionId = "hierarchy-mismatch"; },
  },
  {
    name: "Bundle Mapping",
    mutate: (snapshot) => { dailyAnomalyBundle(snapshot).evidencePins.meterMappingRevisionId = "mapping-mismatch"; },
  },
  {
    name: "Bundle Formula",
    mutate: (snapshot) => { dailyAnomalyBundle(snapshot).evidencePins.meterFormulaRevisionId = "formula-mismatch"; },
  },
  {
    name: "Bundle Metric Version",
    mutate: (snapshot) => { dailyAnomalyBundle(snapshot).evidencePins.metricVersion = "metric-mismatch"; },
  },
  {
    name: "Context Metric Version",
    mutate: (snapshot) => { snapshot.context.metricVersion = "metric-mismatch"; },
  },
  {
    name: "Analysis Context Metric Version",
    mutate: (snapshot) => { snapshot.analysis.context.metricVersion = "metric-mismatch"; },
  },
  {
    name: "Release Usage Metric",
    mutate: (snapshot) => {
      snapshot.projectRelease.metricRevisionIds = snapshot.projectRelease.metricRevisionIds
        .filter((metricId) => metricId !== "energy.total_usage_kwh@1");
    },
  },
  {
    name: "Release Rule",
    mutate: (snapshot) => {
      snapshot.projectRelease.ruleRevisionIds = snapshot.projectRelease.ruleRevisionIds
        .filter((ruleId) => ruleId !== dailyAnomalyBundle(snapshot).ruleRevisionId);
    },
  },
  {
    name: "Analysis Rule",
    mutate: (snapshot) => {
      snapshot.analysis.provenance.ruleRevisionIds = snapshot.analysis.provenance.ruleRevisionIds
        .filter((ruleId) => ruleId !== dailyAnomalyBundle(snapshot).ruleRevisionId);
    },
  },
  {
    name: "Bundle Query",
    mutate: (snapshot) => {
      dailyAnomalyBundle(snapshot).evidencePins.queryIds = ["wrong-query" as "time_slot_anomaly_v1"];
    },
  },
  {
    name: "Analysis Query",
    mutate: (snapshot) => {
      snapshot.analysis.provenance.queryIds = snapshot.analysis.provenance.queryIds
        .filter((queryId) => queryId !== "time_slot_anomaly_v1");
    },
  },
  {
    name: "Usage Evidence Query",
    mutate: (snapshot) => {
      const reference = snapshot.evidence
        .find((candidate) => candidate.metricId === "energy.total_usage_kwh@1")!;
      reference.queryIds = reference.queryIds.filter((queryId) => queryId !== "time_slot_anomaly_v1");
    },
  },
  {
    name: "Snapshot Context Calendar",
    mutate: (snapshot) => { snapshot.context.businessCalendarVersion = "calendar-mismatch"; },
  },
  {
    name: "Analysis Context Calendar",
    mutate: (snapshot) => { snapshot.analysis.context.businessCalendarVersion = "calendar-mismatch"; },
  },
  {
    name: "Release Calendar",
    mutate: (snapshot) => { snapshot.projectRelease.businessCalendarVersion = "calendar-mismatch"; },
  },
  {
    name: "Bundle Calendar",
    mutate: (snapshot) => { dailyAnomalyBundle(snapshot).evidencePins.businessCalendarVersion = "calendar-mismatch"; },
  },
];

const anomalyStrictRuleMismatchCases: Array<{
  name: string;
  mutate: (bundle: AvailableDailyAnomalies) => void;
}> = [
  {
    name: "Rule Revision",
    mutate: (bundle) => { bundle.ruleRevisionId = "comparison.daily_usage_above_baseline@2"; },
  },
  {
    name: "20 percent relative threshold",
    mutate: (bundle) => { bundle.rule.relativeThresholdPct = 21; },
  },
  {
    name: "20 kWh absolute impact",
    mutate: (bundle) => { bundle.rule.absoluteImpactKwh = 21; },
  },
  {
    name: "95 percent coverage",
    mutate: (bundle) => { bundle.rule.minimumCoveragePct = 94; },
  },
  {
    name: "4 comparable samples",
    mutate: (bundle) => { bundle.rule.minimumSampleCount = 3; },
  },
  {
    name: "zero quality events",
    mutate: (bundle) => { bundle.rule.maximumQualityEventCount = 1; },
  },
  {
    name: "60-day lookback",
    mutate: (bundle) => { bundle.rule.maximumLookbackDays = 61; },
  },
  {
    name: "above direction",
    mutate: (bundle) => { (bundle.rule as { direction: string }).direction = "below"; },
  },
  {
    name: "hourly comparable-day baseline method",
    mutate: (bundle) => {
      (bundle.rule as { baselineMethod: string }).baselineMethod = "median_of_days";
    },
  },
  {
    name: "Primary Period local-date cutoff",
    mutate: (bundle) => { bundle.baselineCutoff = "2026-06-09"; },
  },
];

describe("Ngee Ann Overview ViewModel", () => {
  it("projects the fixed Custom Golden Snapshot without creating a second formula stack", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const view = buildNgeeAnnOverviewViewModel(snapshot);

    expect(view.context).toMatchObject({
      projectName: "Ngee Ann Polytechnic",
      scopeName: "Ngee Ann Polytechnic",
      scopeType: "project",
      period: "Custom",
      timezone: "Asia/Singapore",
    });
    expect(view.dataStatus).toMatchObject({
      status: "ready",
      label: "Ready",
      coverage: "100% coverage",
      intervals: "2,688 / 2,688 valid intervals",
      qualityEvents: "0 quality events",
    });
    expect(Object.fromEntries(view.highlights.map((item) => [item.id, item.value]))).toEqual({
      total: "1531.17",
      daily: "218.74",
      peak: "20.67",
      comparison: "26.4% higher",
      cost: "S$489.97",
    });
    expect(view.highlights.find((item) => item.id === "comparison")?.detail)
      .toBe("Current 1531.17 kWh vs previous 1211.68 kWh");
    expect(view.highlights.find((item) => item.id === "cost")?.detail)
      .toBe("Tariff tariff-v1 / 1 allocation");
    expect(view.metadataLimitation).toContain("Area and headcount metadata are missing");
    expect(view.metadataLimitation).toContain("does not affect Total energy, Daily average, Peak interval-average power, Comparison or Cost");
    expect(view.levelComparison).toMatchObject({
      status: "available",
      decisionQuestion: "Which Level needs attention first?",
      rows: [
        {
          id: "level-7",
          currentUsageKwh: "1054.1845",
          projectShare: "68.8484%",
          previousUsageKwh: "734.6257",
          changeKwh: "+319.5588 kWh",
          changePct: "+43.4995%",
          coverage: "100% coverage",
          intervals: "1,344 / 1,344",
          qualityEvents: "0 quality events",
        },
        {
          id: "level-6",
          currentUsageKwh: "476.9838",
          projectShare: "31.1516%",
          previousUsageKwh: "477.0516",
          changeKwh: "-0.0678 kWh",
          changePct: "-0.0142%",
        },
      ],
      evidence: {
        snapshotId: "snapshot-ngee-ann-golden",
        projectReleaseId: "release-ngee-ann-golden",
        meterMappingRevisionId: "mapping-v1",
      },
    });
    expect(view.energyComposition).toMatchObject({
      decisionQuestion: "What explains the official Project total?",
      categories: {
        status: "available",
        rows: [
          {
            id: "load",
            currentUsageKwh: "1239.4239",
            projectShare: "80.9463%",
            previousUsageKwh: "887.217",
            changeKwh: "+352.2069 kWh",
            changePct: "+39.6979%",
            quality: { coverage: "100% coverage", intervals: "1,344 / 1,344" },
          },
          {
            id: "light",
            currentUsageKwh: "291.7444",
            projectShare: "19.0537%",
            previousUsageKwh: "324.4602",
            changeKwh: "-32.7158 kWh",
            changePct: "-10.0832%",
          },
        ],
      },
      circuits: {
        status: "available",
        rows: expect.arrayContaining([
          expect.objectContaining({
            rank: 1,
            meterNodeId: "mapping-lvl-7-office-load-4-l1p22-l3p25-fan-isol1-2-16",
            scopeId: "l7-load-4",
            parentScopeId: "level-7",
            levelId: "level-7",
            levelName: "Level 7",
            categoryId: "load",
            category: "Load",
            currentUsageKwh: "439.0972",
            projectShare: "28.6773%",
            previousUsageKwh: "247.9813",
            changeKwh: "+191.1159 kWh",
            changePct: "+77.0687%",
            includedInOfficialTotal: false,
          }),
          expect.objectContaining({
            rank: 2,
            scopeId: "l7-load-3",
            currentUsageKwh: "337.9023",
            previousUsageKwh: "166.7234",
            changeKwh: "+171.1789 kWh",
            changePct: "+102.6724%",
          }),
          expect.objectContaining({
            rank: 3,
            scopeId: "l6-load-4",
            currentUsageKwh: "255.1539",
            previousUsageKwh: "262.7359",
            changeKwh: "-7.5821 kWh",
            changePct: "-2.8858%",
          }),
          expect.objectContaining({
            rank: 4,
            scopeId: "l7-front-light",
            currentUsageKwh: "107.02",
            previousUsageKwh: "124.28",
            changeKwh: "-17.26 kWh",
            changePct: "-13.888%",
          }),
          expect.objectContaining({
            rank: 5,
            scopeId: "l6-light-right",
            currentUsageKwh: "70.6873",
            previousUsageKwh: "76.9724",
            changeKwh: "-6.2851 kWh",
            changePct: "-8.1653%",
          }),
        ]),
      },
      accounting: {
        status: "available",
        designatedTotals: expect.arrayContaining([
          expect.objectContaining({ scopeId: "l7-total-load", includedInOfficialTotal: true }),
          expect.objectContaining({ scopeId: "l6-total-load", includedInOfficialTotal: true }),
          expect.objectContaining({ scopeId: "l7-total-light", includedInOfficialTotal: true }),
          expect.objectContaining({ scopeId: "l6-total-light", includedInOfficialTotal: true }),
        ]),
        reconciliation: {
          officialUsageKwh: "1531.1683",
          componentUsageKwh: "1518.9965",
          gapKwh: "12.1718",
          ratioPct: "99.2051%",
          officialMeterCount: 4,
          componentMeterCount: 14,
        },
      },
      derivedMeterTrace: {
        status: "available",
        reason: null,
        meterNodeId: "ngee-ann-load-12-v1",
        name: "Load 12",
        scopeId: "level-6",
        scopeName: "Level 6",
        meterKind: "Derived",
        resultUsageKwh: "49.0218",
        includedInOfficialTotal: false,
        terms: [
          {
            meterNodeId: "mapping-lvl-6-office-load-1-l1p1-l3p6-3",
            name: "Lvl 6 Office Load 1: L1P1-L3P6",
            coefficient: "+1",
            inputUsageKwh: "11.5379",
            contributionKwh: "11.5379",
            quality: {
              coverage: "100% coverage",
              intervals: "672 / 672",
              qualityEvents: "0 quality events",
            },
          },
          {
            meterNodeId: "mapping-lvl-6-office-load-2-l1p7-l3p12-4",
            name: "Lvl 6 Office Load 2: L1P7-L3P12",
            coefficient: "+1",
            inputUsageKwh: "37.4839",
            contributionKwh: "37.4839",
          },
        ],
        impactedInputs: [],
      },
      evidence: {
        snapshotId: "snapshot-ngee-ann-golden",
        projectReleaseId: "release-ngee-ann-golden",
        meterMappingRevisionId: "mapping-v1",
        meterFormulaRevisionId: "formula-v1",
        period: "[2026-06-09T16:00:00.000Z, 2026-06-16T16:00:00.000Z)",
        unit: "kWh",
      },
    });
    const componentMeterIds = new Set(
      snapshot.analysis.componentReconciliation!.componentMeterNodeIds,
    );
    expect(view.energyComposition.circuits.rows).toHaveLength(14);
    expect(view.energyComposition.circuits.rows.map((row) => row.meterNodeId)).toEqual(
      snapshot.analysis.circuits
        .filter((circuit) => componentMeterIds.has(circuit.meterNodeId))
        .map((circuit) => circuit.meterNodeId),
    );
    expect(view.evidence).toMatchObject({
      snapshotId: "snapshot-ngee-ann-golden",
      projectReleaseId: "release-ngee-ann-golden",
      importBatchCount: 4,
    });
    expect(view.evidence.queryIds).toEqual(snapshot.analysis.provenance.queryIds);
    expect(view.evidence.references).toEqual([
      expect.objectContaining({
        id: "evidence:ngee-ann-golden:energy.total_usage_kwh@1",
        metricId: "energy.total_usage_kwh@1",
        queryReceiptId: "receipt-ngee-ann-golden",
      }),
      expect.objectContaining({
        id: "evidence:ngee-ann-golden:energy.peak_demand_kw@1",
        metricId: "energy.peak_demand_kw@1",
        queryIds: ["peak_breakdown_v1"],
        queryReceiptId: "receipt-ngee-ann-golden-peak",
      }),
    ]);
    expect(view.evidence.comparison).toEqual({
      status: "available",
      from: "2026-06-02T16:00:00.000Z",
      to: "2026-06-09T16:00:00.000Z",
      range: "[03 Jun 2026, 00:00, 10 Jun 2026, 00:00)",
      currentUsageKwh: "1531.1683",
      previousUsageKwh: "1211.6773",
      changeKwh: "+319.4911",
      changePct: "+26.3677%",
      queryIds: snapshot.analysis.provenance.queryIds,
      referenceIds: ["evidence:ngee-ann-golden:energy.total_usage_kwh@1"],
    });
    expect(view.evidence.cost).toEqual({
      status: "available",
      amount: "489.973864",
      currency: "SGD",
      tariffScheduleVersion: "tariff-v1",
      allocations: [{
        from: "2026-06-09T16:00:00.000Z",
        to: "2026-06-16T16:00:00.000Z",
        range: "[10 Jun 2026, 00:00, 17 Jun 2026, 00:00)",
        ratePerKwh: "0.32",
        usageKwh: "1531.168324",
        cost: "489.973864",
      }],
      queryIds: snapshot.analysis.provenance.queryIds,
      referenceIds: [],
    });
  });

  it("projects the authoritative seven-day Project and Level trend without aggregating in Web", () => {
    const view = buildNgeeAnnOverviewViewModel(ngeeAnnGoldenSnapshot());

    expect(view.energyTrend).toMatchObject({
      status: "available",
      decisionQuestion: "When did accepted energy use change inside the selected Period?",
      scopes: [
        { id: "project", name: "Project", limitation: null },
        { id: "level-7", name: "Level 7", limitation: null },
        { id: "level-6", name: "Level 6", limitation: null },
      ],
      evidence: {
        snapshotId: "snapshot-ngee-ann-golden",
        projectReleaseId: "release-ngee-ann-golden",
        meterMappingRevisionId: "mapping-v1",
        meterFormulaRevisionId: "formula-v1",
        metricId: "energy.total_usage_kwh@1",
        timezone: "Asia/Singapore",
        unit: "kWh",
        queryIds: ["daily_totals_v1"],
      },
    });
    expect(view.energyTrend.scopes[0]!.points).toHaveLength(7);
    expect(view.energyTrend.scopes[0]!.points.map((point) => ({
      localDate: point.localDate,
      usageKwh: point.usageKwh,
      status: point.status,
    }))).toEqual([
      { localDate: "2026-06-10", usageKwh: "253.7018", status: "complete" },
      { localDate: "2026-06-11", usageKwh: "268.399", status: "complete" },
      { localDate: "2026-06-12", usageKwh: "260.0659", status: "complete" },
      { localDate: "2026-06-13", usageKwh: "168.9645", status: "complete" },
      { localDate: "2026-06-14", usageKwh: "127.9387", status: "complete" },
      { localDate: "2026-06-15", usageKwh: "230.1002", status: "complete" },
      { localDate: "2026-06-16", usageKwh: "221.9982", status: "complete" },
    ]);
  });

  it("uses the authoritative 24-hour grid for a single local day without depending on dailyTotals", () => {
    const snapshot = ngeeAnnSingleDaySnapshot({ includeDailyTotals: false });

    const view = buildNgeeAnnOverviewViewModel(snapshot);

    expect(view.energyTrend).toMatchObject({
      status: "available",
      grain: "hour",
      decisionQuestion: "Which accepted local hours drove energy use on the selected day?",
      evidence: { queryIds: ["time_bucket_grid_v1"] },
    });
    expect(view.energyTrend.scopes[0]!.points).toHaveLength(24);
    expect(view.energyTrend.scopes[0]!.points[0]).toMatchObject({
      localDate: "2026-06-16",
      localHour: 0,
      dateLabel: "00:00",
      acceptedUsageKwh: 5.3565,
      usageKwh: "5.3565",
      status: "complete",
      intervals: "16 / 16 valid intervals",
    });
  });

  it("projects only the seven server-triggered daily incidents in frozen Scope and date order", () => {
    const dailyAnomalies = buildNgeeAnnOverviewViewModel(ngeeAnnGoldenSnapshot()).dailyAnomalies;

    expect(dailyAnomalies).toMatchObject({
      status: "available",
      allSuppressed: false,
      outcomeSummary: {
        triggered: 7,
        withinThreshold: 14,
        suppressed: 0,
      },
      rule: {
        ruleRevisionId: "comparison.daily_usage_above_baseline@1",
        baselineCutoff: "2026-06-10",
        baselineMethod: "mean_of_complete_comparable_days_by_local_hour",
        relativeThresholdPct: "20%",
        absoluteImpactKwh: "20 kWh",
        minimumCoveragePct: "95%",
        minimumSampleCount: 4,
      },
      evidence: {
        bundleId: "anomaly-bundle-ngee-ann-golden",
        snapshotId: "snapshot-ngee-ann-golden",
        projectReleaseId: "release-ngee-ann-golden",
        hierarchyRevisionId: "hierarchy-v6",
        meterMappingRevisionId: "mapping-v1",
        meterFormulaRevisionId: "formula-v1",
        metricVersion: "metric-v1",
        businessCalendarVersion: "calendar-v1",
        queryIds: ["time_slot_anomaly_v1"],
      },
    });
    expect(dailyAnomalies.incidents.map((incident) => [incident.scopeId, incident.localDate])).toEqual([
      ["project", "2026-06-11"],
      ["project", "2026-06-13"],
      ["project", "2026-06-14"],
      ["level-7", "2026-06-11"],
      ["level-7", "2026-06-12"],
      ["level-7", "2026-06-13"],
      ["level-7", "2026-06-14"],
    ]);
    expect(dailyAnomalies.incidents.some((incident) => incident.scopeId === "level-6")).toBe(false);
    expect(dailyAnomalies.incidents[0]).toMatchObject({
      scopeName: "Project",
      actualKwh: "268.399",
      baselineKwh: "218.885",
      impactKwh: "+49.514",
      baselineDates: ["2026-06-04", "2026-06-05", "2026-06-08", "2026-06-09"],
    });
    expect(dailyAnomalies.incidents[0]!.hourlyComparison).toHaveLength(24);
    expect(dailyAnomalies.incidents[0]!.series.map((series) => series.scopeId)).toEqual([
      "project",
      "level-7",
      "level-6",
    ]);
    expect(dailyAnomalies.incidents[3]!.series.map((series) => ({
      scopeId: series.scopeId,
      category: series.category,
      includedInOfficialTotal: series.includedInOfficialTotal,
    }))).toEqual([
      { scopeId: "level-7", category: null, includedInOfficialTotal: true },
      { scopeId: "l7-anomaly-load", category: "load", includedInOfficialTotal: false },
      { scopeId: "l7-anomaly-light", category: "light", includedInOfficialTotal: false },
    ]);
  });

  it.each(anomalyEvidencePinMismatchCases)(
    "fails daily anomalies closed for a mismatched $name pin",
    ({ mutate }) => {
      const snapshot = ngeeAnnGoldenSnapshot();
      mutate(snapshot);

      const view = buildNgeeAnnOverviewViewModel(snapshot);

      expect(view.dailyAnomalies).toMatchObject({ status: "unavailable", incidents: [] });
    },
  );

  it.each(anomalyStrictRuleMismatchCases)(
    "fails daily anomalies closed for a non-canonical $name",
    ({ mutate }) => {
      const snapshot = ngeeAnnGoldenSnapshot();
      mutate(dailyAnomalyBundle(snapshot));

      const view = buildNgeeAnnOverviewViewModel(snapshot);

      expect(view.dailyAnomalies).toMatchObject({ status: "unavailable", incidents: [] });
      expect(view.energyTrend.status).toBe("available");
    },
  );

  it("requires exactly the latest four eligible baseline samples for triggered and within-threshold rows", () => {
    const tooFew = ngeeAnnGoldenSnapshot();
    const triggered = dailyAnomalyBundle(tooFew).scopes[0]!.rows[1]!;
    triggered.baselineDates.pop();
    triggered.baselineSamples.pop();
    triggered.baselineSampleCount = 3;

    const tooMany = ngeeAnnGoldenSnapshot();
    const withinThreshold = dailyAnomalyBundle(tooMany).scopes[0]!.rows[0]!;
    withinThreshold.baselineDates.unshift("2026-06-03");
    withinThreshold.baselineSamples.unshift({
      ...withinThreshold.baselineSamples[0]!,
      localDate: "2026-06-03",
    });
    withinThreshold.baselineSampleCount = 5;

    for (const snapshot of [tooFew, tooMany]) {
      const view = buildNgeeAnnOverviewViewModel(snapshot);
      expect(view.dailyAnomalies).toMatchObject({ status: "unavailable", incidents: [] });
      expect(view.energyTrend.status).toBe("available");
    }
  });

  it("rejects an eligible baseline sample unless it is complete, 100% covered and quality-clean", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const sample = dailyAnomalyBundle(snapshot).scopes[0]!.rows[1]!.baselineSamples[0]!;
    sample.coveragePct = 99.7396;
    sample.validIntervalCount = sample.expectedMeterIntervalCount - 1;

    const view = buildNgeeAnnOverviewViewModel(snapshot);

    expect(view.dailyAnomalies).toMatchObject({ status: "unavailable", incidents: [] });
    expect(view.energyTrend.status).toBe("available");
  });

  it("rejects triggered or within-threshold rows that violate pinned coverage or quality gates", () => {
    const lowCoverage = ngeeAnnGoldenSnapshot();
    dailyAnomalyBundle(lowCoverage).scopes[0]!.rows[1]!.coveragePct = 94;
    const qualityEvent = ngeeAnnGoldenSnapshot();
    dailyAnomalyBundle(qualityEvent).scopes[0]!.rows[0]!.qualityEventCount = 1;

    for (const snapshot of [lowCoverage, qualityEvent]) {
      const view = buildNgeeAnnOverviewViewModel(snapshot);
      expect(view.dailyAnomalies).toMatchObject({ status: "unavailable", incidents: [] });
      expect(view.energyTrend.status).toBe("available");
    }
  });

  it("fails daily anomalies locally when a triggered Project detail omits or reorders an immediate Level", () => {
    const missingChild = ngeeAnnGoldenSnapshot();
    dailyAnomalyBundle(missingChild).scopes[0]!.rows[1]!.detailSeries.splice(2, 1);
    const reorderedChildren = ngeeAnnGoldenSnapshot();
    const series = dailyAnomalyBundle(reorderedChildren).scopes[0]!.rows[1]!.detailSeries;
    [series[1], series[2]] = [series[2]!, series[1]!];

    for (const snapshot of [missingChild, reorderedChildren]) {
      const view = buildNgeeAnnOverviewViewModel(snapshot);
      expect(view.dailyAnomalies).toMatchObject({ status: "unavailable", incidents: [] });
      expect(view.energyTrend.status).toBe("available");
      expect(view.dayProfile.status).toBe("available");
      expect(view.levelComparison.status).toBe("available");
    }
  });

  it("uses the stable anomaly Scope order instead of usage-ranked childScopes for Project detail", () => {
    const liveOrder = ngeeAnnGoldenSnapshot();
    const liveBundle = dailyAnomalyBundle(liveOrder);
    [liveBundle.scopes[1], liveBundle.scopes[2]] = [liveBundle.scopes[2]!, liveBundle.scopes[1]!];
    for (const row of liveBundle.scopes[0]!.rows) {
      if (row.outcome === "triggered") {
        [row.detailSeries[1], row.detailSeries[2]] = [row.detailSeries[2]!, row.detailSeries[1]!];
      }
    }

    expect(liveOrder.analysis.childScopes.map((scope) => scope.nodeId)).toEqual(["level-7", "level-6"]);
    expect(liveBundle.scopes.map((scope) => scope.scopeId)).toEqual(["project", "level-6", "level-7"]);
    expect(buildNgeeAnnOverviewViewModel(liveOrder).dailyAnomalies.status).toBe("available");

    const mismatchedProjectDetail = ngeeAnnGoldenSnapshot();
    const mismatchedBundle = dailyAnomalyBundle(mismatchedProjectDetail);
    [mismatchedBundle.scopes[1], mismatchedBundle.scopes[2]] = [
      mismatchedBundle.scopes[2]!,
      mismatchedBundle.scopes[1]!,
    ];

    expect(buildNgeeAnnOverviewViewModel(mismatchedProjectDetail).dailyAnomalies).toMatchObject({
      status: "unavailable",
      incidents: [],
    });
  });

  it.each([
    {
      name: "duplicate bundled Level",
      mutate: (snapshot: GoldenSnapshot) => {
        const scopes = dailyAnomalyBundle(snapshot).scopes;
        scopes[2]!.scopeId = scopes[1]!.scopeId;
        scopes[2]!.scopeName = scopes[1]!.scopeName;
      },
    },
    {
      name: "Level outside the immediate hierarchy",
      mutate: (snapshot: GoldenSnapshot) => {
        const level = dailyAnomalyBundle(snapshot).scopes[1]!;
        level.scopeId = "level-8";
        level.scopeName = "Level 8";
      },
    },
    {
      name: "missing immediate hierarchy Level",
      mutate: (snapshot: GoldenSnapshot) => {
        snapshot.analysis.childScopes.pop();
      },
    },
  ])("fails the daily anomaly Scope set closed for a $name", ({ mutate }) => {
    const snapshot = ngeeAnnGoldenSnapshot();
    mutate(snapshot);

    expect(buildNgeeAnnOverviewViewModel(snapshot).dailyAnomalies).toMatchObject({
      status: "unavailable",
      incidents: [],
    });
  });

  it("summarises triggered, within-threshold and suppressed rows without treating suppressed as normal", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const suppressed = dailyAnomalyBundle(snapshot).scopes[0]!.rows[0]!;
    suppressed.outcome = "suppressed";
    suppressed.suppressionReason = {
      code: "CALENDAR_EXCEPTION_DATE",
      message: "The date is excluded by the pinned Calendar.",
    };

    const dailyAnomalies = buildNgeeAnnOverviewViewModel(snapshot).dailyAnomalies;

    expect(dailyAnomalies).toMatchObject({
      status: "available",
      allSuppressed: false,
      outcomeSummary: {
        triggered: 7,
        withinThreshold: 13,
        suppressed: 1,
      },
    });
    expect(dailyAnomalies.incidents).toHaveLength(7);
  });

  it("fails only daily anomalies closed for absent, unavailable or invalid optional payloads", () => {
    const absent = ngeeAnnGoldenSnapshot();
    delete absent.analysis.dailyUsageAnomalies;
    const unavailable = ngeeAnnGoldenSnapshot();
    unavailable.analysis.dailyUsageAnomalies = {
      status: "unavailable",
      ruleRevisionId: "comparison.daily_usage_above_baseline@1",
      reason: {
        code: "BUSINESS_CALENDAR_VERSION_NOT_FOUND",
        message: "The pinned business Calendar is unavailable.",
      },
    };
    const invalid = ngeeAnnGoldenSnapshot();
    dailyAnomalyBundle(invalid).scopes[0]!.rows[1]!.hourlyComparison.pop();

    expect(buildNgeeAnnOverviewViewModel(absent).dailyAnomalies).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("does not include"),
    });
    expect(buildNgeeAnnOverviewViewModel(unavailable).dailyAnomalies).toMatchObject({
      status: "unavailable",
      reason: "The pinned business Calendar is unavailable.",
    });
    const invalidView = buildNgeeAnnOverviewViewModel(invalid);
    expect(invalidView.dailyAnomalies).toMatchObject({ status: "unavailable", incidents: [] });
    expect(invalidView.energyTrend.status).toBe("available");
  });

  it("keeps an all-suppressed bundle and partial detail series honest without inventing incidents or zeroes", () => {
    const suppressed = ngeeAnnGoldenSnapshot();
    for (const scope of dailyAnomalyBundle(suppressed).scopes) {
      for (const row of scope.rows) {
        row.outcome = "suppressed";
        row.suppressionReason = {
          code: "CALENDAR_EXCEPTION_DATE",
          message: "The date is excluded by the pinned Calendar.",
        };
      }
    }
    expect(buildNgeeAnnOverviewViewModel(suppressed).dailyAnomalies).toMatchObject({
      status: "available",
      allSuppressed: true,
      outcomeSummary: {
        triggered: 0,
        withinThreshold: 0,
        suppressed: 21,
      },
      incidents: [],
    });

    const partial = ngeeAnnGoldenSnapshot();
    const component = dailyAnomalyBundle(partial).scopes[1]!.rows[1]!.detailSeries[1]!;
    component.status = "partial";
    component.selectedTotalKwh = null;
    component.points[0]!.selectedKwh = null;
    component.points[0]!.impactKwh = null;
    const partialSeries = buildNgeeAnnOverviewViewModel(partial).dailyAnomalies.incidents
      .find((incident) => incident.scopeId === "level-7" && incident.localDate === "2026-06-11")!
      .series.find((series) => series.scopeId === "l7-anomaly-load")!;
    expect(partialSeries).toMatchObject({
      status: "partial",
      statusLabel: "Partial",
      selectedTotalKwh: null,
    });
    expect(partialSeries.points).toHaveLength(24);
    expect(partialSeries.points[0]).toMatchObject({ localHour: 0, selectedKwh: null, impactKwh: null });
  });

  it("projects server Day Profiles and the direct hourly heatmap grid", () => {
    const view = buildNgeeAnnOverviewViewModel(ngeeAnnGoldenSnapshot());

    expect(view.dayProfile).toMatchObject({
      status: "available",
      scopes: [
        { id: "project", name: "Project" },
        { id: "level-7", name: "Level 7" },
        { id: "level-6", name: "Level 6" },
      ],
      evidence: { queryIds: ["time_bucket_grid_v1"] },
    });
    expect(view.dayProfile.profiles).toHaveLength(9);
    expect(view.dayProfile.profiles.find((profile) => profile.id === "project:weekday")).toMatchObject({
      status: "available",
      sampleDayCount: 5,
      values: expect.any(Array),
    });
    expect(view.dayProfile.profiles.find((profile) => profile.id === "project:weekend")).toMatchObject({
      status: "available",
      sampleDayCount: 2,
    });
    expect(view.dayProfile.profiles.find((profile) => profile.id === "project:public_holiday")).toMatchObject({
      status: "unavailable",
      reason: "Public Holiday profile requires an authoritative release-pinned Calendar classification.",
      values: [],
    });
    expect(view.dayProfile.profiles.find((profile) => profile.id === "project:weekday")?.values).toHaveLength(24);

    expect(view.usageHeatmap).toMatchObject({
      status: "available",
      defaultView: "date-hour",
      evidence: { queryIds: ["time_bucket_grid_v1"] },
    });
    expect(view.usageHeatmap.dates).toHaveLength(7);
    expect(view.usageHeatmap.scopes).toHaveLength(3);
    expect(view.usageHeatmap.scopes[0]!.cells).toHaveLength(168);
    expect(view.usageHeatmap.scopes[0]!.cells[0]).toMatchObject({
      scopeId: "project",
      localDate: "2026-06-10",
      localHour: 0,
      quality: { status: "complete", coverage: "100% coverage" },
    });
  });

  it("keeps invalid Day Profile and hourly grid failures inside their owning modules", () => {
    const invalidProfile = ngeeAnnGoldenSnapshot();
    const weekday = invalidProfile.analysis.timeBehaviour!.dayProfiles.find((profile) => (
      profile.status === "available" && profile.scopeId === "project" && profile.dayType === "weekday"
    ));
    if (weekday?.status === "available") weekday.values.pop();
    const invalidGrid = ngeeAnnGoldenSnapshot();
    invalidGrid.analysis.timeBehaviour!.scopes[1]!.cells[4]!.localHour = 8;

    const profileView = buildNgeeAnnOverviewViewModel(invalidProfile);
    expect(profileView.dayProfile).toMatchObject({ status: "unavailable", profiles: [] });
    expect(profileView.usageHeatmap.status).toBe("available");
    expect(profileView.energyTrend.status).toBe("available");

    const gridView = buildNgeeAnnOverviewViewModel(invalidGrid);
    expect(gridView.usageHeatmap).toMatchObject({ status: "unavailable", scopes: [] });
    expect(gridView.dayProfile).toMatchObject({ status: "unavailable", profiles: [] });
    expect(gridView.energyTrend).toMatchObject({ status: "available", grain: "day" });
    expect(gridView.levelComparison.status).toBe("available");
  });

  it.each(timeEvidencePinMismatchCases)(
    "fails only hourly-grid modules closed for a mismatched $name pin",
    ({ mutate }) => {
      const snapshot = ngeeAnnGoldenSnapshot();
      mutate(snapshot);

      const view = buildNgeeAnnOverviewViewModel(snapshot);

      expect(view.dayProfile).toMatchObject({ status: "unavailable", profiles: [] });
      expect(view.usageHeatmap).toMatchObject({ status: "unavailable", scopes: [] });
      expect(view.energyTrend).toMatchObject({ status: "available", grain: "day" });
      expect(view.levelComparison.status).toBe("available");
      expect(view.energyComposition.categories.status).toBe("available");
    },
  );

  it("keeps partial and unavailable heatmap cells explicit without suppressing the module", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const cells = snapshot.analysis.timeBehaviour!.scopes[0]!.cells;
    cells[0]!.dataHealth = {
      status: "partial",
      coveragePct: 75,
      expectedMeterIntervalCount: 16,
      validIntervalCount: 12,
      qualityEventCount: 1,
    };
    cells[1]!.usageKwh = null;
    cells[1]!.dataHealth = {
      status: "unavailable",
      coveragePct: 0,
      expectedMeterIntervalCount: 16,
      validIntervalCount: 0,
      qualityEventCount: 2,
    };

    const heatmap = buildNgeeAnnOverviewViewModel(snapshot).usageHeatmap;

    expect(heatmap.status).toBe("available");
    expect(heatmap.scopes[0]!.cells[0]).toMatchObject({
      usageKwh: expect.any(String),
      quality: {
        status: "partial",
        coverage: "75% coverage",
        intervals: "12 / 16 valid intervals",
        qualityEvents: "1 quality events",
      },
    });
    expect(heatmap.scopes[0]!.cells[1]).toMatchObject({
      acceptedUsageKwh: null,
      usageKwh: null,
      quality: { status: "unavailable", coverage: "0% coverage" },
    });
  });

  it("projects the authoritative same-interval Peak breakdown without reordering server rows", () => {
    const view = buildNgeeAnnOverviewViewModel(ngeeAnnGoldenSnapshot());

    expect(view.peakBreakdown).toMatchObject({
      status: "available",
      periodStatus: "complete",
      periodCoverage: "100% coverage",
      peakLabel: "Highest accepted interval",
      peakAt: "11 Jun 2026, 14:00",
      peakInterval: "[11 Jun 2026, 14:00, 11 Jun 2026, 14:15)",
      averageKw: "20.6731",
      levels: [
        {
          scopeId: "level-7",
          scopeName: "Level 7",
          averageKw: "12.0637",
          sharePct: "58.3545%",
        },
        {
          scopeId: "level-6",
          scopeName: "Level 6",
          averageKw: "8.6094",
          sharePct: "41.6455%",
        },
      ],
      evidence: {
        snapshotId: "snapshot-ngee-ann-golden",
        projectReleaseId: "release-ngee-ann-golden",
        meterMappingRevisionId: "mapping-v1",
        meterFormulaRevisionId: "formula-v1",
        metricId: "energy.peak_demand_kw@1",
        period: "[2026-06-09T16:00:00.000Z, 2026-06-16T16:00:00.000Z)",
        timezone: "Asia/Singapore",
        unit: "kW",
        queryIds: ["peak_breakdown_v1"],
      },
    });
    expect(view.peakBreakdown.levels[0]!.circuits.map((row) => row.meterNodeId)).toEqual([
      "mapping-lvl-7-office-load-4-l1p22-l3p25-fan-isol1-2-16",
      "mapping-lvl-7-office-load-3-l1p16-l3p21-15",
      "mapping-lvl-7-front-row-office-light-11",
      "mapping-lvl-7-back-row-office-light-10",
      "mapping-lvl-7-office-load-2-l1p7-l3p15-14",
      "mapping-lvl-7-middle-row-office-light-12",
      "mapping-lvl-7-office-load-1-l1p1-l3p6-13",
    ]);
  });

  it("keeps an accepted Peak available while labeling an incomplete Period", () => {
    const snapshot = ngeeAnnGoldenSnapshot({
      dataStatus: "partial",
      coveragePct: 75,
      validIntervalCount: 2_016,
    });
    const view = buildNgeeAnnOverviewViewModel(snapshot);

    expect(view.peakBreakdown).toMatchObject({
      status: "available",
      periodStatus: "partial",
      periodCoverage: "75% coverage",
      peakLabel: "Highest complete observed interval",
      averageKw: "20.6731",
    });
  });

  it("matches Peak Levels by identity while preserving server Peak order", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    if (snapshot.analysis.peakBreakdown?.status === "available") {
      snapshot.analysis.peakBreakdown.levels.reverse();
    }

    const peak = buildNgeeAnnOverviewViewModel(snapshot).peakBreakdown;

    expect(peak.status).toBe("available");
    expect(peak.levels.map((level) => level.scopeId)).toEqual(["level-6", "level-7"]);
  });

  it.each(peakEvidencePinMismatchCases)(
    "fails only Peak breakdown closed for a mismatched $name pin",
    ({ mutate }) => {
      const snapshot = ngeeAnnGoldenSnapshot();
      mutate(snapshot);

      const view = buildNgeeAnnOverviewViewModel(snapshot);

      expect(view.peakBreakdown).toMatchObject({
        status: "unavailable",
        reason: "The Peak Snapshot, Release or revision evidence pins are inconsistent.",
        levels: [],
      });
      expect(view.highlights.find((highlight) => highlight.id === "peak")).toMatchObject({
        value: "20.67",
        unit: "kW",
        available: true,
      });
      expect(view.energyTrend.status).toBe("available");
    },
  );

  it("fails Peak breakdown closed for impossible interval-health counts", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    if (snapshot.analysis.peakBreakdown?.status === "available") {
      const circuit = snapshot.analysis.peakBreakdown.levels[0]!.circuits[0]!;
      circuit.averageKw = null;
      circuit.sharePct = null;
      circuit.dataHealth = {
        status: "unavailable",
        coveragePct: 0,
        expectedMeterIntervalCount: 1,
        validIntervalCount: 2,
        qualityEventCount: 1,
      };
    }

    const view = buildNgeeAnnOverviewViewModel(snapshot);

    expect(view.peakBreakdown).toMatchObject({ status: "unavailable", levels: [] });
    expect(view.highlights.find((highlight) => highlight.id === "peak")?.value).toBe("20.67");
    expect(view.energyTrend.status).toBe("available");
  });

  it("fails only Peak breakdown closed for absent, unavailable or invalid optional payloads", () => {
    const absent = ngeeAnnGoldenSnapshot();
    delete absent.analysis.peakBreakdown;
    const unavailable = ngeeAnnGoldenSnapshot();
    unavailable.analysis.peakBreakdown = {
      status: "unavailable",
      reason: {
        code: "PEAK_INTERVAL_FACTS_REJECTED",
        message: "The Project Peak interval contains rejected official inputs.",
      },
    };
    const wrongQuery = ngeeAnnGoldenSnapshot();
    wrongQuery.analysis.provenance.queryIds = wrongQuery.analysis.provenance.queryIds
      .filter((queryId) => queryId !== "peak_breakdown_v1");
    const mismatchedPeak = ngeeAnnGoldenSnapshot();
    if (mismatchedPeak.analysis.peakBreakdown?.status === "available") {
      mismatchedPeak.analysis.peakBreakdown.peak.averageKw = 21;
    }
    const invalidCircuit = ngeeAnnGoldenSnapshot();
    if (invalidCircuit.analysis.peakBreakdown?.status === "available") {
      invalidCircuit.analysis.peakBreakdown.levels[0]!.circuits[0]!.sharePct = null;
    }

    for (const snapshot of [absent, unavailable, wrongQuery, mismatchedPeak, invalidCircuit]) {
      const view = buildNgeeAnnOverviewViewModel(snapshot);
      expect(view.peakBreakdown).toMatchObject({ status: "unavailable", levels: [] });
      expect(view.highlights.find((highlight) => highlight.id === "peak")).toMatchObject({
        value: "20.67",
        unit: "kW",
        available: true,
      });
      expect(view.energyTrend.status).toBe("available");
    }
  });

  it("keeps partial accepted usage and an unavailable day on the authoritative date spine", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const rows = snapshot.analysis.dailyTotals!.scopes[0]!.rows;
    rows[1]!.dataHealth = {
      status: "partial",
      coveragePct: 75,
      expectedMeterIntervalCount: 384,
      validIntervalCount: 288,
      qualityEventCount: 2,
    };
    rows[2]!.usageKwh = null;
    rows[2]!.dataHealth = {
      status: "unavailable",
      coveragePct: 0,
      expectedMeterIntervalCount: 384,
      validIntervalCount: 0,
      qualityEventCount: 1,
    };

    const trend = buildNgeeAnnOverviewViewModel(snapshot).energyTrend;

    expect(trend.status).toBe("available");
    expect(trend.scopes[0]!.limitation).toContain("not zero-filled");
    expect(trend.scopes[0]!.points[1]).toMatchObject({
      usageKwh: "268.399",
      status: "partial",
      statusLabel: "Partial",
      coverage: "75% coverage",
      intervals: "288 / 384 valid intervals",
      qualityEvents: "2 quality events",
    });
    expect(trend.scopes[0]!.points[2]).toMatchObject({
      localDate: "2026-06-12",
      acceptedUsageKwh: null,
      usageKwh: null,
      status: "unavailable",
      statusLabel: "Unavailable",
    });
  });

  it("fails only Energy trend closed for absent or invalid optional daily totals", () => {
    const absent = ngeeAnnGoldenSnapshot();
    delete absent.analysis.dailyTotals;
    const wrongQuery = ngeeAnnGoldenSnapshot();
    wrongQuery.analysis.provenance.queryIds = wrongQuery.analysis.provenance.queryIds
      .filter((queryId) => queryId !== "daily_totals_v1");
    const brokenSpine = ngeeAnnGoldenSnapshot();
    brokenSpine.analysis.dailyTotals!.scopes[1]!.rows[2]!.localDate = "2026-06-20";
    const zeroFilledMissing = ngeeAnnGoldenSnapshot();
    zeroFilledMissing.analysis.dailyTotals!.scopes[0]!.rows[2]!.dataHealth.status = "unavailable";
    zeroFilledMissing.analysis.dailyTotals!.scopes[0]!.rows[2]!.usageKwh = 0;

    for (const snapshot of [absent, wrongQuery, brokenSpine, zeroFilledMissing]) {
      const view = buildNgeeAnnOverviewViewModel(snapshot);
      expect(view.energyTrend).toMatchObject({ status: "unavailable", scopes: [] });
      expect(view.levelComparison.status).toBe("available");
      expect(view.energyComposition.categories.status).toBe("available");
    }
  });

  it("fails the Level module closed for a legacy Snapshot without comparison facts", () => {
    const view = buildNgeeAnnOverviewViewModel(ngeeAnnGoldenSnapshot({
      levelFactsAvailable: false,
    }));

    expect(view.levelComparison).toMatchObject({
      status: "unavailable",
      reason: "This published Snapshot does not include the Level comparison and quality contract.",
      rows: [],
      evidence: {
        snapshotId: "snapshot-ngee-ann-golden",
        meterMappingRevisionId: "mapping-v1",
      },
    });
  });

  it("keeps official Categories available while Circuit and accounting contracts fail closed", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    delete snapshot.analysis.topCircuits[0]!.parentScopeId;
    delete snapshot.analysis.designatedTotals![0]!.includedInOfficialTotal;
    delete snapshot.analysis.componentReconciliation;

    const view = buildNgeeAnnOverviewViewModel(snapshot);

    expect(view.energyComposition.categories).toMatchObject({
      status: "available",
      rows: [
        { id: "load", currentUsageKwh: "1239.4239" },
        { id: "light", currentUsageKwh: "291.7444" },
      ],
    });
    expect(view.energyComposition.circuits).toMatchObject({
      status: "unavailable",
      rows: [],
    });
    expect(view.energyComposition.accounting).toMatchObject({
      status: "unavailable",
      designatedTotals: [],
      reconciliation: null,
    });
  });

  it("rejects an accounting contract that would count one meter as official and component", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const reconciliation = snapshot.analysis.componentReconciliation!;
    reconciliation.componentMeterNodeIds.push(reconciliation.officialMeterNodeIds[0]!);

    const view = buildNgeeAnnOverviewViewModel(snapshot);

    expect(view.energyComposition.categories.status).toBe("available");
    expect(view.energyComposition.circuits.status).toBe("unavailable");
    expect(view.energyComposition.accounting).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("non-overlapping"),
      reconciliation: null,
    });
  });

  it("rejects reconciliation meter sets with extra or missing identities", () => {
    const extraOfficialSnapshot = ngeeAnnGoldenSnapshot();
    extraOfficialSnapshot.analysis.componentReconciliation!.officialMeterNodeIds.push("unexpected-official-meter");
    const missingComponentSnapshot = ngeeAnnGoldenSnapshot();
    missingComponentSnapshot.analysis.componentReconciliation!.componentMeterNodeIds.pop();

    expect(buildNgeeAnnOverviewViewModel(extraOfficialSnapshot).energyComposition.accounting.status)
      .toBe("unavailable");
    expect(buildNgeeAnnOverviewViewModel(missingComponentSnapshot).energyComposition.accounting.status)
      .toBe("unavailable");
  });

  it("formats the authoritative reconciliation without recomputing it from displayed rows", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    snapshot.analysis.componentReconciliation = {
      ...snapshot.analysis.componentReconciliation!,
      officialUsageKwh: 2_000,
      componentUsageKwh: 1_500,
      gapKwh: 500,
      ratioPct: 75,
    };

    const view = buildNgeeAnnOverviewViewModel(snapshot);

    expect(view.energyComposition.accounting.reconciliation).toMatchObject({
      officialUsageKwh: "2000",
      componentUsageKwh: "1500",
      gapKwh: "500",
      ratioPct: "75%",
    });
  });

  it("fails only the Derived meter trace closed for a legacy Snapshot without the optional trace", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    delete snapshot.analysis.virtualMeterTraces;

    const view = buildNgeeAnnOverviewViewModel(snapshot);

    expect(view.energyComposition.categories.status).toBe("available");
    expect(view.energyComposition.circuits.status).toBe("available");
    expect(view.energyComposition.accounting.status).toBe("available");
    expect(view.energyComposition.derivedMeterTrace).toMatchObject({
      status: "unavailable",
      reason: "This published Snapshot does not include the server-derived meter trace contract.",
      resultUsageKwh: null,
      terms: [],
      impactedInputs: [],
    });
  });

  it("shows only affected input identities for a partial Derived meter trace", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const trace = snapshot.analysis.virtualMeterTraces![0]!;
    const affectedTerm = trace.terms[0]!;
    trace.status = "partial";
    trace.usageKwh = null;
    trace.missingTermMeterNodeIds = [affectedTerm.meterNodeId];
    affectedTerm.inputUsageKwh = null;
    affectedTerm.contributionKwh = null;
    affectedTerm.dataHealth = null;

    const view = buildNgeeAnnOverviewViewModel(snapshot);

    expect(view.energyComposition.derivedMeterTrace).toEqual({
      status: "partial",
      reason: "Derived result unavailable because required inputs are missing.",
      meterNodeId: "ngee-ann-load-12-v1",
      name: "Load 12",
      scopeId: "level-6",
      scopeName: "Level 6",
      meterKind: "Derived",
      resultUsageKwh: null,
      includedInOfficialTotal: false,
      terms: [],
      impactedInputs: [{
        meterNodeId: "mapping-lvl-6-office-load-1-l1p1-l3p6-3",
        name: "Lvl 6 Office Load 1: L1P1-L3P6",
      }],
    });
  });

  it("rejects duplicate or missing term identities, a missing result and a wrong total marker", () => {
    const invalidSnapshots = [
      (() => {
        const snapshot = ngeeAnnGoldenSnapshot();
        snapshot.analysis.virtualMeterTraces![0]!.terms[1]!.meterNodeId =
          snapshot.analysis.virtualMeterTraces![0]!.terms[0]!.meterNodeId;
        return snapshot;
      })(),
      (() => {
        const snapshot = ngeeAnnGoldenSnapshot();
        snapshot.analysis.virtualMeterTraces![0]!.terms[0]!.meterNodeId = "";
        return snapshot;
      })(),
      (() => {
        const snapshot = ngeeAnnGoldenSnapshot();
        snapshot.analysis.virtualMeterTraces![0]!.usageKwh = null;
        return snapshot;
      })(),
      (() => {
        const snapshot = ngeeAnnGoldenSnapshot();
        const trace = snapshot.analysis.virtualMeterTraces![0]! as { includedInOfficialTotal: boolean };
        trace.includedInOfficialTotal = true;
        return snapshot;
      })(),
      (() => {
        const snapshot = ngeeAnnGoldenSnapshot();
        const term = snapshot.analysis.virtualMeterTraces![0]!.terms[0]! as { coefficient: number };
        term.coefficient = 2;
        return snapshot;
      })(),
    ];

    for (const snapshot of invalidSnapshots) {
      const view = buildNgeeAnnOverviewViewModel(snapshot);
      expect(view.energyComposition.categories.status).toBe("available");
      expect(view.energyComposition.circuits.status).toBe("available");
      expect(view.energyComposition.accounting.status).toBe("available");
      expect(view.energyComposition.derivedMeterTrace).toMatchObject({
        status: "unavailable",
        resultUsageKwh: null,
        terms: [],
      });
    }
  });

  it("rejects partial traces that retain a result or non-null facts for an affected input", () => {
    const resultRetainedSnapshot = ngeeAnnGoldenSnapshot();
    const resultRetainedTrace = resultRetainedSnapshot.analysis.virtualMeterTraces![0]!;
    const resultRetainedTerm = resultRetainedTrace.terms[0]!;
    resultRetainedTrace.status = "partial";
    resultRetainedTrace.missingTermMeterNodeIds = [resultRetainedTerm.meterNodeId];
    resultRetainedTerm.inputUsageKwh = null;
    resultRetainedTerm.contributionKwh = null;
    resultRetainedTerm.dataHealth = null;

    const affectedFactsRetainedSnapshot = ngeeAnnGoldenSnapshot();
    const affectedFactsRetainedTrace = affectedFactsRetainedSnapshot.analysis.virtualMeterTraces![0]!;
    const affectedFactsRetainedTerm = affectedFactsRetainedTrace.terms[0]!;
    affectedFactsRetainedTrace.status = "partial";
    affectedFactsRetainedTrace.usageKwh = null;
    affectedFactsRetainedTrace.missingTermMeterNodeIds = [affectedFactsRetainedTerm.meterNodeId];

    for (const snapshot of [resultRetainedSnapshot, affectedFactsRetainedSnapshot]) {
      expect(buildNgeeAnnOverviewViewModel(snapshot).energyComposition.derivedMeterTrace)
        .toMatchObject({ status: "unavailable", resultUsageKwh: null, terms: [] });
    }
  });

  it("formats server-provided Derived values without recomputing the formula result", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const trace = snapshot.analysis.virtualMeterTraces![0]!;
    trace.usageKwh = 88;
    trace.terms[0]!.contributionKwh = 7;
    trace.terms[1]!.contributionKwh = 9;

    const derived = buildNgeeAnnOverviewViewModel(snapshot).energyComposition.derivedMeterTrace;

    expect(derived).toMatchObject({
      status: "available",
      resultUsageKwh: "88",
      terms: [
        { inputUsageKwh: "11.5379", contributionKwh: "7" },
        { inputUsageKwh: "37.4839", contributionKwh: "9" },
      ],
    });
  });

  it("matches only canonical comparison Metric IDs and their strict revisions", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const reference = snapshot.evidence[0]!;
    snapshot.evidence = [
      {
        ...reference,
        id: "evidence:comparison-logical",
        metricId: "energy.comparison_change_kwh",
      },
      {
        ...reference,
        id: "evidence:usage-revision",
        metricId: "energy.total_usage_kwh@2",
      },
      {
        ...reference,
        id: "evidence:nearby-metric",
        metricId: "energy.total_usage_kwh_daily@1",
      },
      {
        ...reference,
        id: "evidence:malformed-revision",
        metricId: "energy.total_usage_kwh@1@shadow",
      },
    ];

    const view = buildNgeeAnnOverviewViewModel(snapshot);

    expect(view.evidence.comparison.referenceIds).toEqual([
      "evidence:comparison-logical",
      "evidence:usage-revision",
    ]);
    expect(view.evidence.cost.referenceIds).toEqual([]);
  });

  it("keeps accepted partial values visible with an actionable incomplete-data status", () => {
    const view = buildNgeeAnnOverviewViewModel(ngeeAnnGoldenSnapshot({
      dataStatus: "partial",
      coveragePct: 50,
      validIntervalCount: 1_344,
    }));

    expect(view.dataStatus).toMatchObject({
      status: "partial",
      label: "Partial data",
      coverage: "50% coverage",
      intervals: "1,344 / 2,688 valid intervals",
    });
    expect(view.dataStatus.recovery).toContain("Restore the missing source intervals");
    expect(view.highlights.find((item) => item.id === "total")).toMatchObject({
      value: "1531.17",
      available: true,
    });
  });

  it("fails closed when no trusted interval is available and exposes only an explicit CTA hint", () => {
    const view = buildNgeeAnnOverviewViewModel(
      ngeeAnnGoldenSnapshot({
        dataStatus: "unavailable",
        coveragePct: 0,
        validIntervalCount: 0,
        lastSeenAt: null,
      }),
      {
        latestAvailableRange: { from: "2026-06-10", to: "2026-06-16" },
      },
    );

    expect(view.dataStatus).toMatchObject({
      status: "unavailable",
      label: "Unavailable",
      coverage: "0% coverage",
      intervals: "0 / 2,688 valid intervals",
    });
    expect(view.highlights.every((item) => !item.available)).toBe(true);
    expect(view.highlights.map((item) => item.value)).toEqual([
      "Unavailable",
      "Unavailable",
      "Unavailable",
      "Unavailable",
      "Unavailable",
    ]);
    expect(view.latestAvailableRange).toEqual({ from: "2026-06-10", to: "2026-06-16" });
    expect(view.evidence.comparison.status).toBe("unavailable");
    expect(view.evidence.cost).toMatchObject({
      status: "unavailable",
      reason: "No trusted intervals support a Cost for this Period.",
      allocations: [],
      referenceIds: [],
    });
  });

  it("shows Cost as Unavailable when the Snapshot has no effective Tariff", () => {
    const view = buildNgeeAnnOverviewViewModel(ngeeAnnGoldenSnapshot({ costAvailable: false }));

    expect(view.highlights.find((item) => item.id === "cost")).toEqual(expect.objectContaining({
      value: "Unavailable",
      available: false,
      detail: "No effective Tariff covers the selected period.",
    }));
    expect(view.evidence.cost).toEqual({
      status: "unavailable",
      reason: "No effective Tariff covers the selected period.",
      tariffScheduleVersion: "tariff-v1",
      allocations: [],
      queryIds: view.evidence.queryIds,
      referenceIds: [],
    });
  });

  it("uses the approved day grain for a single local day when the authoritative daily total is present", () => {
    const view = buildNgeeAnnOverviewViewModel(
      ngeeAnnSingleDaySnapshot(),
      { trendGrain: "day" },
    );

    expect(view.energyTrend).toMatchObject({
      status: "available",
      grain: "day",
      decisionQuestion: "When did accepted energy use change inside the selected Period?",
      evidence: { queryIds: ["daily_totals_v1"] },
    });
    expect(view.energyTrend.scopes[0]!.points).toHaveLength(1);
    expect(view.energyTrend.scopes[0]!.points[0]).toMatchObject({
      localDate: "2026-06-16",
      localHour: null,
      usageKwh: "221.9982",
    });
  });

  it("selects and formats the server-owned Top 3 decision priorities without reranking them", () => {
    const view = buildNgeeAnnOverviewViewModel(ngeeAnnGoldenSnapshot());

    expect(view.decisionPriorities).toMatchObject({
      status: "available",
      limitation: null,
      items: [
        {
          rank: 1,
          finding: "Ngee Ann Polytechnic used 105.626 kWh above its comparable-day baseline on 2026-06-13.",
          evidence: "Project / 13 Jun / 168.96 kWh vs 63.34 kWh baseline (+166.8%)",
          impact: "+105.63 kWh above baseline; incident cost unavailable",
          targetIncidentId: "incident:project:2026-06-13",
          confidence: "Complete Evidence",
        },
        { rank: 2, targetIncidentId: "incident:project:2026-06-14" },
        { rank: 3, targetIncidentId: "incident:project:2026-06-11" },
      ],
    });
  });

  it("accepts empty priorities only when the anomaly bundle has no triggered or suppressed outcomes", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    for (const scope of dailyAnomalyBundle(snapshot).scopes) {
      for (const row of scope.rows) {
        if (row.outcome === "triggered") row.outcome = "within_threshold";
      }
    }
    snapshot.decisionPriorities = {
      ...snapshot.decisionPriorities!,
      status: "empty",
      limitation: null,
      items: [],
    };

    expect(buildNgeeAnnOverviewViewModel(snapshot).decisionPriorities).toMatchObject({
      status: "empty",
      limitation: null,
      items: [],
    });
  });

  it("accepts partial priorities only when the anomaly bundle contains suppressed outcomes", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const suppressed = dailyAnomalyBundle(snapshot).scopes[0]!.rows[0]!;
    suppressed.outcome = "suppressed";
    suppressed.suppressionReason = {
      code: "CALENDAR_EXCEPTION_DATE",
      message: "The date is excluded by the pinned Calendar.",
    };
    snapshot.decisionPriorities = {
      ...snapshot.decisionPriorities!,
      status: "partial",
      limitation: {
        code: "SOME_CANDIDATE_DATES_SUPPRESSED",
        message: "Some candidate dates were suppressed.",
      },
    };

    expect(buildNgeeAnnOverviewViewModel(snapshot).decisionPriorities).toMatchObject({
      status: "partial",
      limitation: "Some candidate dates were suppressed.",
      items: [{ rank: 1 }, { rank: 2 }, { rank: 3 }],
    });
  });

  it("accepts suppressed priorities only when the anomaly bundle has suppressed but no triggered outcomes", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    for (const scope of dailyAnomalyBundle(snapshot).scopes) {
      for (const row of scope.rows) {
        row.outcome = "suppressed";
        row.suppressionReason = {
          code: "CALENDAR_EXCEPTION_DATE",
          message: "The date is excluded by the pinned Calendar.",
        };
      }
    }
    snapshot.decisionPriorities = {
      ...snapshot.decisionPriorities!,
      status: "suppressed",
      limitation: {
        code: "ALL_CANDIDATE_DATES_SUPPRESSED",
        message: "All candidate dates were suppressed.",
      },
      items: [],
    };

    expect(buildNgeeAnnOverviewViewModel(snapshot).decisionPriorities).toMatchObject({
      status: "suppressed",
      limitation: "All candidate dates were suppressed.",
      items: [],
    });
  });

  it.each(["empty", "suppressed", "partial"] as const)(
    "fails a forged zero-item %s state closed when the anomaly bundle has triggered outcomes",
    (status) => {
      const snapshot = ngeeAnnGoldenSnapshot();
      snapshot.decisionPriorities = {
        ...snapshot.decisionPriorities!,
        status,
        limitation: status === "empty" ? null : {
          code: status === "suppressed"
            ? "ALL_CANDIDATE_DATES_SUPPRESSED"
            : "SOME_CANDIDATE_DATES_SUPPRESSED",
          message: "Forged priority status.",
        },
        items: [],
      };

      expect(buildNgeeAnnOverviewViewModel(snapshot).decisionPriorities).toMatchObject({
        status: "unavailable",
        items: [],
      });
    },
  );

  it("fails priorities closed when supporting incident IDs omit an exact same-date sibling", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    snapshot.decisionPriorities!.items[0]!.evidence.supportingIncidentIds.pop();

    expect(buildNgeeAnnOverviewViewModel(snapshot).decisionPriorities).toMatchObject({
      status: "unavailable",
      items: [],
    });
  });

  it("fails a suppressed priority state closed when anomaly outcomes are mixed", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    for (const scope of dailyAnomalyBundle(snapshot).scopes) {
      for (const row of scope.rows) {
        if (row.outcome === "triggered") row.outcome = "within_threshold";
      }
    }
    const mixedSuppressed = dailyAnomalyBundle(snapshot).scopes[0]!.rows[0]!;
    mixedSuppressed.outcome = "suppressed";
    mixedSuppressed.suppressionReason = {
      code: "CALENDAR_EXCEPTION_DATE",
      message: "The date is excluded by the pinned Calendar.",
    };
    snapshot.decisionPriorities = {
      ...snapshot.decisionPriorities!,
      status: "suppressed",
      limitation: {
        code: "ALL_CANDIDATE_DATES_SUPPRESSED",
        message: "All candidate dates were suppressed.",
      },
      items: [],
    };

    expect(buildNgeeAnnOverviewViewModel(snapshot).decisionPriorities.status).toBe("unavailable");
  });

  it("fails SOME_CANDIDATE_DATES_SUPPRESSED closed for all-suppressed rows or items without a trigger", () => {
    const allSuppressed = ngeeAnnGoldenSnapshot();
    for (const scope of dailyAnomalyBundle(allSuppressed).scopes) {
      for (const row of scope.rows) {
        row.outcome = "suppressed";
        row.suppressionReason = {
          code: "CALENDAR_EXCEPTION_DATE",
          message: "The date is excluded by the pinned Calendar.",
        };
      }
    }
    allSuppressed.decisionPriorities = {
      ...allSuppressed.decisionPriorities!,
      status: "partial",
      limitation: {
        code: "SOME_CANDIDATE_DATES_SUPPRESSED",
        message: "Some candidate dates were suppressed.",
      },
      items: [],
    };

    const noTriggerWithItems = ngeeAnnGoldenSnapshot();
    for (const scope of dailyAnomalyBundle(noTriggerWithItems).scopes) {
      for (const row of scope.rows) {
        if (row.outcome === "triggered") row.outcome = "within_threshold";
      }
    }
    const suppressed = dailyAnomalyBundle(noTriggerWithItems).scopes[0]!.rows[0]!;
    suppressed.outcome = "suppressed";
    suppressed.suppressionReason = {
      code: "CALENDAR_EXCEPTION_DATE",
      message: "The date is excluded by the pinned Calendar.",
    };
    noTriggerWithItems.decisionPriorities!.status = "partial";
    noTriggerWithItems.decisionPriorities!.limitation = {
      code: "SOME_CANDIDATE_DATES_SUPPRESSED",
      message: "Some candidate dates were suppressed.",
    };

    for (const snapshot of [allSuppressed, noTriggerWithItems]) {
      expect(buildNgeeAnnOverviewViewModel(snapshot).decisionPriorities.status).toBe("unavailable");
    }
  });

  it("fails available and SUPPORTING_EVIDENCE_PARTIAL states closed when confidence or suppression outcomes disagree", () => {
    const availablePartialConfidence = ngeeAnnGoldenSnapshot();
    const confidenceLimitation = {
      code: "SUPPORTING_EVIDENCE_PARTIAL" as const,
      message: "Supporting Evidence is partial.",
    };
    availablePartialConfidence.decisionPriorities!.items[0]!.confidence = {
      status: "partial",
      limitation: confidenceLimitation,
    };

    const availableWithSuppression = ngeeAnnGoldenSnapshot();
    const availableSuppressedRow = dailyAnomalyBundle(availableWithSuppression).scopes[0]!.rows[0]!;
    availableSuppressedRow.outcome = "suppressed";
    availableSuppressedRow.suppressionReason = {
      code: "CALENDAR_EXCEPTION_DATE",
      message: "The date is excluded by the pinned Calendar.",
    };

    const partialWithSuppression = ngeeAnnGoldenSnapshot();
    partialWithSuppression.decisionPriorities!.status = "partial";
    partialWithSuppression.decisionPriorities!.limitation = confidenceLimitation;
    partialWithSuppression.decisionPriorities!.items[0]!.confidence = {
      status: "partial",
      limitation: confidenceLimitation,
    };
    const suppressed = dailyAnomalyBundle(partialWithSuppression).scopes[0]!.rows[0]!;
    suppressed.outcome = "suppressed";
    suppressed.suppressionReason = {
      code: "CALENDAR_EXCEPTION_DATE",
      message: "The date is excluded by the pinned Calendar.",
    };

    const partialWithoutPartialConfidence = ngeeAnnGoldenSnapshot();
    partialWithoutPartialConfidence.decisionPriorities!.status = "partial";
    partialWithoutPartialConfidence.decisionPriorities!.limitation = confidenceLimitation;

    for (const snapshot of [
      availablePartialConfidence,
      availableWithSuppression,
      partialWithSuppression,
      partialWithoutPartialConfidence,
    ]) {
      expect(buildNgeeAnnOverviewViewModel(snapshot).decisionPriorities.status).toBe("unavailable");
    }
  });

  it("withholds only priorities when their order or anomaly Evidence contract is invalid", () => {
    const invalidRank = ngeeAnnGoldenSnapshot();
    invalidRank.decisionPriorities!.items[1]!.rank = 1;
    const invalidPins = ngeeAnnGoldenSnapshot();
    invalidPins.decisionPriorities!.evidencePins.dataSnapshotId = "snapshot-other";
    const invalidEmptySource = ngeeAnnGoldenSnapshot();
    invalidEmptySource.decisionPriorities = {
      ...invalidEmptySource.decisionPriorities!,
      status: "empty",
      limitation: null,
      items: [],
    };
    invalidEmptySource.analysis.dailyUsageAnomalies!.ruleRevisionId = "rule-other";

    for (const snapshot of [invalidRank, invalidPins]) {
      const view = buildNgeeAnnOverviewViewModel(snapshot);
      expect(view.decisionPriorities).toMatchObject({
        status: "unavailable",
        items: [],
      });
      expect(view.dailyAnomalies.status).toBe("available");
      expect(view.highlights.find((item) => item.id === "total")?.available).toBe(true);
    }

    const invalidEmptySourceView = buildNgeeAnnOverviewViewModel(invalidEmptySource);
    expect(invalidEmptySourceView.decisionPriorities).toMatchObject({
      status: "unavailable",
      items: [],
    });
    expect(invalidEmptySourceView.dailyAnomalies.status).toBe("unavailable");
    expect(invalidEmptySourceView.highlights.find((item) => item.id === "total")?.available).toBe(true);
  });
});
