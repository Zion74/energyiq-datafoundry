/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ngeeAnnGoldenSnapshot } from "./ngee-ann-overview.test-fixture";
import { NgeeAnnOverviewRenderer } from "./ngee-ann-overview-renderer";

describe("NgeeAnnOverviewRenderer", () => {
  it("keeps the Golden context, status, highlights and evidence in one compact dedicated surface", () => {
    const markup = renderToStaticMarkup(
      <NgeeAnnOverviewRenderer state={{ status: "ready", snapshot: ngeeAnnGoldenSnapshot() }} />,
    );

    expect(markup).toContain("data-ngee-ann-overview=\"true\"");
    expect(markup).toContain("Ngee Ann Polytechnic");
    expect(markup).toContain("Custom energy position");
    expect(markup).toContain("Ready");
    expect(markup).toContain("100% coverage");
    expect(markup).toContain("2,688 / 2,688 valid intervals");
    expect(markup).toContain("1531.1683");
    expect(markup).toContain("218.7383");
    expect(markup).toContain("20.6731");
    expect(markup).toContain("+26.3677%");
    expect(markup).toContain("Previous 1211.6773 kWh / +319.4911 kWh");
    expect(markup).toContain("489.973864 SGD");
    expect(markup).toContain("Energy distribution");
    expect(markup).toContain("Level comparison");
    expect(markup).toContain("Which Level needs attention first?");
    expect(markup).toContain("1054.1845");
    expect(markup).toContain("68.8484%");
    expect(markup).toContain("734.6257");
    expect(markup).toContain("+43.4995%");
    expect(markup).toContain("476.9838");
    expect(markup).toContain("31.1516%");
    expect(markup).toContain("-0.0142%");
    expect(markup).toContain("Energy composition");
    expect(markup).toContain("What explains the official Project total?");
    expect(markup).toContain("Official categories");
    expect(markup).toContain("1239.4239 kWh");
    expect(markup).toContain("80.9463%");
    expect(markup).toContain("887.217 kWh");
    expect(markup).toContain("+352.2069 kWh");
    expect(markup).toContain("+39.6979%");
    expect(markup).toContain("291.7444 kWh");
    expect(markup).toContain("19.0537%");
    expect(markup).toContain("324.4602 kWh");
    expect(markup).toContain("-32.7158 kWh");
    expect(markup).toContain("-10.0832%");
    expect(markup).toContain("Top 5 component Circuits");
    expect(markup).toContain("These are explanatory components and are not added separately to the official Project total.");
    expect(markup).toContain("439.0972 kWh");
    expect(markup).toContain("28.6773%");
    expect(markup).toContain("70.6873 kWh");
    expect(markup).toContain("4.6166%");
    for (const comparison of [
      ["Previous 247.9813 kWh", "+191.1159 kWh", "+77.0687%"],
      ["Previous 166.7234 kWh", "+171.1789 kWh", "+102.6724%"],
      ["Previous 262.7359 kWh", "-7.5821 kWh", "-2.8858%"],
      ["Previous 124.28 kWh", "-17.26 kWh", "-13.888%"],
      ["Previous 76.9724 kWh", "-6.2851 kWh", "-8.1653%"],
    ]) {
      for (const expected of comparison) expect(markup).toContain(expected);
    }
    expect(markup).toContain("Explanatory only");
    expect(markup).toContain("Accounting trace");
    expect(markup).toContain("Included once");
    expect(markup).toContain("Component Circuits explain 1518.9965 kWh of 1531.1683 kWh (99.2051%).");
    expect(markup).toContain("The 12.1718 kWh difference remains outside the component breakdown");
    expect(markup).toContain("it is not classified here as an anomaly, missing data or savings");
    expect(markup).toContain("Designated rows are rounded for display; the server-reconciled official total is authoritative.");
    expect(markup).toContain("Composition evidence");
    expect(markup).toContain("Circuit evidence");
    expect(markup).toContain("l7-load-4");
    expect(markup).toContain("level-7");
    expect(markup).toContain("No · explanatory component");
    expect(markup).toContain("[2026-06-09T16:00:00.000Z, 2026-06-16T16:00:00.000Z)");
    expect(markup.indexOf("Level comparison")).toBeLessThan(markup.indexOf("Energy composition"));
    expect(markup.indexOf("Energy composition")).toBeLessThan(markup.indexOf("Snapshot &amp; evidence"));
    expect(markup).toContain("mapping-v1");
    expect(markup).toContain("snapshot-ngee-ann-golden");
    expect(markup).toContain("View reproducible evidence");
    expect(markup).toContain("Comparison evidence");
    expect(markup).toContain("Previous period uses [from, to): start inclusive, end exclusive.");
    expect(markup).toContain("Previous period range");
    expect(markup).not.toContain("Baseline");
    expect(markup).toContain("[03 Jun 2026, 00:00, 10 Jun 2026, 00:00)");
    expect(markup).toContain("1531.1683 kWh");
    expect(markup).toContain("1211.6773 kWh");
    expect(markup).toContain("+319.4911 kWh");
    expect(markup).toContain("+26.3677%");
    expect(markup).toContain("Cost evidence");
    expect(markup).toContain("Tariff allocations");
    expect(markup).toContain("[10 Jun 2026, 00:00, 17 Jun 2026, 00:00)");
    expect(markup).toContain("0.32 SGD/kWh");
    expect(markup).toContain("1531.168324 kWh");
    expect(markup).toContain("489.973864 SGD");
    expect(markup).toContain("href=\"#ngee-ann-evidence-ref-evidence_3Angee-ann-golden_3Aenergy.total_usage_kwh_401\"");
    expect(markup).toContain("id=\"ngee-ann-evidence-ref-evidence_3Angee-ann-golden_3Aenergy.total_usage_kwh_401\"");
    const costEvidenceMarkup = markup.slice(
      markup.indexOf("Cost evidence"),
      markup.indexOf("</section>", markup.indexOf("Cost evidence")),
    );
    expect(costEvidenceMarkup).toContain("No dedicated Evidence reference is attached");
    expect(costEvidenceMarkup).not.toContain("href=");
    expect(costEvidenceMarkup).not.toContain("evidence:ngee-ann-golden:energy.total_usage_kwh@1");
    expect(markup).not.toContain("Published sections");
  });

  it("renders an honest unavailable Level module for a legacy Snapshot contract", () => {
    const markup = renderToStaticMarkup(
      <NgeeAnnOverviewRenderer
        state={{ status: "ready", snapshot: ngeeAnnGoldenSnapshot({ levelFactsAvailable: false }) }}
      />,
    );

    expect(markup).toContain("Level comparison unavailable");
    expect(markup).toContain("does not include the Level comparison and quality contract");
    expect(markup).not.toContain("1054.1845");
  });

  it("keeps Category facts visible when explicit Circuit and accounting evidence is unavailable", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    delete snapshot.analysis.topCircuits[0]!.includedInOfficialTotal;
    delete snapshot.analysis.topCircuits[0]!.parentScopeId;
    delete snapshot.analysis.componentReconciliation;

    const markup = renderToStaticMarkup(
      <NgeeAnnOverviewRenderer state={{ status: "ready", snapshot }} />,
    );

    expect(markup).toContain("Official categories");
    expect(markup).toContain("1239.4239 kWh");
    expect(markup).toContain("291.7444 kWh");
    expect(markup).toContain("Component Circuit ranking unavailable");
    expect(markup).toContain("Accounting trace unavailable");
    expect(markup).not.toContain("439.0972 kWh");
    expect(markup).not.toContain("1518.9965 kWh");
  });

  it("shows partial accepted values and fails closed for an unavailable selection", () => {
    const partialMarkup = renderToStaticMarkup(
      <NgeeAnnOverviewRenderer
        state={{
          status: "ready",
          snapshot: ngeeAnnGoldenSnapshot({
            dataStatus: "partial",
            coveragePct: 50,
            validIntervalCount: 1_344,
          }),
        }}
      />,
    );
    const unavailableMarkup = renderToStaticMarkup(
      <NgeeAnnOverviewRenderer
        state={{
          status: "ready",
          snapshot: ngeeAnnGoldenSnapshot({
            dataStatus: "unavailable",
            coveragePct: 0,
            validIntervalCount: 0,
          }),
        }}
      />,
    );

    expect(partialMarkup).toContain("Partial data");
    expect(partialMarkup).toContain("1531.1683");
    expect(unavailableMarkup).toContain("data-data-status=\"unavailable\"");
    expect(unavailableMarkup).not.toContain("1531.1683");
    expect(unavailableMarkup.match(/Unavailable/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it("renders the Tariff limitation instead of inventing a Cost", () => {
    const markup = renderToStaticMarkup(
      <NgeeAnnOverviewRenderer
        state={{ status: "ready", snapshot: ngeeAnnGoldenSnapshot({ costAvailable: false }) }}
      />,
    );

    expect(markup).toContain("Cost");
    expect(markup).toContain("Unavailable");
    expect(markup).toContain("No effective Tariff covers the selected period.");
    expect(markup).toContain("Cost evidence");
    expect(markup).toContain("tariff-v1");
    expect(markup).toContain("No allocation rows are available.");
    expect(markup).not.toContain("489.973864 SGD");
    expect(markup).not.toContain("Tariff allocations");
    expect(markup).not.toContain("0.32 SGD/kWh");
  });
});

describe("NgeeAnnOverviewRenderer latest-data action", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("does not select the latest range until the user clicks the explicit CTA", async () => {
    const onViewLatestAvailableData = vi.fn();
    await act(async () => {
      root.render(
        <NgeeAnnOverviewRenderer
          state={{
            status: "ready",
            snapshot: ngeeAnnGoldenSnapshot({
              dataStatus: "unavailable",
              coveragePct: 0,
              validIntervalCount: 0,
              lastSeenAt: null,
            }),
          }}
          latestAvailableRange={{ from: "2026-06-10", to: "2026-06-16" }}
          onViewLatestAvailableData={onViewLatestAvailableData}
        />,
      );
    });

    expect(onViewLatestAvailableData).not.toHaveBeenCalled();
    const button = Array.from(container.querySelectorAll("button"))
      .find((candidate) => candidate.textContent?.includes("View latest available data"));
    expect(button).toBeTruthy();

    await act(async () => button?.click());
    expect(onViewLatestAvailableData).toHaveBeenCalledOnce();
    expect(onViewLatestAvailableData).toHaveBeenCalledWith({
      from: "2026-06-10",
      to: "2026-06-16",
    });
  });

  it("hides the CTA when the authoritative coverage hint is unavailable", async () => {
    await act(async () => {
      root.render(
        <NgeeAnnOverviewRenderer
          state={{
            status: "ready",
            snapshot: ngeeAnnGoldenSnapshot({
              dataStatus: "unavailable",
              coveragePct: 0,
              validIntervalCount: 0,
              lastSeenAt: null,
            }),
          }}
        />,
      );
    });

    expect(container.textContent).not.toContain("View latest available data");
    expect(container.textContent).toContain("latest complete range is not currently available");
  });
});
