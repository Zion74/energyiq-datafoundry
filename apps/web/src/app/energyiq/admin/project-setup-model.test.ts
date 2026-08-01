import { describe, expect, it } from "vitest";

import type { EnergyProjectSetupDocumentDto } from "../../../lib/config-api";

import {
  addNode,
  addParentTier,
  branchNodeCount,
  canLockTierStructure,
  hasSiblingNameConflict,
  initialTierSelection,
  isTierStructureLocked,
  nodesForTierAndParent,
  removeNodeAndDescendants,
  removeHighestTier,
  tiersTopDown,
} from "./project-setup-model";

describe("project setup model", () => {
  it("keeps internal ordinals independent from customer-facing aliases", () => {
    let document: EnergyProjectSetupDocumentDto = {
      project: { name: "Test", timezone: "Asia/Singapore" },
      tier_structure_locked: false,
      tiers: [],
      nodes: [],
    };
    document = addParentTier(document, "test");
    document = addParentTier(document, "test");
    document.tiers[0]!.alias = "Circuit";
    document.tiers[1]!.alias = "Room";
    expect(tiersTopDown(document).map((tier) => [tier.ordinal, tier.alias])).toEqual([
      [2, "Room"],
      [1, "Circuit"],
    ]);
  });

  it("locks only a complete unique Tier definition and removes only the highest empty Tier", () => {
    let document: EnergyProjectSetupDocumentDto = {
      project: { name: "Test", timezone: "Asia/Singapore" },
      tier_structure_locked: false,
      tiers: [],
      nodes: [],
    };
    document = addParentTier(document, "test");
    document.tiers[0]!.alias = "Circuit";
    document = addParentTier(document, "test");
    document.tiers[1]!.alias = "Level";
    expect(canLockTierStructure(document)).toBe(true);
    expect(isTierStructureLocked(document)).toBe(false);
    document.tiers[1]!.alias = " circuit ";
    expect(canLockTierStructure(document)).toBe(false);
    document.tiers[1]!.alias = "Level";
    expect(removeHighestTier(document).tiers.map((tier) => tier.alias)).toEqual(["Circuit"]);
  });

  it("browses an arbitrary tier tree and removes a branch safely", () => {
    const document = {
      project: { name: "Test", timezone: "Asia/Singapore" },
      tier_structure_locked: true,
      tiers: [
        { id: "circuit", ordinal: 1, alias: "Circuit" },
        { id: "room", ordinal: 2, alias: "Room" },
        { id: "block", ordinal: 3, alias: "Block" },
      ],
      nodes: [
        { id: "b1", tier_definition_id: "block", name: "Block 1", sort_order: 1, metadata_status: "confirmed" as const },
        { id: "r1", tier_definition_id: "room", parent_id: "b1", name: "Room 1", sort_order: 1, metadata_status: "confirmed" as const },
        { id: "c1", tier_definition_id: "circuit", parent_id: "r1", name: "Circuit 1", sort_order: 1, metadata_status: "confirmed" as const },
      ],
    };
    expect(initialTierSelection(document)).toEqual({ block: "b1", room: "r1", circuit: "c1" });
    expect(nodesForTierAndParent(document, "room", "b1")).toHaveLength(1);
    expect(removeNodeAndDescendants(document, "r1").nodes).toEqual([document.nodes[0]]);
    expect(branchNodeCount(document, "r1")).toBe(2);
  });

  it("adds lower-tier nodes only under the selected immediate parent", () => {
    const document = {
      project: { name: "Test", timezone: "Asia/Singapore" },
      tier_structure_locked: true,
      tiers: [
        { id: "circuit", ordinal: 1, alias: "Circuit" },
        { id: "level", ordinal: 2, alias: "Level" },
      ],
      nodes: [
        { id: "l6", tier_definition_id: "level", name: "Level 6", sort_order: 1, metadata_status: "confirmed" as const },
      ],
    };
    const result = addNode(document, { projectId: "test", tierId: "circuit", parentId: "l6" });
    expect(result.document.nodes.at(-1)).toMatchObject({
      id: "test-circuit-1",
      parent_id: "l6",
      tier_definition_id: "circuit",
    });
  });

  it("treats display names as unique only within the same parent and tier", () => {
    const document = {
      project: { name: "Test", timezone: "Asia/Singapore" },
      tier_structure_locked: true,
      tiers: [
        { id: "room", ordinal: 1, alias: "Room" },
        { id: "level", ordinal: 2, alias: "Level" },
      ],
      nodes: [
        { id: "l1", tier_definition_id: "level", name: "Level 1", sort_order: 1, metadata_status: "confirmed" as const },
        { id: "l2", tier_definition_id: "level", name: "Level 2", sort_order: 2, metadata_status: "confirmed" as const },
        { id: "r1-l1", tier_definition_id: "room", parent_id: "l1", name: "Room 1", sort_order: 1, metadata_status: "confirmed" as const },
        { id: "r3-l1", tier_definition_id: "room", parent_id: "l1", name: "Room 3", sort_order: 3, metadata_status: "confirmed" as const },
        { id: "r1-l2", tier_definition_id: "room", parent_id: "l2", name: "Room 1", sort_order: 1, metadata_status: "confirmed" as const },
      ],
    };

    expect(hasSiblingNameConflict(document, {
      tierId: "room",
      parentId: "l1",
      name: " room   1 ",
    })).toBe(true);
    expect(hasSiblingNameConflict(document, {
      tierId: "room",
      parentId: "l2",
      name: "Room 3",
    })).toBe(false);

    const result = addNode(document, { projectId: "test", tierId: "room", parentId: "l1" });
    expect(result.document.nodes.at(-1)?.name).toBe("Room 4");
  });
});
