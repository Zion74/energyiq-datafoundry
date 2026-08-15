import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const overviewSource = readFileSync(new URL("./published-decision-dashboard.tsx", import.meta.url), "utf8");

describe("Overview change wiring", () => {
  it("adds the lightweight Overview A/B comparison without replacing the governed Additional diagnostic", () => {
    expect(overviewSource).toContain("<OverviewChangeDialog");
    expect(overviewSource).toContain("What changed?");
    expect(overviewSource).toContain("Test A/B update");
    expect(overviewSource).toContain("currentSnapshot={currentSnapshot}");
    expect(overviewSource).toContain("currentAiArtifact={aiArtifact}");
  });
});
