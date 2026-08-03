"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  configApi,
  type EnergyPublishedTemplateResponseDto,
  type EnergyQueryContextRequestDto,
  type EnergySavedAnalysisDetailDto,
  type EnergyScopeAnalysisDto,
} from "../../../lib/config-api";
import {
  EnergyTemplateRenderer,
  type EnergyTemplateRendererState,
} from "./energy-template-renderer";
import { buildEnergyTemplateRenderPlan } from "./energy-template-render-plan";
import { useEnergyIqAccess } from "./energyiq-access";
import { EnergyIcon } from "./icons";

const periodOptions: readonly Array<{
  label: string;
  value?: OverviewPeriod;
  disabled?: boolean;
  title?: string;
}> = [
  { label: "Yesterday", value: "Yesterday" },
  { label: "Last 7 days", value: "Last 7 days" },
  { label: "Previous month", disabled: true, title: "Awaiting the trusted calendar-month period contract." },
  { label: "Custom", value: "Custom" },
];
type OverviewPeriod = "Yesterday" | "Last 7 days" | "Custom";
type ResourceType = "electricity" | "water";

type LoadedTemplate = {
  projectId: string;
  value: EnergyPublishedTemplateResponseDto;
};

export function PublishedDecisionDashboard() {
  const { activeProject } = useEnergyIqAccess();
  const [resource, setResource] = useState<ResourceType>("electricity");
  const [period, setPeriod] = useState<OverviewPeriod>("Last 7 days");
  const [customRange, setCustomRange] = useState({ projectId: "", from: "", to: "" });
  const [template, setTemplate] = useState<LoadedTemplate | null>(null);
  const [analysis, setAnalysis] = useState<EnergyScopeAnalysisDto | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [running, setRunning] = useState(false);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [activeSection, setActiveSection] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAnalysis, setSavedAnalysis] = useState<EnergySavedAnalysisDetailDto | null>(null);

  const projectId = activeProject?.id ?? "";
  const effectiveCustomRange = customRange.projectId === projectId
    ? customRange
    : { projectId, from: "", to: "" };
  const currentTemplate = template?.projectId === projectId ? template.value : null;
  const currentAnalysis = analysis?.context.projectId === projectId ? analysis : null;
  const projectTemplate = currentTemplate?.document.templates.find((candidate) => candidate.template_id === "project") ?? null;
  const renderPlan = useMemo(
    () => projectTemplate && currentTemplate
      ? buildEnergyTemplateRenderPlan({ template: projectTemplate, catalog: currentTemplate.catalog })
      : null,
    [currentTemplate, projectTemplate],
  );

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoadingTemplate(true);
    setTemplateError(null);
    void configApi.getEnergyPublishedTemplate(projectId)
      .then((result) => {
        if (cancelled) return;
        setTemplate({ projectId, value: result });
      })
      .catch((reason) => {
        if (cancelled) return;
        setTemplate(null);
        setTemplateError(messageFrom(reason, "Unable to load the published Project Template"));
      })
      .finally(() => {
        if (!cancelled) setLoadingTemplate(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshRevision]);

  useEffect(() => {
    if (!projectId || resource !== "electricity") return;
    let cancelled = false;
    const request = overviewAnalysisRequest(projectId, period, effectiveCustomRange);
    setRunning(true);
    setAnalysisError(null);
    void configApi.executeEnergyScopeAnalysis(request)
      .then((result) => {
        if (cancelled) return;
        setAnalysis(result);
        setCustomRange((current) => current.projectId === projectId && current.from && current.to
          ? current
          : {
            projectId,
            from: toDateInput(result.context.from, result.context.timezone),
            to: toDateInput(new Date(Date.parse(result.context.to) - 1).toISOString(), result.context.timezone),
          });
      })
      .catch((reason) => {
        if (cancelled) return;
        setAnalysis(null);
        setAnalysisError(messageFrom(reason, "Unable to run project analysis"));
      })
      .finally(() => {
        if (!cancelled) setRunning(false);
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveCustomRange.from, effectiveCustomRange.to, period, projectId, refreshRevision, resource]);

  useEffect(() => {
    const firstSectionId = renderPlan?.sections[0]?.section_id ?? "";
    setActiveSection(firstSectionId);
  }, [projectId, renderPlan]);

  useEffect(() => {
    setSavedAnalysis(null);
    setSaveError(null);
  }, [effectiveCustomRange.from, effectiveCustomRange.to, period, projectId, resource]);

  const saveCurrentAnalysis = async () => {
    if (!projectId || !currentAnalysis || !currentTemplate?.revision || resource !== "electricity") return;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await configApi.saveEnergyAnalysis(projectId, {
        ...overviewAnalysisRequest(projectId, period, effectiveCustomRange),
        title: `${currentAnalysis.context.scopeName} · ${period}`,
      });
      setSavedAnalysis(saved);
    } catch (reason) {
      setSavedAnalysis(null);
      setSaveError(messageFrom(reason, "Unable to save this analysis"));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!renderPlan) return;
    const elements = renderPlan.sections
      .map((section) => document.getElementById(sectionDomId(section.section_id)))
      .filter((element): element is HTMLElement => Boolean(element));
    if (elements.length === 0) return;
    const scrollContainer = elements[0]?.closest("main");
    if (!scrollContainer) return;
    const updateActiveSection = () => {
      const passed = elements.filter((element) => element.getBoundingClientRect().top <= 168);
      setActiveSection((passed.at(-1) ?? elements[0]).id.replace("customer-overview-", ""));
    };
    updateActiveSection();
    scrollContainer.addEventListener("scroll", updateActiveSection, { passive: true });
    return () => scrollContainer.removeEventListener("scroll", updateActiveSection);
  }, [renderPlan]);

  const runMessage = currentAnalysis
    ? `${formatRunPeriod(currentAnalysis)} · ${currentAnalysis.provenance.dataSnapshotId}`
    : running ? "Resolving Project scope and trusted facts…" : "Waiting for analysis context";
  const rendererState = resolveOverviewRendererState({
    projectId,
    resource,
    loading: loadingTemplate || running,
    templateError,
    analysisError,
    analysis: currentAnalysis,
    plan: renderPlan,
  });
  const publishedSections = rendererState.status === "ready" ? rendererState.plan.sections : [];

  return (
    <div className="mx-auto w-full max-w-[1480px] px-4 py-6 lg:px-8 lg:py-8">
      <section className="flex flex-col gap-5 border-b border-border pb-6 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted">
            <span>{activeProject?.name ?? "Select a Project"}</span>
            <EnergyIcon name="chevron" className="h-3 w-3" />
            <span>Published analysis</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Energy analysis</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted">
            A Project-specific decision view rendered from the published EnergyIQ Template Schema.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border bg-surface p-1" aria-label="Resource type">
            {(["electricity", "water"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setResource(item)}
                className={[
                  "flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors",
                  resource === item ? "bg-primary text-white" : "text-muted hover:bg-surface-subtle hover:text-foreground",
                ].join(" ")}
              >
                <EnergyIcon name={item === "electricity" ? "bolt" : "water"} className="h-3.5 w-3.5" />
                {item === "electricity" ? "Electricity" : "Water"}
              </button>
            ))}
          </div>
          <div className="flex max-w-full overflow-x-auto rounded-lg border border-border bg-surface p-1">
            {periodOptions.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => item.value ? setPeriod(item.value) : undefined}
                disabled={item.disabled}
                title={item.title}
                className={[
                  "h-8 whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-colors",
                  item.value && period === item.value ? "bg-surface-subtle text-foreground shadow-sm" : "text-muted hover:text-foreground",
                  item.disabled ? "cursor-not-allowed opacity-45 hover:text-muted" : "",
                ].join(" ")}
              >
                {item.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setRefreshRevision((current) => current + 1)}
            disabled={running || resource === "water"}
            className="h-10 rounded-lg bg-primary px-4 text-xs font-semibold text-white transition-colors hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? "Refreshing…" : "Refresh view"}
          </button>
          <button
            type="button"
            onClick={() => void saveCurrentAnalysis()}
            disabled={saving || rendererState.status !== "ready" || !currentTemplate?.revision}
            className="h-10 rounded-lg border border-border bg-surface px-4 text-xs font-semibold text-foreground transition-colors hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save analysis"}
          </button>
        </div>
      </section>

      {period === "Custom" ? (
        <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface px-4 py-3">
          <DateField label="From" value={effectiveCustomRange.from} onChange={(from) => setCustomRange((current) => ({ ...current, projectId, from }))} />
          <DateField label="To, inclusive" value={effectiveCustomRange.to} onChange={(to) => setCustomRange((current) => ({ ...current, projectId, to }))} />
          <p className="pb-2 text-[10px] text-muted-light">Changing the range reuses the published template and runs only the scoped queries.</p>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-light">
        <span>{runMessage}</span>
        <div className="flex flex-wrap items-center gap-3">
          {saveError ? <span className="text-step-error">Save failed: {saveError}</span> : null}
          {savedAnalysis ? (
            <Link href={`/energyiq/saved/${savedAnalysis.id}`} className="font-semibold text-primary hover:underline">
              Saved as version {savedAnalysis.sequence} →
            </Link>
          ) : null}
          {currentTemplate ? (
            <span className="font-mono">
              {currentTemplate.revision?.revision_id ?? "No published Template Revision"}
            </span>
          ) : null}
        </div>
      </div>

      {rendererState.status === "ready" ? (
        <div className="mt-6 lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start lg:gap-8 xl:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="lg:sticky lg:top-6">
            <p className="mb-2 hidden px-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-light lg:block">Published sections</p>
            <nav className="flex max-w-full gap-1 overflow-x-auto rounded-lg border border-border bg-surface p-1 lg:flex-col lg:overflow-visible" aria-label="Published analysis sections">
              {publishedSections.map((section, index) => (
                <a
                  key={section.section_id}
                  href={`#${sectionDomId(section.section_id)}`}
                  onClick={() => setActiveSection(section.section_id)}
                  aria-current={activeSection === section.section_id ? "location" : undefined}
                  className={[
                    "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors lg:min-h-10 lg:w-full",
                    activeSection === section.section_id ? "bg-primary text-white" : "text-muted hover:bg-surface-subtle hover:text-foreground",
                  ].join(" ")}
                >
                  <span className={activeSection === section.section_id ? "text-[10px] text-white/65" : "text-[10px] text-muted-light"}>{String(index + 1).padStart(2, "0")}</span>
                  <span>{section.navigation_label}</span>
                </a>
              ))}
            </nav>
            <p className="mt-3 hidden px-3 text-[11px] leading-5 text-muted-light lg:block">This navigation is generated from the same published template used by Admin Preview.</p>
          </aside>

          <div className="min-w-0">
            <EnergyTemplateRenderer state={rendererState} sectionIdPrefix="customer-overview" onRetry={() => setRefreshRevision((current) => current + 1)} />
          </div>
        </div>
      ) : (
        <div className="mt-6">
          <EnergyTemplateRenderer state={rendererState} onRetry={() => setRefreshRevision((current) => current + 1)} />
        </div>
      )}
    </div>
  );
}

function resolveOverviewRendererState(input: {
  projectId: string;
  resource: ResourceType;
  loading: boolean;
  templateError: string | null;
  analysisError: string | null;
  analysis: EnergyScopeAnalysisDto | null;
  plan: ReturnType<typeof buildEnergyTemplateRenderPlan> | null;
}): EnergyTemplateRendererState {
  if (!input.projectId) {
    return { status: "empty", title: "Select a Project", detail: "Choose a Project to load its published Template Revision and analysis context." };
  }
  if (input.resource === "water") {
    return { status: "unsupported", title: "Water analysis is not configured", detail: "Publish water metrics, capabilities and modules before this view displays decision-grade results." };
  }
  const error = input.templateError ?? input.analysisError;
  if (error) {
    return { status: "error", title: "Published analysis is unavailable", detail: `${error} Retry the same Project and period without changing the published template.` };
  }
  if (input.loading || !input.analysis || !input.plan) {
    return { status: "loading", title: "Resolving the published analysis", detail: "Loading the Template Revision, trusted Project scope, selected period and data snapshot." };
  }
  return { status: "ready", analysis: input.analysis, plan: input.plan };
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="text-[9px] font-semibold uppercase tracking-wide text-muted-light">
      {label}
      <input type="date" value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 block h-9 rounded-md border border-border bg-surface px-3 text-xs font-medium normal-case text-foreground" />
    </label>
  );
}

function overviewAnalysisRequest(
  projectId: string,
  period: OverviewPeriod,
  customRange: { from: string; to: string },
): EnergyQueryContextRequestDto {
  const scopeId = projectId === "preschool-demo" ? "preschool-project" : "project";
  if (period !== "Custom") return { projectId, scopeId, resource: "electricity", period };
  return { projectId, scopeId, resource: "electricity", period, from: customRange.from, to: customRange.to };
}

export function toDateInput(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(new Date(value));
}

function formatRunPeriod(analysis: EnergyScopeAnalysisDto): string {
  const formatter = new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", year: "numeric", timeZone: analysis.context.timezone });
  const from = formatter.format(new Date(analysis.context.from));
  const to = formatter.format(new Date(new Date(analysis.context.to).getTime() - 1));
  return `${analysis.context.projectName} · ${from}–${to}`;
}

function sectionDomId(sectionId: string): string {
  return `customer-overview-${sectionId}`;
}

function messageFrom(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}
