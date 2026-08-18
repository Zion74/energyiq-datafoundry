import { LocalDataGateway } from "@datafoundry/data-gateway";
import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import type { ConfigApiContext } from "../routes/types.js";
import {
  ensureEnergyIqBootstrap,
  NGEE_ANN_DAILY_ANOMALY_RULE_REVISION_ID,
  NGEE_ANN_WORKSPACE_ID,
} from "./energy-bootstrap.js";
import { handleEnergyApiRequest } from "./energy-api.js";

describe("Energy Project Release readiness", () => {
  it("rejects a Ngee Ann publication that omits the required daily anomaly Rule Revision", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-release-readiness-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const current = metadata.energyIq.rules.getProjectConfig("ngee-ann-polytechnic");
      const withoutDailyAnomaly = metadata.energyIq.rules.saveProjectConfig({
        project_id: "ngee-ann-polytechnic",
        expected_revision: current.revision,
        selected_rule_revision_ids: current.selected_rule_revision_ids.filter(
          (id) => id !== NGEE_ANN_DAILY_ANOMALY_RULE_REVISION_ID,
        ),
        updated_by: "dev-user",
      });

      const response = await handleEnergyApiRequest(
        jsonPost({
          expectedRevision: 0,
          expectedTemplateDraftRevision: 0,
          expectedMetricConfigRevision: 0,
          expectedRuleConfigRevision: withoutDailyAnomaly.revision,
        }),
        ["projects", "ngee-ann-polytechnic", "setup", "publish"],
        {
          metadataStore: metadata,
          dataGateway: new LocalDataGateway(metadata),
          userId: "dev-user",
          workspaceId: NGEE_ANN_WORKSPACE_ID,
        } as Required<ConfigApiContext>,
      );

      expect(response).toMatchObject({
        status: 409,
        body: {
          success: false,
          error: {
            code: "CONFLICT",
            message: `ENERGYIQ_OVERVIEW_RULE_REQUIRED:${NGEE_ANN_DAILY_ANOMALY_RULE_REVISION_ID}`,
          },
        },
      });
      expect(metadata.energyIq.templates.getLatestProjectRevision("ngee-ann-polytechnic"))
        .toBeNull();
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

const jsonPost = (body: unknown): IncomingMessage => {
  const request = new PassThrough();
  Object.assign(request, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  request.end(JSON.stringify(body));
  return request as unknown as IncomingMessage;
};
