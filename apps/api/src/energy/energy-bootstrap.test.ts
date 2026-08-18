import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ensureEnergyIqBootstrap,
} from "./energy-bootstrap.js";

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
});
