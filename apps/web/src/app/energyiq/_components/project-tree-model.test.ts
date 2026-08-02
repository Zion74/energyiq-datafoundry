import { describe, expect, it } from "vitest";

import { orderProjectNodesDepthFirst } from "./project-tree-model";

describe("orderProjectNodesDepthFirst", () => {
  it("places each level's circuits directly beneath that level", () => {
    const nodes = [
      { id: "project", parentId: null },
      { id: "level-6", parentId: "project" },
      { id: "level-7", parentId: "project" },
      { id: "l6-light", parentId: "level-6" },
      { id: "l6-load", parentId: "level-6" },
      { id: "l7-light", parentId: "level-7" },
      { id: "l7-load", parentId: "level-7" },
    ];

    expect(orderProjectNodesDepthFirst(nodes).map((node) => node.id)).toEqual([
      "project",
      "level-6",
      "l6-light",
      "l6-load",
      "level-7",
      "l7-light",
      "l7-load",
    ]);
  });

  it("keeps each centre's descendants together in a multi-branch project", () => {
    const nodes = [
      { id: "project", parentId: null },
      { id: "centre-a", parentId: "project" },
      { id: "centre-b", parentId: "project" },
      { id: "room-a", parentId: "centre-a" },
      { id: "room-b", parentId: "centre-b" },
      { id: "circuit-a", parentId: "room-a" },
      { id: "circuit-b", parentId: "room-b" },
    ];

    expect(orderProjectNodesDepthFirst(nodes).map((node) => node.id)).toEqual([
      "project",
      "centre-a",
      "room-a",
      "circuit-a",
      "centre-b",
      "room-b",
      "circuit-b",
    ]);
  });
});
