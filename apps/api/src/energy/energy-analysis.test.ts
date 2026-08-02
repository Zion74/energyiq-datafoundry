import { LocalDataGateway } from "@datafoundry/data-gateway";
import { createMetadataStore, type EnergyIqRuleRevisionRecord } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { evaluateEnergyAttention, executeEnergyScopeAnalysis } from "./energy-analysis.js";
import { ensureEnergyIqBootstrap, PRESCHOOL_WORKSPACE_ID } from "./energy-bootstrap.js";
import { resolveEnergyQueryContext } from "./energy-query-context.js";

describe("EnergyScopeAnalysis", () => {
  it("calculates reproducible Preschool portfolio and circuit drill-down facts", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-analysis-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      const user = metadata.users.getById({ user_id: "dev-user" });
      const context = resolveEnergyQueryContext({
        metadataStore: metadata,
        user,
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        request: {
          projectId: "preschool-demo",
          scopeId: "preschool-project",
          resource: "electricity",
          period: "Custom",
          from: "2026-05-01",
          to: "2026-05-31"
        }
      });
      const portfolio = await executeEnergyScopeAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        context,
        databasePath: resolve(`storage/energy/${PRESCHOOL_WORKSPACE_ID}/energy.duckdb`)
      });

      expect(portfolio.summary.usageKwh).toBe(24_921.8123);
      expect(portfolio.summary.averageDailyUsageKwh).toBe(803.9294);
      expect(portfolio.summary.nonOperatingSharePct).toBe(12.45);
      expect(portfolio.hourlyProfile).toHaveLength(24);
      expect(portfolio.childScopes).toHaveLength(30);
      expect(portfolio.circuits).toHaveLength(270);
      expect(portfolio.childScopes.every((child) => child.usageKwh > 0)).toBe(true);
      expect(portfolio.childScopes.reduce((sum, child) => sum + child.usageKwh, 0))
        .toBe(portfolio.summary.usageKwh);
      expect(portfolio.provenance).toMatchObject({
        dataSnapshotId: "preschool-26b85b9c0b95e090",
        hierarchyRevisionId: "preschool-hierarchy-v4",
        meterFormulaRevisionId: "preschool-meter-formula-v2",
        aggregationRule: "component"
      });
      expect(portfolio.provenance.ruleRevisionIds).toContain("time.high_off_hours_share@1");
      expect(portfolio.attention.some((item) => item.code === "NON_OPERATING_SHARE")).toBe(true);

      const centreContext = resolveEnergyQueryContext({
        metadataStore: metadata,
        user,
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        request: {
          projectId: "preschool-demo",
          scopeId: "preschool-centre-a",
          resource: "electricity",
          period: "Custom",
          from: "2026-05-01",
          to: "2026-05-31"
        }
      });
      const centre = await executeEnergyScopeAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        context: centreContext,
        databasePath: resolve(`storage/energy/${PRESCHOOL_WORKSPACE_ID}/energy.duckdb`)
      });
      expect(centre.summary.usageKwh).toBe(843.0985);
      expect(centre.circuits).toHaveLength(9);
      expect(centre.childScopes).toHaveLength(9);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("preserves the Ngee Ann golden totals after removing the legacy Block Test wrapper", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-analysis-ngee-ann-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      const user = metadata.users.getById({ user_id: "dev-user" });
      const context = resolveEnergyQueryContext({
        metadataStore: metadata,
        user,
        workspaceId: "default",
        request: {
          projectId: "ngee-ann-polytechnic",
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: "2026-05-19",
          to: "2026-06-17"
        }
      });
      const analysis = await executeEnergyScopeAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        context,
        databasePath: resolve("storage/energy/default/energy.duckdb")
      });

      expect(analysis.summary.usageKwh).toBe(5_328.2073);
      expect(analysis.summary.averageDailyUsageKwh).toBe(177.6069);
      expect(analysis.summary.peakKw).toBe(22.5009);
      expect(analysis.summary.qualityEventCount).toBe(0);
      expect(analysis.childScopes).toMatchObject([
        { nodeId: "level-7", usageKwh: 3_314.2365 },
        { nodeId: "level-6", usageKwh: 2_013.9707 }
      ]);
      expect(analysis.circuits).toHaveLength(18);
      expect(analysis.provenance).toMatchObject({
        hierarchyRevisionId: "ngee-ann-hierarchy-v2",
        aggregationRule: "designated_total"
      });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("evaluates only supplied rule revisions and takes thresholds from the registry", () => {
    const attention = evaluateEnergyAttention({
      summary: {
        usageKwh: 100,
        averageDailyUsageKwh: 100,
        costSgd: 0,
        peakKw: 5,
        nonOperatingKwh: 50,
        nonOperatingSharePct: 50,
        validIntervalCount: 96,
        qualityEventCount: 0,
      },
      childScopes: [
        { nodeId: "a", name: "A", nodeType: "room", usageKwh: 30, sharePct: 30, occupantCount: 10, kwhPerPerson: 3 },
        { nodeId: "b", name: "B", nodeType: "room", usageKwh: 10, sharePct: 10, occupantCount: 10, kwhPerPerson: 1 },
        { nodeId: "c", name: "C", nodeType: "room", usageKwh: 10, sharePct: 10, occupantCount: 10, kwhPerPerson: 1 },
      ],
      circuits: [],
      ruleRevisions: [ruleRevision({
        revision_id: "comparison.people_intensity_outlier@7",
        evaluation_key: "PEOPLE_NORMALISED_OUTLIER",
        parameters: { minimum_peers: 3, median_ratio: 2.5 },
      })],
    });

    expect(attention.map((item) => item.code)).toEqual(["PEOPLE_NORMALISED_OUTLIER"]);
    expect(attention[0]?.evidence).toContain("3.00 kWh/person");
  });
});

const ruleRevision = (override: Partial<EnergyIqRuleRevisionRecord>): EnergyIqRuleRevisionRecord => ({
  revision_id: "rule@1",
  rule_id: "rule",
  version: 1,
  display_name: "Rule",
  description: "Rule",
  family: "comparison",
  severity: "warning",
  evaluation_key: "RULE",
  metric_revision_ids: [],
  parameters: {},
  requirement: "always",
  created_at: "2026-08-02T00:00:00.000Z",
  ...override,
});
