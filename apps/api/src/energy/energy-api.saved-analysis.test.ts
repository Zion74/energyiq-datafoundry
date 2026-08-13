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
import { resolveEnergyPublishedMeterRoute } from "./energy-query-context.js";
import { materializePreschoolGoldenFixture } from "./preschool-golden.fixture.js";

describe("saved analysis decision-quality boundary", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("rejects low-coverage creation and rerun before either result is persisted", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-saved-analysis-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      vi.stubEnv("ENERGYIQ_DUCKDB_PATH", databasePath);
      ensureEnergyIqBootstrap(metadata);
      await materializePreschoolGoldenFixture(databasePath, metadata);
      const project = metadata.energyIq.getProject("preschool-demo");
      const templateRevision = metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
        project_id: project.id,
        tier_definition_ids: metadata.energyIq.listTierDefinitions(project.id).map((tier) => tier.id),
        hierarchy_revision_id: project.hierarchy_revision_id,
        meter_mapping_revision_id: resolveEnergyPublishedMeterRoute({ metadataStore: metadata, projectId: project.id, hierarchyRevisionId: project.hierarchy_revision_id, scopeId: project.root_scope_id, resource: "electricity" }).meterMappingRevisionId,
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
      vi.stubEnv("ENERGYIQ_DUCKDB_PATH", databasePath);
      ensureEnergyIqBootstrap(metadata);
      await materializePreschoolGoldenFixture(databasePath, metadata);
      const project = metadata.energyIq.getProject("preschool-demo");
      const templateRevision = metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
        project_id: project.id,
        tier_definition_ids: metadata.energyIq.listTierDefinitions(project.id).map((tier) => tier.id),
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
      const query = {
        projectId: project.id,
        scopeId: "project",
        resource: "electricity",
        period: "Custom",
        from: "2026-05-01",
        to: "2026-05-01",
        viewState: {
          grain: "day",
          comparison: "selected",
          category: "load",
        },
        aiArtifact: {
          contract: "energyiq-saved-ai-result@1",
          rendererKey: "preschool-overview",
          snapshotId: project.data_snapshot_id,
          projectReleaseId: templateRevision.revision_id,
          result: {
            status: "available",
            providerProfileId: "profile-test",
            runId: "saved-analysis-ai-editor-run-v1",
            packId: "preschool-analysis-pack",
            packRevision: "v1",
            contract: { id: "preschool-ai-accepted-artifact", revision: "v13" },
            binding: {
              projectId: project.id,
              scopeId: project.root_scope_id,
              dataSnapshotId: project.data_snapshot_id,
              projectReleaseId: templateRevision.revision_id,
              dataCutoff: "2026-05-01T16:00:00.000Z",
              analysisPeriod: { from: "2026-04-30T16:00:00.000Z", to: "2026-05-01T16:00:00.000Z" },
              outputContractRevision: "v13",
            },
            workflow: {
              id: "preschool-two-stage",
              revision: "preschool-two-stage-v2",
              methodSkill: { id: "energy-insight-investigation", revision: "1.0.0" },
              stages: {
                investigator: { runId: "saved-analysis-ai-investigator-run-v1", promptRevision: "preschool-investigator-v11" },
                editor: { runId: "saved-analysis-ai-editor-run-v1", promptRevision: "preschool-insight-editor-v5" },
              },
            },
            findings: [{
              id: "finding-v1",
              binding: {
                projectId: project.id,
                scopeId: project.root_scope_id,
                dataSnapshotId: project.data_snapshot_id,
                projectReleaseId: templateRevision.revision_id,
                dataCutoff: "2026-05-01T16:00:00.000Z",
                analysisPeriod: { from: "2026-04-30T16:00:00.000Z", to: "2026-05-01T16:00:00.000Z" },
                outputContractRevision: "v13",
              },
              placementTargets: ["preschool.benchmark"],
              epistemicLevel: "verified",
              relationship: "supports",
              signalRefs: ["efficiency"],
              title: "Benchmark priority needs investigation",
              takeaway: "The current Snapshot supports a focused operating review.",
              action: "Review the priority Centre with its local operator.",
              expectedIfAct: "The next review will isolate the operating driver.",
              ifIgnored: "The priority condition may continue without an owner.",
              uncertainty: "The pinned evidence does not establish a cause.",
              evidence: {
                snapshotId: project.data_snapshot_id,
                period: { from: "2026-04-30T16:00:00.000Z", to: "2026-05-01T16:00:00.000Z" },
                deterministic: [{
                  id: "benchmark:priority-centre:G",
                  kind: "benchmark",
                  label: "Priority Centre benchmark",
                  unit: "kWh",
                  values: { usageKwh: 843.0985 },
                  queryIds: ["benchmark-query"],
                  limitation: null,
                }],
                tools: [],
              },
              presentation: {
                version: "1",
                blocks: [
                  {
                    type: "metric",
                    label: "Priority score",
                    value: 843.1,
                    unit: "kWh",
                    evidenceRefs: ["benchmark:priority-centre:G"],
                  },
                  {
                    type: "metric",
                    label: "Unbound score",
                    value: 999,
                    unit: "kWh",
                    evidenceRefs: ["benchmark:not-cited"],
                  },
                  { type: "html", value: "<script>unsafe()</script>" },
                ],
              },
            }],
          },
        },
      } as const;
      metadata.sessions.create({ user_id: "dev-user", id: "saved-analysis-ai-session-v1", title: "Saved AI v1" });
      for (const runId of [
        query.aiArtifact.result.workflow.stages.investigator.runId,
        query.aiArtifact.result.workflow.stages.editor.runId,
      ]) {
        metadata.runs.create({
          id: runId,
          user_id: "dev-user",
          session_id: "saved-analysis-ai-session-v1",
          status: "running",
          user_input: `Snapshot ${project.data_snapshot_id}; Release ${templateRevision.revision_id}`,
          model_provider: "openai-compatible",
          model_name: "test-model-v1",
          request_fingerprint: "request-fingerprint-v1",
        });
        metadata.runs.updateStatus({
          user_id: "dev-user",
          run_id: runId,
          status: "completed",
        });
      }
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
      expect(creation.body).toMatchObject({
        success: true,
        data: {
          viewState: query.viewState,
          aiArtifact: {
            rendererKey: "preschool-overview",
            snapshotId: project.data_snapshot_id,
            projectReleaseId: templateRevision.revision_id,
            result: {
              runId: query.aiArtifact.result.runId,
              findings: [{
                presentation: {
                  version: "1",
                  blocks: [{
                    type: "metric",
                    label: "Priority score",
                    evidenceRefs: ["benchmark:priority-centre:G"],
                  }],
                },
              }],
            },
            runProvenance: {
              modelProvider: "openai-compatible",
              modelName: "test-model-v1",
              requestFingerprint: "request-fingerprint-v1",
              contextSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
            },
          },
          snapshot: {
            renderer: { key: "preschool-overview" },
            dataSnapshot: { id: project.data_snapshot_id },
          },
        },
      });
      const first = metadata.energyIq.savedAnalyses.listProject(project.id)[0];
      expect(first?.template_revision_id).toBe(templateRevision.revision_id);
      const frozenAnalysisJson = first?.analysis_json;
      const frozenSnapshotJson = first?.snapshot_json;
      const frozenAiResultJson = first?.ai_result_json;
      expect(frozenAiResultJson).toContain(query.aiArtifact.result.runId);
      expect(frozenAiResultJson).not.toContain("benchmark:not-cited");
      expect(frozenAiResultJson).not.toContain("<script>");
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
      const publishedV2Hierarchy = metadata.energyIq.projectSetup.listHierarchyRevisions(project.id)
        .find((revision) => revision.id === publishedV2.hierarchy_revision_id);
      const publishedV2Document = JSON.parse(publishedV2Hierarchy?.snapshot_json ?? "null") as {
        meter_mapping?: { schema_version?: number; confirmed?: boolean; official_aggregation_routes?: unknown[] };
      };
      expect(publishedV2Document.meter_mapping).toMatchObject({
        schema_version: 2,
        confirmed: true,
      });
      expect(publishedV2Document.meter_mapping?.official_aggregation_routes?.length).toBeGreaterThan(0);

      const rerun = await handleEnergyApiRequest(
        jsonPost({}),
        ["projects", project.id, "saved-analyses", first?.id ?? "", "rerun"],
        context,
      );
      expect(rerun.status, JSON.stringify(rerun.body)).toBe(201);
      expect(rerun.body).toMatchObject({
        success: true,
        data: {
          rerunOfId: first?.id,
          viewState: query.viewState,
          snapshot: { renderer: { key: "preschool-overview" } },
        },
      });
      const records = metadata.energyIq.savedAnalyses.listProject(project.id);
      expect(records).toHaveLength(2);
      expect(records[0]).toMatchObject({
        series_id: first?.series_id,
        sequence: 2,
        rerun_of_id: first?.id,
        template_revision_id: publishedV2.template_revision_id,
      });
      expect(records.find((record) => record.id === first?.id)?.analysis_json).toBe(frozenAnalysisJson);
      expect(records.find((record) => record.id === first?.id)?.snapshot_json).toBe(frozenSnapshotJson);
      expect(records.find((record) => record.id === first?.id)?.ai_result_json).toBe(frozenAiResultJson);
      expect(records[0]?.ai_result_json).toBeUndefined();

      metadata.sessions.create({ user_id: "dev-user", id: "saved-analysis-ai-session-v2", title: "Saved AI v2" });
      for (const runId of ["saved-analysis-ai-investigator-run-v2", "saved-analysis-ai-editor-run-v2"]) {
        metadata.runs.create({
          id: runId,
          user_id: "dev-user",
          session_id: "saved-analysis-ai-session-v2",
          status: "running",
          user_input: `Snapshot ${project.data_snapshot_id}; Release ${publishedV2.template_revision_id}`,
          model_provider: "openai-compatible",
          model_name: "test-model-v2",
          request_fingerprint: "request-fingerprint-v2",
        });
        metadata.runs.updateStatus({
          user_id: "dev-user",
          run_id: runId,
          status: "completed",
        });
      }
      const bindingV2 = {
        projectId: project.id,
        scopeId: project.root_scope_id,
        dataSnapshotId: project.data_snapshot_id,
        projectReleaseId: publishedV2.template_revision_id,
        dataCutoff: "2026-05-01T16:00:00.000Z",
        analysisPeriod: { from: "2026-04-30T16:00:00.000Z", to: "2026-05-01T16:00:00.000Z" },
        outputContractRevision: "v13",
      } as const;
      const aiArtifactV2 = {
        contract: "energyiq-saved-ai-result@1",
        rendererKey: "preschool-overview",
        snapshotId: project.data_snapshot_id,
        projectReleaseId: publishedV2.template_revision_id,
        result: {
          status: "available",
          providerProfileId: "profile-test",
          runId: "saved-analysis-ai-editor-run-v2",
          packId: "preschool-analysis-pack",
          packRevision: "v1",
          contract: { id: "preschool-ai-accepted-artifact", revision: "v13" },
          binding: bindingV2,
          workflow: {
            id: "preschool-two-stage",
            revision: "preschool-two-stage-v2",
            methodSkill: { id: "energy-insight-investigation", revision: "1.0.0" },
            stages: {
              investigator: { runId: "saved-analysis-ai-investigator-run-v2", promptRevision: "preschool-investigator-v11" },
              editor: { runId: "saved-analysis-ai-editor-run-v2", promptRevision: "preschool-insight-editor-v5" },
            },
          },
          findings: [{
            id: "finding-v2",
            binding: bindingV2,
            placementTargets: ["preschool.benchmark"],
            epistemicLevel: "hypothesis",
            relationship: "independent",
            signalRefs: [],
            title: "Benchmark gap needs an operating explanation",
            takeaway: "The current facts do not establish the driver.",
            action: "Review schedules and major circuit loads.",
            expectedIfAct: "The review should isolate the operating condition.",
            ifIgnored: "The unexplained benchmark gap may persist.",
            verification: "Compare schedules and major circuit loads.",
            uncertainty: "The pinned evidence does not establish a cause.",
            evidence: {
              snapshotId: project.data_snapshot_id,
              period: bindingV2.analysisPeriod,
              deterministic: [],
              tools: [],
            },
          }],
        },
      } as const;
      const mismatchedAttachment = await handleEnergyApiRequest(
        jsonPost({ aiArtifact: { ...aiArtifactV2, snapshotId: "different-snapshot" } }),
        ["projects", project.id, "saved-analyses", records[0]?.id ?? "", "ai-result"],
        context,
      );
      expect(mismatchedAttachment).toMatchObject({
        status: 400,
        body: { success: false, error: { message: "ENERGYIQ_SAVED_ANALYSIS_AI_RESULT_INVALID" } },
      });
      expect(metadata.energyIq.savedAnalyses.get(records[0]?.id ?? "").ai_result_json).toBeUndefined();
      const attached = await handleEnergyApiRequest(
        jsonPost({ aiArtifact: aiArtifactV2 }),
        ["projects", project.id, "saved-analyses", records[0]?.id ?? "", "ai-result"],
        context,
      );
      expect(attached).toMatchObject({
        status: 200,
        body: {
          success: true,
          data: {
            id: records[0]?.id,
            aiArtifact: {
              projectReleaseId: publishedV2.template_revision_id,
              result: { runId: "saved-analysis-ai-editor-run-v2" },
              runProvenance: {
                modelProvider: "openai-compatible",
                modelName: "test-model-v2",
                requestFingerprint: "request-fingerprint-v2",
                contextSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
              },
            },
          },
        },
      });
      expect(metadata.energyIq.savedAnalyses.get(first?.id ?? "").ai_result_json).toBe(frozenAiResultJson);
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

      metadata.energyIq.upsertProject({
        ...metadata.energyIq.getProject(project.id),
        data_snapshot_id: "missing-current-snapshot",
      });
      const unavailableRerun = await handleEnergyApiRequest(
        jsonPost({}),
        ["projects", project.id, "saved-analyses", first?.id ?? "", "rerun"],
        context,
      );
      expect(unavailableRerun).toMatchObject({
        status: 409,
        body: {
          success: false,
          error: { code: "CONFLICT", message: "ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE" },
        },
      });
      expect(metadata.energyIq.savedAnalyses.listProject(project.id)).toHaveLength(2);
      expect(metadata.energyIq.savedAnalyses.get(first?.id ?? "").analysis_json).toBe(frozenAnalysisJson);
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
        meter_mapping_revision_id: resolveEnergyPublishedMeterRoute({ metadataStore: metadata, projectId: project.id, hierarchyRevisionId: project.hierarchy_revision_id, scopeId: project.root_scope_id, resource: "electricity" }).meterMappingRevisionId,
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
