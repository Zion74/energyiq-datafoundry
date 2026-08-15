/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EnergyIqAdminSidebar } from "./admin-sidebar";

describe("EnergyIqAdminSidebar", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("React", React);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("keeps a narrow clickable rail after desktop collapse", async () => {
    const onDesktopCollapsedChange = vi.fn<(collapsed: boolean) => void>();

    await act(async () => {
      root.render(
        <EnergyIqAdminSidebar
          projects={[{ id: "project-1", name: "Project 1", status: "published" }]}
          selectedProjectId="project-1"
          activeSection="overview"
          desktopCollapsed
          onProjectChange={() => undefined}
          onCreateProject={() => undefined}
          onDesktopCollapsedChange={onDesktopCollapsedChange}
          onSectionChange={() => undefined}
        />,
      );
    });

    expect(container.querySelector("aside[aria-label='Admin navigation rail']")).not.toBeNull();
    const expand = container.querySelector<HTMLButtonElement>("button[aria-label='Show admin navigation']");
    await act(async () => expand?.click());
    expect(onDesktopCollapsedChange).toHaveBeenCalledWith(false);
  });

  it("uses an icon-only collapse control and omits the redundant subtitle", async () => {
    const onDesktopCollapsedChange = vi.fn<(collapsed: boolean) => void>();
    const onSectionChange = vi.fn();

    await act(async () => {
      root.render(
        <EnergyIqAdminSidebar
          projects={[{ id: "project-1", name: "Project 1", status: "published" }]}
          selectedProjectId="project-1"
          activeSection="overview"
          desktopCollapsed={false}
          onProjectChange={() => undefined}
          onCreateProject={() => undefined}
          onDesktopCollapsedChange={onDesktopCollapsedChange}
          onSectionChange={onSectionChange}
        />,
      );
    });

    expect(container.textContent).toContain("Admin console");
    expect(container.textContent).toContain("Overview Design");
    expect(container.textContent).toContain("AI Analysis");
    expect(container.textContent).toContain("Methods & SOP");
    expect(container.textContent).toContain("Harness Configuration");
    expect(container.textContent).toContain("Configuration overview");
    expect(container.textContent).not.toContain("AI Configuration");
    const harness = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Configuration overview"));
    await act(async () => harness?.click());
    expect(onSectionChange).toHaveBeenCalledWith("harness");
    expect(container.textContent).not.toContain("Overview Setup");
    expect(container.textContent).not.toContain("Templates");
    expect(container.textContent).not.toContain("Delivery, access and AI operations");
    const collapse = container.querySelector<HTMLButtonElement>("button[aria-label='Collapse admin navigation']");
    expect(collapse?.textContent).toBe("");
    await act(async () => collapse?.click());
    expect(onDesktopCollapsedChange).toHaveBeenCalledWith(true);
  });
});
