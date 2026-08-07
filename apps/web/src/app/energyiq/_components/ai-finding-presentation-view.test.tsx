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

  it("renders the visual forms chosen by the analyst", async () => {
    await act(async () => root.render(<AiFindingPresentationView presentation={{
      version: "1",
      blocks: [
        { type: "metric", label: "Latest day", value: 418.2, unit: "kWh" },
        {
          type: "comparison",
          title: "Current versus previous",
          items: [{ label: "Current", value: 2801 }, { label: "Previous", value: 2450 }],
          unit: "kWh",
        },
        {
          type: "trend",
          title: "Seven-day pattern",
          points: [{ label: "Mon", value: 10 }, { label: "Tue", value: 14 }, { label: "Wed", value: 12 }],
        },
      ],
    }} />));

    expect(container.querySelector("[data-ai-presentation='true']")).not.toBeNull();
    expect(container.querySelector("[data-presentation-type='metric']")?.textContent).toContain("418.2 kWh");
    expect(container.querySelector("[data-presentation-type='comparison']")?.textContent).toContain("Previous");
    expect(container.querySelector("[data-presentation-type='trend'] svg")).not.toBeNull();
  });
});
