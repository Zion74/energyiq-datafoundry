import { describe, expect, it } from "vitest";

import type {
  EnergyProjectAnalysisSnapshotDto,
  EnergySavedAnalysisAiArtifactInputDto,
  EnergySavedAnalysisDetailDto,
  EnergySavedAnalysisSummaryDto,
} from "../../../lib/config-api";
import {
  buildOverviewChangeSummary,
  isCompatiblePreviousOverview,
  orderPreviousOverviewCandidates,
} from "./overview-change-summary";

describe("Overview change summary", () => {
  it("compares immutable A/B identities, decision metrics, and AI conclusions without inventing semantic matches", () => {
    const previous = savedDetail({
      id: "saved-a",
      sequence: 4,
      snapshotId: "snapshot-a",
      releaseId: "release-a",
      from: "2026-05-01T00:00:00.000Z",
      to: "2026-05-29T00:00:00.000Z",
      usageKwh: 1_000,
      averageDailyUsageKwh: 35.71,
      peakKw: 90,
      nonOperatingSharePct: 12,
      keyFindings: ["Closed-hours lighting is the first priority"],
    });
    const current = snapshot({
      snapshotId: "snapshot-b",
      releaseId: "release-b",
      from: "2026-05-08T00:00:00.000Z",
      to: "2026-06-05T00:00:00.000Z",
      usageKwh: 1_100,
      averageDailyUsageKwh: 39.29,
      peakKw: 81,
      nonOperatingSharePct: 10,
    });
    const currentAi = aiArtifact("snapshot-b", "release-b", [
      "G, M and J remain high after normalisation",
      "Closed-hours lighting remains the first priority",
    ]);

    const result = buildOverviewChangeSummary({ previous, current, currentAiArtifact: currentAi });

    expect(result.previous).toMatchObject({ analysisId: "saved-a", snapshotId: "snapshot-a", projectReleaseId: "release-a" });
    expect(result.current).toMatchObject({ snapshotId: "snapshot-b", projectReleaseId: "release-b" });
    expect(result.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "usage", previousValue: 1_000, currentValue: 1_100, delta: 100, deltaPct: 10 }),
      expect.objectContaining({ id: "peak", previousValue: 90, currentValue: 81, delta: -9, deltaPct: -10 }),
      expect.objectContaining({ id: "closed-hours-share", previousValue: 12, currentValue: 10, delta: -2, unit: "%" }),
    ]));
    expect(result.ai.keyFindingsChanged).toBe(true);
    expect(result.ai.previousKeyFindings).toEqual(["Closed-hours lighting is the first priority"]);
    expect(result.ai.currentKeyFindings).toEqual([
      "G, M and J remain high after normalisation",
      "Closed-hours lighting remains the first priority",
    ]);
  });

  it("orders only earlier same-project/scope/resource snapshots and verifies renderer compatibility on detail", () => {
    const current = snapshot({ snapshotId: "snapshot-current", releaseId: "release-current" });
    const candidates: EnergySavedAnalysisSummaryDto[] = [
      summary({ id: "wrong-project", projectId: "other", sequence: 9, snapshotId: "snapshot-x" }),
      summary({ id: "current-copy", sequence: 8, snapshotId: "snapshot-current" }),
      summary({ id: "older", sequence: 3, snapshotId: "snapshot-a" }),
      summary({ id: "newer", sequence: 7, snapshotId: "snapshot-b" }),
    ];

    expect(orderPreviousOverviewCandidates({ items: candidates, current }).map(({ id }) => id)).toEqual(["newer", "older"]);
    expect(isCompatiblePreviousOverview(savedDetail({ id: "newer", sequence: 7, snapshotId: "snapshot-b" }), current)).toBe(true);
    expect(isCompatiblePreviousOverview(savedDetail({
      id: "wrong-renderer",
      sequence: 6,
      snapshotId: "snapshot-c",
      rendererKey: "ngee-ann-overview",
    }), current)).toBe(false);
  });

  it("orders across Saved series by globally comparable creation time instead of per-series sequence", () => {
    const current = snapshot({ snapshotId: "snapshot-current", releaseId: "release-current" });
    const olderHighSequence = summary({
      id: "older-high-sequence",
      sequence: 100,
      seriesId: "series-old",
      snapshotId: "snapshot-old",
      createdAt: "2026-08-10T00:00:00.000Z",
    });
    const newerLowSequence = summary({
      id: "newer-low-sequence",
      sequence: 1,
      seriesId: "series-new",
      snapshotId: "snapshot-new",
      createdAt: "2026-08-15T00:00:00.000Z",
    });

    expect(orderPreviousOverviewCandidates({
      items: [olderHighSequence, newerLowSequence],
      current,
    }).map(({ id }) => id)).toEqual(["newer-low-sequence", "older-high-sequence"]);
  });

  it("withholds misleading metric deltas when the window or deterministic metric basis differs", () => {
    const current = snapshot({ snapshotId: "snapshot-current", releaseId: "release-current" });
    const shorterWindow = savedDetail({
      id: "shorter",
      sequence: 1,
      snapshotId: "snapshot-short",
      from: "2026-05-29T00:00:00.000Z",
      to: "2026-06-05T00:00:00.000Z",
    });
    const differentMetricBasis = savedDetail({
      id: "different-metric",
      sequence: 2,
      snapshotId: "snapshot-metric",
      metricVersion: "energy-metrics-v2",
    });
    const futureWindow = savedDetail({
      id: "future",
      sequence: 3,
      snapshotId: "snapshot-future",
      from: "2026-05-15T00:00:00.000Z",
      to: "2026-06-12T00:00:00.000Z",
    });
    const sameCutoff = savedDetail({
      id: "same-cutoff",
      sequence: 4,
      snapshotId: "snapshot-ambiguous",
      lastSeenAt: "2026-06-05T00:00:00.000Z",
    });

    expect(isCompatiblePreviousOverview(shorterWindow, current)).toBe(false);
    expect(isCompatiblePreviousOverview(differentMetricBasis, current)).toBe(false);
    expect(isCompatiblePreviousOverview(futureWindow, current)).toBe(false);
    expect(isCompatiblePreviousOverview(sameCutoff, current)).toBe(false);
    expect(buildOverviewChangeSummary({
      previous: shorterWindow,
      current,
      currentAiArtifact: null,
    })).toBeNull();
  });

  it("does not reuse a stale current Artifact and detects same-title finding content changes", () => {
    const previous = savedDetail({
      id: "saved-a",
      sequence: 1,
      snapshotId: "snapshot-a",
      keyFindings: ["Same title"],
      keyFindingTexts: ["Previous explanation"],
    });
    const current = snapshot({ snapshotId: "snapshot-b", releaseId: "release-b" });
    const staleCurrentAi = aiArtifact("snapshot-other", "release-other", ["Same title"]);

    const stale = buildOverviewChangeSummary({ previous, current, currentAiArtifact: staleCurrentAi });
    expect(stale?.ai.currentStatus).toBe("not-available");
    expect(stale?.ai.keyFindingsChanged).toBeNull();

    const wrongWorkspace = aiArtifact("snapshot-b", "release-b", ["Same title"]);
    if (wrongWorkspace.contract === "energyiq-saved-ai-result@2") {
      wrongWorkspace.result.binding.workspaceId = "other-workspace";
    }
    expect(buildOverviewChangeSummary({
      previous,
      current,
      currentAiArtifact: wrongWorkspace,
    })?.ai.currentStatus).toBe("not-available");

    const currentAi = aiArtifact("snapshot-b", "release-b", ["Same title"], ["Current explanation"]);
    const changed = buildOverviewChangeSummary({ previous, current, currentAiArtifact: currentAi });
    expect(changed?.ai.keyFindingsChanged).toBe(true);
  });

  it("separates conclusion changes from Evidence lineage and discloses legacy model-basis uncertainty", () => {
    const previous = savedDetail({
      id: "saved-legacy",
      sequence: 1,
      snapshotId: "snapshot-a",
      rendererKey: "ngee-ann-overview",
    });
    previous.aiArtifact = legacyAiArtifact("snapshot-a", "release-a", "Same recommendation", "evidence:a");
    const current = snapshot({
      snapshotId: "snapshot-b",
      releaseId: "release-b",
      rendererKey: "ngee-ann-overview",
    });
    const currentAi = legacyAiArtifact("snapshot-b", "release-b", "Same recommendation", "evidence:b");

    const result = buildOverviewChangeSummary({ previous, current, currentAiArtifact: currentAi });

    expect(result?.ai.generationBasisStatus).toBe("unversioned");
    expect(result?.ai.keyFindingsChanged).toBe(false);
    expect(result?.ai.keyFindingEvidenceChanged).toBe(true);

    const explanationChanged = legacyAiArtifact(
      "snapshot-b",
      "release-b",
      "Same recommendation",
      "evidence:b",
      "A different operational explanation",
    );
    expect(buildOverviewChangeSummary({
      previous,
      current,
      currentAiArtifact: explanationChanged,
    })?.ai.keyFindingsChanged).toBe(true);
  });
});

function snapshot(input: {
  snapshotId: string;
  releaseId: string;
  from?: string;
  to?: string;
  usageKwh?: number;
  averageDailyUsageKwh?: number;
  peakKw?: number;
  nonOperatingSharePct?: number;
  rendererKey?: "preschool-overview" | "ngee-ann-overview";
  metricVersion?: string;
  lastSeenAt?: string | null;
}): EnergyProjectAnalysisSnapshotDto {
  return {
    context: {
      projectId: "preschool-demo",
      scopeId: "project",
      resource: "electricity",
      from: input.from ?? "2026-05-08T00:00:00.000Z",
      to: input.to ?? "2026-06-05T00:00:00.000Z",
      timezone: "Asia/Singapore",
      userId: "admin",
      workspaceId: "preschool-demo-org",
      projectName: "Preschool Demo",
      scopeName: "All centres",
      scopeType: "project",
      endExclusive: true,
      period: "Custom",
      hierarchyRevisionId: "hierarchy-v1",
      meterMappingRevisionId: "mapping-v1",
      meterFormulaRevisionId: "formula-v1",
      metricVersion: input.metricVersion ?? "energy-metrics-v1",
      businessCalendarVersion: "calendar-v1",
      tariffScheduleVersion: "tariff-v1",
      resolvedAt: "2026-08-15T00:00:00.000Z",
      dataSnapshotId: input.snapshotId,
      primaryPeriod: {
        start: input.from ?? "2026-05-08T00:00:00.000Z",
        endExclusive: input.to ?? "2026-06-05T00:00:00.000Z",
      },
      projectReleaseId: input.releaseId,
    },
    renderer: { key: input.rendererKey ?? "preschool-overview", version: "1", contractVersion: "project-analysis-snapshot@1" },
    projectRelease: { id: input.releaseId },
    recipe: { id: "energy-scope-analysis", version: "1" },
    dataSnapshot: {
      id: input.snapshotId,
      importBatchIds: [],
      lastSeenAt: input.lastSeenAt === undefined ? "2026-06-05T00:00:00.000Z" : input.lastSeenAt,
    },
    analysis: {
      summary: {
        usageKwh: input.usageKwh ?? 1_000,
        averageDailyUsageKwh: input.averageDailyUsageKwh ?? 35.71,
        peakKw: input.peakKw ?? 90,
        nonOperatingSharePct: input.nonOperatingSharePct ?? 12,
      },
    },
  } as unknown as EnergyProjectAnalysisSnapshotDto;
}

function savedDetail(input: {
  id: string;
  sequence: number;
  snapshotId: string;
  releaseId?: string;
  from?: string;
  to?: string;
  usageKwh?: number;
  averageDailyUsageKwh?: number;
  peakKw?: number;
  nonOperatingSharePct?: number;
  keyFindings?: string[];
  keyFindingTexts?: string[];
  rendererKey?: "preschool-overview" | "ngee-ann-overview";
  metricVersion?: string;
  lastSeenAt?: string | null;
}): EnergySavedAnalysisDetailDto {
  const frozen = snapshot({
    snapshotId: input.snapshotId,
    releaseId: input.releaseId ?? "release-a",
    from: input.from,
    to: input.to,
    usageKwh: input.usageKwh,
    averageDailyUsageKwh: input.averageDailyUsageKwh,
    peakKw: input.peakKw,
    nonOperatingSharePct: input.nonOperatingSharePct,
    rendererKey: input.rendererKey,
    metricVersion: input.metricVersion,
    lastSeenAt: input.lastSeenAt ?? "2026-06-04T00:00:00.000Z",
  });
  return {
    ...summary({ id: input.id, sequence: input.sequence, snapshotId: input.snapshotId }),
    snapshot: frozen,
    analysis: frozen.analysis,
    aiArtifact: aiArtifact(
      input.snapshotId,
      input.releaseId ?? "release-a",
      input.keyFindings ?? [],
      input.keyFindingTexts,
      input.from,
      input.to,
    ),
  } as unknown as EnergySavedAnalysisDetailDto;
}

function summary(input: {
  id: string;
  sequence: number;
  snapshotId: string;
  projectId?: string;
  seriesId?: string;
  createdAt?: string;
}): EnergySavedAnalysisSummaryDto {
  return {
    id: input.id,
    seriesId: input.seriesId ?? "series-1",
    sequence: input.sequence,
    projectId: input.projectId ?? "preschool-demo",
    scopeId: "project",
    scopeName: "All centres",
    resource: "electricity",
    title: `Overview ${input.sequence}`,
    templateRevisionId: "template-v1",
    dataSnapshotId: input.snapshotId,
    createdBy: "admin",
    createdAt: input.createdAt ?? `2026-08-${String(input.sequence).padStart(2, "0")}T00:00:00.000Z`,
  };
}

function aiArtifact(
  snapshotId: string,
  projectReleaseId: string,
  keyFindings: string[],
  keyFindingTexts?: string[],
  from = "2026-05-08T00:00:00.000Z",
  to = "2026-06-05T00:00:00.000Z",
): EnergySavedAnalysisAiArtifactInputDto {
  return {
    contract: "energyiq-saved-ai-result@2",
    rendererKey: "preschool-overview",
    snapshotId,
    projectReleaseId,
    result: {
      artifactKind: "preschool-overview-ai-read-model",
      status: "available",
      binding: {
        workspaceId: "preschool-demo-org",
        projectId: "preschool-demo",
        scopeId: "project",
        dataSnapshotId: snapshotId,
        projectReleaseId,
        analysisPeriod: { from, to },
        modelProfileId: "workspace-default",
        modelProfileRevision: 8,
      },
      sections: {
        "centre-benchmark": { status: "unavailable", reason: "Not generated." },
        "standby-wastage": { status: "unavailable", reason: "Not generated." },
        "operating-behaviour": { status: "unavailable", reason: "Not generated." },
        "planning-outlook": { status: "unavailable", reason: "Not generated." },
      },
      executive: {
        status: "available",
        artifactId: `executive-${snapshotId}`,
        result: {
          artifactKind: "executive-synthesis",
          status: "available",
          providerProfileId: "workspace-default",
          runId: `run-${snapshotId}`,
          binding: {
            workspaceId: "preschool-demo-org",
            projectId: "preschool-demo",
            scopeId: "project",
            dataSnapshotId: snapshotId,
            projectReleaseId,
            analysisPeriod: { from, to },
            modelProfileId: "workspace-default",
            modelProfileRevision: 8,
          },
          sourceSectionArtifactIds: [],
          summary: { text: "Current summary", evidenceRefs: ["evidence:summary"] },
          findings: keyFindings.map((title, index) => ({
            id: `finding-${index}`,
            title,
            text: keyFindingTexts?.[index] ?? title,
            sectionIds: ["centre-benchmark"],
            evidenceRefs: [`evidence:${index}`],
          })),
        },
      },
    },
  };
}

function legacyAiArtifact(
  snapshotId: string,
  projectReleaseId: string,
  title: string,
  evidenceRef: string,
  what = "Same operational explanation",
): EnergySavedAnalysisAiArtifactInputDto {
  return {
    contract: "energyiq-saved-ai-result@1",
    rendererKey: "ngee-ann-overview",
    snapshotId,
    projectReleaseId,
    result: {
      status: "available",
      providerProfileId: "workspace-default",
      runId: `run-${snapshotId}`,
      findings: [{ title, what, evidenceRefs: [evidenceRef], binding: { dataSnapshotId: snapshotId } }],
    },
  };
}
