"use client";

import React, { useState } from "react";

import { NgeeAnnHourAxis } from "./ngee-ann-hour-axis";
import type { NgeeAnnDayProfileViewModel } from "./ngee-ann-overview-view-model";

export function NgeeAnnDayProfile({ view }: { view: NgeeAnnDayProfileViewModel }) {
  const [selectedScopeId, setSelectedScopeId] = useState(view.scopes[0]?.id ?? "");
  const [selectedDayType, setSelectedDayType] = useState<"weekday" | "weekend" | "public_holiday">("weekday");
  const [activePointId, setActivePointId] = useState<string | null>(null);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);

  if (view.status === "unavailable") {
    return (
      <TimeModuleUnavailable
        heading="Day profile"
        headingId="ngee-ann-day-profile"
        question={view.decisionQuestion}
        reason={view.reason}
      />
    );
  }

  const profile = view.profiles.find((candidate) => (
    candidate.scopeId === selectedScopeId && candidate.dayType === selectedDayType
  )) ?? view.profiles[0]!;
  const activePoint = profile.values.find((point) => point.id === activePointId)
    ?? profile.values.find((point) => point.id === selectedPointId)
    ?? null;
  let maximumUsageKwh = 0;
  for (const point of profile.values) {
    if (point.acceptedUsageKwh > maximumUsageKwh) maximumUsageKwh = point.acceptedUsageKwh;
  }
  const averageUsageKwh = profile.values.length === 0
    ? 0
    : profile.values.reduce((total, point) => total + point.acceptedUsageKwh, 0) / profile.values.length;
  const averageHeight = maximumUsageKwh <= 0 ? 0 : averageUsageKwh / maximumUsageKwh * 100;
  const activeDifferencePct = activePoint && averageUsageKwh > 0
    ? (activePoint.acceptedUsageKwh - averageUsageKwh) / averageUsageKwh * 100
    : null;

  const resetPoint = () => {
    setActivePointId(null);
    setSelectedPointId(null);
  };

  return (
    <section aria-labelledby="ngee-ann-day-profile" className="border-b border-border px-5 py-5 lg:px-7 lg:py-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h3 id="ngee-ann-day-profile" className="text-base font-semibold tracking-[-0.015em] text-foreground">
            Day profile
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted">{view.decisionQuestion}</p>
        </div>
        <p className="text-[11px] leading-5 text-muted">
          Mean of complete local days / {view.evidence.timezone} / {view.evidence.unit}
        </p>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <fieldset>
          <legend className="mb-2 text-[10px] font-semibold text-muted">Day Profile type</legend>
          <div className="flex flex-wrap gap-1.5">
            {(["weekday", "weekend", "public_holiday"] as const).map((dayType) => {
              const selected = profile.dayType === dayType;
              const label = dayType === "weekday" ? "Weekday" : dayType === "weekend" ? "Weekend" : "Public Holiday";
              return (
                <button
                  key={dayType}
                  type="button"
                  aria-pressed={selected}
                  aria-controls="ngee-ann-day-profile-chart"
                  className={filterClassName(selected)}
                  onClick={() => {
                    setSelectedDayType(dayType);
                    resetPoint();
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-[10px] font-semibold text-muted">Day Profile Scope</legend>
          <div className="flex flex-wrap gap-1.5">
            {view.scopes.map((scope) => {
              const selected = scope.id === profile.scopeId;
              return (
                <button
                  key={scope.id}
                  type="button"
                  aria-pressed={selected}
                  aria-controls="ngee-ann-day-profile-chart"
                  className={filterClassName(selected)}
                  onClick={() => {
                    setSelectedScopeId(scope.id);
                    resetPoint();
                  }}
                >
                  {scope.name}
                </button>
              );
            })}
          </div>
        </fieldset>
      </div>

      {profile.status === "unavailable" ? (
        <div id="ngee-ann-day-profile-chart" className="mt-4 rounded-lg border border-border bg-surface-subtle px-4 py-5" role="status">
          <p className="text-xs font-semibold text-foreground">{profile.dayTypeLabel} / {profile.scopeName} unavailable</p>
          <p className="mt-1 text-[11px] leading-5 text-muted">{profile.reason}</p>
          <p className="mt-2 text-[10px] leading-4 text-muted-light">No value is inferred or zero-filled for this selection.</p>
        </div>
      ) : (
        <>
          <div id="ngee-ann-day-profile-chart" className="mt-4 overflow-x-auto pb-1">
            <div className="min-w-[1040px]">
              <div className="mb-2 flex items-center justify-between text-[10px] text-muted">
                <span>Mean accepted energy / kWh</span>
                <span>{profile.sampleDayCount} complete {profile.sampleDayCount === 1 ? "day" : "days"} / 24 server values</span>
              </div>
              <div data-hour-plot="day-profile" className="relative h-52 border-b border-border">
                <div
                  className="grid h-full items-end gap-1 px-2"
                  style={{ gridTemplateColumns: "repeat(24, minmax(32px, 1fr))" }}
                >
                  {profile.values.map((point) => {
                    const selected = selectedPointId === point.id;
                    const aboveAverage = point.acceptedUsageKwh > averageUsageKwh;
                    const height = maximumUsageKwh <= 0 ? 0 : Math.max(4, (point.acceptedUsageKwh / maximumUsageKwh) * 100);
                    return (
                      <button
                        key={point.id}
                        type="button"
                        aria-label={`${profile.dayTypeLabel} ${profile.scopeName} ${point.hourLabel}: ${point.usageKwh} kWh`}
                        aria-pressed={selected}
                        className="group relative z-10 flex h-full min-w-0 items-end justify-center rounded-t px-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                        onMouseEnter={() => setActivePointId(point.id)}
                        onMouseLeave={() => setActivePointId(null)}
                        onFocus={() => setActivePointId(point.id)}
                        onBlur={() => setActivePointId(null)}
                        onClick={() => setSelectedPointId(point.id)}
                      >
                        <span
                          className={aboveAverage
                            ? "w-full rounded-t bg-step-inspect/75 group-hover:bg-step-inspect group-focus-visible:bg-step-inspect"
                            : "w-full rounded-t bg-primary/35 group-hover:bg-primary/70 group-focus-visible:bg-primary/70"}
                          style={{ height: `${height}%` }}
                          aria-hidden="true"
                        />
                      </button>
                    );
                  })}
                </div>
                {averageHeight > 0 ? (
                  <div
                    className="pointer-events-none absolute inset-x-2 z-20 border-t border-dashed border-step-inspect/70"
                    style={{ bottom: `${averageHeight}%` }}
                    aria-hidden="true"
                  >
                    <span className="absolute -top-4 right-0 bg-surface px-1 text-[9px] font-semibold text-step-inspect">
                      Mean {averageUsageKwh.toFixed(2)} kWh
                    </span>
                  </div>
                ) : null}
              </div>
              <NgeeAnnHourAxis points={profile.values} axis="day-profile" />
            </div>
          </div>
          <div className="mt-4 min-h-[78px] rounded-lg bg-surface-subtle px-4 py-3" aria-live="polite" aria-atomic="true">
            {activePoint ? (
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-foreground">{profile.dayTypeLabel} / {profile.scopeName}</p>
                  <p className="mt-1 text-[10px] text-muted">{profile.sampleDayCount} complete-day samples / mean_of_complete_local_days</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums text-foreground">{activePoint.hourLabel} / {activePoint.usageKwh} kWh</p>
                  {activeDifferencePct !== null ? (
                    <p className={activeDifferencePct > 0 ? "mt-1 text-[10px] font-semibold text-step-inspect" : "mt-1 text-[10px] text-muted"}>
                      {activeDifferencePct > 0 ? "+" : ""}{activeDifferencePct.toFixed(1)}% vs profile mean
                    </p>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="text-[11px] leading-5 text-muted">
                Hover or focus an hour to inspect its server-provided mean. Press Enter or Space to keep its detail open.
              </p>
            )}
          </div>
        </>
      )}

      <TimeEvidence label="Day Profile evidence" evidence={view.evidence} />
    </section>
  );
}

function TimeModuleUnavailable({
  heading,
  headingId,
  question,
  reason,
}: {
  heading: string;
  headingId: string;
  question: string;
  reason: string | null;
}) {
  return (
    <section aria-labelledby={headingId} className="border-b border-border px-5 py-5 lg:px-7 lg:py-6">
      <h3 id={headingId} className="text-base font-semibold tracking-[-0.015em] text-foreground">{heading}</h3>
      <p className="mt-1 text-xs leading-5 text-muted">{question}</p>
      <div className="mt-4 rounded-lg border border-border bg-surface-subtle px-4 py-4" role="status">
        <p className="text-xs font-semibold text-foreground">{heading} unavailable</p>
        <p className="mt-1 text-[11px] leading-5 text-muted">{reason}</p>
      </div>
    </section>
  );
}

function TimeEvidence({
  label,
  evidence,
}: {
  label: string;
  evidence: NgeeAnnDayProfileViewModel["evidence"];
}) {
  return (
    <details className="mt-4 border-t border-border pt-3 text-[10px] leading-4 text-muted">
      <summary className="cursor-pointer font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
        {label} / time_bucket_grid_v1
      </summary>
      <dl className="mt-2 grid gap-x-3 gap-y-1 sm:grid-cols-[80px_minmax(0,1fr)]">
        <dt>Snapshot</dt><dd className="break-all font-mono text-foreground">{evidence.snapshotId}</dd>
        <dt>Release</dt><dd className="break-all font-mono text-foreground">{evidence.projectReleaseId}</dd>
        <dt>Mapping</dt><dd className="break-all font-mono text-foreground">{evidence.meterMappingRevisionId}</dd>
        <dt>Formula</dt><dd className="break-all font-mono text-foreground">{evidence.meterFormulaRevisionId}</dd>
        <dt>Metric</dt><dd className="break-all font-mono text-foreground">{evidence.metricId}</dd>
        <dt>Period</dt><dd className="break-words text-foreground">{evidence.period}</dd>
        <dt>Timezone</dt><dd className="text-foreground">{evidence.timezone}</dd>
        <dt>Unit</dt><dd className="text-foreground">{evidence.unit}</dd>
        <dt>Query</dt><dd className="break-all font-mono text-foreground">{evidence.queryIds.join(", ")}</dd>
      </dl>
    </details>
  );
}

function filterClassName(selected: boolean): string {
  return selected
    ? "min-h-11 rounded-lg border border-primary bg-primary/10 px-3 py-2 text-[11px] font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
    : "min-h-11 rounded-lg border border-border px-3 py-2 text-[11px] font-semibold text-muted hover:bg-surface-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";
}

export { TimeEvidence, TimeModuleUnavailable, filterClassName };
