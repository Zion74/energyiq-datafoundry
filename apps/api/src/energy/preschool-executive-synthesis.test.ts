import { createMetadataStore, type EnergyIqOverviewAiArtifactIdentity } from "@datafoundry/metadata";
import type { AnalysisContextEvidenceCatalog } from "@datafoundry/agent-runtime";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createPreschoolExecutiveSynthesizer,
  MAX_PRESCHOOL_EXECUTIVE_PROMPT_CHARS,
} from "./preschool-executive-synthesis.js";
import { PRESCHOOL_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V4 } from "./preschool-overview-ai-structured-output.js";
import {
  createOverviewAiArtifactIdentity,
  createPreschoolOverviewAiSectionArtifactIdentityV4,
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
    expect(prompt).toContain("limited inline Markdown");
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

  it("allows ordinary management prose containing the word from", async () => {
    const harness = createHarness();
    completeSection(harness, "standby-wastage", "Closed-hour usage stands out against the normal pattern.");
    const synthesizer = createPreschoolExecutiveSynthesizer({
      metadataStore: harness.metadata,
      runSynthesis: async (input) => ({
        answer: JSON.stringify({
          status: "available",
          keyFindings: [{
            takeaway: "Closed-hour usage stands out from the normal pattern and deserves review.",
            sectionIds: ["standby-wastage"],
            evidenceRefs: ["evidence:standby-wastage"],
          }],
        }),
        runId: input.runId,
        sessionId: input.sessionId,
      }),
    });

    const artifact = await synthesizer.execute({ baseIdentity: harness.identity, user: harness.user, retry: false });
    expect(artifact.status).toBe("available");
    harness.close();
  });

  it("accepts comma-grouped numbers copied from accepted Sections", async () => {
    const harness = createHarness();
    completeSection(harness, "standby-wastage", "Closed-hour usage was 3,103.78 kWh.");
    const synthesizer = createPreschoolExecutiveSynthesizer({
      metadataStore: harness.metadata,
      runSynthesis: async (input) => ({
        answer: JSON.stringify({
          status: "available",
          keyFindings: [{
            takeaway: "Closed-hour usage was 3,103.78 kWh and deserves review.",
            sectionIds: ["standby-wastage"],
            evidenceRefs: ["evidence:standby-wastage"],
          }],
        }),
        runId: input.runId,
        sessionId: input.sessionId,
      }),
    });

    const artifact = await synthesizer.execute({ baseIdentity: harness.identity, user: harness.user, retry: false });
    expect(artifact.status).toBe("available");
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

  it("does not complete an old-identity Executive when the model binding changes during synthesis", async () => {
    const harness = createHarness();
    completeSection(harness, "centre-benchmark");
    let runtimeRevision = 1;
    const synthesizer = createPreschoolExecutiveSynthesizer({
      metadataStore: harness.metadata,
      assertRuntimeIdentity: (identity) => {
        if (identity.modelProfileRevision !== runtimeRevision) {
          throw new Error("OVERVIEW_AI_MODEL_PROFILE_REVISION_MISMATCH");
        }
      },
      runSynthesis: async (input) => {
        runtimeRevision = 2;
        return {
          answer: JSON.stringify({
            status: "available",
            keyFindings: [{
              takeaway: "Accepted Section evidence supports a focused review.",
              sectionIds: ["centre-benchmark"],
              evidenceRefs: ["evidence:centre-benchmark"],
            }],
          }),
          runId: input.runId,
          sessionId: input.sessionId,
        };
      },
    });

    const artifact = await synthesizer.execute({ baseIdentity: harness.identity, user: harness.user, retry: false });
    expect(artifact).toMatchObject({
      status: "failed",
      error_code: "OVERVIEW_AI_MODEL_PROFILE_REVISION_MISMATCH",
    });
    expect(artifact.result_json).toBeUndefined();
    harness.close();
  });

  it("synthesizes a partial 3-of-4 Key Findings Artifact from current-v4 Summary and Insight content only", async () => {
    const harness = createHarness();
    const benchmark = completeSectionV4(harness, "centre-benchmark");
    const standby = completeSectionV4(harness, "standby-wastage");
    const operating = completeSectionV4(harness, "operating-behaviour");
    failSectionV4(harness, "planning-outlook");
    completeSection(harness, "planning-outlook", "Legacy planning content must not enter current Key Findings.");
    let prompt = "";
    const synthesizer = createPreschoolExecutiveSynthesizer({
      metadataStore: harness.metadata,
      revision: "v4",
      runSynthesis: async (input) => {
        expect(input.structuredOutput).toBe(PRESCHOOL_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V4);
        prompt = input.prompt;
        return {
          answer: JSON.stringify({
            status: "available",
            summary: {
              text: "Three current Sections point to a concentrated management review.",
              evidenceRefs: [
                "evidence:centre-benchmark:summary",
                "evidence:standby-wastage:summary",
                "evidence:operating-behaviour:summary",
              ],
            },
            findings: [{
              title: "Priorities recur across three Sections",
              text: "The current evidence connects peer position with both closed- and operating-hour signals.",
              sectionIds: ["centre-benchmark", "standby-wastage", "operating-behaviour"],
              evidenceRefs: [
                "evidence:centre-benchmark:insight",
                "evidence:standby-wastage:insight",
                "evidence:operating-behaviour:insight",
              ],
            }],
          }),
          runId: input.runId,
          sessionId: input.sessionId,
        };
      },
    });

    const artifact = await synthesizer.execute({ baseIdentity: harness.identity, user: harness.user, retry: false });
    harness.close();
    expect(artifact.status, artifact.error_code ?? undefined).toBe("available");
    expect(artifact.result_json).toBeDefined();
    const result = JSON.parse(artifact.result_json!) as Record<string, unknown>;
    expect(JSON.parse(artifact.identity_json)).toMatchObject({
      artifactKind: "executive-synthesis",
      targetId: expect.stringMatching(/^sections:[a-f0-9]{64}$/u),
    });
    expect(result).toMatchObject({
      artifactKind: "executive-synthesis",
      status: "available",
      sourceSectionArtifactIds: [benchmark.id, standby.id, operating.id],
      summary: { text: "Three current Sections point to a concentrated management review." },
      findings: [{
        title: "Priorities recur across three Sections",
        sectionIds: ["centre-benchmark", "standby-wastage", "operating-behaviour"],
      }],
    });
    expect(result).not.toHaveProperty("keyFindings");
    expect(prompt).toContain('"summary"');
    expect(prompt).toContain('"insights"');
    expect(prompt).not.toContain('"keyPoints"');
    expect(prompt).not.toContain('"sectionId":"planning-outlook"');
  });

  it("records only current-v4 Sections that actually contribute to the accepted Key Findings output", async () => {
    const harness = createHarness();
    const benchmark = completeSectionV4(harness, "centre-benchmark");
    completeSectionV4(harness, "standby-wastage");
    const operating = completeSectionV4(harness, "operating-behaviour");
    const synthesizer = createPreschoolExecutiveSynthesizer({
      metadataStore: harness.metadata,
      revision: "v4",
      runSynthesis: async (input) => ({
        answer: JSON.stringify({
          status: "available",
          summary: {
            text: "Benchmark and operating evidence form the clearest cross-Section theme.",
            evidenceRefs: ["evidence:centre-benchmark:summary", "evidence:operating-behaviour:summary"],
          },
          findings: [{
            title: "One cross-Section pattern stands out",
            text: "The accepted benchmark and operating insights point in the same direction.",
            sectionIds: ["centre-benchmark", "operating-behaviour"],
            evidenceRefs: ["evidence:centre-benchmark:insight", "evidence:operating-behaviour:insight"],
          }],
        }),
        runId: input.runId,
        sessionId: input.sessionId,
      }),
    });

    const artifact = await synthesizer.execute({ baseIdentity: harness.identity, user: harness.user, retry: false });
    harness.close();
    expect(JSON.parse(artifact.result_json!)).toMatchObject({
      sourceSectionArtifactIds: [benchmark.id, operating.id],
    });
  });

  it("losslessly projects two accepted Sections and the full Overview fact catalog before calling the Provider", async () => {
    const harness = createHarness();
    const benchmark = completeSectionV4(harness, "centre-benchmark");
    const operating = completeSectionV4(harness, "operating-behaviour");
    const catalog = portfolioScaleOverviewEvidenceCatalog(harness.identity);
    expect(JSON.stringify(catalog).length).toBeGreaterThan(MAX_PRESCHOOL_EXECUTIVE_PROMPT_CHARS);
    let prompt = "";
    const synthesizer = createPreschoolExecutiveSynthesizer({
      metadataStore: harness.metadata,
      revision: "v4",
      authoritativeOverviewEvidence: {
        binding: preschoolOverviewAiBindingFromIdentity(harness.identity),
        catalog,
      },
      runSynthesis: async (input) => {
        prompt = input.prompt;
        return {
          answer: JSON.stringify({
            status: "available",
            summary: {
              text: "Benchmark and operating evidence point to a focused portfolio review.",
              evidenceRefs: ["evidence:centre-benchmark:summary", "evidence:operating-behaviour:summary"],
            },
            findings: [{
              title: "One cross-Section pattern stands out",
              text: "The accepted benchmark and operating insights point in the same direction.",
              sectionIds: ["centre-benchmark", "operating-behaviour"],
              evidenceRefs: ["evidence:centre-benchmark:insight", "evidence:operating-behaviour:insight"],
            }],
          }),
          runId: input.runId,
          sessionId: input.sessionId,
        };
      },
    });

    const artifact = await synthesizer.execute({ baseIdentity: harness.identity, user: harness.user, retry: false });
    harness.close();
    expect(artifact.status, artifact.error_code ?? undefined).toBe("available");
    expect(prompt.length).toBeLessThanOrEqual(MAX_PRESCHOOL_EXECUTIVE_PROMPT_CHARS);
    expect(prompt).toContain(benchmark.id);
    expect(prompt).toContain(operating.id);
    for (let index = 0; index < catalog.facts.length; index += 1) {
      expect(prompt).toContain(catalog.facts[index]!.id);
    }
    expect(prompt).toContain("evidence:overview:scope-summary");
    expect(prompt).toContain("cite its fact-row id as the evidenceRef");
    expect(prompt).toContain("sourceArtifactId and encoding indexes are provenance only; never repeat them in customer text");
    const acceptedProjection = JSON.parse(prompt.split("Accepted Sections: ")[1]!.split("\n\nAuthoritative Overview Evidence: ")[0]!);
    expect(decodeAcceptedSectionProjection(acceptedProjection)).toEqual([
      { sourceArtifactId: benchmark.id, result: JSON.parse(benchmark.result_json!) },
      { sourceArtifactId: operating.id, result: JSON.parse(operating.result_json!) },
    ].map(({ sourceArtifactId, result }) => ({
      sourceArtifactId,
      sectionId: result.sectionId,
      summary: result.summary,
      insights: result.insights,
    })));
    const overviewProjection = JSON.parse(prompt.split("Authoritative Overview Evidence: ")[1]!);
    expect(decodeOverviewEvidenceProjection(overviewProjection)).toEqual(catalog);
    expect(JSON.parse(artifact.result_json!)).toMatchObject({
      sourceSectionArtifactIds: [benchmark.id, operating.id],
    });
  });

  it("rejects a Key Finding whose Evidence belongs to a different current-v4 Section", async () => {
    const harness = createHarness();
    const benchmark = completeSectionV4(harness, "centre-benchmark");
    completeSectionV4(harness, "standby-wastage");
    const synthesizer = createPreschoolExecutiveSynthesizer({
      metadataStore: harness.metadata,
      revision: "v4",
      runSynthesis: async (input) => ({
        answer: JSON.stringify({
          status: "available",
          summary: {
            text: "The benchmark provides the summary context.",
            evidenceRefs: ["evidence:centre-benchmark:summary"],
          },
          findings: [{
            title: "Mismatched lineage",
            text: "This finding claims to come from the benchmark Section.",
            sectionIds: ["centre-benchmark"],
            evidenceRefs: ["evidence:standby-wastage:insight"],
          }],
        }),
        runId: input.runId,
        sessionId: input.sessionId,
      }),
    });

    const artifact = await synthesizer.execute({ baseIdentity: harness.identity, user: harness.user, retry: false });
    const storedBenchmark = harness.metadata.energyIq.overviewAiArtifacts
      .get(sectionIdentityV4(harness.identity, "centre-benchmark"));
    harness.close();
    expect(artifact).toMatchObject({
      status: "failed",
      error_code: "PRESCHOOL_EXECUTIVE_SYNTHESIS_EVIDENCE_UNSUPPORTED",
    });
    expect(storedBenchmark).toEqual(benchmark);
  });

  it("persists a supported deterministic Overview Evidence reference without weakening Section lineage", async () => {
    const harness = createHarness();
    const benchmark = completeSectionV4(harness, "centre-benchmark");
    const synthesizer = createPreschoolExecutiveSynthesizer({
      metadataStore: harness.metadata,
      revision: "v4",
      authoritativeOverviewEvidence: {
        binding: preschoolOverviewAiBindingFromIdentity(harness.identity),
        catalog: {
          contract: "analysis-context-evidence@1",
          sourceId: "project-analysis-snapshot:preschool-demo:snapshot-current",
          pins: {
            workspaceId: harness.identity.workspaceId,
            projectId: harness.identity.projectId,
            scopeId: harness.identity.scopeId,
            dataSnapshotId: harness.identity.dataSnapshotId,
            dataCutoff: "2026-05-31T23:45:00.000Z",
            projectReleaseId: harness.identity.projectReleaseId,
            metricVersion: "energy-v1",
          },
          facts: [{
            id: "analysis.summary.usage_kwh",
            label: "Portfolio energy use",
            metricId: "energy.total_usage_kwh",
            value: 120,
            unit: "kWh",
            status: "confirmed",
            evidenceRefs: ["query:overview-current"],
            dimensions: { sectionId: "centre-benchmark" },
          }],
        },
      },
      runSynthesis: async (input) => ({
        answer: JSON.stringify({
          status: "available",
          summary: {
            text: "The portfolio used 120 kWh and the benchmark evidence warrants attention.",
            evidenceRefs: ["analysis.summary.usage_kwh", "evidence:centre-benchmark:summary"],
          },
          findings: [{
            title: "Confirmed portfolio alert",
            text: "The confirmed 120 kWh total adds context to the current benchmark pattern.",
            sectionIds: ["centre-benchmark"],
            evidenceRefs: ["analysis.summary.usage_kwh", "evidence:centre-benchmark:insight"],
            alert: { severity: "attention", certainty: "confirmed" },
          }],
        }),
        runId: input.runId,
        sessionId: input.sessionId,
      }),
    });

    const artifact = await synthesizer.execute({ baseIdentity: harness.identity, user: harness.user, retry: false });
    harness.close();
    expect(artifact.status, artifact.error_code ?? undefined).toBe("available");
    expect(JSON.parse(artifact.identity_json)).toMatchObject({
      validatorRevision: "preschool-executive-synthesis-validator-v5",
      workflowRevision: "preschool-executive-synthesis-v6",
      investigatorPromptRevision: "preschool-executive-synthesis-prompt-v6",
      capabilityRevision: "section-artifacts-and-overview-evidence-v2",
      publicationRevision: "key-findings-v2",
    });
    expect(JSON.parse(artifact.result_json!)).toMatchObject({
      sourceSectionArtifactIds: [benchmark.id],
      overviewEvidence: {
        contract: "analysis-context-evidence@1",
        sourceId: "project-analysis-snapshot:preschool-demo:snapshot-current",
        factIds: ["analysis.summary.usage_kwh"],
      },
      findings: [{ alert: { severity: "attention", certainty: "confirmed" } }],
    });
  });

  it("accepts conventional half-unit rounding of authoritative Overview facts", async () => {
    const harness = createHarness();
    completeSectionV4(harness, "centre-benchmark");
    const authoritativeOverviewEvidence = {
      binding: preschoolOverviewAiBindingFromIdentity(harness.identity),
      catalog: {
        contract: "analysis-context-evidence@1" as const,
        sourceId: "project-analysis-snapshot:preschool-demo:snapshot-current",
        pins: {
          workspaceId: harness.identity.workspaceId,
          projectId: harness.identity.projectId,
          scopeId: harness.identity.scopeId,
          dataSnapshotId: harness.identity.dataSnapshotId,
          dataCutoff: "2026-05-31T23:45:00.000Z",
          projectReleaseId: harness.identity.projectReleaseId,
          metricVersion: "energy-v1",
        },
        facts: [{
          id: "analysis.summary.closed_hour_share_pct",
          label: "Closed-hour energy share",
          metricId: "energy.off_hours_share_pct",
          value: 12.45,
          unit: "%",
          status: "confirmed" as const,
          evidenceRefs: ["query:overview-current"],
          dimensions: { sectionId: "standby-wastage" },
        }],
      },
    };
    const synthesizer = createPreschoolExecutiveSynthesizer({
      metadataStore: harness.metadata,
      revision: "v4",
      authoritativeOverviewEvidence,
      runSynthesis: async (input) => ({
        answer: JSON.stringify({
          status: "available",
          summary: {
            text: "The closed-hour share is roughly **12.5%**, with benchmark context available.",
            evidenceRefs: [
              "analysis.summary.closed_hour_share_pct",
              "evidence:centre-benchmark:summary",
            ],
          },
          findings: [{
            title: "Closed-hour share is roughly 12.5%",
            text: "The benchmark evidence provides context for the confirmed share.",
            sectionIds: ["centre-benchmark"],
            evidenceRefs: [
              "analysis.summary.closed_hour_share_pct",
              "evidence:centre-benchmark:insight",
            ],
          }],
        }),
        runId: input.runId,
        sessionId: input.sessionId,
      }),
    });

    const artifact = await synthesizer.execute({
      baseIdentity: harness.identity,
      user: harness.user,
      retry: false,
      authoritativeOverviewEvidence,
    });
    harness.close();

    expect(artifact.status, artifact.error_code ?? undefined).toBe("available");
  });

  it("accepts a rounded negative variance expressed as an under-plan magnitude", async () => {
    const harness = createHarness();
    completeSectionV4(harness, "planning-outlook");
    const authoritativeOverviewEvidence = {
      binding: preschoolOverviewAiBindingFromIdentity(harness.identity),
      catalog: {
        contract: "analysis-context-evidence@1" as const,
        sourceId: "project-analysis-snapshot:preschool-demo:snapshot-current",
        pins: {
          workspaceId: harness.identity.workspaceId,
          projectId: harness.identity.projectId,
          scopeId: harness.identity.scopeId,
          dataSnapshotId: harness.identity.dataSnapshotId,
          dataCutoff: "2026-05-31T23:45:00.000Z",
          projectReleaseId: harness.identity.projectReleaseId,
          metricVersion: "energy-v1",
        },
        facts: [{
          id: "analysis.outlook.first_week_variance_kwh",
          label: "First-week variance from plan",
          metricId: "energy.plan_variance_kwh",
          value: -668.86,
          unit: "kWh",
          status: "provisional" as const,
          evidenceRefs: ["query:daily-totals"],
          dimensions: { sectionId: "planning-outlook" },
        }],
      },
    };
    const synthesizer = createPreschoolExecutiveSynthesizer({
      metadataStore: harness.metadata,
      revision: "v4",
      authoritativeOverviewEvidence,
      runSynthesis: async (input) => ({
        answer: JSON.stringify({
          status: "available",
          summary: {
            text: "The first week is about **669 kWh under plan**.",
            evidenceRefs: [
              "analysis.outlook.first_week_variance_kwh",
              "evidence:planning-outlook:summary",
            ],
          },
          findings: [{
            title: "First week is about 669 kWh under plan",
            text: "This is a provisional planning signal.",
            sectionIds: ["planning-outlook"],
            evidenceRefs: [
              "analysis.outlook.first_week_variance_kwh",
              "evidence:planning-outlook:insight",
            ],
          }],
        }),
        runId: input.runId,
        sessionId: input.sessionId,
      }),
    });

    const artifact = await synthesizer.execute({
      baseIdentity: harness.identity,
      user: harness.user,
      retry: false,
      authoritativeOverviewEvidence,
    });
    harness.close();

    expect(artifact.status, artifact.error_code ?? undefined).toBe("available");
  });

  it("persists an explicit current Key Findings empty result without Provider when no current-v4 Section contributes", async () => {
    const harness = createHarness();
    completeSectionV4(harness, "centre-benchmark", "empty");
    failSectionV4(harness, "standby-wastage");
    let providerCalls = 0;
    const synthesizer = createPreschoolExecutiveSynthesizer({
      metadataStore: harness.metadata,
      revision: "v4",
      runSynthesis: async () => {
        providerCalls += 1;
        throw new Error("ZERO_CONTRIBUTION_MUST_NOT_CALL_PROVIDER");
      },
    });

    const artifact = await synthesizer.execute({ baseIdentity: harness.identity, user: harness.user, retry: false });
    harness.close();
    const result = JSON.parse(artifact.result_json!) as Record<string, unknown>;
    expect(artifact.status).toBe("available");
    expect(result).toMatchObject({
      artifactKind: "executive-synthesis",
      status: "empty",
      sourceSectionArtifactIds: [],
      findings: [],
    });
    expect(result).not.toHaveProperty("summary");
    expect(result).not.toHaveProperty("keyFindings");
    expect(providerCalls).toBe(0);
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
        revision: "preschool-section-interpretation-v3",
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

const completeSectionV4 = (
  harness: ReturnType<typeof createHarness>,
  sectionId: PreschoolSectionId,
  status: "available" | "empty" = "available",
) => {
  const identity = sectionIdentityV4(harness.identity, sectionId);
  harness.metadata.energyIq.overviewAiArtifacts.queue({ identity, triggeredBy: harness.user.id });
  const workerId = `worker:v4:${sectionId}`;
  harness.metadata.energyIq.overviewAiArtifacts.claim({ identity, workerId, leaseMs: 60_000 });
  const runId = `run:v4:${sectionId}`;
  return harness.metadata.energyIq.overviewAiArtifacts.complete({
    identity,
    workerId,
    sessionId: `session:v4:${sectionId}`,
    runId,
    resultJson: JSON.stringify({
      artifactKind: "section-interpretation",
      status,
      providerProfileId: identity.modelProfileId,
      runId,
      contract: {
        id: "preschool-section-interpretation",
        revision: "preschool-section-interpretation-v4",
      },
      binding: preschoolOverviewAiBindingFromIdentity(identity),
      sectionId,
      packRevision: "v2",
      capability: {
        revision: "scoped-read-only-v1",
        mode: "scoped-read-only",
        tools: sectionTools(sectionId),
      },
      toolAudits: [],
      ...(status === "available" ? {
        summary: {
          text: `Current ${sectionId} summary.`,
          evidenceRefs: [`evidence:${sectionId}:summary`],
        },
        insights: [{
          id: `insight:${sectionId}:1`,
          title: `Current ${sectionId} insight`,
          epistemicStatus: "inferred",
          text: `Current ${sectionId} evidence supports this relationship.`,
          evidenceRefs: [`evidence:${sectionId}:insight`],
        }],
        publication: {
          policyId: "preschool-section-publication",
          policyRevision: "v1",
          discoveredCount: 1,
          acceptedCount: 1,
          rejectedCount: 0,
          publishedCount: 1,
          suppressedCandidateIds: [],
        },
      } : {
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
    }),
  });
};

const sectionTools = (sectionId: PreschoolSectionId) => {
  if (sectionId === "centre-benchmark") return ["compare_centres", "inspect_related_section_signals"] as const;
  if (sectionId === "standby-wastage" || sectionId === "operating-behaviour") {
    return ["inspect_time_pattern", "inspect_load_composition", "inspect_related_section_signals"] as const;
  }
  return ["inspect_related_section_signals"] as const;
};

const portfolioScaleOverviewEvidenceCatalog = (
  identity: ReturnType<typeof createOverviewAiArtifactIdentity>,
): AnalysisContextEvidenceCatalog => ({
  contract: "analysis-context-evidence@1",
  sourceId: `project-analysis-snapshot:${identity.projectId}:${identity.dataSnapshotId}`,
  pins: {
    workspaceId: identity.workspaceId,
    projectId: identity.projectId,
    scopeId: identity.scopeId,
    dataSnapshotId: identity.dataSnapshotId,
    dataCutoff: "2026-05-31T23:45:00.000Z",
    projectReleaseId: identity.projectReleaseId,
    metricVersion: "energy-v1",
  },
  facts: [
    ...Array.from({ length: 31 }, (_, scopeIndex) => {
    const scopeId = scopeIndex === 0 ? "preschool-project" : `centre-${scopeIndex}`;
    const scopeName = scopeIndex === 0 ? "All centres" : `Centre ${scopeIndex}`;
    return [
      ["usage_kwh", "energy use", "energy.total_usage_kwh", 1_000.123456789 + scopeIndex, "kWh"],
      ["share_pct", "share of portfolio energy", "energy.scope_share_pct", 3.123456789 + scopeIndex / 10, "%"],
      ["eui", "annualised EUI", "preschool.benchmark.eui", 12.123456789 + scopeIndex / 10, "kWh/m2/year"],
      ["per_pax", "May energy use per person", "preschool.benchmark.per_pax", 18.123456789 + scopeIndex / 10, "kWh/person/month"],
      ["peak_kw", "peak interval-average power", "energy.peak_interval_average_kw", 7.123456789 + scopeIndex / 10, "kW"],
      ["off_hours_kwh", "off-hours energy use", "energy.off_hours_usage_kwh", 100.123456789 + scopeIndex, "kWh"],
      ["off_hours_share", "off-hours share", "energy.off_hours_share_pct", 12.123456789 + scopeIndex / 10, "%"],
      ["change_pct", "change from previous period", "energy.period_change_pct", -3.123456789 + scopeIndex / 10, "%"],
    ].map(([suffix, label, metricId, value, unit]) => ({
      id: `fact:${scopeId}:${suffix}`,
      label: `${scopeName} ${label}`,
      metricId: String(metricId),
      value: Number(value),
      unit: String(unit),
      status: scopeIndex === 0 ? "confirmed" as const : "provisional" as const,
      evidenceRefs: [
        "evidence:overview:scope-summary",
        "query:scope_summary_v1",
        "query:hourly_profile_v1",
        "query:daily_totals_v1",
        "query:peak_breakdown_v1",
        "query:meter_breakdown_v1",
        "query:previous_meter_usage_v1",
        "query:operational_policy_scope_intervals_v1",
      ],
      dimensions: { scopeId, scopeName, scopeType: scopeIndex === 0 ? "project" : "centre" },
    }));
    }).flat(),
    ...Array.from({ length: 29 }, (_, index) => ({
      id: `fact:portfolio:category-${index + 1}`,
      label: `Portfolio category ${index + 1} energy use`,
      metricId: "energy.category_usage_kwh",
      value: 200.123456789 + index,
      unit: "kWh",
      status: "confirmed" as const,
      evidenceRefs: [
        "evidence:overview:scope-summary",
        "query:scope_summary_v1",
        "query:hourly_profile_v1",
        "query:daily_totals_v1",
        "query:peak_breakdown_v1",
        "query:meter_breakdown_v1",
        "query:previous_meter_usage_v1",
        "query:operational_policy_scope_intervals_v1",
      ],
      dimensions: { category: `category-${index + 1}` },
    })),
  ],
});

const decodeAcceptedSectionProjection = (projection: {
  evidenceRefs: string[];
  sections: Array<{
    sourceArtifactId: string;
    sectionId: string;
    summary: { text: string; evidenceRefIndexes: number[] };
    insights: Array<Record<string, unknown> & { evidenceRefIndexes: number[] }>;
    limitation?: string;
  }>;
}) => projection.sections.map((section) => ({
  sourceArtifactId: section.sourceArtifactId,
  sectionId: section.sectionId,
  summary: {
    text: section.summary.text,
    evidenceRefs: section.summary.evidenceRefIndexes.map((index) => projection.evidenceRefs[index]),
  },
  insights: section.insights.map(({ evidenceRefIndexes, ...insight }) => ({
    ...insight,
    evidenceRefs: evidenceRefIndexes.map((index) => projection.evidenceRefs[index]),
  })),
  ...(section.limitation ? { limitation: section.limitation } : {}),
}));

const decodeOverviewEvidenceProjection = (projection: {
  contract: AnalysisContextEvidenceCatalog["contract"];
  sourceId: string;
  pins: AnalysisContextEvidenceCatalog["pins"];
  dictionaries: {
    metricIds: string[];
    units: string[];
    statuses: AnalysisContextEvidenceCatalog["facts"][number]["status"][];
    evidenceRefs: string[];
    evidenceSets: number[][];
    dimensions: Array<Record<string, string>>;
  };
  factTable: { rows: unknown[][] };
}): AnalysisContextEvidenceCatalog => ({
  contract: projection.contract,
  sourceId: projection.sourceId,
  pins: projection.pins,
  facts: projection.factTable.rows.map((row) => {
    const [id, label, metricIdIndex, value, unitIndex, statusIndex, evidenceSetIndex, dimensionsIndex] = row;
    return {
      id: String(id),
      label: String(label),
      metricId: projection.dictionaries.metricIds[Number(metricIdIndex)]!,
      value: value as string | number | boolean | null,
      ...(Number(unitIndex) < 0 ? {} : { unit: projection.dictionaries.units[Number(unitIndex)]! }),
      status: projection.dictionaries.statuses[Number(statusIndex)]!,
      evidenceRefs: projection.dictionaries.evidenceSets[Number(evidenceSetIndex)]!
        .map((index) => projection.dictionaries.evidenceRefs[index]!),
      dimensions: projection.dictionaries.dimensions[Number(dimensionsIndex)]!,
    };
  }),
});

const failSectionV4 = (harness: ReturnType<typeof createHarness>, sectionId: PreschoolSectionId) => {
  const identity = sectionIdentityV4(harness.identity, sectionId);
  harness.metadata.energyIq.overviewAiArtifacts.queue({ identity, triggeredBy: harness.user.id });
  const workerId = `worker:v4:${sectionId}`;
  harness.metadata.energyIq.overviewAiArtifacts.claim({ identity, workerId, leaseMs: 60_000 });
  return harness.metadata.energyIq.overviewAiArtifacts.fail({
    identity,
    workerId,
    errorCode: "SECTION_V4_FAILED",
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

const sectionIdentityV4 = (
  baseIdentity: ReturnType<typeof createOverviewAiArtifactIdentity>,
  sectionId: PreschoolSectionId,
): EnergyIqOverviewAiArtifactIdentity => createPreschoolOverviewAiSectionArtifactIdentityV4({
  baseIdentity,
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
