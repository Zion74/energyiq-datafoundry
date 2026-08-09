/** @vitest-environment happy-dom */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PRESCHOOL_OVERVIEW_SECTIONS, PreschoolOverviewRenderer } from "./preschool-overview-renderer";
import { preschoolGoldenSnapshot } from "./preschool-overview.test-fixture";

describe("PreschoolOverviewRenderer reading flow", () => {
  it("renders the Charles-aligned five-section spine and keeps Key findings before AI", () => {
    const markup = renderToStaticMarkup(
      <PreschoolOverviewRenderer state={{ status: "ready", snapshot: preschoolGoldenSnapshot() }} />,
    );

    expect(PRESCHOOL_OVERVIEW_SECTIONS).toEqual([
      { id: "preschool-overall-summary", label: "1 · Overview" },
      { id: "preschool-benchmark-analysis", label: "2 · Benchmarks" },
      { id: "preschool-standby-wastage", label: "3 · Standby wastage" },
      { id: "preschool-operating-hours", label: "4 · Operating hours" },
      { id: "preschool-june-planning", label: "5 · June planning" },
    ]);
    expect(markup.match(/data-overview-section=/g)).toHaveLength(5);
    expect(markup).toContain("Overall consumption summary");
    expect(markup.match(/data-overall-summary-metric=/g)).toHaveLength(3);
    expect(markup).toContain("Total centres");
    expect(markup).toContain("Total energy · May 2026");
    expect(markup).toContain("Estimated total cost · May 2026");
    expect(markup).toContain("Energy &amp; cost by centre type");
    expect(markup).toContain(">Outlets</th>");
    expect(markup).toContain("Senior Care Center");
    expect(markup).toContain("11,637.00 kWh");
    expect(markup).toContain("Portfolio total");
    expect(markup).toContain("24,921.81 kWh");
    expect(markup).toContain("100.0%");
    expect(markup).toContain("S$0.2727/kWh before GST");
    expect(markup).not.toContain("Published Portfolio total for this Snapshot.");
    expect(markup).not.toContain("Average across the selected reporting window.");
    expect(markup).not.toContain("Centre rows returned by the authoritative Project analysis.");
    expect(markup).toContain('id="preschool-decision-summary"');
    expect(markup).toContain("Key findings · Sections 2–5");
    expect(markup.match(/data-key-finding-target=/g)).toHaveLength(4);
    expect(markup).toContain('href="#preschool-benchmark-analysis"');
    expect(markup).toContain('href="#preschool-standby-wastage"');
    expect(markup).toContain('href="#preschool-operating-hours"');
    expect(markup).toContain('href="#preschool-june-planning"');
    expect(markup).toContain("Energy used after closing");
    expect(markup).toContain("Centres <strong class=\"font-semibold text-foreground\">L · E · N</strong>");
    expect(markup).toContain("High for both floor area and headcount");
    expect(markup).toContain("Unusual peaks during opening hours");
    expect(markup).toContain("A · B · C · D · E · +9 more");
    expect(markup).not.toContain("A · B · C · D · E · F · G · H · I · J · K · L · M · N");
    expect(markup).toContain("Estimated June energy");
    expect(markup).toContain("24,348 kWh");
    expect(markup).toContain("Limitation and evidence");
    expect(markup).not.toContain("What to do next");
    expect(markup).toContain("June planning / Forecast");
    expect(markup).toContain("not an AI forecast or customer bill");
    expect(markup).toContain("View normalisation and evidence");
    const sectionPositions = PRESCHOOL_OVERVIEW_SECTIONS.map((section) => markup.indexOf(`id="${section.id}"`));
    expect(sectionPositions.every((position) => position >= 0)).toBe(true);
    expect(sectionPositions).toEqual([...sectionPositions].sort((left, right) => left - right));
    expect(markup.indexOf("Overall consumption summary")).toBeLessThan(markup.indexOf("Key findings · Sections 2–5"));
    expect(markup.indexOf("Key findings · Sections 2–5")).toBeLessThan(markup.indexOf('id="preschool-ai-analysis"'));
    expect(markup.indexOf("Key findings · Sections 2–5")).toBeLessThan(markup.indexOf("Benchmark analysis"));
    expect(markup.indexOf("Benchmark analysis")).toBeLessThan(markup.indexOf("Standby energy waste"));
    expect(markup.indexOf("Standby energy waste")).toBeLessThan(markup.indexOf("Operating hours analysis"));
    expect(markup.indexOf("Operating hours analysis")).toBeLessThan(markup.indexOf("June planning / Forecast"));
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
