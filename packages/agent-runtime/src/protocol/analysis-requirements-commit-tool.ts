import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { AGENT_RUNTIME_LIMITS } from "../config/agent-runtime-limits.js";
import { toolErrorObservation } from "../errors/tool-execution-error.js";
import type { AnalysisRequirement } from "./analysis-requirements.js";
import {
  adaptTrustedEnergyRequirementsCommit,
  type TrustedEnergyRequirementsCommitInput
} from "./trusted-energy-requirements-commit-adapter.js";

type CommitActionInput = {
  runId: string;
  segmentId: string;
  actionId: string;
  actionName: "analysis.requirements.commit";
  input: TrustedEnergyRequirementsCommitInput;
  idempotencyKey: string;
};

export type CreateAnalysisRequirementsCommitToolInput = {
  analysisRequirements: AnalysisRequirement[];
  executeAction(input: CommitActionInput): Promise<{ observation: unknown }>;
  runId: string;
  segmentId: string;
  trustedEnergy: boolean;
};

export const analysisRequirementsCommitInputSchema = z.object({
  claims: z.array(z.object({
    requirement_id: z.string().min(1),
    claim: z.string().min(1),
    values: z.array(z.object({
      name: z.string().min(1),
      value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
      unit: z.string().optional()
    })).max(AGENT_RUNTIME_LIMITS.requirementCommitMaxOutputFields).optional(),
    evidence_refs: z.array(z.string().min(1)).optional(),
    evidence_requirement_ids: z.array(z.string().min(1)).optional()
  })).min(1).max(AGENT_RUNTIME_LIMITS.requirementCommitMaxClaims)
});

const stringEnum = (values: string[]) =>
  z.enum(values as [string, ...string[]]);

/**
 * Build the smallest flat model-facing commit contract for this Run.
 *
 * Provider schemas stay free of per-requirement unions. The trusted adapter
 * remains the final per-requirement guard, while the schema stops advertising
 * ids and value names that the server can never accept.
 */
export const buildAnalysisRequirementsCommitInputSchema = (
  requirements: AnalysisRequirement[]
) => {
  const requirementIds = requirements.map((requirement) => requirement.id);
  if (requirementIds.length === 0) {
    throw new Error("ANALYSIS_REQUIREMENTS_COMMIT_SCHEMA_EMPTY");
  }
  const declaredValueNames = [...new Set(requirements.flatMap((requirement) =>
    requirement.assertions.flatMap((assertion) =>
      assertion.claimValues.map((value) => value.name))))];
  const valueSchema = declaredValueNames.length > 0
    ? z.array(z.object({
        name: stringEnum(declaredValueNames),
        value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
        unit: z.string().optional()
      }).strict()).max(AGENT_RUNTIME_LIMITS.requirementCommitMaxOutputFields).optional()
    : undefined;
  const claimShape = {
    requirement_id: stringEnum(requirementIds),
    claim: z.string().min(1),
    ...(valueSchema ? { values: valueSchema } : {}),
    evidence_refs: z.array(z.string().min(1)).optional(),
    evidence_requirement_ids: z.array(stringEnum(requirementIds)).optional()
  };
  return z.object({
    claims: z.array(z.object(claimShape).strict())
      .min(1)
      .max(AGENT_RUNTIME_LIMITS.requirementCommitMaxClaims)
  }).strict() as z.ZodType<TrustedEnergyRequirementsCommitInput>;
};

/** The adapter is deliberately inside execute's catch boundary so bad model input is one observation. */
export const createAnalysisRequirementsCommitTool = (
  input: CreateAnalysisRequirementsCommitToolInput
) => {
  const inputSchema = buildAnalysisRequirementsCommitInputSchema(input.analysisRequirements);
  return createTool({
    id: "analysis_requirements_commit",
    description: "Commit final claims for analysis requirements using artifact evidence from successful SQL results.",
    inputSchema,
    execute: async (toolInput, options) => {
      const toolCallId = typeof options?.agent?.toolCallId === "string" && options.agent.toolCallId.length > 0
        ? options.agent.toolCallId
        : undefined;
      try {
        const parsedToolInput = inputSchema.parse(toolInput);
        const commitInput = input.trustedEnergy
          ? adaptTrustedEnergyRequirementsCommit(parsedToolInput, input.analysisRequirements)
          : parsedToolInput;
        const result = await input.executeAction({
          runId: input.runId,
          segmentId: input.segmentId,
          actionId: toolCallId ?? `analysis-requirements-commit:${Date.now()}`,
          actionName: "analysis.requirements.commit",
          input: commitInput,
          idempotencyKey: toolCallId ?? JSON.stringify(commitInput)
        });
        return result.observation;
      } catch (error) {
        return toolErrorObservation(error, { toolName: "analysis_requirements_commit" });
      }
    }
  });
};
