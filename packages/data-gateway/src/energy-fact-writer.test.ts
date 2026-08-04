import { describe, expect, it } from "vitest";

import { readEnergyFactMaterializationStats, writeEnergyFactMaterialization } from "./energy-fact-writer.js";
import { readEnergyFactCoverage } from "./energy-scoped-datasource.js";

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
    await expect(readEnergyFactCoverage({
      databasePath: ":memory:",
      workspaceId: "workspace-1",
      projectId: "project-1",
      resource: "electricity",
    })).resolves.toEqual({
      from: "2026-05-01T00:00:00.000Z",
      to: "2026-05-01T00:15:00.000Z",
      intervalCount: 1,
    });

    const legacyProjectId = "project-legacy";
    const legacy = await writeEnergyFactMaterialization({
      ...input,
      projectId: legacyProjectId,
      importBatchId: "",
      sourceSha256: "",
      rawReadings: input.rawReadings.map((row) => ({
        ...row,
        projectId: legacyProjectId,
        importBatchId: "",
        sourceSha256: "",
        sourceFile: "synthetic-legacy.xlsx",
        isValid: null as unknown as boolean,
      })),
      normalizedReadings: input.normalizedReadings.map((row) => ({
        ...row,
        projectId: legacyProjectId,
        importBatchId: "",
        sourceSha256: "",
        sourceFile: "synthetic-legacy.xlsx",
      })),
      intervalFacts: input.intervalFacts.map((row) => ({
        ...row,
        projectId: legacyProjectId,
        importBatchId: "",
        sourceSha256: "",
        sourceFile: "synthetic-legacy.xlsx",
        qualityStatus: "negative_delta",
      })),
      qualityEvents: [],
    });
    expect(legacy.projectAudit).toMatchObject({
      invalidRawRowCount: 1,
      negativeDeltaIntervalCount: 1,
      legacyRawRowCount: 1,
      legacyNormalizedReadingCount: 1,
      legacyIntervalFactCount: 1,
      legacyCanonicalRowCount: 2,
    });
  });

  it("keeps the source with the later coverage end at an overlapping timestamp", async () => {
    const databasePath = ":memory:";
    const base = {
      databasePath,
      projectId: "project-overlap",
      qualityEvents: [],
    };
    const raw = (batch: string, sha: string, time: string, value: number, projectId = "project-overlap") => ({
      workspaceId: "workspace-1",
      projectId,
      importBatchId: batch,
      resource: "electricity" as const,
      sourceLabel: "Meter A",
      meterPointId: "meter-a",
      scopeId: "scope-a",
      eventTime: time,
      activeEnergyKwh: value,
      sourceFile: `${batch}.xlsx`,
      sourceSha256: sha,
      sourceRowNumber: 2,
      isValid: true,
      isOverlapConflict: false,
    });
    const normalized = (batch: string, sha: string, time: string, value: number, projectId = "project-overlap") => ({
      workspaceId: "workspace-1",
      projectId,
      importBatchId: batch,
      resource: "electricity" as const,
      meterPointId: "meter-a",
      scopeId: "scope-a",
      sourceLabel: "Meter A",
      category: "load",
      meterRole: "total",
      eventTime: time,
      activeEnergyKwh: value,
      sourceFile: `${batch}.xlsx`,
      sourceSha256: sha,
      sourceRowNumber: 2,
    });
    const fact = (batch: string, sha: string, start: string, end: string, usage: number, projectId = "project-overlap") => ({
      workspaceId: "workspace-1",
      projectId,
      importBatchId: batch,
      resource: "electricity" as const,
      meterPointId: "meter-a",
      scopeId: "scope-a",
      sourceLabel: "Meter A",
      category: "load",
      meterRole: "total",
      intervalStart: start,
      intervalEnd: end,
      elapsedMinutes: 15,
      activeEnergyKwh: 101,
      previousActiveEnergyKwh: 100,
      rawDeltaKwh: usage,
      usageKwh: usage,
      averageKw: usage * 4,
      qualityStatus: "ok",
      localDate: "2026-05-01",
      localHour: 8,
      dayType: "weekday",
      sourceFile: `${batch}.xlsx`,
      sourceSha256: sha,
    });

    await writeEnergyFactMaterialization({
      ...base,
      importBatchId: "later",
      sourceSha256: "sha-later",
      rawReadings: [
        raw("later", "sha-later", "2026-05-01T00:15:00.000Z", 101),
        raw("later", "sha-later", "2026-05-01T00:30:00.000Z", 102),
      ],
      normalizedReadings: [
        normalized("later", "sha-later", "2026-05-01T00:15:00.000Z", 101),
        normalized("later", "sha-later", "2026-05-01T00:30:00.000Z", 102),
      ],
      intervalFacts: [
        fact("later", "sha-later", "2026-05-01T00:00:00.000Z", "2026-05-01T00:15:00.000Z", 1),
        fact("later", "sha-later", "2026-05-01T00:15:00.000Z", "2026-05-01T00:30:00.000Z", 1),
      ],
    });
    const materialized = await writeEnergyFactMaterialization({
      ...base,
      importBatchId: "earlier",
      sourceSha256: "sha-earlier",
      rawReadings: [
        raw("earlier", "sha-earlier", "2026-05-01T00:15:00.000Z", 100.9),
      ],
      normalizedReadings: [
        normalized("earlier", "sha-earlier", "2026-05-01T00:15:00.000Z", 100.9),
      ],
      intervalFacts: [
        fact("earlier", "sha-earlier", "2026-05-01T00:00:00.000Z", "2026-05-01T00:15:00.000Z", 0.9),
      ],
    });

    await expect(readEnergyFactMaterializationStats({ databasePath, importBatchId: "later" }))
      .resolves.toMatchObject({ normalizedRows: 2, intervalFacts: 2 });
    await expect(readEnergyFactMaterializationStats({ databasePath, importBatchId: "earlier" }))
      .resolves.toMatchObject({ normalizedRows: 0, intervalFacts: 0 });
    expect(materialized.projectAudit).toEqual({
      rawRowCount: 3,
      invalidRawRowCount: 0,
      unmappedRawRowCount: 0,
      rawOverlapConflictCount: 2,
      normalizedReadingCount: 2,
      intervalFactCount: 2,
      duplicateNormalizedReadingCount: 0,
      duplicateIntervalFactCount: 0,
      invalidIntervalDurationCount: 0,
      negativeDeltaIntervalCount: 0,
      legacyRawRowCount: 0,
      legacyNormalizedReadingCount: 0,
      legacyIntervalFactCount: 0,
      legacyCanonicalRowCount: 0,
    });

    const reverseProjectId = "project-overlap-reverse";
    await writeEnergyFactMaterialization({
      ...base,
      projectId: reverseProjectId,
      importBatchId: "earlier-reverse",
      sourceSha256: "sha-earlier",
      rawReadings: [raw("earlier-reverse", "sha-earlier", "2026-05-01T00:15:00.000Z", 100.9, reverseProjectId)],
      normalizedReadings: [normalized("earlier-reverse", "sha-earlier", "2026-05-01T00:15:00.000Z", 100.9, reverseProjectId)],
      intervalFacts: [fact("earlier-reverse", "sha-earlier", "2026-05-01T00:00:00.000Z", "2026-05-01T00:15:00.000Z", 0.9, reverseProjectId)],
    });
    const reverseMaterialized = await writeEnergyFactMaterialization({
      ...base,
      projectId: reverseProjectId,
      importBatchId: "later-reverse",
      sourceSha256: "sha-later",
      rawReadings: [
        raw("later-reverse", "sha-later", "2026-05-01T00:15:00.000Z", 101, reverseProjectId),
        raw("later-reverse", "sha-later", "2026-05-01T00:30:00.000Z", 102, reverseProjectId),
      ],
      normalizedReadings: [
        normalized("later-reverse", "sha-later", "2026-05-01T00:15:00.000Z", 101, reverseProjectId),
        normalized("later-reverse", "sha-later", "2026-05-01T00:30:00.000Z", 102, reverseProjectId),
      ],
      intervalFacts: [
        fact("later-reverse", "sha-later", "2026-05-01T00:00:00.000Z", "2026-05-01T00:15:00.000Z", 1, reverseProjectId),
        fact("later-reverse", "sha-later", "2026-05-01T00:15:00.000Z", "2026-05-01T00:30:00.000Z", 1, reverseProjectId),
      ],
    });
    expect(reverseMaterialized.projectAudit).toEqual(materialized.projectAudit);
    await expect(readEnergyFactMaterializationStats({ databasePath, importBatchId: "later-reverse" }))
      .resolves.toMatchObject({ normalizedRows: 2, intervalFacts: 2 });
    await expect(readEnergyFactMaterializationStats({ databasePath, importBatchId: "earlier-reverse" }))
      .resolves.toMatchObject({ normalizedRows: 0, intervalFacts: 0 });

    const replayed = await writeEnergyFactMaterialization({
      ...base,
      importBatchId: "earlier",
      sourceSha256: "sha-earlier",
      rawReadings: [
        raw("earlier", "sha-earlier", "2026-05-01T00:15:00.000Z", 101),
      ],
      normalizedReadings: [
        normalized("earlier", "sha-earlier", "2026-05-01T00:15:00.000Z", 101),
      ],
      intervalFacts: [
        fact("earlier", "sha-earlier", "2026-05-01T00:00:00.000Z", "2026-05-01T00:15:00.000Z", 1),
      ],
    });
    expect(replayed.projectAudit.rawOverlapConflictCount).toBe(0);
    await expect(readEnergyFactMaterializationStats({ databasePath, importBatchId: "later" }))
      .resolves.toMatchObject({ normalizedRows: 2, intervalFacts: 2 });
    await expect(readEnergyFactMaterializationStats({ databasePath, importBatchId: "earlier" }))
      .resolves.toMatchObject({ normalizedRows: 0, intervalFacts: 0 });
  });
});
