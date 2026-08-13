import React from "react";

import type { InsightCanvasQuantitativeBlock } from "@datafoundry/contracts";

import type { PreschoolOverviewAiBindingDto } from "../../../lib/config-api";
import { resolvePreschoolAdditionalCanvasRenderer } from "./preschool-additional-ai-insight-canvas-registry";
import { EnergyIcon } from "./icons";
import { SafeAiMarkdown } from "./safe-ai-markdown";

export function PreschoolAdditionalAiInsights({
  unit,
  outerBinding,
  mode,
}: {
  unit: unknown;
  outerBinding: PreschoolOverviewAiBindingDto;
  mode: "live" | "saved";
}) {
  const parsed = parseAdditionalUnit(unit, outerBinding, mode);
  return (
    <section
      aria-labelledby="preschool-additional-ai-insights"
      className="border-b border-border bg-surface px-5 py-6 lg:px-7 lg:py-7"
      data-ai-section="overall-summary"
    >
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <h3 id="preschool-additional-ai-insights" className="text-lg font-semibold tracking-[-0.02em] text-foreground">
          Additional AI Insights
        </h3>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-primary">
          AI-generated
        </span>
      </div>
      <p className="mb-5 max-w-[75ch] text-sm leading-6 text-muted">
        Distinct Evidence-backed angles published for this exact Snapshot and Release.
      </p>
      {parsed.status === "pending" ? (
        <AdditionalStatus title="Additional insights pending" detail="No customer-visible result has been published yet." />
      ) : parsed.status === "unavailable" ? (
        <AdditionalStatus title="Additional insights unavailable" detail={parsed.detail} />
      ) : parsed.status === "empty" ? (
        <AdditionalStatus title="No material additional insight" detail="The published discovery found no distinct Evidence-backed angle worth adding." />
      ) : (
        <div className="space-y-4" aria-label="Additional AI energy insights">
          {parsed.findings.map((finding, index) => finding
            ? <AdditionalFindingCard key={finding.id} finding={finding} />
            : <InvalidAdditionalFinding key={`invalid:${index}`} index={index} />)}
        </div>
      )}
      {mode === "saved" && parsed.status !== "pending" && parsed.status !== "unavailable" ? (
        <p className="mt-3 text-[10px] font-medium text-muted" data-saved-ai-result="true">
          Saved AI result · Run {parsed.runId}
        </p>
      ) : null}
    </section>
  );
}

function AdditionalFindingCard({ finding }: { finding: ParsedAdditionalFinding }) {
  const status = {
    observed: { label: "Observed", tone: "bg-step-success-soft text-step-success" },
    inferred: { label: "Inferred", tone: "bg-step-warning-soft text-step-warning" },
    speculative: { label: "Idea to test", tone: "bg-step-warning-soft text-step-warning" },
  }[finding.epistemicStatus];
  return (
    <article className="rounded-xl border border-primary/20 bg-primary/5 p-4 lg:p-5" data-additional-insight={finding.id}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${status.tone}`}>
            {status.label}
          </span>
          <h4 className="mt-2 text-base font-semibold leading-6 text-foreground">{finding.title}</h4>
        </div>
        {finding.alert ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-step-error-soft px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-step-error">
            <EnergyIcon name="alert" className="h-3 w-3" />
            {finding.alert.severity === "urgent" ? "Urgent alert" : "Attention"} · {finding.alert.certainty}
          </span>
        ) : null}
      </div>
      <SafeAiMarkdown className="mt-2 max-w-[75ch] text-sm leading-6 text-foreground" children={finding.text} />
      {finding.canvas.status === "available" ? (
        <div className="mt-4 grid gap-3" data-additional-canvas-plan={finding.canvas.planId}>
          {finding.canvas.blocks.map((block) => <CanvasBlock key={block.id} block={block} />)}
        </div>
      ) : finding.canvas.status === "invalid" ? (
        <div className="mt-4 rounded-lg border border-step-warning/30 bg-step-warning-soft px-3 py-3" role="status">
          <p className="text-xs font-semibold text-step-warning">Visual unavailable</p>
          <p className="mt-1 text-[11px] leading-5 text-muted">The saved Canvas declaration was not safe to display. The accepted narrative remains available.</p>
        </div>
      ) : null}
      <details className="mt-4 border-t border-primary/15 pt-3">
        <summary className="cursor-pointer text-xs font-semibold text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
          Evidence, Method and limitation
        </summary>
        <div className="mt-2 space-y-2 text-xs leading-5 text-muted">
          <p><span className="font-semibold text-foreground">Evidence</span> · {finding.evidenceRefs.join(" · ")}</p>
          <p><span className="font-semibold text-foreground">Method</span> · {finding.methodLabels.join(" · ")}</p>
          <p><span className="font-semibold text-foreground">Limitation</span> · {epistemicLimitation(finding.epistemicStatus)}</p>
          {finding.canvas.status === "available" && finding.canvas.rejections.length > 0 ? (
            <p>{finding.canvas.rejections.length} unsafe or unsupported Canvas declaration{finding.canvas.rejections.length === 1 ? " was" : "s were"} omitted.</p>
          ) : null}
        </div>
      </details>
    </article>
  );
}

function CanvasBlock({ block }: { block: InsightCanvasQuantitativeBlock }) {
  const Renderer = resolvePreschoolAdditionalCanvasRenderer(block.visualization);
  return Renderer ? <Renderer block={block} /> : null;
}

function AdditionalStatus({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-subtle px-4 py-4" role="status">
      <p className="text-xs font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-[11px] leading-5 text-muted">{detail}</p>
    </div>
  );
}

function InvalidAdditionalFinding({ index }: { index: number }) {
  return (
    <article className="rounded-xl border border-step-warning/30 bg-step-warning-soft p-4" data-additional-insight-invalid={index + 1}>
      <p className="text-xs font-semibold text-step-warning">Insight unavailable</p>
      <p className="mt-1 text-[11px] leading-5 text-muted">This saved Insight was malformed and was not displayed. Other published Insights remain available.</p>
    </article>
  );
}

type ParsedAdditionalFinding = {
  id: string;
  title: string;
  text: string;
  epistemicStatus: "observed" | "inferred" | "speculative";
  evidenceRefs: string[];
  methodLabels: string[];
  alert?: { severity: "attention" | "urgent"; certainty: "confirmed" | "anomaly" | "possible" };
  canvas: { status: "absent" } | { status: "invalid" } | {
    status: "available";
    planId: string;
    blocks: InsightCanvasQuantitativeBlock[];
    rejections: Array<{ code: string; subjectId: string }>;
  };
};

type ParsedAdditionalUnit =
  | { status: "pending" }
  | { status: "unavailable"; detail: string }
  | { status: "empty"; runId: string }
  | { status: "available"; runId: string; findings: Array<ParsedAdditionalFinding | null> };

const CANVAS_REJECTION_CODES = new Set([
  "INPUT_IDENTITY_INVALID",
  "PLAN_INVALID",
  "PLAN_IDENTITY_MISMATCH",
  "FINDING_INVALID",
  "INVESTIGATOR_BLOCK_INVALID",
  "EVIDENCE_BINDING_MISMATCH",
  "EDITOR_PLAN_INVALID",
  "EDITOR_BLOCK_NOT_INVESTIGATED",
  "PRESENTATION_BUDGET_EXCEEDED",
  "PRESENTATION_GAP_INVALID",
]);

function parseAdditionalUnit(
  unit: unknown,
  outerBinding: PreschoolOverviewAiBindingDto,
  mode: "live" | "saved",
): ParsedAdditionalUnit {
  if (!isRecord(unit)) return { status: "unavailable", detail: "The current Additional Artifact is missing." };
  if (unit.status === "queued" || unit.status === "running") return { status: "pending" };
  if (unit.status === "unavailable") {
    return { status: "unavailable", detail: isNonEmptyString(unit.reason) ? unit.reason : "The current Additional Artifact is unavailable." };
  }
  if ((unit.status !== "available" && unit.status !== "empty")
    || !isNonEmptyString(unit.artifactId)
    || !isRecord(unit.result)) {
    return { status: "unavailable", detail: "The current Additional Artifact is invalid." };
  }
  const artifact = unit.result;
  const currentV2 = isRecord(artifact.contract)
    && artifact.contract.id === "energyiq-additional-ai-insights"
    && artifact.contract.revision === "energyiq-additional-ai-insights-v2"
    && isRecord(artifact.publication)
    && artifact.publication.policyRevision === "additional-insights-v2";
  const historicalSavedV1 = mode === "saved"
    && isRecord(artifact.contract)
    && artifact.contract.id === "energyiq-additional-ai-insights"
    && artifact.contract.revision === "energyiq-additional-ai-insights-v1"
    && isRecord(artifact.publication)
    && artifact.publication.policyRevision === "additional-insights-v1";
  if (artifact.artifactKind !== "autonomous-insights"
    || artifact.status !== unit.status
    || !isNonEmptyString(artifact.runId)
    || artifact.providerProfileId !== outerBinding.modelProfileId
    || (!currentV2 && !historicalSavedV1)
    || !bindingMatches(artifact.binding, outerBinding)
    || !isRecord(artifact.evidenceLineage)
    || !evidencePinsMatch(artifact.evidenceLineage.pins, outerBinding)
    || !Array.isArray(artifact.evidenceLineage.facts)
    || !isRecord(artifact.methodExecution)
    || !Array.isArray(artifact.methodExecution.loadedMethods)
    || !Array.isArray(artifact.findings)
    || artifact.findings.length > 3) {
    return { status: "unavailable", detail: "The current Additional Artifact is invalid." };
  }
  if (unit.status === "empty") {
    return artifact.findings.length === 0
      ? { status: "empty", runId: artifact.runId }
      : { status: "unavailable", detail: "The current Additional Artifact is invalid." };
  }
  if (artifact.findings.length === 0) return { status: "unavailable", detail: "The current Additional Artifact is invalid." };
  const methodExecution = artifact.methodExecution;
  const evidenceLineage = artifact.evidenceLineage;
  if (!isRecord(methodExecution) || !isRecord(evidenceLineage)) {
    return { status: "unavailable", detail: "The current Additional Artifact is invalid." };
  }
  const loadedMethods = methodExecution.loadedMethods;
  const facts = evidenceLineage.facts;
  if (!Array.isArray(loadedMethods) || !Array.isArray(facts)) {
    return { status: "unavailable", detail: "The current Additional Artifact is invalid." };
  }
  const factIds = new Set(facts.flatMap((fact) => isRecord(fact) && isNonEmptyString(fact.id) ? [fact.id] : []));
  return {
    status: "available",
    runId: artifact.runId,
    findings: artifact.findings.map((finding) => parseAdditionalFinding(finding, loadedMethods, factIds)),
  };
}

function parseAdditionalFinding(
  finding: unknown,
  loadedMethods: unknown[],
  factIds: ReadonlySet<string>,
): ParsedAdditionalFinding | null {
  if (!isRecord(finding)
    || !isNonEmptyString(finding.id)
    || !isSafeNarrative(finding.title)
    || !isSafeNarrative(finding.text)
    || (finding.epistemicStatus !== "observed" && finding.epistemicStatus !== "inferred" && finding.epistemicStatus !== "speculative")
    || !isUniqueNonEmptyStrings(finding.evidenceRefs, false)
    || finding.evidenceRefs.some((reference) => !factIds.has(reference))
    || !isRecord(finding.origin)
    || !isRecord(finding.origin.coreMethod)
    || !Array.isArray(finding.origin.directionMethods)) return null;
  const methodLabels = [finding.origin.coreMethod, ...finding.origin.directionMethods]
    .flatMap((method) => isRecord(method) && isNonEmptyString(method.skillId) && isNonEmptyString(method.semanticVersion)
      && loadedMethods.some((loaded) => sameMethodIdentity(loaded, method))
      ? [`${method.skillId}@${method.semanticVersion}`]
      : []);
  if (methodLabels.length !== 1 + finding.origin.directionMethods.length) return null;
  const alert = parseAlert(finding.alert, finding.evidenceRefs);
  if (finding.alert !== undefined && !alert) return null;
  return {
    id: finding.id,
    title: finding.title,
    text: finding.text,
    epistemicStatus: finding.epistemicStatus,
    evidenceRefs: [...finding.evidenceRefs],
    methodLabels,
    ...(alert ? { alert } : {}),
    canvas: parseCanvas(finding.canvas, finding.evidenceRefs),
  };
}

function parseCanvas(value: unknown, findingEvidenceRefs: readonly string[]): ParsedAdditionalFinding["canvas"] {
  if (value === undefined) return { status: "absent" };
  if (!isRecord(value)
    || value.contractRevision !== "energyiq-insight-canvas-v2"
    || !isNonEmptyString(value.planId)
    || !isUniqueNonEmptyStrings(value.acceptedBlockIds, true)
    || value.acceptedBlockIds.length > 3
    || !Array.isArray(value.acceptedBlocks)
    || value.acceptedBlocks.length !== value.acceptedBlockIds.length
    || !Array.isArray(value.rejections)) return { status: "invalid" };
  const blocks = value.acceptedBlocks.flatMap((block) => isQuantitativeBlock(block, findingEvidenceRefs) ? [block] : []);
  if (blocks.length !== value.acceptedBlocks.length
    || !value.acceptedBlockIds.every((id, index) => blocks[index]?.id === id)
    || !value.rejections.every((rejection) => isRecord(rejection)
      && typeof rejection.code === "string"
      && CANVAS_REJECTION_CODES.has(rejection.code)
      && isNonEmptyString(rejection.subjectId))) {
    return { status: "invalid" };
  }
  return {
    status: "available",
    planId: value.planId,
    blocks,
    rejections: value.rejections as Array<{ code: string; subjectId: string }>,
  };
}

function isQuantitativeBlock(value: unknown, findingEvidenceRefs: readonly string[]): value is InsightCanvasQuantitativeBlock {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && value.kind === "quantitative"
    && resolvePreschoolAdditionalCanvasRenderer(value.visualization) !== null
    && isSafeNarrative(value.title)
    && Array.isArray(value.bindings)
    && value.bindings.length > 0
    && value.bindings.length <= 32
    && value.bindings.every((binding) => isRecord(binding)
      && isNonEmptyString(binding.evidenceRef)
      && findingEvidenceRefs.includes(binding.evidenceRef)
      && isNonEmptyString(binding.entityId)
      && isNonEmptyString(binding.metricId)
      && typeof binding.value === "number"
      && Number.isFinite(binding.value)
      && isNonEmptyString(binding.unit));
}

function parseAlert(
  value: unknown,
  evidenceRefs: readonly string[],
): ParsedAdditionalFinding["alert"] | null | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)
    || (value.severity !== "attention" && value.severity !== "urgent")
    || (value.certainty !== "confirmed" && value.certainty !== "anomaly" && value.certainty !== "possible")
    || !isUniqueNonEmptyStrings(value.evidenceRefs, false)
    || value.evidenceRefs.some((reference) => !evidenceRefs.includes(reference))) return null;
  return { severity: value.severity, certainty: value.certainty };
}

function bindingMatches(value: unknown, expected: PreschoolOverviewAiBindingDto): boolean {
  if (!isRecord(value) || !isRecord(value.analysisPeriod)) return false;
  return value.workspaceId === expected.workspaceId
    && value.projectId === expected.projectId
    && value.scopeId === expected.scopeId
    && value.dataSnapshotId === expected.dataSnapshotId
    && value.projectReleaseId === expected.projectReleaseId
    && value.analysisPeriod.from === expected.analysisPeriod.from
    && value.analysisPeriod.to === expected.analysisPeriod.to
    && value.modelProfileId === expected.modelProfileId
    && value.modelProfileRevision === expected.modelProfileRevision;
}

function evidencePinsMatch(value: unknown, expected: PreschoolOverviewAiBindingDto): boolean {
  if (!isRecord(value)) return false;
  return value.workspaceId === expected.workspaceId
    && value.projectId === expected.projectId
    && value.scopeId === expected.scopeId
    && value.dataSnapshotId === expected.dataSnapshotId
    && value.projectReleaseId === expected.projectReleaseId
    && isNonEmptyString(value.dataCutoff)
    && isNonEmptyString(value.metricVersion);
}

function sameMethodIdentity(left: unknown, right: Record<string, unknown>): boolean {
  if (!isRecord(left)) return false;
  return left.skillId === right.skillId
    && left.semanticVersion === right.semanticVersion
    && left.resourceId === right.resourceId
    && left.resourceRevision === right.resourceRevision
    && left.contentSha256 === right.contentSha256
    && left.scope === right.scope
    && left.workspaceId === right.workspaceId
    && left.userId === right.userId
    && left.role === right.role;
}

function epistemicLimitation(status: ParsedAdditionalFinding["epistemicStatus"]): string {
  if (status === "observed") return "Observed only within the cited current Snapshot Evidence; it does not establish a cause.";
  if (status === "inferred") return "This interpretation must be rechecked against the cited Evidence before action.";
  return "This is a hypothesis to test; the cited Evidence does not confirm the explanation.";
}

function isUniqueNonEmptyStrings(value: unknown, allowEmpty: boolean): value is string[] {
  return Array.isArray(value)
    && (allowEmpty || value.length > 0)
    && value.every(isNonEmptyString)
    && new Set(value).size === value.length;
}

function isSafeNarrative(value: unknown): value is string {
  return isNonEmptyString(value) && value.length <= 1_600;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && /\S/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
