/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildEnergyAiHandoffInitialDraftPrompt } from "./energy-analysis-workbench";
import { PreschoolAiSlot } from "./preschool-ai-slot";
import type { PreschoolAiProgress, PreschoolAiRunResult } from "./preschool-ai-run";
import { preschoolGoldenSnapshot } from "./preschool-overview.test-fixture";
import { buildPreschoolOverviewViewModel } from "./preschool-overview-view-model";

describe("PreschoolAiSlot", () => {
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps the deterministic Overview ready while analysis progresses", async () => {
    let finish!: (result: PreschoolAiRunResult) => void;
    let report!: (progress: PreschoolAiProgress) => void;
    const startRun = vi.fn((_input, onProgress) => new Promise<PreschoolAiRunResult>((resolve) => {
      finish = resolve;
      report = onProgress ?? (() => undefined);
    }));
    await renderSlot(startRun);

    expect(container.textContent).toContain("Inspecting scoped data…");
    expect(container.textContent).toContain("deterministic Overview is ready");
    await act(async () => report("querying"));
    expect(container.textContent).toContain("Querying Snapshot…");
    await act(async () => report("drafting"));
    expect(container.textContent).toContain("Drafting findings…");
    await act(async () => finish(availableResult()));
    expect(container.querySelectorAll("article")).toHaveLength(2);
    expect(container.textContent).toContain("Next investigation");
    expect(container.textContent).toContain("How to verify");
  });

  it("shows an honest no-additional-finding state instead of filler", async () => {
    await renderSlot(vi.fn().mockResolvedValue({ ...availableResult(), findings: [] }));
    await act(async () => undefined);

    expect(container.textContent).toContain("No additional Evidence-backed candidates");
    expect(container.querySelectorAll("article")).toHaveLength(0);
  });

  it("keeps provider failure optional and the verified Overview unchanged", async () => {
    await renderSlot(vi.fn().mockResolvedValue({ status: "unavailable", reason: "provider unavailable" }));
    await act(async () => undefined);

    expect(container.textContent).toContain("AI analysis unavailable");
    expect(container.textContent).toContain("verified Overview remains available and unchanged");
  });

  it("opens compact Evidence and carries one Finding into Ask AI deeper", async () => {
    await renderSlot(vi.fn().mockResolvedValue(availableResult()));
    await act(async () => undefined);
    const firstCard = container.querySelector("article")!;
    const evidenceButton = [...firstCard.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("View evidence"))!;
    await act(async () => evidenceButton.click());

    expect(document.body.textContent).toContain("preschool-analysis-pack@v1");
    expect(document.body.textContent).toContain("preschool-26b85b9c0b95e090");
    expect(document.body.textContent).toContain("audit-sql-1");
    expect(document.body.textContent).toContain("scope_summary_v1");
    expect(document.body.textContent).toContain("Rows 1");
    expect(document.body.textContent).toContain("12 ms");
    expect(document.body.textContent).toContain("preschool-centre-7");
    const askLink = firstCard.querySelector<HTMLAnchorElement>("a")!;
    expect(askLink.textContent).toContain("Ask AI deeper");
    const askUrl = new URL(askLink.href);
    expect(Object.fromEntries(askUrl.searchParams)).toMatchObject({
      projectId: "preschool-demo",
      scopeId: "project",
      resource: "electricity",
      period: "Custom",
      from: "2026-05-01",
      to: "2026-05-31",
      dataCutoff: "2026-05-31",
      dataSnapshotId: "preschool-26b85b9c0b95e090",
    });
    expect(buildEnergyAiHandoffInitialDraftPrompt(askUrl.searchParams)).toContain(
      "Centre G deserves investigation",
    );
    expect(buildEnergyAiHandoffInitialDraftPrompt(askUrl.searchParams)).toContain(
      "preschool-26b85b9c0b95e090",
    );
    expect(buildEnergyAiHandoffInitialDraftPrompt(askUrl.searchParams)).toContain(
      "Data cutoff reference: 2026-05-31",
    );
    expect(askUrl.searchParams.has("findingId")).toBe(false);
    expect(askUrl.searchParams.has("evidenceSnapshotId")).toBe(false);
  });

  it("uses a three-column desktop grid only when three Findings are returned", async () => {
    const result = availableResult();
    result.findings.push(finding("preschool-ai-finding-3", "independent", false));
    await renderSlot(vi.fn().mockResolvedValue(result));
    await act(async () => undefined);

    const grid = container.querySelector('[aria-label="Preschool AI energy analyst findings"]')!;
    expect(grid.className).toContain("lg:grid-cols-2");
    expect(grid.className).toContain("xl:grid-cols-3");
    expect(container.querySelectorAll("article")).toHaveLength(3);
  });

  async function renderSlot(startRun: Parameters<typeof PreschoolAiSlot>[0]["startRun"]) {
    const snapshot = preschoolGoldenSnapshot();
    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={snapshot}
        decisionSummary={buildPreschoolOverviewViewModel(snapshot).decisionSummary}
        aiAnalystHref="/energyiq/ai?projectId=preschool-demo&scopeId=project&resource=electricity&period=Custom&from=2026-05-01&to=2026-05-31&dataCutoff=2026-05-31&dataSnapshotId=preschool-26b85b9c0b95e090"
        startRun={startRun}
      />,
    ));
  }
});

function availableResult(): Extract<PreschoolAiRunResult, { status: "available" }> {
  return {
    status: "available",
    providerProfileId: "profile-1",
    runId: "run-1",
    packId: "preschool-analysis-pack",
    packRevision: "v1",
    findings: [
      finding("preschool-ai-finding-1", "supports", true),
      finding("preschool-ai-finding-2", "independent", false),
    ],
  };
}

function finding(
  id: string,
  relationship: "supports" | "independent",
  withSql: boolean,
): Extract<PreschoolAiRunResult, { status: "available" }>["findings"][number] {
  return {
    id,
    relationship,
    title: id === "preschool-ai-finding-1" ? "Centre G deserves investigation" : "Standby is a separate angle",
    what: "A scoped pattern is visible.",
    why: { kind: withSql ? "Evidence" : "Hypothesis", text: "The cited Evidence supports an investigation." },
    how: "Inspect the operating context and leading Circuit.",
    howToVerify: "Repeat the same scoped comparison after investigation.",
    evidenceNote: "This is not a confirmed root cause.",
    evidence: {
      snapshotId: "preschool-26b85b9c0b95e090",
      period: { from: "2026-05-01", to: "2026-05-31" },
      deterministic: [{
        id: withSql ? "benchmark:priority-centre:G" : "operating:portfolio",
        kind: withSql ? "centre" : "operating",
        label: withSql ? "Priority Centre G" : "Published Calendar split",
        unit: withSql ? null : "kWh",
        values: withSql ? { centreCode: "G", eui: 12.6 } : { standbySharePct: 12.45 },
        queryIds: ["scope_summary_v1"],
        limitation: "Not a confirmed cause.",
      }],
      tools: withSql ? [{
        toolCallId: "sql-1",
        sql: "SELECT parent_node_id, SUM(usage_kwh) FROM energy_intervals GROUP BY parent_node_id",
        rowCount: 1,
        auditLogId: "audit-sql-1",
        elapsedMs: 12,
        resultPreview: "{\"rows\":[[\"preschool-centre-7\",843.0985]]}",
      }] : [],
    },
  };
}
