import { describe, expect, it } from "vitest";

import { EnergyQuerySemanticProvider } from "./energy-query-semantic-provider.js";

describe("EnergyQuerySemanticProvider", () => {
  it("marks a server-scoped canonical fact view as authoritative live context", async () => {
    const provider = new EnergyQuerySemanticProvider({
      projectId: "ngee-ann-polytechnic",
      projectName: "Ngee Ann Polytechnic",
      scopeId: "l7-load-4",
      scopeName: "Office Load 4 Fan ISOL 1/2",
      scopeType: "circuit",
      resource: "electricity",
      timezone: "Asia/Singapore",
      from: "2026-06-02T16:00:00.000Z",
      to: "2026-06-09T16:00:00.000Z",
      endExclusive: true,
      period: "Custom",
      dataSnapshotId: "snapshot-1",
      metricVersion: "energy-fact-v1"
    });

    const result = await provider.resolve({
      userId: "dev-user",
      workspaceId: "default",
      datasourceId: "scoped-view",
      datasourceRevision: "4",
      query: "total consumption",
      physicalSchema: { tables: [{ name: "energy_fact" }] }
    });

    expect(result).toMatchObject({
      provider: "energyiq",
      mode: "live",
      trust: "authoritative",
      warnings: [],
      snapshotId: "snapshot-1",
      datasourceRevision: "4",
      capabilities: ["physical-schema", "energy-query-context", "canonical-energy-fact"]
    });
  });
});
