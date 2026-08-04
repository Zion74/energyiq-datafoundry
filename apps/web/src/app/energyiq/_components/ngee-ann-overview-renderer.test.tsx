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
    expect(markup).toContain("Energy trend");
    expect(markup).toContain("When did accepted energy use change inside the selected Period?");
    expect(markup).toContain("Energy trend Scope");
    expect(markup).toContain("7 daily buckets");
    expect(markup).toContain("Trend evidence / daily_totals_v1");
    expect(markup).toContain("energy.total_usage_kwh@1");
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
    expect(markup).toContain("Derived meter trace");
    expect(markup).toContain("Load 12 / Level 6 / Derived");
    expect(markup).toContain("Result 49.0218 kWh");
    expect(markup).toContain("Lvl 6 Office Load 1: L1P1-L3P6");
    expect(markup).toContain("mapping-lvl-6-office-load-1-l1p1-l3p6-3");
    expect(markup).toContain("+1 × 11.5379 kWh = 11.5379 kWh");
    expect(markup).toContain("Lvl 6 Office Load 2: L1P7-L3P12");
    expect(markup).toContain("mapping-lvl-6-office-load-2-l1p7-l3p12-4");
    expect(markup).toContain("+1 × 37.4839 kWh = 37.4839 kWh");
    expect(markup).toContain("Load 12 is not added separately to the official Project total.");
    expect(markup).toContain("same Snapshot, Release, Mapping revision, Formula revision, Period, unit and query ids");
    expect(markup).toContain("Composition evidence");
    expect(markup).toContain("Circuit evidence");
    expect(markup).toContain("l7-load-4");
    expect(markup).toContain("level-7");
    expect(markup).toContain("No · explanatory component");
    expect(markup).toContain("[2026-06-09T16:00:00.000Z, 2026-06-16T16:00:00.000Z)");
    expect(markup.indexOf("Energy trend")).toBeLessThan(markup.indexOf("Level comparison"));
    expect(markup.indexOf("Level comparison")).toBeLessThan(markup.indexOf("Energy composition"));
    expect(markup.indexOf("Energy composition")).toBeLessThan(markup.indexOf("Snapshot &amp; evidence"));
    expect(markup.indexOf("Accounting trace")).toBeLessThan(markup.indexOf("Derived meter trace"));
    expect(markup.indexOf("Derived meter trace")).toBeLessThan(markup.indexOf("Composition evidence"));
    expect(markup).toContain("mapping-v1");
    expect(markup).toContain("formula-v1");
    expect(markup).toContain("previous_meter_usage_v1");
    expect(markup).toContain("snapshot-ngee-ann-golden");
    expect(markup).toContain("View reproducible evidence");
    expect(markup).toContain("Comparison evidence");
    expect(markup).toContain("Previous period uses [from, to): start inclusive, end exclusive.");
    expect(markup).toContain("Previous period range");
    expect(markup).not.toContain("Baseline");
    expect(markup).not.toContain("Peak 1h Consumption");
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

  it("fails only Energy trend closed for a legacy Snapshot without daily totals", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    delete snapshot.analysis.dailyTotals;

    const markup = renderToStaticMarkup(
      <NgeeAnnOverviewRenderer state={{ status: "ready", snapshot }} />,
    );

    expect(markup).toContain("Energy trend unavailable");
    expect(markup).toContain("does not include the authoritative daily totals contract");
    expect(markup).toContain("Energy distribution");
    expect(markup).toContain("Energy composition");
    expect(markup).toContain("1531.1683");
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

  it("fails only the Derived subsection closed for legacy or wrongly marked traces", () => {
    const legacySnapshot = ngeeAnnGoldenSnapshot();
    delete legacySnapshot.analysis.virtualMeterTraces;
    const wrongMarkerSnapshot = ngeeAnnGoldenSnapshot();
    const wrongMarkerTrace = wrongMarkerSnapshot.analysis.virtualMeterTraces![0]! as {
      includedInOfficialTotal: boolean;
    };
    wrongMarkerTrace.includedInOfficialTotal = true;

    for (const snapshot of [legacySnapshot, wrongMarkerSnapshot]) {
      const markup = renderToStaticMarkup(
        <NgeeAnnOverviewRenderer state={{ status: "ready", snapshot }} />,
      );

      expect(markup).toContain("1239.4239 kWh");
      expect(markup).toContain("439.0972 kWh");
      expect(markup).toContain("Component Circuits explain 1518.9965 kWh");
      expect(markup).toContain("Derived meter trace unavailable");
      expect(markup).not.toContain("Result 49.0218 kWh");
      expect(markup).not.toContain("+1 × 11.5379 kWh = 11.5379 kWh");
    }
  });

  it("renders affected identities for a partial trace without a result, zero or partial sum", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const trace = snapshot.analysis.virtualMeterTraces![0]!;
    const affectedTerm = trace.terms[0]!;
    trace.status = "partial";
    trace.usageKwh = null;
    trace.missingTermMeterNodeIds = [affectedTerm.meterNodeId];
    affectedTerm.inputUsageKwh = null;
    affectedTerm.contributionKwh = null;
    affectedTerm.dataHealth = null;

    const markup = renderToStaticMarkup(
      <NgeeAnnOverviewRenderer state={{ status: "ready", snapshot }} />,
    );
    const derivedMarkup = markup.slice(
      markup.indexOf("Derived meter trace"),
      markup.indexOf("Composition evidence"),
    );

    expect(derivedMarkup).toContain("Load 12 / Level 6 / Derived");
    expect(derivedMarkup).toContain("Partial");
    expect(derivedMarkup).toContain("Derived result unavailable because required inputs are missing.");
    expect(derivedMarkup).toContain("Lvl 6 Office Load 1: L1P1-L3P6");
    expect(derivedMarkup).toContain("mapping-lvl-6-office-load-1-l1p1-l3p6-3");
    expect(derivedMarkup).toContain("Load 12 is not added separately to the official Project total.");
    expect(derivedMarkup).not.toContain("49.0218");
    expect(derivedMarkup).not.toContain("Result");
    expect(derivedMarkup).not.toContain(" kWh");
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

describe("NgeeAnnOverviewRenderer interaction closure", () => {
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

  const renderGolden = async (snapshot = ngeeAnnGoldenSnapshot()) => {
    await act(async () => {
      root.render(<NgeeAnnOverviewRenderer state={{ status: "ready", snapshot }} />);
    });
  };

  const circuitRows = () => Array.from(
    container.querySelectorAll<HTMLTableRowElement>("[data-circuit-row]"),
  );

  const filterButton = (legend: string, label: string) => {
    const fieldset = Array.from(container.querySelectorAll("fieldset"))
      .find((candidate) => candidate.querySelector("legend")?.textContent === legend);
    return Array.from(fieldset?.querySelectorAll("button") ?? [])
      .find((candidate) => candidate.textContent === label) as HTMLButtonElement | undefined;
  };

  it("switches authoritative trend Scopes and exposes point detail through focus and keyboard selection", async () => {
    await renderGolden();

    const projectButton = filterButton("Energy trend Scope", "Project")!;
    const level7Button = filterButton("Energy trend Scope", "Level 7")!;
    expect(projectButton.getAttribute("aria-pressed")).toBe("true");
    expect(level7Button.getAttribute("aria-pressed")).toBe("false");

    const projectPoint = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Wed 10 Jun: 216.3774 kWh"]',
    )!;
    await act(async () => projectPoint.focus());
    expect(container.textContent).toContain("216.3774 kWh");
    expect(container.textContent).toContain("Complete / 100% coverage / 384 / 384 valid intervals");

    await activateNativeButton(projectPoint, "Enter");
    await act(async () => projectPoint.blur());
    expect(projectPoint.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("216.3774 kWh");

    await activateNativeButton(level7Button, " ");
    expect(projectButton.getAttribute("aria-pressed")).toBe("false");
    expect(level7Button.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("Hover or focus a day to inspect accepted usage and coverage.");

    const level7Point = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Wed 10 Jun: 148.956 kWh"]',
    )!;
    await act(async () => level7Point.focus());
    expect(container.textContent).toContain("148.956 kWh");
  });

  it("keeps partial and missing daily buckets visible without zero-filling them", async () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const rows = snapshot.analysis.dailyTotals!.scopes[0]!.rows;
    rows[1]!.dataHealth = {
      status: "partial",
      coveragePct: 75,
      expectedMeterIntervalCount: 384,
      validIntervalCount: 288,
      qualityEventCount: 2,
    };
    rows[2]!.usageKwh = null;
    rows[2]!.dataHealth = {
      status: "unavailable",
      coveragePct: 0,
      expectedMeterIntervalCount: 384,
      validIntervalCount: 0,
      qualityEventCount: 1,
    };
    await renderGolden(snapshot);

    expect(container.textContent).toContain("not zero-filled");
    const partialPoint = container.querySelector<HTMLButtonElement>(
      'button[aria-label*="233.8201 kWh; Partial; 75% coverage"]',
    )!;
    const missingPoint = container.querySelector<HTMLButtonElement>(
      'button[aria-label*="no accepted facts; Unavailable; 0% coverage"]',
    )!;
    expect(partialPoint).toBeTruthy();
    expect(missingPoint).toBeTruthy();

    await act(async () => partialPoint.click());
    expect(container.textContent).toContain("Partial / 75% coverage / 288 / 384 valid intervals / 2 quality events");
    await act(async () => missingPoint.click());
    expect(container.textContent).toContain("No accepted facts");
    expect(container.textContent).not.toContain("2026-06-12 / 0 kWh");
  });

  it("filters the same ViewModel rows and expands All before returning to Top 5", async () => {
    await renderGolden();

    expect(circuitRows()).toHaveLength(5);
    expect(container.textContent).toContain("Showing 5 of 14 matching component Circuits.");
    const showAllButton = Array.from(container.querySelectorAll("button"))
      .find((candidate) => candidate.textContent === "Show all 14 Circuits") as HTMLButtonElement;
    expect(showAllButton).toBeTruthy();
    expect(showAllButton.getAttribute("aria-expanded")).toBe("false");

    await act(async () => showAllButton.click());
    expect(circuitRows()).toHaveLength(14);
    expect(container.textContent).toContain("All available component Circuits");
    expect(showAllButton.textContent).toBe("Show Top 5 Circuits");
    expect(showAllButton.getAttribute("aria-expanded")).toBe("true");

    await act(async () => showAllButton.click());
    expect(circuitRows()).toHaveLength(5);
    expect(container.textContent).toContain("Top 5 component Circuits");

    const level6Button = filterButton("Filter component Circuits by Level", "Level 6");
    expect(level6Button?.tagName).toBe("BUTTON");
    await act(async () => level6Button?.click());
    expect(circuitRows()).toHaveLength(5);
    expect(circuitRows().every((row) => row.dataset.levelId === "level-6")).toBe(true);
    expect(container.textContent).toContain("Showing 5 of 7 matching component Circuits.");

    const lightButton = filterButton("Filter component Circuits by Category", "Light");
    expect(lightButton?.tagName).toBe("BUTTON");
    await act(async () => lightButton?.click());
    expect(circuitRows()).toHaveLength(2);
    expect(circuitRows().every((row) =>
      row.dataset.levelId === "level-6" && row.dataset.categoryId === "light"
    )).toBe(true);
    expect(container.textContent).toContain("Showing 2 of 2 matching component Circuits.");
    expect(level6Button?.getAttribute("aria-pressed")).toBe("true");
    expect(lightButton?.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows an honest empty state for a Level and Category combination with no Snapshot rows", async () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const removedIds = new Set(
      snapshot.analysis.circuits
        .filter((circuit) =>
          circuit.includedInOfficialTotal === false
          && circuit.parentScopeId === "level-6"
          && circuit.category === "light"
        )
        .map((circuit) => circuit.meterNodeId),
    );
    snapshot.analysis.circuits = snapshot.analysis.circuits
      .filter((circuit) => !removedIds.has(circuit.meterNodeId));
    snapshot.analysis.componentReconciliation!.componentMeterNodeIds =
      snapshot.analysis.componentReconciliation!.componentMeterNodeIds
        .filter((meterNodeId) => !removedIds.has(meterNodeId));
    await renderGolden(snapshot);

    await act(async () => filterButton("Filter component Circuits by Level", "Level 6")?.click());
    await act(async () => filterButton("Filter component Circuits by Category", "Light")?.click());

    expect(circuitRows()).toHaveLength(0);
    expect(container.textContent).toContain("Showing 0 of 0 matching component Circuits.");
    expect(container.textContent).toContain("No component Circuits match these filters");
    expect(container.textContent).toContain("Choose All or another Level and Category combination");
  });

  it("keeps nested Accounting and Derived disclosure state coherent for Enter and Space", async () => {
    await renderGolden();
    const accountingButton = container.querySelector<HTMLButtonElement>(
      'button[aria-controls="ngee-ann-accounting-trace-panel"]',
    )!;
    const derivedButton = container.querySelector<HTMLButtonElement>(
      'button[aria-controls="ngee-ann-derived-meter-trace-panel"]',
    )!;
    const accountingPanel = container.querySelector<HTMLElement>("#ngee-ann-accounting-trace-panel")!;
    const derivedPanel = container.querySelector<HTMLElement>("#ngee-ann-derived-meter-trace-panel")!;

    expect(accountingButton.tagName).toBe("BUTTON");
    expect(derivedButton.tagName).toBe("BUTTON");
    expect(accountingButton.getAttribute("aria-expanded")).toBe("true");
    expect(derivedButton.getAttribute("aria-expanded")).toBe("true");

    await activateNativeButton(derivedButton, "Enter");
    expect(derivedButton.getAttribute("aria-expanded")).toBe("false");
    expect(derivedPanel.hidden).toBe(true);

    await activateNativeButton(accountingButton, " ");
    expect(accountingButton.getAttribute("aria-expanded")).toBe("false");
    expect(accountingPanel.hidden).toBe(true);

    await activateNativeButton(accountingButton, " ");
    expect(accountingButton.getAttribute("aria-expanded")).toBe("true");
    expect(accountingPanel.hidden).toBe(false);
    expect(derivedButton.getAttribute("aria-expanded")).toBe("false");

    await activateNativeButton(derivedButton, "Enter");
    expect(derivedButton.getAttribute("aria-expanded")).toBe("true");
    expect(derivedPanel.hidden).toBe(false);
    expect(derivedPanel.textContent).toContain("Result 49.0218 kWh");
  });

  it("preserves partial and unavailable Derived fail-closed states through disclosure toggles", async () => {
    const partialSnapshot = ngeeAnnGoldenSnapshot();
    const partialTrace = partialSnapshot.analysis.virtualMeterTraces![0]!;
    const affectedTerm = partialTrace.terms[0]!;
    partialTrace.status = "partial";
    partialTrace.usageKwh = null;
    partialTrace.missingTermMeterNodeIds = [affectedTerm.meterNodeId];
    affectedTerm.inputUsageKwh = null;
    affectedTerm.contributionKwh = null;
    affectedTerm.dataHealth = null;
    await renderGolden(partialSnapshot);

    let derivedButton = container.querySelector<HTMLButtonElement>(
      'button[aria-controls="ngee-ann-derived-meter-trace-panel"]',
    )!;
    await act(async () => derivedButton.click());
    await act(async () => derivedButton.click());
    expect(container.textContent).toContain("Derived result unavailable because required inputs are missing.");
    expect(container.textContent).not.toContain("Result 49.0218 kWh");

    const legacySnapshot = ngeeAnnGoldenSnapshot();
    delete legacySnapshot.analysis.virtualMeterTraces;
    await renderGolden(legacySnapshot);
    derivedButton = container.querySelector<HTMLButtonElement>(
      'button[aria-controls="ngee-ann-derived-meter-trace-panel"]',
    )!;
    await act(async () => derivedButton.click());
    await act(async () => derivedButton.click());
    expect(container.textContent).toContain("Derived meter trace unavailable");
    expect(container.textContent).not.toContain("Result 49.0218 kWh");
  });
});

async function activateNativeButton(button: HTMLButtonElement, key: "Enter" | " ") {
  button.focus();
  await act(async () => {
    button.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    button.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
    // happy-dom does not synthesize the browser's native button click from keyboard events.
    button.click();
  });
}

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
