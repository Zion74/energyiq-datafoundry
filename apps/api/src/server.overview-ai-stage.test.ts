import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDataFoundry, createDataFoundryRunContext } from "@datafoundry/agent-runtime";
import type { EnergyIqOverviewAiArtifactIdentity } from "@datafoundry/metadata";

import {
  buildOverviewAiStageRunInput,
  collectOverviewAiText,
  createPreschoolAdditionalAiInsightTrustedStageTools,
  createPreschoolSectionTrustedStageTools,
  resolveOverviewAiAgentRuntimeOptions,
  resolveOverviewAiServerRunnerOptions,
  resolveOverviewAiStageRuntimeOptions,
  resolveOverviewAiStageStructuredOutput,
  shouldUseEnergyContextForOverviewAiStage,
  shouldIncludeProjectAnalysisEvidenceContext,
} from "./server.js";
import {
  PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V2,
  PRESCHOOL_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V4,
  PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V4,
} from "./energy/preschool-overview-ai-structured-output.js";
import { buildPreschoolSectionDiscoveryPrompt } from "./energy/preschool-section-interpreter.js";
import type { PreschoolSectionPackV2 } from "./energy/preschool-section-pack-v2.js";
import { MAX_PRESCHOOL_EXECUTIVE_PROMPT_CHARS } from "./energy/preschool-executive-synthesis.js";
import { MAX_PRESCHOOL_ADDITIONAL_DISCOVERY_PROMPT_CHARS } from "./energy/preschool-additional-ai-insights-workflow.js";

describe("Overview AI server stage options", () => {
  it("isolates Additional discovery to server-owned contract tools and current EnergyIQ pins", () => {
    const toolNames = [
      "energy.evidence.read",
      "energy.metrics.compare",
      "energy.timeseries.analyze",
      "energy.snapshot-history.read",
      "energy.project-knowledge.read",
    ] as const;
    const invokeAdditionalInsightTool = async () => ({}) as never;
    const trusted = resolveOverviewAiServerRunnerOptions({
      stage: "additional-insights-discovery",
      structuredOutput: PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V2,
      additionalInsightTools: toolNames,
      invokeAdditionalInsightTool,
    });

    const currentRuntime = resolveOverviewAiStageRuntimeOptions("additional-insights-discovery");
    expect(currentRuntime).toMatchObject({
      analysisRequirementsMode: "omit",
      disableTools: true,
      excludedToolNames: [
        "skill", "skill_search", "skill_read", "inspect_schema", "run_sql_readonly", "protocol_handoff",
      ],
      overviewAiCandidateSubmission: false,
    });
    expect(currentRuntime.structuredOutput).toBe(PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V2);
    expect(trusted).toMatchObject({
      disableTools: false,
      conversationMessageMaxChars: MAX_PRESCHOOL_ADDITIONAL_DISCOVERY_PROMPT_CHARS,
    });
    expect(trusted?.structuredOutput).toBe(PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V2);
    expect(Object.keys(trusted?.trustedStageTools ?? {}).sort()).toEqual([...toolNames].sort());
    expect(Object.keys(createPreschoolAdditionalAiInsightTrustedStageTools({
      toolNames,
      invoke: invokeAdditionalInsightTool,
    })).sort()).toEqual([...toolNames].sort());
    expect(shouldUseEnergyContextForOverviewAiStage("additional-insights-discovery")).toBe(true);
    expect(shouldIncludeProjectAnalysisEvidenceContext("additional-insights-discovery")).toBe(false);

    const run = buildOverviewAiStageRunInput({
      stage: "additional-insights-discovery",
      prompt: "Open discovery.",
      identity: additionalIdentity(),
      workspaceId: "preschool-workspace",
      user: { id: "dev-user" } as never,
      runId: "additional-run",
      sessionId: "additional-session",
    });
    expect(run.tools).toEqual([]);
    expect(run.forwardedProps).toMatchObject({
      externalContext: {
        source: "energyiq",
        projectId: "preschool-demo",
        scopeId: "preschool-project",
        expectedDataSnapshotId: "snapshot-current",
        expectedProjectReleaseId: "release-current",
        overviewAiStage: "additional-insights-discovery",
      },
      run_config: {
        skillMode: "none",
        enabledMcpServerIds: [],
        enabledSkillIds: [],
        skillPolicy: { allowedToolNames: [] },
      },
    });
  });

  it("registers Additional tools in the real governed runtime and nowhere else", async () => {
    const toolNames = [
      "energy.evidence.read",
      "energy.metrics.compare",
      "energy.timeseries.analyze",
      "energy.snapshot-history.read",
      "energy.project-knowledge.read",
    ] as const;
    const identity = additionalIdentity();
    const input = buildOverviewAiStageRunInput({
      stage: "additional-insights-discovery",
      prompt: "Open discovery.",
      identity,
      workspaceId: identity.workspaceId,
      user: { id: "dev-user" } as never,
      runId: "additional-runtime-run",
      sessionId: "additional-runtime-session",
    });
    const workspaceRoot = mkdtempSync(join(tmpdir(), "preschool-additional-runtime-"));
    let runtime: Awaited<ReturnType<typeof createDataFoundry>> | undefined;
    try {
      runtime = await createDataFoundry({
        analysisRequirementsMode: "omit",
        dataGateway: {} as never,
        emitter: { emit: () => undefined },
        excludedToolNames: [
          "skill", "skill_search", "skill_read", "inspect_schema", "run_sql_readonly", "protocol_handoff",
        ],
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
          session_id: "additional-runtime-session",
          run_id: "additional-runtime-run",
          user_input: "Open discovery.",
          chat_mode: "copilotkit",
          model_name: "test-model",
          energy_query_context: {
            projectId: identity.projectId,
            projectName: "Preschool Portfolio",
            scopeId: identity.scopeId,
            scopeName: "Preschool Portfolio",
            scopeType: "project",
            resource: "electricity",
            timezone: "Asia/Singapore",
            from: identity.analysisPeriodFrom,
            to: identity.analysisPeriodTo,
            endExclusive: true,
            period: "Custom",
          },
        }),
        trustedStageTools: createPreschoolAdditionalAiInsightTrustedStageTools({
          toolNames,
          invoke: async () => ({}) as never,
        }),
        workspaceRoot,
      });
      expect(Object.keys(await runtime.agent.listTools()).sort()).toEqual([...toolNames].sort());

      const ordinary = resolveOverviewAiServerRunnerOptions({
        stage: "executive-synthesis",
        structuredOutput: PRESCHOOL_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V4,
        additionalInsightTools: toolNames,
        invokeAdditionalInsightTool: async () => ({}) as never,
      });
      expect(ordinary).not.toHaveProperty("trustedStageTools");
    } finally {
      await runtime?.destroyWorkspace();
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

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
    expect(trusted).toEqual({
      structuredOutput: PRESCHOOL_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V4,
      conversationMessageMaxChars: MAX_PRESCHOOL_EXECUTIVE_PROMPT_CHARS,
    });
    expect(resolveOverviewAiAgentRuntimeOptions("executive-synthesis", trusted)).toMatchObject({
      structuredOutput: PRESCHOOL_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V4,
      conversationMessageMaxChars: MAX_PRESCHOOL_EXECUTIVE_PROMPT_CHARS,
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

  it("carries the bounded current-v4 Executive projection through the real governed runtime without Energy or SQL tools", async () => {
    const identity = {
      workspaceId: "preschool-demo-org",
      projectId: "preschool-demo",
      scopeId: "preschool-project",
      resource: "electricity",
      dataSnapshotId: "energy-snapshot-563f8939fd90dc2fbef0018a",
      projectReleaseId: "preschool-demo-template-v2",
      analysisPeriodFrom: "2026-04-30T16:00:00.000Z",
      analysisPeriodTo: "2026-05-31T16:00:00.000Z",
      rendererKey: "preschool-overview",
      rendererVersion: "1",
      analysisPackId: "preschool-executive-section-artifacts",
      analysisPackRevision: "section-interpretation-v4",
      modelProfileId: "workspace-default",
      modelProfileRevision: 7,
      outputContractRevision: "preschool-executive-synthesis-v4",
      validatorRevision: "preschool-executive-synthesis-validator-v5",
      workflowRevision: "preschool-executive-synthesis-v5",
      investigatorPromptRevision: "preschool-executive-synthesis-prompt-v5",
      editorPromptRevision: "not-applicable-v1",
      methodSkillId: "none",
      methodSkillRevision: "not-applicable-v1",
      artifactKind: "executive-synthesis" as const,
      targetId: "sections:current-v4",
    } as const satisfies EnergyIqOverviewAiArtifactIdentity;
    const prompt = "E".repeat(MAX_PRESCHOOL_EXECUTIVE_PROMPT_CHARS);
    const input = buildOverviewAiStageRunInput({
      stage: "executive-synthesis",
      prompt,
      identity,
      workspaceId: identity.workspaceId,
      user: {
        id: "dev-user",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      runId: "executive-run-budget",
      sessionId: "executive-session-budget",
    });
    expect(input.messages[0]?.content).toBe(prompt);
    expect(input.forwardedProps).not.toHaveProperty("externalContext");

    const workspaceRoot = mkdtempSync(join(tmpdir(), "preschool-executive-runtime-budget-"));
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
          session_id: "executive-session-budget",
          run_id: "executive-run-budget",
          user_input: prompt,
          chat_mode: "copilotkit",
          model_name: "test-model",
        }),
        workspaceRoot,
      });
      const toolNames = Object.keys(await runtime.agent.listTools());
      expect(toolNames).not.toEqual(expect.arrayContaining([
        "inspect_schema",
        "run_sql_readonly",
        "protocol_handoff",
        "compare_centres",
        "inspect_time_pattern",
        "inspect_load_composition",
        "inspect_related_section_signals",
      ]));
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

const additionalIdentity = (): EnergyIqOverviewAiArtifactIdentity => ({
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
  analysisPackId: "preschool-additional-insights-pack",
  analysisPackRevision: "v1",
  modelProfileId: "workspace-default",
  modelProfileRevision: 7,
  outputContractRevision: "energyiq-additional-ai-insights-v2",
  validatorRevision: "additional-insights-acceptance-v3",
  workflowRevision: "additional-insights-discover-accept-publish-v3",
  investigatorPromptRevision: "additional-insights-discovery-v3",
  editorPromptRevision: "additional-insights-publication-v2",
  methodSkillId: "energyiq-open-discovery",
  methodSkillRevision: "1.0.0",
  artifactKind: "autonomous-insights",
  identityContractRevision: "additional-insights-v3",
  methodSetId: "preschool-additional-insights-current",
  methodSetRevision: "v1",
  methodSetFingerprint: `sha256:${"a".repeat(64)}`,
  capabilityRevision: "scoped-read-only-v1",
  publicationRevision: "additional-insights-v2",
  canvasRevision: "energyiq-insight-canvas-v2",
});
