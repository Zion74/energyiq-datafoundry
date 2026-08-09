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
    expect(markup.indexOf("Key findings · Sections 2–5")).toBeLessThan(markup.indexOf("Benchmark Analysis"));
    expect(markup.indexOf("Benchmark Analysis")).toBeLessThan(markup.indexOf("Standby energy waste"));
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

  it("renders action-first benchmark summaries before collapsed empirical detail", () => {
    const markup = renderToStaticMarkup(
      <PreschoolOverviewRenderer state={{ status: "ready", snapshot: preschoolGoldenSnapshot() }} />,
    );
    const container = document.createElement("div");
    container.innerHTML = markup;

    const benchmarkSection = container.querySelector<HTMLElement>("#preschool-benchmark-analysis")!;
    expect(benchmarkSection.querySelector("[data-benchmark-interpretation-status]")?.getAttribute("data-benchmark-interpretation-status")).toBe("unavailable");
    expect(benchmarkSection.textContent).toContain("No matching AI interpretation is available for this Snapshot.");
    expect(benchmarkSection.textContent).toContain("2.1 — Centre Efficiency Metrics");
    expect(benchmarkSection.querySelectorAll("[data-benchmark-priority-label]")).toHaveLength(3);
    expect([...benchmarkSection.querySelectorAll("[data-benchmark-priority-label]")].map((node) => node.textContent?.trim())).toEqual([
      "3. Centre J",
      "2. Centre M",
      "1. Centre G",
    ]);
    expect([...benchmarkSection.querySelectorAll("[data-benchmark-priority-centre]")].map((node) => node.getAttribute("data-benchmark-priority-centre"))).toEqual(["G", "M", "J"]);
    expect(benchmarkSection.textContent).toContain("Portfolio P75 review threshold");
    expect(benchmarkSection.querySelectorAll("[data-benchmark-summary]")).toHaveLength(2);
    expect(benchmarkSection.textContent).toContain("2.2 — EUI Benchmark");
    expect(benchmarkSection.textContent).toContain("2.3 — Per-pax Energy Benchmark");

    const euiSenior = benchmarkSection.querySelector<HTMLElement>('[data-benchmark-summary-cohort="eui:Senior Care Center"]')!;
    expect(euiSenior.textContent).toContain("6.76");
    expect(euiSenior.textContent).toContain("9.20");
    expect(euiSenior.textContent).toContain("Centre J12.90");
    const activePerPaxAbove = [...benchmarkSection.querySelectorAll('[data-benchmark-summary-cohort="per-pax:Active Aging Center"] [data-benchmark-above-p75]')]
      .map((node) => node.getAttribute("data-benchmark-above-p75"));
    expect(activePerPaxAbove).toEqual(["per-pax:M", "per-pax:G"]);

    const details = benchmarkSection.querySelectorAll<HTMLDetailsElement>("details[data-benchmark-detail]");
    expect(details).toHaveLength(2);
    expect([...details].every((detail) => !detail.open)).toBe(true);
    expect(benchmarkSection.querySelectorAll('[data-benchmark-ranking="eui"] [data-benchmark-ranking-row]')).toHaveLength(30);
    expect(benchmarkSection.querySelectorAll('[data-benchmark-ranking="per-pax"] [data-benchmark-ranking-row]')).toHaveLength(30);
    expect([...benchmarkSection.querySelectorAll('[data-benchmark-ranking="per-pax"] [data-benchmark-ranking-row]')].slice(0, 3)
      .map((node) => node.getAttribute("data-benchmark-ranking-row"))).toEqual(["per-pax:J", "per-pax:M", "per-pax:G"]);
    expect(benchmarkSection.textContent).not.toMatch(/bell curve/i);
  });

  it("only renders supplied benchmark interpretation when its identity matches the current Snapshot", () => {
    const snapshot = preschoolGoldenSnapshot();
    const staleMarkup = renderToStaticMarkup(
      <PreschoolOverviewRenderer
        state={{ status: "ready", snapshot }}
        benchmarkInterpretation={{
          status: "available",
          dataSnapshotId: snapshot.dataSnapshot.id,
          projectReleaseId: snapshot.projectRelease.id,
          period: { start: "2026-05-10T16:00:00.000Z", endExclusive: "2026-06-07T16:00:00.000Z" },
          headline: "STALE_BENCHMARK_HEADLINE",
          summary: "STALE_BENCHMARK_SUMMARY",
        }}
      />,
    );
    expect(staleMarkup).not.toContain("STALE_BENCHMARK_HEADLINE");
    expect(staleMarkup).not.toContain("STALE_BENCHMARK_SUMMARY");
    expect(staleMarkup).toContain('data-benchmark-interpretation-status="unavailable"');

    const pendingMarkup = renderToStaticMarkup(
      <PreschoolOverviewRenderer
        state={{ status: "ready", snapshot }}
        benchmarkInterpretation={{
          status: "pending",
          dataSnapshotId: snapshot.dataSnapshot.id,
          projectReleaseId: snapshot.projectRelease.id,
          period: snapshot.context.primaryPeriod,
        }}
      />,
    );
    expect(pendingMarkup).toContain('data-benchmark-interpretation-status="pending"');
    expect(pendingMarkup).toContain("AI interpretation pending for this Snapshot.");

    const matchingMarkup = renderToStaticMarkup(
      <PreschoolOverviewRenderer
        state={{ status: "ready", snapshot }}
        benchmarkInterpretation={{
          status: "available",
          dataSnapshotId: snapshot.dataSnapshot.id,
          projectReleaseId: snapshot.projectRelease.id,
          period: snapshot.context.primaryPeriod,
          headline: "MATCHING_BENCHMARK_HEADLINE",
          summary: "MATCHING_BENCHMARK_SUMMARY",
          actions: ["MATCHING_BENCHMARK_ACTION"],
        }}
      />,
    );
    expect(matchingMarkup).toContain('data-benchmark-interpretation-status="available"');
    expect(matchingMarkup).toContain("MATCHING_BENCHMARK_HEADLINE");
    expect(matchingMarkup).toContain("MATCHING_BENCHMARK_SUMMARY");
    expect(matchingMarkup).toContain("MATCHING_BENCHMARK_ACTION");
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
