import { createMetadataStore, type EnergyIqOverviewAiArtifactIdentity } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createPreschoolExecutiveSynthesizer } from "./preschool-executive-synthesis.js";
import {
  createOverviewAiArtifactIdentity,
  createPreschoolOverviewAiValueArtifactIdentity,
} from "./overview-ai-artifact.js";
import { preschoolOverviewAiBindingFromIdentity, type PreschoolSectionId } from "./preschool-overview-ai-contracts.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Preschool Executive Synthesis", () => {
  it("reads only accepted same-identity Sections and preserves their source references", async () => {
    const harness = createHarness();
    const benchmark = completeSection(harness, "centre-benchmark", "30 Centres are included in the benchmark.");
    failSection(harness, "standby-wastage");
    const operating = completeSection(harness, "operating-behaviour", "Operating evidence supports a focused review.");
    completeSection(harness, "planning-outlook", undefined, "empty");
    let prompt = "";
    const synthesizer = createPreschoolExecutiveSynthesizer({
      metadataStore: harness.metadata,
      runSynthesis: async (input) => {
        prompt = input.prompt;
        return {
          answer: JSON.stringify({
            status: "available",
            keyFindings: [{
              takeaway: "Benchmark and operating evidence point to one focused management review.",
              sectionIds: ["centre-benchmark", "operating-behaviour"],
              evidenceRefs: ["evidence:centre-benchmark", "evidence:operating-behaviour"],
            }],
          }),
          runId: input.runId,
          sessionId: input.sessionId,
        };
      },
    });

    const artifact = await synthesizer.execute({
      baseIdentity: harness.identity,
      user: harness.user,
      retry: false,
    });
    expect(artifact.status).toBe("available");
    expect(JSON.parse(artifact.result_json!)).toMatchObject({
      status: "available",
      sourceSectionArtifactIds: [benchmark.id, operating.id],
      keyFindings: [{
        sectionIds: ["centre-benchmark", "operating-behaviour"],
        evidenceRefs: ["evidence:centre-benchmark", "evidence:operating-behaviour"],
      }],
    });
    expect(prompt).toContain('"sectionId":"centre-benchmark"');
    expect(prompt).toContain('"sectionId":"operating-behaviour"');
    expect(prompt).not.toContain('"sectionId":"standby-wastage"');
    expect(prompt).not.toContain('"sectionId":"planning-outlook"');
    harness.close();
  });

  it("fails only Synthesis when it introduces a new number", async () => {
    const harness = createHarness();
    const section = completeSection(harness, "centre-benchmark", "30 Centres are included in the benchmark.");
    const synthesizer = createPreschoolExecutiveSynthesizer({
      metadataStore: harness.metadata,
      runSynthesis: async (input) => ({
        answer: JSON.stringify({
          status: "available",
          keyFindings: [{
            takeaway: "99 Centres require action.",
            sectionIds: ["centre-benchmark"],
            evidenceRefs: ["evidence:centre-benchmark"],
          }],
        }),
        runId: input.runId,
        sessionId: input.sessionId,
      }),
    });

    const artifact = await synthesizer.execute({ baseIdentity: harness.identity, user: harness.user, retry: false });
    expect(artifact).toMatchObject({
      status: "failed",
      error_code: "PRESCHOOL_EXECUTIVE_SYNTHESIS_FACT_UNSUPPORTED",
    });
    expect(harness.metadata.energyIq.overviewAiArtifacts.get(sectionIdentity(harness.identity, "centre-benchmark"))).toEqual(section);
    harness.close();
  });

  it("keeps accepted Sections available when the Synthesis Provider fails", async () => {
    const harness = createHarness();
    const section = completeSection(harness, "centre-benchmark", "The benchmark supports a focused review.");
    const synthesizer = createPreschoolExecutiveSynthesizer({
      metadataStore: harness.metadata,
      runSynthesis: async () => { throw new Error("SYNTHESIS_PROVIDER_UNAVAILABLE"); },
    });

    const artifact = await synthesizer.execute({ baseIdentity: harness.identity, user: harness.user, retry: false });
    expect(artifact).toMatchObject({ status: "failed", error_code: "SYNTHESIS_PROVIDER_UNAVAILABLE" });
    expect(harness.metadata.energyIq.overviewAiArtifacts.get(sectionIdentity(harness.identity, "centre-benchmark"))).toEqual(section);
    harness.close();
  });

  it("uses a new immutable Executive identity when a retried Section becomes accepted", async () => {
    const harness = createHarness();
    completeSection(harness, "centre-benchmark");
    let calls = 0;
    const synthesizer = createPreschoolExecutiveSynthesizer({
      metadataStore: harness.metadata,
      runSynthesis: async (input) => {
        calls += 1;
        return {
          answer: JSON.stringify({
            status: "available",
            keyFindings: [{
              takeaway: "Accepted Section evidence supports a focused review.",
              sectionIds: calls === 1
                ? ["centre-benchmark"]
                : ["centre-benchmark", "operating-behaviour"],
              evidenceRefs: calls === 1
                ? ["evidence:centre-benchmark"]
                : ["evidence:centre-benchmark", "evidence:operating-behaviour"],
            }],
          }),
          runId: input.runId,
          sessionId: input.sessionId,
        };
      },
    });

    const first = await synthesizer.execute({ baseIdentity: harness.identity, user: harness.user, retry: false });
    completeSection(harness, "operating-behaviour");
    const second = await synthesizer.execute({ baseIdentity: harness.identity, user: harness.user, retry: false });

    expect(first.id).not.toBe(second.id);
    expect(first.status).toBe("available");
    expect(second.status).toBe("available");
    expect(calls).toBe(2);
    expect(JSON.parse(second.identity_json)).toMatchObject({
      artifactKind: "executive-synthesis",
      targetId: expect.stringMatching(/^sections:[a-f0-9]{64}$/u),
    });
    harness.close();
  });

  it("persists an empty success without calling the Provider when no Section has content", async () => {
    const harness = createHarness();
    completeSection(harness, "planning-outlook", undefined, "empty");
    let providerCalled = false;
    const synthesizer = createPreschoolExecutiveSynthesizer({
      metadataStore: harness.metadata,
      runSynthesis: async () => {
        providerCalled = true;
        throw new Error("unexpected");
      },
    });

    const artifact = await synthesizer.execute({ baseIdentity: harness.identity, user: harness.user, retry: false });
    expect(artifact.status).toBe("available");
    expect(JSON.parse(artifact.result_json!)).toMatchObject({
      artifactKind: "executive-synthesis",
      status: "empty",
      sourceSectionArtifactIds: [],
      keyFindings: [],
    });
    expect(providerCalled).toBe(false);
    harness.close();
  });
});

const completeSection = (
  harness: ReturnType<typeof createHarness>,
  sectionId: PreschoolSectionId,
  summary = "The verified Section evidence supports a focused review.",
  status: "available" | "empty" = "available",
) => {
  const identity = sectionIdentity(harness.identity, sectionId);
  harness.metadata.energyIq.overviewAiArtifacts.queue({ identity, triggeredBy: harness.user.id });
  const workerId = `worker:${sectionId}`;
  harness.metadata.energyIq.overviewAiArtifacts.claim({ identity, workerId, leaseMs: 60_000 });
  const runId = `run:${sectionId}`;
  return harness.metadata.energyIq.overviewAiArtifacts.complete({
    identity,
    workerId,
    sessionId: `session:${sectionId}`,
    runId,
    resultJson: JSON.stringify({
      artifactKind: "section-interpretation",
      status,
      providerProfileId: identity.modelProfileId,
      runId,
      contract: {
        id: "preschool-section-interpretation",
        revision: "preschool-section-interpretation-v1",
      },
      binding: preschoolOverviewAiBindingFromIdentity(identity),
      sectionId,
      ...(status === "available" ? {
        summary,
        keyPoints: [
          { kind: "finding", text: "The current pattern deserves attention.", evidenceRefs: [`evidence:${sectionId}`] },
          { kind: "next-check", text: "Confirm the context before assigning a cause.", evidenceRefs: [`evidence:${sectionId}`] },
        ],
      } : { keyPoints: [] }),
    }),
  });
};

const failSection = (harness: ReturnType<typeof createHarness>, sectionId: PreschoolSectionId) => {
  const identity = sectionIdentity(harness.identity, sectionId);
  harness.metadata.energyIq.overviewAiArtifacts.queue({ identity, triggeredBy: harness.user.id });
  const workerId = `worker:${sectionId}`;
  harness.metadata.energyIq.overviewAiArtifacts.claim({ identity, workerId, leaseMs: 60_000 });
  return harness.metadata.energyIq.overviewAiArtifacts.fail({
    identity,
    workerId,
    errorCode: "SECTION_FAILED",
  });
};

const sectionIdentity = (
  baseIdentity: ReturnType<typeof createOverviewAiArtifactIdentity>,
  sectionId: PreschoolSectionId,
): EnergyIqOverviewAiArtifactIdentity => createPreschoolOverviewAiValueArtifactIdentity({
  baseIdentity,
  artifactKind: "section-interpretation",
  targetId: sectionId,
});

const createHarness = () => {
  const root = mkdtempSync(join(tmpdir(), "preschool-executive-synthesis-"));
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
