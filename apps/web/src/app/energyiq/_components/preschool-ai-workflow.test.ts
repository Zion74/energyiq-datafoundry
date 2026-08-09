import { describe, expect, it } from "vitest";

import {
  buildPreschoolInsightEditorPrompt,
  buildPreschoolInvestigatorPrompt,
  parsePreschoolEditorEnvelope,
  parsePreschoolInvestigatorCandidates,
} from "./preschool-ai-workflow";
import {
  buildPreschoolAiRunInput,
  buildPreschoolAiStageRunBody,
  resolvePreschoolAiWorkflowEventStreams,
} from "./preschool-ai-run";
import { preschoolGoldenSnapshot } from "./preschool-overview.test-fixture";

describe("fixed Preschool Investigator to Insight Editor workflow contract", () => {
  it("gives Investigator Snapshot coverage and allows open discovery with zero candidates", () => {
    const input = requiredInput();
    const prompt = buildPreschoolInvestigatorPrompt(input);

    expect(prompt).toContain("energy-insight-investigation@1.0.0");
    expect(prompt).toContain("Overview Coverage");
    expect(prompt).toContain(input.snapshotId);
    expect(prompt).toContain("Zero candidates is valid");
    expect(prompt).toContain("There is no candidate count target or global finding quota");
    expect(prompt).not.toContain("exactly three");
    expect(parsePreschoolInvestigatorCandidates('{"candidates":[]}')).toEqual([]);
  });

  it("preserves hypotheses and no-visual candidates without complete Evidence", () => {
    expect(parsePreschoolInvestigatorCandidates(JSON.stringify({
      candidates: [{
        id: "candidate-1",
        epistemicLevel: "hypothesis",
        title: "Schedules may explain the benchmark gap",
        takeaway: "The normalised benchmark pattern warrants an operating-schedule check.",
        nextCheck: "Compare opening schedules with major circuit loads.",
        evidenceRefs: [],
        evidenceSqlIndexes: [],
      }],
    }))).toEqual([expect.objectContaining({
      id: "candidate-1",
      epistemicLevel: "hypothesis",
      evidenceRefs: [],
      evidenceSqlIndexes: [],
    })]);
  });

  it("lets Editor accept Benchmark placement or leave it empty without audit-field filler", () => {
    const input = requiredInput();
    const candidates = parsePreschoolInvestigatorCandidates(JSON.stringify({
      candidates: [{
        id: "candidate-1",
        epistemicLevel: "hypothesis",
        title: "Schedules may explain the benchmark gap",
        takeaway: "The normalised pattern needs a schedule check.",
        evidenceRefs: [],
        evidenceSqlIndexes: [],
      }],
    }))!;
    const prompt = buildPreschoolInsightEditorPrompt(input, candidates, []);
    expect(prompt).toContain("preschool.benchmark");
    expect(prompt).toContain("Leave preschool.benchmark empty");
    expect(prompt).not.toContain("addsValueBy");
    expect(prompt).not.toContain("overlapRefs");

    const accepted = parsePreschoolEditorEnvelope(JSON.stringify({
      findings: [{
        sourceCandidateIds: ["candidate-1"],
        placementTargets: ["preschool.benchmark"],
        epistemicLevel: "hypothesis",
        relationship: "independent",
        signalRefs: ["efficiency"],
        title: "Benchmark gap needs a schedule check",
        takeaway: "The same pattern across two normalisations points to an operational check.",
        verification: "Compare schedules and major circuit loads.",
        uncertainty: "No occupancy schedule is present in this Snapshot.",
        evidenceRefs: [],
        evidenceSqlIndexes: [],
      }],
      trace: [{ decision: "accepted", sourceCandidateIds: ["candidate-1"] }],
    }), new Set(["candidate-1"]));
    expect(accepted).toMatchObject({
      findings: [{ placementTargets: ["preschool.benchmark"], epistemicLevel: "hypothesis" }],
      trace: [{ decision: "accepted", sourceCandidateIds: ["candidate-1"] }],
    });
    expect(parsePreschoolEditorEnvelope('{"findings":[],"trace":[{"decision":"rejected","sourceCandidateIds":["candidate-1"],"reason":"No incremental value"}]}', new Set(["candidate-1"])))
      .toMatchObject({ findings: [] });
  });

  it("rejects an accepted Finding that points outside the candidate set", () => {
    expect(parsePreschoolEditorEnvelope(JSON.stringify({
      findings: [{
        sourceCandidateIds: ["unknown"],
        placementTargets: ["preschool.benchmark"],
        epistemicLevel: "verified",
        relationship: "supports",
        signalRefs: [],
        title: "Unsupported",
        takeaway: "Unsupported",
        evidenceRefs: [],
        evidenceSqlIndexes: [],
      }],
    }), new Set(["candidate-1"]))).toBeNull();
  });

  it("requires a hypothesis or exploration idea to expose uncertainty or a verification path", () => {
    const base = {
      sourceCandidateIds: ["candidate-1"],
      placementTargets: ["preschool.benchmark"],
      epistemicLevel: "hypothesis",
      relationship: "independent",
      signalRefs: [],
      title: "Schedule may explain the gap",
      takeaway: "The driver is not established.",
      evidenceRefs: [],
      evidenceSqlIndexes: [],
    };
    expect(parsePreschoolEditorEnvelope(
      JSON.stringify({ findings: [base] }),
      new Set(["candidate-1"]),
    )).toBeNull();
    expect(parsePreschoolEditorEnvelope(
      JSON.stringify({ findings: [{ ...base, uncertainty: "Occupancy schedules are not present." }] }),
      new Set(["candidate-1"]),
    )).toMatchObject({ findings: [{ uncertainty: "Occupancy schedules are not present." }] });
  });

  it("enables the Method Skill and skill discovery tools for both fixed stages", () => {
    const input = requiredInput();
    const body = buildPreschoolAiStageRunBody(
      input,
      "profile-1",
      "run-1",
      "thread-1",
      "investigator",
      buildPreschoolInvestigatorPrompt(input),
    );

    expect(body).toMatchObject({
      body: {
        forwardedProps: {
          externalContext: { overviewAiStage: "investigator" },
          run_config: {
            activeSkillId: "energy-insight-investigation",
            enabledSkillIds: ["energy-insight-investigation"],
            skillPolicy: {
              allowedToolNames: ["skill", "skill_search", "skill_read", "inspect_schema", "run_sql_readonly"],
              deniedToolNames: ["list_data_sources", "preview_table"],
            },
          },
        },
      },
    });
  });

  it("materializes an accepted Benchmark interpretation with two-stage trace and no forced visual", () => {
    const input = requiredInput();
    const result = resolvePreschoolAiWorkflowEventStreams({
      input,
      providerProfileId: "profile-1",
      investigatorRunId: "investigator-run",
      investigatorEventStream: eventStream({ candidates: [{
        id: "candidate-1",
        epistemicLevel: "hypothesis",
        title: "Priority centres need a schedule check",
        takeaway: "The two normalisations point to an operational question.",
        evidenceRefs: ["benchmark:priority-centre:G"],
        evidenceSqlIndexes: [],
      }] }),
      editorRunId: "editor-run",
      editorEventStream: eventStream({
        findings: [{
          sourceCandidateIds: ["candidate-1"],
          placementTargets: ["preschool.benchmark"],
          epistemicLevel: "hypothesis",
          relationship: "independent",
          signalRefs: ["efficiency"],
          title: "Priority centres need a schedule check",
          takeaway: "Centre G remains a priority after both normalisations.",
          action: "Compare its operating schedule with major circuit loads.",
          verification: "Check schedule and circuit Evidence before changing operations.",
          uncertainty: "The current Snapshot does not confirm the cause.",
          evidenceRefs: ["benchmark:priority-centre:G"],
          evidenceSqlIndexes: [],
        }],
        trace: [{ decision: "accepted", sourceCandidateIds: ["candidate-1"], reason: "Adds a next decision" }],
      }),
    });

    expect(result).toMatchObject({
      status: "available",
      runId: "editor-run",
      contract: { id: "preschool-ai-accepted-artifact", revision: "v13" },
      binding: { dataSnapshotId: input.snapshotId },
      workflow: {
        stages: {
          investigator: { runId: "investigator-run" },
          editor: { runId: "editor-run" },
        },
        editorTrace: [{ decision: "accepted", sourceCandidateIds: ["candidate-1"] }],
      },
      findings: [{
        placementTargets: ["preschool.benchmark"],
        epistemicLevel: "hypothesis",
        evidence: { snapshotId: input.snapshotId },
      }],
    });
    if (result.status === "available" && "contract" in result) {
      expect(result.findings[0]).not.toHaveProperty("presentation");
      expect(result.findings[0]).not.toHaveProperty("sourceCandidateIds");
    }
  });

  it("drops only an unsupported Presentation block and preserves Agent-selected no-visual narrative", () => {
    const input = requiredInput();
    const result = resolvePreschoolAiWorkflowEventStreams({
      input,
      providerProfileId: "profile-1",
      investigatorRunId: "investigator-run",
      investigatorEventStream: eventStream({ candidates: [{
        id: "candidate-1",
        epistemicLevel: "hypothesis",
        title: "Schedule check",
        takeaway: "A schedule check may clarify the benchmark pattern.",
        evidenceRefs: [],
        evidenceSqlIndexes: [],
      }] }),
      editorRunId: "editor-run",
      editorEventStream: eventStream({ findings: [{
        sourceCandidateIds: ["candidate-1"],
        placementTargets: ["preschool.benchmark"],
        epistemicLevel: "hypothesis",
        relationship: "independent",
        signalRefs: [],
        title: "Schedule check",
        takeaway: "A schedule check may clarify the benchmark pattern.",
        verification: "Compare the operating schedule with major circuit loads.",
        uncertainty: "Equipment state and occupancy are not present.",
        evidenceRefs: [],
        evidenceSqlIndexes: [],
        presentation: {
          version: "1",
          blocks: [{ type: "metric", label: "Unsupported", value: 999, unit: "kWh" }],
        },
      }] }),
    });

    expect(result).toMatchObject({ status: "available", findings: [{ title: "Schedule check" }] });
    if (result.status === "available" && "contract" in result) {
      expect(result.findings[0]).not.toHaveProperty("presentation");
    }
  });

  it("does not impose a global accepted Finding count cap", () => {
    const input = requiredInput();
    const candidates = Array.from({ length: 6 }, (_, index) => ({
      id: `candidate-${index + 1}`,
      epistemicLevel: "exploration-idea",
      title: `Investigation angle ${String.fromCharCode(65 + index)}`,
      takeaway: `A distinct operational question ${String.fromCharCode(65 + index)} may be worth checking.`,
      evidenceRefs: [],
      evidenceSqlIndexes: [],
    }));
    const findings = candidates.map((candidate) => ({
      sourceCandidateIds: [candidate.id],
      placementTargets: ["cross-section"],
      epistemicLevel: candidate.epistemicLevel,
      relationship: "independent",
      signalRefs: [],
      title: candidate.title,
      takeaway: candidate.takeaway,
      verification: "Check the relevant schedule or circuit Evidence before acting.",
      evidenceRefs: [],
      evidenceSqlIndexes: [],
    }));

    const result = resolvePreschoolAiWorkflowEventStreams({
      input,
      providerProfileId: "profile-1",
      investigatorRunId: "investigator-run",
      investigatorEventStream: eventStream({ candidates }),
      editorRunId: "editor-run",
      editorEventStream: eventStream({ findings }),
    });

    expect(result).toMatchObject({ status: "available" });
    if (result.status === "available") expect(result.findings).toHaveLength(6);
  });
});

function requiredInput() {
  const input = buildPreschoolAiRunInput(preschoolGoldenSnapshot());
  if (!input) throw new Error("fixture should build an AI input");
  return input;
}

function eventStream(payload: Record<string, unknown>): string {
  return [
    { type: "TEXT_MESSAGE_CONTENT", delta: JSON.stringify(payload) },
    { type: "RUN_FINISHED" },
  ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}
