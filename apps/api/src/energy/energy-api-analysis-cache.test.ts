import { LocalDataGateway } from "@datafoundry/data-gateway";
import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConfigApiContext } from "../routes/types.js";
import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";

const resolveProjectAnalysis = vi.hoisted(() => vi.fn(async (_input: unknown) => ({
  status: "configuration-required" as const,
})));

vi.mock("./project-analysis-resolver.js", () => ({ resolveProjectAnalysis }));

import { handleEnergyApiRequest } from "./energy-api.js";

describe("Energy analysis resolve cache control", () => {
  afterEach(() => {
    resolveProjectAnalysis.mockClear();
  });

  it("passes refresh bypass separately from the authoritative query request", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-analysis-cache-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const response = await handleEnergyApiRequest(
        jsonPost({
          projectId: "ngee-ann-polytechnic",
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: "2026-06-10",
          to: "2026-06-16",
          bypassCache: true,
        }),
        ["analysis", "resolve"],
        {
          metadataStore: metadata,
          dataGateway: new LocalDataGateway(metadata),
          userId: "dev-user",
          workspaceId: "default",
        } as Required<ConfigApiContext>,
      );

      expect(response.status).toBe(200);
      expect(resolveProjectAnalysis).toHaveBeenCalledTimes(1);
      const resolverInput = resolveProjectAnalysis.mock.calls[0]?.[0];
      expect(resolverInput).toMatchObject({
        bypassCache: true,
        request: {
          projectId: "ngee-ann-polytechnic",
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: "2026-06-10",
          to: "2026-06-16",
        },
      });
      expect((resolverInput as { request: unknown }).request).not.toHaveProperty("bypassCache");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

const jsonPost = (body: unknown): IncomingMessage => {
  const request = new PassThrough() as PassThrough & IncomingMessage;
  request.method = "POST";
  request.headers = { "content-type": "application/json" };
  request.end(JSON.stringify(body));
  return request;
};
