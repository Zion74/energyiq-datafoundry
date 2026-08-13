import { describe, expect, it } from "vitest";

import {
  PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V3,
  PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V4,
  resolveOverviewAiStageStructuredOutput,
  resolveOverviewAiStageStructuredOutputV4,
} from "./preschool-overview-ai-structured-output.js";

describe("Preschool Overview AI structured output", () => {
  it("keeps the v3 schema for history while making v4 the current Section discovery contract", () => {
    const legacyProperties = PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V3.schema.properties!;
    const v4Properties = PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V4.schema.properties!;
    const v4PropertyMap = v4Properties as Record<string, unknown>;
    const candidateProperties = v4Properties.candidates!.items!.properties!;

    expect(legacyProperties.keyPoints).toBeDefined();
    expect(legacyProperties.keyPoints!.items!.properties!.kind).toBeDefined();
    expect(v4PropertyMap.keyPoints).toBeUndefined();
    expect(v4PropertyMap.allowedNextChecks).toBeUndefined();
    expect(candidateProperties.kind).toBeUndefined();
    expect(candidateProperties.candidateId).toBeUndefined();
    expect(candidateProperties).toMatchObject({
      title: { type: "string" },
      epistemicStatus: { enum: ["observed", "inferred", "speculative"] },
      text: { type: "string" },
      evidenceRefs: { type: "array" },
    });
    expect(resolveOverviewAiStageStructuredOutput("section-interpreter"))
      .toBe(PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V3);
    expect(resolveOverviewAiStageStructuredOutputV4("section-interpreter"))
      .toBe(PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V4);
    expect(resolveOverviewAiStageStructuredOutputV4("executive-synthesis"))
      .toBe(resolveOverviewAiStageStructuredOutput("executive-synthesis"));
  });
});
