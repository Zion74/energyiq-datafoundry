import type {
  EnergyQueryContextDto,
  SessionEnergyContextDto,
} from "../../../lib/config-api";

export type EnergySessionContextStatus =
  | { status: "current" }
  | { status: "outdated"; reason: string };

export type EnergySessionInitialRestoreKey = string | null | false;

export function decideEnergySessionContextRestore(input: {
  pathname: string;
  currentSearchParams: Pick<URLSearchParams, "entries" | "get">;
  context: SessionEnergyContextDto;
  initialRestoredContextKey: EnergySessionInitialRestoreKey;
}): { href: string | null; initialRestoredContextKey: EnergySessionInitialRestoreKey } {
  const contextKey = restoredContextKey(input.context);
  const hasExplicitRequest = Boolean(
    input.currentSearchParams.get("projectId")
    && input.currentSearchParams.get("from")
    && input.currentSearchParams.get("to"),
  );

  if (input.initialRestoredContextKey === null && hasExplicitRequest) {
    return { href: null, initialRestoredContextKey: contextKey };
  }
  if (input.initialRestoredContextKey === contextKey) {
    return { href: null, initialRestoredContextKey: contextKey };
  }
  return {
    href: restoredEnergySessionHref(
      input.pathname,
      input.currentSearchParams,
      input.context,
    ),
    initialRestoredContextKey: false,
  };
}

export function restoredEnergySessionHref(
  pathname: string,
  currentSearchParams: Pick<URLSearchParams, "entries">,
  context: SessionEnergyContextDto,
): string | null {
  const next = new URLSearchParams([...currentSearchParams.entries()]);
  next.set("projectId", context.projectId);
  next.set("scopeId", context.scopeId);
  next.set("resource", context.resource);
  next.set("period", "Custom");
  next.set("from", localDateFromInstant(context.from, context.timezone));
  next.set("to", localDateFromInstant(
    new Date(Date.parse(context.to) - 1).toISOString(),
    context.timezone,
  ));
  for (const staleKey of [
    "currentFrom",
    "currentTo",
    "currentDataSnapshotId",
    "currentProjectReleaseId",
    "finding",
    "evidence",
  ]) {
    next.delete(staleKey);
  }

  const current = new URLSearchParams([...currentSearchParams.entries()]);
  return next.toString() === current.toString()
    ? null
    : `${pathname}?${next.toString()}`;
}

export function energySessionContextStatus(
  historical: SessionEnergyContextDto,
  current: EnergyQueryContextDto,
): EnergySessionContextStatus {
  const sameAuthorizedWindow = historical.workspaceId === current.workspaceId
    && historical.projectId === current.projectId
    && historical.scopeId === current.scopeId
    && historical.resource === current.resource
    && historical.timezone === current.timezone
    && historical.from === current.from
    && historical.to === current.to;
  if (!sameAuthorizedWindow) {
    return {
      status: "outdated",
      reason: "This answer belongs to a different authorized Project, Scope, or reporting window.",
    };
  }
  if (historical.dataSnapshotId !== current.dataSnapshotId) {
    return {
      status: "outdated",
      reason: "This answer used an older data Snapshot. Its figures are preserved, but current data has changed.",
    };
  }
  return { status: "current" };
}

function localDateFromInstant(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(new Date(value));
}

function restoredContextKey(context: SessionEnergyContextDto): string {
  return JSON.stringify([
    context.workspaceId,
    context.projectId,
    context.scopeId,
    context.resource,
    context.from,
    context.to,
    context.dataSnapshotId,
  ]);
}
