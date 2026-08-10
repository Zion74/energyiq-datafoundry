"use client";

import React, { useState } from "react";

import type { PreschoolOverviewViewModel } from "./preschool-overview-view-model";

type ForecastView = Exclude<PreschoolOverviewViewModel["forecast"], { status: "unavailable" }>;
type ForecastScope = ForecastView["scopes"][number];
type ForecastGrain = keyof ForecastScope["buckets"];
type ForecastBucket = ForecastScope["buckets"][ForecastGrain][number];

const GRAINS: Array<{ id: ForecastGrain; label: string }> = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
];

export function PreschoolForecastPanel({
  forecast,
}: {
  forecast: PreschoolOverviewViewModel["forecast"];
}) {
  if (forecast.status === "unavailable") return <ForecastUnavailable detail={forecast.detail} />;
  return <AvailableForecastPanel forecast={forecast} />;
}

function AvailableForecastPanel({ forecast }: { forecast: ForecastView }) {
  const [grain, setGrain] = useState<ForecastGrain>("daily");
  const [scopeId, setScopeId] = useState(forecast.defaultScopeId);
  const scope = forecast.scopes.find((candidate) => candidate.scopeId === scopeId)
    ?? forecast.scopes.find((candidate) => candidate.scopeId === forecast.defaultScopeId)
    ?? forecast.scopes[0]!;

  return (
    <div className="mt-5" data-forecast-status={forecast.status} data-forecast-scope={scope.role}>
      <ForecastStatusStrip forecast={forecast} scope={scope} />

      <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ForecastKpi label="Estimated Energy" value={scope.estimatedEnergy} note={forecast.targetPeriod} />
        <ForecastKpi label="Estimated Cost" value={scope.estimatedCost} note="Before GST · planning estimate, not a bill" />
        <ForecastKpi label="Consumed So Far" value={scope.consumedSoFar} note={scope.coverage} />
        <ForecastKpi label="Pace vs Estimate" value={scope.paceVsEstimate} note={scope.paceDetail} />
      </dl>

      <article className="mt-4 overflow-hidden rounded-xl border border-border bg-surface" data-forecast-grain={grain}>
        <div className="flex flex-col gap-4 border-b border-border px-4 py-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h4 className="text-base font-semibold text-foreground">Estimate vs Actual</h4>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
              Dashed Estimate comes from the Saved May Plan. Solid Actual contains only complete June days from the current Snapshot.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="grid min-w-0 gap-1 text-xs font-semibold text-foreground">
              View
              <select
                aria-label="Forecast scope"
                className="h-10 min-w-0 rounded-md border border-border bg-surface px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60 sm:min-w-52"
                disabled={!forecast.centreSelectionAvailable}
                value={scope.scopeId}
                onChange={(event) => setScopeId(event.target.value)}
              >
                {forecast.scopes.map((option) => (
                  <option key={option.scopeId} value={option.scopeId}>
                    {option.role === "portfolio" ? "Portfolio" : option.label}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <span className="block text-xs font-semibold text-foreground">Interval</span>
              <div className="mt-1 inline-flex rounded-md border border-border bg-surface-subtle p-1" aria-label="Forecast interval">
                {GRAINS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={grain === option.id}
                    className={`min-h-8 rounded px-3 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/30 ${grain === option.id ? "bg-foreground text-surface" : "text-muted hover:bg-surface hover:text-foreground"}`}
                    onClick={() => setGrain(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <ForecastTrendChart scope={scope} grain={grain} />
      </article>
    </div>
  );
}

function ForecastStatusStrip({ forecast, scope }: { forecast: ForecastView; scope: ForecastScope }) {
  const tone = forecast.status === "complete"
    ? "border-step-success/30 bg-step-success-soft/45"
    : forecast.status === "partial"
      ? "border-primary/25 bg-primary/5"
      : "border-step-warning/30 bg-step-warning-soft/45";
  const dot = forecast.status === "complete"
    ? "bg-step-success"
    : forecast.status === "partial"
      ? "bg-primary"
      : "bg-step-warning";
  return (
    <div className={`flex flex-col gap-2 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${tone}`} role="status">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className={`mt-1.5 size-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{forecast.statusLabel}</p>
          <p className="mt-0.5 text-xs leading-5 text-muted">{forecast.statusDetail}</p>
        </div>
      </div>
      <p className="shrink-0 text-xs font-semibold text-foreground">{scope.role === "portfolio" ? "Portfolio" : scope.label} · {forecast.targetPeriod}</p>
    </div>
  );
}

function ForecastKpi({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface px-4 py-4" data-forecast-kpi={label}>
      <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">{label}</dt>
      <dd className="mt-2 break-words text-2xl font-semibold tabular-nums tracking-[-0.025em] text-foreground">{value}</dd>
      <dd className="mt-1 text-[11px] leading-5 text-muted">{note}</dd>
    </div>
  );
}

function ForecastTrendChart({ scope, grain }: { scope: ForecastScope; grain: ForecastGrain }) {
  const buckets = scope.buckets[grain];
  const width = 900;
  const height = 340;
  const inset = { top: 30, right: 34, bottom: 58, left: 70 };
  const plotWidth = width - inset.left - inset.right;
  const plotHeight = height - inset.top - inset.bottom;
  const values = buckets.flatMap((bucket) => [bucket.estimateKwh, ...(bucket.actualKwh === null ? [] : [bucket.actualKwh])]);
  const maximum = Math.max(1, ...values) * 1.1;
  const x = (index: number) => buckets.length === 1
    ? inset.left + plotWidth / 2
    : inset.left + (index / (buckets.length - 1)) * plotWidth;
  const y = (value: number) => inset.top + plotHeight - (value / maximum) * plotHeight;
  const estimatePath = linePath(buckets, (bucket) => bucket.estimateKwh, x, y);
  const actualPath = linePath(buckets, (bucket) => bucket.actualKwh, x, y);
  const ticks = Array.from({ length: 5 }, (_, index) => (maximum / 4) * index).reverse();
  const labelStep = Math.max(1, Math.ceil(buckets.length / 6));
  const titleId = `forecast-${scope.scopeId.replace(/[^a-zA-Z0-9_-]/g, "-")}-${grain}-title`;
  const descId = `${titleId}-desc`;

  return (
    <div className="px-3 py-4 sm:px-4">
      {scope.status === "waiting" ? (
        <p className="mb-3 rounded-md border border-step-warning/25 bg-step-warning-soft/40 px-3 py-2 text-xs leading-5 text-muted" role="status">
          Actual not available yet. The Estimate remains visible; no June Actual line is invented.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-xs text-muted" aria-hidden="true">
        <span className="inline-flex items-center gap-2"><span className="w-8 border-t-2 border-dashed border-muted" />Estimate</span>
        <span className="inline-flex items-center gap-2"><span className="w-8 border-t-2 border-foreground" />Actual</span>
        <span>{scope.label} · {scope.coverage}</span>
      </div>
      <div className="mt-3 overflow-hidden rounded-lg bg-surface-subtle/55">
        <svg className="block h-auto w-full" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${titleId} ${descId}`}>
          <title id={titleId}>{`${scope.label} June 2026 ${grain} estimate and actual`}</title>
          <desc id={descId}>Estimate is dashed. Actual is solid and stops where current June complete-day Evidence ends.</desc>
          {ticks.map((tick) => {
            const tickY = y(tick);
            return (
              <g key={tick}>
                <line x1={inset.left} x2={width - inset.right} y1={tickY} y2={tickY} stroke="currentColor" className="text-border" strokeWidth="1" />
                <text x={inset.left - 12} y={tickY + 4} textAnchor="end" className="fill-muted text-[11px] tabular-nums">{formatCompactKwh(tick)}</text>
              </g>
            );
          })}
          <line x1={inset.left} x2={inset.left} y1={inset.top} y2={height - inset.bottom} stroke="currentColor" className="text-border" />
          <line x1={inset.left} x2={width - inset.right} y1={height - inset.bottom} y2={height - inset.bottom} stroke="currentColor" className="text-border" />
          <path d={estimatePath} fill="none" stroke="currentColor" className="text-muted" strokeWidth="3" strokeDasharray="8 7" strokeLinejoin="round" data-series="estimate" />
          <path d={actualPath} fill="none" stroke="currentColor" className="text-foreground" strokeWidth="3" strokeLinejoin="round" data-series="actual" />
          {buckets.map((bucket, index) => (
            <g key={`${bucket.start}-${bucket.endExclusive}`}>
              <circle cx={x(index)} cy={y(bucket.estimateKwh)} r="4" fill="currentColor" className="text-muted">
                <title>{`${bucket.label}: Estimate ${bucket.estimate}; Actual ${bucket.actual}; ${bucket.coverage}`}</title>
              </circle>
              {bucket.actualKwh === null ? null : (
                <circle cx={x(index)} cy={y(bucket.actualKwh)} r="4" fill="currentColor" className="text-foreground">
                  <title>{`${bucket.label}: Actual ${bucket.actual}; ${bucket.coverage}`}</title>
                </circle>
              )}
              {(index % labelStep === 0 || index === buckets.length - 1) ? (
                <text x={x(index)} y={height - inset.bottom + 25} textAnchor="middle" className="fill-muted text-[10px]">{shortAxisLabel(bucket.label)}</text>
              ) : null}
            </g>
          ))}
          <text x="18" y={inset.top + plotHeight / 2} textAnchor="middle" transform={`rotate(-90 18 ${inset.top + plotHeight / 2})`} className="fill-muted text-[11px]">Energy (kWh)</text>
        </svg>
      </div>
      <details className="mt-3 border-t border-border pt-3">
        <summary className="cursor-pointer text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">View accessible chart values</summary>
        <div className="mt-3 max-h-64 overflow-y-auto overscroll-contain rounded-md border border-border" tabIndex={0} aria-label={`${scope.label} ${grain} Forecast values`}>
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-surface-subtle text-muted">
              <tr><th className="px-3 py-2 font-semibold">Period</th><th className="px-3 py-2 font-semibold">Estimate</th><th className="px-3 py-2 font-semibold">Actual</th><th className="px-3 py-2 font-semibold">Coverage</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {buckets.map((bucket) => (
                <tr key={`${bucket.start}-${bucket.endExclusive}`}><td className="px-3 py-2">{bucket.label}</td><td className="px-3 py-2 tabular-nums">{bucket.estimate}</td><td className="px-3 py-2 tabular-nums">{bucket.actual}</td><td className="px-3 py-2 text-muted">{bucket.coverage}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function ForecastUnavailable({ detail }: { detail: string }) {
  return (
    <div className="mt-5" data-forecast-status="unavailable">
      <div className="rounded-lg border border-step-warning/30 bg-step-warning-soft/45 px-4 py-3" role="status">
        <p className="text-sm font-semibold text-foreground">Forecast unavailable for this Snapshot</p>
        <p className="mt-1 text-xs leading-5 text-muted">{detail}</p>
      </div>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Estimated Energy", "Saved Plan series unavailable"],
          ["Estimated Cost", "Saved Plan series unavailable"],
          ["Consumed So Far", "Current Actual series unavailable"],
          ["Pace vs Estimate", "Like-for-like dates unavailable"],
        ].map(([label, note]) => <ForecastKpi key={label} label={label!} value="Unavailable" note={note!} />)}
      </dl>
    </div>
  );
}

function linePath(
  buckets: ForecastBucket[],
  value: (bucket: ForecastBucket) => number | null,
  x: (index: number) => number,
  y: (value: number) => number,
): string {
  let drawing = false;
  return buckets.flatMap((bucket, index) => {
    const current = value(bucket);
    if (current === null) {
      drawing = false;
      return [];
    }
    const command = drawing ? "L" : "M";
    drawing = true;
    return [`${command}${x(index).toFixed(2)},${y(current).toFixed(2)}`];
  }).join(" ");
}

function formatCompactKwh(value: number): string {
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return Math.round(value).toLocaleString("en-SG");
}

function shortAxisLabel(label: string): string {
  return label.replace(/ Jun/g, "");
}
