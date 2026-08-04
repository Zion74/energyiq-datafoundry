import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ENERGY_FACT_WRITER_CONTRACT_VERSION,
  writeEnergyFactMaterialization,
  type EnergyFactMaterializationResult,
  type EnergyFactMaterializationWrite,
} from "@datafoundry/data-gateway";
import { createMetadataStore, type EnergyIqDataSnapshotRecord } from "@datafoundry/metadata";

import {
  createEnergyImportCompletionInput,
  ENERGY_EXCEL_MATERIALIZER_CONTRACT_VERSION,
  type EnergyImportMaterializationSummary,
} from "./energy-import-materializer.js";

describe("Energy import completion", () => {
  it("keeps the final immutable Snapshot identical across real writer completion orders", async () => {
    const earlierFirst = await runWriterOrder("writer-earlier-first", ["earlier", "later"]);
    const laterFirst = await runWriterOrder("writer-later-first", ["later", "earlier"]);

    expect(earlierFirst.results.earlier.persisted.normalizedRows).toBe(1);
    expect(laterFirst.results.earlier.persisted.normalizedRows).toBe(0);
    expect(earlierFirst.results.earlier.completion.summary.normalizedReadingCount).toBe(1);
    expect(laterFirst.results.earlier.completion.summary.normalizedReadingCount).toBe(1);
    expect(earlierFirst.finalAudit).toEqual(laterFirst.finalAudit);

    const left = persistCompletionOrder(["earlier", "later"], earlierFirst.results);
    const right = persistCompletionOrder(["later", "earlier"], laterFirst.results);
    expect(left.id).toBe(right.id);
    expect(JSON.parse(left.manifest_json)).toEqual(JSON.parse(right.manifest_json));
    expect(JSON.parse(left.audit_json)).toEqual(JSON.parse(right.audit_json));
  });
});

type SourceKey = "earlier" | "later";
type WriterResult = {
  persisted: EnergyFactMaterializationResult;
  completion: ReturnType<typeof createEnergyImportCompletionInput>;
};

const SOURCE_SHA = {
  earlier: "a".repeat(64),
  later: "b".repeat(64),
} as const;

const runWriterOrder = async (
  projectId: string,
  order: SourceKey[],
): Promise<{ results: Record<SourceKey, WriterResult>; finalAudit: EnergyFactMaterializationResult["projectAudit"] }> => {
  const results = {} as Record<SourceKey, WriterResult>;
  for (const source of order) {
    const write = sourceWrite(projectId, source);
    const persisted = await writeEnergyFactMaterialization(write);
    results[source] = {
      persisted,
      completion: createEnergyImportCompletionInput(sourceSummary(source, write), persisted),
    };
  }
  return { results, finalAudit: results[order.at(-1)!].persisted.projectAudit };
};

const persistCompletionOrder = (
  order: SourceKey[],
  results: Record<SourceKey, WriterResult>,
): EnergyIqDataSnapshotRecord => {
  const root = mkdtempSync(join(tmpdir(), "energy-import-completion-order-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  try {
    metadata.workspaces.upsert({
      id: "workspace-1",
      owner_user_id: "dev-user",
      name: "Customer Workspace",
      kind: "customer",
    });
    metadata.energyIq.upsertProject({
      id: "project-order",
      workspace_id: "workspace-1",
      name: "Order-independent Project",
      status: "draft",
    });
    for (const source of ["earlier", "later"] as const) {
      metadata.energyIq.createImportBatch({
        id: `batch-${source}`,
        workspace_id: "workspace-1",
        project_id: "project-order",
        source_kind: "excel",
        source_sha256: SOURCE_SHA[source],
        filename: `${source}.xlsx`,
        status: "inspected",
        inspection: {
          sheetName: "Sheet1",
          rowCount: source === "earlier" ? 1 : 2,
          sourceLabels: [{ label: "Meter A", rowCount: source === "earlier" ? 1 : 2 }],
          coverageFrom: source === "earlier" ? "2026-05-01T00:15:00.000Z" : "2026-05-01T00:15:00.000Z",
          coverageTo: source === "earlier" ? "2026-05-01T00:15:00.000Z" : "2026-05-01T00:30:00.000Z",
        },
        created_by: "dev-user",
      });
    }
    let snapshot: EnergyIqDataSnapshotRecord | undefined;
    for (const source of order) {
      snapshot = metadata.energyIq.completeImportBatchMaterialization({
        batch_id: `batch-${source}`,
        project_id: "project-order",
        ...results[source].completion,
        source_manifest_sha256: Object.values(SOURCE_SHA),
      }).snapshot;
    }
    return snapshot!;
  } finally {
    metadata.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};

const sourceWrite = (projectId: string, source: SourceKey): EnergyFactMaterializationWrite => {
  const batchId = `${projectId}-${source}`;
  const sourceSha256 = SOURCE_SHA[source];
  const sourceFile = `${source}.xlsx`;
  const points = source === "earlier"
    ? [{ time: "2026-05-01T00:15:00.000Z", value: 100.9 }]
    : [
        { time: "2026-05-01T00:15:00.000Z", value: 101 },
        { time: "2026-05-01T00:30:00.000Z", value: 102 },
      ];
  const facts = source === "earlier"
    ? [{ start: "2026-05-01T00:00:00.000Z", end: "2026-05-01T00:15:00.000Z", usage: 0.9 }]
    : [
        { start: "2026-05-01T00:00:00.000Z", end: "2026-05-01T00:15:00.000Z", usage: 1 },
        { start: "2026-05-01T00:15:00.000Z", end: "2026-05-01T00:30:00.000Z", usage: 1 },
      ];
  return {
    databasePath: ":memory:",
    projectId,
    importBatchId: batchId,
    sourceSha256,
    timezone: "Asia/Singapore",
    rawReadings: points.map((point, index) => ({
      workspaceId: "workspace-1",
      projectId,
      importBatchId: batchId,
      resource: "electricity",
      sourceLabel: "Meter A",
      meterPointId: "meter-a",
      scopeId: "scope-a",
      eventTime: point.time,
      activeEnergyKwh: point.value,
      sourceFile,
      sourceSha256,
      sourceRowNumber: index + 2,
      isValid: true,
      isOverlapConflict: false,
    })),
    normalizedReadings: points.map((point, index) => ({
      workspaceId: "workspace-1",
      projectId,
      importBatchId: batchId,
      resource: "electricity",
      meterPointId: "meter-a",
      scopeId: "scope-a",
      sourceLabel: "Meter A",
      category: "load",
      meterRole: "total",
      eventTime: point.time,
      activeEnergyKwh: point.value,
      sourceFile,
      sourceSha256,
      sourceRowNumber: index + 2,
      sourceReadingKind: "cumulative_energy",
    })),
    intervalFacts: facts.map((fact) => ({
      workspaceId: "workspace-1",
      projectId,
      importBatchId: batchId,
      resource: "electricity",
      meterPointId: "meter-a",
      scopeId: "scope-a",
      sourceLabel: "Meter A",
      category: "load",
      meterRole: "total",
      intervalStart: fact.start,
      intervalEnd: fact.end,
      elapsedMinutes: 15,
      activeEnergyKwh: 101,
      previousActiveEnergyKwh: 100,
      rawDeltaKwh: fact.usage,
      usageKwh: fact.usage,
      averageKw: fact.usage * 4,
      qualityStatus: "ok",
      localDate: "2026-05-01",
      localHour: 8,
      dayType: "weekday",
      sourceFile,
      sourceSha256,
      sourceReadingKind: "cumulative_energy",
    })),
    qualityEvents: [],
  };
};

const sourceSummary = (
  source: SourceKey,
  write: EnergyFactMaterializationWrite,
): EnergyImportMaterializationSummary => ({
  rawRowCount: write.rawReadings.length,
  normalizedReadingCount: write.normalizedReadings.length,
  intervalFactCount: write.intervalFacts.length,
  totalUsageKwh: write.intervalFacts.reduce((sum, fact) => sum + (fact.usageKwh ?? 0), 0),
  qualityCounts: { ok: write.intervalFacts.length },
  mappingRevision: 3,
  mappingFingerprint: "mapping-fingerprint",
  timezone: "Asia/Singapore",
  materializerContractVersion: ENERGY_EXCEL_MATERIALIZER_CONTRACT_VERSION,
  factWriterContractVersion: ENERGY_FACT_WRITER_CONTRACT_VERSION,
  sourceSheetName: "Sheet1",
  sourceRowCount: write.rawReadings.length,
  sourceLabels: ["Meter A"],
  sourceCoverageFrom: "2026-05-01T00:15:00.000Z",
  sourceCoverageTo: source === "earlier" ? "2026-05-01T00:15:00.000Z" : "2026-05-01T00:30:00.000Z",
});
