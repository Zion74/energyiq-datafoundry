import { LocalDataGateway } from "@datafoundry/data-gateway";
import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ensureEnergyIqBootstrap,
  PRESCHOOL_WORKSPACE_ID,
} from "./energy-bootstrap.js";
import {
  materializePreschoolGoldenFixture,
  PRESCHOOL_GOLDEN,
} from "./preschool-golden.fixture.js";
import { resolveProjectAnalysis } from "./project-analysis-resolver.js";

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

  it("returns configuration-required for an unregistered customer Project instead of a generic dashboard", async () => {
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
          period: "Yesterday",
        },
      });

      expect(result).toMatchObject({
        status: "configuration-required",
        projectId: "customer-without-renderer",
        title: "Project analysis is not configured",
      });
      expect(result).not.toHaveProperty("snapshot");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("returns a versioned Preschool Snapshot from one trusted Resolver Interface", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-analysis-resolver-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      await materializePreschoolGoldenFixture(databasePath);
      ensureEnergyIqBootstrap(metadata);
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
          id: "preschool-26b85b9c0b95e090",
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

      const project = metadata.energyIq.getProject("preschool-demo");
      const publishedRevision = metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
        project_id: "preschool-demo",
        tier_definition_ids: metadata.energyIq.listTierDefinitions("preschool-demo")
          .map((tier) => tier.id),
        hierarchy_revision_id: project.hierarchy_revision_id,
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
