import { describe, expect, it } from "vitest";

import {
  resolveOverviewAiStageRuntimeOptions,
  shouldIncludeProjectAnalysisEvidenceContext,
} from "./server.js";

describe("Overview AI server stage options", () => {
  it("keeps the investigator on the narrow Artifact path with DeepSeek thinking disabled", () => {
    expect(resolveOverviewAiStageRuntimeOptions("investigator")).toEqual({
      analysisRequirementsMode: "omit",
      excludedToolNames: ["protocol_handoff"],
      overviewAiCandidateSubmission: true,
      reasoningModel: false,
    });
  });

  it("keeps the editor on the same narrow path without Schema or SQL tools", () => {
    expect(resolveOverviewAiStageRuntimeOptions("editor")).toEqual({
      analysisRequirementsMode: "omit",
      excludedToolNames: ["inspect_schema", "run_sql_readonly", "protocol_handoff"],
      overviewAiCandidateSubmission: false,
      reasoningModel: false,
    });
  });

  it("suppresses only duplicate full Snapshot and Catalog context for Overview stages", () => {
    expect(shouldIncludeProjectAnalysisEvidenceContext("investigator")).toBe(false);
    expect(shouldIncludeProjectAnalysisEvidenceContext("editor")).toBe(false);
    expect(shouldIncludeProjectAnalysisEvidenceContext(undefined)).toBe(true);
  });
});
