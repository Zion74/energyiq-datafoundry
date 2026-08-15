import type {
  EnergyIqOverviewAiArtifactRecord,
  MetadataStore,
  RunEventRecord,
  RunRecord,
  UserRecord,
} from "@datafoundry/metadata";

export type ProjectAiOperationsState = {
  project: {
    id: string;
    name: string;
    workspaceId: string;
  };
  runs: ProjectAiRunSummary[];
  selectedRun: ProjectAiRunDetail | null;
};

export type ProjectAiRunSummary = {
  runId: string;
  actorId: string;
  sessionId: string;
  status: RunRecord["status"];
  stage: string | null;
  modelProvider: string | null;
  modelName: string | null;
  startedAt: string;
  finishedAt: string | null;
  latencyMs: number | null;
  parentRunId: string | null;
  errorCode: string | null;
  inputTokens: number;
  outputTokens: number;
  toolCounts: {
    called: number;
    succeeded: number;
    rejected: number;
    failed: number;
  };
  traceAvailability: "available" | "partial" | "unavailable";
};

export type ProjectAiRunDetail = ProjectAiRunSummary & {
  historicalConfiguration: {
    status: "available" | "unavailable";
    detail: string;
    modelProfileId: string | null;
    resourceRevisions: Record<string, number>;
    selectedSkills: Array<{ id: string; name: string; revision: number }>;
    selectionAudit: { selected: number; rejected: number; unavailable: number };
    loadedSkills: {
      status: "available" | "unavailable";
      items: Array<{ id: string; revision: number | null }>;
    };
    mcp: {
      enabledServerIds: string[];
      serverToolMapping: {
        status: "available" | "unavailable";
        items: Array<{ serverId: string; toolNames: string[] }>;
      };
    };
  };
  context: {
    status: "available" | "unavailable";
    steps: Array<{
      stepNumber: number;
      packageId: string | null;
      packageRevision: number | null;
      planId: string | null;
      selectedGroupCount: number;
      omittedGroupCount: number;
      selectedSourceTypes: string[];
      omittedSourceTypes: string[];
      truncationDecisionCount: number;
      promptTokens: number | null;
      inputBudget: number | null;
      contextWindow: number | null;
      remainingTokens: number | null;
      capabilitySource: string | null;
      highWaterMark: string | null;
    }>;
  };
  tools: Array<{
    toolCallId: string;
    name: string;
    status: "called" | "succeeded" | "rejected" | "failed";
    startedAt: string | null;
    finishedAt: string | null;
  }>;
  tokens: {
    input: number;
    output: number;
    total: number;
    cache: {
      status: "available" | "unavailable";
      hit: number | null;
      miss: number | null;
    };
  };
  lineage: {
    artifacts: Array<{ id: string; type: string; name: string }>;
    energyIqArtifacts: Array<{
      id: string;
      kind: string;
      targetId: string | null;
      findingIds: string[];
    }>;
  };
};

export type ProjectAiOperationsReader = {
  readProjectAiOperations(
    projectId: string,
    filters?: { runId?: string; limit?: number },
  ): ProjectAiOperationsState;
};

export const createProjectAiOperationsReader = (input: {
  metadataStore: MetadataStore;
  user: UserRecord;
  workspaceId: string;
}): ProjectAiOperationsReader => ({
  readProjectAiOperations(projectId, filters = {}) {
    requireAdmin(input.metadataStore, input.user);
    const project = input.metadataStore.energyIq.getProject(projectId);
    if (project.workspace_id !== input.workspaceId) {
      throw new Error("ENERGYIQ_PROJECT_FORBIDDEN");
    }

    const runs = input.metadataStore.runs.listByProject({
      workspace_id: project.workspace_id,
      project_id: project.id,
      ...(filters.limit !== undefined ? { limit: filters.limit } : {}),
    });
    const energyIqArtifacts = input.metadataStore.energyIq.overviewAiArtifacts.listByProject({
      workspaceId: project.workspace_id,
      projectId: project.id,
    });
    const summaries = runs.map((run) => projectRun(
      input.metadataStore,
      project.workspace_id,
      run,
      energyIqArtifacts,
    ).summary);
    let selectedRun: ProjectAiRunDetail | null = null;
    if (filters.runId) {
      const exactRun = input.metadataStore.runs.findByProject({
        workspace_id: project.workspace_id,
        project_id: project.id,
        run_id: filters.runId,
      });
      if (!exactRun) throw new Error("ENERGYIQ_RUN_FORBIDDEN");
      selectedRun = projectRun(
        input.metadataStore,
        project.workspace_id,
        exactRun,
        energyIqArtifacts,
      ).detail;
    }
    return {
      project: { id: project.id, name: project.name, workspaceId: project.workspace_id },
      runs: summaries,
      selectedRun,
    };
  },
});

const projectRun = (
  metadataStore: MetadataStore,
  workspaceId: string,
  run: RunRecord,
  energyIqArtifacts: EnergyIqOverviewAiArtifactRecord[],
): { summary: ProjectAiRunSummary; detail: ProjectAiRunDetail } => {
  const eventRecords = metadataStore.runEvents.listByRun({ user_id: run.user_id, run_id: run.id });
  const events = eventRecords.map((record) => ({ record, value: parseRecord(record.payload_json) }));
  const configEvent = findLastCustom(events, "run.config.resolved");
  const configExact = configEvent !== undefined
    && stringValue(configEvent.value.workspace_id) === workspaceId;
  const stage = configExact ? nullableStringValue(configEvent.value.overview_ai_stage) : null;
  const tokens = tokenSummary(events);
  const tools = toolSummary(events);
  const context = contextSummary(events);
  const historicalConfiguration = configSummary(events, configExact ? configEvent?.value : undefined);
  const artifacts = metadataStore.artifacts.listByRun({ user_id: run.user_id, run_id: run.id })
    .map((artifact) => ({ id: artifact.id, type: artifact.type, name: artifact.name }));
  const traceParts = [configExact, context.status === "available", events.length > 0];
  const traceAvailability = traceParts.every(Boolean)
    ? "available" as const
    : traceParts.some(Boolean)
      ? "partial" as const
      : "unavailable" as const;
  const summary: ProjectAiRunSummary = {
    runId: run.id,
    actorId: run.user_id,
    sessionId: run.session_id,
    status: run.status,
    stage,
    modelProvider: run.model_provider ?? null,
    modelName: run.model_name ?? null,
    startedAt: run.started_at,
    finishedAt: run.finished_at ?? null,
    latencyMs: elapsedMs(run.started_at, run.finished_at),
    parentRunId: run.parent_run_id ?? null,
    errorCode: safeErrorCode(run),
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    toolCounts: {
      called: tools.length,
      succeeded: tools.filter(({ status }) => status === "succeeded").length,
      rejected: tools.filter(({ status }) => status === "rejected").length,
      failed: tools.filter(({ status }) => status === "failed").length,
    },
    traceAvailability,
  };
  return {
    summary,
    detail: {
      ...summary,
      historicalConfiguration,
      context,
      tools,
      tokens,
      lineage: { artifacts, energyIqArtifacts: energyIqLineage(run.id, energyIqArtifacts) },
    },
  };
};

const energyIqLineage = (
  runId: string,
  artifacts: EnergyIqOverviewAiArtifactRecord[],
): ProjectAiRunDetail["lineage"]["energyIqArtifacts"] => artifacts.flatMap((artifact) => {
  const result = parseResult(artifact.result_json);
  const referencedRunIds = new Set([
    ...(artifact.run_id ? [artifact.run_id] : []),
    ...collectStringFields(result, "runId"),
  ]);
  if (!referencedRunIds.has(runId)) return [];
  const identity = parseResult(artifact.identity_json);
  return [{
    id: artifact.id,
    kind: isRecord(identity) ? stringValue(identity.artifactKind) || artifact.analysis_pack_id : artifact.analysis_pack_id,
    targetId: isRecord(identity) ? nullableStringValue(identity.targetId) : null,
    findingIds: collectFindingIds(result),
  }];
});

const collectStringFields = (value: unknown, field: string): string[] => {
  if (Array.isArray(value)) return value.flatMap((item) => collectStringFields(item, field));
  if (!isRecord(value)) return [];
  return [
    ...(typeof value[field] === "string" && value[field].trim() ? [value[field].trim()] : []),
    ...Object.values(value).flatMap((item) => collectStringFields(item, field)),
  ];
};

const collectFindingIds = (value: unknown): string[] => [...new Set(collectArraysNamed(value, "findings")
  .flatMap((findings) => arrayRecords(findings).map((finding) => stringValue(finding.id)).filter(Boolean)))]
  .sort((left, right) => left.localeCompare(right));

const collectArraysNamed = (value: unknown, field: string): unknown[] => {
  if (Array.isArray(value)) return value.flatMap((item) => collectArraysNamed(item, field));
  if (!isRecord(value)) return [];
  return [
    ...(Array.isArray(value[field]) ? [value[field]] : []),
    ...Object.values(value).flatMap((item) => collectArraysNamed(item, field)),
  ];
};

type ParsedEvent = { record: RunEventRecord; value: Record<string, unknown> };

const configSummary = (
  events: ParsedEvent[],
  config: Record<string, unknown> | undefined,
): ProjectAiRunDetail["historicalConfiguration"] => {
  if (!config) {
    return {
      status: "unavailable",
      detail: "This Run has no Project-exact run.config.resolved event; current configuration was not substituted.",
      modelProfileId: null,
      resourceRevisions: {},
      selectedSkills: [],
      selectionAudit: { selected: 0, rejected: 0, unavailable: 0 },
      loadedSkills: { status: "unavailable", items: [] },
      mcp: { enabledServerIds: [], serverToolMapping: { status: "unavailable", items: [] } },
    };
  }
  const selection = findLastCustom(events, "skill.selection")?.value;
  const selectedSkills = arrayRecords(selection?.selected).flatMap((skill) => {
    const id = stringValue(skill.id);
    const name = stringValue(skill.name);
    const revision = integerValue(skill.revision);
    return id && name && revision !== undefined ? [{ id, name, revision }] : [];
  });
  const audit = arrayRecords(selection?.audit);
  const auditCount = (decision: string) => audit.filter((item) => stringValue(item.decision) === decision).length;
  const materialized = findLastCustom(events, "skill.materialized")?.value;
  const loadedItems = arrayRecords(materialized?.items).flatMap((item) => {
    const id = stringValue(item.id);
    if (!id) return [];
    return [{ id, revision: integerValue(item.revision) ?? null }];
  });
  const enabledServerIds = stringArray(config.enabled_mcp_server_ids);
  const mapping = mcpMapping(config.mcp_tool_names_by_server_id);
  return {
    status: "available",
    detail: "Historical effective configuration comes only from this Run's persisted events.",
    modelProfileId: nullableStringValue(config.active_llm_profile_id),
    resourceRevisions: numericRecord(config.resource_revisions),
    selectedSkills,
    selectionAudit: {
      selected: auditCount("selected"),
      rejected: auditCount("rejected"),
      unavailable: auditCount("unavailable"),
    },
    loadedSkills: {
      status: materialized ? "available" : "unavailable",
      items: loadedItems,
    },
    mcp: {
      enabledServerIds,
      serverToolMapping: {
        status: mapping || enabledServerIds.length === 0 ? "available" : "unavailable",
        items: mapping ?? [],
      },
    },
  };
};

const contextSummary = (events: ParsedEvent[]): ProjectAiRunDetail["context"] => {
  const verifiedByStep = new Map<number, Record<string, unknown>>();
  events.forEach((event) => {
    if (!isCustom(event.value, "context.prompt-verified") || !isRecord(event.value.value)) return;
    const step = integerValue(event.value.value.step_number) ?? 1;
    verifiedByStep.set(step, event.value.value);
  });
  const compiled = events.flatMap((event, index) => {
    if (!isCustom(event.value, "context.compiled") || !isRecord(event.value.value)) return [];
    const value = event.value.value;
    const stepNumber = integerValue(value.step_number) ?? index + 1;
    const verified = verifiedByStep.get(stepNumber);
    const budget = isRecord(value.budget) ? value.budget : {};
    const report = isRecord(value.token_report) ? value.token_report : {};
    return [{
      stepNumber,
      packageId: nullableStringValue(value.package_id),
      packageRevision: integerValue(value.package_revision) ?? null,
      planId: nullableStringValue(value.plan_id),
      selectedGroupCount: stringArray(value.selected_group_ids).length,
      omittedGroupCount: stringArray(value.omitted_group_ids).length,
      selectedSourceTypes: sourceTypes(value.selected_sources),
      omittedSourceTypes: sourceTypes(value.omitted_sources),
      truncationDecisionCount: arrayRecords(value.decisions).filter((decision) => (
        numberValue(decision.tokenSavings) > 0 || /drop|truncate|omit/iu.test(stringValue(decision.strategyId))
      )).length,
      promptTokens: firstNumber(verified?.prompt_tokens, value.prompt_tokens, report.totalInputTokens),
      inputBudget: firstNumber(verified?.input_budget, verified?.budget_tokens, budget.inputBudget, value.budget_tokens),
      contextWindow: firstNumber(verified?.context_window, budget.contextWindow),
      remainingTokens: firstNumber(verified?.remaining_tokens, value.remaining_tokens, report.remainingTokens),
      capabilitySource: nullableStringValue(verified?.capability_source ?? budget.capabilitySource),
      highWaterMark: nullableStringValue(verified?.high_water_mark ?? value.high_water_mark),
    }];
  });
  return {
    status: compiled.length > 0 ? "available" : "unavailable",
    steps: compiled.sort((left, right) => left.stepNumber - right.stepNumber),
  };
};

const toolSummary = (events: ParsedEvent[]): ProjectAiRunDetail["tools"] => {
  const calls = new Map<string, ProjectAiRunDetail["tools"][number]>();
  events.forEach(({ record, value }) => {
    const type = stringValue(value.type);
    const toolCallId = stringValue(value.toolCallId ?? value.tool_call_id);
    if (!toolCallId) return;
    const name = stringValue(value.toolCallName ?? value.tool_call_name)
      || calls.get(toolCallId)?.name
      || "Unknown Tool";
    if (type === "TOOL_CALL_START") {
      calls.set(toolCallId, {
        toolCallId,
        name,
        status: "called",
        startedAt: record.created_at,
        finishedAt: null,
      });
      return;
    }
    if (type !== "TOOL_CALL_RESULT") return;
    const current = calls.get(toolCallId);
    const result = parseResult(value.content ?? value.result ?? value.value);
    calls.set(toolCallId, {
      toolCallId,
      name,
      status: rejectedResult(result) ? "rejected" : failedResult(result) ? "failed" : "succeeded",
      startedAt: current?.startedAt ?? null,
      finishedAt: record.created_at,
    });
  });
  return [...calls.values()];
};

const tokenSummary = (events: ParsedEvent[]): ProjectAiRunDetail["tokens"] => {
  let input = 0;
  let output = 0;
  let total = 0;
  let hit = 0;
  let miss = 0;
  let cacheAvailable = false;
  events.forEach((event) => {
    if (!isCustom(event.value, "token_usage") || !isRecord(event.value.value)) return;
    const value = event.value.value;
    const eventInput = numberValue(value.input_tokens ?? value.inputTokens);
    const eventOutput = numberValue(value.output_tokens ?? value.outputTokens);
    input += eventInput;
    output += eventOutput;
    total += numberValue(value.total_tokens ?? value.totalTokens) || eventInput + eventOutput;
    const eventHit = optionalNumber(value.cache_hit_tokens);
    const eventMiss = optionalNumber(value.cache_miss_tokens);
    cacheAvailable ||= value.cache_telemetry_available === true || eventHit !== undefined || eventMiss !== undefined;
    hit += eventHit ?? 0;
    miss += eventMiss ?? 0;
  });
  return {
    input,
    output,
    total,
    cache: {
      status: cacheAvailable ? "available" : "unavailable",
      hit: cacheAvailable ? hit : null,
      miss: cacheAvailable ? miss : null,
    },
  };
};

const findLastCustom = (events: ParsedEvent[], name: string): { value: Record<string, unknown> } | undefined => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]?.value;
    if (event && isCustom(event, name) && isRecord(event.value)) return { value: event.value };
  }
  return undefined;
};

const sourceTypes = (value: unknown): string[] => [...new Set(arrayRecords(value)
  .flatMap((entry) => stringArray(entry.source_types)))]
  .sort((left, right) => left.localeCompare(right));

const mcpMapping = (value: unknown): Array<{ serverId: string; toolNames: string[] }> | null => {
  if (!isRecord(value)) return null;
  return Object.entries(value)
    .flatMap(([serverId, names]) => stringArray(names).length > 0
      ? [{ serverId, toolNames: stringArray(names).sort((left, right) => left.localeCompare(right)) }]
      : [{ serverId, toolNames: [] }])
    .sort((left, right) => left.serverId.localeCompare(right.serverId));
};

const numericRecord = (value: unknown): Record<string, number> => {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .flatMap(([key, candidate]) => integerValue(candidate) !== undefined
      ? [[key, integerValue(candidate)!] as const]
      : [])
    .sort(([left], [right]) => left.localeCompare(right)));
};

const parseResult = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value) as unknown; } catch { return value; }
};

const rejectedResult = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  const marker = [value.status, value.code, value.error, value.reason]
    .map(stringValue)
    .join(" ")
    .toLowerCase();
  return /reject|block|denied|forbidden/iu.test(marker);
};

const failedResult = (value: unknown): boolean => isRecord(value)
  && (value.success === false || value.ok === false || value.isError === true || Boolean(stringValue(value.error)));

const safeErrorCode = (run: RunRecord): string | null => {
  if (run.status !== "failed") return null;
  const code = run.error_message?.match(/^[A-Z][A-Z0-9_]{2,80}/u)?.[0];
  return code ?? "RUN_FAILED";
};

const elapsedMs = (startedAt: string, finishedAt: string | undefined): number | null => {
  if (!finishedAt) return null;
  const elapsed = Date.parse(finishedAt) - Date.parse(startedAt);
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
};

const requireAdmin = (metadataStore: MetadataStore, user: UserRecord): void => {
  if (metadataStore.energyIq.findUserRole(user.id)?.role !== "admin") {
    throw new Error("ENERGYIQ_ADMIN_REQUIRED");
  }
};

const parseRecord = (value: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const arrayRecords = (value: unknown): Record<string, unknown>[] => Array.isArray(value)
  ? value.filter(isRecord)
  : [];

const stringArray = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
  : [];

const firstNumber = (...values: unknown[]): number | null => {
  for (const value of values) {
    const number = optionalNumber(value);
    if (number !== undefined) return number;
  }
  return null;
};

const optionalNumber = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value)
  ? value
  : undefined;

const numberValue = (value: unknown): number => optionalNumber(value) ?? 0;

const integerValue = (value: unknown): number | undefined => typeof value === "number" && Number.isSafeInteger(value)
  ? value
  : undefined;

const nullableStringValue = (value: unknown): string | null => {
  const result = stringValue(value);
  return result || null;
};

const stringValue = (value: unknown): string => typeof value === "string" ? value.trim() : "";

const isCustom = (event: Record<string, unknown>, name: string): boolean => (
  stringValue(event.type) === "CUSTOM" && stringValue(event.name) === name
);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);
