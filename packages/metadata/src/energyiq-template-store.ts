import type { DatabaseSync } from "node:sqlite";

export type EnergyIqComponentFamily = "decision" | "overview" | "comparison" | "time" | "composition" | "quality" | "evidence";
export type EnergyIqComponentTarget = "project" | "tier" | "both";
export type EnergyIqComponentRequirement = "always" | "rules" | "operating_hours" | "children" | "area_peers" | "people_peers" | "meter_breakdown";

export type EnergyIqComponentRevisionRecord = {
  revision_id: string;
  component_id: string;
  version: number;
  display_name: string;
  description: string;
  family: EnergyIqComponentFamily;
  view_key: string;
  target: EnergyIqComponentTarget;
  metric_revision_ids: string[];
  rule_revision_ids: string[];
  query_ids: string[];
  requirement: EnergyIqComponentRequirement;
  created_at: string;
};

export type EnergyIqTemplateComponentPlacement = {
  component_revision_id: string;
  enabled: boolean;
};

export type EnergyIqTemplateDefinition = {
  template_id: string;
  target_kind: "project" | "tier";
  tier_definition_id?: string;
  components: EnergyIqTemplateComponentPlacement[];
};

export type EnergyIqTemplateDraftDocument = {
  templates: EnergyIqTemplateDefinition[];
};

export type EnergyIqProjectTemplateDraftRecord = {
  project_id: string;
  revision: number;
  document: EnergyIqTemplateDraftDocument;
  updated_by?: string;
  created_at?: string;
  updated_at?: string;
};

const BUILT_IN_COMPONENTS: readonly Omit<EnergyIqComponentRevisionRecord, "created_at">[] = [
  {
    revision_id: "decision.executive_actions@1",
    component_id: "decision.executive_actions",
    version: 1,
    display_name: "Executive action summary",
    description: "Prioritised deterministic findings, recommended actions and evidence links.",
    family: "decision",
    view_key: "executive_action_summary_v1",
    target: "both",
    metric_revision_ids: [],
    rule_revision_ids: [],
    query_ids: [],
    requirement: "rules",
  },
  {
    revision_id: "overview.consumption@1",
    component_id: "overview.consumption",
    version: 1,
    display_name: "Consumption overview",
    description: "Total usage, daily average and peak demand for the selected scope and period.",
    family: "overview",
    view_key: "consumption_overview_v1",
    target: "both",
    metric_revision_ids: ["energy.total_usage_kwh@1", "energy.average_daily_usage_kwh@1", "energy.peak_demand_kw@1"],
    rule_revision_ids: [],
    query_ids: ["scope_summary_v1"],
    requirement: "always",
  },
  {
    revision_id: "comparison.child_scope_ranking@1",
    component_id: "comparison.child_scope_ranking",
    version: 1,
    display_name: "Child scope comparison",
    description: "Ranks directly comparable child scopes by total usage and share.",
    family: "comparison",
    view_key: "child_scope_ranking_v1",
    target: "both",
    metric_revision_ids: ["energy.total_usage_kwh@1"],
    rule_revision_ids: ["comparison.highest_child_usage@1"],
    query_ids: ["scope_summary_v1"],
    requirement: "children",
  },
  {
    revision_id: "comparison.area_intensity@1",
    component_id: "comparison.area_intensity",
    version: 1,
    display_name: "Area-normalised benchmark",
    description: "Compares sibling scopes using energy use per square metre when metadata is comparable.",
    family: "comparison",
    view_key: "area_intensity_comparison_v1",
    target: "both",
    metric_revision_ids: ["energy.usage_per_sqm@1"],
    rule_revision_ids: ["comparison.area_intensity_outlier@1"],
    query_ids: ["scope_summary_v1"],
    requirement: "area_peers",
  },
  {
    revision_id: "comparison.people_intensity@1",
    component_id: "comparison.people_intensity",
    version: 1,
    display_name: "People-normalised benchmark",
    description: "Compares sibling scopes using energy use per representative person.",
    family: "comparison",
    view_key: "people_intensity_comparison_v1",
    target: "both",
    metric_revision_ids: ["energy.usage_per_person@1"],
    rule_revision_ids: ["comparison.people_intensity_outlier@1"],
    query_ids: ["scope_summary_v1"],
    requirement: "people_peers",
  },
  {
    revision_id: "time.off_hours@1",
    component_id: "time.off_hours",
    version: 1,
    display_name: "Off-hours analysis",
    description: "Shows energy use and share outside the configured operating hours.",
    family: "time",
    view_key: "off_hours_analysis_v1",
    target: "both",
    metric_revision_ids: ["energy.off_hours_usage_kwh@1", "energy.off_hours_share_pct@1"],
    rule_revision_ids: ["time.high_off_hours_share@1"],
    query_ids: ["scope_summary_v1", "meter_breakdown_v1"],
    requirement: "operating_hours",
  },
  {
    revision_id: "time.operating_pattern@1",
    component_id: "time.operating_pattern",
    version: 1,
    display_name: "Operating pattern",
    description: "Hourly demand profile used to identify peak and persistent usage periods.",
    family: "time",
    view_key: "operating_pattern_v1",
    target: "both",
    metric_revision_ids: ["energy.peak_demand_kw@1"],
    rule_revision_ids: [],
    query_ids: ["hourly_profile_v1"],
    requirement: "always",
  },
  {
    revision_id: "composition.meter_breakdown@1",
    component_id: "composition.meter_breakdown",
    version: 1,
    display_name: "Meter and category breakdown",
    description: "Explains the selected scope through its trusted meters and load, light, aircon or other categories.",
    family: "composition",
    view_key: "meter_breakdown_v1",
    target: "tier",
    metric_revision_ids: ["energy.total_usage_kwh@1"],
    rule_revision_ids: [],
    query_ids: ["meter_breakdown_v1"],
    requirement: "meter_breakdown",
  },
  {
    revision_id: "quality.data_coverage@1",
    component_id: "quality.data_coverage",
    version: 1,
    display_name: "Data quality and coverage",
    description: "Shows valid intervals and quality events so users can judge whether findings are trustworthy.",
    family: "quality",
    view_key: "data_quality_summary_v1",
    target: "both",
    metric_revision_ids: ["data.valid_interval_count@1", "data.quality_event_count@1"],
    rule_revision_ids: ["quality.no_valid_data@1"],
    query_ids: ["scope_summary_v1"],
    requirement: "always",
  },
  {
    revision_id: "evidence.exceptions@1",
    component_id: "evidence.exceptions",
    version: 1,
    display_name: "Exceptions and evidence",
    description: "Presents rule evidence, calculation versions and the path to further investigation.",
    family: "evidence",
    view_key: "exceptions_evidence_v1",
    target: "both",
    metric_revision_ids: [],
    rule_revision_ids: [],
    query_ids: [],
    requirement: "rules",
  },
];

export const initializeEnergyIqTemplateSchema = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS energyiq_component_revisions (
      revision_id TEXT PRIMARY KEY,
      component_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      display_name TEXT NOT NULL,
      description TEXT NOT NULL,
      family TEXT NOT NULL,
      view_key TEXT NOT NULL,
      target TEXT NOT NULL CHECK (target IN ('project', 'tier', 'both')),
      metric_revision_ids_json TEXT NOT NULL,
      rule_revision_ids_json TEXT NOT NULL,
      query_ids_json TEXT NOT NULL,
      requirement TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (component_id, version)
    );

    CREATE TABLE IF NOT EXISTS energyiq_project_template_drafts (
      project_id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL,
      document_json TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES energyiq_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (updated_by) REFERENCES users(id)
    );
  `);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO energyiq_component_revisions (
      revision_id, component_id, version, display_name, description, family,
      view_key, target, metric_revision_ids_json, rule_revision_ids_json,
      query_ids_json, requirement, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const createdAt = "2026-08-02T00:00:00.000Z";
  for (const component of BUILT_IN_COMPONENTS) {
    insert.run(
      component.revision_id,
      component.component_id,
      component.version,
      component.display_name,
      component.description,
      component.family,
      component.view_key,
      component.target,
      JSON.stringify(component.metric_revision_ids),
      JSON.stringify(component.rule_revision_ids),
      JSON.stringify(component.query_ids),
      component.requirement,
      createdAt,
    );
  }
};

export class EnergyIqTemplateStore {
  constructor(private readonly db: DatabaseSync) {}

  listComponentRevisions(): EnergyIqComponentRevisionRecord[] {
    return this.db.prepare(`
      SELECT * FROM energyiq_component_revisions
      ORDER BY CASE family
        WHEN 'decision' THEN 1 WHEN 'overview' THEN 2 WHEN 'comparison' THEN 3
        WHEN 'time' THEN 4 WHEN 'composition' THEN 5 WHEN 'quality' THEN 6 ELSE 7 END,
        display_name ASC
    `).all().map(mapComponentRevision);
  }

  getProjectDraft(input: {
    project_id: string;
    tier_definition_ids: string[];
  }): EnergyIqProjectTemplateDraftRecord {
    const row = this.db.prepare(`
      SELECT * FROM energyiq_project_template_drafts WHERE project_id = ?
    `).get(input.project_id);
    if (isRecord(row)) {
      const saved = mapProjectTemplateDraft(row);
      return {
        ...saved,
        document: reconcileTemplateDocument(
          saved.document,
          this.listComponentRevisions(),
          input.tier_definition_ids,
        ),
      };
    }
    return {
      project_id: input.project_id,
      revision: 0,
      document: createDefaultTemplateDocument(this.listComponentRevisions(), input.tier_definition_ids),
    };
  }

  saveProjectDraft(input: {
    project_id: string;
    expected_revision: number;
    tier_definition_ids: string[];
    document: EnergyIqTemplateDraftDocument;
    updated_by: string;
  }): EnergyIqProjectTemplateDraftRecord {
    const current = this.getProjectDraft({
      project_id: input.project_id,
      tier_definition_ids: input.tier_definition_ids,
    });
    if (current.revision !== input.expected_revision) {
      throw new Error("ENERGYIQ_TEMPLATE_DRAFT_REVISION_CONFLICT");
    }
    const document = validateAndCanonicalizeTemplateDocument({
      document: input.document,
      tier_definition_ids: input.tier_definition_ids,
      catalog: this.listComponentRevisions(),
    });
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO energyiq_project_template_drafts (
        project_id, revision, document_json, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        revision = excluded.revision,
        document_json = excluded.document_json,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `).run(
      input.project_id,
      current.revision + 1,
      JSON.stringify(document),
      input.updated_by,
      current.created_at ?? now,
      now,
    );
    return this.getProjectDraft({
      project_id: input.project_id,
      tier_definition_ids: input.tier_definition_ids,
    });
  }
}

export const createDefaultTemplateDocument = (
  catalog: readonly EnergyIqComponentRevisionRecord[],
  tierDefinitionIds: readonly string[],
): EnergyIqTemplateDraftDocument => ({
  templates: [
    {
      template_id: "project",
      target_kind: "project",
      components: catalog
        .filter((component) => component.target === "project" || component.target === "both")
        .map((component) => ({ component_revision_id: component.revision_id, enabled: true })),
    },
    ...tierDefinitionIds.map((tierDefinitionId) => ({
      template_id: `tier:${tierDefinitionId}`,
      target_kind: "tier" as const,
      tier_definition_id: tierDefinitionId,
      components: catalog
        .filter((component) => component.target === "tier" || component.target === "both")
        .map((component) => ({ component_revision_id: component.revision_id, enabled: true })),
    })),
  ],
});

const reconcileTemplateDocument = (
  saved: EnergyIqTemplateDraftDocument,
  catalog: readonly EnergyIqComponentRevisionRecord[],
  tierDefinitionIds: readonly string[],
): EnergyIqTemplateDraftDocument => {
  const defaults = createDefaultTemplateDocument(catalog, tierDefinitionIds);
  const savedByTemplateId = new Map(saved.templates.map((template) => [template.template_id, template]));
  const catalogById = new Map(catalog.map((component) => [component.revision_id, component]));
  return {
    templates: defaults.templates.map((fallback) => {
      const current = savedByTemplateId.get(fallback.template_id);
      if (!current) return fallback;
      const applicableIds = new Set(fallback.components.map((placement) => placement.component_revision_id));
      const existing = current.components.filter((placement) =>
        applicableIds.has(placement.component_revision_id) && catalogById.has(placement.component_revision_id)
      );
      const existingIds = new Set(existing.map((placement) => placement.component_revision_id));
      return {
        ...fallback,
        components: [
          ...existing,
          ...fallback.components.filter((placement) => !existingIds.has(placement.component_revision_id)),
        ],
      };
    }),
  };
};

const validateAndCanonicalizeTemplateDocument = (input: {
  document: EnergyIqTemplateDraftDocument;
  tier_definition_ids: readonly string[];
  catalog: readonly EnergyIqComponentRevisionRecord[];
}): EnergyIqTemplateDraftDocument => {
  if (!Array.isArray(input.document.templates)) throw new Error("ENERGYIQ_TEMPLATE_DOCUMENT_INVALID");
  const catalogById = new Map(input.catalog.map((component) => [component.revision_id, component]));
  const expectedTemplateIds = new Set(["project", ...input.tier_definition_ids.map((id) => `tier:${id}`)]);
  const seenTemplateIds = new Set<string>();
  const canonical: EnergyIqTemplateDefinition[] = [];

  for (const template of input.document.templates) {
    if (!expectedTemplateIds.has(template.template_id) || seenTemplateIds.has(template.template_id)) {
      throw new Error("ENERGYIQ_TEMPLATE_TARGET_INVALID");
    }
    seenTemplateIds.add(template.template_id);
    const isProject = template.template_id === "project";
    if ((isProject && template.target_kind !== "project") || (!isProject && template.target_kind !== "tier")) {
      throw new Error("ENERGYIQ_TEMPLATE_TARGET_INVALID");
    }
    if (!isProject && template.tier_definition_id !== template.template_id.slice("tier:".length)) {
      throw new Error("ENERGYIQ_TEMPLATE_TARGET_INVALID");
    }
    const seenComponents = new Set<string>();
    const components = template.components.map((placement) => {
      const component = catalogById.get(placement.component_revision_id);
      if (!component || seenComponents.has(placement.component_revision_id)) {
        throw new Error("ENERGYIQ_TEMPLATE_COMPONENT_INVALID");
      }
      if ((isProject && component.target === "tier") || (!isProject && component.target === "project")) {
        throw new Error("ENERGYIQ_TEMPLATE_COMPONENT_TARGET_INVALID");
      }
      seenComponents.add(placement.component_revision_id);
      return { component_revision_id: placement.component_revision_id, enabled: placement.enabled === true };
    });
    canonical.push({
      template_id: template.template_id,
      target_kind: template.target_kind,
      ...(!isProject ? { tier_definition_id: template.tier_definition_id } : {}),
      components,
    });
  }
  if (seenTemplateIds.size !== expectedTemplateIds.size) throw new Error("ENERGYIQ_TEMPLATE_TARGET_REQUIRED");
  return {
    templates: [
      canonical.find((template) => template.template_id === "project")!,
      ...input.tier_definition_ids.map((id) => canonical.find((template) => template.template_id === `tier:${id}`)!),
    ],
  };
};

const mapComponentRevision = (row: unknown): EnergyIqComponentRevisionRecord => {
  if (!isRecord(row)) throw new Error("Invalid EnergyIQ component revision row");
  return {
    revision_id: requiredString(row, "revision_id"),
    component_id: requiredString(row, "component_id"),
    version: requiredNumber(row, "version"),
    display_name: requiredString(row, "display_name"),
    description: requiredString(row, "description"),
    family: requiredString(row, "family") as EnergyIqComponentFamily,
    view_key: requiredString(row, "view_key"),
    target: requiredString(row, "target") as EnergyIqComponentTarget,
    metric_revision_ids: parseStringArray(requiredString(row, "metric_revision_ids_json")),
    rule_revision_ids: parseStringArray(requiredString(row, "rule_revision_ids_json")),
    query_ids: parseStringArray(requiredString(row, "query_ids_json")),
    requirement: requiredString(row, "requirement") as EnergyIqComponentRequirement,
    created_at: requiredString(row, "created_at"),
  };
};

const mapProjectTemplateDraft = (row: Record<string, unknown>): EnergyIqProjectTemplateDraftRecord => {
  const parsed: unknown = JSON.parse(requiredString(row, "document_json"));
  if (!isRecord(parsed) || !Array.isArray(parsed.templates)) {
    throw new Error("Invalid EnergyIQ template draft document");
  }
  const updatedBy = optionalString(row.updated_by);
  const createdAt = optionalString(row.created_at);
  const updatedAt = optionalString(row.updated_at);
  return {
    project_id: requiredString(row, "project_id"),
    revision: requiredNumber(row, "revision"),
    document: parsed as EnergyIqTemplateDraftDocument,
    ...(updatedBy ? { updated_by: updatedBy } : {}),
    ...(createdAt ? { created_at: createdAt } : {}),
    ...(updatedAt ? { updated_at: updatedAt } : {}),
  };
};

const parseStringArray = (value: string): string[] => {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("Invalid EnergyIQ component dependency list");
  }
  return parsed;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const requiredString = (row: Record<string, unknown>, key: string): string => {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`Invalid ${key}`);
  return value;
};

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const requiredNumber = (row: Record<string, unknown>, key: string): number => {
  const value = row[key];
  if (typeof value !== "number") throw new Error(`Invalid ${key}`);
  return value;
};
