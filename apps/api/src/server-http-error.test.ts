import { describe, expect, it } from "vitest";

import { classifyServerRequestError } from "./server.js";

describe("server request error classification", () => {
  it("reports an inaccessible workspace as forbidden instead of a server failure", () => {
    expect(classifyServerRequestError(new Error("ENERGYIQ_WORKSPACE_FORBIDDEN"))).toEqual({
      status: 403,
      code: "FORBIDDEN",
      message: "ENERGYIQ_WORKSPACE_FORBIDDEN",
    });
  });

  it("keeps unknown failures internal", () => {
    expect(classifyServerRequestError(new Error("UNEXPECTED_FAILURE"))).toEqual({
      status: 500,
      code: "NOT_ENABLED",
      message: "UNEXPECTED_FAILURE",
    });
  });
});
