import { describe, expect, it } from "vitest";

import { readEnergyFactMaterializationStats, writeEnergyFactMaterialization } from "./energy-fact-writer.js";

describe("writeEnergyFactMaterialization", () => {
  it("writes a batch idempotently into the canonical fact tables", async () => {
    const input = {
      databasePath: ":memory:",
      projectId: "project-1",
      importBatchId: "batch-1",
      sourceSha256: "sha-1",
      rawReadings: [{
        workspaceId: "workspace-1",
        projectId: "project-1",
        importBatchId: "batch-1",
        resource: "electricity" as const,
        sourceLabel: "Meter A",
        meterPointId: "meter-a",
        scopeId: "scope-a",
        eventTime: "2026-05-01T00:00:00.000Z",
        activeEnergyKwh: 100,
        sourceFile: "meter.xlsx",
        sourceSha256: "sha-1",
        sourceRowNumber: 2,
        isValid: true,
        isOverlapConflict: false,
      }],
      normalizedReadings: [{
        workspaceId: "workspace-1",
        projectId: "project-1",
        importBatchId: "batch-1",
        resource: "electricity" as const,
        meterPointId: "meter-a",
        scopeId: "scope-a",
        sourceLabel: "Meter A",
        category: "load",
        meterRole: "total",
        eventTime: "2026-05-01T00:00:00.000Z",
        activeEnergyKwh: 100,
        sourceFile: "meter.xlsx",
        sourceSha256: "sha-1",
        sourceRowNumber: 2,
      }],
      intervalFacts: [{
        workspaceId: "workspace-1",
        projectId: "project-1",
        importBatchId: "batch-1",
        resource: "electricity" as const,
        meterPointId: "meter-a",
        scopeId: "scope-a",
        sourceLabel: "Meter A",
        category: "load",
        meterRole: "total",
        intervalStart: "2026-05-01T00:00:00.000Z",
        intervalEnd: "2026-05-01T00:15:00.000Z",
        elapsedMinutes: 15,
        activeEnergyKwh: 100.5,
        previousActiveEnergyKwh: 100,
        rawDeltaKwh: 0.5,
        usageKwh: 0.5,
        averageKw: 2,
        qualityStatus: "ok",
        localDate: "2026-05-01",
        localHour: 8,
        dayType: "weekday",
        sourceFile: "meter.xlsx",
        sourceSha256: "sha-1",
      }],
      qualityEvents: [{
        workspaceId: "workspace-1",
        projectId: "project-1",
        importBatchId: "batch-1",
        meterPointId: "meter-a",
        sourceLabel: "Meter A",
        eventTime: "2026-05-01T00:00:00.000Z",
        code: "boundary",
        severity: "warning" as const,
        details: {},
      }],
    };

    await writeEnergyFactMaterialization(input);
    await writeEnergyFactMaterialization(input);
    await expect(readEnergyFactMaterializationStats({
      databasePath: ":memory:",
      importBatchId: "batch-1",
    })).resolves.toEqual({ rawRows: 1, normalizedRows: 1, intervalFacts: 1, qualityEvents: 1 });
  });
});
