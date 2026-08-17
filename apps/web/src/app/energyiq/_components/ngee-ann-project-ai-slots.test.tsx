/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EnergyProjectOverviewAiReadModelDto } from "../../../lib/config-api";
import { ngeeAnnGoldenSnapshot } from "./ngee-ann-overview.test-fixture";
import { NgeeAnnProjectAiSlots } from "./ngee-ann-project-ai-slots";

describe("NgeeAnnProjectAiSlots", () => {
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
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("restores exact stored Key Findings and four Section states through one read-only GET", async () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const restore = vi.fn().mockResolvedValue(readModel(snapshot));

    await act(async () => {
      root.render(<NgeeAnnProjectAiSlots snapshot={snapshot} restore={restore} />);
    });

    expect(restore).toHaveBeenCalledOnce();
    expect(restore).toHaveBeenCalledWith(snapshot.context.projectId, snapshot.context.scopeId);
    expect(container.textContent).toContain("4 of 4 Sections ready");
    expect(container.textContent).toContain("Peak demand and time behaviour should be read together");
    expect(container.textContent).toContain("Trend and demand");
    expect(container.textContent).toContain("Time behaviour");
    expect(container.textContent).toContain("Circuit concentration");
    expect(container.textContent).toContain("Decision priorities");
    expect(container.textContent).toContain("Possible");
    expect(container.textContent).toContain("Not generated for this Snapshot yet");
  });

  it("never displays a read model from another Snapshot", async () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const wrong = readModel(snapshot);
    wrong.binding.dataSnapshotId = "snapshot-stale";

    await act(async () => {
      root.render(<NgeeAnnProjectAiSlots snapshot={snapshot} restore={vi.fn().mockResolvedValue(wrong)} />);
    });

    expect(container.textContent).toContain("does not match this Snapshot");
    expect(container.textContent).not.toContain("Peak demand and time behaviour should be read together");
  });
});

const readModel = (snapshot: ReturnType<typeof ngeeAnnGoldenSnapshot>): EnergyProjectOverviewAiReadModelDto => ({
  contract: "energyiq-project-overview-ai-read-model@1",
  rendererKey: "ngee-ann-overview",
  binding: {
    workspaceId: snapshot.context.workspaceId,
    projectId: snapshot.context.projectId,
    scopeId: snapshot.context.scopeId,
    dataSnapshotId: snapshot.dataSnapshot.id,
    projectReleaseId: snapshot.projectRelease.id,
    analysisPeriod: { from: snapshot.context.primaryPeriod.start, to: snapshot.context.primaryPeriod.endExclusive },
    modelProfileId: "workspace-default-model-profile",
    modelProfileRevision: 8,
    generation: {},
  },
  keyFindings: {
    status: "available",
    artifactId: "artifact:executive",
    result: {
      status: "available",
      summary: { text: "Peak demand and time behaviour should be read together.", evidenceRefs: ["evidence:trend"] },
      findings: [{
        id: "finding:1", title: "A shared operational boundary is possible", text: "The timing pattern may help explain when the peak forms.",
        epistemicStatus: "speculative", evidenceRefs: ["evidence:trend", "evidence:time"],
      }],
    },
  },
  sections: Object.fromEntries(["trend-and-demand", "time-behaviour", "circuit-concentration", "decision-priorities"].map((sectionId) => [sectionId, {
    status: "available",
    artifactId: `artifact:${sectionId}`,
    result: {
      status: "available",
      summary: { text: `Current ${sectionId} conclusion.`, evidenceRefs: [`evidence:${sectionId}`] },
      insights: [],
    },
  }])),
  additionalInsights: { status: "missing" },
});
