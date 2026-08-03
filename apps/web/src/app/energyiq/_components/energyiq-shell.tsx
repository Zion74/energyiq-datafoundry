"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { EnergyIcon, type EnergyIconName } from "./icons";
import { EnergySelect } from "./energy-select";
import { useEnergyIqAccess } from "./energyiq-access";
import { DataTaskAccountMenu } from "../../data-tasks/data-task-identity";

const navigation: Array<{
  href: string;
  label: string;
  shortLabel: string;
  icon: EnergyIconName;
}> = [
  { href: "/energyiq/overview", label: "Overview", shortLabel: "Overview", icon: "analysis" },
  { href: "/energyiq/saved", label: "Saved analyses", shortLabel: "Saved", icon: "calendar" },
  { href: "/energyiq/ai", label: "AI Analyst", shortLabel: "AI Analyst", icon: "ask" },
  { href: "/energyiq/explorer", label: "Project Explorer", shortLabel: "Explorer", icon: "explorer" },
];

export function EnergyIqShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { access, activeProject, selectOrganisation, selectProject } = useEnergyIqAccess();
  const visibleNavigation = access?.role === "admin"
    ? [...navigation, { href: "/energyiq/admin", label: "Admin", shortLabel: "Admin", icon: "settings" as EnergyIconName }]
    : navigation;
  const activeWorkspace = access?.workspaces.find(
    (workspace) => workspace.id === access.activeWorkspaceId,
  );
  const publishedProjects = access?.projects.filter((project) => project.status === "published") ?? [];
  const isAdminPage = pathname.startsWith("/energyiq/admin");
  const showWorkspaceSelector = !isAdminPage && (access?.workspaces.length ?? 0) > 1;
  const showProjectSelector = !isAdminPage && publishedProjects.length > 1;
  const showStaticProjectContext = !isAdminPage && publishedProjects.length === 1 && activeProject;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-surface-subtle text-foreground">
      <header className="sticky top-0 z-40 shrink-0 border-b border-border bg-surface/95 backdrop-blur">
        <div className="flex h-14 items-center gap-4 px-4 lg:px-6">
          <Link href="/energyiq/overview" className="flex shrink-0 items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white">
              <EnergyIcon name="bolt" className="h-4 w-4" />
            </span>
            <span className="hidden text-sm font-semibold tracking-tight sm:block">EnergyIQ</span>
          </Link>

          <div className="hidden h-5 w-px bg-border sm:block" />

          {showWorkspaceSelector ? (
            <EnergySelect
              ariaLabel="Customer workspace"
              value={access?.activeWorkspaceId ?? ""}
              options={(access?.workspaces ?? []).map((workspace) => ({
                value: workspace.id,
                label: `Workspace · ${workspace.name}${workspace.disabled ? " (disabled)" : ""}`,
              }))}
              onValueChange={(workspaceId) => void selectOrganisation(workspaceId)}
              leadingIcon={<EnergyIcon name="building" className="h-3.5 w-3.5" />}
              placeholder="No organisations"
              className="max-w-40 sm:max-w-52"
              triggerClassName="w-auto max-w-40 sm:max-w-52"
              size="small"
            />
          ) : null}

          {showProjectSelector ? (
            <EnergySelect
              ariaLabel="Energy project"
              value={activeProject?.id ?? ""}
              options={publishedProjects.map((project) => ({ value: project.id, label: `Project · ${project.name}` }))}
              onValueChange={selectProject}
              leadingIcon={<EnergyIcon name="explorer" className="h-3.5 w-3.5" />}
              placeholder="No published projects"
              className="max-w-44 sm:max-w-60"
              triggerClassName="w-auto max-w-44 sm:max-w-60"
              size="small"
            />
          ) : showStaticProjectContext ? (
            <div className="hidden min-w-0 items-center gap-2 text-xs sm:flex" aria-label="Energy project">
              <EnergyIcon name="explorer" className="h-3.5 w-3.5 shrink-0 text-muted-light" />
              <span className="max-w-56 truncate font-medium">{activeProject.name}</span>
            </div>
          ) : null}

          <nav className="hidden h-full items-center gap-1 md:flex" aria-label="Main navigation">
            {visibleNavigation.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={[
                    "relative flex h-full items-center gap-2 px-3 text-xs font-medium transition-colors",
                    active ? "text-foreground" : "text-muted hover:text-foreground",
                  ].join(" ")}
                >
                  <EnergyIcon name={item.icon} className="h-3.5 w-3.5" />
                  {item.label}
                  {active ? <span className="absolute inset-x-3 bottom-0 h-0.5 bg-primary" /> : null}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full border border-step-success/25 bg-step-success/10 px-2.5 py-1 text-[11px] font-medium text-step-success sm:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-step-success" />
              Published Project
            </span>
            <DataTaskAccountMenu
              settingsHref="/energyiq/settings"
              details={[
                { label: "Role", value: access?.role === "admin" ? "Administrator" : "User" },
                ...(activeWorkspace
                  ? [{ label: "Workspace", value: activeWorkspace.name }]
                  : []),
              ]}
            />
          </div>
        </div>

        <nav
          className="grid border-t border-border md:hidden"
          style={{ gridTemplateColumns: `repeat(${visibleNavigation.length}, minmax(0, 1fr))` }}
          aria-label="Mobile navigation"
        >
          {visibleNavigation.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  "flex min-h-11 items-center justify-center gap-1.5 border-r border-border px-2 text-[11px] font-medium last:border-r-0",
                  active ? "bg-surface-subtle text-foreground" : "bg-surface text-muted",
                ].join(" ")}
              >
                <EnergyIcon name={item.icon} className="h-3.5 w-3.5" />
                {item.shortLabel}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="min-h-0 flex-1 overflow-auto">
        {access?.role === "user" && access.workspaces.length === 0 ? (
          <section className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-6 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface text-muted shadow-[var(--shadow-card)]">
              <EnergyIcon name="building" className="h-5 w-5" />
            </span>
            <h1 className="mt-4 text-lg font-semibold">No organisation access</h1>
            <p className="mt-2 text-sm leading-6 text-muted">
              Your account is active, but it has not been assigned to a customer Organisation. Contact your EnergyIQ administrator.
            </p>
          </section>
        ) : children}
      </main>
    </div>
  );
}
