/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  EnergyAccessContextDto,
  EnergyComponentRevisionDto,
  EnergyProjectAnalysisMetadataDto,
  EnergyProjectAnalysisPayloadDto,
  EnergyProjectAnalysisResolutionDto,
  EnergyProjectHierarchyDto,
  EnergyProjectDto,
  EnergyPublishedProjectReleaseDto,
  EnergyQueryContextDto,
  EnergyTemplateDefinitionDto,
} from "../../../lib/config-api";
import { configApi } from "../../../lib/config-api";
import { buildEnergyTemplateRenderPlan } from "./energy-template-render-plan";
import { ngeeAnnGoldenSnapshot } from "./ngee-ann-overview.test-fixture";
import { preschoolGoldenSnapshot } from "./preschool-overview.test-fixture";
import {
  currentOverviewUrlWithView,
  currentOverviewAnalysisRequest,
  overviewAnalysisRequest,
  overviewUrlWithView,
  overviewViewStateFromSearchParams,
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
  push: vi.fn<(href: string) => void>(),
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
    mockedRouter.push.mockReset();
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

  it("round-trips only the nine approved Fixed Golden URL fields", () => {
    const fixedUrl = "projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16&grain=day&comparison=overlay&category=all&dialog-open=true&focus=point-1";
    const view = overviewViewStateFromSearchParams(new URLSearchParams(fixedUrl));

    expect(view).toEqual({
      projectId: "ngee-ann-polytechnic",
      scopeId: "project",
      resource: "electricity",
      period: "Custom",
      from: "2026-06-10",
      to: "2026-06-16",
      grain: "day",
      comparison: "overlay",
      category: "all",
    });
    expect(overviewUrlWithView(view)).toBe(
      "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16&grain=day&comparison=overlay&category=all",
    );
  });

  it("opens Project-scoped History over the Current Overview without dropping its URL context", async () => {
    const preschool = project("preschool-demo", "Preschool Demo");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState(
      {},
      "",
      "/energyiq/overview?projectId=preschool-demo&scopeId=project&resource=electricity&grain=day&comparison=overlay&category=all",
    );
    vi.spyOn(configApi, "resolveProjectAnalysis").mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    const history = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("History"));
    await act(async () => history?.click());

    expect(mockedRouter.push).toHaveBeenCalledWith(
      "/energyiq/overview?projectId=preschool-demo&scopeId=project&resource=electricity&period=Custom&from=2026-05-01&to=2026-05-31&grain=day&comparison=overlay&category=all&history=1",
    );
  });

  it("keeps hour grain only for a single-day Period and defaults invalid view controls safely", () => {
    const multiDay = overviewViewStateFromSearchParams(new URLSearchParams(
      "period=Last+7+days&grain=hour&comparison=unknown&category=unknown",
    ));
    const singleDay = overviewViewStateFromSearchParams(new URLSearchParams(
      "period=Custom&from=2026-06-16&to=2026-06-16&grain=hour&comparison=average&category=load",
    ));

    expect(multiDay).toMatchObject({ grain: "day", comparison: "overlay", category: "all" });
    expect(singleDay).toMatchObject({ grain: "hour", comparison: "average", category: "load" });
  });

  it("restores anomaly controls and handoffs from URL, writes changes back, and keeps dialog state transient", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    window.history.replaceState(
      {},
      "",
      "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&grain=day&comparison=average&category=load",
    );
    const snapshot = dashboardNgeeAnnSnapshot();
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockResolvedValue({ status: "ready", snapshot });

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    const explorer = Array.from(container.querySelectorAll<HTMLAnchorElement>("a"))
      .find((anchor) => anchor.textContent?.includes("Open Project Explorer"));
    const analyst = Array.from(container.querySelectorAll<HTMLAnchorElement>("a"))
      .find((anchor) => anchor.textContent?.includes("Ask AI Analyst"));
    const expectedQuery = "projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16&grain=day&comparison=average&category=load";
    expect(explorer?.getAttribute("href")).toBe(
      `/energyiq/explorer?${expectedQuery}&dataSnapshotId=${encodeURIComponent(snapshot.context.dataSnapshotId)}&projectReleaseId=${encodeURIComponent(snapshot.projectRelease.id)}`,
    );
    expect(analyst?.getAttribute("href")).toBe(`/energyiq/ai?${expectedQuery}`);

    const openIncident = container.querySelector<HTMLButtonElement>('button[data-anomaly-trigger="true"]');
    await act(async () => openIncident?.click());
    const dialog = document.querySelector<HTMLElement>("[role='dialog']");
    const average = Array.from(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .find((button) => button.textContent === "Average");
    const selected = Array.from(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .find((button) => button.textContent === "Selected");
    const load = Array.from(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .find((button) => button.textContent === "Load");
    const light = Array.from(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .find((button) => button.textContent === "Light");
    expect(average?.getAttribute("aria-pressed")).toBe("true");
    expect(load?.getAttribute("aria-pressed")).toBe("true");

    await act(async () => selected?.click());
    await act(async () => light?.click());
    const close = Array.from(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .find((button) => button.textContent === "Close");
    await act(async () => close?.click());

    const navigations = mockedRouter.replace.mock.calls.map(([href]) => href);
    expect(navigations).toHaveLength(3);
    expect(navigations[1]).toContain("scopeId=project&resource=electricity&grain=day&comparison=selected&category=load");
    expect(navigations[1]).toContain("currentDataSnapshotId=");
    expect(navigations[1]).not.toContain("period=");
    expect(navigations[2]).toContain("scopeId=project&resource=electricity&grain=day&comparison=selected&category=light");
    expect(navigations[2]).toContain("currentDataSnapshotId=");
    expect(navigations[2]).not.toContain("period=");
    expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
  });

  it("uses the server-owned current Ngee Ann window without rendering global Period controls", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    window.history.replaceState(
      {},
      "",
      "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&grain=day&comparison=overlay&category=all",
    );
    const snapshot = dashboardNgeeAnnSnapshot();
    snapshot.context.from = "2026-05-19T16:00:00.000Z";
    snapshot.context.to = "2026-06-16T16:00:00.000Z";
    snapshot.context.primaryPeriod = {
      start: snapshot.context.from,
      endExclusive: snapshot.context.to,
    };
    snapshot.analysis.context.from = snapshot.context.from;
    snapshot.analysis.context.to = snapshot.context.to;
    snapshot.decisionPriorities = {
      ...snapshot.decisionPriorities!,
      status: "empty",
      limitation: null,
      items: [],
    };
    if (snapshot.analysis.dailyUsageAnomalies?.status === "available") {
      for (const scope of snapshot.analysis.dailyUsageAnomalies.scopes) {
        for (const row of scope.rows) {
          if (row.outcome === "triggered") row.outcome = "within_threshold";
        }
      }
    }
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockResolvedValue({ status: "ready", snapshot });
    const saveEnergyAnalysis = vi.spyOn(configApi, "saveEnergyAnalysis")
      .mockRejectedValue(new Error("Expected test stop after request capture"));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(container.textContent).toContain("Decision themes unavailable");
    expect(container.textContent).toContain("Verified figures");
    expect(container.textContent).toContain("Energy decision overview");
    expect(container.textContent).toContain("Rolling 28-day view");
    expect(container.textContent).toContain("20 May 2026–16 Jun 2026");
    expect(container.textContent).not.toContain("Published overview");
    expect(container.querySelector("[role='combobox'][aria-label='Analysis Scope']")).toBeNull();
    expect(Array.from(container.querySelectorAll("button"), (button) => button.textContent)).not.toEqual(
      expect.arrayContaining(["Yesterday", "Last 7 days", "Previous week", "Previous month", "Custom"]),
    );
    expect(container.querySelectorAll("input[type='date']")).toHaveLength(0);
    const contents = container.querySelector("[aria-label='Overview contents']");
    expect(contents).not.toBeNull();
    expect(Array.from(contents?.querySelectorAll<HTMLAnchorElement>("a") ?? [], (anchor) => [
      anchor.textContent,
      anchor.getAttribute("href"),
    ])).toEqual([
      ["Takeaways", "#ngee-ann-takeaways"],
      ["Verified figures", "#ngee-ann-key-highlights"],
      ["AI analysis", "#ngee-ann-ai-analysis"],
      ["Change over time", "#ngee-ann-change"],
      ["Main contributors", "#ngee-ann-location"],
      ["Time patterns", "#ngee-ann-timing"],
      ["Evidence", "#ngee-ann-evidence"],
    ]);
    expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
    expect(resolveProjectAnalysis).toHaveBeenCalledWith({
      projectId: "ngee-ann-polytechnic",
      scopeId: "project",
      resource: "electricity",
      analysisWindow: "current-overview-28d",
    });
    const explorer = Array.from(container.querySelectorAll<HTMLAnchorElement>("a"))
      .find((anchor) => anchor.textContent?.includes("Open Project Explorer"));
    expect(explorer?.getAttribute("href")).toContain("period=Custom&from=2026-05-20&to=2026-06-16");
    expect(explorer?.getAttribute("href")).toContain(`dataSnapshotId=${encodeURIComponent(snapshot.context.dataSnapshotId)}`);
    expect(explorer?.getAttribute("href")).toContain(`projectReleaseId=${encodeURIComponent(snapshot.projectRelease.id)}`);
    const save = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Save analysis");
    await act(async () => save?.click());
    expect(saveEnergyAnalysis).toHaveBeenCalledWith(
      "ngee-ann-polytechnic",
      expect.objectContaining({
        analysisWindow: "current-overview-28d",
        from: "2026-05-20",
        to: "2026-06-16",
        expectedDataSnapshotId: snapshot.context.dataSnapshotId,
        expectedProjectReleaseId: snapshot.projectRelease.id,
        viewState: {
          grain: "day",
          comparison: "overlay",
          category: "all",
        },
      }),
    );
    expect(mockedRouter.replace).toHaveBeenCalledWith(expect.stringContaining(
      `currentDataSnapshotId=${encodeURIComponent(snapshot.context.dataSnapshotId)}`,
    ));
    expect(mockedRouter.replace).toHaveBeenCalledWith(expect.stringContaining(
      `currentProjectReleaseId=${encodeURIComponent(snapshot.projectRelease.id)}`,
    ));
  });

  it("normalizes a legacy Ngee Ann Custom deep link to the current Project overview", async () => {
    window.history.replaceState({}, "", "/energyiq/overview?scopeId=level-7&period=Custom&from=2026-06-10&to=2026-06-16");
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
      analysisWindow: "current-overview-28d",
    });
    expect(container.querySelector("[role='combobox'][aria-label='Analysis Scope']")).toBeNull();
    expect(container.querySelectorAll("input[type='date']")).toHaveLength(0);
  });

  it("uses the dedicated Preschool shell and bypasses only the user-triggered Refresh request", async () => {
    const preschool = project("preschool-demo", "Preschool Portfolio");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState(
      {},
      "",
      "/energyiq/overview?projectId=preschool-demo&scopeId=project&resource=electricity&period=Custom&from=2026-05-01&to=2026-05-31&grain=day&comparison=overlay&category=all",
    );
    const snapshot = dashboardNgeeAnnSnapshot(preschoolGoldenSnapshot());
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockResolvedValue({ status: "ready", snapshot });

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
    expect(resolveProjectAnalysis).toHaveBeenCalledWith({
      projectId: "preschool-demo",
      scopeId: "project",
      resource: "electricity",
      period: "Custom",
      from: "2026-05-01",
      to: "2026-05-31",
    });
    expect(container.querySelector("[data-preschool-overview='true']")).not.toBeNull();
    expect(container.textContent?.match(/Portfolio energy overview/g)).toHaveLength(1);
    expect(container.textContent).not.toContain("Published overview");
    expect(container.textContent).not.toContain("A Project-wide portfolio view built from");
    expect(container.querySelector("[role='combobox'][aria-label='Analysis Scope']")).toBeNull();
    expect(container.querySelector("[aria-label='Area and headcount metadata']")).toBeNull();
    expect(container.querySelectorAll("input[type='date']")).toHaveLength(0);
    const centreExplorerLink = container.querySelector<HTMLAnchorElement>("[data-centre-explorer-link]");
    expect(centreExplorerLink).not.toBeNull();
    const linkedScopeId = centreExplorerLink!.dataset.centreExplorerLink;
    expect(linkedScopeId).toBeTruthy();
    const centreExplorerUrl = new URL(centreExplorerLink!.href);
    expect(Object.fromEntries(centreExplorerUrl.searchParams)).toMatchObject({
      projectId: "preschool-demo",
      scopeId: linkedScopeId,
      resource: "electricity",
      period: "Custom",
      from: "2026-05-01",
      to: "2026-05-31",
      dataSnapshotId: snapshot.context.dataSnapshotId,
      projectReleaseId: snapshot.projectRelease.id,
    });
    expect(container.textContent).toContain("Overview contents");
    const contents = container.querySelector("[aria-label='Overview contents']");
    expect(Array.from(contents?.querySelectorAll<HTMLAnchorElement>("a") ?? [], (anchor) => anchor.textContent)).toEqual([
      "Takeaways",
      "AI analysis",
      "Energy drivers",
      "Efficiency",
      "Operating patterns",
      "June plan",
      "Centre detail",
      "Evidence",
    ]);
    expect(Array.from(container.querySelectorAll("button"), (button) => button.textContent)).not.toEqual(
      expect.arrayContaining(["Yesterday", "Last 7 days", "Previous week", "Previous month", "Custom"]),
    );
    expect(Array.from(
      container.querySelector("[aria-label='Resource type']")?.querySelectorAll("button") ?? [],
      (button) => button.textContent,
    )).toEqual(["Electricity"]);
    expect(container.textContent).toContain("Refresh view");
    expect(container.textContent).toContain("Save analysis");
    expect(mockedRouter.replace).not.toHaveBeenCalled();

    const refresh = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Refresh view");
    await act(async () => refresh?.click());

    expect(resolveProjectAnalysis).toHaveBeenCalledTimes(2);
    expect(resolveProjectAnalysis).toHaveBeenNthCalledWith(2, {
      projectId: "preschool-demo",
      scopeId: "project",
      resource: "electricity",
      period: "Custom",
      from: "2026-05-01",
      to: "2026-05-31",
    }, { bypassCache: true });
  });

  it.each([
    ["a URL without Period", "/energyiq/overview?projectId=preschool-demo&scopeId=level-7&resource=electricity"],
    ["an old arbitrary Custom range", "/energyiq/overview?projectId=preschool-demo&scopeId=level-7&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16"],
    ["an old Water resource", "/energyiq/overview?projectId=preschool-demo&scopeId=project&resource=water&period=Custom&from=2026-05-01&to=2026-05-31"],
  ] as const)("canonicalizes Preschool %s to the published May Project overview", async (_label, href) => {
    const preschool = project("preschool-demo", "Preschool Portfolio");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState({}, "", href);
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
    expect(resolveProjectAnalysis).toHaveBeenCalledWith({
      projectId: "preschool-demo",
      scopeId: "project",
      resource: "electricity",
      period: "Custom",
      from: "2026-05-01",
      to: "2026-05-31",
    });
    expect(mockedRouter.replace).toHaveBeenCalledOnce();
    expect(mockedRouter.replace).toHaveBeenCalledWith(
      "/energyiq/overview?projectId=preschool-demo&scopeId=project&resource=electricity&period=Custom&from=2026-05-01&to=2026-05-31&grain=day&comparison=overlay&category=all",
    );
    expect(container.querySelector("[role='combobox'][aria-label='Analysis Scope']")).toBeNull();
    expect(container.querySelectorAll("input[type='date']")).toHaveLength(0);
    expect(configApi.getEnergyProjectHierarchy).not.toHaveBeenCalled();
  });

  it.each([
    ["Previous week", "Previous+week"],
    ["Previous month", "Previous+month"],
  ] as const)("uses a cold public %s URL for the first resolve after access hydration", async (period, encodedPeriod) => {
    window.history.replaceState(
      {},
      "",
      `/energyiq/overview?projectId=generic-demo&scopeId=project&resource=electricity&period=${encodedPeriod}`,
    );
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });
    expect(resolveProjectAnalysis).not.toHaveBeenCalled();

    const preschool = project("generic-demo", "Generic Project");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
    expect(resolveProjectAnalysis).toHaveBeenCalledWith({
      projectId: "generic-demo",
      scopeId: "project",
      resource: "electricity",
      period,
    });
  });

  it("atomically resolves new Custom dates after client navigation changes the public URL", async () => {
    mockedAccess.activeProject = project("generic-demo", "Generic Project");
    window.history.replaceState({}, "", "/energyiq/overview?period=Custom&from=2026-06-01&to=2026-06-07");
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });
    expect(resolveProjectAnalysis).toHaveBeenCalledWith({
      projectId: "generic-demo",
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
      projectId: "generic-demo",
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
    mockedAccess.activeProject = project("generic-demo", "Generic Project");
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
    mockedAccess.activeProject = project("generic-demo", "Generic Project");
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
    mockedAccess.activeProject = project("generic-demo", "Generic Project");
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
    const preschool = project("generic-demo", "Generic Project");
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
      scopeId: "project",
      resource: "electricity",
      analysisWindow: "current-overview-28d",
    });
    expect(mockedAccess.selectProject).toHaveBeenCalledOnce();
    expect(mockedAccess.selectProject).toHaveBeenCalledWith("ngee-ann-polytechnic");
    expect(container.textContent).toContain("Ngee Ann Polytechnic");
    expect(container.textContent).not.toContain("Generic Project");
  });

  it("does not fall back to the active Project when the URL Project is unavailable", async () => {
    const preschool = project("generic-demo", "Generic Project");
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
    expect(container.textContent).not.toContain("Generic Project");
  });

  it("rejects a published URL Project outside the active workspace", async () => {
    const preschool = project("generic-demo", "Generic Project");
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

  it("normalizes a legacy Ngee Ann Water URL to the electricity-only current Overview", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=ngee-ann-polytechnic&resource=water&period=Last%207%20days");
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).toHaveBeenCalledWith({
      projectId: "ngee-ann-polytechnic",
      scopeId: "project",
      resource: "electricity",
      analysisWindow: "current-overview-28d",
    });
    expect(mockedRouter.replace).toHaveBeenCalledWith(
      "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&grain=day&comparison=overlay&category=all",
    );
    const resourceButtons = Array.from(
      container.querySelector("[aria-label='Resource type']")?.querySelectorAll("button") ?? [],
      (button) => button.textContent,
    );
    expect(resourceButtons).toEqual(["Electricity"]);
    expect(container.textContent).not.toContain("Water analysis is not configured");
  });

  it("writes a Resource change to the public URL without losing the current view", async () => {
    const preschool = project("generic-demo", "Generic Project");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16");
    vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    const resourceButtons = Array.from(
      container.querySelector("[aria-label='Resource type']")?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );
    expect(resourceButtons.map((button) => button.textContent)).toEqual(["Electricity", "Water"]);
    const water = resourceButtons.find((button) => button.textContent === "Water");
    await act(async () => water?.click());

    expect(mockedRouter.replace).toHaveBeenCalledOnce();
    expect(mockedRouter.replace).toHaveBeenCalledWith(
      "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=water&period=Custom&from=2026-06-10&to=2026-06-16&grain=day&comparison=overlay&category=all",
    );
  });

  it("composes consecutive Resource and Period changes before the router rerenders", async () => {
    const preschool = project("generic-demo", "Generic Project");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16");
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
      "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=water&period=Custom&from=2026-06-10&to=2026-06-16&grain=day&comparison=overlay&category=all",
      "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=water&period=Last+7+days&grain=day&comparison=overlay&category=all",
    ]);
  });

  it("writes Period changes to the public URL with only the effective date range", async () => {
    const preschool = project("generic-demo", "Generic Project");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16");
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
      "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=electricity&period=Last+7+days&grain=day&comparison=overlay&category=all",
      "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=electricity&period=Yesterday&grain=day&comparison=overlay&category=all",
      "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16&grain=day&comparison=overlay&category=all",
    ]);
  });

  it("selects and restores Previous week through the server-authoritative URL contract", async () => {
    const preschool = project("generic-demo", "Generic Project");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=generic-demo&scopeId=project&resource=electricity&period=Last%207%20days");
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    const previousWeek = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Previous week");
    await act(async () => previousWeek?.click());
    const previousWeekUrl = "/energyiq/overview?projectId=generic-demo&scopeId=project&resource=electricity&period=Previous+week&grain=day&comparison=overlay&category=all";
    expect(mockedRouter.replace).toHaveBeenCalledWith(previousWeekUrl);

    resolveProjectAnalysis.mockClear();
    window.history.replaceState({}, "", previousWeekUrl);
    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });
    expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
    expect(resolveProjectAnalysis).toHaveBeenCalledWith({
      projectId: "generic-demo",
      scopeId: "project",
      resource: "electricity",
      period: "Previous week",
    });
  });

  it("selects and restores Previous month through the server-authoritative URL contract", async () => {
    const preschool = project("generic-demo", "Generic Project");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=generic-demo&scopeId=project&resource=electricity&period=Previous+week");
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    const previousMonth = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Previous month");
    await act(async () => previousMonth?.click());
    const previousMonthUrl = "/energyiq/overview?projectId=generic-demo&scopeId=project&resource=electricity&period=Previous+month&grain=day&comparison=overlay&category=all";
    expect(mockedRouter.replace).toHaveBeenCalledWith(previousMonthUrl);

    resolveProjectAnalysis.mockClear();
    window.history.replaceState({}, "", previousMonthUrl);
    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });
    expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
    expect(resolveProjectAnalysis).toHaveBeenCalledWith({
      projectId: "generic-demo",
      scopeId: "project",
      resource: "electricity",
      period: "Previous month",
    });
  });

  it("preserves Previous week when Scope changes before the router rerenders", async () => {
    const preschool = project("generic-demo", "Generic Project");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=generic-demo&scopeId=project&resource=electricity&period=Last%207%20days");
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    const previousWeek = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Previous week");
    await act(async () => previousWeek?.click());
    const scopeSelect = container.querySelector<HTMLButtonElement>("[role='combobox'][aria-label='Analysis Scope']");
    await act(async () => scopeSelect?.click());
    const totalCircuit = Array.from(document.querySelectorAll<HTMLButtonElement>("[role='option']"))
      .find((option) => option.textContent?.endsWith("Level 6 / Total Office Load"));
    await act(async () => totalCircuit?.click());

    const previousWeekScopeUrl = "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=electricity&period=Previous+week&grain=day&comparison=overlay&category=all";
    expect(mockedRouter.replace.mock.calls.map(([href]) => href)).toEqual([
      "/energyiq/overview?projectId=generic-demo&scopeId=project&resource=electricity&period=Previous+week&grain=day&comparison=overlay&category=all",
      previousWeekScopeUrl,
    ]);

    resolveProjectAnalysis.mockClear();
    window.history.replaceState({}, "", previousWeekScopeUrl);
    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });
    expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
    expect(resolveProjectAnalysis).toHaveBeenCalledWith({
      projectId: "generic-demo",
      scopeId: "l6-total-light",
      resource: "electricity",
      period: "Previous week",
    });
  });

  it("preserves Previous month when Scope changes before the router rerenders", async () => {
    const preschool = project("generic-demo", "Generic Project");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=generic-demo&scopeId=project&resource=electricity&period=Previous+week");
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    const previousMonth = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Previous month");
    await act(async () => previousMonth?.click());
    const scopeSelect = container.querySelector<HTMLButtonElement>("[role='combobox'][aria-label='Analysis Scope']");
    await act(async () => scopeSelect?.click());
    const totalCircuit = Array.from(document.querySelectorAll<HTMLButtonElement>("[role='option']"))
      .find((option) => option.textContent?.endsWith("Level 6 / Total Office Load"));
    await act(async () => totalCircuit?.click());

    const previousMonthScopeUrl = "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=electricity&period=Previous+month&grain=day&comparison=overlay&category=all";
    expect(mockedRouter.replace.mock.calls.map(([href]) => href)).toEqual([
      "/energyiq/overview?projectId=generic-demo&scopeId=project&resource=electricity&period=Previous+month&grain=day&comparison=overlay&category=all",
      previousMonthScopeUrl,
    ]);

    resolveProjectAnalysis.mockClear();
    window.history.replaceState({}, "", previousMonthScopeUrl);
    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });
    expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
    expect(resolveProjectAnalysis).toHaveBeenCalledWith({
      projectId: "generic-demo",
      scopeId: "l6-total-light",
      resource: "electricity",
      period: "Previous month",
    });
  });

  it.each(["Previous week", "Previous month"] as const)(
    "keeps ready zero-coverage %s explicit without auto-navigation or a second resolve",
    async (period) => {
      const preschool = project("generic-demo", "Generic Project");
      mockedAccess.activeProject = preschool;
      mockedAccess.access = accessContext([preschool]);
      const periodUrl = `/energyiq/overview?projectId=generic-demo&scopeId=project&resource=electricity&period=${period.replace(" ", "+")}`;
      window.history.replaceState({}, "", periodUrl);
      const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
        .mockResolvedValue(readyZeroCoverageResolution(period));

      await act(async () => {
        root.render(React.createElement(PublishedDecisionDashboard));
      });

      expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
      expect(resolveProjectAnalysis).toHaveBeenCalledWith({
        projectId: "generic-demo",
        scopeId: "project",
        resource: "electricity",
        period,
      });
      expect(mockedRouter.replace).not.toHaveBeenCalled();
      expect(window.location.pathname + window.location.search).toBe(periodUrl);
      expect(container.textContent).toContain("Unavailable");
      expect(container.textContent).toContain("0% coverage");
    },
  );

  it("keeps the canonical current cutoff when a selected Scope has no accepted facts", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    const defaultUrl = "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity";
    window.history.replaceState({}, "", defaultUrl);
    const zeroCoverage = readyZeroCoverageResolution("Last 7 days");
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockResolvedValue(zeroCoverage);

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
    expect(resolveProjectAnalysis).toHaveBeenCalledWith({
      projectId: "ngee-ann-polytechnic",
      scopeId: "project",
      resource: "electricity",
      analysisWindow: "current-overview-28d",
    });
    expect(mockedRouter.replace).toHaveBeenCalledWith(expect.stringContaining(
      "currentFrom=2026-07-28&currentTo=2026-08-03",
    ));
    expect(window.location.pathname + window.location.search).toBe(defaultUrl);
    const latestButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("View latest available data"));
    expect(latestButton).toBeFalsy();
    expect(mockedRouter.replace).toHaveBeenCalledOnce();
  });

  it("carries the server-resolved range when a standard Period changes to Custom", async () => {
    const preschool = project("generic-demo", "Generic Project");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=electricity&period=Last%207%20days");
    vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockResolvedValue(readyRangeResolution());

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    const custom = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Custom");
    await act(async () => custom?.click());

    expect(mockedRouter.replace).toHaveBeenCalledWith(
      "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16&grain=day&comparison=overlay&category=all",
    );
  });

  it("writes each Custom date to the public URL before resolving the rerendered view", async () => {
    const preschool = project("generic-demo", "Generic Project");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    const initialUrl = "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16";
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

    const fromUrl = "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-11&to=2026-06-16&grain=day&comparison=overlay&category=all";
    expect(mockedRouter.replace).toHaveBeenLastCalledWith(fromUrl);
    window.history.replaceState({}, "", fromUrl);
    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });
    expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
    expect(resolveProjectAnalysis).toHaveBeenLastCalledWith({
      projectId: "generic-demo",
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

    const toUrl = "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-11&to=2026-06-17&grain=day&comparison=overlay&category=all";
    expect(mockedRouter.replace).toHaveBeenLastCalledWith(toUrl);
    window.history.replaceState({}, "", toUrl);
    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });
    expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
    expect(resolveProjectAnalysis).toHaveBeenLastCalledWith({
      projectId: "generic-demo",
      scopeId: "l6-total-light",
      resource: "electricity",
      period: "Custom",
      from: "2026-06-11",
      to: "2026-06-17",
    });
  });

  it("composes consecutive Custom date changes before the router rerenders", async () => {
    const preschool = project("generic-demo", "Generic Project");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16");
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
      "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-11&to=2026-06-16&grain=day&comparison=overlay&category=all",
      "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-11&to=2026-06-17&grain=day&comparison=overlay&category=all",
    ]);
  });

  it("switches from Project to a published hierarchy Scope through the public URL", async () => {
    const preschool = project("generic-demo", "Generic Project");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=generic-demo&scopeId=project&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16");
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
      "Project · Generic Project",
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
      "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16&grain=day&comparison=overlay&category=all",
    );

    resolveProjectAnalysis.mockClear();
    window.history.replaceState({}, "", "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16");
    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });
    expect(resolveProjectAnalysis).toHaveBeenCalledTimes(1);
    expect(resolveProjectAnalysis).toHaveBeenCalledWith({
      projectId: "generic-demo",
      scopeId: "l6-total-light",
      resource: "electricity",
      period: "Custom",
      from: "2026-06-10",
      to: "2026-06-16",
    });
  });

  it("bounds Scope display paths when hierarchy parents are missing or cyclic", async () => {
    const preschool = project("generic-demo", "Generic Project");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
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
    const preschool = project("generic-demo", "Generic Project");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=generic-demo&scopeId=project&resource=water&period=Custom&from=2026-06-10&to=2026-06-16");
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
      "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=water&period=Custom&from=2026-06-10&to=2026-06-16&grain=day&comparison=overlay&category=all",
    );
  });

  it("shows a disabled Scope selector when hierarchy loading fails and retries on Refresh", async () => {
    const preschool = project("generic-demo", "Generic Project");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=generic-demo&scopeId=project&resource=electricity&period=Last%207%20days");
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

  it("fails closed on a stale current pin and bypasses it only for the user-triggered Refresh request", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    window.history.replaceState(
      {},
      "",
      "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=level-7&resource=electricity&currentFrom=2026-05-20&currentTo=2026-06-16&currentDataSnapshotId=stale-snapshot&currentProjectReleaseId=release-v1",
    );
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockRejectedValue(new Error("ENERGYIQ_DATA_SNAPSHOT_MISMATCH"));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      scopeId: "project",
      analysisWindow: "current-overview-28d",
      from: "2026-05-20",
      to: "2026-06-16",
      expectedDataSnapshotId: "stale-snapshot",
      expectedProjectReleaseId: "release-v1",
    }));
    expect(container.textContent).toContain("ENERGYIQ_DATA_SNAPSHOT_MISMATCH");
    const refresh = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Refresh current overview");
    await act(async () => refresh?.click());

    expect(resolveProjectAnalysis).toHaveBeenCalledTimes(2);
    expect(resolveProjectAnalysis).toHaveBeenNthCalledWith(2, {
      projectId: "ngee-ann-polytechnic",
      scopeId: "project",
      resource: "electricity",
      analysisWindow: "current-overview-28d",
    }, { bypassCache: true });
    expect(mockedRouter.replace).not.toHaveBeenCalled();
  });

  it("keeps the current cutoff pin while forcing a legacy Ngee Ann Scope to Project", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    window.history.replaceState(
      {},
      "",
      "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=level-7&resource=electricity&currentFrom=2026-05-20&currentTo=2026-06-16&currentDataSnapshotId=snapshot-v1&currentProjectReleaseId=release-v1",
    );
    vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(container.querySelector("[role='combobox'][aria-label='Analysis Scope']")).toBeNull();
    expect(configApi.resolveProjectAnalysis).toHaveBeenCalledWith({
      projectId: "ngee-ann-polytechnic",
      scopeId: "project",
      resource: "electricity",
      analysisWindow: "current-overview-28d",
      from: "2026-05-20",
      to: "2026-06-16",
      expectedDataSnapshotId: "snapshot-v1",
      expectedProjectReleaseId: "release-v1",
    });
  });

});

describe("published Overview date inputs", () => {
  it("formats trusted UTC boundaries in the Project timezone", () => {
    expect(toDateInput("2026-07-26T16:00:00.000Z", "Asia/Singapore")).toBe("2026-07-27");
    expect(toDateInput("2026-08-02T15:59:59.999Z", "Asia/Singapore")).toBe("2026-08-02");
  });

  it("asks the server to resolve the Project root instead of hard-coding a customer Scope", () => {
    expect(overviewAnalysisRequest(
      "generic-demo",
      "Last 7 days",
      { from: "", to: "" },
    )).toEqual({
      projectId: "generic-demo",
      scopeId: "project",
      resource: "electricity",
      period: "Last 7 days",
    });
  });

  it("asks the server for the canonical rolling 28-day Ngee Ann window without client dates", () => {
    expect(currentOverviewAnalysisRequest("ngee-ann-polytechnic", {
      scopeId: "level-7",
      resource: "electricity",
    })).toEqual({
      projectId: "ngee-ann-polytechnic",
      scopeId: "level-7",
      resource: "electricity",
      analysisWindow: "current-overview-28d",
    });
  });

  it("round-trips the server-validated current window pin and restores it on reload", () => {
    const view = overviewViewStateFromSearchParams(new URLSearchParams(
      "projectId=ngee-ann-polytechnic&scopeId=level-7&resource=electricity&currentFrom=2026-05-20&currentTo=2026-06-16&currentDataSnapshotId=snapshot-v1&currentProjectReleaseId=release-v1",
    ));

    expect(view.currentOverviewPin).toEqual({
      from: "2026-05-20",
      to: "2026-06-16",
      dataSnapshotId: "snapshot-v1",
      projectReleaseId: "release-v1",
    });
    expect(currentOverviewAnalysisRequest("ngee-ann-polytechnic", {
      scopeId: view.scopeId,
      resource: view.resource,
      currentOverviewPin: view.currentOverviewPin,
    })).toEqual({
      projectId: "ngee-ann-polytechnic",
      scopeId: "level-7",
      resource: "electricity",
      analysisWindow: "current-overview-28d",
      from: "2026-05-20",
      to: "2026-06-16",
      expectedDataSnapshotId: "snapshot-v1",
      expectedProjectReleaseId: "release-v1",
    });
    expect(currentOverviewUrlWithView(view)).toContain(
      "currentFrom=2026-05-20&currentTo=2026-06-16&currentDataSnapshotId=snapshot-v1&currentProjectReleaseId=release-v1",
    );
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

function dashboardNgeeAnnSnapshot(snapshot = ngeeAnnGoldenSnapshot()) {
  const qualityComponent = component("quality.data_coverage@1", "quality", "data_quality_summary_v1");
  snapshot.projectRelease.catalog = [qualityComponent];
  snapshot.projectRelease.document = {
    schema_version: 2,
    templates: [{
      template_id: "project",
      target_kind: "project",
      components: [{ component_revision_id: qualityComponent.revision_id, enabled: true }],
    }],
  };
  return snapshot;
}

function readyZeroCoverageResolution(
  period: "Last 7 days" | "Previous week" | "Previous month",
): EnergyProjectAnalysisResolutionDto {
  const qualityComponent = component("quality.data_coverage@1", "quality", "data_quality_summary_v1");
  const quality = dataQuality(0);
  const from = period === "Previous week"
    ? "2026-07-26T16:00:00.000Z"
    : period === "Previous month"
      ? "2026-06-30T16:00:00.000Z"
      : "2026-07-27T16:00:00.000Z";
  const to = period === "Previous week"
    ? "2026-08-02T16:00:00.000Z"
    : period === "Previous month"
      ? "2026-07-31T16:00:00.000Z"
      : "2026-08-03T16:00:00.000Z";
  const context: EnergyQueryContextDto = {
    userId: "user-1",
    workspaceId: "workspace-1",
      projectId: "generic-demo",
    projectName: "Ngee Ann Polytechnic",
    scopeId: "project",
    scopeName: "Ngee Ann Polytechnic",
    scopeType: "project",
    resource: "electricity",
    timezone: "Asia/Singapore",
    from,
    to,
    endExclusive: true,
    period,
    hierarchyRevisionId: "hierarchy-v6",
    meterMappingRevisionId: "mapping-v1",
    meterFormulaRevisionId: "formula-v1",
    dataSnapshotId: "snapshot-zero-coverage",
    metricVersion: "metric-v1",
    businessCalendarVersion: "calendar-v1",
    tariffScheduleVersion: "tariff-v1",
    resolvedAt: "2026-08-03T16:30:00.000Z",
  };
  const metadata: EnergyProjectAnalysisMetadataDto = {
    status: "missing",
    hierarchyRevisionId: context.hierarchyRevisionId,
    timezone: context.timezone,
    period: { start: from, endExclusive: to },
    selectedScope: {
      scopeId: context.scopeId,
      scopeName: context.scopeName,
      usageKwh: 0,
      status: "missing",
      area: {
        status: "missing",
        value: null,
        unit: "m2",
        reason: "not-configured",
        guidance: "Configure area metadata.",
        metadataRevisionIds: [],
        hierarchyRevisionIds: [context.hierarchyRevisionId],
        evidence: [],
      },
      headcount: {
        status: "missing",
        value: null,
        unit: "people",
        reason: "not-configured",
        guidance: "Configure headcount metadata.",
        metadataRevisionIds: [],
        hierarchyRevisionIds: [context.hierarchyRevisionId],
        evidence: [],
      },
      normalisations: {
        eui: {
          status: "missing",
          metricId: "energy.usage_per_sqm",
          value: null,
          unit: "kWh/m2",
          reason: "not-configured",
          guidance: "Configure area metadata.",
          metadataRevisionIds: [],
          hierarchyRevisionIds: [context.hierarchyRevisionId],
          evidence: [],
        },
        perPax: {
          status: "missing",
          metricId: "energy.usage_per_person",
          value: null,
          unit: "kWh/person",
          reason: "not-configured",
          guidance: "Configure headcount metadata.",
          metadataRevisionIds: [],
          hierarchyRevisionIds: [context.hierarchyRevisionId],
          evidence: [],
        },
      },
      evidence: [],
    },
    comparisonScopes: [],
    evidence: [],
  };
  const analysis: EnergyProjectAnalysisPayloadDto = {
    context,
    latestAcceptedReading: {
      status: "not_applicable",
      queryId: "latest_accepted_reading_v1",
      reason: {
        code: "LEAF_METER_REQUIRED",
        message: "Select a leaf Meter or Circuit to view its latest accepted cumulative reading.",
      },
    },
    summary: {
      usageKwh: 0,
      averageDailyUsageKwh: 0,
      peakKw: 0,
      validIntervalCount: 0,
      qualityEventCount: 0,
    },
    hourlyProfile: [],
    comparison: { from, to, usageKwh: 0, changeKwh: 0, changePct: null },
    categories: [],
    childScopes: [],
    circuits: [],
    topCircuits: [],
    virtualMeters: [],
    offHours: {
      status: "unavailable",
      reason: { code: "OPERATING_FACTS_UNAVAILABLE", message: "No accepted intervals." },
      businessCalendarVersion: context.businessCalendarVersion,
    },
    cost: {
      status: "unavailable",
      reason: { code: "COST_FACTS_UNAVAILABLE", message: "No accepted intervals." },
      tariffScheduleVersion: context.tariffScheduleVersion,
    },
    dataHealth: quality,
    units: { usage: "kWh", demand: "kW", intervalMinutes: 15, timezone: context.timezone },
    attention: [],
    provenance: {
      dataSnapshotId: context.dataSnapshotId,
      hierarchyRevisionId: context.hierarchyRevisionId,
      meterMappingRevisionId: context.meterMappingRevisionId,
      meterFormulaRevisionId: context.meterFormulaRevisionId,
      metricVersion: context.metricVersion,
      ruleRevisionIds: [],
      aggregationRule: "designated_total",
      sourceView: "energy_scope_intervals",
      queryIds: [
        "scope_summary_v1",
        "hourly_profile_v1",
        "meter_breakdown_v1",
        "operational_policy_scope_intervals_v1",
        "operational_policy_meter_intervals_v1",
      ],
    },
    metadata,
  };
  const projectRelease: EnergyPublishedProjectReleaseDto = {
    id: "release-zero-coverage",
    source: "template-revision",
    projectId: context.projectId,
    templateRevisionId: "template-zero-coverage",
    templateRevisionSequence: 1,
    recipe: { id: "energy-scope-analysis", version: "1" },
    renderer: {
      key: "ngee-ann-overview",
      version: "1",
      contractVersion: "project-analysis-snapshot@1",
    },
    hierarchyRevisionId: context.hierarchyRevisionId,
    meterMappingRevisionId: context.meterMappingRevisionId,
    meterFormulaRevisionId: context.meterFormulaRevisionId,
    metricRevisionIds: [],
    ruleRevisionIds: [],
    businessCalendarVersion: context.businessCalendarVersion,
    tariffScheduleVersion: context.tariffScheduleVersion,
    publishedAt: "2026-08-03T00:00:00.000Z",
    document: {
      schema_version: 2,
      templates: [{
        template_id: "project",
        target_kind: "project",
        components: [{
          component_revision_id: qualityComponent.revision_id,
          enabled: true,
        }],
      }],
    },
    catalog: [qualityComponent],
  };
  const resolution: EnergyProjectAnalysisResolutionDto = {
    status: "ready",
    snapshot: {
      context: {
        ...context,
        primaryPeriod: { start: from, endExclusive: to },
        projectReleaseId: projectRelease.id,
      },
      projectRelease,
      recipe: projectRelease.recipe,
      renderer: projectRelease.renderer,
      dataSnapshot: { id: context.dataSnapshotId, importBatchIds: [], lastSeenAt: null },
      dataQuality: quality,
      evidence: [],
      findings: [],
      metadata,
      analysis,
    },
  };
  if (resolution.status === "ready") {
    Object.assign(resolution.snapshot, {
      latestAvailablePeriod: { period: "Custom", from: "2026-06-10", to: "2026-06-16" },
    });
  }
  return resolution;
}
