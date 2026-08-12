import { describe, expect, it } from "vitest";

import { PRESCHOOL_SECTION_IDS, type PreschoolSectionId } from "./preschool-overview-ai-contracts.js";
import { arePreschoolSectionArtifactsTerminal } from "./preschool-overview-ai-page-workflow.js";

describe("Preschool Overview AI page workflow", () => {
  it("waits to synthesize while any independently claimed Section is queued or running", () => {
    expect(arePreschoolSectionArtifactsTerminal(statuses({ "standby-wastage": "running" }))).toBe(false);
    expect(arePreschoolSectionArtifactsTerminal(statuses({ "planning-outlook": "queued" }))).toBe(false);
  });

  it("allows synthesis after every Section reaches an available or failed terminal state", () => {
    expect(arePreschoolSectionArtifactsTerminal(statuses({}))).toBe(true);
    expect(arePreschoolSectionArtifactsTerminal(statuses({ "standby-wastage": "failed" }))).toBe(true);
  });
});

const statuses = (
  overrides: Partial<Record<PreschoolSectionId, "queued" | "running" | "available" | "failed">>,
) => Object.fromEntries(PRESCHOOL_SECTION_IDS.map((sectionId) => [
  sectionId,
  { status: overrides[sectionId] ?? "available" },
])) as Record<PreschoolSectionId, { status: "queued" | "running" | "available" | "failed" }>;
