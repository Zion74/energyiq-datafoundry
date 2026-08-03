"use client";

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
import { orderProjectNodesDepthFirst } from "./project-tree-model";
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

type ExplorerPeriod = "Yesterday" | "Last 7 days" | "Custom";

const explorerPeriodOptions: readonly Array<{
  label: string;
  value?: ExplorerPeriod;
  disabled?: boolean;
  title?: string;
}> = [
  { label: "Yesterday", value: "Yesterday" },
  { label: "Last 7 days", value: "Last 7 days" },
  { label: "Previous month", disabled: true, title: "Awaiting the trusted calendar-month period contract." },
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
  const { activeProject } = useEnergyIqAccess();
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [resource, setResource] = useState<"electricity" | "water">("electricity");
  const [hierarchyNodes, setHierarchyNodes] = useState<ProjectNode[] | null>(null);
  const [hierarchyError, setHierarchyError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<EnergyScopeAnalysisDto | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [periodSelection, setPeriodSelection] = useState<ExplorerPeriod>("Last 7 days");
  const [customRange, setCustomRange] = useState({ projectId: "", from: "", to: "" });
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const activeProjectId = activeProject?.id;

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
        setHierarchyNodes(mapped);
        setSelectedId(defaultScopeId(mapped));
        setExpandedIds(defaultExpandedIds(mapped));
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
  }, [activeProjectId]);

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
    void configApi.executeEnergyScopeAnalysis({
      projectId: activeProjectId,
      scopeId: selectedId,
      resource,
      period: periodSelection,
      ...(periodSelection === "Custom" ? { from: range.from, to: range.to } : {}),
    }).then((result) => {
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
  }, [activeProjectId, customRange.from, customRange.projectId, customRange.to, periodSelection, resource, selectedId]);

  const projectNodes = hierarchyNodes ?? [];
  const selected = projectNodes.find((node) => node.id === selectedId)
    ?? projectNodes[0]
    ?? { id: "", parentId: null, type: "project", name: activeProject?.name ?? "Loading project" };
  const children = projectNodes.filter((node) => node.parentId === selected.id);
  const directMeters = projectNodes.filter(
    (node) => node.parentId === selected.id && isMeterNode(node),
  );
  const explorerMetricsPending = analysisLoading || !analysis;
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
  const handleNodeSelect = (nodeId: string) => {
    setSelectedId(nodeId);
    if (!projectNodes.some((node) => node.parentId === nodeId)) return;
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const selectedValue = analysis?.summary.usageKwh ?? 0;
  const selectedTrend = (analysis?.hourlyProfile ?? []).map((point) => ({
    time: `${String(point.hour).padStart(2, "0")}:00`,
    averagePowerKw: point.averageKw,
  }));

  return (
    <div className="mx-auto grid min-h-[calc(100vh-56px)] w-full max-w-[1680px] lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="max-h-[420px] overflow-y-auto border-b border-border bg-surface lg:max-h-none lg:overflow-visible lg:border-b-0 lg:border-r">
        <div className="sticky top-[56px] max-h-[calc(100vh-56px)] overflow-y-auto p-4">
          <div>
            <h1 className="text-sm font-semibold text-foreground">Project Explorer</h1>
            <p className="mt-1 text-xs leading-5 text-muted-light">Browse configured project structure and meter evidence.</p>
          </div>

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
                  onSelect={handleNodeSelect}
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
                <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-light">
                  {breadcrumbs.map((node, index) => (
                    <span key={node.id} className="flex items-center gap-1">
                      {index > 0 ? <EnergyIcon name="chevron" className="h-3 w-3" /> : null}
                      <button
                        type="button"
                        onClick={() => setSelectedId(node.id)}
                        className="hover:text-foreground hover:underline"
                      >
                        {node.name}
                      </button>
                    </span>
                  ))}
                </div>
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
                <p className="mt-1.5 text-sm text-muted">
                  {isMeterNode(selected)
                    ? `${selected.category ?? "Electricity"} ${selected.type} · source interval readings`
                    : `${children.length} direct children · ${directMeters.length} metered circuits attached directly to this node`}
                </p>
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

            {analysisError ? (
              <p className="mt-4 rounded-lg border border-step-warning/25 bg-step-warning/5 p-3 text-xs leading-5 text-step-warning">
                Scope analysis unavailable: {analysisError}
              </p>
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
                    value={`${selectedValue.toLocaleString(undefined, { maximumFractionDigits: 2 })} kWh`}
                    note={`${analysis!.context.scopeName} · selected period`}
                  />
                  <MetricCell
                    label="Latest cumulative reading"
                    value="Not provided"
                    note="Requires the latest accepted Raw Reading from Data Foundation"
                  />
                  <MetricCell
                    label="Average power"
                    value="Hourly series"
                    note={`${analysis!.hourlyProfile.length} server-provided hourly averages`}
                  />
                  <MetricCell
                    label="Source"
                    value={analysis!.provenance.sourceView}
                    note={`Snapshot ${analysis!.provenance.dataSnapshotId}`}
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
                <div className="mb-3 flex items-end justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">Hourly operating profile</h2>
                    <p className="mt-1 text-xs text-muted-light">Server-provided interval-average power by hour across the selected period</p>
                  </div>
                  <span className="text-[11px] text-muted-light">Average power · kW</span>
                </div>
                <div className="h-[300px] rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
                  {explorerMetricsPending ? (
                    <div className="grid h-full place-items-center text-center">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {analysisLoading ? "Loading trusted interval facts" : analysisError ? "Trusted interval facts are unavailable" : "No validated interval facts"}
                        </p>
                        <p className="mt-1 max-w-sm text-xs leading-5 text-muted">
                          {analysisError ? "Resolve the Data Foundation error shown above, then retry this exact Scope and period." : "The chart uses the exact Project, Scope and period shown above."}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={selectedTrend} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                      <defs>
                        <linearGradient id="explorer-fill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#3f827f" stopOpacity={0.2} />
                          <stop offset="100%" stopColor="#3f827f" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#ececf0" strokeDasharray="3 4" vertical={false} />
                      <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#8a8a99" }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#8a8a99" }} />
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
                  <p className="mt-1 text-xs text-muted-light">Trace the selected facts without making a decision claim</p>
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
                    <dl className="space-y-3 text-xs">
                      <EvidenceRow label="Source view" value={analysis!.provenance.sourceView} />
                      <EvidenceRow label="Data Snapshot" value={analysis!.provenance.dataSnapshotId} />
                      <EvidenceRow label="Hierarchy" value={analysis!.provenance.hierarchyRevisionId} />
                      <EvidenceRow label="Meter formula" value={analysis!.provenance.meterFormulaRevisionId} />
                      <EvidenceRow label="Coverage" value={`${analysis!.dataHealth.coveragePct.toFixed(1)}%`} />
                      <EvidenceRow label="Valid intervals" value={`${analysis!.dataHealth.validIntervalCount.toLocaleString()} / ${analysis!.dataHealth.expectedMeterIntervalCount.toLocaleString()}`} />
                      <EvidenceRow label="Quality events" value={analysis!.dataHealth.qualityEventCount.toLocaleString()} />
                      <EvidenceRow label="Last interval" value={analysis!.dataHealth.lastSeenAt ? formatExplorerTimestamp(analysis!.dataHealth.lastSeenAt, analysis!.context.timezone) : "Not provided"} />
                      <EvidenceRow label="Import batches" value={analysis!.dataHealth.importBatchIds.join(", ") || "Not provided"} />
                    </dl>
                  )}
                </div>
              </div>
            </div>

            <section className="mt-8">
              <div className="mb-3 flex items-end justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Meter points attached to {selected.name}</h2>
                  <p className="mt-1 text-xs text-muted-light">
                    {explorerMetricsPending
                      ? "Each Meter Point is queried within the selected Scope and period."
                      : "Period energy and health come from the same trusted analysis result shown above."}
                  </p>
                </div>
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
                    const hasQualityIssue = (circuit?.qualityEventCount ?? 0) > 0;
                    return (
                      <button
                      key={meter.id}
                      type="button"
                      onClick={() => setSelectedId(meter.id)}
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
                        {circuit ? `${circuit.usageKwh.toFixed(2)} kWh` : analysisLoading ? "Loading…" : "No data"}
                      </span>
                      <span
                        className={[
                          "flex items-center gap-1.5 text-[11px] font-medium",
                          hasQualityIssue ? "text-step-warning" : "text-step-success",
                        ].join(" ")}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        {circuit ? (hasQualityIssue ? "review" : "validated") : "not returned"}
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

function EvidenceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-3">
      <dt className="text-muted-light">{label}</dt>
      <dd className="truncate text-right font-mono text-[11px] text-foreground" title={value}>{value}</dd>
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
    <div className="bg-surface px-5 py-4">
      <p className="text-[11px] font-medium text-muted-light">{label}</p>
      <p className="mt-2 tabular text-xl font-semibold tracking-tight text-foreground">{value}</p>
      <p
        className={[
          "mt-1 text-[11px]",
          tone === "warning" ? "text-step-warning" : tone === "success" ? "text-step-success" : "text-muted-light",
        ].join(" ")}
      >
        {note}
      </p>
    </div>
  );
}
