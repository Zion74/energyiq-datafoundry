import { describe, expect, it } from "vitest";

import {
  createOverviewAiCandidateSubmissionTool,
  overviewAiCandidateSubmissionSchema,
  OVERVIEW_AI_CANDIDATE_SUBMISSION_TOOL_NAME,
} from "./overview-ai-candidate-submission-tool.js";

const submission = {
  candidates: [{
    id: "candidate-1",
    epistemicLevel: "hypothesis" as const,
    title: "A quoted \"lower-intensity\" label stays ordinary text",
    takeaway: "The structured tool owns serialization.",
    action: "Verify the source metadata before changing operations.",
    expectedIfAct: "The team can decide with an authoritative baseline.",
    ifIgnored: "The apparent priority may remain misleading.",
    limitation: "The current source does not establish causality.",
    possibleExplanation: "The source remains unconfirmed.",
    nextCheck: "Verify it against the pinned Snapshot.",
    evidenceRefs: ["benchmark:priority-centre:A1"],
    evidenceSqlIndexes: [1],
  }],
};

describe("Overview AI Candidate submission tool", () => {
  it("strictly parses and echoes one Candidate submission without rewriting it", async () => {
    const tool = createOverviewAiCandidateSubmissionTool();

    const result = await tool.execute?.(submission, {} as never);

    expect(OVERVIEW_AI_CANDIDATE_SUBMISSION_TOOL_NAME).toBe("overview_ai_candidates_submit");
    expect(tool.description).toContain("zero to three concise Findings");
    expect(tool.description).toContain("action, expectedIfAct, ifIgnored, and limitation");
    expect(result).toEqual({
      ok: true,
      resultType: "overview-ai-candidate-submission",
      payload: submission,
    });
  });

  it("fails closed on a duplicate successful submission in the same Run", async () => {
    const tool = createOverviewAiCandidateSubmissionTool();
    await tool.execute?.(submission, {} as never);

    const duplicate = await tool.execute?.({ candidates: [] }, {} as never);

    expect(duplicate).toMatchObject({
      ok: false,
      isError: true,
      error: { code: "OVERVIEW_AI_CANDIDATE_SUBMISSION_CONFLICT" },
    });
  });

  it("accepts zero to three Findings and rejects a fourth", () => {
    expect(overviewAiCandidateSubmissionSchema.safeParse({ candidates: [] }).success).toBe(true);
    expect(overviewAiCandidateSubmissionSchema.safeParse({
      candidates: Array.from({ length: 3 }, (_, index) => ({
        ...submission.candidates[0]!,
        id: `candidate-${index + 1}`,
      })),
    }).success).toBe(true);
    expect(overviewAiCandidateSubmissionSchema.safeParse({
      candidates: Array.from({ length: 4 }, (_, index) => ({
        ...submission.candidates[0]!,
        id: `candidate-${index + 1}`,
      })),
    }).success).toBe(false);
  });

  it("requires the action, expected outcome, ignored outcome, and limitation", () => {
    for (const field of ["action", "expectedIfAct", "ifIgnored", "limitation"] as const) {
      const candidate: Record<string, unknown> = { ...submission.candidates[0]! };
      delete candidate[field];

      expect(overviewAiCandidateSubmissionSchema.safeParse({ candidates: [candidate] }).success).toBe(false);
    }
  });

  it("enforces the concise Finding text limits", () => {
    const textLimits = {
      title: 160,
      takeaway: 220,
      action: 120,
      expectedIfAct: 120,
      ifIgnored: 120,
      limitation: 120,
      significance: 120,
      possibleExplanation: 120,
      nextCheck: 120,
    } as const;

    for (const [field, max] of Object.entries(textLimits)) {
      expect(overviewAiCandidateSubmissionSchema.safeParse({
        candidates: [{ ...submission.candidates[0]!, [field]: "x".repeat(max) }],
      }).success).toBe(true);
      expect(overviewAiCandidateSubmissionSchema.safeParse({
        candidates: [{ ...submission.candidates[0]!, [field]: "x".repeat(max + 1) }],
      }).success).toBe(false);
    }
  });

  it("retains bounded Evidence references and 1-based SQL indexes", () => {
    const exactLimit = {
      ...submission.candidates[0]!,
      evidenceRefs: Array.from({ length: 24 }, (_, index) => `evidence:${index + 1}`),
      evidenceSqlIndexes: Array.from({ length: 24 }, (_, index) => index + 1),
    };
    expect(overviewAiCandidateSubmissionSchema.safeParse({ candidates: [exactLimit] }).success).toBe(true);
    expect(overviewAiCandidateSubmissionSchema.safeParse({
      candidates: [{ ...exactLimit, evidenceRefs: [...exactLimit.evidenceRefs, "evidence:25"] }],
    }).success).toBe(false);
    expect(overviewAiCandidateSubmissionSchema.safeParse({
      candidates: [{ ...exactLimit, evidenceRefs: ["x".repeat(241)] }],
    }).success).toBe(false);
    expect(overviewAiCandidateSubmissionSchema.safeParse({
      candidates: [{ ...exactLimit, evidenceSqlIndexes: [...exactLimit.evidenceSqlIndexes, 25] }],
    }).success).toBe(false);
    expect(overviewAiCandidateSubmissionSchema.safeParse({
      candidates: [{ ...exactLimit, evidenceSqlIndexes: [0] }],
    }).success).toBe(false);
  });

  it("rejects Candidate identities and text that downstream parsing cannot accept", async () => {
    const invalidIdentityTool = createOverviewAiCandidateSubmissionTool();
    const invalidIdentity = await invalidIdentityTool.execute?.({
      candidates: [{ ...submission.candidates[0]!, id: "candidate 1" }],
    }, {} as never);
    const oversizedTextTool = createOverviewAiCandidateSubmissionTool();
    const oversizedText = await oversizedTextTool.execute?.({
      candidates: [{ ...submission.candidates[0]!, takeaway: "x".repeat(221) }],
    }, {} as never);

    expect(invalidIdentity).toMatchObject({ error: true });
    expect(oversizedText).toMatchObject({ error: true });
  });
});
