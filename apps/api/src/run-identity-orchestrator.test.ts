import { createMetadataStore, RunEventWriter } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ensureEnergyIqBootstrap } from "./energy/energy-bootstrap.js";
import { RunCancelRegistry } from "./run-cancel-registry.js";
import { resolveRunIdentity } from "./run-identity-orchestrator.js";

describe("resolveRunIdentity EnergyIQ Session scope", () => {
  it("rejects replay before events from another Workspace or Project can be returned", () => {
    const root = mkdtempSync(join(tmpdir(), "run-identity-energy-scope-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const ngeeAnn = metadata.energyIq.getProject("ngee-ann-polytechnic");
      const preschool = metadata.energyIq.getProject("preschool-demo");
      metadata.sessions.create({
        user_id: "dev-user",
        id: "session-1",
        workspace_id: ngeeAnn.workspace_id,
        project_id: ngeeAnn.id,
      });
      metadata.runs.create({
        user_id: "dev-user",
        id: "run-1",
        session_id: "session-1",
        request_fingerprint: "irrelevant-before-scope-check",
        user_input: "old project question",
        status: "completed",
      });

      expect(() => resolveRunIdentity({
        energySessionScope: {
          workspaceId: preschool.workspace_id,
          projectId: preschool.id,
        },
        effectiveRunConfig: {} as never,
        metadataStore: metadata,
        modelName: "test-model",
        runCancelRegistry: new RunCancelRegistry(),
        runEventWriter: new RunEventWriter(metadata.runEvents),
        runInput: {
          threadId: "session-1",
          runId: "run-1",
          messages: [],
        } as never,
        userId: "dev-user",
        userInput: "new project question",
      })).toThrow("ENERGYIQ_SESSION_WORKSPACE_MISMATCH");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
