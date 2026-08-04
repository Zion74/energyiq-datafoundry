"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { NgeeAnnDailyAnomalyViewModel } from "./ngee-ann-overview-view-model";

type Incident = NgeeAnnDailyAnomalyViewModel["incidents"][number];
type Series = Incident["series"][number];
type ViewMode = "overlay" | "selected" | "average";

const ALL_SCOPES = "all-scopes";

export function NgeeAnnDailyAnomalies({ view }: { view: NgeeAnnDailyAnomalyViewModel }) {
  const [openIncidentId, setOpenIncidentId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("overlay");
  const [selectedScopeId, setSelectedScopeId] = useState(ALL_SCOPES);
  const [selectedCategory, setSelectedCategory] = useState<"all" | "load" | "light">("all");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const closeDialog = useCallback(() => {
    setOpenIncidentId(null);
    setViewMode("overlay");
    setSelectedScopeId(ALL_SCOPES);
    setSelectedCategory("all");
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!openIncidentId) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), summary, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
      ) ?? []).filter((element) => !element.hasAttribute("disabled"));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialogRef.current?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeDialog, openIncidentId]);

  if (view.status === "unavailable") {
    return (
      <section aria-labelledby="ngee-ann-daily-anomalies" className="border-b border-border px-5 py-5 lg:px-7 lg:py-6">
        <h3 id="ngee-ann-daily-anomalies" className="text-base font-semibold tracking-[-0.015em] text-foreground">
          Daily usage anomalies
        </h3>
        <p className="mt-1 text-xs leading-5 text-muted">{view.decisionQuestion}</p>
        <div className="mt-4 rounded-lg border border-border bg-surface-subtle px-4 py-4" role="status">
          <p className="text-xs font-semibold text-foreground">Daily anomaly analysis unavailable</p>
          <p className="mt-1 text-[11px] leading-5 text-muted">{view.reason}</p>
        </div>
      </section>
    );
  }

  const incident = view.incidents.find((candidate) => candidate.incidentId === openIncidentId) ?? null;

  return (
    <section aria-labelledby="ngee-ann-daily-anomalies" className="border-b border-border px-5 py-5 lg:px-7 lg:py-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h3 id="ngee-ann-daily-anomalies" className="text-base font-semibold tracking-[-0.015em] text-foreground">
            Daily usage anomalies
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted">{view.decisionQuestion}</p>
        </div>
        <p className="text-[11px] leading-5 text-muted">
          Triggered only / pinned Rule {view.rule?.ruleRevisionId}
        </p>
      </div>

      {view.incidents.length > 0 ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-3" aria-label="Server-triggered daily incidents">
          {view.incidents.map((item) => (
            <article key={item.incidentId} className="rounded-lg border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-foreground">{item.scopeName}</p>
                  <p className="mt-1 text-[10px] text-muted">{item.weekday} {item.dateLabel} / {item.dayType}</p>
                </div>
                <span className="rounded-md bg-step-warning/10 px-2 py-1 text-[10px] font-semibold text-step-warning">
                  Triggered
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-[10px]">
                <div><dt className="text-muted">Actual</dt><dd className="mt-1 font-semibold tabular-nums text-foreground">{item.actualKwh} kWh</dd></div>
                <div><dt className="text-muted">Baseline</dt><dd className="mt-1 font-semibold tabular-nums text-foreground">{item.baselineKwh} kWh</dd></div>
                <div><dt className="text-muted">Impact</dt><dd className="mt-1 font-semibold tabular-nums text-foreground">{item.impactKwh} kWh</dd></div>
                <div><dt className="text-muted">Relative</dt><dd className="mt-1 font-semibold tabular-nums text-foreground">{item.relativePct}</dd></div>
              </dl>
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={(event) => {
                  triggerRef.current = event.currentTarget;
                  setOpenIncidentId(item.incidentId);
                }}
                className="mt-4 min-h-11 w-full rounded-lg border border-border px-3 py-2 text-[11px] font-semibold text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                Open incident detail
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-border bg-surface-subtle px-4 py-4" role="status">
          <p className="text-xs font-semibold text-foreground">
            {view.allSuppressed ? "All candidate dates were suppressed" : "No server-triggered daily usage incidents"}
          </p>
          <p className="mt-1 text-[11px] leading-5 text-muted">
            {view.allSuppressed
              ? "Coverage, quality, Calendar or comparable-sample gates prevented a business anomaly conclusion."
              : "No row in this Snapshot crossed both pinned relative and absolute thresholds."}
          </p>
        </div>
      )}

      <AnomalyEvidence view={view} />

      {incident ? createPortal((
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/35 p-3 sm:p-6">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ngee-ann-anomaly-dialog-title"
            aria-describedby="ngee-ann-anomaly-dialog-question"
            tabIndex={-1}
            className="max-h-[min(90vh,900px)] w-full max-w-6xl overflow-y-auto rounded-xl border border-border bg-surface shadow-[var(--shadow-card)] focus:outline-none"
          >
            <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border bg-surface px-5 py-4 sm:px-6">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Pinned daily usage incident</p>
                <h2 id="ngee-ann-anomaly-dialog-title" className="mt-1 text-lg font-semibold tracking-[-0.02em] text-foreground">
                  {incident.scopeName} / {incident.weekday} {incident.dateLabel}
                </h2>
                <p id="ngee-ann-anomaly-dialog-question" className="mt-1 max-w-3xl text-xs leading-5 text-muted">
                  Selected day and frozen comparable-day baseline from the same server incident payload.
                </p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={closeDialog}
                className="min-h-11 shrink-0 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                Close
              </button>
            </header>

            <div className="space-y-5 px-5 py-5 sm:px-6">
              <IncidentSummary incident={incident} />

              <div className="grid gap-4 xl:grid-cols-3">
                <fieldset>
                  <legend className="mb-2 text-[10px] font-semibold text-muted">Incident view</legend>
                  <div className="flex flex-wrap gap-1.5">
                    {(["overlay", "selected", "average"] as const).map((mode) => (
                      <FilterButton
                        key={mode}
                        selected={viewMode === mode}
                        controls="ngee-ann-anomaly-series"
                        onClick={() => setViewMode(mode)}
                      >
                        {mode === "overlay" ? "Overlay" : mode === "selected" ? "Selected" : "Average"}
                      </FilterButton>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend className="mb-2 text-[10px] font-semibold text-muted">Incident Scope</legend>
                  <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                    <FilterButton selected={selectedScopeId === ALL_SCOPES} controls="ngee-ann-anomaly-series" onClick={() => setSelectedScopeId(ALL_SCOPES)}>
                      All
                    </FilterButton>
                    {seriesScopeOptions(incident.series).map((scope) => (
                      <FilterButton key={scope.id} selected={selectedScopeId === scope.id} controls="ngee-ann-anomaly-series" onClick={() => setSelectedScopeId(scope.id)}>
                        {scope.name}
                      </FilterButton>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend className="mb-2 text-[10px] font-semibold text-muted">Incident Category</legend>
                  <div className="flex flex-wrap gap-1.5">
                    {(["all", "load", "light"] as const).map((category) => (
                      <FilterButton
                        key={category}
                        selected={selectedCategory === category}
                        controls="ngee-ann-anomaly-series"
                        onClick={() => setSelectedCategory(category)}
                      >
                        {category === "all" ? "All" : category === "load" ? "Load" : "Light"}
                      </FilterButton>
                    ))}
                  </div>
                </fieldset>
              </div>

              <IncidentSeries
                incident={incident}
                viewMode={viewMode}
                selectedScopeId={selectedScopeId}
                selectedCategory={selectedCategory}
              />

              <IncidentEvidence incident={incident} view={view} />
            </div>
          </div>
        </div>
      ), document.body) : null}
    </section>
  );
}

function IncidentSummary({ incident }: { incident: Incident }) {
  return (
    <section aria-labelledby="ngee-ann-anomaly-summary" className="rounded-lg border border-border bg-surface-subtle p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 id="ngee-ann-anomaly-summary" className="text-xs font-semibold text-foreground">Triggered daily incident</h3>
          <p className="mt-1 text-[11px] text-muted">{incident.range} / {incident.dayType}</p>
          <p className="mt-1 text-[10px] text-muted-light">{incident.coverage} / {incident.intervals} / {incident.qualityEvents}</p>
        </div>
        <dl className="grid grid-cols-2 gap-x-5 gap-y-2 text-right text-[10px]">
          <div><dt className="text-muted">Actual</dt><dd className="mt-1 text-base font-semibold tabular-nums text-foreground">{incident.actualKwh} kWh</dd></div>
          <div><dt className="text-muted">Baseline</dt><dd className="mt-1 text-base font-semibold tabular-nums text-foreground">{incident.baselineKwh} kWh</dd></div>
          <div><dt className="text-muted">Impact</dt><dd className="font-semibold tabular-nums text-foreground">{incident.impactKwh} kWh</dd></div>
          <div><dt className="text-muted">Relative</dt><dd className="font-semibold tabular-nums text-foreground">{incident.relativePct}</dd></div>
        </dl>
      </div>
    </section>
  );
}

function IncidentSeries({
  incident,
  viewMode,
  selectedScopeId,
  selectedCategory,
}: {
  incident: Incident;
  viewMode: ViewMode;
  selectedScopeId: string;
  selectedCategory: "all" | "load" | "light";
}) {
  const visible = incident.series.filter((series) => (
    (selectedScopeId === ALL_SCOPES || series.scopeId === selectedScopeId)
    && (selectedCategory === "all" || series.category === selectedCategory)
  ));
  return (
    <section id="ngee-ann-anomaly-series" aria-labelledby="ngee-ann-anomaly-series-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="ngee-ann-anomaly-series-heading" className="text-sm font-semibold text-foreground">24-hour incident evidence</h3>
          <p className="mt-1 text-[11px] leading-5 text-muted">
            {viewMode === "overlay" ? "Selected and baseline" : viewMode === "selected" ? "Selected day only" : "Frozen baseline average only"}; server series remain in server order.
          </p>
        </div>
        <span className="text-[10px] text-muted">{visible.length} server series</span>
      </div>
      {visible.length > 0 ? (
        <div className="mt-4 space-y-4">
          {visible.map((series) => <SeriesChart key={series.seriesId} series={series} viewMode={viewMode} />)}
        </div>
      ) : (
        <p className="mt-4 rounded-lg border border-border bg-surface-subtle px-4 py-4 text-[11px] text-muted" role="status">
          No server series matches this Scope and Category selection.
        </p>
      )}
    </section>
  );
}

function SeriesChart({ series, viewMode }: { series: Series; viewMode: ViewMode }) {
  const [activeHour, setActiveHour] = useState<number | null>(null);
  let maximum = 0;
  for (const point of series.points) {
    if (viewMode !== "average" && point.selectedKwh !== null && point.selectedKwh > maximum) maximum = point.selectedKwh;
    if (viewMode !== "selected" && point.baselineKwh !== null && point.baselineKwh > maximum) maximum = point.baselineKwh;
  }
  const active = activeHour === null ? null : series.points[activeHour] ?? null;
  return (
    <article className="rounded-lg border border-border p-4" data-anomaly-series={series.seriesId}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-foreground">{series.scopeName}</p>
          <p className="mt-1 text-[10px] text-muted">
            {series.relationship.replaceAll("_", " ")} / {series.categoryLabel ?? "Official Scope"} / {series.statusLabel}
          </p>
          {series.kind === "component_circuit" ? (
            <p className="mt-1 text-[10px] font-semibold text-step-warning">Explanatory component · not included in the official total</p>
          ) : (
            <p className="mt-1 text-[10px] text-muted-light">Official Scope series · included in the Published route</p>
          )}
        </div>
        <p className="text-[10px] text-muted">{series.coverage} / {series.intervals} / {series.qualityEvents}</p>
      </div>

      {series.status === "unavailable" ? (
        <p className="mt-3 rounded-lg border border-border bg-surface-subtle px-3 py-3 text-[11px] text-muted" role="status">
          This server series is unavailable; no chart value is inferred.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto pb-1">
          <div className="min-w-[1040px]">
            <div className="grid h-44 items-end gap-1 border-b border-border px-2" style={{ gridTemplateColumns: "repeat(24, minmax(32px, 1fr))" }}>
              {series.points.map((point) => (
                <button
                  key={point.localHour}
                  type="button"
                  aria-label={seriesPointLabel(series, point, viewMode)}
                  className="group flex h-full flex-col justify-end rounded-t px-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  onMouseEnter={() => setActiveHour(point.localHour)}
                  onMouseLeave={() => setActiveHour(null)}
                  onFocus={() => setActiveHour(point.localHour)}
                  onBlur={() => setActiveHour(null)}
                >
                  <span className="flex min-h-0 flex-1 items-end justify-center gap-px">
                    {viewMode !== "average" ? (
                      <ChartBar value={point.selectedKwh} maximum={maximum} tone="selected" />
                    ) : null}
                    {viewMode !== "selected" ? (
                      <ChartBar value={point.baselineKwh} maximum={maximum} tone="baseline" />
                    ) : null}
                  </span>
                  <span className="mt-2 pb-2 text-[9px] text-muted">{point.localHour % 3 === 0 ? point.hourLabel : ""}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 min-h-14 rounded-lg bg-surface-subtle px-3 py-2" aria-live="polite" aria-atomic="true">
        {active ? (
          <p className="text-[10px] leading-5 text-muted">
            <span className="font-semibold text-foreground">{active.hourLabel}</span>
            {viewMode !== "average" ? ` / Selected ${formatChartValue(active.selectedKwh)}` : ""}
            {viewMode !== "selected" ? ` / Average ${formatChartValue(active.baselineKwh)}` : ""}
            {viewMode !== "overlay" || active.impactKwh === null
              ? ""
              : ` / Impact ${active.impactKwh >= 0 ? "+" : ""}${active.impactKwh.toFixed(4)} kWh`}
          </p>
        ) : (
          <p className="text-[10px] leading-5 text-muted">Hover or keyboard-focus an hour for the exact server points.</p>
        )}
      </div>
    </article>
  );
}

function ChartBar({ value, maximum, tone }: { value: number | null; maximum: number; tone: "selected" | "baseline" }) {
  if (value === null || maximum <= 0) return <span className="mb-1 h-1 w-2 border-b border-dashed border-border" aria-hidden="true" />;
  const height = Math.max(4, value / maximum * 100);
  return <span className={tone === "selected" ? "w-2 rounded-t bg-primary" : "w-2 rounded-t bg-step-warning/70"} style={{ height: `${height}%` }} aria-hidden="true" />;
}

function IncidentEvidence({ incident, view }: { incident: Incident; view: NgeeAnnDailyAnomalyViewModel }) {
  return (
    <details className="border-t border-border pt-4 text-[10px] leading-4 text-muted">
      <summary className="cursor-pointer font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
        Incident evidence / time_slot_anomaly_v1
      </summary>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <dl className="grid gap-x-3 gap-y-1.5 sm:grid-cols-[92px_minmax(0,1fr)]">
          <dt>Incident</dt><dd className="break-all font-mono text-foreground">{incident.incidentId}</dd>
          <dt>Anomaly</dt><dd className="break-all font-mono text-foreground">{incident.anomalyId}</dd>
          <dt>Snapshot</dt><dd className="break-all font-mono text-foreground">{view.evidence.snapshotId}</dd>
          <dt>Bundle</dt><dd className="break-all font-mono text-foreground">{view.evidence.bundleId}</dd>
          <dt>Rule</dt><dd className="break-all font-mono text-foreground">{view.rule?.ruleRevisionId}</dd>
          <dt>Metric / Query</dt><dd className="break-all font-mono text-foreground">{view.evidence.metricId} / {view.evidence.queryIds[0]}</dd>
        </dl>
        <div>
          <p className="font-semibold text-foreground">Eligible comparable dates ({incident.baselineSamples.length})</p>
          <ul className="mt-2 space-y-1.5">
            {incident.baselineSamples.map((sample) => (
              <li key={sample.localDate} className="rounded-md bg-surface-subtle px-2 py-1.5">
                {sample.localDate} / {sample.coverage} / {sample.intervals} / {sample.qualityEvents}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </details>
  );
}

function AnomalyEvidence({ view }: { view: NgeeAnnDailyAnomalyViewModel }) {
  return (
    <details className="mt-4 border-t border-border pt-3 text-[10px] leading-4 text-muted">
      <summary className="cursor-pointer font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
        Anomaly Rule & evidence / time_slot_anomaly_v1
      </summary>
      <dl className="mt-2 grid gap-x-3 gap-y-1 sm:grid-cols-[104px_minmax(0,1fr)]">
        <dt>Snapshot</dt><dd className="break-all font-mono text-foreground">{view.evidence.snapshotId}</dd>
        <dt>Release</dt><dd className="break-all font-mono text-foreground">{view.evidence.projectReleaseId}</dd>
        <dt>Bundle</dt><dd className="break-all font-mono text-foreground">{view.evidence.bundleId}</dd>
        <dt>Rule</dt><dd className="break-all font-mono text-foreground">{view.rule?.ruleRevisionId}</dd>
        <dt>Baseline cutoff</dt><dd className="font-mono text-foreground">{view.rule?.baselineCutoff}</dd>
        <dt>Baseline method</dt><dd className="break-all font-mono text-foreground">{view.rule?.baselineMethod}</dd>
        <dt>Thresholds</dt><dd className="text-foreground">{view.rule?.relativeThresholdPct} and {view.rule?.absoluteImpactKwh}</dd>
        <dt>Quality gates</dt><dd className="text-foreground">{view.rule?.minimumCoveragePct} minimum coverage / {view.rule?.minimumSampleCount} samples / at most {view.rule?.maximumQualityEventCount} quality events</dd>
        <dt>Period</dt><dd className="break-words text-foreground">{view.evidence.period}</dd>
        <dt>Timezone</dt><dd className="text-foreground">{view.evidence.timezone}</dd>
      </dl>
    </details>
  );
}

function FilterButton({ selected, controls, onClick, children }: {
  selected: boolean;
  controls: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-controls={controls}
      onClick={onClick}
      className={selected
        ? "min-h-11 rounded-lg border border-primary bg-primary/10 px-3 py-2 text-[11px] font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        : "min-h-11 rounded-lg border border-border px-3 py-2 text-[11px] font-semibold text-muted hover:bg-surface-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"}
    >
      {children}
    </button>
  );
}

function seriesScopeOptions(series: Series[]): Array<{ id: string; name: string }> {
  const seen = new Set<string>();
  const options: Array<{ id: string; name: string }> = [];
  for (const item of series) {
    if (seen.has(item.scopeId)) continue;
    seen.add(item.scopeId);
    options.push({ id: item.scopeId, name: item.scopeName });
  }
  return options;
}

function seriesPointLabel(series: Series, point: Series["points"][number], viewMode: ViewMode): string {
  const selected = viewMode === "average" ? "" : `; selected ${formatChartValue(point.selectedKwh)}`;
  const average = viewMode === "selected" ? "" : `; average ${formatChartValue(point.baselineKwh)}`;
  return `${series.scopeName} ${point.hourLabel}${selected}${average}; ${series.statusLabel}`;
}

function formatChartValue(value: number | null): string {
  return value === null ? "unavailable" : `${value.toFixed(4)} kWh`;
}
