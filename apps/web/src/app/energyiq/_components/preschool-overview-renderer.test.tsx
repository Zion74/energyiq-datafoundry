/** @vitest-environment happy-dom */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PreschoolOverviewRenderer } from "./preschool-overview-renderer";
import { preschoolGoldenSnapshot } from "./preschool-overview.test-fixture";

describe("PreschoolOverviewRenderer reading flow", () => {
  it("leads with takeaways and keeps secondary outcomes, forecast and technical evidence behind disclosure", () => {
    const markup = renderToStaticMarkup(
      <PreschoolOverviewRenderer state={{ status: "ready", snapshot: preschoolGoldenSnapshot() }} />,
    );

    expect(markup).toContain('id="preschool-decision-summary"');
    expect(markup).toContain("Takeaways and next decisions");
    expect(markup).toContain("Why it matters");
    expect(markup).toContain("Do next");
    expect(markup).toContain("Verify with");
    expect(markup).toContain("Expected outcome, evidence and limits");
    expect(markup).toContain("June planning baseline");
    expect(markup).toContain("not an AI forecast or customer bill");
    expect(markup).toContain("View normalisation and evidence");
    expect(markup.indexOf("Takeaways and next decisions")).toBeLessThan(markup.indexOf("Where energy goes"));
  });

  it("shows only the first five Centres by default and retains the remaining rows in disclosure", () => {
    const markup = renderToStaticMarkup(
      <PreschoolOverviewRenderer state={{ status: "ready", snapshot: preschoolGoldenSnapshot() }} />,
    );

    expect(markup).toContain("Top 5 of 30 Centres");
    expect(markup).toContain("View all 30 Centres and normalised metrics");
    expect(markup.match(/data-centre-row=/g)).toHaveLength(30);
  });
});
