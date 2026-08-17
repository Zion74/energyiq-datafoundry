import type {
  EnergyIqOverviewAiArtifactIdentity,
  EnergyIqOverviewAiArtifactRecord,
  MetadataStore,
  UserRecord,
} from "@datafoundry/metadata";
import { describe, expect, it, vi } from "vitest";

import {
  createNgeeAnnAdditionalAiInsightArtifactIdentity,
  createNgeeAnnOverviewAiSectionArtifactIdentity,
  createOverviewAiArtifactIdentity,
} from "./overview-ai-artifact.js";
import { createNgeeAnnProjectOverviewAiAdapter } from "./ngee-ann-overview-ai-adapter.js";

describe("createNgeeAnnProjectOverviewAiAdapter", () => {
  it("restores each exact stored unit without queueing or executing Provider work", async () => {
    const identity = baseIdentity();
    const records = new Map<string, EnergyIqOverviewAiArtifactRecord>();
    const trend = createNgeeAnnOverviewAiSectionArtifactIdentity({
      baseIdentity: identity,
      targetId: "trend-and-demand",
    });
    const time = createNgeeAnnOverviewAiSectionArtifactIdentity({
      baseIdentity: identity,
      targetId: "time-behaviour",
    });
    const circuit = createNgeeAnnOverviewAiSectionArtifactIdentity({
      baseIdentity: identity,
      targetId: "circuit-concentration",
    });
    records.set(key(trend), availableRecord(trend, "available"));
    records.set(key(time), availableRecord(time, "empty"));
    records.set(key(circuit), failedRecord(circuit));
    const additional = createNgeeAnnAdditionalAiInsightArtifactIdentity({ baseIdentity: identity });
    records.set(key(additional), availableRecord(additional, "available"));
    const find = vi.fn((candidate: EnergyIqOverviewAiArtifactIdentity) => records.get(key(candidate)));
    const queue = vi.fn();
    const executeMissing = vi.fn();
    const adapter = createNgeeAnnProjectOverviewAiAdapter({
      metadataStore: {
        energyIq: {
          overviewAiArtifacts: { find, queue },
          insightMethodGovernance: { listPublishedWorkspaceMethodResources: vi.fn().mockReturnValue([]) },
        },
      } as unknown as MetadataStore,
      dataGateway: {} as never,
      resolveBaseIdentity: vi.fn().mockResolvedValue(identity),
      executeMissing,
    });

    const readModel = await adapter.readExact({ identity, user: user() });

    expect(readModel).toMatchObject({
      contract: "energyiq-project-overview-ai-read-model@1",
      rendererKey: "ngee-ann-overview",
      binding: {
        dataSnapshotId: "snapshot-a",
        generation: { workflowRevision: "energyiq-project-overview-ai-v1" },
      },
      keyFindings: { status: "missing" },
      sections: {
        "trend-and-demand": { status: "available", artifactId: trend.targetId },
        "time-behaviour": { status: "empty" },
        "circuit-concentration": { status: "failed", reason: "NGEE_SECTION_FAILED" },
        "decision-priorities": { status: "missing" },
      },
      additionalInsights: { status: "available" },
    });
    expect(find).toHaveBeenCalledTimes(6);
    expect(queue).not.toHaveBeenCalled();
    expect(executeMissing).not.toHaveBeenCalled();
  });

  it("delegates explicit Admin generation once and returns the newly stored exact read model", async () => {
    const identity = baseIdentity();
    const records = new Map<string, EnergyIqOverviewAiArtifactRecord>();
    const find = vi.fn((candidate: EnergyIqOverviewAiArtifactIdentity) => records.get(key(candidate)));
    const executeMissing = vi.fn(async () => {
      const trend = createNgeeAnnOverviewAiSectionArtifactIdentity({
        baseIdentity: identity,
        targetId: "trend-and-demand",
      });
      records.set(key(trend), availableRecord(trend, "available"));
    });
    const adapter = createNgeeAnnProjectOverviewAiAdapter({
      metadataStore: {
        energyIq: {
          overviewAiArtifacts: { find },
          insightMethodGovernance: { listPublishedWorkspaceMethodResources: vi.fn().mockReturnValue([]) },
        },
      } as unknown as MetadataStore,
      dataGateway: {} as never,
      resolveBaseIdentity: vi.fn().mockResolvedValue(identity),
      executeMissing,
    });

    const readModel = await adapter.generateMissing({
      identity,
      user: user(),
      retryTarget: "trend-and-demand",
    });

    expect(executeMissing).toHaveBeenCalledOnce();
    expect(executeMissing).toHaveBeenCalledWith({
      identity,
      user: expect.objectContaining({ id: "dev-user" }),
      retryTarget: "trend-and-demand",
    });
    expect(readModel.sections["trend-and-demand"]).toMatchObject({ status: "available" });
  });

  it("fails closed when a non-Ngee or stale base contract reaches the adapter", async () => {
    const identity = baseIdentity();
    const adapter = createNgeeAnnProjectOverviewAiAdapter({
      metadataStore: {
        energyIq: {
          overviewAiArtifacts: { find: vi.fn() },
          insightMethodGovernance: { listPublishedWorkspaceMethodResources: vi.fn().mockReturnValue([]) },
        },
      } as unknown as MetadataStore,
      dataGateway: {} as never,
      resolveBaseIdentity: vi.fn().mockResolvedValue(identity),
      executeMissing: vi.fn(),
    });

    await expect(adapter.readExact({
      identity: { ...identity, workflowRevision: "stale-workflow-v0" },
      user: user(),
    })).rejects.toThrow("ENERGYIQ_NGEE_ANN_OVERVIEW_AI_IDENTITY_INVALID");
  });
});

const baseIdentity = () => createOverviewAiArtifactIdentity({
  workspaceId: "workspace-ngee",
  projectId: "ngee-ann-polytechnic",
  scopeId: "ngee-ann-polytechnic",
  dataSnapshotId: "snapshot-a",
  projectReleaseId: "ngee-release-v6",
  analysisPeriodFrom: "2026-05-19T16:00:00.000Z",
  analysisPeriodTo: "2026-06-16T16:00:00.000Z",
  rendererKey: "ngee-ann-overview",
  rendererVersion: "1",
  modelProfileId: "workspace-default-model-profile",
  modelProfileRevision: 8,
});

const user = (): UserRecord => ({ id: "dev-user" } as UserRecord);

const key = (identity: EnergyIqOverviewAiArtifactIdentity): string => JSON.stringify(identity);

const availableRecord = (
  identity: EnergyIqOverviewAiArtifactIdentity,
  status: "available" | "empty",
): EnergyIqOverviewAiArtifactRecord => ({
  id: identity.targetId ?? "artifact",
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
  status: "available",
  attempt_count: 1,
  triggered_by: "dev-user",
  result_json: JSON.stringify({ status, sectionId: identity.targetId }),
  created_at: "2026-08-17T00:00:00.000Z",
  updated_at: "2026-08-17T00:01:00.000Z",
  completed_at: "2026-08-17T00:01:00.000Z",
});

const failedRecord = (
  identity: EnergyIqOverviewAiArtifactIdentity,
): EnergyIqOverviewAiArtifactRecord => {
  const { result_json: _resultJson, ...record } = availableRecord(identity, "empty");
  return {
    ...record,
    status: "failed",
    error_code: "NGEE_SECTION_FAILED",
  };
};
