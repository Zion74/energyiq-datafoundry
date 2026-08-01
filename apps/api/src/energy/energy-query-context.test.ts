import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import {
  resolveEnergyAccessContext,
  resolveEnergyQueryContext,
  resolveEnergyScopeMeterNodeIds
} from "./energy-query-context.js";

describe("EnergyQueryContext", () => {
  it("resolves a server-authoritative Singapore reporting range and version pins", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-query-context-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const user = metadata.users.getById({ user_id: "dev-user" });
      const access = resolveEnergyAccessContext({
        metadataStore: metadata,
        user,
        requestedWorkspaceId: "default"
      });
      expect(access.role).toBe("admin");
      expect(access.projects.map((project) => project.status)).toEqual(["published", "published"]);

      const context = resolveEnergyQueryContext({
        metadataStore: metadata,
        user,
        workspaceId: "default",
        request: {
          projectId: "ngee-ann-polytechnic",
          scopeId: "level-7",
          resource: "electricity",
          period: "Last 7 days"
        },
        now: new Date("2026-07-31T06:00:00.000Z")
      });
      expect(context).toMatchObject({
        projectId: "ngee-ann-polytechnic",
        scopeId: "level-7",
        scopeType: "level",
        timezone: "Asia/Singapore",
        from: "2026-07-23T16:00:00.000Z",
        to: "2026-07-30T16:00:00.000Z",
        endExclusive: true,
        hierarchyRevisionId: "ngee-ann-hierarchy-v2",
        dataSnapshotId: "ngee-ann-4bac1177eca62cdb"
      });
      expect(resolveEnergyScopeMeterNodeIds(metadata, "ngee-ann-polytechnic", "level-7"))
        .toEqual([
          "level-7",
          "l7-total-light",
          "l7-total-load",
          "l7-front-light",
          "l7-middle-light",
          "l7-back-light",
          "l7-load-1",
          "l7-load-2",
          "l7-load-3",
          "l7-load-4"
        ]);
      expect(metadata.energyIq.listTierDefinitions("ngee-ann-polytechnic")).toMatchObject([
        { ordinal: 1, alias: "Circuit" },
        { ordinal: 2, alias: "Level" }
      ]);
      const ngeeAnnNodes = metadata.energyIq.listProjectNodes("ngee-ann-polytechnic");
      expect(ngeeAnnNodes.some((node) => node.id === "block-test")).toBe(false);
      expect(ngeeAnnNodes.find((node) => node.id === "level-6")).toMatchObject({
        parent_id: "project",
        tier_definition_id: "ngee-ann-tier-level"
      });
      const preschoolNodes = metadata.energyIq.listProjectNodes("preschool-demo");
      expect(preschoolNodes).toHaveLength(301);
      expect(preschoolNodes.filter((node) => node.parent_id === "preschool-project"))
        .toHaveLength(30);
      expect(resolveEnergyScopeMeterNodeIds(metadata, "preschool-demo", "preschool-centre-a"))
        .toHaveLength(10);
      expect(metadata.energyIq.getProject("preschool-demo").hierarchy_revision_id)
        .toBe("preschool-hierarchy-v4");
      expect(metadata.energyIq.listTierDefinitions("preschool-demo")).toMatchObject([
        { ordinal: 1, alias: "Circuit" },
        { ordinal: 2, alias: "Centre" }
      ]);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("treats a custom end date as inclusive and rejects a scope from another project", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-query-context-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const user = metadata.users.getById({ user_id: "dev-user" });
      const context = resolveEnergyQueryContext({
        metadataStore: metadata,
        user,
        workspaceId: "default",
        request: {
          projectId: "ngee-ann-polytechnic",
          scopeId: "project",
          period: "Custom",
          from: "2026-07-01",
          to: "2026-07-20"
        }
      });
      expect(context.from).toBe("2026-06-30T16:00:00.000Z");
      expect(context.to).toBe("2026-07-20T16:00:00.000Z");
      expect(() => resolveEnergyQueryContext({
        metadataStore: metadata,
        user,
        workspaceId: "default",
        request: {
          projectId: "ngee-ann-polytechnic",
          scopeId: "preschool-project",
          period: "Yesterday"
        }
      })).toThrow("ENERGYIQ_SCOPE_FORBIDDEN");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("inherits published Project access from Organisation membership and rejects drafts or another Organisation", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-query-context-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      metadata.users.upsertDevUser({
        id: "fm-user",
        email: "fm@example.com",
        display_name: "FM User",
        dev_token: "fm-token"
      });
      metadata.workspaces.upsert({
        id: "customer-two",
        owner_user_id: "fm-user",
        name: "Customer Two",
        kind: "customer"
      });
      metadata.workspaceMemberships.upsert({
        workspace_id: "customer-two",
        user_id: "fm-user",
        role: "owner"
      });
      metadata.energyIq.upsertProject({
        id: "customer-two-project",
        workspace_id: "customer-two",
        name: "Customer Two Published",
        status: "published"
      });
      metadata.energyIq.upsertProjectNode({
        id: "customer-two-root",
        project_id: "customer-two-project",
        name: "Customer Two Project",
        node_type: "project"
      });
      metadata.energyIq.upsertProject({
        id: "customer-two-draft",
        workspace_id: "customer-two",
        name: "Customer Two Draft",
        status: "draft"
      });
      const user = metadata.users.getById({ user_id: "fm-user" });
      const access = resolveEnergyAccessContext({
        metadataStore: metadata,
        user,
        requestedWorkspaceId: "customer-two",
        env: {}
      });
      expect(access.role).toBe("user");
      expect(access.projects.map((project) => project.id)).toEqual(["customer-two-project"]);
      expect(() => resolveEnergyQueryContext({
        metadataStore: metadata,
        user,
        workspaceId: "customer-two",
        request: {
          projectId: "customer-two-draft",
          period: "Yesterday"
        },
        env: {}
      })).toThrow("ENERGYIQ_PROJECT_FORBIDDEN");
      expect(() => resolveEnergyAccessContext({
        metadataStore: metadata,
        user,
        requestedWorkspaceId: "default",
        env: {}
      })).toThrow("ENERGYIQ_WORKSPACE_FORBIDDEN");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("hides personal and disabled Organisations from users while admins retain repair access", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-query-context-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      metadata.users.upsertDevUser({
        id: "multi-user",
        email: "multi@example.com",
        display_name: "Multi User",
        dev_token: "multi-token"
      });
      metadata.workspaces.createPersonal({
        id: "personal-multi-user",
        owner_user_id: "multi-user",
        name: "Personal"
      });
      metadata.workspaceMemberships.upsertOwner({
        workspace_id: "personal-multi-user",
        user_id: "multi-user"
      });
      metadata.workspaces.upsert({
        id: "disabled-customer",
        owner_user_id: "dev-user",
        name: "Disabled Customer",
        kind: "customer"
      });
      metadata.workspaceMemberships.upsert({
        workspace_id: "disabled-customer",
        user_id: "multi-user",
        role: "member"
      });
      metadata.workspaces.setCustomerDetails({
        id: "disabled-customer",
        name: "Disabled Customer",
        disabled: true
      });

      const userAccess = resolveEnergyAccessContext({
        metadataStore: metadata,
        user: metadata.users.getById({ user_id: "multi-user" }),
        env: {}
      });
      expect(userAccess.workspaces).toEqual([]);
      expect(userAccess.activeWorkspaceId).toBe("");

      const adminAccess = resolveEnergyAccessContext({
        metadataStore: metadata,
        user: metadata.users.getById({ user_id: "dev-user" }),
        requestedWorkspaceId: "disabled-customer"
      });
      expect(adminAccess.workspaces.find((workspace) => workspace.id === "disabled-customer"))
        .toMatchObject({ disabled: true });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
