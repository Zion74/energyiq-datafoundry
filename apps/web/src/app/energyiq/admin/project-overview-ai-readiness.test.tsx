/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EnergyProjectOverviewAdminStateDto } from "../../../lib/config-api";
import { ProjectOverviewAiReadiness } from "./project-overview-ai-readiness";

describe("ProjectOverviewAiReadiness", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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

  it("shows the customer-visible state, independent analysis items and one generation action", async () => {
    const initial = preschoolState();
    const ready = preschoolState({
      analysis: {
        ...initial.analysis,
        status: "ready",
        detail: "All 6 saved analysis results are ready.",
        readyCount: 6,
        items: initial.analysis.items.map((item) => ({ ...item, status: "ready" as const })),
      },
      allowedActions: [],
      recommendedNextAction: null,
    });
    const client = {
      getEnergyProjectOverviewAdminState: vi.fn().mockResolvedValue(initial),
      generateMissingEnergyProjectOverviewAnalysis: vi.fn().mockResolvedValue(ready),
    };

    await act(async () => {
      root.render(<ProjectOverviewAiReadiness projectId="preschool-demo" client={client} />);
    });

    expect(container.textContent).toContain("AI Analysis readiness");
    expect(container.textContent).toContain("1 of 6 ready");
    expect(container.textContent).toContain("Key Findings");
    expect(container.textContent).toContain("Centre benchmark");
    expect(container.textContent).toContain("Additional AI Insights");
    expect(container.textContent).not.toContain("Artifact");

    const generate = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Generate missing analysis");
    expect(generate).toBeDefined();
    await act(async () => generate?.click());

    expect(client.generateMissingEnergyProjectOverviewAnalysis).toHaveBeenCalledWith("preschool-demo");
    expect(container.textContent).toContain("6 of 6 ready");
    expect(container.textContent).not.toContain("Generate missing analysis");
  });

  it("does not invent Preschool Sections for Ngee Ann", async () => {
    const state: EnergyProjectOverviewAdminStateDto = {
      projectId: "ngee-ann-polytechnic",
      projectName: "Ngee Ann Polytechnic",
      rendererKey: "ngee-ann-overview",
      customerOverview: { status: "ready", detail: "The published customer Overview is available.", url: "/energyiq/overview?projectId=ngee-ann-polytechnic" },
      currentIdentity: null,
      capabilities: { keyFindings: false, sectionAnalysis: [], additionalInsights: false },
      analysis: {
        supported: false,
        status: "ready",
        detail: "This Project uses its existing Ngee Ann Overview analysis path. Layer 1–3 readiness is not connected yet.",
        readyCount: 0,
        totalCount: 0,
        lastGeneratedAt: null,
        items: [],
      },
      allowedActions: [],
      recommendedNextAction: null,
    };
    const client = {
      getEnergyProjectOverviewAdminState: vi.fn().mockResolvedValue(state),
      generateMissingEnergyProjectOverviewAnalysis: vi.fn(),
    };

    await act(async () => {
      root.render(<ProjectOverviewAiReadiness projectId="ngee-ann-polytechnic" client={client} />);
    });

    expect(container.textContent).toContain("existing Ngee Ann Overview analysis path");
    expect(container.textContent).not.toContain("Centre benchmark");
    expect(container.textContent).not.toContain("Generate missing analysis");
  });

  it("does not say no action is needed when saved analysis needs attention", async () => {
    const initial = preschoolState();
    const state = preschoolState({
      allowedActions: [],
      recommendedNextAction: null,
      analysis: {
        ...initial.analysis,
        status: "needs-attention",
      },
    });
    const client = {
      getEnergyProjectOverviewAdminState: vi.fn().mockResolvedValue(state),
      generateMissingEnergyProjectOverviewAnalysis: vi.fn(),
    };

    await act(async () => {
      root.render(<ProjectOverviewAiReadiness projectId="preschool-demo" client={client} variant="summary" />);
    });

    expect(container.textContent).toContain("Review readiness details");
    expect(container.textContent).not.toContain("No action needed");
  });
});

function preschoolState(overrides: Partial<EnergyProjectOverviewAdminStateDto> = {}): EnergyProjectOverviewAdminStateDto {
  const base: EnergyProjectOverviewAdminStateDto = {
    projectId: "preschool-demo",
    projectName: "Preschool Portfolio",
    rendererKey: "preschool-overview",
    customerOverview: { status: "ready", detail: "The published customer Overview is available.", url: "/energyiq/overview?projectId=preschool-demo" },
    currentIdentity: {
      dataSnapshotId: "snapshot-current",
      projectReleaseId: "release-current",
      analysisPeriod: { from: "2026-04-30T16:00:00.000Z", to: "2026-05-31T16:00:00.000Z" },
      modelProfileRevision: 8,
    },
    capabilities: {
      keyFindings: true,
      sectionAnalysis: ["centre-benchmark", "standby-wastage", "operating-behaviour", "planning-outlook"],
      additionalInsights: true,
    },
    analysis: {
      supported: true,
      status: "needs-attention",
      detail: "1 of 6 saved analysis results are ready; one or more items need attention.",
      readyCount: 1,
      totalCount: 6,
      lastGeneratedAt: "2026-08-15T01:00:00.000Z",
      items: [
        { id: "key-findings", label: "Key Findings", status: "needs-attention", detail: "This analysis needs attention." },
        { id: "section:centre-benchmark", label: "Centre benchmark", status: "ready", detail: "Ready." },
        { id: "section:standby-wastage", label: "Closed-hours use", status: "not-generated", detail: "Not generated." },
        { id: "section:operating-behaviour", label: "Operating-hours behaviour", status: "not-generated", detail: "Not generated." },
        { id: "section:planning-outlook", label: "Planning outlook", status: "not-generated", detail: "Not generated." },
        { id: "additional-insights", label: "Additional AI Insights", status: "not-generated", detail: "Not generated." },
      ],
    },
    allowedActions: ["generate-missing"],
    recommendedNextAction: {
      action: "generate-missing",
      label: "Generate missing analysis",
      detail: "Create only missing results.",
    },
  };
  return { ...base, ...overrides };
}
