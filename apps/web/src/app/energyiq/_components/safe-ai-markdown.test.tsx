import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SafeAiMarkdown } from "./safe-ai-markdown";

describe("SafeAiMarkdown", () => {
  it("repairs harmless whitespace before a closing emphasis marker", () => {
    const markup = renderToStaticMarkup(
      <SafeAiMarkdown>_This is a naive baseline, not a validated forecast. _</SafeAiMarkdown>,
    );

    expect(markup).toContain("<em");
    expect(markup).toContain("This is a naive baseline, not a validated forecast.</em>");
    expect(markup).not.toContain("_This is a naive baseline");
  });
});
