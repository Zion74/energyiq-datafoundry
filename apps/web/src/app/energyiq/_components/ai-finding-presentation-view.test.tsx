/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AiFindingPresentationView } from "./ai-finding-presentation-view";

describe("AiFindingPresentationView", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("renders one primary visual and folds the remaining visual forms", async () => {
    await act(async () => root.render(<AiFindingPresentationView presentation={{
      version: "1",
      blocks: [
        { type: "metric", label: "Latest day", value: 418.2, unit: "kWh", evidenceRefs: ["horizon:1d"] },
        {
          type: "comparison",
          title: "Current versus previous",
          items: [{ label: "Current", value: 2801 }, { label: "Previous", value: 2450 }],
          unit: "kWh",
          evidenceRefs: ["horizon:28d"],
        },
        {
          type: "trend",
          title: "Seven-day pattern",
          points: [{ label: "Mon", value: 10 }, { label: "Tue", value: 14 }, { label: "Wed", value: 12 }],
          evidenceSqlIndexes: [1],
        },
        {
          type: "heatmap",
          title: "Centre by hour",
          unit: "kWh",
          xLabels: ["09:00", "10:00"],
          yLabels: ["Centre A"],
          values: [[8, 9]],
          evidenceSqlIndexes: [2],
        },
        {
          type: "table",
          title: "Priority centres",
          columns: ["Centre", "Usage"],
          rows: [["Centre A", 8]],
          evidenceRefs: ["centre:A"],
        },
      ],
    }} />));

    expect(container.querySelector("[data-ai-presentation='true']")).not.toBeNull();
    expect(container.querySelectorAll("[data-ai-presentation-primary='true'] [data-presentation-type]")).toHaveLength(1);
    expect(container.querySelector("[data-ai-supporting-visuals='true']")?.hasAttribute("open")).toBe(false);
    expect(container.querySelector("[data-ai-supporting-visuals='true'] summary")?.textContent).toContain("Supporting visuals (4)");
    expect(container.querySelector("[data-presentation-type='metric']")?.textContent).toContain("418.2 kWh");
    expect(container.querySelector("[data-presentation-type='comparison']")?.textContent).toContain("Previous");
    expect(container.querySelector("[data-presentation-type='trend'] svg")).not.toBeNull();
    expect(container.querySelector("[data-presentation-a11y='trend']")?.textContent).toContain("Tue: 14");
    expect(container.querySelector("[data-presentation-type='heatmap'] [role='gridcell']")?.getAttribute("aria-label"))
      .toBe("Centre A, 09:00: 8 kWh");
    expect(container.querySelector("[data-presentation-type='table'] caption")?.textContent).toBe("Priority centres");
    expect(container.querySelector("[data-presentation-type='table'] th")?.getAttribute("scope")).toBe("col");
  });

  it.each([1, 3, 8])("keeps exactly one of %i blocks primary", async (blockCount) => {
    await act(async () => root.render(<AiFindingPresentationView presentation={{
      version: "1",
      blocks: Array.from({ length: blockCount }, (_, index) => ({
        type: "metric" as const,
        label: `Metric ${index + 1}`,
        value: index + 1,
        evidenceRefs: [`metric:${index + 1}`],
      })),
    }} />));

    expect(container.querySelectorAll("[data-ai-presentation-primary='true'] [data-presentation-type]")).toHaveLength(1);
    const supporting = container.querySelector("[data-ai-supporting-visuals='true']");
    if (blockCount === 1) {
      expect(supporting).toBeNull();
    } else {
      expect(supporting?.hasAttribute("open")).toBe(false);
      expect(supporting?.querySelector("summary")?.textContent).toContain(`Supporting visuals (${blockCount - 1})`);
      expect(supporting?.querySelectorAll("[data-presentation-type]")).toHaveLength(blockCount - 1);
    }
  });

  it("renders no visual shell when the analyst chose no blocks", async () => {
    await act(async () => root.render(<AiFindingPresentationView presentation={{ version: "1", blocks: [] }} />));
    expect(container.querySelector("[data-ai-presentation='true']")).toBeNull();
  });
});
