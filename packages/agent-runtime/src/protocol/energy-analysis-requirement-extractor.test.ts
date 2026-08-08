import { describe, expect, it } from "vitest";

import { createEnergyAnalysisRequirementExtractor } from "./model-analysis-requirement-extractor.js";

describe("EnergyIQ analysis requirement extraction", () => {
  it("keeps the exact customer question without a model paraphrase", async () => {
    const extract = createEnergyAnalysisRequirementExtractor();

    await expect(extract({
      userText: "How many Active Aging Centers are there?"
    })).resolves.toMatchObject([{
      id: "R1",
      kind: "validation",
      description: "How many Active Aging Centers are there?"
    }]);
  });
});
