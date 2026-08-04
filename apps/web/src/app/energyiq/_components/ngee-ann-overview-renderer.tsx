import React from "react";

import type { EnergyProjectAnalysisSnapshotDto } from "../../../lib/config-api";
import { EnergyIcon } from "./icons";
import {
  buildNgeeAnnOverviewViewModel,
  type NgeeAnnLatestAvailableRange,
  type NgeeAnnOverviewDataStatus,
} from "./ngee-ann-overview-view-model";

export type NgeeAnnOverviewRendererState =
  | {
    status: "loading" | "empty" | "unsupported" | "error";
    title: string;
    detail: string;
  }
  | {
    status: "ready";
    snapshot: EnergyProjectAnalysisSnapshotDto;
  };

export function NgeeAnnOverviewRenderer({
  state,
  onRetry,
  onViewLatestAvailableData,
  latestAvailableRange,
}: {
  state: NgeeAnnOverviewRendererState;
  onRetry?: () => void;
  onViewLatestAvailableData?: (range: NgeeAnnLatestAvailableRange) => void;
  latestAvailableRange?: NgeeAnnLatestAvailableRange | null;
}) {
  if (state.status !== "ready") {
    return <NgeeAnnRendererState state={state} onRetry={onRetry} />;
  }

  const view = buildNgeeAnnOverviewViewModel(state.snapshot, {
    latestAvailableRange,
  });
  const statusTone = dataStatusTone(view.dataStatus.status);

  return (
    <section
      aria-label="Ngee Ann published energy analysis"
      data-ngee-ann-overview="true"
      data-data-status={view.dataStatus.status}
      className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-card)]"
    >
      <header className="grid gap-5 border-b border-border px-5 py-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:px-7">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span className="font-semibold text-foreground">{view.context.projectName}</span>
            <EnergyIcon name="chevron" className="h-3 w-3 text-muted-light" />
            <span>{view.context.scopeType} / {view.context.scopeName}</span>
          </div>
          <h2 className="mt-2 text-xl font-semibold tracking-[-0.02em] text-foreground">
            {view.context.period} energy position
          </h2>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5">
              <EnergyIcon name="calendar" className="h-3.5 w-3.5 text-muted-light" />
              {view.context.periodRange}
            </span>
            <span>{view.context.timezone}</span>
          </div>
        </div>

        <div className={`max-w-lg rounded-lg px-4 py-3 ${statusTone.surface}`} role="status">
          <div className="flex items-start gap-3">
            <EnergyIcon name={statusTone.icon} className={`mt-0.5 h-4 w-4 shrink-0 ${statusTone.text}`} />
            <div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className={`text-xs font-semibold ${statusTone.text}`}>{view.dataStatus.label}</p>
                <span className="text-[11px] text-muted">{view.dataStatus.coverage}</span>
              </div>
              <p className="mt-1 text-[11px] leading-5 text-muted">{view.dataStatus.summary}</p>
              <p className="mt-1 text-[10px] leading-4 text-muted-light">
                {view.dataStatus.intervals} / {view.dataStatus.qualityEvents} / {view.dataStatus.lastSeen}
              </p>
            </div>
          </div>
        </div>
      </header>

      {view.dataStatus.recovery ? (
        <div className="flex flex-col gap-3 border-b border-border bg-surface-subtle px-5 py-3 sm:flex-row sm:items-center sm:justify-between lg:px-7">
          <p className="max-w-3xl text-xs leading-5 text-muted">{view.dataStatus.recovery}</p>
          {view.latestAvailableRange && onViewLatestAvailableData ? (
            <button
              type="button"
              onClick={() => onViewLatestAvailableData(view.latestAvailableRange!)}
              className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-3.5 text-xs font-semibold text-white transition-colors hover:bg-primary-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-2"
            >
              View latest available data
              <EnergyIcon name="arrow" className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="grid border-b border-border sm:grid-cols-2 xl:grid-cols-5 xl:divide-x xl:divide-border">
        {view.highlights.map((highlight) => (
          <article
            key={highlight.id}
            className="min-w-0 border-b border-border px-5 py-5 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0 xl:border-b-0"
          >
            <p className="text-[11px] font-medium text-muted">{highlight.label}</p>
            <p className={[
              "mt-2 break-words text-xl font-semibold tracking-[-0.025em] tabular-nums",
              highlight.available ? "text-foreground" : "text-muted-light",
            ].join(" ")}>
              {highlight.value}
              {highlight.unit ? <span className="ml-1 text-xs font-medium tracking-normal text-muted">{highlight.unit}</span> : null}
            </p>
            <p className="mt-2 text-[10px] leading-4 text-muted-light">{highlight.detail}</p>
          </article>
        ))}
      </div>

      <div className="px-5 py-4 lg:px-7">
        <div>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Snapshot & evidence</h3>
              <p className="mt-1 text-[11px] text-muted">
                {view.evidence.projectRelease} / {view.evidence.importBatchCount} import batches / Metadata {view.evidence.metadataStatus}
              </p>
            </div>
            <span className="rounded-md bg-surface-subtle px-2 py-1 text-[10px] font-medium text-muted">
              {view.evidence.references.length} references
            </span>
          </div>
          <dl className="mt-3 space-y-2 text-[11px]">
            <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
              <dt className="text-muted-light">Snapshot</dt>
              <dd className="break-all font-mono text-foreground">{view.evidence.snapshotId}</dd>
            </div>
            <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
              <dt className="text-muted-light">Release</dt>
              <dd className="break-all font-mono text-foreground">{view.evidence.projectReleaseId}</dd>
            </div>
          </dl>
          <details className="mt-3 border-t border-border pt-3">
            <summary className="cursor-pointer text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
              View reproducible evidence
            </summary>
            <div className="mt-3 space-y-3 text-[10px] leading-4 text-muted">
              <p className="break-words">Queries: {view.evidence.queryIds.join(", ")}</p>
              {view.evidence.references.map((reference) => (
                <div key={reference.id} className="border-t border-border pt-2 first:border-t-0 first:pt-0">
                  <p className="break-all font-mono text-foreground">{reference.id}</p>
                  <p>{reference.metricId} / {reference.queryIds.join(", ")}</p>
                  {reference.queryReceiptId ? <p className="break-all">Receipt: {reference.queryReceiptId}</p> : null}
                </div>
              ))}
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}

function NgeeAnnRendererState({
  state,
  onRetry,
}: {
  state: Exclude<NgeeAnnOverviewRendererState, { status: "ready" }>;
  onRetry?: () => void;
}) {
  const isError = state.status === "error";
  return (
    <section
      aria-label="Ngee Ann published energy analysis"
      role={isError ? "alert" : "status"}
      data-ngee-ann-overview="true"
      data-renderer-state={state.status}
      className="rounded-xl border border-border bg-surface px-5 py-8"
    >
      <div className="mx-auto flex max-w-xl items-start gap-3">
        <EnergyIcon name={isError ? "alert" : "analysis"} className={isError ? "mt-0.5 h-4 w-4 text-step-error" : "mt-0.5 h-4 w-4 text-muted"} />
        <div>
          <h2 className="text-sm font-semibold text-foreground">{state.title}</h2>
          <p className="mt-1 text-xs leading-5 text-muted">{state.detail}</p>
          {isError && onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-4 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-foreground hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
            >
              Try again
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function dataStatusTone(status: NgeeAnnOverviewDataStatus): {
  surface: string;
  text: string;
  icon: "check" | "info" | "alert";
} {
  if (status === "ready") {
    return { surface: "bg-step-success/10", text: "text-step-success", icon: "check" };
  }
  if (status === "partial") {
    return { surface: "bg-step-warning/10", text: "text-step-warning", icon: "info" };
  }
  return { surface: "bg-step-error/10", text: "text-step-error", icon: "alert" };
}
