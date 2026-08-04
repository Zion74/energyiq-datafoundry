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
});
