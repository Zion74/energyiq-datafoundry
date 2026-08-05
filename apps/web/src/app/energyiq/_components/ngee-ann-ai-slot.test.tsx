/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NgeeAnnAiSlot, buildAskAiDeeperHref } from "./ngee-ann-ai-slot";
import type { NgeeAnnAiFinding, NgeeAnnAiRunResult } from "./ngee-ann-ai-run";
import { ngeeAnnGoldenSnapshot } from "./ngee-ann-overview.test-fixture";

describe("NgeeAnnAiSlot", () => {
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
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows the deterministic-safe analyzing state immediately, then three Findings", async () => {
    let finishRun!: (result: NgeeAnnAiRunResult) => void;
    const startRun = vi.fn(() => new Promise<NgeeAnnAiRunResult>((resolve) => {
      finishRun = resolve;
    }));
    await act(async () => {
      root.render(
        <NgeeAnnAiSlot
          snapshot={ngeeAnnGoldenSnapshot()}
          aiAnalystHref="/energyiq/ai?projectId=ngee-ann-polytechnic&period=Custom"
          startRun={startRun}
        />,
      );
    });

    expect(container.textContent).toContain("Analyzing / Thinking");
    expect(container.textContent).toContain("The deterministic Overview is ready");

    await act(async () => finishRun(availableResult()));

    expect(container.textContent).toContain("Supports theme");
    expect(container.textContent).toContain("Challenges theme");
    expect(container.textContent).toContain("Independent theme");
    expect(container.textContent).toContain("How to verify");
    expect(container.querySelectorAll("article")).toHaveLength(3);
    expect(startRun).toHaveBeenCalledTimes(1);
  });

  it("opens Finding-specific SQL Evidence in one click", async () => {
    const startRun = vi.fn().mockResolvedValue(availableResult());
    await act(async () => {
      root.render(<NgeeAnnAiSlot snapshot={ngeeAnnGoldenSnapshot()} startRun={startRun} />);
    });
    const button = Array.from(container.querySelectorAll("button"))
      .find((candidate) => candidate.textContent?.includes("View evidence"));
    if (!button) throw new Error("Expected a View evidence button");

    await act(async () => button.click());

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Finding Evidence");
    expect(dialog?.textContent).toContain("snapshot-1");
    expect(dialog?.textContent).toContain("SELECT 150 AS usage_kwh");
    expect(dialog?.textContent).not.toContain("SELECT 21.4 AS average_kwh");
  });

  it("does not start a new Run for local UI href changes", async () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const startRun = vi.fn().mockResolvedValue(availableResult());
    await act(async () => {
      root.render(<NgeeAnnAiSlot snapshot={snapshot} aiAnalystHref="/energyiq/ai?period=Custom" startRun={startRun} />);
    });
    await act(async () => {
      root.render(<NgeeAnnAiSlot snapshot={snapshot} aiAnalystHref="/energyiq/ai?period=Yesterday" startRun={startRun} />);
    });

    expect(startRun).toHaveBeenCalledTimes(1);
  });

  it("starts a new Run when the authoritative Snapshot identity changes", async () => {
    const firstSnapshot = ngeeAnnGoldenSnapshot();
    const nextSnapshot = ngeeAnnGoldenSnapshot();
    nextSnapshot.dataSnapshot.id = "snapshot-next";
    nextSnapshot.context.dataSnapshotId = "snapshot-next";
    const startRun = vi.fn().mockResolvedValue(availableResult());
    await act(async () => {
      root.render(<NgeeAnnAiSlot snapshot={firstSnapshot} startRun={startRun} />);
    });
    await act(async () => {
      root.render(<NgeeAnnAiSlot snapshot={nextSnapshot} startRun={startRun} />);
    });

    expect(startRun).toHaveBeenCalledTimes(2);
    expect(startRun.mock.calls[1]![0].snapshotId).toBe("snapshot-next");
  });

  it("keeps an AI failure isolated from the deterministic Overview", async () => {
    const startRun = vi.fn().mockResolvedValue({ status: "unavailable", reason: "Model timeout" });
    await act(async () => {
      root.render(<NgeeAnnAiSlot snapshot={ngeeAnnGoldenSnapshot()} startRun={startRun} />);
    });

    expect(container.textContent).toContain("AI analysis unavailable");
    expect(container.textContent).toContain("Model timeout");
    expect(container.textContent).toContain("The deterministic Overview remains available and unchanged");
  });

  it("passes only Project, Finding and Evidence into Ask AI deeper", () => {
    const href = buildAskAiDeeperHref(
      "/energyiq/ai?projectId=old&scopeId=old&period=Custom&from=2020-01-01",
      "ngee-ann-polytechnic",
      finding("finding-1", "supports", ["1d", "7d"], "sql-1", "SELECT 150 AS usage_kwh"),
    );
    const url = new URL(href, "https://energyiq.local");

    expect([...url.searchParams.keys()].sort()).toEqual(["evidence", "finding", "projectId"]);
    expect(url.searchParams.get("projectId")).toBe("ngee-ann-polytechnic");
    expect(url.searchParams.get("finding")).toContain("How to verify");
    expect(url.searchParams.get("evidence")).toContain("snapshot-1");
  });
});

function availableResult(): NgeeAnnAiRunResult {
  return {
    status: "available",
    providerProfileId: "profile-1",
    runId: "run-1",
    findings: [
      finding("finding-1", "supports", ["1d", "7d"], "sql-1", "SELECT 150 AS usage_kwh"),
      finding("finding-2", "challenges", ["7d", "28d"], "sql-2", "SELECT 21.4 AS average_kwh"),
      finding("finding-3", "independent", ["28d"], "sql-3", "SELECT 34.2 AS peak_kwh"),
    ],
  };
}

function finding(
  id: string,
  relationship: NgeeAnnAiFinding["relationship"],
  horizons: NgeeAnnAiFinding["horizons"],
  toolCallId: string,
  sql: string,
): NgeeAnnAiFinding {
  return {
    id,
    relationship,
    horizons,
    title: `${relationship} Finding`,
    what: "A useful energy pattern was identified.",
    why: { kind: "Evidence", text: "The SQL result supports this angle." },
    how: "Inspect the relevant operating condition.",
    howToVerify: "How to verify this Finding after an operational change.",
    evidenceNote: "This is Finding-specific SQL Evidence.",
    evidence: {
      snapshotId: "snapshot-1",
      dataCutoff: "2026-06-16",
      tools: [{
        toolCallId,
        toolName: "run_sql_readonly",
        sql,
        rowCount: 1,
        auditLogId: `audit-${toolCallId}`,
        elapsedMs: 12,
        resultPreview: JSON.stringify({ columns: ["value"], rows: [[150]] }),
      }],
    },
  };
}
