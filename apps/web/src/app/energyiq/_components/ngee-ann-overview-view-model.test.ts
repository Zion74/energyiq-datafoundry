import { describe, expect, it } from "vitest";

import { ngeeAnnGoldenSnapshot } from "./ngee-ann-overview.test-fixture";
import { buildNgeeAnnOverviewViewModel } from "./ngee-ann-overview-view-model";

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
      total: "1531.1683",
      daily: "218.7383",
      peak: "20.6731",
      comparison: "+26.3677%",
      cost: "489.973864 SGD",
    });
    expect(view.highlights.find((item) => item.id === "comparison")?.detail)
      .toBe("Previous 1211.6773 kWh / +319.4911 kWh");
    expect(view.highlights.find((item) => item.id === "cost")?.detail)
      .toBe("Tariff tariff-v1 / 1 allocation");
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
    expect(view.evidence.references).toEqual([expect.objectContaining({
      id: "evidence:ngee-ann-golden:energy.total_usage_kwh@1",
      metricId: "energy.total_usage_kwh@1",
      queryReceiptId: "receipt-ngee-ann-golden",
    })]);
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
      { localDate: "2026-06-10", usageKwh: "216.3774", status: "complete" },
      { localDate: "2026-06-11", usageKwh: "233.8201", status: "complete" },
      { localDate: "2026-06-12", usageKwh: "214.7432", status: "complete" },
      { localDate: "2026-06-13", usageKwh: "214.7432", status: "complete" },
      { localDate: "2026-06-14", usageKwh: "214.7432", status: "complete" },
      { localDate: "2026-06-15", usageKwh: "214.7432", status: "complete" },
      { localDate: "2026-06-16", usageKwh: "221.9982", status: "complete" },
    ]);
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
      usageKwh: "233.8201",
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
      value: "1531.1683",
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
});
