import type {
  EnergyProjectAnalysisSnapshotDto,
  EnergySavedAnalysisAiArtifactInputDto,
  EnergySavedAnalysisDetailDto,
  EnergySavedAnalysisSummaryDto,
  PreschoolOverviewAiSectionIdDto,
} from "../../../lib/config-api";

export type OverviewChangeMetric = {
  id: "usage" | "average-daily-usage" | "peak" | "closed-hours-share";
  label: string;
  previousValue: number;
  currentValue: number;
  delta: number;
  deltaPct: number | null;
  unit: "kWh" | "kW" | "%";
};

export type OverviewChangeSummary = {
  previous: OverviewVersionIdentity & { analysisId: string; sequence: number };
  current: OverviewVersionIdentity;
  metrics: OverviewChangeMetric[];
  ai: {
    previousStatus: "available" | "not-saved";
    currentStatus: "available" | "not-available";
    generationBasisStatus: "same" | "changed" | "unversioned" | null;
    keyFindingsChanged: boolean | null;
    keyFindingEvidenceChanged: boolean | null;
    previousKeyFindings: string[];
    currentKeyFindings: string[];
    sectionChanges: Array<{
      sectionId: PreschoolOverviewAiSectionIdDto;
      previousStatus: string;
      currentStatus: string;
      contentChanged: boolean;
    }>;
    additionalChanged: boolean | null;
    additionalBasisChanged: boolean | null;
  };
};

type OverviewVersionIdentity = {
  snapshotId: string;
  projectReleaseId: string;
  period: { from: string; to: string; timezone: string };
};

export const orderPreviousOverviewCandidates = (input: {
  items: readonly EnergySavedAnalysisSummaryDto[];
  current: EnergyProjectAnalysisSnapshotDto;
}): EnergySavedAnalysisSummaryDto[] => input.items
  .filter((item) => item.projectId === input.current.context.projectId
    && item.scopeId === input.current.context.scopeId
    && item.resource === input.current.context.resource
    && item.dataSnapshotId !== input.current.dataSnapshot.id)
  .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)
    || right.sequence - left.sequence
    || right.id.localeCompare(left.id));

export const isCompatiblePreviousOverview = (
  previous: EnergySavedAnalysisDetailDto,
  current: EnergyProjectAnalysisSnapshotDto,
): boolean => Boolean(previous.snapshot
  && previous.projectId === current.context.projectId
  && previous.scopeId === current.context.scopeId
  && previous.resource === current.context.resource
  && previous.dataSnapshotId !== current.dataSnapshot.id
  && previous.snapshot.context.projectId === current.context.projectId
  && previous.snapshot.context.scopeId === current.context.scopeId
  && previous.snapshot.context.timezone === current.context.timezone
  && sameWindowLength(previous.snapshot, current)
  && chronologicallyPrecedes(previous.snapshot, current)
  && previous.snapshot.context.hierarchyRevisionId === current.context.hierarchyRevisionId
  && previous.snapshot.context.meterMappingRevisionId === current.context.meterMappingRevisionId
  && previous.snapshot.context.meterFormulaRevisionId === current.context.meterFormulaRevisionId
  && previous.snapshot.context.metricVersion === current.context.metricVersion
  && previous.snapshot.context.businessCalendarVersion === current.context.businessCalendarVersion
  && previous.snapshot.context.tariffScheduleVersion === current.context.tariffScheduleVersion
  && previous.snapshot.recipe.id === current.recipe.id
  && previous.snapshot.recipe.version === current.recipe.version
  && previous.snapshot.renderer.key === current.renderer.key
  && previous.snapshot.renderer.version === current.renderer.version
  && previous.snapshot.renderer.contractVersion === current.renderer.contractVersion);

export const buildOverviewChangeSummary = (input: {
  previous: EnergySavedAnalysisDetailDto;
  current: EnergyProjectAnalysisSnapshotDto;
  currentAiArtifact: EnergySavedAnalysisAiArtifactInputDto | null;
}): OverviewChangeSummary | null => {
  if (!isCompatiblePreviousOverview(input.previous, input.current) || !input.previous.snapshot) {
    return null;
  }
  const previousAi = extractAiState(input.previous.aiArtifact, input.previous.snapshot);
  const currentAi = extractAiState(input.currentAiArtifact, input.current);
  const generationBasisStatus = previousAi && currentAi
    ? previousAi.generationBasisFingerprint !== currentAi.generationBasisFingerprint
      ? "changed"
      : previousAi.generationBasisExact && currentAi.generationBasisExact
        ? "same"
        : "unversioned"
    : null;
  const previousSummary = input.previous.analysis.summary;
  const currentSummary = input.current.analysis.summary;
  const metrics = [
    metric("usage", "Total usage", previousSummary.usageKwh, currentSummary.usageKwh, "kWh"),
    metric(
      "average-daily-usage",
      "Average daily use",
      previousSummary.averageDailyUsageKwh,
      currentSummary.averageDailyUsageKwh,
      "kWh",
    ),
    metric("peak", "Peak demand", previousSummary.peakKw, currentSummary.peakKw, "kW"),
    optionalMetric(
      "closed-hours-share",
      "Closed-hours share",
      previousSummary.nonOperatingSharePct,
      currentSummary.nonOperatingSharePct,
      "%",
    ),
  ].filter((value): value is OverviewChangeMetric => value !== null);

  return {
    previous: {
      analysisId: input.previous.id,
      sequence: input.previous.sequence,
      ...identityFromSnapshot(input.previous.snapshot),
    },
    current: identityFromSnapshot(input.current),
    metrics,
    ai: {
      previousStatus: previousAi ? "available" : "not-saved",
      currentStatus: currentAi ? "available" : "not-available",
      generationBasisStatus,
      keyFindingsChanged: previousAi && currentAi
        ? !sameStrings(previousAi.keyFindingFingerprints, currentAi.keyFindingFingerprints)
        : null,
      keyFindingEvidenceChanged: previousAi && currentAi
        ? !sameStrings(previousAi.keyFindingEvidenceFingerprints, currentAi.keyFindingEvidenceFingerprints)
        : null,
      previousKeyFindings: previousAi?.keyFindings ?? [],
      currentKeyFindings: currentAi?.keyFindings ?? [],
      sectionChanges: previousAi && currentAi
        ? SECTION_IDS.flatMap((sectionId) => {
            const previousStatus = previousAi.sectionStatuses.get(sectionId);
            const currentStatus = currentAi.sectionStatuses.get(sectionId);
            const contentChanged = previousAi.sectionFingerprints.get(sectionId)
              !== currentAi.sectionFingerprints.get(sectionId);
            return previousStatus && currentStatus && (previousStatus !== currentStatus || contentChanged)
              ? [{ sectionId, previousStatus, currentStatus, contentChanged }]
              : [];
          })
        : [],
      additionalChanged: previousAi && currentAi
        ? previousAi.additionalFingerprint !== currentAi.additionalFingerprint
        : null,
      additionalBasisChanged: previousAi && currentAi
        ? previousAi.additionalBasisFingerprint !== currentAi.additionalBasisFingerprint
        : null,
    },
  };
};

const identityFromSnapshot = (snapshot: EnergyProjectAnalysisSnapshotDto): OverviewVersionIdentity => ({
  snapshotId: snapshot.dataSnapshot.id,
  projectReleaseId: snapshot.projectRelease.id,
  period: {
    from: snapshot.context.primaryPeriod.start,
    to: snapshot.context.primaryPeriod.endExclusive,
    timezone: snapshot.context.timezone,
  },
});

const metric = (
  id: OverviewChangeMetric["id"],
  label: string,
  previousValue: number,
  currentValue: number,
  unit: OverviewChangeMetric["unit"],
): OverviewChangeMetric => {
  const delta = round(currentValue - previousValue);
  return {
    id,
    label,
    previousValue,
    currentValue,
    delta,
    deltaPct: previousValue === 0 ? null : round((delta / Math.abs(previousValue)) * 100),
    unit,
  };
};

const optionalMetric = (
  id: OverviewChangeMetric["id"],
  label: string,
  previousValue: number | undefined,
  currentValue: number | undefined,
  unit: OverviewChangeMetric["unit"],
): OverviewChangeMetric | null => typeof previousValue === "number" && typeof currentValue === "number"
  ? metric(id, label, previousValue, currentValue, unit)
  : null;

const extractAiState = (
  artifact: EnergySavedAnalysisAiArtifactInputDto | undefined | null,
  expected: EnergyProjectAnalysisSnapshotDto,
): {
  keyFindings: string[];
  keyFindingFingerprints: string[];
  keyFindingEvidenceFingerprints: string[];
  sectionStatuses: Map<PreschoolOverviewAiSectionIdDto, string>;
  sectionFingerprints: Map<PreschoolOverviewAiSectionIdDto, string>;
  additionalStatus: string;
  additionalFingerprint: string;
  additionalBasisFingerprint: string;
  generationBasisFingerprint: string;
  generationBasisExact: boolean;
} | null => {
  if (!artifact || !matchesArtifactIdentity(artifact, expected)) return null;
  if (artifact.contract === "energyiq-saved-ai-result@1") {
    const findings = artifact.result.findings.flatMap((finding) => readableFinding(finding));
    return {
      keyFindings: findings,
      keyFindingFingerprints: artifact.result.findings.map((finding) =>
        stableSerialize(semanticNarrative(finding))),
      keyFindingEvidenceFingerprints: artifact.result.findings.map((finding) => stableSerialize(
        Array.isArray(finding.evidenceRefs) ? [...finding.evidenceRefs].sort() : [],
      )),
      sectionStatuses: new Map(),
      sectionFingerprints: new Map(),
      additionalStatus: "not-applicable",
      additionalFingerprint: "not-applicable",
      additionalBasisFingerprint: "not-applicable",
      generationBasisFingerprint: stableSerialize({
        contract: artifact.contract,
        rendererKey: artifact.rendererKey,
        providerProfileId: artifact.result.providerProfileId,
      }),
      generationBasisExact: false,
    };
  }
  const executive = artifact.result.executive;
  const keyFindings = executive.status === "available"
    ? "findings" in executive.result
      ? executive.result.findings.map(({ title }) => title)
      : executive.result.keyFindings.map(({ takeaway }) => takeaway)
    : [];
  const keyFindingFingerprints = executive.status === "available"
    ? "findings" in executive.result
      ? executive.result.findings.map((finding) => stableSerialize({
          title: finding.title,
          text: finding.text,
          sectionIds: [...finding.sectionIds].sort(),
          alert: finding.alert ? {
            severity: finding.alert.severity,
            certainty: finding.alert.certainty,
          } : null,
        }))
      : executive.result.keyFindings.map((finding) => stableSerialize({
          takeaway: finding.takeaway,
          sectionIds: [...finding.sectionIds].sort(),
        }))
    : [];
  const keyFindingEvidenceFingerprints = executive.status === "available"
    ? "findings" in executive.result
      ? executive.result.findings.map((finding) => stableSerialize([
          ...finding.evidenceRefs,
        ].sort()))
      : executive.result.keyFindings.map((finding) => stableSerialize([...finding.evidenceRefs].sort()))
    : [];
  const additional = artifact.result.additional;
  const executiveContract = executive.status === "available" || executive.status === "empty"
    ? "findings" in executive.result ? "executive-v4" : "executive-v3"
    : "terminal-unavailable";
  return {
    keyFindings,
    keyFindingFingerprints,
    keyFindingEvidenceFingerprints,
    sectionStatuses: new Map(SECTION_IDS.map((sectionId) => [sectionId, artifact.result.sections[sectionId].status])),
    sectionFingerprints: new Map(SECTION_IDS.map((sectionId) => [
      sectionId,
      sectionSemanticFingerprint(artifact.result.sections[sectionId]),
    ])),
    additionalStatus: additional?.status ?? "not-generated",
    additionalFingerprint: additional ? additionalSemanticFingerprint(additional) : "not-generated",
    additionalBasisFingerprint: additional && (additional.status === "available" || additional.status === "empty")
      ? stableSerialize({
          methodSetId: additional.result.methodExecution.methodSetId,
          methodSetRevision: additional.result.methodExecution.methodSetRevision,
          methodSetFingerprint: additional.result.methodExecution.methodSetFingerprint,
          contractRevision: additional.result.contract.revision,
        })
      : "not-generated",
    generationBasisFingerprint: stableSerialize({
      contract: artifact.contract,
      modelProfileId: artifact.result.binding.modelProfileId,
      modelProfileRevision: artifact.result.binding.modelProfileRevision,
      executiveContract,
    }),
    generationBasisExact: false,
  };
};

const matchesArtifactIdentity = (
  artifact: EnergySavedAnalysisAiArtifactInputDto,
  expected: EnergyProjectAnalysisSnapshotDto,
): boolean => {
  if (artifact.snapshotId !== expected.dataSnapshot.id
    || artifact.projectReleaseId !== expected.projectRelease.id
    || artifact.rendererKey !== expected.renderer.key) return false;
  if (artifact.contract === "energyiq-saved-ai-result@1") return true;
  const binding = artifact.result.binding;
  return binding.projectId === expected.context.projectId
    && binding.workspaceId === expected.context.workspaceId
    && binding.scopeId === expected.context.scopeId
    && binding.dataSnapshotId === expected.dataSnapshot.id
    && binding.projectReleaseId === expected.projectRelease.id
    && binding.analysisPeriod.from === expected.context.primaryPeriod.start
    && binding.analysisPeriod.to === expected.context.primaryPeriod.endExclusive;
};

const sameWindowLength = (
  previous: EnergyProjectAnalysisSnapshotDto,
  current: EnergyProjectAnalysisSnapshotDto,
): boolean => {
  const previousDuration = Date.parse(previous.context.primaryPeriod.endExclusive)
    - Date.parse(previous.context.primaryPeriod.start);
  const currentDuration = Date.parse(current.context.primaryPeriod.endExclusive)
    - Date.parse(current.context.primaryPeriod.start);
  return Number.isFinite(previousDuration)
    && Number.isFinite(currentDuration)
    && previousDuration > 0
    && previousDuration === currentDuration;
};

const chronologicallyPrecedes = (
  previous: EnergyProjectAnalysisSnapshotDto,
  current: EnergyProjectAnalysisSnapshotDto,
): boolean => {
  const previousEnd = Date.parse(previous.context.primaryPeriod.endExclusive);
  const currentEnd = Date.parse(current.context.primaryPeriod.endExclusive);
  if (!Number.isFinite(previousEnd) || !Number.isFinite(currentEnd)) return false;
  if (previousEnd < currentEnd) return true;
  if (previousEnd > currentEnd) return false;
  const previousCutoff = previous.dataSnapshot.lastSeenAt ? Date.parse(previous.dataSnapshot.lastSeenAt) : Number.NaN;
  const currentCutoff = current.dataSnapshot.lastSeenAt ? Date.parse(current.dataSnapshot.lastSeenAt) : Number.NaN;
  return Number.isFinite(previousCutoff)
    && Number.isFinite(currentCutoff)
    && previousCutoff < currentCutoff;
};

const sectionSemanticFingerprint = (unit: unknown): string => {
  if (!unit || typeof unit !== "object" || !("status" in unit)) return "invalid";
  const value = unit as { status: string; result?: Record<string, unknown> };
  if (!value.result) return value.status;
  const result = value.result;
  return stableSerialize({
    status: result.status,
    summary: semanticNarrative(result.summary),
    keyPoints: semanticNarrative(result.keyPoints),
    insights: semanticNarrative(result.insights),
    limitation: result.limitation ?? null,
  });
};

const additionalSemanticFingerprint = (unit: unknown): string => {
  if (!unit || typeof unit !== "object" || !("status" in unit)) return "invalid";
  const value = unit as { status: string; result?: { status?: string; findings?: unknown[] } };
  return value.result
    ? stableSerialize({ status: value.result.status, findings: semanticNarrative(value.result.findings ?? []) })
    : value.status;
};

const semanticNarrative = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(semanticNarrative);
  if (!value || typeof value !== "object") return value;
  const ignored = new Set([
    "id",
    "evidenceRefs",
    "toolAuditIds",
    "planId",
    "acceptedBlockIds",
    "binding",
    "runId",
    "providerProfileId",
    "artifactId",
  ]);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !ignored.has(key))
    .map(([key, entry]) => [key, semanticNarrative(entry)]));
};

const stableSerialize = (value: unknown): string => JSON.stringify(stableValue(value));

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, stableValue(entry)]));
};

const readableFinding = (value: Record<string, unknown>): string[] => {
  for (const key of ["title", "takeaway", "text"] as const) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return [candidate.trim()];
  }
  return [];
};

const sameStrings = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => normalize(value) === normalize(right[index] ?? ""));

const normalize = (value: string): string => value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en");
const round = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const SECTION_IDS: readonly PreschoolOverviewAiSectionIdDto[] = [
  "centre-benchmark",
  "standby-wastage",
  "operating-behaviour",
  "planning-outlook",
];
