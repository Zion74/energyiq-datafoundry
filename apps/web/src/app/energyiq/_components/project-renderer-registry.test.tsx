import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ProjectRenderer,
  selectProjectRenderer,
} from "./project-renderer-registry";
import { ngeeAnnGoldenSnapshot } from "./ngee-ann-overview.test-fixture";

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

  it("routes Ngee Ann to its independent Snapshot Renderer instead of forwarding to EnergyTemplateRenderer", () => {
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
    const preschoolMarkup = renderToStaticMarkup(
      <ProjectRenderer
        request={{ mode: "customer", rendererKey: "preschool-overview" }}
        state={state}
      />,
    );

    expect(ngeeAnnMarkup).toContain("data-ngee-ann-overview=\"true\"");
    expect(ngeeAnnMarkup).toContain("1531.1683");
    expect(ngeeAnnMarkup).not.toContain("No modules are enabled");
    expect(preschoolMarkup).toContain("No modules are enabled");
    expect(preschoolMarkup).not.toContain("data-ngee-ann-overview");
  });
});
