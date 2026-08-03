import type {
  EnergyIqProjectRecord,
  EnergyIqRole,
  MetadataStore,
  UserRecord,
  WorkspaceRecord
} from "@datafoundry/metadata";

export type EnergyResource = "electricity" | "water";
export type EnergyPeriod = "Yesterday" | "Last 7 days" | "Last 30 days" | "Custom";

export type EnergyAccessContext = {
  role: EnergyIqRole;
  user: {
    id: string;
    email?: string;
    displayName?: string;
  };
  activeWorkspaceId: string;
  workspaces: Array<{
    id: string;
    name: string;
    kind: WorkspaceRecord["kind"];
    disabled: boolean;
  }>;
  projects: Array<{
    id: string;
    workspaceId: string;
    name: string;
    status: EnergyIqProjectRecord["status"];
    timezone: string;
  }>;
};

export type EnergyQueryContextRequest = {
  projectId: string;
  scopeId?: string;
  resource?: EnergyResource;
  period?: EnergyPeriod;
  from?: string;
  to?: string;
};

export type EnergyQueryContext = {
  userId: string;
  workspaceId: string;
  projectId: string;
  projectName: string;
  scopeId: string;
  scopeName: string;
  scopeType: string;
  resource: EnergyResource;
  timezone: string;
  from: string;
  to: string;
  endExclusive: true;
  period: EnergyPeriod;
  hierarchyRevisionId: string;
  meterFormulaRevisionId: string;
  dataSnapshotId: string;
  metricVersion: string;
  businessCalendarVersion: string;
  tariffScheduleVersion: string;
  resolvedAt: string;
};

export const ensureEnergyIqUserRole = (
  metadataStore: MetadataStore,
  user: UserRecord,
  env: Record<string, string | undefined> = process.env
): EnergyIqRole => {
  const adminEmails = new Set(
    (env.ENERGYIQ_ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
  const allowlisted = user.id === "dev-user"
    || (user.email ? adminEmails.has(user.email.toLowerCase()) : false);
  const existing = metadataStore.energyIq.findUserRole(user.id);
  if (allowlisted && existing?.role !== "admin") {
    return metadataStore.energyIq.upsertUserRole({ user_id: user.id, role: "admin" }).role;
  }
  if (existing) {
    return existing.role;
  }
  return metadataStore.energyIq.upsertUserRole({ user_id: user.id, role: "user" }).role;
};

export const resolveEnergyAccessContext = (input: {
  metadataStore: MetadataStore;
  user: UserRecord;
  requestedWorkspaceId?: string;
  env?: Record<string, string | undefined>;
}): EnergyAccessContext => {
  const role = ensureEnergyIqUserRole(input.metadataStore, input.user, input.env);
  const workspaces = (
    role === "admin"
      ? input.metadataStore.workspaces.list()
      : input.metadataStore.workspaces.listByUser({ user_id: input.user.id })
  ).filter((workspace) => workspace.kind === "customer" && (role === "admin" || !workspace.disabled_at));
  if (workspaces.length === 0) {
    return {
      role,
      user: {
        id: input.user.id,
        ...(input.user.email ? { email: input.user.email } : {}),
        ...(input.user.display_name ? { displayName: input.user.display_name } : {})
      },
      activeWorkspaceId: "",
      workspaces: [],
      projects: []
    };
  }
  const activeWorkspace = input.requestedWorkspaceId
    ? workspaces.find((workspace) => workspace.id === input.requestedWorkspaceId)
    : workspaces[0];
  if (!activeWorkspace) {
    throw new Error("ENERGYIQ_WORKSPACE_FORBIDDEN");
  }
  const projects = input.metadataStore.energyIq.listVisibleProjects({
    user_id: input.user.id,
    workspace_id: activeWorkspace.id,
    is_admin: role === "admin"
  });
  return {
    role,
    user: {
      id: input.user.id,
      ...(input.user.email ? { email: input.user.email } : {}),
      ...(input.user.display_name ? { displayName: input.user.display_name } : {})
    },
    activeWorkspaceId: activeWorkspace.id,
    workspaces: workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      kind: workspace.kind,
      disabled: Boolean(workspace.disabled_at)
    })),
    projects: projects.map((project) => ({
      id: project.id,
      workspaceId: project.workspace_id,
      name: project.name,
      status: project.status,
      timezone: project.timezone
    }))
  };
};

export const resolveEnergyQueryContext = (input: {
  metadataStore: MetadataStore;
  user: UserRecord;
  workspaceId: string;
  request: EnergyQueryContextRequest;
  now?: Date;
  env?: Record<string, string | undefined>;
}): EnergyQueryContext => {
  const access = resolveEnergyAccessContext({
    metadataStore: input.metadataStore,
    user: input.user,
    requestedWorkspaceId: input.workspaceId,
    ...(input.env ? { env: input.env } : {})
  });
  const project = access.projects.find((candidate) => candidate.id === input.request.projectId);
  if (!project || project.workspaceId !== access.activeWorkspaceId) {
    throw new Error("ENERGYIQ_PROJECT_FORBIDDEN");
  }
  if (project.status !== "published" && access.role !== "admin") {
    throw new Error("ENERGYIQ_PROJECT_FORBIDDEN");
  }
  const projectRecord = input.metadataStore.energyIq.getProject(project.id);
  const nodes = input.metadataStore.energyIq.listProjectNodes(project.id);
  const root = nodes.find((node) =>
    node.id === projectRecord.root_scope_id && !node.parent_id
  );
  if (!root) {
    throw new Error("ENERGYIQ_PROJECT_ROOT_REQUIRED");
  }
  const requestedScopeId = input.request.scopeId;
  const scope = !requestedScopeId || requestedScopeId === "project"
    ? root
    : nodes.find((node) => node.id === requestedScopeId);
  if (!scope) {
    throw new Error("ENERGYIQ_SCOPE_FORBIDDEN");
  }
  const period = input.request.period ?? "Last 30 days";
  const range = resolvePeriodRange({
    period,
    timezone: projectRecord.timezone,
    ...(input.request.from ? { from: input.request.from } : {}),
    ...(input.request.to ? { to: input.request.to } : {}),
    now: input.now ?? new Date()
  });
  return {
    userId: input.user.id,
    workspaceId: access.activeWorkspaceId,
    projectId: projectRecord.id,
    projectName: projectRecord.name,
    scopeId: scope.id,
    scopeName: scope.name,
    scopeType: scope.node_type,
    resource: input.request.resource ?? "electricity",
    timezone: projectRecord.timezone,
    from: range.from,
    to: range.to,
    endExclusive: true,
    period,
    hierarchyRevisionId: projectRecord.hierarchy_revision_id,
    meterFormulaRevisionId: projectRecord.meter_formula_revision_id,
    dataSnapshotId: projectRecord.data_snapshot_id,
    metricVersion: projectRecord.metric_version,
    businessCalendarVersion: projectRecord.business_calendar_version,
    tariffScheduleVersion: projectRecord.tariff_schedule_version,
    resolvedAt: (input.now ?? new Date()).toISOString()
  };
};

export const resolveEnergyScopeMeterNodeIds = (
  metadataStore: MetadataStore,
  projectId: string,
  scopeId: string
): string[] => {
  const nodes = metadataStore.energyIq.listProjectNodes(projectId);
  const byParent = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parent_id) continue;
    const children = byParent.get(node.parent_id) ?? [];
    children.push(node.id);
    byParent.set(node.parent_id, children);
  }
  const included = new Set<string>();
  const pending = [scopeId];
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (!nodeId || included.has(nodeId)) continue;
    included.add(nodeId);
    pending.push(...(byParent.get(nodeId) ?? []));
  }
  return nodes
    .filter((node) => included.has(node.id))
    .map((node) => node.id);
};

const resolvePeriodRange = (input: {
  period: EnergyPeriod;
  timezone: string;
  from?: string;
  to?: string;
  now: Date;
}): { from: string; to: string } => {
  if (input.period === "Custom") {
    if (!input.from || !input.to) {
      throw new Error("ENERGYIQ_CUSTOM_RANGE_REQUIRED");
    }
    const from = parseRangeBoundary(input.from, input.timezone, false);
    const to = parseRangeBoundary(input.to, input.timezone, true);
    if (Date.parse(from) >= Date.parse(to)) {
      throw new Error("ENERGYIQ_INVALID_RANGE");
    }
    return { from, to };
  }
  const today = localDate(input.now, input.timezone);
  const endDate = today;
  const days = input.period === "Yesterday" ? 1 : input.period === "Last 7 days" ? 7 : 30;
  return {
    from: zonedStartOfDay(shiftDate(endDate, -days), input.timezone),
    to: zonedStartOfDay(endDate, input.timezone)
  };
};

const parseRangeBoundary = (
  value: string,
  timezone: string,
  inclusiveDateEnd: boolean
): string => {
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return zonedStartOfDay(inclusiveDateEnd ? shiftDate(value, 1) : value, timezone);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error("ENERGYIQ_INVALID_RANGE");
  }
  return new Date(timestamp).toISOString();
};

const localDate = (date: Date, timezone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

const shiftDate = (date: string, days: number): string => {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
};

const zonedStartOfDay = (date: string, timezone: string): string => {
  const [year, month, day] = date.split("-").map(Number);
  const targetUtc = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1);
  let candidate = targetUtc;
  for (let index = 0; index < 3; index += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date(candidate));
    const get = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((part) => part.type === type)?.value ?? 0);
    const observedAsUtc = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second")
    );
    candidate += targetUtc - observedAsUtc;
  }
  return new Date(candidate).toISOString();
};
