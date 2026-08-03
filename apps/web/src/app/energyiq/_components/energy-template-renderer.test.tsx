import { readFileSync } from "node:fs";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EnergyTemplateRenderer } from "./energy-template-renderer";

describe("EnergyTemplateRenderer states", () => {
  it("does not invoke the legacy dashboard calculation model", () => {
    const source = readFileSync(new URL("./energy-template-renderer.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("buildDecisionDashboardModel");
    expect(source).not.toMatch(/\.reduce\s*\(/);
  });

  it("renders a shared loading state without pretending analysis exists", () => {
    const markup = renderToStaticMarkup(
      <EnergyTemplateRenderer
        state={{
          status: "loading",
          title: "Resolving trusted facts",
          detail: "Project, Scope, period and snapshot are being resolved.",
        }}
      />,
    );

    expect(markup).toContain("role=\"status\"");
    expect(markup).toContain("Resolving trusted facts");
    expect(markup).not.toContain("kWh");
  });

  it("renders recoverable error and unsupported states with explicit meaning", () => {
    const errorMarkup = renderToStaticMarkup(
      <EnergyTemplateRenderer
        state={{ status: "error", title: "Analysis unavailable", detail: "The capability request failed." }}
        onRetry={() => undefined}
      />,
    );
    const unsupportedMarkup = renderToStaticMarkup(
      <EnergyTemplateRenderer
        state={{ status: "unsupported", title: "Water is not configured", detail: "Publish water capabilities first." }}
      />,
    );

    expect(errorMarkup).toContain("role=\"alert\"");
    expect(errorMarkup).toContain("Try again");
    expect(unsupportedMarkup).toContain("Water is not configured");
    expect(unsupportedMarkup).toContain("Unsupported");
  });

  it("keeps partial and stale advisories visible above ready modules", () => {
    const source = renderToStaticMarkup(
      <EnergyTemplateRenderer
        state={{
          status: "ready",
          analysis: analysisFixture(),
          plan: renderPlanFixture(),
          advisories: [
            { kind: "partial", title: "Partial coverage", detail: "Some intervals are unavailable." },
            { kind: "stale", title: "Data is stale", detail: "The latest scheduled sync has not completed." },
          ],
        }}
      />,
    );

    expect(source).toContain("Partial coverage");
    expect(source).toContain("Data is stale");
    expect(source).toContain("Analysis data advisories");
  });

  it("renders published recommended actions without recomputing the finding", () => {
    const analysis = analysisFixture();
    analysis.attention.push({
      code: "HIGH_OFF_HOURS",
      severity: "warning",
      title: "Off-hours consumption is elevated",
      evidence: "18.4% of selected-period energy was outside operating hours.",
      suggestedAction: "Review the top contributing circuits with the FM team.",
    });
    const plan = renderPlanFixture();
    plan.sections[0]!.modules[0]!.component = {
      ...plan.sections[0]!.modules[0]!.component,
      revision_id: "decision.recommended_actions@1",
      component_id: "decision.recommended_actions",
      display_name: "Recommended actions",
      view_key: "recommended_actions_v1",
      family: "decision",
    };
    plan.sections[0]!.modules[0]!.placement = {
      ...plan.sections[0]!.modules[0]!.placement,
      component_revision_id: "decision.recommended_actions@1",
      placement_id: "decision.recommended_actions",
      presentation: {
        ...plan.sections[0]!.modules[0]!.placement.presentation,
        visual_preset: "list",
        limit: 3,
      },
    };

    const markup = renderToStaticMarkup(<EnergyTemplateRenderer state={{ status: "ready", analysis, plan }} />);

    expect(markup).toContain("Off-hours consumption is elevated");
    expect(markup).toContain("Review the top contributing circuits with the FM team.");
  });
});

function analysisFixture() {
  return {
    context: {
      userId: "admin",
      workspaceId: "workspace",
      projectId: "project",
      projectName: "Ngee Ann Polytechnic",
      scopeId: "project",
      scopeName: "Ngee Ann Polytechnic",
      scopeType: "project",
      resource: "electricity" as const,
      timezone: "Asia/Singapore",
      from: "2026-05-01T00:00:00.000Z",
      to: "2026-06-01T00:00:00.000Z",
      endExclusive: true as const,
      period: "Custom" as const,
      hierarchyRevisionId: "hierarchy-v1",
      meterFormulaRevisionId: "formula-v1",
      dataSnapshotId: "snapshot-v1",
      metricVersion: "metrics-v1",
      businessCalendarVersion: "calendar-v1",
      tariffScheduleVersion: "tariff-v1",
      resolvedAt: "2026-08-03T00:00:00.000Z",
    },
    summary: {
      usageKwh: 100,
      averageDailyUsageKwh: 10,
      costSgd: 27.27,
      peakKw: 8,
      peakAt: "2026-05-12T06:00:00.000Z",
      nonOperatingKwh: 12,
      nonOperatingSharePct: 12,
      validIntervalCount: 100,
      qualityEventCount: 1,
    },
    comparison: {
      from: "2026-04-01T00:00:00.000Z",
      to: "2026-05-01T00:00:00.000Z",
      usageKwh: 80,
      changeKwh: 20,
      changePct: 25,
    },
    hourlyProfile: [],
    categories: [],
    childScopes: [],
    circuits: [],
    topCircuits: [],
    virtualMeters: [],
    offHours: {
      status: "unavailable" as const,
      reason: "OPERATING_CALENDAR_NOT_MATERIALIZED" as const,
    },
    cost: {
      status: "unavailable" as const,
      reason: "TARIFF_NOT_CONFIGURED" as const,
      currency: "SGD" as const,
    },
    dataHealth: {
      status: "partial" as const,
      coveragePct: 99,
      expectedMeterIntervalCount: 101,
      validIntervalCount: 100,
      qualityEventCount: 1,
      lastSeenAt: "2026-05-31T15:45:00.000Z",
      importBatchIds: ["batch-1"],
    },
    units: {
      usage: "kWh" as const,
      demand: "kW" as const,
      intervalMinutes: 15,
      timezone: "Asia/Singapore",
    },
    attention: [],
    provenance: {
      dataSnapshotId: "snapshot-v1",
      hierarchyRevisionId: "hierarchy-v1",
      meterFormulaRevisionId: "formula-v1",
      metricVersion: "metrics-v1",
      ruleRevisionIds: [],
      aggregationRule: "component" as const,
      sourceView: "fixture",
      queryIds: ["scope_summary_v1", "hourly_profile_v1", "meter_breakdown_v1"] as const,
    },
  };
}

function renderPlanFixture() {
  return {
    template_id: "project",
    target_kind: "project" as const,
    module_count: 1,
    sections: [{
      section_id: "data",
      title: "Data status",
      navigation_label: "Data status",
      modules: [{
        placement: {
          placement_id: "coverage",
          component_revision_id: "quality.data_coverage@1",
          enabled: true,
          section_id: "data",
          layout: { span: 12 as const, height: "compact" as const },
          presentation: { visual_preset: "cards" as const, density: "compact" as const, tone: "quiet" as const, show_legend: false, limit: 3 },
        },
        component: {
          revision_id: "quality.data_coverage@1",
          component_id: "quality.data_coverage",
          version: 1,
          display_name: "Data quality and coverage",
          description: "Coverage and provenance.",
          family: "quality" as const,
          view_key: "data_quality_summary_v1",
          target: "both" as const,
          metric_revision_ids: [],
          rule_revision_ids: [],
          query_ids: ["data_health_v1"],
          requirement: "always" as const,
          allowed_presentation: {
            layout: { spans: [12 as const], heights: ["compact" as const] },
            visuals: { presets: ["cards" as const], densities: ["compact" as const], tones: ["quiet" as const], legend: { configurable: false, default: false }, limit: { configurable: false, min: 3, max: 3, default: 3 } },
          },
          created_at: "2026-08-03T00:00:00.000Z",
        },
        readiness: { status: "ready" as const, label: "Published", detail: "Fixture" },
      }],
    }],
  };
}
