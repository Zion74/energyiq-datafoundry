import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createMetadataStore } from "./index.js";

describe("EnergyIqOperationalPolicyStore", () => {
  it("prices each interval with the effective immutable Tariff rate and reports currency/version", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-operational-policy-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({
        id: "workspace-1",
        owner_user_id: "dev-user",
        name: "Workspace 1",
        kind: "customer",
      });
      metadata.energyIq.upsertProject({
        id: "project-1",
        workspace_id: "workspace-1",
        name: "Project 1",
        status: "published",
        timezone: "Asia/Singapore",
        root_scope_id: "project-1-root",
      });
      metadata.energyIq.upsertProjectNode({
        id: "project-1-root",
        project_id: "project-1",
        name: "Project 1",
        node_type: "project",
      });
      metadata.energyIq.upsertProjectNode({
        id: "level-1",
        project_id: "project-1",
        parent_id: "project-1-root",
        name: "Level 1",
        node_type: "level",
      });
      metadata.energyIq.upsertProjectNode({
        id: "circuit-a",
        project_id: "project-1",
        parent_id: "level-1",
        name: "Circuit A",
        node_type: "circuit",
      });

      const revision = metadata.energyIq.operationalPolicy.publishTariffSchedule({
        version_id: "tariff-v1",
        project_id: "project-1",
        published_by: "dev-user",
        activate: true,
        entries: [
          {
            id: "project-rate",
            owner: { kind: "project" },
            effective_from: "2026-07-01T00:00:00+08:00",
            effective_to: "2026-07-03T00:00:00+08:00",
            currency: "SGD",
            rate_per_kwh: 0.2,
          },
          {
            id: "level-override",
            owner: { kind: "scope", scope_id: "level-1" },
            effective_from: "2026-07-02T00:00:00+08:00",
            effective_to: "2026-07-03T00:00:00+08:00",
            currency: "SGD",
            rate_per_kwh: 0.3,
          },
        ],
      });

      const result = metadata.energyIq.operationalPolicy.evaluateAnalysisPolicy({
        project_id: "project-1",
        scope_id: "circuit-a",
        period: {
          from: "2026-07-01T00:00:00+08:00",
          to: "2026-07-03T00:00:00+08:00",
        },
        intervals: [
          {
            start: "2026-07-01T00:00:00+08:00",
            end_exclusive: "2026-07-02T00:00:00+08:00",
            usage_kwh: 10,
          },
          {
            start: "2026-07-02T00:00:00+08:00",
            end_exclusive: "2026-07-03T00:00:00+08:00",
            usage_kwh: 10,
          },
        ],
      });

      expect(revision.version_id).toBe("tariff-v1");
      expect(result.tariff).toEqual({
        status: "available",
        currency: "SGD",
        tariff_schedule_version: "tariff-v1",
        total_cost: 5,
        allocations: [
          {
            from: "2026-06-30T16:00:00.000Z",
            to: "2026-07-01T16:00:00.000Z",
            rate_per_kwh: 0.2,
            usage_kwh: 10,
            cost: 2,
          },
          {
            from: "2026-07-01T16:00:00.000Z",
            to: "2026-07-02T16:00:00.000Z",
            rate_per_kwh: 0.3,
            usage_kwh: 10,
            cost: 3,
          },
        ],
      });
      expect(result.operating).toMatchObject({
        status: "unavailable",
        reason: { code: "OPERATING_CALENDAR_VERSION_MISSING" },
      });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("classifies Operating and Standby usage in the Project timezone with Scope inheritance and calendar exceptions", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-operating-calendar-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({
        id: "workspace-2",
        owner_user_id: "dev-user",
        name: "Workspace 2",
        kind: "customer",
      });
      metadata.energyIq.upsertProject({
        id: "project-2",
        workspace_id: "workspace-2",
        name: "Project 2",
        status: "published",
        timezone: "Asia/Singapore",
        root_scope_id: "project-2-root",
      });
      metadata.energyIq.upsertProjectNode({
        id: "project-2-root",
        project_id: "project-2",
        name: "Project 2",
        node_type: "project",
      });
      metadata.energyIq.upsertProjectNode({
        id: "level-6",
        project_id: "project-2",
        parent_id: "project-2-root",
        name: "Level 6",
        node_type: "level",
      });
      metadata.energyIq.upsertProjectNode({
        id: "circuit-1",
        project_id: "project-2",
        parent_id: "level-6",
        name: "Circuit 1",
        node_type: "circuit",
      });

      metadata.energyIq.operationalPolicy.publishOperatingCalendar({
        version_id: "calendar-v1",
        project_id: "project-2",
        published_by: "dev-user",
        activate: true,
        entries: [
          {
            id: "project-hours",
            owner: { kind: "project" },
            effective_from: "2026-07-01",
            effective_to: "2026-07-04",
            weekly: operatingWeek("08:00", "18:00"),
          },
          {
            id: "level-6-hours",
            owner: { kind: "scope", scope_id: "level-6" },
            effective_from: "2026-07-01",
            effective_to: "2026-07-04",
            weekly: operatingWeek("09:00", "17:00"),
            exceptions: [{ date: "2026-07-02", operating: [], label: "Project holiday" }],
          },
        ],
      });

      const result = metadata.energyIq.operationalPolicy.evaluateAnalysisPolicy({
        project_id: "project-2",
        scope_id: "circuit-1",
        period: {
          from: "2026-07-01T00:00:00Z",
          to: "2026-07-03T10:00:00Z",
        },
        intervals: [
          { start: "2026-07-01T00:00:00Z", end_exclusive: "2026-07-01T02:00:00Z", usage_kwh: 2 },
          { start: "2026-07-02T02:00:00Z", end_exclusive: "2026-07-02T04:00:00Z", usage_kwh: 2 },
          { start: "2026-07-03T08:00:00Z", end_exclusive: "2026-07-03T10:00:00Z", usage_kwh: 2 },
        ],
      });

      expect(result.operating).toEqual({
        status: "available",
        timezone: "Asia/Singapore",
        business_calendar_version: "calendar-v1",
        operating_kwh: 2,
        standby_kwh: 4,
      });
      expect(metadata.energyIq.operationalPolicy.getActivePolicyVersions("project-2"))
        .toMatchObject({ business_calendar_version: "calendar-v1" });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns stable Unavailable reason codes and never falls back from strict release versions", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-policy-unavailable-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({
        id: "workspace-3",
        owner_user_id: "dev-user",
        name: "Workspace 3",
        kind: "customer",
      });
      metadata.energyIq.upsertProject({
        id: "project-3",
        workspace_id: "workspace-3",
        name: "Project 3",
        status: "published",
        timezone: "Asia/Singapore",
        root_scope_id: "project-3-root",
      });

      const period = { from: "2026-07-01T00:00:00+08:00", to: "2026-07-02T00:00:00+08:00" };
      const interval = [{
        start: "2026-07-01T00:00:00+08:00",
        end_exclusive: "2026-07-02T00:00:00+08:00",
        usage_kwh: 10,
      }];
      const missing = metadata.energyIq.operationalPolicy.evaluateAnalysisPolicy({
        project_id: "project-3",
        scope_id: "project-3-root",
        period,
        intervals: interval,
      });

      metadata.energyIq.operationalPolicy.publishTariffSchedule({
        version_id: "tariff-gap",
        project_id: "project-3",
        published_by: "dev-user",
        activate: true,
        entries: [{
          id: "future-rate",
          owner: { kind: "project" },
          effective_from: "2026-07-02T00:00:00+08:00",
          currency: "SGD",
          rate_per_kwh: 0.2,
        }],
      });
      metadata.energyIq.operationalPolicy.publishOperatingCalendar({
        version_id: "calendar-gap",
        project_id: "project-3",
        published_by: "dev-user",
        activate: true,
        entries: [{
          id: "future-hours",
          owner: { kind: "project" },
          effective_from: "2026-07-02",
          weekly: operatingWeek("08:00", "18:00"),
        }],
      });
      const gap = metadata.energyIq.operationalPolicy.evaluateAnalysisPolicy({
        project_id: "project-3",
        scope_id: "project-3-root",
        period,
        intervals: interval,
      });
      const strict = metadata.energyIq.operationalPolicy.evaluateAnalysisPolicy({
        project_id: "project-3",
        scope_id: "project-3-root",
        period,
        intervals: interval,
        tariff_schedule_version: "release-missing-tariff",
        business_calendar_version: "release-missing-calendar",
      });

      metadata.energyIq.operationalPolicy.publishTariffSchedule({
        version_id: "tariff-currency-conflict",
        project_id: "project-3",
        published_by: "dev-user",
        entries: [
          {
            id: "sgd-rate",
            owner: { kind: "project" },
            effective_from: "2026-07-01T00:00:00+08:00",
            effective_to: "2026-07-01T12:00:00+08:00",
            currency: "SGD",
            rate_per_kwh: 0.2,
          },
          {
            id: "usd-rate",
            owner: { kind: "project" },
            effective_from: "2026-07-01T12:00:00+08:00",
            effective_to: "2026-07-02T00:00:00+08:00",
            currency: "USD",
            rate_per_kwh: 0.2,
          },
        ],
      });
      const currencyConflict = metadata.energyIq.operationalPolicy.evaluateAnalysisPolicy({
        project_id: "project-3",
        scope_id: "project-3-root",
        period,
        intervals: interval,
        tariff_schedule_version: "tariff-currency-conflict",
      });
      const noFacts = metadata.energyIq.operationalPolicy.evaluateAnalysisPolicy({
        project_id: "project-3",
        scope_id: "project-3-root",
        period: { from: "2026-07-02T00:00:00+08:00", to: "2026-07-03T00:00:00+08:00" },
        intervals: [],
      });

      expect([
        unavailableCode(missing.tariff),
        unavailableCode(missing.operating),
        unavailableCode(gap.tariff),
        unavailableCode(gap.operating),
        unavailableCode(strict.tariff),
        unavailableCode(strict.operating),
        unavailableCode(currencyConflict.tariff),
        unavailableCode(noFacts.operating),
      ]).toEqual([
        "TARIFF_VERSION_MISSING",
        "OPERATING_CALENDAR_VERSION_MISSING",
        "TARIFF_NOT_EFFECTIVE_FOR_PERIOD",
        "OPERATING_CALENDAR_NOT_EFFECTIVE_FOR_PERIOD",
        "TARIFF_VERSION_NOT_FOUND",
        "OPERATING_CALENDAR_VERSION_NOT_FOUND",
        "TARIFF_CURRENCY_CONFLICT",
        "OPERATING_FACTS_UNAVAILABLE",
      ]);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses newly activated Admin versions for new analysis while release-pinned and Saved Analysis results remain unchanged", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-policy-history-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({
        id: "workspace-4",
        owner_user_id: "dev-user",
        name: "Workspace 4",
        kind: "customer",
      });
      metadata.energyIq.upsertProject({
        id: "project-4",
        workspace_id: "workspace-4",
        name: "Project 4",
        status: "published",
        timezone: "Asia/Singapore",
        root_scope_id: "project-4-root",
      });
      const period = { from: "2026-07-01T00:00:00+08:00", to: "2026-07-02T00:00:00+08:00" };
      const intervals = [{
        start: "2026-07-01T00:00:00+08:00",
        end_exclusive: "2026-07-02T00:00:00+08:00",
        usage_kwh: 10,
      }];
      publishTariff(metadata, "project-4", "tariff-v1", 0.2, true);
      publishCalendar(metadata, "project-4", "calendar-v1", closedWeek(), true);
      const historical = metadata.energyIq.operationalPolicy.evaluateAnalysisPolicy({
        project_id: "project-4",
        scope_id: "project-4-root",
        period,
        intervals,
      });
      metadata.energyIq.savedAnalyses.create({
        id: "saved-v1",
        series_id: "saved-series",
        project_id: "project-4",
        workspace_id: "workspace-4",
        scope_id: "project-4-root",
        scope_name: "Project 4",
        resource: "electricity",
        title: "Historical policy",
        query_json: JSON.stringify({ period, tariff: "tariff-v1", calendar: "calendar-v1" }),
        analysis_json: JSON.stringify(historical),
        template_revision_id: "template-v1",
        data_snapshot_id: "snapshot-v1",
        created_by: "dev-user",
      });

      publishTariff(metadata, "project-4", "tariff-v2", 0.4, true);
      publishCalendar(metadata, "project-4", "calendar-v2", operatingWeek("00:00", "24:00"), true);
      const latest = metadata.energyIq.operationalPolicy.evaluateAnalysisPolicy({
        project_id: "project-4",
        scope_id: "project-4-root",
        period,
        intervals,
      });
      const pinned = metadata.energyIq.operationalPolicy.evaluateAnalysisPolicy({
        project_id: "project-4",
        scope_id: "project-4-root",
        period,
        intervals,
        tariff_schedule_version: "tariff-v1",
        business_calendar_version: "calendar-v1",
      });
      const saved = JSON.parse(metadata.energyIq.savedAnalyses.get("saved-v1").analysis_json) as unknown;

      expect({ latest, pinned, saved }).toMatchObject({
        latest: {
          tariff: { status: "available", tariff_schedule_version: "tariff-v2", total_cost: 4 },
          operating: { status: "available", business_calendar_version: "calendar-v2", operating_kwh: 10, standby_kwh: 0 },
        },
        pinned: {
          tariff: { status: "available", tariff_schedule_version: "tariff-v1", total_cost: 2 },
          operating: { status: "available", business_calendar_version: "calendar-v1", operating_kwh: 0, standby_kwh: 10 },
        },
        saved: {
          tariff: { status: "available", tariff_schedule_version: "tariff-v1", total_cost: 2 },
          operating: { status: "available", business_calendar_version: "calendar-v1", operating_kwh: 0, standby_kwh: 10 },
        },
      });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

const operatingWeek = (from: string, to: string) => ({
  monday: [{ from, to }],
  tuesday: [{ from, to }],
  wednesday: [{ from, to }],
  thursday: [{ from, to }],
  friday: [{ from, to }],
  saturday: [],
  sunday: [],
});

const closedWeek = () => ({
  monday: [],
  tuesday: [],
  wednesday: [],
  thursday: [],
  friday: [],
  saturday: [],
  sunday: [],
});

const publishTariff = (
  metadata: ReturnType<typeof createMetadataStore>,
  projectId: string,
  versionId: string,
  rate: number,
  activate: boolean,
) => metadata.energyIq.operationalPolicy.publishTariffSchedule({
  version_id: versionId,
  project_id: projectId,
  published_by: "dev-user",
  activate,
  entries: [{
    id: `${versionId}-rate`,
    owner: { kind: "project" },
    effective_from: "2026-07-01T00:00:00+08:00",
    effective_to: "2026-07-02T00:00:00+08:00",
    currency: "SGD",
    rate_per_kwh: rate,
  }],
});

const publishCalendar = (
  metadata: ReturnType<typeof createMetadataStore>,
  projectId: string,
  versionId: string,
  weekly: ReturnType<typeof operatingWeek>,
  activate: boolean,
) => metadata.energyIq.operationalPolicy.publishOperatingCalendar({
  version_id: versionId,
  project_id: projectId,
  published_by: "dev-user",
  activate,
  entries: [{
    id: `${versionId}-hours`,
    owner: { kind: "project" },
    effective_from: "2026-07-01",
    effective_to: "2026-07-02",
    weekly,
  }],
});

const unavailableCode = (value: {
  status: "available" | "unavailable";
  reason?: { code: string };
}): string => value.status === "unavailable" ? value.reason?.code ?? "MISSING_REASON" : "AVAILABLE";
