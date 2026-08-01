"use client";

import nextDynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import type { DataTasksExternalContext } from "../../data-tasks/data-tasks-app";
import {
  configApi,
  type EnergyQueryContextDto,
  type EnergyQueryContextRequestDto,
} from "../../../lib/config-api";
import { useEnergyIqAccess } from "./energyiq-access";

const DataTasksApp = nextDynamic(
  () => import("../../data-tasks/data-tasks-app"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[560px] items-center justify-center bg-surface-subtle text-sm text-muted">
        Loading Energy Analysis…
      </div>
    ),
  },
);

export function EnergyAnalysisWorkbench() {
  const searchParams = useSearchParams();
  const { activeProject } = useEnergyIqAccess();
  const requestedContext = useMemo<EnergyQueryContextRequestDto>(
    () => {
      const projectId =
        searchParams.get("projectId") ?? activeProject?.id ?? "ngee-ann-polytechnic";
      const explicitPeriod = searchParams.get("period");
      const usePreschoolDemoWindow =
        projectId === "preschool-demo" && explicitPeriod === null;
      return {
        projectId,
        scopeId: searchParams.get("scopeId") ?? "project",
        resource:
          searchParams.get("resource") === "water" ? "water" : "electricity",
        period: usePreschoolDemoWindow
          ? "Custom"
          : normalizePeriod(explicitPeriod),
        ...(searchParams.get("from")
          ? { from: searchParams.get("from")! }
          : usePreschoolDemoWindow
            ? { from: "2026-05-01" }
            : {}),
        ...(searchParams.get("to")
          ? { to: searchParams.get("to")! }
          : usePreschoolDemoWindow
            ? { to: "2026-05-31" }
            : {}),
      };
    },
    [activeProject?.id, searchParams],
  );
  const [resolved, setResolved] = useState<EnergyQueryContextDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResolved(null);
    setError(null);
    void configApi.resolveEnergyQueryContext(requestedContext)
      .then((context) => {
        if (!cancelled) setResolved(context);
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Unable to resolve analysis context");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [requestedContext]);

  const externalContext = useMemo<DataTasksExternalContext | null>(
    () => resolved ? {
      source: "energyiq",
      projectId: resolved.projectId,
      projectName: resolved.projectName,
      scopeId: resolved.scopeId,
      scopeName: resolved.scopeName,
      resource: resolved.resource,
      period: resolved.period,
      from: resolved.from,
      to: resolved.to,
    } : null,
    [resolved],
  );

  if (error) {
    return (
      <div className="flex h-full min-h-[560px] items-center justify-center bg-surface-subtle px-6 text-center">
        <div>
          <p className="text-sm font-semibold">Analysis context is unavailable</p>
          <p className="mt-2 text-xs text-muted">{error}</p>
        </div>
      </div>
    );
  }
  if (!externalContext) {
    return (
      <div className="flex h-full min-h-[560px] items-center justify-center bg-surface-subtle text-sm text-muted">
        Resolving project, scope and reporting period…
      </div>
    );
  }

  return (
    <div className="h-full min-h-0">
      <DataTasksApp
        viewport="embedded"
        accessMode="user"
        externalContext={externalContext}
        inheritIdentity
      />
    </div>
  );
}

const normalizePeriod = (
  value: string | null,
): "Yesterday" | "Last 7 days" | "Last 30 days" | "Custom" => {
  if (value === "Yesterday" || value === "Last 7 days" || value === "Custom") {
    return value;
  }
  return "Last 30 days";
};
