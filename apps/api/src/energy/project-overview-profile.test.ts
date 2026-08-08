import { describe, expect, it } from "vitest";

import { resolveProjectOverviewProfile } from "./project-analysis-resolver.js";

describe("resolveProjectOverviewProfile", () => {
  it("returns the registered customer renderer and fixed decision horizons", () => {
    expect(resolveProjectOverviewProfile("ngee-ann-polytechnic")).toEqual({
      rendererKey: "ngee-ann-overview",
      rendererVersion: "1",
      contractVersion: "project-analysis-snapshot@1",
      horizons: {
        latestStatus: "latest-complete-day",
        shortTermDays: 7,
        mainDays: 28,
      },
    });
    expect(resolveProjectOverviewProfile("preschool-demo")?.rendererKey)
      .toBe("preschool-overview");
  });

  it("does not invent a customer renderer for an unregistered project", () => {
    expect(resolveProjectOverviewProfile("new-project")).toBeNull();
  });
});
