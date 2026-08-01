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
  subtitle?: string;
  role?: "total" | "submeter" | "virtual";
  value?: number;
  category?: "Light" | "Load" | "Aircon";
  quality?: "complete" | "partial";
  areaSqm?: number;
  occupantCount?: number;
};

const ngeeAnnNodes: ProjectNode[] = [
  { id: "project", parentId: null, type: "project", name: "Ngee Ann Polytechnic" },
  { id: "block-test", parentId: "project", type: "block", name: "Block Test", subtitle: "2 levels · 18 meters" },
  { id: "level-7", parentId: "block-test", type: "level", name: "Level 7", subtitle: "9 direct meters" },
  {
    id: "l7-total-light",
    parentId: "level-7",
    type: "meter",
    name: "Total Office Light",
    subtitle: "Physical total",
    role: "total",
    category: "Light",
    value: 701.76,
    quality: "complete",
  },
  {
    id: "l7-total-load",
    parentId: "level-7",
    type: "meter",
    name: "Total Office Load",
    subtitle: "Physical total",
    role: "total",
    category: "Load",
    value: 1038.42,
    quality: "complete",
  },
  {
    id: "l7-front-light",
    parentId: "level-7",
    type: "meter",
    name: "Front Row Office Light",
    role: "submeter",
    category: "Light",
    value: 183.54,
    quality: "complete",
  },
  {
    id: "l7-middle-light",
    parentId: "level-7",
    type: "meter",
    name: "Middle Row Office Light",
    role: "submeter",
    category: "Light",
    value: 201.82,
    quality: "complete",
  },
  {
    id: "l7-back-light",
    parentId: "level-7",
    type: "meter",
    name: "Back Row Office Light",
    role: "submeter",
    category: "Light",
    value: 221.36,
    quality: "complete",
  },
  {
    id: "l7-load-1",
    parentId: "level-7",
    type: "meter",
    name: "Office Load 1 · L1P1–L3P6",
    role: "submeter",
    category: "Load",
    value: 284.72,
    quality: "complete",
  },
  {
    id: "l7-load-2",
    parentId: "level-7",
    type: "meter",
    name: "Office Load 2 · L1P7–L3P15",
    role: "submeter",
    category: "Load",
    value: 253.18,
    quality: "complete",
  },
  {
    id: "l7-load-3",
    parentId: "level-7",
    type: "meter",
    name: "Office Load 3 · L1P16–L3P21",
    role: "submeter",
    category: "Load",
    value: 267.63,
    quality: "complete",
  },
  {
    id: "l7-load-4",
    parentId: "level-7",
    type: "meter",
    name: "Office Load 4 · Fan ISOL 1/2",
    role: "submeter",
    category: "Load",
    value: 232.89,
    quality: "complete",
  },
  { id: "level-6", parentId: "block-test", type: "level", name: "Level 6", subtitle: "9 direct meters" },
  {
    id: "l6-total-light",
    parentId: "level-6",
    type: "meter",
    name: "Total Office Light",
    subtitle: "Physical total",
    role: "total",
    category: "Light",
    value: 565.73,
    quality: "complete",
  },
  {
    id: "l6-total-load",
    parentId: "level-6",
    type: "meter",
    name: "Total Office Load",
    subtitle: "Physical total",
    role: "total",
    category: "Load",
    value: 924.16,
    quality: "complete",
  },
  {
    id: "l6-light-right",
    parentId: "level-6",
    type: "meter",
    name: "Office Light-Right · Internal",
    role: "submeter",
    category: "Light",
    value: 241.72,
    quality: "partial",
  },
  {
    id: "l6-load-4",
    parentId: "level-6",
    type: "meter",
    name: "Office Load 4 · L1P19–L3P24",
    role: "submeter",
    category: "Load",
    value: 258.24,
    quality: "complete",
  },
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
  const [selectedId, setSelectedId] = useState("block-test");
  const [search, setSearch] = useState("");
  const [resource, setResource] = useState<"electricity" | "water">("electricity");
  const [hierarchyNodes, setHierarchyNodes] = useState<ProjectNode[] | null>(null);
  const [hierarchyError, setHierarchyError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<EnergyScopeAnalysisDto | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(["project", "block-test", "level-6", "level-7"]),
  );

  const activeProjectId = activeProject?.id;

  useEffect(() => {
    if (!activeProjectId) return;
    let cancelled = false;
    setHierarchyError(null);
    void configApi.getEnergyProjectHierarchy(activeProjectId)
      .then((hierarchy) => {
        if (cancelled) return;
        const mapped = hierarchy.nodes.map((node) =>
          mapHierarchyNode(
            node,
            activeProjectId === "ngee-ann-polytechnic"
              ? ngeeAnnNodes.find((candidate) => candidate.id === node.id)
              : undefined,
          ),
        );
        setHierarchyNodes(mapped);
        setSelectedId(defaultScopeId(activeProjectId, mapped));
        setExpandedIds(defaultExpandedIds(activeProjectId, mapped));
      })
      .catch((reason) => {
        if (cancelled) return;
        setHierarchyNodes(null);
        setHierarchyError(
          reason instanceof Error ? reason.message : "Unable to load project hierarchy",
        );
        setSelectedId(activeProjectId === "ngee-ann-polytechnic" ? "block-test" : "");
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
    const period = analysisPeriodForProject(activeProjectId);
    setAnalysisLoading(true);
    setAnalysisError(null);
    void configApi.executeEnergyScopeAnalysis({
      projectId: activeProjectId,
      scopeId: selectedId,
      resource,
      period: "Custom",
      from: period.from,
      to: period.to,
    }).then((result) => {
      if (cancelled) return;
      setAnalysis(result);
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
  }, [activeProjectId, resource, selectedId]);

  const projectNodes = hierarchyNodes
    ?? (activeProject?.id === "ngee-ann-polytechnic" ? ngeeAnnNodes : []);
  const selected = projectNodes.find((node) => node.id === selectedId)
    ?? projectNodes[0]
    ?? ngeeAnnNodes[0]!;
  const children = projectNodes.filter((node) => node.parentId === selected.id);
  const directMeters = projectNodes.filter(
    (node) => node.parentId === selected.id && isMeterNode(node),
  );
  const period = analysisPeriodForProject(activeProjectId ?? "");
  const scopeArea = analysis?.summary.areaSqm ?? 0;
  const scopeOccupants = analysis?.summary.occupantCount ?? 0;
  const centresInScope = [selected, ...getDescendantNodes(selected.id, projectNodes)]
    .filter((node) => node.type === "centre");
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
    energy: point.averageKw,
    baseline: point.peakKw,
  }));
  const childScopeComparisons = analysis?.childScopes ?? [];
  const composition = ["Light", "Load", "Aircon"].map((category) => {
    const categoryCircuits = (analysis?.circuits ?? []).filter(
      (circuit) => circuit.category.toLowerCase() === category.toLowerCase()
        && circuit.meterRole !== "total",
    );
    const top = categoryCircuits[0];
    return {
      category,
      total: categoryCircuits.reduce((sum, circuit) => sum + circuit.usageKwh, 0),
      top,
    };
  }).filter((row) => row.total > 0);
  const primaryAttention = analysis?.attention[0];

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
              <div className="mt-4" role="tree" aria-label="Project structure">
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

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-muted transition-colors hover:bg-surface-subtle hover:text-foreground"
                >
                  <EnergyIcon name="calendar" className="h-3.5 w-3.5" />
                  {period.label}
                </button>
                <a
                  href={buildEnergyAiHref({
                    projectId: activeProject?.id ?? "",
                    projectName: activeProject?.name ?? "",
                    scopeId: selected.id,
                    scopeName: selected.name,
                    resource,
                  })}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-white transition-colors hover:bg-primary-light"
                >
                  <EnergyIcon name="ask" className="h-3.5 w-3.5" />
                  Investigate with AI
                </a>
              </div>
            </div>

            {analysisError ? (
              <p className="mt-4 rounded-lg border border-step-warning/25 bg-step-warning/5 p-3 text-xs leading-5 text-step-warning">
                Scope analysis unavailable: {analysisError}
              </p>
            ) : null}

            <div className="mt-6 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
              {explorerMetricsPending ? (
                <>
                  <MetricCell
                    label="Period consumption"
                    value={analysisLoading ? "Loading facts…" : "No validated data"}
                    note="Resolved from the trusted project, scope and period"
                  />
                  <MetricCell
                    label="Area in scope"
                    value={scopeArea > 0 ? `${scopeArea.toLocaleString()} m²` : "—"}
                    note={`${centresInScope.length} centre${centresInScope.length === 1 ? "" : "s"} in scope`}
                  />
                  <MetricCell
                    label="People in scope"
                    value={scopeOccupants > 0 ? scopeOccupants.toLocaleString() : "—"}
                    note="Teachers + customers from project metadata"
                  />
                  <MetricCell
                    label="Data quality"
                    value="—"
                    note="Waiting for deterministic analysis"
                  />
                </>
              ) : (
                <>
                  <MetricCell
                    label="Period consumption"
                    value={`${selectedValue.toLocaleString(undefined, { maximumFractionDigits: 2 })} kWh`}
                    note={`${analysis!.summary.nonOperatingSharePct.toFixed(1)}% outside operating hours`}
                  />
                  <MetricCell
                    label="Estimated energy cost"
                    value={`S$${analysis!.summary.costSgd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                    note={analysis!.summary.kwhPerSqm !== undefined
                      ? `${analysis!.summary.kwhPerSqm.toFixed(2)} kWh/m²`
                      : "Singapore reference tariff"}
                  />
                  <MetricCell
                    label="Peak demand"
                    value={`${analysis!.summary.peakKw.toLocaleString(undefined, { maximumFractionDigits: 2 })} kW`}
                    note={analysis!.summary.kwhPerPerson !== undefined
                      ? `${analysis!.summary.kwhPerPerson.toFixed(2)} kWh/person`
                      : "Highest validated interval"}
                  />
                  <MetricCell
                    label="Data quality"
                    value={analysis!.summary.qualityEventCount > 0 ? "Review" : "Validated"}
                    note={`${analysis!.summary.validIntervalCount.toLocaleString()} valid · ${analysis!.summary.qualityEventCount} flagged`}
                    tone={analysis!.summary.qualityEventCount > 0 ? "warning" : "success"}
                  />
                </>
              )}
            </div>

            <div className="mt-7 grid gap-6 xl:grid-cols-[1.4fr_0.8fr]">
              <div>
                <div className="mb-3 flex items-end justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">Hourly operating profile</h2>
                    <p className="mt-1 text-xs text-muted-light">Average and observed peak by hour across the selected period</p>
                  </div>
                  <span className="text-[11px] text-muted-light">Average power · kW</span>
                </div>
                <div className="h-[300px] rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
                  {explorerMetricsPending ? (
                    <div className="grid h-full place-items-center text-center">
                      <div>
                        <p className="text-sm font-medium text-foreground">Loading trusted interval facts</p>
                        <p className="mt-1 max-w-sm text-xs leading-5 text-muted">
                          The chart uses the exact Project, Scope and period shown above.
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
                        formatter={(value, name) => [
                          `${Number(value).toFixed(1)} kW`,
                          name === "energy" ? "Hourly average" : "Observed peak",
                        ]}
                      />
                      <Area
                        type="monotone"
                        dataKey="baseline"
                        stroke="#a3a3a3"
                        strokeDasharray="5 4"
                        fill="none"
                        dot={false}
                      />
                      <Area
                        type="monotone"
                        dataKey="energy"
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
                  <h2 className="text-sm font-semibold text-foreground">What needs attention</h2>
                  <p className="mt-1 text-xs text-muted-light">Evidence attached to this scope</p>
                </div>
                <div className={[
                  "rounded-xl border p-5",
                  explorerMetricsPending
                    ? "border-border bg-surface"
                    : "border-step-warning/30 bg-step-warning/5",
                ].join(" ")}>
                  <div className="flex items-center gap-2 text-step-warning">
                    <EnergyIcon name="alert" className="h-4 w-4" />
                    <span className="text-[11px] font-semibold uppercase tracking-[0.07em]">
                      {explorerMetricsPending ? "Evaluating rules" : primaryAttention?.severity ?? "No exception"}
                    </span>
                  </div>
                  <h3 className="mt-3 text-sm font-semibold text-foreground">
                    {explorerMetricsPending
                      ? "No anomaly claim before the rule is evaluated"
                      : primaryAttention?.title ?? "No deterministic exception was triggered"}
                  </h3>
                  <p className="mt-2 text-xs leading-5 text-muted">
                    {explorerMetricsPending
                      ? "The system is calculating time, per-person and per-area evidence for this exact scope."
                      : primaryAttention?.evidence ?? "The selected period passed the current deterministic checks."}
                  </p>
                  <div className="mt-4 border-t border-step-warning/20 pt-4">
                    <p className="text-[11px] font-semibold text-foreground">Suggested check</p>
                    <p className="mt-1 text-xs leading-5 text-muted">
                      {explorerMetricsPending
                        ? "Wait for the scoped evidence before acting."
                        : primaryAttention?.suggestedAction ?? "Continue monitoring the next scheduled import."}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {!isMeterNode(selected) && !explorerMetricsPending ? (
              <section className="mt-8">
                <div className="mb-3">
                  <h2 className="text-sm font-semibold text-foreground">Horizontal and vertical comparisons</h2>
                  <p className="mt-1 text-xs text-muted-light">
                    Horizontal compares sibling scopes; vertical compares this scope with its own historical time pattern.
                  </p>
                </div>

                <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
                  <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-card)]">
                    <div className="border-b border-border px-5 py-4">
                      <h3 className="text-sm font-semibold text-foreground">
                        {childScopeComparisons.length > 0 ? "Child scope comparison" : "Load composition"}
                      </h3>
                      <p className="mt-1 text-xs text-muted-light">
                        {childScopeComparisons.length > 0
                          ? "Each child uses its own designated totals; the dominant submeter is shown separately."
                          : "Light and load totals are compared without double-counting their submeters."}
                      </p>
                    </div>

                    {childScopeComparisons.length > 0
                      ? childScopeComparisons.map((scope) => {
                          const max = Math.max(...childScopeComparisons.map((entry) => entry.usageKwh), 1);
                          return (
                            <button
                              key={scope.nodeId}
                              type="button"
                              onClick={() => setSelectedId(scope.nodeId)}
                              className="block w-full border-b border-border px-5 py-4 text-left last:border-b-0 hover:bg-surface-subtle"
                            >
                              <div className="flex items-center justify-between gap-4">
                                <div>
                                  <p className="text-sm font-semibold text-foreground">{scope.name}</p>
                                  <p className="mt-1 text-xs text-muted">
                                    Highest load: {scope.topCircuitName ?? "Not mapped"}
                                  </p>
                                </div>
                                <span className="text-sm font-semibold tabular-nums text-foreground">
                                  {scope.usageKwh.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh
                                </span>
                              </div>
                              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-subtle">
                                <div
                                  className="h-full rounded-full bg-step-inspect"
                                  style={{ width: `${Math.max(8, (scope.usageKwh / max) * 100)}%` }}
                                />
                              </div>
                              <p className="mt-2 text-[11px] text-muted-light">
                                {scope.sharePct.toFixed(1)}% of selected scope
                                {scope.kwhPerSqm !== undefined ? ` · ${scope.kwhPerSqm.toFixed(2)} kWh/m²` : ""}
                              </p>
                            </button>
                          );
                        })
                      : composition.map((row) => (
                          <div key={row.category} className="border-b border-border px-5 py-4 last:border-b-0">
                            <div className="flex items-center justify-between gap-4">
                              <div>
                                <p className="text-sm font-semibold text-foreground">{row.category}</p>
                                <p className="mt-1 text-xs text-muted">
                                  Highest component: {row.top?.name ?? "No submeter configured"}
                                </p>
                              </div>
                              <span className="text-sm font-semibold tabular-nums text-foreground">
                                {row.total.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh
                              </span>
                            </div>
                            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-subtle">
                              <div
                                className={[
                                  "h-full rounded-full",
                                  row.category === "Light" ? "bg-step-inspect" : "bg-step-warning",
                                ].join(" ")}
                                style={{ width: `${Math.max(8, (row.total / Math.max(selectedValue, 1)) * 100)}%` }}
                              />
                            </div>
                          </div>
                        ))}
                  </div>

                  <div className="rounded-xl border border-border bg-surface p-5 shadow-[var(--shadow-card)]">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">Trusted query evidence</h3>
                        <p className="mt-1 text-xs text-muted-light">The visible metrics are reproducible from fixed queries.</p>
                      </div>
                      <span className="rounded-full bg-step-success/10 px-2 py-1 text-[10px] font-semibold text-step-success">Scoped</span>
                    </div>
                    <dl className="mt-5 space-y-3 text-xs">
                      <EvidenceRow label="Snapshot" value={analysis!.provenance.dataSnapshotId} />
                      <EvidenceRow label="Hierarchy" value={analysis!.provenance.hierarchyRevisionId} />
                      <EvidenceRow label="Meter formula" value={analysis!.provenance.meterFormulaRevisionId} />
                      <EvidenceRow label="Aggregation" value={analysis!.provenance.aggregationRule.replaceAll("_", " ")} />
                      <EvidenceRow label="Queries" value={analysis!.provenance.queryIds.join(", ")} />
                    </dl>
                    <p className="mt-5 border-t border-border pt-4 text-[11px] leading-5 text-muted">
                      The room × level × time heatmap will use the same scope contract after room-level mappings are available; no mock heatmap is mixed into these facts.
                    </p>
                  </div>
                </div>
              </section>
            ) : null}

            <section className="mt-8">
              <div className="mb-3 flex items-end justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Meter points attached to {selected.name}</h2>
                  <p className="mt-1 text-xs text-muted-light">
                    {explorerMetricsPending
                      ? "Each circuit is queryable independently and rolls up once to its Centre."
                      : "Total meters define scope totals; submeters support composition and drill-down."}
                  </p>
                </div>
                <span className="text-[11px] text-muted-light">{directMeters.length} direct meters</span>
              </div>

              {directMeters.length > 0 ? (
                <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-card)]">
                  <div className="hidden grid-cols-[minmax(0,1fr)_100px_110px_100px] gap-4 border-b border-border bg-surface-subtle px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-light md:grid">
                    <span>Meter point</span>
                    <span>Role</span>
                    <span>Reading</span>
                    <span>Quality</span>
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
                  <p className="mt-1 text-xs text-muted-light">This is a leaf meter point. Use its trend and source records above.</p>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border bg-surface p-6 text-center">
                  <p className="text-sm font-medium text-foreground">Meters are attached below this scope</p>
                  <p className="mt-1 text-xs text-muted-light">
                    Use the child comparison above or select a child node to inspect its direct totals and submeters.
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
  const renderedNodes = searchActive
    ? visibleNodes
    : visibleNodes.filter((node) => ancestorsAreExpanded(node, allNodes, expandedIds));

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
              {node.quality === "partial" ? (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-step-warning" title="Partial data" />
              ) : null}
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

function getDescendantNodes(nodeId: string, allNodes: ProjectNode[]): ProjectNode[] {
  const childIds = allNodes
    .filter((node) => node.parentId === nodeId)
    .map((node) => node.id);
  const descendantIds = new Set(childIds);
  const queue = [...childIds];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const child of allNodes.filter((node) => node.parentId === current)) {
      if (descendantIds.has(child.id)) continue;
      descendantIds.add(child.id);
      queue.push(child.id);
    }
  }
  return allNodes.filter((node) => descendantIds.has(node.id));
}

function getDescendantMeters(nodeId: string, allNodes: ProjectNode[]): ProjectNode[] {
  return getDescendantNodes(nodeId, allNodes).filter(isMeterNode);
}

function isMeterNode(node: ProjectNode): boolean {
  return node.type === "meter" || node.type === "circuit";
}

function analysisPeriodForProject(projectId: string): { from: string; to: string; label: string } {
  if (projectId === "preschool-demo") {
    return { from: "2026-05-01", to: "2026-05-31", label: "1–31 May 2026" };
  }
  return { from: "2026-05-19", to: "2026-06-17", label: "19 May–17 Jun 2026" };
}

function defaultScopeId(projectId: string, allNodes: ProjectNode[]): string {
  if (projectId === "ngee-ann-polytechnic" && allNodes.some((node) => node.id === "block-test")) {
    return "block-test";
  }
  return allNodes.find((node) => node.parentId === null)?.id ?? allNodes[0]?.id ?? "";
}

function defaultExpandedIds(projectId: string, allNodes: ProjectNode[]): Set<string> {
  if (projectId === "ngee-ann-polytechnic") {
    return new Set(
      ["project", "block-test", "level-6", "level-7"].filter((id) =>
        allNodes.some((node) => node.id === id),
      ),
    );
  }
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

function buildEnergyAiHref(input: {
  projectId: string;
  projectName: string;
  scopeId: string;
  scopeName: string;
  resource: "electricity" | "water";
}): string {
  const params = new URLSearchParams({
    projectId: input.projectId,
    projectName: input.projectName,
    scopeId: input.scopeId,
    scopeName: input.scopeName,
    resource: input.resource,
  });
  const period = analysisPeriodForProject(input.projectId);
  params.set("period", "Custom");
  params.set("from", period.from);
  params.set("to", period.to);
  return `/energyiq/ai?${params.toString()}`;
}

function mapHierarchyNode(
  node: EnergyProjectNodeDto,
  fallback?: ProjectNode,
): ProjectNode {
  const metadata = parseHierarchyMetadata(node.metadata_json);
  const nodeType = normalizeNodeType(node.node_type);
  return {
    ...fallback,
    id: node.id,
    parentId: node.parent_id ?? null,
    type: nodeType,
    name: node.name,
    subtitle: nodeType === "centre"
      ? [
          metadata.facilityType,
          node.area_sqm ? `${node.area_sqm.toLocaleString()} m²` : null,
          node.occupant_count ? `${node.occupant_count} people` : null,
        ].filter(Boolean).join(" · ")
      : fallback?.subtitle,
    role: metadata.meterRole ?? fallback?.role,
    category: metadata.category ?? fallback?.category,
    areaSqm: node.area_sqm,
    occupantCount: node.occupant_count,
  };
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
  facilityType?: string;
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
      facilityType: typeof parsed.facilityType === "string" ? parsed.facilityType : undefined,
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
