/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EnergyProjectAiOperationsDto } from "../../../lib/config-api";
import { ProjectAiOperations } from "./project-ai-operations";

describe("ProjectAiOperations", () => {
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

  it("loads the Project Run list first and reveals exact historical evidence only on demand", async () => {
    const list = operations();
    const detail = operations();
    detail.selectedRun = runDetail();
    const client = {
      getEnergyProjectAiOperations: vi.fn().mockResolvedValue(list),
      getEnergyProjectAiOperationsRun: vi.fn().mockResolvedValue(detail),
    };

    await act(async () => {
      root.render(<ProjectAiOperations projectId="preschool-demo" client={client} />);
    });

    expect(client.getEnergyProjectAiOperations).toHaveBeenCalledWith("preschool-demo");
    expect(client.getEnergyProjectAiOperationsRun).not.toHaveBeenCalled();
    expect(container.textContent).toContain("AI Operations");
    expect(container.textContent).toContain("Historical Run evidence");
    expect(container.textContent).toContain("Additional Insights");
    expect(container.textContent).toContain("2,900 tokens");
    expect(container.textContent).toContain("2 succeeded");
    expect(container.textContent).toContain("Partial trace");

    const view = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("View trace"));
    await act(async () => view?.click());

    expect(client.getEnergyProjectAiOperationsRun).toHaveBeenCalledWith("preschool-demo", "run-1");
    expect(container.textContent).toContain("Historical effective configuration");
    expect(container.textContent).toContain("Current configuration changes never rewrite this trace");
    expect(container.textContent).toContain("Selected for Run");
    expect(container.textContent).toContain("Actually materialized");
    expect(container.textContent).toContain("MCP server-to-tool mapping unavailable");
    expect(container.textContent).toContain("Current manifest was not substituted");
    expect(container.textContent).toContain("Context plan");
    expect(container.textContent).toContain("1 selected group");
    expect(container.textContent).toContain("1 omitted group");
    expect(container.textContent).toContain("1 truncation decision");
    expect(container.textContent).toContain("Tool calls");
    expect(container.textContent).toContain("Succeeded");
    expect(container.textContent).toContain("Rejected");
    expect(container.textContent).toContain("Token usage");
    expect(container.textContent).toContain("Artifact & Finding lineage");
    expect(container.textContent).not.toContain("private prompt body");
    const technical = container.querySelector<HTMLDetailsElement>("details[data-ai-operations-technical]");
    expect(technical?.open).toBe(false);
    expect(technical?.querySelector("summary")?.textContent).toContain("Technical IDs");
  });

  it("keeps an empty Project explicit without requesting a detail trace", async () => {
    const state = operations();
    state.runs = [];
    const client = {
      getEnergyProjectAiOperations: vi.fn().mockResolvedValue(state),
      getEnergyProjectAiOperationsRun: vi.fn(),
    };

    await act(async () => {
      root.render(<ProjectAiOperations projectId="preschool-demo" client={client} />);
    });

    expect(container.textContent).toContain("No persisted Runs are available for this Project");
    expect(container.textContent).toContain("Current Harness configuration is not used to fill this gap");
    expect(client.getEnergyProjectAiOperationsRun).not.toHaveBeenCalled();
  });
});

function operations(): EnergyProjectAiOperationsDto {
  return {
    project: { id: "preschool-demo", name: "Preschool Portfolio", workspaceId: "preschool-demo-org" },
    runs: [{
      runId: "run-1",
      actorId: "analyst-1",
      sessionId: "session-1",
      status: "completed",
      stage: "additional-insights",
      modelProvider: "openai-compatible",
      modelName: "historical-model",
      startedAt: "2026-08-15T10:00:00.000Z",
      finishedAt: "2026-08-15T10:00:08.000Z",
      latencyMs: 8_000,
      parentRunId: null,
      errorCode: null,
      inputTokens: 2_400,
      outputTokens: 500,
      toolCounts: { called: 3, succeeded: 2, rejected: 1, failed: 0 },
      traceAvailability: "partial",
    }],
    selectedRun: null,
  };
}

function runDetail(): NonNullable<EnergyProjectAiOperationsDto["selectedRun"]> {
  return {
    ...operations().runs[0]!,
    historicalConfiguration: {
      status: "available",
      detail: "Historical effective configuration comes only from this Run's persisted events.",
      modelProfileId: "historical-model-profile",
      resourceRevisions: { "skill:open-discovery": 2 },
      selectedSkills: [{ id: "open-discovery", name: "Open Discovery", revision: 2 }],
      selectionAudit: { selected: 1, rejected: 2, unavailable: 1 },
      loadedSkills: { status: "available", items: [{ id: "open-discovery", revision: 2 }] },
      mcp: {
        enabledServerIds: ["forecast-mcp"],
        serverToolMapping: { status: "unavailable", items: [] },
      },
    },
    context: {
      status: "available",
      steps: [{
        stepNumber: 1,
        packageId: "additional-insights-context",
        packageRevision: 3,
        planId: "plan-1",
        selectedGroupCount: 1,
        omittedGroupCount: 1,
        selectedSourceTypes: ["evidence"],
        omittedSourceTypes: ["conversation"],
        truncationDecisionCount: 1,
        promptTokens: 2_400,
        inputBudget: 96_000,
        contextWindow: 128_000,
        remainingTokens: 93_600,
        capabilitySource: "explicit-profile",
        highWaterMark: "below-budget",
      }],
    },
    tools: [{
      toolCallId: "tool-1",
      name: "energy.evidence.read",
      status: "succeeded",
      startedAt: "2026-08-15T10:00:01.000Z",
      finishedAt: "2026-08-15T10:00:02.000Z",
    }, {
      toolCallId: "tool-2",
      name: "run_sql_readonly",
      status: "rejected",
      startedAt: "2026-08-15T10:00:03.000Z",
      finishedAt: "2026-08-15T10:00:04.000Z",
    }],
    tokens: {
      input: 2_400,
      output: 500,
      total: 2_900,
      cache: { status: "unavailable", hit: null, miss: null },
    },
    lineage: {
      artifacts: [{ id: "artifact-1", type: "analysis", name: "Additional Insights" }],
      energyIqArtifacts: [{
        id: "energy-artifact-1",
        kind: "additional-insights",
        targetId: "additional-insights",
        findingIds: ["finding-1"],
      }],
    },
  };
}
