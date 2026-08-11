import { createMetadataStore, type EnergyIqOverviewAiArtifactIdentity } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createPreschoolExecutiveSynthesizer } from "./preschool-executive-synthesis.js";
import { composePreschoolOverviewAiReadModel } from "./preschool-overview-ai-read-model.js";
import {
  createOverviewAiArtifactIdentity,
  createPreschoolOverviewAiValueArtifactIdentity,
} from "./overview-ai-artifact.js";
import { preschoolOverviewAiBindingFromIdentity, type PreschoolSectionId } from "./preschool-overview-ai-contracts.js";

describe("composePreschoolOverviewAiReadModel", () => {
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
      const user = metadata.users.getById({ user_id: "dev-user" });
      const baseIdentity = identity();
      completeSection(metadata, baseIdentity, "centre-benchmark", "available");
      failSection(metadata, baseIdentity, "standby-wastage");
      runningSection(metadata, baseIdentity, "operating-behaviour");
      completeSection(metadata, baseIdentity, "planning-outlook", "empty");
      const synthesizer = createPreschoolExecutiveSynthesizer({
        metadataStore: metadata,
        runSynthesis: async () => { throw new Error("SYNTHESIS_PROVIDER_UNAVAILABLE"); },
      });
      await synthesizer.execute({ baseIdentity, user, retry: false });

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
): EnergyIqOverviewAiArtifactIdentity => createPreschoolOverviewAiValueArtifactIdentity({
  baseIdentity,
  artifactKind: "section-interpretation",
  targetId: sectionId,
});

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
  metadata.energyIq.overviewAiArtifacts.complete({
    identity: unitIdentity,
    workerId,
    sessionId: `session:${sectionId}`,
    runId,
    resultJson: JSON.stringify({
      artifactKind: "section-interpretation",
      status,
      providerProfileId: unitIdentity.modelProfileId,
      runId,
      contract: { id: "preschool-section-interpretation", revision: "preschool-section-interpretation-v1" },
      binding: preschoolOverviewAiBindingFromIdentity(unitIdentity),
      sectionId,
      ...(status === "available" ? {
        summary: "Verified evidence supports a focused review.",
        keyPoints: [
          { kind: "finding", text: "A verified pattern deserves attention.", evidenceRefs: [`evidence:${sectionId}`] },
          { kind: "next-check", text: "Confirm context before assigning a cause.", evidenceRefs: [`evidence:${sectionId}`] },
        ],
      } : { keyPoints: [] }),
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
