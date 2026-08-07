/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ngeeAnnGoldenSnapshot, ngeeAnnSingleDaySnapshot } from "./ngee-ann-overview.test-fixture";
import { NgeeAnnDecisionPriorities } from "./ngee-ann-decision-priorities";
import { NgeeAnnOverviewRenderer } from "./ngee-ann-overview-renderer";
import { buildNgeeAnnOverviewViewModel } from "./ngee-ann-overview-view-model";

vi.mock("./ngee-ann-ai-run", async () => {
  const actual = await vi.importActual<typeof import("./ngee-ann-ai-run")>("./ngee-ann-ai-run");
  return {
    ...actual,
    getOrStartNgeeAnnAiRun: vi.fn(() => new Promise<never>(() => {})),
  };
});

type GoldenSnapshot = ReturnType<typeof ngeeAnnGoldenSnapshot>;
type DailyAnomalyRow = Extract<
  NonNullable<GoldenSnapshot["analysis"]["dailyUsageAnomalies"]>,
  { status: "available" }
>["scopes"][number]["rows"][number];

function makeWithinThreshold(row: DailyAnomalyRow): void {
  if (row.outcome !== "triggered" || row.actualKwh === null) return;
  row.outcome = "within_threshold";
  row.baselineKwh = row.actualKwh;
  row.impactKwh = 0;
  row.relativePct = 0;
}

describe("NgeeAnnOverviewRenderer", () => {
  it("shows one deterministic theme across latest day, rolling 7 days and rolling 28 days", () => {
    const markup = renderToStaticMarkup(
      <NgeeAnnOverviewRenderer state={{ status: "ready", snapshot: ngeeAnnGoldenSnapshot() }} />,
    );

    expect(markup).toContain("Takeaways and next decisions");
    expect(markup).toContain("Priority 1");
    expect(markup).toContain("Latest complete day");
    expect(markup).toContain("Rolling 7 days");
    expect(markup).toContain("Rolling 28 days");
    expect(markup).toContain("How each horizon compares with its governed baseline");
    expect(markup).toContain('data-horizon-label="Rolling 7 days"');
    expect(markup).toContain('data-direction="increase"');
    expect(markup).toContain('aria-label="Rolling 7 days, 10 Jun – 16 Jun: 1,531.17 kWh versus 1,211.68 kWh governed baseline; +319.49 kWh, +26.4%"');
    expect(markup).toContain("Bar length is relative to the largest visible change.");
    expect(markup).toContain("1,531.17 vs 1,211.68 kWh");
    expect(markup).toContain("+319.49 kWh vs baseline");
    expect(markup).toContain("Seen on 3 distinct exception days. Linked Level and Circuit evidence is preserved.");
    expect(markup).toContain("Why it matters");
    expect(markup).toContain("Do next");
    expect(markup).toContain("Verify with");
    expect(markup).toContain("Details, evidence and limitations");
    expect(markup.match(/View supporting evidence/g)).toHaveLength(1);
    expect(markup).toContain("Compared with saved result from");
    expect(markup).toContain("Newly supported in current B");
    expect(markup).toContain("This does not prove the issue itself began in B.");
    expect(markup).toContain('data-decision-lifecycle-kind="newly_supported"');
  });

  it("shows a prior theme as resolved only when current B has complete no-trigger Evidence", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    if (snapshot.analysis.dailyUsageAnomalies?.status !== "available") throw new Error("GOLDEN_ANOMALY_BUNDLE_REQUIRED");
    for (const row of snapshot.analysis.dailyUsageAnomalies.scopes.flatMap((scope) => scope.rows)) {
      makeWithinThreshold(row);
    }
    snapshot.decisionPriorities = {
      ...snapshot.decisionPriorities!,
      status: "empty",
      limitation: null,
      items: [],
    };
    snapshot.decisionLifecycle = {
      ...snapshot.decisionLifecycle!,
      reference: {
        ...snapshot.decisionLifecycle!.reference!,
        evidenceStatus: "available",
      },
      items: [{
        ...snapshot.decisionLifecycle!.items[0]!,
        kind: "resolved",
        currentPriorityId: null,
      }],
    };

    const markup = renderToStaticMarkup(
      <NgeeAnnOverviewRenderer state={{ status: "ready", snapshot }} />,
    );

    expect(markup).toContain("Resolved in the current 28-day window");
    expect(markup).toContain('data-decision-lifecycle-kind="resolved"');
    expect(markup).not.toContain("Priority 1");
  });

  it("hides cross-Snapshot labels when the lifecycle contract points at another current Snapshot", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    snapshot.decisionLifecycle!.currentDataSnapshotId = "snapshot-other";

    const markup = renderToStaticMarkup(
      <NgeeAnnOverviewRenderer state={{ status: "ready", snapshot }} />,
    );

    expect(markup).not.toContain("Compared with saved result from");
    expect(markup).not.toContain("Newly supported in current B");
  });

  it("keeps decrease, flat and unavailable horizons distinct without inventing zero values", () => {
    const view = buildNgeeAnnOverviewViewModel(ngeeAnnGoldenSnapshot()).decisionPriorities;
    const horizons = view.items[0]!.horizons;
    Object.assign(horizons[0], {
      actualKwh: 100,
      baselineKwh: 125,
      deltaKwh: -25,
      relativePct: -20,
    });
    Object.assign(horizons[1], {
      actualKwh: 200,
      baselineKwh: 200,
      deltaKwh: 0,
      relativePct: 0,
    });
    Object.assign(horizons[2], {
      status: "unavailable",
      actualKwh: null,
      baselineKwh: null,
      deltaKwh: null,
      relativePct: null,
      limitation: "No governed 28-day baseline is available.",
    });

    const markup = renderToStaticMarkup(
      <NgeeAnnDecisionPriorities view={view} />,
    );

    expect(markup).toContain('data-direction="decrease"');
    expect(markup).toContain('data-direction="flat"');
    expect(markup).toContain('data-direction="unavailable"');
    expect(markup).toContain("-25 kWh vs baseline");
    expect(markup).toContain("0 kWh vs baseline");
    expect(markup).toContain("No governed 28-day baseline is available.");
    expect(markup).not.toContain("Rolling 28 days, 20 May – 16 Jun: 0 kWh");
  });

  it("places the server-owned decision priorities after Data Status and before Key highlights", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const projectExplorerHref = [
      "/energyiq/explorer?projectId=ngee-ann-polytechnic",
      "scopeId=project",
      "resource=electricity",
      "period=Custom",
      "from=2026-06-10",
      "to=2026-06-16",
      `dataSnapshotId=${encodeURIComponent(snapshot.context.dataSnapshotId)}`,
      `projectReleaseId=${encodeURIComponent(snapshot.projectRelease.id)}`,
    ].join("&");
    const markup = renderToStaticMarkup(
      <NgeeAnnOverviewRenderer
        state={{ status: "ready", snapshot }}
        projectExplorerHref={projectExplorerHref}
        aiAnalystHref="/energyiq/ai?projectId=ngee-ann-polytechnic"
      />,
    );

    expect(markup).toContain("Takeaways and next decisions");
    expect(markup).toContain("Supporting evidence");
    expect(markup).toContain("Why it matters");
    expect(markup).toContain("Do next");
    expect(markup).toContain("Verify with");
    expect(markup).toContain("Complete Evidence");
    expect(markup).toContain("href=\"#incident-project-2026-06-13\"");
    expect(markup).toContain("Inspect Level 7 in Project Explorer");
    expect(markup).toContain("Open Project Explorer");
    expect(markup).toContain("Ask AI Analyst");
    expect(markup).toContain("AI energy analyst");
    expect(markup).toContain("Inspecting scoped data");
    expect(markup.indexOf("Takeaways and next decisions")).toBeLessThan(markup.indexOf("Verified figures"));
    expect(markup.indexOf("Verified figures")).toBeLessThan(markup.indexOf("AI energy analyst"));
    expect(markup.indexOf("AI energy analyst")).toBeLessThan(markup.indexOf("Change over time"));

    const container = document.createElement("div");
    container.innerHTML = markup;
    const preciseExplorerLink = container.querySelector<HTMLAnchorElement>("[data-explorer-scope='level-7']");
    expect(preciseExplorerLink).not.toBeNull();
    const preciseUrl = new URL(preciseExplorerLink!.href);
    expect(Object.fromEntries(preciseUrl.searchParams)).toMatchObject({
      projectId: "ngee-ann-polytechnic",
      scopeId: "level-7",
      resource: "electricity",
      period: "Custom",
      from: "2026-06-10",
      to: "2026-06-16",
      dataSnapshotId: snapshot.context.dataSnapshotId,
      projectReleaseId: snapshot.projectRelease.id,
    });
  });

  it.each([
    { status: "empty", expected: "No deterministic theme for this Period", code: null },
    { status: "partial", expected: "No complete theme conclusion", code: "SOME_CANDIDATE_DATES_SUPPRESSED" },
    { status: "suppressed", expected: "Theme conclusion suppressed", code: "ALL_CANDIDATE_DATES_SUPPRESSED" },
    { status: "unavailable", expected: "Decision themes unavailable", code: "DAILY_USAGE_ANOMALIES_UNAVAILABLE" },
  ] as const)("renders the server-owned $status priority state without inventing a card", ({ status, expected, code }) => {
    const snapshot = ngeeAnnGoldenSnapshot();
    if (snapshot.analysis.dailyUsageAnomalies?.status === "available" && status !== "unavailable") {
      const rows = snapshot.analysis.dailyUsageAnomalies.scopes.flatMap((scope) => scope.rows);
      for (const row of rows) {
        makeWithinThreshold(row);
      }
      if (status === "partial") {
        rows[0]!.outcome = "suppressed";
        rows[0]!.suppressionReason = {
          code: "CALENDAR_EXCEPTION_DATE",
          message: "The date is excluded by the pinned Calendar.",
        };
      }
      if (status === "suppressed") {
        for (const row of rows) {
          row.outcome = "suppressed";
          row.suppressionReason = {
            code: "CALENDAR_EXCEPTION_DATE",
            message: "The date is excluded by the pinned Calendar.",
          };
        }
      }
    }
    snapshot.decisionPriorities = {
      ...snapshot.decisionPriorities!,
      status,
      limitation: code ? { code, message: `Server limitation: ${code}` } : null,
      items: [],
    };
    const markup = renderToStaticMarkup(
      <NgeeAnnOverviewRenderer state={{ status: "ready", snapshot }} />,
    );

    expect(markup).toContain(expected);
    expect(markup).toContain("0 verified priorities");
    expect(markup).not.toContain("View supporting evidence");
    expect(markup).toContain("Verified figures");
  });

  it("fails invalid priorities closed while leaving the rest of the Golden Overview visible", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    snapshot.decisionPriorities!.items[0]!.rank = 2;
    const markup = renderToStaticMarkup(
      <NgeeAnnOverviewRenderer state={{ status: "ready", snapshot }} />,
    );

    expect(markup).toContain("Decision themes unavailable");
    expect(markup).toContain("order or Evidence contract is invalid");
    expect(markup).toContain("1531.17");
    expect(markup).toContain("Energy trend");
  });

  it("uses a warning badge for a server-owned partial priority", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const limitation = {
      code: "SUPPORTING_EVIDENCE_PARTIAL" as const,
      message: "Supporting Circuit Evidence is partial.",
    };
    snapshot.decisionPriorities!.status = "partial";
    snapshot.decisionPriorities!.limitation = limitation;
    snapshot.decisionPriorities!.items[0]!.confidence = { status: "partial", limitation };
    const markup = renderToStaticMarkup(
      <NgeeAnnOverviewRenderer state={{ status: "ready", snapshot }} />,
    );

    expect(markup).toContain("bg-step-warning/10 text-step-warning\">Partial Evidence");
    expect(markup).toContain("Limitation.</span> Supporting Circuit Evidence is partial.");
  });

  it("keeps the Golden context, status, highlights and evidence in one compact dedicated surface", () => {
    const markup = renderToStaticMarkup(
      <NgeeAnnOverviewRenderer state={{ status: "ready", snapshot: ngeeAnnGoldenSnapshot() }} />,
    );

    expect(markup).toContain("data-ngee-ann-overview=\"true\"");
    expect(markup).toContain("Ngee Ann Polytechnic");
    expect(markup).toContain("Energy decision overview");
    expect(markup).toContain("Scope · Whole project");
    expect(markup).not.toContain("Custom energy position");
    expect(markup).toContain("Ready");
    expect(markup).toContain("100% coverage");
    expect(markup).toContain("2,688 / 2,688 valid intervals");
    expect(markup).toContain("1531.17");
    expect(markup).toContain("218.74");
    expect(markup).toContain("20.67");
    expect(markup).toContain("26.4% higher");
    expect(markup).toContain("Current 1531.17 kWh vs previous 1211.68 kWh");
    expect(markup).toContain("S$489.97");
    expect(markup).toContain("Area and headcount metadata are missing");
    expect(markup).toContain("Configure area metadata. Configure headcount metadata.");
    expect(markup).toContain("Energy trend");
    expect(markup).toContain("When did accepted energy use change inside the selected Period?");
    expect(markup).toContain("Energy trend Scope");
    expect(markup).toContain("7 daily buckets");
    expect(markup).toContain("Trend evidence / daily_totals_v1");
    expect(markup).toContain("Priority usage exceptions");
    expect(markup).toContain("Focus on the largest gaps from comparable days");
    expect(markup).toContain("Largest gap to review first");
    expect(markup.match(/data-priority-anomaly-trigger="true"/g)).toHaveLength(3);
    expect(markup.match(/data-anomaly-trigger="true"/g)).toHaveLength(7);
    expect(markup).toContain("View all 7 flagged checks");
    expect(markup).toContain("How these exceptions were selected");
    expect(markup).not.toContain("Triggered only / pinned Rule");
    expect(markup).toContain("Day profile");
    expect(markup).toContain("How does the typical 24-hour energy shape change by Day Type and Scope?");
    expect(markup).toContain("5 complete days / 24 server values");
    expect(markup).toContain("Day Profile evidence / time_bucket_grid_v1");
    expect(markup).toContain("Usage heatmap");
    expect(markup).toContain("Which recurring local hour pattern or individual date needs inspection?");
    expect(markup).toContain("Level × hour average");
    expect(markup).toContain("Average day type");
    expect(markup).toContain("Date × hour");
    expect(markup).toContain("Heatmap evidence / time_bucket_grid_v1");
    expect(markup).toContain("energy.total_usage_kwh@1");
    expect(markup).toContain("Energy distribution");
    expect(markup).toContain("bg-blue-600");
    expect(markup).toContain("bg-teal-700");
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
    expect(markup).toContain("Where the energy went");
    expect(markup).toContain("bg-violet-600");
    expect(markup).toContain("bg-amber-600");
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
    expect(markup).toContain("Largest component Circuits");
    expect(markup).toContain("Ranked by current usage. Use these Circuits to decide where to investigate first.");
    expect(markup).toContain("439.0972 kWh");
    expect(markup).toContain("28.6773%");
    expect(markup).toContain("70.6873 kWh");
    expect(markup).toContain("4.6166%");
    for (const comparison of [
      ["previous 247.9813 kWh", "+191.1159 kWh", "+77.0687%"],
      ["previous 166.7234 kWh", "+171.1789 kWh", "+102.6724%"],
      ["previous 262.7359 kWh", "-7.5821 kWh", "-2.8858%"],
      ["previous 124.28 kWh", "-17.26 kWh", "-13.888%"],
      ["previous 76.9724 kWh", "-6.2851 kWh", "-8.1653%"],
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
    expect(markup).toContain("Circuit details and Evidence");
    expect(markup).toContain("l7-load-4");
    expect(markup).toContain("level-7");
    expect(markup).toContain("No · explanatory component");
    expect(markup).toContain("[2026-06-09T16:00:00.000Z, 2026-06-16T16:00:00.000Z)");
    expect(markup.indexOf("Energy trend")).toBeLessThan(markup.indexOf("Energy distribution"));
    expect(markup.indexOf("Energy trend")).toBeLessThan(markup.indexOf("Priority usage exceptions"));
    expect(markup.indexOf("Priority usage exceptions")).toBeLessThan(markup.indexOf("Energy distribution"));
    expect(markup.indexOf("Energy distribution")).toBeLessThan(markup.indexOf("Energy composition"));
    expect(markup.indexOf("Energy composition")).toBeLessThan(markup.indexOf("Day profile"));
    expect(markup.indexOf("Day profile")).toBeLessThan(markup.indexOf("Usage heatmap"));
    expect(markup.indexOf("Usage heatmap")).toBeLessThan(markup.indexOf("Evidence and calculation details"));
    expect(markup.indexOf("Accounting trace")).toBeLessThan(markup.indexOf("Derived meter trace"));
    expect(markup.indexOf("Derived meter trace")).toBeLessThan(markup.indexOf("Composition evidence"));
    expect(markup).toContain("mapping-v1");
    expect(markup).toContain("formula-v1");
    expect(markup).toContain("previous_meter_usage_v1");
    expect(markup).toContain("snapshot-ngee-ann-golden");
    expect(markup).toContain("View reproducible evidence and technical IDs");
    expect(markup).toContain("Comparison evidence");
    expect(markup).toContain("Previous period uses [from, to): start inclusive, end exclusive.");
    expect(markup).toContain("Previous period range");
    expect(markup).not.toContain("Baseline period");
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

  it("renders accepted daily bars with governed baseline markers and triggered key dates", () => {
    const markup = renderToStaticMarkup(
      <NgeeAnnOverviewRenderer state={{ status: "ready", snapshot: ngeeAnnGoldenSnapshot() }} />,
    );

    expect(markup).toContain("Accepted usage");
    expect(markup).toContain("Governed baseline");
    expect(markup).toContain('data-trend-baseline-marker="true"');
    expect(markup).toContain('data-trend-outcome="triggered"');
    expect(markup).toContain("Needs review");
    expect(markup).toContain('aria-label="Thu 11 Jun: current 268.399 kWh; governed baseline 218.88 kWh; delta +49.51 kWh (+22.6%); Above-baseline rule triggered; Complete; 100% coverage"');
    expect(markup).toContain("Baseline query");
    expect(markup).toContain("time_slot_anomaly_v1");
    expect(markup).toContain("comparison.daily_usage_above_baseline@1");
  });

  it("keeps accepted daily bars available while honestly hiding a mismatched baseline overlay", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    if (snapshot.analysis.dailyUsageAnomalies?.status !== "available") throw new Error("GOLDEN_ANOMALY_BUNDLE_REQUIRED");
    snapshot.analysis.dailyUsageAnomalies.scopes[0]!.rows[0]!.actualKwh = 999;

    const markup = renderToStaticMarkup(
      <NgeeAnnOverviewRenderer state={{ status: "ready", snapshot }} />,
    );

    expect(markup).toContain("7 daily buckets");
    expect(markup).toContain("253.7018 kWh");
    expect(markup).toContain("Governed baseline overlay unavailable");
    expect(markup).toContain("Accepted usage remains available");
    expect(markup).not.toContain('data-trend-baseline-marker="true"');
  });

  it("fails only the new time modules closed for an absent authoritative hourly grid", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    delete snapshot.analysis.timeBehaviour;

    const markup = renderToStaticMarkup(
      <NgeeAnnOverviewRenderer state={{ status: "ready", snapshot }} />,
    );

    expect(markup).toContain("7 daily buckets");
    expect(markup).toContain("Day profile unavailable");
    expect(markup).toContain("Usage heatmap unavailable");
    expect(markup).toContain("does not include the authoritative hourly time grid");
    expect(markup).toContain("Energy distribution");
    expect(markup).toContain("Energy composition");
  });

  it("keeps absent, unavailable, invalid and all-suppressed daily anomaly states explicit", () => {
    const absent = ngeeAnnGoldenSnapshot();
    delete absent.analysis.dailyUsageAnomalies;
    const unavailable = ngeeAnnGoldenSnapshot();
    unavailable.analysis.dailyUsageAnomalies = {
      status: "unavailable",
      ruleRevisionId: "comparison.daily_usage_above_baseline@1",
      reason: {
        code: "BUSINESS_CALENDAR_VERSION_MISSING",
        message: "No Published Calendar is pinned.",
      },
    };
    const invalid = ngeeAnnGoldenSnapshot();
    if (invalid.analysis.dailyUsageAnomalies?.status === "available") {
      invalid.analysis.dailyUsageAnomalies.evidencePins.dataSnapshotId = "snapshot-mismatch";
    }
    const suppressed = ngeeAnnGoldenSnapshot();
    if (suppressed.analysis.dailyUsageAnomalies?.status === "available") {
      for (const scope of suppressed.analysis.dailyUsageAnomalies.scopes) {
        for (const row of scope.rows) {
          row.outcome = "suppressed";
          row.suppressionReason = {
            code: "CALENDAR_EXCEPTION_DATE",
            message: "Excluded by the pinned Calendar.",
          };
        }
      }
    }

    const absentMarkup = renderToStaticMarkup(
      <NgeeAnnOverviewRenderer state={{ status: "ready", snapshot: absent }} />,
    );
    const unavailableMarkup = renderToStaticMarkup(
      <NgeeAnnOverviewRenderer state={{ status: "ready", snapshot: unavailable }} />,
    );
    const invalidMarkup = renderToStaticMarkup(
      <NgeeAnnOverviewRenderer state={{ status: "ready", snapshot: invalid }} />,
    );
    const suppressedMarkup = renderToStaticMarkup(
      <NgeeAnnOverviewRenderer state={{ status: "ready", snapshot: suppressed }} />,
    );

    expect(absentMarkup).toContain("Usage exception analysis unavailable");
    expect(absentMarkup).toContain("does not include the authoritative daily anomaly contract");
    expect(unavailableMarkup).toContain("No Published Calendar is pinned.");
    expect(invalidMarkup).toContain("evidence pins are inconsistent");
    expect(suppressedMarkup).toContain("No daily check was eligible for a conclusion");
    expect(suppressedMarkup).toContain("prevented a trustworthy conclusion for every check");
    expect(suppressedMarkup).not.toContain("data-anomaly-trigger=\"true\"");
    for (const markup of [absentMarkup, unavailableMarkup, invalidMarkup, suppressedMarkup]) {
      expect(markup).toContain("Energy trend");
      expect(markup).toContain("Day profile");
      expect(markup).toContain("Energy distribution");
    }
  });

  it("summarises mixed Scope-date outcomes without describing suppressed evaluations as normal", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    if (snapshot.analysis.dailyUsageAnomalies?.status === "available") {
      const suppressed = snapshot.analysis.dailyUsageAnomalies.scopes[0]!.rows[0]!;
      suppressed.outcome = "suppressed";
      suppressed.suppressionReason = {
        code: "CALENDAR_EXCEPTION_DATE",
        message: "Excluded by the pinned Calendar.",
      };
    }

    const markup = renderToStaticMarkup(
      <NgeeAnnOverviewRenderer state={{ status: "ready", snapshot }} />,
    );

    expect(markup).toContain("7 checks crossed both published thresholds; 13 stayed within threshold; 1 could not be classified.");
    expect(markup).toContain("Suppressed checks are not counted as normal.");
    expect(markup.match(/data-priority-anomaly-trigger="true"/g)).toHaveLength(3);
    expect(markup.match(/data-anomaly-trigger="true"/g)).toHaveLength(7);
  });

  it("keeps the static Peak KPI when the optional breakdown is absent or invalid", () => {
    const absent = ngeeAnnGoldenSnapshot();
    delete absent.analysis.peakBreakdown;
    const invalid = ngeeAnnGoldenSnapshot();
    if (invalid.analysis.peakBreakdown?.status === "available") {
      invalid.analysis.peakBreakdown.levels[0]!.circuits[0]!.sharePct = null;
    }

    for (const snapshot of [absent, invalid]) {
      const markup = renderToStaticMarkup(
        <NgeeAnnOverviewRenderer state={{ status: "ready", snapshot }} />,
      );
      expect(markup).toContain("20.67");
      expect(markup).toContain("Breakdown unavailable");
      expect(markup).not.toContain("View peak breakdown");
    }
  });

  it("keeps Category facts visible when explicit Circuit and accounting evidence is unavailable", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    delete snapshot.analysis.topCircuits[0]!.includedInOfficialTotal;
    delete snapshot.analysis.topCircuits[0]!.parentScopeId;
    delete snapshot.analysis.componentReconciliation;

    const markup = renderToStaticMarkup(
      <NgeeAnnOverviewRenderer state={{ status: "ready", snapshot }} />,
    );

    expect(markup).toContain("Where the energy went");
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

  const peakTrigger = () => Array.from(container.querySelectorAll("button"))
    .find((candidate) => candidate.textContent === "View peak breakdown") as HTMLButtonElement;

  const peakDialog = () => document.querySelector<HTMLDivElement>('[role="dialog"][aria-modal="true"]');

  const peakScopeButton = (label: string) => {
    const dialog = peakDialog();
    const fieldset = Array.from(dialog?.querySelectorAll("fieldset") ?? [])
      .find((candidate) => candidate.querySelector("legend")?.textContent === "Peak breakdown Scope");
    return Array.from(fieldset?.querySelectorAll("button") ?? [])
      .find((candidate) => candidate.textContent === label) as HTMLButtonElement | undefined;
  };

  const anomalyTriggers = () => Array.from(
    container.querySelectorAll<HTMLButtonElement>('button[data-anomaly-trigger="true"]'),
  );

  const decisionEvidenceTrigger = () => Array.from(container.querySelectorAll<HTMLAnchorElement>("a"))
    .find((candidate) => candidate.textContent === "View supporting evidence") as HTMLAnchorElement;

  const anomalyDialog = () => document.querySelector<HTMLDivElement>(
    '[role="dialog"][aria-labelledby="ngee-ann-anomaly-dialog-title"]',
  );

  const anomalyFilterButton = (legend: string, label: string) => {
    const dialog = anomalyDialog();
    const fieldset = Array.from(dialog?.querySelectorAll("fieldset") ?? [])
      .find((candidate) => candidate.querySelector("legend")?.textContent === legend);
    return Array.from(fieldset?.querySelectorAll("button") ?? [])
      .find((candidate) => candidate.textContent === label) as HTMLButtonElement | undefined;
  };

  const samePeriodAnomalyRefreshCases: Array<{
    name: string;
    mutate: (snapshot: ReturnType<typeof ngeeAnnGoldenSnapshot>) => void;
  }> = [
    {
      name: "Snapshot",
      mutate: (snapshot) => {
        snapshot.dataSnapshot.id = "snapshot-ngee-ann-refresh";
        snapshot.context.dataSnapshotId = "snapshot-ngee-ann-refresh";
        snapshot.analysis.context.dataSnapshotId = "snapshot-ngee-ann-refresh";
        snapshot.analysis.provenance.dataSnapshotId = "snapshot-ngee-ann-refresh";
        if (snapshot.analysis.dailyUsageAnomalies?.status === "available") {
          snapshot.analysis.dailyUsageAnomalies.evidencePins.dataSnapshotId = "snapshot-ngee-ann-refresh";
        }
      },
    },
    {
      name: "Release",
      mutate: (snapshot) => {
        snapshot.projectRelease.id = "release-ngee-ann-refresh";
        snapshot.context.projectReleaseId = "release-ngee-ann-refresh";
        if (snapshot.analysis.dailyUsageAnomalies?.status === "available") {
          snapshot.analysis.dailyUsageAnomalies.evidencePins.projectReleaseId = "release-ngee-ann-refresh";
        }
      },
    },
    {
      name: "bundle",
      mutate: (snapshot) => {
        if (snapshot.analysis.dailyUsageAnomalies?.status === "available") {
          snapshot.analysis.dailyUsageAnomalies.bundleId = "anomaly-bundle-ngee-ann-refresh";
        }
      },
    },
  ];

  it("opens the dialog, enters focus, selects a Level and expands server Circuit evidence", async () => {
    await renderGolden();
    const trigger = peakTrigger();
    expect(trigger).toBeTruthy();

    await activateNativeButton(trigger, "Enter");
    const dialog = peakDialog()!;
    expect(dialog).toBeTruthy();
    expect((document.activeElement as HTMLElement)?.textContent).toBe("Close");
    expect(peakScopeButton("All Project")?.getAttribute("aria-pressed")).toBe("true");
    expect(dialog.textContent).toContain("12.0637 kW");
    expect(dialog.textContent).toContain("8.6094 kW");

    await act(async () => peakScopeButton("Level 7")?.click());
    expect(peakScopeButton("Level 7")?.getAttribute("aria-pressed")).toBe("true");
    expect(dialog.textContent).toContain("Level 7 official contribution");
    const circuitDisclosure = Array.from(dialog.querySelectorAll("details"))
      .find((details) => details.querySelector("summary")?.textContent?.includes("Circuit evidence"))!;
    expect(circuitDisclosure.open).toBe(false);
    await act(async () => circuitDisclosure.querySelector("summary")?.click());
    expect(circuitDisclosure.open).toBe(true);
    const rows = Array.from(dialog.querySelectorAll<HTMLTableRowElement>("[data-peak-circuit-row]"));
    expect(rows).toHaveLength(7);
    expect(rows[0]?.textContent).toContain("mapping-lvl-7-office-load-4-l1p22-l3p25-fan-isol1-2-16");
    expect(dialog.textContent).toContain("Explanatory only; component Circuits are not added");

    await act(async () => peakScopeButton("Level 6")?.click());
    const level6Disclosure = Array.from(dialog.querySelectorAll("details"))
      .find((details) => details.querySelector("summary")?.textContent?.includes("Circuit evidence"))!;
    expect(level6Disclosure.open).toBe(false);
  });

  it("closes through Close and Escape, restores focus and resets All Project", async () => {
    await renderGolden();
    const trigger = peakTrigger();
    await act(async () => trigger.click());
    await act(async () => peakScopeButton("Level 7")?.click());
    expect(peakScopeButton("Level 7")?.getAttribute("aria-pressed")).toBe("true");

    const closeButton = Array.from(peakDialog()!.querySelectorAll("button"))
      .find((button) => button.textContent === "Close") as HTMLButtonElement;
    await act(async () => closeButton.click());
    expect(peakDialog()).toBeNull();
    expect(document.activeElement).toBe(trigger);

    await activateNativeButton(trigger, " ");
    expect(peakScopeButton("All Project")?.getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(peakDialog()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("traps Tab focus inside the Peak dialog", async () => {
    await renderGolden();
    await act(async () => peakTrigger().click());
    const dialog = peakDialog()!;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      "button:not([disabled]), summary, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
    ));
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    expect(document.activeElement).toBe(first);

    await act(async () => last.focus());
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(document.activeElement).toBe(first);

    await act(async () => first.focus());
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    });
    expect(document.activeElement).toBe(last);
  });

  it("keeps a partial Period and unavailable Circuit row honest inside the dialog", async () => {
    const snapshot = ngeeAnnGoldenSnapshot({
      dataStatus: "partial",
      coveragePct: 75,
      validIntervalCount: 2_016,
    });
    if (snapshot.analysis.peakBreakdown?.status === "available") {
      const circuit = snapshot.analysis.peakBreakdown.levels[0]!.circuits[0]!;
      circuit.averageKw = null;
      circuit.sharePct = null;
      circuit.dataHealth = {
        status: "unavailable",
        coveragePct: 0,
        expectedMeterIntervalCount: 1,
        validIntervalCount: 0,
        qualityEventCount: 1,
      };
    }
    await renderGolden(snapshot);
    await act(async () => peakTrigger().click());
    const dialog = peakDialog()!;
    expect(dialog.textContent).toContain("This Period is incomplete (75% coverage)");
    expect(dialog.textContent).toContain("highest complete observed interval");

    await act(async () => peakScopeButton("Level 7")?.click());
    const disclosure = Array.from(dialog.querySelectorAll("details"))
      .find((details) => details.querySelector("summary")?.textContent?.includes("Circuit evidence"))!;
    await act(async () => disclosure.querySelector("summary")?.click());
    expect(disclosure.textContent).toContain("Unavailable");
    expect(disclosure.textContent).toContain("0% coverage");
    expect(disclosure.textContent).toContain("0 / 1 valid intervals");
    expect(disclosure.textContent).toContain("1 quality events");
  });

  it("shows an honest empty Circuit evidence state for a selected Level", async () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    if (snapshot.analysis.peakBreakdown?.status === "available") {
      snapshot.analysis.peakBreakdown.levels[1]!.circuits = [];
    }
    await renderGolden(snapshot);
    await act(async () => peakTrigger().click());
    await act(async () => peakScopeButton("Level 6")?.click());
    const disclosure = Array.from(peakDialog()!.querySelectorAll("details"))
      .find((details) => details.querySelector("summary")?.textContent?.includes("Circuit evidence"))!;
    await act(async () => disclosure.querySelector("summary")?.click());

    expect(disclosure.textContent).toContain("Circuit evidence unavailable for this Level.");
    expect(disclosure.querySelectorAll("[data-peak-circuit-row]")).toHaveLength(0);
  });

  it("switches authoritative trend Scopes and exposes point detail through focus and keyboard selection", async () => {
    await renderGolden();

    const projectButton = filterButton("Energy trend Scope", "Project")!;
    const level7Button = filterButton("Energy trend Scope", "Level 7")!;
    expect(projectButton.getAttribute("aria-pressed")).toBe("true");
    expect(level7Button.getAttribute("aria-pressed")).toBe("false");

    const projectPoint = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Wed 10 Jun: current 253.7018 kWh"]',
    )!;
    await act(async () => projectPoint.focus());
    expect(container.textContent).toContain("253.7018 kWh");
    expect(container.textContent).toContain("Governed baseline 218.88 kWh");
    expect(container.textContent).toContain("Delta +34.82 kWh (+15.9%)");
    expect(container.textContent).toContain("Within rule threshold");
    expect(container.textContent).toContain("Complete / 100% coverage / 384 / 384 valid intervals");

    await activateNativeButton(projectPoint, "Enter");
    await act(async () => projectPoint.blur());
    expect(projectPoint.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("253.7018 kWh");

    const triggeredPoint = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Thu 11 Jun: current 268.399 kWh"]',
    )!;
    await act(async () => triggeredPoint.focus());
    const ruleEvidenceLink = Array.from(container.querySelectorAll<HTMLAnchorElement>("a"))
      .find((link) => link.textContent?.includes("Open rule evidence"));
    expect(ruleEvidenceLink?.getAttribute("href")).toBe("#incident-project-2026-06-11");
    await act(async () => triggeredPoint.blur());

    await activateNativeButton(level7Button, " ");
    expect(projectButton.getAttribute("aria-pressed")).toBe("false");
    expect(level7Button.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("Hover or focus a day to inspect accepted usage and coverage.");

    const level7Point = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Wed 10 Jun: current 157.1325 kWh"]',
    )!;
    await act(async () => level7Point.focus());
    expect(container.textContent).toContain("157.1325 kWh");
    expect(container.textContent).toContain("Governed baseline 138.88 kWh");
  });

  it("opens a frozen daily incident, switches exact server modes, closes and restores trigger focus", async () => {
    await renderGolden();
    expect(anomalyTriggers()).toHaveLength(7);
    const trigger = anomalyTriggers()[0]!;

    await activateNativeButton(trigger, "Enter");
    let dialog = anomalyDialog()!;
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain("Project / Thu 11 Jun");
    expect((document.activeElement as HTMLElement)?.textContent).toBe("Close");
    expect(anomalyFilterButton("Comparison view", "Overlay")?.getAttribute("aria-pressed")).toBe("true");
    expect(dialog.querySelectorAll("[data-anomaly-series]")).toHaveLength(3);
    expect(dialog.textContent).toContain("Official Scope series · included in the official total");
    expect(dialog.textContent).not.toContain("路");

    let point = dialog.querySelector<HTMLButtonElement>('[data-anomaly-series="scope:project"] button')!;
    const anomalySeries = dialog.querySelector<HTMLElement>('[data-anomaly-series="scope:project"]')!;
    const anomalyPlot = anomalySeries.querySelector<HTMLElement>("[data-hour-plot='anomaly-series']");
    const anomalyAxis = anomalySeries.querySelector<HTMLElement>("[data-hour-axis='anomaly-series']");
    expect(anomalyPlot?.nextElementSibling).toBe(anomalyAxis);
    expect(point.textContent).toBe("");
    expect(anomalyAxis?.textContent).toContain("00:00");
    expect(anomalyAxis?.textContent).toContain("21:00");
    expect(point.getAttribute("aria-label")).toContain("selected");
    expect(point.getAttribute("aria-label")).toContain("average");
    await act(async () => point.focus());
    expect(dialog.textContent).toContain("Impact");

    await act(async () => anomalyFilterButton("Comparison view", "Selected")?.click());
    point = dialog.querySelector<HTMLButtonElement>('[data-anomaly-series="scope:project"] button')!;
    expect(point.getAttribute("aria-label")).toContain("selected");
    expect(point.getAttribute("aria-label")).not.toContain("average");
    await act(async () => point.focus());
    const selectedDetail = dialog.querySelector('[aria-live="polite"]')?.textContent ?? "";
    expect(selectedDetail).toContain("Selected");
    expect(selectedDetail).not.toContain("Average");
    expect(selectedDetail).not.toContain("Impact");

    await act(async () => anomalyFilterButton("Comparison view", "Average")?.click());
    point = dialog.querySelector<HTMLButtonElement>('[data-anomaly-series="scope:project"] button')!;
    expect(point.getAttribute("aria-label")).not.toContain("selected");
    expect(point.getAttribute("aria-label")).toContain("average");
    await act(async () => point.focus());
    const averageDetail = dialog.querySelector('[aria-live="polite"]')?.textContent ?? "";
    expect(averageDetail).not.toContain("Selected");
    expect(averageDetail).toContain("Average");
    expect(averageDetail).not.toContain("Impact");

    const close = Array.from(dialog.querySelectorAll("button"))
      .find((button) => button.textContent === "Close") as HTMLButtonElement;
    await act(async () => close.click());
    expect(anomalyDialog()).toBeNull();
    expect(document.activeElement).toBe(trigger);

    await activateNativeButton(trigger, " ");
    dialog = anomalyDialog()!;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      "button:not([disabled]), summary, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
    ));
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    await act(async () => last.focus());
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(document.activeElement).toBe(first);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(anomalyDialog()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("opens the primary incident dialog directly from its Decision theme and restores that link", async () => {
    await renderGolden();
    const trigger = decisionEvidenceTrigger();
    expect(trigger.getAttribute("href")).toBe("#incident-project-2026-06-13");

    await act(async () => trigger.click());
    const dialog = anomalyDialog()!;
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain("Project / Sat 13 Jun");
    expect((document.activeElement as HTMLElement)?.textContent).toBe("Close");

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(anomalyDialog()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("filters an L7 incident by frozen Scope and Load/Light component categories only", async () => {
    await renderGolden();
    await act(async () => anomalyTriggers()[3]!.click());
    const dialog = anomalyDialog()!;

    expect(dialog.textContent).toContain("Level 7 / Thu 11 Jun");
    expect(dialog.querySelectorAll("[data-anomaly-series]")).toHaveLength(3);
    await act(async () => anomalyFilterButton("Category", "Load")?.click());
    expect(dialog.querySelectorAll("[data-anomaly-series]")).toHaveLength(1);
    expect(dialog.querySelector('[data-anomaly-series="meter:l7-anomaly-load"]')).toBeTruthy();
    expect(dialog.textContent).toContain("Explanatory component · not included in the official total");

    await act(async () => anomalyFilterButton("Category", "Light")?.click());
    expect(dialog.querySelectorAll("[data-anomaly-series]")).toHaveLength(1);
    expect(dialog.querySelector('[data-anomaly-series="meter:l7-anomaly-light"]')).toBeTruthy();

    await act(async () => anomalyFilterButton("Category", "All")?.click());
    await act(async () => anomalyFilterButton("Scope", "Level 7 component Load")?.click());
    expect(dialog.querySelectorAll("[data-anomaly-series]")).toHaveLength(1);
    expect(dialog.querySelector('[data-anomaly-series="meter:l7-anomaly-load"]')).toBeTruthy();
    expect(dialog.textContent).toContain("1 evidence series");
  });

  it("keeps a partial anomaly detail series explicit and never zero-fills its missing hour", async () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    if (snapshot.analysis.dailyUsageAnomalies?.status === "available") {
      const component = snapshot.analysis.dailyUsageAnomalies.scopes[1]!.rows[1]!.detailSeries[1]!;
      component.status = "partial";
      component.selectedTotalKwh = null;
      component.points[0]!.selectedKwh = null;
      component.points[0]!.impactKwh = null;
    }
    await renderGolden(snapshot);
    await act(async () => anomalyTriggers()[3]!.click());
    const dialog = anomalyDialog()!;
    await act(async () => anomalyFilterButton("Category", "Load")?.click());

    const series = dialog.querySelector<HTMLElement>('[data-anomaly-series="meter:l7-anomaly-load"]')!;
    expect(series.textContent).toContain("Partial");
    const missingPoint = series.querySelector<HTMLButtonElement>("button")!;
    expect(missingPoint.getAttribute("aria-label")).toContain("selected unavailable");
    expect(missingPoint.getAttribute("aria-label")).not.toContain("selected 0.0000 kWh");
  });

  it.each(samePeriodAnomalyRefreshCases)(
    "resets dialog, modes, filters and stale focus on a same-Period $name refresh",
    async ({ mutate }) => {
      await renderGolden();
      await act(async () => anomalyTriggers()[3]!.click());
      await act(async () => anomalyFilterButton("Comparison view", "Average")?.click());
      await act(async () => anomalyFilterButton("Category", "Load")?.click());
      await act(async () => anomalyFilterButton("Scope", "Level 7 component Load")?.click());
      const oldDialog = anomalyDialog()!;
      const oldFocusedPoint = oldDialog.querySelector<HTMLButtonElement>(
        '[data-anomaly-series="meter:l7-anomaly-load"] button',
      )!;
      await act(async () => oldFocusedPoint.focus());
      expect(document.activeElement).toBe(oldFocusedPoint);

      const refreshed = ngeeAnnGoldenSnapshot();
      mutate(refreshed);
      await act(async () => {
        root.render(<NgeeAnnOverviewRenderer state={{ status: "ready", snapshot: refreshed }} />);
      });

      expect(anomalyDialog()).toBeNull();
      expect(oldFocusedPoint.isConnected).toBe(false);
      expect(document.activeElement).not.toBe(oldFocusedPoint);
      await act(async () => anomalyTriggers()[3]!.click());
      expect((document.activeElement as HTMLElement)?.textContent).toBe("Close");
      expect(anomalyFilterButton("Comparison view", "Overlay")?.getAttribute("aria-pressed")).toBe("true");
      expect(anomalyFilterButton("Scope", "All")?.getAttribute("aria-pressed")).toBe("true");
      expect(anomalyFilterButton("Category", "All")?.getAttribute("aria-pressed")).toBe("true");
    },
  );

  it("renders and operates 24 server hours for a single-day Period without dailyTotals", async () => {
    const snapshot = ngeeAnnSingleDaySnapshot({ includeDailyTotals: false });
    await renderGolden(snapshot);

    expect(container.textContent).toContain("24 hourly buckets");
    expect(container.textContent).toContain("Trend evidence / time_bucket_grid_v1");
    const firstHour = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="16 Jun 00:00: 5.3565 kWh"]',
    )!;
    const trendPlot = container.querySelector<HTMLElement>("[data-hour-plot='energy-trend']");
    const trendAxis = container.querySelector<HTMLElement>("[data-hour-axis='energy-trend']");
    expect(trendPlot?.nextElementSibling).toBe(trendAxis);
    expect(firstHour.textContent).toBe("");
    expect(trendAxis?.textContent).toContain("00:00");
    expect(trendAxis?.textContent).toContain("21:00");
    await act(async () => firstHour.focus());
    expect(container.textContent).toContain("5.3565 kWh");
    expect(container.textContent).toContain("Complete / 100% coverage / 16 / 16 valid intervals");
    await activateNativeButton(firstHour, "Enter");
    await act(async () => firstHour.blur());
    expect(firstHour.getAttribute("aria-pressed")).toBe("true");

    await act(async () => filterButton("Energy trend Scope", "Level 7")?.click());
    expect(container.textContent).toContain("Hover or focus an hour");
  });

  it("clears Trend, Day Profile and Heatmap selections when the authoritative Period changes", async () => {
    await renderGolden();
    const trendPoint = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Wed 10 Jun: current 253.7018 kWh"]',
    )!;
    await act(async () => trendPoint.click());
    await act(async () => filterButton("Day Profile type", "Weekend")?.click());
    await act(async () => filterButton("Day Profile Scope", "Level 7")?.click());
    const profilePoint = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Weekend Level 7 00:00:"]',
    )!;
    await act(async () => profilePoint.click());
    await act(async () => filterButton("Heatmap view", "Date × hour")?.click());
    await act(async () => filterButton("Heatmap Level", "Level 7")?.click());
    const heatmapCell = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Wed 10 Jun / Wed 10 Jun 00:00:"]',
    )!;
    await act(async () => heatmapCell.click());
    await act(async () => anomalyTriggers()[0]!.click());
    await act(async () => anomalyFilterButton("Comparison view", "Average")?.click());
    expect(trendPoint.getAttribute("aria-pressed")).toBe("true");
    expect(profilePoint.getAttribute("aria-pressed")).toBe("true");
    expect(heatmapCell.getAttribute("aria-pressed")).toBe("true");
    expect(anomalyDialog()).toBeTruthy();
    expect(anomalyFilterButton("Comparison view", "Average")?.getAttribute("aria-pressed")).toBe("true");

    const next = ngeeAnnSingleDaySnapshot({ includeDailyTotals: false });
    await act(async () => {
      root.render(<NgeeAnnOverviewRenderer state={{ status: "ready", snapshot: next }} />);
    });

    expect(container.textContent).toContain("24 hourly buckets");
    expect(filterButton("Energy trend Scope", "Project")?.getAttribute("aria-pressed")).toBe("true");
    expect(filterButton("Day Profile type", "Weekday")?.getAttribute("aria-pressed")).toBe("true");
    expect(filterButton("Day Profile Scope", "Project")?.getAttribute("aria-pressed")).toBe("true");
    expect(filterButton("Heatmap view", "Level × hour average")?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector<HTMLButtonElement>(
      'button[aria-label^="16 Jun 00:00: 5.3565 kWh"]',
    )?.getAttribute("aria-pressed")).toBe("false");
    expect(container.textContent).toContain("Hover or focus an hour");
    expect(anomalyDialog()).toBeNull();
    expect(container.textContent).toContain("Usage exception analysis unavailable");
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
      'button[aria-label*="268.399 kWh; Partial; 75% coverage"]',
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

  it("switches server Day Type and Scope profiles, exposes keyboard detail, and recovers from explicit empty", async () => {
    await renderGolden();

    const weekday = filterButton("Day Profile type", "Weekday")!;
    const weekend = filterButton("Day Profile type", "Weekend")!;
    const publicHoliday = filterButton("Day Profile type", "Public Holiday")!;
    const project = filterButton("Day Profile Scope", "Project")!;
    const level7 = filterButton("Day Profile Scope", "Level 7")!;
    expect(weekday.getAttribute("aria-pressed")).toBe("true");
    expect(project.getAttribute("aria-pressed")).toBe("true");

    await act(async () => weekend.click());
    await act(async () => level7.click());
    expect(weekend.getAttribute("aria-pressed")).toBe("true");
    expect(level7.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("2 complete days / 24 server values");

    const profileHour = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Weekend Level 7 00:00:"]',
    )!;
    const profilePlot = container.querySelector<HTMLElement>("[data-hour-plot='day-profile']");
    const profileTimeAxis = container.querySelector<HTMLElement>("[data-hour-axis='day-profile']");
    expect(profilePlot).toBeTruthy();
    expect(profileTimeAxis).toBeTruthy();
    expect(profilePlot?.nextElementSibling).toBe(profileTimeAxis);
    expect(profileHour.textContent).toBe("");
    expect(profileTimeAxis?.textContent).toContain("00:00");
    expect(profileTimeAxis?.textContent).toContain("21:00");
    await act(async () => profileHour.focus());
    expect(container.textContent).toContain("Weekend / Level 7");
    expect(container.textContent).toContain("2 complete-day samples / mean_of_complete_local_days");
    await activateNativeButton(profileHour, "Enter");
    await act(async () => profileHour.blur());
    expect(profileHour.getAttribute("aria-pressed")).toBe("true");

    await act(async () => publicHoliday.click());
    expect(container.textContent).toContain("Public Holiday / Level 7 unavailable");
    expect(container.textContent).toContain("requires an authoritative release-pinned Calendar classification");
    expect(container.textContent).toContain("No value is inferred or zero-filled");

    await act(async () => weekday.click());
    expect(container.textContent).toContain("5 complete days / 24 server values");
    expect(container.textContent).toContain("Hover or focus an hour");
  });

  it("switches Heatmap Level and View, exposes the same cell by hover/focus, and clears stale detail", async () => {
    await renderGolden();

    const dateHour = filterButton("Heatmap view", "Date × hour")!;
    const levelHour = filterButton("Heatmap view", "Level × hour average")!;
    const weekday = filterButton("Average day type", "Weekday")!;
    expect(levelHour.getAttribute("aria-pressed")).toBe("true");
    expect(weekday.getAttribute("aria-pressed")).toBe("true");
    expect(filterButton("Heatmap Level", "Project")).toBeUndefined();
    const averageCell = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Project / Weekday 00:00: mean"]',
    )!;
    await act(async () => averageCell.focus());
    expect(container.textContent).toContain("Project / Weekday / 00:00");
    expect(container.textContent).toContain("5 complete-day samples / mean_of_complete_local_days");
    await activateNativeButton(averageCell, "Enter");
    await act(async () => averageCell.blur());
    expect(averageCell.getAttribute("aria-pressed")).toBe("true");

    await act(async () => dateHour.click());
    const project = filterButton("Heatmap Level", "Project")!;
    const level7 = filterButton("Heatmap Level", "Level 7")!;
    expect(project.getAttribute("aria-pressed")).toBe("true");
    await act(async () => level7.click());
    expect(level7.getAttribute("aria-pressed")).toBe("true");
    const dateCell = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Wed 10 Jun / Wed 10 Jun 00:00:"]',
    )!;
    await act(async () => dateCell.focus());
    expect(container.textContent).toContain("Level 7 / Wed 10 Jun / 00:00");
    expect(container.textContent).toContain("Complete / 100% coverage / 8 / 8 valid intervals");
    await activateNativeButton(dateCell, "Enter");
    await act(async () => dateCell.blur());
    expect(dateCell.getAttribute("aria-pressed")).toBe("true");

    await act(async () => levelHour.click());
    expect(levelHour.getAttribute("aria-pressed")).toBe("true");
    expect(filterButton("Heatmap Level", "Project")).toBeUndefined();
    expect(container.textContent).toContain("Hover or keyboard-focus a cell");
  });

  it("keeps partial and unavailable Heatmap cells explicit and keyboard inspectable", async () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const cells = snapshot.analysis.timeBehaviour!.scopes[0]!.cells;
    cells[0]!.dataHealth = {
      status: "partial",
      coveragePct: 75,
      expectedMeterIntervalCount: 16,
      validIntervalCount: 12,
      qualityEventCount: 1,
    };
    cells[1]!.usageKwh = null;
    cells[1]!.dataHealth = {
      status: "unavailable",
      coveragePct: 0,
      expectedMeterIntervalCount: 16,
      validIntervalCount: 0,
      qualityEventCount: 2,
    };
    await renderGolden(snapshot);
    await act(async () => filterButton("Heatmap view", "Date × hour")?.click());

    const partial = container.querySelector<HTMLButtonElement>(
      'button[aria-label*="00:00:"][aria-label*="Partial; 75% coverage"]',
    )!;
    const unavailable = container.querySelector<HTMLButtonElement>(
      'button[aria-label*="01:00: no accepted facts; Unavailable; 0% coverage"]',
    )!;
    expect(partial).toBeTruthy();
    expect(unavailable).toBeTruthy();
    await act(async () => partial.focus());
    expect(container.textContent).toContain("Partial / 75% coverage / 12 / 16 valid intervals / 1 quality events");
    await act(async () => unavailable.focus());
    expect(container.textContent).toContain("No accepted facts");
    expect(container.textContent).toContain("Unavailable / 0% coverage / 0 / 16 valid intervals / 2 quality events");
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
    expect(container.textContent).toContain("Largest component Circuits");

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

  it("uses the URL-backed Category as the initial Composition filter", async () => {
    await act(async () => {
      root.render(
        <NgeeAnnOverviewRenderer
          state={{ status: "ready", snapshot: ngeeAnnGoldenSnapshot() }}
          category="light"
        />,
      );
    });

    const lightButton = filterButton("Filter component Circuits by Category", "Light");
    expect(lightButton?.getAttribute("aria-pressed")).toBe("true");
    expect(circuitRows()).toHaveLength(5);
    expect(circuitRows().every((row) => row.dataset.categoryId === "light")).toBe(true);
    expect(container.textContent).toContain("Showing 5 of 5 matching component Circuits.");
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
    expect(accountingButton.getAttribute("aria-expanded")).toBe("false");
    expect(derivedButton.getAttribute("aria-expanded")).toBe("false");
    expect(accountingPanel.hidden).toBe(true);
    expect(derivedPanel.hidden).toBe(true);

    await activateNativeButton(accountingButton, " ");
    expect(accountingButton.getAttribute("aria-expanded")).toBe("true");
    expect(accountingPanel.hidden).toBe(false);
    expect(derivedButton.getAttribute("aria-expanded")).toBe("false");

    await activateNativeButton(derivedButton, "Enter");
    expect(derivedButton.getAttribute("aria-expanded")).toBe("true");
    expect(derivedPanel.hidden).toBe(false);
    expect(derivedPanel.textContent).toContain("Result 49.0218 kWh");

    await activateNativeButton(accountingButton, " ");
    expect(accountingButton.getAttribute("aria-expanded")).toBe("false");
    expect(derivedButton.getAttribute("aria-expanded")).toBe("false");
    expect(accountingPanel.hidden).toBe(true);
    expect(derivedPanel.hidden).toBe(true);
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
