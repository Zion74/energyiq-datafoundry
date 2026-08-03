import { LocalDataGateway } from "@datafoundry/data-gateway";
import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConfigApiContext } from "../routes/types.js";
import {
  ensureEnergyIqBootstrap,
  PRESCHOOL_WORKSPACE_ID,
} from "./energy-bootstrap.js";
import { handleEnergyApiRequest } from "./energy-api.js";
import { materializePreschoolGoldenFixture } from "./preschool-golden.fixture.js";

describe("saved analysis decision-quality boundary", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("rejects low-coverage creation and rerun before either result is persisted", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-saved-analysis-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      await materializePreschoolGoldenFixture(databasePath);
      vi.stubEnv("ENERGYIQ_DUCKDB_PATH", databasePath);
      ensureEnergyIqBootstrap(metadata);
      const project = metadata.energyIq.getProject("preschool-demo");
      const templateRevision = metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
        project_id: project.id,
        tier_definition_ids: metadata.energyIq.listTierDefinitions(project.id).map((tier) => tier.id),
        hierarchy_revision_id: project.hierarchy_revision_id,
        published_by: "dev-user",
        published_at: "2026-08-04T00:00:00.000Z",
      });
      const query = {
        projectId: project.id,
        scopeId: "project",
        resource: "electricity",
        period: "Custom",
        from: "2026-05-01",
        to: "2026-05-31",
      } as const;
      const previous = metadata.energyIq.savedAnalyses.create({
        id: "saved-analysis-low-coverage-seed",
        series_id: "saved-analysis-low-coverage-series",
        project_id: project.id,
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        scope_id: "preschool-project",
        scope_name: "Preschool Portfolio",
        resource: "electricity",
        title: "Seed only",
        query_json: JSON.stringify(query),
        analysis_json: JSON.stringify({ dataHealth: { coveragePct: 3.2258 } }),
        template_revision_id: templateRevision.revision_id,
        data_snapshot_id: project.data_snapshot_id,
        created_by: "dev-user",
      });
      const context = {
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        workspaceId: PRESCHOOL_WORKSPACE_ID,
      } as Required<ConfigApiContext>;

      const creation = await handleEnergyApiRequest(
        jsonPost(query),
        ["projects", project.id, "saved-analyses"],
        context,
      );
      const rerun = await handleEnergyApiRequest(
        jsonPost({}),
        ["projects", project.id, "saved-analyses", previous.id, "rerun"],
        context,
      );

      for (const response of [creation, rerun]) {
        expect(response).toMatchObject({
          status: 400,
          body: {
            success: false,
            error: {
              code: "BAD_REQUEST",
              message: "ENERGYIQ_DECISION_COVERAGE_REQUIRED",
            },
          },
        });
      }
      expect(metadata.energyIq.savedAnalyses.listProject(project.id).map((item) => item.id))
        .toEqual([previous.id]);
    } finally {
      metadata.close();
      removeTemporaryFixture(root);
    }
  }, 30_000);
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

const removeTemporaryFixture = (root: string): void => {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    if (
      process.platform === "win32"
      && error instanceof Error
      && "code" in error
      && (error.code === "EPERM" || error.code === "EBUSY")
    ) {
      return;
    }
    throw error;
  }
};
