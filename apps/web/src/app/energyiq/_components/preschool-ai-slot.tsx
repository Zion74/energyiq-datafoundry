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
  type PreschoolAiSectionId,
} from "./preschool-ai-run";
import { AiFindingPresentationView } from "./ai-finding-presentation-view";

type ProgressCallback = (progress: PreschoolAiProgress) => void;
type Settled = { identityKey: string; result: PreschoolAiRunResult };

export function PreschoolAiSlot({
  snapshot,
  sectionId = "page-synthesis",
  aiAnalystHref,
  mode = "live",
  savedResult,
  onCompletedResult,
  startRun = getOrStartPreschoolAiRun,
}: {
  snapshot: EnergyProjectAnalysisSnapshotDto;
  sectionId?: PreschoolAiSectionId;
  aiAnalystHref?: string;
  mode?: "live" | "saved";
  savedResult?: Extract<PreschoolAiRunResult, { status: "available" }>;
  onCompletedResult?: (result: Extract<PreschoolAiRunResult, { status: "available" }>) => void;
  startRun?: (input: PreschoolAiRunInput, onProgress?: ProgressCallback) => Promise<PreschoolAiRunResult>;
}) {
  const input = useMemo(() => buildPreschoolAiRunInput(snapshot), [snapshot]);
  const inputRef = useRef(input);
  const startRunRef = useRef(startRun);
  const onCompletedResultRef = useRef(onCompletedResult);
  const [settled, setSettled] = useState<Settled | null>(null);
  const [progress, setProgress] = useState<{ identityKey: string; stage: PreschoolAiProgress } | null>(null);
  inputRef.current = input;
  startRunRef.current = startRun;
  onCompletedResultRef.current = onCompletedResult;

  useEffect(() => {
    if (mode === "saved") return;
    if (!input) return;
    const currentInput = inputRef.current;
    if (!currentInput) return;
    const identityKey = currentInput.identityKey;
    let active = true;
    void startRunRef.current(currentInput, (stage) => {
      if (active) setProgress({ identityKey, stage });
    }).then((result) => {
      if (active) {
        setSettled({ identityKey, result });
        if (result.status === "available") onCompletedResultRef.current?.(result);
      }
    }).catch(() => {
      if (active) setSettled({
        identityKey,
        result: { status: "unavailable", reason: "AI analysis is temporarily unavailable." },
      });
    });
    return () => { active = false; };
  }, [input?.identityKey, mode]);

  if (mode === "saved" && !savedResult) {
    if (sectionId !== "page-synthesis") return null;
    return (
      <AiFrame sectionId={sectionId}>
        <Unavailable detail="No completed AI result was attached when this analysis was saved. Opening a saved result never starts a new AI run." />
      </AiFrame>
    );
  }

  if (!input) return sectionId === "page-synthesis"
    ? <AiFrame sectionId={sectionId}><Unavailable detail="AI analysis needs one complete, release-pinned Preschool Snapshot." /></AiFrame>
    : null;
  const displayedResult = mode === "saved"
    ? savedResult
    : settled?.identityKey === input.identityKey
      ? settled.result
      : null;
  if (!displayedResult) {
    if (sectionId !== "page-synthesis") return null;
    const stage = progress?.identityKey === input.identityKey ? progress.stage : "queued";
    return (
      <AiFrame sectionId={sectionId}>
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
  if (displayedResult.status === "unavailable") return sectionId === "page-synthesis"
    ? <AiFrame sectionId={sectionId}><Unavailable detail={displayedResult.reason} /></AiFrame>
    : null;
  const availableResult = displayedResult;
  const sectionFindings = availableResult.findings.filter((finding) => findingSectionId(finding) === sectionId);
  if (sectionFindings.length === 0) {
    if (sectionId !== "page-synthesis") return null;
    return (
      <AiFrame sectionId={sectionId}>
        <div className="rounded-lg border border-border bg-surface-subtle px-4 py-4" role="status">
          <p className="text-xs font-semibold text-foreground">
            {availableResult.findings.length > 0 ? "Section interpretations ready" : "No additional Evidence-backed candidates"}
          </p>
          <p className="mt-1 text-[11px] leading-5 text-muted">
            {availableResult.findings.length > 0
              ? "The accepted AI findings are shown beside the analysis sections they explain."
              : "The AI Analyst did not find a distinct angle worth adding to the verified signals for this Snapshot."}
          </p>
        </div>
        {mode === "saved" ? (
          <p className="mt-3 text-[10px] font-medium text-muted" data-saved-ai-result="true">
            Saved AI result · Run {availableResult.runId}
          </p>
        ) : null}
      </AiFrame>
    );
  }
  return (
    <AiFrame sectionId={sectionId}>
      <div
        className="space-y-4"
        aria-label="Preschool AI energy analyst findings"
      >
        {sectionFindings.map((finding) => (
          <FindingCard
            key={finding.id}
            finding={finding}
            pack={`${availableResult.packId}@${availableResult.packRevision}`}
            projectId={input.projectId}
            aiAnalystHref={aiAnalystHref}
          />
        ))}
      </div>
      {mode === "saved" ? (
        <p className="mt-3 text-[10px] font-medium text-muted" data-saved-ai-result="true">
          Saved AI result · Run {availableResult.runId}
        </p>
      ) : null}
      <p className="mt-4 text-xs leading-5 text-muted-light">
        AI suggestions are based on this pinned Snapshot. Verified KPIs and Evidence remain authoritative.
      </p>
    </AiFrame>
  );
}

function AiFrame({ children, sectionId }: { children: React.ReactNode; sectionId: PreschoolAiSectionId }) {
  if (sectionId !== "page-synthesis") {
    return (
      <aside className="mt-5 rounded-xl border border-primary/20 bg-primary/5 p-4 lg:p-5" aria-label="AI interpretation for this section" data-ai-section={sectionId}>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <EnergyIcon name="spark" className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold text-foreground">AI interpretation</p>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-primary">AI-generated</span>
        </div>
        {children}
      </aside>
    );
  }
  return (
    <section aria-labelledby="preschool-ai-slot" className="border-b border-border bg-surface px-5 py-5 lg:px-7 lg:py-6" data-ai-section={sectionId}>
      <div className="mb-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="preschool-ai-slot" className="text-xl font-semibold tracking-[-0.02em] text-foreground">AI analyst briefing</h3>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-primary">AI-generated</span>
          </div>
          <p className="mt-1.5 text-sm leading-6 text-muted">What stands out, why it matters, and what to check next.</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function findingSectionId(finding: PreschoolAiFinding): PreschoolAiSectionId {
  return finding.sectionId ?? "page-synthesis";
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
    <article className="min-w-0 rounded-xl border border-border bg-surface px-5 py-5 lg:px-6 lg:py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h4 className="max-w-5xl text-lg font-semibold leading-7 tracking-[-0.015em] text-foreground">{finding.title}</h4>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${relationshipClass(finding.relationship)}`}>
          {relationshipLabel(finding.relationship)}
        </span>
      </div>

      <div className="mt-5" data-ai-primary-takeaway="true">
        <p className="text-xs font-semibold text-muted">What the data shows</p>
        <p className="mt-1.5 max-w-[75ch] text-base font-semibold leading-7 text-foreground">{finding.what}</p>
      </div>

      <div className="mt-5 grid gap-5 border-t border-border pt-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold text-muted">Why this matters</p>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${whyKindClass(finding.why.kind)}`}>
              {whyKindLabel(finding.why.kind)}
            </span>
          </div>
          <p className="mt-1.5 max-w-[70ch] text-sm leading-6 text-foreground/80">{finding.why.text}</p>
        </div>
        <div className="rounded-xl bg-primary px-5 py-4 text-white" data-ai-primary-action="true">
          <p className="text-xs font-semibold text-white/70">Recommended next check</p>
          <p className="mt-1.5 text-base font-semibold leading-6">{finding.how}</p>
        </div>
      </div>

      <AiFindingPresentationView presentation={finding.presentation} />

      <dl className="mt-5 grid gap-5 border-t border-border pt-5 sm:grid-cols-2">
        <DecisionOutcome label="Expected if acted on" value={finding.expectedIfAct} tone="positive" />
        <DecisionOutcome label="If ignored" value={finding.ifIgnored} tone="warning" />
      </dl>

      <details className="mt-5 border-t border-border pt-4" data-ai-secondary-details="true">
        <summary className="cursor-pointer text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
          Verification and limitations
        </summary>
        <dl className="mt-4 grid gap-5 text-sm leading-6 sm:grid-cols-2">
          <DecisionDetail label="How to verify" value={finding.howToVerify} />
          <DecisionDetail label="Limitations" value={finding.evidenceNote} />
        </dl>
      </details>

      <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
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

function DecisionOutcome({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "positive" | "warning";
}) {
  return (
    <div>
      <dt className={tone === "positive" ? "font-semibold text-step-success" : "font-semibold text-step-warning"}>{label}</dt>
      <dd className="mt-1.5 max-w-[65ch] text-sm leading-6 text-foreground/80">{value}</dd>
    </div>
  );
}

function DecisionDetail({ label, value }: { label: string; value: string }) {
  return <div><dt className="font-semibold text-foreground">{label}</dt><dd className="mt-1 text-muted">{value}</dd></div>;
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

function relationshipLabel(relationship: PreschoolAiFinding["relationship"]): string {
  if (relationship === "challenges") return "Challenges the current view";
  if (relationship === "independent") return "New investigation angle";
  return "Reinforces a known issue";
}

function whyKindLabel(kind: PreschoolAiFinding["why"]["kind"]): string {
  if (kind === "Evidence") return "Evidence-backed";
  if (kind === "Hypothesis") return "Hypothesis";
  return "Needs more evidence";
}

function whyKindClass(kind: PreschoolAiFinding["why"]["kind"]): string {
  if (kind === "Evidence") return "bg-step-success-soft text-step-success";
  if (kind === "Hypothesis") return "bg-step-warning-soft text-step-warning";
  return "bg-surface-subtle text-muted";
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
