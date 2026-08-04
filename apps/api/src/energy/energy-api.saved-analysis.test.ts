import { LocalDataGateway } from "@datafoundry/data-gateway";
import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConfigApiContext } from "../routes/types.js";
import {
  ensureEnergyIqBootstrap,
  PRESCHOOL_WORKSPACE_ID,
} from "./energy-bootstrap.js";
import { handleEnergyApiRequest } from "./energy-api.js";
import { materializePreschoolGoldenFixture } from "./preschool-golden.fixture.js";

describe("saved analysis decision-quality boundary", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("rejects low-coverage creation and rerun before either result is persisted", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-saved-analysis-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      await materializePreschoolGoldenFixture(databasePath);
      vi.stubEnv("ENERGYIQ_DUCKDB_PATH", databasePath);
      ensureEnergyIqBootstrap(metadata);
      const project = metadata.energyIq.getProject("preschool-demo");
      const templateRevision = metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
        project_id: project.id,
        tier_definition_ids: metadata.energyIq.listTierDefinitions(project.id).map((tier) => tier.id),
        hierarchy_revision_id: project.hierarchy_revision_id,
        published_by: "dev-user",
        published_at: "2026-08-04T00:00:00.000Z",
      });
      const query = {
        projectId: project.id,
        scopeId: "project",
        resource: "electricity",
        period: "Custom",
        from: "2026-05-01",
        to: "2026-05-31",
      } as const;
      const previous = metadata.energyIq.savedAnalyses.create({
        id: "saved-analysis-low-coverage-seed",
        series_id: "saved-analysis-low-coverage-series",
        project_id: project.id,
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        scope_id: "preschool-project",
        scope_name: "Preschool Portfolio",
        resource: "electricity",
        title: "Seed only",
        query_json: JSON.stringify(query),
        analysis_json: JSON.stringify({ dataHealth: { coveragePct: 3.2258 } }),
        template_revision_id: templateRevision.revision_id,
        data_snapshot_id: project.data_snapshot_id,
        created_by: "dev-user",
      });
      const context = {
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        workspaceId: PRESCHOOL_WORKSPACE_ID,
      } as Required<ConfigApiContext>;

      const creation = await handleEnergyApiRequest(
        jsonPost(query),
        ["projects", project.id, "saved-analyses"],
        context,
      );
      const rerun = await handleEnergyApiRequest(
        jsonPost({}),
        ["projects", project.id, "saved-analyses", previous.id, "rerun"],
        context,
      );

      for (const response of [creation, rerun]) {
        expect(response).toMatchObject({
          status: 400,
          body: {
            success: false,
            error: {
              code: "BAD_REQUEST",
              message: "ENERGYIQ_DECISION_COVERAGE_REQUIRED",
            },
          },
        });
      }
      expect(metadata.energyIq.savedAnalyses.listProject(project.id).map((item) => item.id))
        .toEqual([previous.id]);
    } finally {
      metadata.close();
      removeTemporaryFixture(root);
    }
  }, 30_000);

  it("creates and reruns Saved Analysis through the published Project Release", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-saved-analysis-release-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      await materializePreschoolGoldenFixture(databasePath);
      vi.stubEnv("ENERGYIQ_DUCKDB_PATH", databasePath);
      ensureEnergyIqBootstrap(metadata);
      const project = metadata.energyIq.getProject("preschool-demo");
      const templateRevision = metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
        project_id: project.id,
        tier_definition_ids: metadata.energyIq.listTierDefinitions(project.id).map((tier) => tier.id),
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
      const query = {
        projectId: project.id,
        scopeId: "project",
        resource: "electricity",
        period: "Custom",
        from: "2026-05-01",
        to: "2026-05-01",
      } as const;
      const context = {
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        workspaceId: PRESCHOOL_WORKSPACE_ID,
      } as Required<ConfigApiContext>;

      const creation = await handleEnergyApiRequest(
        jsonPost(query),
        ["projects", project.id, "saved-analyses"],
        context,
      );
      expect(creation.status, JSON.stringify(creation.body)).toBe(201);
      const first = metadata.energyIq.savedAnalyses.listProject(project.id)[0];
      expect(first?.template_revision_id).toBe(templateRevision.revision_id);
      const frozenAnalysisJson = first?.analysis_json;
      const firstAnalysis = JSON.parse(first?.analysis_json ?? "null") as {
        context: Record<string, unknown>;
        provenance: Record<string, unknown>;
        cost: Record<string, unknown>;
        offHours: Record<string, unknown>;
      };
      expect(firstAnalysis.context).toMatchObject({
        hierarchyRevisionId: templateRevision.hierarchy_revision_id,
        meterFormulaRevisionId: templateRevision.meter_formula_revision_id,
        businessCalendarVersion: templateRevision.business_calendar_version,
        tariffScheduleVersion: templateRevision.tariff_schedule_version,
      });
      expect(firstAnalysis.provenance).toMatchObject({
        hierarchyRevisionId: templateRevision.hierarchy_revision_id,
        meterFormulaRevisionId: templateRevision.meter_formula_revision_id,
      });
      expect(firstAnalysis.cost).toMatchObject({
        tariffScheduleVersion: templateRevision.tariff_schedule_version,
      });
      expect(firstAnalysis.offHours).toMatchObject({
        businessCalendarVersion: templateRevision.business_calendar_version,
      });

      metadata.energyIq.operationalPolicy.publishTariffSchedule({
        version_id: "preschool-tariff-v2",
        project_id: project.id,
        published_by: "dev-user",
        activate: true,
        entries: [{
          id: "preschool-tariff-v2-flat",
          owner: { kind: "project" },
          effective_from: "2026-04-30T16:00:00.000Z",
          effective_to: "2026-05-01T16:00:00.000Z",
          currency: "SGD",
          rate_per_kwh: 0.5,
        }],
      });
      metadata.energyIq.operationalPolicy.publishOperatingCalendar({
        version_id: "preschool-calendar-v2",
        project_id: project.id,
        published_by: "dev-user",
        activate: true,
        entries: [{
          id: "preschool-calendar-v2-full-day",
          owner: { kind: "project" },
          effective_from: "2026-05-01",
          effective_to: "2026-05-02",
          weekly: allDays("00:00", "24:00"),
        }],
      });
      const draft = metadata.energyIq.projectSetup.getDraft({
        project_id: project.id,
        user_id: "dev-user",
      });
      const publishedV2 = metadata.energyIq.projectSetup.publishDraft({
        project_id: project.id,
        expected_revision: draft.revision,
        user_id: "dev-user",
      });

      const rerun = await handleEnergyApiRequest(
        jsonPost({}),
        ["projects", project.id, "saved-analyses", first?.id ?? "", "rerun"],
        context,
      );
      expect(rerun.status).toBe(201);
      const records = metadata.energyIq.savedAnalyses.listProject(project.id);
      expect(records).toHaveLength(2);
      expect(records[0]).toMatchObject({
        series_id: first?.series_id,
        sequence: 2,
        rerun_of_id: first?.id,
        template_revision_id: publishedV2.template_revision_id,
      });
      expect(records.find((record) => record.id === first?.id)?.analysis_json).toBe(frozenAnalysisJson);
      const latestAnalysis = JSON.parse(records[0]?.analysis_json ?? "null") as {
        context: Record<string, unknown>;
        cost: Record<string, unknown>;
        offHours: Record<string, unknown>;
      };
      expect(latestAnalysis.context).toMatchObject({
        tariffScheduleVersion: "preschool-tariff-v2",
        businessCalendarVersion: "preschool-calendar-v2",
      });
      expect(latestAnalysis.cost).toMatchObject({
        status: "available",
        tariffScheduleVersion: "preschool-tariff-v2",
      });
      expect(latestAnalysis.offHours).toMatchObject({
        status: "available",
        operatingKwh: expect.any(Number),
        standbyKwh: 0,
        businessCalendarVersion: "preschool-calendar-v2",
      });
      expect(latestAnalysis.cost).not.toEqual(firstAnalysis.cost);
      expect(latestAnalysis.offHours).not.toEqual(firstAnalysis.offHours);
    } finally {
      metadata.close();
      removeTemporaryFixture(root);
    }
  }, 30_000);

  it("returns frozen metadata evidence without replacing it from the current Project release", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-saved-metadata-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      const project = metadata.energyIq.getProject("preschool-demo");
      const templateRevision = metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
        project_id: project.id,
        tier_definition_ids: metadata.energyIq.listTierDefinitions(project.id).map((tier) => tier.id),
        hierarchy_revision_id: project.hierarchy_revision_id,
        published_by: "dev-user",
        published_at: "2026-08-04T00:00:00.000Z",
      });
      const query = {
        projectId: project.id,
        scopeId: "preschool-centre-a",
        resource: "electricity",
        period: "Custom",
        from: "2026-05-01",
        to: "2026-05-31",
      } as const;
      const frozenAnalysis = {
        context: {
          projectId: project.id,
          scopeId: "preschool-centre-a",
          scopeName: "Centre A",
          timezone: "Asia/Singapore",
          from: "2026-04-30T16:00:00.000Z",
          to: "2026-05-31T16:00:00.000Z",
        },
        metadata: {
          status: "provisional",
          hierarchyRevisionId: project.hierarchy_revision_id,
          selectedScope: {
            scopeId: "preschool-centre-a",
            status: "provisional",
            area: { status: "provisional", value: 743 },
            evidence: [{
              scopeId: "preschool-centre-a",
              dimension: "area",
              value: 743,
              status: "provisional",
              hierarchyRevisionId: project.hierarchy_revision_id,
              metadataRevisionId: `${project.hierarchy_revision_id}:preschool-centre-a`,
            }],
          },
        },
      };
      const record = metadata.energyIq.savedAnalyses.create({
        id: "saved-analysis-frozen-metadata",
        series_id: "saved-analysis-frozen-metadata-series",
        project_id: project.id,
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        scope_id: "preschool-centre-a",
        scope_name: "Centre A",
        resource: "electricity",
        title: "Frozen Centre A metadata",
        query_json: JSON.stringify(query),
        analysis_json: JSON.stringify(frozenAnalysis),
        template_revision_id: templateRevision.revision_id,
        data_snapshot_id: project.data_snapshot_id,
        created_by: "dev-user",
      });

      const draft = metadata.energyIq.projectSetup.getDraft({
        project_id: project.id,
        user_id: "dev-user",
      });
      const savedDraft = metadata.energyIq.projectSetup.saveDraft({
        project_id: project.id,
        expected_revision: draft.revision,
        user_id: "dev-user",
        document: {
          ...draft.document,
          nodes: draft.document.nodes.map((node) => node.id === "preschool-centre-a"
            ? { ...node, area_sqm: 999, metadata_status: "confirmed" }
            : node),
        },
      });
      const currentRelease = metadata.energyIq.projectSetup.publishDraft({
        project_id: project.id,
        expected_revision: savedDraft.revision,
        user_id: "dev-user",
      });
      expect(metadata.energyIq.scopeMetadata.resolveForPeriod({
        projectId: project.id,
        scopeId: "preschool-centre-a",
        hierarchyRevisionId: currentRelease.hierarchy_revision_id,
        period: {
          start: "2026-04-30T16:00:00.000Z",
          endExclusive: "2026-05-31T16:00:00.000Z",
        },
      }).area).toMatchObject({
        status: "missing",
        reason: "ambiguous-effective-revisions",
        value: null,
        evidence: [{ value: 743 }, { value: 999 }],
      });

      const response = await handleEnergyApiRequest(
        getRequest(),
        ["projects", project.id, "saved-analyses", record.id],
        {
          metadataStore: metadata,
          dataGateway: gateway,
          userId: "dev-user",
          workspaceId: PRESCHOOL_WORKSPACE_ID,
        } as Required<ConfigApiContext>,
      );

      expect(response).toMatchObject({
        status: 200,
        body: {
          success: true,
          data: {
            analysis: {
              metadata: {
                status: "provisional",
                hierarchyRevisionId: project.hierarchy_revision_id,
                selectedScope: {
                  area: { status: "provisional", value: 743 },
                  evidence: [{
                    dimension: "area",
                    value: 743,
                    metadataRevisionId: `${project.hierarchy_revision_id}:preschool-centre-a`,
                  }],
                },
              },
            },
          },
        },
      });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

const allDays = (from: string, to: string) => ({
  monday: [{ from, to }],
  tuesday: [{ from, to }],
  wednesday: [{ from, to }],
  thursday: [{ from, to }],
  friday: [{ from, to }],
  saturday: [{ from, to }],
  sunday: [{ from, to }],
});

const jsonPost = (body: unknown): IncomingMessage => {
  const request = new PassThrough();
  Object.assign(request, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  request.end(JSON.stringify(body));
  return request as unknown as IncomingMessage;
};

const getRequest = (): IncomingMessage => {
  const request = new PassThrough();
  Object.assign(request, { method: "GET", headers: {} });
  request.end();
  return request as unknown as IncomingMessage;
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
