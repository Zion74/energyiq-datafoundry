import React from "react";

import type { NgeeAnnLevelComparisonViewModel } from "./ngee-ann-overview-view-model";

export function NgeeAnnLevelComparison({
  view,
}: {
  view: NgeeAnnLevelComparisonViewModel;
}) {
  return (
    <section aria-labelledby="ngee-ann-level-comparison" className="border-b border-border px-5 py-5 lg:px-7 lg:py-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 id="ngee-ann-level-comparison" className="text-base font-semibold tracking-[-0.015em] text-foreground">
            Energy distribution
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted">Level comparison · {view.decisionQuestion}</p>
        </div>
        <p className="max-w-xl text-[11px] leading-5 text-muted">
          Official-route energy, adjacent-period movement and accepted interval quality from one published Snapshot.
        </p>
      </div>

      {view.status === "unavailable" ? (
        <div className="mt-4 rounded-lg border border-border bg-surface-subtle px-4 py-4" role="status">
          <p className="text-xs font-semibold text-foreground">Level comparison unavailable</p>
          <p className="mt-1 text-[11px] leading-5 text-muted">{view.reason}</p>
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-left">
            <caption className="sr-only">Level 6 and Level 7 official energy comparison</caption>
            <thead className="border-y border-border bg-surface-subtle text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
              <tr>
                <th scope="col" className="px-3 py-2.5">Level</th>
                <th scope="col" className="px-3 py-2.5">Current</th>
                <th scope="col" className="px-3 py-2.5">Project share</th>
                <th scope="col" className="px-3 py-2.5">Previous</th>
                <th scope="col" className="px-3 py-2.5">Change</th>
                <th scope="col" className="px-3 py-2.5">Data quality</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {view.rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row" className="w-[180px] px-3 py-4 align-top">
                    <p className="text-xs font-semibold text-foreground">{row.name}</p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-subtle" aria-hidden="true">
                      <div className="h-full rounded-full bg-primary" style={{ width: row.projectShareBar }} />
                    </div>
                  </th>
                  <td className="px-3 py-4 align-top text-sm font-semibold tabular-nums text-foreground">
                    {row.currentUsageKwh} <span className="text-[10px] font-medium text-muted">kWh</span>
                  </td>
                  <td className="px-3 py-4 align-top text-xs font-semibold tabular-nums text-foreground">{row.projectShare}</td>
                  <td className="px-3 py-4 align-top text-xs tabular-nums text-foreground">
                    {row.previousUsageKwh} <span className="text-[10px] text-muted">kWh</span>
                  </td>
                  <td className="px-3 py-4 align-top">
                    <p className="text-xs font-semibold tabular-nums text-foreground">{row.changePct}</p>
                    <p className="mt-1 text-[10px] tabular-nums text-muted">{row.changeKwh}</p>
                  </td>
                  <td className="px-3 py-4 align-top">
                    <p className="text-xs font-semibold text-foreground">{row.coverage}</p>
                    <p className="mt-1 text-[10px] text-muted">{row.intervals} valid / {row.qualityEvents}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <details className="mt-4 border-t border-border pt-3 text-[10px] leading-4 text-muted">
        <summary className="cursor-pointer text-[10px] font-semibold text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
          Level evidence · {view.evidence.queryIds.length} shared queries
        </summary>
        <div className="mt-2 space-y-1">
          <p className="break-all">Snapshot <span className="font-mono text-muted">{view.evidence.snapshotId}</span></p>
          <p className="break-all">Release <span className="font-mono text-muted">{view.evidence.projectReleaseId}</span></p>
          <p className="break-all">Mapping <span className="font-mono text-muted">{view.evidence.meterMappingRevisionId}</span></p>
          <p className="break-words">Queries {view.evidence.queryIds.join(", ")}</p>
        </div>
      </details>
    </section>
  );
}
