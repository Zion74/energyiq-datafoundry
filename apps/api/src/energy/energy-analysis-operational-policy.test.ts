import {
  LocalDataGateway,
  writeEnergyFactMaterialization,
  type EnergyIntervalFactWrite,
} from "@datafoundry/data-gateway";
import {
  createMetadataStore,
  type EnergyIqRuleRevisionRecord,
} from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { executeEnergyScopeAnalysis } from "./energy-analysis.js";
import type { EnergyQueryContext } from "./energy-query-context.js";

describe("EnergyScopeAnalysis operational policy", () => {
  it("uses complete Release-pinned Tariff and Calendar versions for cost and standby facts", async () => {
    const fixture = await createOperationalFixture();
    try {
      publishPolicyV1(fixture.metadata);
      const analysis = await executeEnergyScopeAnalysis({
        metadataStore: fixture.metadata,
        dataGateway: fixture.gateway,
        userId: "dev-user",
        context: policyContext("tariff-v1", "calendar-v1"),
        databasePath: fixture.databasePath,
        ruleRevisions: [offHoursRule],
      });

      expect(analysis.summary).toMatchObject({
        usageKwh: 10,
        nonOperatingKwh: 7,
        nonOperatingSharePct: 70,
      });
      expect(analysis.cost).toEqual({
        status: "available",
        amount: 2.2,
        currency: "SGD",
        tariffScheduleVersion: "tariff-v1",
        allocations: [
          {
            from: "2026-06-30T16:00:00.000Z",
            to: "2026-07-01T00:00:00.000Z",
            ratePerKwh: 0.1,
            usageKwh: 4,
            cost: 0.4,
          },
          {
            from: "2026-07-01T00:00:00.000Z",
            to: "2026-07-01T16:00:00.000Z",
            ratePerKwh: 0.3,
            usageKwh: 6,
            cost: 1.8,
          },
        ],
      });
      expect(analysis.offHours).toEqual({
        status: "available",
        operatingKwh: 3,
        standbyKwh: 7,
        usageKwh: 7,
        sharePct: 70,
        timezone: "Asia/Singapore",
        businessCalendarVersion: "calendar-v1",
      });
      expect(analysis.circuits).toEqual([
        expect.objectContaining({ meterNodeId: "meter-1", nonOperatingKwh: 7 }),
      ]);
      expect(analysis.attention).toEqual([
        expect.objectContaining({
          code: "NON_OPERATING_SHARE",
          title: "70.0% of usage occurred outside operating hours",
        }),
      ]);
    } finally {
      fixture.close();
    }
  });

  it("returns explicit unavailable policy results and suppresses legacy off-hours findings", async () => {
    const fixture = await createOperationalFixture();
    try {
      const analysis = await executeEnergyScopeAnalysis({
        metadataStore: fixture.metadata,
        dataGateway: fixture.gateway,
        userId: "dev-user",
        context: policyContext("missing-tariff", "missing-calendar"),
        databasePath: fixture.databasePath,
        ruleRevisions: [offHoursRule],
      });

      expect(analysis.cost).toEqual({
        status: "unavailable",
        reason: {
          code: "TARIFF_VERSION_NOT_FOUND",
          message: "Tariff schedule missing-tariff is not published for this Project.",
        },
        tariffScheduleVersion: "missing-tariff",
      });
      expect(analysis.offHours).toEqual({
        status: "unavailable",
        reason: {
          code: "OPERATING_CALENDAR_VERSION_NOT_FOUND",
          message: "Operating calendar missing-calendar is not published for this Project.",
        },
        businessCalendarVersion: "missing-calendar",
      });
      expect(analysis.summary).not.toHaveProperty("nonOperatingKwh");
      expect(analysis.summary).not.toHaveProperty("nonOperatingSharePct");
      expect(analysis.circuits[0]).not.toHaveProperty("nonOperatingKwh");
      expect(analysis.attention.some((finding) => finding.code === "NON_OPERATING_SHARE")).toBe(false);
    } finally {
      fixture.close();
    }
  });

  it("fails explicitly when a valid meter policy series is missing", async () => {
    const fixture = await createOperationalFixture();
    try {
      publishPolicyV1(fixture.metadata);
      const runSqlReadonly = fixture.gateway.runSqlReadonly.bind(fixture.gateway);
      vi.spyOn(fixture.gateway, "runSqlReadonly").mockImplementation(async (input) => {
        const result = await runSqlReadonly(input);
        return input.sql.includes("'meter' AS series_kind")
          ? { ...result, rows: [], row_count: 0 }
          : result;
      });

      await expect(executeEnergyScopeAnalysis({
        metadataStore: fixture.metadata,
        dataGateway: fixture.gateway,
        userId: "dev-user",
        context: policyContext("tariff-v1", "calendar-v1"),
        databasePath: fixture.databasePath,
        ruleRevisions: [],
      })).rejects.toThrow(
        "ENERGYIQ_OPERATIONAL_POLICY_METER_INTERVALS_INCOMPLETE:meter-1",
      );
    } finally {
      vi.restoreAllMocks();
      fixture.close();
    }
  });

  it("keeps a serialized historical result unchanged after Admin activates new versions", async () => {
    const fixture = await createOperationalFixture();
    try {
      publishPolicyV1(fixture.metadata);
      const historical = await executeEnergyScopeAnalysis({
        metadataStore: fixture.metadata,
        dataGateway: fixture.gateway,
        userId: "dev-user",
        context: policyContext("tariff-v1", "calendar-v1"),
        databasePath: fixture.databasePath,
        ruleRevisions: [],
      });
      const serializedHistorical = JSON.stringify(historical);

      publishPolicyV2(fixture.metadata);
      const stillPinned = await executeEnergyScopeAnalysis({
        metadataStore: fixture.metadata,
        dataGateway: fixture.gateway,
        userId: "dev-user",
        context: policyContext("tariff-v1", "calendar-v1"),
        databasePath: fixture.databasePath,
        ruleRevisions: [],
      });
      const latest = await executeEnergyScopeAnalysis({
        metadataStore: fixture.metadata,
        dataGateway: fixture.gateway,
        userId: "dev-user",
        context: policyContext("tariff-v2", "calendar-v2"),
        databasePath: fixture.databasePath,
        ruleRevisions: [],
      });

      expect(JSON.stringify(stillPinned)).toBe(serializedHistorical);
      expect(latest.cost).toMatchObject({
        status: "available",
        amount: 5,
        tariffScheduleVersion: "tariff-v2",
      });
      expect(latest.offHours).toMatchObject({
        status: "available",
        operatingKwh: 10,
        standbyKwh: 0,
        businessCalendarVersion: "calendar-v2",
      });
      expect(JSON.stringify(latest)).not.toBe(serializedHistorical);
    } finally {
      fixture.close();
    }
  });
});

const createOperationalFixture = async () => {
  const root = mkdtempSync(join(tmpdir(), "energy-analysis-policy-"));
  const databasePath = join(root, "energy.duckdb");
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  const gateway = new LocalDataGateway(metadata);
  metadata.workspaces.upsert({
    id: "workspace-policy",
    owner_user_id: "dev-user",
    name: "Operational Policy Workspace",
    kind: "customer",
  });
  metadata.energyIq.upsertProject({
    id: "project-policy",
    workspace_id: "workspace-policy",
    name: "Operational Policy Project",
    status: "published",
    timezone: "Asia/Singapore",
    root_scope_id: "project-policy-root",
  });
  metadata.energyIq.upsertProjectNode({
    id: "project-policy-root",
    project_id: "project-policy",
    name: "Operational Policy Project",
    node_type: "project",
  });
  const intervals: EnergyIntervalFactWrite[] = [
    fact("2026-06-30T16:00:00.000Z", "2026-06-30T20:00:00.000Z", 4),
    fact("2026-07-01T00:00:00.000Z", "2026-07-01T04:00:00.000Z", 6),
  ];
  await writeEnergyFactMaterialization({
    databasePath,
    projectId: "project-policy",
    importBatchId: "policy-fixture",
    sourceSha256: "policy-fixture-sha",
    rawReadings: [],
    normalizedReadings: [],
    intervalFacts: intervals,
    qualityEvents: [],
  });
  return {
    metadata,
    gateway,
    databasePath,
    close: () => {
      metadata.close();
      try {
        rmSync(root, { recursive: true, force: true });
      } catch (error) {
        if (
          process.platform !== "win32"
          || !(error instanceof Error)
          || !("code" in error)
          || (error.code !== "EPERM" && error.code !== "EBUSY")
        ) {
          throw error;
        }
      }
    },
  };
};

const fact = (
  intervalStart: string,
  intervalEnd: string,
  usageKwh: number,
): EnergyIntervalFactWrite => ({
  workspaceId: "workspace-policy",
  projectId: "project-policy",
  importBatchId: "policy-fixture",
  resource: "electricity",
  meterPointId: "meter-1",
  scopeId: "project-policy-root",
  parentNodeId: "project-policy-root",
  sourceLabel: "Meter 1",
  category: "overall",
  meterRole: "total",
  intervalStart,
  intervalEnd,
  elapsedMinutes: (Date.parse(intervalEnd) - Date.parse(intervalStart)) / 60_000,
  activeEnergyKwh: 1_000 + usageKwh,
  previousActiveEnergyKwh: 1_000,
  rawDeltaKwh: usageKwh,
  usageKwh,
  averageKw: usageKwh / ((Date.parse(intervalEnd) - Date.parse(intervalStart)) / 3_600_000),
  qualityStatus: "ok",
  localDate: "2026-07-01",
  localHour: new Date(intervalStart).getUTCHours() + 8,
  dayType: "weekday",
  isOperating: true,
  sourceFile: "policy-fixture.csv",
  sourceSha256: "policy-fixture-sha",
});

const policyContext = (
  tariffScheduleVersion: string,
  businessCalendarVersion: string,
): EnergyQueryContext => ({
  userId: "dev-user",
  workspaceId: "workspace-policy",
  projectId: "project-policy",
  projectName: "Operational Policy Project",
  scopeId: "project-policy-root",
  scopeName: "Operational Policy Project",
  scopeType: "project",
  resource: "electricity",
  timezone: "Asia/Singapore",
  from: "2026-06-30T16:00:00.000Z",
  to: "2026-07-01T16:00:00.000Z",
  endExclusive: true,
  period: "Custom",
  hierarchyRevisionId: "hierarchy-v1",
  meterFormulaRevisionId: "meter-formula-v1",
  dataSnapshotId: "snapshot-v1",
  metricVersion: "metric-v1",
  businessCalendarVersion,
  tariffScheduleVersion,
  resolvedAt: "2026-08-04T00:00:00.000Z",
});

const publishPolicyV1 = (metadata: ReturnType<typeof createMetadataStore>): void => {
  metadata.energyIq.operationalPolicy.publishTariffSchedule({
    version_id: "tariff-v1",
    project_id: "project-policy",
    published_by: "dev-user",
    activate: true,
    entries: [
      {
        id: "tariff-v1-off-peak",
        owner: { kind: "project" },
        effective_from: "2026-06-30T16:00:00.000Z",
        effective_to: "2026-07-01T00:00:00.000Z",
        currency: "SGD",
        rate_per_kwh: 0.1,
      },
      {
        id: "tariff-v1-day",
        owner: { kind: "project" },
        effective_from: "2026-07-01T00:00:00.000Z",
        effective_to: "2026-07-01T16:00:00.000Z",
        currency: "SGD",
        rate_per_kwh: 0.3,
      },
    ],
  });
  metadata.energyIq.operationalPolicy.publishOperatingCalendar({
    version_id: "calendar-v1",
    project_id: "project-policy",
    published_by: "dev-user",
    activate: true,
    entries: [{
      id: "calendar-v1-hours",
      owner: { kind: "project" },
      effective_from: "2026-07-01",
      effective_to: "2026-07-02",
      weekly: allDays("08:00", "10:00"),
    }],
  });
};

const publishPolicyV2 = (metadata: ReturnType<typeof createMetadataStore>): void => {
  metadata.energyIq.operationalPolicy.publishTariffSchedule({
    version_id: "tariff-v2",
    project_id: "project-policy",
    published_by: "dev-user",
    activate: true,
    entries: [{
      id: "tariff-v2-flat",
      owner: { kind: "project" },
      effective_from: "2026-06-30T16:00:00.000Z",
      effective_to: "2026-07-01T16:00:00.000Z",
      currency: "SGD",
      rate_per_kwh: 0.5,
    }],
  });
  metadata.energyIq.operationalPolicy.publishOperatingCalendar({
    version_id: "calendar-v2",
    project_id: "project-policy",
    published_by: "dev-user",
    activate: true,
    entries: [{
      id: "calendar-v2-hours",
      owner: { kind: "project" },
      effective_from: "2026-07-01",
      effective_to: "2026-07-02",
      weekly: allDays("00:00", "24:00"),
    }],
  });
};

const allDays = (from: string, to: string) => ({
  monday: [{ from, to }],
  tuesday: [{ from, to }],
  wednesday: [{ from, to }],
  thursday: [{ from, to }],
  friday: [{ from, to }],
  saturday: [{ from, to }],
  sunday: [{ from, to }],
});

const offHoursRule: EnergyIqRuleRevisionRecord = {
  revision_id: "time.high_off_hours_share@policy-test",
  rule_id: "time.high_off_hours_share",
  version: 1,
  display_name: "High off-hours share",
  description: "Test rule",
  family: "time",
  severity: "warning",
  evaluation_key: "NON_OPERATING_SHARE",
  metric_revision_ids: [],
  parameters: { share_pct: 10 },
  requirement: "operating_hours",
  created_at: "2026-08-04T00:00:00.000Z",
};
