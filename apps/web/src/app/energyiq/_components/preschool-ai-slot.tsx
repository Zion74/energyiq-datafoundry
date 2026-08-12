"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type {
  EnergyProjectAnalysisSnapshotDto,
  PreschoolExecutiveSynthesisResultDto,
  PreschoolOverviewAiReadModelDto,
  PreschoolOverviewAiSectionIdDto,
  PreschoolOverviewAiUnitStatusDto,
  PreschoolSectionInterpretationResultDto,
} from "../../../lib/config-api";
import { EnergyIcon } from "./icons";
import {
  buildPreschoolAiRunInput,
  getOrStartPreschoolAiRun,
  isPendingPreschoolSectionedReadModel,
  retryPreschoolAiRun,
  type PreschoolAiFinding,
  type PreschoolAiProgress,
  type PreschoolAiRunInput,
  type PreschoolAiRunResult,
  type PreschoolAiSectionId,
} from "./preschool-ai-run";
import type { PreschoolAiAcceptedFinding, PreschoolAiEpistemicLevel } from "./preschool-ai-artifact";
import { AiFindingPresentationView } from "./ai-finding-presentation-view";
import { SafeAiMarkdown } from "./safe-ai-markdown";

type ProgressCallback = (progress: PreschoolAiProgress) => void;
type Settled = { identityKey: string; result: PreschoolAiRunResult };

export function PreschoolAiSlot({
  snapshot,
  sectionId = "page-synthesis",
  aiAnalystHref,
  mode = "live",
  savedResult,
  liveResult,
  onResult,
  onCompletedResult,
  startRun = getOrStartPreschoolAiRun,
  retryRun = retryPreschoolAiRun,
}: {
  snapshot: EnergyProjectAnalysisSnapshotDto;
  sectionId?: PreschoolAiSectionId;
  aiAnalystHref?: string;
  mode?: "live" | "saved";
  savedResult?: Extract<PreschoolAiRunResult, { status: "available" }>;
  liveResult?: PreschoolAiRunResult;
  onResult?: (result: PreschoolAiRunResult) => void;
  onCompletedResult?: (result: Extract<PreschoolAiRunResult, { status: "available" }>) => void;
  startRun?: (input: PreschoolAiRunInput, onProgress?: ProgressCallback) => Promise<PreschoolAiRunResult>;
  retryRun?: (
    input: PreschoolAiRunInput,
    onProgress?: ProgressCallback,
    targetId?: PreschoolOverviewAiSectionIdDto | "executive-synthesis",
  ) => Promise<PreschoolAiRunResult>;
}) {
  const input = useMemo(() => buildPreschoolAiRunInput(snapshot), [snapshot]);
  const inputRef = useRef(input);
  const startRunRef = useRef(startRun);
  const retryRunRef = useRef(retryRun);
  const onResultRef = useRef(onResult);
  const onCompletedResultRef = useRef(onCompletedResult);
  const [settled, setSettled] = useState<Settled | null>(null);
  const [progress, setProgress] = useState<{ identityKey: string; stage: PreschoolAiProgress } | null>(null);
  inputRef.current = input;
  startRunRef.current = startRun;
  retryRunRef.current = retryRun;
  onResultRef.current = onResult;
  onCompletedResultRef.current = onCompletedResult;

  const retry = useCallback(() => {
    const currentInput = inputRef.current;
    if (!currentInput) return;
    const identityKey = currentInput.identityKey;
    setSettled(null);
    setProgress({ identityKey, stage: "queued" });
    void retryRunRef.current(
      currentInput,
      (stage) => setProgress({ identityKey, stage }),
      retryTargetForSection(sectionId),
    )
      .then((result) => {
        setSettled({ identityKey, result });
        onResultRef.current?.(result);
      })
      .catch(() => {
        const result = { status: "unavailable", reason: "AI analysis is temporarily unavailable." } as const;
        setSettled({ identityKey, result });
        onResultRef.current?.(result);
      });
  }, []);

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
        onResultRef.current?.(result);
      }
    }).catch(() => {
      if (active) {
        const result = { status: "unavailable", reason: "AI analysis is temporarily unavailable." } as const;
        setSettled({ identityKey, result });
        onResultRef.current?.(result);
      }
    });
    return () => { active = false; };
  }, [input?.identityKey, mode]);

  const completedResult = mode === "live"
    ? liveResult ?? (input && settled?.identityKey === input.identityKey ? settled.result : undefined)
    : undefined;
  useEffect(() => {
    if (completedResult?.status === "available" && !isPendingPreschoolSectionedReadModel(completedResult)) {
      onCompletedResultRef.current?.(completedResult);
    }
  }, [completedResult]);

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
    : liveResult ?? (settled?.identityKey === input.identityKey
      ? settled.result
      : null);
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
    ? <AiFrame sectionId={sectionId}><Unavailable detail={displayedResult.reason} onRetry={mode === "live" && displayedResult.retryable === true ? retry : undefined} /></AiFrame>
    : null;
  const availableResult = displayedResult;
  if (isSectionedReadModel(availableResult)) {
    return (
      <SectionedAiResult
        result={availableResult}
        sectionId={sectionId}
        mode={mode}
        onRetry={mode === "live" ? retry : undefined}
      />
    );
  }
  const sectionFindings = availableResult.findings.filter((finding) => findingMatchesSection(finding, sectionId));
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

function SectionedAiResult({
  result,
  sectionId,
  mode,
  onRetry,
}: {
  result: PreschoolOverviewAiReadModelDto;
  sectionId: PreschoolAiSectionId;
  mode: "live" | "saved";
  onRetry?: () => void;
}) {
  if (sectionId === "page-synthesis") {
    return (
      <AiFrame sectionId={sectionId}>
        <ExecutiveUnit unit={result.executive} completedSectionCount={completedSectionCount(result)} onRetry={onRetry} />
        <SavedRunMarker mode={mode} unit={result.executive} />
      </AiFrame>
    );
  }
  const target = sectionIdToValueTarget(sectionId);
  if (!target) return null;
  const unit = result.sections[target];
  return (
    <AiFrame sectionId={sectionId}>
      <SectionUnit unit={unit} onRetry={onRetry} />
      <SavedRunMarker mode={mode} unit={unit} />
    </AiFrame>
  );
}

function ExecutiveUnit({
  unit,
  completedSectionCount,
  onRetry,
}: {
  unit: PreschoolOverviewAiUnitStatusDto<PreschoolExecutiveSynthesisResultDto>;
  completedSectionCount: number;
  onRetry?: () => void;
}) {
  const coverage = <p className="mb-3 text-xs font-medium text-muted">Based on {completedSectionCount} of 4 sections</p>;
  if (unit.status === "queued" || unit.status === "running") {
    return <>{coverage}<PendingValue detail="The Executive Summary is being composed from completed Section interpretations." /></>;
  }
  if (unit.status === "unavailable") {
    return <>{coverage}<Unavailable detail="The Executive Summary is unavailable. Completed Section interpretations remain visible below." onRetry={onRetry} /></>;
  }
  if (unit.status === "empty") {
    return <>{coverage}<EmptyValue title="No additional Executive Summary finding" detail="The accepted Sections did not support a distinct cross-section message for this Snapshot." /></>;
  }
  return (
    <div>
      <p className="mb-3 text-xs font-medium text-muted">Based on {unit.result.sourceSectionArtifactIds.length || completedSectionCount} of 4 sections</p>
      <ol className="divide-y divide-border" aria-label="AI management priorities">
        {unit.result.keyFindings.map((finding) => (
          <li key={finding.id} className="flex gap-3 py-4 first:pt-0 last:pb-0">
            <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-white">
              <EnergyIcon name="arrow" className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 max-w-[75ch]">
              <SafeAiMarkdown className="text-sm leading-6 text-foreground" children={finding.takeaway} />
              <details className="mt-2">
                <summary className="cursor-pointer text-[10px] font-semibold text-muted">Source Sections and Evidence</summary>
                <p className="mt-1 break-words font-mono text-[10px] leading-4 text-muted-light">
                  {finding.sectionIds.join(" / ")} · {finding.evidenceRefs.join(" / ")}
                </p>
              </details>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function SectionUnit({
  unit,
  onRetry,
}: {
  unit: PreschoolOverviewAiUnitStatusDto<PreschoolSectionInterpretationResultDto>;
  onRetry?: () => void;
}) {
  if (unit.status === "queued" || unit.status === "running") {
    return <PendingValue detail="This Section interpretation is being prepared from its verified Section Pack." />;
  }
  if (unit.status === "unavailable") {
    return <Unavailable detail="This Section interpretation is unavailable. Other Sections and the verified Overview are unchanged." onRetry={onRetry} />;
  }
  if (unit.status === "empty") {
    return <EmptyValue title="No additional AI interpretation" detail="This Section Pack did not support a useful additional conclusion." />;
  }
  return (
    <div>
      <div className="border-b border-primary/15 pb-4" data-ai-takeaway="true">
        <div className="flex items-center gap-2 text-primary">
          <EnergyIcon name="spark" className="h-3.5 w-3.5" />
          <p className="text-xs font-semibold">AI takeaway</p>
        </div>
        {unit.result.summary ? (
          <SafeAiMarkdown className="mt-2 max-w-[75ch] text-base leading-7 text-foreground" children={unit.result.summary} />
        ) : null}
      </div>
      <ul className="divide-y divide-border">
        {unit.result.keyPoints.map((point, index) => (
          <li key={`${point.kind}-${index}`} className="flex gap-3 py-4" data-ai-point-role={point.kind}>
            <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${sectionPointMeta[point.kind].tone}`}>
              <EnergyIcon name={sectionPointMeta[point.kind].icon} className="h-4 w-4" />
            </span>
            <div className="min-w-0 max-w-[75ch]">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${sectionPointMeta[point.kind].tone}`}>
                  {sectionPointMeta[point.kind].label}
                </span>
                {point.label ? <p className="text-sm font-semibold text-foreground">{point.label}</p> : null}
              </div>
              <SafeAiMarkdown className="mt-1 text-sm leading-6 text-foreground" children={point.text} />
              <details className="mt-1.5">
                <summary className="cursor-pointer text-[10px] font-medium text-muted">Evidence references</summary>
                <p className="mt-1 break-words font-mono text-[10px] leading-4 text-muted-light">{point.evidenceRefs.join(" / ")}</p>
              </details>
            </div>
          </li>
        ))}
      </ul>
      {unit.result.limitation ? (
        <details className="mt-3 border-t border-border pt-3">
          <summary className="cursor-pointer text-xs font-semibold text-muted">Limitation</summary>
          <SafeAiMarkdown className="mt-1 text-xs leading-5 text-muted" children={unit.result.limitation} />
        </details>
      ) : null}
    </div>
  );
}

function PendingValue({ detail }: { detail: string }) {
  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3" role="status">
      <p className="text-xs font-semibold text-foreground">AI interpretation in progress</p>
      <p className="mt-1 text-[11px] leading-5 text-muted">{detail}</p>
    </div>
  );
}

function EmptyValue({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-subtle px-4 py-3" role="status">
      <p className="text-xs font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-[11px] leading-5 text-muted">{detail}</p>
    </div>
  );
}

function SavedRunMarker<T>({
  mode,
  unit,
}: {
  mode: "live" | "saved";
  unit: PreschoolOverviewAiUnitStatusDto<T>;
}) {
  if (mode !== "saved" || (unit.status !== "available" && unit.status !== "empty")) return null;
  const result = unit.result as { runId?: string };
  return (
    <p className="mt-3 text-[10px] font-medium text-muted" data-saved-ai-result="true">
      Saved AI result{result.runId ? ` · Run ${result.runId}` : ""}
    </p>
  );
}

const isSectionedReadModel = (
  result: Extract<PreschoolAiRunResult, { status: "available" }>,
): result is PreschoolOverviewAiReadModelDto =>
  "artifactKind" in result && result.artifactKind === "preschool-overview-ai-read-model";

const sectionIdToValueTarget = (sectionId: PreschoolAiSectionId): PreschoolOverviewAiSectionIdDto | null => {
  if (sectionId === "centre-benchmark"
    || sectionId === "standby-wastage"
    || sectionId === "operating-behaviour"
    || sectionId === "planning-outlook") return sectionId;
  return null;
};

const retryTargetForSection = (
  sectionId: PreschoolAiSectionId,
): PreschoolOverviewAiSectionIdDto | "executive-synthesis" | undefined => {
  if (sectionId === "page-synthesis") return "executive-synthesis";
  return sectionIdToValueTarget(sectionId) ?? undefined;
};

const sectionPointMeta = {
  priority: { icon: "alert", label: "Priority", tone: "bg-step-error-soft text-step-error" },
  finding: { icon: "analysis", label: "Supporting signal", tone: "bg-step-inspect/10 text-step-inspect" },
  meaning: { icon: "info", label: "Why it matters", tone: "bg-step-warning-soft text-step-warning" },
  "next-check": { icon: "arrow", label: "Next action", tone: "bg-step-success-soft text-step-success" },
} as const;

function AiFrame({ children, sectionId }: { children: React.ReactNode; sectionId: PreschoolAiSectionId }) {
  if (sectionId === "overall-summary") {
    return (
      <section aria-labelledby="preschool-additional-ai-insights" className="border-b border-border bg-surface px-5 py-6 lg:px-7 lg:py-7" data-ai-section={sectionId}>
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <h3 id="preschool-additional-ai-insights" className="text-lg font-semibold tracking-[-0.02em] text-foreground">Additional AI Insights</h3>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-primary">AI-generated</span>
        </div>
        {children}
      </section>
    );
  }
  if (sectionId !== "page-synthesis") {
    return (
      <aside className="mt-5 rounded-xl border border-primary/20 bg-primary/5 p-4 lg:p-5" aria-label="AI interpretation for this section" data-ai-section={sectionId}>
        <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-primary/15 pb-3">
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
            <h3 id="preschool-ai-slot" className="text-xl font-semibold tracking-[-0.02em] text-foreground">AI Executive Summary</h3>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-primary">AI-generated</span>
          </div>
          <p className="mt-1.5 max-w-[75ch] text-sm leading-6 text-muted">The main cross-section summary, composed only from accepted Section interpretations.</p>
        </div>
      </div>
      {children}
    </section>
  );
}

const completedSectionCount = (result: PreschoolOverviewAiReadModelDto): number =>
  Object.values(result.sections).filter((unit) => unit.status === "available" || unit.status === "empty").length;

type DisplayFinding = PreschoolAiFinding | PreschoolAiAcceptedFinding;

function findingMatchesSection(finding: DisplayFinding, sectionId: PreschoolAiSectionId): boolean {
  if (!isAcceptedFinding(finding)) return (finding.sectionId ?? "page-synthesis") === sectionId;
  return finding.placementTargets.some((target) => {
    if (target === "preschool.benchmark") return sectionId === "centre-benchmark";
    if (target === "preschool.standby") return false;
    if (target === "preschool.operating-hours") return sectionId === "operating-behaviour";
    if (target === "preschool.forecast") return sectionId === "planning-outlook";
    return sectionId === "page-synthesis";
  });
}

function Unavailable({ detail, onRetry }: { detail: string; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-border bg-surface-subtle px-4 py-4" role="status">
      <p className="text-xs font-semibold text-foreground">AI analysis unavailable</p>
      <p className="mt-1 text-[11px] leading-5 text-muted">{detail}</p>
      <p className="mt-1 text-[10px] leading-4 text-muted-light">The verified Overview remains available and unchanged.</p>
      {onRetry ? (
        <button
          type="button"
          className="mt-3 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-surface-subtle"
          onClick={onRetry}
        >
          Retry AI analysis
        </button>
      ) : null}
    </div>
  );
}

function FindingCard({
  finding,
  pack,
  projectId,
  aiAnalystHref,
}: {
  finding: DisplayFinding;
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
  const accepted = isAcceptedFinding(finding);
  const takeaway = accepted ? finding.takeaway : finding.what;
  const interpretation = accepted ? finding.interpretation : finding.why.text;
  const action = accepted ? finding.action : finding.how;
  const expectedIfAct = finding.expectedIfAct;
  const ifIgnored = finding.ifIgnored;
  const possibleExplanation = accepted ? finding.possibleExplanation : undefined;
  const verification = accepted ? finding.verification : finding.howToVerify;
  const limitation = accepted ? finding.uncertainty : finding.evidenceNote;
  const epistemicLevel = accepted ? finding.epistemicLevel : whyKindToEpistemicLevel(finding.why.kind);
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
        <p className="mt-1.5 max-w-[75ch] text-base font-semibold leading-7 text-foreground">{takeaway}</p>
      </div>

      {interpretation || action ? <div className="mt-5 grid gap-5 border-t border-border pt-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
        {interpretation ? <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold text-muted">Why this matters</p>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${epistemicLevelClass(epistemicLevel)}`}>
              {epistemicLevelLabel(epistemicLevel)}
            </span>
          </div>
          <p className="mt-1.5 max-w-[70ch] text-sm leading-6 text-foreground/80">{interpretation}</p>
        </div> : <div />}
        {action ? <div className="rounded-xl bg-primary px-5 py-4 text-white" data-ai-primary-action="true">
          <p className="text-xs font-semibold text-white/70">Recommended next check</p>
          <p className="mt-1.5 text-base font-semibold leading-6">{action}</p>
        </div> : null}
      </div> : null}

      {possibleExplanation ? <div className="mt-5 rounded-xl border border-step-warning/30 bg-step-warning-soft px-5 py-4">
        <p className="text-xs font-semibold text-step-warning">Possible explanation · needs verification</p>
        <p className="mt-1.5 max-w-[75ch] text-sm leading-6 text-foreground/80">{possibleExplanation}</p>
      </div> : null}

      <AiFindingPresentationView presentation={finding.presentation} />

      <dl className="mt-5 grid gap-5 border-t border-border pt-5 sm:grid-cols-2">
        <DecisionOutcome label="Expected if acted on" value={expectedIfAct} tone="positive" />
        <DecisionOutcome label="If ignored" value={ifIgnored} tone="warning" />
      </dl>

      {verification || limitation ? <details className="mt-5 border-t border-border pt-4" data-ai-secondary-details="true">
        <summary className="cursor-pointer text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
          Verification and limitations
        </summary>
        <dl className="mt-4 grid gap-5 text-sm leading-6 sm:grid-cols-2">
          {verification ? <DecisionDetail label="How to verify" value={verification} /> : null}
          {limitation ? <DecisionDetail label="Limitations" value={limitation} /> : null}
        </dl>
      </details> : null}

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
            {limitation ? <p className="mt-4 rounded-lg border border-border bg-surface-subtle px-4 py-3 text-xs leading-5 text-muted">{limitation}</p> : null}
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
  if (progress === "queued" || progress === "inspecting") return "Loading saved AI summary…";
  if (progress === "querying") return "Preparing AI summary…";
  if (progress === "validating") return "Validating the investigation…";
  if (progress === "drafting") return "Drafting findings…";
  return "Loading saved AI summary…";
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

function epistemicLevelLabel(level: PreschoolAiEpistemicLevel): string {
  if (level === "verified") return "Evidence-backed";
  if (level === "hypothesis") return "Hypothesis";
  return "Exploration idea";
}

function epistemicLevelClass(level: PreschoolAiEpistemicLevel): string {
  if (level === "verified") return "bg-step-success-soft text-step-success";
  if (level === "hypothesis") return "bg-step-warning-soft text-step-warning";
  return "bg-surface-subtle text-muted";
}

function whyKindToEpistemicLevel(kind: PreschoolAiFinding["why"]["kind"]): PreschoolAiEpistemicLevel {
  if (kind === "Evidence") return "verified";
  if (kind === "Hypothesis") return "hypothesis";
  return "exploration-idea";
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function buildAskHref(base: string, projectId: string, finding: DisplayFinding): string {
  const [path, query = ""] = base.split("?", 2);
  const params = new URLSearchParams(query);
  params.set("projectId", projectId);
  params.set("finding", JSON.stringify(isAcceptedFinding(finding) ? {
    title: finding.title,
    takeaway: finding.takeaway,
    epistemicLevel: finding.epistemicLevel,
    interpretation: finding.interpretation,
    possibleExplanation: finding.possibleExplanation,
    action: finding.action,
    expectedIfAct: finding.expectedIfAct,
    ifIgnored: finding.ifIgnored,
    verification: finding.verification,
    uncertainty: finding.uncertainty,
  } : {
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
    note: isAcceptedFinding(finding) ? finding.uncertainty : finding.evidenceNote,
    deterministicEvidenceIds: finding.evidence.deterministic.map((item) => item.id),
    toolCallIds: finding.evidence.tools.map((tool) => tool.toolCallId),
    auditLogIds: finding.evidence.tools.flatMap((tool) => tool.auditLogId ? [tool.auditLogId] : []),
  }));
  return `${path}?${params.toString()}`;
}

function isAcceptedFinding(finding: DisplayFinding): finding is PreschoolAiAcceptedFinding {
  return "placementTargets" in finding && "epistemicLevel" in finding && "takeaway" in finding;
}
