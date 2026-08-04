"use client";

import React, { useState } from "react";

import type { NgeeAnnEnergyTrendViewModel } from "./ngee-ann-overview-view-model";

export function NgeeAnnEnergyTrend({ view }: { view: NgeeAnnEnergyTrendViewModel }) {
  const [selectedScopeId, setSelectedScopeId] = useState(view.scopes[0]?.id ?? "");
  const [activePointId, setActivePointId] = useState<string | null>(null);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);

  if (view.status === "unavailable") {
    return (
      <section aria-labelledby="ngee-ann-energy-trend" className="border-b border-border px-5 py-5 lg:px-7 lg:py-6">
        <h3 id="ngee-ann-energy-trend" className="text-base font-semibold tracking-[-0.015em] text-foreground">
          Energy trend
        </h3>
        <p className="mt-1 text-xs leading-5 text-muted">{view.decisionQuestion}</p>
        <div className="mt-4 rounded-lg border border-border bg-surface-subtle px-4 py-4" role="status">
          <p className="text-xs font-semibold text-foreground">Energy trend unavailable</p>
          <p className="mt-1 text-[11px] leading-5 text-muted">{view.reason}</p>
        </div>
      </section>
    );
  }

  const selectedScope = view.scopes.find((scope) => scope.id === selectedScopeId) ?? view.scopes[0]!;
  const selectedPoint = selectedScope.points.find((point) => point.id === selectedPointId) ?? null;
  const activePoint = selectedScope.points.find((point) => point.id === activePointId) ?? selectedPoint;
  let maximumUsageKwh = 0;
  for (const point of selectedScope.points) {
    if (point.acceptedUsageKwh !== null && point.acceptedUsageKwh > maximumUsageKwh) {
      maximumUsageKwh = point.acceptedUsageKwh;
    }
  }

  return (
    <section aria-labelledby="ngee-ann-energy-trend" className="border-b border-border px-5 py-5 lg:px-7 lg:py-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h3 id="ngee-ann-energy-trend" className="text-base font-semibold tracking-[-0.015em] text-foreground">
            Energy trend
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted">{view.decisionQuestion}</p>
        </div>
        <p className="text-[11px] leading-5 text-muted">
          Daily totals / {view.evidence.timezone} / {view.evidence.unit}
        </p>
      </div>

      <fieldset className="mt-4">
        <legend className="mb-2 text-[10px] font-semibold text-muted">Energy trend Scope</legend>
        <div className="flex flex-wrap gap-1.5">
          {view.scopes.map((scope) => {
            const selected = scope.id === selectedScope.id;
            return (
              <button
                key={scope.id}
                type="button"
                className={selected
                  ? "min-h-11 rounded-lg border border-primary bg-primary/10 px-3 py-2 text-[11px] font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  : "min-h-11 rounded-lg border border-border px-3 py-2 text-[11px] font-semibold text-muted hover:bg-surface-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"}
                aria-pressed={selected}
                aria-controls="ngee-ann-energy-trend-chart"
                onClick={() => {
                  setSelectedScopeId(scope.id);
                  setActivePointId(null);
                  setSelectedPointId(null);
                }}
              >
                {scope.name}
              </button>
            );
          })}
        </div>
      </fieldset>

      {selectedScope.limitation ? (
        <p className="mt-3 rounded-lg border border-step-warning/25 bg-step-warning/5 px-3 py-2 text-[11px] leading-5 text-step-warning" role="status">
          {selectedScope.limitation}
        </p>
      ) : null}

      <div id="ngee-ann-energy-trend-chart" className="mt-4 overflow-x-auto pb-1">
        <div className="min-w-[720px]">
          <div className="mb-2 flex items-center justify-between text-[10px] text-muted">
            <span>Accepted energy / kWh</span>
            <span>{selectedScope.points.length} daily buckets</span>
          </div>
          <div className="grid h-56 grid-cols-7 items-end gap-2 border-b border-border px-2">
            {selectedScope.points.map((point) => {
              const selected = selectedPoint?.id === point.id;
              const height = point.acceptedUsageKwh === null || maximumUsageKwh <= 0
                ? 0
                : Math.max(4, (point.acceptedUsageKwh / maximumUsageKwh) * 100);
              const ariaValue = point.usageKwh === null ? "no accepted facts" : `${point.usageKwh} kWh`;
              return (
                <button
                  key={point.id}
                  type="button"
                  className="group flex h-full min-w-0 flex-col justify-end rounded-t px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  aria-label={`${point.weekday} ${point.dateLabel}: ${ariaValue}; ${point.statusLabel}; ${point.coverage}`}
                  aria-pressed={selected}
                  onMouseEnter={() => setActivePointId(point.id)}
                  onMouseLeave={() => setActivePointId(null)}
                  onFocus={() => setActivePointId(point.id)}
                  onBlur={() => setActivePointId(null)}
                  onClick={() => setSelectedPointId(point.id)}
                >
                  <span className="relative flex min-h-0 flex-1 items-end justify-center">
                    {point.acceptedUsageKwh === null ? (
                      <span className="mb-1 h-2 w-full max-w-12 rounded-sm border border-dashed border-border bg-surface-subtle" aria-hidden="true" />
                    ) : (
                      <span
                        className={point.status === "partial"
                          ? "w-full max-w-12 rounded-t bg-step-warning/70 group-hover:bg-step-warning group-focus-visible:bg-step-warning"
                          : "w-full max-w-12 rounded-t bg-primary/70 group-hover:bg-primary group-focus-visible:bg-primary"}
                        style={{ height: `${height}%` }}
                        aria-hidden="true"
                      />
                    )}
                  </span>
                  <span className="mt-2 text-[10px] font-semibold text-foreground">{point.weekday}</span>
                  <span className="pb-2 text-[10px] text-muted">{point.dateLabel}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-4 min-h-[92px] rounded-lg bg-surface-subtle px-4 py-3" aria-live="polite" aria-atomic="true">
        {activePoint ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-foreground">{activePoint.weekday} / {activePoint.dateLabel}</p>
                <p className="mt-1 text-[10px] text-muted">{activePoint.range}</p>
              </div>
              <p className="text-sm font-semibold tabular-nums text-foreground">
                {activePoint.usageKwh === null ? "No accepted facts" : `${activePoint.usageKwh} kWh`}
              </p>
            </div>
            <p className="mt-2 text-[11px] text-muted">
              {activePoint.statusLabel} / {activePoint.coverage} / {activePoint.intervals} / {activePoint.qualityEvents}
            </p>
          </>
        ) : (
          <p className="text-[11px] leading-5 text-muted">
            Hover or focus a day to inspect accepted usage and coverage. Press Enter or Space to keep its detail open.
          </p>
        )}
      </div>

      <details className="mt-4 border-t border-border pt-3 text-[10px] leading-4 text-muted">
        <summary className="cursor-pointer font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
          Trend evidence / daily_totals_v1
        </summary>
        <dl className="mt-2 grid gap-x-3 gap-y-1 sm:grid-cols-[80px_minmax(0,1fr)]">
          <dt>Snapshot</dt><dd className="break-all font-mono text-foreground">{view.evidence.snapshotId}</dd>
          <dt>Release</dt><dd className="break-all font-mono text-foreground">{view.evidence.projectReleaseId}</dd>
          <dt>Mapping</dt><dd className="break-all font-mono text-foreground">{view.evidence.meterMappingRevisionId}</dd>
          <dt>Formula</dt><dd className="break-all font-mono text-foreground">{view.evidence.meterFormulaRevisionId}</dd>
          <dt>Metric</dt><dd className="break-all font-mono text-foreground">{view.evidence.metricId}</dd>
          <dt>Period</dt><dd className="break-words text-foreground">{view.evidence.period}</dd>
          <dt>Timezone</dt><dd className="text-foreground">{view.evidence.timezone}</dd>
          <dt>Unit</dt><dd className="text-foreground">{view.evidence.unit}</dd>
          <dt>Query</dt><dd className="break-all font-mono text-foreground">{view.evidence.queryIds.join(", ")}</dd>
        </dl>
      </details>
    </section>
  );
}
