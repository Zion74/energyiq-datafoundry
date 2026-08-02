"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import {
  configApi,
  type EnergyComponentRevisionDto,
  type EnergyImportBatchDto,
  type EnergyMeterMappingDraftDto,
  type EnergyMeterMappingRowDto,
  type EnergyMetricFamilyDto,
  type EnergyMetricRevisionDto,
  type EnergyRuleFamilyDto,
  type EnergyRuleRevisionDto,
  type EnergyVirtualMeterDto,
  type EnergyProjectDto,
  type EnergyProjectSetupDocumentDto,
  type EnergyProjectSetupDto,
  type EnergyProjectSetupNodeDto,
  type EnergyProjectSetupValidationDto,
  type EnergyProjectTemplateDraftDto,
  type EnergyTemplateDraftDocumentDto,
  type EnergyTemplateDefinitionDto,
  type EnergyTierDefinitionDto,
} from "../../../lib/config-api";
import { EnergyIcon } from "../_components/icons";
import type { useEnergyIqAccess } from "../_components/energyiq-access";
import { EnergyIqAdminSidebar, type AdminSection } from "./admin-sidebar";
import { AdminAccessPages } from "./admin-access-pages";
import { resolveComponentReadiness, resolveMetricReadiness, resolveRuleReadiness } from "./analysis-configuration-model";
import { deriveProjectDeliveryProgress } from "./project-delivery-progress";
import { TemplateDraftPreview } from "./template-draft-preview";
import {
  buildTemplatePreviewPlan,
  resolveEnergyPreviewRange,
  type EnergyPreviewRange,
} from "./template-draft-preview-model";
import { useProjectSetupLoader } from "./use-project-setup-loader";
import {
  addNode,
  addParentTier,
  branchNodeCount,
  canLockTierStructure,
  buildAggregationReview,
  createMeterMappingFromSourceLabels,
  hasSiblingNameConflict,
  initialTierSelection,
  isTierStructureLocked,
  nodePathLabel,
  nodesForTierAndParent,
  removeNodeAndDescendants,
  removeHighestTier,
  tiersTopDown,
} from "./project-setup-model";

type AccessState = ReturnType<typeof useEnergyIqAccess>;
type MeterMappingIntent = {
  scopeId: string;
  scopeName: string;
  kind: "physical" | "virtual";
};

export function EnergyIqAdminWorkbench({
  accessState,
  initialSection = "overview",
}: {
  accessState: AccessState;
  initialSection?: AdminSection;
}) {
  const router = useRouter();
  const { access, activeProject, refresh, selectProject } = accessState;
  const projects = access?.projects ?? [];
  const [selectedProjectId, setSelectedProjectId] = useState(
    activeProject?.id ?? projects[0]?.id ?? "",
  );
  const [section, setSection] = useState<AdminSection>(initialSection);
  const [setup, setSetup] = useState<EnergyProjectSetupDto | null>(null);
  const [document, setDocument] = useState<EnergyProjectSetupDocumentDto | null>(null);
  const [validation, setValidation] = useState<EnergyProjectSetupValidationDto | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [meterMappingIntent, setMeterMappingIntent] = useState<MeterMappingIntent | null>(null);

  useEffect(() => {
    if (!selectedProjectId && projects[0]) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  const loadSetup = useCallback(async (projectId: string) => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const next = await configApi.getEnergyProjectSetup(projectId);
      setSetup(next);
      setDocument(next.draft.document);
      setValidation(next.validation);
      const selection = initialTierSelection(next.draft.document);
      const ordered = tiersTopDown(next.draft.document);
      setSelectedNodeId(ordered.map((tier) => selection[tier.id]).filter(Boolean).at(-1) ?? null);
      setDirty(false);
    } catch (reason) {
      setError(messageFrom(reason, "Failed to load project setup"));
      setSetup(null);
      setDocument(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useProjectSetupLoader(selectedProjectId, loadSetup);

  const changeDocument = useCallback((
    updater: (current: EnergyProjectSetupDocumentDto) => EnergyProjectSetupDocumentDto,
  ) => {
    setDocument((current) => (current ? updater(current) : current));
    setDirty(true);
    setNotice(null);
  }, []);

  const persistDraft = useCallback(async () => {
    if (!setup || !document) throw new Error("Project setup is not loaded");
    if (!dirty) return setup.draft;
    const result = await configApi.saveEnergyProjectSetupDraft(selectedProjectId, {
      expectedRevision: setup.draft.revision,
      document,
    });
    setSetup((current) => current ? { ...current, draft: result.draft, validation: result.validation } : current);
    setDocument(result.draft.document);
    setValidation(result.validation);
    setDirty(false);
    await refresh();
    return result.draft;
  }, [dirty, document, refresh, selectedProjectId, setup]);

  const saveDraft = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await persistDraft();
      setNotice("Draft saved. Customer-facing pages are unchanged until Publish.");
    } catch (reason) {
      setError(messageFrom(reason, "Failed to save draft"));
    } finally {
      setSaving(false);
    }
  }, [persistDraft]);

  const validateDraft = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await persistDraft();
      const result = await configApi.validateEnergyProjectSetup(selectedProjectId);
      setValidation(result);
      setNotice(result.blocking
        ? "Validation found blocking issues. Fix them before publishing."
        : "Validation passed. Warnings can be reviewed before publishing.");
    } catch (reason) {
      setError(messageFrom(reason, "Failed to validate draft"));
    } finally {
      setSaving(false);
    }
  }, [persistDraft, selectedProjectId]);

  const discardUnsavedChanges = useCallback(() => {
    if (!setup || !dirty) return;
    if (!window.confirm("Discard all changes made since the last saved draft?")) return;
    setDocument(setup.draft.document);
    setValidation(setup.validation);
    const selection = initialTierSelection(setup.draft.document);
    setSelectedNodeId(
      tiersTopDown(setup.draft.document)
        .map((tier) => selection[tier.id])
        .filter(Boolean)
        .at(-1) ?? null,
    );
    setDirty(false);
    setNotice("Unsaved changes were discarded. The last saved draft is unchanged.");
  }, [dirty, setup]);

  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const errorCount = validation?.issues.filter((issue) => issue.severity === "error").length ?? 0;
  const warningCount = validation?.issues.filter((issue) => issue.severity === "warning").length ?? 0;
  const sectionMeta = adminSectionMeta(section, selectedProject?.name);
  const showSetupActions = section === "basics"
    || section === "structure"
    || section === "data-sources"
    || section === "meter-mapping";
  const showProjectLink = Boolean(selectedProject?.status === "published" && isProjectContext(section));
  const chooseAdminProject = (projectId: string) => {
    setSelectedProjectId(projectId);
    setMeterMappingIntent(null);
    selectProject(projectId);
  };

  return (
    <div className="flex min-h-full flex-col bg-surface-subtle lg:flex-row">
      <EnergyIqAdminSidebar
        projects={projects}
        selectedProjectId={selectedProjectId}
        activeSection={section}
        onProjectChange={(projectId) => {
          chooseAdminProject(projectId);
          setSection("project-overview");
        }}
        onCreateProject={() => setNewProjectOpen(true)}
        onSectionChange={(nextSection) => {
          setSection(nextSection);
          router.replace(`/energyiq/admin?section=${nextSection}`, { scroll: false });
        }}
      />

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-border bg-surface px-4 py-3 lg:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-base font-semibold">{sectionMeta.title}</h2>
                {showSetupActions && setup ? <LifecycleBadge setup={setup} dirty={dirty} /> : null}
              </div>
              <p className="mt-0.5 text-xs text-muted">{sectionMeta.description}</p>
            </div>
            <div className="flex items-center gap-2">
              {showSetupActions ? (
                <>
                  {dirty ? (
                    <button type="button" onClick={discardUnsavedChanges} disabled={saving || loading} className={secondaryButton}>
                      Discard changes
                    </button>
                  ) : null}
                  <button type="button" onClick={() => void saveDraft()} disabled={saving || loading || !dirty} className={secondaryButton}>
                    Save draft
                  </button>
                  <button type="button" onClick={() => void validateDraft()} disabled={saving || loading} className={secondaryButton}>
                    Validate
                  </button>
                </>
              ) : null}
              {showProjectLink && selectedProject ? (
                <Link
                  href="/energyiq/explorer"
                  onClick={() => selectProject(selectedProject.id)}
                  className={secondaryButton}
                >
                  View as user
                </Link>
              ) : null}
            </div>
          </div>
        </header>

        <div className="p-4 lg:p-6">
          {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
          {notice ? <StatusMessage tone={validation?.blocking ? "warning" : "success"}>{notice}</StatusMessage> : null}
          {section === "organisations" || section === "users" ? (
            <AdminAccessPages initialView={section} />
          ) : null}
          {section !== "organisations" && section !== "users" && loading ? <LoadingPanel /> : null}
          {section !== "organisations" && section !== "users" && !loading && document && setup ? renderAdminSection({
            section,
            projects,
            selectedProject,
            chooseAdminProject,
            selectedProjectId,
            setup,
            document,
            validation,
            errorCount,
            warningCount,
            meterMappingIntent,
            setMeterMappingIntent,
            selectedNodeId,
            setSelectedNodeId,
            changeDocument,
            setSection,
          }) : null}
        </div>
      </div>

      {newProjectOpen ? (
        <NewProjectDialog
          onClose={() => setNewProjectOpen(false)}
          onCreated={async (projectId) => {
            setNewProjectOpen(false);
            await refresh();
            setSelectedProjectId(projectId);
            setSection("basics");
          }}
        />
      ) : null}
    </div>
  );
}

function renderAdminSection({
  section,
  projects,
  selectedProject,
  chooseAdminProject,
  selectedProjectId,
  setup,
  document,
  validation,
  errorCount,
  warningCount,
  meterMappingIntent,
  setMeterMappingIntent,
  selectedNodeId,
  setSelectedNodeId,
  changeDocument,
  setSection,
}: {
  section: AdminSection;
  projects: EnergyProjectDto[];
  selectedProject?: EnergyProjectDto;
  chooseAdminProject: (projectId: string) => void;
  selectedProjectId: string;
  setup: EnergyProjectSetupDto;
  document: EnergyProjectSetupDocumentDto;
  validation: EnergyProjectSetupValidationDto | null;
  errorCount: number;
  warningCount: number;
  meterMappingIntent: MeterMappingIntent | null;
  setMeterMappingIntent: Dispatch<SetStateAction<MeterMappingIntent | null>>;
  selectedNodeId: string | null;
  setSelectedNodeId: Dispatch<SetStateAction<string | null>>;
  changeDocument: (updater: (current: EnergyProjectSetupDocumentDto) => EnergyProjectSetupDocumentDto) => void;
  setSection: Dispatch<SetStateAction<AdminSection>>;
}) {
  if (section === "overview") {
    return <AdminOverview projects={projects} selectedProject={selectedProject} chooseAdminProject={chooseAdminProject} setSection={setSection} />;
  }
  if (section === "project-overview") {
    return <ProjectDeliveryOverview projectId={selectedProjectId} project={selectedProject} setup={setup} document={document} setSection={setSection} />;
  }
  if (section === "basics") {
    return (
      <ProjectProfile
        setup={setup}
        document={document}
        validation={validation}
        errorCount={errorCount}
        warningCount={warningCount}
        changeDocument={changeDocument}
        onBack={() => setSection("project-overview")}
      />
    );
  }
  if (section === "structure") {
    return (
      <StructureEditor
        projectId={selectedProjectId}
        document={document}
        validation={validation}
        selectedNodeId={selectedNodeId}
        setSelectedNodeId={setSelectedNodeId}
        changeDocument={changeDocument}
        onOpenMeterMapping={(node, kind) => {
          setMeterMappingIntent({ scopeId: node.id, scopeName: node.name, kind });
          setSection("meter-mapping");
        }}
      />
    );
  }
  if (section === "data-sources") {
    return (
      <DataSourcesPage
        projectId={selectedProjectId}
        document={document}
        changeDocument={changeDocument}
        setSection={setSection}
      />
    );
  }
  if (section === "meter-mapping") {
    return (
      <MeterMappingPage
        setSection={setSection}
        intent={meterMappingIntent}
        document={document}
        changeDocument={changeDocument}
      />
    );
  }
  if (section === "templates") {
    return (
      <AnalysisConfigurationPage
        projectId={selectedProjectId}
        document={document}
        businessCalendarVersion={setup.project.business_calendar_version}
      />
    );
  }

  const planned = plannedSectionCopy(section);
  return <PlannedAdminPage title={planned.title} description={planned.description} dependency={planned.dependency} />;
}

const metricFamilyCopy: Record<EnergyMetricFamilyDto, { label: string; description: string }> = {
  aggregate: {
    label: "Core totals",
    description: "Stable totals used by the Project and Tier analysis templates.",
  },
  time: {
    label: "Time patterns",
    description: "Metrics that explain when consumption and demand occur.",
  },
  normalised: {
    label: "Normalised comparison",
    description: "Fair comparison after area or people metadata is available.",
  },
  quality: {
    label: "Data quality",
    description: "Signals that show whether the calculation has enough trustworthy facts.",
  },
};

const ruleFamilyCopy: Record<EnergyRuleFamilyDto, { label: string; description: string }> = {
  data_quality: {
    label: "Data integrity",
    description: "Deterministic checks that prevent a dashboard from presenting missing facts as a valid result.",
  },
  time: {
    label: "Time-based findings",
    description: "Findings derived from the selected period and the Project operating-hours calendar.",
  },
  comparison: {
    label: "Scope comparison",
    description: "Peer findings that only run when enough genuinely comparable child or sibling scopes exist.",
  },
};

function AnalysisConfigurationPage({
  projectId,
  document,
  businessCalendarVersion,
}: {
  projectId: string;
  document: EnergyProjectSetupDocumentDto;
  businessCalendarVersion: string;
}) {
  const [activeStep, setActiveStep] = useState<"metrics" | "rules" | "layout">("metrics");
  const [catalog, setCatalog] = useState<EnergyMetricRevisionDto[]>([]);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [savedSelection, setSavedSelection] = useState<string[]>([]);
  const [ruleCatalog, setRuleCatalog] = useState<EnergyRuleRevisionDto[]>([]);
  const [ruleRevision, setRuleRevision] = useState(0);
  const [selectedRules, setSelectedRules] = useState<string[]>([]);
  const [savedRuleSelection, setSavedRuleSelection] = useState<string[]>([]);
  const [componentCatalog, setComponentCatalog] = useState<EnergyComponentRevisionDto[]>([]);
  const [templateDraft, setTemplateDraft] = useState<EnergyProjectTemplateDraftDto | null>(null);
  const [savedTemplateDocument, setSavedTemplateDocument] = useState<EnergyTemplateDraftDocumentDto | null>(null);
  const [previewRange, setPreviewRange] = useState<EnergyPreviewRange | null>(null);
  const [activeTemplateId, setActiveTemplateId] = useState("project");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const [metricResult, ruleResult, templateResult, importResult, coverageResult] = await Promise.all([
        configApi.getEnergyProjectMetricConfig(projectId),
        configApi.getEnergyProjectRuleConfig(projectId),
        configApi.getEnergyProjectTemplateDraft(projectId),
        configApi.listEnergyImportBatches(projectId).catch(() => ({ batches: [] })),
        configApi.getEnergyProjectDataCoverage(projectId).catch(() => ({ coverage: null })),
      ]);
      setCatalog(metricResult.catalog);
      setRevision(metricResult.config.revision);
      setSelected(metricResult.config.selected_metric_revision_ids);
      setSavedSelection(metricResult.config.selected_metric_revision_ids);
      setRuleCatalog(ruleResult.catalog);
      setRuleRevision(ruleResult.config.revision);
      setSelectedRules(ruleResult.config.selected_rule_revision_ids);
      setSavedRuleSelection(ruleResult.config.selected_rule_revision_ids);
      setComponentCatalog(templateResult.catalog);
      setTemplateDraft(templateResult.draft);
      setSavedTemplateDocument(templateResult.draft.document);
      setPreviewRange(resolveEnergyPreviewRange({
        coverage: coverageResult.coverage,
        batches: importResult.batches,
        timezone: document.project.timezone,
      }));
      setActiveTemplateId("project");
    } catch (reason) {
      setError(messageFrom(reason, "Failed to load analysis configuration"));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = selected.length !== savedSelection.length
    || selected.some((id) => !savedSelection.includes(id));
  const rulesDirty = selectedRules.length !== savedRuleSelection.length
    || selectedRules.some((id) => !savedRuleSelection.includes(id));
  const templateDirty = templateDraft !== null && savedTemplateDocument !== null
    && JSON.stringify(templateDraft.document) !== JSON.stringify(savedTemplateDocument);
  const saveMetrics = useCallback(async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await configApi.saveEnergyProjectMetricConfig(projectId, {
        expectedRevision: revision,
        selectedMetricRevisionIds: selected,
      });
      setCatalog(result.catalog);
      setRevision(result.config.revision);
      setSelected(result.config.selected_metric_revision_ids);
      setSavedSelection(result.config.selected_metric_revision_ids);
      setNotice("Metric selection saved as a new project configuration revision.");
    } catch (reason) {
      setError(messageFrom(reason, "Failed to save metric configuration"));
    } finally {
      setSaving(false);
    }
  }, [projectId, revision, selected]);

  const saveRules = useCallback(async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await configApi.saveEnergyProjectRuleConfig(projectId, {
        expectedRevision: ruleRevision,
        selectedRuleRevisionIds: selectedRules,
      });
      setRuleCatalog(result.catalog);
      setRuleRevision(result.config.revision);
      setSelectedRules(result.config.selected_rule_revision_ids);
      setSavedRuleSelection(result.config.selected_rule_revision_ids);
      setNotice("Rule selection saved as a new project configuration revision.");
    } catch (reason) {
      setError(messageFrom(reason, "Failed to save rule configuration"));
    } finally {
      setSaving(false);
    }
  }, [projectId, ruleRevision, selectedRules]);

  const saveTemplate = useCallback(async () => {
    if (!templateDraft) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await configApi.saveEnergyProjectTemplateDraft(projectId, {
        expectedRevision: templateDraft.revision,
        document: templateDraft.document,
      });
      setComponentCatalog(result.catalog);
      setTemplateDraft(result.draft);
      setSavedTemplateDocument(result.draft.document);
      setNotice("Project and Tier template layouts saved as a new Draft revision.");
    } catch (reason) {
      setError(messageFrom(reason, "Failed to save template layout"));
    } finally {
      setSaving(false);
    }
  }, [projectId, templateDraft]);

  const families = (["aggregate", "time", "normalised", "quality"] as const)
    .map((family) => ({ family, metrics: catalog.filter((metric) => metric.family === family) }))
    .filter((group) => group.metrics.length > 0);
  const readinessByMetricId = new Map(catalog.map((metric) => [
    metric.revision_id,
    resolveMetricReadiness(metric, document),
  ]));
  const selectedMetricIdSet = new Set(selected);
  const selectedRuleIdSet = new Set(selectedRules);
  const ruleFamilies = (["data_quality", "time", "comparison"] as const)
    .map((family) => ({ family, rules: ruleCatalog.filter((rule) => rule.family === family) }))
    .filter((group) => group.rules.length > 0);
  const readinessByRuleId = new Map(ruleCatalog.map((rule) => [
    rule.revision_id,
    resolveRuleReadiness(rule, document, selectedMetricIdSet, businessCalendarVersion),
  ]));
  const activeRevision = activeStep === "metrics"
    ? revision
    : activeStep === "rules"
      ? ruleRevision
      : templateDraft?.revision ?? 0;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">Analysis configuration</span>
            <h3 className="mt-2 text-base font-semibold">Configure trusted calculations, findings and layouts</h3>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-muted">
              Formulas are controlled, versioned definitions. Here the administrator only selects which metrics may appear in rules and templates; free-form SQL is intentionally out of scope.
            </p>
          </div>
          <span className="rounded-full bg-surface-subtle px-3 py-1 text-[10px] font-semibold text-muted">
            Draft config revision {activeRevision}
          </span>
        </div>

        <ol className="mt-5 grid gap-3 md:grid-cols-3">
          <AnalysisStep number="1" title="Metrics" body="Select approved calculations." active={activeStep === "metrics"} onClick={() => setActiveStep("metrics")} />
          <AnalysisStep number="2" title="Rules" body="Select deterministic findings." active={activeStep === "rules"} onClick={() => setActiveStep("rules")} />
          <AnalysisStep number="3" title="Template layout" body="Choose and order evidence-backed modules." active={activeStep === "layout"} onClick={() => setActiveStep("layout")} />
        </ol>
      </section>

      {error ? <div className="rounded-lg border border-step-error/25 bg-step-error/5 px-4 py-3 text-xs text-step-error">{error}</div> : null}
      {notice ? <div className="rounded-lg border border-step-success/25 bg-step-success/5 px-4 py-3 text-xs text-step-success">{notice}</div> : null}

      {activeStep === "metrics" ? <section className="rounded-xl border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h4 className="text-sm font-semibold">Metric catalog</h4>
            <p className="mt-1 text-[11px] text-muted">{selected.length} of {catalog.length} metric revisions enabled</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!dirty || saving}
              onClick={() => setSelected(savedSelection)}
              className="rounded-md border border-border px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
            >
              Reset
            </button>
            <button
              type="button"
              disabled={!dirty || saving}
              onClick={() => void saveMetrics()}
              className="rounded-md bg-foreground px-3 py-2 text-xs font-semibold text-background disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? "Saving..." : "Save selection"}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-xs text-muted">Loading metric definitions...</div>
        ) : (
          <div className="space-y-7 p-5">
            {families.map(({ family, metrics }) => (
              <div key={family}>
                <div className="mb-3">
                  <h5 className="text-xs font-semibold">{metricFamilyCopy[family].label}</h5>
                  <p className="mt-1 text-[11px] text-muted">{metricFamilyCopy[family].description}</p>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  {metrics.map((metric) => {
                    const checked = selectedMetricIdSet.has(metric.revision_id);
                    const readiness = readinessByMetricId.get(metric.revision_id);
                    return (
                      <label
                        key={metric.revision_id}
                        className={[
                          "flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors",
                          checked ? "border-foreground/30 bg-surface-subtle" : "border-border hover:border-foreground/20",
                        ].join(" ")}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setSelected((current) => checked
                            ? current.filter((id) => id !== metric.revision_id)
                            : [...current, metric.revision_id])}
                          className="mt-1 h-4 w-4 accent-current"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <strong className="text-xs">{metric.display_name}</strong>
                            <span className="rounded-full bg-surface px-2 py-0.5 text-[9px] font-semibold text-muted">{metric.unit}</span>
                            <span className="rounded-full bg-surface px-2 py-0.5 text-[9px] text-muted">v{metric.version}</span>
                            {readiness ? (
                              <span className={[
                                "rounded-full px-2 py-0.5 text-[9px] font-semibold",
                                readiness.status === "ready"
                                  ? "bg-step-success/10 text-step-success"
                                  : readiness.status === "partial"
                                    ? "bg-step-warning/10 text-step-warning"
                                    : "bg-surface text-muted",
                              ].join(" ")}>{readiness.label}</span>
                            ) : null}
                          </span>
                          <span className="mt-1.5 block text-[11px] leading-4 text-muted">{metric.description}</span>
                          <span className="mt-2 block text-[10px] font-medium text-muted-light">
                            {readiness?.detail ?? "Readiness unavailable"}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section> : activeStep === "rules" ? (
        <section className="rounded-xl border border-border bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <h4 className="text-sm font-semibold">Rule catalog</h4>
              <p className="mt-1 text-[11px] text-muted">
                {selectedRules.length} of {ruleCatalog.length} deterministic rule revisions enabled · draft revision {ruleRevision}
              </p>
              <p className="mt-1 text-[10px] text-muted-light">
                Draft changes do not affect customer analysis until Review &amp; Publish.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!rulesDirty || saving}
                onClick={() => setSelectedRules(savedRuleSelection)}
                className="rounded-md border border-border px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
              >
                Reset
              </button>
              <button
                type="button"
                disabled={!rulesDirty || saving}
                onClick={() => void saveRules()}
                className="rounded-md bg-foreground px-3 py-2 text-xs font-semibold text-background disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? "Saving..." : "Save selection"}
              </button>
            </div>
          </div>

          {loading ? (
            <div className="p-8 text-center text-xs text-muted">Loading rule definitions...</div>
          ) : (
            <div className="space-y-7 p-5">
              {ruleFamilies.map(({ family, rules }) => (
                <div key={family}>
                  <div className="mb-3">
                    <h5 className="text-xs font-semibold">{ruleFamilyCopy[family].label}</h5>
                    <p className="mt-1 text-[11px] text-muted">{ruleFamilyCopy[family].description}</p>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2">
                    {rules.map((rule) => {
                      const checked = selectedRuleIdSet.has(rule.revision_id);
                      const readiness = readinessByRuleId.get(rule.revision_id);
                      return (
                        <label
                          key={rule.revision_id}
                          className={[
                            "flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors",
                            checked ? "border-foreground/30 bg-surface-subtle" : "border-border hover:border-foreground/20",
                          ].join(" ")}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setSelectedRules((current) => checked
                              ? current.filter((id) => id !== rule.revision_id)
                              : [...current, rule.revision_id])}
                            className="mt-1 h-4 w-4 accent-current"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <strong className="text-xs">{rule.display_name}</strong>
                              <span className={[
                                "rounded-full px-2 py-0.5 text-[9px] font-semibold",
                                rule.severity === "warning" ? "bg-step-warning/10 text-step-warning" : "bg-surface text-muted",
                              ].join(" ")}>{rule.severity}</span>
                              <span className="rounded-full bg-surface px-2 py-0.5 text-[9px] text-muted">v{rule.version}</span>
                              {readiness ? (
                                <span className={[
                                  "rounded-full px-2 py-0.5 text-[9px] font-semibold",
                                  readiness.status === "ready" ? "bg-step-success/10 text-step-success" : "bg-surface text-muted",
                                ].join(" ")}>{readiness.label}</span>
                              ) : null}
                            </span>
                            <span className="mt-1.5 block text-[11px] leading-4 text-muted">{rule.description}</span>
                            <span className="mt-2 block text-[10px] font-medium text-muted-light">
                              {readiness?.detail ?? "Readiness unavailable"} · {formatRuleParameters(rule)}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : (
        <TemplateLayoutPanel
          loading={loading}
          saving={saving}
          document={document}
          componentCatalog={componentCatalog}
          templateDraft={templateDraft}
          savedTemplateDocument={savedTemplateDocument}
          selectedMetricRevisionIds={selectedMetricIdSet}
          selectedRuleRevisionIds={selectedRuleIdSet}
          businessCalendarVersion={businessCalendarVersion}
          projectId={projectId}
          previewRange={previewRange}
          activeTemplateId={activeTemplateId}
          setActiveTemplateId={setActiveTemplateId}
          dirty={templateDirty}
          onReset={() => setTemplateDraft((current) => current && savedTemplateDocument
            ? { ...current, document: savedTemplateDocument }
            : current)}
          onChange={(nextDocument) => setTemplateDraft((current) => current
            ? { ...current, document: nextDocument }
            : current)}
          onSave={() => void saveTemplate()}
        />
      )}
    </div>
  );
}

function TemplateLayoutPanel({
  loading,
  saving,
  document,
  componentCatalog,
  templateDraft,
  savedTemplateDocument,
  selectedMetricRevisionIds,
  selectedRuleRevisionIds,
  businessCalendarVersion,
  projectId,
  previewRange,
  activeTemplateId,
  setActiveTemplateId,
  dirty,
  onReset,
  onChange,
  onSave,
}: {
  loading: boolean;
  saving: boolean;
  document: EnergyProjectSetupDocumentDto;
  componentCatalog: EnergyComponentRevisionDto[];
  templateDraft: EnergyProjectTemplateDraftDto | null;
  savedTemplateDocument: EnergyTemplateDraftDocumentDto | null;
  selectedMetricRevisionIds: ReadonlySet<string>;
  selectedRuleRevisionIds: ReadonlySet<string>;
  businessCalendarVersion: string;
  projectId: string;
  previewRange: EnergyPreviewRange | null;
  activeTemplateId: string;
  setActiveTemplateId: Dispatch<SetStateAction<string>>;
  dirty: boolean;
  onReset: () => void;
  onChange: (document: EnergyTemplateDraftDocumentDto) => void;
  onSave: () => void;
}) {
  if (loading || !templateDraft || !savedTemplateDocument) {
    return (
      <section className="rounded-xl border border-border bg-surface p-8 text-center text-xs text-muted">
        Loading Component Catalog and template layouts...
      </section>
    );
  }

  const tierById = new Map(document.tiers.map((tier) => [tier.id, tier]));
  const catalogById = new Map(componentCatalog.map((component) => [component.revision_id, component]));
  const selectedTemplate = templateDraft.document.templates.find((template) => template.template_id === activeTemplateId)
    ?? templateDraft.document.templates[0];
  if (!selectedTemplate) {
    return (
      <section className="rounded-xl border border-border bg-surface p-8 text-center text-xs text-muted">
        Define and save the Project Tier structure before configuring templates.
      </section>
    );
  }

  const updateComponents = (components: EnergyTemplateDefinitionDto["components"]) => onChange({
    templates: templateDraft.document.templates.map((template) => template.template_id === selectedTemplate.template_id
      ? { ...template, components }
      : template),
  });
  const enabledCount = selectedTemplate.components.filter((placement) => placement.enabled).length;
  const templateLabel = selectedTemplate.target_kind === "project"
    ? "Project Overview"
    : `${tierById.get(selectedTemplate.tier_definition_id ?? "")?.alias ?? "Tier"} Template`;
  const previewPlan = buildTemplatePreviewPlan({
    template: selectedTemplate,
    document,
    catalog: componentCatalog,
    selectedMetricRevisionIds,
    selectedRuleRevisionIds,
    businessCalendarVersion,
  });

  return (
    <section className="rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h4 className="text-sm font-semibold">Template layout</h4>
          <p className="mt-1 max-w-2xl text-[11px] leading-4 text-muted">
            Configure one Project Overview and one shared layout per Tier Definition. Templates may only reference the controlled Component Catalog.
          </p>
          <p className="mt-1 text-[10px] text-muted-light">
            Draft revision {templateDraft.revision} · changes remain invisible to customers until Review &amp; Publish.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" disabled={!dirty || saving} onClick={onReset} className="rounded-md border border-border px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40">
            Reset
          </button>
          <button type="button" disabled={!dirty || saving} onClick={onSave} className="rounded-md bg-foreground px-3 py-2 text-xs font-semibold text-background disabled:cursor-not-allowed disabled:opacity-40">
            {saving ? "Saving..." : "Save layout"}
          </button>
        </div>
      </div>

      <div className="grid min-h-[520px] lg:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="border-b border-border p-4 lg:border-b-0 lg:border-r">
          <p className="px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-light">Analysis scope</p>
          <div className="mt-3 space-y-1">
            {templateDraft.document.templates.map((template) => {
              const active = template.template_id === selectedTemplate.template_id;
              const tier = template.tier_definition_id ? tierById.get(template.tier_definition_id) : undefined;
              const label = template.target_kind === "project" ? "Project Overview" : tier?.alias ?? "Tier Template";
              const count = template.components.filter((placement) => placement.enabled).length;
              return (
                <button
                  key={template.template_id}
                  type="button"
                  onClick={() => setActiveTemplateId(template.template_id)}
                  className={[
                    "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-xs transition-colors",
                    active ? "bg-foreground text-background" : "text-muted hover:bg-surface-subtle hover:text-foreground",
                  ].join(" ")}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{label}</span>
                    <span className={["mt-0.5 block text-[9px]", active ? "text-background/65" : "text-muted-light"].join(" ")}>
                      {template.target_kind === "project" ? "Project scope" : `Shared by all ${tier?.alias ?? "Tier"} nodes`}
                    </span>
                  </span>
                  <span className={["ml-2 rounded-full px-2 py-0.5 text-[9px]", active ? "bg-background/15" : "bg-surface-subtle"].join(" ")}>{count}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h5 className="text-sm font-semibold">{templateLabel}</h5>
              <p className="mt-1 text-[11px] text-muted">{enabledCount} enabled modules · order runs from top to bottom</p>
            </div>
            <span className="rounded-full bg-surface-subtle px-2.5 py-1 text-[9px] font-semibold text-muted">
              {selectedTemplate.target_kind === "project" ? "PROJECT" : "TIER"}
            </span>
          </div>

          <div className="mt-4 space-y-2">
            {selectedTemplate.components.map((placement, index) => {
              const component = catalogById.get(placement.component_revision_id);
              if (!component) return null;
              const readiness = resolveComponentReadiness(
                component,
                selectedTemplate,
                document,
                selectedMetricRevisionIds,
                selectedRuleRevisionIds,
                businessCalendarVersion,
              );
              const dependencyCount = component.metric_revision_ids.length + component.rule_revision_ids.length;
              return (
                <div
                  key={placement.component_revision_id}
                  className={[
                    "grid gap-3 rounded-xl border p-4 sm:grid-cols-[32px_minmax(0,1fr)_auto]",
                    placement.enabled ? "border-foreground/25 bg-surface-subtle" : "border-border opacity-65",
                  ].join(" ")}
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-surface text-[10px] font-bold text-muted">{index + 1}</div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="inline-flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={placement.enabled}
                          onChange={() => updateComponents(selectedTemplate.components.map((item) => item.component_revision_id === placement.component_revision_id
                            ? { ...item, enabled: !item.enabled }
                            : item))}
                          className="h-4 w-4 accent-current"
                        />
                        <strong className="text-xs">{component.display_name}</strong>
                      </label>
                      <span className="rounded-full bg-surface px-2 py-0.5 text-[9px] capitalize text-muted">{component.family}</span>
                      <span className="rounded-full bg-surface px-2 py-0.5 text-[9px] text-muted">v{component.version}</span>
                      <span className={[
                        "rounded-full px-2 py-0.5 text-[9px] font-semibold",
                        readiness.status === "ready"
                          ? "bg-step-success/10 text-step-success"
                          : readiness.status === "partial"
                            ? "bg-step-warning/10 text-step-warning"
                            : "bg-surface text-muted",
                      ].join(" ")}>{readiness.label}</span>
                    </div>
                    <p className="mt-1.5 text-[11px] leading-4 text-muted">{component.description}</p>
                    <p className="mt-2 text-[10px] text-muted-light">
                      {readiness.detail} · {dependencyCount} controlled dependencies · {component.query_ids.length} query specs
                    </p>
                  </div>
                  <div className="flex items-center gap-1 self-center">
                    <button
                      type="button"
                      aria-label={`Move ${component.display_name} up`}
                      disabled={index === 0}
                      onClick={() => updateComponents(movePlacement(selectedTemplate.components, index, index - 1))}
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-xs disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${component.display_name} down`}
                      disabled={index === selectedTemplate.components.length - 1}
                      onClick={() => updateComponents(movePlacement(selectedTemplate.components, index, index + 1))}
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-xs disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      ↓
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <TemplateDraftPreview
        key={`${projectId}:${selectedTemplate.template_id}`}
        projectId={projectId}
        plan={previewPlan}
        previewRange={previewRange}
        dirty={dirty}
      />
    </section>
  );
}

function movePlacement(
  placements: EnergyTemplateDefinitionDto["components"],
  from: number,
  to: number,
): EnergyTemplateDefinitionDto["components"] {
  if (to < 0 || to >= placements.length || from === to) return placements;
  const next = [...placements];
  const [placement] = next.splice(from, 1);
  if (!placement) return placements;
  next.splice(to, 0, placement);
  return next;
}

function AnalysisStep({
  number,
  title,
  body,
  active = false,
  disabled = false,
  onClick,
}: {
  number: string;
  title: string;
  body: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <li className={["rounded-xl border", active ? "border-foreground/25 bg-surface-subtle" : "border-border", disabled ? "opacity-60" : ""].join(" ")}>
      <button type="button" disabled={disabled} onClick={onClick} className="w-full p-3 text-left disabled:cursor-not-allowed">
        <span className="flex items-center gap-2">
          <span className={["flex h-5 w-5 items-center justify-center rounded text-[9px] font-bold", active ? "bg-foreground text-background" : "bg-surface-subtle text-muted"].join(" ")}>{number}</span>
          <strong className="text-xs">{title}</strong>
        </span>
        <span className="mt-2 block text-[10px] leading-4 text-muted">{body}</span>
      </button>
    </li>
  );
}

function formatRuleParameters(rule: EnergyRuleRevisionDto): string {
  const threshold = rule.parameters.threshold_pct;
  if (typeof threshold === "number") return `Threshold ≥ ${threshold}%`;
  const medianRatio = rule.parameters.median_ratio;
  const minimumPeers = rule.parameters.minimum_peers;
  if (typeof medianRatio === "number" && typeof minimumPeers === "number") {
    return `≥ ${medianRatio}× sibling median · min ${minimumPeers} peers`;
  }
  if (typeof minimumPeers === "number") return `Minimum ${minimumPeers} comparable scopes`;
  return "Controlled deterministic evaluation";
}

function AdminOverview({
  projects,
  selectedProject,
  chooseAdminProject,
  setSection,
}: {
  projects: EnergyProjectDto[];
  selectedProject?: EnergyProjectDto;
  chooseAdminProject: (projectId: string) => void;
  setSection: Dispatch<SetStateAction<AdminSection>>;
}) {
  const publishedCount = projects.filter((project) => project.status === "published").length;
  const draftCount = projects.length - publishedCount;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_320px]">
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold">What needs attention</h3>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
                Start from delivery blockers. Operational alerts and AI usage will appear here after those services are connected.
              </p>
            </div>
            <span className="rounded-full bg-step-warning/10 px-2.5 py-1 text-[10px] font-semibold text-step-warning">
              {draftCount > 0 ? `${draftCount} draft project${draftCount === 1 ? "" : "s"}` : "Project setup active"}
            </span>
          </div>

          <div className="mt-5 divide-y divide-border border-y border-border">
            {projects.map((project) => (
              <div key={project.id} className="flex flex-wrap items-center gap-3 py-3.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-subtle text-muted">
                  <EnergyIcon name="building" className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{project.name}</p>
                  <p className="mt-0.5 text-[11px] capitalize text-muted">{project.status} · Project delivery</p>
                </div>
                <button type="button" onClick={() => {
                  chooseAdminProject(project.id);
                  setSection("project-overview");
                }} className={secondaryButton}>
                  Open project
                </button>
              </div>
            ))}
          </div>
        </div>

        <aside className="rounded-xl border border-border bg-surface p-5">
          <h3 className="text-sm font-semibold">Portfolio status</h3>
          <dl className="mt-4 divide-y divide-border">
            <SummaryRow label="Projects" value={String(projects.length)} />
            <SummaryRow label="Published" value={String(publishedCount)} />
            <SummaryRow label="Draft or changing" value={String(draftCount)} />
          </dl>
          <p className="mt-4 text-[11px] leading-5 text-muted">
            Counts come from the current Workspace. Import failures, AI runs and cost are not shown until their operational APIs are wired.
          </p>
        </aside>
      </section>

      <section className="rounded-xl border border-border bg-surface p-5">
        <h3 className="text-sm font-semibold">Admin operating model</h3>
        <div className="mt-4 grid gap-5 md:grid-cols-3">
          <OperatingArea title="Access" body="Create organisations and users, then assign Workspace and Project access." status="Planned" />
          <OperatingArea title="Project delivery" body={`Configure ${selectedProject?.name ?? "a project"}, validate evidence, then publish it for customer use.`} status="Active" />
          <OperatingArea title="AI operations" body="Monitor runs, queries, usage, cost and traces after the project is live." status="Planned" />
        </div>
      </section>
    </div>
  );
}

function ProjectDeliveryOverview({
  projectId,
  project,
  setup,
  document,
  setSection,
}: {
  projectId: string;
  project?: EnergyProjectDto;
  setup: EnergyProjectSetupDto;
  document: EnergyProjectSetupDocumentDto;
  setSection: Dispatch<SetStateAction<AdminSection>>;
}) {
  const [batches, setBatches] = useState<EnergyImportBatchDto[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(true);

  useEffect(() => {
    let active = true;
    setLoadingBatches(true);
    void configApi.listEnergyImportBatches(projectId)
      .then((result) => {
        if (active) setBatches(result.batches);
      })
      .catch(() => {
        if (active) setBatches([]);
      })
      .finally(() => {
        if (active) setLoadingBatches(false);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  const hasBasics = Boolean(document.project.name && document.project.timezone);
  const hasStructure = isTierStructureLocked(document) && document.tiers.length > 0 && document.nodes.length > 0;
  const latestBatch = batches[0];
  const hasConfirmedMapping = document.meter_mapping?.confirmed === true
    && document.meter_mapping.rows.length > 0;
  const progress = deriveProjectDeliveryProgress({
    hasBasics,
    hasStructure,
    hasSource: Boolean(latestBatch),
    hasConfirmedMapping,
    hasMaterializedFacts: latestBatch?.status === "materialized",
  });
  const { nextSection, nextLabel, stages } = progress;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <h3 className="text-base font-semibold">{project?.name ?? document.project.name}</h3>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
              This page coordinates the delivery workflow. Configuration remains in the specialist pages in the sidebar.
            </p>
          </div>
          <button type="button" onClick={() => setSection(nextSection)} className={primaryButton}>{nextLabel}</button>
        </div>

        <div className="mt-6 grid gap-2 lg:grid-cols-5">
          {stages.map((stage, index) => (
            <button
              key={stage.label}
              type="button"
              disabled={!stage.enabled}
              onClick={() => setSection(stage.section)}
              className="flex min-h-20 items-start gap-3 rounded-xl bg-surface-subtle p-3 text-left transition-colors enabled:hover:bg-primary-light/5 enabled:focus-visible:outline-none enabled:focus-visible:ring-2 enabled:focus-visible:ring-primary/20 disabled:cursor-default"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface text-[10px] font-semibold text-muted">{index + 1}</span>
              <span>
                <span className="block text-xs font-semibold">{stage.label}</span>
                <span className={[
                  "mt-1 block text-[10px]",
                  stage.state === "Complete" || stage.state === "Draft ready" || stage.state === "Facts ready" || stage.state === "Ready to configure"
                    ? "text-step-success"
                    : "text-muted",
                ].join(" ")}>{stage.state}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-xl border border-border bg-surface p-5">
          <h3 className="text-sm font-semibold">Recommended next action</h3>
          <div className="mt-4 flex items-start gap-3 rounded-xl bg-primary-light/5 p-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-white">
              <EnergyIcon name="arrow" className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{loadingBatches ? "Checking project data" : nextLabel}</p>
              <p className="mt-1 text-xs leading-5 text-muted">
                Structure is confirmed before source labels are mapped. Data Sources comes before Meter Mapping; virtual meters remain optional inside Mapping.
              </p>
            </div>
            <button type="button" onClick={() => setSection(nextSection)} disabled={loadingBatches} className={secondaryButton}>Continue</button>
          </div>
        </section>

        <aside className="rounded-xl border border-border bg-surface p-5">
          <h3 className="text-sm font-semibold">Published configuration</h3>
          <dl className="mt-4 divide-y divide-border">
            <SummaryRow label="Hierarchy" value={setup.project.hierarchy_revision_id || "Not published"} />
            <SummaryRow label="Tiers" value={String(setup.published.tiers.length)} />
            <SummaryRow label="Nodes" value={String(Math.max(0, setup.published.nodes.length - 1))} />
          </dl>
        </aside>
      </div>
    </div>
  );
}

function DataSourcesPage({
  projectId,
  document,
  changeDocument,
  setSection,
}: {
  projectId: string;
  document: EnergyProjectSetupDocumentDto;
  changeDocument: (updater: (current: EnergyProjectSetupDocumentDto) => EnergyProjectSetupDocumentDto) => void;
  setSection: Dispatch<SetStateAction<AdminSection>>;
}) {
  const [batches, setBatches] = useState<EnergyImportBatchDto[]>([]);
  const [loadingImports, setLoadingImports] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [materializing, setMaterializing] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);

  const loadBatches = useCallback(async () => {
    setLoadingImports(true);
    setImportError(null);
    try {
      const result = await configApi.listEnergyImportBatches(projectId);
      setBatches(result.batches);
    } catch (reason) {
      setImportError(messageFrom(reason, "Failed to load import batches"));
    } finally {
      setLoadingImports(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadBatches();
  }, [loadBatches]);

  const uploadWorkbook = async (file: File) => {
    setUploading(true);
    setImportError(null);
    setImportNotice(null);
    try {
      const result = await configApi.uploadEnergyExcelImport(projectId, file);
      setBatches((current) => [
        result.batch,
        ...current.filter((batch) => batch.id !== result.batch.id),
      ]);
      setImportNotice(result.duplicate
        ? "This exact workbook was already inspected. The existing Import Batch was reused."
        : "Workbook preserved and inspected. Review the detected labels before opening Meter Mapping.");
    } catch (reason) {
      setImportError(messageFrom(reason, "Excel inspection failed"));
    } finally {
      setUploading(false);
    }
  };

  const latest = batches[0];
  const mappingConfirmed = document.meter_mapping?.confirmed === true;
  const useDetectedLabels = () => {
    if (!latest) return;
    const mapping = createMeterMappingFromSourceLabels(
      document,
      latest.inspection.sourceLabels.map((source) => source.label),
    );
    changeDocument((current) => ({ ...current, meter_mapping: mapping }));
    setImportNotice(`${mapping.rows.length} source labels were prepared as a Mapping draft. Unmatched labels still require an admin Scope selection.`);
  };

  const materializeLatest = async () => {
    if (!latest) return;
    setMaterializing(true);
    setImportError(null);
    setImportNotice(null);
    try {
      const result = await configApi.materializeEnergyImportBatch(projectId, latest.id);
      setBatches((current) => current.map((batch) => batch.id === result.batch.id ? result.batch : batch));
      setImportNotice(result.duplicate
        ? "This Import Batch was already materialized. Existing facts were reused."
        : "Raw readings, interval facts and quality events were materialized successfully.");
    } catch (reason) {
      setImportError(messageFrom(reason, "Fact materialization failed"));
    } finally {
      setMaterializing(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {importError ? <StatusMessage tone="error">{importError}</StatusMessage> : null}
      {importNotice ? <StatusMessage tone="success">{importNotice}</StatusMessage> : null}
      <section className="rounded-xl border border-border bg-surface p-5">
        <h3 className="text-base font-semibold">Connect project data</h3>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-muted">
          Excel is the current onboarding path. Tuya will use the same Import Batch and Raw Reading contract when its API is available.
        </p>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-primary/30 bg-primary-light/5 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold">Excel workbook</h4>
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-primary">Current onboarding format</p>
              </div>
              <EnergyIcon name="check" className="h-4 w-4 text-primary" />
            </div>
            <p className="mt-3 text-xs leading-5 text-muted">Upload one `.xlsx`, inspect the fixed cumulative-reading contract and preserve the original bytes by SHA.</p>
            <label className={`${primaryButton} mt-4 inline-flex cursor-pointer`}>
              {uploading ? "Inspecting workbook..." : "Upload Excel"}
              <input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={uploading}
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void uploadWorkbook(file);
                }}
              />
            </label>
          </div>
          <SourceOption title="Tuya API" status="Connector pending" description="Daily synchronisation will reuse the same downstream mapping and quality rules." />
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Latest Import Batch</h3>
            <p className="mt-1 text-xs text-muted">An import is evidence only; it does not change the published hierarchy or Mapping.</p>
          </div>
          {latest ? (
            <span className={latest.status === "materialized" || latest.inspection.qualityStatus === "ready"
              ? "rounded-full bg-step-success/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wide text-step-success"
              : "rounded-full bg-step-warning/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wide text-step-warning"}
            >
              {latest.status === "materialized"
                ? "Facts ready"
                : latest.inspection.qualityStatus === "ready"
                  ? "Ready for mapping"
                  : "Review quality"}
            </span>
          ) : null}
        </div>
        {loadingImports ? (
          <p className="mt-5 text-xs text-muted">Loading imports...</p>
        ) : latest ? (
          <div className="mt-5 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <ImportFact label="Workbook" value={latest.filename} />
              <ImportFact label="Rows" value={`${latest.inspection.validRowCount.toLocaleString()} valid / ${latest.inspection.rowCount.toLocaleString()}`} />
              <ImportFact label="Source labels" value={String(latest.inspection.sourceLabels.length)} />
              <ImportFact label="Typical interval" value={latest.inspection.typicalIntervalMinutes ? `${latest.inspection.typicalIntervalMinutes} min` : "Unknown"} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ImportFact label="Coverage" value={formatImportCoverage(latest)} />
              <ImportFact label="SHA-256" value={latest.sourceSha256.slice(0, 16)} mono />
            </div>
            {latest.materialization ? (
              <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-4">
                <ImportFact label="Raw readings" value={latest.materialization.rawRowCount.toLocaleString()} />
                <ImportFact label="Normalized" value={latest.materialization.normalizedReadingCount.toLocaleString()} />
                <ImportFact label="Interval facts" value={latest.materialization.intervalFactCount.toLocaleString()} />
                <ImportFact label="All-meter deltas" value={`${latest.materialization.totalUsageKwh.toLocaleString("en-SG", { maximumFractionDigits: 3 })} kWh`} />
              </div>
            ) : null}
            {latest.inspection.issues.length > 0 ? (
              <ul className="space-y-1 rounded-lg bg-step-warning/5 px-4 py-3 text-[11px] text-step-warning">
                {latest.inspection.issues.map((issue) => <li key={issue}>• {issue}</li>)}
              </ul>
            ) : (
              <p className="rounded-lg bg-step-success/5 px-4 py-3 text-[11px] text-step-success">Required fields, timestamps and cumulative readings passed the inspection.</p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <div>
                <p className="text-xs text-muted">Detected: {latest.inspection.columns.join(" · ")}</p>
                {latest.status !== "materialized" && !mappingConfirmed ? (
                  <p className="mt-1 text-[10px] text-step-warning">Confirm and save Meter Mapping before building facts.</p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={useDetectedLabels} disabled={latest.status === "materialized"} className={secondaryButton}>Use detected labels</button>
                {latest.status === "materialized" ? null : (
                  <button type="button" onClick={() => void materializeLatest()} disabled={!mappingConfirmed || materializing} className={primaryButton}>
                    {materializing ? "Building facts..." : "Build interval facts"}
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-5 rounded-lg border border-dashed border-border px-5 py-8 text-center">
            <p className="text-sm font-semibold">No Excel Import Batch yet</p>
            <p className="mt-1 text-xs text-muted">Upload the first workbook above. Mapping stays unavailable until labels are inspected.</p>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-surface p-5">
        <h3 className="text-sm font-semibold">First source workflow</h3>
        <ol className="mt-4 grid gap-3 md:grid-cols-4">
          <WorkflowStep number="1" title="Add source" body="Choose Excel now or Tuya later." />
          <WorkflowStep number="2" title="Inspect labels" body="Confirm fields, time range and raw coverage." />
          <WorkflowStep number="3" title="Map meters" body="Continue to physical meter mapping." />
          <WorkflowStep number="4" title="Validate data" body="Review duplicates, gaps and quality evidence." />
        </ol>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="max-w-2xl text-xs leading-5 text-muted">
            Adding a source does not change customer-facing analysis until its mapping and quality checks are approved.
          </p>
          <button type="button" onClick={() => setSection("meter-mapping")} disabled={!document.meter_mapping?.rows.length} className={secondaryButton}>Open Meter Mapping</button>
        </div>
      </section>
    </div>
  );
}

function ImportFact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg bg-surface-subtle px-3 py-2.5">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 truncate text-xs font-semibold ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

const formatImportCoverage = (batch: EnergyImportBatchDto): string => {
  const from = batch.inspection.coverageFrom;
  const to = batch.inspection.coverageTo;
  if (!from || !to) return "Unknown";
  return `${new Date(from).toLocaleDateString("en-SG")} – ${new Date(to).toLocaleDateString("en-SG")}`;
};

function MeterMappingPage({
  setSection,
  intent,
  document,
  changeDocument,
}: {
  setSection: Dispatch<SetStateAction<AdminSection>>;
  intent: MeterMappingIntent | null;
  document: EnergyProjectSetupDocumentDto;
  changeDocument: (updater: (current: EnergyProjectSetupDocumentDto) => EnergyProjectSetupDocumentDto) => void;
}) {
  const mapping = document.meter_mapping ?? {
    source_kind: "excel" as const,
    rows: [],
    confirmed: false,
  };
  const [reviewing, setReviewing] = useState(false);
  const [selectedRowId, setSelectedRowId] = useState(
    () => mapping.rows.find((row) => row.scope_id === intent?.scopeId)?.id ?? mapping.rows[0]?.id ?? "",
  );
  const selectedRow = mapping.rows.find((row) => row.id === selectedRowId) ?? mapping.rows[0] ?? null;
  const aggregation = useMemo(() => buildAggregationReview(document, mapping), [document, mapping]);
  const conflicts = aggregation.filter((group) => group.conflict);
  const missingScopes = mapping.rows.filter((row) => !document.nodes.some((node) => node.id === row.scope_id));
  const setMapping = (next: EnergyMeterMappingDraftDto) => {
    changeDocument((current) => ({ ...current, meter_mapping: next }));
  };

  useEffect(() => {
    if (!selectedRowId && mapping.rows[0]) setSelectedRowId(mapping.rows[0].id);
  }, [mapping.rows, selectedRowId]);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">Data & Meters</span>
            <h3 className="mt-1 text-base font-semibold">Map source labels to existing Scopes</h3>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-muted">Mapping cannot create Floors, Rooms or Circuits. If a Scope is missing, return to Structure, add it, then continue here.</p>
          </div>
          {intent ? (
            <div className="rounded-lg bg-primary-light/5 px-3 py-2 text-right">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-primary">Selected from Structure</p>
              <p className="mt-0.5 text-xs font-semibold">{intent.scopeName}</p>
            </div>
          ) : null}
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-4">
          <MappingProgressStep number="1" label="Source labels" state="Complete" active={!reviewing} />
          <MappingProgressStep number="2" label="Physical Mapping" state={`${mapping.rows.length} labels`} active={!reviewing} />
          <MappingProgressStep number="3" label="Aggregation review" state={conflicts.length ? `${conflicts.length} conflicts` : "Ready"} active={reviewing} />
          <MappingProgressStep number="4" label="Confirm" state={mapping.confirmed ? "Confirmed" : "Draft"} active={false} />
        </div>
      </section>

      {!reviewing ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className="min-w-0 rounded-xl border border-border bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <h4 className="text-sm font-semibold">Imported source labels</h4>
                <p className="mt-1 text-xs text-muted">Labels preserve the exact Excel `Device Name`; suggested Scopes remain editable by an admin.</p>
              </div>
              <span className="rounded-full bg-primary-light/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wide text-primary">Excel import</span>
            </div>
            {mapping.rows.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
                <p className="text-sm font-semibold">No source labels available</p>
                <p className="mt-1 text-xs text-muted">Connect an Excel source, or complete the lowest Tier nodes for this pilot.</p>
              </div>
            ) : (
              <div className="max-h-[620px] overflow-auto divide-y divide-border">
                {mapping.rows.map((row) => {
                  const scope = document.nodes.find((node) => node.id === row.scope_id);
                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => setSelectedRowId(row.id)}
                      className={[
                        "grid w-full gap-2 px-5 py-3 text-left transition-colors sm:grid-cols-[minmax(180px,1.3fr)_minmax(140px,1fr)_90px_88px] sm:items-center",
                        selectedRow?.id === row.id ? "bg-primary-light/5" : "hover:bg-surface-subtle",
                      ].join(" ")}
                    >
                      <span className="truncate text-xs font-semibold">{row.source_label}</span>
                      <span className="truncate text-[11px] text-muted">{scope ? nodePathLabel(document, scope.id) : "Missing Scope"}</span>
                      <span className="text-[10px] capitalize text-muted">{row.category}</span>
                      <span className={scope ? "text-[10px] font-semibold text-step-success" : "text-[10px] font-semibold text-step-error"}>{scope ? "Mapped" : "Needs Scope"}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <aside className="space-y-5">
            {selectedRow ? (
              <MeterMappingEditor
                key={selectedRow.id}
                row={selectedRow}
                document={document}
                onApply={(nextRow) => setMapping({
                  ...mapping,
                  confirmed: false,
                  rows: mapping.rows.map((row) => row.id === nextRow.id ? nextRow : row),
                })}
                onReturnToStructure={() => setSection("structure")}
              />
            ) : null}
          </aside>
        </div>
      ) : (
        <AggregationReviewPanel
          document={document}
          mapping={mapping}
          groups={aggregation}
          onChange={(next) => setMapping({ ...next, confirmed: false })}
        />
      )}

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface p-5">
        <div>
          <h4 className="text-sm font-semibold">{reviewing ? "Confirm the Mapping Checkpoint" : "Ready to review aggregation?"}</h4>
          <p className="mt-1 text-xs leading-5 text-muted">
            {reviewing
              ? "Mark the reviewed Mapping as confirmed, then use Save draft in the page header. Final customer publication still happens in Review & Publish."
              : "Review groups by Scope, resource and category before confirmation. Overall is never added to Load, Light, Aircon or Other."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setSection("structure")} className={secondaryButton}>Return to Structure</button>
          {reviewing ? (
            <>
              <button type="button" onClick={() => setReviewing(false)} className={secondaryButton}>Back to labels</button>
              <button
                type="button"
                disabled={conflicts.length > 0 || missingScopes.length > 0 || mapping.rows.length === 0}
                onClick={() => setMapping({ ...mapping, confirmed: true })}
                className={primaryButton}
              >
                Mark Mapping Confirmed
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setReviewing(true)} disabled={mapping.rows.length === 0} className={primaryButton}>Review aggregation</button>
          )}
        </div>
      </section>
    </div>
  );
}

function MappingProgressStep({ number, label, state, active }: { number: string; label: string; state: string; active: boolean }) {
  return (
    <div className={[
      "flex items-center gap-3 rounded-xl px-3 py-2.5",
      active ? "bg-primary-light/5" : "bg-surface-subtle",
    ].join(" ")}>
      <span className={[
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[9px] font-semibold",
        active ? "bg-primary text-white" : "bg-surface text-muted",
      ].join(" ")}>{number}</span>
      <span className="min-w-0"><span className="block truncate text-[11px] font-semibold">{label}</span><span className="block text-[9px] text-muted">{state}</span></span>
    </div>
  );
}

function MeterMappingEditor({
  row,
  document,
  onApply,
  onReturnToStructure,
}: {
  row: EnergyMeterMappingRowDto;
  document: EnergyProjectSetupDocumentDto;
  onApply: (row: EnergyMeterMappingRowDto) => void;
  onReturnToStructure: () => void;
}) {
  const [draft, setDraft] = useState(row);
  const scopeExists = document.nodes.some((node) => node.id === draft.scope_id);
  const orderedTiers = tiersTopDown(document);
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h4 className="text-sm font-semibold">Mapping details</h4>
      <p className="mt-1 text-xs leading-5 text-muted">A source label always creates or updates a Physical Meter Point. Virtual Meters are optional and reviewed after this step.</p>
      <div className="mt-5 space-y-4">
        <ReadOnlyField label="Source label" value={draft.source_label} />
        <Field label="Meter display name">
          <input value={draft.display_name} onChange={(event) => setDraft((current) => ({ ...current, display_name: event.target.value }))} className={inputClass} />
        </Field>
        <Field label="Existing Scope" hint="Scopes are created only in Structure.">
          <select value={draft.scope_id} onChange={(event) => setDraft((current) => ({ ...current, scope_id: event.target.value }))} className={`${inputClass} ${scopeExists ? "" : "border-step-error"}`}>
            <option value="">Select an existing Scope</option>
            {orderedTiers.flatMap((tier) => document.nodes
              .filter((node) => node.tier_definition_id === tier.id)
              .map((node) => <option key={node.id} value={node.id}>{tier.alias} · {nodePathLabel(document, node.id)}</option>))}
          </select>
          {!scopeExists ? <button type="button" onClick={onReturnToStructure} className="mt-2 text-[11px] font-semibold text-step-error hover:underline">Scope missing · Return to Structure</button> : null}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Resource">
            <select value={draft.resource} onChange={(event) => setDraft((current) => ({ ...current, resource: event.target.value as EnergyMeterMappingRowDto["resource"] }))} className={inputClass}>
              <option value="electricity">Electricity</option>
              <option value="water">Water</option>
            </select>
          </Field>
          <Field label="Category">
            <select value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value as EnergyMeterMappingRowDto["category"] }))} className={inputClass}>
              <option value="overall">Overall</option>
              <option value="load">Load</option>
              <option value="light">Light</option>
              <option value="aircon">Aircon</option>
              <option value="other">Other</option>
            </select>
          </Field>
        </div>
        <Field label="Coverage" hint="This describes what the meter covers inside the selected Scope and Category.">
          <select value={draft.coverage} onChange={(event) => setDraft((current) => ({ ...current, coverage: event.target.value as EnergyMeterMappingRowDto["coverage"] }))} className={inputClass}>
            <option value="whole">Whole scope</option>
            <option value="partial">Partial</option>
            <option value="reference">Reference only</option>
          </select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Meter Role">
            <select value={draft.meter_role} onChange={(event) => setDraft((current) => ({ ...current, meter_role: event.target.value as EnergyMeterMappingRowDto["meter_role"] }))} className={inputClass}>
              <option value="total">Total</option>
              <option value="component">Component</option>
              <option value="standalone">Standalone</option>
            </select>
          </Field>
          <Field label="Official aggregation">
            <select value={draft.aggregation_usage} onChange={(event) => setDraft((current) => ({ ...current, aggregation_usage: event.target.value as EnergyMeterMappingRowDto["aggregation_usage"] }))} className={inputClass}>
              <option value="official">Included</option>
              <option value="excluded">Excluded</option>
            </select>
          </Field>
        </div>
        {draft.meter_role === "standalone" && draft.aggregation_usage === "official" ? (
          <p className="rounded-lg bg-step-error/10 px-3 py-2 text-[11px] font-medium text-step-error">Standalone meters must be excluded from official aggregation.</p>
        ) : null}
        <button type="button" disabled={!scopeExists || !draft.display_name.trim() || (draft.meter_role === "standalone" && draft.aggregation_usage === "official")} onClick={() => onApply({ ...draft, display_name: draft.display_name.trim() })} className={`${primaryButton} w-full`}>Apply Mapping</button>
      </div>
    </section>
  );
}

function AggregationReviewPanel({
  document,
  mapping,
  groups,
  onChange,
}: {
  document: EnergyProjectSetupDocumentDto;
  mapping: EnergyMeterMappingDraftDto;
  groups: ReturnType<typeof buildAggregationReview>;
  onChange: (mapping: EnergyMeterMappingDraftDto) => void;
}) {
  const overallCount = groups.filter((group) => group.category === "overall").length;
  const [addingVirtual, setAddingVirtual] = useState(false);
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="rounded-xl border border-border bg-surface">
        <div className="border-b border-border px-5 py-4">
          <h4 className="text-sm font-semibold">Official aggregation review</h4>
          <p className="mt-1 text-xs leading-5 text-muted">One official Total is allowed for each Scope, resource and category. Included Components are summed only when no official Total is selected.</p>
        </div>
        <div className="divide-y divide-border">
          {groups.map((group) => (
            <div key={group.key} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(160px,1fr)_100px_minmax(180px,1fr)_90px] md:items-center">
              <div><p className="text-xs font-semibold">{group.scopeName}</p><p className="mt-0.5 text-[10px] capitalize text-muted">{group.resource}</p></div>
              <span className="text-[10px] font-semibold capitalize text-muted">{group.category}</span>
              <div><p className="text-[11px] font-semibold capitalize">{group.recommendation}</p><p className="mt-0.5 text-[10px] text-muted">{group.officialTotals.length} totals · {group.officialComponents.length} components · {group.excluded.length} excluded</p></div>
              <span className={group.conflict ? "text-[10px] font-semibold text-step-error" : "text-[10px] font-semibold text-step-success"}>{group.conflict ? "Conflict" : "Ready"}</span>
            </div>
          ))}
        </div>
      </section>
      <aside className="space-y-5">
        <section className="rounded-xl border border-border bg-surface p-5">
          <h4 className="text-sm font-semibold">Review summary</h4>
          <dl className="mt-4 divide-y divide-border">
            <SummaryRow label="Physical labels" value={String(mapping.rows.length)} />
            <SummaryRow label="Aggregation groups" value={String(groups.length)} />
            <SummaryRow label="Overall routes" value={String(overallCount)} />
            <SummaryRow label="Missing Scopes" value={String(mapping.rows.filter((row) => !document.nodes.some((node) => node.id === row.scope_id)).length)} />
          </dl>
        </section>
        <section className="rounded-xl border border-border bg-surface p-5">
          <h4 className="text-sm font-semibold">Optional Virtual Meter</h4>
          <p className="mt-2 text-xs leading-5 text-muted">Create an optional + / - formula from mapped physical meters. Virtual Meters stay standalone and excluded from official totals.</p>
          <button type="button" onClick={() => setAddingVirtual((current) => !current)} className={`${secondaryButton} mt-4 w-full`}>{addingVirtual ? "Cancel" : "Add Virtual Meter"}</button>
        </section>
      </aside>
      {(addingVirtual || (mapping.virtual_meters?.length ?? 0) > 0) ? (
        <VirtualMeterPanel
          document={document}
          mapping={mapping}
          adding={addingVirtual}
          onCancel={() => setAddingVirtual(false)}
          onChange={onChange}
        />
      ) : null}
    </div>
  );
}

function VirtualMeterPanel({
  document,
  mapping,
  adding,
  onCancel,
  onChange,
}: {
  document: EnergyProjectSetupDocumentDto;
  mapping: EnergyMeterMappingDraftDto;
  adding: boolean;
  onCancel: () => void;
  onChange: (mapping: EnergyMeterMappingDraftDto) => void;
}) {
  const initialScopeId = mapping.rows[0]?.scope_id ?? document.nodes[0]?.id ?? "";
  const [name, setName] = useState("Load 12");
  const [scopeId, setScopeId] = useState(initialScopeId);
  const [resource, setResource] = useState<EnergyVirtualMeterDto["resource"]>("electricity");
  const [category, setCategory] = useState<EnergyVirtualMeterDto["category"]>("load");
  const [terms, setTerms] = useState<Record<string, 0 | 1 | -1>>({});
  const selectedTerms = Object.entries(terms).filter((entry): entry is [string, 1 | -1] => entry[1] !== 0);
  const availableRows = mapping.rows.filter((row) => row.resource === resource);
  const saveVirtualMeter = () => {
    const virtualMeter: EnergyVirtualMeterDto = {
      id: `virtual-${Date.now()}`,
      display_name: name.trim(),
      scope_id: scopeId,
      resource,
      category,
      terms: selectedTerms.map(([mappingRowId, coefficient]) => ({ mapping_row_id: mappingRowId, coefficient })),
    };
    onChange({ ...mapping, virtual_meters: [...(mapping.virtual_meters ?? []), virtualMeter] });
    onCancel();
  };
  return (
    <section className="rounded-xl border border-border bg-surface xl:col-span-2">
      <div className="border-b border-border px-5 py-4">
        <h4 className="text-sm font-semibold">Virtual Meters</h4>
        <p className="mt-1 text-xs leading-5 text-muted">Optional derived values for comparison or gap analysis. They never alter official rollups in this pilot.</p>
      </div>
      {(mapping.virtual_meters?.length ?? 0) > 0 ? (
        <div className="divide-y divide-border">
          {mapping.virtual_meters?.map((virtualMeter) => (
            <div key={virtualMeter.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
              <div>
                <p className="text-xs font-semibold">{virtualMeter.display_name}</p>
                <p className="mt-1 text-[10px] text-muted">{nodePathLabel(document, virtualMeter.scope_id)} · {virtualMeter.terms.map((term, index) => {
                  const label = mapping.rows.find((row) => row.id === term.mapping_row_id)?.display_name ?? "Missing meter";
                  return `${index === 0 && term.coefficient === 1 ? "" : term.coefficient === 1 ? "+ " : "- "}${label}`;
                }).join(" ")}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[9px] font-semibold uppercase tracking-wide text-muted">Standalone · Excluded</span>
                <button type="button" onClick={() => onChange({ ...mapping, virtual_meters: mapping.virtual_meters?.filter((item) => item.id !== virtualMeter.id) })} className="text-[10px] font-semibold text-step-error hover:underline">Delete</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {adding ? (
        <div className="grid gap-5 border-t border-border p-5 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-4">
            <Field label="Display name"><input value={name} onChange={(event) => setName(event.target.value)} className={inputClass} /></Field>
            <Field label="Existing Scope">
              <select value={scopeId} onChange={(event) => setScopeId(event.target.value)} className={inputClass}>
                {tiersTopDown(document).flatMap((tier) => document.nodes.filter((node) => node.tier_definition_id === tier.id).map((node) => <option key={node.id} value={node.id}>{tier.alias} · {nodePathLabel(document, node.id)}</option>))}
              </select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <Field label="Resource"><select value={resource} onChange={(event) => { setResource(event.target.value as EnergyVirtualMeterDto["resource"]); setTerms({}); }} className={inputClass}><option value="electricity">Electricity</option><option value="water">Water</option></select></Field>
              <Field label="Category"><select value={category} onChange={(event) => setCategory(event.target.value as EnergyVirtualMeterDto["category"])} className={inputClass}><option value="overall">Overall</option><option value="load">Load</option><option value="light">Light</option><option value="aircon">Aircon</option><option value="other">Other</option></select></Field>
            </div>
            <button type="button" disabled={!name.trim() || !scopeId || selectedTerms.length < 2} onClick={saveVirtualMeter} className={`${primaryButton} w-full`}>Save Virtual Meter</button>
            <p className="text-[10px] leading-4 text-muted">Choose at least two inputs. Use + to sum circuits or - to calculate a residual from a total.</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Formula inputs</p>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {availableRows.map((row) => (
                <div key={row.id} className="flex items-center gap-3 rounded-lg bg-surface-subtle px-3 py-2.5">
                  <select value={terms[row.id] ?? 0} onChange={(event) => setTerms((current) => ({ ...current, [row.id]: Number(event.target.value) as 0 | 1 | -1 }))} aria-label={`Formula operator for ${row.source_label}`} className="h-8 rounded-md border border-border bg-surface px-2 text-xs">
                    <option value="0">Off</option><option value="1">+</option><option value="-1">-</option>
                  </select>
                  <span className="min-w-0"><span className="block truncate text-[11px] font-semibold">{row.display_name}</span><span className="block truncate text-[9px] text-muted">{nodePathLabel(document, row.scope_id)}</span></span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function PlannedAdminPage({ title, description, dependency }: { title: string; description: string; dependency: string }) {
  return (
    <div className="mx-auto max-w-4xl">
      <section className="rounded-xl border border-border bg-surface p-6">
        <span className="inline-flex rounded-full bg-surface-subtle px-2.5 py-1 text-[10px] font-semibold text-muted">Planned</span>
        <h3 className="mt-4 text-base font-semibold">{title}</h3>
        <p className="mt-2 max-w-2xl text-xs leading-5 text-muted">{description}</p>
        <p className="mt-5 border-t border-border pt-4 text-xs text-muted"><strong className="text-foreground">Depends on:</strong> {dependency}</p>
      </section>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-4 py-2.5"><dt className="text-xs text-muted">{label}</dt><dd className="max-w-[60%] truncate text-xs font-semibold">{value}</dd></div>;
}

function OperatingArea({ title, body, status }: { title: string; body: string; status: string }) {
  return <div><div className="flex items-center justify-between gap-3"><h4 className="text-xs font-semibold">{title}</h4><span className="text-[10px] text-muted-light">{status}</span></div><p className="mt-2 text-xs leading-5 text-muted">{body}</p></div>;
}

function SourceOption({ title, status, description, active = false }: { title: string; status: string; description: string; active?: boolean }) {
  return <div className={["rounded-xl p-4", active ? "bg-primary-light/5" : "bg-surface-subtle"].join(" ")}><div className="flex items-center justify-between gap-3"><h4 className="text-sm font-semibold">{title}</h4><span className={active ? "text-[10px] font-semibold text-step-success" : "text-[10px] text-muted-light"}>{status}</span></div><p className="mt-2 text-xs leading-5 text-muted">{description}</p></div>;
}

function WorkflowStep({ number, title, body }: { number: string; title: string; body: string }) {
  return <li className="flex items-start gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-subtle text-[10px] font-semibold text-muted">{number}</span><span><strong className="block text-xs">{title}</strong><span className="mt-1 block text-[11px] leading-4 text-muted">{body}</span></span></li>;
}

function plannedSectionCopy(section: AdminSection): { title: string; description: string; dependency: string } {
  const copy: Partial<Record<AdminSection, { title: string; description: string; dependency: string }>> = {
    "data-map": { title: "Data Map", description: "Review configured scopes, meters, sources and trusted relationships without replacing authoritative project configuration.", dependency: "Published Structure and Meter Mapping" },
    templates: { title: "Templates", description: "Configure the Project Overview template and one shared analysis template for each Tier Definition.", dependency: "Metrics, rules and mapped facts" },
    knowledge: { title: "Project Knowledge", description: "Add operational documents that AI may cite. Structured meter facts and mappings do not belong in the knowledge base.", dependency: "Project scope and access policy" },
    assets: { title: "Project Assets", description: "Store project files that belong to this Project rather than a user's personal temporary assets.", dependency: "Project scope and storage policy" },
  };
  return copy[section] ?? { title: "Admin capability", description: "This capability is part of the agreed Admin information architecture but is not connected in the current pilot.", dependency: "A later implementation batch" };
}

function isProjectContext(section: AdminSection): boolean {
  return ["project-overview", "basics", "structure", "data-sources", "meter-mapping", "data-map", "templates", "knowledge", "assets"].includes(section);
}

function adminSectionMeta(section: AdminSection, projectName?: string): { title: string; description: string } {
  const project = projectName ?? "Selected project";
  const copy: Record<AdminSection, { title: string; description: string }> = {
    overview: { title: "Overview", description: "Delivery priorities and platform operations across the current Workspace." },
    organisations: { title: "Organisations", description: "Customer organisations and Workspace ownership." },
    users: { title: "Users", description: "Accounts, membership and Project access." },
    "project-overview": { title: "Project Overview", description: `${project} · delivery status, blockers and next action.` },
    basics: { title: "Project basics", description: `${project} · identity, timezone and stable Project scope.` },
    structure: { title: "Structure", description: `${project} · define meaningful Tiers and Nodes from the lowest scope upward.` },
    "data-sources": { title: "Data Sources", description: `${project} · Excel now, Tuya later, one downstream fact contract.` },
    "meter-mapping": { title: "Meter Mapping", description: `${project} · source labels to physical meters, scopes and optional derived meters.` },
    "data-map": { title: "Data Map", description: `${project} · trusted configured relationships and traceable lineage.` },
    templates: { title: "Templates", description: `${project} · controlled Project and Tier analysis templates.` },
    knowledge: { title: "Knowledge", description: `${project} · documents and citations available to AI.` },
    assets: { title: "Assets", description: `${project} · Project-owned files and source material.` },
    runs: { title: "Runs & Replays", description: "Analysis runs, deterministic replays and failures." },
    conversations: { title: "Conversations & Queries", description: "Customer questions, common intents and support investigation." },
    usage: { title: "Usage & Cost", description: "Model usage, token cost and budget signals." },
    traces: { title: "Traces", description: "AI session execution and evidence traces." },
    models: { title: "Models & Routing", description: "Model providers, task routing and fallback order." },
    skills: { title: "Skills", description: "Managed analysis skills available to EnergyIQ agents." },
    tools: { title: "Tools", description: "Tool permissions and runtime availability." },
    mcp: { title: "MCP", description: "External MCP servers and their approved capabilities." },
  };
  return copy[section];
}

function ProjectProfile({
  setup,
  document,
  validation,
  errorCount,
  warningCount,
  changeDocument,
  onBack,
}: {
  setup: EnergyProjectSetupDto;
  document: EnergyProjectSetupDocumentDto;
  validation: EnergyProjectSetupValidationDto | null;
  errorCount: number;
  warningCount: number;
  changeDocument: (updater: (current: EnergyProjectSetupDocumentDto) => EnergyProjectSetupDocumentDto) => void;
  onBack: () => void;
}) {
  return (
    <div className="mx-auto grid max-w-6xl gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-5">
        <section className="rounded-xl border border-border bg-surface p-5">
          <div className="mb-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Project profile</h3>
              <button type="button" onClick={onBack} className="text-xs font-medium text-primary hover:text-primary-light">Back to Project Overview</button>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted">
              Keep the Project as a stable business container. Estate, Block, Floor, Room, Area and Circuit belong in the configurable tier ladder only when they add analytical value.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Project name">
              <input
                value={document.project.name}
                onChange={(event) => changeDocument((current) => ({
                  ...current,
                  project: { ...current.project, name: event.target.value },
                }))}
                className={inputClass}
              />
            </Field>
            <Field label="Timezone">
              <select
                value={document.project.timezone}
                onChange={(event) => changeDocument((current) => ({
                  ...current,
                  project: { ...current.project, timezone: event.target.value },
                }))}
                className={inputClass}
              >
                <option value="Asia/Singapore">Asia/Singapore (SGT)</option>
                <option value="Asia/Kuala_Lumpur">Asia/Kuala Lumpur (MYT)</option>
                <option value="UTC">UTC</option>
              </select>
            </Field>
            <ReadOnlyField label="Project ID" value={setup.project.id} />
            <ReadOnlyField label="Workspace ID" value={setup.project.workspace_id} />
          </div>
        </section>

        <section className="rounded-xl border border-border bg-surface p-5">
          <h3 className="text-sm font-semibold">Published configuration</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Fact label="Hierarchy revision" value={setup.project.hierarchy_revision_id} />
            <Fact label="Published tiers" value={String(setup.published.tiers.length)} />
            <Fact label="Published nodes" value={String(Math.max(0, setup.published.nodes.length - 1))} />
          </div>
          <p className="mt-4 text-xs leading-5 text-muted">
            Draft changes do not alter Overview, Project Explorer or AI query scope. Publish creates one immutable hierarchy snapshot and atomically switches customer pages to it.
          </p>
        </section>
      </div>

      <div className="space-y-5">
        <section className="rounded-xl border border-border bg-surface p-5">
          <h3 className="text-sm font-semibold">Setup readiness</h3>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Fact label="Blocking errors" value={String(errorCount)} tone={errorCount ? "error" : "default"} />
            <Fact label="Warnings" value={String(warningCount)} tone={warningCount ? "warning" : "default"} />
          </div>
          <ValidationList validation={validation} compact />
        </section>
        <section className="rounded-xl border border-border bg-surface p-5">
          <h3 className="text-sm font-semibold">Recommended order</h3>
          <ol className="mt-3 space-y-3 text-xs leading-5 text-muted">
            <li><strong className="text-foreground">1.</strong> Confirm project name and timezone.</li>
            <li><strong className="text-foreground">2.</strong> Build tiers from the lowest useful scope upward.</li>
            <li><strong className="text-foreground">3.</strong> Add nodes and confirm area or typical daily people where available.</li>
            <li><strong className="text-foreground">4.</strong> Validate, review warnings, then publish.</li>
          </ol>
        </section>
      </div>
    </div>
  );
}

function StructureEditor(props: {
  projectId: string;
  document: EnergyProjectSetupDocumentDto;
  validation: EnergyProjectSetupValidationDto | null;
  selectedNodeId: string | null;
  setSelectedNodeId: Dispatch<SetStateAction<string | null>>;
  changeDocument: (updater: (current: EnergyProjectSetupDocumentDto) => EnergyProjectSetupDocumentDto) => void;
  onOpenMeterMapping: (node: EnergyProjectSetupNodeDto, kind: MeterMappingIntent["kind"]) => void;
}) {
  if (!isTierStructureLocked(props.document)) {
    return (
      <TierSetup
        projectId={props.projectId}
        document={props.document}
        changeDocument={props.changeDocument}
        onLocked={() => props.setSelectedNodeId(null)}
      />
    );
  }
  return <HierarchyBuilder {...props} />;
}

function TierSetup({
  projectId,
  document,
  changeDocument,
  onLocked,
}: {
  projectId: string;
  document: EnergyProjectSetupDocumentDto;
  changeDocument: (updater: (current: EnergyProjectSetupDocumentDto) => EnergyProjectSetupDocumentDto) => void;
  onLocked: () => void;
}) {
  const orderedTiers = useMemo(() => tiersTopDown(document), [document]);
  const aliases = document.tiers.map((tier) => tier.alias.trim().replace(/\s+/g, " ").toLocaleLowerCase());
  const duplicateAliases = new Set(aliases.filter((alias, index) => alias && aliases.indexOf(alias) !== index));
  const canLock = canLockTierStructure(document);
  const hasNodes = document.nodes.length > 0;

  const updateTier = (tierId: string, patch: Partial<EnergyTierDefinitionDto>) => {
    changeDocument((current) => ({
      ...current,
      tiers: current.tiers.map((tier) => tier.id === tierId ? { ...tier, ...patch } : tier),
    }));
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">Structure · Step 1 of 2</span>
            <h3 className="mt-1 text-base font-semibold">Define the Tier Structure</h3>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
              Define the lowest meaningful Tier first, then add parent Tiers upward. Confirm the depth before creating real Project nodes.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {document.tiers.length > 0 ? (
              <button
                type="button"
                disabled={hasNodes}
                onClick={() => changeDocument(removeHighestTier)}
                className={secondaryButton}
                title={hasNodes ? "Reset the hierarchy before changing Tier depth" : "Remove the highest Tier"}
              >
                Remove top Tier
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => changeDocument((current) => addParentTier(current, projectId))}
              disabled={document.tiers.length >= 7 || hasNodes}
              className={secondaryButton}
              title={hasNodes ? "Reset the hierarchy before changing Tier depth" : undefined}
            >
              {document.tiers.length === 0 ? "+ Add first Tier" : "+ Add parent Tier"}
            </button>
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-xl border border-border bg-surface">
          <div className="border-b border-border px-5 py-4">
            <h4 className="text-sm font-semibold">Tier definitions</h4>
            <p className="mt-1 text-xs leading-5 text-muted">Aliases are customer-facing. Internal calculations continue to use stable Tier IDs and ordinals.</p>
          </div>
          {orderedTiers.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-subtle text-muted">
                <EnergyIcon name="floor" className="h-5 w-5" />
              </span>
              <p className="mt-3 text-sm font-semibold">Start from the lowest useful scope</p>
              <p className="mt-1 max-w-md text-xs leading-5 text-muted">Tier 1 is not hard-coded as Circuit. Use the lowest scope this Project needs to analyse, compare, navigate or bind data to.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {orderedTiers.map((tier) => {
                const aliasKey = tier.alias.trim().replace(/\s+/g, " ").toLocaleLowerCase();
                const aliasError = !aliasKey
                  ? "Display name is required."
                  : duplicateAliases.has(aliasKey)
                    ? "Tier display names must be unique."
                    : null;
                return (
                  <div key={tier.id} className="grid gap-3 px-5 py-4 md:grid-cols-[72px_minmax(150px,220px)_minmax(0,1fr)] md:items-start">
                    <span className="pt-2.5 text-[11px] font-semibold text-muted">Tier {tier.ordinal}</span>
                    <div>
                      <input
                        aria-label={`Tier ${tier.ordinal} alias`}
                        value={tier.alias}
                        onChange={(event) => updateTier(tier.id, { alias: event.target.value })}
                        className={`${inputClass} ${aliasError ? "border-step-error" : ""}`}
                      />
                      {aliasError ? <p className="mt-1.5 text-[11px] text-step-error">{aliasError}</p> : null}
                    </div>
                    <div>
                      <input
                        aria-label={`${tier.alias} description`}
                        value={tier.description ?? ""}
                        placeholder="Why this Tier matters"
                        onChange={(event) => updateTier(tier.id, { description: event.target.value })}
                        className={inputClass}
                      />
                      <p className="mt-1.5 text-[10px] leading-4 text-muted">Use analysis, comparison, navigation, permissions, independent attributes or direct meter binding as the reason.</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <aside className="space-y-5">
          <LockedTierSummary tiers={orderedTiers} locked={false} />
          {hasNodes ? (
            <section className="rounded-xl border border-step-warning/20 bg-step-warning/5 p-5">
              <h4 className="text-sm font-semibold">Existing hierarchy detected</h4>
              <p className="mt-2 text-xs leading-5 text-muted">Aliases can be corrected safely. To add, remove or reorder Tiers, reset the existing {document.nodes.length} nodes first.</p>
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm(`Reset all ${document.nodes.length} hierarchy nodes? This only changes the current Draft.`)) return;
                  changeDocument((current) => ({ ...current, nodes: [] }));
                }}
                className="mt-4 text-xs font-semibold text-step-error hover:underline"
              >
                Reset hierarchy nodes
              </button>
            </section>
          ) : null}
        </aside>
      </div>

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface p-5">
        <div>
          <h4 className="text-sm font-semibold">Ready to build the hierarchy?</h4>
          <p className="mt-1 text-xs leading-5 text-muted">Locking is a Draft checkpoint. Customers will not see these changes until the final Review & Publish stage.</p>
        </div>
        <button
          type="button"
          disabled={!canLock}
          onClick={() => {
            changeDocument((current) => ({ ...current, tier_structure_locked: true }));
            onLocked();
          }}
          className={primaryButton}
        >
          Lock Tier Structure & Continue
        </button>
      </section>
    </div>
  );
}

function HierarchyBuilder({
  projectId,
  document,
  validation,
  selectedNodeId,
  setSelectedNodeId,
  changeDocument,
  onOpenMeterMapping,
}: {
  projectId: string;
  document: EnergyProjectSetupDocumentDto;
  validation: EnergyProjectSetupValidationDto | null;
  selectedNodeId: string | null;
  setSelectedNodeId: Dispatch<SetStateAction<string | null>>;
  changeDocument: (updater: (current: EnergyProjectSetupDocumentDto) => EnergyProjectSetupDocumentDto) => void;
  onOpenMeterMapping: (node: EnergyProjectSetupNodeDto, kind: MeterMappingIntent["kind"]) => void;
}) {
  const orderedTiers = useMemo(() => tiersTopDown(document), [document]);
  const topTier = orderedTiers[0];
  const selectedNode = document.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedTier = selectedNode
    ? document.tiers.find((tier) => tier.id === selectedNode.tier_definition_id) ?? null
    : null;
  const rootNodes = topTier ? nodesForTierAndParent(document, topTier.id) : [];
  const unassignedNodes = document.nodes.filter((node) => {
    const tier = document.tiers.find((candidate) => candidate.id === node.tier_definition_id);
    if (!tier) return true;
    if (tier.id === topTier?.id) return Boolean(node.parent_id);
    const expectedParentTier = document.tiers.find((candidate) => candidate.ordinal === tier.ordinal + 1);
    const parent = node.parent_id ? document.nodes.find((candidate) => candidate.id === node.parent_id) : null;
    return !expectedParentTier || !parent || parent.tier_definition_id !== expectedParentTier.id;
  });

  const updateNode = (nodeId: string, patch: Partial<EnergyProjectSetupNodeDto>) => {
    changeDocument((current) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id === nodeId ? { ...node, ...patch } : node),
    }));
  };

  const addScopeNode = (tier: EnergyTierDefinitionDto, parentId?: string) => {
    const result = addNode(document, { projectId, tierId: tier.id, ...(parentId ? { parentId } : {}) });
    changeDocument(() => result.document);
    setSelectedNodeId(parentId ?? result.nodeId);
  };

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-border bg-surface p-5">
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">Structure · Step 2 of 2</span>
          <h3 className="mt-1 text-base font-semibold">Build the Project hierarchy</h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">Create real nodes from the top Tier downward. Each branch may contain a different number of child nodes.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (document.nodes.length > 0 && !window.confirm("Return to Tier Setup? Existing nodes stay in the Draft, but Tier depth changes require a hierarchy reset.")) return;
            changeDocument((current) => ({ ...current, tier_structure_locked: false }));
          }}
          className={secondaryButton}
        >
          Edit Tier Structure
        </button>
      </section>

      {topTier ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className="min-w-0 rounded-xl border border-border bg-surface">
            <div className="border-b border-border px-5 py-4">
              <div>
                <h3 className="text-sm font-semibold">Hierarchy tree</h3>
                <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
                  Expand a branch to inspect its children. A meter shortcut always carries the selected Scope into Data & Meters.
                </p>
              </div>
            </div>

            <div className="max-h-[620px] min-h-80 overflow-auto p-4 sm:p-5">
              <div className="mb-2 flex min-h-11 items-center gap-3 rounded-lg bg-surface-subtle px-3 py-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-surface text-muted">
                  <EnergyIcon name="building" className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-light">Project root</span>
                  <span className="block truncate text-xs font-semibold">{document.project.name}</span>
                </span>
                <span className="text-[10px] text-muted">{rootNodes.length} {topTier.alias}</span>
                <button
                  type="button"
                  aria-label={`Add ${topTier.alias} to ${document.project.name}`}
                  title={`Add ${topTier.alias}`}
                  onClick={() => addScopeNode(topTier)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                >
                  <EnergyIcon name="plus" className="h-4 w-4" />
                </button>
              </div>

              {rootNodes.length ? (
                <ul className="space-y-1" aria-label="Project hierarchy">
                  {rootNodes.map((node) => (
                    <HierarchyTreeNode
                      key={node.id}
                      node={node}
                      document={document}
                      selectedNodeId={selectedNodeId}
                      onSelect={setSelectedNodeId}
                      onAddChild={addScopeNode}
                      onOpenMeterMapping={onOpenMeterMapping}
                    />
                  ))}
                </ul>
              ) : (
                <div className="flex min-h-40 flex-col items-center justify-center text-center">
                  <p className="text-sm font-semibold">No {topTier.alias} nodes yet</p>
                  <p className="mt-1 max-w-sm text-xs leading-5 text-muted">Add the first top-level node, then build its branch downward.</p>
                </div>
              )}

              {unassignedNodes.length ? (
                <div className="mt-5 border-t border-border pt-4">
                  <h4 className="text-xs font-semibold text-step-warning">Needs parent assignment</h4>
                  <p className="mt-1 text-[11px] leading-5 text-muted">These nodes are missing the immediate parent required by their Tier.</p>
                  <ul className="mt-2 space-y-1">
                    {unassignedNodes.map((node) => (
                      <HierarchyTreeNode
                        key={node.id}
                        node={node}
                        document={document}
                        selectedNodeId={selectedNodeId}
                        onSelect={setSelectedNodeId}
                        onAddChild={addScopeNode}
                        onOpenMeterMapping={onOpenMeterMapping}
                      />
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </section>

          <aside className="space-y-5">
            <LockedTierSummary tiers={orderedTiers} locked />
            <section className="rounded-xl border border-border bg-surface p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold">Node properties</h3>
                <p className="mt-1 text-xs leading-5 text-muted">Select a tree node to edit its name, parent and comparison attributes.</p>
              </div>
              {selectedNode ? (
                <button
                  type="button"
                  onClick={() => {
                    const count = branchNodeCount(document, selectedNode.id);
                    const message = count === 1
                      ? `Remove ${selectedNode.name} from the current Draft?`
                      : `Remove ${selectedNode.name} and ${count - 1} descendant nodes from the current Draft?`;
                    if (!window.confirm(message)) return;
                    const next = removeNodeAndDescendants(document, selectedNode.id);
                    changeDocument(() => next);
                    const selection = initialTierSelection(next);
                    setSelectedNodeId(tiersTopDown(next).map((tier) => selection[tier.id]).filter(Boolean).at(-1) ?? null);
                  }}
                  className="text-xs font-semibold text-step-error hover:underline"
                >
                  Remove from Draft
                </button>
              ) : null}
            </div>
            {!selectedNode || !selectedTier ? (
              <div className="flex min-h-64 items-center justify-center text-sm text-muted">Select a node to edit its properties.</div>
            ) : (
              <NodeInspector
                node={selectedNode}
                tier={selectedTier}
                document={document}
                updateNode={updateNode}
              />
            )}
            </section>
          </aside>
        </div>
      ) : null}

      <section className="rounded-xl border border-border bg-surface p-5">
        <h3 className="text-sm font-semibold">Validation</h3>
        <p className="mt-1 text-xs leading-5 text-muted">Drafts may be incomplete. Blocking errors must be resolved before Publish; warnings stay visible for review.</p>
        <ValidationList validation={validation} />
      </section>
    </div>
  );
}

function LockedTierSummary({
  tiers,
  locked,
}: {
  tiers: EnergyTierDefinitionDto[];
  locked: boolean;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold">Tier Structure</h4>
        <span className={[
          "rounded-full px-2 py-1 text-[9px] font-semibold uppercase tracking-wide",
          locked ? "bg-step-success/10 text-step-success" : "bg-step-warning/10 text-step-warning",
        ].join(" ")}>{locked ? "Locked in Draft" : "Draft"}</span>
      </div>
      {tiers.length === 0 ? (
        <p className="mt-4 text-xs text-muted">No Tiers defined yet.</p>
      ) : (
        <ol className="mt-4 space-y-1.5">
          {tiers.map((tier, index) => (
            <li key={tier.id}>
              <div className="flex items-center gap-3 rounded-lg bg-surface-subtle px-3 py-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface text-[9px] font-semibold text-muted">T{tier.ordinal}</span>
                <span className="min-w-0 flex-1 truncate text-xs font-semibold">{tier.alias || "Unnamed Tier"}</span>
              </div>
              {index < tiers.length - 1 ? <div className="ml-6 h-1.5 border-l border-border" /> : null}
            </li>
          ))}
        </ol>
      )}
      <p className="mt-4 text-[10px] leading-4 text-muted">Tier numbers stay internal. Customer pages use these aliases and each node's display name.</p>
    </section>
  );
}

function HierarchyTreeNode({
  node,
  document,
  selectedNodeId,
  onSelect,
  onAddChild,
  onOpenMeterMapping,
}: {
  node: EnergyProjectSetupNodeDto;
  document: EnergyProjectSetupDocumentDto;
  selectedNodeId: string | null;
  onSelect: (nodeId: string) => void;
  onAddChild: (tier: EnergyTierDefinitionDto, parentId?: string) => void;
  onOpenMeterMapping: (node: EnergyProjectSetupNodeDto, kind: MeterMappingIntent["kind"]) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const tier = document.tiers.find((candidate) => candidate.id === node.tier_definition_id);
  if (!tier) return null;
  const childTier = document.tiers.find((candidate) => candidate.ordinal === tier.ordinal - 1);
  const children = childTier ? nodesForTierAndParent(document, childTier.id, node.id) : [];
  const selected = selectedNodeId === node.id;
  const rowClass = [
    "flex min-h-11 w-full items-center gap-1 rounded-lg px-1.5 py-1.5 transition-colors",
    selected ? "bg-primary text-white" : "hover:bg-surface-subtle",
  ].join(" ");

  return (
    <li>
      <div className={rowClass}>
        {childTier ? (
          <button
            type="button"
            aria-label={`${expanded ? "Collapse" : "Expand"} ${node.name}`}
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
            className="flex h-8 w-7 shrink-0 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
          >
            <EnergyIcon name="chevron" className={selected ? `h-3 w-3 text-white/70 transition-transform ${expanded ? "rotate-90" : ""}` : `h-3 w-3 text-muted-light transition-transform ${expanded ? "rotate-90" : ""}`} />
          </button>
        ) : <span className="h-8 w-7 shrink-0" />}

        <button
          type="button"
          onClick={() => onSelect(node.id)}
          className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
        >
          <EnergyIcon name={tier.ordinal === 1 ? "meter" : "floor"} className={selected ? "h-3.5 w-3.5 shrink-0 text-white/80" : "h-3.5 w-3.5 shrink-0 text-muted"} />
          <span className="min-w-0 flex-1">
            <span className={selected ? "block text-[10px] font-medium text-white/70" : "block text-[10px] font-medium text-muted-light"}>{tier.alias}</span>
            <span className="block truncate text-xs font-semibold">{node.name}</span>
          </span>
          {children.length ? <span className={selected ? "text-[10px] text-white/70" : "text-[10px] text-muted"}>{children.length}</span> : null}
          <span className={[
            "h-1.5 w-1.5 rounded-full",
            node.metadata_status === "confirmed" ? "bg-step-success" : "bg-step-warning",
          ].join(" ")} title={node.metadata_status} />
        </button>

        <NodeAddMenu
          node={node}
          childTier={childTier}
          selected={selected}
          onAddChild={onAddChild}
          onOpenMeterMapping={onOpenMeterMapping}
        />
      </div>

      {childTier && expanded ? (
        <ul className="ml-4 space-y-1 border-l border-border py-1 pl-4">
          {children.map((child) => (
            <HierarchyTreeNode
              key={child.id}
              node={child}
              document={document}
              selectedNodeId={selectedNodeId}
              onSelect={onSelect}
              onAddChild={onAddChild}
              onOpenMeterMapping={onOpenMeterMapping}
            />
          ))}
          {children.length === 0 ? (
            <li className="px-2.5 py-2 text-[11px] text-muted">No {childTier.alias} nodes under this {tier.alias}.</li>
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}

function NodeAddMenu({
  node,
  childTier,
  selected,
  onAddChild,
  onOpenMeterMapping,
}: {
  node: EnergyProjectSetupNodeDto;
  childTier?: EnergyTierDefinitionDto;
  selected: boolean;
  onAddChild: (tier: EnergyTierDefinitionDto, parentId?: string) => void;
  onOpenMeterMapping: (node: EnergyProjectSetupNodeDto, kind: MeterMappingIntent["kind"]) => void;
}) {
  const closeMenu = (target: HTMLElement) => target.closest("details")?.removeAttribute("open");
  return (
    <details className="group/add relative shrink-0">
      <summary
        aria-label={`Add to ${node.name}`}
        title={`Add to ${node.name}`}
        className={[
          "flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
          selected ? "text-white/80 hover:bg-white/10" : "text-muted hover:bg-surface",
        ].join(" ")}
      >
        <EnergyIcon name="plus" className="h-4 w-4" />
      </summary>
      <div className="absolute right-0 top-9 z-30 w-56 rounded-xl bg-surface p-1.5 text-foreground shadow-lg">
        {childTier ? (
          <button
            type="button"
            onClick={(event) => {
              onAddChild(childTier, node.id);
              closeMenu(event.currentTarget);
            }}
            className="w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
          >
            <span className="block text-xs font-semibold">Add {childTier.alias}</span>
            <span className="mt-0.5 block text-[10px] text-muted">Create the next Tier under {node.name}</span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={(event) => {
            onOpenMeterMapping(node, "physical");
            closeMenu(event.currentTarget);
          }}
          className="w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
        >
          <span className="block text-xs font-semibold">Configure meters for {node.name}</span>
          <span className="mt-0.5 block text-[10px] text-muted">Continue with this existing Scope in Data & Meters</span>
        </button>
      </div>
    </details>
  );
}

function NodeInspector({
  node,
  tier,
  document,
  updateNode,
}: {
  node: EnergyProjectSetupNodeDto;
  tier: EnergyTierDefinitionDto;
  document: EnergyProjectSetupDocumentDto;
  updateNode: (nodeId: string, patch: Partial<EnergyProjectSetupNodeDto>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node);
  const parentTier = document.tiers.find((candidate) => candidate.ordinal === tier.ordinal + 1);
  const parentOptions = parentTier
    ? document.nodes.filter((candidate) => candidate.tier_definition_id === parentTier.id)
    : [];
  const trimmedName = draft.name.trim().replace(/\s+/g, " ");
  const nameConflict = hasSiblingNameConflict(document, {
    tierId: tier.id,
    parentId: draft.parent_id,
    name: trimmedName,
    excludeNodeId: node.id,
  });
  const nameError = !trimmedName
    ? `${tier.alias} name is required.`
    : nameConflict
      ? `${trimmedName} already exists under this parent.`
      : null;

  useEffect(() => {
    setDraft(node);
    setEditing(false);
  }, [node]);

  if (!editing) {
    return (
      <div className="mt-5">
        <dl className="divide-y divide-border rounded-xl bg-surface-subtle px-4">
          <SummaryRow label={`${tier.alias} name`} value={node.name} />
          <SummaryRow label="Metadata" value={node.metadata_status === "confirmed" ? "Confirmed" : "Provisional"} />
          <SummaryRow label="Area" value={node.area_sqm === undefined ? "Not set" : `${node.area_sqm.toLocaleString()} m²`} />
          <SummaryRow label="Typical daily people" value={node.occupant_count === undefined ? "Not set" : String(node.occupant_count)} />
        </dl>
        <button type="button" onClick={() => setEditing(true)} className={`${secondaryButton} mt-4 w-full`}>
          Edit node
        </button>
      </div>
    );
  }

  return (
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      <Field label={`${tier.alias} name`}>
        <input
          value={draft.name}
          aria-invalid={Boolean(nameError)}
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          className={`${inputClass} ${nameError ? "border-step-error focus:border-step-error focus:ring-step-error/15" : ""}`}
        />
        {nameError ? <p className="mt-1.5 text-[11px] leading-4 text-step-error">{nameError}</p> : null}
      </Field>
      <ReadOnlyField label="Internal node ID" value={node.id} />
      {parentTier ? (
        <Field label={`Parent ${parentTier.alias}`}>
          <select
            value={draft.parent_id ?? ""}
            onChange={(event) => {
              const nextParentId = event.target.value || undefined;
              setDraft((current) => ({ ...current, parent_id: nextParentId }));
            }}
            className={inputClass}
          >
            <option value="">Select parent</option>
            {parentOptions.map((parent) => <option key={parent.id} value={parent.id}>{parent.name}</option>)}
          </select>
        </Field>
      ) : null}
      <Field label="Metadata confidence" hint="Provisional values remain visibly labelled until confirmed.">
        <select value={draft.metadata_status} onChange={(event) => setDraft((current) => ({ ...current, metadata_status: event.target.value as EnergyProjectSetupNodeDto["metadata_status"] }))} className={inputClass}>
          <option value="provisional">Provisional</option>
          <option value="confirmed">Confirmed</option>
        </select>
      </Field>
      <Field label="Area (m²)" hint="Optional. Used for kWh per m² comparisons.">
        <input type="number" min="0" value={draft.area_sqm ?? ""} onChange={(event) => setDraft((current) => ({ ...current, area_sqm: optionalNumericInput(event.target.value) }))} className={inputClass} />
      </Field>
      <Field label="Typical daily people" hint="A simple 24-hour project estimate for kWh per person.">
        <input type="number" min="0" value={draft.occupant_count ?? ""} onChange={(event) => setDraft((current) => ({ ...current, occupant_count: optionalNumericInput(event.target.value) }))} className={inputClass} />
      </Field>
      <Field label="Effective from" hint="Optional metadata validity window.">
        <input type="date" value={draft.effective_from?.slice(0, 10) ?? ""} onChange={(event) => setDraft((current) => ({ ...current, effective_from: event.target.value || undefined }))} className={inputClass} />
      </Field>
      <Field label="Effective to">
        <input type="date" value={draft.effective_to?.slice(0, 10) ?? ""} onChange={(event) => setDraft((current) => ({ ...current, effective_to: event.target.value || undefined }))} className={inputClass} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Independent business meaning" hint="Explain why a single-node tier still needs separate analysis, navigation, permission or data binding.">
          <textarea value={draft.independent_reason ?? ""} onChange={(event) => setDraft((current) => ({ ...current, independent_reason: event.target.value || undefined }))} rows={3} className={inputClass} />
        </Field>
      </div>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <button
          type="button"
          onClick={() => {
            setDraft(node);
            setEditing(false);
          }}
          className={secondaryButton}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={Boolean(nameError)}
          onClick={() => {
            if (nameError) return;
            updateNode(node.id, { ...draft, name: trimmedName });
            setEditing(false);
          }}
          className={primaryButton}
        >
          Apply changes
        </button>
      </div>
    </div>
  );
}

function ValidationList({ validation, compact = false }: { validation: EnergyProjectSetupValidationDto | null; compact?: boolean }) {
  if (!validation) return <p className="mt-4 text-xs text-muted">Run validation after saving the draft.</p>;
  if (validation.issues.length === 0) {
    return (
      <div className="mt-4 flex items-center gap-2 rounded-lg bg-step-success/10 px-3 py-2 text-xs text-step-success">
        <EnergyIcon name="check" className="h-3.5 w-3.5" /> No validation issues
      </div>
    );
  }
  const items = compact ? validation.issues.slice(0, 4) : validation.issues;
  return (
    <div className="mt-4 space-y-2">
      {items.map((issue, index) => (
        <div key={`${issue.code}-${issue.path ?? index}`} className={[
          "rounded-lg border px-3 py-2",
          issue.severity === "error"
            ? "border-step-error/20 bg-step-error/5"
            : "border-step-warning/20 bg-step-warning/5",
        ].join(" ")}>
          <div className="flex items-start gap-2">
            <EnergyIcon name="alert" className={[
              "mt-0.5 h-3.5 w-3.5 shrink-0",
              issue.severity === "error" ? "text-step-error" : "text-step-warning",
            ].join(" ")} />
            <div>
              <p className="text-xs font-medium">{issue.message}</p>
              <p className="mt-0.5 font-mono text-[9px] uppercase tracking-wide text-muted-light">{issue.code}</p>
            </div>
          </div>
        </div>
      ))}
      {compact && validation.issues.length > items.length ? (
        <p className="text-[11px] text-muted">+ {validation.issues.length - items.length} more issues in Tiers & nodes</p>
      ) : null}
    </div>
  );
}

function NewProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (projectId: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("Asia/Singapore");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4" role="dialog" aria-modal="true" aria-label="Create project">
      <form
        className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitting(true);
          setError(null);
          void configApi.createEnergyProject({ name, timezone })
            .then((result) => onCreated(result.project.id))
            .catch((reason) => setError(messageFrom(reason, "Failed to create project")))
            .finally(() => setSubmitting(false));
        }}
      >
        <h2 className="text-lg font-semibold">Create project</h2>
        <p className="mt-1 text-xs leading-5 text-muted">Create the stable project scope first. Tiers and nodes remain an unpublished draft until you validate and publish them.</p>
        <div className="mt-5 space-y-4">
          <Field label="Project name"><input autoFocus required value={name} onChange={(event) => setName(event.target.value)} className={inputClass} placeholder="e.g. Tampines Preschool Portfolio" /></Field>
          <Field label="Timezone"><select value={timezone} onChange={(event) => setTimezone(event.target.value)} className={inputClass}><option value="Asia/Singapore">Asia/Singapore (SGT)</option><option value="Asia/Kuala_Lumpur">Asia/Kuala Lumpur (MYT)</option><option value="UTC">UTC</option></select></Field>
        </div>
        {error ? <p className="mt-4 text-xs text-step-error">{error}</p> : null}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryButton}>Cancel</button>
          <button type="submit" disabled={submitting || !name.trim()} className={primaryButton}>{submitting ? "Creating…" : "Create draft"}</button>
        </div>
      </form>
    </div>
  );
}

function LifecycleBadge({ setup, dirty }: { setup: EnergyProjectSetupDto; dirty: boolean }) {
  const label = dirty ? "Unsaved draft" : setup.project.has_unpublished_changes ? "Saved draft" : setup.project.delivery_stage;
  const tone = dirty || setup.project.has_unpublished_changes ? "bg-step-warning/10 text-step-warning" : setup.project.status === "published" ? "bg-step-success/10 text-step-success" : "bg-surface-subtle text-muted";
  return <span className={`rounded-full px-2 py-1 text-[10px] font-semibold capitalize ${tone}`}>{label}</span>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-medium">{label}</span>{children}{hint ? <span className="mt-1 block text-[10px] leading-4 text-muted-light">{hint}</span> : null}</label>;
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return <Field label={label}><div className="rounded-lg border border-border bg-surface-subtle px-3 py-2 font-mono text-xs text-muted">{value}</div></Field>;
}

function Fact({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "warning" | "error" }) {
  return <div className="rounded-lg border border-border bg-surface-subtle p-3"><p className="text-[10px] text-muted-light">{label}</p><p className={[
    "mt-1 truncate text-sm font-semibold",
    tone === "error" ? "text-step-error" : tone === "warning" ? "text-step-warning" : "text-foreground",
  ].join(" ")}>{value}</p></div>;
}

function StatusMessage({ tone, children }: { tone: "error" | "warning" | "success"; children: React.ReactNode }) {
  const colors = tone === "error" ? "border-step-error/20 bg-step-error/5 text-step-error" : tone === "warning" ? "border-step-warning/20 bg-step-warning/5 text-step-warning" : "border-step-success/20 bg-step-success/5 text-step-success";
  return <div className={`mb-4 rounded-lg border px-3 py-2 text-xs ${colors}`}>{children}</div>;
}

function LoadingPanel() {
  return <div className="flex min-h-96 items-center justify-center rounded-xl border border-border bg-surface text-sm text-muted">Loading project setup…</div>;
}

const optionalNumericInput = (value: string): number | undefined => value === "" ? undefined : Number(value);
const messageFrom = (reason: unknown, fallback: string): string => reason instanceof Error ? reason.message : fallback;
const inputClass = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition-shadow focus:border-primary/30 focus:ring-2 focus:ring-primary/10";
const secondaryButton = "inline-flex items-center justify-center rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-foreground hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-40";
const primaryButton = "inline-flex items-center justify-center rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-40";
