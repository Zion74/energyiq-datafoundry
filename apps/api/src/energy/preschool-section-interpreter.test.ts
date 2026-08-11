import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createOverviewAiArtifactIdentity } from "./overview-ai-artifact.js";
import {
  PRESCHOOL_SECTION_IDS,
  type PreschoolSectionId,
  type PreschoolSectionPack,
} from "./preschool-overview-ai-contracts.js";
import { createPreschoolSectionInterpreter } from "./preschool-section-interpreter.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Preschool Section Interpreter", () => {
  it("persists valid siblings when one Section cites unsupported Evidence and retries only that Section", async () => {
    const harness = createHarness();
    const prompts: string[] = [];
    let attempt = 0;
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runBatch: async ({ prompt, runId, sessionId }) => {
        prompts.push(prompt);
        attempt += 1;
        const sections = attempt === 1
          ? [
              available("centre-benchmark"),
              available("standby-wastage", "unsupported:evidence"),
              available("operating-behaviour"),
              { sectionId: "planning-outlook", status: "empty" },
            ]
          : [available("standby-wastage")];
        return { answer: JSON.stringify({ sections }), runId, sessionId };
      },
    });

    const first = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: packs(),
      user: harness.user,
    });
    expect(first).toMatchObject({
      "centre-benchmark": { status: "available" },
      "standby-wastage": {
        status: "failed",
        error_code: "PRESCHOOL_SECTION_INTERPRETATION_EVIDENCE_UNSUPPORTED",
      },
      "operating-behaviour": { status: "available" },
      "planning-outlook": { status: "available" },
    });
    expect(JSON.parse(first["planning-outlook"].result_json!)).toMatchObject({ status: "empty", keyPoints: [] });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).not.toContain("SQL tool");
    expect(prompts[0]).toContain("Do not query SQL");

    const retried = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: packs(),
      user: harness.user,
      retryTargets: ["standby-wastage"],
    });
    expect(retried["standby-wastage"]).toMatchObject({ status: "available", attempt_count: 2 });
    expect(retried["centre-benchmark"]).toEqual(first["centre-benchmark"]);
    expect(retried["operating-behaviour"]).toEqual(first["operating-behaviour"]);
    expect(retried["planning-outlook"]).toEqual(first["planning-outlook"]);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('"sectionId":"standby-wastage"');
    expect(prompts[1]).not.toContain('"sectionId":"centre-benchmark"');
    harness.close();
  });

  it("records one honest shared transport failure when the batch Provider is unavailable", async () => {
    const harness = createHarness();
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runBatch: async () => { throw new Error("PROVIDER_TRANSPORT_UNAVAILABLE"); },
    });

    const result = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: packs(),
      user: harness.user,
    });
    expect(PRESCHOOL_SECTION_IDS.map((sectionId) => result[sectionId].status)).toEqual([
      "failed", "failed", "failed", "failed",
    ]);
    expect(new Set(PRESCHOOL_SECTION_IDS.map((sectionId) => result[sectionId].error_code))).toEqual(
      new Set(["PROVIDER_TRANSPORT_UNAVAILABLE"]),
    );
    harness.close();
  });

  it("fails only a malformed item instead of rejecting the whole Provider envelope", async () => {
    const harness = createHarness();
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runBatch: async ({ runId, sessionId }) => ({
        answer: JSON.stringify({
          sections: PRESCHOOL_SECTION_IDS.map((sectionId) => sectionId === "operating-behaviour"
            ? { sectionId, status: "available", summary: "Supported summary", keyPoints: [] }
            : available(sectionId)),
        }),
        runId,
        sessionId,
      }),
    });

    const result = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: packs(),
      user: harness.user,
    });
    expect(result["operating-behaviour"]).toMatchObject({
      status: "failed",
      error_code: "PRESCHOOL_SECTION_INTERPRETATION_MALFORMED",
    });
    expect(result["centre-benchmark"].status).toBe("available");
    expect(result["standby-wastage"].status).toBe("available");
    expect(result["planning-outlook"].status).toBe("available");
    harness.close();
  });

  it("extracts a Provider-wrapped JSON envelope and keeps missing Sections independent", async () => {
    const harness = createHarness();
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runBatch: async ({ runId, sessionId }) => ({
        answer: `I will now return the requested object.\n${JSON.stringify({
          sections: PRESCHOOL_SECTION_IDS
            .filter((sectionId) => sectionId !== "operating-behaviour")
            .map((sectionId) => available(sectionId)),
        })}\nThe interpretation is complete.`,
        runId,
        sessionId,
      }),
    });

    const result = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: packs(),
      user: harness.user,
    });
    expect(result["centre-benchmark"].status).toBe("available");
    expect(result["standby-wastage"].status).toBe("available");
    expect(result["planning-outlook"].status).toBe("available");
    expect(result["operating-behaviour"]).toMatchObject({
      status: "failed",
      error_code: "PRESCHOOL_SECTION_INTERPRETATION_MISSING",
    });
    harness.close();
  });

  it("sends a bounded prompt projection rather than repeated runtime bindings", async () => {
    const harness = createHarness();
    let capturedPrompt = "";
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runBatch: async ({ prompt, runId, sessionId }) => {
        capturedPrompt = prompt;
        return {
          answer: JSON.stringify({ sections: PRESCHOOL_SECTION_IDS.map((sectionId) => available(sectionId)) }),
          runId,
          sessionId,
        };
      },
    });

    await interpreter.execute({
      baseIdentity: harness.identity,
      packs: packs(),
      user: harness.user,
    });
    expect(capturedPrompt.length).toBeLessThan(12_000);
    expect(capturedPrompt).not.toContain('"binding"');
    expect(capturedPrompt).toContain("exactly 4 complete bounded Section Pack projections");
    harness.close();
  });

  it("rejects stale Pack bindings before queuing or calling the Provider", async () => {
    const harness = createHarness();
    let providerCalled = false;
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runBatch: async () => {
        providerCalled = true;
        throw new Error("unexpected");
      },
    });
    const stalePacks = packs();
    stalePacks[0] = {
      ...stalePacks[0]!,
      binding: { ...stalePacks[0]!.binding, dataSnapshotId: "snapshot-stale" },
    };

    await expect(interpreter.execute({
      baseIdentity: harness.identity,
      packs: stalePacks,
      user: harness.user,
    })).rejects.toThrow("PRESCHOOL_SECTION_PACK_IDENTITY_MISMATCH");
    expect(providerCalled).toBe(false);
    harness.close();
  });
});

const available = (sectionId: PreschoolSectionId, evidenceRef = `evidence:${sectionId}`) => ({
  sectionId,
  status: "available",
  summary: "The verified evidence supports a focused management review.",
  keyPoints: [
    { kind: "finding", text: "The current pattern deserves attention.", evidenceRefs: [evidenceRef] },
    { kind: "next-check", text: "Confirm the operating context before assigning a cause.", evidenceRefs: [evidenceRef] },
  ],
});

const packs = (): PreschoolSectionPack[] => PRESCHOOL_SECTION_IDS.map((sectionId) => ({
  sectionId,
  audience: "non-technical energy manager",
  decisionQuestion: "What should the manager understand and check next?",
  binding: {
    workspaceId: "preschool-workspace",
    projectId: "preschool-demo",
    scopeId: "preschool-project",
    dataSnapshotId: "snapshot-current",
    projectReleaseId: "release-current",
    analysisPeriod: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
    modelProfileId: "workspace-default-model-profile",
    modelProfileRevision: 1,
  },
  evidence: [{
    id: `evidence:${sectionId}`,
    label: "Verified Section evidence",
    value: { supportedValue: 30 },
    entityRefs: [],
    evidenceRefs: [`evidence:${sectionId}`],
  }],
  dataQuality: { status: "complete" },
  limitations: [],
  missingEvidence: [],
  pageCoverage: ["Verified Section evidence"],
  allowedNextChecks: ["Confirm the operating context."],
}));

const createHarness = () => {
  const root = mkdtempSync(join(tmpdir(), "preschool-section-interpreter-"));
  roots.push(root);
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  metadata.users.upsertDevUser({ id: "dev-user", email: "dev@example.test", display_name: "Dev", dev_token: "dev" });
  metadata.workspaces.upsert({ id: "preschool-workspace", owner_user_id: "dev-user", name: "Preschool", kind: "customer" });
  metadata.energyIq.upsertProject({
    id: "preschool-demo",
    workspace_id: "preschool-workspace",
    name: "Preschool",
    status: "published",
    root_scope_id: "preschool-project",
  });
  return {
    metadata,
    identity: createOverviewAiArtifactIdentity({
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
    }),
    user: metadata.users.getById({ user_id: "dev-user" }),
    close: () => metadata.close(),
  };
};
