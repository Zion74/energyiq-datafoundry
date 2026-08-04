import { describe, expect, it } from "vitest";

import {
  ENERGY_FACT_WRITER_CONTRACT_VERSION,
  readEnergyFactMaterializationStats,
  readEnergyFactProjectState,
  writeEnergyFactMaterialization,
} from "./energy-fact-writer.js";

describe("writeEnergyFactMaterialization", () => {
  it("canonicalizes only the prepared manifest sources and commits their Project fact state", async () => {
    const databasePath = ":memory:";
    const projectId = "project-manifest-scope";
    const sourceC = boundaryBatch({
      databasePath,
      projectId,
      importBatchId: "batch-c",
      sourceSha256: "sha-c",
      readings: [
        ["2026-05-01T01:00:00.000Z", 500],
        ["2026-05-01T01:15:00.000Z", 501],
      ],
    });
    const sourceA = boundaryBatch({
      databasePath,
      projectId,
      importBatchId: "batch-a",
      sourceSha256: "sha-a",
      readings: [
        ["2026-05-01T00:00:00.000Z", 100],
        ["2026-05-01T00:15:00.000Z", 101],
      ],
    });
    const sourceB = boundaryBatch({
      databasePath,
      projectId,
      importBatchId: "batch-b",
      sourceSha256: "sha-b",
      readings: [
        ["2026-05-01T00:30:00.000Z", 102],
        ["2026-05-01T00:45:00.000Z", 103],
      ],
    });

    await writeEnergyFactMaterialization(withFactScope(sourceC, "snapshot-c", ["sha-c"]));
    await writeEnergyFactMaterialization(withFactScope(sourceA, "snapshot-a", ["sha-a"]));
    const result = await writeEnergyFactMaterialization(withFactScope(sourceB, "snapshot-ab", ["sha-a", "sha-b"]));

    expect(result.projectAudit.intervalFactCount).toBe(3);
    await expect(readEnergyFactProjectState({ databasePath, projectId })).resolves.toEqual({
      workspaceId: "workspace-1",
      projectId,
      dataSnapshotId: "snapshot-ab",
      manifestFingerprint: "fingerprint-snapshot-ab",
      sourceSha256: ["sha-a", "sha-b"],
      factWriterContractVersion: ENERGY_FACT_WRITER_CONTRACT_VERSION,
    });
  });

  it("restores the manifest winner after an off-manifest source previously replaced it", async () => {
    const databasePath = ":memory:";
    const projectId = "project-manifest-winner-restore";
    const sourceA = boundaryBatch({
      databasePath,
      projectId,
      importBatchId: "restore-a",
      sourceSha256: "restore-sha-a",
      readings: [
        ["2026-05-01T00:00:00.000Z", 100],
        ["2026-05-01T00:15:00.000Z", 101],
        ["2026-05-01T00:30:00.000Z", 102],
      ],
    });
    const sourceB = boundaryBatch({
      databasePath,
      projectId,
      importBatchId: "restore-b",
      sourceSha256: "restore-sha-b",
      readings: [
        ["2026-05-01T00:15:00.000Z", 100.9],
        ["2026-05-01T00:30:00.000Z", 101.9],
        ["2026-05-01T00:45:00.000Z", 102.9],
      ],
    });
    const sourceC = boundaryBatch({
      databasePath,
      projectId,
      importBatchId: "restore-c",
      sourceSha256: "restore-sha-c",
      readings: [
        ["2026-05-01T00:15:00.000Z", 100.8],
        ["2026-05-01T00:30:00.000Z", 101.8],
        ["2026-05-01T00:45:00.000Z", 102.8],
        ["2026-05-01T01:00:00.000Z", 103.8],
      ],
    });

    await writeEnergyFactMaterialization(withFactScope(sourceA, "snapshot-a", ["restore-sha-a"]));
    const original = await writeEnergyFactMaterialization(withFactScope(
      sourceB,
      "snapshot-ab",
      ["restore-sha-a", "restore-sha-b"],
    ));
    await writeEnergyFactMaterialization(withFactScope(
      sourceC,
      "snapshot-abc",
      ["restore-sha-a", "restore-sha-b", "restore-sha-c"],
    ));
    const restored = await writeEnergyFactMaterialization(withFactScope(
      sourceA,
      "snapshot-ab-restored",
      ["restore-sha-a", "restore-sha-b"],
    ));

    expect(restored.projectAudit).toEqual(original.projectAudit);
  });

  it("rebuilds the interval that crosses adjacent canonical batch boundaries", async () => {
    const databasePath = ":memory:";
    const projectId = "project-cross-batch-boundary";

    const earlier = boundaryBatch({
      databasePath,
      projectId,
      importBatchId: "batch-a",
      sourceSha256: "sha-a",
      readings: [
        ["2026-05-01T00:00:00.000Z", 100],
        ["2026-05-01T00:15:00.000Z", 101],
      ],
    });
    const later = boundaryBatch({
      databasePath,
      projectId,
      importBatchId: "batch-b",
      sourceSha256: "sha-b",
      readings: [
        ["2026-05-01T00:30:00.000Z", 102],
        ["2026-05-01T00:45:00.000Z", 103],
      ],
    });
    await writeEnergyFactMaterialization(earlier);
    const result = await writeEnergyFactMaterialization(withFactScope(later, "snapshot-ab", ["sha-a", "sha-b"]));

    expect(result.projectAudit).toMatchObject({
      normalizedReadingCount: 4,
      intervalFactCount: 3,
      invalidIntervalDurationCount: 0,
      negativeDeltaIntervalCount: 0,
      canonicalMeterSeriesCount: 1,
      adjacentReadingPairCount: 3,
      missingAdjacentIntervalCount: 0,
      orphanIntervalFactCount: 0,
    });
    await expect(writeEnergyFactMaterialization(withFactScope(earlier, "snapshot-ab", ["sha-a", "sha-b"]))).resolves.toMatchObject({
      projectAudit: result.projectAudit,
    });

    const reverseProjectId = "project-cross-batch-boundary-reverse";
    await writeEnergyFactMaterialization(withProjectId(later, reverseProjectId));
    const reverse = await writeEnergyFactMaterialization(withFactScope(
      withProjectId(earlier, reverseProjectId),
      "snapshot-reverse-ab",
      ["sha-a", "sha-b"],
    ));
    expect(reverse.projectAudit).toEqual(result.projectAudit);
  });

  it("keeps project-wide gaps and resets as non-ok canonical facts", async () => {
    const databasePath = ":memory:";
    const projectId = "project-cross-batch-quality";
    await writeEnergyFactMaterialization(boundaryBatch({
      databasePath,
      projectId,
      importBatchId: "quality-a",
      sourceSha256: "quality-sha-a",
      readings: [
        ["2026-05-01T00:00:00.000Z", 100],
        ["2026-05-01T00:15:00.000Z", 101],
      ],
    }));
    const result = await writeEnergyFactMaterialization(withFactScope(boundaryBatch({
      databasePath,
      projectId,
      importBatchId: "quality-b",
      sourceSha256: "quality-sha-b",
      readings: [
        ["2026-05-01T00:45:00.000Z", 102],
        ["2026-05-01T01:00:00.000Z", 90],
        ["2026-05-01T01:15:00.000Z", 91],
      ],
    }), "snapshot-quality-ab", ["quality-sha-a", "quality-sha-b"]));

    expect(result.projectAudit).toMatchObject({
      normalizedReadingCount: 5,
      intervalFactCount: 4,
      invalidIntervalDurationCount: 1,
      negativeDeltaIntervalCount: 1,
      canonicalMeterSeriesCount: 1,
      adjacentReadingPairCount: 4,
      missingAdjacentIntervalCount: 0,
      orphanIntervalFactCount: 0,
    });
    await expect(readEnergyFactMaterializationStats({ databasePath, importBatchId: "quality-a" }))
      .resolves.toMatchObject({ intervalFacts: 1, qualityEvents: 1 });
    await expect(readEnergyFactMaterializationStats({ databasePath, importBatchId: "quality-b" }))
      .resolves.toMatchObject({ intervalFacts: 3, qualityEvents: 2 });
  });

  it("rebuilds from the later-coverage canonical winner at overlapping cumulative timestamps", async () => {
    const databasePath = ":memory:";
    const projectId = "project-cumulative-overlap";
    const earlier = boundaryBatch({
      databasePath,
      projectId,
      importBatchId: "cumulative-earlier",
      sourceSha256: "cumulative-sha-earlier",
      readings: [
        ["2026-05-01T00:00:00.000Z", 100],
        ["2026-05-01T00:15:00.000Z", 101],
        ["2026-05-01T00:30:00.000Z", 102],
      ],
    });
    const later = boundaryBatch({
      databasePath,
      projectId,
      importBatchId: "cumulative-later",
      sourceSha256: "cumulative-sha-later",
      readings: [
        ["2026-05-01T00:15:00.000Z", 100.9],
        ["2026-05-01T00:30:00.000Z", 101.9],
        ["2026-05-01T00:45:00.000Z", 102.9],
      ],
    });
    await writeEnergyFactMaterialization(later);
    const result = await writeEnergyFactMaterialization(withFactScope(
      earlier,
      "snapshot-cumulative-ab",
      ["cumulative-sha-earlier", "cumulative-sha-later"],
    ));

    expect(result.projectAudit).toMatchObject({
      normalizedReadingCount: 4,
      intervalFactCount: 3,
      adjacentReadingPairCount: 3,
      missingAdjacentIntervalCount: 0,
      orphanIntervalFactCount: 0,
    });
    await expect(readEnergyFactMaterializationStats({ databasePath, importBatchId: "cumulative-later" }))
      .resolves.toMatchObject({ normalizedRows: 3, intervalFacts: 3 });
    await expect(readEnergyFactMaterializationStats({ databasePath, importBatchId: "cumulative-earlier" }))
      .resolves.toMatchObject({ normalizedRows: 1, intervalFacts: 0 });

    const forwardProjectId = "project-cumulative-overlap-forward";
    await writeEnergyFactMaterialization(withProjectId(earlier, forwardProjectId));
    const forward = await writeEnergyFactMaterialization(withFactScope(
      withProjectId(later, forwardProjectId),
      "snapshot-cumulative-forward-ab",
      ["cumulative-sha-earlier", "cumulative-sha-later"],
    ));
    expect(forward.projectAudit).toEqual(result.projectAudit);
  });

  it("writes a batch idempotently into the canonical fact tables", async () => {
    const input = {
      databasePath: ":memory:",
      projectId: "project-1",
      importBatchId: "batch-1",
      sourceSha256: "sha-1",
      timezone: "Asia/Singapore",
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
        sourceReadingKind: "interval_usage" as const,
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
        sourceReadingKind: "interval_usage" as const,
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
        sourceReadingKind: "interval_usage" as const,
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
        sourceReadingKind: "interval_usage" as const,
      }],
      snapshotFactScope: testFactScope("project-1", "snapshot-1", ["sha-1"]),
    };

    await writeEnergyFactMaterialization(input);
    await writeEnergyFactMaterialization(input);
    await expect(readEnergyFactMaterializationStats({
      databasePath: ":memory:",
      importBatchId: "batch-1",
    })).resolves.toEqual({ rawRows: 1, normalizedRows: 1, intervalFacts: 1, qualityEvents: 1 });
    const legacyProjectId = "project-legacy";
    await expect(writeEnergyFactMaterialization({
      ...input,
      projectId: legacyProjectId,
      importBatchId: "",
      sourceSha256: "",
      snapshotFactScope: testFactScope(legacyProjectId, "snapshot-legacy", [""]),
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
    })).rejects.toThrow("ENERGYIQ_SNAPSHOT_FACT_SCOPE_EMPTY");
  });

  it("keeps the source with the later coverage end at an overlapping timestamp", async () => {
    const databasePath = ":memory:";
    const base = {
      databasePath,
      projectId: "project-overlap",
      timezone: "Asia/Singapore",
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
      sourceReadingKind: "interval_usage" as const,
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
      sourceReadingKind: "interval_usage" as const,
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
      sourceReadingKind: "interval_usage" as const,
    });

    await writeEnergyFactMaterialization({
      ...base,
      importBatchId: "later",
      sourceSha256: "sha-later",
      snapshotFactScope: testFactScope("project-overlap", "snapshot-later", ["sha-later"]),
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
      snapshotFactScope: testFactScope("project-overlap", "snapshot-overlap", ["sha-earlier", "sha-later"]),
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
      canonicalMeterSeriesCount: 0,
      adjacentReadingPairCount: 0,
      missingAdjacentIntervalCount: 0,
      orphanIntervalFactCount: 0,
    });

    const reverseProjectId = "project-overlap-reverse";
    await writeEnergyFactMaterialization({
      ...base,
      projectId: reverseProjectId,
      importBatchId: "earlier-reverse",
      sourceSha256: "sha-earlier",
      snapshotFactScope: testFactScope(reverseProjectId, "snapshot-earlier-reverse", ["sha-earlier"]),
      rawReadings: [raw("earlier-reverse", "sha-earlier", "2026-05-01T00:15:00.000Z", 100.9, reverseProjectId)],
      normalizedReadings: [normalized("earlier-reverse", "sha-earlier", "2026-05-01T00:15:00.000Z", 100.9, reverseProjectId)],
      intervalFacts: [fact("earlier-reverse", "sha-earlier", "2026-05-01T00:00:00.000Z", "2026-05-01T00:15:00.000Z", 0.9, reverseProjectId)],
    });
    const reverseMaterialized = await writeEnergyFactMaterialization({
      ...base,
      projectId: reverseProjectId,
      importBatchId: "later-reverse",
      sourceSha256: "sha-later",
      snapshotFactScope: testFactScope(reverseProjectId, "snapshot-overlap-reverse", ["sha-earlier", "sha-later"]),
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
      snapshotFactScope: testFactScope("project-overlap", "snapshot-overlap-replay", ["sha-earlier", "sha-later"]),
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

const boundaryBatch = (input: {
  databasePath: string;
  projectId: string;
  importBatchId: string;
  sourceSha256: string;
  readings: Array<[time: string, value: number]>;
}) => ({
  databasePath: input.databasePath,
  projectId: input.projectId,
  importBatchId: input.importBatchId,
  sourceSha256: input.sourceSha256,
  timezone: "Asia/Singapore",
  rawReadings: [],
  normalizedReadings: input.readings.map(([eventTime, activeEnergyKwh], index) => ({
    workspaceId: "workspace-1",
    projectId: input.projectId,
    importBatchId: input.importBatchId,
    resource: "electricity" as const,
    meterPointId: "meter-a",
    scopeId: "scope-a",
    sourceLabel: "Meter A",
    category: "load",
    meterRole: "total",
    eventTime,
    activeEnergyKwh,
    sourceFile: `${input.importBatchId}.xlsx`,
    sourceSha256: input.sourceSha256,
    sourceRowNumber: index + 2,
    sourceReadingKind: "cumulative_energy" as const,
  })),
  intervalFacts: input.readings.slice(1).map(([intervalEnd, activeEnergyKwh], index) => {
    const [intervalStart, previousActiveEnergyKwh] = input.readings[index]!;
    const rawDeltaKwh = activeEnergyKwh - previousActiveEnergyKwh;
    return {
      workspaceId: "workspace-1",
      projectId: input.projectId,
      importBatchId: input.importBatchId,
      resource: "electricity" as const,
      meterPointId: "meter-a",
      scopeId: "scope-a",
      sourceLabel: "Meter A",
      category: "load",
      meterRole: "total",
      intervalStart,
      intervalEnd,
      elapsedMinutes: 15,
      activeEnergyKwh,
      previousActiveEnergyKwh,
      rawDeltaKwh,
      usageKwh: rawDeltaKwh,
      averageKw: rawDeltaKwh * 4,
      qualityStatus: rawDeltaKwh < 0 ? "negative_delta" : "ok",
      localDate: "2026-05-01",
      localHour: 8,
      dayType: "weekday",
      sourceFile: `${input.importBatchId}.xlsx`,
      sourceSha256: input.sourceSha256,
      sourceReadingKind: "cumulative_energy" as const,
    };
  }),
  qualityEvents: [],
  snapshotFactScope: testFactScope(input.projectId, `snapshot-${input.importBatchId}`, [input.sourceSha256]),
});

const withProjectId = (
  input: ReturnType<typeof boundaryBatch>,
  projectId: string,
): ReturnType<typeof boundaryBatch> => ({
  ...input,
  projectId,
  snapshotFactScope: testFactScope(projectId, input.snapshotFactScope.dataSnapshotId, input.snapshotFactScope.sourceSha256),
  rawReadings: [],
  normalizedReadings: input.normalizedReadings.map((row) => ({ ...row, projectId })),
  intervalFacts: input.intervalFacts.map((row) => ({ ...row, projectId })),
  qualityEvents: [],
});

const withFactScope = (
  input: ReturnType<typeof boundaryBatch>,
  dataSnapshotId: string,
  sourceSha256: string[],
) => ({
  ...input,
  snapshotFactScope: testFactScope(input.projectId, dataSnapshotId, sourceSha256),
});

const testFactScope = (projectId: string, dataSnapshotId: string, sourceSha256: string[]) => ({
  workspaceId: "workspace-1",
  projectId,
  dataSnapshotId,
  manifestFingerprint: `fingerprint-${dataSnapshotId}`,
  sourceSha256,
});
