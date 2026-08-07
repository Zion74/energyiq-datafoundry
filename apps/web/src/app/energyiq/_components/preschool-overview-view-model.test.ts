import { describe, expect, it } from "vitest";

import { preschoolGoldenSnapshot } from "./preschool-overview.test-fixture";
import { buildPreschoolOverviewViewModel } from "./preschool-overview-view-model";

describe("Preschool Overview ViewModel", () => {
  it("projects the server-authoritative May Portfolio benchmark and Evidence", () => {
    const snapshot = preschoolGoldenSnapshot();
    snapshot.analysis.childScopes[0]!.topCircuitName = "preschool-centre-a:Aircon 1";
    const view = buildPreschoolOverviewViewModel(snapshot);

    expect(view.context).toMatchObject({
      projectName: "Preschool Portfolio",
      period: "1 May 2026–31 May 2026",
    });
    expect(view.highlights.find((item) => item.id === "energy")?.value).toBe("24,921.81 kWh");
    expect(view.highlights.find((item) => item.id === "off-hours")?.value).toBe("12.5%");
    expect(view.highlights.find((item) => item.id === "cost")).toMatchObject({
      label: "Estimated May cost",
      value: "S$6,796.18",
      available: true,
    });
    expect(view.centres).toHaveLength(30);
    expect(view.centres[0]).toMatchObject({
      rank: 1,
      name: "Centre A",
      usageKwh: "843.10",
      metadataStatus: "provisional",
      topCircuit: "Aircon 1",
      cohort: "Senior Care Center",
      quadrant: "lower-intensity",
    });
    expect(view.normalisation).toMatchObject({
      euiAvailableCount: 30,
      perPaxAvailableCount: 30,
      status: "provisional",
    });
    expect(view.benchmark).toMatchObject({
      status: "provisional",
      sampleSize: 30,
      eui: { p50: "7.03", p75: "10.53" },
      perPax: { p50: "18.4", p75: "20.8" },
      priorityCentreCodes: ["G", "M", "J"],
      scatter: {
        euiP75: 10.525439076,
        perPaxP75: 20.84584375,
      },
    });
    if (view.benchmark.status !== "provisional") throw new Error("Expected benchmark view");
    expect(view.benchmark.scatter.points).toHaveLength(30);
    expect(view.benchmark.scatter.points.find((point) => point.centreCode === "G"))
      .toMatchObject({ priority: true, quadrant: "priority" });
    expect(view.benchmark.distributions.map((distribution) => ({
      id: distribution.id,
      label: distribution.label,
      unit: distribution.unit,
      axis: distribution.axis,
      cohorts: distribution.cohorts.map((cohort) => ({
        name: cohort.name,
        sampleSize: cohort.sampleSize,
        p50: cohort.p50,
        p75: cohort.p75,
        pointCount: cohort.points.length,
      })),
    }))).toEqual([
      {
        id: "eui",
        label: "Annualised May EUI estimate",
        unit: "kWh/m²/year",
        axis: { min: 0, max: 16 },
        cohorts: [
          { name: "Active Aging Center", sampleSize: 8, p50: "6.72", p75: "15.13", pointCount: 8 },
          { name: "Preschool", sampleSize: 8, p50: "9.00", p75: "10.95", pointCount: 8 },
          { name: "Senior Care Center", sampleSize: 14, p50: "6.76", p75: "9.20", pointCount: 14 },
        ],
      },
      {
        id: "per-pax",
        label: "May energy per person",
        unit: "kWh/person",
        axis: { min: 0, max: 24 },
        cohorts: [
          { name: "Active Aging Center", sampleSize: 8, p50: "17.2", p75: "22.5", pointCount: 8 },
          { name: "Preschool", sampleSize: 8, p50: "18.1", p75: "20.1", pointCount: 8 },
          { name: "Senior Care Center", sampleSize: 14, p50: "18.5", p75: "20.7", pointCount: 14 },
        ],
      },
    ]);
    expect(view.benchmark.distributions.flatMap((distribution) => (
      distribution.cohorts.flatMap((cohort) => cohort.points)
    ))).toHaveLength(60);
    expect(view.benchmark.distributions[0]?.cohorts
      .find((cohort) => cohort.name === "Senior Care Center")?.points
      .find((point) => point.centreCode === "J"))
      .toMatchObject({ centreCode: "J", name: "Centre J", aboveP75: true });
    expect(view.appliances).toMatchObject({
      status: "available",
      totalEnergy: "24,921.81 kWh",
    });
    if (view.appliances.status !== "available") throw new Error(view.appliances.detail);
    expect(view.appliances.rows).toHaveLength(9);
    expect(view.appliances.rows[0]).toMatchObject({
      name: "Aircon 1",
      applianceGroup: "Aircon",
      energy: "5,200.00 kWh",
      centreCount: 30,
      relativeToTopPct: 100,
    });
    expect(view.appliances.rows.reduce((sum, row) => sum + row.usageKwh, 0)).toBe(24_921.8123);
    expect(view.operational).toMatchObject({
      status: "available",
      hourlyProfile: {
        completeDayCount: 31,
        unit: "mean kWh per complete day",
        peakHourLabel: "11:00–12:00",
      },
      standby: { energy: "3,103.78 kWh", share: "12.5%", spikeCount: 7, centreCount: 3 },
      operating: { energy: "21,818.03 kWh", spikeCount: 21, centreCount: 14 },
      sop: {
        label: "Provisional after-hours SOP signal",
        breachingCentreCodes: ["L", "E", "N"],
        centres: [
          { centreCode: "L", standbySpikeCount: 4, score: "96" },
          { centreCode: "E", standbySpikeCount: 2, score: "98" },
          { centreCode: "N", standbySpikeCount: 1, score: "99" },
        ],
      },
    });
    if (view.operational.status !== "available") throw new Error(view.operational.detail);
    expect(view.operational.hourlyProfile.rows).toHaveLength(24);
    expect(view.operational.hourlyProfile.rows[0]).toMatchObject({
      hour: 0,
      label: "00:00–01:00",
      operatingKwh: 0,
      closedHourKwh: 13,
    });
    expect(view.operational.standby.centres[0]).toMatchObject({
      centreCode: "L",
      centreType: "Preschool",
    });
    expect(view.operational.operating.centres.find((centre) => centre.centreCode === "A"))
      .toMatchObject({ centreType: "Senior Care Center" });
    expect(view.decisionSummary.items).toHaveLength(3);
    expect(view.decisionSummary.items.map((item) => item.id)).toEqual([
      "after-hours",
      "efficiency",
      "operating",
    ]);
    expect(view.decisionSummary.items[0]).toMatchObject({
      priority: 1,
      finding: "L · E · N need after-hours checks first.",
      signal: {
        label: "Outside published hours",
        value: 12.45,
        max: 100,
        valueLabel: "12.5%",
      },
      what: "3,103.78 kWh fell outside published hours, with 7 Spikes across 3 Centres.",
      evidenceLabel: "preschool-hour-slot-spike-v1 · preschool-after-hours-sop-signal-v1",
    });
    expect(view.decisionSummary.items[1]).toMatchObject({
      priority: 2,
      finding: "G · M · J need metadata and Appliance review first.",
      signal: {
        label: "Above both Portfolio P75 lines",
        value: 3,
        max: 30,
        valueLabel: "3 / 30",
      },
    });
    expect(view.decisionSummary.items[2]).toMatchObject({
      priority: 3,
      finding: "14 Centres need operating-hour event review.",
      signal: {
        label: "Centres with operating Spikes",
        value: 14,
        max: 30,
        valueLabel: "14 / 30",
      },
      evidenceLabel: "preschool-hour-slot-spike-v1",
    });
    expect(view.decisionSummary.items.every((item) => (
      item.what.length > 0
      && item.why.length > 0
      && item.action.length > 0
      && item.ifActed.length > 0
      && item.ifIgnored.length > 0
      && item.verification.length > 0
      && item.limitation.length > 0
      && item.evidenceLabel.length > 0
    ))).toBe(true);
    expect(view.planningOutlook).toMatchObject({
      status: "provisional",
      targetPeriod: "1–30 Jun 2026",
      weeklyAverage: "5,681 kWh/week",
      projectedUsage: "24,348 kWh",
      projectedRange: "23,571–24,857 kWh",
      currentPeriodCost: "S$6,796",
      projectedCost: "S$6,640",
      projectedCostRange: "S$6,428–S$6,779",
      tariffRate: "27.27¢/kWh before GST",
      sourceWeeks: [
        { label: "4 May–10 May", usage: "5,500 kWh" },
        { label: "11 May–17 May", usage: "5,750 kWh" },
        { label: "18 May–24 May", usage: "5,675 kWh" },
        { label: "25 May–31 May", usage: "5,800 kWh" },
      ],
    });
    expect(view.liveForecast).toMatchObject({ status: "unavailable", label: "Unavailable" });
    if (view.planningOutlook.status !== "provisional") throw new Error(view.planningOutlook.detail);
    expect(view.planningOutlook.limitations.join(" ")).toContain("not the customer's contract or bill");
    expect(JSON.stringify(view.planningOutlook)).not.toMatch(/28,011|7,639|simulated actual/i);
    if (view.operational.status !== "available") throw new Error("Expected operational view");
    expect(view.operational.standby.centres[0]?.worst).toMatchObject({
      when: "25 May · 01:00–02:00",
      dayType: "Weekend",
      leadingCircuit: "Other Lighting3 · 96%",
    });
    expect(view.evidence.benchmarkRecipeIds).toEqual([
      "preschool-eui-benchmark-v1",
      "preschool-per-pax-benchmark-v1",
      "preschool-quadrant-v1",
    ]);
    expect(view.evidence.operationalRecipeIds).toEqual([
      "preschool-hour-slot-spike-v1",
      "preschool-after-hours-sop-signal-v1",
    ]);
    expect(view.evidence.planningRecipeIds).toEqual(["preschool-naive-weekly-planning-baseline-v1"]);
    expect(view.evidence.applianceRecipeIds).toEqual(["preschool-appliance-ranking-v1"]);
  });

  it("presents a Calendar exception honestly without labelling it a public holiday", () => {
    const snapshot = preschoolGoldenSnapshot();
    if (snapshot.preschoolOperational?.status !== "available") throw new Error("Expected operational fixture");
    snapshot.preschoolOperational.spikes.standby.centres[0]!.worstSpike.dayType = "calendar_exception";

    const view = buildPreschoolOverviewViewModel(snapshot);
    if (view.operational.status !== "available") throw new Error("Expected operational view");
    expect(view.operational.standby.centres[0]?.worst.dayType).toBe("Calendar exception");
    expect(view.operational.standby.centres[0]?.worst.dayType).not.toBe("Public Holiday");
  });

  it("does not infer a Day Type when reading an older cached projection without the additive field", () => {
    const snapshot = preschoolGoldenSnapshot();
    if (snapshot.preschoolOperational?.status !== "available") throw new Error("Expected operational fixture");
    Reflect.deleteProperty(snapshot.preschoolOperational.spikes.standby.centres[0]!.worstSpike, "dayType");

    const view = buildPreschoolOverviewViewModel(snapshot);
    if (view.operational.status !== "available") throw new Error("Expected operational view");
    expect(view.operational.standby.centres[0]?.worst.dayType).toBe("Unavailable");
  });

  it("shows an honest operational Unavailable state without inferring Spikes or SOP", () => {
    const snapshot = preschoolGoldenSnapshot();
    snapshot.preschoolOperational = {
      status: "unavailable",
      reason: {
        code: "PRESCHOOL_OPERATING_CALENDAR_UNAVAILABLE",
        message: "No release-pinned operating Calendar is available.",
      },
      evidence: {
        projectReleaseId: snapshot.projectRelease.id,
        dataSnapshotId: snapshot.dataSnapshot.id,
        businessCalendarVersion: snapshot.projectRelease.businessCalendarVersion,
      },
    };

    const view = buildPreschoolOverviewViewModel(snapshot);
    expect(view.operational).toEqual({
      status: "unavailable",
      detail: "No release-pinned operating Calendar is available.",
    });
    expect(view.planningOutlook).toMatchObject({ status: "unavailable" });
    expect(view.evidence.operationalRecipeIds).toEqual([]);
    expect(view.decisionSummary.items.map((item) => item.id)).toEqual(["efficiency"]);
    expect(view.decisionSummary.items.map((item) => item.priority)).toEqual([1]);
  });

  it("does not calculate percentiles in the browser when the server projection is absent", () => {
    const snapshot = preschoolGoldenSnapshot();
    delete snapshot.preschoolBenchmark;
    const view = buildPreschoolOverviewViewModel(snapshot);

    expect(view.benchmark).toMatchObject({ status: "unavailable" });
    expect(view.benchmark.detail).toContain("No client-side percentile");
    expect(view.centres.every((centre) => centre.eui === null && centre.perPax === null)).toBe(true);
    expect(view.decisionSummary.items.map((item) => item.id)).toEqual(["after-hours", "operating"]);
    expect(view.decisionSummary.items.map((item) => item.priority)).toEqual([1, 2]);
  });

  it("does not calculate an Appliance ranking in the browser when the server projection is absent", () => {
    const snapshot = preschoolGoldenSnapshot();
    delete snapshot.preschoolAppliances;

    const view = buildPreschoolOverviewViewModel(snapshot);

    expect(view.appliances).toMatchObject({ status: "unavailable" });
    expect(view.appliances.detail).toContain("server-authoritative Appliance ranking");
    expect(view.evidence.applianceRecipeIds).toEqual([]);
  });

  it("withholds all decision priorities when the Snapshot is partial", () => {
    const snapshot = preschoolGoldenSnapshot();
    snapshot.dataQuality.status = "partial";

    const view = buildPreschoolOverviewViewModel(snapshot);

    expect(view.decisionSummary.items).toEqual([]);
    expect(view.decisionSummary.detail).toContain("withheld");
    expect(view.benchmark).toMatchObject({ status: "provisional" });
    expect(view.operational).toMatchObject({ status: "available" });
  });

  it("does not backfill decision priorities when both server projections are absent", () => {
    const snapshot = preschoolGoldenSnapshot();
    delete snapshot.preschoolBenchmark;
    delete snapshot.preschoolOperational;

    const view = buildPreschoolOverviewViewModel(snapshot);

    expect(view.decisionSummary.items).toEqual([]);
    expect(view.decisionSummary.detail).toContain("no available Benchmark or Operational exception projection");
  });

  it("fails closed when the published Renderer key does not match", () => {
    const snapshot = preschoolGoldenSnapshot();
    snapshot.renderer.key = "ngee-ann-overview";
    expect(() => buildPreschoolOverviewViewModel(snapshot))
      .toThrow("PRESCHOOL_OVERVIEW_RENDERER_MISMATCH");
  });
});
