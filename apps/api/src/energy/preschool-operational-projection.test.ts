import {
  LocalDataGateway,
  type EnergyIntervalFactWrite,
} from "@datafoundry/data-gateway";
import {
  createMetadataStore,
  type EnergyIqOperatingCalendarRevision,
} from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import { materializeTestProjectSnapshot } from "./energy-test-materialization.js";
import type { ProjectAnalysisPayload } from "./project-analysis-metadata.js";
import type { PublishedProjectRelease } from "./project-analysis-resolver.js";
import {
  buildPreschoolOperationalProjection,
  loadPreschoolOperationalProjection,
  type PreschoolOperationalCell,
} from "./preschool-operational-projection.js";
import { resolveEnergyPublishedMeterRoute } from "./energy-query-context.js";

const centreCodes = [
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J",
  "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T",
  "U", "V", "W", "X", "Y", "Z", "AA", "AB", "AC", "AD",
];
const applianceCircuits = [
  ["plug-load3", "Plug Load3", "load", 0.4],
  ["kitchen-plug-load", "Kitchen Plug Load", "load", 0.3],
  ["living-area-plug-load", "Living Area Plug Load", "load", 0.274],
  ["aircon-1", "Aircon 1", "aircon", 0.012],
  ["aircon-2", "Aircon 2", "aircon", 0.008],
  ["kitchen-lighting", "Kitchen Lighting", "light", 0.002],
  ["living-room-lighting", "Living Room Lighting", "light", 0.002],
  ["other-lighting3", "Other Lighting3", "light", 0.001],
  ["heater", "Heater", "load", 0.001],
] as const;

describe("Preschool operational projection", () => {
  it("reproduces the May Spike and provisional after-hours SOP Golden", () => {
    const cells = mayCells();
    const standbySpikes = [
      ["L", "2026-05-25", 1],
      ["L", "2026-05-15", 20],
      ["L", "2026-05-15", 1],
      ["L", "2026-05-15", 19],
      ["E", "2026-05-04", 23],
      ["E", "2026-05-08", 5],
      ["N", "2026-05-08", 22],
    ] as const;
    standbySpikes.forEach(([code, localDate, localHour]) => setUsage(cells, code, localDate, localHour, 20));

    for (let localHour = 7; localHour < 15; localHour += 1) {
      setUsage(cells, "A", "2026-05-18", localHour, 40);
    }
    centreCodes.slice(1, 14).forEach((code) => setUsage(cells, code, "2026-05-18", 15, 40));

    const projection = buildPreschoolOperationalProjection({
      projectRelease: release(),
      dataSnapshotId: "preschool-snapshot-may-2026",
      period: {
        start: "2026-04-30T16:00:00.000Z",
        endExclusive: "2026-05-31T16:00:00.000Z",
      },
      timezone: "Asia/Singapore",
      analysis: analysis(),
      calendar: calendar(),
      centres: centreCodes.map((code) => ({
        scopeId: scopeId(code),
        centreCode: code,
        name: `Centre ${code}`,
        centreType: null,
      })),
      cells,
    });

    expect(projection.status).toBe("available");
    if (projection.status !== "available") throw new Error("Expected available projection");
    expect(projection.contract.version).toBe("3");
    expect(projection.energy).toEqual({
      totalKwh: 24_921.8123,
      standbyKwh: 3_103.784,
      standbySharePct: 12.45,
      operatingKwh: 21_818.0283,
      operatingSharePct: 87.5459,
      provisionalStandbyCostBeforeGstSgd: 846.4019,
      provisionalOperatingCostBeforeGstSgd: 5_949.7763,
    });
    expect(projection.tariffReference).toMatchObject({
      sourceName: "SP Group",
      beforeGstSgdPerKwh: 0.2727,
      supplyClass: "Low tension, non-domestic",
    });
    expect(projection.standbyAppliances).toMatchObject({
      totalKwh: 3_103.784,
      provisionalCostBeforeGstSgd: 846.4019,
      reconciliationGapKwh: 0,
    });
    expect(projection.standbyAppliances.applianceGroups.map((group) => [group.name, group.sharePct]))
      .toEqual([
        ["Plugload", 97.4],
        ["Aircon", 2],
        ["Lighting", 0.5],
        ["Heater", 0.1],
      ]);
    expect(projection.standbyAppliances.appliances).toHaveLength(9);
    expect(projection.standbyAppliances.appliances.every((appliance) => (
      appliance.centreCount === 30 && appliance.sourceCircuitIds.length === 30
    ))).toBe(true);
    expect(projection.operatingAppliances).toMatchObject({
      totalKwh: 21_818.0283,
      provisionalCostBeforeGstSgd: 5_949.7763,
      reconciliationGapKwh: 0,
    });
    expect(projection.operatingAppliances.applianceGroups.map((group) => [group.name, group.sharePct]))
      .toEqual([
        ["Plugload", 97.4],
        ["Aircon", 2],
        ["Lighting", 0.5],
        ["Heater", 0.1],
      ]);
    expect(projection.operatingAppliances.appliances).toHaveLength(9);
    expect(projection.operatingAppliances.appliances.every((appliance) => (
      appliance.centreCount === 30 && appliance.sourceCircuitIds.length === 30
    ))).toBe(true);
    expect(projection.hourlyProfile).toMatchObject({
      completeDayCount: 31,
      unit: "mean kWh per complete day",
    });
    expect(projection.hourlyProfile.rows).toHaveLength(24);
    expect(projection.hourlyProfile.rows[7]).toMatchObject({ localHour: 7 });
    expect(projection.planningOutlook).toMatchObject({
      status: "unavailable",
      reason: { code: "PRESCHOOL_PLANNING_BASELINE_INCOMPLETE" },
    });
    expect(projection.spikes.standby).toMatchObject({ count: 7, centreCount: 3 });
    expect(projection.spikes.operating).toMatchObject({ count: 21, centreCount: 14 });
    expect(projection.spikes.standby.centres.map((centre) => [centre.centreCode, centre.spikeCount]))
      .toEqual([["L", 4], ["E", 2], ["N", 1]]);
    expect(projection.spikes.standby.centres.map((centre) => centre.events.length)).toEqual([4, 2, 1]);
    expect(projection.spikes.standby.centres[0]?.events).toEqual(
      [...projection.spikes.standby.centres[0]!.events].sort((left, right) => (
        right.variancePct - left.variancePct
        || left.localDate.localeCompare(right.localDate)
        || left.localHour - right.localHour
      )),
    );
    expect(projection.sop.breachingCentreCodes).toEqual(["L", "E", "N"]);
    expect(projection.sop.centres.slice(0, 3).map((centre) => [centre.centreCode, centre.score]))
      .toEqual([["L", 96], ["E", 98], ["N", 99]]);
    expect(projection.sop).toMatchObject({
      status: "provisional",
      label: "Provisional after-hours SOP signal",
      baselineScore: 100,
      deductionPerStandbySpike: 1,
    });
    expect(projection.evidence).toMatchObject({
      projectReleaseId: "preschool-release-v1",
      dataSnapshotId: "preschool-snapshot-may-2026",
      hierarchyRevisionId: "preschool-hierarchy-v5",
      meterMappingRevisionId: "preschool-mapping-v5",
      businessCalendarVersion: "preschool-calendar-v1",
      projectionQueryId: "preschool_centre_hour_appliance_cells_v2",
      projectionRecipeIds: [
        "preschool-hour-slot-spike-v1",
        "preschool-after-hours-sop-signal-v1",
        "preschool-operating-state-appliance-v1",
      ],
    });
  });

  it.each([
    {
      phase: "Day 1",
      firstLocalDate: "2026-05-05",
      start: "2026-05-04T16:00:00.000Z",
      endExclusive: "2026-06-01T16:00:00.000Z",
    },
    {
      phase: "Day 7",
      firstLocalDate: "2026-05-11",
      start: "2026-05-10T16:00:00.000Z",
      endExclusive: "2026-06-07T16:00:00.000Z",
    },
  ])("derives the 28-day May/June Operational window from the $phase context", ({
    firstLocalDate,
    start,
    endExclusive,
  }) => {
    const cells = rollingWindowCells(firstLocalDate, 28);
    const dataSnapshotId = `preschool-snapshot-${firstLocalDate}`;
    const rollingCalendar = calendar();
    rollingCalendar.entries[0]!.effective_to = "2026-07-01";

    const projectionInput = {
      projectRelease: release(),
      dataSnapshotId,
      period: { start, endExclusive },
      timezone: "Asia/Singapore",
      analysis: analysisForCells(cells, dataSnapshotId),
      calendar: rollingCalendar,
      centres: centreCodes.map((code) => ({
        scopeId: scopeId(code),
        centreCode: code,
        name: `Centre ${code}`,
        centreType: null,
      })),
      cells,
    };
    const projection = buildPreschoolOperationalProjection(projectionInput);

    expect(cells).toHaveLength(20_160);
    expect(projection.status).toBe("available");
    if (projection.status !== "available") throw new Error(projection.reason.message);
    expect(projection.contract.version).toBe("3");
    expect(projection.period).toEqual({ start, endExclusive, timezone: "Asia/Singapore" });
    expect(projection.hourlyProfile).toMatchObject({
      completeDayCount: 28,
      unit: "mean kWh per complete day",
    });
    expect(projection.hourlyProfile.rows).toHaveLength(24);
    expect(projection.planningOutlook).toMatchObject({
      status: "unavailable",
      reason: { code: "PRESCHOOL_PLANNING_BASELINE_INCOMPLETE" },
    });
    expect(buildPreschoolOperationalProjection({
      ...projectionInput,
      cells: cells.slice(0, -1),
    })).toMatchObject({
      status: "unavailable",
      reason: { code: "PRESCHOOL_OPERATIONAL_FACTS_UNAVAILABLE" },
    });
  });

  it("fails a rolling window closed when the release-pinned Calendar does not cover its complete period", () => {
    const cells = rollingWindowCells("2026-05-11", 28);
    const dataSnapshotId = "preschool-snapshot-rolling-calendar-gap";

    const projection = buildPreschoolOperationalProjection({
      projectRelease: release(),
      dataSnapshotId,
      period: {
        start: "2026-05-10T16:00:00.000Z",
        endExclusive: "2026-06-07T16:00:00.000Z",
      },
      timezone: "Asia/Singapore",
      analysis: analysisForCells(cells, dataSnapshotId),
      calendar: calendar(),
      centres: centreCodes.map((code) => ({
        scopeId: scopeId(code),
        centreCode: code,
        name: `Centre ${code}`,
        centreType: null,
      })),
      cells,
    });

    expect(projection).toMatchObject({
      status: "unavailable",
      reason: { code: "PRESCHOOL_OPERATIONAL_CONTRACT_UNSUPPORTED" },
    });
  });

  it("does not generalise Operational beyond the accepted May/June fixture range", () => {
    const cells = rollingWindowCells("2026-07-01", 28);
    const dataSnapshotId = "preschool-snapshot-arbitrary-july-window";
    const julyCalendar = calendar();
    julyCalendar.entries[0]!.effective_to = "2026-08-01";

    const projection = buildPreschoolOperationalProjection({
      projectRelease: release(),
      dataSnapshotId,
      period: {
        start: "2026-06-30T16:00:00.000Z",
        endExclusive: "2026-07-28T16:00:00.000Z",
      },
      timezone: "Asia/Singapore",
      analysis: analysisForCells(cells, dataSnapshotId),
      calendar: julyCalendar,
      centres: centreCodes.map((code) => ({
        scopeId: scopeId(code),
        centreCode: code,
        name: `Centre ${code}`,
        centreType: null,
      })),
      cells,
    });

    expect(projection).toMatchObject({
      status: "unavailable",
      reason: { code: "PRESCHOOL_OPERATIONAL_CONTRACT_UNSUPPORTED" },
    });
  });

  it("accepts release-scoped Circuit identities and exposes user-facing Appliance aliases", () => {
    const cells = mayCells();

    const projection = buildPreschoolOperationalProjection({
      projectRelease: release(),
      dataSnapshotId: "preschool-snapshot-may-2026",
      period: {
        start: "2026-04-30T16:00:00.000Z",
        endExclusive: "2026-05-31T16:00:00.000Z",
      },
      timezone: "Asia/Singapore",
      analysis: analysis(),
      calendar: calendar(),
      centres: centreCodes.map((code) => ({
        scopeId: scopeId(code),
        centreCode: code,
        name: `Centre ${code}`,
        centreType: null,
      })),
      cells,
    });

    expect(projection.status).toBe("available");
    if (projection.status !== "available") throw new Error(projection.reason.message);
    expect(projection.standbyAppliances.appliances.map((appliance) => appliance.name))
      .toContain("Living Area Plug Load");
    expect(projection.standbyAppliances.appliances.some((appliance) => appliance.name.includes(":")))
      .toBe(false);
  });

  it("builds a transparent June planning baseline from four complete May weeks and the official demo tariff reference", () => {
    const projection = buildPreschoolOperationalProjection({
      projectRelease: release(),
      dataSnapshotId: "preschool-snapshot-may-2026",
      period: {
        start: "2026-04-30T16:00:00.000Z",
        endExclusive: "2026-05-31T16:00:00.000Z",
      },
      timezone: "Asia/Singapore",
      analysis: planningAnalysis(),
      calendar: calendar(),
      centres: centreCodes.map((code) => ({
        scopeId: scopeId(code),
        centreCode: code,
        name: `Centre ${code}`,
        centreType: null,
      })),
      cells: mayCells(),
    });

    if (projection.status !== "available") throw new Error(projection.reason.message);
    expect(projection.planningOutlook).toMatchObject({
      status: "provisional",
      contract: {
        id: "preschool-june-2026-naive-weekly-baseline",
        method: "mean of four complete Monday-Sunday weeks",
      },
      sourceWeeks: [
        { start: "2026-05-04", endInclusive: "2026-05-10", usageKwh: 749 },
        { start: "2026-05-11", endInclusive: "2026-05-17", usageKwh: 798 },
        { start: "2026-05-18", endInclusive: "2026-05-24", usageKwh: 847 },
        { start: "2026-05-25", endInclusive: "2026-05-31", usageKwh: 896 },
      ],
      weeklyBaseline: { averageKwh: 822.5, minimumKwh: 749, maximumKwh: 896 },
      usageEstimate: { projectedKwh: 3_525, lowerKwh: 3_210, upperKwh: 3_840 },
      costEstimate: {
        currentPeriodBeforeGstSgd: 980.6292,
        projectedBeforeGstSgd: 961.2675,
        lowerBeforeGstSgd: 875.367,
        upperBeforeGstSgd: 1_047.168,
      },
      tariffReference: {
        sourceName: "SP Group",
        supplyClass: "Low tension, non-domestic",
        appliesFrom: "2026-04-01",
        appliesTo: "2026-06-30",
        beforeGstSgdPerKwh: 0.2727,
        withGstSgdPerKwh: 0.2972,
      },
      evidence: {
        dataSnapshotId: "preschool-snapshot-may-2026",
        queryId: "daily_totals_v1",
        recipeId: "preschool-naive-weekly-planning-baseline-v1",
      },
      estimateSeries: {
        contract: {
          id: "preschool-june-2026-estimate-series",
          version: "1",
        },
        scopes: [
          { scopeId: "preschool-project", scopeName: "Preschool Portfolio", scopeRole: "portfolio", estimatedKwh: 3525 },
          { scopeId: "centre-a", scopeName: "Centre A", scopeRole: "centre", estimatedKwh: 2115 },
          { scopeId: "centre-b", scopeName: "Centre B", scopeRole: "centre", estimatedKwh: 1410 },
        ],
      },
    });
    if (projection.planningOutlook.status !== "provisional") throw new Error(projection.planningOutlook.reason.message);
    const estimateSeries = Reflect.get(projection.planningOutlook, "estimateSeries") as {
      scopes: Array<{
        estimatedKwh: number;
        estimatedCostBeforeGstSgd: number;
        buckets: Record<"daily" | "weekly" | "monthly", Array<{ estimatedKwh: number }>>;
      }>;
    };
    expect(estimateSeries.scopes[0]?.buckets.daily).toHaveLength(30);
    expect(estimateSeries.scopes[0]?.buckets.weekly).toHaveLength(5);
    expect(estimateSeries.scopes[0]?.buckets.monthly).toHaveLength(1);
    expect(estimateSeries.scopes[0]?.buckets.daily.reduce((total, bucket) => total + bucket.estimatedKwh, 0)).toBeCloseTo(3525, 2);
    expect(estimateSeries.scopes[0]?.estimatedCostBeforeGstSgd).toBe(961.2675);
  });

  it("classifies each worst Spike from the published Calendar without assuming every exception is a public holiday", () => {
    const cells = mayCells();
    setUsage(cells, "A", "2026-05-27", 1, 20);
    setUsage(cells, "B", "2026-05-24", 1, 20);
    setUsage(cells, "C", "2026-05-26", 1, 20);

    const projection = buildPreschoolOperationalProjection({
      projectRelease: release(),
      dataSnapshotId: "preschool-snapshot-may-2026",
      period: {
        start: "2026-04-30T16:00:00.000Z",
        endExclusive: "2026-05-31T16:00:00.000Z",
      },
      timezone: "Asia/Singapore",
      analysis: analysis(),
      calendar: calendar(),
      centres: centreCodes.map((code) => ({
        scopeId: scopeId(code),
        centreCode: code,
        name: `Centre ${code}`,
        centreType: null,
      })),
      cells,
    });

    expect(projection.status).toBe("available");
    if (projection.status !== "available") throw new Error("Expected available projection");
    expect(projection.spikes.standby.centres.find((centre) => centre.centreCode === "A")?.worstSpike.dayType)
      .toBe("calendar_exception");
    expect(projection.spikes.standby.centres.find((centre) => centre.centreCode === "B")?.worstSpike.dayType)
      .toBe("weekend");
    expect(projection.spikes.standby.centres.find((centre) => centre.centreCode === "C")?.worstSpike.dayType)
      .toBe("weekday");
  });

  it("fails the optional module closed when Calendar Evidence does not match the Release", () => {
    const mismatchedCalendar = calendar();
    mismatchedCalendar.version_id = "another-calendar";
    const projection = buildPreschoolOperationalProjection({
      projectRelease: release(),
      dataSnapshotId: "preschool-snapshot-may-2026",
      period: {
        start: "2026-04-30T16:00:00.000Z",
        endExclusive: "2026-05-31T16:00:00.000Z",
      },
      timezone: "Asia/Singapore",
      analysis: analysis(),
      calendar: mismatchedCalendar,
      centres: centreCodes.map((code) => ({ scopeId: scopeId(code), centreCode: code, name: `Centre ${code}`, centreType: null })),
      cells: mayCells(),
    });

    expect(projection).toMatchObject({
      status: "unavailable",
      reason: { code: "PRESCHOOL_OPERATIONAL_EVIDENCE_MISMATCH" },
    });
  });

  it("fails closed when the unique Calendar entry does not cover the complete May window", () => {
    const truncatedCalendar = calendar();
    truncatedCalendar.entries[0]!.effective_to = "2026-05-31";
    const projection = buildPreschoolOperationalProjection({
      projectRelease: release(),
      dataSnapshotId: "preschool-snapshot-may-2026",
      period: {
        start: "2026-04-30T16:00:00.000Z",
        endExclusive: "2026-05-31T16:00:00.000Z",
      },
      timezone: "Asia/Singapore",
      analysis: analysis(),
      calendar: truncatedCalendar,
      centres: centreCodes.map((code) => ({ scopeId: scopeId(code), centreCode: code, name: `Centre ${code}`, centreType: null })),
      cells: mayCells(),
    });

    expect(projection).toMatchObject({
      status: "unavailable",
      reason: { code: "PRESCHOOL_OPERATIONAL_CONTRACT_UNSUPPORTED" },
    });
  });

  it("does not infer an operating schedule when the Calendar is unavailable", () => {
    const unavailableAnalysis = analysis();
    unavailableAnalysis.offHours = {
      status: "unavailable",
      reason: {
        code: "OPERATING_CALENDAR_VERSION_NOT_FOUND",
        message: "The release-pinned Calendar is unavailable.",
      },
      businessCalendarVersion: "preschool-calendar-v1",
    };
    const projection = buildPreschoolOperationalProjection({
      projectRelease: release(),
      dataSnapshotId: "preschool-snapshot-may-2026",
      period: {
        start: "2026-04-30T16:00:00.000Z",
        endExclusive: "2026-05-31T16:00:00.000Z",
      },
      timezone: "Asia/Singapore",
      analysis: unavailableAnalysis,
      calendar: calendar(),
      centres: [],
      cells: [],
    });

    expect(projection).toMatchObject({
      status: "unavailable",
      reason: {
        code: "PRESCHOOL_OPERATING_CALENDAR_UNAVAILABLE",
        message: "The release-pinned Calendar is unavailable.",
      },
    });
  });

  it("loads the Day 7 rolling window through one Snapshot-scoped Centre-hour query", async () => {
    const root = mkdtempSync(join(tmpdir(), "preschool-operational-rolling-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      const testCells = rollingWindowCells("2026-05-11", 28);
      const snapshot = await materializeTestProjectSnapshot({
        metadataStore: metadata,
        databasePath,
        workspaceId: "preschool-demo-org",
        projectId: "preschool-demo",
        timezone: "Asia/Singapore",
        batches: [{
          importBatchId: "preschool-operational-query-fixture",
          sourceSha256: "preschool-operational-query-fixture",
          rawReadings: [],
          normalizedReadings: [],
          intervalFacts: cellsToFacts(testCells),
          qualityEvents: [],
        }],
      });
      const rollingCalendar = calendar();
      rollingCalendar.entries[0]!.effective_to = "2026-07-01";
      metadata.energyIq.operationalPolicy.publishOperatingCalendar({
        version_id: "preschool-calendar-v1",
        project_id: "preschool-demo",
        entries: rollingCalendar.entries,
        published_by: "dev-user",
      });
      const project = metadata.energyIq.getProject("preschool-demo");
      const route = resolveEnergyPublishedMeterRoute({
        metadataStore: metadata,
        projectId: project.id,
        hierarchyRevisionId: project.hierarchy_revision_id,
        scopeId: project.root_scope_id,
        resource: "electricity",
      });
      const publishedRelease = {
        ...release(),
        hierarchyRevisionId: project.hierarchy_revision_id,
        meterMappingRevisionId: route.meterMappingRevisionId,
        meterFormulaRevisionId: project.meter_formula_revision_id,
      };
      const rollingAnalysis = analysisForCells(testCells, snapshot.id);
      const projectedAnalysis = {
        ...rollingAnalysis,
        childScopes: centreCodes.map((code) => ({ nodeId: scopeId(code), name: `Centre ${code}` })),
        provenance: {
          ...rollingAnalysis.provenance,
          hierarchyRevisionId: project.hierarchy_revision_id,
          meterMappingRevisionId: route.meterMappingRevisionId,
          meterFormulaRevisionId: project.meter_formula_revision_id,
          metricVersion: project.metric_version,
        },
      } as ProjectAnalysisPayload;
      const projection = await loadPreschoolOperationalProjection({
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        projectRelease: publishedRelease,
        context: {
          userId: "dev-user",
          workspaceId: "preschool-demo-org",
          projectId: "preschool-demo",
          projectName: "Preschool Portfolio",
          scopeId: project.root_scope_id,
          scopeName: "Preschool Portfolio",
          scopeType: "project",
          resource: "electricity",
          period: "Custom",
          from: "2026-05-10T16:00:00.000Z",
          to: "2026-06-07T16:00:00.000Z",
          endExclusive: true,
          timezone: "Asia/Singapore",
          hierarchyRevisionId: project.hierarchy_revision_id,
          meterMappingRevisionId: route.meterMappingRevisionId,
          meterFormulaRevisionId: project.meter_formula_revision_id,
          dataSnapshotId: snapshot.id,
          metricVersion: project.metric_version,
          businessCalendarVersion: "preschool-calendar-v1",
          tariffScheduleVersion: "",
          resolvedAt: "2026-08-10T00:00:00.000Z",
        },
        analysis: projectedAnalysis,
        databasePath,
      });

      if (projection.status !== "available") throw new Error(projection.reason.message);
      expect(projection).toMatchObject({
        status: "available",
        contract: { version: "3" },
        period: {
          start: "2026-05-10T16:00:00.000Z",
          endExclusive: "2026-06-07T16:00:00.000Z",
          timezone: "Asia/Singapore",
        },
        hourlyProfile: { completeDayCount: 28 },
        evidence: {
          dataSnapshotId: snapshot.id,
          hierarchyRevisionId: project.hierarchy_revision_id,
          meterMappingRevisionId: route.meterMappingRevisionId,
          businessCalendarVersion: "preschool-calendar-v1",
        },
      });
    } finally {
      metadata.close();
      removeTemporaryFixture(root);
    }
  }, 30_000);

  it("runs the Golden through one Snapshot-scoped Centre-hour query", async () => {
    const root = mkdtempSync(join(tmpdir(), "preschool-operational-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      const testCells = mayCells();
      const standbySpikes = [
        ["L", "2026-05-25", 1], ["L", "2026-05-15", 20],
        ["L", "2026-05-15", 1], ["L", "2026-05-15", 19],
        ["E", "2026-05-04", 23], ["E", "2026-05-08", 5], ["N", "2026-05-08", 22],
      ] as const;
      standbySpikes.forEach(([code, localDate, localHour]) => setUsage(testCells, code, localDate, localHour, 20));
      for (let localHour = 7; localHour < 15; localHour += 1) {
        setUsage(testCells, "A", "2026-05-18", localHour, 40);
      }
      centreCodes.slice(1, 14).forEach((code) => setUsage(testCells, code, "2026-05-18", 15, 40));

      const facts = cellsToFacts(testCells);
      const snapshot = await materializeTestProjectSnapshot({
        metadataStore: metadata,
        databasePath,
        workspaceId: "preschool-demo-org",
        projectId: "preschool-demo",
        timezone: "Asia/Singapore",
        batches: [{
          importBatchId: "preschool-operational-query-fixture",
          sourceSha256: "preschool-operational-query-fixture",
          rawReadings: [],
          normalizedReadings: [],
          intervalFacts: facts,
          qualityEvents: [],
        }],
      });
      metadata.energyIq.operationalPolicy.publishOperatingCalendar({
        version_id: "preschool-calendar-v1",
        project_id: "preschool-demo",
        entries: calendar().entries,
        published_by: "dev-user",
      });
      const project = metadata.energyIq.getProject("preschool-demo");
      const route = resolveEnergyPublishedMeterRoute({
        metadataStore: metadata,
        projectId: project.id,
        hierarchyRevisionId: project.hierarchy_revision_id,
        scopeId: project.root_scope_id,
        resource: "electricity",
      });
      const publishedRelease = {
        ...release(),
        hierarchyRevisionId: project.hierarchy_revision_id,
        meterMappingRevisionId: route.meterMappingRevisionId,
        meterFormulaRevisionId: project.meter_formula_revision_id,
      };
      const projectedAnalysis = {
        ...analysis(),
        childScopes: centreCodes.map((code) => ({ nodeId: scopeId(code), name: `Centre ${code}` })),
        provenance: {
          ...analysis().provenance,
          dataSnapshotId: snapshot.id,
          hierarchyRevisionId: project.hierarchy_revision_id,
          meterMappingRevisionId: route.meterMappingRevisionId,
          meterFormulaRevisionId: project.meter_formula_revision_id,
          metricVersion: project.metric_version,
        },
      } as ProjectAnalysisPayload;
      const projection = await loadPreschoolOperationalProjection({
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        projectRelease: publishedRelease,
        context: {
          userId: "dev-user",
          workspaceId: "preschool-demo-org",
          projectId: "preschool-demo",
          projectName: "Preschool Portfolio",
          scopeId: project.root_scope_id,
          scopeName: "Preschool Portfolio",
          scopeType: "project",
          resource: "electricity",
          period: "Custom",
          from: "2026-04-30T16:00:00.000Z",
          to: "2026-05-31T16:00:00.000Z",
          endExclusive: true,
          timezone: "Asia/Singapore",
          hierarchyRevisionId: project.hierarchy_revision_id,
          meterMappingRevisionId: route.meterMappingRevisionId,
          meterFormulaRevisionId: project.meter_formula_revision_id,
          dataSnapshotId: snapshot.id,
          metricVersion: project.metric_version,
          businessCalendarVersion: "preschool-calendar-v1",
          tariffScheduleVersion: "",
          resolvedAt: "2026-08-06T00:00:00.000Z",
        },
        analysis: projectedAnalysis,
        databasePath,
      });

      if (projection.status !== "available") throw new Error(projection.reason.message);
      expect(projection.status).toBe("available");
      expect(projection.contract.version).toBe("3");
      expect(projection.spikes.standby).toMatchObject({ count: 7, centreCount: 3 });
      expect(projection.spikes.operating).toMatchObject({ count: 21, centreCount: 14 });
      expect(projection.sop.breachingCentreCodes).toEqual(["L", "E", "N"]);
      expect(projection.spikes.operating.centres.find((centre) => centre.centreCode === "A")?.worstSpike)
        .toMatchObject({ leadingCircuitName: "Plug Load3", leadingCircuitSharePct: 100 });
      expect(projection.standbyAppliances).toMatchObject({
        totalKwh: 3_103.784,
        reconciliationGapKwh: 0,
      });
      expect(new Set(projection.standbyAppliances.applianceGroups.map((group) => group.name)))
        .toEqual(new Set(["Plugload", "Aircon", "Lighting", "Heater"]));
      expect(projection.operatingAppliances).toMatchObject({
        totalKwh: 21_818.0283,
        reconciliationGapKwh: 0,
      });
      expect(projection.operatingAppliances.applianceGroups.map((group) => [group.name, group.sharePct]))
        .toEqual([["Plugload", 100]]);
      expect(projection.operatingAppliances.appliances).toHaveLength(1);
      expect(projection.operatingAppliances.appliances[0]).toMatchObject({
        name: "Plug Load3",
        applianceGroup: "Plugload",
        sharePct: 100,
        centreCount: 30,
      });
      expect(projection.spikes.operating.centres.find((centre) => centre.centreCode === "A"))
        .toMatchObject({ centreType: "Senior Care Center" });
      expect(projection.sop.centres.find((centre) => centre.centreCode === "L"))
        .toMatchObject({ centreType: "Preschool" });
      expect(projection.evidence).toMatchObject({
        dataSnapshotId: snapshot.id,
        hierarchyRevisionId: project.hierarchy_revision_id,
        meterMappingRevisionId: route.meterMappingRevisionId,
        businessCalendarVersion: "preschool-calendar-v1",
      });
    } finally {
      metadata.close();
      removeTemporaryFixture(root);
    }
  }, 30_000);
});

const release = (): PublishedProjectRelease => ({
  id: "preschool-release-v1",
  source: "template-revision",
  projectId: "preschool-demo",
  templateRevisionId: "preschool-release-v1",
  templateRevisionSequence: 1,
  recipe: { id: "energy-scope-analysis", version: "1" },
  renderer: { key: "preschool-overview", version: "1", contractVersion: "project-analysis-snapshot@1" },
  hierarchyRevisionId: "preschool-hierarchy-v5",
  meterMappingRevisionId: "preschool-mapping-v5",
  meterFormulaRevisionId: "preschool-formula-v1",
  metricRevisionIds: ["energy.total_usage_kwh@1"],
  ruleRevisionIds: [],
  businessCalendarVersion: "preschool-calendar-v1",
  tariffScheduleVersion: "",
  publishedAt: "2026-08-06T00:00:00.000Z",
  document: { schema_version: 2, templates: [] },
  catalog: [],
});

const analysis = (): Pick<ProjectAnalysisPayload, "offHours" | "provenance"> => ({
  offHours: {
    status: "available",
    operatingKwh: 21_818.0283,
    standbyKwh: 3_103.784,
    usageKwh: 3_103.784,
    sharePct: 12.45,
    timezone: "Asia/Singapore",
    businessCalendarVersion: "preschool-calendar-v1",
  },
  provenance: {
    dataSnapshotId: "preschool-snapshot-may-2026",
    hierarchyRevisionId: "preschool-hierarchy-v5",
    meterMappingRevisionId: "preschool-mapping-v5",
    meterFormulaRevisionId: "preschool-formula-v1",
    metricVersion: "metric-v1",
    ruleRevisionIds: [],
    aggregationRule: "component",
    sourceView: "energy_scope_fixture",
    queryIds: ["scope_summary_v1", "operational_policy_scope_intervals_v1"],
  },
});

const planningAnalysis = (): Pick<ProjectAnalysisPayload, "offHours" | "provenance"> & {
  context: Pick<ProjectAnalysisPayload["context"], "scopeId">;
  dailyTotals: NonNullable<ProjectAnalysisPayload["dailyTotals"]>;
} => ({
  ...analysis(),
  provenance: {
    ...analysis().provenance,
    queryIds: [...analysis().provenance.queryIds, "daily_totals_v1"],
  },
  context: { scopeId: "preschool-project" },
  dailyTotals: {
    metricId: "energy.total_usage_kwh@1",
    grain: "day",
    timezone: "Asia/Singapore",
    scopes: [
      { scopeId: "preschool-project", scopeName: "Preschool Portfolio", scopeType: "project", share: 1 },
      { scopeId: "centre-a", scopeName: "Centre A", scopeType: "centre", share: 0.6 },
      { scopeId: "centre-b", scopeName: "Centre B", scopeType: "centre", share: 0.4 },
    ].map((scope) => ({
      scopeId: scope.scopeId,
      scopeName: scope.scopeName,
      scopeType: scope.scopeType,
      rows: Array.from({ length: 31 }, (_, index) => {
        const day = index + 1;
        const localDate = `2026-05-${String(day).padStart(2, "0")}`;
        return {
          localDate,
          from: `${localDate}T00:00:00.000+08:00`,
          to: `${localDate}T23:59:59.999+08:00`,
          usageKwh: (100 + day) * scope.share,
          dataHealth: {
            status: "complete" as const,
            coveragePct: 100,
            expectedMeterIntervalCount: 2_880,
            validIntervalCount: 2_880,
            qualityEventCount: 0,
          },
        };
      }),
    })),
  },
});

const calendar = (): EnergyIqOperatingCalendarRevision => ({
  version_id: "preschool-calendar-v1",
  project_id: "preschool-demo",
  timezone: "Asia/Singapore",
  entries: [{
    id: "preschool-project-hours",
    owner: { kind: "project" },
    effective_from: "2026-05-01",
    effective_to: "2026-06-01",
    weekly: {
      monday: [{ from: "07:00", to: "19:00" }],
      tuesday: [{ from: "07:00", to: "19:00" }],
      wednesday: [{ from: "07:00", to: "19:00" }],
      thursday: [{ from: "07:00", to: "19:00" }],
      friday: [{ from: "07:00", to: "19:00" }],
      saturday: [],
      sunday: [],
    },
    exceptions: [
      { date: "2026-05-01", operating: [], label: "Labour Day" },
      { date: "2026-05-27", operating: [], label: "Hari Raya Haji" },
    ],
  }],
  published_by: "dev-user",
  published_at: "2026-08-06T00:00:00.000Z",
});

const mayCells = (): PreschoolOperationalCell[] => {
  const cells: PreschoolOperationalCell[] = [];
  for (const centreCode of centreCodes) {
    for (let day = 1; day <= 31; day += 1) {
      const localDate = `2026-05-${String(day).padStart(2, "0")}`;
      const weekday = new Date(`${localDate}T00:00:00.000Z`).getUTCDay();
      const closed = weekday === 0 || weekday === 6 || day === 1 || day === 27;
      for (let localHour = 0; localHour < 24; localHour += 1) {
        const operating = !closed && localHour >= 7 && localHour < 19;
        cells.push({
          scopeId: scopeId(centreCode),
          localDate,
          localHour,
          usageKwh: operating ? 10 : 1,
          leadingCircuitName: `${scopeId(centreCode)}:Plug Load3`,
          leadingCircuitKwh: (operating ? 10 : 1) * applianceCircuits[0][3],
          circuits: applianceCircuits.map(([slug, name, category, share]) => ({
            circuitId: `${scopeId(centreCode)}-${slug}`,
            name: `${scopeId(centreCode)}:${name}`,
            category,
            usageKwh: (operating ? 10 : 1) * share,
          })),
        });
      }
    }
  }
  reconcileMayCellTotals(cells);
  return cells;
};

const rollingWindowCells = (firstLocalDate: string, dayCount: number): PreschoolOperationalCell[] => {
  const cells: PreschoolOperationalCell[] = [];
  for (const centreCode of centreCodes) {
    for (let dayOffset = 0; dayOffset < dayCount; dayOffset += 1) {
      const localDate = addLocalDays(firstLocalDate, dayOffset);
      const operatingDay = fixtureOperatingDay(localDate);
      for (let localHour = 0; localHour < 24; localHour += 1) {
        const usageKwh = operatingDay && localHour >= 7 && localHour < 19 ? 10 : 1;
        cells.push({
          scopeId: scopeId(centreCode),
          localDate,
          localHour,
          usageKwh,
          leadingCircuitName: `${scopeId(centreCode)}:Plug Load3`,
          leadingCircuitKwh: usageKwh * applianceCircuits[0][3],
          circuits: applianceCircuits.map(([slug, name, category, share]) => ({
            circuitId: `${scopeId(centreCode)}-${slug}`,
            name: `${scopeId(centreCode)}:${name}`,
            category,
            usageKwh: usageKwh * share,
          })),
        });
      }
    }
  }
  return cells;
};

const analysisForCells = (
  cells: PreschoolOperationalCell[],
  dataSnapshotId: string,
): Pick<ProjectAnalysisPayload, "offHours" | "provenance"> => {
  const operatingKwh = cells
    .filter((cell) => fixtureOperatingDay(cell.localDate) && cell.localHour >= 7 && cell.localHour < 19)
    .reduce((total, cell) => total + cell.usageKwh, 0);
  const totalKwh = cells.reduce((total, cell) => total + cell.usageKwh, 0);
  const standbyKwh = totalKwh - operatingKwh;
  return {
    offHours: {
      status: "available",
      operatingKwh,
      standbyKwh,
      usageKwh: standbyKwh,
      sharePct: (standbyKwh / totalKwh) * 100,
      timezone: "Asia/Singapore",
      businessCalendarVersion: "preschool-calendar-v1",
    },
    provenance: {
      ...analysis().provenance,
      dataSnapshotId,
    },
  };
};

const fixtureOperatingDay = (localDate: string): boolean => {
  const weekday = new Date(`${localDate}T00:00:00.000Z`).getUTCDay();
  return weekday !== 0
    && weekday !== 6
    && localDate !== "2026-05-01"
    && localDate !== "2026-05-27";
};

const addLocalDays = (localDate: string, days: number): string => new Date(
  Date.parse(`${localDate}T00:00:00.000Z`) + days * 86_400_000,
).toISOString().slice(0, 10);

const setUsage = (
  cells: PreschoolOperationalCell[],
  centreCode: string,
  localDate: string,
  localHour: number,
  usageKwh: number,
): void => {
  const cell = cells.find((candidate) => candidate.scopeId === scopeId(centreCode)
    && candidate.localDate === localDate
    && candidate.localHour === localHour);
  if (!cell) throw new Error(`Missing test cell ${centreCode}:${localDate}:${localHour}`);
  cell.usageKwh = usageKwh;
  cell.circuits.forEach((circuit, index) => {
    circuit.usageKwh = usageKwh * applianceCircuits[index]![3];
  });
  cell.leadingCircuitName = cell.circuits[0]!.name;
  cell.leadingCircuitKwh = cell.circuits[0]!.usageKwh;
  reconcileMayCellTotals(cells);
};

const reconcileMayCellTotals = (cells: PreschoolOperationalCell[]): void => {
  const targets = { standby: 3_103.784, operating: 21_818.0283 } as const;
  const stateFor = (cell: PreschoolOperationalCell): keyof typeof targets => {
    const weekday = new Date(`${cell.localDate}T00:00:00.000Z`).getUTCDay();
    const calendarException = cell.localDate === "2026-05-01" || cell.localDate === "2026-05-27";
    return !calendarException && weekday !== 0 && weekday !== 6 && cell.localHour >= 7 && cell.localHour < 19
      ? "operating"
      : "standby";
  };
  for (const state of ["standby", "operating"] as const) {
    const stateCells = cells.filter((cell) => stateFor(cell) === state);
    const currentTotal = stateCells.reduce((sum, cell) => sum + cell.usageKwh, 0);
    const factor = targets[state] / currentTotal;
    stateCells.forEach((cell) => {
      cell.usageKwh *= factor;
      cell.circuits.forEach((circuit) => { circuit.usageKwh *= factor; });
      const leading = [...cell.circuits]
        .sort((left, right) => right.usageKwh - left.usageKwh || left.name.localeCompare(right.name))[0]!;
      cell.leadingCircuitName = leading.name;
      cell.leadingCircuitKwh = leading.usageKwh;
    });
  }
};

const scopeId = (centreCode: string): string => `preschool-centre-${centreCode.toLowerCase()}`;

const removeTemporaryFixture = (root: string): void => {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    if (
      process.platform === "win32"
      && error instanceof Error
      && "code" in error
      && (error.code === "EPERM" || error.code === "EBUSY")
    ) return;
    throw error;
  }
};

const cellsToFacts = (cells: PreschoolOperationalCell[]): EnergyIntervalFactWrite[] => {
  const activeEnergyByMeter = new Map<string, number>();
  const firstLocalDate = cells[0]?.localDate;
  return cells.flatMap((cell) => {
    const intervalStartMs = Date.parse(`${cell.localDate}T${String(cell.localHour).padStart(2, "0")}:00:00.000Z`)
      - 8 * 60 * 60_000;
    const sourceCircuits = cell.localDate === firstLocalDate && cell.localHour === 0
      ? cell.circuits
      : [{ ...cell.circuits[0]!, usageKwh: cell.usageKwh }];
    return sourceCircuits.map((circuit) => {
      const meterPointId = circuit.circuitId;
      const usageKwh = circuit.usageKwh;
      const previousActiveEnergyKwh = activeEnergyByMeter.get(meterPointId) ?? 1_000;
      const activeEnergyKwh = previousActiveEnergyKwh + usageKwh;
      activeEnergyByMeter.set(meterPointId, activeEnergyKwh);
      return {
      workspaceId: "preschool-demo-org",
      projectId: "preschool-demo",
      importBatchId: "preschool-operational-query-fixture",
      resource: "electricity",
      meterPointId,
      scopeId: meterPointId,
      parentNodeId: cell.scopeId,
      sourceLabel: circuit.name,
      category: circuit.category,
      meterRole: "component",
      intervalStart: new Date(intervalStartMs).toISOString(),
      intervalEnd: new Date(intervalStartMs + 60 * 60_000).toISOString(),
      elapsedMinutes: 60,
      activeEnergyKwh,
      previousActiveEnergyKwh,
      rawDeltaKwh: usageKwh,
      usageKwh,
      averageKw: usageKwh,
      qualityStatus: "ok",
      localDate: cell.localDate,
      localHour: cell.localHour,
      dayType: [0, 6].includes(new Date(`${cell.localDate}T00:00:00.000Z`).getUTCDay()) ? "weekend" : "weekday",
      isOperating: false,
      sourceFile: "preschool-operational-query-fixture.xlsx",
      sourceSha256: "preschool-operational-query-fixture",
      sourceReadingKind: "interval_usage",
      };
    });
  });
};
