import { EventType } from "@ag-ui/core";
import { createCustomEvent } from "@datafoundry/agent-runtime";
import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import type { ConfigApiContext } from "../routes/types.js";
import { ensureEnergyIqBootstrap, PRESCHOOL_WORKSPACE_ID } from "./energy-bootstrap.js";
import { handleEnergyApiRequest } from "./energy-api.js";
import { createProjectAiOperationsReader } from "./project-ai-operations.js";

describe("Project AI Operations", () => {
  it("projects exact historical Run evidence without backfilling current configuration", () => {
    const root = mkdtempSync(join(tmpdir(), "project-ai-operations-"));
    const metadataStore = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadataStore);
      const user = metadataStore.users.getById({ user_id: "dev-user" });
      metadataStore.sessions.create({
        id: "session-historical",
        user_id: user.id,
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        project_id: "preschool-demo",
        title: "Private customer conversation title",
      });
      metadataStore.runs.create({
        id: "run-historical",
        user_id: user.id,
        session_id: "session-historical",
        user_input: "Private customer prompt must not be returned",
        model_provider: "openai-compatible",
        model_name: "historical-model",
      });
      append(createCustomEvent("run.config.resolved", {
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        overview_ai_stage: "additional-insights-investigator",
        active_llm_profile_id: "historical-profile",
        resource_revisions: {
          "model-profile:historical-profile": 7,
          "skill:historical-skill": 4,
        },
        selected_skill_ids: ["historical-skill"],
        enabled_mcp_server_ids: ["historical-mcp"],
        context_window: 128_000,
        input_budget: 119_808,
        secret: "must-not-render",
      }));
      append(createCustomEvent("skill.selection", {
        mode: "auto",
        selected: [{ id: "historical-skill", name: "Historical Skill", revision: 4, tags: ["energy"] }],
        audit: [{ skillId: "historical-skill", decision: "selected", reasons: ["explicit"] }],
      }));
      append(createCustomEvent("context.compiled", {
        step_number: 1,
        package_id: "context-package-1",
        package_revision: 2,
        plan_id: "context-plan-1",
        selected_group_ids: ["project", "evidence"],
        omitted_group_ids: ["long-term-memory"],
        selected_sources: [{ source_types: ["project-analysis-snapshot", "evidence"] }],
        omitted_sources: [{ source_types: ["long-term-memory"] }],
        decisions: [{ strategyId: "drop-low-priority", tokenSavings: 80 }],
        budget: {
          capabilitySource: "explicit-profile",
          contextWindow: 128_000,
          maxOutputTokens: 4_096,
          outputReserve: 4_096,
          safetyMargin: 4_096,
          inputBudget: 119_808,
        },
        token_report: {
          systemTokens: 120,
          toolTokens: 80,
          messageTokens: 400,
          totalInputTokens: 600,
          remainingTokens: 119_208,
          countQuality: "estimated",
        },
        prompt_tokens: 600,
        remaining_tokens: 119_208,
        high_water_mark: "normal",
        prompt: "Private materialized prompt must not be returned",
      }));
      append(createCustomEvent("context.prompt-verified", {
        step_number: 1,
        prompt_tokens: 620,
        input_budget: 119_808,
        context_window: 128_000,
        remaining_tokens: 119_188,
        capability_source: "explicit-profile",
      }));
      append({ type: EventType.TOOL_CALL_START, toolCallId: "call-success", toolCallName: "energy.evidence.read" });
      append({
        type: EventType.TOOL_CALL_RESULT,
        toolCallId: "call-success",
        toolCallName: "energy.evidence.read",
        content: JSON.stringify({ success: true, privateRows: ["must-not-render"] }),
      });
      append({ type: EventType.TOOL_CALL_START, toolCallId: "call-rejected", toolCallName: "run_sql_readonly" });
      append({
        type: EventType.TOOL_CALL_RESULT,
        toolCallId: "call-rejected",
        toolCallName: "run_sql_readonly",
        content: JSON.stringify({ success: false, error: "SQL_BLOCKED" }),
      });
      append({ type: EventType.TOOL_CALL_START, toolCallId: "call-pending", toolCallName: "inspect_schema" });
      append(createCustomEvent("token_usage", {
        input_tokens: 700,
        output_tokens: 180,
        total_tokens: 880,
        cache_telemetry_available: true,
        cache_hit_tokens: 200,
        cache_miss_tokens: 500,
      }));
      append({ type: EventType.RUN_FINISHED });
      metadataStore.runs.updateStatus({ user_id: user.id, run_id: "run-historical", status: "completed" });
      metadataStore.artifacts.create({
        id: "artifact-historical",
        user_id: user.id,
        session_id: "session-historical",
        run_id: "run-historical",
        type: "table",
        name: "Evidence table",
        storage_path: "private/storage/path.csv",
        preview_json: { privateRows: ["must-not-render"] },
      });
      const artifactIdentity = {
        artifactKind: "autonomous-insights",
        targetId: "preschool-project",
      };
      const artifactResult = {
        runId: "run-historical",
        findings: [{ id: "finding-historical", text: "Private finding text must not be returned" }],
      };
      metadataStore.db.prepare(`
        INSERT INTO energyiq_overview_ai_artifacts (
          id, identity_hash, identity_json, workspace_id, project_id, scope_id,
          resource, data_snapshot_id, project_release_id, renderer_key,
          renderer_version, analysis_pack_id, analysis_pack_revision,
          model_profile_id, model_profile_revision, output_contract_revision,
          validator_revision, status, attempt_count, triggered_by,
          session_id, run_id, result_json, created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'electricity', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          'available', 1, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "energy-artifact-historical",
        "identity-historical",
        JSON.stringify(artifactIdentity),
        PRESCHOOL_WORKSPACE_ID,
        "preschool-demo",
        "preschool-project",
        "preschool-snapshot",
        "preschool-release",
        "preschool-overview",
        "1",
        "preschool-additional-insights",
        "12",
        "historical-profile",
        7,
        "additional-v12",
        "validator-v12",
        user.id,
        "session-historical",
        "run-historical",
        JSON.stringify(artifactResult),
        "2026-08-15T10:00:00.000Z",
        "2026-08-15T10:01:00.000Z",
        "2026-08-15T10:01:00.000Z",
      );

      metadataStore.configResources.upsert({
        id: "historical-profile",
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        user_id: user.id,
        kind: "model-profile",
        name: "Current replacement profile",
        payload: { modelName: "current-model", contextLength: 1_000_000 },
        default_enabled: true,
        status: "connected",
      });
      metadataStore.configResources.upsert({
        id: "historical-mcp",
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        user_id: user.id,
        kind: "mcp-server",
        name: "Current MCP",
        payload: {
          url: "https://current-mcp.example",
          headers: { Authorization: "Bearer current-secret" },
          toolManifest: [{ name: "current_tool_must_not_backfill" }],
        },
        default_enabled: true,
        status: "connected",
      });

      const state = createProjectAiOperationsReader({
        metadataStore,
        user,
        workspaceId: PRESCHOOL_WORKSPACE_ID,
      }).readProjectAiOperations("preschool-demo", { runId: "run-historical" });

      expect(state.runs).toEqual([
        expect.objectContaining({
          runId: "run-historical",
          actorId: user.id,
          status: "completed",
          stage: "additional-insights-investigator",
          modelName: "historical-model",
          inputTokens: 700,
          outputTokens: 180,
          toolCounts: { called: 3, succeeded: 1, rejected: 1, failed: 0 },
        }),
      ]);
      expect(state.selectedRun).toMatchObject({
        runId: "run-historical",
        historicalConfiguration: {
          status: "available",
          modelProfileId: "historical-profile",
          resourceRevisions: {
            "model-profile:historical-profile": 7,
            "skill:historical-skill": 4,
          },
          selectedSkills: [{ id: "historical-skill", name: "Historical Skill", revision: 4 }],
          loadedSkills: { status: "unavailable", items: [] },
          mcp: {
            enabledServerIds: ["historical-mcp"],
            serverToolMapping: { status: "unavailable", items: [] },
          },
        },
        context: {
          status: "available",
          steps: [expect.objectContaining({
            stepNumber: 1,
            selectedGroupCount: 2,
            omittedGroupCount: 1,
            selectedSourceTypes: ["evidence", "project-analysis-snapshot"],
            omittedSourceTypes: ["long-term-memory"],
            promptTokens: 620,
            inputBudget: 119_808,
          })],
        },
        tools: [
          expect.objectContaining({ toolCallId: "call-success", name: "energy.evidence.read", status: "succeeded" }),
          expect.objectContaining({ toolCallId: "call-rejected", name: "run_sql_readonly", status: "rejected" }),
          expect.objectContaining({ toolCallId: "call-pending", name: "inspect_schema", status: "called" }),
        ],
        tokens: {
          input: 700,
          output: 180,
          total: 880,
          cache: { status: "available", hit: 200, miss: 500 },
        },
        lineage: {
          artifacts: [{ id: "artifact-historical", type: "table", name: "Evidence table" }],
          energyIqArtifacts: [{
            id: "energy-artifact-historical",
            kind: "autonomous-insights",
            targetId: "preschool-project",
            findingIds: ["finding-historical"],
          }],
        },
      });
      const serialized = JSON.stringify(state);
      expect(serialized).not.toContain("Private customer");
      expect(serialized).not.toContain("Private materialized prompt");
      expect(serialized).not.toContain("Private finding text");
      expect(serialized).not.toContain("must-not-render");
      expect(serialized).not.toContain("current-model");
      expect(serialized).not.toContain("current_tool_must_not_backfill");
      expect(serialized).not.toContain("current-secret");
      expect(serialized).not.toContain("private/storage");

      function append(event: unknown): void {
        metadataStore.runEvents.append({
          user_id: user.id,
          run_id: "run-historical",
          session_id: "session-historical",
          event: event as never,
        });
      }
    } finally {
      metadataStore.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("allows an Admin to read all actors in one exact Project and rejects cross-Project detail", () => {
    const root = mkdtempSync(join(tmpdir(), "project-ai-operations-scope-"));
    const metadataStore = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadataStore);
      metadataStore.users.upsertDevUser({
        id: "project-analyst",
        email: "project-analyst@example.test",
        display_name: "Project Analyst",
        dev_token: "project-analyst-token",
      });
      metadataStore.workspaceMemberships.upsert({
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        user_id: "project-analyst",
        role: "member",
      });
      metadataStore.energyIq.upsertUserRole({ user_id: "project-analyst", role: "user" });
      metadataStore.energyIq.upsertProjectAccess({
        project_id: "preschool-demo",
        user_id: "project-analyst",
        role: "viewer",
      });
      metadataStore.sessions.create({
        id: "project-session",
        user_id: "project-analyst",
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        project_id: "preschool-demo",
      });
      metadataStore.runs.create({
        id: "project-run",
        user_id: "project-analyst",
        session_id: "project-session",
        user_input: "private",
      });
      metadataStore.sessions.create({
        id: "other-project-session",
        user_id: "dev-user",
        workspace_id: "default",
        project_id: "ngee-ann-polytechnic",
      });
      metadataStore.runs.create({
        id: "other-project-run",
        user_id: "dev-user",
        session_id: "other-project-session",
        user_input: "private",
      });

      const admin = metadataStore.users.getById({ user_id: "dev-user" });
      const reader = createProjectAiOperationsReader({
        metadataStore,
        user: admin,
        workspaceId: PRESCHOOL_WORKSPACE_ID,
      });

      expect(reader.readProjectAiOperations("preschool-demo").runs).toEqual([
        expect.objectContaining({ runId: "project-run", actorId: "project-analyst" }),
      ]);
      expect(() => reader.readProjectAiOperations("preschool-demo", { runId: "other-project-run" }))
        .toThrow("ENERGYIQ_RUN_FORBIDDEN");
      expect(() => createProjectAiOperationsReader({
        metadataStore,
        user: metadataStore.users.getById({ user_id: "project-analyst" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
      }).readProjectAiOperations("preschool-demo")).toThrow("ENERGYIQ_ADMIN_REQUIRED");
    } finally {
      metadataStore.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("serves private list and detail GETs without starting Provider work", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-ai-operations-api-"));
    const metadataStore = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadataStore);
      metadataStore.sessions.create({
        id: "operations-session",
        user_id: "dev-user",
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        project_id: "preschool-demo",
      });
      metadataStore.runs.create({
        id: "operations-run",
        user_id: "dev-user",
        session_id: "operations-session",
        user_input: "private",
      });
      const resolveCurrentIdentity = vi.fn();
      const read = vi.fn();
      const execute = vi.fn();
      const executeAdditional = vi.fn();
      const context = {
        metadataStore,
        userId: "dev-user",
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        overviewAiWorkflow: { resolveCurrentIdentity, read, execute },
        additionalAiInsightsWorkflow: { execute: executeAdditional },
      } as unknown as Required<ConfigApiContext>;

      const list = await handleEnergyApiRequest(
        getRequest("/api/v1/energy/projects/preschool-demo/ai-operations"),
        ["projects", "preschool-demo", "ai-operations"],
        context,
      );
      const detail = await handleEnergyApiRequest(
        getRequest("/api/v1/energy/projects/preschool-demo/ai-operations/runs/operations-run"),
        ["projects", "preschool-demo", "ai-operations", "runs", "operations-run"],
        context,
      );

      expect(list).toMatchObject({
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
        body: { success: true, data: { runs: [expect.objectContaining({ runId: "operations-run" })], selectedRun: null } },
      });
      expect(detail).toMatchObject({
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
        body: { success: true, data: { selectedRun: expect.objectContaining({ runId: "operations-run" }) } },
      });
      expect(resolveCurrentIdentity).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
      expect(executeAdditional).not.toHaveBeenCalled();
    } finally {
      metadataStore.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

function getRequest(url: string): IncomingMessage {
  const request = new PassThrough();
  Object.assign(request, { method: "GET", headers: {}, url });
  request.end();
  return request as unknown as IncomingMessage;
}
