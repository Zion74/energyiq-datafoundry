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

/** The adapter is deliberately inside execute's catch boundary so bad model input is one observation. */
export const createAnalysisRequirementsCommitTool = (
  input: CreateAnalysisRequirementsCommitToolInput
) => createTool({
  id: "analysis_requirements_commit",
  description: "Commit final claims for analysis requirements using artifact evidence from successful SQL results.",
  inputSchema: z.object({
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
  }),
  execute: async (toolInput, options) => {
    const toolCallId = typeof options?.agent?.toolCallId === "string" && options.agent.toolCallId.length > 0
      ? options.agent.toolCallId
      : undefined;
    try {
      const commitInput = input.trustedEnergy
        ? adaptTrustedEnergyRequirementsCommit(toolInput, input.analysisRequirements)
        : toolInput;
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
