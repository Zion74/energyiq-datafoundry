import { describe, expect, it } from "vitest";

import {
  overviewAnalysisRequest,
  toDateInput,
} from "./published-decision-dashboard";

describe("published Overview date inputs", () => {
  it("formats trusted UTC boundaries in the Project timezone", () => {
    expect(toDateInput("2026-07-26T16:00:00.000Z", "Asia/Singapore")).toBe("2026-07-27");
    expect(toDateInput("2026-08-02T15:59:59.999Z", "Asia/Singapore")).toBe("2026-08-02");
  });

  it("asks the server to resolve the Project root instead of hard-coding a customer Scope", () => {
    expect(overviewAnalysisRequest(
      "preschool-demo",
      "Last 7 days",
      { from: "", to: "" },
    )).toEqual({
      projectId: "preschool-demo",
      scopeId: "project",
      resource: "electricity",
      period: "Last 7 days",
    });
  });
});
