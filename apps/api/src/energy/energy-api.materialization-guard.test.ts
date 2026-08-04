import { LocalDataGateway } from "@datafoundry/data-gateway";
import { createEnergyIqSourceManifest, createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import type { ConfigApiContext } from "../routes/types.js";
import {
  ensureEnergyIqBootstrap,
  NGEE_ANN_WORKSPACE_ID,
} from "./energy-bootstrap.js";
import { handleEnergyApiRequest } from "./energy-api.js";

describe("Energy import materialization guard", () => {
  it("returns 409 without reading the workbook or mutating the batch when saved Mapping is incomplete", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-materialization-guard-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    let workbookReadCount = 0;
    try {
      ensureEnergyIqBootstrap(metadata);
      const projectId = "ngee-ann-polytechnic";
      const sourceSha256 = ["a".repeat(64), "b".repeat(64)];
      for (const [index, label] of ["Meter A", "Meter B"].entries()) {
        metadata.energyIq.createImportBatch({
          id: `batch-${index + 1}`,
          workspace_id: NGEE_ANN_WORKSPACE_ID,
          project_id: projectId,
          source_kind: "excel",
          source_sha256: sourceSha256[index]!,
          filename: `batch-${index + 1}.xlsx`,
          status: "inspected",
          inspection: { sourceLabels: [{ label, rowCount: 10 }] },
          created_by: "dev-user",
        });
      }

      const draft = metadata.energyIq.projectSetup.getDraft({
        project_id: projectId,
        user_id: "dev-user",
      });
      metadata.energyIq.projectSetup.saveDraft({
        project_id: projectId,
        expected_revision: draft.revision,
        user_id: "dev-user",
        document: {
          ...draft.document,
          source_manifest: createEnergyIqSourceManifest(sourceSha256, true),
          meter_mapping: {
            source_kind: "excel",
            confirmed: true,
            rows: [{
              id: "mapping-meter-a",
              source_label: "Meter A",
              scope_id: "level-6",
              display_name: "Meter A",
              resource: "electricity",
              category: "load",
              coverage: "whole",
              meter_role: "total",
              aggregation_usage: "official",
            }],
          },
        },
      });
      const batchesBefore = [
        metadata.energyIq.getImportBatch("batch-1"),
        metadata.energyIq.getImportBatch("batch-2"),
      ];

      const response = await handleEnergyApiRequest(
        request("POST"),
        ["projects", projectId, "imports", "batch-1", "materialize"],
        {
          metadataStore: metadata,
          dataGateway: gateway,
          fileAssetService: {
            readRef: () => {
              workbookReadCount += 1;
              throw new Error("WORKBOOK_MUST_NOT_BE_READ");
            },
          },
          userId: "dev-user",
          workspaceId: NGEE_ANN_WORKSPACE_ID,
        } as unknown as Required<ConfigApiContext>,
      );

      expect(response).toMatchObject({
        status: 409,
        body: {
          success: false,
          error: {
            code: "CONFLICT",
            message: "ENERGYIQ_IMPORT_MATERIALIZATION_NOT_READY:SOURCE_LABEL_UNMAPPED",
          },
        },
      });
      expect(workbookReadCount).toBe(0);
      expect([
        metadata.energyIq.getImportBatch("batch-1"),
        metadata.energyIq.getImportBatch("batch-2"),
      ]).toEqual(batchesBefore);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

const request = (method: "POST"): IncomingMessage => {
  const stream = new PassThrough();
  Object.assign(stream, {
    method,
    headers: { "content-type": "application/json" },
  });
  stream.end();
  return stream as unknown as IncomingMessage;
};
