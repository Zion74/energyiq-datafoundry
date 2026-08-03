import { describe, expect, it } from "vitest";

import { createUserAnalysisRequirements } from "./analysis-requirements.js";
import { adaptTrustedEnergyRequirementsCommit } from "./trusted-energy-requirements-commit-adapter.js";

const requirements = createUserAnalysisRequirements([
  {
    kind: "comparison",
    description: "Explain the period comparison",
    acceptanceCriteria: ["Evidence-backed comparison"]
  },
  {
    kind: "metric",
    description: "Report total electricity consumption",
    acceptanceCriteria: ["Exact kWh"],
    assertions: [{
      kind: "metric",
      description: "Validated usage",
      claimValues: [{
        name: "usage_kwh",
        field: "usage_kwh",
        unit: "kWh",
        required: true
      }]
    }]
  }
]);

describe("trusted Energy requirements commit adapter", () => {
  it("normalizes each claim against its own requirement registry instead of a global fallback", () => {
    const input = {
      claims: [
        {
          requirement_id: "R1",
          claim: "Usage increased from the previous period.",
          values: [{ name: "invented_change", value: 26.3677, unit: "%" }]
        },
        {
          requirement_id: "R2",
          claim: "Usage was 1,531.1683 kWh.",
          values: [
            { name: "usage_kwh", value: 1531.1683, unit: "kWh" },
            { name: "invented_total", value: 3050.1648, unit: "kWh" }
          ]
        }
      ]
    };

    expect(adaptTrustedEnergyRequirementsCommit(input, requirements)).toEqual({
      claims: [
        {
          requirement_id: "R1",
          claim: "Usage increased from the previous period."
        },
        {
          requirement_id: "R2",
          claim: "Usage was 1,531.1683 kWh.",
          values: [{ name: "usage_kwh", value: 1531.1683, unit: "kWh" }]
        }
      ]
    });
    expect(input.claims[0]).toHaveProperty("values");
  });

  it("fails closed when the model commits a requirement outside the server registry", () => {
    expect(() => adaptTrustedEnergyRequirementsCommit({
      claims: [{ requirement_id: "R99", claim: "Unsupported claim" }]
    }, requirements)).toThrow("TRUSTED_ENERGY_REQUIREMENT_NOT_FOUND:R99");
  });

  it("fails closed on cross-requirement Evidence references", () => {
    expect(() => adaptTrustedEnergyRequirementsCommit({
      claims: [{
        requirement_id: "R1",
        claim: "Comparison",
        evidence_requirement_ids: ["R99"]
      }]
    }, requirements)).toThrow("TRUSTED_ENERGY_EVIDENCE_REQUIREMENT_NOT_FOUND:R99");
  });
});
