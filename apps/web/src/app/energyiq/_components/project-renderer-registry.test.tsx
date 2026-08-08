import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ProjectRenderer,
  selectProjectRenderer,
} from "./project-renderer-registry";
import { ngeeAnnGoldenSnapshot } from "./ngee-ann-overview.test-fixture";
import { preschoolGoldenSnapshot } from "./preschool-overview.test-fixture";

const emptyPlan = {
  template_id: "project",
  target_kind: "project" as const,
  sections: [],
  module_count: 0,
};

describe("Project Renderer Registry", () => {
  it("selects the registered Ngee Ann, Preschool and Admin Generic Preview renderers", () => {
    expect(selectProjectRenderer({ mode: "customer", rendererKey: "ngee-ann-overview" }))
      .toMatchObject({ status: "ready", key: "ngee-ann-overview", version: "1" });
    expect(selectProjectRenderer({ mode: "customer", rendererKey: "preschool-overview" }))
      .toMatchObject({ status: "ready", key: "preschool-overview", version: "1" });
    expect(selectProjectRenderer({ mode: "admin-preview" }))
      .toMatchObject({ status: "ready", key: "admin-generic-preview", version: "1" });
  });

  it("renders a concise configuration state for an unregistered customer Project", () => {
    const selection = selectProjectRenderer({ mode: "customer", rendererKey: null });
    expect(selection).toEqual({
      status: "configuration-required",
      title: "Project analysis is not configured",
      detail: "Ask an administrator to publish a Project Template Revision with a registered customer Renderer.",
    });

    const markup = renderToStaticMarkup(
      <ProjectRenderer
        request={{ mode: "customer", rendererKey: null }}
        state={{
          status: "loading",
          title: "This generic dashboard must not render",
          detail: "No published customer Renderer exists.",
        }}
      />,
    );
    expect(markup).toContain("Project analysis is not configured");
    expect(markup).not.toContain("This generic dashboard must not render");
  });

  it("routes Ngee Ann and Preschool to independent Snapshot Renderers", () => {
    const state = {
      status: "ready" as const,
      snapshot: ngeeAnnGoldenSnapshot(),
      plan: emptyPlan,
    };

    const ngeeAnnMarkup = renderToStaticMarkup(
      <ProjectRenderer
        request={{ mode: "customer", rendererKey: "ngee-ann-overview" }}
        state={state}
      />,
    );
    const preschoolSnapshot = preschoolGoldenSnapshot();
    if (preschoolSnapshot.preschoolOperational?.status !== "available") {
      throw new Error("Expected operational Preschool fixture");
    }
    const exceptionCentre = preschoolSnapshot.preschoolOperational.spikes.standby.centres
      .find((centre) => centre.centreCode === "E");
    if (!exceptionCentre) throw new Error("Expected Centre E standby Spike fixture");
    exceptionCentre.worstSpike.localDate = "2026-05-27";
    exceptionCentre.worstSpike.dayType = "calendar_exception";
    const preschoolMarkup = renderToStaticMarkup(
      <ProjectRenderer
        request={{ mode: "customer", rendererKey: "preschool-overview" }}
        state={{ status: "ready", snapshot: preschoolSnapshot, plan: emptyPlan }}
        aiAnalystHref="/energyiq/ai?projectId=preschool-demo"
      />,
    );

    expect(ngeeAnnMarkup).toContain("data-ngee-ann-overview=\"true\"");
    expect(ngeeAnnMarkup).toContain("1531.1683");
    expect(ngeeAnnMarkup).not.toContain("No modules are enabled");
    expect(preschoolMarkup).toContain("data-preschool-overview=\"true\"");
    expect(preschoolMarkup).toContain("24,921.81 kWh");
    expect(preschoolMarkup).toContain("Centre A");
    expect(preschoolMarkup).toContain("Efficiency benchmark");
    expect(preschoolMarkup).not.toContain("P50 / P75 peer benchmark");
    expect(preschoolMarkup).toContain("Review first: G · M · J");
    expect(preschoolMarkup).toContain("10.53 kWh/m²/yr");
    expect(preschoolMarkup).toContain("20.8 kWh/person");
    expect(preschoolMarkup).toContain("data-benchmark-plot=\"eui-x-per-pax-y\"");
    expect(preschoolMarkup.match(/data-benchmark-centre=/g)).toHaveLength(30);
    expect(preschoolMarkup).toMatch(/data-benchmark-centre=\"A\"[^>]*data-marker-shape=\"circle\"/);
    expect(preschoolMarkup).toMatch(/data-benchmark-centre=\"B\"[^>]*data-marker-shape=\"triangle\"/);
    expect(preschoolMarkup).toMatch(/data-benchmark-centre=\"C\"[^>]*data-marker-shape=\"diamond\"/);
    expect(preschoolMarkup).toContain("Senior Care Center · circle");
    expect(preschoolMarkup).toContain("Active Aging Center · triangle");
    expect(preschoolMarkup).toContain("Preschool · diamond");
    expect(preschoolMarkup).toContain("data-benchmark-p75-axis=\"eui\"");
    expect(preschoolMarkup).toContain("data-benchmark-p75-axis=\"per-pax\"");
    expect(preschoolMarkup.match(/data-benchmark-priority-label=/g)).toHaveLength(3);
    expect(preschoolMarkup).toContain("Annualised EUI (kWh/m²/yr) →");
    expect(preschoolMarkup).toContain("↑ May per-pax (kWh/person)");
    expect(preschoolMarkup.match(/data-benchmark-distribution=/g)).toHaveLength(2);
    expect(preschoolMarkup.match(/data-benchmark-lane=/g)).toHaveLength(6);
    expect(preschoolMarkup.match(/data-distribution-centre=/g)).toHaveLength(60);
    expect(preschoolMarkup).toContain("data-shared-axis=\"eui\"");
    expect(preschoolMarkup).toContain("data-shared-axis=\"per-pax\"");
    expect(preschoolMarkup).toContain("Annualised May EUI estimate");
    expect(preschoolMarkup).toContain("May energy per person");
    expect(preschoolMarkup).toContain("Each dot is one Centre");
    expect(preschoolMarkup).toContain("Empirical distribution — not a fitted bell curve");
    expect(preschoolMarkup).toContain("Typical (P50)");
    expect(preschoolMarkup).toContain("Review above (P75)");
    expect(preschoolMarkup).not.toMatch(/Std Dev|Mean \(μ\)/i);
    expect(preschoolMarkup).toContain("Operating patterns");
    expect(preschoolMarkup).toContain('data-operating-profile="hourly-calendar-split"');
    expect(preschoolMarkup.match(/data-profile-hour=/g)).toHaveLength(24);
    expect(preschoolMarkup).toContain("Average hourly energy split by operating and closed hours");
    expect(preschoolMarkup).toContain("3,103.78 kWh · 12.5%");
    expect(preschoolMarkup).toContain("21,818.03 kWh");
    expect(preschoolMarkup).toContain("Spikes · 14 Centres");
    expect(preschoolMarkup).toContain("Provisional after-hours SOP signal");
    expect(preschoolMarkup).toContain("L · Preschool · 4 Spikes");
    expect(preschoolMarkup).toContain("A · Senior Care Center · 8 Spikes");
    expect(preschoolMarkup).toContain("25 May · 01:00–02:00 · Weekend");
    expect(preschoolMarkup).toContain("27 May · 22:00–23:00 · Calendar exception");
    expect(preschoolMarkup).toContain("18 May · 14:00–15:00 · Weekday");
    expect(preschoolMarkup).not.toContain("Public Holiday");
    expect(preschoolMarkup).toContain("data-sop-centre-type=\"Preschool\"");
    expect(preschoolMarkup).toContain("Overall consumption summary");
    expect(preschoolMarkup.match(/data-overall-summary-metric=/g)).toHaveLength(3);
    expect(preschoolMarkup).toContain("Energy &amp; cost by centre type");
    expect(preschoolMarkup).toContain("S$0.2727/kWh before GST");
    expect(preschoolMarkup).toContain("Key findings and next steps");
    expect(preschoolMarkup).toContain("AI energy analyst");
    expect(preschoolMarkup).toContain("AI analysis queued…");
    expect(preschoolMarkup).toContain("deterministic Overview is ready");
    expect(preschoolMarkup).toContain("Centres L, E and N should be checked first for energy use after closing.");
    expect(preschoolMarkup).toContain("Centres G, M and J use more energy than expected for both their floor area and number of people.");
    expect(preschoolMarkup).toContain("14 centres had unusual energy peaks during opening hours.");
    expect(preschoolMarkup).toContain('data-decision-signal="after-hours"');
    expect(preschoolMarkup).toContain("12.5%</strong> of total energy");
    expect(preschoolMarkup).toContain("3 / 30</strong> centres");
    expect(preschoolMarkup).toContain("14 / 30</strong> centres");
    expect(preschoolMarkup).toContain("What to do next");
    expect(preschoolMarkup).toContain("Expected result");
    expect(preschoolMarkup).toContain("If no action is taken");
    expect(preschoolMarkup).toContain("What we cannot confirm");
    expect(preschoolMarkup).toContain("Where energy goes");
    expect(preschoolMarkup).toContain("5,200.00 kWh");
    expect(preschoolMarkup).toContain("9 Appliances");
    expect(preschoolMarkup).toContain("Leading appliance");
    expect(preschoolMarkup).not.toContain("Leading circuit");
    expect(preschoolMarkup).toContain("Published Circuit aliases");
    const afterHoursPriority = preschoolMarkup.indexOf('data-decision-priority="after-hours"');
    const efficiencyPriority = preschoolMarkup.indexOf('data-decision-priority="efficiency"');
    const operatingPriority = preschoolMarkup.indexOf('data-decision-priority="operating"');
    const aiSlot = preschoolMarkup.indexOf("AI energy analyst");
    expect(afterHoursPriority).toBeGreaterThan(-1);
    expect(efficiencyPriority).toBeGreaterThan(afterHoursPriority);
    expect(operatingPriority).toBeGreaterThan(efficiencyPriority);
    expect(aiSlot).toBeGreaterThan(operatingPriority);
    const decisionMarkup = preschoolMarkup.slice(afterHoursPriority, aiSlot);
    expect(decisionMarkup).toContain("Evidence · View supporting evidence");
    expect(decisionMarkup).not.toContain("preschool-hour-slot-spike-v1");
    expect(preschoolMarkup).toContain("June planning baseline");
    expect(preschoolMarkup).toContain('data-planning-baseline="naive-weekly-average"');
    expect(preschoolMarkup).toContain("24,348 kWh");
    expect(preschoolMarkup).toContain("S$6,640");
    expect(preschoolMarkup).toContain("27.27¢/kWh before GST");
    expect(preschoolMarkup).toContain("View official SP tariff source");
    expect(preschoolMarkup).toContain("not an AI forecast or customer bill");
    expect(preschoolMarkup).toContain("Live Forecast");
    expect(preschoolMarkup).toContain("published Forecast Recipe");
    expect(preschoolMarkup).toContain("View all 30 Centres and normalised metrics");
    expect(preschoolMarkup).not.toMatch(/28,011|7,639|simulated actual/i);
    expect(preschoolMarkup).not.toContain("The current Snapshot does not contain the published May benchmark projection");
    expect(preschoolMarkup).not.toContain("No modules are enabled");
    expect(preschoolMarkup).not.toContain("data-ngee-ann-overview");
  });
});
