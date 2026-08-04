import { describe, expect, it } from "vitest";

import {
  energyIqPublishedMeterRoutingRevisionId,
  fingerprintEnergyIqMeterMapping,
  validateProjectSetupDocument,
  type EnergyIqMeterMappingDraft,
} from "./energyiq-project-setup-store.js";

describe("validateProjectSetupDocument sibling names", () => {
  it("changes the Mapping fingerprint and revision when attachment or route authority changes", () => {
    const mapping: EnergyIqMeterMappingDraft = {
      schema_version: 2,
      source_kind: "excel",
      confirmed: true,
      rows: [{
        id: "m1", source_label: "Meter 1", scope_id: "c1", navigation_scope_id: "c1",
        display_name: "Meter 1", resource: "electricity", category: "load", coverage: "whole",
        meter_role: "total", aggregation_usage: "official",
      }],
      official_aggregation_routes: [{
        scope_id: "c1", resource: "electricity", category: "load", meter_point_ids: ["m1"],
      }],
    };
    const attachmentChanged: EnergyIqMeterMappingDraft = {
      ...mapping,
      rows: [{ ...mapping.rows[0]!, navigation_scope_id: "c2" }],
    };
    const routeChanged: EnergyIqMeterMappingDraft = {
      ...mapping,
      official_aggregation_routes: [{
        scope_id: "project", resource: "electricity", category: "load", meter_point_ids: ["m1"],
      }],
    };

    expect(fingerprintEnergyIqMeterMapping(attachmentChanged)).not.toBe(fingerprintEnergyIqMeterMapping(mapping));
    expect(fingerprintEnergyIqMeterMapping(routeChanged)).not.toBe(fingerprintEnergyIqMeterMapping(mapping));
    expect(energyIqPublishedMeterRoutingRevisionId(mapping)).toMatch(/^meter-routing-[a-f0-9]{24}$/);
    expect(energyIqPublishedMeterRoutingRevisionId(routeChanged)).not.toBe(energyIqPublishedMeterRoutingRevisionId(mapping));
  });

  it("blocks normalised duplicates under one parent but allows the same name under another parent", () => {
    const validation = validateProjectSetupDocument({
      project: { name: "Test", timezone: "Asia/Singapore" },
      tier_structure_locked: true,
      tiers: [
        { id: "room", ordinal: 1, alias: "Room" },
        { id: "level", ordinal: 2, alias: "Level" },
      ],
      nodes: [
        { id: "l1", tier_definition_id: "level", name: "Level 1", sort_order: 1, metadata_status: "confirmed" },
        { id: "l2", tier_definition_id: "level", name: "Level 2", sort_order: 2, metadata_status: "confirmed" },
        { id: "r1", tier_definition_id: "room", parent_id: "l1", name: "Room 1", sort_order: 1, metadata_status: "confirmed" },
        { id: "r2", tier_definition_id: "room", parent_id: "l1", name: " ROOM   1 ", sort_order: 2, metadata_status: "confirmed" },
        { id: "r3", tier_definition_id: "room", parent_id: "l2", name: "Room 1", sort_order: 1, metadata_status: "confirmed" },
      ],
    });

    expect(validation.issues.filter((issue) => issue.code === "SIBLING_NAME_DUPLICATE")).toHaveLength(1);
  });

  it("requires the Tier Structure draft checkpoint before hierarchy validation", () => {
    const validation = validateProjectSetupDocument({
      project: { name: "Test", timezone: "Asia/Singapore" },
      tier_structure_locked: false,
      tiers: [{ id: "level", ordinal: 1, alias: "Level" }],
      nodes: [{
        id: "l1",
        tier_definition_id: "level",
        name: "Level 1",
        sort_order: 1,
        metadata_status: "confirmed",
      }],
    });

    expect(validation.issues.some((issue) => issue.code === "TIER_STRUCTURE_NOT_LOCKED")).toBe(true);
  });

  it("blocks Meter Mapping rows that target a Scope missing from Structure", () => {
    const validation = validateProjectSetupDocument({
      project: { name: "Test", timezone: "Asia/Singapore" },
      tier_structure_locked: true,
      tiers: [{ id: "level", ordinal: 1, alias: "Level" }],
      nodes: [{
        id: "l1",
        tier_definition_id: "level",
        name: "Level 1",
        sort_order: 1,
        metadata_status: "confirmed",
      }],
      meter_mapping: {
        schema_version: 2,
        source_kind: "excel",
        confirmed: false,
        rows: [{
          id: "mapping-1",
          source_label: "Office Load 1",
          scope_id: "missing-room",
          display_name: "Office Load 1",
          resource: "electricity",
          category: "load",
          coverage: "whole",
          meter_role: "total",
          aggregation_usage: "official",
        }],
      },
    });

    expect(validation.issues.some((issue) => issue.code === "METER_SCOPE_NOT_FOUND")).toBe(true);
    expect(validation.blocking).toBe(true);
  });

  it("allows one official direct total but blocks two for the same aggregation route", () => {
    const validation = validateProjectSetupDocument({
      project: { name: "Test", timezone: "Asia/Singapore" },
      tier_structure_locked: true,
      tiers: [{ id: "level", ordinal: 1, alias: "Level" }],
      nodes: [{
        id: "l1",
        tier_definition_id: "level",
        name: "Level 1",
        sort_order: 1,
        metadata_status: "confirmed",
      }],
      meter_mapping: {
        schema_version: 2,
        source_kind: "excel",
        confirmed: true,
        rows: [
          {
            id: "mapping-1",
            source_label: "Total Office Load A",
            scope_id: "l1",
            display_name: "Total Office Load A",
            resource: "electricity",
            category: "load",
            coverage: "whole",
            meter_role: "total",
            aggregation_usage: "official",
          },
          {
            id: "mapping-2",
            source_label: "Total Office Load B",
            scope_id: "l1",
            display_name: "Total Office Load B",
            resource: "electricity",
            category: "load",
            coverage: "whole",
            meter_role: "total",
            aggregation_usage: "official",
          },
        ],
      },
    });

    expect(validation.issues.filter((issue) => issue.code === "MULTIPLE_DIRECT_TOTALS")).toHaveLength(1);
    expect(validation.blocking).toBe(true);
  });

  it("accepts a standalone Virtual Meter with two valid physical inputs", () => {
    const validation = validateProjectSetupDocument({
      project: { name: "Test", timezone: "Asia/Singapore" },
      tier_structure_locked: true,
      tiers: [
        { id: "circuit", ordinal: 1, alias: "Circuit" },
        { id: "level", ordinal: 2, alias: "Level" },
      ],
      nodes: [
        { id: "l1", tier_definition_id: "level", name: "Level 1", sort_order: 1, metadata_status: "confirmed" },
        { id: "c1", tier_definition_id: "circuit", parent_id: "l1", name: "Load 1", sort_order: 1, metadata_status: "confirmed" },
        { id: "c2", tier_definition_id: "circuit", parent_id: "l1", name: "Load 2", sort_order: 2, metadata_status: "confirmed" },
      ],
      meter_mapping: {
        schema_version: 2,
        source_kind: "excel",
        confirmed: true,
        rows: [
          { id: "m1", source_label: "Load 1", scope_id: "c1", display_name: "Load 1", resource: "electricity", category: "load", coverage: "whole", meter_role: "total", aggregation_usage: "official" },
          { id: "m2", source_label: "Load 2", scope_id: "c2", display_name: "Load 2", resource: "electricity", category: "load", coverage: "whole", meter_role: "total", aggregation_usage: "official" },
        ],
        official_aggregation_routes: [
          { scope_id: "c1", resource: "electricity", category: "load", meter_point_ids: ["m1"] },
          { scope_id: "c2", resource: "electricity", category: "load", meter_point_ids: ["m2"] },
        ],
        virtual_meters: [{
          id: "vm-load-12",
          display_name: "Load 12",
          scope_id: "l1",
          resource: "electricity",
          category: "load",
          terms: [
            { mapping_row_id: "m1", coefficient: 1 },
            { mapping_row_id: "m2", coefficient: 1 },
          ],
        }],
      },
    });

    expect(validation.issues.some((issue) => issue.code.startsWith("VIRTUAL_METER"))).toBe(false);
    expect(validation.blocking).toBe(false);
  });

  it.each([
    {
      name: "missing",
      routes: undefined,
      code: "OFFICIAL_ROUTES_REQUIRED",
    },
    {
      name: "duplicate",
      routes: [
        { scope_id: "c1", resource: "electricity" as const, category: "load" as const, meter_point_ids: ["m1"] },
        { scope_id: "c1", resource: "electricity" as const, category: "load" as const, meter_point_ids: ["m1"] },
      ],
      code: "OFFICIAL_ROUTE_DUPLICATE",
    },
    {
      name: "dangling",
      routes: [
        { scope_id: "c1", resource: "electricity" as const, category: "load" as const, meter_point_ids: ["missing"] },
      ],
      code: "OFFICIAL_ROUTE_METER_INVALID",
    },
    {
      name: "cross-resource",
      routes: [
        { scope_id: "c1", resource: "water" as const, category: "load" as const, meter_point_ids: ["m1"] },
      ],
      code: "OFFICIAL_ROUTE_RESOURCE_MISMATCH",
    },
  ])("fails closed for $name published Meter routes", ({ routes, code }) => {
    const validation = validateProjectSetupDocument({
      project: { name: "Test", timezone: "Asia/Singapore" },
      tier_structure_locked: true,
      tiers: [{ id: "circuit", ordinal: 1, alias: "Circuit" }],
      nodes: [{
        id: "c1",
        tier_definition_id: "circuit",
        name: "Load 1",
        sort_order: 1,
        metadata_status: "confirmed",
      }],
      meter_mapping: {
        schema_version: 2,
        source_kind: "excel",
        confirmed: true,
        rows: [{
          id: "m1",
          source_label: "Load 1",
          scope_id: "c1",
          navigation_scope_id: "c1",
          display_name: "Load 1",
          resource: "electricity",
          category: "load",
          coverage: "whole",
          meter_role: "total",
          aggregation_usage: "official",
        }],
        ...(routes ? { official_aggregation_routes: routes } : {}),
      },
    });

    expect(validation.issues.some((issue) => issue.code === code)).toBe(true);
    expect(validation.blocking).toBe(true);
  });
});
