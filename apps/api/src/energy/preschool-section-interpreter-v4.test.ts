import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createOverviewAiArtifactIdentity } from "./overview-ai-artifact.js";
import {
  buildPreschoolSectionDiscoveryPrompt,
  createPreschoolSectionInterpreter,
  materializePreschoolSectionResultV4,
} from "./preschool-section-interpreter.js";
import { PRESCHOOL_SECTION_IDS, type PreschoolSectionPack } from "./preschool-overview-ai-contracts.js";
import { PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V4 } from "./preschool-overview-ai-structured-output.js";
import type { PreschoolSectionPackV2 } from "./preschool-section-pack-v2.js";

describe("Preschool Section Interpreter v4", () => {
  it("consumes a complete Pack v2, locally rejects a bad candidate and publishes at most three runtime-identified insights", () => {
    const pack = packV2("centre-benchmark", 30);
    const prompt = buildPreschoolSectionDiscoveryPrompt(pack);
    const result = materializePreschoolSectionResultV4({
      answer: JSON.stringify({
        sectionId: "centre-benchmark",
        status: "available",
        summary: {
          text: "The verified Section evidence is available.",
          evidenceRefs: ["evidence:centre-benchmark:1"],
        },
        candidates: [{
          candidateId: "model-controlled",
          title: "Unsupported reference",
          epistemicStatus: "observed",
          text: "Centre 999 is the highest user.",
          evidenceRefs: ["unsupported:evidence"],
        }, ...["Peer shape", "Cross-section contrast", "Counterexample", "Watch signal"].map((title, index) => ({
          title,
          epistemicStatus: index === 3 ? "speculative" : "inferred",
          text: `${title} is a useful comparison angle supported by the peer matrix.`,
          evidenceRefs: ["evidence:centre-benchmark:1"],
        }))],
      }),
      pack,
      identity: identity("centre-benchmark"),
      runId: "runtime-run-1",
    });

    expect(result).toMatchObject({
      contract: { revision: "preschool-section-interpretation-v4" },
      packRevision: "v2",
      status: "available",
      runId: "runtime-run-1",
      capability: {
        revision: "scoped-read-only-v1",
        mode: "scoped-read-only",
        tools: ["compare_centres", "inspect_related_section_signals"],
      },
      toolAudits: [],
      insights: [
        { id: "preschool:centre-benchmark:candidate:2" },
        { id: "preschool:centre-benchmark:candidate:3" },
        { id: "preschool:centre-benchmark:candidate:4" },
      ],
      publication: {
        discoveredCount: 5,
        acceptedCount: 4,
        rejectedCount: 1,
        publishedCount: 3,
        suppressedCandidateIds: ["preschool:centre-benchmark:candidate:5"],
      },
    });
    expect(prompt).toContain("analysisGoal");
    expect(prompt).toContain("inline-complete");
    expect(prompt).toContain("Centre 30");
    expect(prompt).toContain("highest to lowest incremental value");
    expect(prompt).toContain("novel angle, relevance, urgency, contrarian value, and verifiability");
    expect(prompt).toContain("preserves that source order");
    expect(prompt).toContain("Do not invent an alert");
    expect(prompt).not.toContain("allowedNextChecks");
    expect(prompt).not.toContain('"kind"');
  });

  it("keeps an available Summary with zero insights", () => {
    const pack = packV2("planning-outlook", 1);
    const result = materializePreschoolSectionResultV4({
      answer: JSON.stringify({
        sectionId: "planning-outlook",
        status: "available",
        summary: {
          text: "The verified Section evidence is available.",
          evidenceRefs: ["evidence:planning-outlook:1"],
        },
        candidates: [],
      }),
      pack,
      identity: identity("planning-outlook"),
      runId: "runtime-run-2",
    });

    expect(result).toMatchObject({
      status: "available",
      insights: [],
      publication: { publishedCount: 0 },
    });
  });

  it("keeps a valid Summary available when every candidate is rejected", () => {
    const pack = packV2("standby-wastage", 1);
    const result = materializePreschoolSectionResultV4({
      answer: JSON.stringify({
        sectionId: "standby-wastage",
        status: "available",
        summary: {
          text: "The verified Section evidence is available.",
          evidenceRefs: ["evidence:standby-wastage:1"],
        },
        candidates: [{
          title: "Unsupported claim",
          epistemicStatus: "observed",
          text: "Centre 999 used 999 kWh on 2026-06-31.",
          evidenceRefs: ["unsupported:evidence"],
        }],
      }),
      pack,
      identity: identity("standby-wastage"),
      runId: "runtime-run-3",
    });

    expect(result).toMatchObject({
      status: "available",
      summary: {
        text: "The verified Section evidence is available.",
        evidenceRefs: ["evidence:standby-wastage:1"],
      },
      insights: [],
      publication: {
        discoveredCount: 1,
        acceptedCount: 0,
        rejectedCount: 1,
        publishedCount: 0,
      },
    });
  });

  it("accepts conventional decimal rounding at the exact half-unit boundary", () => {
    const pack = packV2("standby-wastage", 1);
    pack.evidence[0] = {
      id: "evidence:standby-wastage:1",
      label: "Closed-hour energy summary",
      value: { closedHoursSharePct: 12.45 },
      unit: "%",
      entityRefs: [],
      evidenceRefs: ["evidence:standby-wastage:1"],
    };
    const result = materializePreschoolSectionResultV4({
      answer: JSON.stringify({
        sectionId: "standby-wastage",
        status: "available",
        summary: {
          text: "Closed-hour energy was roughly **12.5%** of total usage.",
          evidenceRefs: ["evidence:standby-wastage:1"],
        },
        candidates: [],
      }),
      pack,
      identity: identity("standby-wastage"),
      runId: "runtime-run-decimal-rounding",
    });

    expect(result).toMatchObject({
      status: "available",
      summary: { text: "Closed-hour energy was roughly **12.5%** of total usage." },
      insights: [],
      publication: {
        discoveredCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        publishedCount: 0,
      },
    });
  });

  it("passes the explicit V4 structured contract only to Pack-v2 runner calls", async () => {
    const root = mkdtempSync(join(tmpdir(), "preschool-section-v4-runner-"));
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
    const user = metadata.users.getById({ user_id: "dev-user" });
    const seenV2: unknown[] = [];
    const seenV2Identities: Array<{ outputContractRevision: string; analysisPackRevision: string }> = [];
    const v2 = createPreschoolSectionInterpreter({
      metadataStore: metadata,
      runSection: async ({ identity, structuredOutput }) => {
        seenV2.push(structuredOutput);
        seenV2Identities.push({
          outputContractRevision: identity.outputContractRevision,
          analysisPackRevision: identity.analysisPackRevision,
        });
        throw new Error("EXPECTED_TEST_STOP");
      },
    });
    await v2.execute({
      baseIdentity: identity("centre-benchmark"),
      packs: PRESCHOOL_SECTION_IDS.map((sectionId) => packV2(sectionId, 1)),
      user,
    });

    const seenV1: unknown[] = [];
    const seenV1Identities: Array<{ outputContractRevision: string; analysisPackRevision: string }> = [];
    const v1 = createPreschoolSectionInterpreter({
      metadataStore: metadata,
      runSection: async ({ identity, structuredOutput }) => {
        seenV1.push(structuredOutput);
        seenV1Identities.push({
          outputContractRevision: identity.outputContractRevision,
          analysisPackRevision: identity.analysisPackRevision,
        });
        throw new Error("EXPECTED_TEST_STOP");
      },
    });
    await v1.execute({
      baseIdentity: {
        ...identity("centre-benchmark"),
        dataSnapshotId: "snapshot-legacy",
      },
      packs: legacyPacks("snapshot-legacy"),
      user,
    });

    expect(seenV2).toHaveLength(4);
    expect(seenV2.every((value) => value === PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V4)).toBe(true);
    expect(seenV2Identities.every((value) => value.outputContractRevision === "preschool-section-interpretation-v4"
      && value.analysisPackRevision === "v2")).toBe(true);
    expect(seenV1).toHaveLength(4);
    expect(seenV1.every((value) => value === undefined)).toBe(true);
    expect(seenV1Identities.every((value) => value.outputContractRevision === "preschool-section-interpretation-v3"
      && value.analysisPackRevision === "v1")).toBe(true);
    metadata.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("constructs scoped tools from the server-owned Section Pack and exposes only a controlled invocation callback", async () => {
    const root = mkdtempSync(join(tmpdir(), "preschool-section-v4-tools-"));
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
    const user = metadata.users.getById({ user_id: "dev-user" });
    const sectionPacks = PRESCHOOL_SECTION_IDS.map((sectionId) => packV2(sectionId, 1));
    const benchmarkPack = sectionPacks.find(({ sectionId }) => sectionId === "centre-benchmark")!;
    benchmarkPack.evidence = [{
      id: "evidence:centre-benchmark:g",
      label: "Centre G benchmark",
      value: {
        centreCode: "G",
        metrics: {
          absoluteUsage: { value: 120, unit: "kWh", rank: { position: 1, outOf: 1 } },
        },
      },
      unit: "kWh",
      entityRefs: ["centre-g"],
      evidenceRefs: ["evidence:centre-benchmark:g"],
    }];
    let centreToolResult: unknown;
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: metadata,
      runSection: async (runnerInput) => {
        expect(runnerInput).not.toHaveProperty("pack");
        expect(runnerInput).not.toHaveProperty("binding");
        expect(runnerInput).not.toHaveProperty("sectionId");
        expect(runnerInput.prompt).toContain("scoped read-only tools");
        if (runnerInput.identity.targetId === "centre-benchmark") {
          expect(runnerInput.sectionInsightTools).toEqual([
            "compare_centres",
            "inspect_related_section_signals",
          ]);
          centreToolResult = await runnerInput.invokeSectionInsightTool!({
            toolName: "compare_centres",
            toolCallId: "provider-tool-call-centre-g",
            input: { centreScopeIds: ["centre-g"], dimensions: ["absoluteUsage"] },
          });
          await expect(runnerInput.invokeSectionInsightTool!({
            toolName: "compare_centres",
            toolCallId: "provider-tool-call-forged",
            input: {
              centreScopeIds: ["centre-g"],
              dimensions: ["absoluteUsage"],
              dataSnapshotId: "snapshot-forged",
            },
          } as never)).rejects.toThrow("PRESCHOOL_SECTION_INSIGHT_REQUEST_INVALID");
        }
        return {
          answer: JSON.stringify({
            sectionId: runnerInput.identity.targetId,
            status: "available",
            summary: {
              text: "The verified Section evidence is available.",
              evidenceRefs: [`evidence:${runnerInput.identity.targetId}:1`],
            },
            candidates: [],
          }),
          runId: runnerInput.runId,
          sessionId: runnerInput.sessionId,
        };
      },
    });

    await interpreter.execute({
      baseIdentity: identity("centre-benchmark"),
      packs: sectionPacks,
      user,
    });

    expect(centreToolResult).toMatchObject({
      binding: {
        workspaceId: "preschool-workspace",
        projectId: "preschool-demo",
        sectionId: "centre-benchmark",
        dataSnapshotId: "snapshot-current",
      },
      audit: {
        toolName: "compare_centres",
        evidenceRefs: ["evidence:centre-benchmark:g"],
      },
      evidence: [{
        id: "evidence:centre-benchmark:g",
        value: { metrics: { absoluteUsage: { value: 120 } } },
      }],
    });
    metadata.close();
    rmSync(root, { recursive: true, force: true });
  });
});

const packV2 = (
  sectionId: PreschoolSectionPackV2["sectionId"],
  evidenceCount: number,
): PreschoolSectionPackV2 => ({
  contract: { id: "preschool-section-pack", revision: "preschool-section-pack-v2" },
  sectionId,
  audience: "non-technical energy manager",
  analysisGoal: "Find useful supported patterns and lines of inquiry.",
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
  evidence: Array.from({ length: evidenceCount }, (_, index) => ({
    id: `evidence:${sectionId}:${index + 1}`,
    label: sectionId === "centre-benchmark" ? `Centre ${index + 1}` : "Verified Section evidence",
    value: { centreCode: `Centre ${index + 1}`, supportedValue: 30 + index },
    unit: "kWh",
    entityRefs: [`centre-${index + 1}`],
    evidenceRefs: [`evidence:${sectionId}:${index + 1}`],
  })),
  alreadyPresentedFacts: [],
  crossSectionIndex: [],
  dataQuality: completeDataQuality,
  limitations: [],
  missingEvidence: [],
  capabilities: {
    revision: "scoped-read-only-v1",
    mode: "scoped-read-only",
    tools: sectionTools(sectionId),
  },
});

const sectionTools = (sectionId: PreschoolSectionPackV2["sectionId"]): PreschoolSectionPackV2["capabilities"]["tools"] => {
  if (sectionId === "centre-benchmark") return ["compare_centres", "inspect_related_section_signals"];
  if (sectionId === "standby-wastage" || sectionId === "operating-behaviour") {
    return ["inspect_time_pattern", "inspect_load_composition", "inspect_related_section_signals"];
  }
  return ["inspect_related_section_signals"];
};

const completeDataQuality: PreschoolSectionPackV2["dataQuality"] = {
  status: "complete",
  coveragePct: 100,
  expectedMeterIntervalCount: 1,
  validIntervalCount: 1,
  qualityEventCount: 0,
  cumulativeDeltaMismatchCount: 0,
  averageKwMismatchCount: 0,
  invalidIntervalDurationCount: 0,
  importBatchIds: [],
};

const legacyPacks = (dataSnapshotId: string): PreschoolSectionPack[] =>
  PRESCHOOL_SECTION_IDS.map((sectionId) => ({
    sectionId,
    audience: "non-technical energy manager",
    decisionQuestion: "What should the manager understand?",
    binding: {
      workspaceId: "preschool-workspace",
      projectId: "preschool-demo",
      scopeId: "preschool-project",
      dataSnapshotId,
      projectReleaseId: "release-current",
      analysisPeriod: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
      modelProfileId: "workspace-default-model-profile",
      modelProfileRevision: 1,
    },
    evidence: [{
      id: `evidence:${sectionId}:1`,
      label: "Verified Section evidence",
      value: { supportedValue: 30 },
      entityRefs: [],
      evidenceRefs: [`evidence:${sectionId}:1`],
    }],
    dataQuality: { status: "complete" },
    limitations: [],
    missingEvidence: [],
    pageCoverage: [],
    allowedNextChecks: [],
  }));

const identity = (sectionId: PreschoolSectionPackV2["sectionId"]) => ({
  ...createOverviewAiArtifactIdentity({
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
  artifactKind: "section-interpretation" as const,
  targetId: sectionId,
});
