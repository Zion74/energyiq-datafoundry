import {
  createMetadataStore,
  type EnergyIqOverviewAiArtifactIdentity,
  type EnergyIqOverviewAiArtifactRecord,
  type MetadataStore,
} from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { preschoolExecutiveSynthesisTargetId } from "./preschool-executive-synthesis.js";
import {
  composePreschoolOverviewAiReadModel,
  composePreschoolOverviewAiReadModelV3,
} from "./preschool-overview-ai-read-model.js";
import {
  createOverviewAiArtifactIdentity,
  createPreschoolOverviewAiExecutiveArtifactIdentityV4,
  createPreschoolOverviewAiSectionArtifactIdentityV3,
  createPreschoolOverviewAiSectionArtifactIdentityV4,
  createPreschoolOverviewAiValueArtifactIdentity,
} from "./overview-ai-artifact.js";
import { preschoolOverviewAiBindingFromIdentity, type PreschoolSectionId } from "./preschool-overview-ai-contracts.js";

describe("composePreschoolOverviewAiReadModel", () => {
  it("returns null when the current identity has no Section or Executive artifacts", () => {
    const root = mkdtempSync(join(tmpdir(), "preschool-overview-read-model-empty-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      expect(composePreschoolOverviewAiReadModel({
        metadataStore: metadata,
        baseIdentity: identity(),
      })).toBeNull();
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads the current v4 Section identity even when the only artifact is still queued", () => {
    const root = mkdtempSync(join(tmpdir(), "preschool-overview-read-model-v4-current-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      seedProject(metadata);
      const baseIdentity = identity();
      metadata.energyIq.overviewAiArtifacts.queue({
        identity: sectionIdentityV4(baseIdentity, "centre-benchmark"),
        triggeredBy: "dev-user",
      });

      expect(composePreschoolOverviewAiReadModel({ metadataStore: metadata, baseIdentity }))
        .toMatchObject({
          sections: {
            "centre-benchmark": { status: "queued" },
          },
        });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not present an exact legacy v3 Section artifact as the current v4 result", () => {
    const root = mkdtempSync(join(tmpdir(), "preschool-overview-read-model-v3-legacy-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      seedProject(metadata);
      const baseIdentity = identity();
      completeSectionV3(metadata, baseIdentity, "centre-benchmark");

      expect(composePreschoolOverviewAiReadModel({ metadataStore: metadata, baseIdentity })).toBeNull();
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(["contract", "binding"] as const)(
    "marks only the affected Section unavailable when its stored %s does not match the requested identity",
    (mismatch) => {
      const baseIdentity = identity();
      const unitIdentity = sectionIdentity(baseIdentity, "centre-benchmark");
      const binding = preschoolOverviewAiBindingFromIdentity(unitIdentity);
      const result = {
        artifactKind: "section-interpretation",
        status: "available",
        providerProfileId: unitIdentity.modelProfileId,
        runId: "run:mismatch",
        contract: {
          id: "preschool-section-interpretation",
          revision: mismatch === "contract"
            ? "preschool-section-interpretation-tampered"
            : unitIdentity.outputContractRevision,
        },
        binding: mismatch === "binding"
          ? { ...binding, modelProfileRevision: binding.modelProfileRevision + 1 }
          : binding,
        sectionId: "centre-benchmark",
        packRevision: "v2",
        capability: { revision: "pack-only-v1", mode: "pack-only", tools: [] },
        summary: {
          text: "A stored result with a mismatched binding must not be exposed.",
          evidenceRefs: ["evidence:1"],
        },
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
      };
      const artifact = artifactRecord(unitIdentity, result);
      const metadataStore = {
        energyIq: {
          overviewAiArtifacts: {
            find: (requested: EnergyIqOverviewAiArtifactIdentity) =>
              requested.artifactKind === "section-interpretation"
                && requested.targetId === "centre-benchmark"
                ? artifact
                : undefined,
          },
        },
      } as unknown as MetadataStore;

      expect(composePreschoolOverviewAiReadModel({ metadataStore, baseIdentity }))
        .toMatchObject({
          sections: {
            "centre-benchmark": {
              status: "unavailable",
              artifactId: artifact.id,
              reason: "Section interpretation is invalid.",
            },
          },
        });
    },
  );

  it("keeps successful, empty, failed, and running Sections visible when Executive synthesis fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "preschool-overview-read-model-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.users.upsertDevUser({ id: "dev-user", email: "dev@example.test", display_name: "Dev", dev_token: "dev" });
      metadata.workspaces.upsert({
        id: "preschool-workspace",
        owner_user_id: "dev-user",
        name: "Preschool",
        kind: "customer",
      });
      metadata.energyIq.upsertProject({
        id: "preschool-demo",
        workspace_id: "preschool-workspace",
        name: "Preschool",
        status: "published",
        root_scope_id: "preschool-project",
      });
      const baseIdentity = identity();
      const benchmark = completeSection(metadata, baseIdentity, "centre-benchmark", "available");
      failSection(metadata, baseIdentity, "standby-wastage");
      runningSection(metadata, baseIdentity, "operating-behaviour");
      completeSection(metadata, baseIdentity, "planning-outlook", "empty");
      const executiveIdentity = createPreschoolOverviewAiExecutiveArtifactIdentityV4({
        baseIdentity,
        targetId: preschoolExecutiveSynthesisTargetId([benchmark.id]),
      });
      metadata.energyIq.overviewAiArtifacts.queue({ identity: executiveIdentity, triggeredBy: "dev-user" });
      metadata.energyIq.overviewAiArtifacts.claim({ identity: executiveIdentity, workerId: "executive-worker", leaseMs: 60_000 });
      metadata.energyIq.overviewAiArtifacts.fail({
        identity: executiveIdentity,
        workerId: "executive-worker",
        errorCode: "SYNTHESIS_PROVIDER_UNAVAILABLE",
      });

      const readModel = composePreschoolOverviewAiReadModel({ metadataStore: metadata, baseIdentity });

      expect(readModel).toMatchObject({
        artifactKind: "preschool-overview-ai-read-model",
        status: "available",
        sections: {
          "centre-benchmark": { status: "available" },
          "standby-wastage": { status: "unavailable", reason: "SECTION_FAILED" },
          "operating-behaviour": { status: "running" },
          "planning-outlook": { status: "empty" },
        },
        executive: { status: "unavailable", reason: "SYNTHESIS_PROVIDER_UNAVAILABLE" },
      });
      expect(readModel?.sections["centre-benchmark"]).toHaveProperty("result.summary");
      expect(readModel?.sections["planning-outlook"]).toHaveProperty("result.runId");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("restores exact historical v3 Section and Executive Artifacts through the v3 composer", () => {
    const root = mkdtempSync(join(tmpdir(), "preschool-overview-read-model-v3-history-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      seedProject(metadata);
      const baseIdentity = identity();
      const benchmark = completeSectionV3(metadata, baseIdentity, "centre-benchmark");
      const executiveIdentity = createPreschoolOverviewAiValueArtifactIdentity({
        baseIdentity,
        artifactKind: "executive-synthesis",
        targetId: preschoolExecutiveSynthesisTargetId([benchmark.id]),
      });
      metadata.energyIq.overviewAiArtifacts.queue({ identity: executiveIdentity, triggeredBy: "dev-user" });
      const workerId = "executive-v3-worker";
      metadata.energyIq.overviewAiArtifacts.claim({ identity: executiveIdentity, workerId, leaseMs: 60_000 });
      metadata.energyIq.overviewAiArtifacts.complete({
        identity: executiveIdentity,
        workerId,
        sessionId: "executive-v3-session",
        runId: "executive-v3-run",
        resultJson: JSON.stringify({
          artifactKind: "executive-synthesis",
          status: "available",
          providerProfileId: executiveIdentity.modelProfileId,
          runId: "executive-v3-run",
          contract: { id: "preschool-executive-synthesis", revision: "preschool-executive-synthesis-v1" },
          binding: preschoolOverviewAiBindingFromIdentity(executiveIdentity),
          sourceSectionArtifactIds: [benchmark.id],
          keyFindings: [{
            id: "historical-v3-finding",
            takeaway: "Frozen v3 evidence remains readable.",
            sectionIds: ["centre-benchmark"],
            evidenceRefs: ["evidence:v3"],
          }],
        }),
      });

      expect(composePreschoolOverviewAiReadModelV3({ metadataStore: metadata, baseIdentity })).toMatchObject({
        sections: { "centre-benchmark": { status: "available", artifactId: benchmark.id } },
        executive: { status: "available", result: { keyFindings: [{ id: "historical-v3-finding" }] } },
      });
      expect(composePreschoolOverviewAiReadModel({ metadataStore: metadata, baseIdentity })).toBeNull();
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

const identity = () => createOverviewAiArtifactIdentity({
  workspaceId: "preschool-workspace",
  projectId: "preschool-demo",
  scopeId: "preschool-project",
  dataSnapshotId: "snapshot-current",
  projectReleaseId: "release-current",
  analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
  analysisPeriodTo: "2026-06-01T00:00:00.000Z",
  rendererKey: "preschool-overview",
  rendererVersion: "1",
  modelProfileId: "workspace-default-model-profile",
  modelProfileRevision: 1,
});

const sectionIdentity = (
  baseIdentity: ReturnType<typeof identity>,
  sectionId: PreschoolSectionId,
): EnergyIqOverviewAiArtifactIdentity => createPreschoolOverviewAiSectionArtifactIdentityV4({
  baseIdentity,
  targetId: sectionId,
});

type SectionV4Identity = EnergyIqOverviewAiArtifactIdentity & {
  identityContractRevision: "v4";
  capabilityRevision: "pack-only-v1";
  publicationRevision: "v1";
};

const sectionIdentityV4 = (
  baseIdentity: ReturnType<typeof identity>,
  sectionId: PreschoolSectionId,
): SectionV4Identity => createPreschoolOverviewAiSectionArtifactIdentityV4({
  baseIdentity,
  targetId: sectionId,
}) as SectionV4Identity;

const completeSection = (
  metadata: ReturnType<typeof createMetadataStore>,
  baseIdentity: ReturnType<typeof identity>,
  sectionId: PreschoolSectionId,
  status: "available" | "empty",
) => {
  const unitIdentity = sectionIdentity(baseIdentity, sectionId);
  metadata.energyIq.overviewAiArtifacts.queue({ identity: unitIdentity, triggeredBy: "dev-user" });
  const workerId = `worker:${sectionId}`;
  metadata.energyIq.overviewAiArtifacts.claim({ identity: unitIdentity, workerId, leaseMs: 60_000 });
  const runId = `run:${sectionId}`;
  return metadata.energyIq.overviewAiArtifacts.complete({
    identity: unitIdentity,
    workerId,
    sessionId: `session:${sectionId}`,
    runId,
    resultJson: JSON.stringify({
      artifactKind: "section-interpretation",
      status,
      providerProfileId: unitIdentity.modelProfileId,
      runId,
      contract: { id: "preschool-section-interpretation", revision: "preschool-section-interpretation-v4" },
      binding: preschoolOverviewAiBindingFromIdentity(unitIdentity),
      sectionId,
      packRevision: "v2",
      capability: { revision: "pack-only-v1", mode: "pack-only", tools: [] },
      ...(status === "available" ? {
        summary: {
          text: "Verified evidence supports a focused review.",
          evidenceRefs: [`evidence:${sectionId}`],
        },
      } : {}),
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
    }),
  });
};

const failSection = (
  metadata: ReturnType<typeof createMetadataStore>,
  baseIdentity: ReturnType<typeof identity>,
  sectionId: PreschoolSectionId,
) => {
  const unitIdentity = sectionIdentity(baseIdentity, sectionId);
  metadata.energyIq.overviewAiArtifacts.queue({ identity: unitIdentity, triggeredBy: "dev-user" });
  const workerId = `worker:${sectionId}`;
  metadata.energyIq.overviewAiArtifacts.claim({ identity: unitIdentity, workerId, leaseMs: 60_000 });
  metadata.energyIq.overviewAiArtifacts.fail({ identity: unitIdentity, workerId, errorCode: "SECTION_FAILED" });
};

const runningSection = (
  metadata: ReturnType<typeof createMetadataStore>,
  baseIdentity: ReturnType<typeof identity>,
  sectionId: PreschoolSectionId,
) => {
  const unitIdentity = sectionIdentity(baseIdentity, sectionId);
  metadata.energyIq.overviewAiArtifacts.queue({ identity: unitIdentity, triggeredBy: "dev-user" });
  metadata.energyIq.overviewAiArtifacts.claim({
    identity: unitIdentity,
    workerId: `worker:${sectionId}`,
    leaseMs: 60_000,
  });
};

const seedProject = (metadata: ReturnType<typeof createMetadataStore>) => {
  metadata.users.upsertDevUser({
    id: "dev-user",
    email: "dev@example.test",
    display_name: "Dev",
    dev_token: "dev",
  });
  metadata.workspaces.upsert({
    id: "preschool-workspace",
    owner_user_id: "dev-user",
    name: "Preschool",
    kind: "customer",
  });
  metadata.energyIq.upsertProject({
    id: "preschool-demo",
    workspace_id: "preschool-workspace",
    name: "Preschool",
    status: "published",
    root_scope_id: "preschool-project",
  });
};

const completeSectionV3 = (
  metadata: ReturnType<typeof createMetadataStore>,
  baseIdentity: ReturnType<typeof identity>,
  sectionId: PreschoolSectionId,
) => {
  const unitIdentity = createPreschoolOverviewAiSectionArtifactIdentityV3({
    baseIdentity,
    targetId: sectionId,
  });
  metadata.energyIq.overviewAiArtifacts.queue({ identity: unitIdentity, triggeredBy: "dev-user" });
  const workerId = `worker:v3:${sectionId}`;
  metadata.energyIq.overviewAiArtifacts.claim({ identity: unitIdentity, workerId, leaseMs: 60_000 });
  const runId = `run:v3:${sectionId}`;
  return metadata.energyIq.overviewAiArtifacts.complete({
    identity: unitIdentity,
    workerId,
    sessionId: `session:v3:${sectionId}`,
    runId,
    resultJson: JSON.stringify({
      artifactKind: "section-interpretation",
      status: "available",
      providerProfileId: unitIdentity.modelProfileId,
      runId,
      contract: { id: "preschool-section-interpretation", revision: "preschool-section-interpretation-v3" },
      binding: preschoolOverviewAiBindingFromIdentity(unitIdentity),
      sectionId,
      summary: "This is a frozen v3 result.",
      keyPoints: [{ kind: "finding", text: "Legacy evidence.", evidenceRefs: ["evidence:v3"] }],
    }),
  });
};

const artifactRecord = (
  artifactIdentity: EnergyIqOverviewAiArtifactIdentity,
  result: unknown,
): EnergyIqOverviewAiArtifactRecord => ({
  id: `artifact:${artifactIdentity.targetId}`,
  identity_hash: "identity-hash",
  identity_json: JSON.stringify(artifactIdentity),
  workspace_id: artifactIdentity.workspaceId,
  project_id: artifactIdentity.projectId,
  scope_id: artifactIdentity.scopeId,
  resource: "electricity",
  data_snapshot_id: artifactIdentity.dataSnapshotId,
  project_release_id: artifactIdentity.projectReleaseId,
  renderer_key: artifactIdentity.rendererKey,
  renderer_version: artifactIdentity.rendererVersion,
  analysis_pack_id: artifactIdentity.analysisPackId,
  analysis_pack_revision: artifactIdentity.analysisPackRevision,
  model_profile_id: artifactIdentity.modelProfileId,
  model_profile_revision: artifactIdentity.modelProfileRevision,
  output_contract_revision: artifactIdentity.outputContractRevision,
  validator_revision: artifactIdentity.validatorRevision,
  status: "available",
  attempt_count: 1,
  triggered_by: "dev-user",
  run_id: "run:mismatch",
  result_json: JSON.stringify(result),
  created_at: "2026-08-13T00:00:00.000Z",
  updated_at: "2026-08-13T00:00:00.000Z",
  completed_at: "2026-08-13T00:00:00.000Z",
});
