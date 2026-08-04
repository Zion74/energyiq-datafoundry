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
    expect(markup).toContain("snapshot-ngee-ann-golden");
    expect(markup).toContain("View reproducible evidence");
    expect(markup).toContain("Comparison evidence");
    expect(markup).toContain("Baseline uses [from, to): start inclusive, end exclusive.");
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
    expect(markup).toContain("href=\"#ngee-ann-evidence-ref-evidence_3Angee-ann-golden_3Aenergy.total_usage_kwh\"");
    const costEvidenceMarkup = markup.slice(
      markup.indexOf("Cost evidence"),
      markup.indexOf("</section>", markup.indexOf("Cost evidence")),
    );
    expect(costEvidenceMarkup).toContain("No dedicated Evidence reference is attached");
    expect(costEvidenceMarkup).not.toContain("href=");
    expect(costEvidenceMarkup).not.toContain("evidence:ngee-ann-golden:energy.total_usage_kwh");
    expect(markup).not.toContain("Published sections");
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
