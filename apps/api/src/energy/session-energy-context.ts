import type { ContextPackageSnapshotRecord } from "@datafoundry/metadata";

export type SessionEnergyContextDto = {
  sourceRunId: string;
  workspaceId: string;
  projectId: string;
  projectName: string;
  scopeId: string;
  scopeName: string;
  scopeType: string;
  resource: "electricity" | "water";
  timezone: string;
  from: string;
  to: string;
  dataSnapshotId: string;
};

export const sessionEnergyContextFromSnapshot = (
  snapshot: ContextPackageSnapshotRecord,
): SessionEnergyContextDto | undefined => {
  const payload = parseRecord(snapshot.payload_json);
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const item = items.find(isAuthoritativeEnergyContextItem);
  if (!item) return undefined;

  const metadata = recordValue(item.metadata);
  const structured = recordValue(metadata?.energyQueryContext);
  const values = structured ?? keyValueLines(item.content);
  if (!values) return undefined;

  const workspaceId = boundedString(values, "workspaceId", "workspace_id");
  const projectId = boundedString(values, "projectId", "project_id");
  const projectName = boundedString(values, "projectName", "project_name");
  const scopeId = boundedString(values, "scopeId", "scope_id");
  const scopeName = boundedString(values, "scopeName", "scope_name");
  const scopeType = boundedString(values, "scopeType", "scope_type");
  const resource = boundedString(values, "resource");
  const timezone = boundedString(values, "timezone");
  const from = boundedString(values, "from");
  const to = boundedString(values, "to", "to_exclusive");
  const dataSnapshotId = boundedString(values, "dataSnapshotId", "data_snapshot_id");

  if (
    !workspaceId
    || !projectId
    || !projectName
    || !scopeId
    || !scopeName
    || !scopeType
    || (resource !== "electricity" && resource !== "water")
    || !timezone
    || !validWindow(from, to)
    || !dataSnapshotId
  ) {
    return undefined;
  }

  return {
    sourceRunId: snapshot.run_id,
    workspaceId,
    projectId,
    projectName,
    scopeId,
    scopeName,
    scopeType,
    resource,
    timezone,
    from: from!,
    to: to!,
    dataSnapshotId,
  };
};

const isAuthoritativeEnergyContextItem = (
  value: unknown,
): value is Record<string, unknown> => {
  const item = recordValue(value);
  const metadata = recordValue(item?.metadata);
  const supportedProjection = item?.sourceType === "energy-query-context"
    || (
      item?.sourceType === "evidence-focus"
      && metadata?.originalSourceType === "energy-query-context"
    );
  return supportedProjection
    && item.trust === "tool"
    && metadata?.sourceKind === "energy-query-context"
    && metadata.sourceOwner === "server";
};

const keyValueLines = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value !== "string") return undefined;
  const entries: Array<[string, string]> = [];
  for (const line of value.split(/\r?\n/u)) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    entries.push([line.slice(0, separator).trim(), line.slice(separator + 1).trim()]);
  }
  return Object.fromEntries(entries);
};

const boundedString = (
  value: Record<string, unknown>,
  ...keys: string[]
): string | undefined => {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.length > 0 && candidate.length <= 500) {
      return candidate;
    }
  }
  return undefined;
};

const validWindow = (from: string | undefined, to: string | undefined): boolean => {
  const fromTime = from ? Date.parse(from) : Number.NaN;
  const toTime = to ? Date.parse(to) : Number.NaN;
  return Number.isFinite(fromTime) && Number.isFinite(toTime) && toTime > fromTime;
};

const parseRecord = (value: string): Record<string, unknown> | undefined => {
  try {
    return recordValue(JSON.parse(value));
  } catch {
    return undefined;
  }
};

const recordValue = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
