import { describe, expect, it } from "vitest";

import {
  PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V1,
  PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V2,
  PRESCHOOL_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V4,
  PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V3,
  PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V4,
  resolveOverviewAiStageStructuredOutput,
  resolveOverviewAiStageStructuredOutputV4,
} from "./preschool-overview-ai-structured-output.js";

describe("Preschool Overview AI structured output", () => {
  it("keeps Additional discovery open while bounding its candidate transport", () => {
    expect(PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V1.schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["candidates"],
      properties: {
        candidates: {
          type: "array",
          minItems: 0,
          items: {
            required: ["id", "title", "text", "epistemicStatus", "evidenceRefs", "toolAuditIds"],
            properties: {
              epistemicStatus: { enum: ["observed", "inferred", "speculative"] },
            },
          },
        },
      },
    });
    expect(PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V1.schema.properties!.candidates!.items!.properties)
      .not.toHaveProperty("canvas");
  });

  it("offers only the approved declarative quantitative Canvas plan to current Additional discovery", () => {
    const candidates = PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V2.schema.properties!.candidates!;
    const canvas = candidates.items!.properties!.canvas!;
    const block = canvas.properties!.investigatorBlocks!.items!;

    expect(block).toMatchObject({
      additionalProperties: false,
      required: ["id", "kind", "visualization", "title", "bindings"],
      properties: {
        kind: { enum: ["quantitative"] },
        visualization: { enum: ["metric", "comparison", "trend"] },
      },
    });
    expect(canvas.properties).not.toHaveProperty("html");
    expect(canvas.properties).not.toHaveProperty("url");
    expect(canvas.properties).not.toHaveProperty("sql");
    expect(canvas.properties!.finding!.properties!.evidenceRefs).toMatchObject({
      minItems: 1,
      uniqueItems: true,
    });
    expect(canvas.properties!.presentationGapRequests!.items!.properties!.evidenceRefs).toMatchObject({
      minItems: 1,
      uniqueItems: true,
    });
    expect(resolveOverviewAiStageStructuredOutput("additional-insights-discovery"))
      .toBe(PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V2);
  });

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
      title: { type: "string", maxLength: 96 },
      epistemicStatus: { enum: ["observed", "inferred", "speculative"] },
      text: { type: "string", maxLength: 480 },
      evidenceRefs: { type: "array" },
      deepDiveQuestion: { type: "string", maxLength: 220 },
    });
    expect(v4Properties.summary!.properties!.text).toMatchObject({ maxLength: 360 });
    expect(v4Properties.limitation).toMatchObject({ maxLength: 320 });
    expect(resolveOverviewAiStageStructuredOutput("section-interpreter"))
      .toBe(PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V3);
    expect(resolveOverviewAiStageStructuredOutputV4("section-interpreter"))
      .toBe(PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V4);
    expect(resolveOverviewAiStageStructuredOutputV4("executive-synthesis"))
      .toBe(PRESCHOOL_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V4);
    expect(PRESCHOOL_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V4.schema).toMatchObject({
      required: ["status", "findings"],
      properties: {
        summary: { type: "object", properties: { text: { maxLength: 420 } } },
        findings: {
          type: "array",
          maxItems: 3,
          items: { properties: { title: { maxLength: 96 }, text: { maxLength: 420 } } },
        },
      },
    });

    const sectionSummaryEvidence = v4Properties.summary!.properties!.evidenceRefs!;
    const sectionCandidateEvidence = candidateProperties.evidenceRefs!;
    const executiveProperties = PRESCHOOL_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V4.schema.properties!;
    const executiveSummaryEvidence = executiveProperties.summary!.properties!.evidenceRefs!;
    const executiveFindingEvidence = executiveProperties.findings!.items!.properties!.evidenceRefs!;
    const executiveAlertCertainty = executiveProperties.findings!.items!.properties!.alert!
      .properties!.certainty!;
    for (const schema of [
      sectionSummaryEvidence,
      sectionCandidateEvidence,
      executiveSummaryEvidence,
      executiveFindingEvidence,
    ]) expect(schema).not.toHaveProperty("uniqueItems");
    expect(executiveAlertCertainty.enum).toEqual([
      "confirmed", "anomaly", "possible", "observed", "inferred", "speculative",
    ]);
  });
});
