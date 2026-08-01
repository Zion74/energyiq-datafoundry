"use client";

import { EnergyIcon, type EnergyIconName } from "../_components/icons";

export type AdminSection =
  | "overview"
  | "organisations"
  | "users"
  | "project-overview"
  | "basics"
  | "structure"
  | "data-sources"
  | "meter-mapping"
  | "data-map"
  | "templates"
  | "knowledge"
  | "assets"
  | "runs"
  | "conversations"
  | "usage"
  | "traces"
  | "models"
  | "skills"
  | "tools"
  | "mcp";

type AdminProjectSummary = {
  id: string;
  name: string;
  status: string;
};

type AdminSidebarProps = {
  projects: AdminProjectSummary[];
  selectedProjectId: string;
  activeSection: AdminSection;
  onProjectChange: (projectId: string) => void;
  onCreateProject: () => void;
  onSectionChange: (section: AdminSection) => void;
};

type NavigationItem = {
  id: AdminSection;
  label: string;
  icon: EnergyIconName;
  available: boolean;
};

const accessItems: NavigationItem[] = [
  { id: "organisations", label: "Organisations", icon: "building", available: false },
  { id: "users", label: "Users", icon: "user", available: false },
];

const projectItems: NavigationItem[] = [
  { id: "project-overview", label: "Project Overview", icon: "analysis", available: true },
  { id: "structure", label: "Structure", icon: "floor", available: true },
  { id: "data-sources", label: "Data Sources", icon: "settings", available: true },
  { id: "meter-mapping", label: "Meter Mapping", icon: "meter", available: true },
  { id: "data-map", label: "Data Map", icon: "map", available: true },
  { id: "templates", label: "Templates", icon: "explorer", available: true },
  { id: "knowledge", label: "Knowledge", icon: "spark", available: true },
  { id: "assets", label: "Assets", icon: "explorer", available: true },
];

const operationItems: NavigationItem[] = [
  { id: "runs", label: "Runs & Replays", icon: "analysis", available: false },
  { id: "conversations", label: "Conversations & Queries", icon: "ask", available: false },
  { id: "usage", label: "Usage & Cost", icon: "meter", available: false },
  { id: "traces", label: "Traces", icon: "map", available: false },
];

const configurationItems: NavigationItem[] = [
  { id: "models", label: "Models & Routing", icon: "spark", available: false },
  { id: "skills", label: "Skills", icon: "settings", available: false },
  { id: "tools", label: "Tools", icon: "settings", available: false },
  { id: "mcp", label: "MCP", icon: "map", available: false },
];

export function EnergyIqAdminSidebar(props: AdminSidebarProps) {
  const selectedProject = props.projects.find((project) => project.id === props.selectedProjectId);
  const activeLabel = labelForSection(props.activeSection);

  return (
    <>
      <aside className="hidden w-[276px] shrink-0 border-r border-border bg-surface lg:flex lg:flex-col">
        <SidebarContent {...props} selectedProject={selectedProject} />
      </aside>

      <details className="group border-b border-border bg-surface lg:hidden">
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/25">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-white">
            <EnergyIcon name="settings" className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold">Admin</span>
            <span className="block truncate text-[11px] text-muted">{activeLabel}</span>
          </span>
          <EnergyIcon name="chevron" className="h-4 w-4 rotate-90 text-muted transition-transform group-open:-rotate-90" />
        </summary>
        <div className="max-h-[72vh] overflow-auto border-t border-border">
          <SidebarContent {...props} selectedProject={selectedProject} compact />
        </div>
      </details>
    </>
  );
}

function SidebarContent({
  projects,
  selectedProjectId,
  selectedProject,
  activeSection,
  onProjectChange,
  onCreateProject,
  onSectionChange,
  compact = false,
}: AdminSidebarProps & { selectedProject?: AdminProjectSummary; compact?: boolean }) {
  return (
    <div className={compact ? "p-3" : "flex min-h-0 flex-1 flex-col"}>
      {!compact ? (
        <div className="border-b border-border px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-sm font-semibold">Admin console</h1>
              <p className="mt-0.5 text-[11px] text-muted">Delivery, access and AI operations</p>
            </div>
            <button
              type="button"
              onClick={onCreateProject}
              className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
            >
              New project
            </button>
          </div>
        </div>
      ) : null}

      <nav className={compact ? "space-y-2" : "min-h-0 flex-1 space-y-2 overflow-auto p-3"} aria-label="Admin navigation">
        <NavigationButton
          item={{ id: "overview", label: "Overview", icon: "analysis", available: true }}
          active={activeSection === "overview"}
          onSelect={onSectionChange}
          prominent
        />

        <NavigationGroup title="Access" items={accessItems} activeSection={activeSection} onSelect={onSectionChange} />

        <details className="group/projects" open>
          <NavigationGroupSummary label="Projects" active={isProjectSection(activeSection)} />
          <div className="mt-1 space-y-1 pl-2">
            <label className="mb-2 block px-1">
              <span className="sr-only">Admin project</span>
              <span className="relative block">
                <EnergyIcon name="building" className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-light" />
                <select
                  aria-label="Admin project"
                  value={selectedProjectId}
                  onChange={(event) => onProjectChange(event.target.value)}
                  className="h-10 w-full appearance-none rounded-lg border border-border bg-surface-subtle pl-9 pr-8 text-xs font-semibold outline-none transition-colors hover:border-muted-light focus-visible:ring-2 focus-visible:ring-primary/20"
                >
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
                <EnergyIcon name="chevron" className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 rotate-90 text-muted-light" />
              </span>
              <span className="mt-1.5 flex items-center justify-between px-1 text-[10px] text-muted-light">
                <span>Selected project</span>
                <span className="capitalize">{selectedProject?.status ?? "Draft"}</span>
              </span>
            </label>
            {projectItems.map((item) => (
              <NavigationButton
                key={item.id}
                item={item}
                active={activeProjectSection(activeSection) === item.id}
                onSelect={onSectionChange}
                nested
              />
            ))}
          </div>
        </details>

        <NavigationGroup title="AI Operations" items={operationItems} activeSection={activeSection} onSelect={onSectionChange} />
        <NavigationGroup title="AI Configuration" items={configurationItems} activeSection={activeSection} onSelect={onSectionChange} />
      </nav>
    </div>
  );
}

function NavigationGroup({
  title,
  items,
  activeSection,
  onSelect,
}: {
  title: string;
  items: NavigationItem[];
  activeSection: AdminSection;
  onSelect: (section: AdminSection) => void;
}) {
  const active = items.some((item) => item.id === activeSection);
  return (
    <details className="group/nav" open={active || title === "Access"}>
      <NavigationGroupSummary label={title} active={active} />
      <div className="mt-1 space-y-1 pl-2">
        {items.map((item) => (
          <NavigationButton key={item.id} item={item} active={item.id === activeSection} onSelect={onSelect} nested />
        ))}
      </div>
    </details>
  );
}

function NavigationGroupSummary({ label, active }: { label: string; active: boolean }) {
  return (
    <summary className={[
      "flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-lg px-2.5 text-xs font-semibold transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
      active ? "text-foreground" : "text-muted",
    ].join(" ")}>
      <EnergyIcon name="chevron" className="h-3 w-3 rotate-90 transition-transform group-open/nav:-rotate-90 group-open/projects:-rotate-90" />
      <span className="flex-1">{label}</span>
    </summary>
  );
}

function NavigationButton({
  item,
  active,
  onSelect,
  nested = false,
  prominent = false,
}: {
  item: NavigationItem;
  active: boolean;
  onSelect: (section: AdminSection) => void;
  nested?: boolean;
  prominent?: boolean;
}) {
  if (!item.available) {
    return (
      <div className={[
        "flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 text-muted",
        nested ? "ml-2" : "",
      ].join(" ")} aria-disabled="true">
        <EnergyIcon name={item.icon} className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-xs">{item.label}</span>
        <span className="text-[9px] font-medium uppercase tracking-wide text-muted-light">Later</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      aria-current={active ? "page" : undefined}
      className={[
        "flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
        nested ? "ml-2 w-[calc(100%-0.5rem)]" : "",
        active
          ? "bg-primary text-white"
          : prominent
            ? "text-foreground hover:bg-surface-subtle"
            : "text-muted hover:bg-surface-subtle hover:text-foreground",
      ].join(" ")}
    >
      <EnergyIcon name={item.icon} className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
    </button>
  );
}

function activeProjectSection(section: AdminSection): AdminSection {
  return section === "basics" ? "project-overview" : section;
}

function isProjectSection(section: AdminSection): boolean {
  return projectItems.some((item) => item.id === activeProjectSection(section));
}

function labelForSection(section: AdminSection): string {
  const allItems = [
    { id: "overview" as AdminSection, label: "Overview" },
    ...accessItems,
    ...projectItems,
    ...operationItems,
    ...configurationItems,
  ];
  if (section === "basics") return "Project basics";
  return allItems.find((item) => item.id === section)?.label ?? "Admin";
}

export function isAdminSection(value: string | null): value is AdminSection {
  if (!value) return false;
  return [
    "overview", "organisations", "users", "project-overview", "basics", "structure",
    "data-sources", "meter-mapping", "data-map", "templates", "knowledge", "assets",
    "runs", "conversations", "usage", "traces", "models", "skills", "tools", "mcp",
  ].includes(value);
}
