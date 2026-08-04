import { describe, expect, it } from "vitest";

import { toEnergyApiErrorResponse } from "./energy-api.js";

describe("Energy API business error mapping", () => {
  it("returns a diagnosable 409 when Project publication is blocked by data readiness", () => {
    expect(toEnergyApiErrorResponse(new Error(
      "ENERGYIQ_PROJECT_DATA_NOT_READY:IMPORT_BATCH_NOT_MATERIALIZED,SNAPSHOT_MAPPING_MISMATCH",
    ))).toEqual({
      status: 409,
      body: {
        success: false,
        error: {
          code: "CONFLICT",
          message: "ENERGYIQ_PROJECT_DATA_NOT_READY:IMPORT_BATCH_NOT_MATERIALIZED,SNAPSHOT_MAPPING_MISMATCH",
        },
      },
    });
  });

  it.each([
    "ENERGYIQ_SOURCE_MANIFEST_NOT_CONFIRMED",
    "ENERGYIQ_SOURCE_MANIFEST_MISMATCH",
    "ENERGYIQ_IMPORT_BATCH_NOT_PINNED",
    "ENERGYIQ_IMPORT_BATCH_NOT_PINNED:batch-1",
    "ENERGYIQ_DATA_SNAPSHOT_IMMUTABLE_CONFLICT:energy-snapshot-test",
  ])("returns a diagnosable 409 for materialization precondition %s", (message) => {
    expect(toEnergyApiErrorResponse(new Error(message))).toMatchObject({
      status: 409,
      body: { success: false, error: { code: "CONFLICT", message } },
    });
  });

  it.each([
    "ENERGYIQ_SOURCE_MANIFEST_INVALID",
    "ENERGYIQ_SOURCE_MANIFEST_REQUIRED",
    "ENERGYIQ_SOURCE_MANIFEST_SHA_INVALID:0",
  ])("keeps malformed Source Manifest input as a 400 for %s", (message) => {
    expect(toEnergyApiErrorResponse(new Error(message))).toMatchObject({
      status: 400,
      body: { success: false, error: { code: "BAD_REQUEST", message } },
    });
  });
});
