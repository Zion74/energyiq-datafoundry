import type { RunAgentInput } from "@ag-ui/client";
import { describe, expect, it } from "vitest";

import {
  extractEffectiveRunConfig,
  extractEnergyQueryContextRequest,
  extractTrustedEnergyTextIntent,
} from "./run-input.js";

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
  it("preserves Previous week for server-authoritative Energy context resolution", () => {
    const input = createInput({});
    input.forwardedProps = {
      externalContext: {
        source: "energyiq",
        projectId: "ngee-ann-polytechnic",
        scopeId: "project",
        resource: "electricity",
        period: "Previous week",
      },
    };

    expect(extractEnergyQueryContextRequest(input)).toEqual({
      projectId: "ngee-ann-polytechnic",
      scopeId: "project",
      resource: "electricity",
      period: "Previous week",
    });
  });

  it("preserves Previous month for server-authoritative Energy context resolution", () => {
    const input = createInput({});
    input.forwardedProps = {
      externalContext: {
        source: "energyiq",
        projectId: "ngee-ann-polytechnic",
        scopeId: "project",
        resource: "electricity",
        period: "Previous month",
      },
    };

    expect(extractEnergyQueryContextRequest(input)).toEqual({
      projectId: "ngee-ann-polytechnic",
      scopeId: "project",
      resource: "electricity",
      period: "Previous month",
    });
  });

  it("preserves optional expected Snapshot and Project Release pins for server-authoritative comparison", () => {
    const input = createInput({});
    input.forwardedProps = {
      externalContext: {
        source: "energyiq",
        projectId: "ngee-ann-polytechnic",
        scopeId: "project",
        resource: "electricity",
        period: "Last 7 days",
        expectedDataSnapshotId: "snapshot-from-overview",
        expectedProjectReleaseId: "release-from-overview",
      },
    };

    expect(extractEnergyQueryContextRequest(input)).toEqual({
      projectId: "ngee-ann-polytechnic",
      scopeId: "project",
      resource: "electricity",
      period: "Last 7 days",
      expectedDataSnapshotId: "snapshot-from-overview",
      expectedProjectReleaseId: "release-from-overview",
    });
  });

  it("rejects an explicitly unknown Period instead of silently using Last 30 days", () => {
    const input = createInput({});
    input.forwardedProps = {
      externalContext: {
        source: "energyiq",
        projectId: "ngee-ann-polytechnic",
        scopeId: "project",
        resource: "electricity",
        period: "Previous fortnight",
      },
    };

    expect(() => extractEnergyQueryContextRequest(input)).toThrow("ENERGYIQ_PERIOD_INVALID");
  });

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
