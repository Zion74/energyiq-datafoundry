import { describe, expect, it } from "vitest";

import { buildEnergyAiHandoffInitialDraftPrompt } from "./energy-analysis-workbench";

describe("EnergyIQ AI Analyst handoff", () => {
  it("turns bounded Finding and Evidence URL parameters into an untrusted verification draft", () => {
    const params = new URLSearchParams({
      projectId: "ngee-ann-polytechnic",
      finding: JSON.stringify({
        title: "Recurring overnight load",
        what: "The pattern recurs across recent periods.",
        why: { kind: "Hypothesis", text: "Operating-state evidence is incomplete." },
        how: "Inspect the coincident circuits.",
        howToVerify: "Compare the next complete period after the check.",
      }),
      evidence: JSON.stringify({
        snapshotId: "snapshot-1",
        dataCutoff: "2026-06-16",
        note: "SQL supports the pattern, not the operational cause.",
        toolCallIds: ["sql-1"],
        auditLogIds: ["audit-sql-1"],
      }),
    });

    const prompt = buildEnergyAiHandoffInitialDraftPrompt(params);

    expect(prompt).toContain("untrusted draft");
    expect(prompt).toContain("Recurring overnight load");
    expect(prompt).toContain("Hypothesis");
    expect(prompt).toContain("snapshot-1");
    expect(prompt).toContain("sql-1");
    expect(prompt).toContain("current authorized Project, Scope, resource, and Snapshot");
    expect(prompt).toContain("scoped read-only SQL Evidence");
    expect(prompt).toContain("Missing Evidence");
  });

  it.each([
    { name: "missing Evidence", finding: JSON.stringify({ title: "Finding" }), evidence: null },
    { name: "invalid Finding JSON", finding: "{broken", evidence: JSON.stringify({ snapshotId: "snapshot-1" }) },
    { name: "oversized Finding", finding: JSON.stringify({ title: "x".repeat(8_100) }), evidence: JSON.stringify({ snapshotId: "snapshot-1" }) },
    { name: "invalid Evidence shape", finding: JSON.stringify({ title: "Finding", what: "What", why: { kind: "Evidence", text: "Why" }, how: "How", howToVerify: "Verify" }), evidence: JSON.stringify({ snapshotId: 42 }) },
  ])("fails soft for $name", ({ finding, evidence }) => {
    const params = new URLSearchParams();
    params.set("finding", finding);
    if (evidence !== null) params.set("evidence", evidence);

    expect(buildEnergyAiHandoffInitialDraftPrompt(params)).toBeNull();
  });
});
