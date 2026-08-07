"use client";

import React from "react";

import {
  NGEE_ANN_OPEN_INCIDENT_EVENT,
  type NgeeAnnOpenIncidentEventDetail,
} from "./ngee-ann-daily-anomalies";
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
    <section
      id="ngee-ann-takeaways"
      aria-labelledby="ngee-ann-decision-priorities"
      className="scroll-mt-28 border-b border-border bg-surface-subtle/45 px-5 py-7 lg:px-7 lg:py-8"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="ngee-ann-decision-priorities" className="text-lg font-semibold tracking-[-0.015em] text-foreground">
            Takeaways and next decisions
          </h3>
          <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted">
            Start here: what changed, why it matters, and the next check to make.
          </p>
        </div>
        <span className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted">
          {view.items.length} verified {view.items.length === 1 ? "priority" : "priorities"}
        </span>
      </div>

      {stateMessage ? (
        <div
          role="status"
          className="mt-5 rounded-lg border border-border bg-surface px-4 py-3 text-sm leading-6 text-muted"
        >
          <p className="font-semibold text-foreground">{stateMessage.title}</p>
          <p className="mt-0.5">{stateMessage.detail}</p>
        </div>
      ) : null}

      {view.items.length > 0 ? (
        <div className="mt-5 space-y-4">
          {view.items.map((item) => (
            <article key={item.priorityId} className="min-w-0 rounded-xl border border-border bg-surface p-5 shadow-[var(--shadow-card)] lg:p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-primary">Priority {item.rank}</p>
                  <h4 className="mt-1.5 max-w-4xl text-lg font-semibold leading-7 text-foreground">{item.finding}</h4>
                </div>
                <span className={[
                  "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold",
                  item.confidence === "Complete Evidence"
                    ? "bg-step-success-light text-step-success"
                    : "bg-step-warning/10 text-step-warning",
                ].join(" ")}>
                  {item.confidence}
                </span>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {item.horizons.map((horizon) => (
                  <div key={horizon.label} className="rounded-lg bg-surface-subtle px-4 py-3">
                    <p className="text-xs font-semibold text-foreground">{horizon.label}</p>
                    <p className="mt-1 text-xs text-muted">{horizon.period}</p>
                    <p className="mt-2 text-base font-semibold tabular-nums text-foreground">{horizon.comparison}</p>
                    {horizon.limitation ? (
                      <p className="mt-1 text-xs leading-5 text-step-warning">{horizon.limitation}</p>
                    ) : null}
                  </div>
                ))}
              </div>
              <dl className="mt-5 grid gap-x-8 gap-y-4 text-sm leading-6 md:grid-cols-2">
                <PriorityField label="Why it matters" value={item.impact} />
                <PriorityField label="Main supported driver" value={item.driver} />
                <PriorityField label="Do next" value={item.nextCheck} />
                <PriorityField label="Verify with" value={item.verificationMetric} />
              </dl>
              <details className="mt-5 border-t border-border pt-4">
                <summary className="cursor-pointer text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
                  Details, evidence and limitations
                </summary>
                <div className="mt-4 text-sm leading-6 text-muted">
                  <p><span className="font-semibold text-foreground">Supporting evidence.</span> {item.evidence}</p>
                  <p className="mt-2">Seen on {item.recurrenceDayCount} distinct exception days. Linked Level and Circuit evidence is preserved.</p>
                  {item.confidenceLimitation ? (
                    <p className="mt-2 text-step-warning"><span className="font-semibold">Limitation.</span> {item.confidenceLimitation}</p>
                  ) : null}
                </div>
              </details>
              <a
                href={`#${anomalyIncidentDomId(item.targetIncidentId)}`}
                onClick={(event) => {
                  const handled = !document.dispatchEvent(new CustomEvent<NgeeAnnOpenIncidentEventDetail>(
                    NGEE_ANN_OPEN_INCIDENT_EVENT,
                    {
                      cancelable: true,
                      detail: {
                        incidentId: item.targetIncidentId,
                        trigger: event.currentTarget,
                      },
                    },
                  ));
                  if (handled) event.preventDefault();
                }}
                className="mt-4 inline-flex min-h-10 items-center justify-center rounded-lg border border-primary/25 px-3.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
              >
                View supporting evidence
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
    <div>
      <dt className="font-semibold text-foreground">{label}</dt>
      <dd className="mt-1 text-muted">{value}</dd>
    </div>
  );
}

function priorityStateMessage(view: NgeeAnnDecisionPrioritiesViewModel): { title: string; detail: string } | null {
  if (view.status === "available") return null;
  if (view.status === "empty") {
    return {
      title: "No deterministic theme for this Period",
      detail: "The released daily rule found no eligible exception to rank from the current Evidence.",
    };
  }
  if (view.status === "suppressed") {
    return {
      title: "Theme conclusion suppressed",
      detail: view.limitation ?? "Candidate dates did not pass the released Calendar, coverage, quality or baseline gates.",
    };
  }
  if (view.status === "partial") {
    return {
      title: view.items.length > 0 ? "Themes use partial supporting Evidence" : "No complete theme conclusion",
      detail: view.limitation ?? "Some candidate Evidence is suppressed, partial or unavailable.",
    };
  }
  return {
    title: "Decision themes unavailable",
    detail: view.limitation ?? "The server-owned priority contract is unavailable for this Snapshot.",
  };
}
