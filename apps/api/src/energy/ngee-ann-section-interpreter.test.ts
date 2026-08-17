import type {
  EnergyIqOverviewAiArtifactIdentity,
  EnergyIqOverviewAiArtifactRecord,
  MetadataStore,
  UserRecord,
} from "@datafoundry/metadata";
import { describe, expect, it, vi } from "vitest";

import type { ProjectAnalysisSnapshot } from "./project-analysis-resolver.js";
import { assembleNgeeAnnSectionPacks } from "./ngee-ann-section-pack.js";
import {
  buildNgeeAnnSectionPrompt,
  createNgeeAnnSectionInterpreter,
  materializeNgeeAnnSectionResult,
} from "./ngee-ann-section-interpreter.js";
import {
  createNgeeAnnOverviewAiSectionArtifactIdentity,
  createOverviewAiArtifactIdentity,
} from "./overview-ai-artifact.js";

describe("materializeNgeeAnnSectionResult", () => {
  it("publishes a useful supported sibling while locally rejecting a malformed candidate", () => {
    const pack = assembleNgeeAnnSectionPacks(snapshot())["trend-and-demand"];
    const identity = createNgeeAnnOverviewAiSectionArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: pack.sectionId,
    });
    const evidenceRef = pack.evidence[0]!.id;

    const result = materializeNgeeAnnSectionResult({
      answer: JSON.stringify({
        sectionId: "trend-and-demand",
        status: "available",
        summary: {
          text: "Project use was 9736.42 kWh and peak demand was 138.8 kW in the current period.",
          evidenceRefs: [evidenceRef],
        },
        candidates: [{
          id: "candidate:kept",
          title: "Peak demand moved differently from total use",
          text: "This contrast may point to a short-duration operational driver rather than a broad rise in consumption.",
          epistemicStatus: "inferred",
          evidenceRefs: [evidenceRef],
          deepDiveQuestion: "Which time blocks contributed most to the 138.8 kW peak?",
        }, {
          id: "candidate:rejected",
          title: "Unsupported exact claim",
          text: "Demand increased by 999.9 kW.",
          epistemicStatus: "observed",
          evidenceRefs: [evidenceRef],
        }],
      }),
      pack,
      identity,
      runId: "run:ngee:trend",
    });

    expect(result).toMatchObject({
      status: "available",
      sectionId: "trend-and-demand",
      summary: { evidenceRefs: [evidenceRef] },
      insights: [{ id: "candidate:kept", epistemicStatus: "inferred" }],
      publication: {
        discoveredCount: 2,
        acceptedCount: 1,
        rejectedCount: 1,
        publishedCount: 1,
        suppressedCandidateIds: [],
        rejectedCandidateIds: ["candidate:rejected"],
      },
    });
  });

  it("keeps a clearly labelled speculative angle when its observation Evidence is current", () => {
    const pack = assembleNgeeAnnSectionPacks(snapshot())["time-behaviour"];
    const identity = createNgeeAnnOverviewAiSectionArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: pack.sectionId,
    });
    const evidenceRef = pack.evidence[0]!.id;

    const result = materializeNgeeAnnSectionResult({
      answer: JSON.stringify({
        sectionId: "time-behaviour",
        status: "available",
        summary: { text: "The hourly profile has a visible daytime concentration.", evidenceRefs: [evidenceRef] },
        candidates: [{
          id: "candidate:hypothesis",
          title: "A timetable boundary may be shaping the profile",
          text: "One possibility is that a shared operating timetable creates the daytime concentration; the current data does not prove the cause.",
          epistemicStatus: "speculative",
          evidenceRefs: [evidenceRef],
          deepDiveQuestion: "Does the pattern persist on non-teaching days?",
        }],
      }),
      pack,
      identity,
      runId: "run:ngee:time",
    });

    expect(result.insights).toEqual([
      expect.objectContaining({ id: "candidate:hypothesis", epistemicStatus: "speculative" }),
    ]);
  });

  it("accepts display-precision rounding while still rejecting an unrelated numeric claim", () => {
    const pack = assembleNgeeAnnSectionPacks(snapshot())["decision-priorities"];
    pack.facts.decisionPriorities = {
      status: "available",
      limitation: null,
      evidencePins: {} as never,
      items: [{ finding: { relativePct: 26.3762, impactKwh: 319.4721 } } as never],
    };
    const identity = createNgeeAnnOverviewAiSectionArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: pack.sectionId,
    });
    const evidenceRef = pack.evidence[0]!.id;

    const result = materializeNgeeAnnSectionResult({
      answer: JSON.stringify({
        sectionId: "decision-priorities",
        status: "available",
        summary: {
          text: "Rolling usage is 26.4% above its comparison baseline.",
          evidenceRefs: [evidenceRef],
        },
        candidates: [{
          id: "candidate:rounded",
          title: "The recent comparison moved materially",
          text: "The current difference is about 319.5 kWh, which may merit a closer look.",
          epistemicStatus: "inferred",
          evidenceRefs: [evidenceRef],
        }, {
          id: "candidate:unsupported",
          title: "An unrelated exact claim",
          text: "The current difference is 777.7 kWh.",
          epistemicStatus: "observed",
          evidenceRefs: [evidenceRef],
        }],
      }),
      pack,
      identity,
      runId: "run:ngee:rounded",
    });

    expect(result).toMatchObject({
      status: "available",
      insights: [{ id: "candidate:rounded" }],
      publication: {
        discoveredCount: 2,
        acceptedCount: 1,
        rejectedCount: 1,
        rejectedCandidateIds: ["candidate:unsupported"],
      },
    });
  });

  it("keeps a useful summary and insight within the readable Ngee Ann card budget", () => {
    const pack = assembleNgeeAnnSectionPacks(snapshot())["time-behaviour"];
    const identity = createNgeeAnnOverviewAiSectionArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: pack.sectionId,
    });
    const evidenceRef = pack.evidence[0]!.id;
    const summaryText = `A supported operational pattern matters to the current review. ${"It links the observed schedule to a focused management question. ".repeat(8)}`;
    const insightText = `This is a supported, decision-relevant explanation of the current hourly pattern. ${"It preserves the useful reasoning instead of deleting the whole card at an arbitrary sentence boundary. ".repeat(6)}`;

    const result = materializeNgeeAnnSectionResult({
      answer: JSON.stringify({
        sectionId: "time-behaviour",
        status: "available",
        summary: { text: summaryText, evidenceRefs: [evidenceRef] },
        candidates: [{
          id: "candidate:readable-long-form",
          title: "The current schedule supports a focused operational question",
          text: insightText,
          epistemicStatus: "inferred",
          evidenceRefs: [evidenceRef],
        }],
      }),
      pack,
      identity,
      runId: "run:ngee:readable-long-form",
    });

    expect(summaryText.length).toBeGreaterThan(480);
    expect(insightText.length).toBeGreaterThan(480);
    expect(result).toMatchObject({
      status: "available",
      summary: { text: summaryText },
      insights: [{ id: "candidate:readable-long-form", text: insightText }],
    });
  });

  it("rejects an embedded or wrong-root response instead of searching for JSON inside text", () => {
    const pack = assembleNgeeAnnSectionPacks(snapshot())["circuit-concentration"];
    const identity = createNgeeAnnOverviewAiSectionArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: pack.sectionId,
    });

    expect(() => materializeNgeeAnnSectionResult({
      answer: `Here is the result: ${JSON.stringify({ sectionId: pack.sectionId, status: "empty", candidates: [] })}`,
      pack,
      identity,
      runId: "run:ngee:bad",
    })).toThrow("ENERGYIQ_NGEE_ANN_SECTION_RESULT_INVALID");
  });
});

describe("buildNgeeAnnSectionPrompt", () => {
  it("keeps every current time cell in a compact projection instead of rejecting a complete Pack", () => {
    const pack = assembleNgeeAnnSectionPacks(snapshot())["time-behaviour"];
    const timeBehaviour = pack.facts.timeBehaviour;
    if (!timeBehaviour) throw new Error("TEST_TIME_BEHAVIOUR_REQUIRED");
    pack.facts.timeBehaviour = {
      ...timeBehaviour,
      scopes: Array.from({ length: 3 }, (_, scopeIndex) => ({
        scopeId: `scope-${scopeIndex + 1}`,
        scopeName: `Scope ${scopeIndex + 1}`,
        scopeType: scopeIndex === 0 ? "project" : "level",
        cells: Array.from({ length: 672 }, (_, index) => ({
          localDate: `2026-06-${String(Math.floor(index / 24) + 1).padStart(2, "0")}`,
          localHour: index % 24,
          from: `from-${scopeIndex}-${index}`,
          to: `to-${scopeIndex}-${index}`,
          usageKwh: scopeIndex * 1_000 + index + 0.125,
          dataHealth: {
            status: "complete",
            coveragePct: 100,
            expectedMeterIntervalCount: 2,
            validIntervalCount: 2,
            qualityEventCount: 0,
          },
        })),
      })),
    };

    const prompt = buildNgeeAnnSectionPrompt(pack);

    expect(prompt.length).toBeLessThan(220_000);
    expect(prompt).toContain("scope-3");
    expect(prompt).toContain("2671.125");
    expect(prompt).toContain("projectedRowCount");
    expect(prompt).toContain("2016");
  });
});

describe("createNgeeAnnSectionInterpreter", () => {
  it("runs at most two independent Sections together and keeps good siblings when one fails", async () => {
    const records = new Map<string, EnergyIqOverviewAiArtifactRecord>();
    const store = fakeArtifactStore(records);
    let active = 0;
    let maxActive = 0;
    const runSection = vi.fn(async (input: {
      identity: EnergyIqOverviewAiArtifactIdentity;
      runId: string;
      sessionId: string;
    }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      const sectionId = input.identity.targetId!;
      const answer = sectionId === "circuit-concentration"
        ? "not-json"
        : JSON.stringify({
            sectionId,
            status: "available",
            summary: {
              text: "The current Section Evidence supports a concise management summary.",
              evidenceRefs: ["evidence:snapshot-ngee:project"],
            },
            candidates: [],
          });
      return { answer, runId: input.runId, sessionId: input.sessionId };
    });
    const interpreter = createNgeeAnnSectionInterpreter({
      metadataStore: { energyIq: { overviewAiArtifacts: store } } as unknown as MetadataStore,
      runSection,
    });
    const source = snapshot();
    const packs = assembleNgeeAnnSectionPacks(source);

    const first = await interpreter.execute({
      baseIdentity: baseIdentity(),
      packs,
      user: { id: "dev-user" } as UserRecord,
    });

    expect(runSection).toHaveBeenCalledTimes(4);
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(first["trend-and-demand"].status).toBe("available");
    expect(first["time-behaviour"].status).toBe("available");
    expect(first["circuit-concentration"]).toMatchObject({
      status: "failed",
      error_code: "ENERGYIQ_NGEE_ANN_SECTION_RESULT_INVALID",
    });
    expect(first["decision-priorities"].status).toBe("available");

    await interpreter.execute({
      baseIdentity: baseIdentity(),
      packs,
      user: { id: "dev-user" } as UserRecord,
    });
    expect(runSection).toHaveBeenCalledTimes(4);

    runSection.mockImplementationOnce(async (input) => ({
      answer: JSON.stringify({
        sectionId: input.identity.targetId,
        status: "available",
        summary: {
          text: "The current Circuit Evidence supports a concise management summary.",
          evidenceRefs: ["evidence:snapshot-ngee:project"],
        },
        candidates: [],
      }),
      runId: input.runId,
      sessionId: input.sessionId,
    }));
    const retried = await interpreter.execute({
      baseIdentity: baseIdentity(),
      packs,
      user: { id: "dev-user" } as UserRecord,
      retryTargets: ["circuit-concentration"],
    });
    expect(runSection).toHaveBeenCalledTimes(5);
    expect(retried["circuit-concentration"].status).toBe("available");
  });
});

const baseIdentity = () => createOverviewAiArtifactIdentity({
  workspaceId: "workspace-ngee",
  projectId: "ngee-ann-polytechnic",
  scopeId: "ngee-ann-polytechnic",
  dataSnapshotId: "snapshot-ngee",
  projectReleaseId: "release-ngee",
  analysisPeriodFrom: "2026-05-19T16:00:00.000Z",
  analysisPeriodTo: "2026-06-16T16:00:00.000Z",
  rendererKey: "ngee-ann-overview",
  rendererVersion: "1",
  modelProfileId: "workspace-default-model-profile",
  modelProfileRevision: 8,
});

const snapshot = (): ProjectAnalysisSnapshot => ({
  context: {
    workspaceId: "workspace-ngee",
    projectId: "ngee-ann-polytechnic",
    scopeId: "ngee-ann-polytechnic",
    primaryPeriod: { start: "2026-05-19T16:00:00.000Z", endExclusive: "2026-06-16T16:00:00.000Z" },
  } as ProjectAnalysisSnapshot["context"],
  projectRelease: { id: "release-ngee" } as ProjectAnalysisSnapshot["projectRelease"],
  recipe: { id: "energy-scope-analysis", version: "1" },
  renderer: { key: "ngee-ann-overview", version: "1", contractVersion: "project-analysis-snapshot@1" },
  dataQuality: { status: "complete", coveragePct: 100, expectedMeterIntervalCount: 1, validIntervalCount: 1, qualityEventCount: 0, cumulativeDeltaMismatchCount: 0, averageKwMismatchCount: 0, invalidIntervalDurationCount: 0, importBatchIds: ["batch"] },
  evidence: [{ id: "evidence:snapshot-ngee:project", metricId: "energy.total_usage_kwh@1", queryIds: ["scope_summary_v1", "time_bucket_grid_v1", "meter_breakdown_v1"] }],
  findings: [],
  decisionPriorities: { status: "empty", limitation: null, evidencePins: {} as never, items: [] },
  dataSnapshot: { id: "snapshot-ngee", importBatchIds: ["batch"], lastSeenAt: null },
  metadata: { status: "missing" } as ProjectAnalysisSnapshot["metadata"],
  analysis: {
    context: {} as never,
    latestAcceptedReading: { status: "not_applicable", queryId: "latest_accepted_reading_v1", reason: { code: "INTERVAL_USAGE_SOURCE", message: "Interval source" } },
    summary: { usageKwh: 9_736.42, averageDailyUsageKwh: 347.73, peakKw: 138.8, validIntervalCount: 1, qualityEventCount: 0 },
    hourlyProfile: [{ hour: 9, usageKwh: 100, averageKw: 12, peakKw: 18, observationCount: 28 }],
    dailyTotals: { metricId: "energy.total_usage_kwh@1", grain: "day", timezone: "Asia/Singapore", scopes: [] },
    timeBehaviour: { metricId: "energy.total_usage_kwh@1", grain: "hour", unit: "kWh", timezone: "Asia/Singapore", queryId: "time_bucket_grid_v1", scopes: [], dayProfiles: [] },
    componentHourlyProfiles: { metricId: "energy.total_usage_kwh@1", queryId: "component_hourly_profiles_v1", accountingBasis: "published_component_circuits", grain: "hour", unit: "kWh", timezone: "Asia/Singapore", scopes: [] },
    comparison: { from: "2026-04-21T16:00:00.000Z", to: "2026-05-19T16:00:00.000Z", usageKwh: 9_000, changeKwh: 736.42, changePct: 8.18 },
    categories: [], childScopes: [], circuits: [], topCircuits: [], designatedTotals: [], virtualMeters: [],
    componentReconciliation: { officialUsageKwh: 9_736.42, componentUsageKwh: 9_000, gapKwh: 736.42, ratioPct: 92.44, officialMeterNodeIds: [], componentMeterNodeIds: [] },
    offHours: { status: "unavailable", reason: { code: "OPERATING_CALENDAR_VERSION_MISSING", message: "Calendar unavailable" } },
    cost: { status: "unavailable", reason: { code: "TARIFF_VERSION_MISSING", message: "Tariff unavailable" } },
    dataHealth: { status: "complete", coveragePct: 100, expectedMeterIntervalCount: 1, validIntervalCount: 1, qualityEventCount: 0, cumulativeDeltaMismatchCount: 0, averageKwMismatchCount: 0, invalidIntervalDurationCount: 0, importBatchIds: ["batch"] },
    units: { usage: "kWh", demand: "kW", intervalMinutes: 30, timezone: "Asia/Singapore" },
    attention: [],
    provenance: { dataSnapshotId: "snapshot-ngee", hierarchyRevisionId: "hierarchy", meterMappingRevisionId: "mapping", meterFormulaRevisionId: "formula", metricVersion: "metrics", ruleRevisionIds: [], aggregationRule: "designated_total", sourceView: "facts", queryIds: ["scope_summary_v1", "time_bucket_grid_v1", "meter_breakdown_v1"] },
    metadata: {} as never,
  },
});

const fakeArtifactStore = (
  records: Map<string, EnergyIqOverviewAiArtifactRecord>,
) => ({
  find: (identity: EnergyIqOverviewAiArtifactIdentity) => records.get(JSON.stringify(identity)),
  get: (identity: EnergyIqOverviewAiArtifactIdentity) => records.get(JSON.stringify(identity))!,
  queue: ({ identity, triggeredBy }: { identity: EnergyIqOverviewAiArtifactIdentity; triggeredBy: string }) => {
    const record = artifactRecord(identity, "queued", triggeredBy);
    records.set(JSON.stringify(identity), record);
    return record;
  },
  claim: ({ identity }: { identity: EnergyIqOverviewAiArtifactIdentity }) => {
    const record = artifactRecord(identity, "running", "dev-user");
    records.set(JSON.stringify(identity), record);
    return { claimed: true, artifact: record };
  },
  complete: ({ identity, resultJson }: {
    identity: EnergyIqOverviewAiArtifactIdentity;
    resultJson: string;
  }) => {
    const record = { ...artifactRecord(identity, "available", "dev-user"), result_json: resultJson };
    records.set(JSON.stringify(identity), record);
    return record;
  },
  fail: ({ identity, errorCode }: {
    identity: EnergyIqOverviewAiArtifactIdentity;
    errorCode: string;
  }) => {
    const record = { ...artifactRecord(identity, "failed", "dev-user"), error_code: errorCode };
    records.set(JSON.stringify(identity), record);
    return record;
  },
});

const artifactRecord = (
  identity: EnergyIqOverviewAiArtifactIdentity,
  status: EnergyIqOverviewAiArtifactRecord["status"],
  triggeredBy: string,
): EnergyIqOverviewAiArtifactRecord => ({
  id: `artifact:${identity.targetId}`,
  identity_hash: "hash",
  identity_json: JSON.stringify(identity),
  workspace_id: identity.workspaceId,
  project_id: identity.projectId,
  scope_id: identity.scopeId,
  resource: "electricity",
  data_snapshot_id: identity.dataSnapshotId,
  project_release_id: identity.projectReleaseId,
  renderer_key: identity.rendererKey,
  renderer_version: identity.rendererVersion,
  analysis_pack_id: identity.analysisPackId,
  analysis_pack_revision: identity.analysisPackRevision,
  model_profile_id: identity.modelProfileId,
  model_profile_revision: identity.modelProfileRevision,
  output_contract_revision: identity.outputContractRevision,
  validator_revision: identity.validatorRevision,
  status,
  attempt_count: status === "queued" ? 0 : 1,
  triggered_by: triggeredBy,
  created_at: "2026-08-17T00:00:00.000Z",
  updated_at: "2026-08-17T00:01:00.000Z",
  ...(status === "available" || status === "failed"
    ? { completed_at: "2026-08-17T00:01:00.000Z" }
    : {}),
});
