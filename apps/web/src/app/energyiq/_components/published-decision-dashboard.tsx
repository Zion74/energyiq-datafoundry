"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  configApi,
  type EnergyProjectAnalysisResolutionDto,
  type EnergyProjectHierarchyDto,
  type EnergyQueryContextRequestDto,
  type EnergySavedAnalysisDetailDto,
  type EnergyScopeAnalysisDto,
} from "../../../lib/config-api";
import {
  EnergyTemplateRenderer,
  type EnergyTemplateRendererState,
} from "./energy-template-renderer";
import { buildEnergyTemplateRenderPlan } from "./energy-template-render-plan";
import { EnergySelect } from "./energy-select";
import { useEnergyIqAccess } from "./energyiq-access";
import { EnergyIcon } from "./icons";
import { orderProjectNodesDepthFirst } from "./project-tree-model";
import {
  applyProjectAnalysisQualityPolicy,
  ProjectRenderer,
  type ProjectAnalysisQualityPolicy,
} from "./project-renderer-registry";
import { ScopeMetadataStatus } from "./scope-metadata-status";

const periodOptions: ReadonlyArray<{
  label: string;
  value?: OverviewPeriod;
  disabled?: boolean;
  title?: string;
}> = [
  { label: "Yesterday", value: "Yesterday" },
  { label: "Last 7 days", value: "Last 7 days" },
  { label: "Previous month", disabled: true, title: "Awaiting the trusted calendar-month period contract." },
  { label: "Custom", value: "Custom" },
];
type OverviewPeriod = "Yesterday" | "Last 7 days" | "Custom";
type ResourceType = "electricity" | "water";
type OverviewUrlViewState = {
  projectId: string;
  scopeId: string;
  resource: ResourceType;
  period: OverviewPeriod;
  from: string;
  to: string;
};

type LoadedResolution = {
  projectId: string;
  value: EnergyProjectAnalysisResolutionDto;
};

export function PublishedDecisionDashboard() {
  const searchParams = useSearchParams();
  const initialViewState = overviewViewStateFromSearchParams(searchParams);
  const viewStateKey = [
    initialViewState.projectId,
    initialViewState.scopeId,
    initialViewState.resource,
    initialViewState.period,
    initialViewState.from,
    initialViewState.to,
  ].join(":");
  return (
    <PublishedDecisionDashboardView
      key={viewStateKey}
      initialViewState={initialViewState}
      urlSearch={searchParams.toString()}
    />
  );
}

function PublishedDecisionDashboardView({
  initialViewState,
  urlSearch,
}: {
  initialViewState: OverviewUrlViewState;
  urlSearch: string;
}) {
  const router = useRouter();
  const { access, activeProject, selectProject } = useEnergyIqAccess();
  const requestedProject = initialViewState.projectId && access
    ? access.projects.find((candidate) => candidate.id === initialViewState.projectId
      && candidate.status === "published"
      && candidate.workspaceId === access.activeWorkspaceId) ?? null
    : null;
  const selectedProject = initialViewState.projectId ? requestedProject : activeProject;
  const projectSelectionError = initialViewState.projectId && access && !requestedProject
    ? "Requested Project is unavailable in the active workspace."
    : null;
  const scopeId = initialViewState.scopeId;
  const resource = initialViewState.resource;
  const period = initialViewState.period;
  const [resolvedRange, setResolvedRange] = useState({
    projectId: "",
    from: "",
    to: "",
  });
  const [resolution, setResolution] = useState<LoadedResolution | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [activeSection, setActiveSection] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAnalysis, setSavedAnalysis] = useState<EnergySavedAnalysisDetailDto | null>(null);
  const [hierarchy, setHierarchy] = useState<EnergyProjectHierarchyDto | null>(null);
  const [hierarchyError, setHierarchyError] = useState<string | null>(null);
  const [hierarchyLoading, setHierarchyLoading] = useState(false);

  const projectId = selectedProject?.id ?? "";
  const effectiveCustomRange = period === "Custom"
    ? { projectId, from: initialViewState.from, to: initialViewState.to }
    : resolvedRange.projectId === projectId
      ? resolvedRange
      : { projectId, from: "", to: "" };
  const requestCustomRange = period === "Custom"
    ? { from: effectiveCustomRange.from, to: effectiveCustomRange.to }
    : { from: "", to: "" };
  const queryValidationError = validateOverviewCustomRange(
    period,
    effectiveCustomRange.from,
    effectiveCustomRange.to,
  );
  const requestedProjectId = requestedProject?.id ?? "";
  const pendingUrlSearchRef = useRef(urlSearch);

  useEffect(() => {
    pendingUrlSearchRef.current = urlSearch;
  }, [urlSearch]);

  const navigateOverview = (update: Partial<OverviewUrlViewState>) => {
    const base = overviewViewStateFromSearchParams(new URLSearchParams(pendingUrlSearchRef.current));
    const nextView = {
      ...base,
      ...update,
      projectId: update.projectId ?? (base.projectId || projectId),
    };
    const href = overviewUrlWithView(pendingUrlSearchRef.current, nextView);
    pendingUrlSearchRef.current = href.slice(href.indexOf("?") + 1);
    router.replace(href);
  };

  useEffect(() => {
    if (!requestedProjectId || requestedProjectId === activeProject?.id) return;
    selectProject(requestedProjectId);
  }, [activeProject?.id, requestedProjectId, selectProject]);

  useEffect(() => {
    if (!projectId) {
      setHierarchy(null);
      setHierarchyError(null);
      setHierarchyLoading(false);
      return;
    }
    let cancelled = false;
    setHierarchy(null);
    setHierarchyError(null);
    setHierarchyLoading(true);
    void configApi.getEnergyProjectHierarchy(projectId)
      .then((result) => {
        if (!cancelled) setHierarchy(result);
      })
      .catch((reason) => {
        if (cancelled) return;
        setHierarchy(null);
        setHierarchyError(messageFrom(reason, "Unable to load Project hierarchy"));
      })
      .finally(() => {
        if (!cancelled) setHierarchyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshRevision]);

  const scopeOptions = useMemo(() => {
    const hierarchyNodes = hierarchy?.nodes ?? [];
    const tierAliases = new Map(hierarchy?.tiers.map((tier) => [tier.id, tier.alias]) ?? []);
    const nodesById = new Map(hierarchyNodes.map((node) => [node.id, node]));
    const orderedNodes = orderProjectNodesDepthFirst(
      hierarchyNodes
        .filter((node) => node.node_type !== "project")
        .map((node) => ({ ...node, parentId: node.parent_id ?? null })),
    );
    return [
      { value: "project", label: `Project · ${selectedProject?.name ?? "Project"}` },
      ...orderedNodes.map((node) => ({
        value: node.id,
        label: `${tierAliases.get(node.tier_definition_id ?? "") ?? node.node_type} · ${scopeNodeDisplayPath(node, nodesById)}`,
      })),
    ];
  }, [hierarchy, selectedProject?.name]);
  const currentResolution = resolution?.projectId === projectId ? resolution.value : null;
  const currentSnapshot = currentResolution?.status === "ready" ? currentResolution.snapshot : null;
  const currentAnalysis = currentSnapshot?.analysis ?? null;
  const projectTemplate = currentSnapshot?.projectRelease.document.templates
    .find((candidate) => candidate.template_id === "project") ?? null;
  const renderPlan = useMemo(
    () => projectTemplate && currentSnapshot
      ? buildEnergyTemplateRenderPlan({ template: projectTemplate, catalog: currentSnapshot.projectRelease.catalog })
      : null,
    [currentSnapshot, projectTemplate],
  );
  const qualityPolicy = useMemo(
    () => renderPlan && currentSnapshot
      ? applyProjectAnalysisQualityPolicy({
        plan: renderPlan,
        dataQuality: currentSnapshot.dataQuality,
      })
      : null,
    [currentSnapshot, renderPlan],
  );
  const renderPlanForDisplay = qualityPolicy?.plan ?? renderPlan;
  const saveAllowed = Boolean(
    qualityPolicy?.saveAllowed && currentSnapshot?.projectRelease.templateRevisionId,
  );

  useEffect(() => {
    if (!projectId || resource !== "electricity" || projectSelectionError || queryValidationError) return;
    let cancelled = false;
    const request = overviewAnalysisRequest(projectId, period, requestCustomRange, {
      scopeId,
      resource,
    });
    setRunning(true);
    setAnalysisError(null);
    void configApi.resolveProjectAnalysis(request)
      .then((result) => {
        if (cancelled) return;
        setResolution({ projectId, value: result });
        if (result.status !== "ready") return;
        setResolvedRange({
          projectId,
          from: toDateInput(result.snapshot.context.from, result.snapshot.context.timezone),
          to: toDateInput(new Date(Date.parse(result.snapshot.context.to) - 1).toISOString(), result.snapshot.context.timezone),
        });
      })
      .catch((reason) => {
        if (cancelled) return;
        setResolution(null);
        setAnalysisError(messageFrom(reason, "Unable to run project analysis"));
      })
      .finally(() => {
        if (!cancelled) setRunning(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period, projectId, projectSelectionError, queryValidationError, refreshRevision, requestCustomRange.from, requestCustomRange.to, resource, scopeId]);

  useEffect(() => {
    const firstSectionId = renderPlanForDisplay?.sections[0]?.section_id ?? "";
    setActiveSection(firstSectionId);
  }, [projectId, renderPlanForDisplay]);

  useEffect(() => {
    setSavedAnalysis(null);
    setSaveError(null);
  }, [period, projectId, requestCustomRange.from, requestCustomRange.to, resource]);

  const saveCurrentAnalysis = async () => {
    if (!projectId || !currentAnalysis || !saveAllowed || resource !== "electricity") return;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await configApi.saveEnergyAnalysis(projectId, {
        ...overviewAnalysisRequest(projectId, period, requestCustomRange, {
          scopeId,
          resource,
        }),
        title: `${currentAnalysis.context.scopeName} · ${period}`,
      });
      setSavedAnalysis(saved);
    } catch (reason) {
      setSavedAnalysis(null);
      setSaveError(messageFrom(reason, "Unable to save this analysis"));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!renderPlanForDisplay) return;
    const elements = renderPlanForDisplay.sections
      .map((section) => document.getElementById(sectionDomId(section.section_id)))
      .filter((element): element is HTMLElement => Boolean(element));
    if (elements.length === 0) return;
    const scrollContainer = elements[0]?.closest("main");
    if (!scrollContainer) return;
    const updateActiveSection = () => {
      const passed = elements.filter((element) => element.getBoundingClientRect().top <= 168);
      setActiveSection((passed.at(-1) ?? elements[0]).id.replace("customer-overview-", ""));
    };
    updateActiveSection();
    scrollContainer.addEventListener("scroll", updateActiveSection, { passive: true });
    return () => scrollContainer.removeEventListener("scroll", updateActiveSection);
  }, [renderPlanForDisplay]);

  const runMessage = currentAnalysis
    ? `${formatRunPeriod(currentAnalysis)} · ${currentSnapshot?.dataSnapshot.id ?? currentAnalysis.provenance.dataSnapshotId}`
    : running ? "Resolving Project scope and trusted facts…" : "Waiting for analysis context";
  const rendererState = resolveOverviewRendererState({
    projectId,
    resource,
    loading: running,
    analysisError: projectSelectionError ?? queryValidationError ?? analysisError,
    resolution: currentResolution,
    plan: renderPlanForDisplay,
    advisories: qualityPolicy?.advisories,
  });
  const rendererRequest = currentResolution?.status === "ready"
    ? { mode: "customer" as const, rendererKey: currentResolution.snapshot.renderer.key }
    : currentResolution?.status === "configuration-required"
      ? { mode: "customer" as const, rendererKey: null }
      : null;
  const publishedSections = rendererState.status === "ready" ? rendererState.plan.sections : [];

  return (
    <div className="mx-auto w-full max-w-[1480px] px-4 py-6 lg:px-8 lg:py-8">
      <section className="flex flex-col gap-5 border-b border-border pb-6 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted">
            <span>{selectedProject?.name ?? "Select a Project"}</span>
            <EnergyIcon name="chevron" className="h-3 w-3" />
            <span>Published analysis</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Energy analysis</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted">
            A Project-specific decision view rendered from the published EnergyIQ Template Schema.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="w-full min-w-[220px] sm:w-auto">
            <EnergySelect
              ariaLabel="Analysis Scope"
              value={scopeId}
              options={scopeOptions}
              onValueChange={(nextScopeId) => navigateOverview({
                scopeId: nextScopeId,
              })}
              size="small"
              disabled={!projectId || hierarchyLoading || Boolean(hierarchyError)}
              triggerClassName="sm:w-[260px]"
            />
            {hierarchyError ? (
              <p role="alert" className="mt-1 text-[10px] leading-4 text-step-error">
                Analysis scopes unavailable: {hierarchyError}
              </p>
            ) : null}
          </div>
          <div className="flex rounded-lg border border-border bg-surface p-1" aria-label="Resource type">
            {(["electricity", "water"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => navigateOverview({
                  resource: item,
                })}
                className={[
                  "flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors",
                  resource === item ? "bg-primary text-white" : "text-muted hover:bg-surface-subtle hover:text-foreground",
                ].join(" ")}
              >
                <EnergyIcon name={item === "electricity" ? "bolt" : "water"} className="h-3.5 w-3.5" />
                {item === "electricity" ? "Electricity" : "Water"}
              </button>
            ))}
          </div>
          <div className="flex max-w-full overflow-x-auto rounded-lg border border-border bg-surface p-1">
            {periodOptions.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => item.value ? navigateOverview(item.value === "Custom"
                  ? {
                    period: item.value,
                    from: effectiveCustomRange.from,
                    to: effectiveCustomRange.to,
                  }
                  : { period: item.value }) : undefined}
                disabled={item.disabled}
                title={item.title}
                className={[
                  "h-8 whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-colors",
                  item.value && period === item.value ? "bg-surface-subtle text-foreground shadow-sm" : "text-muted hover:text-foreground",
                  item.disabled ? "cursor-not-allowed opacity-45 hover:text-muted" : "",
                ].join(" ")}
              >
                {item.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setRefreshRevision((current) => current + 1)}
            disabled={running || resource === "water"}
            className="h-10 rounded-lg bg-primary px-4 text-xs font-semibold text-white transition-colors hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? "Refreshing…" : "Refresh view"}
          </button>
          <button
            type="button"
            onClick={() => void saveCurrentAnalysis()}
            disabled={saving || rendererState.status !== "ready" || !saveAllowed}
            className="h-10 rounded-lg border border-border bg-surface px-4 text-xs font-semibold text-foreground transition-colors hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save analysis"}
          </button>
        </div>
      </section>

      {period === "Custom" ? (
        <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface px-4 py-3">
          <DateField label="From" value={effectiveCustomRange.from} onChange={(from) => navigateOverview({
            from,
          })} />
          <DateField label="To, inclusive" value={effectiveCustomRange.to} onChange={(to) => navigateOverview({
            to,
          })} />
          <p className="pb-2 text-[10px] text-muted-light">Changing the range reuses the published template and runs only the scoped queries.</p>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-light">
        <span>{runMessage}</span>
        <div className="flex flex-wrap items-center gap-3">
          {saveError ? <span className="text-step-error">Save failed: {saveError}</span> : null}
          {savedAnalysis ? (
            <Link href={`/energyiq/saved/${savedAnalysis.id}`} className="font-semibold text-primary hover:underline">
              Saved as version {savedAnalysis.sequence} →
            </Link>
          ) : null}
          {currentSnapshot ? (
            <span className="font-mono">
              {currentSnapshot.projectRelease.id}
            </span>
          ) : null}
        </div>
      </div>

      {currentSnapshot ? (
        <div className="mt-6">
          <ScopeMetadataStatus metadata={currentSnapshot.metadata} mode="interactive" />
        </div>
      ) : null}

      {rendererState.status === "ready" ? (
        <div className="mt-6 lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start lg:gap-8 xl:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="lg:sticky lg:top-6">
            <p className="mb-2 hidden px-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-light lg:block">Published sections</p>
            <nav className="flex max-w-full gap-1 overflow-x-auto rounded-lg border border-border bg-surface p-1 lg:flex-col lg:overflow-visible" aria-label="Published analysis sections">
              {publishedSections.map((section, index) => (
                <a
                  key={section.section_id}
                  href={`#${sectionDomId(section.section_id)}`}
                  onClick={() => setActiveSection(section.section_id)}
                  aria-current={activeSection === section.section_id ? "location" : undefined}
                  className={[
                    "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors lg:min-h-10 lg:w-full",
                    activeSection === section.section_id ? "bg-primary text-white" : "text-muted hover:bg-surface-subtle hover:text-foreground",
                  ].join(" ")}
                >
                  <span className={activeSection === section.section_id ? "text-[10px] text-white/65" : "text-[10px] text-muted-light"}>{String(index + 1).padStart(2, "0")}</span>
                  <span>{section.navigation_label}</span>
                </a>
              ))}
            </nav>
            <p className="mt-3 hidden px-3 text-[11px] leading-5 text-muted-light lg:block">This navigation is generated from the same published template used by Admin Preview.</p>
          </aside>

          <div className="min-w-0">
            {rendererRequest ? (
              <ProjectRenderer request={rendererRequest} state={rendererState} sectionIdPrefix="customer-overview" onRetry={() => setRefreshRevision((current) => current + 1)} />
            ) : (
              <EnergyTemplateRenderer state={rendererState} sectionIdPrefix="customer-overview" onRetry={() => setRefreshRevision((current) => current + 1)} />
            )}
          </div>
        </div>
      ) : (
        <div className="mt-6">
          {rendererRequest ? (
            <ProjectRenderer request={rendererRequest} state={rendererState} onRetry={() => setRefreshRevision((current) => current + 1)} />
          ) : (
            <EnergyTemplateRenderer state={rendererState} onRetry={() => setRefreshRevision((current) => current + 1)} />
          )}
        </div>
      )}
    </div>
  );
}

function resolveOverviewRendererState(input: {
  projectId: string;
  resource: ResourceType;
  loading: boolean;
  analysisError: string | null;
  resolution: EnergyProjectAnalysisResolutionDto | null;
  plan: ReturnType<typeof buildEnergyTemplateRenderPlan> | null;
  advisories?: ProjectAnalysisQualityPolicy["advisories"];
}): EnergyTemplateRendererState {
  const error = input.analysisError;
  if (error) {
    return { status: "error", title: "Published analysis is unavailable", detail: `${error} Retry the same Project and period without changing the published template.` };
  }
  if (!input.projectId) {
    return { status: "empty", title: "Select a Project", detail: "Choose a Project to load its published Template Revision and analysis context." };
  }
  if (input.resource === "water") {
    return { status: "unsupported", title: "Water analysis is not configured", detail: "Publish water metrics, capabilities and modules before this view displays decision-grade results." };
  }
  if (input.loading || !input.resolution) {
    return { status: "loading", title: "Resolving the published analysis", detail: "Loading the Template Revision, trusted Project scope, selected period and data snapshot." };
  }
  if (input.resolution.status === "configuration-required") {
    return { status: "unsupported", title: input.resolution.title, detail: input.resolution.detail };
  }
  if (!input.plan) {
    return { status: "empty", title: "Published analysis has no Project Template", detail: "Publish a Project Template with at least one enabled module." };
  }
  return {
    status: "ready",
    analysis: input.resolution.snapshot.analysis,
    plan: input.plan,
    ...(input.advisories?.length ? { advisories: input.advisories } : {}),
  };
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="text-[9px] font-semibold uppercase tracking-wide text-muted-light">
      {label}
      <input type="date" value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 block h-9 rounded-md border border-border bg-surface px-3 text-xs font-medium normal-case text-foreground" />
    </label>
  );
}

export function overviewAnalysisRequest(
  projectId: string,
  period: OverviewPeriod,
  customRange: { from: string; to: string },
  view: { scopeId?: string; resource?: ResourceType } = {},
): EnergyQueryContextRequestDto {
  const scopeId = view.scopeId?.trim() || "project";
  const resource = view.resource ?? "electricity";
  if (period !== "Custom") return { projectId, scopeId, resource, period };
  return { projectId, scopeId, resource, period, from: customRange.from, to: customRange.to };
}

export function overviewViewStateFromSearchParams(searchParams: Pick<URLSearchParams, "get">): OverviewUrlViewState {
  const requestedPeriod = searchParams.get("period");
  const period = requestedPeriod === "Yesterday" || requestedPeriod === "Custom"
    ? requestedPeriod
    : "Last 7 days";
  return {
    projectId: searchParams.get("projectId")?.trim() || "",
    scopeId: searchParams.get("scopeId")?.trim() || "project",
    resource: searchParams.get("resource") === "water" ? "water" : "electricity",
    period,
    from: period === "Custom" ? searchParams.get("from") ?? "" : "",
    to: period === "Custom" ? searchParams.get("to") ?? "" : "",
  };
}

function validateOverviewCustomRange(period: OverviewPeriod, from: string, to: string): string | null {
  if (period !== "Custom") return null;
  if (!from || !to) return "Choose both From and To dates for a Custom period.";
  if (!isValidDateInput(from) || !isValidDateInput(to)) return "Use valid Custom dates in YYYY-MM-DD format.";
  if (from > to) return "From date must be on or before To date.";
  return null;
}

function isValidDateInput(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function overviewUrlWithView(
  urlSearch: string,
  view: OverviewUrlViewState,
): string {
  const next = new URLSearchParams(urlSearch);
  if (view.projectId) next.set("projectId", view.projectId);
  else next.delete("projectId");
  next.set("scopeId", view.scopeId || "project");
  next.set("resource", view.resource);
  next.set("period", view.period);
  if (view.period === "Custom") {
    next.set("from", view.from);
    next.set("to", view.to);
  } else {
    next.delete("from");
    next.delete("to");
  }
  return `/energyiq/overview?${next.toString()}`;
}

function scopeNodeDisplayPath(
  node: EnergyProjectHierarchyDto["nodes"][number],
  nodesById: ReadonlyMap<string, EnergyProjectHierarchyDto["nodes"][number]>,
): string {
  const segments = [node.name];
  const visited = new Set([node.id]);
  let parentId = node.parent_id;
  let remaining = nodesById.size;
  while (parentId && remaining > 0) {
    if (visited.has(parentId)) break;
    visited.add(parentId);
    const parent = nodesById.get(parentId);
    if (!parent) break;
    if (parent.node_type !== "project") segments.unshift(parent.name);
    parentId = parent.parent_id;
    remaining -= 1;
  }
  return segments.join(" / ");
}

export function toDateInput(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(new Date(value));
}

function formatRunPeriod(analysis: EnergyScopeAnalysisDto): string {
  const formatter = new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", year: "numeric", timeZone: analysis.context.timezone });
  const from = formatter.format(new Date(analysis.context.from));
  const to = formatter.format(new Date(new Date(analysis.context.to).getTime() - 1));
  return `${analysis.context.projectName} · ${from}–${to}`;
}

function sectionDomId(sectionId: string): string {
  return `customer-overview-${sectionId}`;
}

function messageFrom(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}
