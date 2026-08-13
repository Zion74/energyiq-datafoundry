import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDataFoundry, createDataFoundryRunContext } from "@datafoundry/agent-runtime";
import type { EnergyIqOverviewAiArtifactIdentity } from "@datafoundry/metadata";

import {
  buildOverviewAiStageRunInput,
  collectOverviewAiText,
  createPreschoolSectionTrustedStageTools,
  resolveOverviewAiAgentRuntimeOptions,
  resolveOverviewAiServerRunnerOptions,
  resolveOverviewAiStageRuntimeOptions,
  resolveOverviewAiStageStructuredOutput,
  shouldUseEnergyContextForOverviewAiStage,
  shouldIncludeProjectAnalysisEvidenceContext,
} from "./server.js";
import {
  PRESCHOOL_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V4,
  PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V4,
} from "./energy/preschool-overview-ai-structured-output.js";
import { buildPreschoolSectionDiscoveryPrompt } from "./energy/preschool-section-interpreter.js";
import type { PreschoolSectionPackV2 } from "./energy/preschool-section-pack-v2.js";

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
      expect(shouldUseEnergyContextForOverviewAiStage(stage)).toBe(stage === "section-interpreter");
    },
  );

  it("runs template proposals as a bounded structured-value stage with no tools or Energy context", () => {
    expect(resolveOverviewAiStageRuntimeOptions("template-proposal")).toEqual({
      analysisRequirementsMode: "omit",
      conversationMessageMaxChars: 24_000,
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
      structuredOutput: resolveOverviewAiStageStructuredOutput("template-proposal"),
    });
    expect(resolveOverviewAiStageStructuredOutput("template-proposal")?.schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["title", "rationale", "operations"],
    });
    expect(shouldUseEnergyContextForOverviewAiStage("template-proposal")).toBe(false);
    expect(shouldIncludeProjectAnalysisEvidenceContext("template-proposal")).toBe(false);
  });

  it.each([
    ["section-interpreter", "sectionId"],
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

  it("allows the isolated Section value contract to return empty or 1-4 useful points", () => {
    const structuredOutput = resolveOverviewAiStageStructuredOutput("section-interpreter");
    expect(structuredOutput?.schema).toMatchObject({
      required: ["sectionId", "status"],
      properties: {
        keyPoints: { minItems: 0, maxItems: 4 },
      },
    });
  });

  it("threads the trusted Pack-v2 Section override through the real agent options", () => {
    const trusted = resolveOverviewAiServerRunnerOptions({
      stage: "section-interpreter",
      structuredOutput: PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V4,
    });
    expect(trusted).toEqual({
      structuredOutput: PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V4,
      conversationMessageMaxChars: 110_000,
    });

    expect(resolveOverviewAiAgentRuntimeOptions("section-interpreter", trusted)).toMatchObject({
      structuredOutput: PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V4,
      conversationMessageMaxChars: 110_000,
    });
    expect(resolveOverviewAiAgentRuntimeOptions("section-interpreter", undefined)).toMatchObject({
      structuredOutput: resolveOverviewAiStageStructuredOutput("section-interpreter"),
      conversationMessageMaxChars: 12_000,
    });
  });

  it("exposes server-owned scoped tools only to the trusted Section stage runtime", () => {
    const toolNames = [
      "compare_centres",
      "inspect_time_pattern",
      "inspect_load_composition",
      "inspect_related_section_signals",
    ] as const;
    const invokeSectionInsightTool = async () => ({}) as never;
    const trusted = resolveOverviewAiServerRunnerOptions({
      stage: "section-interpreter",
      structuredOutput: PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V4,
      sectionInsightTools: toolNames,
      invokeSectionInsightTool,
    });

    expect(trusted).toMatchObject({ disableTools: false });
    expect(Object.keys(trusted?.trustedStageTools ?? {}).sort()).toEqual([...toolNames].sort());
    expect(Object.keys(createPreschoolSectionTrustedStageTools({
      toolNames,
      invoke: invokeSectionInsightTool,
    })).sort()).toEqual([...toolNames].sort());
    expect(resolveOverviewAiAgentRuntimeOptions("section-interpreter", trusted).trustedStageTools)
      .toBe(trusted?.trustedStageTools);

    const executive = resolveOverviewAiServerRunnerOptions({
      stage: "executive-synthesis",
      structuredOutput: PRESCHOOL_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V4,
    });
    expect(executive).not.toHaveProperty("trustedStageTools");
    expect(resolveOverviewAiAgentRuntimeOptions("executive-synthesis", executive)).toMatchObject({
      disableTools: true,
    });
    expect(resolveOverviewAiStageRuntimeOptions("investigator")).not.toHaveProperty("trustedStageTools");
  });

  it("threads the trusted V4 Executive override without changing the legacy default", () => {
    const trusted = resolveOverviewAiServerRunnerOptions({
      stage: "executive-synthesis",
      structuredOutput: PRESCHOOL_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V4,
    });
    expect(resolveOverviewAiAgentRuntimeOptions("executive-synthesis", trusted)).toMatchObject({
      structuredOutput: PRESCHOOL_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V4,
      conversationMessageMaxChars: 24_000,
    });
    expect(resolveOverviewAiAgentRuntimeOptions("executive-synthesis", undefined)).toMatchObject({
      structuredOutput: resolveOverviewAiStageStructuredOutput("executive-synthesis"),
      conversationMessageMaxChars: 24_000,
    });
  });

  it("does not expose trusted runtime overrides through browser-forwarded props", () => {
    const input = buildOverviewAiStageRunInput({
      stage: "section-interpreter",
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
        analysisPackId: "preschool-section-pack",
        analysisPackRevision: "v2",
        modelProfileId: "workspace-default",
        modelProfileRevision: 1,
        outputContractRevision: "preschool-section-interpretation-v4",
        validatorRevision: "acceptance-validator-v1",
        workflowRevision: "discover-accept-publish-v1",
        investigatorPromptRevision: "discovery-prompt-v1",
        editorPromptRevision: "not-applicable-v1",
        methodSkillId: "none",
        methodSkillRevision: "not-applicable-v1",
        artifactKind: "section-interpretation",
        targetId: "centre-benchmark",
      },
      workspaceId: "preschool-workspace",
      user: {
        id: "dev-user",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      runId: "section-run",
      sessionId: "section-session",
      trustedRuntimeOverride: {
        structuredOutput: PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V4,
        conversationMessageMaxChars: 110_000,
      },
    });
    expect(input.forwardedProps).not.toHaveProperty("trustedRuntimeOverride");
    expect(input.forwardedProps).not.toHaveProperty("structuredOutput");
    expect(input.forwardedProps).not.toHaveProperty("conversationMessageMaxChars");
    expect(input.forwardedProps).not.toHaveProperty("trustedStageTools");
  });

  it("persists exact server-owned Section Snapshot, Release and period pins in the user message", () => {
    const identity = {
      workspaceId: "preschool-demo-org",
      projectId: "preschool-demo",
      scopeId: "preschool-project",
      resource: "electricity",
      dataSnapshotId: "energy-snapshot-563f8939fd90dc2fbef0018a",
      projectReleaseId: "preschool-demo-template-v2",
      analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
      analysisPeriodTo: "2026-06-01T00:00:00.000Z",
      rendererKey: "preschool-overview",
      rendererVersion: "1",
      analysisPackId: "preschool-section-pack",
      analysisPackRevision: "v2",
      modelProfileId: "workspace-default",
      modelProfileRevision: 7,
      outputContractRevision: "preschool-section-interpretation-v4",
      validatorRevision: "acceptance-validator-v1",
      workflowRevision: "discover-accept-publish-v1",
      investigatorPromptRevision: "discovery-prompt-v2",
      editorPromptRevision: "not-applicable-v1",
      methodSkillId: "none",
      methodSkillRevision: "not-applicable-v1",
      artifactKind: "section-interpretation" as const,
      targetId: "centre-benchmark",
    } as const satisfies EnergyIqOverviewAiArtifactIdentity;
    const input = buildOverviewAiStageRunInput({
      stage: "section-interpreter",
      prompt: "Bounded Section model projection without caller-authored identity.",
      identity,
      workspaceId: identity.workspaceId,
      user: {
        id: "dev-user",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      runId: "section-run-pins",
      sessionId: "section-session-pins",
    });
    const persistedUserInput = input.messages[0]?.content;
    if (typeof persistedUserInput !== "string") throw new Error("Expected one text user message");

    expect([
      identity.dataSnapshotId,
      identity.projectReleaseId,
      identity.analysisPeriodFrom,
      identity.analysisPeriodTo,
    ].filter((pin) => !persistedUserInput.includes(pin))).toEqual([]);
  });

  it("constructs the real governed runtime for server-owned Section tools from server-owned Energy context", async () => {
    const identity = {
      workspaceId: "preschool-demo-org",
      projectId: "preschool-demo",
      scopeId: "preschool-project",
      resource: "electricity",
      dataSnapshotId: "energy-snapshot-563f8939fd90dc2fbef0018a",
      projectReleaseId: "preschool-demo-template-v2",
      analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
      analysisPeriodTo: "2026-06-01T00:00:00.000Z",
      rendererKey: "preschool-overview",
      rendererVersion: "1",
      analysisPackId: "preschool-section-pack",
      analysisPackRevision: "v2",
      modelProfileId: "workspace-default",
      modelProfileRevision: 7,
      outputContractRevision: "preschool-section-interpretation-v4",
      validatorRevision: "acceptance-validator-v1",
      workflowRevision: "discover-accept-publish-v1",
      investigatorPromptRevision: "discovery-prompt-v2",
      editorPromptRevision: "not-applicable-v1",
      methodSkillId: "none",
      methodSkillRevision: "not-applicable-v1",
      artifactKind: "section-interpretation" as const,
      targetId: "standby-wastage",
    } as const satisfies EnergyIqOverviewAiArtifactIdentity;
    const pack: PreschoolSectionPackV2 = {
      contract: { id: "preschool-section-pack", revision: "preschool-section-pack-v2" },
      sectionId: "standby-wastage",
      audience: "non-technical energy manager",
      analysisGoal: "Identify supported closed-hour patterns.",
      binding: {
        workspaceId: identity.workspaceId,
        projectId: identity.projectId,
        scopeId: identity.scopeId,
        dataSnapshotId: identity.dataSnapshotId,
        projectReleaseId: identity.projectReleaseId,
        analysisPeriod: { from: identity.analysisPeriodFrom, to: identity.analysisPeriodTo },
        modelProfileId: identity.modelProfileId,
        modelProfileRevision: identity.modelProfileRevision,
      },
      evidence: [{
        id: "evidence:standby:summary",
        label: "Closed-hours summary",
        value: { closedHoursSharePct: 12 },
        unit: "%",
        entityRefs: [],
        evidenceRefs: ["evidence:standby:summary"],
      }],
      alreadyPresentedFacts: [],
      crossSectionIndex: [],
      dataQuality: {
        status: "complete",
        coveragePct: 100,
        expectedMeterIntervalCount: 1,
        validIntervalCount: 1,
        qualityEventCount: 0,
        cumulativeDeltaMismatchCount: 0,
        averageKwMismatchCount: 0,
        invalidIntervalDurationCount: 0,
        importBatchIds: [],
      },
      limitations: [],
      missingEvidence: [],
      capabilities: {
        revision: "scoped-read-only-v1",
        mode: "scoped-read-only",
        tools: ["inspect_time_pattern", "inspect_load_composition", "inspect_related_section_signals"],
      },
    };
    const input = buildOverviewAiStageRunInput({
      stage: "section-interpreter",
      prompt: buildPreschoolSectionDiscoveryPrompt(pack),
      identity,
      workspaceId: identity.workspaceId,
      user: {
        id: "dev-user",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      runId: "section-run",
      sessionId: "section-session",
    });
    const externalContext = Reflect.get(input.forwardedProps, "externalContext") as {
      projectId: string;
      scopeId: string;
      resource: "electricity";
      from: string;
      to: string;
      period: "Custom";
    } | undefined;
    const workspaceRoot = mkdtempSync(join(tmpdir(), "preschool-section-runtime-red-"));
    let runtime: Awaited<ReturnType<typeof createDataFoundry>> | undefined;
    try {
      runtime = await createDataFoundry({
        analysisRequirementsMode: "omit",
        dataGateway: {} as never,
        emitter: { emit: () => undefined },
        excludedToolNames: ["inspect_schema", "run_sql_readonly", "protocol_handoff"],
        explicitProtocol: { protocolId: "data-analysis", protocolVersion: "1" },
        messages: input.messages,
        modelProvider: {
          kind: "openai-compatible",
          model: "openai/test-model",
          model_name: "test-model",
          provider_id: "openai-compatible",
        },
        runContext: createDataFoundryRunContext({
          user_id: "dev-user",
          workspace_id: identity.workspaceId,
          session_id: "section-session",
          run_id: "section-run",
          user_input: buildPreschoolSectionDiscoveryPrompt(pack),
          chat_mode: "copilotkit",
          model_name: "test-model",
          ...(externalContext
            ? {
                energy_query_context: {
                  projectId: externalContext.projectId,
                  projectName: "Preschool Portfolio",
                  scopeId: externalContext.scopeId,
                  scopeName: "Preschool Portfolio",
                  scopeType: "project",
                  resource: externalContext.resource,
                  timezone: "Asia/Singapore",
                  from: externalContext.from,
                  to: externalContext.to,
                  endExclusive: true,
                  period: externalContext.period,
                },
              }
            : {}),
        }),
        trustedStageTools: createPreschoolSectionTrustedStageTools({
          toolNames: pack.capabilities.tools,
          invoke: async () => ({}) as never,
        }),
        workspaceRoot,
      });
      expect(Object.keys(await runtime.agent.listTools()).sort()).toEqual([...pack.capabilities.tools].sort());
    } finally {
      await runtime?.destroyWorkspace();
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

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
      if (stage === "section-interpreter") {
        expect(input.forwardedProps).toMatchObject({
          externalContext: {
            source: "energyiq",
            projectId: "preschool-demo",
            scopeId: "preschool-project",
            resource: "electricity",
            from: "2026-05-01T00:00:00.000Z",
            to: "2026-06-01T00:00:00.000Z",
            expectedDataSnapshotId: "snapshot-current",
            expectedProjectReleaseId: "release-current",
            overviewAiStage: "section-interpreter",
          },
        });
      } else {
        expect(input.forwardedProps).not.toHaveProperty("externalContext");
      }
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
