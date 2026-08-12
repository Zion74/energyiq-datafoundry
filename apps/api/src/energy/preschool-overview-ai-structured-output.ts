import type { PublicStructuredOutputOptions } from "@mastra/core/agent";

import { PRESCHOOL_SECTION_IDS } from "./preschool-overview-ai-contracts.js";
import type { PreschoolOverviewAiStage } from "./preschool-overview-ai-workflow.js";

type StructuredEnvelope = Record<string, unknown>;
type JsonSchema = {
  type: "object" | "array" | "string";
  additionalProperties?: boolean;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  enum?: string[];
  minLength?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
};

const nonEmptyString: JsonSchema = { type: "string", minLength: 1 };
const evidenceRefs: JsonSchema = {
  type: "array",
  minItems: 1,
  uniqueItems: true,
  items: nonEmptyString,
};

const sectionKeyPoint: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "text", "evidenceRefs"],
  properties: {
    kind: { type: "string", enum: ["priority", "finding", "meaning", "next-check"] },
    label: nonEmptyString,
    text: nonEmptyString,
    evidenceRefs,
  },
};

/** Native value-output contract for one bounded, independently executed Section. */
export const PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V3 = {
  errorStrategy: "strict",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["sectionId", "status"],
    properties: {
      sectionId: { type: "string", enum: [...PRESCHOOL_SECTION_IDS] },
      status: { type: "string", enum: ["available", "empty"] },
      summary: nonEmptyString,
      keyPoints: {
        type: "array",
        minItems: 0,
        maxItems: 4,
        items: sectionKeyPoint,
      },
      limitation: nonEmptyString,
    },
  },
} satisfies PublicStructuredOutputOptions<StructuredEnvelope>;

const executiveKeyFinding: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["takeaway", "sectionIds", "evidenceRefs"],
  properties: {
    takeaway: nonEmptyString,
    sectionIds: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { type: "string", enum: [...PRESCHOOL_SECTION_IDS] },
    },
    evidenceRefs,
  },
};

/** Native value-output contract for the bounded Executive Synthesis stage. */
export const PRESCHOOL_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V1 = {
  errorStrategy: "strict",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["status", "keyFindings"],
    properties: {
      status: { type: "string", enum: ["available", "empty"] },
      keyFindings: {
        type: "array",
        minItems: 0,
        maxItems: 4,
        items: executiveKeyFinding,
      },
    },
  },
} satisfies PublicStructuredOutputOptions<StructuredEnvelope>;

export const resolveOverviewAiStageStructuredOutput = (
  stage: PreschoolOverviewAiStage,
): PublicStructuredOutputOptions<StructuredEnvelope> | undefined => {
  if (stage === "section-interpreter") return PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V3;
  if (stage === "executive-synthesis") return PRESCHOOL_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V1;
  return undefined;
};
