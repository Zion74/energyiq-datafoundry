import React, { type ReactNode } from "react";

import {
  EnergyTemplateRenderer,
  type EnergyTemplateRendererState,
} from "./energy-template-renderer";

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
