import { describe, expect, it } from "vitest";

import type { ContextPackageSnapshotRecord } from "@datafoundry/metadata";

import { sessionEnergyContextFromSnapshot } from "./session-energy-context.js";

describe("sessionEnergyContextFromSnapshot", () => {
  it("restores the server-authored EnergyIQ context from a historical package", () => {
    const context = sessionEnergyContextFromSnapshot(snapshot({
      sourceType: "evidence-focus",
      trust: "tool",
      metadata: {
        sourceKind: "energy-query-context",
        sourceOwner: "server",
        originalSourceType: "energy-query-context",
      },
      content: [
        "Authoritative EnergyIQ query context.",
        "workspace_id=workspace-ngee-ann",
        "project_id=ngee-ann-polytechnic",
        "project_name=Ngee Ann Polytechnic",
        "scope_id=project",
        "scope_name=Ngee Ann Polytechnic",
        "scope_type=project",
        "resource=electricity",
        "timezone=Asia/Singapore",
        "from=2026-06-02T16:00:00.000Z",
        "to_exclusive=2026-06-09T16:00:00.000Z",
        "data_snapshot_id=snapshot-a",
      ].join("\n"),
    }));

    expect(context).toEqual({
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
    });
  });

  it("prefers structured metadata for newly recorded packages", () => {
    const context = sessionEnergyContextFromSnapshot(snapshot({
      sourceType: "energy-query-context",
      trust: "tool",
      metadata: {
        sourceKind: "energy-query-context",
        sourceOwner: "server",
        energyQueryContext: {
          workspaceId: "workspace-preschool",
          projectId: "preschool-demo",
          projectName: "Preschool Demo",
          scopeId: "preschool-project",
          scopeName: "All centres",
          scopeType: "project",
          resource: "electricity",
          timezone: "Asia/Singapore",
          from: "2026-04-30T16:00:00.000Z",
          to: "2026-05-31T16:00:00.000Z",
          dataSnapshotId: "snapshot-p",
        },
      },
      content: "legacy content is not required",
    }));

    expect(context).toMatchObject({
      sourceRunId: "run-1",
      projectId: "preschool-demo",
      scopeId: "preschool-project",
      dataSnapshotId: "snapshot-p",
    });
  });

  it("does not restore client-authored or untrusted context", () => {
    expect(sessionEnergyContextFromSnapshot(snapshot({
      sourceType: "energy-query-context",
      trust: "untrusted-client",
      metadata: {
        sourceKind: "energy-query-context",
        sourceOwner: "client",
      },
      content: "project_id=ngee-ann-polytechnic",
    }))).toBeUndefined();
  });
});

function snapshot(item: Record<string, unknown>): ContextPackageSnapshotRecord {
  return {
    id: "context-snapshot-1",
    user_id: "user-1",
    session_id: "session-1",
    run_id: "run-1",
    package_id: "package-1",
    revision: 1,
    payload_json: JSON.stringify({ items: [item] }),
    created_at: "2026-08-07T00:00:00.000Z",
  };
}
