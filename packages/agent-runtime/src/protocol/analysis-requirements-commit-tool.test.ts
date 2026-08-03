import { describe, expect, it, vi } from "vitest";

import { createUserAnalysisRequirements } from "./analysis-requirements.js";
import { createAnalysisRequirementsCommitTool } from "./analysis-requirements-commit-tool.js";

const requirements = createUserAnalysisRequirements([{
  kind: "metric",
  description: "Report total electricity consumption",
  acceptanceCriteria: ["Exact kWh"],
  assertions: [{
    kind: "metric",
    description: "Validated usage",
    claimValues: [{ name: "usage_kwh", field: "usage_kwh", unit: "kWh", required: true }]
  }]
}]);

describe("analysis requirements commit tool", () => {
  it.each([
    ["unknown requirement", {
      requirement_id: "R99",
      claim: "Unsupported claim"
    }, "TRUSTED_ENERGY_REQUIREMENT_NOT_FOUND"],
    ["unknown value", {
      requirement_id: "R1",
      claim: "An invented total",
      values: [{ name: "invented_total", value: 3050.1648, unit: "kWh" }]
    }, "TRUSTED_ENERGY_REQUIREMENT_VALUE_NOT_FOUND"]
  ])("returns one controlled Tool Error Observation for an %s", async (_label, claim, code) => {
    const executeAction = vi.fn();
    const tool = createAnalysisRequirementsCommitTool({
      analysisRequirements: requirements,
      executeAction,
      runId: "run-1",
      segmentId: "segment-1",
      trustedEnergy: true
    });

    const result = await tool.execute?.({ claims: [claim] }, {
      agent: { toolCallId: `call-${_label.replace(" ", "-")}` }
    } as never);

    expect(result).toMatchObject({
      ok: false,
      isError: true,
      error: {
        code,
        category: "validation",
        executionStatus: "failed",
        retryable: false
      },
      recovery: {
        strategy: "refresh_and_replan",
        avoid: [expect.stringContaining("Do not repeat analysis_requirements_commit unchanged")]
      }
    });
    expect(executeAction).not.toHaveBeenCalled();
  });
});
