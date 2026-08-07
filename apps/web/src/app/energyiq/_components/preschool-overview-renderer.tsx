import React from "react";

import type { EnergyProjectAnalysisSnapshotDto } from "../../../lib/config-api";
import { EnergyIcon } from "./icons";
import { PreschoolEvidenceLink } from "./preschool-evidence-link";
import { PreschoolAiSlot } from "./preschool-ai-slot";
import {
  buildPreschoolOverviewViewModel,
  type PreschoolDecisionSummaryItem,
  type PreschoolOverviewCentre,
  type PreschoolOverviewViewModel,
  type PreschoolOperationalCentre,
} from "./preschool-overview-view-model";

export type PreschoolOverviewRendererState =
  | {
    status: "loading" | "empty" | "unsupported" | "error";
    title: string;
    detail: string;
  }
  | {
    status: "ready";
    snapshot: EnergyProjectAnalysisSnapshotDto;
  };

export function PreschoolOverviewRenderer({
  state,
  onRetry,
  aiAnalystHref,
}: {
  state: PreschoolOverviewRendererState;
  onRetry?: () => void;
  aiAnalystHref?: string;
}) {
  if (state.status !== "ready") {
    return (
      <section className="rounded-xl border border-border bg-surface p-6" role="status">
        <h2 className="text-base font-semibold text-foreground">{state.title}</h2>
        <p className="mt-2 text-sm leading-6 text-muted">{state.detail}</p>
        {state.status === "error" && onRetry ? (
          <button type="button" onClick={onRetry} className="mt-4 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white">
            Try again
          </button>
        ) : null}
      </section>
    );
  }

  const view = buildPreschoolOverviewViewModel(state.snapshot);
  const statusClass = view.dataStatus.status === "complete"
    ? "border-step-success/30 bg-step-success-soft text-step-success"
    : view.dataStatus.status === "partial"
      ? "border-step-warning/30 bg-step-warning-soft text-step-warning"
      : "border-step-error/30 bg-step-error-soft text-step-error";

  return (
    <section
      aria-label="Preschool published portfolio energy analysis"
      data-preschool-overview="true"
      data-data-status={view.dataStatus.status}
      className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-card)]"
    >
      <header className="grid gap-5 border-b border-border px-5 py-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:px-7">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{view.context.projectName}</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-foreground">Portfolio energy overview</h2>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
            <span className="inline-flex items-center gap-1.5"><EnergyIcon name="calendar" className="h-3.5 w-3.5 text-muted-light" />{view.context.period}</span>
            <span>{view.context.timezone}</span>
          </div>
        </div>
        <div className={`rounded-lg border px-4 py-3 ${statusClass}`} role="status">
          <p className="text-sm font-semibold">{view.dataStatus.label}</p>
          <p className="mt-1 text-xs text-muted">{view.dataStatus.coverage}</p>
          <details className="mt-1">
            <summary className="cursor-pointer text-xs font-medium text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">Data details</summary>
            <p className="mt-1 text-xs leading-5 text-muted">{view.dataStatus.intervals} · {view.dataStatus.qualityEvents}</p>
          </details>
        </div>
      </header>

      <div className="grid divide-y divide-border border-b border-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-5">
        {view.highlights.map((highlight) => (
          <div key={highlight.id} className="min-w-0 px-5 py-4">
            <p className="text-xs font-semibold text-muted">{highlight.label}</p>
            <p className={`mt-2 text-2xl font-semibold tabular-nums ${highlight.available ? "text-foreground" : "text-muted"}`}>{highlight.value}</p>
            <p className="mt-2 text-xs leading-5 text-muted">{highlight.detail}</p>
          </div>
        ))}
      </div>

      <section id="preschool-decision-summary" aria-labelledby="preschool-decision-summary-heading" className="scroll-mt-28 border-b border-border bg-surface-subtle/45 px-5 py-7 lg:px-7 lg:py-8">
        <div>
          <h3 id="preschool-decision-summary-heading" className="text-lg font-semibold tracking-[-0.015em] text-foreground">Takeaways and next decisions</h3>
          <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted">Start here: the Portfolio issues worth attention and the next check for each one.</p>
        </div>
        {view.decisionSummary.items.length > 0 ? (
          <div className="mt-4 space-y-3">
            {view.decisionSummary.items.map((item) => (
              <DecisionSummaryCard key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-border bg-surface-subtle p-4" role="status">
            <p className="text-sm font-semibold text-muted">Decision summary unavailable</p>
            <p className="mt-2 text-sm leading-6 text-muted">{view.decisionSummary.detail}</p>
          </div>
        )}
        {view.decisionSummary.items.length > 0 ? (
          <p className="mt-4 text-xs leading-5 text-muted">{view.decisionSummary.detail}</p>
        ) : null}
      </section>

      <div id="preschool-ai-analysis" className="scroll-mt-28">
        <PreschoolAiSlot
          snapshot={state.snapshot}
          decisionSummary={view.decisionSummary}
          {...(aiAnalystHref ? { aiAnalystHref } : {})}
        />
      </div>

      <section id="preschool-appliance-ranking" aria-labelledby="preschool-appliance-ranking-heading" className="scroll-mt-28 border-b border-border px-5 py-7 lg:px-7 lg:py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 id="preschool-appliance-ranking-heading" className="text-lg font-semibold tracking-[-0.015em] text-foreground">Where energy goes</h3>
            <p className="mt-1.5 text-sm leading-6 text-muted">See which Appliances contribute most before choosing where to investigate.</p>
          </div>
          {view.appliances.status === "available" ? (
            <p className="text-xs font-semibold tabular-nums text-foreground">{view.appliances.totalEnergy} · 9 Appliances</p>
          ) : null}
        </div>
        {view.appliances.status === "available" ? (
          <div className="mt-4">
            <div className="divide-y divide-border border-y border-border" role="list" aria-label="Portfolio Appliance energy ranking">
              {view.appliances.rows.map((appliance, index) => (
                <div key={appliance.name} className="grid gap-2 py-3 sm:grid-cols-[minmax(150px,0.8fr)_minmax(220px,1.5fr)_170px] sm:items-center sm:gap-4" role="listitem">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{index + 1}. {appliance.name}</p>
                    <p className="mt-0.5 text-xs text-muted">{appliance.applianceGroup} · {appliance.centreCount} Centres</p>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-surface-subtle" aria-hidden="true">
                    <div
                      className={`h-full rounded-full ${applianceBarClass(appliance.applianceGroup)}`}
                      style={{ width: `${Math.max(2, appliance.relativeToTopPct)}%` }}
                    />
                  </div>
                  <div className="flex items-baseline justify-between gap-3 tabular-nums sm:justify-end">
                    <span className="text-sm font-semibold text-foreground">{appliance.energy}</span>
                    <span className="w-14 text-right text-xs text-muted">{appliance.share}</span>
                  </div>
                </div>
              ))}
            </div>
            <details className="mt-4 border-t border-border pt-3">
              <summary className="cursor-pointer text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">Appliance calculation note</summary>
              <p className="mt-2 text-xs leading-5 text-muted">{view.appliances.detail}</p>
            </details>
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-border bg-surface-subtle p-4" role="status">
            <p className="text-xs font-semibold text-muted">Appliance ranking unavailable</p>
            <p className="mt-2 text-[11px] leading-5 text-muted">{view.appliances.detail}</p>
          </div>
        )}
      </section>

      <section id="preschool-efficiency-benchmark" aria-labelledby="preschool-efficiency-benchmark-heading" className="scroll-mt-28 border-b border-border px-5 py-7 lg:px-7 lg:py-8">
        {view.benchmark.status === "provisional" ? (
          <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 id="preschool-efficiency-benchmark-heading" className="text-lg font-semibold tracking-[-0.015em] text-foreground">Efficiency benchmark</h3>
                <span className="rounded-full border border-step-warning/30 bg-step-warning-soft px-2.5 py-1 text-xs font-semibold text-step-warning">Provisional</span>
              </div>
              <p className="mt-1.5 text-sm leading-6 text-muted">Find Centres that are high on both annualised EUI and May per-pax usage.</p>
            </div>
            <p className="text-sm font-semibold text-step-error">Review first: {view.benchmark.priorityCentreCodes.join(" · ")}</p>
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0">
              <BenchmarkScatterPlot benchmark={view.benchmark} />
              <div className="mt-3 grid overflow-hidden rounded-lg border border-border sm:grid-cols-2 xl:grid-cols-4">
                {view.benchmark.quadrants.map((quadrant) => (
                  <div key={quadrant.id} className={`min-h-24 border-border p-3 sm:[&:nth-child(odd)]:border-r sm:[&:nth-child(-n+2)]:border-b xl:border-b-0 xl:[&:not(:last-child)]:border-r ${quadrant.id === "priority" ? "bg-step-error-soft" : "bg-surface-subtle"}`}>
                    <div className="flex items-center justify-between gap-3">
                      <p className={`text-[11px] font-semibold ${quadrant.id === "priority" ? "text-step-error" : "text-foreground"}`}>{quadrant.label}</p>
                      <span className="text-[10px] tabular-nums text-muted">{quadrant.centreCodes.length}</span>
                    </div>
                    <p className="mt-2 text-xs font-semibold tracking-wide text-foreground">{quadrant.centreCodes.join(" · ") || "None"}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-surface-subtle p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-light">Portfolio cross-hairs · n={view.benchmark.sampleSize}</p>
              <dl className="mt-3 space-y-3 text-xs">
                <ReadinessRow label="EUI P50" value={`${view.benchmark.eui.p50} kWh/m²/yr`} />
                <ReadinessRow label="EUI P75" value={`${view.benchmark.eui.p75} kWh/m²/yr`} />
                <ReadinessRow label="Per-pax P50" value={`${view.benchmark.perPax.p50} kWh/person`} />
                <ReadinessRow label="Per-pax P75" value={`${view.benchmark.perPax.p75} kWh/person`} />
              </dl>
              <p className="mt-4 border-t border-border pt-3 text-[11px] leading-5 text-muted">{view.benchmark.detail}</p>
            </div>
          </div>
          <div className="mt-5 border-t border-border pt-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h4 className="text-base font-semibold text-foreground">Peer benchmark distributions</h4>
                <p className="mt-1 text-sm leading-6 text-muted">Empirical distribution — not a fitted bell curve. Each dot is one Centre; P50 shows the typical range and P75 marks where review should begin.</p>
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-step-warning">Provisional</span>
            </div>
            <div className="mt-4 grid gap-4 2xl:grid-cols-2">
              {view.benchmark.distributions.map((distribution) => (
                <BenchmarkDistributionPlot key={distribution.id} distribution={distribution} />
              ))}
            </div>
          </div>
          </>
        ) : (
          <div role="status">
            <h3 id="preschool-efficiency-benchmark-heading" className="text-lg font-semibold tracking-[-0.015em] text-foreground">Efficiency benchmark</h3>
            <p className="mt-1.5 text-sm leading-6 text-muted">This Snapshot does not yet support a reliable peer comparison.</p>
            <p className="mt-3 text-sm leading-6 text-muted">{view.benchmark.detail}</p>
          </div>
        )}
      </section>

      <section id="preschool-operational-behaviour" aria-labelledby="preschool-operational-behaviour-heading" className="scroll-mt-28 border-b border-border px-5 py-7 lg:px-7 lg:py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 id="preschool-operational-behaviour-heading" className="text-lg font-semibold tracking-[-0.015em] text-foreground">Operating patterns</h3>
              {view.operational.status === "available" ? (
                <span className="rounded-full border border-step-warning/30 bg-step-warning-soft px-2 py-0.5 text-[10px] font-semibold text-step-warning">Provisional SOP signal</span>
              ) : null}
            </div>
            <p className="mt-1.5 text-sm leading-6 text-muted">See where energy use continues outside operating hours and which Centres repeat the same hourly Spike.</p>
          </div>
          {view.operational.status === "available" ? (
            <p className="text-[11px] text-muted-light">Calendar {view.operational.calendarVersion} · {view.operational.threshold}</p>
          ) : null}
        </div>

        {view.operational.status === "available" ? (
          <>
            <div className="mt-4">
              <OperatingProfileChart profile={view.operational.hourlyProfile} />
            </div>
            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_320px]">
              <OperationalSpikePanel
                title="Standby / closed hours"
                energy={`${view.operational.standby.energy} · ${view.operational.standby.share}`}
                spikeCount={view.operational.standby.spikeCount}
                centreCount={view.operational.standby.centreCount}
                centres={view.operational.standby.centres}
                tone="warning"
              />
              <OperationalSpikePanel
                title="Operating hours"
                energy={view.operational.operating.energy}
                spikeCount={view.operational.operating.spikeCount}
                centreCount={view.operational.operating.centreCount}
                centres={view.operational.operating.centres}
                tone="default"
              />
              <div className="rounded-lg border border-step-warning/30 bg-step-warning-soft p-4">
                <p className="text-xs font-semibold text-step-warning">{view.operational.sop.label}</p>
                <p className="mt-2 text-xl font-semibold tabular-nums text-foreground">
                  {view.operational.sop.breachingCentreCodes.join(" · ") || "No signal"}
                </p>
                <div className="mt-3 space-y-2">
                  {view.operational.sop.centres.map((centre) => (
                    <div
                      key={centre.centreCode}
                      data-sop-centre-type={centre.centreType ?? "Unavailable"}
                      className="flex items-center justify-between gap-3 rounded-md border border-step-warning/20 bg-surface/70 px-3 py-2 text-xs"
                    >
                      <span className="min-w-0">
                        <span className="block font-semibold text-foreground">{centre.centreCode}</span>
                        <span className="mt-0.5 block truncate text-[10px] text-muted-light">{centre.centreType ?? "Type unavailable"}</span>
                      </span>
                      <span className="text-muted">{centre.standbySpikeCount} Spike{centre.standbySpikeCount === 1 ? "" : "s"}</span>
                      <span className="font-semibold tabular-nums text-step-warning">{centre.score}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[11px] leading-5 text-muted">{view.operational.sop.detail}</p>
              </div>
            </div>
          </>
        ) : (
          <div className="mt-4 rounded-lg border border-border bg-surface-subtle p-4" role="status">
            <p className="text-xs font-semibold text-muted">Unavailable</p>
            <p className="mt-2 text-[11px] leading-5 text-muted">{view.operational.detail}</p>
          </div>
        )}
      </section>

      <section aria-labelledby="preschool-planning-outlook" className="border-b border-border bg-surface-subtle/35 px-5 py-7 lg:px-7 lg:py-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 id="preschool-planning-outlook" className="text-lg font-semibold tracking-[-0.015em] text-foreground">June planning baseline</h3>
              {view.planningOutlook.status === "provisional" ? (
                <span className="rounded-full border border-step-warning/30 bg-step-warning-soft px-2.5 py-1 text-xs font-semibold text-step-warning">Estimated · Provisional</span>
              ) : null}
            </div>
            <p className="mt-1.5 text-sm leading-6 text-muted">A transparent planning reference from accepted May facts — not an AI forecast or customer bill.</p>
          </div>
          <span className="text-xs text-muted">Live Forecast: {view.liveForecast.label}</span>
        </div>
        {view.planningOutlook.status === "provisional" ? (
          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
            <PlanningBaselineChart outlook={view.planningOutlook} />
            <div className="rounded-lg border border-step-warning/30 bg-step-warning-soft/30 p-4">
              <p className="text-sm font-semibold text-foreground">If May's complete-week pattern repeats</p>
              <dl className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted">June energy</dt>
                  <dd className="mt-1 text-xl font-semibold tabular-nums text-foreground">{view.planningOutlook.projectedUsage}</dd>
                  <dd className="mt-1 text-xs text-muted">Observed-week range {view.planningOutlook.projectedRange}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">June cost before GST</dt>
                  <dd className="mt-1 text-xl font-semibold tabular-nums text-foreground">{view.planningOutlook.projectedCost}</dd>
                  <dd className="mt-1 text-xs text-muted">Reference range {view.planningOutlook.projectedCostRange}</dd>
                </div>
              </dl>
              <div className="mt-4 border-t border-step-warning/20 pt-4 text-xs leading-5 text-muted">
                <p><strong className="font-semibold text-foreground">Rate:</strong> {view.planningOutlook.tariffRate}</p>
                <p className="mt-1">{view.planningOutlook.tariffLabel}</p>
                <a className="mt-2 inline-flex font-semibold text-primary hover:underline" href={view.planningOutlook.tariffSourceUrl} target="_blank" rel="noreferrer">View official SP tariff source</a>
              </div>
              <details className="mt-4 border-t border-step-warning/20 pt-3">
                <summary className="cursor-pointer text-xs font-semibold text-foreground">Assumptions and limitations</summary>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-muted">
                  {view.planningOutlook.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
                </ul>
              </details>
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-border bg-surface-subtle p-4" role="status">
            <p className="text-sm font-semibold text-muted">Planning baseline unavailable</p>
            <p className="mt-2 text-sm leading-6 text-muted">{view.planningOutlook.detail}</p>
          </div>
        )}
        <p className="mt-3 text-xs leading-5 text-muted">{view.liveForecast.detail}</p>
      </section>

      <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section id="preschool-centre-ranking" aria-labelledby="preschool-centre-ranking-heading" className="min-w-0 scroll-mt-28 px-5 py-7 lg:px-7 lg:py-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 id="preschool-centre-ranking-heading" className="text-lg font-semibold tracking-[-0.015em] text-foreground">Centre detail</h3>
              <p className="mt-1.5 text-sm leading-6 text-muted">Start with the five largest contributors; open the remaining Centres only when you need them.</p>
            </div>
            <span className="text-xs text-muted">Top 5 of {view.centres.length} Centres</span>
          </div>
          <div className="mt-4 grid gap-3" role="list" aria-label="Top five Centres by Portfolio energy contribution">
            {view.centres.slice(0, 5).map((centre) => (
              <div key={centre.id} className="grid gap-2 sm:grid-cols-[minmax(180px,0.7fr)_minmax(220px,1.5fr)_160px] sm:items-center sm:gap-4" role="listitem">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-foreground">{centre.rank}. {centre.name}</p>
                  <p className="mt-0.5 text-[11px] text-muted">{centre.cohort ?? "Cohort unavailable"} · {centre.topCircuit ?? "Leading appliance unavailable"}</p>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-surface-subtle" aria-hidden="true">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, (centre.usageKwhValue / (view.centres[0]?.usageKwhValue ?? 1)) * 100)}%` }} />
                </div>
                <p className="text-right text-xs tabular-nums text-foreground"><strong className="font-semibold">{centre.usageKwh} kWh</strong> · {centre.sharePct}</p>
              </div>
            ))}
          </div>
          <details className="mt-5 rounded-lg border border-border bg-surface-subtle/40">
            <summary className="cursor-pointer px-4 py-3 text-xs font-semibold text-foreground">View all {view.centres.length} Centres and normalised metrics</summary>
            <div className="overflow-x-auto border-t border-border">
              <table className="min-w-[1020px] w-full border-collapse text-left text-xs">
              <thead className="bg-surface-subtle text-[10px] uppercase tracking-[0.07em] text-muted-light">
                <tr>
                  <th className="px-3 py-2.5 font-semibold">Rank</th>
                  <th className="px-3 py-2.5 font-semibold">Centre</th>
                  <th className="px-3 py-2.5 font-semibold">Cohort</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Energy</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Share</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Annualised EUI</th>
                  <th className="px-3 py-2.5 text-right font-semibold">May per pax</th>
                  <th className="px-3 py-2.5 font-semibold">Quadrant</th>
                  <th className="px-3 py-2.5 font-semibold">Leading appliance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {view.centres.map((centre) => <CentreRow key={centre.id} centre={centre} />)}
              </tbody>
              </table>
            </div>
          </details>
        </section>

        <aside className="border-t border-border bg-surface-subtle px-5 py-5 xl:border-l xl:border-t-0 lg:px-7 lg:py-6">
          <h3 className="text-base font-semibold text-foreground">Data confidence</h3>
          <p className="mt-1.5 text-sm leading-6 text-muted">The decisions use the same published Snapshot. Technical IDs stay available when you need to audit them.</p>
          <details id="preschool-evidence" tabIndex={-1} className="mt-5 scroll-mt-28 border-t border-border pt-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
            <summary className="cursor-pointer text-sm font-semibold text-foreground">View normalisation and evidence</summary>
            <dl className="mt-4 space-y-3 text-xs">
              <ReadinessRow label="EUI coverage" value={`${view.normalisation.euiAvailableCount} / ${view.normalisation.totalCentreCount} Centres`} />
              <ReadinessRow label="Per-pax coverage" value={`${view.normalisation.perPaxAvailableCount} / ${view.normalisation.totalCentreCount} Centres`} />
              <ReadinessRow label="Metadata" value={titleCase(view.normalisation.status)} />
              <ReadinessRow label="Period" value={view.context.period} />
              <ReadinessRow label="Snapshot" value={view.evidence.snapshotId} mono />
              <ReadinessRow label="Release" value={view.evidence.projectReleaseId} mono />
              <ReadinessRow label="References" value={String(view.evidence.referenceCount)} />
              <ReadinessRow label="Import batches" value={String(view.evidence.importBatchCount)} />
              <ReadinessRow label="Queries" value={view.evidence.queryIds.join(", ") || "Unavailable"} mono />
              <ReadinessRow label="Benchmark" value={view.evidence.benchmarkRecipeIds.join(", ") || "Unavailable"} mono />
              <ReadinessRow label="Appliances" value={view.evidence.applianceRecipeIds.join(", ") || "Unavailable"} mono />
              <ReadinessRow label="Appliance source" value="Published Circuit aliases" />
              <ReadinessRow label="Operations" value={view.evidence.operationalRecipeIds.join(", ") || "Unavailable"} mono />
              <ReadinessRow label="Planning" value={view.evidence.planningRecipeIds.join(", ") || "Unavailable"} mono />
            </dl>
          </details>
        </aside>
      </div>
    </section>
  );
}

function DecisionSummaryCard({ item }: { item: PreschoolDecisionSummaryItem }) {
  const toneClass = item.id === "after-hours"
    ? "border-step-warning/30 bg-step-warning-soft/30"
    : item.id === "efficiency"
      ? "border-step-error/30 bg-step-error-soft/30"
      : "border-border bg-surface-subtle";
  const signalClass = item.id === "after-hours"
    ? "fill-step-warning"
    : item.id === "efficiency"
      ? "fill-step-error"
      : "fill-primary";
  return (
    <article
      className={`min-w-0 rounded-xl border p-5 lg:p-6 ${toneClass}`}
      data-decision-priority={item.id}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-primary">Priority {item.priority}</p>
          <h4 className="mt-1.5 max-w-4xl text-lg font-semibold leading-7 text-foreground">{item.finding}</h4>
        </div>
        <span className="shrink-0 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-muted">
          {item.label}
        </span>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(240px,0.72fr)_minmax(0,1.5fr)]">
        <div
          data-decision-signal={item.id}
          role="img"
          aria-label={`${item.signal.label}: ${item.signal.valueLabel} ${item.signal.referenceLabel}`}
        >
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="font-semibold text-foreground">{item.signal.label}</span>
            <span className="shrink-0 tabular-nums text-muted"><strong className="font-semibold text-foreground">{item.signal.valueLabel}</strong> {item.signal.referenceLabel}</span>
          </div>
          <svg
            viewBox={`0 0 ${item.signal.max} 6`}
            preserveAspectRatio="none"
            aria-hidden="true"
            className="mt-2 h-1.5 w-full overflow-hidden rounded-full"
          >
            <rect width={item.signal.max} height="6" rx="3" className="fill-border" />
            <rect width={item.signal.value} height="6" rx="3" className={signalClass} />
          </svg>
        </div>
        <dl className="grid min-w-0 gap-x-8 gap-y-4 text-sm leading-6 sm:grid-cols-2">
          <DecisionField label="Why it matters" value={item.why} />
          <DecisionField label="Do next" value={item.action} />
          <DecisionField label="Verify with" value={item.verification} className="sm:col-span-2" />
        </dl>
      </div>
      <details className="mt-5 border-t border-border/80 pt-4">
        <summary className="cursor-pointer text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
          Expected outcome, evidence and limits
        </summary>
        <dl className="mt-4 grid gap-x-8 gap-y-4 text-sm leading-6 sm:grid-cols-2">
          <DecisionField label="What the data shows" value={item.what} />
          <DecisionField label="If acted on" value={item.ifActed} />
          <DecisionField label="If ignored" value={item.ifIgnored} />
          <DecisionField label="Limitation" value={item.limitation} />
        </dl>
      </details>
      <PreschoolEvidenceLink label="View supporting evidence" />
    </article>
  );
}

function DecisionField({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="font-semibold text-foreground">{label}</dt>
      <dd className="mt-1 text-muted">{value}</dd>
    </div>
  );
}

type BenchmarkView = Extract<PreschoolOverviewViewModel["benchmark"], { status: "provisional" }>;

function BenchmarkScatterPlot({ benchmark }: { benchmark: BenchmarkView }) {
  const width = 760;
  const height = 360;
  const margin = { top: 28, right: 30, bottom: 54, left: 66 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const euiValues = benchmark.scatter.points.map((point) => point.eui);
  const perPaxValues = benchmark.scatter.points.map((point) => point.perPax);
  const euiRange = Math.max(...euiValues) - Math.min(...euiValues);
  const perPaxRange = Math.max(...perPaxValues) - Math.min(...perPaxValues);
  const euiMin = Math.max(0, Math.min(...euiValues) - Math.max(0.5, euiRange * 0.08));
  const euiMax = Math.max(...euiValues) + Math.max(0.5, euiRange * 0.08);
  const perPaxMin = Math.max(0, Math.min(...perPaxValues) - Math.max(0.5, perPaxRange * 0.08));
  const perPaxMax = Math.max(...perPaxValues) + Math.max(0.5, perPaxRange * 0.08);
  const x = (value: number) => roundSvg(margin.left + ((value - euiMin) / (euiMax - euiMin)) * plotWidth);
  const y = (value: number) => roundSvg(margin.top + (1 - ((value - perPaxMin) / (perPaxMax - perPaxMin))) * plotHeight);
  const euiP75X = x(benchmark.scatter.euiP75);
  const perPaxP75Y = y(benchmark.scatter.perPaxP75);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface-subtle p-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby="preschool-benchmark-scatter-title preschool-benchmark-scatter-description"
        data-benchmark-plot="eui-x-per-pax-y"
        className="h-auto w-full"
      >
        <title id="preschool-benchmark-scatter-title">Centre EUI and May per-pax efficiency quadrant</title>
        <desc id="preschool-benchmark-scatter-description">Thirty Centres plotted with annualised EUI increasing to the right and May per-pax energy increasing upward. Dashed Portfolio P75 lines identify Priority Centres G, M and J.</desc>
        <rect x={margin.left} y={margin.top} width={plotWidth} height={plotHeight} rx="8" className="fill-surface" />
        <line x1={margin.left} y1={margin.top + plotHeight} x2={margin.left + plotWidth} y2={margin.top + plotHeight} stroke="currentColor" className="text-border" />
        <line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + plotHeight} stroke="currentColor" className="text-border" />
        <line
          data-benchmark-p75-axis="eui"
          x1={euiP75X}
          y1={margin.top}
          x2={euiP75X}
          y2={margin.top + plotHeight}
          stroke="currentColor"
          strokeDasharray="6 5"
          className="text-step-warning"
        />
        <line
          data-benchmark-p75-axis="per-pax"
          x1={margin.left}
          y1={perPaxP75Y}
          x2={margin.left + plotWidth}
          y2={perPaxP75Y}
          stroke="currentColor"
          strokeDasharray="6 5"
          className="text-step-warning"
        />
        <text x={euiP75X + 5} y={margin.top + 13} className="fill-step-warning text-[10px] font-semibold">EUI P75 {benchmark.eui.p75}</text>
        <text x={margin.left + plotWidth - 6} y={perPaxP75Y - 6} textAnchor="end" className="fill-step-warning text-[10px] font-semibold">Per-pax P75 {benchmark.perPax.p75}</text>
        {benchmark.scatter.points.map((point) => {
          const cx = x(point.eui);
          const cy = y(point.perPax);
          const visual = benchmarkCohortVisual(point.cohort);
          return (
            <g
              key={point.centreCode}
              data-benchmark-centre={point.centreCode}
              data-marker-shape={visual.shape}
              className={visual.className}
            >
              <title>{`${point.name} (${point.cohort}): ${point.eui.toFixed(2)} kWh/m²/yr, ${point.perPax.toFixed(1)} kWh/person, ${benchmarkQuadrantLabel(point.quadrant)}`}</title>
              <BenchmarkMarker shape={visual.shape} cx={cx} cy={cy} radius={4.5} />
              {point.priority ? (
                <circle cx={cx} cy={cy} r={7.5} fill="none" stroke="currentColor" strokeWidth={1.8} className="text-step-error" />
              ) : null}
              {point.priority ? (
                <text
                  data-benchmark-priority-label={point.centreCode}
                  x={cx + 7}
                  y={cy - 7}
                  className="fill-step-error text-[11px] font-bold"
                >
                  {point.centreCode}
                </text>
              ) : null}
            </g>
          );
        })}
        <text x={margin.left} y={margin.top + plotHeight + 18} className="fill-muted-light text-[9px]">{euiMin.toFixed(1)}</text>
        <text x={margin.left + plotWidth} y={margin.top + plotHeight + 18} textAnchor="end" className="fill-muted-light text-[9px]">{euiMax.toFixed(1)}</text>
        <text x={margin.left - 8} y={margin.top + plotHeight} textAnchor="end" className="fill-muted-light text-[9px]">{perPaxMin.toFixed(1)}</text>
        <text x={margin.left - 8} y={margin.top + 4} textAnchor="end" className="fill-muted-light text-[9px]">{perPaxMax.toFixed(1)}</text>
        <text x={margin.left + plotWidth / 2} y={height - 10} textAnchor="middle" className="fill-muted text-[11px] font-semibold">Annualised EUI (kWh/m²/yr) →</text>
        <text x={16} y={margin.top + plotHeight / 2} textAnchor="middle" transform={`rotate(-90 16 ${margin.top + plotHeight / 2})`} className="fill-muted text-[11px] font-semibold">↑ May per-pax (kWh/person)</text>
      </svg>
      <BenchmarkCohortLegend />
    </div>
  );
}

type BenchmarkMarkerShape = "circle" | "triangle" | "diamond";

const BENCHMARK_COHORT_VISUALS: Record<string, { shape: BenchmarkMarkerShape; className: string }> = {
  "Senior Care Center": { shape: "circle", className: "text-primary" },
  "Active Aging Center": { shape: "triangle", className: "text-step-success" },
  Preschool: { shape: "diamond", className: "text-step-warning" },
};

function benchmarkCohortVisual(cohort: string) {
  return BENCHMARK_COHORT_VISUALS[cohort] ?? { shape: "circle" as const, className: "text-muted" };
}

function BenchmarkMarker({
  shape,
  cx,
  cy,
  radius,
}: {
  shape: BenchmarkMarkerShape;
  cx: number;
  cy: number;
  radius: number;
}) {
  const markerProps = {
    fill: "currentColor",
    stroke: "white",
    strokeWidth: 1.2,
  };
  if (shape === "triangle") {
    return <path d={`M ${cx} ${cy - radius} L ${cx + radius} ${cy + radius} L ${cx - radius} ${cy + radius} Z`} {...markerProps} />;
  }
  if (shape === "diamond") {
    return <rect x={cx - radius * 0.75} y={cy - radius * 0.75} width={radius * 1.5} height={radius * 1.5} transform={`rotate(45 ${cx} ${cy})`} {...markerProps} />;
  }
  return <circle cx={cx} cy={cy} r={radius} {...markerProps} />;
}

function BenchmarkCohortLegend() {
  return (
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-3 text-[10px] text-muted">
      {Object.entries(BENCHMARK_COHORT_VISUALS).map(([cohort, visual]) => (
        <span key={cohort} className={`inline-flex items-center gap-1.5 ${visual.className}`}>
          <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
            <BenchmarkMarker shape={visual.shape} cx={8} cy={8} radius={4} />
          </svg>
          <span className="text-muted">{cohort} · {visual.shape}</span>
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5 text-step-error">
        <span aria-hidden="true" className="h-3 w-3 rounded-full border-2 border-current" />
        <span className="text-muted">Priority · red ring</span>
      </span>
    </div>
  );
}

type BenchmarkDistributionView = BenchmarkView["distributions"][number];

function BenchmarkDistributionPlot({ distribution }: { distribution: BenchmarkDistributionView }) {
  const width = 720;
  const height = 250;
  const margin = { top: 42, right: 24, bottom: 34, left: 172 };
  const plotWidth = width - margin.left - margin.right;
  const laneGap = 54;
  const x = (value: number) => roundSvg(
    margin.left + ((value - distribution.axis.min) / (distribution.axis.max - distribution.axis.min)) * plotWidth,
  );
  const offsets = [-7, 0, 7];

  return (
    <article
      data-benchmark-distribution={distribution.id}
      className="overflow-hidden rounded-lg border border-border bg-surface-subtle p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h5 className="text-xs font-semibold text-foreground">{distribution.label}</h5>
          <p className="mt-1 text-xs text-muted">Shared cohort axis · {distribution.unit}</p>
        </div>
        <span className="rounded-full border border-step-warning/30 bg-step-warning-soft px-2 py-0.5 text-xs font-semibold text-step-warning">Provisional</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${distribution.label} distribution by cohort`}
        data-shared-axis={distribution.id}
        className="mt-3 h-auto w-full"
      >
        <line x1={margin.left} y1={height - margin.bottom} x2={width - margin.right} y2={height - margin.bottom} stroke="currentColor" className="text-border" />
        {distribution.cohorts.map((cohort, cohortIndex) => {
          const laneY = margin.top + cohortIndex * laneGap;
          const visual = benchmarkCohortVisual(cohort.name);
          return (
            <g key={cohort.name} data-benchmark-lane={`${distribution.id}:${cohort.name}`}>
              <text x={margin.left - 12} y={laneY - 4} textAnchor="end" className="fill-foreground text-xs font-semibold">{cohort.name}</text>
              <text x={margin.left - 12} y={laneY + 11} textAnchor="end" className="fill-muted text-[10px]">n={cohort.sampleSize}</text>
              <line x1={margin.left} y1={laneY} x2={width - margin.right} y2={laneY} stroke="currentColor" className="text-border" />
              <line x1={x(cohort.p50Value)} y1={laneY - 14} x2={x(cohort.p50Value)} y2={laneY + 14} stroke="currentColor" strokeWidth={1.5} className="text-primary" />
              <line x1={x(cohort.p75Value)} y1={laneY - 14} x2={x(cohort.p75Value)} y2={laneY + 14} stroke="currentColor" strokeWidth={1.5} strokeDasharray="3 3" className="text-step-warning" />
              <text x={x(cohort.p50Value)} y={laneY - 18} textAnchor="middle" className="fill-primary text-[10px] font-semibold">P50 {cohort.p50}</text>
              <text x={x(cohort.p75Value)} y={laneY + 25} textAnchor="middle" className="fill-step-warning text-[10px] font-semibold">P75 {cohort.p75}</text>
              {cohort.points.map((point, pointIndex) => {
                const cx = x(point.value);
                const cy = laneY + offsets[pointIndex % offsets.length]!;
                return (
                  <g
                    key={point.centreCode}
                    data-distribution-centre={`${distribution.id}:${point.centreCode}`}
                    className={visual.className}
                  >
                    <title>{`${point.name}: ${point.value.toFixed(distribution.id === "eui" ? 2 : 1)} ${distribution.unit}${point.aboveP75 ? ", above cohort P75" : ""}`}</title>
                    <BenchmarkMarker shape={visual.shape} cx={cx} cy={cy} radius={3.6} />
                  </g>
                );
              })}
            </g>
          );
        })}
        <text x={margin.left} y={height - 12} className="fill-muted text-[10px]">{distribution.axis.min}</text>
        <text x={width - margin.right} y={height - 12} textAnchor="end" className="fill-muted text-[10px]">{distribution.axis.max} {distribution.unit}</text>
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted">
        <span><strong className="font-semibold text-primary">Typical (P50)</strong> · solid marker</span>
        <span><strong className="font-semibold text-step-warning">Review above (P75)</strong> · dashed marker</span>
      </div>
    </article>
  );
}

function benchmarkQuadrantLabel(quadrant: BenchmarkView["scatter"]["points"][number]["quadrant"]): string {
  if (quadrant === "priority") return "Priority";
  if (quadrant === "eui-intensive") return "High EUI";
  if (quadrant === "people-intensive") return "High per-pax";
  return "Lower intensity";
}

function roundSvg(value: number): number {
  return Math.round(value * 100) / 100;
}

type OperationalView = Extract<PreschoolOverviewViewModel["operational"], { status: "available" }>;

function OperatingProfileChart({ profile }: { profile: OperationalView["hourlyProfile"] }) {
  const width = 960;
  const height = 270;
  const margin = { top: 28, right: 24, bottom: 48, left: 54 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const columnWidth = plotWidth / profile.rows.length;
  const barWidth = Math.max(8, columnWidth - 8);
  const maxValue = Math.max(1, ...profile.rows.map((row) => row.totalKwh));

  return (
    <article className="overflow-hidden rounded-lg border border-border bg-surface-subtle p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-foreground">When energy is used</h4>
          <p className="mt-1 text-[11px] leading-5 text-muted">Average complete day across the Portfolio; Calendar-classified closed-hour energy is highlighted.</p>
        </div>
        <p className="text-[11px] text-muted"><strong className="font-semibold text-foreground">Peak average hour:</strong> {profile.peakHourLabel}</p>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby="preschool-operating-profile-title preschool-operating-profile-description"
        data-operating-profile="hourly-calendar-split"
        className="mt-3 h-auto w-full"
      >
        <title id="preschool-operating-profile-title">Average hourly energy split by operating and closed hours</title>
        <desc id="preschool-operating-profile-description">Twenty-four stacked bars show average operating energy in blue and closed-hour energy in amber across thirty-one complete May days.</desc>
        <line x1={margin.left} y1={margin.top + plotHeight} x2={width - margin.right} y2={margin.top + plotHeight} stroke="currentColor" className="text-border" />
        <text x={margin.left - 8} y={margin.top + 4} textAnchor="end" className="fill-muted-light text-[9px]">{Math.ceil(maxValue)}</text>
        <text x={margin.left - 8} y={margin.top + plotHeight} textAnchor="end" className="fill-muted-light text-[9px]">0</text>
        {profile.rows.map((row) => {
          const x = margin.left + row.hour * columnWidth + (columnWidth - barWidth) / 2;
          const operatingHeight = (row.operatingKwh / maxValue) * plotHeight;
          const closedHeight = (row.closedHourKwh / maxValue) * plotHeight;
          const operatingY = margin.top + plotHeight - operatingHeight;
          const closedY = operatingY - closedHeight;
          return (
            <g key={row.hour} data-profile-hour={row.hour}>
              <title>{`${row.label}: ${row.totalKwh.toFixed(1)} kWh mean; ${row.operatingKwh.toFixed(1)} operating and ${row.closedHourKwh.toFixed(1)} closed-hour`}</title>
              <rect x={x} y={operatingY} width={barWidth} height={operatingHeight} rx="2" className="fill-primary" />
              <rect x={x} y={closedY} width={barWidth} height={closedHeight} rx="2" className="fill-step-warning" />
              {row.hour % 3 === 0 ? (
                <text x={x + barWidth / 2} y={margin.top + plotHeight + 22} textAnchor="middle" className="fill-muted text-[10px]">{String(row.hour).padStart(2, "0")}:00</text>
              ) : null}
            </g>
          );
        })}
        <text x={16} y={margin.top + plotHeight / 2} textAnchor="middle" transform={`rotate(-90 16 ${margin.top + plotHeight / 2})`} className="fill-muted text-[10px] font-semibold">Mean kWh / complete day</text>
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-muted">
        <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-primary" aria-hidden="true" />Operating energy</span>
        <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-step-warning" aria-hidden="true" />Closed-hour energy</span>
        <span>{profile.completeDayCount} complete days</span>
      </div>
    </article>
  );
}

type PlanningOutlookView = Extract<PreschoolOverviewViewModel["planningOutlook"], { status: "provisional" }>;

function PlanningBaselineChart({ outlook }: { outlook: PlanningOutlookView }) {
  const maximum = Math.max(1, ...outlook.sourceWeeks.map((week) => week.usageKwh));
  return (
    <article className="rounded-lg border border-border bg-surface-subtle p-4" data-planning-baseline="naive-weekly-average">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-foreground">Four complete May weeks</h4>
          <p className="mt-1 text-[11px] leading-5 text-muted">{outlook.method}</p>
        </div>
        <p className="text-xs tabular-nums text-foreground"><strong className="font-semibold">{outlook.weeklyAverage}</strong> average</p>
      </div>
      <div className="mt-5 space-y-3" role="img" aria-label={`Four complete May week totals with an average of ${outlook.weeklyAverage}`}>
        {outlook.sourceWeeks.map((week) => (
          <div key={week.label} className="grid grid-cols-[100px_minmax(0,1fr)_92px] items-center gap-3 text-[11px]">
            <span className="text-muted">{week.label}</span>
            <span className="h-3 overflow-hidden rounded-full bg-surface" aria-hidden="true">
              <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(4, (week.usageKwh / maximum) * 100)}%` }} />
            </span>
            <span className="text-right font-semibold tabular-nums text-foreground">{week.usage}</span>
          </div>
        ))}
      </div>
      <p className="mt-5 border-t border-border pt-3 text-[11px] leading-5 text-muted">The observed weekly spread becomes the displayed June reference range. No trend, weather or occupancy adjustment is applied.</p>
    </article>
  );
}

function OperationalSpikePanel({
  title,
  energy,
  spikeCount,
  centreCount,
  centres,
  tone,
}: {
  title: string;
  energy: string;
  spikeCount: number;
  centreCount: number;
  centres: PreschoolOperationalCentre[];
  tone: "warning" | "default";
}) {
  return (
    <div className={`rounded-lg border p-4 ${tone === "warning" ? "border-step-warning/30 bg-step-warning-soft/30" : "border-border bg-surface-subtle"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-foreground">{title}</p>
          <p className="mt-1 text-[11px] tabular-nums text-muted">{energy}</p>
        </div>
        <div className="text-right">
          <p className="text-xl font-semibold tabular-nums text-foreground">{spikeCount}</p>
          <p className="text-[10px] text-muted-light">Spikes · {centreCount} Centres</p>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {centres.slice(0, 4).map((centre) => (
          <div key={centre.centreCode} className="rounded-md border border-border bg-surface px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-semibold text-foreground">{centre.centreCode} · {centre.centreType ?? "Type unavailable"} · {centre.spikeCount} Spike{centre.spikeCount === 1 ? "" : "s"}</p>
              <span className="text-[11px] font-semibold tabular-nums text-step-error">{centre.worst.variance}</span>
            </div>
            <p className="mt-1 text-[10px] text-muted">{centre.worst.when} · {centre.worst.dayType} · {centre.worst.usage} · {centre.worst.baseline}</p>
            <p className="mt-1 text-[10px] text-muted-light">Leading appliance: {centre.worst.leadingCircuit}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function CentreRow({ centre }: { centre: PreschoolOverviewCentre }) {
  return (
    <tr className="bg-surface text-foreground" data-centre-row={centre.id}>
      <td className="px-3 py-3 tabular-nums text-muted">{centre.rank}</td>
      <td className="px-3 py-3 font-semibold">{centre.name}</td>
      <td className="px-3 py-3 text-muted">{centre.cohort ?? "Unavailable"}</td>
      <td className="px-3 py-3 text-right tabular-nums">{centre.usageKwh} kWh</td>
      <td className="px-3 py-3 text-right tabular-nums text-muted">{centre.sharePct}</td>
      <td className="px-3 py-3 text-right tabular-nums text-muted">{centre.eui ?? "Unavailable"}</td>
      <td className="px-3 py-3 text-right tabular-nums text-muted">{centre.perPax ?? "Unavailable"}</td>
      <td className="px-3 py-3"><QuadrantBadge quadrant={centre.quadrant} /></td>
      <td className="px-3 py-3 text-muted">{centre.topCircuit ?? "Unavailable"}</td>
    </tr>
  );
}

function QuadrantBadge({ quadrant }: { quadrant: PreschoolOverviewCentre["quadrant"] }) {
  if (!quadrant) return <span className="text-muted">Unavailable</span>;
  const label = quadrant === "priority"
    ? "Priority"
    : quadrant === "eui-intensive"
      ? "High EUI"
      : quadrant === "people-intensive"
        ? "High per-pax"
        : "Lower intensity";
  return (
    <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold ${quadrant === "priority" ? "border-step-error/30 bg-step-error-soft text-step-error" : "border-border bg-surface-subtle text-muted"}`}>
      {label}
    </span>
  );
}

function ReadinessRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[82px_minmax(0,1fr)] gap-2">
      <dt className="text-muted-light">{label}</dt>
      <dd className={`${mono ? "break-all font-mono" : "break-words"} text-foreground`}>{value}</dd>
    </div>
  );
}

function applianceBarClass(applianceGroup: string): string {
  if (applianceGroup === "Aircon") return "bg-primary";
  if (applianceGroup === "Lighting") return "bg-step-inspect";
  if (applianceGroup === "Plugload") return "bg-step-warning";
  return "bg-step-success";
}

function titleCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
