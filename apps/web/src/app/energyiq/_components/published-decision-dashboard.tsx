"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  configApi,
  type EnergyProjectAnalysisSnapshotDto,
  type EnergyProjectAnalysisResolutionDto,
  type EnergyProjectHierarchyDto,
  type EnergyQueryContextRequestDto,
  type EnergySavedAnalysisDetailDto,
  type EnergySavedAnalysisAiArtifactInputDto,
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
import { OverviewHistoryDialog } from "./overview-history-dialog";
import {
  overviewHistoryStateFromSearchParams,
  overviewUrlWithHistory,
  type OverviewHistoryState,
} from "./overview-history-state";
import {
  OverviewSectionNavigation,
  type OverviewNavigationSection,
} from "./overview-section-navigation";
import { orderProjectNodesDepthFirst } from "./project-tree-model";
import {
  applyProjectAnalysisQualityPolicy,
  ProjectRenderer,
  type ProjectAnalysisQualityPolicy,
  type ProjectRendererState,
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
  { label: "Previous week", value: "Previous week" },
  { label: "Previous month", value: "Previous month" },
  { label: "Custom", value: "Custom" },
];
type OverviewPeriod = "Yesterday" | "Last 7 days" | "Previous week" | "Previous month" | "Custom";
type ResourceType = "electricity" | "water";
const ALL_OVERVIEW_RESOURCES = ["electricity", "water"] as const;
const ELECTRICITY_ONLY_RESOURCES = ["electricity"] as const;
const PRESCHOOL_OVERVIEW_RANGE = {
  from: "2026-05-01",
  to: "2026-05-31",
} as const;
const NGEE_ANN_OVERVIEW_SECTIONS: ReadonlyArray<OverviewNavigationSection> = [
  { id: "ngee-ann-takeaways", label: "Takeaways" },
  { id: "ngee-ann-key-highlights", label: "Verified figures" },
  { id: "ngee-ann-ai-analysis", label: "AI analysis" },
  { id: "ngee-ann-change", label: "Change over time" },
  { id: "ngee-ann-location", label: "Main contributors" },
  { id: "ngee-ann-timing", label: "Time patterns" },
  { id: "ngee-ann-evidence", label: "Evidence" },
] as const;
const PRESCHOOL_OVERVIEW_SECTIONS: ReadonlyArray<OverviewNavigationSection> = [
  { id: "preschool-decision-summary", label: "Takeaways" },
  { id: "preschool-ai-analysis", label: "AI analysis" },
  { id: "preschool-appliance-ranking", label: "Energy drivers" },
  { id: "preschool-efficiency-benchmark", label: "Efficiency" },
  { id: "preschool-operational-behaviour", label: "Operating patterns" },
  { id: "preschool-planning-outlook", label: "June plan" },
  { id: "preschool-centre-ranking", label: "Centre detail" },
  { id: "preschool-evidence", label: "Evidence" },
] as const;
export type OverviewComparison = "overlay" | "selected" | "average";
export type OverviewCategory = "all" | "load" | "light";
export type CurrentOverviewPin = {
  from: string;
  to: string;
  dataSnapshotId: string;
  projectReleaseId: string;
};
export type OverviewUrlViewState = {
  projectId: string;
  scopeId: string;
  resource: ResourceType;
  period: OverviewPeriod;
  from: string;
  to: string;
  grain: "day" | "hour";
  comparison: OverviewComparison;
  category: OverviewCategory;
  currentOverviewPin?: CurrentOverviewPin;
};

type LoadedResolution = {
  projectId: string;
  value: EnergyProjectAnalysisResolutionDto;
};

export function PublishedDecisionDashboard() {
  const searchParams = useSearchParams();
  const initialViewState = overviewViewStateFromSearchParams(searchParams);
  const historyState = overviewHistoryStateFromSearchParams(searchParams);
  const hasExplicitPeriod = searchParams.has("period");
  const viewStateKey = [
    initialViewState.projectId,
    initialViewState.scopeId,
    initialViewState.resource,
    initialViewState.period,
    initialViewState.from,
    initialViewState.to,
    initialViewState.currentOverviewPin?.from ?? "",
    initialViewState.currentOverviewPin?.to ?? "",
    initialViewState.currentOverviewPin?.dataSnapshotId ?? "",
    initialViewState.currentOverviewPin?.projectReleaseId ?? "",
    hasExplicitPeriod ? "legacy-window" : "current-window",
  ].join(":");
  return (
    <PublishedDecisionDashboardView
      key={viewStateKey}
      initialViewState={initialViewState}
      urlSearch={searchParams.toString()}
      historyState={historyState}
    />
  );
}

function PublishedDecisionDashboardView({
  initialViewState,
  urlSearch,
  historyState,
}: {
  initialViewState: OverviewUrlViewState;
  urlSearch: string;
  historyState: OverviewHistoryState;
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
  const [aiArtifact, setAiArtifact] = useState<EnergySavedAnalysisAiArtifactInputDto | null>(null);
  const [hierarchy, setHierarchy] = useState<EnergyProjectHierarchyDto | null>(null);
  const [hierarchyError, setHierarchyError] = useState<string | null>(null);
  const [hierarchyLoading, setHierarchyLoading] = useState(false);

  const projectId = selectedProject?.id ?? "";
  const isNgeeAnnProject = projectId === "ngee-ann-polytechnic";
  const isPreschoolProject = projectId === "preschool-demo";
  const isDedicatedOverviewProject = isNgeeAnnProject || isPreschoolProject;
  const resource = isDedicatedOverviewProject ? "electricity" : initialViewState.resource;
  const scopeId = isDedicatedOverviewProject ? "project" : initialViewState.scopeId;
  const period = isPreschoolProject ? "Custom" : initialViewState.period;
  const usesCurrentOverviewWindow = isNgeeAnnProject;
  const effectiveCustomRange = isPreschoolProject
    ? { projectId, ...PRESCHOOL_OVERVIEW_RANGE }
    : period === "Custom"
      ? { projectId, from: initialViewState.from, to: initialViewState.to }
      : resolvedRange.projectId === projectId
        ? resolvedRange
        : { projectId, from: "", to: "" };
  const requestCustomRange = period === "Custom"
    ? { from: effectiveCustomRange.from, to: effectiveCustomRange.to }
    : { from: "", to: "" };
  const queryValidationError = usesCurrentOverviewWindow
    ? null
    : validateOverviewCustomRange(period, effectiveCustomRange.from, effectiveCustomRange.to);
  const requestedProjectId = requestedProject?.id ?? "";
  const pendingUrlSearchRef = useRef(urlSearch);
  const refreshRequestRevisionRef = useRef<number | null>(null);
  const refreshBypassPendingRef = useRef(false);
  const historyButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    pendingUrlSearchRef.current = urlSearch;
  }, [urlSearch]);

  const navigateHistory = (
    nextHistoryState: OverviewHistoryState,
    mode: "push" | "replace" = "push",
  ) => {
    const href = overviewUrlWithHistory(pendingUrlSearchRef.current, nextHistoryState);
    pendingUrlSearchRef.current = href.includes("?") ? href.slice(href.indexOf("?") + 1) : "";
    if (mode === "replace") router.replace(href);
    else router.push(href);
  };

  useEffect(() => {
    if (!isNgeeAnnProject || initialViewState.resource !== "water") return;
    const href = currentOverviewUrlWithView({
      ...initialViewState,
      projectId,
      scopeId: "project",
      resource: "electricity",
    });
    pendingUrlSearchRef.current = href.slice(href.indexOf("?") + 1);
    router.replace(href);
  }, [initialViewState, isNgeeAnnProject, projectId, router]);

  useEffect(() => {
    if (!isPreschoolProject) return;
    const hasCanonicalPreschoolView = initialViewState.projectId === projectId
      && initialViewState.scopeId === "project"
      && initialViewState.resource === "electricity"
      && initialViewState.period === "Custom"
      && initialViewState.from === PRESCHOOL_OVERVIEW_RANGE.from
      && initialViewState.to === PRESCHOOL_OVERVIEW_RANGE.to;
    if (hasCanonicalPreschoolView) return;
    const href = overviewUrlWithView({
      ...initialViewState,
      projectId,
      scopeId: "project",
      resource: "electricity",
      period: "Custom",
      ...PRESCHOOL_OVERVIEW_RANGE,
    });
    pendingUrlSearchRef.current = href.slice(href.indexOf("?") + 1);
    router.replace(href);
  }, [initialViewState, isPreschoolProject, projectId, router]);

  const navigateOverview = (update: Partial<OverviewUrlViewState>) => {
    const base = overviewViewStateFromSearchParams(new URLSearchParams(pendingUrlSearchRef.current));
    const nextView = {
      ...base,
      ...update,
      projectId: update.projectId ?? (base.projectId || projectId),
      scopeId: isDedicatedOverviewProject ? "project" : update.scopeId ?? base.scopeId,
    };
    const href = usesCurrentOverviewWindow
      ? currentOverviewUrlWithView(nextView)
      : overviewUrlWithView(nextView);
    pendingUrlSearchRef.current = href.slice(href.indexOf("?") + 1);
    router.replace(href);
  };

  const refreshOverview = () => {
    const nextRevision = refreshRevision + 1;
    refreshRequestRevisionRef.current = nextRevision;
    refreshBypassPendingRef.current = true;
    setRefreshRevision(nextRevision);
  };

  useEffect(() => {
    if (!requestedProjectId || requestedProjectId === activeProject?.id) return;
    selectProject(requestedProjectId);
  }, [activeProject?.id, requestedProjectId, selectProject]);

  useEffect(() => {
    if (!projectId || isDedicatedOverviewProject) {
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
  }, [isDedicatedOverviewProject, projectId, refreshRevision]);

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
  const latestAvailableRange = currentSnapshot?.latestAvailablePeriod ?? null;
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
    const isUserRefresh = refreshRevision > 0
      && refreshRequestRevisionRef.current === refreshRevision;
    const bypassCache = isUserRefresh && refreshBypassPendingRef.current;
    if (bypassCache) refreshBypassPendingRef.current = false;
    const request = usesCurrentOverviewWindow
      ? currentOverviewAnalysisRequest(projectId, {
          scopeId,
          resource,
          currentOverviewPin: isUserRefresh ? undefined : initialViewState.currentOverviewPin,
        })
      : overviewAnalysisRequest(projectId, period, requestCustomRange, { scopeId, resource });
    setRunning(true);
    setAnalysisError(null);
    const resolutionRequest = bypassCache
      ? configApi.resolveProjectAnalysis(request, { bypassCache: true })
      : configApi.resolveProjectAnalysis(request);
    void resolutionRequest
      .then((result) => {
        if (cancelled) return;
        setResolution({ projectId, value: result });
        if (result.status !== "ready") return;
        setResolvedRange({
          projectId,
          from: toDateInput(result.snapshot.context.from, result.snapshot.context.timezone),
          to: toDateInput(new Date(Date.parse(result.snapshot.context.to) - 1).toISOString(), result.snapshot.context.timezone),
        });
        if (usesCurrentOverviewWindow && (!initialViewState.currentOverviewPin || isUserRefresh)) {
          const range = snapshotLocalDateRange(result.snapshot);
          const href = currentOverviewUrlWithView({
            ...initialViewState,
            projectId,
            scopeId: "project",
            currentOverviewPin: {
              ...range,
              dataSnapshotId: result.snapshot.context.dataSnapshotId,
              projectReleaseId: result.snapshot.projectRelease.id,
            },
          });
          pendingUrlSearchRef.current = href.slice(href.indexOf("?") + 1);
          router.replace(href);
        }
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
  }, [initialViewState, period, projectId, projectSelectionError, queryValidationError, refreshRevision, requestCustomRange.from, requestCustomRange.to, resource, router, scopeId, usesCurrentOverviewWindow]);

  useEffect(() => {
    setSavedAnalysis(null);
    setSaveError(null);
  }, [period, projectId, requestCustomRange.from, requestCustomRange.to, resource]);

  const saveCurrentAnalysis = async () => {
    if (!projectId || !currentAnalysis || !currentSnapshot || !saveAllowed || resource !== "electricity") return;
    setSaving(true);
    setSaveError(null);
    try {
      const resolvedSnapshotRange = snapshotLocalDateRange(currentSnapshot);
      const request = isNgeeAnnProject
        ? currentOverviewAnalysisRequest(projectId, {
            scopeId,
            resource,
            currentOverviewPin: {
              ...resolvedSnapshotRange,
              dataSnapshotId: currentSnapshot.context.dataSnapshotId,
              projectReleaseId: currentSnapshot.projectRelease.id,
            },
          })
        : overviewAnalysisRequest(projectId, period, requestCustomRange, { scopeId, resource });
      const saved = await configApi.saveEnergyAnalysis(projectId, {
        ...request,
        title: `${currentAnalysis.context.scopeName} · ${formatAnalysisWindow(currentSnapshot)}`,
        viewState: {
          grain: initialViewState.grain,
          comparison: initialViewState.comparison,
          category: initialViewState.category,
        },
        ...(aiArtifact?.snapshotId === currentSnapshot.dataSnapshot.id
          && aiArtifact.rendererKey === currentSnapshot.renderer.key
          && aiArtifact.projectReleaseId === currentSnapshot.projectRelease.id
          ? { aiArtifact }
          : {}),
      });
      setSavedAnalysis(saved);
    } catch (reason) {
      setSavedAnalysis(null);
      setSaveError(messageFrom(reason, "Unable to save this analysis"));
    } finally {
      setSaving(false);
    }
  };

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
  const projectRendererState = rendererRequest
    ? toProjectRendererState(rendererState, currentSnapshot)
    : null;
  const isNgeeAnnRenderer = rendererRequest?.rendererKey === "ngee-ann-overview";
  const isPreschoolRenderer = rendererRequest?.rendererKey === "preschool-overview";
  const isDedicatedOverviewRenderer = isNgeeAnnRenderer || isPreschoolRenderer;
  const isDedicatedOverviewShell = isDedicatedOverviewProject || isPreschoolRenderer;
  const currentHandoffPin = currentSnapshot
    ? {
        ...snapshotLocalDateRange(currentSnapshot),
        dataSnapshotId: currentSnapshot.context.dataSnapshotId,
        projectReleaseId: currentSnapshot.projectRelease.id,
      }
    : initialViewState.currentOverviewPin;
  const resolvedHandoffView = currentSnapshot && isNgeeAnnProject
    ? {
        ...initialViewState,
        period: "Custom" as const,
        scopeId: "project",
        ...snapshotLocalDateRange(currentSnapshot),
        ...(currentHandoffPin ? { currentOverviewPin: currentHandoffPin } : {}),
      }
    : {
        ...initialViewState,
        scopeId: isPreschoolProject ? "project" : initialViewState.scopeId,
        period: isPreschoolProject ? "Custom" : initialViewState.period,
        from: effectiveCustomRange.from,
        to: effectiveCustomRange.to,
        ...(currentHandoffPin ? { currentOverviewPin: currentHandoffPin } : {}),
      };
  const publishedSections = rendererState.status === "ready" ? rendererState.plan.sections : [];
  const navigationSections = useMemo<ReadonlyArray<OverviewNavigationSection>>(() => {
    if (isNgeeAnnRenderer) return NGEE_ANN_OVERVIEW_SECTIONS;
    if (isPreschoolRenderer) return PRESCHOOL_OVERVIEW_SECTIONS;
    return publishedSections.map((section) => ({
      id: sectionDomId(section.section_id),
      label: section.navigation_label,
    }));
  }, [isNgeeAnnRenderer, isPreschoolRenderer, publishedSections]);

  useEffect(() => {
    setActiveSection(navigationSections[0]?.id ?? "");
  }, [projectId, navigationSections]);

  useEffect(() => {
    const elements = navigationSections
      .map((section) => document.getElementById(section.id))
      .filter((element): element is HTMLElement => Boolean(element));
    if (elements.length === 0) return;
    const scrollContainer = elements[0]?.closest("main");
    if (!scrollContainer) return;
    const updateActiveSection = () => {
      const passed = elements.filter((element) => element.getBoundingClientRect().top <= 168);
      setActiveSection((passed.at(-1) ?? elements[0]).id);
    };
    updateActiveSection();
    scrollContainer.addEventListener("scroll", updateActiveSection, { passive: true });
    return () => scrollContainer.removeEventListener("scroll", updateActiveSection);
  }, [navigationSections]);

  return (
    <>
    <div
      data-energyiq-current-overview="true"
      data-print-exclude={historyState.open ? "true" : undefined}
      className="mx-auto w-full max-w-[1480px] px-4 py-6 lg:px-8 lg:py-8"
    >
      <section className="flex flex-col gap-5 border-b border-border pb-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          {isDedicatedOverviewRenderer ? (
            <>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                {isPreschoolRenderer ? "Portfolio energy overview" : "Energy decision overview"}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                <span className="font-semibold text-foreground">{selectedProject?.name}</span>
                {isNgeeAnnRenderer ? <span>Rolling 28-day view</span> : null}
                {currentSnapshot ? <span>{formatAnalysisWindow(currentSnapshot)}</span> : null}
                {currentAnalysis ? <span>{currentAnalysis.context.timezone}</span> : null}
                {isNgeeAnnRenderer && currentSnapshot ? (
                  <span>Data through {formatDataThrough(currentSnapshot)}</span>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted">
                <span>{selectedProject?.name ?? "Select a Project"}</span>
                <EnergyIcon name="chevron" className="h-3 w-3" />
                <span>Published analysis</span>
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Energy analysis</h1>
              <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted">
                A Project-specific decision view rendered from the published EnergyIQ Template Schema.
              </p>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isDedicatedOverviewShell ? (
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
          ) : null}
          <div className="flex rounded-lg border border-border bg-surface p-1" aria-label="Resource type">
            {(isDedicatedOverviewShell ? ELECTRICITY_ONLY_RESOURCES : ALL_OVERVIEW_RESOURCES).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={resource === item}
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
          {!isDedicatedOverviewShell ? (
            <div className="flex max-w-full overflow-x-auto rounded-lg border border-border bg-surface p-1">
              {periodOptions.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  aria-pressed={Boolean(item.value && period === item.value)}
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
          ) : null}
          <button
            ref={historyButtonRef}
            type="button"
            onClick={() => navigateHistory({ open: true, selectedAnalysisId: null })}
            disabled={!projectId}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-xs font-semibold text-foreground transition-colors hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
          >
            <EnergyIcon name="calendar" className="h-3.5 w-3.5" />
            History
          </button>
          <button
            type="button"
            onClick={refreshOverview}
            disabled={running || resource === "water"}
            className="h-10 rounded-lg bg-primary px-4 text-xs font-semibold text-white transition-colors hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? "Refreshing…" : usesCurrentOverviewWindow ? "Refresh current overview" : "Refresh view"}
          </button>
          <button
            type="button"
            onClick={() => void saveCurrentAnalysis()}
            disabled={saving || rendererState.status !== "ready" || !saveAllowed}
            title={aiArtifact?.snapshotId === currentSnapshot?.dataSnapshot.id
              ? "Save the deterministic report with its completed AI result."
              : "Save the deterministic report now. A still-running AI result is not attached."}
            className="h-10 rounded-lg border border-border bg-surface px-4 text-xs font-semibold text-foreground transition-colors hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save analysis"}
          </button>
        </div>
      </section>

      {!isDedicatedOverviewShell && period === "Custom" ? (
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

      {!isDedicatedOverviewRenderer || saveError || savedAnalysis ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-light">
          {!isDedicatedOverviewRenderer ? <span>{runMessage}</span> : <span />}
          <div className="flex flex-wrap items-center gap-3">
            {saveError ? <span className="text-step-error">Save failed: {saveError}</span> : null}
            {savedAnalysis ? (
              <button
                type="button"
                onClick={() => navigateHistory({ open: true, selectedAnalysisId: savedAnalysis.id })}
                className="font-semibold text-primary hover:underline"
              >
                Saved as version {savedAnalysis.sequence} →
              </button>
            ) : null}
            {currentSnapshot && !isDedicatedOverviewRenderer ? (
              <span className="font-mono">
                {currentSnapshot.projectRelease.id}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {currentSnapshot && !isDedicatedOverviewRenderer ? (
        <div className="mt-6">
          <ScopeMetadataStatus metadata={currentSnapshot.metadata} mode="interactive" />
        </div>
      ) : null}

      {rendererState.status === "ready" ? (
        <div className="mt-4 xl:grid xl:grid-cols-[200px_minmax(0,1fr)] xl:items-start xl:gap-8 2xl:grid-cols-[220px_minmax(0,1fr)]">
          <OverviewSectionNavigation
            sections={navigationSections}
            activeSectionId={activeSection}
            onSelect={setActiveSection}
          />
          <div className="min-w-0">
            {isDedicatedOverviewRenderer && rendererRequest && projectRendererState ? (
              <ProjectRenderer
                request={rendererRequest}
                state={projectRendererState}
                showContextHeader={false}
                onRetry={refreshOverview}
                latestAvailableRange={usesCurrentOverviewWindow ? null : latestAvailableRange}
                onViewLatestAvailableData={(range) => navigateOverview({
                  period: "Custom",
                  from: range.from,
                  to: range.to,
                })}
                grain={initialViewState.grain}
                comparison={initialViewState.comparison}
                category={initialViewState.category}
                onComparisonChange={(comparison) => navigateOverview({ comparison })}
                onCategoryChange={(category) => navigateOverview({ category })}
                projectExplorerHref={overviewHandoffHref("/energyiq/explorer", {
                  ...resolvedHandoffView,
                  projectId,
                })}
                aiAnalystHref={overviewHandoffHref("/energyiq/ai", {
                  ...resolvedHandoffView,
                  projectId,
                })}
                onAiArtifactChange={setAiArtifact}
              />
            ) : rendererRequest && projectRendererState ? (
              <ProjectRenderer request={rendererRequest} state={projectRendererState} sectionIdPrefix="customer-overview" onRetry={refreshOverview} />
            ) : (
              <EnergyTemplateRenderer state={rendererState} sectionIdPrefix="customer-overview" onRetry={refreshOverview} />
            )}
          </div>
        </div>
      ) : (
        <div className="mt-6">
          {rendererRequest && projectRendererState ? (
            <ProjectRenderer request={rendererRequest} state={projectRendererState} onRetry={refreshOverview} />
          ) : (
            <EnergyTemplateRenderer state={rendererState} onRetry={refreshOverview} />
          )}
        </div>
      )}
    </div>
    {historyState.open ? (
      <OverviewHistoryDialog
        projectName={selectedProject?.name ?? "Current Project"}
        selectedAnalysisId={historyState.selectedAnalysisId}
        onSelect={(analysisId) => navigateHistory({ open: true, selectedAnalysisId: analysisId })}
        onBackToHistory={() => navigateHistory({ open: true, selectedAnalysisId: null }, "replace")}
        onClose={() => navigateHistory({ open: false, selectedAnalysisId: null }, "replace")}
        returnFocusRef={historyButtonRef}
      />
    ) : null}
    </>
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

function toProjectRendererState(
  state: EnergyTemplateRendererState,
  snapshot: EnergyProjectAnalysisSnapshotDto | null,
): ProjectRendererState {
  if (state.status !== "ready") return state;
  if (!snapshot) {
    return {
      status: "error",
      title: "Published analysis is unavailable",
      detail: "The Project Analysis Snapshot is missing. Refresh this same Project and Period.",
    };
  }
  return {
    status: "ready",
    snapshot,
    plan: state.plan,
    ...(state.advisories?.length ? { advisories: state.advisories } : {}),
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

export function currentOverviewAnalysisRequest(
  projectId: string,
  view: {
    scopeId?: string;
    resource?: ResourceType;
    currentOverviewPin?: CurrentOverviewPin;
  } = {},
): EnergyQueryContextRequestDto {
  return {
    projectId,
    scopeId: view.scopeId?.trim() || "project",
    resource: view.resource ?? "electricity",
    analysisWindow: "current-overview-28d",
    ...(view.currentOverviewPin ? {
      from: view.currentOverviewPin.from,
      to: view.currentOverviewPin.to,
      expectedDataSnapshotId: view.currentOverviewPin.dataSnapshotId,
      expectedProjectReleaseId: view.currentOverviewPin.projectReleaseId,
    } : {}),
  };
}

export function overviewViewStateFromSearchParams(searchParams: Pick<URLSearchParams, "get">): OverviewUrlViewState {
  const requestedPeriod = searchParams.get("period");
  const period = requestedPeriod === "Yesterday"
    || requestedPeriod === "Previous week"
    || requestedPeriod === "Previous month"
    || requestedPeriod === "Custom"
    ? requestedPeriod
    : "Last 7 days";
  const from = period === "Custom" ? searchParams.get("from") ?? "" : "";
  const to = period === "Custom" ? searchParams.get("to") ?? "" : "";
  const requestedGrain = searchParams.get("grain");
  const grain = requestedGrain === "hour" && isHourGrainCompatible(period, from, to)
    ? "hour"
    : "day";
  const requestedComparison = searchParams.get("comparison");
  const comparison = requestedComparison === "selected" || requestedComparison === "average"
    ? requestedComparison
    : "overlay";
  const requestedCategory = searchParams.get("category");
  const category = requestedCategory === "load" || requestedCategory === "light"
    ? requestedCategory
    : "all";
  const pinFrom = searchParams.get("currentFrom")?.trim() || "";
  const pinTo = searchParams.get("currentTo")?.trim() || "";
  const pinDataSnapshotId = searchParams.get("currentDataSnapshotId")?.trim() || "";
  const pinProjectReleaseId = searchParams.get("currentProjectReleaseId")?.trim() || "";
  const currentOverviewPin = pinFrom && pinTo && pinDataSnapshotId && pinProjectReleaseId
    ? {
        from: pinFrom,
        to: pinTo,
        dataSnapshotId: pinDataSnapshotId,
        projectReleaseId: pinProjectReleaseId,
      }
    : undefined;
  return {
    projectId: searchParams.get("projectId")?.trim() || "",
    scopeId: searchParams.get("scopeId")?.trim() || "project",
    resource: searchParams.get("resource") === "water" ? "water" : "electricity",
    period,
    from,
    to,
    grain,
    comparison,
    category,
    ...(currentOverviewPin ? { currentOverviewPin } : {}),
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

export function overviewUrlWithView(
  view: OverviewUrlViewState,
): string {
  const next = new URLSearchParams();
  if (view.projectId) next.set("projectId", view.projectId);
  else next.delete("projectId");
  next.set("scopeId", view.scopeId || "project");
  next.set("resource", view.resource);
  next.set("period", view.period);
  if (view.period === "Custom") {
    next.set("from", view.from);
    next.set("to", view.to);
  } else {
    // Non-Custom Periods have no persisted date range.
  }
  next.set("grain", isHourGrainCompatible(view.period, view.from, view.to) ? view.grain : "day");
  next.set("comparison", view.comparison);
  next.set("category", view.category);
  return `/energyiq/overview?${next.toString()}`;
}

export function currentOverviewUrlWithView(view: OverviewUrlViewState): string {
  const next = new URLSearchParams();
  if (view.projectId) next.set("projectId", view.projectId);
  next.set("scopeId", view.scopeId || "project");
  next.set("resource", view.resource);
  next.set("grain", "day");
  next.set("comparison", view.comparison);
  next.set("category", view.category);
  if (view.currentOverviewPin) {
    next.set("currentFrom", view.currentOverviewPin.from);
    next.set("currentTo", view.currentOverviewPin.to);
    next.set("currentDataSnapshotId", view.currentOverviewPin.dataSnapshotId);
    next.set("currentProjectReleaseId", view.currentOverviewPin.projectReleaseId);
  }
  return `/energyiq/overview?${next.toString()}`;
}

function isHourGrainCompatible(period: OverviewPeriod, from: string, to: string): boolean {
  return period === "Yesterday" || (period === "Custom" && Boolean(from) && from === to);
}

function overviewHandoffHref(
  pathname: "/energyiq/explorer" | "/energyiq/ai",
  view: OverviewUrlViewState,
): string {
  const handoff = overviewUrlWithView(view).replace("/energyiq/overview", pathname);
  if (pathname !== "/energyiq/explorer" || !view.currentOverviewPin) return handoff;
  const [path, query = ""] = handoff.split("?");
  const next = new URLSearchParams(query);
  next.set("dataSnapshotId", view.currentOverviewPin.dataSnapshotId);
  next.set("projectReleaseId", view.currentOverviewPin.projectReleaseId);
  return `${path}?${next.toString()}`;
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

function snapshotLocalDateRange(snapshot: EnergyProjectAnalysisSnapshotDto): { from: string; to: string } {
  return {
    from: toDateInput(snapshot.context.from, snapshot.context.timezone),
    to: toDateInput(
      new Date(Date.parse(snapshot.context.to) - 1).toISOString(),
      snapshot.context.timezone,
    ),
  };
}

function formatAnalysisWindow(snapshot: EnergyProjectAnalysisSnapshotDto): string {
  const formatter = new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: snapshot.context.timezone,
  });
  const from = formatter.format(new Date(snapshot.context.from));
  const to = formatter.format(new Date(Date.parse(snapshot.context.to) - 1));
  return `${from}–${to}`;
}

function formatDataThrough(snapshot: EnergyProjectAnalysisSnapshotDto): string {
  return new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: snapshot.context.timezone,
  }).format(new Date(Date.parse(snapshot.context.to) - 1));
}

function sectionDomId(sectionId: string): string {
  return `customer-overview-${sectionId}`;
}

function messageFrom(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}
