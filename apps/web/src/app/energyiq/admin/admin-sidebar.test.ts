import { describe, expect, it } from "vitest";

import { isAdminSection } from "./admin-sidebar";

describe("EnergyIQ Admin navigation", () => {
  it("restores the operational-policy route from the URL", () => {
    expect(isAdminSection("operational-policies")).toBe(true);
  });
});
