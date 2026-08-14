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
    expect(prompt).toContain("usageKwh is total interval energy");
    expect(prompt).toContain("one Portfolio row is not a Centre");
    expect(prompt).toContain("looks like, suggests, is consistent with");
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

  it("rejects a Section Summary that exceeds the two-sentence reading budget", () => {
    const pack = packV2("standby-wastage", 1);
    expect(() => materializePreschoolSectionResultV4({
      answer: JSON.stringify({
        sectionId: "standby-wastage",
        status: "available",
        summary: {
          text: "The verified Section evidence is available. The verified Section evidence is available. The verified Section evidence is available.",
          evidenceRefs: ["evidence:standby-wastage:1"],
        },
        candidates: [],
      }),
      pack,
      identity: identity("standby-wastage"),
      runId: "runtime-run-summary-sentence-budget",
    })).toThrow("PRESCHOOL_SECTION_INTERPRETATION_SUMMARY_UNSUPPORTED");
  });

  it.each([
    {
      sectionId: "centre-benchmark" as const,
      limitation: "Floor area metadata is provisional.",
      conclusion: "The peer comparison places 3 Centres in the highest-use group.",
      value: { highestUseGroupCount: 3, metadataStatus: "provisional" },
    },
    {
      sectionId: "planning-outlook" as const,
      limitation: "Forecast cost uses a reference tariff and is not an actual bill.",
      conclusion: "Projected usage is running at 108% of plan.",
      value: { pacePct: 108, tariffAssumption: { status: "provisional", notBill: true } },
    },
  ])("requires the $sectionId Summary to lead with its screened conclusion instead of substituting a caveat", ({
    sectionId,
    limitation,
    conclusion,
    value,
  }) => {
    const pack = packV2(sectionId, 1);
    pack.limitations = [limitation];
    pack.evidence[0] = {
      id: `evidence:${sectionId}:1`,
      label: "Current Section screening result",
      value,
      entityRefs: [],
      evidenceRefs: [`evidence:${sectionId}:1`],
    };
    const answer = (summary: string) => JSON.stringify({
      sectionId,
      status: "available",
      summary: { text: summary, evidenceRefs: [`evidence:${sectionId}:1`] },
      candidates: [],
      limitation,
    });

    expect(() => materializePreschoolSectionResultV4({
      answer: answer(limitation),
      pack,
      identity: identity(sectionId),
      runId: `runtime-run-${sectionId}-limitation-only`,
    })).toThrow("PRESCHOOL_SECTION_INTERPRETATION_SUMMARY_UNSUPPORTED");

    const supportedConclusion = sectionId === "planning-outlook"
      ? "The verified Section evidence is available."
      : conclusion;
    expect(materializePreschoolSectionResultV4({
      answer: answer(`${supportedConclusion} ${limitation}`),
      pack,
      identity: identity(sectionId),
      runId: `runtime-run-${sectionId}-conclusion-first`,
    })).toMatchObject({
      status: "available",
      summary: { text: `${supportedConclusion} ${limitation}` },
    });
  });

  it("locally rejects a planning Insight that only restates the presented tariff limitation", () => {
    const pack = packV2("planning-outlook", 1);
    const limitation = "Forecast cost uses a reference tariff and is not an actual bill.";
    pack.limitations = [limitation];
    pack.evidence[0] = {
      id: "evidence:planning-outlook:1",
      label: "Current planning outlook",
      value: {
        pacePct: 108,
        tariffAssumption: { status: "provisional", notBill: true },
        forecast: {
          scopes: [
            { scopeId: "portfolio", scopeRole: "portfolio" },
            { scopeId: "centre-1", scopeRole: "centre" },
          ],
        },
      },
      entityRefs: [],
      evidenceRefs: ["evidence:planning-outlook:1"],
    };

    const result = materializePreschoolSectionResultV4({
      answer: JSON.stringify({
        sectionId: "planning-outlook",
        status: "available",
        summary: {
          text: "The verified Section evidence is available.",
          evidenceRefs: ["evidence:planning-outlook:1"],
        },
        candidates: [{
          title: "Reference tariff caveat",
          epistemicStatus: "observed",
          text: "Forecast cost uses a reference tariff and is not an actual bill.",
          evidenceRefs: ["evidence:planning-outlook:1"],
        }, {
          title: "Scope distinction",
          epistemicStatus: "inferred",
          text: "The Portfolio is a separate scope from the Centre rows.",
          evidenceRefs: ["evidence:planning-outlook:1"],
        }],
        limitation,
      }),
      pack,
      identity: identity("planning-outlook"),
      runId: "runtime-run-planning-limitation-restatement",
    });

    expect(result).toMatchObject({
      status: "available",
      insights: [{ title: "Scope distinction", epistemicStatus: "inferred" }],
      publication: { discoveredCount: 2, acceptedCount: 1, rejectedCount: 1, publishedCount: 1 },
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

  it("accepts an evidence-backed day and month when the year is unambiguous", () => {
    const pack = packV2("standby-wastage", 1);
    pack.evidence[0] = {
      id: "evidence:standby-wastage:1",
      label: "Worst closed-hour spike",
      value: { localDate: "2026-05-25", localHour: 1 },
      entityRefs: ["centre-l"],
      evidenceRefs: ["evidence:standby-wastage:1"],
    };
    const result = materializePreschoolSectionResultV4({
      answer: JSON.stringify({
        sectionId: "standby-wastage",
        status: "available",
        summary: {
          text: "The worst spike was on **25 May** at **01:00**.",
          evidenceRefs: ["evidence:standby-wastage:1"],
        },
        candidates: [],
      }),
      pack,
      identity: identity("standby-wastage"),
      runId: "runtime-run-day-month",
    });

    expect(result).toMatchObject({
      status: "available",
      summary: { text: "The worst spike was on **25 May** at **01:00**." },
    });
  });

  it("accepts negative percentages expressed with a Unicode minus or as a below-plan magnitude", () => {
    const pack = packV2("planning-outlook", 1);
    pack.evidence[0] = {
      id: "evidence:planning-outlook:1",
      label: "Current outlook versus plan",
      value: {
        portfolioVariancePct: -2.55,
        bestCentreVariancePct: -1.66,
        worstCentreVariancePct: -3.89,
      },
      unit: "%",
      entityRefs: [],
      evidenceRefs: ["evidence:planning-outlook:1"],
    };
    const result = materializePreschoolSectionResultV4({
      answer: JSON.stringify({
        sectionId: "planning-outlook",
        status: "available",
        summary: {
          text: "The outlook is roughly **2.6% below plan**, with centres ranging from about **−1.7% to −3.9%**.",
          evidenceRefs: ["evidence:planning-outlook:1"],
        },
        candidates: [],
      }),
      pack,
      identity: identity("planning-outlook"),
      runId: "runtime-run-negative-percentages",
    });

    expect(result).toMatchObject({
      status: "available",
      summary: {
        text: "The outlook is roughly **2.6% below plan**, with centres ranging from about **−1.7% to −3.9%**.",
      },
    });
  });

  it("keeps supported Summary sentences when one sentence contains an unsupported number", () => {
    const pack = packV2("standby-wastage", 1);
    pack.evidence[0] = {
      id: "evidence:standby-wastage:1",
      label: "Closed-hour summary",
      value: { closedHoursKwh: 3103.784, applianceMinimumKwh: 1006.017 },
      unit: "kWh",
      entityRefs: [],
      evidenceRefs: ["evidence:standby-wastage:1"],
    };
    const result = materializePreschoolSectionResultV4({
      answer: JSON.stringify({
        sectionId: "standby-wastage",
        status: "available",
        summary: {
          text: "Closed-hour use was **3,104 kWh**. Review the schedule. Two different things drive this. Appliance use started at **1,007 kWh**.",
          evidenceRefs: ["evidence:standby-wastage:1"],
        },
        candidates: [],
      }),
      pack,
      identity: identity("standby-wastage"),
      runId: "runtime-run-partial-summary",
    });

    expect(result).toMatchObject({
      status: "available",
      summary: {
        text: "Closed-hour use was **3,104 kWh**. Review the schedule.",
        evidenceRefs: ["evidence:standby-wastage:1"],
      },
    });
  });

  it("downgrades a conditional observed candidate to inferred without discarding the useful angle", () => {
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
          title: "Possible schedule relationship",
          epistemicStatus: "observed",
          text: "The verified pattern could indicate a scheduling effect.",
          evidenceRefs: ["evidence:standby-wastage:1"],
        }],
      }),
      pack,
      identity: identity("standby-wastage"),
      runId: "runtime-run-epistemic-calibration",
    });

    expect(result).toMatchObject({
      status: "available",
      insights: [{
        title: "Possible schedule relationship",
        epistemicStatus: "inferred",
      }],
    });
  });

  it.each([
    "The pattern looks like a scheduling mismatch.",
    "The pattern suggests a scheduling mismatch.",
    "The pattern is consistent with a scheduling mismatch.",
  ])("downgrades observed wording that makes an inferred relationship: %s", (text) => {
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
          title: "Possible schedule relationship",
          epistemicStatus: "observed",
          text,
          evidenceRefs: ["evidence:standby-wastage:1"],
        }],
      }),
      pack,
      identity: identity("standby-wastage"),
      runId: "runtime-run-epistemic-phrasing",
    });

    expect(result).toMatchObject({
      status: "available",
      insights: [{ epistemicStatus: "inferred", text }],
    });
  });

  it("does not turn one Portfolio row plus 30 Centre rows into 31 Centres", () => {
    const pack = packV2("planning-outlook", 1);
    pack.evidence[0] = {
      id: "evidence:planning-outlook:1",
      label: "Portfolio and Centre outlook scopes",
      value: {
        actual: { completeDayCount: 31 },
        forecast: {
          scopes: [{ scopeId: "portfolio", scopeRole: "portfolio" }, ...Array.from(
            { length: 30 },
            (_, index) => ({ scopeId: `centre-${index + 1}`, scopeRole: "centre" }),
          )],
        },
      },
      entityRefs: ["portfolio", ...Array.from({ length: 30 }, (_, index) => `centre-${index + 1}`)],
      evidenceRefs: ["evidence:planning-outlook:1"],
    };
    const result = materializePreschoolSectionResultV4({
      answer: JSON.stringify({
        sectionId: "planning-outlook",
        status: "available",
        summary: {
          text: "The outlook contains one Portfolio scope and separate Centre scopes.",
          evidenceRefs: ["evidence:planning-outlook:1"],
        },
        candidates: [{
          title: "Wrong scope count",
          epistemicStatus: "observed",
          text: "All 31 Centres are represented in the outlook.",
          evidenceRefs: ["evidence:planning-outlook:1"],
        }, {
          title: "Scope distinction",
          epistemicStatus: "inferred",
          text: "The Portfolio is a separate scope from the Centre rows.",
          evidenceRefs: ["evidence:planning-outlook:1"],
        }],
      }),
      pack,
      identity: identity("planning-outlook"),
      runId: "runtime-run-planning-scope-semantics",
    });

    expect(result).toMatchObject({
      status: "available",
      insights: [{ title: "Scope distinction" }],
      publication: { discoveredCount: 2, acceptedCount: 1, rejectedCount: 1 },
    });
  });

  it("keeps operating-event total energy distinct from excess energy above baseline", () => {
    const pack = packV2("operating-behaviour", 1);
    pack.evidence[0] = {
      id: "evidence:operating-behaviour:1",
      label: "Centre L operating event",
      value: {
        centreCode: "L",
        name: "Centre L",
        worstSpike: {
          usageKwh: 30.847,
          impactKwh: 26.2093,
          variancePct: 565.1,
        },
      },
      unit: "kWh, %",
      entityRefs: ["centre-l"],
      evidenceRefs: ["evidence:operating-behaviour:1"],
    };
    const result = materializePreschoolSectionResultV4({
      answer: JSON.stringify({
        sectionId: "operating-behaviour",
        status: "available",
        summary: {
          text: "Centre L recorded the cited operating-hour event.",
          evidenceRefs: ["evidence:operating-behaviour:1"],
        },
        candidates: [{
          title: "Mislabeled event magnitude",
          epistemicStatus: "observed",
          text: "Centre L's largest operating spike was 26.2 kWh.",
          evidenceRefs: ["evidence:operating-behaviour:1"],
        }, {
          title: "Total and excess are distinct",
          epistemicStatus: "observed",
          text: "Centre L used 30.8 kWh during the interval; 26.2 kWh was above its same-hour baseline.",
          evidenceRefs: ["evidence:operating-behaviour:1"],
        }],
      }),
      pack,
      identity: identity("operating-behaviour"),
      runId: "runtime-run-operating-metric-semantics",
    });

    expect(result).toMatchObject({
      status: "available",
      insights: [{ title: "Total and excess are distinct" }],
      publication: { discoveredCount: 2, acceptedCount: 1, rejectedCount: 1 },
    });
  });

  it("rejects a real flagged-spike Centre count when it is attached to total operating energy", () => {
    const pack = packV2("operating-behaviour", 1);
    pack.evidence[0] = {
      id: "evidence:operating-behaviour:summary",
      label: "Operating-hour energy summary",
      value: {
        operatingHoursKwh: 21_818,
        operatingHoursSharePct: 87.55,
        spikeCount: 28,
        centreCount: 14,
      },
      unit: "kWh, %",
      entityRefs: [],
      evidenceRefs: ["evidence:operating-behaviour:summary"],
    };
    const answer = (summary: string) => JSON.stringify({
      sectionId: "operating-behaviour",
      status: "available",
      summary: {
        text: summary,
        evidenceRefs: ["evidence:operating-behaviour:summary"],
      },
      candidates: [],
    });

    expect(() => materializePreschoolSectionResultV4({
      answer: answer("During operating hours the estate used 21,818 kWh across 14 Centres."),
      pack,
      identity: identity("operating-behaviour"),
      runId: "runtime-run-wrong-operating-count-relation",
    })).toThrow("PRESCHOOL_SECTION_INTERPRETATION_SUMMARY_UNSUPPORTED");

    expect(materializePreschoolSectionResultV4({
      answer: answer("During operating hours the estate used 21,818 kWh. Flagged spikes affected 14 Centres."),
      pack,
      identity: identity("operating-behaviour"),
      runId: "runtime-run-correct-operating-count-relation",
    })).toMatchObject({ status: "available", summary: { text: expect.stringContaining("Flagged spikes") } });
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
