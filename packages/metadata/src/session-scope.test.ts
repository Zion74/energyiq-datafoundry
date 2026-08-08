import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createMetadataStore } from "./index.js";

describe("SessionRepository EnergyIQ scope", () => {
  it("lists conversations only for the selected Workspace and Project", () => {
    const root = mkdtempSync(join(tmpdir(), "session-scope-list-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.sessions.create({
        user_id: "dev-user",
        id: "ngee-session",
        workspace_id: "ngee-workspace",
        project_id: "ngee-ann-polytechnic"
      });
      metadata.sessions.create({
        user_id: "dev-user",
        id: "preschool-session",
        workspace_id: "preschool-workspace",
        project_id: "preschool-demo"
      });
      metadata.sessions.create({ user_id: "dev-user", id: "generic-session" });

      expect(metadata.sessions.list({
        user_id: "dev-user",
        workspace_id: "ngee-workspace",
        project_id: "ngee-ann-polytechnic"
      }).map((session) => session.id)).toEqual(["ngee-session"]);
      expect(metadata.sessions.list({
        user_id: "dev-user",
        workspace_id: "preschool-workspace",
        project_id: "preschool-demo"
      }).map((session) => session.id)).toEqual(["preschool-session"]);
      expect(metadata.sessions.list({ user_id: "dev-user" })).toHaveLength(3);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects reuse of a Session in another Project", () => {
    const root = mkdtempSync(join(tmpdir(), "session-scope-mismatch-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.sessions.create({
        user_id: "dev-user",
        id: "project-session",
        workspace_id: "workspace-1",
        project_id: "project-1"
      });

      expect(() => metadata.sessions.create({
        user_id: "dev-user",
        id: "project-session",
        workspace_id: "workspace-2",
        project_id: "project-2"
      })).toThrow("ENERGYIQ_SESSION_WORKSPACE_MISMATCH");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not silently bind a legacy Session that already has Run history", () => {
    const root = mkdtempSync(join(tmpdir(), "session-scope-legacy-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.sessions.create({ user_id: "dev-user", id: "legacy-session" });
      metadata.runs.create({
        user_id: "dev-user",
        id: "legacy-run",
        session_id: "legacy-session",
        user_input: "old project question",
        status: "completed"
      });

      expect(() => metadata.sessions.create({
        user_id: "dev-user",
        id: "legacy-session",
        workspace_id: "workspace-1",
        project_id: "project-1"
      })).toThrow("ENERGYIQ_SESSION_SCOPE_REQUIRED");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
