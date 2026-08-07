"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { EnergyProjectAnalysisSnapshotDto } from "../../../lib/config-api";
import { EnergyIcon } from "./icons";
import {
  buildPreschoolAiRunInput,
  getOrStartPreschoolAiRun,
  type PreschoolAiFinding,
  type PreschoolAiProgress,
  type PreschoolAiRunInput,
  type PreschoolAiRunResult,
} from "./preschool-ai-run";
import type { PreschoolOverviewViewModel } from "./preschool-overview-view-model";

type ProgressCallback = (progress: PreschoolAiProgress) => void;
type Settled = { identityKey: string; result: PreschoolAiRunResult };

export function PreschoolAiSlot({
  snapshot,
  decisionSummary,
  aiAnalystHref,
  mode = "live",
  startRun = getOrStartPreschoolAiRun,
}: {
  snapshot: EnergyProjectAnalysisSnapshotDto;
  decisionSummary: PreschoolOverviewViewModel["decisionSummary"];
  aiAnalystHref?: string;
  mode?: "live" | "saved-unavailable";
  startRun?: (input: PreschoolAiRunInput, onProgress?: ProgressCallback) => Promise<PreschoolAiRunResult>;
}) {
  const input = useMemo(() => buildPreschoolAiRunInput(snapshot, decisionSummary), [decisionSummary, snapshot]);
  const inputRef = useRef(input);
  const startRunRef = useRef(startRun);
  const [settled, setSettled] = useState<Settled | null>(null);
  const [progress, setProgress] = useState<{ identityKey: string; stage: PreschoolAiProgress } | null>(null);
  inputRef.current = input;
  startRunRef.current = startRun;

  useEffect(() => {
    if (mode === "saved-unavailable") return;
    if (!input) return;
    const currentInput = inputRef.current;
    if (!currentInput) return;
    const identityKey = currentInput.identityKey;
    let active = true;
    void startRunRef.current(currentInput, (stage) => {
      if (active) setProgress({ identityKey, stage });
    }).then((result) => {
      if (active) setSettled({ identityKey, result });
    }).catch(() => {
      if (active) setSettled({
        identityKey,
        result: { status: "unavailable", reason: "AI analysis is temporarily unavailable." },
      });
    });
    return () => { active = false; };
  }, [input?.identityKey, mode]);

  if (mode === "saved-unavailable") {
    return (
      <AiFrame>
        <Unavailable detail="No completed AI result was attached when this analysis was saved. Opening a saved result never starts a new AI run." />
      </AiFrame>
    );
  }

  if (!input) return <AiFrame><Unavailable detail="AI analysis needs one complete, release-pinned Preschool Snapshot." /></AiFrame>;
  if (!settled || settled.identityKey !== input.identityKey) {
    const stage = progress?.identityKey === input.identityKey ? progress.stage : "queued";
    return (
      <AiFrame>
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-4" role="status" aria-live="polite">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 animate-pulse items-center justify-center rounded-full bg-primary/10 text-primary motion-reduce:animate-none">
              <EnergyIcon name="spark" className="h-4 w-4" />
            </span>
            <div>
              <p className="text-xs font-semibold text-foreground">{progressLabel(stage)}</p>
              <p className="mt-1 text-[11px] leading-5 text-muted">
                The deterministic Overview is ready. The AI energy analyst is inspecting this pinned Preschool Snapshot in the background.
              </p>
            </div>
          </div>
        </div>
      </AiFrame>
    );
  }
  if (settled.result.status === "unavailable") return <AiFrame><Unavailable detail={settled.result.reason} /></AiFrame>;
  const availableResult = settled.result;
  if (availableResult.findings.length === 0) {
    return (
      <AiFrame>
        <div className="rounded-lg border border-border bg-surface-subtle px-4 py-4" role="status">
          <p className="text-xs font-semibold text-foreground">No additional Evidence-backed candidates</p>
          <p className="mt-1 text-[11px] leading-5 text-muted">The AI Analyst did not find a distinct angle worth adding to the deterministic themes for this Snapshot.</p>
        </div>
      </AiFrame>
    );
  }
  return (
    <AiFrame>
      <div
        className={`grid gap-3 ${availableResult.findings.length > 1 ? "lg:grid-cols-2" : ""} ${availableResult.findings.length === 3 ? "xl:grid-cols-3" : ""}`}
        aria-label="Preschool AI energy analyst findings"
      >
        {availableResult.findings.map((finding) => (
          <FindingCard
            key={finding.id}
            finding={finding}
            pack={`${availableResult.packId}@${availableResult.packRevision}`}
            projectId={input.projectId}
            aiAnalystHref={aiAnalystHref}
          />
        ))}
      </div>
      <p className="mt-3 text-[10px] leading-4 text-muted-light">
        AI-generated candidates may support, challenge, or extend the deterministic themes. Published Snapshot and governed projections remain authoritative.
      </p>
    </AiFrame>
  );
}

function AiFrame({ children }: { children: React.ReactNode }) {
  return (
    <section aria-labelledby="preschool-ai-slot" className="border-b border-border bg-surface px-5 py-5 lg:px-7 lg:py-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="preschool-ai-slot" className="text-base font-semibold text-foreground">AI energy analyst</h3>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-primary">AI-generated</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted">Up to three autonomous, Evidence-backed investigation angles for the current Preschool Snapshot.</p>
        </div>
        <p className="text-[10px] leading-4 text-muted-light">Optional layer · deterministic KPIs stay authoritative</p>
      </div>
      {children}
    </section>
  );
}

function Unavailable({ detail }: { detail: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-subtle px-4 py-4" role="status">
      <p className="text-xs font-semibold text-foreground">AI analysis unavailable</p>
      <p className="mt-1 text-[11px] leading-5 text-muted">{detail}</p>
      <p className="mt-1 text-[10px] leading-4 text-muted-light">The verified Overview remains available and unchanged.</p>
    </div>
  );
}

function FindingCard({
  finding,
  pack,
  projectId,
  aiAnalystHref,
}: {
  finding: PreschoolAiFinding;
  pack: string;
  projectId: string;
  aiAnalystHref?: string;
}) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setEvidenceOpen(false);
    triggerRef.current?.focus();
  }, []);
  const askHref = aiAnalystHref ? buildAskHref(aiAnalystHref, projectId, finding) : null;
  return (
    <article className="flex min-w-0 flex-col rounded-lg border border-border bg-surface-subtle px-4 py-4">
      <span className={`w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold ${relationshipClass(finding.relationship)}`}>
        {titleCase(finding.relationship)} theme
      </span>
      <h4 className="mt-3 text-sm font-semibold leading-5 text-foreground">{finding.title}</h4>
      <Field label="What" value={finding.what} />
      <Field label={`Why · ${finding.why.kind}`} value={finding.why.text} />
      <Field label="Next investigation" value={finding.how} />
      <Field label="Expected if acted on" value={finding.expectedIfAct} />
      <Field label="If ignored" value={finding.ifIgnored} />
      <Field label="How to verify" value={finding.howToVerify} />
      <Field label="Limitations" value={finding.evidenceNote} />
      <div className="mt-auto flex flex-wrap gap-2 border-t border-border pt-3">
        <button ref={triggerRef} type="button" onClick={() => setEvidenceOpen(true)} className="h-8 rounded-md border border-border bg-surface px-3 text-[11px] font-semibold text-foreground">
          View evidence
        </button>
        {askHref ? <a href={askHref} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[11px] font-semibold text-white">Ask AI deeper <EnergyIcon name="arrow" className="h-3 w-3" /></a> : null}
      </div>
      {evidenceOpen ? createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
          <div role="dialog" aria-modal="true" aria-labelledby={`${finding.id}-evidence`} className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-surface p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-primary">Finding Evidence</p><h4 id={`${finding.id}-evidence`} className="mt-1 text-base font-semibold text-foreground">{finding.title}</h4></div>
              <button type="button" onClick={close} className="h-8 rounded-md border border-border px-3 text-[11px] font-semibold text-foreground">Close</button>
            </div>
            <dl className="mt-4 grid gap-2 text-[11px] sm:grid-cols-2">
              <Pin label="Analysis Pack" value={pack} />
              <Pin label="Snapshot" value={finding.evidence.snapshotId} />
              <Pin label="Period" value={`${finding.evidence.period.from} / ${finding.evidence.period.to}`} />
              <Pin label="Relationship" value={titleCase(finding.relationship)} />
            </dl>
            <p className="mt-4 rounded-lg border border-border bg-surface-subtle px-4 py-3 text-xs leading-5 text-muted">{finding.evidenceNote}</p>
            {finding.evidence.deterministic.map((item) => (
              <section key={item.id} className="mt-4 rounded-lg border border-border p-4">
                <p className="text-xs font-semibold text-foreground">{item.label}</p>
                <p className="mt-1 font-mono text-[10px] text-muted-light">{item.id}</p>
                <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded-md bg-surface-subtle p-3 font-mono text-[10px] text-muted">{JSON.stringify(item.values, null, 2)}</pre>
                {item.queryIds.length > 0 ? <p className="mt-2 break-words font-mono text-[10px] text-muted-light">Queries: {item.queryIds.join(" / ")}</p> : null}
                {item.limitation ? <p className="mt-2 text-[10px] leading-4 text-muted">{item.limitation}</p> : null}
              </section>
            ))}
            {finding.evidence.tools.map((tool) => (
              <section key={tool.toolCallId} className="mt-4 rounded-lg border border-border p-4">
                <p className="text-xs font-semibold text-foreground">Read-only SQL Evidence</p>
                <p className="mt-1 font-mono text-[10px] text-muted-light">{tool.auditLogId ?? tool.toolCallId}</p>
                <p className="mt-2 text-[10px] text-muted-light">
                  Rows {tool.rowCount?.toLocaleString("en-SG") ?? "unknown"} · {tool.elapsedMs === null ? "Elapsed unavailable" : `${tool.elapsedMs.toLocaleString("en-SG")} ms`}
                </p>
                {tool.sql ? <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded-md bg-surface-subtle p-3 font-mono text-[10px] text-muted">{tool.sql}</pre> : null}
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-surface-subtle p-3 font-mono text-[10px] text-muted">{tool.resultPreview}</pre>
              </section>
            ))}
          </div>
        </div>,
        document.body,
      ) : null}
    </article>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return <div className="mt-3"><p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-light">{label}</p><p className="mt-1 text-xs leading-5 text-foreground/80">{value}</p></div>;
}

function Pin({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-border bg-surface-subtle px-3 py-2"><dt className="text-[10px] uppercase text-muted-light">{label}</dt><dd className="mt-1 break-all font-mono text-[10px] text-foreground">{value}</dd></div>;
}

function progressLabel(progress: PreschoolAiProgress): string {
  if (progress === "queued") return "AI analysis queued…";
  if (progress === "querying") return "Querying Snapshot…";
  if (progress === "validating") return "Validating the investigation…";
  if (progress === "drafting") return "Drafting findings…";
  return "Inspecting scoped data…";
}

function relationshipClass(relationship: PreschoolAiFinding["relationship"]): string {
  if (relationship === "challenges") return "bg-step-warning-soft text-step-warning";
  if (relationship === "independent") return "bg-primary/10 text-primary";
  return "bg-step-success-soft text-step-success";
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function buildAskHref(base: string, projectId: string, finding: PreschoolAiFinding): string {
  const [path, query = ""] = base.split("?", 2);
  const params = new URLSearchParams(query);
  params.set("projectId", projectId);
  params.set("finding", JSON.stringify({
    title: finding.title,
    what: finding.what,
    why: finding.why,
    how: finding.how,
    expectedIfAct: finding.expectedIfAct,
    ifIgnored: finding.ifIgnored,
    howToVerify: finding.howToVerify,
  }));
  params.set("evidence", JSON.stringify({
    snapshotId: finding.evidence.snapshotId,
    dataCutoff: finding.evidence.period.to,
    period: finding.evidence.period,
    note: finding.evidenceNote,
    deterministicEvidenceIds: finding.evidence.deterministic.map((item) => item.id),
    toolCallIds: finding.evidence.tools.map((tool) => tool.toolCallId),
    auditLogIds: finding.evidence.tools.flatMap((tool) => tool.auditLogId ? [tool.auditLogId] : []),
  }));
  return `${path}?${params.toString()}`;
}
