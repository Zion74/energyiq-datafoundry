/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PreschoolOverviewViewModel } from "./preschool-overview-view-model";
import { PreschoolForecastPanel } from "./preschool-forecast-panel";

type ForecastView = Exclude<PreschoolOverviewViewModel["forecast"], { status: "unavailable" }>;

describe("PreschoolForecastPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("keeps Daily, Weekly and Monthly plus Portfolio/Centre controls local to Section 5", async () => {
    await act(async () => root.render(<PreschoolForecastPanel forecast={forecastView()} />));

    expect(container.querySelector('[data-forecast-grain="daily"]')).not.toBeNull();
    expect(container.querySelector('[data-forecast-scope="portfolio"]')?.textContent).toContain("24,348 kWh");
    expect(container.textContent).toContain("1,400 kWh");
    expect(container.querySelectorAll("[data-forecast-kpi]")).toHaveLength(4);
    expect(container.querySelector('path[data-series="estimate"]')?.getAttribute("stroke-dasharray")).not.toBeNull();
    expect(container.querySelector('path[data-series="actual"]')?.getAttribute("stroke-dasharray")).toBeNull();

    const weekly = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Weekly")!;
    weekly.focus();
    await act(async () => weekly.click());
    expect(weekly.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[data-forecast-grain="weekly"]')).not.toBeNull();
    expect(container.textContent).toContain("1 Jun–7 Jun");

    const scope = container.querySelector<HTMLSelectElement>('select[aria-label="Forecast scope"]')!;
    await act(async () => {
      scope.value = "centre-a";
      scope.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.querySelector('[data-forecast-scope="centre"]')?.textContent).toContain("Centre A");
    expect(container.querySelector('[data-forecast-scope="centre"]')?.textContent).toContain("6,000 kWh");

    const monthly = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Monthly")!;
    await act(async () => monthly.click());
    expect(container.querySelector('[data-forecast-grain="monthly"]')).not.toBeNull();
    expect(container.textContent).toContain("1 Jun–30 Jun");
  });
});

const forecastView = (): ForecastView => ({
  status: "partial",
  statusLabel: "Partial June actual",
  statusDetail: "June Actual is shown only for complete days.",
  targetPeriod: "1–30 Jun 2026",
  defaultScopeId: "portfolio",
  centreSelectionAvailable: true,
  scopes: [
    scopeView("portfolio", "Preschool Portfolio", "portfolio", "24,348 kWh", "S$6,640", "1,400 kWh"),
    scopeView("centre-a", "Centre A", "centre", "6,000 kWh", "S$1,636", "420 kWh"),
  ],
  method: "same-weekday mean from four complete May weeks, scaled to the Saved Plan total",
  planEvidence: "Saved saved-a · Snapshot snapshot-a · daily_totals_v1",
  actualEvidence: "Current Snapshot snapshot-b · daily_totals_v1",
});

const scopeView = (
  scopeId: string,
  label: string,
  role: "portfolio" | "centre",
  estimatedEnergy: string,
  estimatedCost: string,
  consumedSoFar: string,
): ForecastView["scopes"][number] => ({
  scopeId,
  label,
  scopeType: role === "portfolio" ? "project" : "centre",
  role,
  status: "partial",
  statusLabel: "Partial June actual",
  estimatedEnergy,
  estimatedCost,
  consumedSoFar,
  paceVsEstimate: "24.64%",
  paceDetail: "Actual to date ÷ estimate for the same complete days",
  coverage: "7 / 30 complete days",
  outcome: null,
  buckets: {
    daily: [bucket("1 Jun", "2026-06-01", "2026-06-02", 800, 200, "complete", "1 / 1 complete days")],
    weekly: [bucket("1 Jun–7 Jun", "2026-06-01", "2026-06-08", 5_600, 1_400, "complete", "7 / 7 complete days")],
    monthly: [bucket("1 Jun–30 Jun", "2026-06-01", "2026-07-01", 24_348, 1_400, "partial", "7 / 30 complete days")],
  },
});

const bucket = (
  label: string,
  start: string,
  endExclusive: string,
  estimateKwh: number,
  actualKwh: number,
  actualStatus: "partial" | "complete",
  coverage: string,
) => ({
  label,
  start,
  endExclusive,
  estimateKwh,
  estimate: `${estimateKwh.toLocaleString("en-SG")} kWh`,
  actualKwh,
  actual: `${actualKwh.toLocaleString("en-SG")} kWh`,
  actualStatus,
  coverage,
});
