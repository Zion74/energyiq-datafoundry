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
    expect(preschoolMarkup).toContain("Benchmark Analysis");
    expect(preschoolMarkup).not.toContain("P50 / P75 peer benchmark");
    expect(preschoolMarkup).toContain("Review first · action priority");
    expect(preschoolMarkup).toContain("12.90 kWh/m²/yr");
    expect(preschoolMarkup).toContain("22.9 kWh/person");
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
    expect(preschoolMarkup).toContain("↑ Energy per person (kWh/person/month)");
    expect(preschoolMarkup.match(/data-benchmark-distribution=/g)).toHaveLength(6);
    expect(preschoolMarkup.match(/data-distribution-centre=/g)).toHaveLength(60);
    expect(preschoolMarkup).toContain("data-shared-axis=\"eui\"");
    expect(preschoolMarkup).toContain("data-shared-axis=\"per-pax\"");
    expect(preschoolMarkup).toContain("Annualised EUI estimate");
    expect(preschoolMarkup).toContain("Energy per person");
    expect(preschoolMarkup).toContain("Observed Centres only. Bars show sample frequency; markers show each Centre. No fitted curve is used.");
    expect(preschoolMarkup).toContain("P50");
    expect(preschoolMarkup).toContain("P75");
    expect(preschoolMarkup).not.toMatch(/Std Dev|Mean \(μ\)/i);
    expect(preschoolMarkup).toContain("Standby Energy Wastage — Post Operating Hours");
    expect(preschoolMarkup).toContain('data-standby-kpis="five-decision-metrics"');
    expect(preschoolMarkup).toContain("3,103.78 kWh");
    expect(preschoolMarkup).toContain("S$846.40");
    expect(preschoolMarkup.match(/data-standby-appliance-group=/g)).toHaveLength(4);
    expect(preschoolMarkup.match(/data-standby-appliance=/g)).toHaveLength(9);
    expect(preschoolMarkup.match(/data-standby-spike-event=/g)).toHaveLength(7);
    expect(preschoolMarkup.match(/data-review-priority-centre=/g)).toHaveLength(3);
    expect(preschoolMarkup).toContain("After-hours Review Priority");
    expect(preschoolMarkup).not.toContain("SOP Compliance Score");
    expect(preschoolMarkup).toContain("Operating Hours Analysis");
    expect(preschoolMarkup).toContain("21,818.03 kWh");
    expect(preschoolMarkup).toContain("S$5,949.78");
    expect(preschoolMarkup).toContain('data-operating-kpis="five-decision-metrics"');
    expect(preschoolMarkup.match(/data-operating-appliance-group=/g)).toHaveLength(4);
    expect(preschoolMarkup.match(/data-operating-appliance=/g)).toHaveLength(9);
    expect(preschoolMarkup.match(/data-operating-spike-centre=/g)).toHaveLength(14);
    expect(preschoolMarkup.match(/data-operating-spike-event=/g)).toHaveLength(21);
    expect(preschoolMarkup).toContain("18 May · 14:00–15:00");
    expect(preschoolMarkup).toContain("observed leading contributor");
    expect(preschoolMarkup).not.toContain("Public Holiday");
    expect(preschoolMarkup).toContain("Overall consumption summary");
    expect(preschoolMarkup.match(/data-overall-summary-metric=/g)).toHaveLength(3);
    expect(preschoolMarkup).toContain("Energy &amp; cost by centre type");
    expect(preschoolMarkup).toContain("S$0.2727/kWh before GST");
    expect(preschoolMarkup).toContain("Key findings · Sections 2–5");
    expect(preschoolMarkup).toContain("AI energy analyst");
    expect(preschoolMarkup).toContain("AI analysis queued…");
    expect(preschoolMarkup).toContain("deterministic Overview is ready");
    expect(preschoolMarkup).toContain("Energy used after closing");
    expect(preschoolMarkup).toContain("L · E · N");
    expect(preschoolMarkup).toContain("High for both floor area and headcount");
    expect(preschoolMarkup).toContain("Unusual peaks during opening hours");
    expect(preschoolMarkup).toContain('data-decision-priority="after-hours"');
    expect(preschoolMarkup).toContain("12.5%");
    expect(preschoolMarkup).toContain("Centres compared");
    expect(preschoolMarkup).toContain("Limitation and evidence");
    expect(preschoolMarkup).not.toContain("What to do next");
    expect(preschoolMarkup).toContain("Centre detail");
    expect(preschoolMarkup).toContain("5,200.00 kWh");
    expect(preschoolMarkup).toContain("9 Appliances");
    expect(preschoolMarkup).toContain("Leading contributor");
    expect(preschoolMarkup).not.toContain("Leading circuit");
    expect(preschoolMarkup).toContain("published Circuit aliases");
    const afterHoursPriority = preschoolMarkup.indexOf('data-decision-priority="after-hours"');
    const efficiencyPriority = preschoolMarkup.indexOf('data-decision-priority="efficiency"');
    const operatingPriority = preschoolMarkup.indexOf('data-decision-priority="operating"');
    const aiSlot = preschoolMarkup.indexOf("AI energy analyst");
    expect(efficiencyPriority).toBeGreaterThan(-1);
    expect(afterHoursPriority).toBeGreaterThan(efficiencyPriority);
    expect(operatingPriority).toBeGreaterThan(afterHoursPriority);
    expect(aiSlot).toBeGreaterThan(operatingPriority);
    const decisionMarkup = preschoolMarkup.slice(efficiencyPriority, aiSlot);
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
