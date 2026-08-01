"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { EnergyIcon, type EnergyIconName } from "./icons";
import { useEnergyIqAccess } from "./energyiq-access";
import { DataTaskAccountMenu } from "../../data-tasks/data-task-identity";

const navigation: Array<{
  href: string;
  label: string;
  shortLabel: string;
  icon: EnergyIconName;
}> = [
  { href: "/energyiq/overview", label: "Overview", shortLabel: "Overview", icon: "analysis" },
  { href: "/energyiq/ai", label: "AI Analyst", shortLabel: "AI Analyst", icon: "ask" },
  { href: "/energyiq/explorer", label: "Project Explorer", shortLabel: "Explorer", icon: "explorer" },
];

export function EnergyIqShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { access, activeProject, selectProject } = useEnergyIqAccess();
  const visibleNavigation = access?.role === "admin"
    ? [...navigation, { href: "/energyiq/admin", label: "Admin", shortLabel: "Admin", icon: "settings" as EnergyIconName }]
    : navigation;
  const activeWorkspace = access?.workspaces.find(
    (workspace) => workspace.id === access.activeWorkspaceId,
  );

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

          <label
            className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-left text-xs font-medium text-foreground transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
          >
            <EnergyIcon name="building" className="h-3.5 w-3.5 shrink-0 text-muted-light" />
            <select
              aria-label="Select project"
              className="max-w-36 appearance-none bg-transparent pr-4 outline-none sm:max-w-56"
              value={activeProject?.id ?? ""}
              onChange={(event) => selectProject(event.target.value)}
            >
              {(access?.projects ?? [])
                .filter((project) => project.status === "published")
                .map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
            </select>
            <EnergyIcon name="chevron" className="-ml-4 h-3 w-3 rotate-90 text-muted-light" />
          </label>

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
              {activeProject?.id === "preschool-demo"
                ? "Facts loaded · template preview"
                : "Data through 17 Jun 2026"}
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

      <main className="min-h-0 flex-1 overflow-auto">{children}</main>
    </div>
  );
}
