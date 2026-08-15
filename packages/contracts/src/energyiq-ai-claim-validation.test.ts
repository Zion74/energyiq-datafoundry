import { describe, expect, it } from "vitest";

import { energyAiNarrativeClaimsSupported } from "./energyiq-ai-claim-validation.js";

const energyEvidence = (usageKwh: number) => [{
  id: "portfolio:usage",
  label: "Portfolio usage",
  unit: "kWh",
  values: { usageKwh },
}];

describe("EnergyIQ AI claim validation", () => {
  it("does not treat ISO-like dates and clock times as business numeric claims", () => {
    expect(energyAiNarrativeClaimsSupported({
      narrative: "Peak demand occurred at 2026-05-22 15:00 and reached 20 kWh.",
      evidence: energyEvidence(20),
      sqlEvidence: [],
    })).toBe(true);
  });

  it("does not treat either endpoint of a clock-time range as a business numeric claim", () => {
    for (const separator of ["-", "–", "—"]) {
      for (const range of [`15:00${separator}16:00`, `15:00 ${separator}16:00`, `15:00 ${separator} 16:00`]) {
        expect(energyAiNarrativeClaimsSupported({
          narrative: `Peak demand occurred during ${range} and reached 20 kWh.`,
          evidence: energyEvidence(20),
          sqlEvidence: [],
        })).toBe(true);
      }
    }
  });

  it("continues to validate a genuinely negative business value", () => {
    expect(energyAiNarrativeClaimsSupported({
      narrative: "The measured variance was -15 kWh.",
      evidence: energyEvidence(15),
      sqlEvidence: [],
    })).toBe(false);
    expect(energyAiNarrativeClaimsSupported({
      narrative: "The measured variance was -15 kWh.",
      evidence: energyEvidence(-15),
      sqlEvidence: [],
    })).toBe(true);
  });

  it("does not treat ordinary centre nouns as Centre codes", () => {
    expect(energyAiNarrativeClaimsSupported({
      narrative: "The single-centre demand and centre identity check recorded 20 kWh.",
      evidence: energyEvidence(20),
      sqlEvidence: [],
    })).toBe(true);
    expect(energyAiNarrativeClaimsSupported({
      narrative: "The centre efficiency review recorded 20 kWh.",
      evidence: energyEvidence(20),
      sqlEvidence: [],
    })).toBe(true);
  });

  it("still rejects a clause that names more than one real Centre", () => {
    expect(energyAiNarrativeClaimsSupported({
      narrative: "Centre G, Centre AA, and Centre 1A recorded 20 kWh.",
      evidence: [],
      sqlEvidence: [{
        columns: ["centre_code", "usage_kwh"],
        rows: [["G", 20], ["AA", 20], ["1A", 20]],
      }],
    })).toBe(false);
  });

  it("requires every named Centre entity even when the narrative has no number", () => {
    const centreEvidence = (centreCode: string) => [{
      id: `centre:${centreCode.toLowerCase()}:usage`,
      label: `Centre ${centreCode} usage`,
      unit: "kWh",
      values: { centreCode, usageKwh: 20 },
    }];
    expect(energyAiNarrativeClaimsSupported({
      narrative: "Centre N warrants a separate timing check.",
      evidence: centreEvidence("G"),
      sqlEvidence: [],
    })).toBe(false);
    expect(energyAiNarrativeClaimsSupported({
      narrative: "Centre N warrants a separate timing check.",
      evidence: centreEvidence("N"),
      sqlEvidence: [],
    })).toBe(true);
  });

  it("validates every code in plural Centre coordination lists without treating ordinary nouns as codes", () => {
    const centreEvidence = (centreCode: string) => ({
      id: `centre:${centreCode.toLowerCase()}:usage`,
      label: `Centre ${centreCode} usage`,
      unit: "kWh",
      values: { centreCode, usageKwh: 20 },
    });
    for (const narrative of [
      "Centres G, M and J warrant separate timing checks.",
      "Centers G, M & J warrant separate timing checks.",
      "centres g, m and j warrant separate timing checks.",
      "centers g, m & j warrant separate timing checks.",
    ]) {
      expect(energyAiNarrativeClaimsSupported({
        narrative,
        evidence: [centreEvidence("G"), centreEvidence("M")],
        sqlEvidence: [],
      })).toBe(false);
      expect(energyAiNarrativeClaimsSupported({
        narrative,
        evidence: [centreEvidence("G"), centreEvidence("M"), centreEvidence("J")],
        sqlEvidence: [],
      })).toBe(true);
    }
    expect(energyAiNarrativeClaimsSupported({
      narrative: "Centres with stable loads warrant routine monitoring.",
      evidence: [],
      sqlEvidence: [],
    })).toBe(true);
  });

  it("recognises server-owned plural Centre code dimensions as entity Evidence", () => {
    const evidence = [
      {
        id: "after-hours:centres",
        label: "Centres with closed-hour peaks",
        unit: "count",
        values: { centreCount: 4, centreCodes: "L,G,E,N" },
      },
      {
        id: "efficiency:priority-centres",
        label: "Priority Centres",
        unit: "count",
        values: { centreCount: 3, centreCodes: "J,G,M" },
      },
    ];

    expect(energyAiNarrativeClaimsSupported({
      narrative: "Centre G appears in both the closed-hour and efficiency-priority Centre sets.",
      evidence,
      sqlEvidence: [],
      knownCentreCodes: ["E", "G", "J", "L", "M", "N"],
    })).toBe(true);
    expect(energyAiNarrativeClaimsSupported({
      narrative: "Centre H appears in both sets.",
      evidence,
      sqlEvidence: [],
      knownCentreCodes: ["E", "G", "H", "J", "L", "M", "N"],
    })).toBe(false);
  });

  it("validates a lowercase singular Centre code without treating a following word as a code", () => {
    const centreGEvidence = {
      id: "centre:g:usage",
      label: "Centre G usage",
      unit: "kWh",
      values: { centreCode: "G", usageKwh: 20 },
    };
    expect(energyAiNarrativeClaimsSupported({
      narrative: "centre g warrants a separate timing check.",
      evidence: [],
      sqlEvidence: [],
    })).toBe(false);
    expect(energyAiNarrativeClaimsSupported({
      narrative: "centre g warrants a separate timing check.",
      evidence: [centreGEvidence],
      sqlEvidence: [],
    })).toBe(true);
    expect(energyAiNarrativeClaimsSupported({
      narrative: "The centre garden warrants routine maintenance.",
      evidence: [],
      sqlEvidence: [],
    })).toBe(true);
    for (const narrative of [
      "The centre is closed for maintenance.",
      "The centre in Singapore remains operational.",
    ]) {
      expect(energyAiNarrativeClaimsSupported({
        narrative,
        evidence: [],
        sqlEvidence: [],
      })).toBe(true);
    }
  });

  it("uses an exact server-owned Centre vocabulary for lowercase multi-character codes", () => {
    const centreEvidence = (centreCode: string) => ({
      id: `centre:${centreCode.toLowerCase()}:usage`,
      label: `Centre ${centreCode} usage`,
      unit: "kWh",
      values: { centreCode, usageKwh: 20 },
    });
    const knownCentreCodes = ["G", "AA", "AD"];
    expect(energyAiNarrativeClaimsSupported({
      narrative: "centre aa warrants a separate timing check.",
      evidence: [],
      sqlEvidence: [],
      knownCentreCodes,
    })).toBe(false);
    expect(energyAiNarrativeClaimsSupported({
      narrative: "centre aa warrants a separate timing check.",
      evidence: [centreEvidence("AA")],
      sqlEvidence: [],
      knownCentreCodes,
    })).toBe(true);
    expect(energyAiNarrativeClaimsSupported({
      narrative: "centres aa and ad warrant separate timing checks.",
      evidence: [centreEvidence("AA")],
      sqlEvidence: [],
      knownCentreCodes,
    })).toBe(false);
    expect(energyAiNarrativeClaimsSupported({
      narrative: "centres aa and ad warrant separate timing checks.",
      evidence: [centreEvidence("AA"), centreEvidence("AD")],
      sqlEvidence: [],
      knownCentreCodes,
    })).toBe(true);
    for (const narrative of ["the centre is closed", "the centre in Singapore remains operational"]) {
      expect(energyAiNarrativeClaimsSupported({
        narrative,
        evidence: [],
        sqlEvidence: [],
        knownCentreCodes,
      })).toBe(true);
    }
  });

  it("requires a multiplier claim to come from a ratio, multiple, or factor field", () => {
    const narrative = "Centre G demand was 15x the peer baseline.";
    expect(energyAiNarrativeClaimsSupported({
      narrative,
      evidence: [],
      sqlEvidence: [{ columns: ["centre_code", "ratio"], rows: [["G", 15]] }],
    })).toBe(true);
    expect(energyAiNarrativeClaimsSupported({
      narrative,
      evidence: [],
      sqlEvidence: [{ columns: ["centre_code", "usage_kwh"], rows: [["G", 15]] }],
    })).toBe(false);
  });
});
