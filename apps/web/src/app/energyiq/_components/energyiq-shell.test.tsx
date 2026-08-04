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
    mockedAccess.selectProject.mockReset();
    navigation.pathname = "/energyiq/overview";
    navigation.search = "projectId=project-a&scopeId=level-6&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16";
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

  it("switches the Overview Project through the URL without writing access state twice", async () => {
    await act(async () => {
      root.render(<EnergyIqShell><div>Overview</div></EnergyIqShell>);
    });

    const trigger = container.querySelector<HTMLButtonElement>("[role='combobox'][aria-label='Energy project']");
    await act(async () => trigger?.click());
    const projectBOption = Array.from(document.querySelectorAll<HTMLButtonElement>("[role='option']"))
      .find((option) => option.textContent?.includes("Project B"));
    await act(async () => projectBOption?.click());

    expect(mockedAccess.selectProject).not.toHaveBeenCalled();
    expect(navigation.replace).toHaveBeenCalledOnce();
    expect(navigation.replace).toHaveBeenCalledWith(
      "/energyiq/overview?projectId=project-b&scopeId=project&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16",
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
