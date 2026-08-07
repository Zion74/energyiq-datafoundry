import type { RunAgentInput } from "@ag-ui/client";
import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";

import type { ConfigApiContext } from "./routes/types.js";
import { resolveRunConfig } from "./run-config-resolver.js";
import {
  handleWorkspaceDefaultModelProfileRequest,
  workspaceDefaultModelProfileDto
} from "./workspace-model-profile-api.js";
import { resolveModelProfileChain } from "./workspace-model-profile-resolver.js";

describe("Workspace default model profile runtime", () => {
  it("lets a normal user run the admin profile without exposing its secret or fallback", async () => {
    const root = mkdtempSync(join(tmpdir(), "workspace-default-model-"));
    const metadata = createMetadataStore({
      database_path: join(root, "metadata.sqlite"),
      secret_master_key: "test-key"
    });
    metadata.workspaces.upsert({ id: "default", owner_user_id: "dev-user", name: "EnergyIQ", kind: "personal" });
    metadata.workspaces.upsert({ id: "customer-1", owner_user_id: "dev-user", name: "Customer", kind: "customer" });
    metadata.users.upsertDevUser({ id: "normal-user", email: "user@example.test", display_name: "Normal User", dev_token: "normal-token" });
    metadata.workspaceMemberships.upsert({ workspace_id: "customer-1", user_id: "normal-user", role: "member" });
    const secretRef = metadata.secrets.put({
      workspace_id: "default", user_id: "dev-user", owner_kind: "model-profile", owner_id: "deepseek-v4-flash",
      value: { apiKey: "server-only-test-secret" }
    });
    metadata.configResources.upsert({
      id: "deepseek-v4-flash", workspace_id: "default", user_id: "dev-user", kind: "model-profile",
      name: "DeepSeek V4 Flash", payload: {
        provider: "openai-compatible", modelName: "deepseek-v4-flash", baseUrl: "https://api.example.test/v1"
      }, secret_ref: secretRef, default_enabled: true, status: "connected"
    });
    const adminContext = {
      metadataStore: metadata, userId: "dev-user", workspaceId: "customer-1"
    } as Required<ConfigApiContext>;
    const configured = await handleWorkspaceDefaultModelProfileRequest(
      jsonRequest("PUT", { profileId: "deepseek-v4-flash" }),
      adminContext
    );
    expect(configured.status).toBe(200);

    const userContext = {
      metadataStore: metadata, userId: "normal-user", workspaceId: "customer-1"
    } as Required<ConfigApiContext>;
    await expect(handleWorkspaceDefaultModelProfileRequest(
      jsonRequest("PUT", { profileId: "deepseek-v4-flash" }),
      userContext
    )).rejects.toThrow("ENERGYIQ_ADMIN_REQUIRED");

    const resolved = resolveRunConfig({
      metadataStore: metadata,
      runInput: emptyRunInput(),
      userId: "normal-user",
      userInput: "Compare this period",
      workspaceId: "customer-1"
    });
    expect(resolved.effectiveRunConfig.activeLlmProfileId).toBe("workspace-default");
    expect(resolved.modelProvider.model_name).toBe("deepseek-v4-flash");
    expect(resolved.modelProvider).not.toHaveProperty("provider_ids");
    expect(metadata.configResources.list({
      workspace_id: "customer-1", user_id: "normal-user", kind: "model-profile"
    })).toEqual([]);

    const localSecretRef = metadata.secrets.put({
      workspace_id: "customer-1", user_id: "normal-user", owner_kind: "model-profile", owner_id: "local-model",
      value: { apiKey: "local-test-secret" }
    });
    metadata.configResources.upsert({
      id: "local-model", workspace_id: "customer-1", user_id: "normal-user", kind: "model-profile",
      name: "Local model", payload: {
        provider: "openai-compatible", modelName: "local-model", baseUrl: "https://local.example.test/v1"
      }, secret_ref: localSecretRef, default_enabled: true, status: "connected"
    });
    const explicitLocalInput = {
      ...emptyRunInput(),
      forwardedProps: { run_config: { activeLlmProfileId: "local-model" } }
    } as RunAgentInput;
    expect(resolveRunConfig({
      metadataStore: metadata,
      runInput: explicitLocalInput,
      userId: "normal-user",
      userInput: "Generic data task",
      workspaceId: "customer-1"
    }).modelProvider.model_name).toBe("local-model");
    const energyResolved = resolveRunConfig({
      metadataStore: metadata,
      modelSelection: "system-default",
      runInput: explicitLocalInput,
      userId: "normal-user",
      userInput: "EnergyIQ task",
      workspaceId: "customer-1"
    });
    expect(energyResolved.effectiveRunConfig.activeLlmProfileId).toBe("workspace-default");
    expect(energyResolved.modelProvider.model_name).toBe("deepseek-v4-flash");
    const dto = workspaceDefaultModelProfileDto({
      context: userContext,
      isAdmin: false
    });
    expect(dto).toMatchObject({ id: "workspace-default", available: true, fallbackPolicy: "disabled" });
    expect(JSON.stringify(dto)).not.toContain("server-only-test-secret");
    expect(dto).not.toHaveProperty("secretRef");
    expect(dto).not.toHaveProperty("sourceProfileId");

    const source = metadata.configResources.get({
      id: "deepseek-v4-flash", workspace_id: "default", user_id: "dev-user", kind: "model-profile"
    });
    metadata.configResources.upsert({
      ...source,
      status: "failed",
      expected_revision: source.revision
    });
    expect(workspaceDefaultModelProfileDto({
      context: userContext,
      isAdmin: false
    })).toMatchObject({ configured: true, available: false, unavailableReason: "source-profile-not-connected" });
    expect(() => resolveRunConfig({
      metadataStore: metadata,
      runInput: emptyRunInput(),
      userId: "normal-user",
      userInput: "Compare this period",
      workspaceId: "customer-1"
    })).toThrow("WORKSPACE_DEFAULT_MODEL_PROFILE_NOT_CONNECTED");
    expect(() => resolveModelProfileChain({
      metadataStore: metadata, profileId: "workspace-default", userId: "normal-user", workspaceId: "customer-1"
    })).toThrow("WORKSPACE_DEFAULT_MODEL_PROFILE_NOT_CONNECTED");

    metadata.configResources.delete({
      id: "deepseek-v4-flash", workspace_id: "default", user_id: "dev-user", kind: "model-profile"
    });
    expect(workspaceDefaultModelProfileDto({
      context: userContext,
      isAdmin: false
    })).toMatchObject({ configured: true, available: false, unavailableReason: "source-profile-not-found" });
    expect(() => resolveModelProfileChain({
      metadataStore: metadata, profileId: "workspace-default", userId: "normal-user", workspaceId: "customer-1"
    })).toThrow("WORKSPACE_DEFAULT_MODEL_PROFILE_SOURCE_UNAVAILABLE");

    metadata.db.close();
    rmSync(root, { recursive: true, force: true });
  });
});

const emptyRunInput = (): RunAgentInput => ({
  context: [], forwardedProps: {}, messages: [], runId: "run-1", state: {}, threadId: "thread-1", tools: []
});

const jsonRequest = (method: string, body: Record<string, unknown>): IncomingMessage => {
  const request = Readable.from([JSON.stringify(body)]) as IncomingMessage;
  request.method = method;
  return request;
};
