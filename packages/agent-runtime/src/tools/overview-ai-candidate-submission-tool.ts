import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const OVERVIEW_AI_CANDIDATE_SUBMISSION_TOOL_NAME = "overview_ai_candidates_submit" as const;

const candidateSchema = z.object({
  id: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
  epistemicLevel: z.enum(["verified", "hypothesis", "exploration-idea"]),
  title: z.string().trim().min(1).max(160),
  takeaway: z.string().trim().min(1).max(220),
  action: z.string().trim().min(1).max(120),
  expectedIfAct: z.string().trim().min(1).max(120),
  ifIgnored: z.string().trim().min(1).max(120),
  limitation: z.string().trim().min(1).max(120),
  significance: z.string().trim().min(1).max(120).optional(),
  possibleExplanation: z.string().trim().min(1).max(120).optional(),
  nextCheck: z.string().trim().min(1).max(120).optional(),
  evidenceRefs: z.array(z.string().trim().min(1).max(240)).max(24),
  evidenceSqlIndexes: z.array(z.number().int().positive()).max(24),
  // Presentation stays optional and is parsed by the existing versioned
  // Overview Runtime contract after the submission tool echoes the payload.
  presentation: z.unknown().optional(),
}).strict();

export const overviewAiCandidateSubmissionSchema = z.object({
  candidates: z.array(candidateSchema).max(3),
}).strict();

/**
 * A run-local syntax boundary only. It neither validates Evidence nor writes an
 * Artifact; the Overview workflow remains the authority for both operations.
 */
export const createOverviewAiCandidateSubmissionTool = () => {
  let accepted = false;
  return createTool({
    id: OVERVIEW_AI_CANDIDATE_SUBMISSION_TOOL_NAME,
    description: "Submit zero to three concise Findings in the final Overview Investigator Candidate envelope. Each "
      + "Candidate requires action, expectedIfAct, ifIgnored, and limitation in addition to its title, takeaway, "
      + "epistemic level, and bounded Evidence references. Call once after investigation; do not emit Candidate JSON "
      + "as Assistant text.",
    inputSchema: overviewAiCandidateSubmissionSchema,
    execute: async (input) => {
      const parsed = overviewAiCandidateSubmissionSchema.safeParse(input);
      if (!parsed.success) {
        return {
          ok: false,
          isError: true,
          error: {
            code: "OVERVIEW_AI_CANDIDATE_SUBMISSION_INVALID",
            issues: parsed.error.issues.map(({ path, message }) => ({ path, message })),
          },
        };
      }
      if (accepted) {
        return {
          ok: false,
          isError: true,
          error: { code: "OVERVIEW_AI_CANDIDATE_SUBMISSION_CONFLICT" },
        };
      }
      accepted = true;
      return {
        ok: true,
        resultType: "overview-ai-candidate-submission" as const,
        payload: parsed.data,
      };
    },
  });
};
