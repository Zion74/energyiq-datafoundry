import {
  LocalDataGateway,
  type EnergyFactMaterializationBatchWrite,
  type EnergyIntervalFactWrite,
} from "@datafoundry/data-gateway";
import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  ensureEnergyIqBootstrap,
  NGEE_ANN_WORKSPACE_ID,
  PRESCHOOL_WORKSPACE_ID,
} from "./energy-bootstrap.js";
import { materializeTestProjectSnapshot } from "./energy-test-materialization.js";
import { NGEE_ANN_GOLDEN } from "./ngee-ann-golden.fixture.js";
import {
  materializePreschoolGoldenFixture,
  PRESCHOOL_GOLDEN,
} from "./preschool-golden.fixture.js";
import { resolveProjectAnalysis } from "./project-analysis-resolver.js";
import { resolveEnergyPublishedMeterRoute } from "./energy-query-context.js";

describe("ProjectAnalysisResolver", () => {
  it("rejects a Project outside the user's Workspace Membership before resolving its Scope", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-analysis-resolver-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      metadata.users.upsertDevUser({
        id: "preschool-fm",
        email: "preschool.fm@example.com",
        display_name: "Preschool FM",
        dev_token: "preschool-fm-token",
      });
      metadata.workspaceMemberships.upsert({
        workspace_id: "preschool-demo-org",
        user_id: "preschool-fm",
        role: "member",
      });

      await expect(resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user: metadata.users.getById({ user_id: "preschool-fm" }),
        workspaceId: "default",
        request: {
          projectId: "ngee-ann-polytechnic",
          scopeId: "project",
          resource: "electricity",
          period: "Yesterday",
        },
      })).rejects.toThrow("ENERGYIQ_WORKSPACE_FORBIDDEN");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("rejects a Scope that does not belong to the trusted Project", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-analysis-resolver-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      await expect(resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: "default",
        request: {
          projectId: "ngee-ann-polytechnic",
          scopeId: "preschool-project",
          resource: "electricity",
          period: "Yesterday",
        },
      })).rejects.toThrow("ENERGYIQ_SCOPE_FORBIDDEN");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it.each([
    {
      period: "Previous week",
      from: "2026-07-26T16:00:00.000Z",
      to: "2026-08-02T16:00:00.000Z",
    },
    {
      period: "Previous month",
      from: "2026-06-30T16:00:00.000Z",
      to: "2026-07-31T16:00:00.000Z",
    },
  ] as const)("returns configuration-required for an unregistered customer Project with $period", async ({ period, from, to }) => {
    const root = mkdtempSync(join(tmpdir(), "project-analysis-resolver-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      metadata.energyIq.upsertProject({
        id: "customer-without-renderer",
        workspace_id: "default",
        name: "Customer Without Renderer",
        status: "published",
        root_scope_id: "customer-without-renderer-root",
      });
      metadata.energyIq.upsertProjectNode({
        id: "customer-without-renderer-root",
        project_id: "customer-without-renderer",
        name: "Customer Without Renderer",
        node_type: "project",
      });

      const result = await resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: "default",
        request: {
          projectId: "customer-without-renderer",
          scopeId: "project",
          resource: "electricity",
          period,
        },
        now: new Date("2026-08-03T16:30:00.000Z"),
      });

      expect(result).toMatchObject({
        status: "configuration-required",
        projectId: "customer-without-renderer",
        title: "Project analysis is not configured",
        context: {
          period,
          timezone: "Asia/Singapore",
          from,
          to,
          endExclusive: true,
        },
      });
      expect(result).not.toHaveProperty("snapshot");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("anchors the latest complete day to historical Snapshot facts instead of wall-clock time", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-analysis-latest-day-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      await materializeNgeeAnnLatestPeriodFixture(databasePath, metadata);
      const result = await resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        request: {
          projectId: NGEE_ANN_GOLDEN.projectId,
          scopeId: "project",
          resource: "electricity",
          analysisWindow: "latest-complete-day",
        },
        databasePath,
        now: new Date("2026-08-05T00:00:00.000Z"),
      });

      expect(result.status).toBe("ready");
      if (result.status !== "ready") throw new Error("Expected latest complete Project day");
      expect(result.snapshot.context).toMatchObject({
        period: "Custom",
        from: "2026-06-15T16:00:00.000Z",
        to: "2026-06-16T16:00:00.000Z",
        primaryPeriod: {
          start: "2026-06-15T16:00:00.000Z",
          endExclusive: "2026-06-16T16:00:00.000Z",
        },
      });
      expect(result.snapshot.analysis.summary.validIntervalCount).toBeGreaterThan(0);
      expect(result.snapshot.analysis.dailyTotals?.scopes[0]?.rows).toMatchObject([
        { localDate: "2026-06-16", dataHealth: { status: "complete" } },
      ]);
    } finally {
      metadata.close();
      removeTemporaryFixture(root);
    }
  }, 30_000);

  it("pins the latest complete Project day to one calendar-month-to-date Ngee Ann range across Scopes", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-analysis-latest-period-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      await materializeNgeeAnnLatestPeriodFixture(databasePath, metadata);
      metadata.energyIq.operationalPolicy.publishOperatingCalendar({
        version_id: "sg-calendar-v1",
        project_id: NGEE_ANN_GOLDEN.projectId,
        published_by: "dev-user",
        entries: [{
          id: "ngee-ann-resolver-calendar",
          owner: { kind: "project" },
          effective_from: "2020-01-01",
          weekly: {
            monday: [{ from: "00:00", to: "24:00" }],
            tuesday: [{ from: "00:00", to: "24:00" }],
            wednesday: [{ from: "00:00", to: "24:00" }],
            thursday: [{ from: "00:00", to: "24:00" }],
            friday: [{ from: "00:00", to: "24:00" }],
            saturday: [{ from: "00:00", to: "24:00" }],
            sunday: [{ from: "00:00", to: "24:00" }],
          },
        }],
      });
      const user = metadata.users.getById({ user_id: "dev-user" });
      const currentProjectResult = await resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        request: {
          projectId: NGEE_ANN_GOLDEN.projectId,
          scopeId: "project",
          resource: "electricity",
          analysisWindow: "current-project-overview",
        },
        databasePath,
        now: new Date("2026-08-05T00:00:00.000Z"),
      });
      expect(currentProjectResult.status).toBe("ready");
      if (currentProjectResult.status !== "ready") throw new Error("Expected current Project analysis");
      expect(currentProjectResult.snapshot.context).toMatchObject({
        period: "Custom",
        from: "2026-05-31T16:00:00.000Z",
        to: NGEE_ANN_GOLDEN.selection.period.to,
      });
      expect(currentProjectResult.snapshot.reportTimeContext).toMatchObject({
        contractRevision: "energyiq-report-time-context@1",
        binding: {
          workspaceId: NGEE_ANN_WORKSPACE_ID,
          projectId: NGEE_ANN_GOLDEN.projectId,
          scopeId: "project",
          resource: "electricity",
          dataSnapshotId: currentProjectResult.snapshot.dataSnapshot.id,
          projectReleaseId: currentProjectResult.snapshot.projectRelease.id,
        },
        timezone: "Asia/Singapore",
        asOf: "2026-08-05T00:00:00.000Z",
        acceptedDataEndExclusive: NGEE_ANN_GOLDEN.selection.period.to,
        dataThroughLocalDate: "2026-06-16",
        lastRefreshedAt: "2026-08-05T00:00:00.000Z",
        policyId: "ngee-ann-report-time",
        policyRevision: "1",
      });
      expect(currentProjectResult.snapshot.reportTimeContext?.windows).toEqual(expect.arrayContaining([
        expect.objectContaining({
          windowId: "current-month-progress",
          label: "Current month to date",
          phase: "partial",
          from: "2026-05-31T16:00:00.000Z",
          toExclusive: NGEE_ANN_GOLDEN.selection.period.to,
        }),
        expect.objectContaining({
          windowId: "recent-operations",
          label: "Recent 28 complete days",
          completeDayCount: 28,
        }),
        expect.objectContaining({
          windowId: "next-month-outlook",
          phase: "forecast",
          from: "2026-06-30T16:00:00.000Z",
          toExclusive: "2026-07-31T16:00:00.000Z",
        }),
      ]));
      expect(currentProjectResult.snapshot.reportWindowAnalyses).toEqual(expect.arrayContaining([
        expect.objectContaining({
          windowId: "current-month-progress",
          period: {
            start: "2026-05-31T16:00:00.000Z",
            endExclusive: NGEE_ANN_GOLDEN.selection.period.to,
          },
          status: "ready",
        }),
        expect.objectContaining({
          windowId: "recent-operations",
          period: {
            start: "2026-05-19T16:00:00.000Z",
            endExclusive: NGEE_ANN_GOLDEN.selection.period.to,
          },
          status: "ready",
          analysis: expect.objectContaining({
            dailyTotals: expect.objectContaining({
              scopes: expect.arrayContaining([
                expect.objectContaining({
                  scopeId: "project",
                  rows: expect.arrayContaining([
                    expect.objectContaining({ localDate: "2026-05-20" }),
                    expect.objectContaining({ localDate: "2026-06-16" }),
                  ]),
                }),
              ]),
            }),
          }),
        }),
      ]));
      const recentOperations = currentProjectResult.snapshot.reportWindowAnalyses
        ?.find((window) => window.windowId === "recent-operations");
      expect(recentOperations?.analysis.summary).toEqual(
        expect.objectContaining({ usageKwh: expect.any(Number) }),
      );
      expect(recentOperations?.analysis.offHours).toEqual(
        expect.objectContaining({ status: "available" }),
      );
      expect(recentOperations?.analysis.timeBehaviour).toEqual(expect.objectContaining({
        queryId: "time_bucket_grid_v1",
        scopes: expect.arrayContaining([
          expect.objectContaining({
            scopeId: "project",
            cells: expect.arrayContaining([
              expect.objectContaining({ localDate: "2026-05-20", localHour: 0 }),
              expect.objectContaining({ localDate: "2026-06-16", localHour: 23 }),
            ]),
          }),
        ]),
        dayProfiles: expect.arrayContaining([
          expect.objectContaining({ scopeId: "project", dayType: "weekday" }),
        ]),
      }));
      expect(JSON.stringify(currentProjectResult.snapshot.reportWindowAnalyses).length)
        .toBeLessThan(600_000);
      expect(currentProjectResult.snapshot.analysis.summary.validIntervalCount).toBeGreaterThan(0);
      expect(currentProjectResult.snapshot.projectRelease.ruleRevisionIds)
        .toContain("comparison.daily_usage_above_baseline@1");
      expect(currentProjectResult.snapshot.analysis.dailyUsageAnomalies).toBeDefined();
      expect(currentProjectResult.snapshot.analysis.dataHealth.status).toBe("partial");
      expect(currentProjectResult.snapshot.analysis.dailyTotals?.scopes[0]?.rows).toHaveLength(16);
      expect(currentProjectResult.snapshot.analysis.dailyTotals?.scopes[0]?.rows[0]).toMatchObject({
        localDate: "2026-06-01",
        usageKwh: null,
        dataHealth: { status: "unavailable" },
      });

      const currentLevelResult = await resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        request: {
          projectId: NGEE_ANN_GOLDEN.projectId,
          scopeId: "level-7",
          resource: "electricity",
          analysisWindow: "current-month-to-date",
        },
        databasePath,
        now: new Date("2026-08-05T00:00:00.000Z"),
      });
      expect(currentLevelResult.status).toBe("ready");
      if (currentLevelResult.status !== "ready") throw new Error("Expected current Level analysis");
      expect(currentLevelResult.snapshot.context).toMatchObject({
        period: "Custom",
        from: currentProjectResult.snapshot.context.from,
        to: currentProjectResult.snapshot.context.to,
        dataSnapshotId: currentProjectResult.snapshot.context.dataSnapshotId,
      });

      const pinnedLevelResult = await resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        request: {
          projectId: NGEE_ANN_GOLDEN.projectId,
          scopeId: "level-7",
          resource: "electricity",
          analysisWindow: "current-month-to-date",
          from: "2026-06-01",
          to: "2026-06-16",
          expectedDataSnapshotId: currentProjectResult.snapshot.context.dataSnapshotId,
          expectedProjectReleaseId: currentProjectResult.snapshot.projectRelease.id,
        },
        databasePath,
        now: new Date("2026-08-06T00:00:00.000Z"),
      });
      expect(pinnedLevelResult.status).toBe("ready");
      if (pinnedLevelResult.status !== "ready") throw new Error("Expected pinned Level analysis");
      expect(pinnedLevelResult.snapshot.context).toMatchObject({
        period: "Custom",
        from: currentProjectResult.snapshot.context.from,
        to: currentProjectResult.snapshot.context.to,
        dataSnapshotId: currentProjectResult.snapshot.context.dataSnapshotId,
      });
      expect(pinnedLevelResult.snapshot.projectRelease.id)
        .toBe(currentProjectResult.snapshot.projectRelease.id);

      await expect(resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        request: {
          projectId: NGEE_ANN_GOLDEN.projectId,
          scopeId: "level-7",
          resource: "electricity",
          analysisWindow: "current-month-to-date",
          from: "2026-06-01",
          to: "2026-06-16",
          expectedDataSnapshotId: "stale-snapshot",
          expectedProjectReleaseId: currentProjectResult.snapshot.projectRelease.id,
        },
        databasePath,
      })).rejects.toThrow("ENERGYIQ_DATA_SNAPSHOT_MISMATCH");

      await expect(resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        request: {
          projectId: NGEE_ANN_GOLDEN.projectId,
          scopeId: "level-7",
          resource: "electricity",
          analysisWindow: "current-month-to-date",
          from: "2026-06-01",
          to: "2026-06-16",
          expectedDataSnapshotId: currentProjectResult.snapshot.context.dataSnapshotId,
          expectedProjectReleaseId: "stale-release",
        },
        databasePath,
      })).rejects.toThrow("ENERGYIQ_PROJECT_RELEASE_MISMATCH");

      await expect(resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        request: {
          projectId: NGEE_ANN_GOLDEN.projectId,
          scopeId: "level-7",
          resource: "electricity",
          analysisWindow: "current-month-to-date",
          expectedDataSnapshotId: currentProjectResult.snapshot.context.dataSnapshotId,
        },
        databasePath,
      })).rejects.toThrow("ENERGYIQ_CURRENT_OVERVIEW_PIN_INCOMPLETE");

      await expect(resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        request: {
          projectId: NGEE_ANN_GOLDEN.projectId,
          scopeId: "level-7",
          resource: "electricity",
          analysisWindow: "current-month-to-date",
          from: "2026-05-21",
          to: "2026-06-15",
          expectedDataSnapshotId: currentProjectResult.snapshot.context.dataSnapshotId,
          expectedProjectReleaseId: currentProjectResult.snapshot.projectRelease.id,
        },
        databasePath,
      })).rejects.toThrow("ENERGYIQ_CURRENT_OVERVIEW_WINDOW_MISMATCH");
      const resolve = (
        scopeId: string,
        from: string,
        to: string,
        factsPath = databasePath,
        dataGateway = gateway,
      ) =>
        resolveProjectAnalysis({
          metadataStore: metadata,
          dataGateway,
          user,
          workspaceId: NGEE_ANN_WORKSPACE_ID,
          request: {
            projectId: NGEE_ANN_GOLDEN.projectId,
            scopeId,
            resource: "electricity",
            period: "Custom",
            from,
            to,
          },
          databasePath: factsPath,
        });

      const projectResult = await resolve("project", "2026-08-01", "2026-08-07");
      expect(projectResult.status).toBe("ready");
      if (projectResult.status !== "ready") throw new Error("Expected ready Project analysis");
      expect(projectResult.snapshot.analysis.summary.validIntervalCount).toBe(0);
      expect(projectResult.snapshot.latestAvailablePeriod).toEqual({
        period: "Custom",
        from: NGEE_ANN_GOLDEN.selection.period.localFrom,
        to: "2026-06-16",
      });

      const levelResult = await resolve("level-6", "2026-08-01", "2026-08-07");
      expect(levelResult.status).toBe("ready");
      if (levelResult.status !== "ready") throw new Error("Expected ready Level analysis");
      expect(levelResult.snapshot.analysis.summary.validIntervalCount).toBe(0);
      expect(levelResult.snapshot.latestAvailablePeriod).toEqual(
        projectResult.snapshot.latestAvailablePeriod,
      );

      const multiWindowLevelResult = await resolve("level-7", "2026-08-01", "2026-08-07");
      expect(multiWindowLevelResult.status).toBe("ready");
      if (multiWindowLevelResult.status !== "ready") {
        throw new Error("Expected ready multi-window Level analysis");
      }
      expect(multiWindowLevelResult.snapshot.latestAvailablePeriod).toEqual(
        projectResult.snapshot.latestAvailablePeriod,
      );

      const qualityEventResult = await resolve("l7-front-light", "2026-08-01", "2026-08-07");
      expect(qualityEventResult.status).toBe("ready");
      if (qualityEventResult.status !== "ready") throw new Error("Expected quality-event analysis");
      expect(qualityEventResult.snapshot.latestAvailablePeriod).toEqual({
        period: "Custom",
        from: "2026-06-03",
        to: "2026-06-09",
      });

      const compensatingIntervalsResult = await resolve(
        "l6-light-left",
        "2026-08-01",
        "2026-08-07",
      );
      expect(compensatingIntervalsResult.status).toBe("ready");
      if (compensatingIntervalsResult.status !== "ready") {
        throw new Error("Expected compensating-interval analysis");
      }
      expect(compensatingIntervalsResult.snapshot).not.toHaveProperty("latestAvailablePeriod");
      const compensatingSelectedPeriod = await resolve(
        "l6-light-left",
        "2026-06-10",
        "2026-06-16",
      );
      expect(compensatingSelectedPeriod.status).toBe("ready");
      if (compensatingSelectedPeriod.status !== "ready") {
        throw new Error("Expected selected compensating-interval analysis");
      }
      expect(compensatingSelectedPeriod.snapshot.analysis.dataHealth).toMatchObject({
        validIntervalCount: 7 * 24 * 4,
        expectedMeterIntervalCount: 7 * 24 * 4,
        qualityEventCount: 0,
      });

      const noCandidateResult = await resolve("l6-light-right", "2026-08-01", "2026-08-07");
      expect(noCandidateResult.status).toBe("ready");
      if (noCandidateResult.status !== "ready") throw new Error("Expected ready Circuit analysis");
      expect(noCandidateResult.snapshot.analysis.summary.validIntervalCount).toBe(0);
      expect(noCandidateResult.snapshot).not.toHaveProperty("latestAvailablePeriod");

      const healthyResult = await resolve(
        "project",
        NGEE_ANN_GOLDEN.selection.period.localFrom,
        "2026-06-16",
      );
      expect(healthyResult.status).toBe("ready");
      if (healthyResult.status !== "ready") throw new Error("Expected healthy Project analysis");
      expect(healthyResult.snapshot.analysis.summary.validIntervalCount).toBeGreaterThan(0);
      expect(healthyResult.snapshot.analysis.timeBehaviour).toBeDefined();
      expect(healthyResult.snapshot.analysis.provenance.queryIds).toContain("time_bucket_grid_v1");
      expect(healthyResult.snapshot.analysis.dailyUsageAnomalies?.status).toBe("available");
      expect(healthyResult.snapshot.decisionPriorities).toEqual({
        status: "partial",
        limitation: {
          code: "SOME_CANDIDATE_DATES_SUPPRESSED",
          message: "Some candidate dates were suppressed, so the absence of a priority is not a complete no-exception conclusion.",
        },
        evidencePins: healthyResult.snapshot.analysis.dailyUsageAnomalies?.status === "available"
          ? healthyResult.snapshot.analysis.dailyUsageAnomalies.evidencePins
          : undefined,
        items: [],
      });
      expect(healthyResult.snapshot).not.toHaveProperty("latestAvailablePeriod");

      const anomalyFailingGateway = new LocalDataGateway(metadata);
      const runSqlReadonly = anomalyFailingGateway.runSqlReadonly.bind(anomalyFailingGateway);
      anomalyFailingGateway.runSqlReadonly = async (request) => {
        if (request.sql.includes("series_definitions.series_id")) {
          throw new Error("OPTIONAL_ANOMALY_QUERY_FAILED");
        }
        return runSqlReadonly(request);
      };
      const anomalyUnavailableResult = await resolve(
        "project",
        NGEE_ANN_GOLDEN.selection.period.localFrom,
        "2026-06-16",
        databasePath,
        anomalyFailingGateway,
      );
      expect(anomalyUnavailableResult.status).toBe("ready");
      if (anomalyUnavailableResult.status !== "ready") {
        throw new Error("Expected child-local anomaly failure");
      }
      expect(anomalyUnavailableResult.snapshot.analysis.summary)
        .toMatchObject({
          usageKwh: healthyResult.snapshot.analysis.summary.usageKwh,
          validIntervalCount: healthyResult.snapshot.analysis.summary.validIntervalCount,
          qualityEventCount: healthyResult.snapshot.analysis.summary.qualityEventCount,
        });
      expect(anomalyUnavailableResult.snapshot.analysis.dailyUsageAnomalies).toMatchObject({
        status: "unavailable",
        reason: { code: "DAILY_USAGE_ANOMALY_FACTS_UNAVAILABLE" },
      });
      expect(anomalyUnavailableResult.snapshot.decisionPriorities).toMatchObject({
        status: "unavailable",
        limitation: { code: "DAILY_USAGE_ANOMALIES_UNAVAILABLE" },
        items: [],
      });

      for (const message of [
        "ENERGYIQ_SNAPSHOT_STALE:concurrent-snapshot",
        "ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE",
        "ENERGYIQ_LATEST_COMPLETE_PERIOD_UNKNOWN",
      ]) {
        const failingGateway = new LocalDataGateway(metadata);
        const runSqlReadonly = failingGateway.runSqlReadonly.bind(failingGateway);
        failingGateway.runSqlReadonly = async (request) => {
          if (request.sql.includes("complete_day_count")) throw new Error(message);
          return runSqlReadonly(request);
        };
        await expect(resolve(
          "project",
          "2026-08-01",
          "2026-08-07",
          databasePath,
          failingGateway,
        )).rejects.toThrow(message);
      }

      await expect(resolve(
        "project",
        "2026-08-01",
        "2026-08-07",
        join(root, "missing-energy.duckdb"),
      )).rejects.toThrow("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
    } finally {
      metadata.close();
      removeTemporaryFixture(root);
    }
  }, 30_000);

  it("reuses a fully pinned Ngee Ann current Overview without repeating Period or fact SQL", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-analysis-pinned-cache-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      await materializeNgeeAnnLatestPeriodFixture(databasePath, metadata);
      const user = metadata.users.getById({ user_id: "dev-user" });
      const runSqlReadonly = vi.spyOn(gateway, "runSqlReadonly");
      const current = await resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        request: {
          projectId: NGEE_ANN_GOLDEN.projectId,
          scopeId: "project",
          resource: "electricity",
          analysisWindow: "current-month-to-date",
        },
        databasePath,
        now: new Date("2026-08-06T00:00:00.000Z"),
      });
      expect(current.status).toBe("ready");
      if (current.status !== "ready") throw new Error("Expected current Ngee Ann analysis");
      const pinnedInput = {
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        request: {
          projectId: NGEE_ANN_GOLDEN.projectId,
          scopeId: "level-6",
          resource: "electricity" as const,
          analysisWindow: "current-month-to-date" as const,
          from: "2026-06-01",
          to: "2026-06-16",
          expectedDataSnapshotId: current.snapshot.context.dataSnapshotId,
          expectedProjectReleaseId: current.snapshot.projectRelease.id,
        },
        databasePath,
        now: new Date("2026-08-06T00:00:00.000Z"),
      };
      const baselineSqlCount = runSqlReadonly.mock.calls.length;

      const coldStartedAt = performance.now();
      const cold = await resolveProjectAnalysis(pinnedInput);
      const coldDurationMs = performance.now() - coldStartedAt;
      const coldSqlCount = runSqlReadonly.mock.calls.length;
      expect(cold).toMatchObject({ status: "ready" });
      expect(coldSqlCount).toBeGreaterThan(baselineSqlCount);

      const hitStartedAt = performance.now();
      const hit = await resolveProjectAnalysis(pinnedInput);
      const hitDurationMs = performance.now() - hitStartedAt;
      expect(hit).toEqual(cold);
      expect(runSqlReadonly).toHaveBeenCalledTimes(coldSqlCount);
      expect(hitDurationMs).toBeLessThan(coldDurationMs / 5);

      const refreshStartedAt = performance.now();
      const refreshed = await resolveProjectAnalysis({ ...pinnedInput, bypassCache: true });
      const refreshDurationMs = performance.now() - refreshStartedAt;
      expect(refreshed).toMatchObject({ status: "ready" });
      expect(runSqlReadonly.mock.calls.length).toBeGreaterThan(coldSqlCount);
      expect(refreshDurationMs).toBeGreaterThan(hitDurationMs * 5);

      await expect(resolveProjectAnalysis({
        ...pinnedInput,
        request: {
          ...pinnedInput.request,
          from: "2026-05-21",
          to: "2026-06-15",
        },
      })).rejects.toThrow("ENERGYIQ_CURRENT_OVERVIEW_WINDOW_MISMATCH");
    } finally {
      vi.restoreAllMocks();
      metadata.close();
      removeTemporaryFixture(root);
    }
  }, 30_000);

  it("keeps the Preschool current Overview on its rolling 28-day window after Ngee Ann adopts month-to-date", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-analysis-preschool-current-window-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      await materializePreschoolGoldenFixture(databasePath, metadata, {
        transformIntervalFacts: (facts) => facts.map((fact) => ({
          ...fact,
          intervalStart: shiftFixtureIsoDate(fact.intervalStart, 67),
          intervalEnd: shiftFixtureIsoDate(fact.intervalEnd, 67),
          localDate: "2026-07-07",
          dayType: "weekday" as const,
        })),
      });

      const current = await resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        request: {
          projectId: PRESCHOOL_GOLDEN.projectId,
          scopeId: "project",
          resource: "electricity",
          analysisWindow: "current-project-overview",
        },
        databasePath,
        now: new Date("2026-08-05T00:00:00.000Z"),
      });
      expect(current.status).toBe("ready");
      if (current.status !== "ready") throw new Error("Expected current Preschool analysis");

      const pinned = await resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        request: {
          projectId: PRESCHOOL_GOLDEN.projectId,
          scopeId: "project",
          resource: "electricity",
          analysisWindow: "current-overview-28d",
          from: "2026-06-10",
          to: "2026-07-07",
          expectedDataSnapshotId: current.snapshot.context.dataSnapshotId,
          expectedProjectReleaseId: current.snapshot.projectRelease.id,
        },
        databasePath,
        now: new Date("2026-08-05T00:00:00.000Z"),
      });

      expect(pinned.status).toBe("ready");
      if (pinned.status !== "ready") throw new Error("Expected pinned Preschool analysis");
      expect(pinned.snapshot.context).toMatchObject({
        from: "2026-06-09T16:00:00.000Z",
        to: "2026-07-07T16:00:00.000Z",
        dataSnapshotId: current.snapshot.context.dataSnapshotId,
        projectReleaseId: current.snapshot.projectRelease.id,
      });
      expect(pinned.snapshot.reportTimeContext).toMatchObject({
        policyId: "preschool-report-time",
        policyRevision: "1",
        dataThroughLocalDate: "2026-07-07",
      });
      expect(pinned.snapshot.reportTimeContext?.windows).toEqual(expect.arrayContaining([
        expect.objectContaining({
          windowId: "current-overview",
          label: "Recent 28 complete days",
          phase: "complete",
          from: "2026-06-09T16:00:00.000Z",
          toExclusive: "2026-07-07T16:00:00.000Z",
          completeDayCount: 28,
        }),
        expect.objectContaining({
          windowId: "next-month-outlook",
          label: "Next complete calendar month",
          phase: "forecast",
        }),
      ]));
    } finally {
      metadata.close();
      removeTemporaryFixture(root);
    }
  }, 30_000);

  it("advances the Preschool target month from the latest complete Snapshot day while the Overview stays pinned to May", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-analysis-preschool-target-month-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      await materializePreschoolGoldenFixture(databasePath, metadata, {
        transformIntervalFacts: (facts) => [
          ...facts,
          ...facts.map((fact) => ({
            ...fact,
            intervalStart: shiftFixtureIsoDate(fact.intervalStart, 60),
            intervalEnd: shiftFixtureIsoDate(fact.intervalEnd, 60),
            localDate: "2026-06-30",
            dayType: "weekday" as const,
          })),
        ],
      });

      const result = await resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        request: {
          projectId: PRESCHOOL_GOLDEN.projectId,
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: "2026-05-01",
          to: "2026-05-31",
        },
        databasePath,
      });

      expect(result.status).toBe("ready");
      if (result.status !== "ready") throw new Error("Expected ready Preschool analysis");
      expect(result.snapshot.context).toMatchObject({
        from: "2026-04-30T16:00:00.000Z",
        to: "2026-05-31T16:00:00.000Z",
        latestCompleteLocalDay: "2026-06-30",
        monthlyOutlookTargetPeriod: {
          start: "2026-07-01",
          endExclusive: "2026-08-01",
          timezone: "Asia/Singapore",
          targetDayCount: 31,
        },
      });
    } finally {
      metadata.close();
      removeTemporaryFixture(root);
    }
  }, 30_000);

  it("returns a versioned Preschool Snapshot from one trusted Resolver Interface", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-analysis-resolver-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      const preschoolSnapshot = await materializePreschoolGoldenFixture(databasePath, metadata);
      const result = await resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        request: {
          projectId: "preschool-demo",
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: "2026-05-01",
          to: "2026-05-31",
        },
        databasePath,
      });

      expect(result.status).toBe("ready");
      if (result.status !== "ready") throw new Error("Expected ready analysis");
      expect(result.snapshot).toMatchObject({
        context: {
          workspaceId: PRESCHOOL_WORKSPACE_ID,
          projectId: "preschool-demo",
          scopeId: "preschool-project",
          from: "2026-04-30T16:00:00.000Z",
          to: "2026-05-31T16:00:00.000Z",
          projectReleaseId: "legacy-profile:preschool-demo:1",
          primaryPeriod: {
            start: "2026-04-30T16:00:00.000Z",
            endExclusive: "2026-05-31T16:00:00.000Z",
          },
        },
        projectRelease: {
          id: "legacy-profile:preschool-demo:1",
          source: "legacy-profile",
          templateRevisionId: null,
        },
        recipe: { id: "energy-scope-analysis", version: "1" },
        renderer: {
          key: "preschool-overview",
          version: "1",
          contractVersion: "project-analysis-snapshot@1",
        },
        dataQuality: { status: "partial", coveragePct: 3.2258 },
        dataSnapshot: {
          id: preschoolSnapshot.id,
        },
        analysis: {
          summary: { usageKwh: PRESCHOOL_GOLDEN.period.usageKwh },
        },
      });
      expect(result.snapshot.evidence.length).toBeGreaterThan(0);
      expect(result.snapshot.evidence.every((item) => (
        item.id.length > 0
        && item.metricId.length > 0
        && item.queryIds.length > 0
        && item.queryIds.every((queryId) => result.snapshot.analysis.provenance.queryIds.includes(queryId))
        && !Object.hasOwn(item, "queryReceiptId")
      ))).toBe(true);
      expect(new Set(result.snapshot.evidence.map((item) => item.id)).size)
        .toBe(result.snapshot.evidence.length);
      expect(result.snapshot.findings).toEqual(result.snapshot.analysis.attention);
      expect(result.snapshot).not.toHaveProperty("decisionPriorities");
      const completeProjectDays = result.snapshot.analysis.dailyTotals?.scopes
        .find((scope) => scope.scopeId === "preschool-project")?.rows
        .filter((row) => row.dataHealth.status === "complete") ?? [];
      expect(completeProjectDays.length).toBeLessThan(28);
      expect(result.snapshot).not.toHaveProperty("preschoolBenchmark");
      expect(result.snapshot.preschoolDecisionSignals).toMatchObject({
        contract: { id: "preschool-decision-signals", version: "1" },
        context: {
          projectReleaseId: "legacy-profile:preschool-demo:1",
          dataSnapshotId: preschoolSnapshot.id,
        },
        status: "withheld",
        reason: { code: "SNAPSHOT_INCOMPLETE" },
        items: [],
      });
      expect(result.snapshot.preschoolOperational).toMatchObject({
        status: "unavailable",
        reason: { code: "PRESCHOOL_OPERATING_CALENDAR_UNAVAILABLE" },
        evidence: {
          projectReleaseId: "legacy-profile:preschool-demo:1",
          dataSnapshotId: preschoolSnapshot.id,
        },
      });
      expect(result.snapshot.analysis.timeBehaviour).toBeUndefined();
      expect(result.snapshot.analysis.provenance.queryIds).not.toContain("time_bucket_grid_v1");
      expect(result.snapshot.analysis.provenance.queryIds)
        .not.toContain("operational_policy_meter_intervals_v1");
      expect(result.snapshot.metadata).toMatchObject({
        hierarchyRevisionId: "preschool-hierarchy-v4",
        timezone: "Asia/Singapore",
        selectedScope: {
          scopeId: "preschool-project",
          scopeName: "Preschool Portfolio",
          status: "missing",
          normalisations: {
            eui: {
              status: "missing",
              value: null,
            },
            perPax: {
              status: "missing",
              value: null,
            },
          },
        },
      });
      expect(result.snapshot.metadata.comparisonScopes).toHaveLength(30);
      expect(result.snapshot.metadata.comparisonScopes[0]).toMatchObject({
        scopeId: PRESCHOOL_GOLDEN.centreA.scopeId,
        scopeName: "Centre A",
        usageKwh: PRESCHOOL_GOLDEN.centreA.usageKwh,
        status: "provisional",
        area: { status: "provisional", value: 743, unit: "m2" },
        headcount: { status: "provisional", value: 58, unit: "people" },
        normalisations: {
          eui: { status: "provisional", unit: "kWh/m2" },
          perPax: { status: "provisional", unit: "kWh/person" },
        },
      });
      expect(result.snapshot.metadata.comparisonScopes[0]?.normalisations.eui.value)
        .toBeCloseTo(PRESCHOOL_GOLDEN.centreA.usageKwh / 743, 8);
      expect(result.snapshot.metadata.comparisonScopes[0]?.normalisations.perPax.value)
        .toBeCloseTo(PRESCHOOL_GOLDEN.centreA.usageKwh / 58, 8);
      expect(result.snapshot.analysis.childScopes[0]).toMatchObject({
        nodeId: PRESCHOOL_GOLDEN.centreA.scopeId,
        areaSqm: 743,
        occupantCount: 58,
        kwhPerSqm: PRESCHOOL_GOLDEN.centreA.usageKwh / 743,
        kwhPerPerson: PRESCHOOL_GOLDEN.centreA.usageKwh / 58,
        metadata: {
          status: "provisional",
          normalisations: {
            eui: { status: "provisional" },
            perPax: { status: "provisional" },
          },
        },
      });
      expect(result.snapshot.metadata.evidence[0]).toMatchObject({
        scopeId: PRESCHOOL_GOLDEN.centreA.scopeId,
        dimension: "area",
        value: 743,
        status: "provisional",
        hierarchyRevisionId: "preschool-hierarchy-v4",
      });
      expect(result.snapshot.analysis.metadata).toEqual(result.snapshot.metadata);

      const selectedCentreResult = await resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        request: {
          projectId: "preschool-demo",
          scopeId: PRESCHOOL_GOLDEN.centreA.scopeId,
          resource: "electricity",
          period: "Custom",
          from: "2026-05-01",
          to: "2026-05-31",
        },
        databasePath,
      });
      expect(selectedCentreResult.status).toBe("ready");
      if (selectedCentreResult.status !== "ready") throw new Error("Expected Centre analysis");
      expect(selectedCentreResult.snapshot.metadata.selectedScope).toMatchObject({
        scopeId: PRESCHOOL_GOLDEN.centreA.scopeId,
        scopeName: "Centre A",
        usageKwh: PRESCHOOL_GOLDEN.centreA.usageKwh,
        status: "provisional",
        area: { value: 743, status: "provisional" },
        headcount: { value: 58, status: "provisional" },
        normalisations: {
          eui: { status: "provisional" },
          perPax: { status: "provisional" },
        },
      });
      expect(selectedCentreResult.snapshot.analysis.summary).toMatchObject({
        areaSqm: 743,
        occupantCount: 58,
        kwhPerSqm: PRESCHOOL_GOLDEN.centreA.usageKwh / 743,
        kwhPerPerson: PRESCHOOL_GOLDEN.centreA.usageKwh / 58,
      });

      const project = metadata.energyIq.getProject("preschool-demo");
      const publishedRevision = metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
        project_id: "preschool-demo",
        tier_definition_ids: metadata.energyIq.listTierDefinitions("preschool-demo")
          .map((tier) => tier.id),
        hierarchy_revision_id: project.hierarchy_revision_id,
        meter_mapping_revision_id: resolveEnergyPublishedMeterRoute({ metadataStore: metadata, projectId: project.id, hierarchyRevisionId: project.hierarchy_revision_id, scopeId: project.root_scope_id, resource: "electricity" }).meterMappingRevisionId,
        published_by: "dev-user",
        published_at: "2026-08-04T00:00:00.000Z",
      });
      metadata.energyIq.upsertProject({
        ...project,
        hierarchy_revision_id: "unpublished-hierarchy-drift",
        meter_formula_revision_id: "unpublished-meter-formula-drift",
        metric_version: "unpublished-metric-drift",
        business_calendar_version: "unpublished-calendar-drift",
        tariff_schedule_version: "unpublished-tariff-drift",
      });
      const releasedResult = await resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        request: {
          projectId: "preschool-demo",
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: "2026-05-01",
          to: "2026-05-31",
        },
        databasePath,
      });
      expect(releasedResult.status).toBe("ready");
      if (releasedResult.status !== "ready") throw new Error("Expected released analysis");
      expect(releasedResult.snapshot.projectRelease).toMatchObject({
        id: publishedRevision.revision_id,
        source: "template-revision",
        templateRevisionId: publishedRevision.revision_id,
        hierarchyRevisionId: publishedRevision.hierarchy_revision_id,
        metricRevisionIds: publishedRevision.selected_metric_revision_ids,
        ruleRevisionIds: publishedRevision.selected_rule_revision_ids,
      });
      expect(releasedResult.snapshot.context).toMatchObject({
        projectReleaseId: publishedRevision.revision_id,
        hierarchyRevisionId: publishedRevision.hierarchy_revision_id,
        meterFormulaRevisionId: publishedRevision.meter_formula_revision_id,
        metricVersion: `metric-revisions:${[...publishedRevision.selected_metric_revision_ids]
          .sort((left, right) => left.localeCompare(right))
          .join(",") || "none"}`,
        businessCalendarVersion: publishedRevision.business_calendar_version,
        tariffScheduleVersion: publishedRevision.tariff_schedule_version,
        primaryPeriod: {
          start: "2026-04-30T16:00:00.000Z",
          endExclusive: "2026-05-31T16:00:00.000Z",
        },
      });
      expect(releasedResult.snapshot.analysis.provenance).toMatchObject({
        hierarchyRevisionId: publishedRevision.hierarchy_revision_id,
        meterFormulaRevisionId: publishedRevision.meter_formula_revision_id,
        metricVersion: `metric-revisions:${[...publishedRevision.selected_metric_revision_ids]
          .sort((left, right) => left.localeCompare(right))
          .join(",") || "none"}`,
      });
      expect(releasedResult.snapshot.analysis.cost).toMatchObject({
        tariffScheduleVersion: publishedRevision.tariff_schedule_version,
      });
      expect(releasedResult.snapshot.evidence).toEqual(result.snapshot.evidence);

      const anotherPeriodResult = await resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        request: {
          projectId: "preschool-demo",
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: "2026-05-01",
          to: "2026-05-02",
        },
        databasePath,
      });
      expect(anotherPeriodResult.status).toBe("ready");
      if (anotherPeriodResult.status !== "ready") throw new Error("Expected another period");
      expect(anotherPeriodResult.snapshot.evidence.map((item) => item.id))
        .not.toEqual(releasedResult.snapshot.evidence.map((item) => item.id));
    } finally {
      metadata.close();
      removeTemporaryFixture(root);
    }
  }, 30_000);
});

const materializeNgeeAnnLatestPeriodFixture = async (
  databasePath: string,
  metadataStore: ReturnType<typeof createMetadataStore>,
) => {
  const importBatchId = "ngee-ann-latest-period-contract-fixture";
  const sourceSha256 = "f".repeat(64);
  const sourceFile = `${importBatchId}.xlsx`;
  const localFromMs = Date.parse("2026-06-02T16:00:00.000Z");
  const meters = [
    {
      id: "mapping-lvl-6-total-office-light-8",
      scopeId: "level-6",
      sourceLabel: "Lvl 6 Total Office Light",
      category: "light" as const,
      meterRole: "total" as const,
      parentNodeId: "level-6",
      pattern: "latest-seven" as const,
    },
    {
      id: "mapping-lvl-6-total-office-load-9",
      scopeId: "level-6",
      sourceLabel: "Lvl 6 Total Office Load",
      category: "load" as const,
      meterRole: "total" as const,
      parentNodeId: "level-6",
      pattern: "latest-seven" as const,
    },
    {
      id: "mapping-lvl-7-total-office-light-17",
      scopeId: "level-7",
      sourceLabel: "Lvl 7 Total Office Light",
      category: "light" as const,
      meterRole: "total" as const,
      parentNodeId: "level-7",
      pattern: "complete-fourteen" as const,
    },
    {
      id: "mapping-lvl-7-total-office-load-18",
      scopeId: "level-7",
      sourceLabel: "Lvl 7 Total Office Load",
      category: "load" as const,
      meterRole: "total" as const,
      parentNodeId: "level-7",
      pattern: "complete-fourteen" as const,
    },
    {
      id: "mapping-lvl-7-front-row-office-light-11",
      scopeId: "l7-front-light",
      sourceLabel: "Lvl 7 Front Row Office Light",
      category: "light" as const,
      meterRole: "component" as const,
      parentNodeId: "level-7",
      pattern: "quality-event" as const,
    },
    {
      id: "mapping-lvl-6-office-light-left-external-1",
      scopeId: "l6-light-left",
      sourceLabel: "Lvl 6 Office Light-Left: External",
      category: "light" as const,
      meterRole: "component" as const,
      parentNodeId: "level-6",
      pattern: "compensating-intervals" as const,
    },
  ];
  const intervalFacts: EnergyIntervalFactWrite[] = meters.flatMap((meter) => {
    const firstIntervalIndex = meter.pattern === "latest-seven"
      || meter.pattern === "compensating-intervals"
      ? 7 * 24 * 4
      : 0;
    const intervalCount = meter.pattern === "latest-seven"
      || meter.pattern === "compensating-intervals"
      ? 7 * 24 * 4
      : 14 * 24 * 4;
    const intervalIndexes = Array.from(
      { length: intervalCount },
      (_, index) => firstIntervalIndex + index,
    );
    if (meter.pattern === "compensating-intervals") {
      intervalIndexes.shift();
      intervalIndexes.push(firstIntervalIndex + 24 * 4 + 0.5);
    }
    return intervalIndexes.map((intervalIndex, index) => {
      const intervalStartMs = localFromMs + intervalIndex * 15 * 60_000;
      const local = new Date(intervalStartMs + 8 * 60 * 60_000);
      const qualityStatus = meter.pattern === "quality-event" && intervalIndex === 7 * 24 * 4
        ? "negative_delta"
        : "ok";
      return {
        workspaceId: NGEE_ANN_GOLDEN.workspaceId,
        projectId: NGEE_ANN_GOLDEN.projectId,
        importBatchId,
        resource: "electricity",
        meterPointId: meter.id,
        scopeId: meter.scopeId,
        parentNodeId: meter.parentNodeId,
        sourceLabel: meter.sourceLabel,
        category: meter.category,
        meterRole: meter.meterRole,
        intervalStart: new Date(intervalStartMs).toISOString(),
        intervalEnd: new Date(intervalStartMs + 15 * 60_000).toISOString(),
        elapsedMinutes: 15,
        activeEnergyKwh: 1_000 + (index + 1) * 0.25,
        previousActiveEnergyKwh: 1_000 + index * 0.25,
        rawDeltaKwh: 0.25,
        ...(qualityStatus === "ok" ? { usageKwh: 0.25, averageKw: 1 } : {}),
        qualityStatus,
        localDate: local.toISOString().slice(0, 10),
        localHour: local.getUTCHours(),
        dayType: [0, 6].includes(local.getUTCDay()) ? "weekend" : "weekday",
        sourceFile,
        sourceSha256,
        sourceReadingKind: "interval_usage",
      } satisfies EnergyIntervalFactWrite;
    });
  });
  const batches: EnergyFactMaterializationBatchWrite[] = [{
    importBatchId,
    sourceSha256,
    rawReadings: [],
    normalizedReadings: [],
    intervalFacts,
    qualityEvents: [],
  }];
  return materializeTestProjectSnapshot({
    metadataStore,
    databasePath,
    workspaceId: NGEE_ANN_GOLDEN.workspaceId,
    projectId: NGEE_ANN_GOLDEN.projectId,
    timezone: NGEE_ANN_GOLDEN.timezone,
    batches,
  });
};

const shiftFixtureIsoDate = (value: string, days: number): string => {
  const shifted = new Date(value);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString();
};

const removeTemporaryFixture = (root: string): void => {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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
