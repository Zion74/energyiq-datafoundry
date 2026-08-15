"use client";

import { useEffect, useState } from "react";

import {
  configApi,
  type EnergyProjectOverviewAdminReadinessStatusDto,
  type EnergyProjectOverviewAdminStateDto,
} from "../../../lib/config-api";

export type ProjectOverviewAiReadinessClient = Pick<
  typeof configApi,
  "getEnergyProjectOverviewAdminState" | "generateMissingEnergyProjectOverviewAnalysis"
>;

export function ProjectOverviewAiReadiness({
  projectId,
  client = configApi,
  variant = "full",
  onOpenFull,
}: {
  projectId: string;
  client?: ProjectOverviewAiReadinessClient;
  variant?: "summary" | "full";
  onOpenFull?: () => void;
}) {
  const [state, setState] = useState<EnergyProjectOverviewAdminStateDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void client.getEnergyProjectOverviewAdminState(projectId)
      .then((next) => {
        if (active) setState(next);
      })
      .catch((reason) => {
        if (active) setError(messageFrom(reason, "Failed to load Overview and AI readiness"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, projectId]);

  const generateMissing = async () => {
    if (generating) return;
    setGenerating(true);
    setError(null);
    try {
      setState(await client.generateMissingEnergyProjectOverviewAnalysis(projectId));
    } catch (reason) {
      setError(messageFrom(reason, "Failed to generate missing analysis"));
    } finally {
      setGenerating(false);
    }
  };

  if (loading && !state) {
    return (
      <section className="min-h-36 rounded-xl border border-border bg-surface p-5" role="status" aria-live="polite">
        <h3 className="text-base font-semibold">AI Analysis readiness</h3>
        <p className="mt-3 text-sm text-muted">Restoring saved analysis status…</p>
      </section>
    );
  }

  if (!state) {
    return (
      <section className="rounded-xl border border-step-error/25 bg-surface p-5" role="status">
        <h3 className="text-base font-semibold">AI Analysis readiness</h3>
        <p className="mt-2 text-sm leading-6 text-step-error">{error ?? "Readiness is unavailable."}</p>
      </section>
    );
  }

  const hasGenerateAction = state.allowedActions.includes("generate-missing")
    && state.recommendedNextAction?.action === "generate-missing";

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface" aria-labelledby={`ai-readiness-${variant}`}>
      <div className="flex flex-wrap items-start justify-between gap-5 p-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`ai-readiness-${variant}`} className="text-base font-semibold">AI Analysis readiness</h3>
            {state.analysis.supported
              ? <ReadinessBadge status={state.analysis.status} />
              : <span className="inline-flex w-fit rounded-full bg-surface-subtle px-2.5 py-1 text-xs font-semibold text-muted">Not connected</span>}
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{state.analysis.detail}</p>
          {state.analysis.supported ? (
            <p className="mt-2 text-sm font-semibold text-foreground">
              {state.analysis.readyCount} of {state.analysis.totalCount} ready
              {state.analysis.lastGeneratedAt ? <span className="font-normal text-muted"> · Last generated {formatTimestamp(state.analysis.lastGeneratedAt)}</span> : null}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onOpenFull && variant === "summary" ? (
            <button type="button" onClick={onOpenFull} className={secondaryButton}>View AI Analysis</button>
          ) : null}
          {hasGenerateAction ? (
            <button
              type="button"
              disabled={generating}
              onClick={() => void generateMissing()}
              className={primaryButton}
            >
              {generating ? "Generating missing analysis…" : "Generate missing analysis"}
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="mx-5 mb-5 rounded-lg border border-step-error/25 bg-step-error/5 px-4 py-3 text-sm text-step-error" role="status">
          {error}
        </p>
      ) : null}

      {variant === "summary" ? (
        <div className="grid gap-px border-t border-border bg-border sm:grid-cols-3">
          <ReadinessFact label="Customer Overview" value={STATUS_COPY[state.customerOverview.status]} />
          <ReadinessFact
            label="Saved AI analysis"
            value={state.analysis.supported ? `${state.analysis.readyCount}/${state.analysis.totalCount} ready` : "Not connected"}
          />
          <ReadinessFact
            label="Next action"
            value={state.recommendedNextAction?.label ?? (state.analysis.supported ? "No action needed" : "Connect this Project when ready")}
          />
        </div>
      ) : state.analysis.supported ? (
        <div className="border-t border-border">
          <div className="divide-y divide-border" role="list" aria-label="AI analysis readiness items">
            {state.analysis.items.map((item) => (
              <div key={item.id} className="grid gap-2 px-5 py-4 sm:grid-cols-[minmax(180px,0.8fr)_140px_minmax(0,1.6fr)] sm:items-center" role="listitem">
                <p className="text-sm font-semibold">{item.label}</p>
                <ReadinessBadge status={item.status} />
                <p className="text-sm leading-6 text-muted">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="border-t border-border px-5 py-4 text-sm leading-6 text-muted">
          No Layer 1–3 status is shown because this Project has not adopted that analysis contract.
        </div>
      )}

      {variant === "full" && state.currentIdentity ? (
        <details className="border-t border-border px-5 py-4">
          <summary className="cursor-pointer text-sm font-semibold text-muted hover:text-foreground">Technical details</summary>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <TechnicalDetail label="Data Snapshot" value={state.currentIdentity.dataSnapshotId} />
            <TechnicalDetail label="Project Release" value={state.currentIdentity.projectReleaseId} />
            <TechnicalDetail label="Analysis period" value={`${formatTimestamp(state.currentIdentity.analysisPeriod.from)} – ${formatTimestamp(state.currentIdentity.analysisPeriod.to)}`} />
            <TechnicalDetail label="Model profile revision" value={`r${state.currentIdentity.modelProfileRevision}`} />
          </dl>
        </details>
      ) : null}
    </section>
  );
}

function ReadinessBadge({ status }: { status: EnergyProjectOverviewAdminReadinessStatusDto }) {
  return (
    <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[status]}`}>
      {STATUS_COPY[status]}
    </span>
  );
}

function ReadinessFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-subtle px-5 py-4">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}

function TechnicalDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-muted">{label}</dt>
      <dd className="mt-1 break-all font-mono text-xs text-foreground">{value}</dd>
    </div>
  );
}

const STATUS_COPY: Record<EnergyProjectOverviewAdminReadinessStatusDto, string> = {
  ready: "Ready",
  generating: "Generating",
  "not-generated": "Not generated",
  "needs-attention": "Needs attention",
  "no-new-insight": "No new insight",
  "out-of-date": "Out of date",
};

const STATUS_STYLE: Record<EnergyProjectOverviewAdminReadinessStatusDto, string> = {
  ready: "bg-step-success/10 text-step-success",
  generating: "bg-primary-light/10 text-primary",
  "not-generated": "bg-surface-subtle text-muted",
  "needs-attention": "bg-step-warning/10 text-step-warning",
  "no-new-insight": "bg-surface-subtle text-muted",
  "out-of-date": "bg-step-error/10 text-step-error",
};

const primaryButton = "rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButton = "rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20";

const formatTimestamp = (value: string): string => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat("en-SG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Singapore",
  }).format(new Date(parsed));
};

const messageFrom = (reason: unknown, fallback: string): string =>
  reason instanceof Error && reason.message ? reason.message : fallback;
