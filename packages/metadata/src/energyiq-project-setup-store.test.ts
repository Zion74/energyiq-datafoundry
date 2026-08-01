import { describe, expect, it } from "vitest";

import { validateProjectSetupDocument } from "./energyiq-project-setup-store.js";

describe("validateProjectSetupDocument sibling names", () => {
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
});
