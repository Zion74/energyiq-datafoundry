import React, { type ReactNode } from "react";

import type { EnergyScopeAnalysisDto } from "../../../lib/config-api";
import {
  EnergyTemplateRenderer,
  type EnergyTemplateRenderAdvisory,
  type EnergyTemplateRendererState,
} from "./energy-template-renderer";
import type { EnergyTemplateRenderPlan } from "./energy-template-render-plan";

export type ProjectRendererRequest =
  | {
    mode: "customer";
    rendererKey: string | null;
  }
  | {
    mode: "admin-preview";
  };

export type ProjectRendererSelection =
  | {
    status: "ready";
    key: "ngee-ann-overview" | "preschool-overview" | "admin-generic-preview";
    version: "1";
  }
  | {
    status: "configuration-required";
    title: "Project analysis is not configured";
    detail: "Ask an administrator to publish a Project Template Revision with a registered customer Renderer.";
  };

const CUSTOMER_RENDERERS = {
  "ngee-ann-overview": { status: "ready", key: "ngee-ann-overview", version: "1" },
  "preschool-overview": { status: "ready", key: "preschool-overview", version: "1" },
} as const;

const ADMIN_GENERIC_PREVIEW = {
  status: "ready",
  key: "admin-generic-preview",
  version: "1",
} as const;

const CONFIGURATION_REQUIRED = {
  status: "configuration-required",
  title: "Project analysis is not configured",
  detail: "Ask an administrator to publish a Project Template Revision with a registered customer Renderer.",
} as const;

const MINIMUM_DECISION_COVERAGE_PCT = 95;
const QUALITY_GATED_VIEW_KEYS = new Set([
  "executive_action_summary_v1",
  "recommended_actions_v1",
  "exceptions_evidence_v1",
]);

export type ProjectAnalysisQualityPolicy = {
  plan: EnergyTemplateRenderPlan;
  advisories: readonly EnergyTemplateRenderAdvisory[];
  saveAllowed: boolean;
};

export function applyProjectAnalysisQualityPolicy(input: {
  plan: EnergyTemplateRenderPlan;
  dataQuality: EnergyScopeAnalysisDto["dataHealth"];
}): ProjectAnalysisQualityPolicy {
  if (input.dataQuality.coveragePct >= MINIMUM_DECISION_COVERAGE_PCT) {
    return { plan: input.plan, advisories: [], saveAllowed: true };
  }
  const sections = input.plan.sections
    .map((section) => ({
      ...section,
      modules: section.modules.filter(
        (module) => !QUALITY_GATED_VIEW_KEYS.has(module.component.view_key),
      ),
    }))
    .filter((section) => section.modules.length > 0);
  const moduleCount = sections.reduce((count, section) => count + section.modules.length, 0);
  return {
    plan: {
      ...input.plan,
      sections,
      module_count: moduleCount,
    },
    advisories: [{
      kind: "partial",
      title: "Partial data",
      detail: `Coverage is ${input.dataQuality.coveragePct.toFixed(1)}%. Business exceptions and recommendations are withheld until coverage reaches 95%.`,
    }],
    saveAllowed: false,
  };
}

export function selectProjectRenderer(request: ProjectRendererRequest): ProjectRendererSelection {
  if (request.mode === "admin-preview") return ADMIN_GENERIC_PREVIEW;
  if (request.rendererKey && Object.hasOwn(CUSTOMER_RENDERERS, request.rendererKey)) {
    return CUSTOMER_RENDERERS[request.rendererKey as keyof typeof CUSTOMER_RENDERERS];
  }
  return CONFIGURATION_REQUIRED;
}

export function ProjectRenderer({
  request,
  state,
  sectionIdPrefix,
  onRetry,
}: {
  request: ProjectRendererRequest;
  state: EnergyTemplateRendererState;
  sectionIdPrefix?: string;
  onRetry?: () => void;
}): ReactNode {
  const selection = selectProjectRenderer(request);
  if (selection.status === "configuration-required") {
    return (
      <EnergyTemplateRenderer
        state={{
          status: "unsupported",
          title: selection.title,
          detail: selection.detail,
        }}
      />
    );
  }
  return (
    <div data-project-renderer={selection.key} data-renderer-version={selection.version}>
      <EnergyTemplateRenderer
        state={state}
        {...(sectionIdPrefix ? { sectionIdPrefix } : {})}
        {...(onRetry ? { onRetry } : {})}
      />
    </div>
  );
}
