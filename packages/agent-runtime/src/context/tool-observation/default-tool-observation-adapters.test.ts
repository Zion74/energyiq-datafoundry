import { describe, expect, it } from "vitest";

import { createToolObservationBoundary } from "./tool-observation-boundary.js";

describe("default tool observation adapters", () => {
  it("projects a protocol requirements commit as a governed acknowledgement", () => {
    const runScope = {
      modelName: "test-model",
      resourceId: "user-1",
      runId: "run-1",
      sessionId: "session-1",
    };
    const boundary = createToolObservationBoundary({ identity: runScope });
    const contextPackage = boundary.packager.packageToolObservation({
      toolName: "analysis_requirements_commit",
      rawResult: {
        claims: [{
          requirement_id: "R1",
          claim: "There are 8 Active Aging Centers",
          evidence_refs: ["sql-result-1"],
        }],
      },
      runScope,
    });

    expect(contextPackage.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceType: "analysis-requirements-commit",
        visibility: "model",
        content: expect.objectContaining({
          committed: true,
          source: "analysis-protocol",
        }),
      }),
    ]));
    expect(JSON.stringify(contextPackage)).not.toContain("adapter_missing");
  });

  it("preserves a failed requirements commit instead of acknowledging it as committed", () => {
    const runScope = {
      modelName: "test-model",
      resourceId: "user-1",
      runId: "run-1",
      sessionId: "session-1",
    };
    const boundary = createToolObservationBoundary({ identity: runScope });
    const contextPackage = boundary.packager.packageToolObservation({
      toolName: "analysis_requirements_commit",
      rawResult: {
        ok: false,
        isError: true,
        error: {
          code: "ACTION_INPUT_INVALID",
          category: "validation",
          message: "The claim did not match the trusted contract.",
          executionStatus: "not_started",
          retryable: false,
        },
        recovery: {
          strategy: "refresh_and_replan",
          instruction: "Correct the claim before committing it.",
          avoid: ["Do not repeat the same invalid claim."],
        },
      },
      runScope,
    });

    expect(contextPackage.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceType: "analysis-requirements-commit",
        visibility: "model",
        content: expect.objectContaining({
          committed: false,
          error: expect.objectContaining({ code: "ACTION_INPUT_INVALID" }),
        }),
      }),
    ]));
    expect(JSON.stringify(contextPackage)).not.toContain('"committed":true');
  });
});
