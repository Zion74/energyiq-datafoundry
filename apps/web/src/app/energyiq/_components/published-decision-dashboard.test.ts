/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  EnergyAccessContextDto,
  EnergyComponentRevisionDto,
  EnergyProjectAnalysisResolutionDto,
  EnergyProjectHierarchyDto,
  EnergyProjectDto,
  EnergyTemplateDefinitionDto,
} from "../../../lib/config-api";
import { configApi } from "../../../lib/config-api";
import { buildEnergyTemplateRenderPlan } from "./energy-template-render-plan";
import {
  overviewAnalysisRequest,
  PublishedDecisionDashboard,
  toDateInput,
} from "./published-decision-dashboard";
import { applyProjectAnalysisQualityPolicy } from "./project-renderer-registry";

const mockedAccess = vi.hoisted(() => ({
  access: null as EnergyAccessContextDto | null,
  activeProject: null as EnergyProjectDto | null,
  selectProject: vi.fn<(projectId: string) => void>(),
}));
const mockedRouter = vi.hoisted(() => ({
  replace: vi.fn<(href: string) => void>(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mockedRouter,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock("./energyiq-access", () => ({
  useEnergyIqAccess: () => ({
    access: mockedAccess.access,
    activeProject: mockedAccess.activeProject,
    selectProject: mockedAccess.selectProject,
  }),
}));

describe("published Overview URL reload", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("React", React);
    mockedAccess.access = null;
    mockedAccess.activeProject = null;
    mockedAccess.selectProject.mockReset();
    mockedRouter.replace.mockReset();
    vi.spyOn(configApi, "getEnergyProjectHierarchy").mockResolvedValue(projectHierarchy());
    window.history.replaceState({}, "", "/energyiq/overview");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses the public Custom URL for the first trusted resolve after Project access loads", async () => {
    window.history.replaceState({}, "", "/energyiq/overview?period=Custom&from=2026-06-10&to=2026-06-16");
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });
    expect(resolveProjectAnalysis).not.toHaveBeenCalled();

    mockedAccess.activeProject = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).toHaveBeenCalledTimes(1);
    expect(resolveProjectAnalysis).toHaveBeenCalledWith({
      projectId: "ngee-ann-polytechnic",
      scopeId: "project",
      resource: "electricity",
      period: "Custom",
      from: "2026-06-10",
      to: "2026-06-16",
    });
    expect(Array.from(container.querySelectorAll<HTMLInputElement>("input[type='date']"), (input) => input.value))
      .toEqual(["2026-06-10", "2026-06-16"]);
  });

  it("atomically resolves new Custom dates after client navigation changes the public URL", async () => {
    mockedAccess.activeProject = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    window.history.replaceState({}, "", "/energyiq/overview?period=Custom&from=2026-06-01&to=2026-06-07");
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });
    expect(resolveProjectAnalysis).toHaveBeenCalledWith({
      projectId: "ngee-ann-polytechnic",
      scopeId: "project",
      resource: "electricity",
      period: "Custom",
      from: "2026-06-01",
      to: "2026-06-07",
    });

    resolveProjectAnalysis.mockClear();
    window.history.replaceState({}, "", "/energyiq/overview?period=Custom&from=2026-06-10&to=2026-06-16");
    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).toHaveBeenCalledTimes(1);
    expect(resolveProjectAnalysis).toHaveBeenCalledWith({
      projectId: "ngee-ann-polytechnic",
      scopeId: "project",
      resource: "electricity",
      period: "Custom",
      from: "2026-06-10",
      to: "2026-06-16",
    });
    expect(Array.from(container.querySelectorAll<HTMLInputElement>("input[type='date']"), (input) => input.value))
      .toEqual(["2026-06-10", "2026-06-16"]);
  });

  it("does not resolve an incomplete Custom URL and explains which dates are required", async () => {
    mockedAccess.activeProject = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    window.history.replaceState({}, "", "/energyiq/overview?period=Custom&from=2026-06-10");
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).not.toHaveBeenCalled();
    expect(container.querySelector("[role='alert']")?.textContent)
      .toContain("Choose both From and To dates for a Custom period.");
  });

  it("does not resolve a reversed Custom URL and explains the accepted date order", async () => {
    mockedAccess.activeProject = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    window.history.replaceState({}, "", "/energyiq/overview?period=Custom&from=2026-06-16&to=2026-06-10");
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).not.toHaveBeenCalled();
    expect(container.querySelector("[role='alert']")?.textContent)
      .toContain("From date must be on or before To date.");
  });

  it("does not resolve invalid Custom URL dates", async () => {
    mockedAccess.activeProject = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    window.history.replaceState({}, "", "/energyiq/overview?period=Custom&from=2026-06-10&to=not-a-date");
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).not.toHaveBeenCalled();
    expect(container.querySelector("[role='alert']")?.textContent)
      .toContain("Use valid Custom dates in YYYY-MM-DD format.");
  });

  it("uses an authorized published URL Project and Scope before the different active Project", async () => {
    const preschool = project("preschool-demo", "Preschool Demo");
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool, ngeeAnn]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=level-6&period=Custom&from=2026-06-10&to=2026-06-16");
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).toHaveBeenCalledTimes(1);
    expect(resolveProjectAnalysis).toHaveBeenCalledWith({
      projectId: "ngee-ann-polytechnic",
      scopeId: "level-6",
      resource: "electricity",
      period: "Custom",
      from: "2026-06-10",
      to: "2026-06-16",
    });
    expect(mockedAccess.selectProject).toHaveBeenCalledOnce();
    expect(mockedAccess.selectProject).toHaveBeenCalledWith("ngee-ann-polytechnic");
    expect(container.textContent).toContain("Ngee Ann Polytechnic");
    expect(container.textContent).not.toContain("Preschool Demo");
  });

  it("does not fall back to the active Project when the URL Project is unavailable", async () => {
    const preschool = project("preschool-demo", "Preschool Demo");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=unknown-project&period=Last%207%20days");
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).not.toHaveBeenCalled();
    const alert = container.querySelector("[role='alert']");
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("Requested Project is unavailable in the active workspace.");
    expect(container.textContent).not.toContain("Preschool Demo");
  });

  it("rejects a published URL Project outside the active workspace", async () => {
    const preschool = project("preschool-demo", "Preschool Demo");
    const otherWorkspaceProject = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic", "workspace-2");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool, otherWorkspaceProject]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=ngee-ann-polytechnic&period=Last%207%20days");
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).not.toHaveBeenCalled();
    expect(mockedAccess.selectProject).not.toHaveBeenCalled();
    expect(container.querySelector("[role='alert']")?.textContent)
      .toContain("Requested Project is unavailable in the active workspace.");
  });

  it("restores water as an explicit unsupported URL resource without resolving", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=ngee-ann-polytechnic&resource=water&period=Last%207%20days");
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Water analysis is not configured");
  });

  it("writes a Resource change to the public URL without losing the current view", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16");
    vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    const water = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Water");
    await act(async () => water?.click());

    expect(mockedRouter.replace).toHaveBeenCalledOnce();
    expect(mockedRouter.replace).toHaveBeenCalledWith(
      "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=l6-total-light&resource=water&period=Custom&from=2026-06-10&to=2026-06-16",
    );
  });

  it("composes consecutive Resource and Period changes before the router rerenders", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16");
    vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
    const water = buttons.find((button) => button.textContent === "Water");
    const lastSevenDays = buttons.find((button) => button.textContent === "Last 7 days");
    await act(async () => water?.click());
    await act(async () => lastSevenDays?.click());

    expect(mockedRouter.replace.mock.calls.map(([href]) => href)).toEqual([
      "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=l6-total-light&resource=water&period=Custom&from=2026-06-10&to=2026-06-16",
      "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=l6-total-light&resource=water&period=Last+7+days",
    ]);
  });

  it("writes Period changes to the public URL with only the effective date range", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16");
    vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    const periodButtons = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
    const lastSevenDays = periodButtons.find((button) => button.textContent === "Last 7 days");
    const yesterday = periodButtons.find((button) => button.textContent === "Yesterday");
    const custom = periodButtons.find((button) => button.textContent === "Custom");
    await act(async () => lastSevenDays?.click());
    await act(async () => yesterday?.click());
    await act(async () => custom?.click());

    expect(mockedRouter.replace.mock.calls.map(([href]) => href)).toEqual([
      "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=l6-total-light&resource=electricity&period=Last+7+days",
      "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=l6-total-light&resource=electricity&period=Yesterday",
      "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16",
    ]);
  });

  it("carries the server-resolved range when a standard Period changes to Custom", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=l6-total-light&resource=electricity&period=Last%207%20days");
    vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockResolvedValue(readyRangeResolution());

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    const custom = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Custom");
    await act(async () => custom?.click());

    expect(mockedRouter.replace).toHaveBeenCalledWith(
      "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16",
    );
  });

  it("writes each Custom date to the public URL before resolving the rerendered view", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    const initialUrl = "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16";
    window.history.replaceState({}, "", initialUrl);
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });
    resolveProjectAnalysis.mockClear();

    const inputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    const [initialFrom] = Array.from(container.querySelectorAll<HTMLInputElement>("input[type='date']"));
    await act(async () => {
      inputValueSetter?.call(initialFrom, "2026-06-11");
      initialFrom.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const fromUrl = "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-11&to=2026-06-16";
    expect(mockedRouter.replace).toHaveBeenLastCalledWith(fromUrl);
    window.history.replaceState({}, "", fromUrl);
    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });
    expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
    expect(resolveProjectAnalysis).toHaveBeenLastCalledWith({
      projectId: "ngee-ann-polytechnic",
      scopeId: "l6-total-light",
      resource: "electricity",
      period: "Custom",
      from: "2026-06-11",
      to: "2026-06-16",
    });

    mockedRouter.replace.mockClear();
    resolveProjectAnalysis.mockClear();
    const [, rerenderedTo] = Array.from(container.querySelectorAll<HTMLInputElement>("input[type='date']"));
    await act(async () => {
      inputValueSetter?.call(rerenderedTo, "2026-06-17");
      rerenderedTo.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const toUrl = "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-11&to=2026-06-17";
    expect(mockedRouter.replace).toHaveBeenLastCalledWith(toUrl);
    window.history.replaceState({}, "", toUrl);
    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });
    expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
    expect(resolveProjectAnalysis).toHaveBeenLastCalledWith({
      projectId: "ngee-ann-polytechnic",
      scopeId: "l6-total-light",
      resource: "electricity",
      period: "Custom",
      from: "2026-06-11",
      to: "2026-06-17",
    });
  });

  it("composes consecutive Custom date changes before the router rerenders", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16");
    vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    const inputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    const [fromInput, toInput] = Array.from(container.querySelectorAll<HTMLInputElement>("input[type='date']"));
    await act(async () => {
      inputValueSetter?.call(fromInput, "2026-06-11");
      fromInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      inputValueSetter?.call(toInput, "2026-06-17");
      toInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(mockedRouter.replace.mock.calls.map(([href]) => href)).toEqual([
      "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-11&to=2026-06-16",
      "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-11&to=2026-06-17",
    ]);
  });

  it("switches from Project to a published hierarchy Scope through the public URL", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16");
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    const scopeSelect = container.querySelector<HTMLButtonElement>("[role='combobox'][aria-label='Analysis Scope']");
    expect(scopeSelect).not.toBeNull();
    await act(async () => scopeSelect?.click());
    const options = Array.from(document.querySelectorAll<HTMLButtonElement>("[role='option']"));
    expect(options.map((option) => option.textContent)).toEqual([
      "Project · Ngee Ann Polytechnic",
      "Level · Level 6",
      "Circuit · Level 6 / L6 Light Left",
      "Circuit · Level 6 / Total Office Load",
      "Level · Level 7",
      "Circuit · Level 7 / Total Office Load",
    ]);

    const totalCircuit = options.find((option) => option.textContent === "Circuit · Level 6 / Total Office Load");
    await act(async () => totalCircuit?.click());
    expect(mockedRouter.replace).toHaveBeenCalledOnce();
    expect(mockedRouter.replace).toHaveBeenCalledWith(
      "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16",
    );

    resolveProjectAnalysis.mockClear();
    window.history.replaceState({}, "", "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16");
    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });
    expect(resolveProjectAnalysis).toHaveBeenCalledTimes(1);
    expect(resolveProjectAnalysis).toHaveBeenCalledWith({
      projectId: "ngee-ann-polytechnic",
      scopeId: "l6-total-light",
      resource: "electricity",
      period: "Custom",
      from: "2026-06-10",
      to: "2026-06-16",
    });
  });

  it("bounds Scope display paths when hierarchy parents are missing or cyclic", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    const malformedHierarchy = projectHierarchy();
    malformedHierarchy.nodes.push(
      {
        id: "orphan-circuit",
        project_id: "ngee-ann-polytechnic",
        parent_id: "missing-level",
        name: "Orphan Circuit",
        node_type: "circuit",
        tier_definition_id: "tier-circuit",
        sort_order: 3,
        metadata_status: "provisional",
      },
      {
        id: "cycle-a",
        project_id: "ngee-ann-polytechnic",
        parent_id: "cycle-b",
        name: "Cycle A",
        node_type: "circuit",
        tier_definition_id: "tier-circuit",
        sort_order: 4,
        metadata_status: "provisional",
      },
      {
        id: "cycle-b",
        project_id: "ngee-ann-polytechnic",
        parent_id: "cycle-a",
        name: "Cycle B",
        node_type: "circuit",
        tier_definition_id: "tier-circuit",
        sort_order: 5,
        metadata_status: "provisional",
      },
    );
    vi.mocked(configApi.getEnergyProjectHierarchy).mockResolvedValue(malformedHierarchy);
    vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    const scopeSelect = container.querySelector<HTMLButtonElement>("[role='combobox'][aria-label='Analysis Scope']");
    await act(async () => scopeSelect?.click());
    const labels = Array.from(document.querySelectorAll<HTMLButtonElement>("[role='option']"), (option) => option.textContent);
    expect(labels).toContain("Circuit · Orphan Circuit");
    expect(labels).toContain("Circuit · Cycle B / Cycle A");
    expect(labels).toContain("Circuit · Cycle A / Cycle B");
  });

  it("preserves the URL-backed resource, period and Custom range when Scope changes", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=project&resource=water&period=Custom&from=2026-06-10&to=2026-06-16");
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });
    expect(resolveProjectAnalysis).not.toHaveBeenCalled();

    const scopeSelect = container.querySelector<HTMLButtonElement>("[role='combobox'][aria-label='Analysis Scope']");
    await act(async () => scopeSelect?.click());
    const totalCircuit = Array.from(document.querySelectorAll<HTMLButtonElement>("[role='option']"))
      .find((option) => option.textContent === "Circuit · Level 6 / Total Office Load");
    await act(async () => totalCircuit?.click());

    expect(mockedRouter.replace).toHaveBeenCalledOnce();
    expect(mockedRouter.replace).toHaveBeenCalledWith(
      "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=l6-total-light&resource=water&period=Custom&from=2026-06-10&to=2026-06-16",
    );
  });

  it("shows a disabled Scope selector when hierarchy loading fails and retries on Refresh", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&period=Last%207%20days");
    const loadHierarchy = vi.mocked(configApi.getEnergyProjectHierarchy)
      .mockRejectedValueOnce(new Error("Hierarchy service unavailable"))
      .mockResolvedValue(projectHierarchy());
    vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockRejectedValue(new Error("Analysis service unavailable"));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    const failedScopeSelect = container.querySelector<HTMLButtonElement>("[role='combobox'][aria-label='Analysis Scope']");
    expect(failedScopeSelect?.disabled).toBe(true);
    expect(container.textContent).toContain("Analysis scopes unavailable: Hierarchy service unavailable");
    expect(loadHierarchy).toHaveBeenCalledTimes(1);

    const refresh = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Refresh view");
    expect(refresh?.disabled).toBe(false);
    await act(async () => refresh?.click());

    expect(loadHierarchy).toHaveBeenCalledTimes(2);
    const restoredScopeSelect = container.querySelector<HTMLButtonElement>("[role='combobox'][aria-label='Analysis Scope']");
    expect(restoredScopeSelect?.disabled).toBe(false);
    expect(container.textContent).not.toContain("Analysis scopes unavailable");
  });

});

describe("published Overview date inputs", () => {
  it("formats trusted UTC boundaries in the Project timezone", () => {
    expect(toDateInput("2026-07-26T16:00:00.000Z", "Asia/Singapore")).toBe("2026-07-27");
    expect(toDateInput("2026-08-02T15:59:59.999Z", "Asia/Singapore")).toBe("2026-08-02");
  });

  it("asks the server to resolve the Project root instead of hard-coding a customer Scope", () => {
    expect(overviewAnalysisRequest(
      "preschool-demo",
      "Last 7 days",
      { from: "", to: "" },
    )).toEqual({
      projectId: "preschool-demo",
      scopeId: "project",
      resource: "electricity",
      period: "Last 7 days",
    });
  });

  it("shows partial charts and advisory while suppressing action modules and Save below 95% coverage", () => {
    const policy = applyProjectAnalysisQualityPolicy({
      dataQuality: dataQuality(3.2258),
      plan: overviewPlan(),
    });

    expect(policy).toMatchObject({
      advisories: [{ title: "Partial data" }],
      saveAllowed: false,
    });
    expect(policy.plan.module_count).toBe(2);
    expect(policy.plan.sections.flatMap((section) => section.modules.map((module) => module.component.view_key)))
      .toEqual(["data_quality_summary_v1", "consumption_overview_v1"]);
  });

  it("keeps the published Overview and Save available at the 95% accepted gate", () => {
    const policy = applyProjectAnalysisQualityPolicy({
      dataQuality: dataQuality(95),
      plan: overviewPlan(),
    });

    expect(policy).toMatchObject({
      advisories: [],
      saveAllowed: true,
    });
    expect(policy.plan.module_count).toBe(5);
  });
});

function overviewPlan() {
  const catalog: EnergyComponentRevisionDto[] = [
    component("quality.data_coverage@1", "quality", "data_quality_summary_v1"),
    component("overview.consumption@1", "overview", "consumption_overview_v1"),
    component("decision.executive_actions@1", "decision", "executive_action_summary_v1"),
    component("decision.recommended_actions@1", "decision", "recommended_actions_v1"),
    component("evidence.exceptions@1", "evidence", "exceptions_evidence_v1"),
  ];
  const template: EnergyTemplateDefinitionDto = {
    template_id: "project",
    target_kind: "project",
    components: catalog.map((item) => ({
      component_revision_id: item.revision_id,
      enabled: true,
    })),
  };
  return buildEnergyTemplateRenderPlan({ template, catalog });
}

function dataQuality(coveragePct: number) {
  return {
    status: coveragePct >= 95 ? "complete" as const : "partial" as const,
    coveragePct,
    expectedMeterIntervalCount: 100,
    validIntervalCount: Math.floor(coveragePct),
    qualityEventCount: 0,
    cumulativeDeltaMismatchCount: 0,
    averageKwMismatchCount: 0,
    invalidIntervalDurationCount: 0,
    importBatchIds: ["batch-1"],
  };
}

function component(
  revisionId: string,
  family: EnergyComponentRevisionDto["family"],
  viewKey: string,
): EnergyComponentRevisionDto {
  return {
    revision_id: revisionId,
    component_id: revisionId.replace("@1", ""),
    version: 1,
    display_name: revisionId,
    description: revisionId,
    family,
    view_key: viewKey,
    target: "both",
    metric_revision_ids: [],
    rule_revision_ids: [],
    query_ids: [],
    requirement: "always",
    created_at: "2026-08-04T00:00:00.000Z",
  };
}

function project(id: string, name: string, workspaceId = "workspace-1"): EnergyProjectDto {
  return { id, name, workspaceId, status: "published", timezone: "Asia/Singapore" };
}

function accessContext(projects: EnergyProjectDto[], activeWorkspaceId = "workspace-1"): EnergyAccessContextDto {
  return {
    role: "user",
    user: { id: "user-1" },
    activeWorkspaceId,
    workspaces: [],
    projects,
  };
}

function projectHierarchy(): EnergyProjectHierarchyDto {
  return {
    project: {
      id: "ngee-ann-polytechnic",
      name: "Ngee Ann Polytechnic",
      hierarchy_revision_id: "hierarchy-v6",
    },
    tiers: [
      { id: "tier-level", ordinal: 2, alias: "Level" },
      { id: "tier-circuit", ordinal: 1, alias: "Circuit" },
    ],
    nodes: [
      {
        id: "ngee-ann-polytechnic",
        project_id: "ngee-ann-polytechnic",
        name: "Ngee Ann Polytechnic",
        node_type: "project",
        sort_order: 0,
        metadata_status: "confirmed",
      },
      {
        id: "level-6",
        project_id: "ngee-ann-polytechnic",
        name: "Level 6",
        node_type: "level",
        tier_definition_id: "tier-level",
        sort_order: 1,
        metadata_status: "confirmed",
      },
      {
        id: "l6-light-left",
        project_id: "ngee-ann-polytechnic",
        parent_id: "level-6",
        name: "L6 Light Left",
        node_type: "circuit",
        tier_definition_id: "tier-circuit",
        sort_order: 1,
        metadata_status: "confirmed",
      },
      {
        id: "l6-total-light",
        project_id: "ngee-ann-polytechnic",
        parent_id: "level-6",
        name: "Total Office Load",
        node_type: "circuit",
        tier_definition_id: "tier-circuit",
        sort_order: 2,
        metadata_status: "confirmed",
      },
      {
        id: "level-7",
        project_id: "ngee-ann-polytechnic",
        name: "Level 7",
        node_type: "level",
        tier_definition_id: "tier-level",
        sort_order: 2,
        metadata_status: "confirmed",
      },
      {
        id: "l7-total-office",
        project_id: "ngee-ann-polytechnic",
        parent_id: "level-7",
        name: "Total Office Load",
        node_type: "circuit",
        tier_definition_id: "tier-circuit",
        sort_order: 1,
        metadata_status: "confirmed",
      },
    ],
  };
}

function readyRangeResolution(): EnergyProjectAnalysisResolutionDto {
  return {
    status: "ready",
    snapshot: {
      context: {
        from: "2026-06-09T16:00:00.000Z",
        to: "2026-06-16T16:00:00.000Z",
        timezone: "Asia/Singapore",
      },
      projectRelease: {
        id: "release-1",
        templateRevisionId: null,
        document: { templates: [] },
        catalog: [],
      },
      renderer: { key: "ngee-ann-overview" },
      dataSnapshot: { id: "snapshot-1" },
    },
  } as EnergyProjectAnalysisResolutionDto;
}
