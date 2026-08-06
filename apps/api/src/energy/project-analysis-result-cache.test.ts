import { describe, expect, it } from "vitest";

import {
  createProjectAnalysisCacheKey,
  createProjectAnalysisResultCache,
  type ProjectAnalysisCacheIdentity,
} from "./project-analysis-result-cache.js";

describe("ProjectAnalysisResultCache", () => {
  it("shares same-key in-flight work and reuses its successful result", async () => {
    const cache = createProjectAnalysisResultCache<string>({
      capacity: 6,
      ttlMs: 120_000,
    });
    let executions = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const compute = async () => {
      executions += 1;
      await gate;
      return "ready-result";
    };

    const first = cache.resolve("same-authorized-identity", compute);
    const concurrent = cache.resolve("same-authorized-identity", compute);
    expect(executions).toBe(1);

    release();
    await expect(Promise.all([first, concurrent])).resolves.toEqual([
      "ready-result",
      "ready-result",
    ]);
    await expect(cache.resolve("same-authorized-identity", compute))
      .resolves.toBe("ready-result");
    expect(executions).toBe(1);
  });

  it("does not retain rejected work", async () => {
    const cache = createProjectAnalysisResultCache<string>({
      capacity: 6,
      ttlMs: 120_000,
    });
    let executions = 0;

    await expect(cache.resolve("failing-identity", async () => {
      executions += 1;
      throw new Error("resolver failed");
    })).rejects.toThrow("resolver failed");

    await expect(cache.resolve("failing-identity", async () => {
      executions += 1;
      return "recovered";
    })).resolves.toBe("recovered");
    expect(executions).toBe(2);
  });

  it("evicts the least-recently-used success when capacity is reached", async () => {
    const cache = createProjectAnalysisResultCache<string>({
      capacity: 2,
      ttlMs: 120_000,
    });
    const executions = new Map<string, number>();
    const compute = (key: string) => async () => {
      executions.set(key, (executions.get(key) ?? 0) + 1);
      return `${key}-result`;
    };

    await cache.resolve("a", compute("a"));
    await cache.resolve("b", compute("b"));
    await cache.resolve("a", compute("a"));
    await cache.resolve("c", compute("c"));
    await cache.resolve("b", compute("b"));

    expect(executions.get("a")).toBe(1);
    expect(executions.get("b")).toBe(2);
    expect(executions.get("c")).toBe(1);
  });

  it("recomputes a successful result after its short TTL expires", async () => {
    let currentTime = 1_000;
    const cache = createProjectAnalysisResultCache<string>({
      capacity: 6,
      ttlMs: 120_000,
      now: () => currentTime,
    });
    let executions = 0;
    const compute = async () => {
      executions += 1;
      return `result-${executions}`;
    };

    await expect(cache.resolve("expiring-identity", compute)).resolves.toBe("result-1");
    currentTime += 119_999;
    await expect(cache.resolve("expiring-identity", compute)).resolves.toBe("result-1");
    currentTime += 1;
    await expect(cache.resolve("expiring-identity", compute)).resolves.toBe("result-2");
    expect(executions).toBe(2);
  });

  it("starts a fresh generation on bypass and never lets the old in-flight result refill the cache", async () => {
    const cache = createProjectAnalysisResultCache<string>({
      capacity: 6,
      ttlMs: 120_000,
    });
    let executions = 0;
    let releaseOld!: () => void;
    let releaseRefresh!: () => void;
    const oldGate = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const old = cache.resolve("same-identity", async () => {
      executions += 1;
      await oldGate;
      return "old-result";
    });
    const refresh = cache.resolve("same-identity", async () => {
      executions += 1;
      await refreshGate;
      return "refreshed-result";
    }, { bypass: true });
    expect(executions).toBe(2);

    releaseOld();
    await expect(old).resolves.toBe("old-result");
    const afterOldCompleted = cache.resolve("same-identity", async () => {
      executions += 1;
      return "unexpected-third-result";
    });
    releaseRefresh();
    await expect(Promise.all([refresh, afterOldCompleted])).resolves.toEqual([
      "refreshed-result",
      "refreshed-result",
    ]);
    await expect(cache.resolve("same-identity", async () => "unexpected-fourth-result"))
      .resolves.toBe("refreshed-result");
    expect(executions).toBe(2);
  });

  it("protects a retained success from nested mutation poisoning", async () => {
    const cache = createProjectAnalysisResultCache<{ snapshot: { usageKwh: number } }>({
      capacity: 6,
      ttlMs: 120_000,
    });
    const retained = await cache.resolve("immutable-identity", async () => ({
      snapshot: { usageKwh: 42 },
    }));

    expect(Object.isFrozen(retained)).toBe(true);
    expect(Object.isFrozen(retained.snapshot)).toBe(true);
    expect(() => {
      retained.snapshot.usageKwh = 99;
    }).toThrow(TypeError);
    await expect(cache.resolve("immutable-identity", async () => ({
      snapshot: { usageKwh: 0 },
    }))).resolves.toEqual({ snapshot: { usageKwh: 42 } });
  });
});

describe("ProjectAnalysisCacheIdentity", () => {
  const identity: ProjectAnalysisCacheIdentity = {
    userId: "user-a",
    workspaceId: "workspace-a",
    projectId: "project-a",
    scopeId: "project",
    resource: "electricity",
    analysisWindow: "current-overview-28d",
    period: "Custom",
    timezone: "Asia/Singapore",
    from: "2026-05-20T00:00:00.000Z",
    to: "2026-06-17T00:00:00.000Z",
    dataSnapshotId: "snapshot-a",
    projectReleaseId: "release-a",
    hierarchyRevisionId: "hierarchy-a",
    meterMappingRevisionId: "mapping-a",
    meterFormulaRevisionId: "formula-a",
    metricVersion: "metric-a",
    businessCalendarVersion: "calendar-a",
    tariffScheduleVersion: "tariff-a",
    rendererKey: "ngee-ann-overview",
    rendererVersion: "1",
    rendererContractVersion: "project-analysis-snapshot@1",
    recipeId: "energy-scope-analysis",
    recipeVersion: "1",
    metricRevisionIds: ["metric-r1"],
    ruleRevisionIds: ["rule-r1"],
    databasePath: "D:/facts/workspace-a.duckdb",
  };
  const changedIdentities: Array<[string, ProjectAnalysisCacheIdentity]> = [
    ["user", { ...identity, userId: "user-b" }],
    ["Workspace", { ...identity, workspaceId: "workspace-b" }],
    ["Project", { ...identity, projectId: "project-b" }],
    ["Scope", { ...identity, scopeId: "level-7" }],
    ["Resource", { ...identity, resource: "water" }],
    ["analysis window", { ...identity, analysisWindow: "latest-complete-7d" }],
    ["Period", { ...identity, period: "Previous month" }],
    ["timezone", { ...identity, timezone: "Asia/Tokyo" }],
    ["window start", { ...identity, from: "2026-05-19T00:00:00.000Z" }],
    ["window end", { ...identity, to: "2026-06-18T00:00:00.000Z" }],
    ["Snapshot", { ...identity, dataSnapshotId: "snapshot-b" }],
    ["Project Release", { ...identity, projectReleaseId: "release-b" }],
    ["Hierarchy", { ...identity, hierarchyRevisionId: "hierarchy-b" }],
    ["Meter Mapping", { ...identity, meterMappingRevisionId: "mapping-b" }],
    ["Meter Formula", { ...identity, meterFormulaRevisionId: "formula-b" }],
    ["Metric version", { ...identity, metricVersion: "metric-b" }],
    ["Calendar", { ...identity, businessCalendarVersion: "calendar-b" }],
    ["Tariff", { ...identity, tariffScheduleVersion: "tariff-b" }],
    ["Renderer", { ...identity, rendererKey: "preschool-overview" }],
    ["Renderer version", { ...identity, rendererVersion: "2" }],
    ["Renderer contract", { ...identity, rendererContractVersion: "project-analysis-snapshot@2" }],
    ["Recipe", { ...identity, recipeId: "energy-scope-analysis-v2" }],
    ["Recipe version", { ...identity, recipeVersion: "2" }],
    ["Metric revisions", { ...identity, metricRevisionIds: ["metric-r2"] }],
    ["Rule revisions", { ...identity, ruleRevisionIds: ["rule-r2"] }],
    ["fact store", { ...identity, databasePath: "D:/facts/workspace-b.duckdb" }],
  ];

  it.each(changedIdentities)("changes when the authoritative %s identity changes", (_name, changed) => {
    expect(createProjectAnalysisCacheKey(changed))
      .not.toBe(createProjectAnalysisCacheKey(identity));
  });
});
