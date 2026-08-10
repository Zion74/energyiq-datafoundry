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
    expect(markup.match(/Of energy in the current accepted window/g)).toHaveLength(2);
    expect(markup).not.toContain("Of accepted May Portfolio energy");
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
    expect(markup).toContain("June 2026 Forecast");
    expect(markup).toContain("Estimated Energy");
    expect(markup).toContain("Estimated Cost");
    expect(markup).toContain("Consumed So Far");
    expect(markup).toContain("Pace vs Estimate");
    expect(markup).toContain("Method, tariff and evidence");
    expect(markup).toContain('data-forecast-status="waiting"');
    expect(markup).toContain("Awaiting June actual");
    expect(markup).toContain("24,348 kWh");
    expect(markup).toContain("S$6,640");
    expect(markup).toContain("Actual not available yet. The Estimate remains visible; no June Actual line is invented.");
    expect(markup).toContain("Centre A");
    expect(markup).toContain('data-series="estimate"');
    expect(markup).toContain('d="" fill="none" stroke="currentColor" class="text-foreground"');
    expect(markup).toContain("View normalisation and evidence");
    const sectionPositions = PRESCHOOL_OVERVIEW_SECTIONS.map((section) => markup.indexOf(`id="${section.id}"`));
    expect(sectionPositions.every((position) => position >= 0)).toBe(true);
    expect(sectionPositions).toEqual([...sectionPositions].sort((left, right) => left - right));
    expect(markup.indexOf("Overall consumption summary")).toBeLessThan(markup.indexOf("Key findings · Sections 2–5"));
    expect(markup.indexOf("Key findings · Sections 2–5")).toBeLessThan(markup.indexOf('id="preschool-ai-analysis"'));
    expect(markup.indexOf("Key findings · Sections 2–5")).toBeLessThan(markup.indexOf("Benchmark Analysis"));
    expect(markup.indexOf("Benchmark Analysis")).toBeLessThan(markup.indexOf("Standby Energy Wastage — Post Operating Hours"));
    expect(markup.indexOf("Standby Energy Wastage — Post Operating Hours")).toBeLessThan(markup.indexOf("Operating Hours Analysis"));
    expect(markup.indexOf("Operating Hours Analysis")).toBeLessThan(markup.indexOf("June 2026 Forecast"));
  });

  it.each([
    { status: "waiting" as const, completeDays: 0, actualKwh: null, pacePct: null, label: "Awaiting June actual" },
    { status: "partial" as const, completeDays: 7, actualKwh: 1_400, pacePct: 24.64, label: "Partial June actual" },
    { status: "complete" as const, completeDays: 30, actualKwh: 25_000, pacePct: 102.68, label: "Above plan" },
  ])("renders the $status Forecast path with separately pinned Plan and Actual Evidence", ({ status, completeDays, actualKwh, pacePct, label }) => {
    const snapshot = preschoolGoldenSnapshot();
    attachForecastLifecycle(snapshot, { status, completeDays, actualKwh, pacePct });

    const markup = renderToStaticMarkup(
      <PreschoolOverviewRenderer state={{ status: "ready", snapshot }} />,
    );
    const container = document.createElement("div");
    container.innerHTML = markup;
    const forecastSection = container.querySelector<HTMLElement>("#preschool-june-planning")!;
    const forecastMarkup = forecastSection.innerHTML;

    expect(forecastMarkup).toContain(label);
    expect(forecastMarkup.match(/data-forecast-kpi=/g)).toHaveLength(4);
    expect(forecastMarkup).toContain("Estimate vs Actual");
    expect(forecastMarkup).toContain("Daily");
    expect(forecastMarkup).toContain("Weekly");
    expect(forecastMarkup).toContain("Monthly");
    expect(forecastMarkup).toContain("Portfolio");
    expect(forecastMarkup).toContain("Centre A");
    expect(forecastMarkup).toContain('data-series="estimate"');
    expect(forecastMarkup).toContain('stroke-dasharray="8 7"');
    expect(forecastMarkup).toContain('data-series="actual"');
    expect(forecastMarkup).toContain("Saved saved-a · Snapshot snapshot-a · daily_totals_v1");
    expect(forecastMarkup).toContain("Current Snapshot snapshot-b · daily_totals_v1");
    expect(forecastMarkup.indexOf("Estimated Energy")).toBeLessThan(forecastMarkup.indexOf("Estimate vs Actual"));
    expect(forecastMarkup.indexOf("Estimate vs Actual")).toBeLessThan(forecastMarkup.indexOf("Method, tariff and evidence"));
    expect(forecastMarkup.indexOf("Method, tariff and evidence")).toBeLessThan(forecastMarkup.indexOf("Four complete May weeks"));
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
    expect(benchmarkSection.querySelector("[data-benchmark-interpretation-status]")?.getAttribute("data-benchmark-interpretation-status")).toBe("pending");
    expect(benchmarkSection.textContent).toContain("AI interpretation pending for this Snapshot.");
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

    for (const summary of benchmarkSection.querySelectorAll<HTMLElement>("[data-benchmark-summary]")) {
      const header = summary.firstElementChild as HTMLElement;
      expect(header.classList.contains("min-w-[760px]")).toBe(true);
      expect(header.classList.contains("min-w-[900px]")).toBe(false);
      for (const column of ["outlets", "p50", "p75"]) {
        expect(summary.querySelector(`[data-benchmark-summary-header="${column}"]`)?.classList.contains("text-right")).toBe(false);
        expect([...summary.querySelectorAll(`[data-benchmark-summary-value="${column}"]`)]
          .every((value) => !value.classList.contains("text-right"))).toBe(true);
      }
    }

    const euiSenior = benchmarkSection.querySelector<HTMLElement>('[data-benchmark-summary-cohort="eui:Senior Care Center"]')!;
    expect(euiSenior.textContent).toContain("6.76");
    expect(euiSenior.textContent).toContain("9.20");
    expect(euiSenior.textContent).toContain("Centre J12.90");
    const activePerPaxAbove = [...benchmarkSection.querySelectorAll('[data-benchmark-summary-cohort="per-pax:Active Aging Center"] [data-benchmark-above-p75]')]
      .map((node) => node.getAttribute("data-benchmark-above-p75"));
    expect(activePerPaxAbove).toEqual(["per-pax:M", "per-pax:G"]);

    const details = benchmarkSection.querySelectorAll<HTMLDetailsElement>("details[data-benchmark-detail]");
    expect(details).toHaveLength(6);
    expect([...details].map((detail) => detail.dataset.benchmarkDetail)).toEqual([
      "eui:Senior Care Center",
      "eui:Active Aging Center",
      "eui:Preschool",
      "per-pax:Senior Care Center",
      "per-pax:Active Aging Center",
      "per-pax:Preschool",
    ]);
    expect([...details].every((detail) => !detail.open)).toBe(true);
    expect([...details].every((detail) => detail.querySelector<HTMLElement>(":scope > summary")?.tabIndex === 0)).toBe(true);
    expect([...details].every((detail) => detail.querySelector(":scope > summary")?.getAttribute("aria-label")?.includes("View detail."))).toBe(true);
    [...details].forEach((detail, index) => {
      detail.open = true;
      expect(detail.open).toBe(true);
      expect([...details].filter((candidate) => candidate.open).map((candidate) => candidate.dataset.benchmarkDetail)).toEqual([
        details[index]!.dataset.benchmarkDetail,
      ]);
      detail.open = false;
    });
    expect(benchmarkSection.querySelectorAll('[data-benchmark-ranking^="eui:"] [data-benchmark-ranking-row]')).toHaveLength(30);
    expect(benchmarkSection.querySelectorAll('[data-benchmark-ranking^="per-pax:"] [data-benchmark-ranking-row]')).toHaveLength(30);
    const rankingScrollRegions = benchmarkSection.querySelectorAll<HTMLElement>("[data-benchmark-ranking-scroll]");
    expect(rankingScrollRegions).toHaveLength(6);
    expect([...rankingScrollRegions].every((region) => (
      region.getAttribute("role") === "region"
      && region.tabIndex === 0
      && region.getAttribute("aria-label")?.includes("Centre ranking, all")
      && region.classList.contains("max-h-64")
      && region.classList.contains("overflow-y-auto")
      && region.classList.contains("touch-pan-y")
    ))).toBe(true);
    expect(benchmarkSection.querySelectorAll('[data-benchmark-ranking="eui:Senior Care Center"] [data-benchmark-ranking-row]')).toHaveLength(14);
    expect(benchmarkSection.querySelectorAll('[data-benchmark-ranking="eui:Active Aging Center"] [data-benchmark-ranking-row]')).toHaveLength(8);
    expect(benchmarkSection.querySelectorAll('[data-benchmark-ranking="per-pax:Preschool"] [data-benchmark-ranking-row]')).toHaveLength(8);
    expect([...benchmarkSection.querySelectorAll('[data-benchmark-ranking="per-pax:Active Aging Center"] [data-benchmark-ranking-row]')].slice(0, 2)
      .map((node) => node.getAttribute("data-benchmark-ranking-row"))).toEqual([
      "per-pax:Active Aging Center:M",
      "per-pax:Active Aging Center:G",
    ]);
    expect(benchmarkSection.querySelector('[data-benchmark-detail="eui:Senior Care Center"]')?.textContent).not.toContain("Active Aging Center · n=");
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

  it("renders the Standby decision path from five KPIs to closed-state Appliance evidence, Centre events and review priority", () => {
    const markup = renderToStaticMarkup(
      <PreschoolOverviewRenderer state={{ status: "ready", snapshot: preschoolGoldenSnapshot() }} />,
    );
    const container = document.createElement("div");
    container.innerHTML = markup;
    const standbySection = container.querySelector<HTMLElement>("#preschool-standby-wastage")!;

    expect(standbySection.querySelector("[data-standby-interpretation-status]")?.getAttribute("data-standby-interpretation-status")).toBe("pending");
    expect(standbySection.textContent).toContain("AI interpretation pending for this Snapshot.");
    expect(standbySection.querySelectorAll("[data-standby-kpis] > div")).toHaveLength(5);
    expect(standbySection.textContent).toContain("3,103.78 kWh");
    expect(standbySection.textContent).toContain("S$846.40");
    expect(standbySection.textContent).toContain("Before GST reference · not a bill");
    expect(standbySection.textContent).toContain("12.5%");
    expect(standbySection.textContent).toContain("Unusual closed-hour Spikes7");
    expect(standbySection.textContent).toContain("Centres to review3");

    expect(standbySection.textContent).toContain("3.1 Standby Energy by Appliance");
    const standbySegments = standbySection.querySelectorAll<SVGElement>("[data-standby-appliance-segment]");
    const standbyApplianceRows = standbySection.querySelectorAll<HTMLElement>("[data-standby-appliance]");
    expect(standbySegments).toHaveLength(9);
    expect([...standbySegments].map((node) => node.getAttribute("data-standby-appliance-segment")))
      .toEqual([...standbyApplianceRows].map((node) => node.getAttribute("data-standby-appliance")));
    expect([...standbySegments].every((node) => (
      node.tabIndex === 0
      && node.getAttribute("aria-label")?.includes("kWh")
      && node.getAttribute("aria-label")?.includes("%")
    ))).toBe(true);
    expect(standbySection.querySelectorAll('[data-operating-state-appliance-tooltip^="standby:"]')).toHaveLength(9);
    expect(standbySection.querySelectorAll('[data-operating-state-appliance-legend^="standby:"]')).toHaveLength(0);
    const standbyComposition = standbySection.querySelector<HTMLElement>("[data-standby-appliance-composition]")!;
    expect(standbyComposition.innerHTML.indexOf('data-operating-state-appliance-total="standby"'))
      .toBeLessThan(standbyComposition.innerHTML.indexOf('data-operating-state-appliance-tooltip="standby:Plug Load3"'));
    expect(standbyComposition.querySelector('[data-operating-state-appliance-tooltip="standby:Plug Load3"] rect')?.getAttribute("x")).toBe("80");
    expect(standbyComposition.querySelector('[data-operating-state-appliance-tooltip="standby:Plug Load3"] rect')?.getAttribute("width")).toBe("140");
    expect(standbySection.querySelectorAll("[data-standby-appliance-group]")).toHaveLength(0);
    expect(standbySection.querySelectorAll("[data-standby-appliance]")).toHaveLength(9);
    expect(standbySection.querySelector("[data-standby-appliance]")?.getAttribute("data-standby-appliance")).toBe("Plug Load3");
    expect([...standbyApplianceRows].map((node) => node.getAttribute("data-appliance-series-index"))).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    expect(standbySection.textContent).toContain("40.0%");
    expect(standbySection.textContent).not.toContain("Plug Load3 · Living Area Plug Load · Kitchen Plug Load");

    expect(standbySection.textContent).toContain("3.2 Non-operating Hours Spike Analysis");
    const standbySpikeTable = standbySection.querySelector<HTMLElement>("[data-standby-spike-table]")!;
    expect(standbySpikeTable.classList.contains("overflow-x-auto")).toBe(false);
    expect(standbySpikeTable.classList.contains("overflow-hidden")).toBe(true);
    expect(standbySpikeTable.outerHTML).not.toContain("min-w-[1060px]");
    const centreDetails = standbySection.querySelectorAll<HTMLDetailsElement>("details[data-standby-spike-centre]");
    expect([...centreDetails].map((detail) => detail.dataset.standbySpikeCentre)).toEqual(["L", "E", "N"]);
    expect([...centreDetails].map((detail) => detail.querySelectorAll("[data-standby-spike-event]").length)).toEqual([4, 2, 1]);
    expect([...centreDetails].every((detail) => detail.querySelector(":scope > summary")?.tabIndex === 0)).toBe(true);
    expect([...centreDetails].every((detail) => detail.querySelector(":scope > summary")?.classList.contains("grid-cols-2"))).toBe(true);
    expect([...standbySection.querySelectorAll<HTMLElement>("[data-standby-spike-event]")].every((event) => event.classList.contains("grid-cols-2"))).toBe(true);
    expect(centreDetails[0]?.querySelectorAll('[data-standby-spike-event^="E:"]')).toHaveLength(0);
    centreDetails[0]!.open = true;
    expect(centreDetails[0]!.open).toBe(true);
    centreDetails[0]!.open = false;

    expect(standbySection.textContent).toContain("3.3 After-hours Review Priority");
    expect([...standbySection.querySelectorAll("[data-review-priority-centre]")].map((node) => node.getAttribute("data-review-priority-centre")))
      .toEqual(["L", "E", "N"]);
    expect([...standbySection.querySelectorAll<HTMLElement>("[data-review-priority-centre]")].every((row) => (
      row.classList.contains("sm:grid-cols-2") && [...row.classList].some((className) => className.startsWith("xl:grid-cols-["))
    ))).toBe(true);
    expect(standbySection.textContent).toContain("confirm the Calendar, operating SOP and equipment state with the Centre");
    expect(standbySection.textContent).toContain("does not measure SOP compliance");
    expect(standbySection.textContent).not.toContain("SOP Compliance Score");
    expect(standbySection.textContent).toContain("not confirmed root causes");
    expect(standbySection.textContent).toContain("not guaranteed savings");
  });

  it("only renders Standby interpretation when Snapshot, Release and period identities all match", () => {
    const snapshot = preschoolGoldenSnapshot();
    const staleMarkup = renderToStaticMarkup(
      <PreschoolOverviewRenderer
        state={{ status: "ready", snapshot }}
        standbyInterpretation={{
          status: "available",
          dataSnapshotId: snapshot.dataSnapshot.id,
          projectReleaseId: snapshot.projectRelease.id,
          period: { start: "2026-05-10T16:00:00.000Z", endExclusive: "2026-06-07T16:00:00.000Z" },
          headline: "STALE_STANDBY_HEADLINE",
          summary: "STALE_STANDBY_SUMMARY",
        }}
      />,
    );
    expect(staleMarkup).not.toContain("STALE_STANDBY_HEADLINE");
    expect(staleMarkup).not.toContain("STALE_STANDBY_SUMMARY");
    expect(staleMarkup).toContain('data-standby-interpretation-status="unavailable"');

    const pendingMarkup = renderToStaticMarkup(
      <PreschoolOverviewRenderer
        state={{ status: "ready", snapshot }}
        standbyInterpretation={{
          status: "pending",
          dataSnapshotId: snapshot.dataSnapshot.id,
          projectReleaseId: snapshot.projectRelease.id,
          period: snapshot.context.primaryPeriod,
        }}
      />,
    );
    expect(pendingMarkup).toContain('data-standby-interpretation-status="pending"');

    const matchingMarkup = renderToStaticMarkup(
      <PreschoolOverviewRenderer
        state={{ status: "ready", snapshot }}
        standbyInterpretation={{
          status: "available",
          dataSnapshotId: snapshot.dataSnapshot.id,
          projectReleaseId: snapshot.projectRelease.id,
          period: snapshot.context.primaryPeriod,
          headline: "MATCHING_STANDBY_HEADLINE",
          summary: "MATCHING_STANDBY_SUMMARY",
          actions: ["MATCHING_STANDBY_ACTION"],
        }}
      />,
    );
    expect(matchingMarkup).toContain('data-standby-interpretation-status="available"');
    expect(matchingMarkup).toContain("MATCHING_STANDBY_HEADLINE");
    expect(matchingMarkup).toContain("MATCHING_STANDBY_SUMMARY");
    expect(matchingMarkup).toContain("MATCHING_STANDBY_ACTION");
  });

  it("renders the Operating-hours decision path from five KPIs to state-specific Appliance and complete Centre evidence", () => {
    const markup = renderToStaticMarkup(
      <PreschoolOverviewRenderer state={{ status: "ready", snapshot: preschoolGoldenSnapshot() }} />,
    );
    const container = document.createElement("div");
    container.innerHTML = markup;
    const operatingSection = container.querySelector<HTMLElement>("#preschool-operating-hours")!;

    expect(operatingSection.querySelector("[data-operating-interpretation-status]")?.getAttribute("data-operating-interpretation-status")).toBe("unavailable");
    expect(operatingSection.textContent).toContain("No matching AI interpretation is available for this Snapshot.");
    expect(operatingSection.querySelectorAll("[data-operating-kpis] > div")).toHaveLength(5);
    expect(operatingSection.textContent).toContain("21,818.03 kWh");
    expect(operatingSection.textContent).toContain("S$5,949.78");
    expect(operatingSection.textContent).toContain("Before GST reference · not a bill");
    expect(operatingSection.textContent).toContain("87.5%");
    expect(operatingSection.textContent).toContain("Unusual operating-hour Spikes21");
    expect(operatingSection.textContent).toContain("Centres to review14");

    expect(operatingSection.textContent).toContain("4.1 Operating Energy by Appliance");
    const operatingSegments = operatingSection.querySelectorAll<SVGElement>("[data-operating-appliance-segment]");
    const operatingApplianceRows = operatingSection.querySelectorAll<HTMLElement>("[data-operating-appliance]");
    expect(operatingSegments).toHaveLength(9);
    expect([...operatingSegments].map((node) => node.getAttribute("data-operating-appliance-segment")))
      .toEqual([...operatingApplianceRows].map((node) => node.getAttribute("data-operating-appliance")));
    expect([...operatingSegments].every((node) => node.tabIndex === 0 && node.getAttribute("aria-label")?.includes("kWh"))).toBe(true);
    expect(operatingSection.querySelectorAll('[data-operating-state-appliance-tooltip^="operating:"]')).toHaveLength(9);
    expect(operatingSection.querySelectorAll('[data-operating-state-appliance-legend^="operating:"]')).toHaveLength(0);
    const operatingComposition = operatingSection.querySelector<HTMLElement>("[data-operating-appliance-composition]")!;
    expect(operatingComposition.innerHTML.indexOf('data-operating-state-appliance-total="operating"'))
      .toBeLessThan(operatingComposition.innerHTML.indexOf('data-operating-state-appliance-tooltip="operating:Plug Load3"'));
    expect(operatingSection.querySelectorAll("[data-operating-appliance-group]")).toHaveLength(0);
    expect(operatingSection.querySelectorAll("[data-operating-appliance]")).toHaveLength(9);
    expect(operatingSection.querySelector("[data-operating-appliance]")?.getAttribute("data-operating-appliance")).toBe("Plug Load3");
    expect([...operatingApplianceRows].map((node) => node.getAttribute("data-appliance-series-index"))).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);

    expect(operatingSection.textContent).toContain("4.2 Operating Hours Spike Analysis");
    const operatingSpikeTable = operatingSection.querySelector<HTMLElement>("[data-operating-spike-table]")!;
    expect(operatingSpikeTable.classList.contains("overflow-x-auto")).toBe(false);
    expect(operatingSpikeTable.classList.contains("overflow-hidden")).toBe(true);
    expect(operatingSpikeTable.outerHTML).not.toContain("min-w-[1060px]");
    const centreDetails = operatingSection.querySelectorAll<HTMLDetailsElement>("details[data-operating-spike-centre]");
    expect([...centreDetails].map((detail) => detail.dataset.operatingSpikeCentre)).toEqual([
      "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N",
    ]);
    expect([...centreDetails].map((detail) => detail.querySelectorAll("[data-operating-spike-event]").length))
      .toEqual([8, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect([...centreDetails].every((detail) => detail.querySelector(":scope > summary")?.tabIndex === 0)).toBe(true);
    expect([...centreDetails].every((detail) => detail.querySelector(":scope > summary")?.classList.contains("grid-cols-2"))).toBe(true);
    expect([...operatingSection.querySelectorAll<HTMLElement>("[data-operating-spike-event]")].every((event) => event.classList.contains("grid-cols-2"))).toBe(true);
    expect(centreDetails[0]?.querySelectorAll('[data-operating-spike-event^="B:"]')).toHaveLength(0);
    centreDetails[0]!.open = true;
    expect(centreDetails[0]!.open).toBe(true);
    centreDetails[0]!.open = false;

    expect(operatingSection.textContent).toMatch(/observed leading contributor/i);
    expect(operatingSection.textContent).not.toMatch(/root cause\s*:/i);
    expect(operatingSection.textContent).not.toContain("Potential Saving");
    const supportingContext = operatingSection.querySelector<HTMLDetailsElement>("[data-all-hours-appliance-context]");
    expect(supportingContext).not.toBeNull();
    expect(supportingContext!.open).toBe(false);

    const readingOrder = [
      "Key focus / AI interpretation",
      "Total operating energy",
      "4.1 Operating Energy by Appliance",
      "4.2 Operating Hours Spike Analysis",
      "Supporting Evidence · all-hours Portfolio Appliance context",
      "Method, tariff and evidence",
    ].map((label) => operatingSection.textContent!.indexOf(label));
    expect(readingOrder.every((position) => position >= 0)).toBe(true);
    expect(readingOrder).toEqual([...readingOrder].sort((left, right) => left - right));
  });

  it("only renders Operating-hours interpretation when Snapshot, Release and period identities all match", () => {
    const snapshot = preschoolGoldenSnapshot();
    const staleMarkup = renderToStaticMarkup(
      <PreschoolOverviewRenderer
        state={{ status: "ready", snapshot }}
        operatingInterpretation={{
          status: "available",
          dataSnapshotId: snapshot.dataSnapshot.id,
          projectReleaseId: snapshot.projectRelease.id,
          period: { start: "2026-05-10T16:00:00.000Z", endExclusive: "2026-06-07T16:00:00.000Z" },
          headline: "STALE_OPERATING_HEADLINE",
          summary: "STALE_OPERATING_SUMMARY",
        }}
      />,
    );
    expect(staleMarkup).not.toContain("STALE_OPERATING_HEADLINE");
    expect(staleMarkup).not.toContain("STALE_OPERATING_SUMMARY");
    expect(staleMarkup).toContain('data-operating-interpretation-status="unavailable"');

    const pendingMarkup = renderToStaticMarkup(
      <PreschoolOverviewRenderer
        state={{ status: "ready", snapshot }}
        operatingInterpretation={{
          status: "pending",
          dataSnapshotId: snapshot.dataSnapshot.id,
          projectReleaseId: snapshot.projectRelease.id,
          period: snapshot.context.primaryPeriod,
        }}
      />,
    );
    expect(pendingMarkup).toContain('data-operating-interpretation-status="pending"');

    const matchingMarkup = renderToStaticMarkup(
      <PreschoolOverviewRenderer
        state={{ status: "ready", snapshot }}
        operatingInterpretation={{
          status: "available",
          dataSnapshotId: snapshot.dataSnapshot.id,
          projectReleaseId: snapshot.projectRelease.id,
          period: snapshot.context.primaryPeriod,
          headline: "MATCHING_OPERATING_HEADLINE",
          summary: "MATCHING_OPERATING_SUMMARY",
          actions: ["MATCHING_OPERATING_ACTION"],
        }}
      />,
    );
    expect(matchingMarkup).toContain('data-operating-interpretation-status="available"');
    expect(matchingMarkup).toContain("MATCHING_OPERATING_HEADLINE");
    expect(matchingMarkup).toContain("MATCHING_OPERATING_SUMMARY");
    expect(matchingMarkup).toContain("MATCHING_OPERATING_ACTION");
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

const attachForecastLifecycle = (
  snapshot: ReturnType<typeof preschoolGoldenSnapshot>,
  input: {
    status: "waiting" | "partial" | "complete";
    completeDays: number;
    actualKwh: number | null;
    pacePct: number | null;
  },
) => {
  if (
    snapshot.preschoolOperational?.status !== "available"
    || snapshot.preschoolOperational.planningOutlook.status !== "provisional"
  ) throw new Error("Expected planning fixture");
  const plan = structuredClone(snapshot.preschoolOperational.planningOutlook);
  plan.evidence.dataSnapshotId = "snapshot-a";
  const daily = Array.from({ length: 30 }, (_, index) => ({
    start: `2026-06-${String(index + 1).padStart(2, "0")}`,
    endExclusive: index === 29 ? "2026-07-01" : `2026-06-${String(index + 2).padStart(2, "0")}`,
    estimatedKwh: plan.usageEstimate.projectedKwh / 30,
    actualKwh: index < input.completeDays && input.actualKwh !== null ? input.actualKwh / input.completeDays : null,
    actualCompleteDayCount: index < input.completeDays ? 1 : 0,
    actualTargetDayCount: 1,
    actualStatus: index < input.completeDays ? "complete" as const : "waiting" as const,
  }));
  const aggregate = (size: number) => Array.from({ length: Math.ceil(30 / size) }, (_, bucketIndex) => {
    const rows = daily.slice(bucketIndex * size, (bucketIndex + 1) * size);
    const actualRows = rows.filter((row) => row.actualKwh !== null);
    return {
      start: rows[0]!.start,
      endExclusive: rows.at(-1)!.endExclusive,
      estimatedKwh: rows.reduce((sum, row) => sum + row.estimatedKwh, 0),
      actualKwh: actualRows.length === 0 ? null : actualRows.reduce((sum, row) => sum + row.actualKwh!, 0),
      actualCompleteDayCount: actualRows.length,
      actualTargetDayCount: rows.length,
      actualStatus: actualRows.length === 0 ? "waiting" as const : actualRows.length === rows.length ? "complete" as const : "partial" as const,
    };
  });
  const portfolioScope = {
    scopeId: snapshot.context.scopeId,
    scopeName: snapshot.context.scopeName,
    scopeType: "project",
    scopeRole: "portfolio" as const,
    estimatedKwh: plan.usageEstimate.projectedKwh,
    estimatedCostBeforeGstSgd: plan.costEstimate.projectedBeforeGstSgd,
    actualKwh: input.actualKwh,
    actualCompleteDayCount: input.completeDays,
    actualTargetDayCount: 30 as const,
    pacePct: input.pacePct,
    outcome: input.status === "complete" ? "above_plan" as const : null,
    buckets: { daily, weekly: aggregate(7), monthly: aggregate(30) },
  };
  Reflect.set(snapshot, "preschoolPlanningLifecycle", {
    status: "available",
    contract: { id: "preschool-saved-plan-current-actual", version: "1" },
    targetPeriod: {
      start: "2026-06-01",
      endExclusive: "2026-07-01",
      timezone: "Asia/Singapore",
      targetDayCount: 30,
    },
    plan,
    actual: {
      status: input.status === "complete" ? "complete" : "partial",
      usageKwh: input.actualKwh,
      completeDayCount: input.completeDays,
      targetDayCount: 30,
      varianceKwh: input.status === "complete" ? 651.79 : null,
      variancePct: input.status === "complete" ? 2.68 : null,
    },
    forecast: {
      status: input.status,
      contract: {
        id: "preschool-june-2026-forecast-series",
        version: "1",
        method: "same-weekday mean from four complete May weeks, scaled to the Saved Plan total",
      },
      scopes: [
        portfolioScope,
        {
          ...portfolioScope,
          scopeId: "centre-a",
          scopeName: "Centre A",
          scopeType: "centre",
          scopeRole: "centre",
          estimatedKwh: 6_000,
          estimatedCostBeforeGstSgd: 1_636.2,
        },
      ],
      evidence: {
        planDataSnapshotId: "snapshot-a",
        actualDataSnapshotId: "snapshot-b",
        planQueryId: "daily_totals_v1",
        actualQueryId: "daily_totals_v1",
        recipeId: "preschool-weekday-mean-series-v1",
      },
    },
    planProvenance: {
      savedAnalysisId: "saved-a",
      dataSnapshotId: "snapshot-a",
      projectReleaseId: snapshot.projectRelease.id,
      templateRevisionId: snapshot.projectRelease.templateRevisionId,
      queryId: "daily_totals_v1",
      recipeId: "preschool-naive-weekly-planning-baseline-v1",
    },
    actualProvenance: {
      dataSnapshotId: "snapshot-b",
      projectReleaseId: snapshot.projectRelease.id,
      queryId: "daily_totals_v1",
      period: { start: "2026-06-01", endExclusive: "2026-07-01", timezone: "Asia/Singapore" },
    },
  });
};
