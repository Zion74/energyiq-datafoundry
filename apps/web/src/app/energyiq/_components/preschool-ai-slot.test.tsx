/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildEnergyAiHandoffInitialDraftPrompt } from "./energy-analysis-workbench";
import { PreschoolAiSlot } from "./preschool-ai-slot";
import type { PreschoolAiAcceptedArtifact } from "./preschool-ai-artifact";
import type { PreschoolAiProgress, PreschoolAiRunResult } from "./preschool-ai-run";
import { preschoolGoldenSnapshot } from "./preschool-overview.test-fixture";

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

  it("does not start a new AI Run when a saved result is reopened", async () => {
    const snapshot = preschoolGoldenSnapshot();
    const startRun = vi.fn().mockResolvedValue(availableResult());
    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={snapshot}
        mode="saved"
        startRun={startRun}
      />,
    ));

    expect(startRun).not.toHaveBeenCalled();
    expect(container.textContent).toContain("No completed AI result was attached");
    expect(container.textContent).toContain("never starts a new AI run");
  });

  it("restores a frozen AI result without starting a new Run", async () => {
    const snapshot = preschoolGoldenSnapshot();
    const startRun = vi.fn();
    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={snapshot}
        mode="saved"
        savedResult={availableResult()}
        startRun={startRun}
      />,
    ));

    expect(startRun).not.toHaveBeenCalled();
    expect(container.querySelector("[data-saved-ai-result='true']")?.textContent).toContain("run-1");
    expect(container.querySelectorAll("article")).toHaveLength(2);
    expect(container.querySelector("[data-ai-presentation='true']")?.textContent).toContain("Centre G");
    expectDecisionSummaryBeforeVisual(container);
  });

  it("renders accepted outcomes and labels an unverified explanation before passing it to Ask AI deeper", async () => {
    const startRun = vi.fn();
    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        mode="saved"
        savedResult={acceptedResult()}
        aiAnalystHref="/energyiq/ai?projectId=preschool-demo"
        startRun={startRun}
      />,
    ));

    expect(startRun).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Expected if acted on");
    expect(container.textContent).toContain("If ignored");
    expect(container.textContent).toContain("Possible explanation · needs verification");
    expect(container.textContent).toContain("Equipment schedules may differ from the published Calendar.");
    const askUrl = new URL(container.querySelector<HTMLAnchorElement>("article a")!.href);
    expect(JSON.parse(askUrl.searchParams.get("finding") ?? "null")).toMatchObject({
      possibleExplanation: "Equipment schedules may differ from the published Calendar.",
      expectedIfAct: "The review should isolate the avoidable condition.",
      ifIgnored: "The unexplained closed-hour load may continue.",
    });
    const handoff = buildEnergyAiHandoffInitialDraftPrompt(askUrl.searchParams);
    expect(handoff).toContain("Unverified possible explanation: Equipment schedules may differ from the published Calendar.");
    expect(handoff).toContain("Expected if acted on: The review should isolate the avoidable condition.");
  });

  it("keeps the deterministic Overview ready while analysis progresses", async () => {
    let finish!: (result: PreschoolAiRunResult) => void;
    let report!: (progress: PreschoolAiProgress) => void;
    const startRun = vi.fn((_input, onProgress) => new Promise<PreschoolAiRunResult>((resolve) => {
      finish = resolve;
      report = onProgress ?? (() => undefined);
    }));
    await renderSlot(startRun);

    expect(container.textContent).toContain("AI analysis queued…");
    expect(container.textContent).toContain("deterministic Overview is ready");
    await act(async () => report("querying"));
    expect(container.textContent).toContain("Querying Snapshot…");
    await act(async () => report("validating"));
    expect(container.textContent).toContain("Validating the investigation…");
    await act(async () => report("drafting"));
    expect(container.textContent).toContain("Drafting findings…");
    await act(async () => finish(availableResult()));
    expect(container.querySelectorAll("article")).toHaveLength(2);
    expect(container.textContent).toContain("Recommended next check");
    expect(container.textContent).toContain("Expected if acted on");
    expect(container.textContent).toContain("If ignored");
    expect(container.textContent).toContain("How to verify");
    expect(container.textContent).toContain("Limitations");
    expect(container.querySelectorAll("[data-ai-primary-takeaway='true']")).toHaveLength(2);
    expect(container.querySelectorAll("[data-ai-primary-action='true']")).toHaveLength(2);
    expect(container.querySelector("[data-ai-secondary-details='true']")?.hasAttribute("open")).toBe(false);
  });

  it("shows an honest no-additional-finding state instead of filler", async () => {
    await renderSlot(vi.fn().mockResolvedValue({ ...availableResult(), findings: [] }));
    await act(async () => undefined);

    expect(container.textContent).toContain("No additional Evidence-backed candidates");
    expect(container.querySelectorAll("article")).toHaveLength(0);
  });

  it("keeps provider failure optional and the verified Overview unchanged", async () => {
    const onResult = vi.fn();
    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        startRun={vi.fn().mockResolvedValue({ status: "unavailable", reason: "provider unavailable" })}
        onResult={onResult}
      />,
    ));
    await act(async () => undefined);

    expect(onResult).toHaveBeenCalledWith({ status: "unavailable", reason: "provider unavailable" });
    expect(container.textContent).toContain("AI analysis unavailable");
    expect(container.textContent).toContain("verified Overview remains available and unchanged");
  });

  it("offers one explicit server retry without resubmitting browser content", async () => {
    const retryRun = vi.fn().mockResolvedValue(availableResult());
    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        startRun={vi.fn().mockResolvedValue({ status: "unavailable", reason: "provider unavailable", retryable: true })}
        retryRun={retryRun}
      />,
    ));
    await act(async () => undefined);
    const retryButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Retry AI analysis"));
    expect(retryButton).toBeDefined();

    await act(async () => retryButton!.click());
    expect(retryRun).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll("article")).toHaveLength(2);
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

  it("keeps three Findings in a full-width scannable decision flow", async () => {
    const result = availableResult();
    result.findings.push(finding("preschool-ai-finding-3", "independent", false));
    await renderSlot(vi.fn().mockResolvedValue(result));
    await act(async () => undefined);

    const grid = container.querySelector('[aria-label="Preschool AI energy analyst findings"]')!;
    expect(grid.className).toContain("space-y-4");
    expect(grid.className).not.toContain("grid-cols");
    expect(container.querySelectorAll("article")).toHaveLength(3);
    expect(container.querySelectorAll("[data-ai-primary-takeaway='true']")).toHaveLength(3);
  });

  it("renders only the accepted Finding assigned to the current Overview section", async () => {
    const result = availableResult();
    result.findings[1] = finding("preschool-ai-finding-2", "independent", false, "centre-benchmark", ["efficiency"]);
    await renderSlot(vi.fn().mockResolvedValue(result), "centre-benchmark");
    await act(async () => undefined);

    expect(container.textContent).toContain("AI interpretation");
    expect(container.querySelector("[data-ai-section='centre-benchmark']")).not.toBeNull();
    expect(container.textContent).toContain("Standby is a separate angle");
    expect(container.textContent).not.toContain("Centre G deserves investigation");
    expect(container.querySelectorAll("article")).toHaveLength(1);
  });

  async function renderSlot(
    startRun: Parameters<typeof PreschoolAiSlot>[0]["startRun"],
    sectionId: Parameters<typeof PreschoolAiSlot>[0]["sectionId"] = "page-synthesis",
  ) {
    const snapshot = preschoolGoldenSnapshot();
    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={snapshot}
        sectionId={sectionId}
        aiAnalystHref="/energyiq/ai?projectId=preschool-demo&scopeId=project&resource=electricity&period=Custom&from=2026-05-01&to=2026-05-31&dataCutoff=2026-05-31&dataSnapshotId=preschool-26b85b9c0b95e090"
        startRun={startRun}
      />,
    ));
  }
});

function expectDecisionSummaryBeforeVisual(container: HTMLElement): void {
  const takeaway = container.querySelector("[data-ai-primary-takeaway='true']");
  const action = container.querySelector("[data-ai-primary-action='true']");
  const presentation = container.querySelector("[data-ai-presentation='true']");
  expect(takeaway).not.toBeNull();
  expect(action).not.toBeNull();
  expect(presentation).not.toBeNull();
  expect(takeaway!.compareDocumentPosition(action!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(action!.compareDocumentPosition(presentation!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}

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

function acceptedResult(): PreschoolAiAcceptedArtifact {
  const binding = {
    projectId: "preschool-demo" as const,
    scopeId: "preschool-project",
    dataSnapshotId: "preschool-26b85b9c0b95e090",
    projectReleaseId: "legacy-profile:preschool-demo:1",
    dataCutoff: "2026-05-31T16:00:00.000Z",
    analysisPeriod: { from: "2026-04-30T16:00:00.000Z", to: "2026-05-31T16:00:00.000Z" },
    outputContractRevision: "v13" as const,
  };
  return {
    status: "available",
    providerProfileId: "profile-1",
    runId: "accepted-editor-run",
    packId: "preschool-analysis-pack",
    packRevision: "v1",
    contract: { id: "preschool-ai-accepted-artifact", revision: "v13" },
    binding,
    workflow: {
      id: "preschool-two-stage",
      revision: "preschool-two-stage-v2",
      methodSkill: { id: "energy-insight-investigation", revision: "1.0.0" },
      stages: {
        investigator: { runId: "accepted-investigator-run", promptRevision: "preschool-investigator-v8" },
        editor: { runId: "accepted-editor-run", promptRevision: "preschool-insight-editor-v3" },
      },
    },
    findings: [{
      id: "accepted-finding-1",
      binding,
      placementTargets: ["preschool.overall-key-findings"],
      epistemicLevel: "hypothesis",
      relationship: "independent",
      signalRefs: [],
      title: "Closed-hour load needs an operating check",
      takeaway: "The cited Snapshot shows a repeatable closed-hour pattern.",
      interpretation: "This matters because the load occurs outside the published Calendar.",
      possibleExplanation: "Equipment schedules may differ from the published Calendar.",
      action: "Check equipment schedules with the Centre operator.",
      expectedIfAct: "The review should isolate the avoidable condition.",
      ifIgnored: "The unexplained closed-hour load may continue.",
      verification: "Compare the same hours after the schedule check.",
      uncertainty: "The pinned Evidence does not prove equipment state.",
      evidence: {
        snapshotId: binding.dataSnapshotId,
        period: binding.analysisPeriod,
        deterministic: [{
          id: "operating:closed-hour-pattern",
          kind: "operating",
          label: "Closed-hour pattern",
          unit: "kWh",
          values: { status: "observed" },
          queryIds: ["operating-query"],
          limitation: "Does not establish equipment state.",
        }],
        tools: [],
      },
    }],
  };
}

function finding(
  id: string,
  relationship: "supports" | "independent",
  withSql: boolean,
  sectionId: Extract<PreschoolAiRunResult, { status: "available" }>["findings"][number]["sectionId"] = "page-synthesis",
  signalRefs: string[] = [],
): Extract<PreschoolAiRunResult, { status: "available" }>["findings"][number] {
  return {
    id,
    sectionId,
    signalRefs,
    relationship,
    title: id === "preschool-ai-finding-1" ? "Centre G deserves investigation" : "Standby is a separate angle",
    what: "A scoped pattern is visible.",
    why: { kind: withSql ? "Evidence" : "Hypothesis", text: "The cited Evidence supports an investigation." },
    how: "Inspect the operating context and leading Circuit.",
    expectedIfAct: "The review should isolate the operating condition behind the pattern.",
    ifIgnored: "The unresolved pattern may continue without an accountable investigation.",
    howToVerify: "Repeat the same scoped comparison after investigation.",
    evidenceNote: "This is not a confirmed root cause.",
    ...(withSql ? {
      presentation: {
        version: "1" as const,
        blocks: [{
          type: "metric" as const,
          label: "Centre G EUI",
          value: 12.6,
        }],
      },
    } : {}),
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
        evidenceIndex: 1,
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
