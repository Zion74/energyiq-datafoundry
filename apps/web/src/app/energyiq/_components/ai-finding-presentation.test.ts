import { describe, expect, it } from "vitest";

import { parseAiFindingPresentation } from "./ai-finding-presentation";

describe("parseAiFindingPresentation", () => {
  it("lets the analyst compose multiple useful blocks", () => {
    expect(parseAiFindingPresentation({
      version: "1",
      blocks: [
        { type: "metric", label: "Latest day", value: 418.2, unit: "kWh" },
        {
          type: "comparison",
          title: "Current versus previous period",
          unit: "kWh",
          items: [
            { label: "Current", value: 2801 },
            { label: "Previous", value: 2450 },
          ],
        },
        {
          type: "callout",
          tone: "caution",
          text: "The increase is concentrated in closed hours.",
        },
      ],
    })).toEqual({
      version: "1",
      blocks: [
        { type: "metric", label: "Latest day", value: 418.2, unit: "kWh" },
        {
          type: "comparison",
          title: "Current versus previous period",
          unit: "kWh",
          items: [
            { label: "Current", value: 2801 },
            { label: "Previous", value: 2450 },
          ],
        },
        {
          type: "callout",
          tone: "caution",
          text: "The increase is concentrated in closed hours.",
        },
      ],
    });
  });

  it("omits invalid blocks locally instead of rejecting the Finding", () => {
    expect(parseAiFindingPresentation({
      version: "1",
      blocks: [
        { type: "metric", label: "Broken", value: "not-a-number" },
        {
          type: "ranking",
          items: [
            { label: "Centre E", value: 549.36 },
            { label: "Centre N", value: 544.05 },
          ],
        },
      ],
    })).toEqual({
      version: "1",
      blocks: [{
        type: "ranking",
        items: [
          { label: "Centre E", value: 549.36 },
          { label: "Centre N", value: 544.05 },
        ],
      }],
    });
  });

  it("allows the analyst to omit presentation when prose is clearer", () => {
    expect(parseAiFindingPresentation(undefined)).toBeNull();
    expect(parseAiFindingPresentation({ version: "1", blocks: [] })).toBeNull();
  });
});
