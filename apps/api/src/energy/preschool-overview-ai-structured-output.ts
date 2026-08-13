import type { PublicStructuredOutputOptions } from "@mastra/core/agent";

import { PRESCHOOL_SECTION_IDS } from "./preschool-overview-ai-contracts.js";
import type { PreschoolOverviewAiStage } from "./preschool-overview-ai-workflow.js";

type StructuredEnvelope = Record<string, unknown>;
type JsonSchema = {
  type: "object" | "array" | "string" | "integer" | "boolean";
  additionalProperties?: boolean;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  enum?: Array<string | number | boolean>;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minimum?: number;
  maximum?: number;
};

const nonEmptyString: JsonSchema = { type: "string", minLength: 1 };
const uniqueEvidenceRefs: JsonSchema = {
  type: "array",
  minItems: 1,
  uniqueItems: true,
  items: nonEmptyString,
};

// Compatible Providers occasionally repeat a valid reference. The server parser
// canonicalizes these arrays before acceptance, so duplicates must not make the
// native structured-output layer discard an otherwise recoverable result.
const modelEvidenceRefsV4: JsonSchema = {
  type: "array",
  minItems: 1,
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
    evidenceRefs: uniqueEvidenceRefs,
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

const sectionSummaryV4: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["text", "evidenceRefs"],
  properties: {
    text: nonEmptyString,
    evidenceRefs: modelEvidenceRefsV4,
  },
};

const sectionInsightCandidateV4: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "epistemicStatus", "text", "evidenceRefs"],
  properties: {
    title: nonEmptyString,
    label: nonEmptyString,
    epistemicStatus: { type: "string", enum: ["observed", "inferred", "speculative"] },
    text: nonEmptyString,
    evidenceRefs: modelEvidenceRefsV4,
    deepDiveQuestion: nonEmptyString,
  },
};

/**
 * Current model proposal contract for one independently executed Section.
 * Candidate identity, acceptance and the three-insight publication budget remain server-owned.
 */
export const PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V4 = {
  errorStrategy: "strict",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["sectionId", "status", "candidates"],
    properties: {
      sectionId: { type: "string", enum: [...PRESCHOOL_SECTION_IDS] },
      status: { type: "string", enum: ["available", "empty"] },
      summary: sectionSummaryV4,
      candidates: {
        type: "array",
        minItems: 0,
        items: sectionInsightCandidateV4,
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
    evidenceRefs: uniqueEvidenceRefs,
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

const executiveAlertV4: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["severity", "certainty"],
  properties: {
    severity: { type: "string", enum: ["attention", "urgent"] },
    certainty: { type: "string", enum: ["confirmed", "anomaly", "possible"] },
  },
};

const executiveFindingV4: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "text", "sectionIds", "evidenceRefs"],
  properties: {
    title: nonEmptyString,
    text: nonEmptyString,
    sectionIds: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { type: "string", enum: [...PRESCHOOL_SECTION_IDS] },
    },
    evidenceRefs: modelEvidenceRefsV4,
    alert: executiveAlertV4,
  },
};

/** Current bounded Key Findings proposal contract. Identity and Evidence lineage stay server-owned. */
export const PRESCHOOL_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V4 = {
  errorStrategy: "strict",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["status", "findings"],
    properties: {
      status: { type: "string", enum: ["available", "empty"] },
      summary: sectionSummaryV4,
      findings: {
        type: "array",
        minItems: 0,
        maxItems: 3,
        items: executiveFindingV4,
      },
    },
  },
} satisfies PublicStructuredOutputOptions<StructuredEnvelope>;

const templateChangeOperation: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["op", "templateId"],
  properties: {
    op: {
      type: "string",
      enum: [
        "add_placement",
        "remove_placement",
        "move_placement",
        "set_section",
        "update_layout",
        "update_presentation",
      ],
    },
    templateId: nonEmptyString,
    componentRevisionId: nonEmptyString,
    placementId: nonEmptyString,
    sectionId: nonEmptyString,
    beforePlacementId: nonEmptyString,
    layout: {
      type: "object",
      additionalProperties: false,
      required: ["span", "height"],
      properties: {
        span: { type: "integer", enum: [4, 6, 8, 12] },
        height: { type: "string", enum: ["compact", "standard", "tall"] },
      },
    },
    presentation: {
      type: "object",
      additionalProperties: false,
      properties: {
        visual_preset: { type: "string", enum: ["auto", "cards", "bar", "area", "table", "list"] },
        density: { type: "string", enum: ["comfortable", "compact"] },
        tone: { type: "string", enum: ["default", "highlight", "quiet"] },
        show_legend: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        title: nonEmptyString,
        description: nonEmptyString,
      },
    },
  },
};

/** Model output is only a typed proposal. Validation, preview and publishing remain server-owned. */
export const ENERGYIQ_TEMPLATE_CHANGE_PROPOSAL_STRUCTURED_OUTPUT_V1 = {
  errorStrategy: "strict",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["title", "rationale", "operations"],
    properties: {
      title: { type: "string", minLength: 1, maxLength: 120 },
      rationale: { type: "string", minLength: 1, maxLength: 800 },
      operations: {
        type: "array",
        minItems: 1,
        maxItems: 20,
        items: templateChangeOperation,
      },
    },
  },
} satisfies PublicStructuredOutputOptions<StructuredEnvelope>;

export const resolveOverviewAiStageStructuredOutput = (
  stage: PreschoolOverviewAiStage,
): PublicStructuredOutputOptions<StructuredEnvelope> | undefined => {
  if (stage === "section-interpreter") return PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V3;
  if (stage === "executive-synthesis") return PRESCHOOL_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V1;
  if (stage === "template-proposal") return ENERGYIQ_TEMPLATE_CHANGE_PROPOSAL_STRUCTURED_OUTPUT_V1;
  return undefined;
};

/** Explicit V4 entrypoint for the Pack-v2 workflow; the existing Page path remains on V3. */
export const resolveOverviewAiStageStructuredOutputV4 = (
  stage: PreschoolOverviewAiStage,
): PublicStructuredOutputOptions<StructuredEnvelope> | undefined => {
  if (stage === "section-interpreter") return PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V4;
  if (stage === "executive-synthesis") return PRESCHOOL_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V4;
  return resolveOverviewAiStageStructuredOutput(stage);
};
