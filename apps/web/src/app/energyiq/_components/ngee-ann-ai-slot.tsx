"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { EnergyProjectAnalysisSnapshotDto } from "../../../lib/config-api";
import { EnergyIcon } from "./icons";
import {
  buildNgeeAnnAiRunInput,
  getOrStartNgeeAnnAiRun,
  type NgeeAnnAiFinding,
  type NgeeAnnAiRelationship,
  type NgeeAnnAiRunInput,
  type NgeeAnnAiRunResult,
} from "./ngee-ann-ai-run";
import type { NgeeAnnDecisionPrioritiesViewModel } from "./ngee-ann-overview-view-model";

type SettledRun = {
  identityKey: string;
  result: NgeeAnnAiRunResult;
};

export function NgeeAnnAiSlot({
  snapshot,
  decisionPriorities,
  aiAnalystHref,
  startRun = getOrStartNgeeAnnAiRun,
}: {
  snapshot: EnergyProjectAnalysisSnapshotDto;
  decisionPriorities: NgeeAnnDecisionPrioritiesViewModel;
  aiAnalystHref?: string;
  startRun?: (input: NgeeAnnAiRunInput) => Promise<NgeeAnnAiRunResult>;
}) {
  const input = useMemo(
    () => buildNgeeAnnAiRunInput(snapshot, decisionPriorities),
    [decisionPriorities, snapshot],
  );
  const identityKey = input?.identityKey ?? null;
  const inputRef = useRef(input);
  const startRunRef = useRef(startRun);
  const [settled, setSettled] = useState<SettledRun | null>(null);
  const [retryRevision, setRetryRevision] = useState(0);
  inputRef.current = input;
  startRunRef.current = startRun;

  useEffect(() => {
    if (!identityKey) return;
    const currentInput = inputRef.current;
    if (!currentInput) return;
    let active = true;
    void startRunRef.current(currentInput)
      .then((result) => {
        if (active) setSettled({ identityKey, result });
      })
      .catch((error: unknown) => {
        if (active) {
          setSettled({
            identityKey,
            result: {
              status: "unavailable",
              reason: error instanceof Error && error.message.trim()
                ? error.message
                : "The AI Analyst is unavailable for this Snapshot.",
            },
          });
        }
      });
    return () => {
      active = false;
    };
  }, [identityKey, retryRevision]);

  if (!input) {
    return (
      <AiSlotFrame>
        <AiUnavailable detail="AI analysis needs a ready electricity Snapshot with complete 1d, 7d and 28d decision context." />
      </AiSlotFrame>
    );
  }

  if (!settled || settled.identityKey !== input.identityKey) {
    return (
      <AiSlotFrame>
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-4" role="status" aria-live="polite">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 animate-pulse items-center justify-center rounded-full bg-primary/10 text-primary">
              <EnergyIcon name="spark" className="h-4 w-4" />
            </span>
            <div>
              <p className="text-xs font-semibold text-foreground">Analyzing / Thinking…</p>
              <p className="mt-1 text-[11px] leading-5 text-muted">
                The deterministic Overview is ready. The AI energy analyst is independently querying this pinned Snapshot in the background.
              </p>
            </div>
          </div>
        </div>
      </AiSlotFrame>
    );
  }

  if (settled.result.status === "unavailable") {
    return (
      <AiSlotFrame>
        <AiUnavailable
          detail={settled.result.reason}
          onRetry={() => {
            setSettled(null);
            setRetryRevision((current) => current + 1);
          }}
        />
      </AiSlotFrame>
    );
  }

  return (
    <AiSlotFrame>
      <div className="grid gap-3 xl:grid-cols-3" aria-label="AI energy analyst findings">
        {settled.result.findings.map((finding) => (
          <AiFindingCard
            key={finding.id}
            finding={finding}
            projectId={input.projectId}
            aiAnalystHref={aiAnalystHref}
          />
        ))}
      </div>
      <p className="mt-3 text-[10px] leading-4 text-muted-light">
        AI-generated candidates can support, challenge, or extend the deterministic theme. SQL Evidence remains pinned to Snapshot {input.snapshotId} through {input.dataCutoff}.
      </p>
    </AiSlotFrame>
  );
}

function AiSlotFrame({ children }: { children: React.ReactNode }) {
  return (
    <section aria-labelledby="ngee-ann-ai-slot" className="border-b border-border bg-surface px-5 py-5 lg:px-7 lg:py-6">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="ngee-ann-ai-slot" className="text-base font-semibold tracking-[-0.015em] text-foreground">
              AI energy analyst
            </h3>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-primary">
              AI-generated
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted">
            Three autonomous, SQL-backed angles prepared from the current Project Snapshot.
          </p>
        </div>
        <p className="text-[10px] leading-4 text-muted-light">Optional layer / deterministic KPIs stay authoritative</p>
      </div>
      {children}
    </section>
  );
}

function AiUnavailable({ detail, onRetry }: { detail: string; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-border bg-surface-subtle px-4 py-4" role="status">
      <p className="text-xs font-semibold text-foreground">AI analysis unavailable</p>
      <p className="mt-1 text-[11px] leading-5 text-muted">{detail}</p>
      <p className="mt-1 text-[10px] leading-4 text-muted-light">The deterministic Overview remains available and unchanged.</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex h-8 items-center justify-center rounded-md border border-border bg-surface px-3 text-[11px] font-semibold text-foreground transition-colors hover:border-primary/30 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
        >
          Retry AI analysis
        </button>
      ) : null}
    </div>
  );
}

function AiFindingCard({
  finding,
  projectId,
  aiAnalystHref,
}: {
  finding: NgeeAnnAiFinding;
  projectId: string;
  aiAnalystHref?: string;
}) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeDialog = useCallback(() => {
    setEvidenceOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!evidenceOpen) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
      ) ?? []);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialogRef.current?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeDialog, evidenceOpen]);

  const askAiHref = aiAnalystHref
    ? buildAskAiDeeperHref(aiAnalystHref, projectId, finding)
    : null;

  return (
    <article className="flex min-w-0 flex-col rounded-lg border border-border bg-surface-subtle px-4 py-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${relationshipTone(finding.relationship)}`}>
          {relationshipLabel(finding.relationship)} theme
        </span>
        {finding.horizons.map((horizon) => (
          <span key={horizon} className="rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-medium text-muted">
            {horizon}
          </span>
        ))}
      </div>
      <h4 className="mt-3 text-sm font-semibold leading-5 text-foreground">{finding.title}</h4>
      <FindingField label="What" text={finding.what} />
      <FindingField label={`Why · ${finding.why.kind}`} text={finding.why.text} />
      <FindingField label="How" text={finding.how} />
      <FindingField label="How to verify" text={finding.howToVerify} />
      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setEvidenceOpen(true)}
          className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-surface px-3 text-[11px] font-semibold text-foreground transition-colors hover:border-primary/30 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
        >
          View evidence
        </button>
        {askAiHref ? (
          <a
            href={askAiHref}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-[11px] font-semibold text-white transition-colors hover:bg-primary-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-2"
          >
            Ask AI deeper
            <EnergyIcon name="arrow" className="h-3 w-3" />
          </a>
        ) : null}
      </div>

      {evidenceOpen ? createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${finding.id}-evidence-title`}
            tabIndex={-1}
            className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-surface p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-primary">Finding Evidence</p>
                <h4 id={`${finding.id}-evidence-title`} className="mt-1 text-base font-semibold text-foreground">{finding.title}</h4>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={closeDialog}
                className="inline-flex h-8 items-center justify-center rounded-md border border-border px-3 text-[11px] font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
              >
                Close
              </button>
            </div>
            <dl className="mt-4 grid gap-2 text-[11px] sm:grid-cols-2">
              <EvidencePin label="Snapshot" value={finding.evidence.snapshotId} mono />
              <EvidencePin label="Data cutoff" value={finding.evidence.dataCutoff} />
              <EvidencePin label="Horizon" value={finding.horizons.join(" / ")} />
              <EvidencePin label="Relationship" value={relationshipLabel(finding.relationship)} />
              <EvidencePin label="Data quality" value={titleCase(finding.evidence.dataQuality.status)} />
              <EvidencePin label="Coverage" value={`${finding.evidence.dataQuality.coveragePct.toLocaleString("en-SG")}%`} />
              <EvidencePin
                label="Valid intervals"
                value={`${finding.evidence.dataQuality.validIntervalCount.toLocaleString("en-SG")} / ${finding.evidence.dataQuality.expectedMeterIntervalCount.toLocaleString("en-SG")}`}
              />
              <EvidencePin label="Quality events" value={finding.evidence.dataQuality.qualityEventCount.toLocaleString("en-SG")} />
            </dl>
            <div className="mt-4 rounded-lg border border-border bg-surface-subtle px-4 py-3" role="note">
              <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-light">Data-quality limitation</p>
              <p className="mt-1 text-xs leading-5 text-muted">{finding.evidence.dataQuality.limitation}</p>
            </div>
            <div className="mt-4 rounded-lg border border-border bg-surface-subtle px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-light">Evidence note</p>
              <p className="mt-1 text-xs leading-5 text-muted">{finding.evidenceNote}</p>
            </div>
            <div className="mt-4 space-y-3">
              {finding.evidence.tools.map((tool, index) => (
                <section key={tool.toolCallId} className="rounded-lg border border-border p-4" aria-label={`SQL Evidence ${index + 1}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-foreground">SQL Evidence {index + 1}</p>
                    <p className="font-mono text-[10px] text-muted-light">{tool.toolCallId}</p>
                  </div>
                  {tool.sql ? (
                    <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-surface-subtle p-3 font-mono text-[10px] leading-5 text-foreground">{tool.sql}</pre>
                  ) : null}
                  <p className="mt-2 text-[10px] text-muted-light">
                    {tool.rowCount === null ? "Rows unavailable" : `${tool.rowCount} rows`}
                    {tool.elapsedMs === null ? "" : ` / ${tool.elapsedMs} ms`}
                    {tool.auditLogId ? ` / Audit ${tool.auditLogId}` : ""}
                  </p>
                  <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface px-3 py-2 font-mono text-[10px] leading-5 text-muted">{tool.resultPreview}</pre>
                </section>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </article>
  );
}

function FindingField({ label, text }: { label: string; text: string }) {
  return (
    <div className="mt-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-light">{label}</p>
      <p className="mt-1 text-[11px] leading-5 text-muted">{text}</p>
    </div>
  );
}

function EvidencePin({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[82px_minmax(0,1fr)] gap-2">
      <dt className="text-muted-light">{label}</dt>
      <dd className={`${mono ? "break-all font-mono" : "break-words"} text-foreground`}>{value}</dd>
    </div>
  );
}

export function buildAskAiDeeperHref(
  baseHref: string,
  projectId: string,
  finding: NgeeAnnAiFinding,
): string {
  const url = new URL(baseHref, "https://energyiq.local");
  const params = new URLSearchParams({
    projectId,
    finding: JSON.stringify({
      title: finding.title,
      what: finding.what,
      why: finding.why,
      how: finding.how,
      howToVerify: finding.howToVerify,
    }),
    evidence: JSON.stringify({
      snapshotId: finding.evidence.snapshotId,
      dataCutoff: finding.evidence.dataCutoff,
      note: finding.evidenceNote,
      dataQuality: finding.evidence.dataQuality,
      toolCallIds: finding.evidence.tools.map((tool) => tool.toolCallId),
      auditLogIds: finding.evidence.tools.flatMap((tool) => tool.auditLogId ? [tool.auditLogId] : []),
    }),
  });
  return `${url.pathname}?${params.toString()}`;
}

function relationshipLabel(relationship: NgeeAnnAiRelationship): string {
  if (relationship === "supports") return "Supports";
  if (relationship === "challenges") return "Challenges";
  return "Independent";
}

function relationshipTone(relationship: NgeeAnnAiRelationship): string {
  if (relationship === "supports") return "bg-step-success/10 text-step-success";
  if (relationship === "challenges") return "bg-step-warning/10 text-step-warning";
  return "bg-primary/10 text-primary";
}

function titleCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
