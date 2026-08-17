import type {
  EnergyIqOverviewAiArtifactIdentity,
  EnergyIqOverviewAiArtifactRecord,
  MetadataStore,
  UserRecord,
} from "@datafoundry/metadata";
import { describe, expect, it, vi } from "vitest";

import { createOverviewAiArtifactIdentity } from "./overview-ai-artifact.js";
import {
  areNgeeAnnSectionArtifactsTerminal,
  createNgeeAnnOverviewAiWorkflow,
  isNgeeAnnOverviewAiGenerationTerminal,
  requireNgeeAnnAdditionalInsightsReady,
} from "./ngee-ann-overview-ai-workflow.js";
import {
  NGEE_ANN_SECTION_IDS,
  type NgeeAnnSectionId,
  type NgeeAnnSectionPacks,
} from "./ngee-ann-section-pack.js";

describe("Ngee Ann Overview AI workflow", () => {
  it("runs four exact Snapshot-bound Sections before synthesizing Key Findings", async () => {
    const records = new Map<string, EnergyIqOverviewAiArtifactRecord>();
    const store = fakeArtifactStore(records);
    const sectionCalls: EnergyIqOverviewAiArtifactIdentity[] = [];
    const executiveCalls: EnergyIqOverviewAiArtifactIdentity[] = [];
    const sectionProfileSnapshots: unknown[] = [];
    const executiveProfileSnapshots: unknown[] = [];
    const trustedSnapshot = modelProfileSnapshot();
    const workflow = createNgeeAnnOverviewAiWorkflow({
      metadataStore: { energyIq: { overviewAiArtifacts: store } } as unknown as MetadataStore,
      dataGateway: {} as never,
      assertRuntimeIdentity: vi.fn(),
      resolveModelProfileSnapshot: () => trustedSnapshot,
      resolvePacks: vi.fn().mockResolvedValue(packs()),
      runSection: async ({ identity, runId, sessionId, modelProfileSnapshot: snapshot }) => {
        sectionCalls.push(identity);
        sectionProfileSnapshots.push(snapshot);
        return {
          answer: JSON.stringify({
            sectionId: identity.targetId,
            status: "available",
            summary: { text: "This Section has a current supported conclusion.", evidenceRefs: ["evidence:ngee"] },
            candidates: [],
          }),
          runId,
          sessionId,
        };
      },
      runExecutive: async ({ identity, runId, sessionId, modelProfileSnapshot: snapshot }) => {
        executiveCalls.push(identity);
        executiveProfileSnapshots.push(snapshot);
        return { answer: JSON.stringify({ status: "empty", findings: [] }), runId, sessionId };
      },
    });

    const result = await workflow.execute({ identity: baseIdentity(), user: user() });

    expect(sectionCalls.map(({ targetId }) => targetId).sort()).toEqual([...NGEE_ANN_SECTION_IDS].sort());
    expect(sectionCalls.every(({ dataSnapshotId, rendererKey, identityContractRevision }) =>
      dataSnapshotId === "snapshot-ngee"
      && rendererKey === "ngee-ann-overview"
      && identityContractRevision === "ngee-ann-section-v4")).toBe(true);
    expect(executiveCalls).toHaveLength(1);
    expect(sectionProfileSnapshots).toEqual(Array.from({ length: 4 }, () => trustedSnapshot));
    expect(executiveProfileSnapshots).toEqual([trustedSnapshot]);
    expect(executiveCalls[0]).toMatchObject({
      artifactKind: "executive-synthesis",
      identityContractRevision: "ngee-ann-executive-v3",
      dataSnapshotId: "snapshot-ngee",
    });
    expect(Object.values(result.sections).every(({ status }) => status === "available")).toBe(true);
    expect(result.executive?.status).toBe("available");
  });

  it("waits for every independent Section to become terminal", () => {
    const terminal = Object.fromEntries(NGEE_ANN_SECTION_IDS.map((sectionId) => [sectionId, { status: "available" }])) as
      Record<NgeeAnnSectionId, Pick<EnergyIqOverviewAiArtifactRecord, "status">>;
    expect(areNgeeAnnSectionArtifactsTerminal(terminal)).toBe(true);
    expect(areNgeeAnnSectionArtifactsTerminal({
      ...terminal,
      "time-behaviour": { status: "running" },
    })).toBe(false);
  });

  it("does not consider Layer 1/2 ready while Key Findings is still running", () => {
    const terminal = Object.fromEntries(NGEE_ANN_SECTION_IDS.map((sectionId) => [sectionId, { status: "available" }])) as
      Record<NgeeAnnSectionId, Pick<EnergyIqOverviewAiArtifactRecord, "status">>;

    expect(isNgeeAnnOverviewAiGenerationTerminal({
      sections: terminal,
      executive: { status: "running" },
    })).toBe(false);
    expect(isNgeeAnnOverviewAiGenerationTerminal({
      sections: terminal,
      executive: { status: "available" },
    })).toBe(true);
    expect(() => requireNgeeAnnAdditionalInsightsReady({
      sections: terminal,
      executive: { status: "running" },
    })).toThrowError("ENERGYIQ_NGEE_ANN_ADDITIONAL_INSIGHTS_CORE_NOT_READY");
    expect(requireNgeeAnnAdditionalInsightsReady({
      sections: { ...terminal, "time-behaviour": { status: "empty" } },
      keyFindings: { status: "empty" },
    })).toEqual({
      sections: { ...terminal, "time-behaviour": { status: "empty" } },
      keyFindings: { status: "empty" },
    });
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

const user = (): UserRecord => ({ id: "dev-user" } as UserRecord);

const modelProfileSnapshot = () => ({
  bindingRevision: 8,
  profiles: [{
    exposedId: "workspace-default-model-profile",
    ownerWorkspaceId: "default",
    ownerUserId: "dev-user",
    resource: {
      kind: "model-profile",
      status: "connected",
      default_enabled: true,
      payload: {},
    },
  }],
}) as never;

const packs = (): NgeeAnnSectionPacks => Object.fromEntries(NGEE_ANN_SECTION_IDS.map((sectionId) => [sectionId, {
  contract: { id: "ngee-ann-section-pack", revision: "ngee-ann-section-pack-v1" },
  sectionId,
  audience: "facilities and energy managers",
  analysisGoal: "Find a useful current angle.",
  binding: {
    workspaceId: "workspace-ngee", projectId: "ngee-ann-polytechnic", scopeId: "ngee-ann-polytechnic",
    dataSnapshotId: "snapshot-ngee", projectReleaseId: "release-ngee",
    analysisPeriod: { from: "2026-05-19T16:00:00.000Z", to: "2026-06-16T16:00:00.000Z" },
    rendererKey: "ngee-ann-overview",
  },
  evidence: [{ id: "evidence:ngee", metricId: "energy.total_usage_kwh@1", queryIds: ["scope_summary_v1"] }],
  facts: {},
  dataQuality: { status: "complete", coveragePct: 100, importBatchIds: [] },
  limitations: [],
  missingEvidence: [],
  capabilities: { revision: "pack-only-v1", mode: "pack-only", tools: [] },
}])) as unknown as NgeeAnnSectionPacks;

const fakeArtifactStore = (records: Map<string, EnergyIqOverviewAiArtifactRecord>) => ({
  find: (identity: EnergyIqOverviewAiArtifactIdentity) => records.get(JSON.stringify(identity)),
  get: (identity: EnergyIqOverviewAiArtifactIdentity) => records.get(JSON.stringify(identity))!,
  queue: ({ identity }: { identity: EnergyIqOverviewAiArtifactIdentity }) => {
    const record = artifactRecord(identity, "queued");
    records.set(JSON.stringify(identity), record);
    return record;
  },
  claim: ({ identity }: { identity: EnergyIqOverviewAiArtifactIdentity }) => {
    const record = artifactRecord(identity, "running");
    records.set(JSON.stringify(identity), record);
    return { claimed: true, artifact: record };
  },
  complete: ({ identity, resultJson }: { identity: EnergyIqOverviewAiArtifactIdentity; resultJson: string }) => {
    const record = { ...artifactRecord(identity, "available"), result_json: resultJson };
    records.set(JSON.stringify(identity), record);
    return record;
  },
  fail: ({ identity, errorCode }: { identity: EnergyIqOverviewAiArtifactIdentity; errorCode: string }) => {
    const record = { ...artifactRecord(identity, "failed"), error_code: errorCode };
    records.set(JSON.stringify(identity), record);
    return record;
  },
});

const artifactRecord = (
  identity: EnergyIqOverviewAiArtifactIdentity,
  status: EnergyIqOverviewAiArtifactRecord["status"],
): EnergyIqOverviewAiArtifactRecord => ({
  id: `artifact:${identity.artifactKind}:${identity.targetId}`,
  identity_hash: `hash:${identity.targetId}`,
  identity_json: JSON.stringify(identity),
  workspace_id: identity.workspaceId, project_id: identity.projectId, scope_id: identity.scopeId,
  resource: "electricity", data_snapshot_id: identity.dataSnapshotId, project_release_id: identity.projectReleaseId,
  renderer_key: identity.rendererKey, renderer_version: identity.rendererVersion,
  analysis_pack_id: identity.analysisPackId, analysis_pack_revision: identity.analysisPackRevision,
  model_profile_id: identity.modelProfileId, model_profile_revision: identity.modelProfileRevision,
  output_contract_revision: identity.outputContractRevision, validator_revision: identity.validatorRevision,
  status, attempt_count: status === "queued" ? 0 : 1, triggered_by: "dev-user",
  created_at: "2026-08-17T00:00:00.000Z", updated_at: "2026-08-17T00:01:00.000Z",
});
