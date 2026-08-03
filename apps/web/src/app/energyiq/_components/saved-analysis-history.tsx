"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { configApi, type EnergySavedAnalysisSummaryDto } from "../../../lib/config-api";
import { useEnergyIqAccess } from "./energyiq-access";
import { EnergyIcon } from "./icons";

export function SavedAnalysisHistory() {
  const { activeProject } = useEnergyIqAccess();
  const [items, setItems] = useState<EnergySavedAnalysisSummaryDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projectId = activeProject?.id ?? "";

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void configApi.listEnergySavedAnalyses(projectId)
      .then((result) => {
        if (!cancelled) setItems(result.items);
      })
      .catch((reason) => {
        if (!cancelled) {
          setItems([]);
          setError(reason instanceof Error ? reason.message : "Unable to load analysis history");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const latestBySeries = useMemo(() => {
    const latest = new Map<string, number>();
    for (const item of items) {
      latest.set(item.seriesId, Math.max(latest.get(item.seriesId) ?? 0, item.sequence));
    }
    return latest;
  }, [items]);

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 py-6 lg:px-8 lg:py-8">
      <div className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-muted">{activeProject?.name ?? "Select a Project"}</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Saved analyses</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted">
            Immutable results saved manually from Overview. Each rerun is a new version and never changes earlier evidence.
          </p>
        </div>
        <Link href="/energyiq/overview" className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-white hover:bg-primary-light">
          <EnergyIcon name="analysis" className="h-3.5 w-3.5" />
          Open Overview
        </Link>
      </div>

      {error ? <p className="mt-6 rounded-lg border border-step-error/25 bg-step-error/5 p-4 text-xs text-step-error">{error}</p> : null}

      {loading ? (
        <div className="mt-6 rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted">Loading saved analysis history…</div>
      ) : items.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-border bg-surface p-10 text-center">
          <h2 className="text-sm font-semibold">No saved analyses yet</h2>
          <p className="mt-2 text-xs leading-5 text-muted">Run a trusted Overview, then choose Save analysis.</p>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-card)]">
          {items.map((item) => {
            const latest = latestBySeries.get(item.seriesId) === item.sequence;
            return (
              <Link
                key={item.id}
                href={`/energyiq/saved/${item.id}`}
                className="grid gap-3 border-b border-border px-5 py-4 transition-colors last:border-b-0 hover:bg-surface-subtle sm:grid-cols-[minmax(0,1fr)_160px_150px_auto] sm:items-center"
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <strong className="truncate text-sm">{item.title}</strong>
                    {latest ? <span className="rounded-full bg-step-success/10 px-2 py-0.5 text-[9px] font-semibold uppercase text-step-success">Latest</span> : null}
                  </span>
                  <span className="mt-1 block text-[11px] text-muted">{item.scopeName} · snapshot {item.dataSnapshotId}</span>
                </span>
                <span className="text-xs text-muted">Version {item.sequence}</span>
                <span className="text-xs text-muted">{formatSavedAt(item.createdAt)}</span>
                <span className="flex items-center justify-end gap-1 text-xs font-semibold text-primary">View <EnergyIcon name="arrow" className="h-3.5 w-3.5" /></span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatSavedAt(value: string): string {
  return new Intl.DateTimeFormat("en-SG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
