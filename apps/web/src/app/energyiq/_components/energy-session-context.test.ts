import { describe, expect, it } from "vitest";

import type { EnergyQueryContextDto, SessionEnergyContextDto } from "../../../lib/config-api";
import {
  decideEnergySessionContextRestore,
  energySessionContextStatus,
  restoredEnergySessionHref,
} from "./energy-session-context";

const historical: SessionEnergyContextDto = {
  sourceRunId: "run-1",
  workspaceId: "workspace-ngee-ann",
  projectId: "ngee-ann-polytechnic",
  projectName: "Ngee Ann Polytechnic",
  scopeId: "project",
  scopeName: "Ngee Ann Polytechnic",
  scopeType: "project",
  resource: "electricity",
  timezone: "Asia/Singapore",
  from: "2026-06-02T16:00:00.000Z",
  to: "2026-06-09T16:00:00.000Z",
  dataSnapshotId: "snapshot-a",
};

describe("restoredEnergySessionHref", () => {
  it("restores the historical local inclusive window after workspace navigation reset it", () => {
    expect(restoredEnergySessionHref(
      "/energyiq/ai",
      new URLSearchParams("scopeId=project&resource=electricity"),
      historical,
    )).toBe(
      "/energyiq/ai?scopeId=project&resource=electricity&projectId=ngee-ann-polytechnic&period=Custom&from=2026-06-03&to=2026-06-09",
    );
  });

  it("does not navigate when the URL already represents the historical context", () => {
    expect(restoredEnergySessionHref(
      "/energyiq/ai",
      new URLSearchParams("projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&period=Custom&from=2026-06-03&to=2026-06-09"),
      historical,
    )).toBeNull();
  });
});

describe("decideEnergySessionContextRestore", () => {
  it("preserves an explicit requested window on the initial conversation restore", () => {
    const decision = decideEnergySessionContextRestore({
      pathname: "/energyiq/ai",
      currentSearchParams: new URLSearchParams(
        "projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&period=Custom&from=2026-05-20&to=2026-06-16",
      ),
      context: historical,
      initialRestoredContextKey: null,
    });

    expect(decision.href).toBeNull();
    expect(decision.initialRestoredContextKey).toBeTruthy();
  });

  it("still restores a different historical context after the initial session", () => {
    const initial = decideEnergySessionContextRestore({
      pathname: "/energyiq/ai",
      currentSearchParams: new URLSearchParams(
        "projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&period=Custom&from=2026-05-20&to=2026-06-16",
      ),
      context: historical,
      initialRestoredContextKey: null,
    });
    const other = {
      ...historical,
      from: "2026-07-01T16:00:00.000Z",
      to: "2026-07-08T16:00:00.000Z",
      dataSnapshotId: "snapshot-b",
    };

    expect(decideEnergySessionContextRestore({
      pathname: "/energyiq/ai",
      currentSearchParams: new URLSearchParams(
        "projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&period=Custom&from=2026-05-20&to=2026-06-16",
      ),
      context: other,
      initialRestoredContextKey: initial.initialRestoredContextKey,
    }).href).toBe(
      "/energyiq/ai?projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&period=Custom&from=2026-07-02&to=2026-07-08",
    );
  });
});

describe("energySessionContextStatus", () => {
  it("marks historical answers outdated when the authorized Snapshot changed", () => {
    expect(energySessionContextStatus(historical, resolved("snapshot-b"))).toEqual({
      status: "outdated",
      reason: "This answer used an older data Snapshot. Its figures are preserved, but current data has changed.",
    });
  });

  it("keeps historical answers current when the restored authorized context is identical", () => {
    expect(energySessionContextStatus(historical, resolved("snapshot-a"))).toEqual({
      status: "current",
    });
  });
});

function resolved(dataSnapshotId: string): EnergyQueryContextDto {
  return {
    userId: "user-1",
    workspaceId: historical.workspaceId,
    projectId: historical.projectId,
    projectName: historical.projectName,
    scopeId: historical.scopeId,
    scopeName: historical.scopeName,
    scopeType: historical.scopeType,
    resource: historical.resource,
    timezone: historical.timezone,
    from: historical.from,
    to: historical.to,
    endExclusive: true,
    period: "Custom",
    hierarchyRevisionId: "hierarchy-1",
    meterMappingRevisionId: "mapping-1",
    meterFormulaRevisionId: "formula-1",
    dataSnapshotId,
    metricVersion: "metric-1",
    businessCalendarVersion: "calendar-1",
    tariffScheduleVersion: "tariff-1",
    resolvedAt: "2026-08-07T00:00:00.000Z",
  };
}
