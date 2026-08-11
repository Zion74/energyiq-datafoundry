import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDataFoundry } from "./index.js";

const workspaceRoots: string[] = [];

type ExecutableRuntimeTool = {
  description?: string;
  execute?: (input: Record<string, unknown>, options: Record<string, unknown>) => Promise<unknown>;
};

afterEach(() => {
  for (const workspaceRoot of workspaceRoots.splice(0)) {
    rmSync(workspaceRoot, { force: true, recursive: true });
  }
});

const createEnergyIqAgent = async (
  excludedToolNames: readonly string[],
  options: {
    dataGateway?: unknown;
    emittedEvents?: unknown[];
    overviewAiCandidateSubmission?: boolean;
  } = {},
) => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "datafoundry-agent-policy-"));
  workspaceRoots.push(workspaceRoot);
  return createDataFoundry({
    analysisRequirementsMode: "omit",
    dataGateway: (options.dataGateway ?? {}) as never,
    emitter: { emit: (event: unknown) => { options.emittedEvents?.push(event); } },
    excludedToolNames,
    explicitProtocol: { protocolId: "data-analysis", protocolVersion: "1" },
    messages: [],
    modelProvider: {
      kind: "openai-compatible",
      model: "openai/test-model",
      model_name: "test-model",
      provider_id: "openai-compatible",
    },
    ...(options.overviewAiCandidateSubmission ? { overviewAiCandidateSubmission: true } : {}),
    runContext: {
      user_id: "user-1",
      workspace_id: "workspace-1",
      session_id: "session-1",
      run_id: `run-${workspaceRoots.length}`,
      user_input: "Select the strongest Overview findings.",
      chat_mode: "copilotkit",
      enabled_datasource_ids: ["energy"],
      selected_datasource_id: "energy",
      model_name: "test-model",
      energy_query_context: {
        projectId: "preschool-demo",
        projectName: "Preschool Portfolio",
        scopeId: "project",
        scopeName: "Preschool Portfolio",
        scopeType: "project",
        resource: "electricity",
        timezone: "Asia/Singapore",
        from: "2026-05-01T16:00:00.000Z",
        to: "2026-06-01T16:00:00.000Z",
        endExclusive: true,
        period: "Custom",
      },
    },
    workspaceRoot,
  });
};

describe("EnergyIQ agent policy follows the enabled tool set", () => {
  it("gives a no-tool Editor selection-only instructions instead of requiring Schema or SQL", async () => {
    const runtime = await createEnergyIqAgent([
      "inspect_schema",
      "run_sql_readonly",
      "protocol_handoff",
    ]);

    try {
      const instructions = await runtime.agent.getInstructions();
      const text = typeof instructions === "string" ? instructions : JSON.stringify(instructions);

      expect(text).toContain("selection-only");
      expect(text).toContain("zero to three concise Findings");
      expect(text).toContain("No tools are enabled for this run");
      expect(text).not.toContain("Call inspect_schema alone");
      expect(text).not.toContain("reuse that inspection's schema_id in run_sql_readonly");
      expect(text).not.toContain("Analyze data by calling tools");
      expect(text).not.toContain("You may query any datasource in the list above");
    } finally {
      await runtime.destroyWorkspace();
    }
  });

  it("does not attach Workspace Skill tools when a lightweight stage excludes all Skill entrypoints", async () => {
    const runtime = await createEnergyIqAgent([
      "skill",
      "skill_search",
      "skill_read",
      "inspect_schema",
      "run_sql_readonly",
      "protocol_handoff",
    ]);

    try {
      const tools = await runtime.agent.listTools();
      expect(tools).not.toHaveProperty("skill");
      expect(tools).not.toHaveProperty("skill_search");
      expect(tools).not.toHaveProperty("skill_read");
    } finally {
      await runtime.destroyWorkspace();
    }
  });

  it("retains the Investigator trusted-query policy when Schema and SQL are enabled", async () => {
    const runtime = await createEnergyIqAgent(["protocol_handoff"], {
      overviewAiCandidateSubmission: true,
    });

    try {
      const instructions = await runtime.agent.getInstructions();
      const text = typeof instructions === "string" ? instructions : JSON.stringify(instructions);
      const tools = await runtime.agent.listTools();

      expect(text).toContain("EnergyIQ trusted-query fast path");
      expect(text).toContain("Call inspect_schema alone as the initial governed-contract setup action");
      expect(text).toContain("reuse that inspection's schema_id in run_sql_readonly");
      expect(text).not.toContain("EnergyIQ selection-only path");
      expect(Object.keys(tools)).toEqual(expect.arrayContaining([
        "inspect_schema",
        "run_sql_readonly",
        "overview_ai_candidates_submit",
      ]));
      expect(tools).not.toHaveProperty("protocol_handoff");
    } finally {
      await runtime.destroyWorkspace();
    }
  });

  it("numbers only successful Investigator SQL results and tells the model to copy the returned index", async () => {
    const emittedEvents: unknown[] = [];
    const runtime = await createEnergyIqAgent(["protocol_handoff"], {
      dataGateway: {
        inspectSchema: async () => ({
          datasource_id: "energy",
          dialect: "duckdb",
          tables: [{ name: "energy_fact", columns: [{ name: "usage_kwh", type: "DOUBLE" }] }],
        }),
        runSqlReadonly: async ({ sql }: { sql: string }) => {
          if (sql.includes("fail")) throw new Error("TEST_SQL_FAILURE");
          return {
            columns: ["usage_kwh"],
            rows: [[sql.includes("second") ? 2 : 1]],
            row_count: 1,
            audit_log_id: `audit-${sql}`,
          };
        },
      },
      emittedEvents,
      overviewAiCandidateSubmission: true,
    });

    try {
      const tools = await runtime.agent.listTools();
      const inspectSchema = tools.inspect_schema as ExecutableRuntimeTool;
      const runSqlReadonly = tools.run_sql_readonly as ExecutableRuntimeTool;
      const inspected = await inspectSchema.execute?.({}, {});
      const schemaId = (inspected as { schema_id?: unknown }).schema_id;

      expect(typeof schemaId).toBe("string");
      await expect(runSqlReadonly.execute?.({ schema_id: schemaId, sql: "SELECT fail" }, {}))
        .rejects.toThrow("TEST_SQL_FAILURE");
      await expect(runSqlReadonly.execute?.({ schema_id: schemaId, sql: "SELECT first" }, { agent: { toolCallId: "sql-first" } }))
        .resolves.toMatchObject({ evidence_index: 1 });
      await expect(runSqlReadonly.execute?.({ schema_id: schemaId, sql: "SELECT second" }, { agent: { toolCallId: "sql-second" } }))
        .resolves.toMatchObject({ evidence_index: 2 });
      expect(emittedEvents).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "TOOL_CALL_RESULT",
          toolCallId: "sql-first",
          content: expect.stringMatching(/^\{"evidence_index":1,/),
        }),
        expect.objectContaining({
          type: "TOOL_CALL_RESULT",
          toolCallId: "sql-second",
          content: expect.stringMatching(/^\{"evidence_index":2,/),
        }),
      ]));
      expect(runSqlReadonly.description).toContain("copy the returned evidence_index exactly");

      const instructions = await runtime.agent.getInstructions();
      const text = typeof instructions === "string" ? instructions : JSON.stringify(instructions);
      expect(text).toContain("Copy the returned evidence_index exactly");
      expect(text).toContain("Do not count or reconstruct SQL Evidence indexes yourself");
    } finally {
      await runtime.destroyWorkspace();
    }
  });

  it("leaves ordinary Analyst SQL results and instructions unchanged", async () => {
    const runtime = await createEnergyIqAgent(["protocol_handoff"], {
      dataGateway: {
        inspectSchema: async () => ({
          datasource_id: "energy",
          dialect: "duckdb",
          tables: [{ name: "energy_fact", columns: [{ name: "usage_kwh", type: "DOUBLE" }] }],
        }),
        runSqlReadonly: async () => ({
          columns: ["usage_kwh"],
          rows: [[1]],
          row_count: 1,
          audit_log_id: "audit-ordinary",
        }),
      },
    });

    try {
      const tools = await runtime.agent.listTools();
      const inspectSchema = tools.inspect_schema as ExecutableRuntimeTool;
      const runSqlReadonly = tools.run_sql_readonly as ExecutableRuntimeTool;
      const inspected = await inspectSchema.execute?.({}, {});
      const schemaId = (inspected as { schema_id?: unknown }).schema_id;
      const result = await runSqlReadonly.execute?.({ schema_id: schemaId, sql: "SELECT ordinary" }, {});

      expect(result).not.toHaveProperty("evidence_index");
      expect(runSqlReadonly.description).not.toContain("evidence_index");
      const instructions = await runtime.agent.getInstructions();
      const text = typeof instructions === "string" ? instructions : JSON.stringify(instructions);
      expect(text).not.toContain("evidence_index assigned by this Run");
    } finally {
      await runtime.destroyWorkspace();
    }
  });
});
