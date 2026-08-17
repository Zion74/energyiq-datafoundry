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
  NGEE_ANN_WORKSPACE_ID,
} from "./energy-bootstrap.js";
import { handleEnergyApiRequest } from "./energy-api.js";

describe("EnergyIQ operational policy Admin interface", () => {
  it("publishes immutable pending Tariff and Calendar revisions without changing the current release", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-operational-policy-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      const projectId = "ngee-ann-polytechnic";
      const context = {
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        workspaceId: NGEE_ANN_WORKSPACE_ID,
      } as Required<ConfigApiContext>;

      const initial = await handleEnergyApiRequest(
        request("GET"),
        ["projects", projectId, "operational-policies"],
        context,
      );
      expect(initial, JSON.stringify(initial)).toMatchObject({
        status: 200,
        body: {
          success: true,
          data: {
            projectId,
            timezone: "Asia/Singapore",
            published: {
              tariff_schedule_version: "sg-tariff-v1",
              business_calendar_version: "sg-calendar-v1",
            },
            pending: {
              tariff_schedule_version: "sg-tariff-v1",
              business_calendar_version: "sg-calendar-v1",
            },
            tariffRevisions: [],
            operatingCalendarRevisions: [],
          },
        },
      });

      const tariffResponse = await handleEnergyApiRequest(
        request("POST", {
          entries: [{
            owner: { kind: "project" },
            effectiveFrom: "2026-07-01T00:00:00+08:00",
            currency: "SGD",
            ratePerKwh: 0.28,
          }],
        }),
        ["projects", projectId, "operational-policies", "tariff"],
        context,
      );
      expect(tariffResponse).toMatchObject({
        status: 201,
        body: {
          success: true,
          data: {
            revision: {
              project_id: projectId,
              entries: [{ currency: "SGD", rate_per_kwh: 0.28 }],
            },
          },
        },
      });
      const tariffVersion = requireVersionId(tariffResponse, "revision");

      const calendarResponse = await handleEnergyApiRequest(
        request("POST", {
          entries: [{
            owner: { kind: "scope", scopeId: "level-6" },
            effectiveFrom: "2026-07-01",
            weekly: {
              monday: [{ from: "08:00", to: "18:00" }],
              tuesday: [{ from: "08:00", to: "18:00" }],
              wednesday: [{ from: "08:00", to: "18:00" }],
              thursday: [{ from: "08:00", to: "18:00" }],
              friday: [{ from: "08:00", to: "18:00" }],
              saturday: [],
              sunday: [],
            },
            exceptions: [{
              date: "2026-08-10",
              operating: [],
              label: "National Day observed",
              classification: "public_holiday",
            }],
          }],
        }),
        ["projects", projectId, "operational-policies", "calendar"],
        context,
      );
      expect(calendarResponse).toMatchObject({
        status: 201,
        body: {
          success: true,
          data: {
            revision: {
              project_id: projectId,
              timezone: "Asia/Singapore",
              entries: [{
                owner: { kind: "scope", scope_id: "level-6" },
                exceptions: [{
                  date: "2026-08-10",
                  label: "National Day observed",
                  classification: "public_holiday",
                }],
              }],
            },
          },
        },
      });
      const calendarVersion = requireVersionId(calendarResponse, "revision");

      const invalidClassificationResponse = await handleEnergyApiRequest(
        request("POST", {
          entries: [{
            owner: { kind: "project" },
            effectiveFrom: "2026-07-01",
            weekly: {
              monday: [],
              tuesday: [],
              wednesday: [],
              thursday: [],
              friday: [],
              saturday: [],
              sunday: [],
            },
            exceptions: [{
              date: "2026-08-10",
              operating: [],
              classification: "holiday-like-label",
            }],
          }],
        }),
        ["projects", projectId, "operational-policies", "calendar"],
        context,
      );
      expect(invalidClassificationResponse).toMatchObject({
        status: 400,
        body: { success: false, error: { code: "BAD_REQUEST" } },
      });

      const configuration = await handleEnergyApiRequest(
        request("GET"),
        ["projects", projectId, "operational-policies"],
        context,
      );
      expect(configuration).toMatchObject({
        status: 200,
        body: {
          success: true,
          data: {
            published: {
              tariff_schedule_version: "sg-tariff-v1",
              business_calendar_version: "sg-calendar-v1",
            },
            pending: {
              tariff_schedule_version: tariffVersion,
              business_calendar_version: calendarVersion,
            },
            tariffRevisions: [{ version_id: tariffVersion }],
            operatingCalendarRevisions: [{ version_id: calendarVersion }],
            hasUnpublishedChanges: true,
          },
        },
      });
      expect(metadata.energyIq.getProject(projectId)).toMatchObject({
        tariff_schedule_version: "sg-tariff-v1",
        business_calendar_version: "sg-calendar-v1",
      });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("returns a controlled validation error for overlapping effective windows", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-operational-policy-invalid-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      const response = await handleEnergyApiRequest(
        request("POST", {
          entries: [
            {
              owner: { kind: "project" },
              effectiveFrom: "2026-07-01T00:00:00+08:00",
              effectiveTo: "2026-08-01T00:00:00+08:00",
              currency: "SGD",
              ratePerKwh: 0.28,
            },
            {
              owner: { kind: "project" },
              effectiveFrom: "2026-07-15T00:00:00+08:00",
              currency: "SGD",
              ratePerKwh: 0.3,
            },
          ],
        }),
        ["projects", "ngee-ann-polytechnic", "operational-policies", "tariff"],
        {
          metadataStore: metadata,
          dataGateway: gateway,
          userId: "dev-user",
          workspaceId: NGEE_ANN_WORKSPACE_ID,
        } as Required<ConfigApiContext>,
      );

      expect(response).toMatchObject({
        status: 400,
        body: {
          success: false,
          error: {
            code: "BAD_REQUEST",
          },
        },
      });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

const request = (method: "GET" | "POST", body?: unknown): IncomingMessage => {
  const stream = new PassThrough();
  Object.assign(stream, {
    method,
    headers: { "content-type": "application/json" },
  });
  stream.end(body === undefined ? undefined : JSON.stringify(body));
  return stream as unknown as IncomingMessage;
};

const requireVersionId = (
  response: Awaited<ReturnType<typeof handleEnergyApiRequest>>,
  key: string,
): string => {
  const body = response.body as { data?: Record<string, unknown> };
  const record = body.data?.[key] as { version_id?: unknown } | undefined;
  expect(typeof record?.version_id).toBe("string");
  return String(record?.version_id);
};
