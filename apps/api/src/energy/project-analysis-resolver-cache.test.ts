import { LocalDataGateway } from "@datafoundry/data-gateway";
import { createMetadataStore } from "@datafoundry/metadata";
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
