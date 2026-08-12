import { LocalDataGateway } from "@datafoundry/data-gateway";
import { createMetadataStore, energyIqPublishedMeterRoutingRevisionId } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  ensureEnergyIqBootstrap,
  PRESCHOOL_WORKSPACE_ID,
} from "./energy-bootstrap.js";
import { materializePreschoolGoldenFixture } from "./preschool-golden.fixture.js";
import { resolveProjectAnalysis } from "./project-analysis-resolver.js";

describe("ProjectAnalysisResolver deterministic result reuse", () => {
  it("reuses one authorized success until an explicit refresh bypasses it", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-analysis-cache-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      await materializePreschoolGoldenFixture(databasePath, metadata);
      metadata.users.upsertDevUser({
        id: "preschool-cache-viewer",
        email: "preschool-cache-viewer@example.com",
        display_name: "Preschool Cache Viewer",
        dev_token: "preschool-cache-viewer-token",
      });
      metadata.workspaceMemberships.upsert({
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        user_id: "preschool-cache-viewer",
        role: "member",
      });
      metadata.energyIq.upsertProjectAccess({
        project_id: "preschool-demo",
        user_id: "preschool-cache-viewer",
        role: "viewer",
      });
      const runSqlReadonly = vi.spyOn(gateway, "runSqlReadonly");
      const baseInput = {
        metadataStore: metadata,
        dataGateway: gateway,
        user: metadata.users.getById({ user_id: "preschool-cache-viewer" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        request: {
          projectId: "preschool-demo",
          scopeId: "project",
          resource: "electricity" as const,
          period: "Custom" as const,
          from: "2026-05-01",
          to: "2026-05-31",
        },
        databasePath,
        now: new Date("2026-06-01T00:00:00.000Z"),
      };

      const firstStartedAt = performance.now();
      const first = await resolveProjectAnalysis(baseInput);
      const firstDurationMs = performance.now() - firstStartedAt;
      const firstExecutionSqlCount = runSqlReadonly.mock.calls.length;
      expect(first).toMatchObject({ status: "ready" });
      expect(firstExecutionSqlCount).toBeGreaterThan(0);

      const repeatedStartedAt = performance.now();
      const repeated = await resolveProjectAnalysis(baseInput);
      const repeatedDurationMs = performance.now() - repeatedStartedAt;
      expect(repeated).toEqual(first);
      expect(runSqlReadonly).toHaveBeenCalledTimes(firstExecutionSqlCount);
      expect(repeatedDurationMs).toBeLessThan(firstDurationMs / 5);

      const publishedProject = metadata.energyIq.getProject("preschool-demo");
      const setProjectStatus = (status: "draft" | "published") => metadata.energyIq.upsertProject({
        id: publishedProject.id,
        workspace_id: publishedProject.workspace_id,
        name: publishedProject.name,
        status,
        timezone: publishedProject.timezone,
        hierarchy_revision_id: publishedProject.hierarchy_revision_id,
        meter_formula_revision_id: publishedProject.meter_formula_revision_id,
        data_snapshot_id: publishedProject.data_snapshot_id,
        metric_version: publishedProject.metric_version,
        business_calendar_version: publishedProject.business_calendar_version,
        tariff_schedule_version: publishedProject.tariff_schedule_version,
        delivery_stage: publishedProject.delivery_stage,
        root_scope_id: publishedProject.root_scope_id,
        has_unpublished_changes: publishedProject.has_unpublished_changes,
      });
      setProjectStatus("draft");
      await expect(resolveProjectAnalysis(baseInput)).rejects.toThrow("ENERGYIQ_PROJECT_FORBIDDEN");
      expect(runSqlReadonly).toHaveBeenCalledTimes(firstExecutionSqlCount);
      setProjectStatus("published");
      await expect(resolveProjectAnalysis(baseInput)).resolves.toEqual(first);
      expect(runSqlReadonly).toHaveBeenCalledTimes(firstExecutionSqlCount);

      const refreshStartedAt = performance.now();
      const refreshed = await resolveProjectAnalysis({ ...baseInput, bypassCache: true });
      const refreshDurationMs = performance.now() - refreshStartedAt;
      expect(refreshed).toMatchObject({
        status: "ready",
        snapshot: {
          context: {
            dataSnapshotId: first.status === "ready" ? first.snapshot.context.dataSnapshotId : undefined,
            projectReleaseId: first.status === "ready" ? first.snapshot.context.projectReleaseId : undefined,
          },
        },
      });
      expect(runSqlReadonly.mock.calls.length).toBeGreaterThan(firstExecutionSqlCount);
      expect(refreshDurationMs).toBeGreaterThan(repeatedDurationMs * 5);

      const overviewInput = {
        ...baseInput,
        request: {
          projectId: "preschool-demo",
          scopeId: "project",
          resource: "electricity" as const,
          analysisWindow: "current-overview-28d" as const,
        },
      };
      const overview = await resolveProjectAnalysis(overviewInput);
      expect(overview).toMatchObject({
        status: "ready",
        snapshot: {
          preschoolPlanningLifecycle: {
            status: "unavailable",
            reason: { code: "NO_COMPATIBLE_SAVED_ANALYSIS" },
          },
        },
      });
      const overviewExecutionSqlCount = runSqlReadonly.mock.calls.length;
      const repeatedOverview = await resolveProjectAnalysis(overviewInput);
      expect(repeatedOverview).toEqual(overview);
      // Current-window selection performs one bounded latest-facts query before the result-cache
      // lookup. The cached analysis and absent-A planning adapter must add no further Kernel work.
      expect(runSqlReadonly).toHaveBeenCalledTimes(overviewExecutionSqlCount + 1);
    } finally {
      vi.restoreAllMocks();
      metadata.close();
      removeTemporaryFixture(root);
    }
  }, 30_000);

  it("reuses a compatible Saved Plan lifecycle for the same immutable Snapshot and Release", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-planning-lifecycle-cache-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      await materializePreschoolGoldenFixture(databasePath, metadata);
      const project = metadata.energyIq.getProject("preschool-demo");
      const tierDefinitionIds = metadata.energyIq.listTierDefinitions(project.id).map((tier) => tier.id);
      const mapping = metadata.energyIq.projectSetup.getDraft({
        project_id: project.id,
        user_id: "dev-user",
      }).document.meter_mapping;
      if (!mapping) throw new Error("Expected a published meter mapping");
      metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
        project_id: project.id,
        tier_definition_ids: tierDefinitionIds,
        hierarchy_revision_id: project.hierarchy_revision_id,
        meter_mapping_revision_id: energyIqPublishedMeterRoutingRevisionId(mapping),
        published_by: "dev-user",
        published_at: "2026-06-01T00:00:00.000Z",
      });
      const baseInput = {
        metadataStore: metadata,
        dataGateway: gateway,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        request: {
          projectId: "preschool-demo",
          scopeId: "project",
          resource: "electricity" as const,
          period: "Custom" as const,
          from: "2026-05-01",
          to: "2026-05-31",
        },
        databasePath,
        now: new Date("2026-06-01T00:00:00.000Z"),
      };
      const first = await resolveProjectAnalysis(baseInput);
      if (first.status !== "ready") throw new Error("Expected a ready Preschool analysis");

      const savedSnapshot = structuredClone(first.snapshot);
      const previousSnapshotId = "preschool-cache-saved-plan-snapshot";
      const planningTarget = first.snapshot.context.monthlyOutlookTargetPeriod;
      if (!planningTarget) throw new Error("Expected a Preschool planning target");
      const planningEndInclusive = new Date(`${planningTarget.endExclusive}T00:00:00.000Z`);
      planningEndInclusive.setUTCDate(planningEndInclusive.getUTCDate() - 1);
      savedSnapshot.context.dataSnapshotId = previousSnapshotId;
      savedSnapshot.dataSnapshot.id = previousSnapshotId;
      savedSnapshot.analysis.provenance.dataSnapshotId = previousSnapshotId;
      (savedSnapshot as unknown as { preschoolOperational: unknown }).preschoolOperational = {
        planningOutlook: {
          status: "provisional",
          contract: { id: "preschool-monthly-naive-weekly-baseline", version: "2" },
          targetPeriod: {
            start: planningTarget.start,
            endInclusive: planningEndInclusive.toISOString().slice(0, 10),
            endExclusive: planningTarget.endExclusive,
            timezone: planningTarget.timezone,
            days: planningTarget.targetDayCount,
          },
          sourceWeeks: [],
          weeklyBaseline: { averageKwh: 7_000, minimumKwh: 6_500, maximumKwh: 7_500 },
          usageEstimate: { projectedKwh: 30_000, lowerKwh: 28_000, upperKwh: 32_000 },
          costEstimate: {
            currency: "SGD",
            currentPeriodBeforeGstSgd: 7_500,
            projectedBeforeGstSgd: 8_000,
            lowerBeforeGstSgd: 7_500,
            upperBeforeGstSgd: 8_500,
          },
          evidence: {
            dataSnapshotId: previousSnapshotId,
            queryId: "daily_totals_v1",
            recipeId: "preschool-naive-weekly-planning-baseline-v1",
          },
          limitations: [],
        },
      };
      metadata.energyIq.savedAnalyses.create({
        id: "preschool-cache-saved-plan",
        series_id: "preschool-cache-saved-plan",
        project_id: first.snapshot.context.projectId,
        workspace_id: first.snapshot.context.workspaceId,
        scope_id: first.snapshot.context.scopeId,
        scope_name: "Preschool Portfolio",
        resource: "electricity",
        title: "Saved plan used by the cache regression",
        query_json: JSON.stringify(baseInput.request),
        analysis_json: JSON.stringify(savedSnapshot.analysis),
        snapshot_json: JSON.stringify(savedSnapshot),
        template_revision_id: first.snapshot.projectRelease.templateRevisionId!,
        data_snapshot_id: previousSnapshotId,
        created_by: "dev-user",
        created_at: "2026-06-01T00:00:00.000Z",
      });

      const runSqlReadonly = vi.spyOn(gateway, "runSqlReadonly");
      const lifecycle = await resolveProjectAnalysis(baseInput);
      expect(lifecycle).toMatchObject({
        status: "ready",
        snapshot: { preschoolPlanningLifecycle: { status: "available" } },
      });
      const lifecycleSqlCount = runSqlReadonly.mock.calls.length;
      expect(lifecycleSqlCount).toBeGreaterThan(0);
      const repeatedLifecycle = await resolveProjectAnalysis(baseInput);
      expect(repeatedLifecycle).toEqual(lifecycle);
      expect(runSqlReadonly).toHaveBeenCalledTimes(lifecycleSqlCount);
    } finally {
      vi.restoreAllMocks();
      metadata.close();
      removeTemporaryFixture(root);
    }
  }, 30_000);
});

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
