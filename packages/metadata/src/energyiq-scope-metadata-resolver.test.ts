import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createMetadataStore } from "./index.js";

describe("EnergyIqScopeMetadataResolver", () => {
  it("uses the metadata revision effective during the historical analysis Period", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-scope-metadata-"));
    let metadata: TestMetadata | undefined;
    try {
      metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      seedProject(metadata, [
        {
          id: "project-1-hierarchy-v1:scope-1",
          hierarchyRevisionId: "project-1-hierarchy-v1",
          areaSqm: 100,
          occupantCount: 10,
          metadataStatus: "confirmed",
          effectiveFrom: "2026-01-01",
          effectiveTo: "2026-07-15",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "project-1-hierarchy-v2:scope-1",
          hierarchyRevisionId: "project-1-hierarchy-v2",
          areaSqm: 120,
          occupantCount: 12,
          metadataStatus: "provisional",
          effectiveFrom: "2026-07-15",
          effectiveTo: null,
          createdAt: "2026-07-14T16:00:00.000Z",
        },
      ]);

      const historical = metadata.energyIq.scopeMetadata.resolveForPeriod({
        projectId: "project-1",
        scopeId: "scope-1",
        timezone: "Asia/Singapore",
        period: {
          start: "2026-06-30T16:00:00.000Z",
          endExclusive: "2026-07-09T16:00:00.000Z",
        },
      });
      const normalised = metadata.energyIq.scopeMetadata.calculateEnergyNormalisations({
        energyKwh: 1_000,
        metadata: historical,
      });

      expect(historical.area).toMatchObject({
        status: "confirmed",
        value: 100,
        metadataRevisionIds: ["project-1-hierarchy-v1:scope-1"],
        hierarchyRevisionIds: ["project-1-hierarchy-v1"],
      });
      expect(historical.headcount).toMatchObject({ status: "confirmed", value: 10 });
      expect(normalised.eui).toMatchObject({
        status: "confirmed",
        metricId: "energy.usage_per_sqm",
        value: 10,
        unit: "kWh/m2",
        metadataRevisionIds: ["project-1-hierarchy-v1:scope-1"],
      });
      expect(normalised.perPax).toMatchObject({
        status: "confirmed",
        metricId: "energy.usage_per_person",
        value: 100,
        unit: "kWh/person",
      });

      const current = metadata.energyIq.scopeMetadata.resolveForPeriod({
        projectId: "project-1",
        scopeId: "scope-1",
        timezone: "Asia/Singapore",
        period: {
          start: "2026-07-14T16:00:00.000Z",
          endExclusive: "2026-07-20T16:00:00.000Z",
        },
      });
      const currentNormalised = metadata.energyIq.scopeMetadata.calculateEnergyNormalisations({
        energyKwh: 1_000,
        metadata: current,
      });
      expect(current.area).toMatchObject({
        status: "provisional",
        value: 120,
        metadataRevisionIds: ["project-1-hierarchy-v2:scope-1"],
      });
      expect(currentNormalised.eui).toMatchObject({
        status: "provisional",
        metadataRevisionIds: ["project-1-hierarchy-v2:scope-1"],
      });
      expect(currentNormalised.eui.value).toBeCloseTo(8.333333, 5);
    } finally {
      metadata?.db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not calculate a normalised metric when its metadata value changes inside the Period", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-scope-metadata-"));
    let metadata: TestMetadata | undefined;
    try {
      metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      seedProject(metadata, [
        {
          id: "project-1-hierarchy-v1:scope-1",
          hierarchyRevisionId: "project-1-hierarchy-v1",
          areaSqm: 100,
          occupantCount: 10,
          metadataStatus: "confirmed",
          effectiveFrom: "2026-01-01",
          effectiveTo: "2026-07-15",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "project-1-hierarchy-v2:scope-1",
          hierarchyRevisionId: "project-1-hierarchy-v2",
          areaSqm: 120,
          occupantCount: 12,
          metadataStatus: "confirmed",
          effectiveFrom: "2026-07-15",
          effectiveTo: null,
          createdAt: "2026-07-14T16:00:00.000Z",
        },
      ]);

      const resolution = metadata.energyIq.scopeMetadata.resolveForPeriod({
        projectId: "project-1",
        scopeId: "scope-1",
        timezone: "Asia/Singapore",
        period: {
          start: "2026-07-09T16:00:00.000Z",
          endExclusive: "2026-07-19T16:00:00.000Z",
        },
      });
      const normalised = metadata.energyIq.scopeMetadata.calculateEnergyNormalisations({
        energyKwh: 1_000,
        metadata: resolution,
      });

      expect(resolution.area).toMatchObject({
        status: "missing",
        reason: "value-changes-within-period",
        metadataRevisionIds: [
          "project-1-hierarchy-v1:scope-1",
          "project-1-hierarchy-v2:scope-1",
        ],
      });
      expect(normalised.eui).toMatchObject({
        status: "missing",
        value: null,
        reason: "value-changes-within-period",
      });
      expect(normalised.eui.status === "missing" ? normalised.eui.guidance : "")
        .toContain("split the analysis at the effective-date boundary");
    } finally {
      metadata?.db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns metric-specific Admin guidance when Area and Headcount are missing or invalid", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-scope-metadata-"));
    let metadata: TestMetadata | undefined;
    try {
      metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      seedProject(metadata, [{
        id: "project-1-hierarchy-v1:scope-1",
        hierarchyRevisionId: "project-1-hierarchy-v1",
        areaSqm: null,
        occupantCount: 0,
        metadataStatus: "confirmed",
        effectiveFrom: null,
        effectiveTo: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      }]);

      const resolution = metadata.energyIq.scopeMetadata.resolveForPeriod({
        projectId: "project-1",
        scopeId: "scope-1",
        timezone: "Asia/Singapore",
        period: {
          start: "2026-07-01T16:00:00.000Z",
          endExclusive: "2026-07-08T16:00:00.000Z",
        },
      });
      const normalised = metadata.energyIq.scopeMetadata.calculateEnergyNormalisations({
        energyKwh: 1_000,
        metadata: resolution,
      });

      expect(resolution.area).toMatchObject({ status: "missing", reason: "not-configured" });
      expect(resolution.headcount).toMatchObject({ status: "missing", reason: "invalid-value" });
      expect(normalised.eui).toMatchObject({
        status: "missing",
        value: null,
        reason: "not-configured",
      });
      expect(normalised.perPax).toMatchObject({
        status: "missing",
        value: null,
        reason: "invalid-value",
      });
      expect(normalised.eui.status === "missing" ? normalised.eui.guidance : "")
        .toContain("Add comparison area (m2) for Scope scope-1 in Admin > Projects > Structure");
      expect(normalised.perPax.status === "missing" ? normalised.perPax.guidance : "")
        .toContain("Set 24-hour representative headcount to a value greater than zero");
      expect(JSON.stringify(normalised)).not.toContain("No data");
    } finally {
      metadata?.db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed when effective metadata revisions overlap", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-scope-metadata-"));
    let metadata: TestMetadata | undefined;
    try {
      metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      seedProject(metadata, [
        {
          id: "project-1-hierarchy-v1:scope-1",
          hierarchyRevisionId: "project-1-hierarchy-v1",
          areaSqm: 100,
          occupantCount: 10,
          metadataStatus: "confirmed",
          effectiveFrom: "2026-01-01",
          effectiveTo: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "project-1-hierarchy-v2:scope-1",
          hierarchyRevisionId: "project-1-hierarchy-v2",
          areaSqm: 120,
          occupantCount: 12,
          metadataStatus: "confirmed",
          effectiveFrom: "2026-06-01",
          effectiveTo: null,
          createdAt: "2026-06-01T00:00:00.000Z",
        },
      ]);

      const resolution = metadata.energyIq.scopeMetadata.resolveForPeriod({
        projectId: "project-1",
        scopeId: "scope-1",
        timezone: "Asia/Singapore",
        period: {
          start: "2026-07-01T16:00:00.000Z",
          endExclusive: "2026-07-08T16:00:00.000Z",
        },
      });

      expect(resolution.area).toMatchObject({
        status: "missing",
        reason: "ambiguous-effective-revisions",
        metadataRevisionIds: [
          "project-1-hierarchy-v1:scope-1",
          "project-1-hierarchy-v2:scope-1",
        ],
      });
      expect(resolution.area.status === "missing" ? resolution.area.guidance : "")
        .toContain("Resolve overlapping Area effective dates");
    } finally {
      metadata?.db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

type TestMetadata = ReturnType<typeof createMetadataStore>;

type SeedRevision = {
  id: string;
  hierarchyRevisionId: string;
  areaSqm: number | null;
  occupantCount: number | null;
  metadataStatus: "confirmed" | "provisional";
  effectiveFrom: string | null;
  effectiveTo: string | null;
  createdAt: string;
};

const seedProject = (metadata: TestMetadata, revisions: SeedRevision[]): void => {
  metadata.workspaces.upsert({
    id: "workspace-1",
    owner_user_id: "dev-user",
    name: "Workspace 1",
    kind: "customer",
  });
  metadata.energyIq.upsertProject({
    id: "project-1",
    workspace_id: "workspace-1",
    name: "Project 1",
    status: "published",
    timezone: "Asia/Singapore",
    hierarchy_revision_id: revisions.at(-1)?.hierarchyRevisionId ?? "project-1-hierarchy-v1",
    meter_formula_revision_id: "meter-formula-v1",
    data_snapshot_id: "snapshot-1",
    metric_version: "energy-metrics-v1",
    business_calendar_version: "calendar-v1",
    tariff_schedule_version: "tariff-v1",
    root_scope_id: "project-1-root",
  });
  for (const [index, revision] of revisions.entries()) {
    metadata.db.prepare(`
      INSERT INTO energyiq_hierarchy_revisions (
        id, project_id, sequence, snapshot_json, validation_json, published_by, published_at
      ) VALUES (?, 'project-1', ?, '{}', '{}', 'dev-user', ?)
    `).run(revision.hierarchyRevisionId, index + 1, revision.createdAt);
    metadata.db.prepare(`
      INSERT INTO energyiq_node_metadata_revisions (
        id, project_id, node_id, hierarchy_revision_id, area_sqm, occupant_count,
        metadata_status, effective_from, effective_to, metadata_json, created_at
      ) VALUES (?, 'project-1', 'scope-1', ?, ?, ?, ?, ?, ?, NULL, ?)
    `).run(
      revision.id,
      revision.hierarchyRevisionId,
      revision.areaSqm,
      revision.occupantCount,
      revision.metadataStatus,
      revision.effectiveFrom,
      revision.effectiveTo,
      revision.createdAt,
    );
  }
};
