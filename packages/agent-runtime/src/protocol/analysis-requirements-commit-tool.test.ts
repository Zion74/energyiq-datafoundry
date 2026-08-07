import { describe, expect, it, vi } from "vitest";

import { createUserAnalysisRequirements } from "./analysis-requirements.js";
import {
  buildAnalysisRequirementsCommitInputSchema,
  createAnalysisRequirementsCommitTool
} from "./analysis-requirements-commit-tool.js";

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

const mixedRequirements = createUserAnalysisRequirements([
  {
    kind: "metric",
    description: "Report total electricity consumption",
    acceptanceCriteria: ["Exact kWh"],
    assertions: [{
      kind: "metric",
      description: "Validated usage",
      claimValues: [{ name: "usage_kwh", field: "usage_kwh", unit: "kWh", required: true }]
    }]
  },
  {
    kind: "metric",
    description: "Report centre count",
    acceptanceCriteria: ["Exact count"],
    assertions: [{
      kind: "metric",
      description: "Validated count",
      claimValues: [{ name: "centre_count", field: "centre_count", unit: "count", required: true }]
    }]
  }
]);

describe("analysis requirements commit tool", () => {
  it("removes values from the model schema when no requirement declares claim values", () => {
    const manualRequirements = createUserAnalysisRequirements([{
      kind: "metric",
      description: "Count Active Aging Center facilities",
      acceptanceCriteria: ["Return the exact count"]
    }]);

    const schema = buildAnalysisRequirementsCommitInputSchema(manualRequirements);

    expect(schema.safeParse({
      claims: [{
        requirement_id: "R1",
        claim: "There are 8 Active Aging Center facilities",
        values: [{ name: "active_aging_center_count", value: 8, unit: "count" }]
      }]
    }).success).toBe(false);
    expect(schema.safeParse({
      claims: [{
        requirement_id: "R1",
        claim: "There are 8 Active Aging Center facilities"
      }]
    }).success).toBe(true);
  });

  it("exposes only server-declared requirement ids and value names", () => {
    const schema = buildAnalysisRequirementsCommitInputSchema(requirements);

    expect(schema.safeParse({
      claims: [{
        requirement_id: "R99",
        claim: "Unknown requirement",
        values: [{ name: "usage_kwh", value: 1, unit: "kWh" }]
      }]
    }).success).toBe(false);
    expect(schema.safeParse({
      claims: [{
        requirement_id: "R1",
        claim: "Invented value name",
        values: [{ name: "active_aging_center_count", value: 8, unit: "count" }]
      }]
    }).success).toBe(false);
  });

  it("keeps per-requirement value validation inside the controlled observation boundary", async () => {
    const executeAction = vi.fn();
    const tool = createAnalysisRequirementsCommitTool({
      analysisRequirements: mixedRequirements,
      executeAction,
      runId: "run-1",
      segmentId: "segment-1",
      trustedEnergy: true
    });

    const result = await tool.execute?.({ claims: [{
      requirement_id: "R1",
      claim: "A count incorrectly attached to the usage requirement",
      values: [{ name: "centre_count", value: 8, unit: "count" }]
    }] }, {
      agent: { toolCallId: "call-cross-requirement-value" }
    } as never);

    expect(result).toMatchObject({
      ok: false,
      isError: true,
      error: {
        code: "TRUSTED_ENERGY_REQUIREMENT_VALUE_NOT_FOUND",
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
