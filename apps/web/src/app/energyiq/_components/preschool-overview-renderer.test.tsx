/** @vitest-environment happy-dom */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PreschoolOverviewRenderer } from "./preschool-overview-renderer";
import { preschoolGoldenSnapshot } from "./preschool-overview.test-fixture";

describe("PreschoolOverviewRenderer reading flow", () => {
  it("leads with a three-number overall summary, Centre Type breakdown and plain-language next steps", () => {
    const markup = renderToStaticMarkup(
      <PreschoolOverviewRenderer state={{ status: "ready", snapshot: preschoolGoldenSnapshot() }} />,
    );

    expect(markup).toContain("Overall consumption summary");
    expect(markup.match(/data-overall-summary-metric=/g)).toHaveLength(3);
    expect(markup).toContain("Total centres");
    expect(markup).toContain("Total energy · May 2026");
    expect(markup).toContain("Estimated total cost · May 2026");
    expect(markup).toContain("Energy &amp; cost by centre type");
    expect(markup).toContain("Senior Care Center");
    expect(markup).toContain("11,637.00 kWh");
    expect(markup).toContain("S$0.2727/kWh before GST");
    expect(markup).not.toContain("Published Portfolio total for this Snapshot.");
    expect(markup).not.toContain("Average across the selected reporting window.");
    expect(markup).not.toContain("Centre rows returned by the authoritative Project analysis.");
    expect(markup).toContain('id="preschool-decision-summary"');
    expect(markup).toContain("Key findings and next steps");
    expect(markup).toContain("Centres L, E and N should be checked first for energy use after closing.");
    expect(markup).toContain("Centres G, M and J use more energy than expected for both their floor area and number of people.");
    expect(markup).toContain("14 centres had unusual energy peaks during opening hours.");
    expect(markup).toContain("Why it matters");
    expect(markup).toContain("What to do next");
    expect(markup).toContain("How to check the result");
    expect(markup).toContain("More detail and evidence");
    expect(markup).toContain("June planning baseline");
    expect(markup).toContain("not an AI forecast or customer bill");
    expect(markup).toContain("View normalisation and evidence");
    expect(markup.indexOf("Overall consumption summary")).toBeLessThan(markup.indexOf("Key findings and next steps"));
    expect(markup.indexOf("Key findings and next steps")).toBeLessThan(markup.indexOf("Where energy goes"));
  });

  it("shows only the first five Centres by default and retains the remaining rows in disclosure", () => {
    const markup = renderToStaticMarkup(
      <PreschoolOverviewRenderer state={{ status: "ready", snapshot: preschoolGoldenSnapshot() }} />,
    );

    expect(markup).toContain("Top 5 of 30 Centres");
    expect(markup).toContain("View all 30 Centres and normalised metrics");
    expect(markup.match(/data-centre-row=/g)).toHaveLength(30);
  });

  it("links a visible Centre to its exact Explorer Scope without dropping Snapshot pins", () => {
    const snapshot = preschoolGoldenSnapshot();
    const projectExplorerHref = [
      "/energyiq/explorer?projectId=preschool-demo",
      "scopeId=project",
      "resource=electricity",
      "period=Custom",
      "from=2026-05-01",
      "to=2026-05-31",
      `dataSnapshotId=${encodeURIComponent(snapshot.context.dataSnapshotId)}`,
      `projectReleaseId=${encodeURIComponent(snapshot.projectRelease.id)}`,
    ].join("&");
    const markup = renderToStaticMarkup(
      <PreschoolOverviewRenderer
        state={{ status: "ready", snapshot }}
        projectExplorerHref={projectExplorerHref}
      />,
    );

    const container = document.createElement("div");
    container.innerHTML = markup;
    const centreLink = container.querySelector<HTMLAnchorElement>("[data-centre-explorer-link]");
    expect(centreLink).not.toBeNull();
    const linkedScopeId = centreLink!.dataset.centreExplorerLink;
    expect(linkedScopeId).toBeTruthy();
    const centreUrl = new URL(centreLink!.href);
    expect(Object.fromEntries(centreUrl.searchParams)).toMatchObject({
      projectId: "preschool-demo",
      scopeId: linkedScopeId,
      resource: "electricity",
      period: "Custom",
      from: "2026-05-01",
      to: "2026-05-31",
      dataSnapshotId: snapshot.context.dataSnapshotId,
      projectReleaseId: snapshot.projectRelease.id,
    });
  });
});
