import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import type { ConfigApiContext } from "../routes/types.js";
import { ensureEnergyIqBootstrap, NGEE_ANN_WORKSPACE_ID } from "./energy-bootstrap.js";
import { handleEnergyApiRequest } from "./energy-api.js";
import { resolveEnergyPublishedMeterRoute } from "./energy-query-context.js";
import { createOverviewAiArtifactIdentity } from "./overview-ai-artifact.js";
import {
  projectOverviewAiGenerationBinding,
  type ProjectOverviewAiAdapter,
  type ProjectOverviewAiReadModel,
} from "./project-overview-ai-adapter.js";
import type { ProjectAnalysisSnapshot } from "./project-analysis-resolver.js";

describe("Ngee Ann Saved Project AI", () => {
  it("attaches only the exact canonical terminal read model and restores it without Provider work", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-saved-project-ai-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const project = metadata.energyIq.getProject("ngee-ann-polytechnic");
      const templateRevision = metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
        project_id: project.id,
        tier_definition_ids: metadata.energyIq.listTierDefinitions(project.id).map((tier) => tier.id),
        hierarchy_revision_id: project.hierarchy_revision_id,
        meter_mapping_revision_id: resolveEnergyPublishedMeterRoute({
          metadataStore: metadata,
          projectId: project.id,
          hierarchyRevisionId: project.hierarchy_revision_id,
          scopeId: project.root_scope_id,
          resource: "electricity",
        }).meterMappingRevisionId,
        published_by: "dev-user",
        published_at: "2026-08-17T00:00:00.000Z",
      });
      const period = {
        from: "2026-05-19T16:00:00.000Z",
        to: "2026-06-16T16:00:00.000Z",
      };
      const snapshot = {
        context: {
          workspaceId: NGEE_ANN_WORKSPACE_ID,
          projectId: project.id,
          scopeId: project.root_scope_id,
          scopeName: "Ngee Ann Polytechnic",
          resource: "electricity",
          dataSnapshotId: project.data_snapshot_id,
          projectReleaseId: templateRevision.revision_id,
          primaryPeriod: { start: period.from, endExclusive: period.to },
        },
        projectRelease: {
          id: templateRevision.revision_id,
          templateRevisionId: templateRevision.revision_id,
        },
        renderer: { key: "ngee-ann-overview", version: "1", contractVersion: "project-analysis-snapshot@1" },
        dataSnapshot: { id: project.data_snapshot_id, importBatchIds: [], lastSeenAt: period.to },
        analysis: { provenance: { dataSnapshotId: project.data_snapshot_id } },
      } as unknown as ProjectAnalysisSnapshot;
      const baseIdentity = createOverviewAiArtifactIdentity({
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        projectId: project.id,
        scopeId: project.root_scope_id,
        dataSnapshotId: project.data_snapshot_id,
        projectReleaseId: templateRevision.revision_id,
        analysisPeriodFrom: period.from,
        analysisPeriodTo: period.to,
        rendererKey: "ngee-ann-overview",
        rendererVersion: "1",
        modelProfileId: "workspace-default-model-profile",
        modelProfileRevision: 8,
      });
      const runId = "saved-ngee-project-ai-run";
      const model: ProjectOverviewAiReadModel = {
        contract: "energyiq-project-overview-ai-read-model@1",
        rendererKey: "ngee-ann-overview",
        binding: {
          workspaceId: baseIdentity.workspaceId,
          projectId: baseIdentity.projectId,
          scopeId: baseIdentity.scopeId,
          dataSnapshotId: baseIdentity.dataSnapshotId,
          projectReleaseId: baseIdentity.projectReleaseId,
          analysisPeriod: { from: baseIdentity.analysisPeriodFrom, to: baseIdentity.analysisPeriodTo },
          modelProfileId: baseIdentity.modelProfileId,
          modelProfileRevision: baseIdentity.modelProfileRevision,
          generation: projectOverviewAiGenerationBinding(baseIdentity),
        },
        keyFindings: availableUnit("executive", runId),
        sections: Object.fromEntries([
          "trend-and-demand",
          "time-behaviour",
          "circuit-concentration",
          "decision-priorities",
        ].map((sectionId) => [sectionId, sectionId === "time-behaviour"
          ? emptyUnit(sectionId, runId)
          : availableUnit(sectionId, runId)])),
        additionalInsights: availableUnit("additional", runId),
      };
      const readExact = vi.fn().mockResolvedValue(model);
      const adapter: ProjectOverviewAiAdapter = {
        rendererKey: "ngee-ann-overview",
        sections: [],
        resolveIdentity: vi.fn(),
        readExact,
        generateMissing: vi.fn(),
      };
      metadata.sessions.create({
        user_id: "dev-user",
        id: "saved-ngee-project-ai-session",
        title: "Saved Ngee AI",
        workspace_id: NGEE_ANN_WORKSPACE_ID,
        project_id: project.id,
      });
      metadata.runs.create({
        id: runId,
        user_id: "dev-user",
        session_id: "saved-ngee-project-ai-session",
        status: "running",
        user_input: `Snapshot ${project.data_snapshot_id}; Release ${templateRevision.revision_id}`,
        model_provider: "openai-compatible",
        model_name: "saved-ngee-test-model",
      });
      metadata.runs.updateStatus({ user_id: "dev-user", run_id: runId, status: "completed" });
      const saved = metadata.energyIq.savedAnalyses.create({
        id: "saved-analysis-ngee-project-ai",
        series_id: "saved-analysis-ngee-project-ai-series",
        project_id: project.id,
        workspace_id: NGEE_ANN_WORKSPACE_ID,
        scope_id: project.root_scope_id,
        scope_name: "Ngee Ann Polytechnic",
        resource: "electricity",
        title: "Ngee AI A",
        query_json: JSON.stringify({ projectId: project.id, scopeId: "project", resource: "electricity" }),
        analysis_json: JSON.stringify(snapshot.analysis),
        snapshot_json: JSON.stringify(snapshot),
        template_revision_id: templateRevision.revision_id,
        data_snapshot_id: project.data_snapshot_id,
        created_by: "dev-user",
      });
      const context = {
        metadataStore: metadata,
        dataGateway: {},
        userId: "dev-user",
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        projectOverviewAiAdapters: [adapter],
      } as unknown as Required<ConfigApiContext>;
      const artifact = {
        contract: "energyiq-saved-ai-result@3",
        rendererKey: "ngee-ann-overview",
        snapshotId: project.data_snapshot_id,
        projectReleaseId: templateRevision.revision_id,
        result: model,
      } as const;

      const attached = await handleEnergyApiRequest(
        jsonPost({ aiArtifact: artifact }),
        ["projects", project.id, "saved-analyses", saved.id, "ai-result"],
        context,
      );

      expect(attached).toMatchObject({ status: 200, body: { success: true } });
      expect(readExact).toHaveBeenCalledOnce();
      expect(adapter.generateMissing).not.toHaveBeenCalled();

      const emptyModel: ProjectOverviewAiReadModel = {
        ...model,
        keyFindings: emptyUnit("executive-empty", runId),
        sections: Object.fromEntries(Object.keys(model.sections).map((sectionId) => [
          sectionId,
          emptyUnit(`${sectionId}-empty`, runId),
        ])),
        additionalInsights: emptyUnit("additional-empty", runId),
      };
      const emptySaved = metadata.energyIq.savedAnalyses.create({
        ...saved,
        id: "saved-analysis-ngee-project-ai-empty",
        series_id: "saved-analysis-ngee-project-ai-empty-series",
        title: "Ngee AI empty",
      });
      readExact.mockResolvedValueOnce(emptyModel);
      expect(await handleEnergyApiRequest(
        jsonPost({ aiArtifact: { ...artifact, result: emptyModel } }),
        ["projects", project.id, "saved-analyses", emptySaved.id, "ai-result"],
        context,
      )).toMatchObject({ status: 200, body: { success: true } });

      const tampered = structuredClone(model);
      (tampered.keyFindings as Extract<typeof tampered.keyFindings, { status: "available" }>).result = {
        status: "available",
        runId,
        findings: [{ title: "Browser-authored replacement" }],
      };
      expect(await handleEnergyApiRequest(
        jsonPost({ aiArtifact: { ...artifact, result: tampered } }),
        ["projects", project.id, "saved-analyses", saved.id, "ai-result"],
        context,
      )).toMatchObject({
        status: 400,
        body: { success: false, error: { message: "ENERGYIQ_SAVED_ANALYSIS_AI_RESULT_INVALID" } },
      });

      readExact.mockClear();
      metadata.energyIq.upsertProject({
        ...metadata.energyIq.getProject(project.id),
        data_snapshot_id: "snapshot-ngee-b",
      });
      const restored = await handleEnergyApiRequest(
        getRequest(),
        ["projects", project.id, "saved-analyses", saved.id],
        context,
      );
      expect(restored).toMatchObject({
        status: 200,
        body: {
          success: true,
          data: {
            dataSnapshotId: project.data_snapshot_id,
            aiArtifact: {
              contract: "energyiq-saved-ai-result@3",
              snapshotId: project.data_snapshot_id,
              result: model,
            },
          },
        },
      });
      expect(readExact).not.toHaveBeenCalled();
      expect(adapter.generateMissing).not.toHaveBeenCalled();
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

const availableUnit = (id: string, runId: string) => ({
  status: "available" as const,
  artifactId: `artifact:${id}`,
  result: { status: "available", runId, findings: [] },
});

const emptyUnit = (id: string, runId: string) => ({
  status: "empty" as const,
  artifactId: `artifact:${id}`,
  runId,
});

const jsonPost = (body: unknown): IncomingMessage => {
  const request = new PassThrough();
  Object.assign(request, { method: "POST", headers: { "content-type": "application/json" } });
  request.end(JSON.stringify(body));
  return request as unknown as IncomingMessage;
};

const getRequest = (): IncomingMessage => {
  const request = new PassThrough();
  Object.assign(request, { method: "GET", headers: {} });
  request.end();
  return request as unknown as IncomingMessage;
};
