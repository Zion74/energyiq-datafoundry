import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";

import {
  LocalDataGateway,
  readEnergyFactProjectAudit,
} from "@datafoundry/data-gateway";
import { LocalFileAssetService } from "@datafoundry/files";
import {
  createEnergyIqSourceManifest,
  createMetadataStore,
  resolveEnergyIqSnapshotFactScope,
} from "@datafoundry/metadata";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConfigApiContext } from "../routes/types.js";
import {
  ensureEnergyIqBootstrap,
  NGEE_ANN_WORKSPACE_ID,
} from "./energy-bootstrap.js";
import { handleEnergyApiRequest } from "./energy-api.js";
import { inspectEnergyExcelWorkbook } from "./energy-excel-import.js";
import { materializeEnergyProjectManifest } from "./energy-project-materialization.js";
import { resolveEnergyPublishedMeterRoute } from "./energy-query-context.js";
import { resolveProjectAnalysis } from "./project-analysis-resolver.js";

const PROJECT_ID = "ngee-ann-polytechnic";
const SOURCE_ROOT = join(process.cwd(), "docs", "template", "Net-Zero Product");

const SOURCES = {
  earlierLevel6: {
    batchId: "ngee-ann-a-level-6",
    filename: "Ngee Ann Poly Level 6 (21 April - 20 May).xlsx",
    sha256: "e4d788af0135281c8ba519f04fa3c44751206ce0812e15e434da6cb8fda44f70",
  },
  earlierLevel7: {
    batchId: "ngee-ann-a-level-7",
    filename: "Ngee Ann Poly Level 7 (21 April - 20 May).xlsx",
    sha256: "0b1fb9613c596d3569f6be93046a43737366649b5f8a4d45fc8cdef073c30e5d",
  },
  laterLevel6: {
    batchId: "ngee-ann-b-level-6",
    filename: "Ngee Ann Poly Level 6 (19 May - 17 June).xlsx",
    sha256: "64502f6369dad96f3dc6cbc650b28b3f108bb655e7a95ca078b9aa616966413f",
  },
  laterLevel7: {
    batchId: "ngee-ann-b-level-7",
    filename: "Ngee Ann Poly Level 7 (19 May - 17 June).xlsx",
    sha256: "3f41f94e229933a97ce8d02a0382d3a8192e3c26065bf0f48a04168ec90dd674",
  },
} as const;

describe("Ngee Ann two-Snapshot customer-value acceptance", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps saved A reproducible while the same Release and Mapping advance current Overview to B", async () => {
    const mark = phaseTimer();
    const retainedRoot = process.env.ENERGYIQ_TWO_SNAPSHOT_ACCEPTANCE_ROOT?.trim();
    const root = retainedRoot
      ? createRetainedFixtureRoot(retainedRoot)
      : mkdtempSync(join(tmpdir(), "ngee-ann-two-snapshot-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const fileAssets = new LocalFileAssetService(metadata, { storageRoot: join(root, "files") });
    const gateway = new LocalDataGateway(metadata);
    try {
      vi.stubEnv("ENERGYIQ_DUCKDB_PATH", databasePath);
      ensureEnergyIqBootstrap(metadata);
      configureNgeeAnnOperationalPolicy(metadata);
      const user = metadata.users.getById({ user_id: "dev-user" });
      const project = metadata.energyIq.getProject(PROJECT_ID);
      const publishedTemplate = metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
        project_id: PROJECT_ID,
        tier_definition_ids: metadata.energyIq.listTierDefinitions(PROJECT_ID).map((tier) => tier.id),
        hierarchy_revision_id: project.hierarchy_revision_id,
        meter_mapping_revision_id: resolveEnergyPublishedMeterRoute({
          metadataStore: metadata,
          projectId: PROJECT_ID,
          hierarchyRevisionId: project.hierarchy_revision_id,
          scopeId: project.root_scope_id,
          resource: "electricity",
        }).meterMappingRevisionId,
        published_by: user.id,
        published_at: "2026-08-07T00:00:00.000Z",
      });
      const context = {
        metadataStore: metadata,
        fileAssetService: fileAssets,
        dataGateway: gateway,
        userId: user.id,
        workspaceId: NGEE_ANN_WORKSPACE_ID,
      } as unknown as Required<ConfigApiContext>;

      const earlierSources = await registerSources(
        metadata,
        fileAssets,
        [SOURCES.earlierLevel6, SOURCES.earlierLevel7],
      );
      mark("register A");
      updateSourceManifest(metadata, earlierSources.map((source) => source.sha256));
      const materializedA = await materializeEnergyProjectManifest({
        context,
        userId: user.id,
        projectId: PROJECT_ID,
        requestedBatchId: SOURCES.earlierLevel6.batchId,
        databasePath,
      });
      const snapshotAScope = resolveEnergyIqSnapshotFactScope(materializedA.snapshot);
      mark("materialize A");
      expect(snapshotAScope.sourceSha256).toEqual(sortedSha(earlierSources));
      const auditA = await readEnergyFactProjectAudit({ databasePath, projectId: PROJECT_ID });
      expect(auditA).toMatchObject({
        rawRowCount: 51_839,
        invalidRawRowCount: 0,
        unmappedRawRowCount: 0,
        rawOverlapConflictCount: 0,
        normalizedReadingCount: 51_839,
        intervalFactCount: 51_821,
        duplicateNormalizedReadingCount: 0,
        duplicateIntervalFactCount: 0,
        invalidIntervalDurationCount: 0,
        negativeDeltaIntervalCount: 0,
        canonicalMeterSeriesCount: 18,
        adjacentReadingPairCount: 51_821,
        missingAdjacentIntervalCount: 0,
        orphanIntervalFactCount: 0,
      });

      const analysisA = await resolveCurrentOverview({ metadata, gateway, user, databasePath });
      mark("resolve A");
      expect(analysisA.snapshot.context).toMatchObject({
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        projectId: PROJECT_ID,
        scopeId: "project",
        timezone: "Asia/Singapore",
        from: "2026-04-21T16:00:00.000Z",
        to: "2026-05-19T16:00:00.000Z",
        dataSnapshotId: materializedA.snapshot.id,
      });
      expect(analysisA.snapshot.analysis.summary.usageKwh).toBe(4_831.5555);
      expect(analysisA.snapshot.analysis.summary.validIntervalCount).toBeGreaterThan(0);
      expect(analysisA.snapshot.analysis.cost.status).toBe("available");
      expect(analysisA.snapshot.analysis.offHours.status).toBe("available");
      expectEvidencePins(analysisA.snapshot.evidence, materializedA.snapshot.id);
      const releaseIdentityA = releaseIdentity(analysisA.snapshot);

      const savedResponse = await handleEnergyApiRequest(
        jsonPost({
          projectId: PROJECT_ID,
          scopeId: "project",
          resource: "electricity",
          analysisWindow: "current-overview-28d",
          title: "Ngee Ann Snapshot A",
        }),
        ["projects", PROJECT_ID, "saved-analyses"],
        context,
      );
      expect(savedResponse.status, JSON.stringify(savedResponse.body)).toBe(201);
      mark("save A");
      const savedA = metadata.energyIq.savedAnalyses.listProject(PROJECT_ID)[0];
      if (!savedA) throw new Error("SAVED_ANALYSIS_A_MISSING");
      const frozenAnalysisJson = savedA.analysis_json;
      const frozenQueryJson = savedA.query_json;
      expect(savedA).toMatchObject({
        data_snapshot_id: materializedA.snapshot.id,
        template_revision_id: publishedTemplate.revision_id,
      });

      const laterSources = await registerSources(
        metadata,
        fileAssets,
        [SOURCES.laterLevel6, SOURCES.laterLevel7],
      );
      mark("register B");
      const allSources = [...earlierSources, ...laterSources];
      updateSourceManifest(metadata, allSources.map((source) => source.sha256));
      const materializedB = await materializeEnergyProjectManifest({
        context,
        userId: user.id,
        projectId: PROJECT_ID,
        requestedBatchId: SOURCES.laterLevel6.batchId,
        databasePath,
      });
      expect(materializedB.snapshot.id).not.toBe(materializedA.snapshot.id);
      mark("materialize B");
      const snapshotBScope = resolveEnergyIqSnapshotFactScope(materializedB.snapshot);
      expect(snapshotBScope.sourceSha256).toEqual(sortedSha(allSources));
      const auditB = await readEnergyFactProjectAudit({ databasePath, projectId: PROJECT_ID });
      expect(auditB).toMatchObject({
        rawRowCount: 103_678,
        invalidRawRowCount: 0,
        unmappedRawRowCount: 0,
        rawOverlapConflictCount: 32,
        normalizedReadingCount: 100_223,
        intervalFactCount: 100_205,
        duplicateNormalizedReadingCount: 0,
        duplicateIntervalFactCount: 0,
        invalidIntervalDurationCount: 0,
        negativeDeltaIntervalCount: 0,
        canonicalMeterSeriesCount: 18,
        adjacentReadingPairCount: 100_205,
        missingAdjacentIntervalCount: 0,
        orphanIntervalFactCount: 0,
      });
      expect(auditB.rawRowCount - auditB.normalizedReadingCount).toBe(3_455);

      const analysisB = await resolveCurrentOverview({ metadata, gateway, user, databasePath });
      mark("resolve B");
      expect(analysisB.snapshot.context).toMatchObject({
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        projectId: PROJECT_ID,
        scopeId: "project",
        timezone: "Asia/Singapore",
        from: "2026-05-19T16:00:00.000Z",
        to: "2026-06-16T16:00:00.000Z",
        dataSnapshotId: materializedB.snapshot.id,
      });
      expect(analysisB.snapshot.analysis.summary.usageKwh).toBe(4_904.8659);
      expect(analysisB.snapshot.analysis.comparison).toMatchObject({
        from: analysisA.snapshot.context.from,
        to: analysisA.snapshot.context.to,
        usageKwh: analysisA.snapshot.analysis.summary.usageKwh,
      });
      expect(analysisB.snapshot.analysis.cost.status).toBe("available");
      expect(analysisB.snapshot.analysis.offHours.status).toBe("available");
      expect(analysisB.snapshot.decisionPriorities?.status).not.toBe("unavailable");
      expect(releaseIdentity(analysisB.snapshot)).toEqual(releaseIdentityA);
      expectEvidencePins(analysisB.snapshot.evidence, materializedB.snapshot.id);
      expect(new Set(analysisA.snapshot.evidence.map((item) => item.id)))
        .not.toEqual(new Set(analysisB.snapshot.evidence.map((item) => item.id)));

      const savedAfterB = metadata.energyIq.savedAnalyses.get(savedA.id);
      expect(savedAfterB).toMatchObject({
        id: savedA.id,
        series_id: savedA.series_id,
        sequence: savedA.sequence,
        data_snapshot_id: materializedA.snapshot.id,
        template_revision_id: savedA.template_revision_id,
        analysis_json: frozenAnalysisJson,
        query_json: frozenQueryJson,
      });
      const frozenAnalysis = JSON.parse(savedAfterB.analysis_json) as {
        provenance: { dataSnapshotId: string };
      };
      expect(frozenAnalysis.provenance.dataSnapshotId).toBe(materializedA.snapshot.id);
      expect(frozenAnalysis.provenance.dataSnapshotId).not.toBe(materializedB.snapshot.id);

      const savedDetail = await handleEnergyApiRequest(
        getRequest(),
        ["projects", PROJECT_ID, "saved-analyses", savedA.id],
        context,
      );
      expect(savedDetail).toMatchObject({
        status: 200,
        body: {
          success: true,
          data: {
            id: savedA.id,
            dataSnapshotId: materializedA.snapshot.id,
            analysis: {
              provenance: { dataSnapshotId: materializedA.snapshot.id },
            },
          },
        },
      });
      mark("read saved A after B");
    } finally {
      metadata.close();
      if (retainedRoot) {
        if (process.env.ENERGYIQ_ACCEPTANCE_TIMINGS === "1") {
          console.info(`[ngee-ann-two-snapshot] retained fixture: ${root}`);
        }
      } else {
        removeTemporaryFixture(root);
      }
    }
  }, 360_000);
});

type SourceDefinition = (typeof SOURCES)[keyof typeof SOURCES];

const registerSources = async (
  metadata: ReturnType<typeof createMetadataStore>,
  fileAssets: LocalFileAssetService,
  definitions: readonly SourceDefinition[],
) => Promise.all(definitions.map(async (definition) => {
  const content = readFileSync(join(SOURCE_ROOT, definition.filename));
  const sha256 = createHash("sha256").update(content).digest("hex");
  expect(sha256).toBe(definition.sha256);
  const inspection = await inspectEnergyExcelWorkbook(content);
  expect(inspection).toMatchObject({
    sheetName: "Sheet1",
    invalidRowCount: 0,
    qualityStatus: "ready",
  });
  expect(inspection.sourceLabels).toHaveLength(9);
  const ref = fileAssets.createRef({
    user_id: "dev-user",
    workspace_id: NGEE_ANN_WORKSPACE_ID,
    filename: definition.filename,
    content,
    declared_mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    source: "upload",
    metadata: { purpose: "energyiq_import", projectId: PROJECT_ID },
  });
  metadata.energyIq.createImportBatch({
    id: definition.batchId,
    workspace_id: NGEE_ANN_WORKSPACE_ID,
    project_id: PROJECT_ID,
    source_kind: "excel",
    source_sha256: sha256,
    filename: definition.filename,
    file_asset_ref_id: ref.ref.id,
    status: "inspected",
    inspection,
    created_by: "dev-user",
  });
  return { ...definition, sha256 };
}));

const updateSourceManifest = (
  metadata: ReturnType<typeof createMetadataStore>,
  sha256: string[],
): void => {
  const draft = metadata.energyIq.projectSetup.getDraft({
    project_id: PROJECT_ID,
    user_id: "dev-user",
  });
  metadata.energyIq.projectSetup.saveDraft({
    project_id: PROJECT_ID,
    expected_revision: draft.revision,
    user_id: "dev-user",
    document: {
      ...draft.document,
      source_manifest: createEnergyIqSourceManifest(sha256, true),
    },
  });
};

const resolveCurrentOverview = async (input: {
  metadata: ReturnType<typeof createMetadataStore>;
  gateway: LocalDataGateway;
  user: ReturnType<ReturnType<typeof createMetadataStore>["users"]["getById"]>;
  databasePath: string;
}) => {
  const result = await resolveProjectAnalysis({
    metadataStore: input.metadata,
    dataGateway: input.gateway,
    user: input.user,
    workspaceId: NGEE_ANN_WORKSPACE_ID,
    request: {
      projectId: PROJECT_ID,
      scopeId: "project",
      resource: "electricity",
      analysisWindow: "current-overview-28d",
    },
    databasePath: input.databasePath,
    now: new Date("2026-08-07T00:00:00.000Z"),
  });
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error("NGEE_ANN_CURRENT_OVERVIEW_NOT_READY");
  return result;
};

const releaseIdentity = (snapshot: Awaited<ReturnType<typeof resolveCurrentOverview>>["snapshot"]) => ({
  projectReleaseId: snapshot.projectRelease.id,
  templateRevisionId: snapshot.projectRelease.templateRevisionId,
  hierarchyRevisionId: snapshot.projectRelease.hierarchyRevisionId,
  meterMappingRevisionId: snapshot.projectRelease.meterMappingRevisionId,
  meterFormulaRevisionId: snapshot.projectRelease.meterFormulaRevisionId,
  businessCalendarVersion: snapshot.projectRelease.businessCalendarVersion,
  tariffScheduleVersion: snapshot.projectRelease.tariffScheduleVersion,
  renderer: snapshot.renderer,
  recipe: snapshot.recipe,
});

const expectEvidencePins = (
  evidence: Array<{ id: string }>,
  dataSnapshotId: string,
): void => {
  expect(evidence.length).toBeGreaterThan(0);
  for (const item of evidence) expect(item.id).toContain(`evidence:${dataSnapshotId}:`);
};

const sortedSha = (sources: ReadonlyArray<{ sha256: string }>): string[] =>
  sources.map((source) => source.sha256).sort((left, right) => left.localeCompare(right));

const phaseTimer = () => {
  let previous = performance.now();
  return (label: string): void => {
    const current = performance.now();
    if (process.env.ENERGYIQ_ACCEPTANCE_TIMINGS === "1") {
      console.info(`[ngee-ann-two-snapshot] ${label}: ${Math.round(current - previous)} ms`);
    }
    previous = current;
  };
};

const configureNgeeAnnOperationalPolicy = (
  metadata: ReturnType<typeof createMetadataStore>,
): void => {
  metadata.energyIq.operationalPolicy.publishTariffSchedule({
    version_id: "sg-tariff-v1",
    project_id: PROJECT_ID,
    published_by: "dev-user",
    entries: [{
      id: "sg-tariff-v1-flat",
      owner: { kind: "project" },
      effective_from: "2026-03-31T16:00:00.000Z",
      currency: "SGD",
      rate_per_kwh: 0.32,
    }],
  });
  metadata.energyIq.operationalPolicy.publishOperatingCalendar({
    version_id: "sg-calendar-v1",
    project_id: PROJECT_ID,
    published_by: "dev-user",
    entries: [{
      id: "sg-calendar-v1-office-hours",
      owner: { kind: "project" },
      effective_from: "2026-03-01",
      weekly: {
        monday: [{ from: "08:00", to: "18:00" }],
        tuesday: [{ from: "08:00", to: "18:00" }],
        wednesday: [{ from: "08:00", to: "18:00" }],
        thursday: [{ from: "08:00", to: "18:00" }],
        friday: [{ from: "08:00", to: "18:00" }],
        saturday: [],
        sunday: [],
      },
    }],
  });
};

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

const removeTemporaryFixture = (root: string): void => {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    if (
      process.platform === "win32"
      && error instanceof Error
      && "code" in error
      && (error.code === "EPERM" || error.code === "EBUSY")
    ) return;
    throw error;
  }
};

const createRetainedFixtureRoot = (requestedRoot: string): string => {
  const root = resolve(requestedRoot);
  mkdirSync(root);
  return root;
};
