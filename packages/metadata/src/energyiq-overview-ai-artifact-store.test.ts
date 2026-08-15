import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1,
  CURRENT_ADDITIONAL_AI_INSIGHT_METHOD_SET_ID,
  CURRENT_ADDITIONAL_AI_INSIGHT_METHOD_SET_REVISION,
  canonicalInsightMethodSetJson,
  resolveCurrentAdditionalAiInsightMethodSet,
  type AdditionalAiInsightsArtifact,
} from "@datafoundry/contracts";

import { createMetadataStore } from "./index.js";
import type {
  EnergyIqOverviewAiArtifactIdentity,
  EnergyIqOverviewAiArtifactRecord,
} from "./energyiq-overview-ai-artifact-store.js";

const identity = (
  dataSnapshotId: string,
): EnergyIqOverviewAiArtifactIdentity => ({
  workspaceId: "artifact-workspace",
  projectId: "artifact-project",
  scopeId: "artifact-project-scope",
  resource: "electricity",
  dataSnapshotId,
  projectReleaseId: "release-v1",
  analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
  analysisPeriodTo: "2026-06-01T00:00:00.000Z",
  rendererKey: "preschool-overview",
  rendererVersion: "v1",
  analysisPackId: "preschool-analysis-pack",
  analysisPackRevision: "v1",
  modelProfileId: "deepseek-v4-flash",
  modelProfileRevision: 3,
  outputContractRevision: "v13",
  validatorRevision: "preschool-ai-two-stage-fact-boundary-v1",
  workflowRevision: "preschool-two-stage-v1",
  investigatorPromptRevision: "preschool-investigator-v1",
  editorPromptRevision: "preschool-insight-editor-v1",
  methodSkillId: "energy-insight-investigation",
  methodSkillRevision: "1.0.0",
});

type SectionV4Identity = EnergyIqOverviewAiArtifactIdentity & {
  identityContractRevision: string;
  capabilityRevision: string;
  publicationRevision: string;
};

describe("EnergyIqOverviewAiArtifactStore", () => {
  it("single-flights one exact identity and keeps Snapshot A immutable when B is queued", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-overview-artifact-"));
    let metadata: ReturnType<typeof createMetadataStore> | undefined;
    try {
      const store = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata = store;
      store.workspaces.upsert({
        id: "artifact-workspace",
        owner_user_id: "dev-user",
        name: "Artifact",
        kind: "customer",
      });
      store.energyIq.upsertProject({
        id: "artifact-project",
        workspace_id: "artifact-workspace",
        name: "Artifact",
        status: "published",
      });

      const queuedA = store.energyIq.overviewAiArtifacts.queue({
        identity: identity("snapshot-a"),
        triggeredBy: "dev-user",
        now: "2026-08-08T12:00:00.000Z",
      });
      const duplicateA = store.energyIq.overviewAiArtifacts.queue({
        identity: identity("snapshot-a"),
        triggeredBy: "dev-user",
        now: "2026-08-08T12:00:01.000Z",
      });

      expect(duplicateA).toEqual(queuedA);
      expect(JSON.parse(queuedA.identity_json)).toMatchObject({
        workflowRevision: "preschool-two-stage-v1",
        investigatorPromptRevision: "preschool-investigator-v1",
        editorPromptRevision: "preschool-insight-editor-v1",
        methodSkillId: "energy-insight-investigation",
        methodSkillRevision: "1.0.0",
      });
      const firstClaim = store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-a"),
        workerId: "api-1",
        leaseMs: 60_000,
        now: "2026-08-08T12:00:02.000Z",
      });
      const competingClaim = store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-a"),
        workerId: "api-2",
        leaseMs: 60_000,
        now: "2026-08-08T12:00:03.000Z",
      });

      expect(firstClaim.claimed).toBe(true);
      expect(firstClaim.artifact).toMatchObject({ status: "running", attempt_count: 1 });
      expect(competingClaim.claimed).toBe(false);

      const resultA = JSON.stringify(acceptedResult(identity("snapshot-a"), "run-a"));
      const completedA = store.energyIq.overviewAiArtifacts.complete({
        identity: identity("snapshot-a"),
        workerId: "api-1",
        runId: "run-a",
        sessionId: "session-a",
        resultJson: resultA,
        now: "2026-08-08T12:00:04.000Z",
      });
      expect(completedA).toMatchObject({
        status: "available",
        data_snapshot_id: "snapshot-a",
        run_id: "run-a",
        result_json: resultA,
      });
      expect(store.energyIq.overviewAiArtifacts.complete({
        identity: identity("snapshot-a"),
        workerId: "api-1",
        runId: "run-a",
        sessionId: "session-a",
        resultJson: resultA,
        now: "2026-08-08T12:00:05.000Z",
      })).toEqual(completedA);
      expect(() => store.energyIq.overviewAiArtifacts.complete({
        identity: identity("snapshot-a"),
        workerId: "api-1",
        runId: "run-other",
        sessionId: "session-a",
        resultJson: JSON.stringify(acceptedResult(identity("snapshot-a"), "run-other")),
        now: "2026-08-08T12:00:06.000Z",
      })).toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_IMMUTABLE");

      const queuedB = store.energyIq.overviewAiArtifacts.queue({
        identity: identity("snapshot-b"),
        triggeredBy: "dev-user",
        now: "2026-08-08T12:00:07.000Z",
      });
      expect(queuedB).toMatchObject({ status: "queued", data_snapshot_id: "snapshot-b" });
      expect(queuedB.id).not.toBe(completedA.id);
      expect(store.energyIq.overviewAiArtifacts.get(identity("snapshot-a"))).toEqual(completedA);
      expect(store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-b"),
        workerId: "api-1",
        leaseMs: 60_000,
        now: "2026-08-08T12:00:08.000Z",
      }).claimed).toBe(true);
      const invalidResultB = acceptedResult(identity("snapshot-b"), "run-b");
      invalidResultB.findings[0]!.epistemicLevel = "hypothesis";
      invalidResultB.findings[0]!.evidence.deterministic = [];
      expect(() => store.energyIq.overviewAiArtifacts.complete({
        identity: identity("snapshot-b"),
        workerId: "api-1",
        runId: "run-b",
        sessionId: "session-b",
        resultJson: JSON.stringify(invalidResultB),
        now: "2026-08-08T12:00:09.000Z",
      })).toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
      const revisedEditor = store.energyIq.overviewAiArtifacts.queue({
        identity: { ...identity("snapshot-a"), editorPromptRevision: "preschool-insight-editor-v2" },
        triggeredBy: "dev-user",
        now: "2026-08-08T12:00:10.000Z",
      });
      expect(revisedEditor.id).not.toBe(completedA.id);
    } finally {
      metadata?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("hashes new value units independently while keeping a legacy identity canonical", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-overview-artifact-kind-"));
    let metadata: ReturnType<typeof createMetadataStore> | undefined;
    try {
      const store = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata = store;
      store.workspaces.upsert({
        id: "artifact-workspace",
        owner_user_id: "dev-user",
        name: "Artifact",
        kind: "customer",
      });
      store.energyIq.upsertProject({
        id: "artifact-project",
        workspace_id: "artifact-workspace",
        name: "Artifact",
        status: "published",
      });

      const legacy = store.energyIq.overviewAiArtifacts.queue({
        identity: identity("snapshot-kind"),
        triggeredBy: "dev-user",
      });
      const benchmarkIdentity: EnergyIqOverviewAiArtifactIdentity = {
        ...identity("snapshot-kind"),
        artifactKind: "section-interpretation",
        targetId: "centre-benchmark",
      };
      const standbyIdentity: EnergyIqOverviewAiArtifactIdentity = {
        ...benchmarkIdentity,
        targetId: "standby-wastage",
      };
      const executiveIdentity: EnergyIqOverviewAiArtifactIdentity = {
        ...identity("snapshot-kind"),
        artifactKind: "executive-synthesis",
        targetId: "sections:none",
      };
      const benchmark = store.energyIq.overviewAiArtifacts.queue({
        identity: benchmarkIdentity,
        triggeredBy: "dev-user",
      });
      const standby = store.energyIq.overviewAiArtifacts.queue({
        identity: standbyIdentity,
        triggeredBy: "dev-user",
      });
      const executive = store.energyIq.overviewAiArtifacts.queue({
        identity: executiveIdentity,
        triggeredBy: "dev-user",
      });

      expect(new Set([legacy.id, benchmark.id, standby.id, executive.id]).size).toBe(4);
      expect(JSON.parse(legacy.identity_json)).not.toHaveProperty("artifactKind");
      expect(JSON.parse(benchmark.identity_json)).toMatchObject({
        artifactKind: "section-interpretation",
        targetId: "centre-benchmark",
      });
      expect(store.energyIq.overviewAiArtifacts.find({
        ...benchmarkIdentity,
        dataSnapshotId: "snapshot-other",
      })).toBeUndefined();
      expect(() => store.energyIq.overviewAiArtifacts.queue({
        identity: { ...identity("snapshot-kind"), artifactKind: "section-interpretation" },
        triggeredBy: "dev-user",
      })).toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_TARGET_REQUIRED");
    } finally {
      metadata?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves the released v3 Section identity hash exactly", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-overview-artifact-v3-hash-"));
    let metadata: ReturnType<typeof createMetadataStore> | undefined;
    try {
      const store = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata = store;
      seedArtifactProject(store);

      const queued = store.energyIq.overviewAiArtifacts.queue({
        identity: sectionV3Identity("snapshot-v3-stable"),
        triggeredBy: "dev-user",
      });

      expect(queued.identity_hash).toBe("3fcf78c2da58d021f29f489ed87c64ddcb0ee531a9cbc1395ca1107d6321fde5");
      expect(queued.id).toBe("overview-ai-artifact-3fcf78c2da58d021f29f489e");
    } finally {
      metadata?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("canonicalizes every v4 contract revision and rotates on any revision, Snapshot, Release, model, or period change", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-overview-artifact-v4-identity-"));
    let metadata: ReturnType<typeof createMetadataStore> | undefined;
    try {
      const store = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata = store;
      seedArtifactProject(store);
      const current = sectionV4Identity("snapshot-v4-current");
      const mutations: EnergyIqOverviewAiArtifactIdentity[] = [
        { ...current, identityContractRevision: "v5" } as SectionV4Identity,
        { ...current, analysisPackRevision: "v3" },
        { ...current, outputContractRevision: "preschool-section-interpretation-v5" },
        { ...current, validatorRevision: "acceptance-validator-v3" },
        { ...current, workflowRevision: "discover-tools-accept-publish-v1" },
        { ...current, investigatorPromptRevision: "discovery-prompt-v2" },
        { ...current, capabilityRevision: "scoped-read-only-v2" } as SectionV4Identity,
        { ...current, publicationRevision: "v2" } as SectionV4Identity,
        { ...current, dataSnapshotId: "snapshot-v4-next" },
        { ...current, projectReleaseId: "release-v2" },
        { ...current, modelProfileRevision: 4 },
        { ...current, analysisPeriodTo: "2026-06-02T00:00:00.000Z" },
      ];
      const records = [current, ...mutations].map((artifactIdentity) =>
        store.energyIq.overviewAiArtifacts.queue({ identity: artifactIdentity, triggeredBy: "dev-user" }));

      expect(JSON.parse(records[0]!.identity_json)).toEqual(current);
      expect(new Set(records.map((record) => record.id)).size).toBe(records.length);
    } finally {
      metadata?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("stores valid v4 available-with-zero-insights and empty results, but rejects missing summary, contract, or capability", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-overview-artifact-v4-result-"));
    let metadata: ReturnType<typeof createMetadataStore> | undefined;
    try {
      const store = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata = store;
      seedArtifactProject(store);

      const availableIdentity = sectionV4Identity("snapshot-v4-available", "centre-benchmark");
      const availableResult = sectionV4Result(availableIdentity, "available");
      availableResult.summary = {
        text: "S".repeat(416),
        evidenceRefs: ["evidence:summary"],
      };
      expect(completeSectionV4(store, availableIdentity, availableResult))
        .toMatchObject({ status: "available", result_json: expect.any(String) });

      const emptyIdentity = sectionV4Identity("snapshot-v4-empty", "planning-outlook");
      expect(completeSectionV4(store, emptyIdentity, sectionV4Result(emptyIdentity, "empty")))
        .toMatchObject({ status: "available", result_json: expect.any(String) });

      const missingSummaryIdentity = sectionV4Identity("snapshot-v4-missing-summary");
      const { summary: _summary, ...withoutSummary } = sectionV4Result(missingSummaryIdentity, "available");
      expect(() => completeSectionV4(store, missingSummaryIdentity, withoutSummary))
        .toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");

      const missingContractIdentity = sectionV4Identity("snapshot-v4-missing-contract");
      const { contract: _contract, ...withoutContract } = sectionV4Result(missingContractIdentity, "available");
      expect(() => completeSectionV4(store, missingContractIdentity, withoutContract))
        .toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");

      const missingCapabilityIdentity = sectionV4Identity("snapshot-v4-missing-capability");
      const { capability: _capability, ...withoutCapability } = sectionV4Result(missingCapabilityIdentity, "available");
      expect(() => completeSectionV4(store, missingCapabilityIdentity, withoutCapability))
        .toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");

      const missingBindingIdentity = sectionV4Identity("snapshot-v4-missing-binding");
      const { binding: _binding, ...withoutBinding } = sectionV4Result(missingBindingIdentity, "available");
      expect(() => completeSectionV4(store, missingBindingIdentity, withoutBinding))
        .toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");

      const missingPublicationIdentity = sectionV4Identity("snapshot-v4-missing-publication");
      const { publication: _publication, ...withoutPublication } = sectionV4Result(missingPublicationIdentity, "available");
      expect(() => completeSectionV4(store, missingPublicationIdentity, withoutPublication))
        .toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");

      const mismatchedIdentity = sectionV4Identity("snapshot-v4-mismatched-identity");
      const mismatchedResult = sectionV4Result(mismatchedIdentity, "available");
      expect(() => completeSectionV4(store, mismatchedIdentity, {
        ...mismatchedResult,
        capability: { revision: "scoped-read-only-v2" },
      })).toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
    } finally {
      metadata?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects malformed v4 capability, Evidence, insight budget, and publication accounting", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-overview-artifact-v4-strict-"));
    let metadata: ReturnType<typeof createMetadataStore> | undefined;
    try {
      const store = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata = store;
      seedArtifactProject(store);
      const reject = (suffix: string, mutate: (result: ReturnType<typeof sectionV4Result>) => unknown) => {
        const artifactIdentity = sectionV4Identity(`snapshot-v4-strict-${suffix}`);
        expect(() => completeSectionV4(store, artifactIdentity, mutate(sectionV4Result(artifactIdentity, "available"))))
          .toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
      };

      reject("capability-mode", (result) => ({
        ...result,
        capability: { revision: "scoped-read-only-v1", mode: "pack-only", tools: [] },
      }));
      reject("capability-tools", (result) => ({
        ...result,
        capability: { revision: "scoped-read-only-v1", mode: "scoped-read-only", tools: ["compare_centres"] },
      }));
      reject("summary-empty-evidence", (result) => ({
        ...result,
        summary: { text: "Unsupported summary.", evidenceRefs: [] },
      }));
      reject("summary-duplicate-evidence", (result) => ({
        ...result,
        summary: { text: "Duplicated Evidence.", evidenceRefs: ["evidence:summary", "evidence:summary"] },
      }));
      reject("summary-over-presentation-budget", (result) => ({
        ...result,
        summary: { text: "Evidence-backed summary. ".repeat(20), evidenceRefs: ["evidence:summary"] },
      }));
      reject("limitation-over-presentation-budget", (result) => ({
        ...result,
        limitation: "Evidence limitation. ".repeat(20),
      }));
      reject("insight-empty-evidence", (result) => ({
        ...result,
        insights: [sectionV4Insight("insight-1", [])],
        publication: publication({ discovered: 1, accepted: 1, published: 1 }),
      }));
      reject("insight-duplicate-evidence", (result) => ({
        ...result,
        insights: [sectionV4Insight("insight-1", ["evidence:1", "evidence:1"])],
        publication: publication({ discovered: 1, accepted: 1, published: 1 }),
      }));
      reject("insight-over-presentation-budget", (result) => ({
        ...result,
        insights: [{
          ...sectionV4Insight("insight-1", ["evidence:1"]),
          text: "Evidence-backed insight. ".repeat(30),
        }],
        publication: publication({ discovered: 1, accepted: 1, published: 1 }),
      }));
      reject("four-insights", (result) => ({
        ...result,
        insights: [1, 2, 3, 4].map((index) => sectionV4Insight(`insight-${index}`, [`evidence:${index}`])),
        publication: publication({ discovered: 4, accepted: 4, published: 4 }),
      }));
      reject("publication-count", (result) => ({
        ...result,
        insights: [sectionV4Insight("insight-1", ["evidence:1"])],
        publication: publication({ discovered: 2, accepted: 1, rejected: 0, published: 1 }),
      }));
      reject("suppression-count", (result) => ({
        ...result,
        insights: [sectionV4Insight("insight-1", ["evidence:1"])],
        publication: publication({ discovered: 2, accepted: 2, published: 1, suppressed: [] }),
      }));
      reject("suppression-duplicate", (result) => ({
        ...result,
        insights: [sectionV4Insight("insight-1", ["evidence:1"])],
        publication: publication({
          discovered: 3,
          accepted: 3,
          published: 1,
          suppressed: ["candidate-2", "candidate-2"],
        }),
      }));
    } finally {
      metadata?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("allows an expired running lease to be reclaimed without creating another artifact", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-overview-artifact-reclaim-"));
    let metadata: ReturnType<typeof createMetadataStore> | undefined;
    try {
      const store = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata = store;
      store.workspaces.upsert({
        id: "artifact-workspace",
        owner_user_id: "dev-user",
        name: "Artifact",
        kind: "customer",
      });
      store.energyIq.upsertProject({
        id: "artifact-project",
        workspace_id: "artifact-workspace",
        name: "Artifact",
        status: "published",
      });
      store.energyIq.overviewAiArtifacts.queue({
        identity: identity("snapshot-a"),
        triggeredBy: "dev-user",
        now: "2026-08-08T12:00:00.000Z",
      });
      store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-a"),
        workerId: "dead-api",
        leaseMs: 1_000,
        now: "2026-08-08T12:00:01.000Z",
      });

      const reclaimed = store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-a"),
        workerId: "api-2",
        leaseMs: 60_000,
        now: "2026-08-08T12:00:03.000Z",
      });
      expect(reclaimed).toMatchObject({
        claimed: true,
        artifact: { status: "running", attempt_count: 2, lease_owner: "api-2" },
      });
      expect(store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-a"),
        workerId: "api-3",
        leaseMs: 60_000,
        now: "2026-08-08T12:02:00.000Z",
      })).toMatchObject({
        claimed: true,
        artifact: { status: "running", attempt_count: 3, lease_owner: "api-3" },
      });
      expect(store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-a"),
        workerId: "api-4",
        leaseMs: 60_000,
        now: "2026-08-08T12:04:00.000Z",
      })).toMatchObject({
        claimed: false,
        artifact: { status: "failed", attempt_count: 3, error_code: "ATTEMPT_LIMIT_EXCEEDED" },
      });
    } finally {
      metadata?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("retries a failed exact identity twice, fences stale leases, and keeps available immutable", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-overview-artifact-retry-"));
    let metadata: ReturnType<typeof createMetadataStore> | undefined;
    try {
      const store = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata = store;
      store.workspaces.upsert({
        id: "artifact-workspace",
        owner_user_id: "dev-user",
        name: "Artifact",
        kind: "customer",
      });
      store.energyIq.upsertProject({
        id: "artifact-project",
        workspace_id: "artifact-workspace",
        name: "Artifact",
        status: "published",
      });
      store.energyIq.overviewAiArtifacts.queue({
        identity: identity("snapshot-retry"),
        triggeredBy: "dev-user",
        now: "2026-08-08T12:00:00.000Z",
      });
      store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-retry"),
        workerId: "api-1",
        leaseMs: 60_000,
        now: "2026-08-08T12:00:01.000Z",
      });

      expect(() => store.energyIq.overviewAiArtifacts.fail({
        identity: identity("snapshot-retry"),
        workerId: "wrong-owner",
        errorCode: "PROVIDER_TEMPORARY",
        now: "2026-08-08T12:00:02.000Z",
      })).toThrow();
      const failed = store.energyIq.overviewAiArtifacts.fail({
        identity: identity("snapshot-retry"),
        workerId: "api-1",
        errorCode: "PROVIDER_TEMPORARY",
        now: "2026-08-08T12:00:03.000Z",
      });
      expect(failed).toMatchObject({ status: "failed", attempt_count: 1 });

      const retryOwner = store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-retry"),
        workerId: "api-2",
        leaseMs: 60_000,
        now: "2026-08-08T12:00:04.000Z",
      });
      const competingRetry = store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-retry"),
        workerId: "api-3",
        leaseMs: 60_000,
        now: "2026-08-08T12:00:04.000Z",
      });
      expect(retryOwner).toMatchObject({
        claimed: true,
        artifact: { status: "running", attempt_count: 2, lease_owner: "api-2" },
      });
      expect(competingRetry).toMatchObject({
        claimed: false,
        artifact: { status: "running", attempt_count: 2, lease_owner: "api-2" },
      });

      const result = JSON.stringify(acceptedResult(identity("snapshot-retry"), "run-retry"));
      expect(() => store.energyIq.overviewAiArtifacts.complete({
        identity: identity("snapshot-retry"),
        workerId: "api-1",
        runId: "run-retry",
        sessionId: "session-retry",
        resultJson: result,
        now: "2026-08-08T12:00:05.000Z",
      })).toThrow();
      expect(() => store.energyIq.overviewAiArtifacts.fail({
        identity: identity("snapshot-retry"),
        workerId: "api-1",
        errorCode: "STALE_OWNER",
        now: "2026-08-08T12:00:05.000Z",
      })).toThrow();
      const completed = store.energyIq.overviewAiArtifacts.complete({
        identity: identity("snapshot-retry"),
        workerId: "api-2",
        runId: "run-retry",
        sessionId: "session-retry",
        resultJson: result,
        now: "2026-08-08T12:00:06.000Z",
      });
      expect(completed).toMatchObject({ status: "available", attempt_count: 2 });
      expect(store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-retry"),
        workerId: "api-4",
        leaseMs: 60_000,
        now: "2026-08-08T12:00:07.000Z",
      })).toMatchObject({
        claimed: false,
        artifact: { status: "available", attempt_count: 2 },
      });

      store.energyIq.overviewAiArtifacts.queue({
        identity: identity("snapshot-exhausted"),
        triggeredBy: "dev-user",
        now: "2026-08-08T12:01:00.000Z",
      });
      store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-exhausted"),
        workerId: "api-1",
        leaseMs: 60_000,
        now: "2026-08-08T12:01:01.000Z",
      });
      store.energyIq.overviewAiArtifacts.fail({
        identity: identity("snapshot-exhausted"),
        workerId: "api-1",
        errorCode: "PROVIDER_TEMPORARY",
        now: "2026-08-08T12:01:02.000Z",
      });
      store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-exhausted"),
        workerId: "api-2",
        leaseMs: 60_000,
        now: "2026-08-08T12:01:03.000Z",
      });
      store.energyIq.overviewAiArtifacts.fail({
        identity: identity("snapshot-exhausted"),
        workerId: "api-2",
        errorCode: "PROVIDER_TEMPORARY",
        now: "2026-08-08T12:01:04.000Z",
      });
      expect(store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-exhausted"),
        workerId: "api-3",
        leaseMs: 60_000,
        now: "2026-08-08T12:01:05.000Z",
      })).toMatchObject({
        claimed: true,
        artifact: { status: "running", attempt_count: 3, lease_owner: "api-3" },
      });
      store.energyIq.overviewAiArtifacts.fail({
        identity: identity("snapshot-exhausted"),
        workerId: "api-3",
        errorCode: "PROVIDER_TEMPORARY",
        now: "2026-08-08T12:01:06.000Z",
      });
      expect(store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-exhausted"),
        workerId: "api-4",
        leaseMs: 60_000,
        now: "2026-08-08T12:01:07.000Z",
      })).toMatchObject({
        claimed: false,
        artifact: { status: "failed", attempt_count: 3, error_code: "PROVIDER_TEMPORARY" },
      });
    } finally {
      metadata?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

const acceptedResult = (artifactIdentity: EnergyIqOverviewAiArtifactIdentity, runId: string) => {
  const binding = {
    projectId: artifactIdentity.projectId,
    scopeId: artifactIdentity.scopeId,
    dataSnapshotId: artifactIdentity.dataSnapshotId,
    projectReleaseId: artifactIdentity.projectReleaseId,
    dataCutoff: "2026-06-01T00:00:00.000Z",
    analysisPeriod: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
    outputContractRevision: artifactIdentity.outputContractRevision,
  };
  return {
    status: "available",
    providerProfileId: artifactIdentity.modelProfileId,
    runId,
    packId: artifactIdentity.analysisPackId,
    packRevision: artifactIdentity.analysisPackRevision,
    contract: { id: "preschool-ai-accepted-artifact", revision: artifactIdentity.outputContractRevision },
    binding,
    workflow: {
      id: "preschool-two-stage",
      revision: artifactIdentity.workflowRevision,
      methodSkill: { id: artifactIdentity.methodSkillId, revision: artifactIdentity.methodSkillRevision },
      stages: {
        investigator: { runId: "investigator-run", promptRevision: artifactIdentity.investigatorPromptRevision },
        editor: { runId, promptRevision: artifactIdentity.editorPromptRevision },
      },
    },
    findings: [{
      id: "benchmark-finding",
      binding,
      placementTargets: ["preschool.benchmark"],
      epistemicLevel: "verified",
      relationship: "supports",
      signalRefs: ["efficiency"],
      title: "Benchmark gap persists across normalisations",
      takeaway: "The current Snapshot supports a focused operating review.",
      evidence: {
        snapshotId: artifactIdentity.dataSnapshotId,
        period: binding.analysisPeriod,
        deterministic: [{
          id: "benchmark:portfolio",
          kind: "benchmark",
          label: "Portfolio benchmark",
          unit: "kWh/m2/year",
          values: { actual: 120 },
          queryIds: ["benchmark-query"],
          limitation: null,
        }],
        tools: [],
      },
    }],
  };
};

const seedArtifactProject = (store: ReturnType<typeof createMetadataStore>) => {
  store.workspaces.upsert({
    id: "artifact-workspace",
    owner_user_id: "dev-user",
    name: "Artifact",
    kind: "customer",
  });
  store.energyIq.upsertProject({
    id: "artifact-project",
    workspace_id: "artifact-workspace",
    name: "Artifact",
    status: "published",
  });
};

const sectionV3Identity = (
  dataSnapshotId: string,
  targetId = "centre-benchmark",
): EnergyIqOverviewAiArtifactIdentity => ({
  ...identity(dataSnapshotId),
  analysisPackId: "preschool-analysis-pack",
  analysisPackRevision: "v1",
  outputContractRevision: "preschool-section-interpretation-v3",
  validatorRevision: "preschool-section-interpreter-validator-v12",
  workflowRevision: "preschool-section-interpreter-v14",
  investigatorPromptRevision: "preschool-section-interpreter-prompt-v14",
  editorPromptRevision: "not-applicable-v1",
  methodSkillId: "none",
  methodSkillRevision: "not-applicable-v1",
  artifactKind: "section-interpretation",
  targetId,
});

const sectionV4Identity = (
  dataSnapshotId: string,
  targetId = "centre-benchmark",
): SectionV4Identity => ({
  ...sectionV3Identity(dataSnapshotId, targetId),
  identityContractRevision: "v4",
  analysisPackId: "preschool-section-pack",
  analysisPackRevision: "v2",
  outputContractRevision: "preschool-section-interpretation-v4",
  validatorRevision: "acceptance-validator-v12",
  workflowRevision: "discover-tools-accept-publish-v2",
  investigatorPromptRevision: "discovery-prompt-v11",
  capabilityRevision: "scoped-read-only-v1",
  publicationRevision: "v1",
});

const sectionV4Result = (
  artifactIdentity: SectionV4Identity,
  status: "available" | "empty",
) => ({
  artifactKind: "section-interpretation" as const,
  status,
  providerProfileId: artifactIdentity.modelProfileId,
  runId: `run:${artifactIdentity.dataSnapshotId}`,
  contract: {
    id: "preschool-section-interpretation",
    revision: "preschool-section-interpretation-v4",
  },
  binding: {
    workspaceId: artifactIdentity.workspaceId,
    projectId: artifactIdentity.projectId,
    scopeId: artifactIdentity.scopeId,
    dataSnapshotId: artifactIdentity.dataSnapshotId,
    projectReleaseId: artifactIdentity.projectReleaseId,
    analysisPeriod: {
      from: artifactIdentity.analysisPeriodFrom,
      to: artifactIdentity.analysisPeriodTo,
    },
    modelProfileId: artifactIdentity.modelProfileId,
    modelProfileRevision: artifactIdentity.modelProfileRevision,
  },
  sectionId: artifactIdentity.targetId,
  packRevision: "v2",
  capability: {
    revision: "scoped-read-only-v1",
    mode: "scoped-read-only",
    tools: sectionV4Tools(artifactIdentity.targetId ?? ""),
  },
  toolAudits: [],
  ...(status === "available"
    ? { summary: { text: "The Section has a concise evidence-backed summary.", evidenceRefs: ["evidence:summary"] } }
    : {}),
  insights: [],
  publication: {
    policyId: "preschool-section-publication",
    policyRevision: "v1",
    discoveredCount: 0,
    acceptedCount: 0,
    rejectedCount: 0,
    publishedCount: 0,
    suppressedCandidateIds: [],
  },
});

const sectionV4Tools = (sectionId: string) => {
  switch (sectionId) {
    case "centre-benchmark":
      return ["compare_centres", "inspect_related_section_signals"];
    case "standby-wastage":
    case "operating-behaviour":
      return ["inspect_time_pattern", "inspect_load_composition", "inspect_related_section_signals"];
    case "planning-outlook":
      return ["inspect_related_section_signals"];
    default:
      return [];
  }
};

const sectionV4Insight = (id: string, evidenceRefs: string[]) => ({
  id,
  title: "A concise supported angle",
  epistemicStatus: "inferred",
  text: "The supplied Evidence supports this relationship.",
  evidenceRefs,
});

const publication = (input: {
  discovered: number;
  accepted: number;
  rejected?: number;
  published: number;
  suppressed?: string[];
}) => ({
  policyId: "preschool-section-publication",
  policyRevision: "v1",
  discoveredCount: input.discovered,
  acceptedCount: input.accepted,
  rejectedCount: input.rejected ?? input.discovered - input.accepted,
  publishedCount: input.published,
  suppressedCandidateIds: input.suppressed ?? [],
});

const completeSectionV4 = (
  store: ReturnType<typeof createMetadataStore>,
  artifactIdentity: SectionV4Identity,
  result: unknown,
) => {
  store.energyIq.overviewAiArtifacts.queue({ identity: artifactIdentity, triggeredBy: "dev-user" });
  const workerId = `worker:${artifactIdentity.dataSnapshotId}`;
  store.energyIq.overviewAiArtifacts.claim({ identity: artifactIdentity, workerId, leaseMs: 60_000 });
  return store.energyIq.overviewAiArtifacts.complete({
    identity: artifactIdentity,
    workerId,
    sessionId: `session:${artifactIdentity.dataSnapshotId}`,
    runId: `run:${artifactIdentity.dataSnapshotId}`,
    resultJson: JSON.stringify(result),
  });
};

describe("EnergyIqOverviewAiArtifactStore current Additional AI Insights", () => {
  it("persists only an exact shared Method-set Artifact and keeps empty as a valid terminal result", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-additional-insights-artifact-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({
        id: "artifact-workspace",
        owner_user_id: "dev-user",
        name: "Artifact",
        kind: "customer",
      });
      metadata.energyIq.upsertProject({
        id: "artifact-project",
        workspace_id: "artifact-workspace",
        name: "Artifact",
        status: "published",
      });
      const availableIdentity = additionalIdentity("snapshot-additional-available");
      const availableArtifact = completeAdditional(
        metadata,
        availableIdentity,
        additionalResult(availableIdentity, "available"),
      );
      expect(availableArtifact).toMatchObject({ status: "available" });

      const historicalV3Identity = historicalAdditionalIdentityV3(availableIdentity);
      expect(() => metadata.energyIq.overviewAiArtifacts.queue({
        identity: historicalV3Identity,
        triggeredBy: "dev-user",
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");

      const sameOutputHistoricalIdentity = historicalAdditionalIdentityV2(availableIdentity);
      expect(sameOutputHistoricalIdentity.outputContractRevision)
        .toBe(availableIdentity.outputContractRevision);
      expect(() => metadata.energyIq.overviewAiArtifacts.queue({
        identity: sameOutputHistoricalIdentity,
        triggeredBy: "dev-user",
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");

      const emptyIdentity = additionalIdentity("snapshot-additional-empty");
      expect(completeAdditional(metadata, emptyIdentity, additionalResult(emptyIdentity, "empty")))
        .toMatchObject({ status: "available" });

      const historicalBase = additionalIdentity("snapshot-additional-historical-v1");
      const historicalIdentity = historicalAdditionalIdentity(historicalBase);
      expect(() => metadata.energyIq.overviewAiArtifacts.queue({
        identity: historicalIdentity,
        triggeredBy: "dev-user",
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");

      const driftIdentity = additionalIdentity("snapshot-additional-drift");
      const drift = additionalResult(driftIdentity, "available");
      drift.methodExecution.loadedMethods[0] = {
        ...drift.methodExecution.loadedMethods[0]!,
        contentSha256: "f".repeat(64),
      };
      expect(() => completeAdditional(metadata, driftIdentity, drift))
        .toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");

      const selfApprovedIdentity = additionalIdentity("snapshot-additional-self-approved");
      const selfApproved = additionalResult(selfApprovedIdentity, "available");
      Object.assign(selfApproved.methodExecution, {
        approvedMethods: [{
          ...selfApproved.methodExecution.loadedMethods[0]!,
          skillId: "artifact-self-approved",
          resourceId: "skill:artifact-self-approved",
        }],
      });
      expect(() => completeAdditional(metadata, selfApprovedIdentity, selfApproved))
        .toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");

      expect(() => metadata.energyIq.overviewAiArtifacts.queue({
        identity: { ...availableIdentity, methodSetFingerprint: `sha256:${"f".repeat(64)}` },
        triggeredBy: "dev-user",
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_METHOD_SET_IDENTITY_INVALID");

      expect(() => metadata.energyIq.overviewAiArtifacts.queue({
        identity: { ...availableIdentity, targetId: "method-set:forbidden" },
        triggeredBy: "dev-user",
      })).toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_TARGET_FORBIDDEN");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps historical terminal lookup independent from the current published Method registry", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-additional-history-method-rotation-"));
    const databasePath = join(root, "metadata.sqlite");
    const metadata = createMetadataStore({ database_path: databasePath });
    try {
      for (const [id, email] of [
        ["admin-reviewer", "reviewer@example.test"],
        ["admin-publisher", "publisher@example.test"],
      ] as const) {
        metadata.users.upsertDevUser({
          id,
          email,
          display_name: id,
          dev_token: `${id}-token`,
        });
      }
      seedArtifactProject(metadata);
      const currentIdentity = additionalIdentity("snapshot-additional-before-method");
      const currentArtifact = completeAdditional(
        metadata,
        currentIdentity,
        additionalResult(currentIdentity, "available"),
      );
      const historicalIdentity = historicalAdditionalIdentityV3(currentIdentity);
      const historicalV4Identity = historicalAdditionalIdentityV4(currentIdentity);
      const historicalV5Identity = historicalAdditionalIdentityV5(currentIdentity);
      const historicalV6Identity = historicalAdditionalIdentityV6(currentIdentity);
      const historicalV7Identity = historicalAdditionalIdentityV7(currentIdentity);
      const historicalV8Identity = historicalAdditionalIdentityV8(currentIdentity);
      const historicalV9Identity = historicalAdditionalIdentityV9(currentIdentity);
      const historicalV10Identity = historicalAdditionalIdentityV10(currentIdentity);
      const historicalV11Identity = historicalAdditionalIdentityV11(currentIdentity);
      const historicalV12Identity = historicalAdditionalIdentityV12(currentIdentity);
      const historicalV13Identity = historicalAdditionalIdentityV13(currentIdentity);
      const historicalV14Identity = historicalAdditionalIdentityV14(currentIdentity);
      const historicalV15Identity = historicalAdditionalIdentityV15(currentIdentity);
      const historicalV16Identity = historicalAdditionalIdentityV16(currentIdentity);
      const historicalV17Identity = historicalAdditionalIdentityV17(currentIdentity);
      const historicalV18Identity = historicalAdditionalIdentityV18(currentIdentity);
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalIdentity,
      });
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalV4Identity,
      });
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalV5Identity,
      });
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalV6Identity,
      });
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalV7Identity,
      });
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalV8Identity,
      });
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalV9Identity,
      });
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalV10Identity,
      });
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalV11Identity,
      });
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalV12Identity,
      });
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalV13Identity,
      });
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalV14Identity,
      });
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalV15Identity,
      });
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalV16Identity,
      });
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalV17Identity,
      });
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalV18Identity,
      });
      const historicalArtifact = metadata.energyIq.overviewAiArtifacts.get(historicalIdentity);
      const historicalV4Artifact = metadata.energyIq.overviewAiArtifacts.get(historicalV4Identity);
      const historicalV5Artifact = metadata.energyIq.overviewAiArtifacts.get(historicalV5Identity);
      const historicalV6Artifact = metadata.energyIq.overviewAiArtifacts.get(historicalV6Identity);
      const historicalV7Artifact = metadata.energyIq.overviewAiArtifacts.get(historicalV7Identity);
      const historicalV8Artifact = metadata.energyIq.overviewAiArtifacts.get(historicalV8Identity);
      const historicalV9Artifact = metadata.energyIq.overviewAiArtifacts.get(historicalV9Identity);
      const historicalV10Artifact = metadata.energyIq.overviewAiArtifacts.get(historicalV10Identity);
      const historicalV11Artifact = metadata.energyIq.overviewAiArtifacts.get(historicalV11Identity);
      const historicalV12Artifact = metadata.energyIq.overviewAiArtifacts.get(historicalV12Identity);
      const historicalV13Artifact = metadata.energyIq.overviewAiArtifacts.get(historicalV13Identity);
      const historicalV14Artifact = metadata.energyIq.overviewAiArtifacts.get(historicalV14Identity);
      const historicalV15Artifact = metadata.energyIq.overviewAiArtifacts.get(historicalV15Identity);
      const historicalV16Artifact = metadata.energyIq.overviewAiArtifacts.get(historicalV16Identity);
      const historicalV17Artifact = metadata.energyIq.overviewAiArtifacts.get(historicalV17Identity);
      const historicalV18Artifact = metadata.energyIq.overviewAiArtifacts.get(historicalV18Identity);
      const proposal = metadata.energyIq.insightMethodGovernance.createProposal({
        expectedWorkspaceId: "artifact-workspace",
        expectedProjectId: "artifact-project",
        artifactId: currentArtifact.id,
        findingId: "additional-insight-1",
        actorId: "dev-user",
        idempotencyKey: "proposal:historical-artifact-read",
        title: "Check repeated off-hours event shapes",
        guidance: "Compare repeated event shape and timing before treating an isolated spike as reusable.",
      });
      const inReview = metadata.energyIq.insightMethodGovernance.submitProposal({
        workspaceId: "artifact-workspace",
        projectId: "artifact-project",
        proposalId: proposal.id,
        actorId: "dev-user",
        expectedRevision: proposal.revision,
      });
      const approved = metadata.energyIq.insightMethodGovernance.approveProposal({
        workspaceId: "artifact-workspace",
        projectId: "artifact-project",
        proposalId: proposal.id,
        actorId: "admin-reviewer",
        expectedRevision: inReview.revision,
      });
      metadata.energyIq.insightMethodGovernance.publishProposal({
        workspaceId: "artifact-workspace",
        projectId: "artifact-project",
        proposalId: proposal.id,
        actorId: "admin-publisher",
        expectedRevision: approved.revision,
      });

      expect(metadata.energyIq.overviewAiArtifacts.find(historicalIdentity)).toEqual(historicalArtifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalIdentity)).toEqual(historicalArtifact);
      expect(metadata.energyIq.overviewAiArtifacts.find(historicalV4Identity)).toEqual(historicalV4Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalV4Identity)).toEqual(historicalV4Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.find(historicalV5Identity)).toEqual(historicalV5Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalV5Identity)).toEqual(historicalV5Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.find(historicalV6Identity)).toEqual(historicalV6Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalV6Identity)).toEqual(historicalV6Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.find(historicalV7Identity)).toEqual(historicalV7Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalV7Identity)).toEqual(historicalV7Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.find(historicalV8Identity)).toEqual(historicalV8Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalV8Identity)).toEqual(historicalV8Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.find(historicalV9Identity)).toEqual(historicalV9Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalV9Identity)).toEqual(historicalV9Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.find(historicalV10Identity)).toEqual(historicalV10Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalV10Identity)).toEqual(historicalV10Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.find(historicalV11Identity)).toEqual(historicalV11Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalV11Identity)).toEqual(historicalV11Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.find(historicalV12Identity)).toEqual(historicalV12Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalV12Identity)).toEqual(historicalV12Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.find(historicalV13Identity)).toEqual(historicalV13Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalV13Identity)).toEqual(historicalV13Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.find(historicalV14Identity)).toEqual(historicalV14Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalV14Identity)).toEqual(historicalV14Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.find(historicalV15Identity)).toEqual(historicalV15Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalV15Identity)).toEqual(historicalV15Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.find(historicalV16Identity)).toEqual(historicalV16Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalV16Identity)).toEqual(historicalV16Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.find(historicalV17Identity)).toEqual(historicalV17Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalV17Identity)).toEqual(historicalV17Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.find(historicalV18Identity)).toEqual(historicalV18Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalV18Identity)).toEqual(historicalV18Artifact);
      expect(() => metadata.energyIq.overviewAiArtifacts.queue({
        identity: historicalV18Identity,
        triggeredBy: "dev-user",
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");
      metadata.db.prepare(`
        UPDATE energyiq_overview_ai_artifacts
        SET status = 'running', result_json = NULL, completed_at = NULL,
            lease_owner = 'historical-v6-worker', lease_expires_at = '2099-01-01T00:00:00.000Z'
        WHERE id = ?
      `).run(historicalV6Artifact.id);
      expect(() => metadata.energyIq.overviewAiArtifacts.claim({
        identity: historicalV6Identity,
        workerId: "historical-v6-worker-2",
        leaseMs: 60_000,
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");
      expect(() => metadata.energyIq.overviewAiArtifacts.fail({
        identity: historicalV6Identity,
        workerId: "historical-v6-worker",
        errorCode: "HISTORICAL_RUN_FAILED",
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");
      expect(() => metadata.energyIq.overviewAiArtifacts.queue({
        identity: historicalV6Identity,
        triggeredBy: "dev-user",
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");
      metadata.db.prepare(`
        UPDATE energyiq_overview_ai_artifacts
        SET status = 'running', result_json = NULL, completed_at = NULL,
            lease_owner = 'historical-v7-worker', lease_expires_at = '2099-01-01T00:00:00.000Z'
        WHERE id = ?
      `).run(historicalV7Artifact.id);
      expect(() => metadata.energyIq.overviewAiArtifacts.claim({
        identity: historicalV7Identity,
        workerId: "historical-v7-worker-2",
        leaseMs: 60_000,
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");
      expect(() => metadata.energyIq.overviewAiArtifacts.fail({
        identity: historicalV7Identity,
        workerId: "historical-v7-worker",
        errorCode: "HISTORICAL_RUN_FAILED",
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");
      expect(() => metadata.energyIq.overviewAiArtifacts.queue({
        identity: historicalV7Identity,
        triggeredBy: "dev-user",
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");
      expect(() => metadata.energyIq.overviewAiArtifacts.queue({
        identity: historicalV8Identity,
        triggeredBy: "dev-user",
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");
      expect(() => metadata.energyIq.overviewAiArtifacts.queue({
        identity: historicalV9Identity,
        triggeredBy: "dev-user",
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");
      expect(() => metadata.energyIq.overviewAiArtifacts.queue({
        identity: historicalV10Identity,
        triggeredBy: "dev-user",
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");
      expect(() => metadata.energyIq.overviewAiArtifacts.claim({
        identity: historicalIdentity,
        workerId: "historical-worker",
        leaseMs: 60_000,
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");
      expect(() => metadata.energyIq.overviewAiArtifacts.complete({
        identity: historicalIdentity,
        workerId: "historical-worker",
        sessionId: "historical-session",
        runId: "historical-run",
        resultJson: historicalArtifact.result_json!,
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");
      const publishedMethods = metadata.energyIq.insightMethodGovernance
        .listPublishedWorkspaceMethodResources({ workspaceId: "artifact-workspace" });
      const rotatedIdentity = additionalIdentity("snapshot-additional-rotated-methods", publishedMethods);
      expect(metadata.energyIq.overviewAiArtifacts.queue({
        identity: rotatedIdentity,
        triggeredBy: "dev-user",
      }).identity_json).toContain(rotatedIdentity.methodSetFingerprint);
      expect(() => metadata.energyIq.overviewAiArtifacts.queue({
        identity: { ...currentIdentity, dataSnapshotId: "snapshot-additional-stale-methods" },
        triggeredBy: "dev-user",
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_METHOD_SET_IDENTITY_INVALID");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists only ordered server-accepted Canvas blocks bound to authoritative Evidence", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-additional-canvas-artifact-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({
        id: "artifact-workspace",
        owner_user_id: "dev-user",
        name: "Artifact",
        kind: "customer",
      });
      metadata.energyIq.upsertProject({
        id: "artifact-project",
        workspace_id: "artifact-workspace",
        name: "Artifact",
        status: "published",
      });

      const acceptedIdentity = additionalIdentity("snapshot-additional-canvas");
      const accepted = additionalResult(acceptedIdentity, "available");
      attachAcceptedCanvas(accepted);
      const acceptedCanvas = accepted.findings[0]!.canvas;
      if (acceptedCanvas?.contractRevision !== "energyiq-insight-canvas-v2") throw new Error("current Canvas fixture missing");
      acceptedCanvas.rejections = [{
        code: "PRESENTATION_BUDGET_EXCEEDED",
        subjectId: "canvas-block:suppressed-4",
      }];
      expect(completeAdditional(metadata, acceptedIdentity, accepted)).toMatchObject({ status: "available" });

      const unknownRejectionIdentity = additionalIdentity("snapshot-additional-canvas-unknown-rejection");
      const unknownRejection = additionalResult(unknownRejectionIdentity, "available");
      attachAcceptedCanvas(unknownRejection);
      const unknownRejectionCanvas = unknownRejection.findings[0]!.canvas;
      if (unknownRejectionCanvas?.contractRevision !== "energyiq-insight-canvas-v2") throw new Error("current Canvas fixture missing");
      unknownRejectionCanvas.rejections = [{
        code: "UNKNOWN_REJECTION" as "PRESENTATION_BUDGET_EXCEEDED",
        subjectId: "canvas-block:unknown",
      }];
      expect(() => completeAdditional(metadata, unknownRejectionIdentity, unknownRejection))
        .toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");

      const idDriftIdentity = additionalIdentity("snapshot-additional-canvas-id-drift");
      const idDrift = additionalResult(idDriftIdentity, "available");
      attachAcceptedCanvas(idDrift);
      idDrift.findings[0]!.canvas!.acceptedBlockIds = ["canvas-block:forged"];
      expect(() => completeAdditional(metadata, idDriftIdentity, idDrift))
        .toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");

      const bindingDriftIdentity = additionalIdentity("snapshot-additional-canvas-binding-drift");
      const bindingDrift = additionalResult(bindingDriftIdentity, "available");
      attachAcceptedCanvas(bindingDrift);
      if (bindingDrift.findings[0]!.canvas?.contractRevision !== "energyiq-insight-canvas-v2") {
        throw new Error("current Canvas fixture missing");
      }
      bindingDrift.findings[0]!.canvas.acceptedBlocks[0]!.bindings[0]!.value = 999;
      expect(() => completeAdditional(metadata, bindingDriftIdentity, bindingDrift))
        .toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

const attachAcceptedCanvas = (artifact: AdditionalAiInsightsArtifact): void => {
  if (artifact.status !== "available") throw new Error("available Additional fixture required");
  Object.assign(artifact.evidenceLineage.facts[0]!, {
    label: "Additional Evidence",
    metricId: "energy.additional",
    value: 1,
    unit: "kWh",
    dimensions: { scopeId: artifact.binding.scopeId },
  });
  artifact.findings[0]!.canvas = {
    contractRevision: "energyiq-insight-canvas-v2",
    planId: "canvas-plan:additional-insight-1",
    acceptedBlockIds: ["canvas-block:additional-1"],
    acceptedBlocks: [{
      id: "canvas-block:additional-1",
      kind: "quantitative",
      visualization: "metric",
      title: "Additional Evidence",
      bindings: [{
        evidenceRef: "evidence:additional:1",
        entityId: artifact.binding.scopeId,
        metricId: "energy.additional",
        value: 1,
        unit: "kWh",
      }],
    }],
    rejections: [],
    gaps: [],
  };
};

type AdditionalIdentity = EnergyIqOverviewAiArtifactIdentity & {
  artifactKind: "autonomous-insights";
  identityContractRevision: "additional-insights-v19";
  methodSetId: "preschool-additional-insights-current";
  methodSetRevision: "v1";
  methodSetFingerprint: string;
  capabilityRevision: "scoped-read-only-v1";
  publicationRevision: "additional-insights-v2";
  canvasRevision: "energyiq-insight-canvas-v2";
};

const additionalIdentity = (
  dataSnapshotId: string,
  workspaceMethodResources: Parameters<typeof resolveCurrentAdditionalAiInsightMethodSet>[1] = [],
): AdditionalIdentity => {
  const methodSet = resolveCurrentAdditionalAiInsightMethodSet("artifact-workspace", workspaceMethodResources);
  const canonical = canonicalInsightMethodSetJson(methodSet.methods);
  if (!canonical) throw new Error("test Method set must be canonical");
  return {
    ...identity(dataSnapshotId),
    artifactKind: "autonomous-insights",
    identityContractRevision: "additional-insights-v19",
    analysisPackId: "preschool-additional-insights-pack",
    analysisPackRevision: "v1",
    outputContractRevision: "energyiq-additional-ai-insights-v2",
    validatorRevision: "additional-insights-acceptance-v16",
    workflowRevision: "additional-insights-discover-accept-publish-v19",
    investigatorPromptRevision: "additional-insights-discovery-v10",
    editorPromptRevision: "additional-insights-publication-v2",
    methodSkillId: "energyiq-open-discovery",
    methodSkillRevision: "1.0.0",
    methodSetId: CURRENT_ADDITIONAL_AI_INSIGHT_METHOD_SET_ID,
    methodSetRevision: CURRENT_ADDITIONAL_AI_INSIGHT_METHOD_SET_REVISION,
    methodSetFingerprint: `sha256:${createHash("sha256").update(canonical).digest("hex")}`,
    capabilityRevision: "scoped-read-only-v1",
    publicationRevision: "additional-insights-v2",
    canvasRevision: "energyiq-insight-canvas-v2",
  };
};

const historicalAdditionalIdentityV2 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v2",
  validatorRevision: "additional-insights-acceptance-v2",
  workflowRevision: "additional-insights-discover-accept-publish-v2",
  investigatorPromptRevision: "additional-insights-discovery-v2",
});

const historicalAdditionalIdentityV3 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v3",
  workflowRevision: "additional-insights-discover-accept-publish-v3",
  investigatorPromptRevision: "additional-insights-discovery-v3",
});

const historicalAdditionalIdentityV4 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v4",
  workflowRevision: "additional-insights-discover-accept-publish-v4",
  investigatorPromptRevision: "additional-insights-discovery-v4",
});

const historicalAdditionalIdentityV5 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v5",
  validatorRevision: "additional-insights-acceptance-v3",
  workflowRevision: "additional-insights-discover-accept-publish-v5",
  investigatorPromptRevision: "additional-insights-discovery-v5",
});

const historicalAdditionalIdentityV6 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v6",
  validatorRevision: "additional-insights-acceptance-v4",
  workflowRevision: "additional-insights-discover-accept-publish-v6",
  investigatorPromptRevision: "additional-insights-discovery-v6",
});

const historicalAdditionalIdentityV7 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v7",
  validatorRevision: "additional-insights-acceptance-v5",
  workflowRevision: "additional-insights-discover-accept-publish-v7",
  investigatorPromptRevision: "additional-insights-discovery-v7",
});

const historicalAdditionalIdentityV8 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v8",
  validatorRevision: "additional-insights-acceptance-v6",
  workflowRevision: "additional-insights-discover-accept-publish-v8",
  investigatorPromptRevision: "additional-insights-discovery-v7",
});

const historicalAdditionalIdentityV9 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v9",
  validatorRevision: "additional-insights-acceptance-v6",
  workflowRevision: "additional-insights-discover-accept-publish-v9",
  investigatorPromptRevision: "additional-insights-discovery-v7",
});

const historicalAdditionalIdentityV10 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v10",
  validatorRevision: "additional-insights-acceptance-v7",
  workflowRevision: "additional-insights-discover-accept-publish-v10",
  investigatorPromptRevision: "additional-insights-discovery-v8",
});

const historicalAdditionalIdentityV11 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v11",
  validatorRevision: "additional-insights-acceptance-v8",
  workflowRevision: "additional-insights-discover-accept-publish-v11",
  investigatorPromptRevision: "additional-insights-discovery-v9",
});

const historicalAdditionalIdentityV12 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v12",
  validatorRevision: "additional-insights-acceptance-v9",
  workflowRevision: "additional-insights-discover-accept-publish-v12",
  investigatorPromptRevision: "additional-insights-discovery-v10",
});

const historicalAdditionalIdentityV13 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v13",
  validatorRevision: "additional-insights-acceptance-v10",
  workflowRevision: "additional-insights-discover-accept-publish-v13",
  investigatorPromptRevision: "additional-insights-discovery-v10",
});

const historicalAdditionalIdentityV14 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v14",
  validatorRevision: "additional-insights-acceptance-v11",
  workflowRevision: "additional-insights-discover-accept-publish-v14",
  investigatorPromptRevision: "additional-insights-discovery-v10",
});

const historicalAdditionalIdentityV15 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v15",
  validatorRevision: "additional-insights-acceptance-v12",
  workflowRevision: "additional-insights-discover-accept-publish-v15",
  investigatorPromptRevision: "additional-insights-discovery-v10",
});

const historicalAdditionalIdentityV16 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v16",
  validatorRevision: "additional-insights-acceptance-v13",
  workflowRevision: "additional-insights-discover-accept-publish-v16",
  investigatorPromptRevision: "additional-insights-discovery-v10",
});

const historicalAdditionalIdentityV17 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v17",
  validatorRevision: "additional-insights-acceptance-v14",
  workflowRevision: "additional-insights-discover-accept-publish-v17",
  investigatorPromptRevision: "additional-insights-discovery-v10",
});

const historicalAdditionalIdentityV18 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v18",
  validatorRevision: "additional-insights-acceptance-v15",
  workflowRevision: "additional-insights-discover-accept-publish-v18",
  investigatorPromptRevision: "additional-insights-discovery-v10",
});

const historicalAdditionalIdentity = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => {
  const historical: EnergyIqOverviewAiArtifactIdentity = {
    ...current,
    identityContractRevision: "additional-insights-v1",
    outputContractRevision: "energyiq-additional-ai-insights-v1",
    validatorRevision: "additional-insights-acceptance-v1",
    workflowRevision: "additional-insights-discover-accept-publish-v1",
    investigatorPromptRevision: "additional-insights-discovery-v1",
    editorPromptRevision: "additional-insights-publication-v1",
    publicationRevision: "additional-insights-v1",
  };
  delete historical.canvasRevision;
  return historical;
};

const additionalResult = (
  artifactIdentity: AdditionalIdentity,
  status: "available" | "empty",
): AdditionalAiInsightsArtifact => {
  const methodSet = resolveCurrentAdditionalAiInsightMethodSet(artifactIdentity.workspaceId);
  const base: Omit<AdditionalAiInsightsArtifact, "status" | "findings"> = {
  artifactKind: "autonomous-insights",
  providerProfileId: artifactIdentity.modelProfileId,
  runId: `run:${artifactIdentity.dataSnapshotId}`,
  contract: {
    id: "energyiq-additional-ai-insights",
    revision: artifactIdentity.outputContractRevision,
  },
  binding: {
    workspaceId: artifactIdentity.workspaceId,
    projectId: artifactIdentity.projectId,
    scopeId: artifactIdentity.scopeId,
    dataSnapshotId: artifactIdentity.dataSnapshotId,
    projectReleaseId: artifactIdentity.projectReleaseId,
    analysisPeriod: {
      from: artifactIdentity.analysisPeriodFrom,
      to: artifactIdentity.analysisPeriodTo,
    },
    modelProfileId: artifactIdentity.modelProfileId,
    modelProfileRevision: artifactIdentity.modelProfileRevision,
  },
  methodExecution: {
    methodSetId: artifactIdentity.methodSetId,
    methodSetRevision: artifactIdentity.methodSetRevision,
    methodSetFingerprint: artifactIdentity.methodSetFingerprint,
    loadedMethods: [...methodSet.methods],
  },
  capability: {
    revision: artifactIdentity.capabilityRevision,
    mode: "scoped-read-only",
    allowedTools: [...ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1],
    usedTools: [],
  },
  toolAudits: [],
  evidenceLineage: {
    catalogContract: "analysis-context-evidence@1",
    sourceId: `project-analysis-snapshot:${artifactIdentity.projectId}:${artifactIdentity.dataSnapshotId}`,
    pins: {
      workspaceId: artifactIdentity.workspaceId,
      projectId: artifactIdentity.projectId,
      scopeId: artifactIdentity.scopeId,
      dataSnapshotId: artifactIdentity.dataSnapshotId,
      dataCutoff: "2026-05-31T16:00:00.000Z",
      projectReleaseId: artifactIdentity.projectReleaseId,
      metricVersion: "energy-metrics-v1",
    },
    facts: status === "available" ? [{
      id: "evidence:additional:1",
      label: "Additional Evidence",
      metricId: "energy.additional",
      value: 1,
      unit: "kWh",
      status: "confirmed",
      evidenceRefs: ["snapshot-evidence:additional:1"],
      dimensions: { scopeId: artifactIdentity.scopeId },
    }] : [],
  },
  publication: {
    policyId: "energyiq-additional-ai-insights",
    policyRevision: artifactIdentity.publicationRevision,
    discoveredCount: status === "available" ? 1 : 0,
    acceptedCount: status === "available" ? 1 : 0,
    rejectedCount: 0,
    publishedCount: status === "available" ? 1 : 0,
    sourceOrderCandidateIds: status === "available" ? ["candidate-1"] : [],
    acceptedCandidateIds: status === "available" ? ["candidate-1"] : [],
    rejectedCandidateIds: [],
    publishedCandidateIds: status === "available" ? ["candidate-1"] : [],
    suppressedCandidateIds: [],
  },
  };
  if (status === "empty") {
    return { ...base, status, findings: [] };
  }
  return {
    ...base,
    status,
    findings: [{
      id: "additional-insight-1",
      title: "An incremental angle",
      text: "Current Snapshot Evidence supports this additional angle.",
      epistemicStatus: "inferred",
      origin: {
        kind: "ai-discovery",
        coreMethod: methodSet.methods[0]!,
        directionMethods: [],
      },
      evidenceRefs: ["evidence:additional:1"],
      toolAuditIds: [],
    }],
  };
};

const completeAdditional = (
  metadata: ReturnType<typeof createMetadataStore>,
  artifactIdentity: EnergyIqOverviewAiArtifactIdentity,
  result: AdditionalAiInsightsArtifact,
) => {
  metadata.energyIq.overviewAiArtifacts.queue({ identity: artifactIdentity, triggeredBy: "dev-user" });
  const workerId = `worker:${artifactIdentity.dataSnapshotId}`;
  metadata.energyIq.overviewAiArtifacts.claim({ identity: artifactIdentity, workerId, leaseMs: 60_000 });
  return metadata.energyIq.overviewAiArtifacts.complete({
    identity: artifactIdentity,
    workerId,
    sessionId: `session:${artifactIdentity.dataSnapshotId}`,
    runId: `run:${artifactIdentity.dataSnapshotId}`,
    resultJson: JSON.stringify(result),
  });
};

/** Seeds a released historical row without reopening the production mutation surface. */
const seedHistoricalTerminalArtifact = (input: {
  databasePath: string;
  source: EnergyIqOverviewAiArtifactRecord;
  identity: EnergyIqOverviewAiArtifactIdentity;
}): void => {
  const canonical = JSON.parse(input.source.identity_json) as Record<string, unknown>;
  for (const key of Object.keys(canonical)) {
    const value = input.identity[key as keyof EnergyIqOverviewAiArtifactIdentity];
    if (value === undefined) delete canonical[key];
    else canonical[key] = value;
  }
  const identityJson = JSON.stringify(canonical);
  const identityHash = createHash("sha256").update(identityJson).digest("hex");
  const db = new DatabaseSync(input.databasePath);
  try {
    db.prepare(`
      INSERT INTO energyiq_overview_ai_artifacts (
        id, identity_hash, identity_json, workspace_id, project_id, scope_id,
        resource, data_snapshot_id, project_release_id, renderer_key,
        renderer_version, analysis_pack_id, analysis_pack_revision,
        model_profile_id, model_profile_revision, output_contract_revision,
        validator_revision, status, attempt_count, triggered_by,
        session_id, run_id, result_json, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', 1, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `overview-ai-artifact-${identityHash.slice(0, 24)}`,
      identityHash,
      identityJson,
      input.identity.workspaceId,
      input.identity.projectId,
      input.identity.scopeId,
      input.identity.resource,
      input.identity.dataSnapshotId,
      input.identity.projectReleaseId,
      input.identity.rendererKey,
      input.identity.rendererVersion,
      input.identity.analysisPackId,
      input.identity.analysisPackRevision,
      input.identity.modelProfileId,
      input.identity.modelProfileRevision,
      input.identity.outputContractRevision,
      input.identity.validatorRevision,
      input.source.triggered_by,
      input.source.session_id ?? null,
      input.source.run_id ?? null,
      input.source.result_json ?? null,
      input.source.created_at,
      input.source.updated_at,
      input.source.completed_at ?? null,
    );
  } finally {
    db.close();
  }
};
