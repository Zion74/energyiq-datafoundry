import type {
  EnergyProjectAnalysisSnapshotDto,
  EnergySavedAnalysisAiArtifactInputDto,
  EnergySavedAnalysisDetailDto,
  EnergySavedOverviewComparisonCandidateDto,
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

export type OverviewConclusionChange = {
  state: "retained" | "updated" | "new" | "removed";
  previousTitle?: string;
  currentTitle?: string;
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
    keyFindingChanges: OverviewConclusionChange[];
    sectionChanges: Array<{
      sectionId: PreschoolOverviewAiSectionIdDto;
      previousStatus: string;
      currentStatus: string;
      contentChanged: boolean;
      state: OverviewConclusionChange["state"];
    }>;
    additionalChanged: boolean | null;
    additionalBasisChanged: boolean | null;
    additionalFindingChanges: OverviewConclusionChange[];
  };
};

type OverviewVersionIdentity = {
  snapshotId: string;
  projectReleaseId: string;
  period: { from: string; to: string; timezone: string };
};

type OverviewComparableSnapshot = EnergyProjectAnalysisSnapshotDto
  | EnergySavedOverviewComparisonCandidateDto["snapshot"];

export const orderPreviousOverviewCandidates = <T extends EnergySavedAnalysisSummaryDto>(input: {
  items: readonly T[];
  current: EnergyProjectAnalysisSnapshotDto;
}): T[] => input.items
  .filter((item) => item.projectId === input.current.context.projectId
    && item.scopeId === input.current.context.scopeId
    && item.resource === input.current.context.resource
    && item.dataSnapshotId !== input.current.dataSnapshot.id)
  .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)
    || right.sequence - left.sequence
    || right.id.localeCompare(left.id));

export const isCompatiblePreviousOverview = (
  previous: EnergySavedOverviewComparisonCandidateDto | EnergySavedAnalysisDetailDto,
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
  previous: EnergySavedOverviewComparisonCandidateDto;
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
      keyFindingChanges: previousAi && currentAi
        ? classifyNarrativeChanges(previousAi.keyFindingEntries, currentAi.keyFindingEntries)
        : [],
      sectionChanges: previousAi && currentAi
        ? SECTION_IDS.flatMap((sectionId) => {
            const previousStatus = previousAi.sectionStatuses.get(sectionId);
            const currentStatus = currentAi.sectionStatuses.get(sectionId);
            const contentChanged = previousAi.sectionFingerprints.get(sectionId)
              !== currentAi.sectionFingerprints.get(sectionId);
            const state = previousStatus && currentStatus
              ? classifySectionChange(previousStatus, currentStatus, contentChanged)
              : null;
            return previousStatus && currentStatus && state
              ? [{ sectionId, previousStatus, currentStatus, contentChanged, state }]
              : [];
          })
        : [],
      additionalChanged: previousAi && currentAi
        ? previousAi.additionalFingerprint !== currentAi.additionalFingerprint
        : null,
      additionalBasisChanged: previousAi && currentAi
        ? previousAi.additionalBasisFingerprint !== currentAi.additionalBasisFingerprint
        : null,
      additionalFindingChanges: previousAi && currentAi
        ? classifyNarrativeChanges(previousAi.additionalFindingEntries, currentAi.additionalFindingEntries)
        : [],
    },
  };
};

const identityFromSnapshot = (snapshot: OverviewComparableSnapshot): OverviewVersionIdentity => ({
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
  expected: OverviewComparableSnapshot,
): {
  keyFindings: string[];
  keyFindingEntries: NarrativeFinding[];
  keyFindingFingerprints: string[];
  keyFindingEvidenceFingerprints: string[];
  sectionStatuses: Map<PreschoolOverviewAiSectionIdDto, string>;
  sectionFingerprints: Map<PreschoolOverviewAiSectionIdDto, string>;
  additionalStatus: string;
  additionalFindingEntries: NarrativeFinding[];
  additionalFingerprint: string;
  additionalBasisFingerprint: string;
  generationBasisFingerprint: string;
  generationBasisExact: boolean;
} | null => {
  if (!artifact || !matchesArtifactIdentity(artifact, expected)) return null;
  if (artifact.contract === "energyiq-saved-ai-result@1") {
    const findingEntries: NarrativeFinding[] = artifact.result.findings.flatMap((finding) => {
      const title = readableFinding(finding)[0];
      if (!title) return [];
      const text = [finding.what, finding.text, finding.takeaway]
        .find((value): value is string => typeof value === "string" && Boolean(value.trim())) ?? title;
      return [{ title, text, sectionIds: [] }];
    });
    return {
      keyFindings: findingEntries.map(({ title }) => title),
      keyFindingEntries: findingEntries,
      keyFindingFingerprints: artifact.result.findings.map((finding) =>
        stableSerialize(semanticNarrative(finding))),
      keyFindingEvidenceFingerprints: artifact.result.findings.map((finding) => stableSerialize(
        Array.isArray(finding.evidenceRefs) ? [...finding.evidenceRefs].sort() : [],
      )),
      sectionStatuses: new Map(),
      sectionFingerprints: new Map(),
      additionalStatus: "not-applicable",
      additionalFindingEntries: [],
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
  if (artifact.contract !== "energyiq-saved-ai-result@2") return null;
  const executive = artifact.result.executive;
  const keyFindingEntries: NarrativeFinding[] = executive.status === "available"
    ? "findings" in executive.result
      ? executive.result.findings.map((finding) => ({
          title: finding.title,
          text: finding.text,
          sectionIds: [...finding.sectionIds].sort(),
        }))
      : executive.result.keyFindings.map((finding) => ({
          title: finding.takeaway,
          text: finding.takeaway,
          sectionIds: [...finding.sectionIds].sort(),
        }))
    : [];
  const keyFindings = keyFindingEntries.map(({ title }) => title);
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
  const generationBasis = versionedGenerationBasis(artifact.result);
  return {
    keyFindings,
    keyFindingEntries,
    keyFindingFingerprints,
    keyFindingEvidenceFingerprints,
    sectionStatuses: new Map(SECTION_IDS.map((sectionId) => [sectionId, artifact.result.sections[sectionId].status])),
    sectionFingerprints: new Map(SECTION_IDS.map((sectionId) => [
      sectionId,
      sectionSemanticFingerprint(artifact.result.sections[sectionId]),
    ])),
    additionalStatus: additional?.status ?? "not-generated",
    additionalFindingEntries: narrativeFindingsFromAdditional(additional),
    additionalFingerprint: additional ? additionalSemanticFingerprint(additional) : "not-generated",
    additionalBasisFingerprint: additional && (additional.status === "available" || additional.status === "empty")
      ? stableSerialize({
          methodSetId: additional.result.methodExecution.methodSetId,
          methodSetRevision: additional.result.methodExecution.methodSetRevision,
          methodSetFingerprint: additional.result.methodExecution.methodSetFingerprint,
          contractRevision: additional.result.contract.revision,
        })
      : "not-generated",
    generationBasisFingerprint: stableSerialize(generationBasis.value),
    generationBasisExact: generationBasis.exact,
  };
};

type NarrativeFinding = {
  title: string;
  text: string;
  sectionIds: string[];
};

const classifySectionChange = (
  previousStatus: string,
  currentStatus: string,
  contentChanged: boolean,
): OverviewConclusionChange["state"] | null => {
  const previousHasContent = previousStatus === "available";
  const currentHasContent = currentStatus === "available";
  if (!previousHasContent && !currentHasContent) return null;
  if (!previousHasContent && currentHasContent) return "new";
  if (previousHasContent && !currentHasContent) return "removed";
  return contentChanged ? "updated" : "retained";
};

const narrativeFindingsFromAdditional = (unit: unknown): NarrativeFinding[] => {
  if (!unit || typeof unit !== "object" || !("status" in unit)) return [];
  const value = unit as { status: unknown; result?: unknown };
  if (value.status !== "available" || !value.result || typeof value.result !== "object") return [];
  const findings = (value.result as { findings?: unknown }).findings;
  if (!Array.isArray(findings)) return [];
  return findings.flatMap((finding) => {
    if (!finding || typeof finding !== "object") return [];
    const record = finding as Record<string, unknown>;
    if (typeof record.title !== "string" || !record.title.trim()
      || typeof record.text !== "string" || !record.text.trim()) return [];
    return [{ title: record.title.trim(), text: record.text.trim(), sectionIds: [] }];
  });
};

const classifyNarrativeChanges = (
  previous: readonly NarrativeFinding[],
  current: readonly NarrativeFinding[],
): OverviewConclusionChange[] => {
  const remainingPrevious = new Set(previous.map((_, index) => index));
  const remainingCurrent = new Set(current.map((_, index) => index));
  const retained: OverviewConclusionChange[] = [];
  const updated: OverviewConclusionChange[] = [];

  for (const [previousIndex, previousFinding] of previous.entries()) {
    const currentIndex = [...remainingCurrent].find((index) =>
      narrativeFingerprint(previousFinding) === narrativeFingerprint(current[index]!));
    if (currentIndex === undefined) continue;
    remainingPrevious.delete(previousIndex);
    remainingCurrent.delete(currentIndex);
    retained.push({
      state: "retained",
      previousTitle: previousFinding.title,
      currentTitle: current[currentIndex]!.title,
    });
  }

  for (const previousIndex of [...remainingPrevious]) {
    const previousFinding = previous[previousIndex]!;
    const currentIndex = [...remainingCurrent].find((index) =>
      isSameNarrativeIdentity(previousFinding, current[index]!));
    if (currentIndex === undefined) continue;
    remainingPrevious.delete(previousIndex);
    remainingCurrent.delete(currentIndex);
    updated.push({
      state: "updated",
      previousTitle: previousFinding.title,
      currentTitle: current[currentIndex]!.title,
    });
  }

  return [
    ...retained,
    ...updated,
    ...[...remainingCurrent].map((index): OverviewConclusionChange => ({
      state: "new",
      currentTitle: current[index]!.title,
    })),
    ...[...remainingPrevious].map((index): OverviewConclusionChange => ({
      state: "removed",
      previousTitle: previous[index]!.title,
    })),
  ];
};

const narrativeFingerprint = (finding: NarrativeFinding): string => stableSerialize({
  title: normalize(finding.title),
  text: normalize(finding.text),
  sectionIds: [...finding.sectionIds].sort(),
});

const isSameNarrativeIdentity = (previous: NarrativeFinding, current: NarrativeFinding): boolean =>
  normalize(previous.title) === normalize(current.title)
  && (previous.sectionIds.length === 0 && current.sectionIds.length === 0
    || sameNonEmptySectionLineage(previous.sectionIds, current.sectionIds));

const sameNonEmptySectionLineage = (previous: readonly string[], current: readonly string[]): boolean => {
  if (previous.length === 0 || current.length === 0) return false;
  return stableSerialize([...new Set(previous)].sort()) === stableSerialize([...new Set(current)].sort());
};

const versionedGenerationBasis = (result: Extract<EnergySavedAnalysisAiArtifactInputDto, {
  contract: "energyiq-saved-ai-result@2";
}>["result"]): { value: unknown; exact: boolean } => {
  const sectionBases = SECTION_IDS.map((sectionId) => ({
    sectionId,
    basis: versionedUnitBasis(result.sections[sectionId]),
  }));
  const executiveBasis = versionedUnitBasis(result.executive);
  const additionalBasis = result.additional
    ? versionedUnitBasis(result.additional)
    : { value: "not-generated", exact: true };
  return {
    value: {
      contract: "energyiq-saved-ai-result@2",
      modelProfileId: result.binding.modelProfileId,
      modelProfileRevision: result.binding.modelProfileRevision,
      sections: Object.fromEntries(sectionBases.map(({ sectionId, basis }) => [sectionId, basis.value])),
      executive: executiveBasis.value,
      additional: additionalBasis.value,
    },
    // Saved analysis @2 does not yet persist the complete Artifact identity
    // (workflow, prompt, validator, and identity revisions). The known fields
    // still detect an obvious basis change, but equality is not exact enough to
    // attribute narrative changes to data alone.
    exact: false,
  };
};

const versionedUnitBasis = (unit: unknown): { value: unknown; exact: boolean } => {
  if (!unit || typeof unit !== "object" || !("status" in unit)) return { value: "invalid", exact: false };
  const status = String((unit as { status: unknown }).status);
  if (status !== "available" && status !== "empty") return { value: { status }, exact: true };
  const result = (unit as { result?: unknown }).result;
  if (!result || typeof result !== "object") return { value: { status, result: "missing" }, exact: false };
  const record = result as Record<string, unknown>;
  const contract = record.contract && typeof record.contract === "object"
    ? record.contract as Record<string, unknown>
    : null;
  const revision = typeof contract?.revision === "string" ? contract.revision : null;
  const capability = record.capability && typeof record.capability === "object"
    ? record.capability as Record<string, unknown>
    : null;
  const methodExecution = record.methodExecution && typeof record.methodExecution === "object"
    ? record.methodExecution as Record<string, unknown>
    : null;
  const publication = record.publication && typeof record.publication === "object"
    ? record.publication as Record<string, unknown>
    : null;
  return {
    value: {
      status,
      contractRevision: revision,
      packRevision: typeof record.packRevision === "string" ? record.packRevision : null,
      capabilityRevision: typeof capability?.revision === "string" ? capability.revision : null,
      methodSetId: typeof methodExecution?.methodSetId === "string" ? methodExecution.methodSetId : null,
      methodSetRevision: typeof methodExecution?.methodSetRevision === "string" ? methodExecution.methodSetRevision : null,
      methodSetFingerprint: typeof methodExecution?.methodSetFingerprint === "string"
        ? methodExecution.methodSetFingerprint
        : null,
      publicationRevision: typeof publication?.policyRevision === "string" ? publication.policyRevision : null,
    },
    exact: revision !== null,
  };
};

const matchesArtifactIdentity = (
  artifact: EnergySavedAnalysisAiArtifactInputDto,
  expected: OverviewComparableSnapshot,
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
  previous: OverviewComparableSnapshot,
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
  previous: OverviewComparableSnapshot,
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
