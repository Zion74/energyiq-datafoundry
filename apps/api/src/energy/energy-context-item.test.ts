import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ensureEnergyIqBootstrap,
  NGEE_ANN_WORKSPACE_ID,
} from "./energy-bootstrap.js";
import {
  createEnergyAuthoritativeContextItems,
  createEnergyQueryContextItem,
} from "./energy-context-item.js";
import { resolveEnergyQueryContext } from "./energy-query-context.js";
import {
  resolvePublishedEnergyRunContext,
  resolvePublishedProjectRelease,
} from "./project-analysis-resolver.js";

const baseContext = {
  userId: "user-1",
  workspaceId: "workspace-1",
  projectId: "project-1",
  projectName: "Project One",
  scopeId: "level-7",
  scopeName: "Level 7",
  scopeType: "level",
  resource: "electricity" as const,
  timezone: "Asia/Singapore",
  from: "2026-07-01T16:00:00.000Z",
  to: "2026-07-08T16:00:00.000Z",
  endExclusive: true as const,
  period: "Last 7 days" as const,
  hierarchyRevisionId: "hierarchy-v1",
  meterMappingRevisionId: "meter-routing-v1",
  meterFormulaRevisionId: "formula-v1",
  dataSnapshotId: "snapshot-v1",
  metricVersion: "metrics-v1",
  businessCalendarVersion: "calendar-v1",
  tariffScheduleVersion: "tariff-v1",
  resolvedAt: "2026-07-09T00:00:00.000Z"
};

describe("createEnergyQueryContextItem", () => {
  it("pins the authoritative scope and versions in model context", () => {
    const item = createEnergyQueryContextItem(baseContext, "session-1");
    expect(item.trust).toBe("tool");
    expect(String(item.content)).toContain("to_exclusive=2026-07-08T16:00:00.000Z");
    expect(String(item.content)).toContain("meter_formula_revision_id=formula-v1");
  });

  it("adds evidence-bound Ngee Ann analysis rules without changing other projects", () => {
    const item = createEnergyQueryContextItem({
      ...baseContext,
      projectId: "ngee-ann-polytechnic",
      projectName: "Ngee Ann Polytechnic"
    }, "session-1");
    const content = String(item.content);

    expect(content).toContain("Ngee Ann analysis policy");
    expect(content).toContain("group by local_interval_start");
    expect(content).toContain("comparison is unavailable");
    expect(content).toContain("never create new chart values");
    expect(content).toContain("Never generate mock figures");
    expect(content).toContain("evidence-backed next investigations or actions are allowed");
    expect(content).not.toContain("Never generate mock figures, business anomalies, root causes or action priorities");

    const otherProject = createEnergyQueryContextItem(baseContext, "session-1");
    expect(String(otherProject.content)).not.toContain("Ngee Ann analysis policy");
  });

  it("assembles the authorized Ngee Ann query context and Pack for the server Context Package", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-authoritative-context-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const context = resolveEnergyQueryContext({
        metadataStore: metadata,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        request: {
          projectId: "ngee-ann-polytechnic",
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: "2026-06-10",
          to: "2026-06-16",
        },
      });
      const projectRelease = resolvePublishedProjectRelease(metadata, context);
      expect(projectRelease).not.toBeNull();

      const items = createEnergyAuthoritativeContextItems({
        context,
        projectRelease,
        sessionId: "session-ngee-ann",
        userId: context.userId,
      });

      expect(items.map((item) => item.sourceType)).toEqual([
        "energy-query-context",
        "project-analysis-pack",
      ]);
      expect(items[1]).toMatchObject({
        id: expect.stringContaining("ngee-ann-analysis-pack@v1"),
        groupId: "project-analysis-pack:ngee-ann-analysis-pack@v1",
        metadata: {
          analysisPackRevision: "v1",
          projectReleaseId: projectRelease?.id,
          sourceOwner: "server",
        },
      });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("fails closed on Project Release drift and binds the server Context Package to the accepted Release", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-release-bound-context-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const context = resolveEnergyQueryContext({
        metadataStore: metadata,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        request: {
          projectId: "ngee-ann-polytechnic",
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: "2026-06-10",
          to: "2026-06-16",
        },
      });
      const project = metadata.energyIq.getProject(context.projectId);
      const publishedRevision = metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
        project_id: context.projectId,
        tier_definition_ids: metadata.energyIq.listTierDefinitions(context.projectId)
          .map((tier) => tier.id),
        hierarchy_revision_id: context.hierarchyRevisionId,
        meter_mapping_revision_id: context.meterMappingRevisionId,
        published_by: context.userId,
        published_at: "2026-08-05T00:00:00.000Z",
      });
      const driftedContext = {
        ...context,
        meterFormulaRevisionId: `${project.meter_formula_revision_id}-draft-drift`,
        metricVersion: `${project.metric_version}-draft-drift`,
        businessCalendarVersion: `${project.business_calendar_version}-draft-drift`,
        tariffScheduleVersion: `${project.tariff_schedule_version}-draft-drift`,
      };

      expect(() => resolvePublishedEnergyRunContext({
        metadataStore: metadata,
        context: driftedContext,
        expectedProjectReleaseId: "stale-overview-release",
      })).toThrow("ENERGYIQ_PROJECT_RELEASE_MISMATCH");

      const resolved = resolvePublishedEnergyRunContext({
        metadataStore: metadata,
        context: driftedContext,
        expectedProjectReleaseId: publishedRevision.revision_id,
      });
      expect(resolved.projectRelease?.id).toBe(publishedRevision.revision_id);
      expect(resolved.context).toMatchObject({
        hierarchyRevisionId: publishedRevision.hierarchy_revision_id,
        meterMappingRevisionId: publishedRevision.meter_mapping_revision_id,
        meterFormulaRevisionId: publishedRevision.meter_formula_revision_id,
        metricVersion: `metric-revisions:${[...publishedRevision.selected_metric_revision_ids]
          .sort((left, right) => left.localeCompare(right))
          .join(",") || "none"}`,
        businessCalendarVersion: publishedRevision.business_calendar_version,
        tariffScheduleVersion: publishedRevision.tariff_schedule_version,
      });

      const items = createEnergyAuthoritativeContextItems({
        context: resolved.context,
        projectRelease: resolved.projectRelease,
        sessionId: "session-release-bound",
        userId: resolved.context.userId,
      });
      expect(String(items[0]?.content)).toContain(
        `hierarchy_revision_id=${publishedRevision.hierarchy_revision_id}`,
      );
      expect(items[1]?.metadata).toMatchObject({
        projectReleaseId: publishedRevision.revision_id,
      });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
