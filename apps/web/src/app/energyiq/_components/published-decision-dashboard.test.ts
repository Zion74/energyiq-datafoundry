import { describe, expect, it } from "vitest";

import type {
  EnergyComponentRevisionDto,
  EnergyTemplateDefinitionDto,
} from "../../../lib/config-api";
import { buildEnergyTemplateRenderPlan } from "./energy-template-render-plan";
import {
  overviewAnalysisRequest,
  toDateInput,
} from "./published-decision-dashboard";
import { applyProjectAnalysisQualityPolicy } from "./project-renderer-registry";

describe("published Overview date inputs", () => {
  it("formats trusted UTC boundaries in the Project timezone", () => {
    expect(toDateInput("2026-07-26T16:00:00.000Z", "Asia/Singapore")).toBe("2026-07-27");
    expect(toDateInput("2026-08-02T15:59:59.999Z", "Asia/Singapore")).toBe("2026-08-02");
  });

  it("asks the server to resolve the Project root instead of hard-coding a customer Scope", () => {
    expect(overviewAnalysisRequest(
      "preschool-demo",
      "Last 7 days",
      { from: "", to: "" },
    )).toEqual({
      projectId: "preschool-demo",
      scopeId: "project",
      resource: "electricity",
      period: "Last 7 days",
    });
  });

  it("shows partial charts and advisory while suppressing action modules and Save below 95% coverage", () => {
    const policy = applyProjectAnalysisQualityPolicy({
      dataQuality: dataQuality(3.2258),
      plan: overviewPlan(),
    });

    expect(policy).toMatchObject({
      advisories: [{ title: "Partial data" }],
      saveAllowed: false,
    });
    expect(policy.plan.module_count).toBe(2);
    expect(policy.plan.sections.flatMap((section) => section.modules.map((module) => module.component.view_key)))
      .toEqual(["data_quality_summary_v1", "consumption_overview_v1"]);
  });

  it("keeps the published Overview and Save available at the 95% accepted gate", () => {
    const policy = applyProjectAnalysisQualityPolicy({
      dataQuality: dataQuality(95),
      plan: overviewPlan(),
    });

    expect(policy).toMatchObject({
      advisories: [],
      saveAllowed: true,
    });
    expect(policy.plan.module_count).toBe(5);
  });
});

function overviewPlan() {
  const catalog: EnergyComponentRevisionDto[] = [
    component("quality.data_coverage@1", "quality", "data_quality_summary_v1"),
    component("overview.consumption@1", "overview", "consumption_overview_v1"),
    component("decision.executive_actions@1", "decision", "executive_action_summary_v1"),
    component("decision.recommended_actions@1", "decision", "recommended_actions_v1"),
    component("evidence.exceptions@1", "evidence", "exceptions_evidence_v1"),
  ];
  const template: EnergyTemplateDefinitionDto = {
    template_id: "project",
    target_kind: "project",
    components: catalog.map((item) => ({
      component_revision_id: item.revision_id,
      enabled: true,
    })),
  };
  return buildEnergyTemplateRenderPlan({ template, catalog });
}

function dataQuality(coveragePct: number) {
  return {
    status: coveragePct >= 95 ? "complete" as const : "partial" as const,
    coveragePct,
    expectedMeterIntervalCount: 100,
    validIntervalCount: Math.floor(coveragePct),
    qualityEventCount: 0,
    cumulativeDeltaMismatchCount: 0,
    averageKwMismatchCount: 0,
    invalidIntervalDurationCount: 0,
    importBatchIds: ["batch-1"],
  };
}

function component(
  revisionId: string,
  family: EnergyComponentRevisionDto["family"],
  viewKey: string,
): EnergyComponentRevisionDto {
  return {
    revision_id: revisionId,
    component_id: revisionId.replace("@1", ""),
    version: 1,
    display_name: revisionId,
    description: revisionId,
    family,
    view_key: viewKey,
    target: "both",
    metric_revision_ids: [],
    rule_revision_ids: [],
    query_ids: [],
    requirement: "always",
    created_at: "2026-08-04T00:00:00.000Z",
  };
}
