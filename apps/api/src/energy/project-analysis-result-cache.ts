export type ProjectAnalysisResultCache<T> = {
  resolve: (
    key: string,
    compute: () => Promise<T>,
    options?: { bypass?: boolean },
  ) => Promise<T>;
};

export type ProjectAnalysisCacheIdentity = {
  userId: string;
  workspaceId: string;
  projectId: string;
  scopeId: string;
  resource: string;
  analysisWindow: string | null;
  period: string;
  timezone: string;
  from: string;
  to: string;
  dataSnapshotId: string;
  projectReleaseId: string;
  hierarchyRevisionId: string;
  meterMappingRevisionId: string;
  meterFormulaRevisionId: string;
  metricVersion: string;
  businessCalendarVersion: string;
  tariffScheduleVersion: string;
  rendererKey: string;
  rendererVersion: string;
  rendererContractVersion: string;
  recipeId: string;
  recipeVersion: string;
  metricRevisionIds: readonly string[];
  ruleRevisionIds: readonly string[];
  databasePath: string | null;
};

export const createProjectAnalysisCacheKey = (
  identity: ProjectAnalysisCacheIdentity,
): string => JSON.stringify({
  contract: "project-analysis-result-cache@1",
  userId: identity.userId,
  workspaceId: identity.workspaceId,
  projectId: identity.projectId,
  scopeId: identity.scopeId,
  resource: identity.resource,
  analysisWindow: identity.analysisWindow,
  period: identity.period,
  timezone: identity.timezone,
  from: identity.from,
  to: identity.to,
  dataSnapshotId: identity.dataSnapshotId,
  projectReleaseId: identity.projectReleaseId,
  hierarchyRevisionId: identity.hierarchyRevisionId,
  meterMappingRevisionId: identity.meterMappingRevisionId,
  meterFormulaRevisionId: identity.meterFormulaRevisionId,
  metricVersion: identity.metricVersion,
  businessCalendarVersion: identity.businessCalendarVersion,
  tariffScheduleVersion: identity.tariffScheduleVersion,
  rendererKey: identity.rendererKey,
  rendererVersion: identity.rendererVersion,
  rendererContractVersion: identity.rendererContractVersion,
  recipeId: identity.recipeId,
  recipeVersion: identity.recipeVersion,
  metricRevisionIds: [...identity.metricRevisionIds].sort((left, right) => left.localeCompare(right)),
  ruleRevisionIds: [...identity.ruleRevisionIds].sort((left, right) => left.localeCompare(right)),
  databasePath: identity.databasePath,
});

export const createProjectAnalysisResultCache = <T>(input: {
  capacity: number;
  ttlMs: number;
  now?: () => number;
}): ProjectAnalysisResultCache<T> => {
  const results = new Map<string, { value: T; expiresAt: number }>();
  const inFlight = new Map<string, { generation: number; promise: Promise<T> }>();
  const generations = new Map<string, number>();
  const now = input.now ?? Date.now;
  const capacity = Math.max(1, Math.floor(input.capacity));

  return {
    async resolve(key, compute, options = {}) {
      let generation = generations.get(key) ?? 0;
      if (options.bypass) {
        generation += 1;
        generations.set(key, generation);
        results.delete(key);
      } else {
        const cached = results.get(key);
        if (cached && cached.expiresAt > now()) {
          results.delete(key);
          results.set(key, cached);
          return cached.value;
        }
        if (cached) results.delete(key);
      }
      const current = inFlight.get(key);
      if (current?.generation === generation) return current.promise;

      const pending = compute().then((value) => {
        if ((generations.get(key) ?? 0) !== generation) return value;
        const protectedValue = deepFreeze(value);
        const currentTime = now();
        for (const [resultKey, result] of results) {
          if (result.expiresAt <= currentTime) results.delete(resultKey);
        }
        results.delete(key);
        while (results.size >= capacity) {
          const leastRecentlyUsedKey = results.keys().next().value;
          if (leastRecentlyUsedKey === undefined) break;
          results.delete(leastRecentlyUsedKey);
        }
        results.set(key, { value: protectedValue, expiresAt: currentTime + input.ttlMs });
        return protectedValue;
      }).finally(() => {
        if (inFlight.get(key)?.promise === pending) inFlight.delete(key);
      });
      inFlight.set(key, { generation, promise: pending });
      return pending;
    },
  };
};

const deepFreeze = <T>(value: T): T => {
  if (value === null || typeof value !== "object") return value;
  const seen = new WeakSet<object>();
  const visit = (candidate: object): void => {
    if (seen.has(candidate)) return;
    seen.add(candidate);
    for (const property of Reflect.ownKeys(candidate)) {
      const nested = (candidate as Record<PropertyKey, unknown>)[property];
      if (nested !== null && typeof nested === "object") visit(nested);
    }
    Object.freeze(candidate);
  };
  visit(value);
  return value;
};
