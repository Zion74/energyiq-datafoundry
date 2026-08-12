import { describe, expect, it } from "vitest";

import {
  buildOverviewAiStageRunInput,
  collectOverviewAiText,
  resolveOverviewAiStageRuntimeOptions,
  resolveOverviewAiStageStructuredOutput,
  shouldUseEnergyContextForOverviewAiStage,
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

  it.each(["section-interpreter", "executive-synthesis"] as const)(
    "keeps %s lightweight with no Skill, Schema, SQL, handoff, or candidate submission",
    (stage) => {
      expect(resolveOverviewAiStageRuntimeOptions(stage)).toEqual({
        analysisRequirementsMode: "omit",
        conversationMessageMaxChars: stage === "section-interpreter" ? 12_000 : 24_000,
        disableTools: true,
        excludedToolNames: [
          "skill",
          "skill_search",
          "skill_read",
          "inspect_schema",
          "run_sql_readonly",
          "protocol_handoff",
        ],
        overviewAiCandidateSubmission: false,
        reasoningModel: false,
        structuredOutput: resolveOverviewAiStageStructuredOutput(stage),
      });
      expect(shouldIncludeProjectAnalysisEvidenceContext(stage)).toBe(false);
      expect(shouldUseEnergyContextForOverviewAiStage(stage)).toBe(false);
    },
  );

  it.each([
    ["section-interpreter", "sections"],
    ["executive-synthesis", "keyFindings"],
  ] as const)("pins %s to its native structured-output envelope", (stage, requiredProperty) => {
    const structuredOutput = resolveOverviewAiStageStructuredOutput(stage);
    expect(structuredOutput).toBeDefined();
    expect(structuredOutput?.schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: expect.arrayContaining([requiredProperty]),
    });
    expect(resolveOverviewAiStageRuntimeOptions(stage).structuredOutput).toBe(structuredOutput);
  });

  it.each(["investigator", "editor"] as const)(
    "does not force the agentic %s stage into a value-output schema",
    (stage) => {
      expect(resolveOverviewAiStageStructuredOutput(stage)).toBeUndefined();
      expect(resolveOverviewAiStageRuntimeOptions(stage)).not.toHaveProperty("structuredOutput");
    },
  );

  it("suppresses only duplicate full Snapshot and Catalog context for Overview stages", () => {
    expect(shouldIncludeProjectAnalysisEvidenceContext("investigator")).toBe(false);
    expect(shouldIncludeProjectAnalysisEvidenceContext("editor")).toBe(false);
    expect(shouldIncludeProjectAnalysisEvidenceContext(undefined)).toBe(true);
  });

  it.each(["section-interpreter", "executive-synthesis"] as const)(
    "forces %s to run without workspace-default Skills or datasources",
    (stage) => {
      const input = buildOverviewAiStageRunInput({
        stage,
        prompt: "Return JSON only.",
        identity: {
          workspaceId: "preschool-workspace",
          projectId: "preschool-demo",
          scopeId: "preschool-project",
          resource: "electricity",
          dataSnapshotId: "snapshot-current",
          projectReleaseId: "release-current",
          analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
          analysisPeriodTo: "2026-06-01T00:00:00.000Z",
          rendererKey: "preschool-overview",
          rendererVersion: "1",
          analysisPackId: "preschool-analysis-pack",
          analysisPackRevision: "v1",
          modelProfileId: "workspace-default",
          modelProfileRevision: 1,
          outputContractRevision: "v1",
          validatorRevision: "v1",
          workflowRevision: "v1",
          investigatorPromptRevision: "v1",
          editorPromptRevision: "not-applicable-v1",
          methodSkillId: "none",
          methodSkillRevision: "not-applicable-v1",
          artifactKind: stage === "section-interpreter" ? "section-interpretation" : "executive-synthesis",
          targetId: stage === "section-interpreter" ? "centre-benchmark" : "sections:none",
        },
        workspaceId: "preschool-workspace",
        user: {
          id: "dev-user",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        runId: `${stage}-run`,
        sessionId: `${stage}-session`,
      });
      expect(input.forwardedProps).toMatchObject({
        run_config: {
          skillMode: "none",
          enabledDatasourceIds: [],
          enabledSkillIds: [],
        },
      });
      expect(input.forwardedProps).not.toHaveProperty("externalContext");
    },
  );

  it("collects both legacy content events and current runtime text chunks", () => {
    expect(collectOverviewAiText([
      { type: "TEXT_MESSAGE_CONTENT", delta: "{\"sections\":" },
      { type: "TEXT_MESSAGE_CHUNK", delta: "[]}" },
      { type: "CUSTOM", delta: "ignored" },
    ])).toBe('{"sections":[]}');
  });
});
