import {
  LocalDataGateway,
  type EnergyFactMaterializationBatchWrite,
  type EnergyIntervalFactWrite,
} from "@datafoundry/data-gateway";
import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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

  it("offers the same fixed Ngee Ann Golden range for empty Project and Level periods", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-analysis-latest-period-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      await materializeNgeeAnnLatestPeriodFixture(databasePath, metadata);
      const user = metadata.users.getById({ user_id: "dev-user" });
      const resolve = (scopeId: string, from: string, to: string, factsPath = databasePath) =>
        resolveProjectAnalysis({
          metadataStore: metadata,
          dataGateway: gateway,
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

      const noCandidateResult = await resolve("l6-light-left", "2026-08-01", "2026-08-07");
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
      expect(healthyResult.snapshot).not.toHaveProperty("latestAvailablePeriod");

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
    },
    {
      id: "mapping-lvl-6-total-office-load-9",
      scopeId: "level-6",
      sourceLabel: "Lvl 6 Total Office Load",
      category: "load" as const,
    },
    {
      id: "mapping-lvl-7-total-office-light-17",
      scopeId: "level-7",
      sourceLabel: "Lvl 7 Total Office Light",
      category: "light" as const,
    },
    {
      id: "mapping-lvl-7-total-office-load-18",
      scopeId: "level-7",
      sourceLabel: "Lvl 7 Total Office Load",
      category: "load" as const,
    },
  ];
  const intervalFacts: EnergyIntervalFactWrite[] = meters.flatMap((meter) =>
    Array.from({ length: 14 * 24 * 4 }, (_, index) => {
      const intervalStartMs = localFromMs + index * 15 * 60_000;
      const local = new Date(intervalStartMs + 8 * 60 * 60_000);
      return {
        workspaceId: NGEE_ANN_GOLDEN.workspaceId,
        projectId: NGEE_ANN_GOLDEN.projectId,
        importBatchId,
        resource: "electricity",
        meterPointId: meter.id,
        scopeId: meter.scopeId,
        parentNodeId: meter.scopeId,
        sourceLabel: meter.sourceLabel,
        category: meter.category,
        meterRole: "total",
        intervalStart: new Date(intervalStartMs).toISOString(),
        intervalEnd: new Date(intervalStartMs + 15 * 60_000).toISOString(),
        elapsedMinutes: 15,
        activeEnergyKwh: 1_000 + (index + 1) * 0.25,
        previousActiveEnergyKwh: 1_000 + index * 0.25,
        rawDeltaKwh: 0.25,
        usageKwh: 0.25,
        averageKw: 1,
        qualityStatus: "ok",
        localDate: local.toISOString().slice(0, 10),
        localHour: local.getUTCHours(),
        dayType: [0, 6].includes(local.getUTCDay()) ? "weekend" : "weekday",
        sourceFile,
        sourceSha256,
        sourceReadingKind: "interval_usage",
      } satisfies EnergyIntervalFactWrite;
    }),
  );
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
