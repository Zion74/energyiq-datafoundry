/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EnergyAccessContextDto, EnergyProjectDto } from "../../../lib/config-api";
import { EnergyIqShell } from "./energyiq-shell";

const navigation = vi.hoisted(() => ({
  pathname: "/energyiq/overview",
  replace: vi.fn<(href: string) => void>(),
  search: "",
}));

const mockedAccess = vi.hoisted(() => ({
  access: null as EnergyAccessContextDto | null,
  activeProject: null as EnergyProjectDto | null,
  selectOrganisation: vi.fn<(workspaceId: string) => Promise<void>>(),
  selectProject: vi.fn<(projectId: string) => void>(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: navigation.replace }),
}));

vi.mock("./energyiq-access", () => ({
  useEnergyIqAccess: () => mockedAccess,
}));

vi.mock("../../data-tasks/data-task-identity", () => ({
  DataTaskAccountMenu: () => null,
}));

describe("EnergyIQ Shell Project navigation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("React", React);
    const projectA = project("project-a", "Project A");
    const projectB = project("project-b", "Project B");
    mockedAccess.access = accessContext([projectA, projectB]);
    mockedAccess.activeProject = projectA;
    mockedAccess.selectOrganisation.mockReset();
    mockedAccess.selectOrganisation.mockResolvedValue(undefined);
    mockedAccess.selectProject.mockReset();
    navigation.pathname = "/energyiq/overview";
    navigation.search = "projectId=project-a&scopeId=level-6&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16&currentFrom=2026-06-10&currentTo=2026-06-16&currentDataSnapshotId=snapshot-v1&currentProjectReleaseId=release-v1";
    window.history.replaceState({}, "", `/energyiq/overview?${navigation.search}`);
    navigation.replace.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.querySelectorAll("[role='listbox']").forEach((element) => element.remove());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("switches the Overview Project in access state and the URL together", async () => {
    await act(async () => {
      root.render(<EnergyIqShell><div>Overview</div></EnergyIqShell>);
    });

    const trigger = container.querySelector<HTMLButtonElement>("[role='combobox'][aria-label='Energy project']");
    await act(async () => trigger?.click());
    const projectBOption = Array.from(document.querySelectorAll<HTMLButtonElement>("[role='option']"))
      .find((option) => option.textContent?.includes("Project B"));
    await act(async () => projectBOption?.click());

    expect(mockedAccess.selectProject).toHaveBeenCalledOnce();
    expect(mockedAccess.selectProject).toHaveBeenCalledWith("project-b");
    expect(navigation.replace).toHaveBeenCalledOnce();
    expect(navigation.replace).toHaveBeenCalledWith(
      "/energyiq/overview?projectId=project-b&scopeId=project&resource=electricity&grain=day",
    );
  });

  it("keeps the existing Project selection behavior outside Overview", async () => {
    navigation.pathname = "/energyiq/explorer";
    await act(async () => {
      root.render(<EnergyIqShell><div>Explorer</div></EnergyIqShell>);
    });

    const trigger = container.querySelector<HTMLButtonElement>("[role='combobox'][aria-label='Energy project']");
    await act(async () => trigger?.click());
    const projectBOption = Array.from(document.querySelectorAll<HTMLButtonElement>("[role='option']"))
      .find((option) => option.textContent?.includes("Project B"));
    await act(async () => projectBOption?.click());

    expect(mockedAccess.selectProject).toHaveBeenCalledOnce();
    expect(mockedAccess.selectProject).toHaveBeenCalledWith("project-b");
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("switches the AI Analyst Project and removes the previous handoff context", async () => {
    navigation.pathname = "/energyiq/ai";
    navigation.search = "projectId=project-a&scopeId=level-6&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16&finding=old-finding&evidence=old-evidence";
    window.history.replaceState({}, "", `/energyiq/ai?${navigation.search}`);
    await act(async () => {
      root.render(<EnergyIqShell><div>AI Analyst</div></EnergyIqShell>);
    });

    const trigger = container.querySelector<HTMLButtonElement>("[role='combobox'][aria-label='Energy project']");
    await act(async () => trigger?.click());
    const projectBOption = Array.from(document.querySelectorAll<HTMLButtonElement>("[role='option']"))
      .find((option) => option.textContent?.includes("Project B"));
    await act(async () => projectBOption?.click());

    expect(mockedAccess.selectProject).toHaveBeenCalledOnce();
    expect(mockedAccess.selectProject).toHaveBeenCalledWith("project-b");
    expect(navigation.replace).toHaveBeenCalledWith(
      "/energyiq/ai?projectId=project-b&scopeId=project&resource=electricity",
    );
  });

  it("clears the stale Overview Project identity after switching Workspace", async () => {
    mockedAccess.access = {
      ...accessContext([project("project-a", "Project A")]),
      workspaces: [
        { id: "workspace-1", name: "Workspace 1", kind: "customer", disabled: false },
        { id: "workspace-2", name: "Workspace 2", kind: "customer", disabled: false },
      ],
    };
    await act(async () => {
      root.render(<EnergyIqShell><div>Overview</div></EnergyIqShell>);
    });

    const trigger = container.querySelector<HTMLButtonElement>("[role='combobox'][aria-label='Customer workspace']");
    await act(async () => trigger?.click());
    const workspaceTwoOption = Array.from(document.querySelectorAll<HTMLButtonElement>("[role='option']"))
      .find((option) => option.textContent?.includes("Workspace 2"));
    await act(async () => workspaceTwoOption?.click());

    expect(mockedAccess.selectOrganisation).toHaveBeenCalledOnce();
    expect(mockedAccess.selectOrganisation).toHaveBeenCalledWith("workspace-2");
    expect(navigation.replace).toHaveBeenCalledOnce();
    expect(navigation.replace).toHaveBeenCalledWith(
      "/energyiq/overview?scopeId=project&resource=electricity&grain=day",
    );
  });
});

function project(id: string, name: string): EnergyProjectDto {
  return { id, name, workspaceId: "workspace-1", status: "published", timezone: "Asia/Singapore" };
}

function accessContext(projects: EnergyProjectDto[]): EnergyAccessContextDto {
  return {
    role: "user",
    user: { id: "user-1" },
    activeWorkspaceId: "workspace-1",
    workspaces: [{ id: "workspace-1", name: "Workspace 1", kind: "customer", disabled: false }],
    projects,
  };
}
