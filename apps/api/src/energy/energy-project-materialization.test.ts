import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { LocalFileAssetService } from "@datafoundry/files";
import { readEnergyFactProjectState } from "@datafoundry/data-gateway";
import {
  createEnergyIqSourceManifest,
  createMetadataStore,
  resolveEnergyIqSnapshotFactScope,
} from "@datafoundry/metadata";
import { describe, expect, it, vi } from "vitest";
import writeXlsxFile from "write-excel-file/node";

import {
  isEnergyProjectFactStateCurrent,
  materializeEnergyProjectManifest,
  withEnergyProjectMaterializationLock,
} from "./energy-project-materialization.js";

describe("Energy Project materialization lock", () => {
  it("serializes the complete project publication chain by workspace and Project", async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });

    const first = withEnergyProjectMaterializationLock("workspace-1", "project-1", async () => {
      events.push("first:start");
      markFirstStarted();
      await firstGate;
      events.push("first:end");
    });
    const second = withEnergyProjectMaterializationLock("workspace-1", "project-1", async () => {
      events.push("second:start");
      events.push("second:end");
    });

    await firstStarted;
    expect(events).toEqual(["first:start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });

  it("does not treat an A/B Snapshot as current after the Draft manifest removes B", () => {
    const scope = {
      workspaceId: "workspace-1",
      projectId: "project-1",
      dataSnapshotId: "snapshot-ab",
      manifestFingerprint: "fingerprint-ab",
      sourceSha256: ["sha-a", "sha-b"],
    };
    expect(isEnergyProjectFactStateCurrent({
      factState: { ...scope, factWriterContractVersion: "energy-fact-writer-snapshot-manifest-v3" },
      snapshotScope: scope,
      workspaceId: "workspace-1",
      projectId: "project-1",
      currentSourceManifestSha256: ["sha-a"],
    })).toBe(false);
  });

  it("recovers first publication after the fact writer commits but Metadata completion crashes", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-project-first-publication-retry-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const fileAssets = new LocalFileAssetService(metadata, { storageRoot: join(root, "files") });
    try {
      metadata.workspaces.upsert({ id: "workspace-1", owner_user_id: "dev-user", name: "Workspace", kind: "customer" });
      metadata.energyIq.upsertProject({ id: "project-1", workspace_id: "workspace-1", name: "Project", status: "draft" });
      const source = await workbookSource("source-a.xlsx", "2026-05-01T00:00:00Z", 100);
      const ref = fileAssets.createRef({
        user_id: "dev-user",
        workspace_id: "workspace-1",
        filename: source.filename,
        content: source.content,
        declared_mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        source: "upload",
      });
      metadata.energyIq.createImportBatch({
        id: "batch-a",
        workspace_id: "workspace-1",
        project_id: "project-1",
        source_kind: "excel",
        source_sha256: source.sha,
        filename: source.filename,
        file_asset_ref_id: ref.ref.id,
        status: "inspected",
        inspection: { sourceLabels: [{ label: "Meter A", rowCount: 2 }] },
        created_by: "dev-user",
      });
      const initialDraft = metadata.energyIq.projectSetup.getDraft({ project_id: "project-1", user_id: "dev-user" });
      metadata.energyIq.projectSetup.saveDraft({
        project_id: "project-1",
        expected_revision: initialDraft.revision,
        user_id: "dev-user",
        document: projectDocument([source.sha]),
      });
      const context = { metadataStore: metadata, fileAssetService: fileAssets } as never;
      await createLegacyFactStore(databasePath);
      vi.spyOn(metadata.energyIq, "completeProjectManifestMaterialization")
        .mockImplementationOnce(() => {
          throw new Error("SIMULATED_METADATA_COMPLETION_CRASH");
        });

      await expect(materializeEnergyProjectManifest({
        context,
        userId: "dev-user",
        projectId: "project-1",
        requestedBatchId: "batch-a",
        databasePath,
      })).rejects.toThrow("SIMULATED_METADATA_COMPLETION_CRASH");
      expect(metadata.energyIq.getProject("project-1").data_snapshot_id).toBe("unavailable");
      const committedState = await readEnergyFactProjectState({ databasePath, projectId: "project-1" });
      expect(committedState?.dataSnapshotId).not.toBe("unavailable");

      const recovered = await materializeEnergyProjectManifest({
        context,
        userId: "dev-user",
        projectId: "project-1",
        requestedBatchId: "batch-a",
        databasePath,
      });
      expect(recovered.duplicate).toBe(false);
      expect(recovered.snapshot.id).toBe(committedState?.dataSnapshotId);
      expect(metadata.energyIq.getProject("project-1").data_snapshot_id).toBe(recovered.snapshot.id);
    } finally {
      vi.restoreAllMocks();
      metadata.close();
      try {
        rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch (error) {
        if (process.platform !== "win32" || !(error instanceof Error) || !("code" in error)
          || (error.code !== "EPERM" && error.code !== "EBUSY")) throw error;
      }
    }
  }, 30_000);

  it("rebuilds A-only after the Draft removes B instead of returning the old A/B Snapshot", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-project-manifest-removal-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const fileAssets = new LocalFileAssetService(metadata, { storageRoot: join(root, "files") });
    try {
      metadata.workspaces.upsert({ id: "workspace-1", owner_user_id: "dev-user", name: "Workspace", kind: "customer" });
      metadata.energyIq.upsertProject({ id: "project-1", workspace_id: "workspace-1", name: "Project", status: "draft" });
      const sources = await Promise.all([
        workbookSource("source-a.xlsx", "2026-05-01T00:00:00Z", 100),
        workbookSource("source-b.xlsx", "2026-05-01T00:30:00Z", 101),
      ]);
      for (const [index, source] of sources.entries()) {
        const ref = fileAssets.createRef({
          user_id: "dev-user",
          workspace_id: "workspace-1",
          filename: source.filename,
          content: source.content,
          declared_mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          source: "upload",
        });
        metadata.energyIq.createImportBatch({
          id: `batch-${index === 0 ? "a" : "b"}`,
          workspace_id: "workspace-1",
          project_id: "project-1",
          source_kind: "excel",
          source_sha256: source.sha,
          filename: source.filename,
          file_asset_ref_id: ref.ref.id,
          status: "inspected",
          inspection: { sourceLabels: [{ label: "Meter A", rowCount: 2 }] },
          created_by: "dev-user",
        });
      }
      const initialDraft = metadata.energyIq.projectSetup.getDraft({ project_id: "project-1", user_id: "dev-user" });
      metadata.energyIq.projectSetup.saveDraft({
        project_id: "project-1",
        expected_revision: initialDraft.revision,
        user_id: "dev-user",
        document: projectDocument(sources.map((source) => source.sha)),
      });
      const context = {
        metadataStore: metadata,
        fileAssetService: fileAssets,
      } as never;
      const first = await materializeEnergyProjectManifest({
        context,
        userId: "dev-user",
        projectId: "project-1",
        requestedBatchId: "batch-a",
        databasePath: join(root, "energy.duckdb"),
      });
      expect(first.duplicate).toBe(false);
      expect(first.timings).toMatchObject({
        sourceWriteMs: expect.any(Number),
        canonicalRebuildMs: expect.any(Number),
        integrityAndCheckpointMs: expect.any(Number),
        totalMs: expect.any(Number),
      });
      expect(first.timings?.parseNormalizeByBatch).toHaveLength(2);
      expect(first.timings?.parseNormalizeByBatch).toEqual(expect.arrayContaining([
        { batchId: "batch-a", durationMs: expect.any(Number) },
        { batchId: "batch-b", durationMs: expect.any(Number) },
      ]));
      expect(resolveEnergyIqSnapshotFactScope(first.snapshot).sourceSha256).toEqual(sources.map((source) => source.sha).sort());

      const currentDraft = metadata.energyIq.projectSetup.getDraft({ project_id: "project-1", user_id: "dev-user" });
      metadata.energyIq.projectSetup.saveDraft({
        project_id: "project-1",
        expected_revision: currentDraft.revision,
        user_id: "dev-user",
        document: projectDocument([sources[0]!.sha]),
      });
      const removed = await materializeEnergyProjectManifest({
        context,
        userId: "dev-user",
        projectId: "project-1",
        requestedBatchId: "batch-a",
        databasePath: join(root, "energy.duckdb"),
      });
      expect(removed.duplicate).toBe(false);
      expect(removed.snapshot.id).not.toBe(first.snapshot.id);
      expect(resolveEnergyIqSnapshotFactScope(removed.snapshot).sourceSha256).toEqual([sources[0]!.sha]);
      expect(JSON.parse(removed.snapshot.audit_json)).toMatchObject({ rawRowCount: 2 });
    } finally {
      metadata.close();
      try {
        rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch (error) {
        if (process.platform !== "win32" || !(error instanceof Error) || !("code" in error)
          || (error.code !== "EPERM" && error.code !== "EBUSY")) throw error;
      }
    }
  }, 30_000);
});

const workbookSource = async (filename: string, from: string, start: number) => {
  const content = await writeXlsxFile([
    [{ type: String, value: "Device Name" }, { type: String, value: "Time" }, { type: String, value: "Active Energy" }],
    [{ type: String, value: "Meter A" }, { type: Date, value: new Date(from), format: "yyyy-mm-dd hh:mm" }, { type: Number, value: start }],
    [{ type: String, value: "Meter A" }, { type: Date, value: new Date(Date.parse(from) + 15 * 60_000), format: "yyyy-mm-dd hh:mm" }, { type: Number, value: start + 1 }],
  ]).toBuffer();
  return { filename, content, sha: createHash("sha256").update(content).digest("hex") };
};

const projectDocument = (sourceSha256: string[]) => ({
  project: { name: "Project", timezone: "Asia/Singapore" },
  tier_structure_locked: false,
  tiers: [],
  nodes: [],
  source_manifest: createEnergyIqSourceManifest(sourceSha256, true),
  meter_mapping: {
    schema_version: 2 as const,
    source_kind: "excel" as const,
    confirmed: true,
    rows: [{
      id: "meter-a",
      source_label: "Meter A",
      scope_id: "project",
      display_name: "Meter A",
      resource: "electricity" as const,
      category: "load" as const,
      coverage: "whole" as const,
      meter_role: "total" as const,
      aggregation_usage: "official" as const,
    }],
  },
});

const createLegacyFactStore = async (databasePath: string): Promise<void> => {
  const script = `
    const duckdb = require("duckdb");
    const database = new duckdb.Database(process.env.ENERGYIQ_LEGACY_TEST_DB, (openError) => {
      if (openError) throw openError;
      database.run(${JSON.stringify(legacyFactSchemaSql)}, (runError) => {
        if (runError) throw runError;
        database.close((closeError) => {
          if (closeError) throw closeError;
        });
      });
    });
  `;
  await promisify(execFile)(process.execPath, ["-e", script], {
    env: { ...process.env, ENERGYIQ_LEGACY_TEST_DB: databasePath },
  });
};

const legacyFactSchemaSql = `
  CREATE TABLE raw_meter_readings (
    workspace_id VARCHAR, project_id VARCHAR, resource VARCHAR, device_name VARCHAR,
    event_time TIMESTAMPTZ, active_energy_kwh DOUBLE, source_file VARCHAR,
    source_sha256 VARCHAR, source_row_number INTEGER, is_valid BOOLEAN,
    validation_error VARCHAR, is_overlap_conflict BOOLEAN
  );
  CREATE TABLE normalized_meter_readings (
    workspace_id VARCHAR, project_id VARCHAR, resource VARCHAR, meter_node_id VARCHAR,
    level_node_id VARCHAR, device_name VARCHAR, category VARCHAR, meter_role VARCHAR,
    event_time TIMESTAMPTZ, active_energy_kwh DOUBLE, source_file VARCHAR,
    source_sha256 VARCHAR, source_row_number INTEGER
  );
  CREATE TABLE energy_interval_facts (
    workspace_id VARCHAR, project_id VARCHAR, resource VARCHAR, meter_node_id VARCHAR,
    parent_node_id VARCHAR, level_node_id VARCHAR, device_name VARCHAR, appliance VARCHAR,
    circuit_name VARCHAR, category VARCHAR, meter_role VARCHAR,
    interval_start TIMESTAMPTZ, interval_end TIMESTAMPTZ, elapsed_minutes DOUBLE,
    active_energy_kwh DOUBLE, previous_active_energy_kwh DOUBLE, raw_delta_kwh DOUBLE,
    usage_kwh DOUBLE, average_kw DOUBLE, quality_status VARCHAR, local_date DATE,
    local_hour INTEGER, day_type VARCHAR, is_operating BOOLEAN, source_file VARCHAR,
    source_sha256 VARCHAR
  );
  CREATE TABLE energy_quality_events (
    workspace_id VARCHAR NOT NULL, project_id VARCHAR NOT NULL,
    import_batch_id VARCHAR NOT NULL, meter_node_id VARCHAR, source_label VARCHAR,
    event_time TIMESTAMPTZ, code VARCHAR NOT NULL, severity VARCHAR NOT NULL,
    details_json JSON NOT NULL
  );
`;
