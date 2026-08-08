import { describe, expect, it } from "vitest";

import type { PreschoolBenchmarkProjection } from "./preschool-benchmark-projection.js";
import { buildPreschoolDecisionSignals } from "./preschool-decision-signals.js";
import type { PreschoolOperationalProjection } from "./preschool-operational-projection.js";

const period = {
  start: "2026-04-30T16:00:00.000Z",
  endExclusive: "2026-05-31T16:00:00.000Z",
  timezone: "Asia/Singapore",
};

describe("buildPreschoolDecisionSignals", () => {
  it("returns structured facts, entities and Evidence without customer prose templates", () => {
    const signals = buildPreschoolDecisionSignals({
      projectReleaseId: "release-1",
      dataSnapshotId: "snapshot-1",
      period,
      dataQualityStatus: "complete",
      totalCentreCount: 30,
      benchmark: benchmarkProjection(),
      operational: operationalProjection(),
    });

    expect(signals).toMatchObject({
      contract: { id: "preschool-decision-signals", version: "1" },
      context: { projectReleaseId: "release-1", dataSnapshotId: "snapshot-1", period },
      status: "available",
    });
    expect(signals.items.map((item) => [item.id, item.sectionId, item.priority])).toEqual([
      ["after-hours", "operating-behaviour", 1],
      ["efficiency", "centre-benchmark", 2],
      ["operating", "operating-behaviour", 3],
    ]);
    expect(signals.items[0]).toMatchObject({
      label: "Energy used after closing",
      metrics: expect.arrayContaining([
        expect.objectContaining({ metricId: "energy.off_hours_share_pct", value: 12.5, unit: "%", role: "primary" }),
        expect.objectContaining({ metricId: "energy.off_hours_usage_kwh", value: 3103.78, unit: "kWh" }),
      ]),
      entities: [
        { scopeId: "centre-l", code: "L", name: "Centre L" },
        { scopeId: "centre-e", code: "E", name: "Centre E" },
      ],
    });
    expect(signals.items[1]?.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ metricId: "preschool.benchmark.priority_count", value: 3 }),
      expect.objectContaining({ metricId: "preschool.benchmark.sample_size", value: 30 }),
    ]));
    expect(signals.items.every((item) => (
      item.evidenceRefs.length > 0
      && item.metrics.every((metric) => Number.isFinite(metric.value))
      && !Object.hasOwn(item, "what")
      && !Object.hasOwn(item, "why")
      && !Object.hasOwn(item, "action")
    ))).toBe(true);
  });

  it("fails closed when the Snapshot is not complete", () => {
    expect(buildPreschoolDecisionSignals({
      projectReleaseId: "release-1",
      dataSnapshotId: "snapshot-1",
      period,
      dataQualityStatus: "partial",
      totalCentreCount: 30,
      benchmark: benchmarkProjection(),
      operational: operationalProjection(),
    })).toEqual({
      contract: { id: "preschool-decision-signals", version: "1" },
      context: { projectReleaseId: "release-1", dataSnapshotId: "snapshot-1", period },
      status: "withheld",
      reason: {
        code: "SNAPSHOT_INCOMPLETE",
        message: "Decision signals are withheld because the current Snapshot is not complete.",
      },
      items: [],
    });
  });
});

function benchmarkProjection(): PreschoolBenchmarkProjection {
  return {
    status: "provisional",
    contract: { id: "preschool-may-2026-benchmark", version: "1", annualisationFactor: 12 },
    period,
    sampleSize: 30,
    portfolio: {
      eui: { p50: 10, p75: 20, unit: "kWh/m2/year" },
      perPax: { p50: 30, p75: 40, unit: "kWh/person/month" },
    },
    cohorts: [],
    centres: [
      benchmarkCentre("centre-g", "G"),
      benchmarkCentre("centre-m", "M"),
      benchmarkCentre("centre-j", "J"),
    ],
    priorityCentreCodes: ["G", "M", "J"],
    evidence: {
      projectReleaseId: "release-1",
      dataSnapshotId: "snapshot-1",
      hierarchyRevisionId: "hierarchy-1",
      meterMappingRevisionId: "mapping-1",
      metricRevisionIds: ["metric-1"],
      metadataRevisionIds: ["metadata-1"],
      sourceQueryIds: ["benchmark-query"],
      projectionRecipeIds: [
        "preschool-eui-benchmark-v1",
        "preschool-per-pax-benchmark-v1",
        "preschool-quadrant-v1",
      ],
      cohortSource: "published-hierarchy-node-metadata",
      metadataStatus: "provisional",
      normalisation: {
        eui: "May usage kWh * 12 / published comparison area m2",
        perPax: "May usage kWh / published representative headcount",
      },
    },
  };
}

function benchmarkCentre(scopeId: string, centreCode: string) {
  return {
    scopeId,
    centreCode,
    name: `Centre ${centreCode}`,
    cohort: "Preschool",
    usageKwh: 100,
    annualisedEuiKwhPerSqmYear: 20,
    mayKwhPerPerson: 40,
    quadrant: "priority" as const,
    priority: true,
  };
}

function operationalProjection(): PreschoolOperationalProjection {
  const centre = (scopeId: string, centreCode: string) => ({
    scopeId,
    centreCode,
    name: `Centre ${centreCode}`,
    centreType: "Preschool",
    spikeCount: 2,
    worstSpike: {
      localDate: "2026-05-01",
      localHour: 1,
      dayType: "weekday" as const,
      usageKwh: 5,
      baselineKwh: 2,
      impactKwh: 3,
      variancePct: 150,
      leadingCircuitName: "Aircon",
      leadingCircuitKwh: 4,
      leadingCircuitSharePct: 80,
    },
  });
  return {
    status: "available",
    contract: { id: "preschool-may-2026-operational-behaviour", version: "1", spikeThresholdPct: 50 },
    period,
    energy: { totalKwh: 24921.81, standbyKwh: 3103.78, standbySharePct: 12.5, operatingKwh: 21818.03 },
    hourlyProfile: { completeDayCount: 31, unit: "mean kWh per complete day", rows: [] },
    planningOutlook: {
      status: "unavailable",
      reason: { code: "PRESCHOOL_PLANNING_BASELINE_INCOMPLETE", message: "Unavailable in this fixture." },
    },
    spikes: {
      standby: { count: 7, centreCount: 2, centres: [centre("centre-l", "L"), centre("centre-e", "E")] },
      operating: { count: 21, centreCount: 2, centres: [centre("centre-g", "G"), centre("centre-m", "M")] },
    },
    sop: {
      status: "provisional",
      label: "Provisional after-hours SOP signal",
      baselineScore: 100,
      deductionPerStandbySpike: 1,
      breachingCentreCodes: ["L", "E"],
      centres: [
        { scopeId: "centre-l", centreCode: "L", name: "Centre L", centreType: "Preschool", standbySpikeCount: 2, score: 98 },
        { scopeId: "centre-e", centreCode: "E", name: "Centre E", centreType: "Preschool", standbySpikeCount: 2, score: 98 },
      ],
    },
    evidence: {
      projectReleaseId: "release-1",
      dataSnapshotId: "snapshot-1",
      hierarchyRevisionId: "hierarchy-1",
      meterMappingRevisionId: "mapping-1",
      metricRevisionIds: ["metric-1"],
      businessCalendarVersion: "calendar-1",
      sourceQueryIds: ["operational-query"],
      projectionQueryId: "preschool_centre_hour_cells_v1",
      projectionRecipeIds: ["preschool-hour-slot-spike-v1", "preschool-after-hours-sop-signal-v1"],
      baseline: "same-centre same-hour-slot mean within operating state",
    },
  };
}
