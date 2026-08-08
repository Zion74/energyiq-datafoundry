"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { EnergyIcon, type EnergyIconName } from "./icons";
import { useEnergyIqAccess } from "./energyiq-access";
import { orderProjectNodesDepthFirst, revealProjectTreeSelection } from "./project-tree-model";
import {
  configApi,
  type EnergyProjectNodeDto,
  type EnergyScopeAnalysisDto,
} from "../../../lib/config-api";

type ProjectNode = {
  id: string;
  parentId: string | null;
  type: "project" | "block" | "level" | "centre" | "meter" | "circuit";
  name: string;
  role?: "total" | "submeter" | "virtual";
  category?: "Light" | "Load" | "Aircon";
};

type ExplorerPeriod = "Yesterday" | "Last 7 days" | "Previous week" | "Previous month" | "Custom";
type ExplorerChartView = "daily" | "weekly" | "monthly" | "hourly";

export type ExplorerUrlViewState = {
  projectId: string;
  scopeId: string;
  resource: "electricity" | "water";
  period: ExplorerPeriod;
  from: string;
  to: string;
  dataSnapshotId: string;
  projectReleaseId: string;
  chartView: ExplorerChartView;
};

const explorerPeriodOptions: ReadonlyArray<{
  label: string;
  value?: ExplorerPeriod;
  disabled?: boolean;
  title?: string;
}> = [
  { label: "Yesterday", value: "Yesterday" },
  { label: "Last 7 days", value: "Last 7 days" },
  { label: "Previous week", value: "Previous week" },
  { label: "Previous month", value: "Previous month" },
  { label: "Custom", value: "Custom" },
];

const typeIcon: Record<ProjectNode["type"], EnergyIconName> = {
  project: "building",
  block: "building",
  level: "floor",
  centre: "building",
  meter: "meter",
  circuit: "meter",
};

export function ProjectExplorer() {
  const searchParams = useSearchParams();
  const initialViewState = explorerViewStateFromSearchParams(searchParams);
  const viewStateKey = [
    initialViewState.projectId,
    initialViewState.scopeId,
    initialViewState.resource,
    initialViewState.period,
    initialViewState.from,
    initialViewState.to,
    initialViewState.dataSnapshotId,
    initialViewState.projectReleaseId,
    initialViewState.chartView,
  ].join(":");
  return <ProjectExplorerView key={viewStateKey} initialViewState={initialViewState} />;
}

function ProjectExplorerView({ initialViewState }: { initialViewState: ExplorerUrlViewState }) {
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
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [resource, setResource] = useState<"electricity" | "water">(initialViewState.resource);
  const [hierarchyNodes, setHierarchyNodes] = useState<ProjectNode[] | null>(null);
  const [hierarchyError, setHierarchyError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<EnergyScopeAnalysisDto | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [periodSelection, setPeriodSelection] = useState<ExplorerPeriod>(initialViewState.period);
  const [chartView, setChartView] = useState<ExplorerChartView>(initialViewState.chartView);
  const [customRange, setCustomRange] = useState({
    projectId: initialViewState.projectId,
    from: initialViewState.from,
    to: initialViewState.to,
  });
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const activeProjectId = selectedProject?.id;

  useEffect(() => {
    if (!requestedProject || requestedProject.id === activeProject?.id) return;
    selectProject(requestedProject.id);
  }, [activeProject?.id, requestedProject, selectProject]);

  useEffect(() => {
    if (
      !activeProjectId
      || periodSelection !== "Custom"
      || customRange.projectId
      || !initialViewState.from
      || !initialViewState.to
    ) return;
    setCustomRange({
      projectId: activeProjectId,
      from: initialViewState.from,
      to: initialViewState.to,
    });
  }, [activeProjectId, customRange.projectId, initialViewState.from, initialViewState.to, periodSelection]);

  useEffect(() => {
    if (!activeProjectId) return;
    let cancelled = false;
    setHierarchyError(null);
    void configApi.getEnergyProjectHierarchy(activeProjectId)
      .then((hierarchy) => {
        if (cancelled) return;
        const mapped = hierarchy.nodes.map((node) =>
          mapHierarchyNode(node),
        );
        const selection = revealProjectTreeSelection(
          mapped,
          defaultExpandedIds(mapped),
          requestedScopeId(mapped, initialViewState.scopeId),
        );
        setHierarchyNodes(mapped);
        setSelectedId(selection.selectedId);
        setExpandedIds(selection.expandedIds);
      })
      .catch((reason) => {
        if (cancelled) return;
        setHierarchyNodes(null);
        setHierarchyError(
          reason instanceof Error ? reason.message : "Unable to load project hierarchy",
        );
        setSelectedId("");
      });
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, initialViewState.scopeId]);

  useEffect(() => {
    if (!activeProjectId || !selectedId || resource !== "electricity") {
      setAnalysis(null);
      setAnalysisError(null);
      return;
    }
    let cancelled = false;
    const range = customRange.projectId === activeProjectId
      ? customRange
      : { projectId: activeProjectId, from: "", to: "" };
    if (periodSelection === "Custom" && (!range.from || !range.to)) {
      setAnalysis(null);
      setAnalysisError(null);
      return;
    }
    setAnalysisLoading(true);
    setAnalysisError(null);
    void configApi.executeEnergyScopeAnalysis(buildExplorerAnalysisRequest({
      projectId: activeProjectId,
      scopeId: selectedId,
      resource,
      period: periodSelection,
      from: periodSelection === "Custom" ? range.from : "",
      to: periodSelection === "Custom" ? range.to : "",
      dataSnapshotId: initialViewState.dataSnapshotId,
      projectReleaseId: initialViewState.projectReleaseId,
    })).then((result) => {
      if (cancelled) return;
      setAnalysis(result);
      setCustomRange((current) => current.projectId === activeProjectId && current.from && current.to
        ? current
        : {
          projectId: activeProjectId,
          from: formatDateInput(result.context.from, result.context.timezone),
          to: formatDateInput(new Date(Date.parse(result.context.to) - 1).toISOString(), result.context.timezone),
        });
    }).catch((reason) => {
      if (cancelled) return;
      setAnalysis(null);
      setAnalysisError(reason instanceof Error ? reason.message : "Unable to load scope analysis");
    }).finally(() => {
      if (!cancelled) setAnalysisLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [
    activeProjectId,
    customRange.from,
    customRange.projectId,
    customRange.to,
    initialViewState.dataSnapshotId,
    initialViewState.projectReleaseId,
    periodSelection,
    resource,
    selectedId,
  ]);

  const projectNodes = hierarchyNodes ?? [];
  const selected = projectNodes.find((node) => node.id === selectedId)
    ?? projectNodes[0]
    ?? { id: "", parentId: null, type: "project", name: selectedProject?.name ?? "Loading project" };
  const directMeters = projectNodes.filter(
    (node) => node.parentId === selected.id && isMeterNode(node),
  );
  const explorerMetricsPending = analysisLoading || !analysis;
  const selectedPeriodHasFacts = hasExplorerFacts(analysis);
  const pinnedContextMismatch = isExplorerPinnedContextMismatch(analysisError);
  const currentFactsHref = explorerCurrentFactsUrl({
    projectId: activeProjectId ?? initialViewState.projectId,
    scopeId: selectedId || initialViewState.scopeId,
    resource,
    period: periodSelection,
    from: periodSelection === "Custom" && customRange.projectId === activeProjectId ? customRange.from : "",
    to: periodSelection === "Custom" && customRange.projectId === activeProjectId ? customRange.to : "",
    dataSnapshotId: initialViewState.dataSnapshotId,
    projectReleaseId: initialViewState.projectReleaseId,
    chartView,
  });
  const analysisCircuitById = new Map(
    (analysis?.circuits ?? []).map((circuit) => [circuit.meterNodeId, circuit]),
  );
  const breadcrumbs = buildBreadcrumbs(selected, projectNodes);
  const filteredNodes = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    if (!normalized) return projectNodes;
    const matchingIds = new Set(
      projectNodes
        .filter((node) => node.name.toLowerCase().includes(normalized))
        .map((node) => node.id),
    );
    for (const node of projectNodes) {
      if (!matchingIds.has(node.id)) continue;
      let parent = projectNodes.find((candidate) => candidate.id === node.parentId);
      while (parent) {
        matchingIds.add(parent.id);
        parent = projectNodes.find((candidate) => candidate.id === parent?.parentId);
      }
    }
    return projectNodes.filter((node) => matchingIds.has(node.id));
  }, [projectNodes, search]);
  const revealNodeSelection = (nodeId: string) => {
    setSelectedId(nodeId);
    setExpandedIds((current) => {
      return revealProjectTreeSelection(projectNodes, current, nodeId).expandedIds;
    });
  };
  const handleTreeNodeSelect = (nodeId: string) => {
    setSelectedId(nodeId);
    setExpandedIds((current) => {
      const next = revealProjectTreeSelection(projectNodes, current, nodeId).expandedIds;
      if (!projectNodes.some((node) => node.parentId === nodeId)) return next;
      if (current.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const selectedValue = selectedPeriodHasFacts ? analysis?.summary.usageKwh ?? null : null;
  const latestReadingPresentation = analysis
    ? explorerLatestReadingPresentation(analysis.latestAcceptedReading, analysis.context.timezone)
    : null;
  const hourlyTrend = useMemo(
    () => (analysis?.hourlyProfile ?? []).map((point) => ({
      time: `${String(point.hour).padStart(2, "0")}:00`,
      averagePowerKw: point.averageKw,
    })),
    [analysis],
  );
  const dailyTrend = useMemo(() => explorerTrendSeries(analysis, "daily"), [analysis]);
  const weeklyTrend = useMemo(() => explorerTrendSeries(analysis, "weekly"), [analysis]);
  const monthlyTrend = useMemo(() => explorerTrendSeries(analysis, "monthly"), [analysis]);
  const childScopeHealth = useMemo(() => explorerChildScopeHealth(analysis), [analysis]);
  const requestedEnergyTrend = chartView === "weekly"
    ? weeklyTrend
    : chartView === "monthly"
      ? monthlyTrend
      : dailyTrend;
  const selectedChartView = chartView === "hourly"
    ? "hourly"
    : requestedEnergyTrend.length > 0
      ? chartView
      : dailyTrend.length > 1
        ? "daily"
        : "hourly";
  const selectedEnergyTrend = selectedChartView === "weekly"
    ? weeklyTrend
    : selectedChartView === "monthly"
      ? monthlyTrend
      : dailyTrend;
  const showLatestAvailable = () => {
    const latest = analysis?.latestAvailablePeriod;
    if (!activeProjectId || !latest) return;
    setCustomRange({
      projectId: activeProjectId,
      from: latest.from,
      to: latest.to,
    });
    setPeriodSelection("Custom");
  };

  useEffect(() => {
    if (!activeProjectId || !selectedId) return;
    const range = customRange.projectId === activeProjectId
      ? customRange
      : { from: "", to: "" };
    const nextUrl = explorerUrlWithView({
      projectId: activeProjectId,
      scopeId: selectedId,
      resource,
      period: periodSelection,
      from: periodSelection === "Custom" ? range.from : "",
      to: periodSelection === "Custom" ? range.to : "",
      dataSnapshotId: initialViewState.dataSnapshotId,
      projectReleaseId: initialViewState.projectReleaseId,
      chartView,
    });
    if (`${window.location.pathname}${window.location.search}` === nextUrl) return;
    window.history.replaceState(window.history.state, "", nextUrl);
  }, [
    activeProjectId,
    chartView,
    customRange,
    initialViewState.dataSnapshotId,
    initialViewState.projectReleaseId,
    periodSelection,
    resource,
    selectedId,
  ]);

  return (
    <div className="mx-auto grid min-h-[calc(100vh-56px)] w-full max-w-[1680px] lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="max-h-[420px] overflow-y-auto border-b border-border bg-surface lg:max-h-none lg:overflow-visible lg:border-b-0 lg:border-r">
        <div className="sticky top-0 max-h-[calc(100vh-56px)] overflow-y-auto p-4">
          <div>
            <h1 className="text-sm font-semibold text-foreground">Project Explorer</h1>
          </div>

          {projectSelectionError ? (
            <p role="alert" className="mt-4 rounded-lg border border-step-warning/25 bg-step-warning/5 p-3 text-xs leading-5 text-step-warning">
              {projectSelectionError}
            </p>
          ) : null}

          <div className="mt-4 flex rounded-lg border border-border bg-surface-subtle p-1">
            <button
              type="button"
              onClick={() => setResource("electricity")}
              className={[
                "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors",
                resource === "electricity" ? "bg-surface text-foreground shadow-sm" : "text-muted",
              ].join(" ")}
            >
              <EnergyIcon name="bolt" className="h-3.5 w-3.5" />
              Electricity
            </button>
            <button
              type="button"
              onClick={() => setResource("water")}
              className={[
                "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors",
                resource === "water" ? "bg-surface text-foreground shadow-sm" : "text-muted",
              ].join(" ")}
            >
              <EnergyIcon name="water" className="h-3.5 w-3.5" />
              Water
            </button>
          </div>

          <label className="relative mt-4 block">
            <span className="sr-only">Search project structure</span>
            <EnergyIcon
              name="search"
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-light"
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search structure or meter"
              className="h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-xs text-foreground outline-none transition-colors placeholder:text-muted-light focus:border-muted-light focus:ring-2 focus:ring-primary/10"
            />
          </label>

          {resource === "water" ? (
            <div className="mt-4 rounded-lg border border-dashed border-border bg-surface-subtle p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <EnergyIcon name="water" className="h-4 w-4 text-step-inspect" />
                Water structure reserved
              </div>
              <p className="mt-2 text-xs leading-5 text-muted">
                This project has no published water meter mapping yet. The same project tree will appear here after configuration.
              </p>
            </div>
          ) : (
            <>
              {hierarchyError ? (
                <p className="mt-3 rounded-lg border border-step-warning/25 bg-step-warning/5 p-3 text-xs leading-5 text-step-warning">
                  {hierarchyError}
                </p>
              ) : null}
              <div className="mt-4 flex items-center justify-between gap-3">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-light">
                  Hierarchy
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="Expand all hierarchy nodes"
                    onClick={() => setExpandedIds(new Set(
                      projectNodes
                        .filter((node) => projectNodes.some((candidate) => candidate.parentId === node.id))
                        .map((node) => node.id),
                    ))}
                    className="rounded-md px-2 py-1 text-[10px] font-semibold text-muted transition-colors hover:bg-surface-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                  >
                    Expand all
                  </button>
                  <span className="text-border">/</span>
                  <button
                    type="button"
                    aria-label="Collapse all hierarchy nodes"
                    onClick={() => setExpandedIds(new Set())}
                    className="rounded-md px-2 py-1 text-[10px] font-semibold text-muted transition-colors hover:bg-surface-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                  >
                    Collapse all
                  </button>
                </div>
              </div>
              <div className="mt-2" role="tree" aria-label="Project structure">
                <ProjectTree
                  allNodes={projectNodes}
                  nodes={filteredNodes}
                  selectedId={selectedId}
                  expandedIds={expandedIds}
                  searchActive={search.trim().length > 0}
                  onSelect={handleTreeNodeSelect}
                />
              </div>
            </>
          )}
        </div>
      </aside>

      <section className="min-w-0 px-4 py-6 lg:px-8 lg:py-8">
        {resource === "water" ? (
          <div className="grid min-h-[520px] place-items-center rounded-xl border border-dashed border-border bg-surface">
            <div className="max-w-md px-6 text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-step-inspect/10 text-step-inspect">
                <EnergyIcon name="water" className="h-5 w-5" />
              </span>
              <h2 className="mt-4 text-base font-semibold text-foreground">Water analysis is ready to configure</h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                Bind physical or virtual water meters to any project node. Water volume and continuous-flow rules will reuse the same drill-down structure.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                {breadcrumbs.length > 1 ? (
                  <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-light">
                    {breadcrumbs.map((node, index) => (
                      <span key={node.id} className="flex items-center gap-1">
                        {index > 0 ? <EnergyIcon name="chevron" className="h-3 w-3" /> : null}
                        <button
                          type="button"
                          onClick={() => revealNodeSelection(node.id)}
                          className="hover:text-foreground hover:underline"
                        >
                          {node.name}
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="mt-2 flex items-center gap-2">
                  <h1 className="text-2xl font-semibold tracking-tight text-foreground">{selected.name}</h1>
                  <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">
                    {selected.type}
                  </span>
                  {selected.role ? (
                    <span className="rounded-full border border-step-inspect/25 bg-step-inspect/10 px-2 py-0.5 text-[10px] font-semibold text-step-inspect">
                      {selected.role}
                    </span>
                  ) : null}
                </div>
                {isMeterNode(selected) ? (
                  <p className="mt-1.5 text-sm text-muted">
                    {selected.category ?? "Electricity"} {selected.type} · source interval readings
                  </p>
                ) : null}
              </div>

              <div className="flex max-w-full overflow-x-auto rounded-lg border border-border bg-surface p-1" aria-label="Explorer period">
                {explorerPeriodOptions.map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    onClick={() => option.value ? setPeriodSelection(option.value) : undefined}
                    disabled={option.disabled}
                    title={option.title}
                    className={[
                      "h-8 whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-colors",
                      option.value && periodSelection === option.value ? "bg-surface-subtle text-foreground shadow-sm" : "text-muted hover:text-foreground",
                      option.disabled ? "cursor-not-allowed opacity-45 hover:text-muted" : "",
                    ].join(" ")}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {periodSelection === "Custom" ? (
              <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface px-4 py-3">
                <ExplorerDateField label="From" value={customRange.projectId === activeProjectId ? customRange.from : ""} onChange={(from) => setCustomRange((current) => ({ ...current, projectId: activeProjectId ?? "", from }))} />
                <ExplorerDateField label="To, inclusive" value={customRange.projectId === activeProjectId ? customRange.to : ""} onChange={(to) => setCustomRange((current) => ({ ...current, projectId: activeProjectId ?? "", to }))} />
                <p className="pb-2 text-[10px] text-muted-light">The hierarchy stays fixed while the selected-period facts are re-queried.</p>
              </div>
            ) : null}

            {pinnedContextMismatch ? (
              <div role="alert" className="mt-4 flex flex-col gap-3 rounded-xl border border-step-warning/25 bg-step-warning/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">This Explorer link is outdated</p>
                  <p className="mt-1 text-sm leading-5 text-muted">
                    Its pinned Snapshot or Project Release no longer matches the published data. No current facts were mixed into this view.
                  </p>
                </div>
                <Link
                  href={currentFactsHref}
                  className="inline-flex shrink-0 items-center justify-center rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                >
                  Open current Project data
                </Link>
              </div>
            ) : analysisError ? (
              <p className="mt-4 rounded-lg border border-step-warning/25 bg-step-warning/5 p-3 text-xs leading-5 text-step-warning">
                Scope analysis unavailable: {analysisError}
              </p>
            ) : null}

            {analysis && !selectedPeriodHasFacts ? (
              <div role="status" className="mt-4 flex flex-col gap-3 rounded-xl border border-step-warning/25 bg-step-warning/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">No energy facts in this period</p>
                  <p className="mt-1 text-sm leading-5 text-muted">
                    This Scope has no accepted intervals between {formatExplorerDate(analysis.context.from, analysis.context.timezone)} and {formatExplorerDate(new Date(Date.parse(analysis.context.to) - 1).toISOString(), analysis.context.timezone)}. Zero consumption is not assumed.
                  </p>
                </div>
                {analysis.latestAvailablePeriod ? (
                  <button
                    type="button"
                    onClick={showLatestAvailable}
                    className="shrink-0 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  >
                    View latest available data
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="mt-6 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 xl:grid-cols-5">
              {explorerMetricsPending ? (
                <>
                  <MetricCell
                    label="Period consumption"
                    value={analysisLoading ? "Loading facts…" : "No validated data"}
                    note="Resolved from the trusted project, scope and period"
                  />
                  <MetricCell
                    label="Latest cumulative reading"
                    value="—"
                    note="Waiting for the Meter Data Health contract"
                  />
                  <MetricCell
                    label="Average power"
                    value="—"
                    note="Hourly interval-average power loads below"
                  />
                  <MetricCell
                    label="Source"
                    value="—"
                    note="Waiting for trusted analysis provenance"
                  />
                  <MetricCell
                    label="Data health"
                    value="—"
                    note="Waiting for deterministic analysis"
                  />
                </>
              ) : (
                <>
                  <MetricCell
                    label="Period consumption"
                    value={selectedValue === null ? "No data" : `${selectedValue.toLocaleString(undefined, { maximumFractionDigits: 2 })} kWh`}
                    note={selectedValue === null ? "No accepted interval facts in this period" : `${analysis!.context.scopeName} · selected period`}
                    tone={selectedValue === null ? "warning" : "muted"}
                  />
                  <MetricCell
                    label="Latest cumulative reading"
                    value={latestReadingPresentation!.value}
                    note={latestReadingPresentation!.note}
                    tone={latestReadingPresentation!.tone}
                  />
                  <MetricCell
                    label="Average power"
                    value={selectedPeriodHasFacts ? "24h profile" : "No data"}
                    note={selectedPeriodHasFacts ? `${analysis!.hourlyProfile.length} server-provided hourly averages` : "No accepted intervals to profile"}
                    tone={selectedPeriodHasFacts ? "muted" : "warning"}
                  />
                  <MetricCell
                    label="Source"
                    value="Canonical facts"
                    note={`Snapshot ${compactEvidenceId(analysis!.provenance.dataSnapshotId)}`}
                  />
                  <MetricCell
                    label="Data health"
                    value={analysis!.dataHealth.status === "complete" ? "Complete" : analysis!.dataHealth.status === "partial" ? "Review" : "Unavailable"}
                    note={`${analysis!.dataHealth.coveragePct.toFixed(1)}% coverage · ${analysis!.dataHealth.qualityEventCount} flagged`}
                    tone={analysis!.dataHealth.status === "complete" ? "success" : "warning"}
                  />
                </>
              )}
            </div>

            <div className="mt-7 grid gap-6 xl:grid-cols-[1.4fr_0.8fr]">
              <div>
                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">
                      {explorerChartTitle(selectedChartView)}
                    </h2>
                    {explorerChartDescription(selectedChartView) ? (
                      <p className="mt-1 text-xs text-muted-light">
                        {explorerChartDescription(selectedChartView)}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-3">
                    {dailyTrend.length > 1 || weeklyTrend.length > 0 || monthlyTrend.length > 0 ? (
                      <div className="flex flex-wrap rounded-lg border border-border bg-surface p-1" aria-label="Explorer chart view">
                        <button
                          type="button"
                          aria-pressed={selectedChartView === "daily"}
                          onClick={() => setChartView("daily")}
                          className={[
                            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                            selectedChartView === "daily" ? "bg-surface-subtle text-foreground" : "text-muted hover:text-foreground",
                          ].join(" ")}
                        >
                          Daily trend
                        </button>
                        {weeklyTrend.length > 0 ? (
                          <button
                            type="button"
                            aria-pressed={selectedChartView === "weekly"}
                            onClick={() => setChartView("weekly")}
                            className={[
                              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                              selectedChartView === "weekly" ? "bg-surface-subtle text-foreground" : "text-muted hover:text-foreground",
                            ].join(" ")}
                          >
                            Week
                          </button>
                        ) : null}
                        {monthlyTrend.length > 0 ? (
                          <button
                            type="button"
                            aria-pressed={selectedChartView === "monthly"}
                            onClick={() => setChartView("monthly")}
                            className={[
                              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                              selectedChartView === "monthly" ? "bg-surface-subtle text-foreground" : "text-muted hover:text-foreground",
                            ].join(" ")}
                          >
                            Month
                          </button>
                        ) : null}
                        <button
                          type="button"
                          aria-pressed={selectedChartView === "hourly"}
                          onClick={() => setChartView("hourly")}
                          className={[
                            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                            selectedChartView === "hourly" ? "bg-surface-subtle text-foreground" : "text-muted hover:text-foreground",
                          ].join(" ")}
                        >
                          24h profile
                        </button>
                      </div>
                    ) : null}
                    <span className="text-xs text-muted-light">
                      {selectedChartView === "hourly" ? "Average power · kW" : "Energy · kWh"}
                    </span>
                  </div>
                </div>
                <div className="h-[300px] rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
                  {explorerMetricsPending || !selectedPeriodHasFacts ? (
                    <div className="grid h-full place-items-center text-center">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {analysisLoading ? "Loading trusted interval facts" : analysisError ? "Trusted interval facts are unavailable" : "No accepted intervals in this period"}
                        </p>
                        <p className="mt-1 max-w-sm text-xs leading-5 text-muted">
                          {analysisError
                            ? "Resolve the Data Foundation error shown above, then retry this exact Scope and period."
                            : analysis?.latestAvailablePeriod
                              ? "Use View latest available data above to inspect the most recent complete window."
                              : "Choose another period or check the selected Scope's data status."}
                        </p>
                      </div>
                    </div>
                  ) : selectedChartView !== "hourly" ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={selectedEnergyTrend} margin={{ top: 8, right: 12, left: -8, bottom: 8 }}>
                        <defs>
                          <linearGradient id="explorer-daily-fill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#3f827f" stopOpacity={0.22} />
                            <stop offset="100%" stopColor="#3f827f" stopOpacity={0.03} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="#ececf0" strokeDasharray="3 4" vertical={false} />
                        <XAxis
                          dataKey="date"
                          axisLine={false}
                          tickLine={false}
                          minTickGap={24}
                          tick={{ fontSize: 11, fill: "#6f6f7b" }}
                          tickFormatter={formatExplorerTrendDate}
                        />
                        <YAxis axisLine={false} tickLine={false} width={48} tick={{ fontSize: 11, fill: "#6f6f7b" }} />
                        <Tooltip
                          contentStyle={{
                            border: "1px solid #ececf0",
                            borderRadius: 8,
                            boxShadow: "0 8px 24px rgba(13,13,13,.08)",
                            fontSize: 12,
                          }}
                          labelFormatter={(label) => formatExplorerTrendTooltipLabel(String(label), selectedChartView)}
                          formatter={(value) => [value === null ? "No accepted facts" : `${Number(value).toFixed(2)} kWh`, explorerChartSeriesLabel(selectedChartView)]}
                        />
                        <Area
                          type="monotone"
                          dataKey="usageKwh"
                          stroke="#3f827f"
                          strokeWidth={2}
                          fill="url(#explorer-daily-fill)"
                          dot={{ r: 2.5, fill: "#3f827f", strokeWidth: 0 }}
                          activeDot={{ r: 4 }}
                          connectNulls={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={hourlyTrend} margin={{ top: 8, right: 12, left: -8, bottom: 8 }}>
                        <defs>
                          <linearGradient id="explorer-fill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#3f827f" stopOpacity={0.2} />
                            <stop offset="100%" stopColor="#3f827f" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="#ececf0" strokeDasharray="3 4" vertical={false} />
                        <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#6f6f7b" }} />
                        <YAxis axisLine={false} tickLine={false} width={48} tick={{ fontSize: 11, fill: "#6f6f7b" }} />
                        <Tooltip
                          contentStyle={{
                            border: "1px solid #ececf0",
                            borderRadius: 8,
                            boxShadow: "0 8px 24px rgba(13,13,13,.08)",
                            fontSize: 12,
                          }}
                          formatter={(value) => [`${Number(value).toFixed(1)} kW`, "Hourly average"]}
                        />
                        <Area
                          type="monotone"
                          dataKey="averagePowerKw"
                          stroke="#3f827f"
                          strokeWidth={2}
                          fill="url(#explorer-fill)"
                          dot={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              <div>
                <div className="mb-3">
                  <h2 className="text-sm font-semibold text-foreground">Source & Data Health</h2>
                </div>
                <div className="rounded-xl border border-border bg-surface p-5 shadow-[var(--shadow-card)]">
                  {explorerMetricsPending ? (
                    <p className="text-xs leading-5 text-muted">
                      {analysisLoading
                        ? "Loading the selected Scope, Data Snapshot and source query versions."
                        : analysisError
                          ? "Source evidence is withheld because the trusted analysis request failed."
                          : "No source evidence was returned for this selection."}
                    </p>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {analysis!.dataHealth.status === "complete"
                              ? "Data is complete for this period"
                              : analysis!.dataHealth.status === "partial"
                                ? "Some expected intervals need review"
                                : "No accepted intervals in this period"}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-muted">
                            {analysis!.dataHealth.coveragePct.toFixed(1)}% coverage · {analysis!.dataHealth.qualityEventCount.toLocaleString()} quality events
                          </p>
                        </div>
                        <span className={[
                          "rounded-full px-2.5 py-1 text-xs font-semibold",
                          analysis!.dataHealth.status === "complete"
                            ? "bg-step-success/10 text-step-success"
                            : "bg-step-warning/10 text-step-warning",
                        ].join(" ")}
                        >
                          {analysis!.dataHealth.status === "complete" ? "Validated" : analysis!.dataHealth.status === "partial" ? "Review" : "Unavailable"}
                        </span>
                      </div>
                      <p className="mt-4 text-xs leading-5 text-muted">
                        Last accepted interval: {analysis!.dataHealth.lastSeenAt
                          ? formatExplorerTimestamp(analysis!.dataHealth.lastSeenAt, analysis!.context.timezone)
                          : "Not provided by the current fact response"}
                      </p>
                      <details className="mt-4 border-t border-border pt-3">
                        <summary className="cursor-pointer text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
                          Technical provenance
                        </summary>
                        <dl className="mt-3 space-y-3 text-xs">
                          <EvidenceRow label="Source view" value={analysis!.provenance.sourceView} />
                          <EvidenceRow label="Data Snapshot" value={analysis!.provenance.dataSnapshotId} />
                          <EvidenceRow label="Hierarchy" value={analysis!.provenance.hierarchyRevisionId} />
                          <EvidenceRow label="Meter formula" value={analysis!.provenance.meterFormulaRevisionId} />
                          <EvidenceRow label="Coverage" value={`${analysis!.dataHealth.coveragePct.toFixed(1)}%`} />
                          <EvidenceRow label="Valid intervals" value={`${analysis!.dataHealth.validIntervalCount.toLocaleString()} / ${analysis!.dataHealth.expectedMeterIntervalCount.toLocaleString()}`} />
                          <EvidenceRow label="Quality events" value={analysis!.dataHealth.qualityEventCount.toLocaleString()} />
                          <EvidenceRow label="Import batches" value={analysis!.dataHealth.importBatchIds.join(", ") || "Not provided"} />
                          {analysis!.latestAcceptedReading.status === "available" ? (
                            <>
                              <EvidenceRow label="Reading source" value={analysis!.latestAcceptedReading.sourceFile} />
                              <EvidenceRow label="Source SHA" value={analysis!.latestAcceptedReading.sourceSha256} />
                              <EvidenceRow label="Reading query" value={analysis!.latestAcceptedReading.queryId} />
                            </>
                          ) : (
                            <EvidenceRow label="Latest reading" value={analysis!.latestAcceptedReading.reason.message} />
                          )}
                        </dl>
                      </details>
                    </>
                  )}
                </div>
              </div>
            </div>

            {childScopeHealth ? (
              <section className="mt-8 rounded-xl border border-border bg-surface p-5 shadow-[var(--shadow-card)]" aria-label="Child Scope health">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">Child Scope health</h2>
                    <p className="mt-1 text-xs leading-5 text-muted">
                      {childScopeHealth.total.toLocaleString()} direct child Scopes checked · {childScopeHealth.needsAttention.toLocaleString()} need attention
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
                    <span className="rounded-full bg-step-success/10 px-2.5 py-1 text-step-success">{childScopeHealth.validated} validated</span>
                    {childScopeHealth.review > 0 ? <span className="rounded-full bg-step-warning/10 px-2.5 py-1 text-step-warning">{childScopeHealth.review} review</span> : null}
                    {childScopeHealth.unavailable > 0 ? <span className="rounded-full bg-muted/10 px-2.5 py-1 text-muted">{childScopeHealth.unavailable} unavailable</span> : null}
                  </div>
                </div>
                {childScopeHealth.attention.length > 0 ? (
                  <div className="mt-4 divide-y divide-border border-t border-border">
                    {childScopeHealth.attention.slice(0, 5).map((scope) => (
                      <button
                        key={scope.nodeId}
                        type="button"
                        onClick={() => revealNodeSelection(scope.nodeId)}
                        className="grid w-full gap-1 py-3 text-left hover:text-primary sm:grid-cols-[minmax(0,1fr)_140px_140px] sm:items-center sm:gap-4"
                      >
                        <span className="truncate text-xs font-semibold text-foreground">{scope.name}</span>
                        <span className="text-xs tabular-nums text-muted">{scope.coveragePct.toFixed(1)}% coverage</span>
                        <span className={scope.status === "unavailable" ? "text-xs font-semibold text-muted" : "text-xs font-semibold text-step-warning"}>
                          {scope.status === "unavailable"
                            ? "No accepted facts"
                            : scope.qualityEventCount > 0
                              ? `${scope.qualityEventCount} quality events`
                              : "Coverage below 95%"}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 border-t border-border pt-3 text-xs leading-5 text-muted">
                    Every direct child Scope has accepted facts with at least 95% coverage and no flagged quality events in this period.
                  </p>
                )}
              </section>
            ) : null}

            <section className="mt-8">
              <div className="mb-3 flex items-end justify-between">
                <h2 className="text-sm font-semibold text-foreground">Meter points attached to {selected.name}</h2>
                <span className="text-[11px] text-muted-light">{directMeters.length} direct meters</span>
              </div>

              {directMeters.length > 0 ? (
                <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-card)]">
                  <div className="hidden grid-cols-[minmax(0,1fr)_100px_110px_100px] gap-4 border-b border-border bg-surface-subtle px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-light md:grid">
                    <span>Meter point</span>
                    <span>Role</span>
                    <span>Period energy</span>
                    <span>Data health</span>
                  </div>
                  {directMeters.map((meter) => {
                    const circuit = analysisCircuitById.get(meter.id);
                    const circuitHasFacts = selectedPeriodHasFacts && Boolean(circuit);
                    const hasQualityIssue = circuitHasFacts && (circuit?.qualityEventCount ?? 0) > 0;
                    return (
                      <button
                      key={meter.id}
                      type="button"
                      onClick={() => revealNodeSelection(meter.id)}
                      className="grid w-full gap-2 border-b border-border px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-surface-subtle md:grid-cols-[minmax(0,1fr)_100px_110px_100px] md:items-center md:gap-4"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-subtle text-muted">
                          <EnergyIcon name="meter" className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-semibold text-foreground">{meter.name}</span>
                          <span className="mt-0.5 block text-[11px] text-muted-light">{meter.category}</span>
                        </span>
                      </span>
                      <span className="w-fit rounded-full border border-border bg-surface-subtle px-2 py-0.5 text-[10px] font-medium text-muted">
                        {meter.role}
                      </span>
                      <span className="tabular text-xs font-medium text-foreground">
                        {circuitHasFacts && circuit ? `${circuit.usageKwh.toFixed(2)} kWh` : analysisLoading ? "Loading…" : "No data"}
                      </span>
                      <span
                        className={[
                          "flex items-center gap-1.5 text-[11px] font-medium",
                          !circuitHasFacts ? "text-muted" : hasQualityIssue ? "text-step-warning" : "text-step-success",
                        ].join(" ")}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        {circuitHasFacts ? (hasQualityIssue ? "review" : "validated") : "not returned"}
                      </span>
                      </button>
                    );
                  })}
                </div>
              ) : isMeterNode(selected) ? (
                <div className="rounded-xl border border-dashed border-border bg-surface p-6 text-center">
                  <p className="text-sm font-medium text-foreground">No child meters are attached</p>
                  <p className="mt-1 text-xs text-muted-light">This is a leaf Meter Point. Its selected-period facts and source evidence are shown above.</p>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border bg-surface p-6 text-center">
                  <p className="text-sm font-medium text-foreground">Meters are attached below this scope</p>
                  <p className="mt-1 text-xs text-muted-light">
                    Select a child node in the hierarchy to inspect its direct Meter Points.
                  </p>
                </div>
              )}
            </section>
          </>
        )}
      </section>
    </div>
  );
}

function ProjectTree({
  allNodes,
  nodes: visibleNodes,
  selectedId,
  expandedIds,
  searchActive,
  onSelect,
}: {
  allNodes: ProjectNode[];
  nodes: ProjectNode[];
  selectedId: string;
  expandedIds: Set<string>;
  searchActive: boolean;
  onSelect: (id: string) => void;
}) {
  const orderedNodes = useMemo(
    () => orderProjectNodesDepthFirst(visibleNodes),
    [visibleNodes],
  );
  const renderedNodes = searchActive
    ? orderedNodes
    : orderedNodes.filter((node) => ancestorsAreExpanded(node, allNodes, expandedIds));

  return (
    <div className="space-y-0.5">
      {renderedNodes
        .map((node) => {
          const depth = getDepth(node, allNodes);
          const selected = selectedId === node.id;
          const hasChildren = allNodes.some((candidate) => candidate.parentId === node.id);
          const expanded = expandedIds.has(node.id);
          return (
            <button
              key={node.id}
              type="button"
              role="treeitem"
              aria-selected={selected}
              onClick={() => onSelect(node.id)}
              style={{ paddingLeft: `${8 + depth * 18}px` }}
              className={[
                "group flex min-h-9 w-full items-center gap-2 rounded-lg pr-2 text-left text-xs transition-colors",
                selected ? "bg-primary text-white" : "text-muted hover:bg-surface-subtle hover:text-foreground",
              ].join(" ")}
            >
              <EnergyIcon
                name="chevron"
                className={[
                  "h-3 w-3 shrink-0 transition-transform",
                  hasChildren ? "" : "invisible",
                  expanded ? "rotate-90" : "",
                  selected ? "text-white" : "text-muted-light",
                ].join(" ")}
              />
              <EnergyIcon
                name={typeIcon[node.type]}
                className={["h-3.5 w-3.5 shrink-0", selected ? "text-white" : "text-muted-light"].join(" ")}
              />
              <span className="min-w-0 flex-1 truncate font-medium">{node.name}</span>
            </button>
          );
        })}
    </div>
  );
}

function getDepth(node: ProjectNode, allNodes: ProjectNode[]): number {
  let depth = 0;
  let parent = allNodes.find((candidate) => candidate.id === node.parentId);
  while (parent) {
    depth += 1;
    parent = allNodes.find((candidate) => candidate.id === parent?.parentId);
  }
  return depth;
}

function buildBreadcrumbs(node: ProjectNode, allNodes: ProjectNode[]): ProjectNode[] {
  const result: ProjectNode[] = [node];
  let parent = allNodes.find((candidate) => candidate.id === node.parentId);
  while (parent) {
    result.unshift(parent);
    parent = allNodes.find((candidate) => candidate.id === parent?.parentId);
  }
  return result;
}

function isMeterNode(node: ProjectNode): boolean {
  return node.type === "meter" || node.type === "circuit";
}

function defaultScopeId(allNodes: ProjectNode[]): string {
  return allNodes.find((node) => node.parentId === null)?.id ?? allNodes[0]?.id ?? "";
}

function requestedScopeId(allNodes: ProjectNode[], scopeId: string): string {
  if (scopeId && scopeId !== "project" && allNodes.some((node) => node.id === scopeId)) {
    return scopeId;
  }
  return defaultScopeId(allNodes);
}

function defaultExpandedIds(allNodes: ProjectNode[]): Set<string> {
  const rootId = allNodes.find((node) => node.parentId === null)?.id;
  return new Set(rootId ? [rootId] : []);
}

function ancestorsAreExpanded(
  node: ProjectNode,
  allNodes: ProjectNode[],
  expandedIds: Set<string>,
): boolean {
  let parent = allNodes.find((candidate) => candidate.id === node.parentId);
  while (parent) {
    if (!expandedIds.has(parent.id)) return false;
    parent = allNodes.find((candidate) => candidate.id === parent?.parentId);
  }
  return true;
}

function mapHierarchyNode(
  node: EnergyProjectNodeDto,
): ProjectNode {
  const metadata = parseHierarchyMetadata(node.metadata_json);
  const nodeType = normalizeNodeType(node.node_type);
  return {
    id: node.id,
    parentId: node.parent_id ?? null,
    type: nodeType,
    name: node.name,
    role: metadata.meterRole,
    category: metadata.category,
  };
}

function ExplorerDateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-[9px] font-semibold uppercase tracking-wide text-muted-light">
      {label}
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 block h-9 rounded-md border border-border bg-surface px-3 text-xs font-medium normal-case text-foreground"
      />
    </label>
  );
}

export function formatDateInput(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(new Date(value));
}

export function explorerViewStateFromSearchParams(
  searchParams: Pick<URLSearchParams, "get">,
): ExplorerUrlViewState {
  const requestedPeriod = searchParams.get("period");
  const period: ExplorerPeriod = requestedPeriod === "Yesterday"
    || requestedPeriod === "Previous week"
    || requestedPeriod === "Previous month"
    || requestedPeriod === "Custom"
    ? requestedPeriod
    : "Last 7 days";
  const requestedFrom = period === "Custom" ? searchParams.get("from") ?? "" : "";
  const requestedTo = period === "Custom" ? searchParams.get("to") ?? "" : "";
  const hasValidCustomRange = period !== "Custom"
    || (validDateInput(requestedFrom) && validDateInput(requestedTo) && requestedFrom <= requestedTo);
  const requestedChartView = searchParams.get("view");
  const chartView: ExplorerChartView = requestedChartView === "weekly"
    || requestedChartView === "monthly"
    || requestedChartView === "hourly"
    ? requestedChartView
    : "daily";
  return {
    projectId: searchParams.get("projectId")?.trim() || "",
    scopeId: searchParams.get("scopeId")?.trim() || "project",
    resource: searchParams.get("resource") === "water" ? "water" : "electricity",
    period,
    from: hasValidCustomRange ? requestedFrom : "",
    to: hasValidCustomRange ? requestedTo : "",
    dataSnapshotId: searchParams.get("dataSnapshotId")?.trim() || "",
    projectReleaseId: searchParams.get("projectReleaseId")?.trim() || "",
    chartView,
  };
}

export function explorerUrlWithView(view: ExplorerUrlViewState): string {
  const next = new URLSearchParams();
  if (view.projectId) next.set("projectId", view.projectId);
  next.set("scopeId", view.scopeId || "project");
  next.set("resource", view.resource);
  next.set("period", view.period);
  if (view.period === "Custom" && view.from && view.to) {
    next.set("from", view.from);
    next.set("to", view.to);
  }
  if (view.dataSnapshotId) next.set("dataSnapshotId", view.dataSnapshotId);
  if (view.projectReleaseId) next.set("projectReleaseId", view.projectReleaseId);
  if (view.chartView !== "daily") next.set("view", view.chartView);
  return `/energyiq/explorer?${next.toString()}`;
}

export function explorerCurrentFactsUrl(view: ExplorerUrlViewState): string {
  return explorerUrlWithView({
    ...view,
    dataSnapshotId: "",
    projectReleaseId: "",
  });
}

export function isExplorerPinnedContextMismatch(message: string | null): boolean {
  if (!message) return false;
  return message.includes("ENERGYIQ_DATA_SNAPSHOT_MISMATCH")
    || message.includes("ENERGYIQ_PROJECT_RELEASE_MISMATCH");
}

export function buildExplorerAnalysisRequest(
  view: Omit<ExplorerUrlViewState, "chartView">,
): Parameters<typeof configApi.executeEnergyScopeAnalysis>[0] {
  return {
    projectId: view.projectId,
    scopeId: view.scopeId || "project",
    resource: view.resource,
    period: view.period,
    ...(view.period === "Custom" && view.from && view.to
      ? { from: view.from, to: view.to }
      : {}),
    ...(view.dataSnapshotId ? { expectedDataSnapshotId: view.dataSnapshotId } : {}),
    ...(view.projectReleaseId ? { expectedProjectReleaseId: view.projectReleaseId } : {}),
  };
}

export function hasExplorerFacts(
  analysis: EnergyScopeAnalysisDto | null,
): boolean {
  return Boolean(analysis && analysis.summary.validIntervalCount > 0);
}

export function explorerTrendSeries(
  analysis: EnergyScopeAnalysisDto | null,
  grain: "daily" | "weekly" | "monthly" = "daily",
): Array<{
  date: string;
  usageKwh: number | null;
  coveragePct: number;
  isPartialCalendarPeriod?: boolean;
}> {
  if (!analysis || !hasExplorerFacts(analysis)) return [];
  if (grain !== "daily") {
    const selectedScope = analysis.calendarTotals?.scopes.find(
      (candidate) => candidate.scopeId === analysis.context.scopeId,
    );
    const rows = grain === "weekly" ? selectedScope?.weeks : selectedScope?.months;
    return (rows ?? []).map((row) => ({
      date: row.localFrom,
      usageKwh: row.usageKwh,
      coveragePct: row.dataHealth.coveragePct,
      isPartialCalendarPeriod: row.isPartialCalendarPeriod,
    }));
  }
  const selectedScope = analysis.dailyTotals?.scopes.find(
    (candidate) => candidate.scopeId === analysis.context.scopeId,
  );
  return (selectedScope?.rows ?? []).map((row) => ({
    date: row.localDate,
    usageKwh: row.usageKwh,
    coveragePct: row.dataHealth.coveragePct,
  }));
}

export type ExplorerChildScopeHealth = {
  total: number;
  validated: number;
  review: number;
  unavailable: number;
  needsAttention: number;
  attention: Array<{
    nodeId: string;
    name: string;
    coveragePct: number;
    qualityEventCount: number;
    status: "review" | "unavailable";
  }>;
};

export function explorerChildScopeHealth(
  analysis: EnergyScopeAnalysisDto | null,
): ExplorerChildScopeHealth | null {
  if (!analysis || analysis.childScopes.length === 0) return null;
  const scopes = analysis.childScopes.map((scope) => {
    const health = scope.dataHealth;
    const unavailable = !health || health.validIntervalCount === 0;
    const review = !unavailable && (health.coveragePct < 95 || health.qualityEventCount > 0);
    return {
      nodeId: scope.nodeId,
      name: scope.name,
      coveragePct: health?.coveragePct ?? 0,
      qualityEventCount: health?.qualityEventCount ?? 0,
      status: unavailable ? "unavailable" as const : review ? "review" as const : "validated" as const,
    };
  });
  const attention = scopes
    .filter((scope): scope is typeof scope & { status: "review" | "unavailable" } => scope.status !== "validated")
    .sort((left, right) => {
      if (left.status !== right.status) return left.status === "unavailable" ? -1 : 1;
      if (left.coveragePct !== right.coveragePct) return left.coveragePct - right.coveragePct;
      return left.name.localeCompare(right.name);
    });
  const unavailable = scopes.filter((scope) => scope.status === "unavailable").length;
  const review = scopes.filter((scope) => scope.status === "review").length;
  return {
    total: scopes.length,
    validated: scopes.length - unavailable - review,
    review,
    unavailable,
    needsAttention: unavailable + review,
    attention,
  };
}

export function explorerLatestReadingPresentation(
  reading: EnergyScopeAnalysisDto["latestAcceptedReading"],
  timeZone: string,
): { value: string; note: string; tone: "muted" | "warning" | "success" } {
  if (reading.status === "available") {
    return {
      value: `${reading.valueKwh.toLocaleString("en-SG", { maximumFractionDigits: 2 })} kWh`,
      note: `${formatExplorerTimestamp(reading.recordedAt, timeZone)} · ${reading.sourceFile}`,
      tone: "success",
    };
  }
  return {
    value: reading.status === "not_applicable" ? "Not applicable" : "Unavailable",
    note: reading.reason.message,
    tone: reading.status === "not_applicable" ? "muted" : "warning",
  };
}

function validDateInput(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeNodeType(value: string): ProjectNode["type"] {
  if (
    value === "project"
    || value === "block"
    || value === "level"
    || value === "centre"
    || value === "meter"
    || value === "circuit"
  ) {
    return value;
  }
  return "level";
}

function parseHierarchyMetadata(value: string | undefined): {
  meterRole?: ProjectNode["role"];
  category?: ProjectNode["category"];
} {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const meterRole = parsed.meterRole;
    const rawCategory = parsed.category;
    const category = typeof rawCategory === "string"
      ? `${rawCategory.slice(0, 1).toUpperCase()}${rawCategory.slice(1).toLowerCase()}`
      : undefined;
    return {
      meterRole:
        meterRole === "total" || meterRole === "submeter" || meterRole === "virtual"
          ? meterRole
          : undefined,
      category:
        category === "Light" || category === "Load" || category === "Aircon"
          ? category
          : undefined,
    };
  } catch {
    return {};
  }
}

function formatExplorerTimestamp(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-SG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(value));
}

function formatExplorerDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-SG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone,
  }).format(new Date(value));
}

function formatExplorerTrendDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", timeZone: "UTC" }).format(parsed);
}

function formatExplorerTrendTooltipDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

function formatExplorerTrendTooltipLabel(value: string, view: ExplorerChartView): string {
  if (view === "weekly") return `Week of ${formatExplorerTrendTooltipDate(value)}`;
  if (view === "monthly") {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.valueOf())) return value;
    return new Intl.DateTimeFormat("en-SG", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(parsed);
  }
  return formatExplorerTrendTooltipDate(value);
}

function explorerChartTitle(view: ExplorerChartView): string {
  if (view === "weekly") return "Calendar-week energy trend";
  if (view === "monthly") return "Calendar-month energy trend";
  if (view === "hourly") return "24-hour operating profile";
  return "Daily energy trend";
}

function explorerChartDescription(view: ExplorerChartView): string | null {
  if (view === "weekly") return "Server-aggregated Monday–Sunday totals; boundary weeks may be partial";
  if (view === "monthly") return "Server-aggregated calendar-month totals; boundary months may be partial";
  return null;
}

function explorerChartSeriesLabel(view: ExplorerChartView): string {
  if (view === "weekly") return "Calendar-week energy";
  if (view === "monthly") return "Calendar-month energy";
  return "Daily energy";
}

function compactEvidenceId(value: string): string {
  return value.length <= 24 ? value : `${value.slice(0, 12)}…${value.slice(-8)}`;
}

function EvidenceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 grid-cols-[100px_minmax(0,1fr)] gap-3">
      <dt className="text-muted-light">{label}</dt>
      <dd className="break-all text-right font-mono text-[11px] leading-4 text-foreground">{value}</dd>
    </div>
  );
}

function MetricCell({
  label,
  value,
  note,
  tone = "muted",
}: {
  label: string;
  value: string;
  note: string;
  tone?: "muted" | "warning" | "success";
}) {
  return (
    <div className="min-w-0 bg-surface px-5 py-4">
      <p className="text-xs font-medium text-muted-light">{label}</p>
      <p className="mt-2 break-words tabular text-lg font-semibold leading-tight tracking-tight text-foreground">{value}</p>
      <p
        className={[
          "mt-1 break-words text-xs leading-4",
          tone === "warning" ? "text-step-warning" : tone === "success" ? "text-step-success" : "text-muted-light",
        ].join(" ")}
      >
        {note}
      </p>
    </div>
  );
}
