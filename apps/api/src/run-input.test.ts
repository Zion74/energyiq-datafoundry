import type { RunAgentInput } from "@ag-ui/client";
import { describe, expect, it } from "vitest";

import { extractEffectiveRunConfig, extractTrustedEnergyTextIntent } from "./run-input.js";

describe("extractEffectiveRunConfig protocol selection", () => {
  it("parses an explicit protocol identity from run_config", () => {
    const config = extractEffectiveRunConfig(createInput({
      protocol: { id: "data-analysis", version: "1" }
    }));

    expect(config.protocol).toEqual({ protocolId: "data-analysis", protocolVersion: "1" });
  });

  it("rejects a partially specified explicit protocol", () => {
    expect(() => extractEffectiveRunConfig(createInput({
      protocol: { id: "data-analysis" }
    }))).toThrow("INVALID_PROTOCOL_SELECTION");
  });
});

describe("trusted Energy text run input", () => {
  it("accepts only an allowlisted intent from the untrusted host context", () => {
    const valid = createInput({});
    valid.forwardedProps = {
      externalContext: {
        source: "energyiq",
        projectId: "ngee-ann-polytechnic",
        trustedTextIntent: "period-usage-vs-previous"
      }
    };
    expect(extractTrustedEnergyTextIntent(valid)).toBe("period-usage-vs-previous");

    (valid.forwardedProps as Record<string, unknown>).externalContext = {
      source: "energyiq", projectId: "ngee-ann-polytechnic", trustedTextIntent: "free-form-sql"
    };
    expect(() => extractTrustedEnergyTextIntent(valid)).toThrow("TRUSTED_ENERGY_TEXT_INTENT_INVALID:free-form-sql");
  });
});

const createInput = (runConfig: Record<string, unknown>): RunAgentInput => ({
  context: [],
  forwardedProps: { run_config: runConfig },
  messages: [],
  runId: "run-1",
  state: {},
  threadId: "thread-1",
  tools: []
});
