import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ensureEnergyIqBootstrap,
} from "./energy-bootstrap.js";
import { resolveEnergyPublishedMeterRoute } from "./energy-query-context.js";

describe("ensureEnergyIqBootstrap", () => {
  it("enables the release-pinned daily anomaly Rule for a new Ngee Ann Project only", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-bootstrap-rules-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);

      expect(metadata.energyIq.rules.getProjectConfig("ngee-ann-polytechnic"))
        .toMatchObject({
          revision: 1,
          selected_rule_revision_ids: expect.arrayContaining([
            "comparison.daily_usage_above_baseline@1",
          ]),
        });
      expect(metadata.energyIq.rules.getProjectConfig("preschool-demo")
        .selected_rule_revision_ids)
        .not.toContain("comparison.daily_usage_above_baseline@1");

      ensureEnergyIqBootstrap(metadata);
      expect(metadata.energyIq.rules.getProjectConfig("ngee-ann-polytechnic").revision).toBe(1);

      const configured = metadata.energyIq.rules.getProjectConfig("ngee-ann-polytechnic");
      metadata.energyIq.rules.saveProjectConfig({
        project_id: "ngee-ann-polytechnic",
        expected_revision: configured.revision,
        selected_rule_revision_ids: configured.selected_rule_revision_ids.filter(
          (id) => id !== "comparison.daily_usage_above_baseline@1",
        ),
        updated_by: "dev-user",
      });
      ensureEnergyIqBootstrap(metadata);
      expect(metadata.energyIq.rules.getProjectConfig("ngee-ann-polytechnic"))
        .toMatchObject({
          revision: 2,
          selected_rule_revision_ids: expect.not.arrayContaining([
            "comparison.daily_usage_above_baseline@1",
          ]),
        });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("attaches immutable Overview Definitions to existing pilot Template Revisions", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-bootstrap-overview-definition-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      for (const projectId of ["ngee-ann-polytechnic", "preschool-demo"] as const) {
        const project = metadata.energyIq.getProject(projectId);
        const revision = metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
          project_id: projectId,
          tier_definition_ids: metadata.energyIq.listTierDefinitions(projectId).map((tier) => tier.id),
          hierarchy_revision_id: project.hierarchy_revision_id,
          meter_mapping_revision_id: resolveEnergyPublishedMeterRoute({
            metadataStore: metadata,
            projectId,
            hierarchyRevisionId: project.hierarchy_revision_id,
            scopeId: project.root_scope_id,
            resource: "electricity",
          }).meterMappingRevisionId,
          published_by: "dev-user",
          published_at: "2026-08-19T00:00:00.000Z",
        });
        expect(metadata.energyIq.overviewDefinitions.get(revision.revision_id)).toBeNull();
      }

      ensureEnergyIqBootstrap(metadata);

      const ngeeRevision = metadata.energyIq.templates.getLatestProjectRevision("ngee-ann-polytechnic");
      const preschoolRevision = metadata.energyIq.templates.getLatestProjectRevision("preschool-demo");
      expect(metadata.energyIq.overviewDefinitions.get(ngeeRevision!.revision_id)).toMatchObject({
        renderer_key: "ngee-ann-overview",
        time_policy_revision_id: "ngee-ann-report-time@1",
        definition: { sections: expect.arrayContaining([expect.objectContaining({ primaryWindowId: "current-month-progress" })]) },
      });
      expect(metadata.energyIq.overviewDefinitions.get(preschoolRevision!.revision_id)).toMatchObject({
        renderer_key: "preschool-overview",
        time_policy_revision_id: "preschool-report-time@1",
        definition: { sections: expect.arrayContaining([expect.objectContaining({ primaryWindowId: "current-overview" })]) },
      });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
