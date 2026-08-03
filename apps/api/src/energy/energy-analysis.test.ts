import {
  LocalDataGateway,
  writeEnergyFactMaterialization,
  type EnergyIntervalFactWrite,
  type EnergyNormalizedReadingWrite
} from "@datafoundry/data-gateway";
import { createMetadataStore, type EnergyIqRuleRevisionRecord } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  evaluateEnergyAttention,
  executeEnergyScopeAnalysis,
  selectEnergyGoldenPeriod
} from "./energy-analysis.js";
import { ensureEnergyIqBootstrap, PRESCHOOL_WORKSPACE_ID } from "./energy-bootstrap.js";
import { resolveEnergyQueryContext } from "./energy-query-context.js";
import { NGEE_ANN_GOLDEN } from "./ngee-ann-golden.fixture.js";

describe("EnergyScopeAnalysis", () => {
  it("calculates reproducible Preschool portfolio and circuit drill-down facts", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-analysis-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      const user = metadata.users.getById({ user_id: "dev-user" });
      const context = resolveEnergyQueryContext({
        metadataStore: metadata,
        user,
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        request: {
          projectId: "preschool-demo",
          scopeId: "preschool-project",
          resource: "electricity",
          period: "Custom",
          from: "2026-05-01",
          to: "2026-05-31"
        }
      });
      const portfolio = await executeEnergyScopeAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        context,
        databasePath: resolve(`storage/energy/${PRESCHOOL_WORKSPACE_ID}/energy.duckdb`)
      });

      expect(portfolio.summary.usageKwh).toBe(24_921.8123);
      expect(portfolio.summary.averageDailyUsageKwh).toBe(803.9294);
      expect(portfolio.summary.nonOperatingSharePct).toBe(12.45);
      expect(portfolio.hourlyProfile).toHaveLength(24);
      expect(portfolio.childScopes).toHaveLength(30);
      expect(portfolio.circuits).toHaveLength(270);
      expect(portfolio.childScopes.every((child) => child.usageKwh > 0)).toBe(true);
      expect(portfolio.childScopes.reduce((sum, child) => sum + child.usageKwh, 0))
        .toBe(portfolio.summary.usageKwh);
      expect(portfolio.provenance).toMatchObject({
        dataSnapshotId: "preschool-26b85b9c0b95e090",
        hierarchyRevisionId: "preschool-hierarchy-v4",
        meterFormulaRevisionId: "preschool-meter-formula-v2",
        aggregationRule: "component"
      });
      expect(portfolio.provenance.ruleRevisionIds).toContain("time.high_off_hours_share@1");
      expect(portfolio.attention.some((item) => item.code === "NON_OPERATING_SHARE")).toBe(true);

      const centreContext = resolveEnergyQueryContext({
        metadataStore: metadata,
        user,
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        request: {
          projectId: "preschool-demo",
          scopeId: "preschool-centre-a",
          resource: "electricity",
          period: "Custom",
          from: "2026-05-01",
          to: "2026-05-31"
        }
      });
      const centre = await executeEnergyScopeAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        context: centreContext,
        databasePath: resolve(`storage/energy/${PRESCHOOL_WORKSPACE_ID}/energy.duckdb`)
      });
      expect(centre.summary.usageKwh).toBe(843.0985);
      expect(centre.circuits).toHaveLength(9);
      expect(centre.childScopes).toHaveLength(9);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("repeats the selected Ngee Ann golden period without contending with the live API DuckDB", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-analysis-ngee-ann-"));
    const databasePath = join(root, "energy.duckdb");
    await materializeNgeeAnnGoldenFixture(databasePath);
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      configureNgeeAnnGoldenVirtualMeter(metadata);
      const user = metadata.users.getById({ user_id: "dev-user" });
      const context = resolveEnergyQueryContext({
        metadataStore: metadata,
        user,
        workspaceId: "default",
        request: {
          projectId: "ngee-ann-polytechnic",
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: NGEE_ANN_GOLDEN.selection.period.localFrom,
          to: "2026-06-16"
        }
      });
      const selected = await selectEnergyGoldenPeriod({
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        context,
        databasePath,
        periodDays: NGEE_ANN_GOLDEN.selection.periodDays
      });
      expect(selected).toEqual(NGEE_ANN_GOLDEN.selection);

      const run = () => executeEnergyScopeAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        context,
        databasePath
      });
      const analysis = await run();
      const repeated = await run();

      expect(repeated).toEqual(analysis);
      expect(analysis.summary.usageKwh).toBe(NGEE_ANN_GOLDEN.period.usageKwh);
      expect(analysis.summary.peakKw).toBe(NGEE_ANN_GOLDEN.period.peakKw);
      expect(analysis.summary.peakAt).toBe(NGEE_ANN_GOLDEN.period.peakAt);
      expect(analysis.comparison).toMatchObject({
        usageKwh: NGEE_ANN_GOLDEN.period.previousUsageKwh,
        changeKwh: NGEE_ANN_GOLDEN.period.changeKwh,
        changePct: NGEE_ANN_GOLDEN.period.changePct
      });
      expect(analysis.childScopes).toMatchObject([
        { nodeId: "level-7", usageKwh: NGEE_ANN_GOLDEN.period.levelUsageKwh["level-7"] },
        { nodeId: "level-6", usageKwh: NGEE_ANN_GOLDEN.period.levelUsageKwh["level-6"] }
      ]);
      expect(analysis.circuits).toHaveLength(18);
      expect(analysis.categories).toMatchObject([
        { category: "load", usageKwh: NGEE_ANN_GOLDEN.period.categoryUsageKwh.load },
        { category: "light", usageKwh: NGEE_ANN_GOLDEN.period.categoryUsageKwh.light }
      ]);
      expect(analysis.topCircuits[0]).toMatchObject({
        meterNodeId: NGEE_ANN_GOLDEN.period.topCircuit.meterNodeId,
        usageKwh: NGEE_ANN_GOLDEN.period.topCircuit.usageKwh,
        peakKw: NGEE_ANN_GOLDEN.period.topCircuit.peakKw
      });
      expect(analysis.hourlyProfile).toEqual(
        expectedHourlyProfile(NGEE_ANN_GOLDEN.period.hourlyProfile, 28)
      );
      expect(analysis.offHours).toEqual({
        status: NGEE_ANN_GOLDEN.invariants.offHoursStatus,
        reason: "OPERATING_CALENDAR_NOT_MATERIALIZED"
      });
      expect(analysis.cost).toEqual({
        status: NGEE_ANN_GOLDEN.invariants.tariffStatus,
        reason: "TARIFF_NOT_CONFIGURED",
        currency: "SGD"
      });
      expect(analysis.dataHealth).toMatchObject(NGEE_ANN_GOLDEN.period.dataHealth);
      expect(analysis.dataHealth).toMatchObject({
        cumulativeDeltaMismatchCount: NGEE_ANN_GOLDEN.invariants.cumulativeDeltaMismatchCount,
        averageKwMismatchCount: NGEE_ANN_GOLDEN.invariants.averageKwMismatchCount,
        invalidIntervalDurationCount: NGEE_ANN_GOLDEN.invariants.invalidIntervalDurationCount
      });
      expect(roundForGolden(analysis.circuits.reduce((sum, meter) => sum + meter.usageKwh, 0)))
        .toBe(NGEE_ANN_GOLDEN.invariants.allMeterUsageKwh);
      expect(analysis.summary.usageKwh).not.toBe(NGEE_ANN_GOLDEN.invariants.allMeterUsageKwh);
      expect(analysis.units).toEqual({
        usage: NGEE_ANN_GOLDEN.invariants.usageUnit,
        demand: NGEE_ANN_GOLDEN.invariants.demandUnit,
        intervalMinutes: NGEE_ANN_GOLDEN.selection.intervalMinutes,
        timezone: NGEE_ANN_GOLDEN.timezone
      });
      expect(analysis.virtualMeters).toContainEqual(expect.objectContaining(NGEE_ANN_GOLDEN.virtualMeter));
      expect(analysis.provenance).toMatchObject({
        hierarchyRevisionId: context.hierarchyRevisionId,
        aggregationRule: "designated_total"
      });

      const dayContext = resolveEnergyQueryContext({
        metadataStore: metadata,
        user,
        workspaceId: "default",
        request: {
          projectId: "ngee-ann-polytechnic",
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: NGEE_ANN_GOLDEN.selection.day.localDate,
          to: NGEE_ANN_GOLDEN.selection.day.localDate
        }
      });
      const day = await executeEnergyScopeAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        context: dayContext,
        databasePath
      });
      expect(day.summary).toMatchObject({
        usageKwh: NGEE_ANN_GOLDEN.day.usageKwh,
        peakKw: NGEE_ANN_GOLDEN.day.peakKw,
        peakAt: NGEE_ANN_GOLDEN.day.peakAt,
        validIntervalCount: NGEE_ANN_GOLDEN.day.validIntervalCount,
        qualityEventCount: NGEE_ANN_GOLDEN.day.qualityEventCount
      });
      expect(day.dataHealth.expectedMeterIntervalCount)
        .toBe(NGEE_ANN_GOLDEN.day.expectedMeterIntervalCount);
      expect(day.hourlyProfile).toEqual(
        expectedHourlyProfile(NGEE_ANN_GOLDEN.day.hourlyProfile, 4)
      );

      const analyzeScope = async (scopeId: string) => {
        const scopeContext = resolveEnergyQueryContext({
          metadataStore: metadata,
          user,
          workspaceId: "default",
          request: {
            projectId: "ngee-ann-polytechnic",
            scopeId,
            resource: "electricity",
            period: "Custom",
            from: NGEE_ANN_GOLDEN.selection.period.localFrom,
            to: "2026-06-16"
          }
        });
        return await executeEnergyScopeAnalysis({
          metadataStore: metadata,
          dataGateway: gateway,
          userId: "dev-user",
          context: scopeContext,
          databasePath
        });
      };
      for (const [scopeId, expected] of Object.entries(NGEE_ANN_GOLDEN.period.levels)) {
        const level = await analyzeScope(scopeId);
        expect(level.summary).toMatchObject({
          usageKwh: expected.usageKwh,
          peakKw: expected.peakKw,
          peakAt: expected.peakAt
        });
        expect(level.comparison).toMatchObject({
          usageKwh: expected.previousUsageKwh,
          changeKwh: expected.changeKwh,
          changePct: expected.changePct
        });
        expect(level.dataHealth).toMatchObject({
          status: "complete",
          coveragePct: 100,
          expectedMeterIntervalCount: 1344,
          validIntervalCount: 1344,
          qualityEventCount: 0
        });
      }
      const topCircuit = await analyzeScope(NGEE_ANN_GOLDEN.period.topCircuit.meterNodeId);
      expect(topCircuit.summary).toMatchObject({
        usageKwh: NGEE_ANN_GOLDEN.period.topCircuit.usageKwh,
        peakKw: NGEE_ANN_GOLDEN.period.topCircuit.peakKw
      });
      expect(topCircuit.comparison).toMatchObject({
        usageKwh: NGEE_ANN_GOLDEN.period.topCircuit.previousUsageKwh,
        changeKwh: NGEE_ANN_GOLDEN.period.topCircuit.changeKwh,
        changePct: NGEE_ANN_GOLDEN.period.topCircuit.changePct
      });
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  }, 30_000);

  it("evaluates only supplied rule revisions and takes thresholds from the registry", () => {
    const attention = evaluateEnergyAttention({
      summary: {
        usageKwh: 100,
        averageDailyUsageKwh: 100,
        costSgd: 0,
        peakKw: 5,
        nonOperatingKwh: 50,
        nonOperatingSharePct: 50,
        validIntervalCount: 96,
        qualityEventCount: 0,
      },
      childScopes: [
        { nodeId: "a", name: "A", nodeType: "room", usageKwh: 30, sharePct: 30, occupantCount: 10, kwhPerPerson: 3 },
        { nodeId: "b", name: "B", nodeType: "room", usageKwh: 10, sharePct: 10, occupantCount: 10, kwhPerPerson: 1 },
        { nodeId: "c", name: "C", nodeType: "room", usageKwh: 10, sharePct: 10, occupantCount: 10, kwhPerPerson: 1 },
      ],
      circuits: [],
      ruleRevisions: [ruleRevision({
        revision_id: "comparison.people_intensity_outlier@7",
        evaluation_key: "PEOPLE_NORMALISED_OUTLIER",
        parameters: { minimum_peers: 3, median_ratio: 2.5 },
      })],
    });

    expect(attention.map((item) => item.code)).toEqual(["PEOPLE_NORMALISED_OUTLIER"]);
    expect(attention[0]?.evidence).toContain("3.00 kWh/person");
  });
});

const ruleRevision = (override: Partial<EnergyIqRuleRevisionRecord>): EnergyIqRuleRevisionRecord => ({
  revision_id: "rule@1",
  rule_id: "rule",
  version: 1,
  display_name: "Rule",
  description: "Rule",
  family: "comparison",
  severity: "warning",
  evaluation_key: "RULE",
  metric_revision_ids: [],
  parameters: {},
  requirement: "always",
  created_at: "2026-08-02T00:00:00.000Z",
  ...override,
});

type GoldenMeter = {
  id: string;
  scopeId: string;
  parentNodeId: string;
  name: string;
  category: "light" | "load";
  meterRole: "total" | "submeter";
  importBatchId: string;
  usage: number[];
};

const materializeNgeeAnnGoldenFixture = async (databasePath: string): Promise<void> => {
  const currentRootUsage = buildCurrentRootUsage();
  const currentLevel6Usage = allocateLevel6Usage(currentRootUsage);
  const currentLevel7Usage = currentRootUsage.map((usage, index) => usage - currentLevel6Usage[index]!);
  const previousLevel6Usage = constantUsage(477.051617, 7 * 24 * 4);
  const previousLevel7Usage = constantUsage(734.625651, 7 * 24 * 4);
  const currentFrom = Date.parse(NGEE_ANN_GOLDEN.selection.period.from);
  const previousFrom = currentFrom - 7 * 86_400_000;
  const legacyBatchId = NGEE_ANN_GOLDEN.period.dataHealth.importBatchIds[0];
  const currentBatchId = NGEE_ANN_GOLDEN.period.dataHealth.importBatchIds[1];
  const level6LightShare = 110.974382 / 476.983827;
  const level7LightShare = 180.770005 / 1054.184497;
  const meters: GoldenMeter[] = [
    officialMeter({
      id: "mapping-lvl-6-total-office-light-8",
      scopeId: "level-6",
      name: "Lvl 6 Total Office Light",
      category: "light",
      importBatchId: currentBatchId,
      previous: previousLevel6Usage.map((usage) => usage * level6LightShare),
      current: currentLevel6Usage.map((usage) => usage * level6LightShare)
    }),
    officialMeter({
      id: "mapping-lvl-6-total-office-load-9",
      scopeId: "level-6",
      name: "Lvl 6 Total Office Load",
      category: "load",
      importBatchId: currentBatchId,
      previous: previousLevel6Usage.map((usage) => usage * (1 - level6LightShare)),
      current: currentLevel6Usage.map((usage) => usage * (1 - level6LightShare))
    }),
    officialMeter({
      id: "l7-total-light",
      scopeId: "level-7",
      name: "Total Office Light",
      category: "light",
      importBatchId: legacyBatchId,
      previous: previousLevel7Usage.map((usage) => usage * level7LightShare),
      current: currentLevel7Usage.map((usage) => usage * level7LightShare)
    }),
    officialMeter({
      id: "l7-total-load",
      scopeId: "level-7",
      name: "Total Office Load",
      category: "load",
      importBatchId: legacyBatchId,
      previous: previousLevel7Usage.map((usage) => usage * (1 - level7LightShare)),
      current: currentLevel7Usage.map((usage) => usage * (1 - level7LightShare))
    }),
    ...circuitMeters(currentBatchId, legacyBatchId)
  ];

  for (const importBatchId of [legacyBatchId, currentBatchId]) {
    const sourceSha256 = fixtureSha(importBatchId);
    const batchMeters = meters.filter((meter) => meter.importBatchId === importBatchId);
    const intervalFacts = batchMeters.flatMap((meter) => meter.usage.map((usage, index) => {
      const intervalStartMs = meter.usage.length === 14 * 24 * 4
        ? previousFrom + index * 15 * 60_000
        : currentFrom + index * 15 * 60_000;
      return factFor(meter, usage, index, intervalStartMs);
    }));
    const normalizedReadings = batchMeters.map((meter): EnergyNormalizedReadingWrite => ({
      workspaceId: NGEE_ANN_GOLDEN.workspaceId,
      projectId: NGEE_ANN_GOLDEN.projectId,
      importBatchId,
      resource: "electricity",
      meterPointId: meter.id,
      scopeId: meter.scopeId,
      parentNodeId: meter.parentNodeId,
      sourceLabel: meter.name,
      category: meter.category,
      meterRole: meter.meterRole,
      eventTime: new Date(currentFrom + 7 * 86_400_000).toISOString(),
      activeEnergyKwh: 1000 + meter.usage.reduce((sum, usage) => sum + usage, 0),
      sourceFile: "ngee-ann-golden.xlsx",
      sourceSha256,
      sourceRowNumber: 1
    }));
    await writeEnergyFactMaterialization({
      databasePath,
      projectId: NGEE_ANN_GOLDEN.projectId,
      importBatchId,
      sourceSha256,
      rawReadings: [],
      normalizedReadings,
      intervalFacts,
      qualityEvents: []
    });
  }
};

const configureNgeeAnnGoldenVirtualMeter = (
  metadata: ReturnType<typeof createMetadataStore>
): void => {
  const draft = metadata.energyIq.projectSetup.getDraft({
    project_id: NGEE_ANN_GOLDEN.projectId,
    user_id: "dev-user"
  });
  const saved = metadata.energyIq.projectSetup.saveDraft({
    project_id: NGEE_ANN_GOLDEN.projectId,
    expected_revision: draft.revision,
    user_id: "dev-user",
    document: {
      ...draft.document,
      meter_mapping: {
        source_kind: "excel",
        confirmed: true,
        rows: [
          {
            id: NGEE_ANN_GOLDEN.virtualMeter.termMeterNodeIds[0],
            source_label: "Lvl 6 Office Load 1: L1P1-L3P6",
            scope_id: "l6-load-1",
            display_name: "Office Load 1",
            resource: "electricity",
            category: "load",
            coverage: "whole",
            meter_role: "total",
            aggregation_usage: "official"
          },
          {
            id: NGEE_ANN_GOLDEN.virtualMeter.termMeterNodeIds[1],
            source_label: "Lvl 6 Office Load 2: L1P7-L3P12",
            scope_id: "l6-load-2",
            display_name: "Office Load 2",
            resource: "electricity",
            category: "load",
            coverage: "whole",
            meter_role: "total",
            aggregation_usage: "official"
          }
        ],
        virtual_meters: [{
          id: NGEE_ANN_GOLDEN.virtualMeter.meterNodeId,
          display_name: NGEE_ANN_GOLDEN.virtualMeter.name,
          scope_id: NGEE_ANN_GOLDEN.virtualMeter.scopeId,
          resource: "electricity",
          category: "load",
          terms: NGEE_ANN_GOLDEN.virtualMeter.termMeterNodeIds.map((mappingRowId) => ({
            mapping_row_id: mappingRowId,
            coefficient: 1 as const
          }))
        }]
      }
    }
  });
  metadata.energyIq.projectSetup.publishDraft({
    project_id: NGEE_ANN_GOLDEN.projectId,
    expected_revision: saved.revision,
    user_id: "dev-user"
  });
};

const officialMeter = (input: {
  id: string;
  scopeId: string;
  name: string;
  category: "light" | "load";
  importBatchId: string;
  previous: number[];
  current: number[];
}): GoldenMeter => ({
  ...input,
  parentNodeId: input.scopeId,
  meterRole: "total",
  usage: [...input.previous, ...input.current]
});

const circuitMeters = (currentBatchId: string, legacyBatchId: string): GoldenMeter[] => [
  circuitMeter("mapping-lvl-6-office-light-left-external-1", "l6-light-left", "Lvl 6 Office Light-Left: External", "light", "total", 40.287062, currentBatchId),
  circuitMeter("mapping-lvl-6-office-light-right-internal-2", "l6-light-right", "Lvl 6 Office Light-Right: Internal", "light", "total", 70.68732, currentBatchId),
  circuitMeter("mapping-lvl-6-office-load-1-l1p1-l3p6-3", "l6-load-1", "Lvl 6 Office Load 1: L1P1-L3P6", "load", "total", 11.537893, currentBatchId),
  circuitMeter("mapping-lvl-6-office-load-2-l1p7-l3p12-4", "l6-load-2", "Lvl 6 Office Load 2: L1P7-L3P12", "load", "total", 37.483874, currentBatchId),
  circuitMeter("mapping-lvl-6-office-load-3-l1p13-l3p18-5", "l6-load-3", "Lvl 6 Office Load 3: L1P13-L3P18", "load", "total", 13.52915, currentBatchId),
  circuitMeter("mapping-lvl-6-office-load-4-l1p19-l3p24-6", "l6-load-4", "Lvl 6 Office Load 4: L1P19-L3P24", "load", "total", 255.153879, currentBatchId),
  circuitMeter("mapping-lvl-6-office-load-5-l1p25-l3p29-fan-isol-1-2-7", "l6-load-5", "Lvl 6 Office Load 5: L1P25-L3P29 Fan Isol 1/2", "load", "total", 42.335467, currentBatchId),
  circuitMeter("l7-front-light", "l7-front-light", "Front Row Office Light", "light", "submeter", 107.019997, legacyBatchId),
  circuitMeter("l7-middle-light", "l7-middle-light", "Middle Row Office Light", "light", "submeter", 20.767825, legacyBatchId),
  circuitMeter("l7-back-light", "l7-back-light", "Back Row Office Light", "light", "submeter", 48.904264, legacyBatchId),
  circuitMeter("l7-load-1", "l7-load-1", "Office Load 1", "load", "submeter", 28.122014, legacyBatchId),
  circuitMeter("l7-load-2", "l7-load-2", "Office Load 2", "load", "submeter", 66.168234, legacyBatchId),
  circuitMeter("l7-load-3", "l7-load-3", "Office Load 3", "load", "submeter", 337.902316, legacyBatchId),
  circuitMeter(
    "l7-load-4",
    "l7-load-4",
    "Office Load 4 Fan ISOL 1/2",
    "load",
    "submeter",
    439.097185,
    legacyBatchId,
    3.530652,
    247.9813,
    3.7734
  )
];

const circuitMeter = (
  id: string,
  scopeId: string,
  name: string,
  category: "light" | "load",
  meterRole: "total" | "submeter",
  totalUsageKwh: number,
  importBatchId: string,
  peakKw = Math.max((totalUsageKwh / (7 * 24)) * 1.5, 0.2),
  previousUsageKwh?: number,
  previousPeakKw?: number
): GoldenMeter => {
  const currentUsage = [
    peakKw * 0.25,
    ...constantUsage(totalUsageKwh - peakKw * 0.25, 7 * 24 * 4 - 1)
  ];
  const previousUsage = previousUsageKwh === undefined
    ? []
    : [
        (previousPeakKw ?? peakKw) * 0.25,
        ...constantUsage(
          previousUsageKwh - (previousPeakKw ?? peakKw) * 0.25,
          7 * 24 * 4 - 1
        )
      ];
  return {
    id,
    scopeId,
    parentNodeId: scopeId.startsWith("l7-") ? "level-7" : "level-6",
    name,
    category,
    meterRole,
    importBatchId,
    usage: [...previousUsage, ...currentUsage]
  };
};

const buildCurrentRootUsage = (): number[] => {
  const values = new Array<number>(7 * 24 * 4).fill(0);
  for (const [hour, weeklyUsage, , weeklyPeakKw] of NGEE_ANN_GOLDEN.period.hourlyProfile) {
    const dayProfile = NGEE_ANN_GOLDEN.day.hourlyProfile[hour];
    if (!dayProfile) throw new Error(`NGEE_ANN_GOLDEN_DAY_HOUR_MISSING:${hour}`);
    const [, dayUsage, , dayPeakKw] = dayProfile;
    const dayPeakQuarter = hour === 15 ? 1 : 0;
    const dayOtherUsage = (dayUsage - dayPeakKw * 0.25) / 3;
    for (let quarter = 0; quarter < 4; quarter += 1) {
      values[intervalIndex(6, hour, quarter)] = quarter === dayPeakQuarter
        ? dayPeakKw * 0.25
        : dayOtherUsage;
    }
    const weeklyPeakDay = hour === 10 ? 0 : 1;
    const weeklyPeakQuarter = hour === 10 ? 2 : 0;
    const otherUsage = (weeklyUsage - dayUsage - weeklyPeakKw * 0.25) / 23;
    for (let day = 0; day < 6; day += 1) {
      for (let quarter = 0; quarter < 4; quarter += 1) {
        values[intervalIndex(day, hour, quarter)] = day === weeklyPeakDay && quarter === weeklyPeakQuarter
          ? weeklyPeakKw * 0.25
          : otherUsage;
      }
    }
  }
  return values;
};

const allocateLevel6Usage = (rootUsage: number[]): number[] => {
  const target = 476.983827;
  const projectPeakIndex = intervalIndex(1, 14, 0);
  const level6PeakIndex = intervalIndex(0, 10, 2);
  const lower = rootUsage.map((usage) => Math.max(0, usage - 12.063679 * 0.25));
  const upper = rootUsage.map((usage) => Math.min(usage, 9.205119 * 0.25));
  lower[projectPeakIndex] = upper[projectPeakIndex] = 8.609428 * 0.25;
  lower[level6PeakIndex] = upper[level6PeakIndex] = 9.20512 * 0.25;
  const lowerTotal = lower.reduce((sum, usage) => sum + usage, 0);
  const headroom = upper.reduce((sum, usage, index) => sum + usage - lower[index]!, 0);
  const fraction = (target - lowerTotal) / headroom;
  if (fraction < 0 || fraction > 1) throw new Error("NGEE_ANN_LEVEL_ALLOCATION_INVALID");
  const result = lower.map((usage, index) => usage + (upper[index]! - usage) * fraction);
  const correction = target - result.reduce((sum, usage) => sum + usage, 0);
  const correctionIndex = result.findIndex((usage, index) =>
    index !== projectPeakIndex && index !== level6PeakIndex && usage + correction <= upper[index]!);
  if (correctionIndex < 0) throw new Error("NGEE_ANN_LEVEL_ALLOCATION_CORRECTION_FAILED");
  result[correctionIndex] = result[correctionIndex]! + correction;
  return result;
};

const factFor = (
  meter: GoldenMeter,
  usage: number,
  index: number,
  intervalStartMs: number
): EnergyIntervalFactWrite => {
  const previousActiveEnergyKwh = 1000 + meter.usage.slice(0, index).reduce((sum, value) => sum + value, 0);
  const local = new Date(intervalStartMs + 8 * 60 * 60_000);
  return {
    workspaceId: NGEE_ANN_GOLDEN.workspaceId,
    projectId: NGEE_ANN_GOLDEN.projectId,
    importBatchId: meter.importBatchId,
    resource: "electricity",
    meterPointId: meter.id,
    scopeId: meter.scopeId,
    parentNodeId: meter.parentNodeId,
    sourceLabel: meter.name,
    category: meter.category,
    meterRole: meter.meterRole,
    intervalStart: new Date(intervalStartMs).toISOString(),
    intervalEnd: new Date(intervalStartMs + 15 * 60_000).toISOString(),
    elapsedMinutes: 15,
    activeEnergyKwh: previousActiveEnergyKwh + usage,
    previousActiveEnergyKwh,
    rawDeltaKwh: usage,
    usageKwh: usage,
    averageKw: usage * 4,
    qualityStatus: "ok",
    localDate: local.toISOString().slice(0, 10),
    localHour: local.getUTCHours(),
    dayType: [0, 6].includes(local.getUTCDay()) ? "weekend" : "weekday",
    sourceFile: "ngee-ann-golden.xlsx",
    sourceSha256: fixtureSha(meter.importBatchId)
  };
};

const fixtureSha = (importBatchId: string): string =>
  importBatchId === "<legacy>" ? "ngee-ann-golden-legacy" : "ngee-ann-golden-current";

const constantUsage = (total: number, count: number): number[] =>
  new Array<number>(count).fill(total / count);

const intervalIndex = (day: number, hour: number, quarter: number): number =>
  day * 24 * 4 + hour * 4 + quarter;

const expectedHourlyProfile = (
  profile: readonly (readonly [number, number, number, number])[],
  observationCount: number
) => profile.map(([hour, usageKwh, averageKw, peakKw]) => ({
  hour,
  usageKwh: roundForGolden(usageKwh),
  averageKw: roundForGolden(averageKw),
  peakKw: roundForGolden(peakKw),
  observationCount
}));

const roundForGolden = (value: number): number => Math.round((value + Number.EPSILON) * 10_000) / 10_000;

const removeTemporaryEnergyFixture = (root: string): void => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch (error) {
    if (
      process.platform === "win32"
      && error instanceof Error
      && "code" in error
      && (error.code === "EPERM" || error.code === "EBUSY")
    ) {
      return;
    }
    throw error;
  }
};
