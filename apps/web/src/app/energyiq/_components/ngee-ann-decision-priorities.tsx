import React from "react";

import type { NgeeAnnDecisionPrioritiesViewModel } from "./ngee-ann-overview-view-model";
import { anomalyIncidentDomId } from "./ngee-ann-overview-links";

export function NgeeAnnDecisionPriorities({
  view,
  projectExplorerHref,
  aiAnalystHref,
}: {
  view: NgeeAnnDecisionPrioritiesViewModel;
  projectExplorerHref?: string;
  aiAnalystHref?: string;
}) {
  const stateMessage = priorityStateMessage(view);
  return (
    <section aria-labelledby="ngee-ann-decision-priorities" className="border-b border-border bg-surface-subtle/45 px-5 py-6 lg:px-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.11em] text-primary">Act first</p>
          <h3 id="ngee-ann-decision-priorities" className="mt-1 text-base font-semibold text-foreground">
            Decision priorities
          </h3>
          <p className="mt-1 max-w-3xl text-[11px] leading-5 text-muted">
            Server-ranked exceptions from this Snapshot. Evidence is shown before any operational change is made.
          </p>
        </div>
        <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-muted">
          {view.items.length} of 3 priorities
        </span>
      </div>

      {stateMessage ? (
        <div
          role="status"
          className="mt-4 rounded-lg border border-border bg-surface px-4 py-3 text-[11px] leading-5 text-muted"
        >
          <p className="font-semibold text-foreground">{stateMessage.title}</p>
          <p className="mt-0.5">{stateMessage.detail}</p>
        </div>
      ) : null}

      {view.items.length > 0 ? (
        <div className="mt-4 grid gap-3 xl:grid-cols-3">
          {view.items.map((item) => (
            <article key={item.priorityId} className="flex min-w-0 flex-col rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">Priority {item.rank}</p>
                <span className={[
                  "rounded-full px-2 py-1 text-[11px] font-semibold",
                  item.confidence === "Complete Evidence"
                    ? "bg-step-success-light text-step-success"
                    : "bg-step-warning/10 text-step-warning",
                ].join(" ")}>
                  {item.confidence}
                </span>
              </div>
              <PriorityField label="Finding" value={item.finding} />
              <PriorityField label="Evidence" value={item.evidence} />
              <PriorityField label="Impact" value={item.impact} />
              <PriorityField label="Action" value={item.action} />
              {item.confidenceLimitation ? (
                <p className="mt-3 text-[11px] leading-5 text-step-warning">Limitation: {item.confidenceLimitation}</p>
              ) : null}
              <a
                href={`#${anomalyIncidentDomId(item.targetIncidentId)}`}
                className="mt-4 inline-flex min-h-9 items-center justify-center rounded-lg border border-primary/25 px-3 text-xs font-semibold text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
              >
                View evidence
              </a>
            </article>
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {projectExplorerHref ? (
          <a href={projectExplorerHref} className="inline-flex min-h-9 items-center rounded-lg bg-primary px-3.5 text-xs font-semibold text-white hover:bg-primary-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-2">
            Open Project Explorer
          </a>
        ) : null}
        {aiAnalystHref ? (
          <a href={aiAnalystHref} className="inline-flex min-h-9 items-center rounded-lg border border-border bg-surface px-3.5 text-xs font-semibold text-foreground hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25">
            Ask AI Analyst <span className="ml-1 font-normal text-muted">(optional)</span>
          </a>
        ) : null}
      </div>
    </section>
  );
}

function PriorityField({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-3">
      <p className="text-[11px] font-semibold text-muted">{label}</p>
      <p className="mt-1 text-xs leading-5 text-foreground">{value}</p>
    </div>
  );
}

function priorityStateMessage(view: NgeeAnnDecisionPrioritiesViewModel): { title: string; detail: string } | null {
  if (view.status === "available") return null;
  if (view.status === "empty") {
    return {
      title: "No deterministic priority for this Period",
      detail: "The released daily rule found no eligible exception to rank from the current Evidence.",
    };
  }
  if (view.status === "suppressed") {
    return {
      title: "Priority conclusion suppressed",
      detail: view.limitation ?? "Candidate dates did not pass the released Calendar, coverage, quality or baseline gates.",
    };
  }
  if (view.status === "partial") {
    return {
      title: view.items.length > 0 ? "Priorities use partial supporting Evidence" : "No complete priority conclusion",
      detail: view.limitation ?? "Some candidate Evidence is suppressed, partial or unavailable.",
    };
  }
  return {
    title: "Decision priorities unavailable",
    detail: view.limitation ?? "The server-owned priority contract is unavailable for this Snapshot.",
  };
}
