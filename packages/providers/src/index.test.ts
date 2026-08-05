import { describe, expect, it } from "vitest";

import { createModelRuntimeProviderOptions } from "./index.js";

describe("createModelRuntimeProviderOptions", () => {
  it("requests low reasoning effort for an explicitly disabled openai-compatible model", () => {
    expect(createModelRuntimeProviderOptions({
      providerId: "openai-compatible",
      reasoningEnabled: false
    })).toEqual({
      openaiCompatible: { reasoningEffort: "low" }
    });
  });

  it("does not override an openai-compatible model when reasoning is unspecified", () => {
    expect(createModelRuntimeProviderOptions({
      providerId: "openai-compatible"
    })).toBeUndefined();
  });

  it("does not force high reasoning for an enabled openai-compatible model", () => {
    expect(createModelRuntimeProviderOptions({
      providerId: "openai-compatible",
      reasoningEnabled: true
    })).toBeUndefined();
  });

  it("preserves the existing Alibaba reasoning options", () => {
    expect(createModelRuntimeProviderOptions({
      providerId: "alibaba",
      reasoningEnabled: false
    })).toEqual({
      alibaba: { enableThinking: false }
    });
    expect(createModelRuntimeProviderOptions({
      providerId: "alibaba",
      reasoningEnabled: true
    })).toEqual({
      alibaba: { enableThinking: true, thinkingBudget: 2048 }
    });
  });

  it("preserves the existing DeepSeek reasoning options", () => {
    expect(createModelRuntimeProviderOptions({
      providerId: "deepseek",
      reasoningEnabled: false
    })).toEqual({
      deepseek: { thinking: { type: "disabled" } }
    });
    expect(createModelRuntimeProviderOptions({
      providerId: "deepseek",
      reasoningEnabled: true
    })).toEqual({
      deepseek: { thinking: { type: "enabled" } }
    });
  });
});
