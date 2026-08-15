import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import type { ConfigApiContext } from "../routes/types.js";
import { ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID } from "../workspace-model-profile-resolver.js";
import { ensureEnergyIqBootstrap, PRESCHOOL_WORKSPACE_ID } from "./energy-bootstrap.js";
import { handleEnergyApiRequest } from "./energy-api.js";
import { createProjectHarnessConfigurationReader } from "./project-harness-configuration.js";

describe("Project Harness Configuration", () => {
  it("describes exact current resources without promoting run-dependent selection or leaking connection details", () => {
    const root = mkdtempSync(join(tmpdir(), "project-harness-configuration-"));
    const metadataStore = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadataStore);
      const user = metadataStore.users.getById({ user_id: "dev-user" });
      const project = metadataStore.energyIq.getProject("preschool-demo");

      metadataStore.configResources.upsert({
        id: "system-model",
        workspace_id: ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID,
        user_id: user.id,
        kind: "model-profile",
        name: "System analysis model",
        payload: {
          provider: "openai-compatible",
          modelName: "model-system",
          baseUrl: "https://provider.internal.example/v1",
          contextLength: 32_768,
          maxTokens: 2_048,
        },
        secret_ref: "secret:model-system",
        default_enabled: true,
        status: "connected",
      });
      metadataStore.workspaceDefaultModelProfiles.set({
        workspace_id: ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID,
        profile_id: "system-model",
        profile_owner_user_id: user.id,
        configured_by_user_id: user.id,
      });
      metadataStore.configResources.upsert({
        id: "workspace-labelled-skill",
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        user_id: user.id,
        kind: "skill",
        name: "Workspace-labelled investigation",
        description: "A current-user resource whose declared Workspace scope is not storage-backed.",
        payload: {
          scope: "workspace",
          version: "2.0.0",
          allowedTools: ["run_sql_readonly"],
          packageFileRefId: "private-file-ref",
          builtinContentSha256: "a".repeat(64),
        },
        default_enabled: true,
        status: "valid",
      });
      metadataStore.configResources.upsert({
        id: "forecast-mcp",
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        user_id: user.id,
        kind: "mcp-server",
        name: "Forecast MCP",
        payload: {
          transport: "streamable-http",
          url: "https://mcp.internal.example",
          headers: { Authorization: "Bearer private-token" },
          toolManifest: [{ name: "forecast_read" }],
          toolAllowlist: ["forecast_read"],
        },
        secret_ref: "secret:mcp-forecast",
        default_enabled: true,
        status: "connected",
      });

      const state = createProjectHarnessConfigurationReader({
        metadataStore,
        user,
        workspaceId: PRESCHOOL_WORKSPACE_ID,
      })
        .readProjectHarnessConfiguration(project.id);

      expect(state).toMatchObject({
        project: {
          id: project.id,
          workspaceId: PRESCHOOL_WORKSPACE_ID,
          rendererKey: "preschool-overview",
        },
        resources: {
          models: [expect.objectContaining({
            id: "system-model",
            source: "server-system-binding",
            status: "connected",
            revision: 1,
            planningContext: expect.objectContaining({
              capabilitySource: "explicit-profile",
              contextWindow: 32_768,
              maxOutputTokens: 2_048,
            }),
          })],
          skills: [expect.objectContaining({
            id: "workspace-labelled-skill",
            physicalOwner: "user",
            declaredScope: "workspace",
            scopeStatus: "unverified",
            availability: "unavailable",
          })],
          mcpServers: [expect.objectContaining({
            id: "forecast-mcp",
            availability: "configured",
            connection: "persisted-status",
            toolManifest: {
              source: "persisted-last-test",
              toolNames: ["forecast_read"],
            },
          })],
        },
        harnesses: expect.arrayContaining([
          expect.objectContaining({
            id: "ai-analyst",
            resolution: "run-dependent",
            mcpServerIds: ["forecast-mcp"],
          }),
          expect.objectContaining({
            id: "additional-insights",
            resolution: "fixed-stage-contract",
            mcpServerIds: [],
            toolIds: expect.arrayContaining(["energy.evidence.read"]),
          }),
        ]),
      });
      const serialized = JSON.stringify(state);
      expect(serialized).not.toContain("private-token");
      expect(serialized).not.toContain("provider.internal.example");
      expect(serialized).not.toContain("mcp.internal.example");
      expect(serialized).not.toContain("private-file-ref");
      expect(serialized).not.toContain("secret:");
    } finally {
      metadataStore.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("uses the same verified model capability as Run planning", () => {
    const root = mkdtempSync(join(tmpdir(), "project-harness-configuration-model-"));
    const metadataStore = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadataStore);
      const user = metadataStore.users.getById({ user_id: "dev-user" });
      metadataStore.configResources.upsert({
        id: "verified-deepseek-model",
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        user_id: user.id,
        kind: "model-profile",
        name: "Verified DeepSeek model",
        payload: {
          provider: "openai-compatible",
          modelName: "deepseek-v4-flash",
          baseUrl: "https://api.deepseek.com/v1",
        },
        secret_ref: "secret:verified-deepseek-model",
        default_enabled: true,
        status: "connected",
      });

      const state = createProjectHarnessConfigurationReader({
        metadataStore,
        user,
        workspaceId: PRESCHOOL_WORKSPACE_ID,
      }).readProjectHarnessConfiguration("preschool-demo");

      expect(state.resources.models).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: "verified-deepseek-model",
          planningContext: {
            capabilitySource: "verified-model-default",
            contextWindow: 1_000_000,
            maxOutputTokens: 32_000,
            outputReserve: 32_000,
            safetyMargin: 4_096,
            inputBudget: 963_904,
          },
        }),
      ]));
    } finally {
      metadataStore.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("does not confuse the EnergyIQ system binding with Analyst model candidates", () => {
    const root = mkdtempSync(join(tmpdir(), "project-harness-configuration-routing-"));
    const metadataStore = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadataStore);
      const user = metadataStore.users.getById({ user_id: "dev-user" });
      metadataStore.configResources.upsert({
        id: "overview-system-model",
        workspace_id: ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID,
        user_id: user.id,
        kind: "model-profile",
        name: "Overview system model",
        payload: { provider: "openai-compatible", modelName: "overview-model", contextLength: 32_768 },
        default_enabled: true,
        status: "connected",
      });
      metadataStore.workspaceDefaultModelProfiles.set({
        workspace_id: ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID,
        profile_id: "overview-system-model",
        profile_owner_user_id: user.id,
        configured_by_user_id: user.id,
      });
      metadataStore.configResources.upsert({
        id: "analyst-model",
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        user_id: user.id,
        kind: "model-profile",
        name: "Analyst model",
        payload: { provider: "openai-compatible", modelName: "analyst-model", contextLength: 16_384 },
        default_enabled: true,
        status: "connected",
      });

      const state = createProjectHarnessConfigurationReader({
        metadataStore,
        user,
        workspaceId: PRESCHOOL_WORKSPACE_ID,
      }).readProjectHarnessConfiguration("preschool-demo");
      const analyst = state.harnesses.find(({ id }) => id === "ai-analyst");
      const additional = state.harnesses.find(({ id }) => id === "additional-insights");

      expect(analyst?.modelIds).toEqual(["analyst-model"]);
      expect(additional?.modelIds).toEqual(["overview-system-model"]);
    } finally {
      metadataStore.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("does not invent Preschool stage contracts for Ngee Ann and degrades locally", () => {
    const root = mkdtempSync(join(tmpdir(), "project-harness-configuration-profile-"));
    const metadataStore = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadataStore);
      const user = metadataStore.users.getById({ user_id: "dev-user" });

      const state = createProjectHarnessConfigurationReader({
        metadataStore,
        user,
        workspaceId: "default",
      }).readProjectHarnessConfiguration("ngee-ann-polytechnic");

      expect(state).toMatchObject({
        status: "partially-unavailable",
        project: {
          id: "ngee-ann-polytechnic",
          workspaceId: "default",
          rendererKey: "ngee-ann-overview",
        },
        unavailable: [expect.objectContaining({ id: "server-system-model" })],
      });
      expect(state.harnesses.map(({ id }) => id)).toEqual(["ai-analyst"]);
      expect(state.harnesses[0]).toMatchObject({
        status: "unavailable",
        resolution: "run-dependent",
      });
    } finally {
      metadataStore.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("serves the Admin read model privately without starting Provider work", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-harness-configuration-api-"));
    const metadataStore = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadataStore);
      const project = metadataStore.energyIq.getProject("preschool-demo");
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

      const response = await handleEnergyApiRequest(
        getRequest(`/api/v1/energy/projects/${project.id}/harness-configuration`),
        ["projects", project.id, "harness-configuration"],
        context,
      );

      expect(response).toMatchObject({
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
        body: {
          success: true,
          data: {
            project: { id: project.id, workspaceId: PRESCHOOL_WORKSPACE_ID },
            harnesses: expect.arrayContaining([
              expect.objectContaining({ id: "ai-analyst", resolution: "run-dependent" }),
            ]),
          },
        },
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

  it("fails closed for a non-Admin and for a cross-Workspace Project", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-harness-configuration-auth-"));
    const metadataStore = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadataStore);
      metadataStore.users.upsertDevUser({
        id: "project-viewer",
        email: "project-viewer@example.test",
        display_name: "Project Viewer",
        dev_token: "project-viewer-token",
      });
      metadataStore.workspaceMemberships.upsert({
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        user_id: "project-viewer",
        role: "member",
      });
      metadataStore.energyIq.upsertUserRole({ user_id: "project-viewer", role: "user" });
      metadataStore.energyIq.upsertProjectAccess({
        project_id: "preschool-demo",
        user_id: "project-viewer",
        role: "viewer",
      });
      const providerWorkflow = {
        resolveCurrentIdentity: vi.fn(),
        read: vi.fn(),
        execute: vi.fn(),
      };
      const baseContext = {
        metadataStore,
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        overviewAiWorkflow: providerWorkflow,
        additionalAiInsightsWorkflow: { execute: vi.fn() },
      } as unknown as Required<ConfigApiContext>;

      const nonAdmin = await handleEnergyApiRequest(
        getRequest("/api/v1/energy/projects/preschool-demo/harness-configuration"),
        ["projects", "preschool-demo", "harness-configuration"],
        { ...baseContext, userId: "project-viewer" },
      );
      const crossWorkspace = await handleEnergyApiRequest(
        getRequest("/api/v1/energy/projects/preschool-demo/harness-configuration"),
        ["projects", "preschool-demo", "harness-configuration"],
        { ...baseContext, userId: "dev-user", workspaceId: "default" },
      );

      expect(nonAdmin.status).toBe(403);
      expect(crossWorkspace.status).toBe(403);
      expect(providerWorkflow.resolveCurrentIdentity).not.toHaveBeenCalled();
      expect(providerWorkflow.read).not.toHaveBeenCalled();
      expect(providerWorkflow.execute).not.toHaveBeenCalled();
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
