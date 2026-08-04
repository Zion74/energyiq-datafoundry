import React from "react";

import type { NgeeAnnEnergyCompositionViewModel } from "./ngee-ann-overview-view-model";

export function NgeeAnnEnergyComposition({
  view,
}: {
  view: NgeeAnnEnergyCompositionViewModel;
}) {
  return (
    <section aria-labelledby="ngee-ann-energy-composition" className="border-b border-border px-5 py-5 lg:px-7 lg:py-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 id="ngee-ann-energy-composition" className="text-base font-semibold tracking-[-0.015em] text-foreground">
            Energy composition
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted">{view.decisionQuestion}</p>
        </div>
        <p className="max-w-xl text-[11px] leading-5 text-muted">
          Official categories and designated totals stay separate from explanatory component Circuits.
        </p>
      </div>

      <div className="mt-5">
        <h4 className="text-xs font-semibold text-foreground">Official categories</h4>
        <p className="mt-1 text-[11px] leading-5 text-muted">
          Load and Light use the official Project total as their shared denominator.
        </p>
        {view.categories.status === "unavailable" ? (
          <Unavailable title="Category comparison unavailable" reason={view.categories.reason} />
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-left">
              <caption className="sr-only">Load and Light official energy comparison</caption>
              <thead className="border-y border-border bg-surface-subtle text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2.5">Category</th>
                  <th scope="col" className="px-3 py-2.5">Current</th>
                  <th scope="col" className="px-3 py-2.5">Project share</th>
                  <th scope="col" className="px-3 py-2.5">Previous</th>
                  <th scope="col" className="px-3 py-2.5">Change</th>
                  <th scope="col" className="px-3 py-2.5">Data quality</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {view.categories.rows.map((row) => (
                  <tr key={row.id}>
                    <th scope="row" className="px-3 py-3.5 text-xs font-semibold text-foreground">{row.name}</th>
                    <td className="px-3 py-3.5 text-xs font-semibold tabular-nums text-foreground">{row.currentUsageKwh} kWh</td>
                    <td className="px-3 py-3.5 text-xs tabular-nums text-foreground">{row.projectShare}</td>
                    <td className="px-3 py-3.5 text-xs tabular-nums text-foreground">{row.previousUsageKwh} kWh</td>
                    <td className="px-3 py-3.5">
                      <p className="text-xs font-semibold tabular-nums text-foreground">{row.changePct}</p>
                      <p className="mt-1 text-[10px] tabular-nums text-muted">{row.changeKwh}</p>
                    </td>
                    <td className="px-3 py-3.5">
                      <Quality quality={row.quality} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-6 border-t border-border pt-5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div>
            <h4 className="text-xs font-semibold text-foreground">Top 5 component Circuits</h4>
            <p className="mt-1 text-[11px] leading-5 text-muted">
              Ranked by current usage. These are explanatory components and are not included in the official Project total.
            </p>
          </div>
          <span className="text-[10px] font-medium text-muted">Share denominator: Project official total</span>
        </div>
        {view.circuits.status === "unavailable" ? (
          <Unavailable title="Component Circuit ranking unavailable" reason={view.circuits.reason} />
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[1040px] border-collapse text-left">
              <caption className="sr-only">Top five explanatory component Circuits</caption>
              <thead className="border-y border-border bg-surface-subtle text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2.5">Rank / Circuit</th>
                  <th scope="col" className="px-3 py-2.5">Level</th>
                  <th scope="col" className="px-3 py-2.5">Category</th>
                  <th scope="col" className="px-3 py-2.5">Current</th>
                  <th scope="col" className="px-3 py-2.5">Project official share</th>
                  <th scope="col" className="px-3 py-2.5">Change</th>
                  <th scope="col" className="px-3 py-2.5">Data quality</th>
                  <th scope="col" className="px-3 py-2.5">Accounting</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {view.circuits.rows.map((row) => (
                  <tr key={row.meterNodeId}>
                    <th scope="row" className="max-w-[260px] px-3 py-3.5 align-top">
                      <p className="text-xs font-semibold text-foreground">{row.rank}. {row.name}</p>
                      <CircuitEvidence row={row} evidence={view.evidence} />
                    </th>
                    <td className="px-3 py-3.5 align-top text-xs text-foreground">{row.levelName}</td>
                    <td className="px-3 py-3.5 align-top text-xs text-foreground">{row.category}</td>
                    <td className="px-3 py-3.5 align-top text-xs font-semibold tabular-nums text-foreground">{row.currentUsageKwh} kWh</td>
                    <td className="px-3 py-3.5 align-top text-xs tabular-nums text-foreground">{row.projectShare}</td>
                    <td className="px-3 py-3.5 align-top">
                      <p className="text-xs font-semibold tabular-nums text-foreground">{row.changePct}</p>
                      <p className="mt-1 text-[10px] tabular-nums text-muted">{row.changeKwh}</p>
                      <p className="mt-1 text-[10px] tabular-nums text-muted">Previous {row.previousUsageKwh} kWh</p>
                    </td>
                    <td className="px-3 py-3.5 align-top"><Quality quality={row.quality} /></td>
                    <td className="px-3 py-3.5 align-top text-[10px] font-semibold text-muted">Explanatory only</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-6 border-t border-border pt-5">
        <h4 className="text-xs font-semibold text-foreground">Accounting trace</h4>
        <p className="mt-1 text-[11px] leading-5 text-muted">
          Four designated totals form the official Project route. Component Circuits remain outside this addition.
        </p>
        {view.accounting.status === "unavailable" || !view.accounting.reconciliation ? (
          <Unavailable title="Accounting trace unavailable" reason={view.accounting.reason} />
        ) : (
          <>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left">
                <caption className="sr-only">Designated totals included in the official Project total</caption>
                <thead className="border-y border-border bg-surface-subtle text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
                  <tr>
                    <th scope="col" className="px-3 py-2.5">Designated total</th>
                    <th scope="col" className="px-3 py-2.5">Level</th>
                    <th scope="col" className="px-3 py-2.5">Category</th>
                    <th scope="col" className="px-3 py-2.5">Current</th>
                    <th scope="col" className="px-3 py-2.5">Official route</th>
                    <th scope="col" className="px-3 py-2.5">Data quality</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {view.accounting.designatedTotals.map((row) => (
                    <tr key={row.meterNodeId}>
                      <th scope="row" className="px-3 py-3.5 align-top">
                        <p className="text-xs font-semibold text-foreground">{row.name}</p>
                        <p className="mt-1 break-all font-mono text-[10px] font-normal text-muted">{row.scopeId}</p>
                      </th>
                      <td className="px-3 py-3.5 align-top text-xs text-foreground">{row.levelName}</td>
                      <td className="px-3 py-3.5 align-top text-xs text-foreground">{row.category}</td>
                      <td className="px-3 py-3.5 align-top text-xs font-semibold tabular-nums text-foreground">{row.currentUsageKwh} kWh</td>
                      <td className="px-3 py-3.5 align-top text-[10px] font-semibold text-foreground">Included once</td>
                      <td className="px-3 py-3.5 align-top"><Quality quality={row.quality} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 bg-surface-subtle px-4 py-3" role="note">
              <p className="text-xs font-semibold leading-5 text-foreground">
                Component Circuits explain {view.accounting.reconciliation.componentUsageKwh} kWh of {view.accounting.reconciliation.officialUsageKwh} kWh ({view.accounting.reconciliation.ratioPct}).
              </p>
              <p className="mt-1 text-[11px] leading-5 text-muted">
                The {view.accounting.reconciliation.gapKwh} kWh difference remains outside the component breakdown; it is not classified here as an anomaly, missing data or savings.
              </p>
              <p className="mt-1 text-[10px] text-muted">
                {view.accounting.reconciliation.componentMeterCount} component meters reconciled against {view.accounting.reconciliation.officialMeterCount} designated totals.
              </p>
              <p className="mt-1 text-[10px] text-muted">
                Designated rows are rounded for display; the server-reconciled official total is authoritative.
              </p>
            </div>
          </>
        )}
      </div>

      <details className="mt-5 border-t border-border pt-3 text-[10px] leading-4 text-muted">
        <summary className="cursor-pointer text-[10px] font-semibold text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
          Composition evidence · {view.evidence.queryIds.length} shared queries
        </summary>
        <dl className="mt-2 grid gap-x-3 gap-y-1 sm:grid-cols-[80px_minmax(0,1fr)]">
          <dt className="text-muted">Snapshot</dt>
          <dd className="break-all font-mono text-foreground">{view.evidence.snapshotId}</dd>
          <dt className="text-muted">Release</dt>
          <dd className="break-all font-mono text-foreground">{view.evidence.projectReleaseId}</dd>
          <dt className="text-muted">Mapping</dt>
          <dd className="break-all font-mono text-foreground">{view.evidence.meterMappingRevisionId}</dd>
          <dt className="text-muted">Period / unit</dt>
          <dd className="break-words text-foreground">{view.evidence.period} · {view.evidence.unit}</dd>
          <dt className="text-muted">Queries</dt>
          <dd className="break-words text-foreground">{view.evidence.queryIds.join(", ")}</dd>
        </dl>
      </details>
    </section>
  );
}

function Quality({
  quality,
}: {
  quality: { coverage: string; intervals: string; qualityEvents: string };
}) {
  return (
    <>
      <p className="text-xs font-semibold text-foreground">{quality.coverage}</p>
      <p className="mt-1 text-[10px] text-muted">{quality.intervals} valid / {quality.qualityEvents}</p>
    </>
  );
}

function Unavailable({ title, reason }: { title: string; reason: string | null }) {
  return (
    <div className="mt-3 rounded-lg border border-border bg-surface-subtle px-4 py-4" role="status">
      <p className="text-xs font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-[11px] leading-5 text-muted">{reason}</p>
    </div>
  );
}

function CircuitEvidence({
  row,
  evidence,
}: {
  row: NgeeAnnEnergyCompositionViewModel["circuits"]["rows"][number];
  evidence: NgeeAnnEnergyCompositionViewModel["evidence"];
}) {
  return (
    <details className="mt-2 text-[10px] font-normal leading-4 text-muted">
      <summary className="cursor-pointer font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
        Circuit evidence
      </summary>
      <dl className="mt-1 grid grid-cols-[64px_minmax(0,1fr)] gap-x-2 gap-y-0.5">
        <dt>Meter point</dt><dd className="break-all font-mono text-foreground">{row.meterNodeId}</dd>
        <dt>Scope</dt><dd className="break-all font-mono text-foreground">{row.scopeId}</dd>
        <dt>Parent</dt><dd className="break-all font-mono text-foreground">{row.parentScopeId}</dd>
        <dt>Category</dt><dd className="text-foreground">{row.category}</dd>
        <dt>Official</dt><dd className="text-foreground">No · explanatory component</dd>
        <dt>Period</dt><dd className="break-words text-foreground">{evidence.period}</dd>
        <dt>Unit</dt><dd className="text-foreground">{evidence.unit}</dd>
        <dt>Quality</dt><dd className="text-foreground">{row.quality.coverage}; {row.quality.intervals} valid; {row.quality.qualityEvents}</dd>
        <dt>Snapshot</dt><dd className="break-all font-mono text-foreground">{evidence.snapshotId}</dd>
      </dl>
    </details>
  );
}
