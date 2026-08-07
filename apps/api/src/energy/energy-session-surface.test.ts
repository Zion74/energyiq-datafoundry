import { describe, expect, it } from "vitest";

import { isEnergyIqOverviewSlotSessionId } from "./energy-session-surface.js";

describe("EnergyIQ session surfaces", () => {
  it("keeps Overview Slot runs out of the user Analyst conversation list", () => {
    expect(isEnergyIqOverviewSlotSessionId(
      "energyiq-overview-slot-preschool-portfolio-1234",
    )).toBe(true);
    expect(isEnergyIqOverviewSlotSessionId("ngee-ann-overview-1234")).toBe(true);
    expect(isEnergyIqOverviewSlotSessionId("preschool-overview-1234")).toBe(true);
    expect(isEnergyIqOverviewSlotSessionId("58b8bcf4-analyst-session")).toBe(false);
  });
});
