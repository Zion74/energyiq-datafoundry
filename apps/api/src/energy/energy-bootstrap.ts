import type {
  EnergyIqOverviewDefinition,
  ReportTimePolicyRevision,
} from "@datafoundry/contracts";
import type {
  EnergyIqProjectSetupDocument,
  MetadataStore
} from "@datafoundry/metadata";

const NGEE_ANN_PROJECT_ID = "ngee-ann-polytechnic";
const PRESCHOOL_PROJECT_ID = "preschool-demo";
export const NGEE_ANN_DAILY_ANOMALY_RULE_REVISION_ID =
  "comparison.daily_usage_above_baseline@1" as const;
export const NGEE_ANN_WORKSPACE_ID = "default";
export const PRESCHOOL_WORKSPACE_ID = "preschool-demo-org";

export const ensureEnergyIqBootstrap = (metadataStore: MetadataStore): void => {
  metadataStore.energyIq.upsertUserRole({ user_id: "dev-user", role: "admin" });
  metadataStore.workspaces.upsert({
    id: NGEE_ANN_WORKSPACE_ID,
    owner_user_id: "dev-user",
    name: "Ngee Ann FM",
    kind: "customer"
  });
  metadataStore.workspaceMemberships.upsert({
    workspace_id: NGEE_ANN_WORKSPACE_ID,
    user_id: "dev-user",
    role: "owner"
  });
  metadataStore.workspaces.upsert({
    id: PRESCHOOL_WORKSPACE_ID,
    owner_user_id: "dev-user",
    name: "Preschool Demo",
    kind: "customer"
  });
  metadataStore.workspaceMemberships.upsert({
    workspace_id: PRESCHOOL_WORKSPACE_ID,
    user_id: "dev-user",
    role: "owner"
  });

  metadataStore.energyIq.projectSetup.bootstrapPublished({
    project: {
      id: NGEE_ANN_PROJECT_ID,
      workspace_id: NGEE_ANN_WORKSPACE_ID,
      name: "Ngee Ann Polytechnic",
      timezone: "Asia/Singapore",
      hierarchy_revision_id: "ngee-ann-hierarchy-v2",
      meter_formula_revision_id: "ngee-ann-meter-formula-v1",
      data_snapshot_id: "ngee-ann-4bac1177eca62cdb",
      metric_version: "energy-metrics-v1",
      business_calendar_version: "sg-calendar-v1",
      tariff_schedule_version: "sg-tariff-v1",
      root_scope_id: "project"
    },
    document: buildNgeeAnnSetup(),
    published_by: "dev-user"
  });
  ensureNgeeAnnDefaultRuleConfig(metadataStore);
  ensureBootstrapProjectWorkspace(metadataStore, NGEE_ANN_PROJECT_ID, NGEE_ANN_WORKSPACE_ID);
  metadataStore.energyIq.upsertProjectAccess({
    project_id: NGEE_ANN_PROJECT_ID,
    user_id: "dev-user",
    role: "editor"
  });

  metadataStore.energyIq.projectSetup.bootstrapPublished({
    project: {
      id: PRESCHOOL_PROJECT_ID,
      workspace_id: PRESCHOOL_WORKSPACE_ID,
      name: "Preschool Portfolio",
      timezone: "Asia/Singapore",
      hierarchy_revision_id: "preschool-hierarchy-v4",
      meter_formula_revision_id: "preschool-meter-formula-v2",
      data_snapshot_id: "preschool-26b85b9c0b95e090",
      metric_version: "energy-metrics-v1",
      business_calendar_version: "sg-preschool-calendar-v1",
      tariff_schedule_version: "sg-tariff-v1",
      root_scope_id: "preschool-project"
    },
    document: buildPreschoolSetup(),
    published_by: "dev-user"
  });
  ensurePreschoolExplicitMeterRoutes(metadataStore);
  ensureBootstrapProjectWorkspace(metadataStore, PRESCHOOL_PROJECT_ID, PRESCHOOL_WORKSPACE_ID);
  metadataStore.energyIq.upsertProjectAccess({
    project_id: PRESCHOOL_PROJECT_ID,
    user_id: "dev-user",
    role: "editor"
  });

  ensurePilotOverviewDefinition(
    metadataStore,
    NGEE_ANN_PROJECT_ID,
    "ngee-ann-overview",
    NGEE_ANN_REPORT_TIME_POLICY,
    NGEE_ANN_OVERVIEW_DEFINITION,
  );
  ensurePilotOverviewDefinition(
    metadataStore,
    PRESCHOOL_PROJECT_ID,
    "preschool-overview",
    PRESCHOOL_REPORT_TIME_POLICY,
    PRESCHOOL_OVERVIEW_DEFINITION,
  );
};

const ensurePreschoolExplicitMeterRoutes = (metadataStore: MetadataStore): void => {
  const project = metadataStore.energyIq.getProject(PRESCHOOL_PROJECT_ID);
  if (project.hierarchy_revision_id !== "preschool-hierarchy-v4") return;
  const currentRevision = metadataStore.energyIq.projectSetup
    .listHierarchyRevisions(PRESCHOOL_PROJECT_ID)
    .find((revision) => revision.id === project.hierarchy_revision_id);
  if (!currentRevision) return;
  const currentDocument = JSON.parse(currentRevision.snapshot_json) as EnergyIqProjectSetupDocument;
  if (
    currentDocument.meter_mapping?.schema_version === 2
    && currentDocument.meter_mapping.confirmed
    && currentDocument.meter_mapping.official_aggregation_routes
  ) return;

  const targetDocument = buildPreschoolSetup();
  const draft = metadataStore.energyIq.projectSetup.getDraft({
    project_id: PRESCHOOL_PROJECT_ID,
    user_id: "dev-user",
  });
  if (
    project.has_unpublished_changes
    && (
      draft.based_on_hierarchy_revision_id !== project.hierarchy_revision_id
      || JSON.stringify(draft.document) !== JSON.stringify(targetDocument)
    )
  ) return;
  const saved = project.has_unpublished_changes
    ? draft
    : metadataStore.energyIq.projectSetup.saveDraft({
        project_id: PRESCHOOL_PROJECT_ID,
        expected_revision: draft.revision,
        user_id: "dev-user",
        document: targetDocument,
      });
  metadataStore.energyIq.projectSetup.publishDraft({
    project_id: PRESCHOOL_PROJECT_ID,
    expected_revision: saved.revision,
    user_id: "dev-user",
  });
};

const ensurePilotOverviewDefinition = (
  metadataStore: MetadataStore,
  projectId: string,
  rendererKey: "ngee-ann-overview" | "preschool-overview",
  policy: ReportTimePolicyRevision,
  definition: EnergyIqOverviewDefinition,
): void => {
  const policyRecord = metadataStore.energyIq.reportTimePolicies.publish({
    project_id: projectId,
    policy,
    published_by: "dev-user",
    published_at: new Date().toISOString(),
  });
  const revision = metadataStore.energyIq.templates.getLatestProjectRevision(projectId);
  if (!revision || metadataStore.energyIq.overviewDefinitions.get(revision.revision_id)) return;
  metadataStore.energyIq.overviewDefinitions.attachMigrationRecord({
    project_id: projectId,
    template_revision_id: revision.revision_id,
    renderer_key: rendererKey,
    definition,
    report_time_policy: policyRecord.policy,
  });
};

const NGEE_ANN_REPORT_TIME_POLICY: ReportTimePolicyRevision = {
  policyId: "ngee-ann-report-time",
  revision: "1",
  windows: [
    { windowId: "current-month-progress", role: "current_progress", label: "Current month to date", strategy: { kind: "calendar_month_to_date" } },
    { windowId: "recent-operations", role: "recent_operations", label: "Recent 28 complete days", strategy: { kind: "rolling_complete_days", days: 28 } },
    { windowId: "completed-month-trend", role: "historical_trend", label: "Previous 3 complete months", strategy: { kind: "completed_calendar_months", months: 3 } },
    { windowId: "same-progress-comparison", role: "comparison", label: "Previous months at the same progress", strategy: { kind: "prior_equivalent_progress", months: 3, sourceWindowId: "current-month-progress" } },
    { windowId: "next-month-outlook", role: "forecast", label: "Next complete calendar month", strategy: { kind: "next_complete_calendar_month" } },
    { windowId: "day-type-reference", role: "day_type_baseline", label: "Workday, weekend and public holiday reference", strategy: { kind: "same_day_type_baseline", lookbackDays: 90, sourceWindowId: "recent-operations" } },
  ],
};

const NGEE_ANN_OVERVIEW_DEFINITION: EnergyIqOverviewDefinition = {
  contractRevision: "energyiq-overview-definition@1",
  timePolicyRevisionId: "ngee-ann-report-time@1",
  sections: [
    section("executive-summary", "Executive summary", "What needs management attention this month?", "current-month-progress", [
      block("ngee-executive-actions", "decision.executive_actions@1", "current-month-progress", "primary"),
      block("ngee-consumption", "overview.consumption@1", "current-month-progress", "primary"),
    ]),
    section("cost-and-trend", "Cost and trend", "How is current-month performance changing against comparable history?", "current-month-progress", [
      block("ngee-month-trend", "overview.consumption@1", "completed-month-trend"),
      block("ngee-same-progress", "comparison.child_scope_ranking@1", "same-progress-comparison"),
    ], ["completed-month-trend", "same-progress-comparison"]),
    section("operating-patterns", "Operating patterns", "Which hours and day types explain the current operating pattern?", "recent-operations", [
      block("ngee-operating-pattern", "time.operating_pattern@1", "recent-operations"),
      block("ngee-off-hours", "time.off_hours@1", "day-type-reference"),
    ], ["day-type-reference"]),
    section("circuit-analysis", "Circuit analysis", "Which Levels and Circuits account for the observed use?", "recent-operations", [
      block("ngee-circuit-breakdown", "composition.project_meter_breakdown@1", "recent-operations"),
      block("ngee-recommendations", "decision.recommended_actions@1", "recent-operations"),
    ]),
  ],
};

const PRESCHOOL_REPORT_TIME_POLICY: ReportTimePolicyRevision = {
  policyId: "preschool-report-time",
  revision: "1",
  windows: [
    { windowId: "current-overview", role: "recent_operations", label: "Recent 28 complete days", strategy: { kind: "rolling_complete_days", days: 28 } },
    { windowId: "current-month-progress", role: "current_progress", label: "Current month to date", strategy: { kind: "calendar_month_to_date" } },
    { windowId: "next-month-outlook", role: "forecast", label: "Next complete calendar month", strategy: { kind: "next_complete_calendar_month" } },
    { windowId: "day-type-reference", role: "day_type_baseline", label: "Workday, weekend and public holiday reference", strategy: { kind: "same_day_type_baseline", lookbackDays: 90, sourceWindowId: "current-overview" } },
  ],
};

const PRESCHOOL_OVERVIEW_DEFINITION: EnergyIqOverviewDefinition = {
  contractRevision: "energyiq-overview-definition@1",
  timePolicyRevisionId: "preschool-report-time@1",
  sections: [
    section("portfolio-review", "Portfolio review", "What changed across all Centres and what needs attention?", "current-overview", [
      block("preschool-executive-actions", "decision.executive_actions@1", "current-overview", "primary"),
      block("preschool-consumption", "overview.consumption@1", "current-overview", "primary"),
    ]),
    section("benchmark-analysis", "Benchmark analysis", "Which Centres remain unusual after normalising for area and people?", "current-overview", [
      block("preschool-area-intensity", "comparison.area_intensity@1", "current-overview"),
      block("preschool-people-intensity", "comparison.people_intensity@1", "current-overview"),
    ]),
    section("standby-energy", "Standby energy", "What remains powered after closing?", "current-overview", [
      block("preschool-off-hours", "time.off_hours@1", "day-type-reference"),
    ], ["day-type-reference"]),
    section("operating-hours", "Operating hours", "Which operating-hour patterns deserve review?", "current-overview", [
      block("preschool-operating-pattern", "time.operating_pattern@1", "current-overview"),
      block("preschool-meter-breakdown", "composition.project_meter_breakdown@1", "current-overview"),
    ]),
    section("monthly-outlook", "Monthly energy outlook", "How is the current month tracking and what is the next-month outlook?", "current-month-progress", [
      block("preschool-month-progress", "overview.consumption@1", "current-month-progress"),
      block("preschool-outlook-evidence", "evidence.exceptions@1", "next-month-outlook", "supporting"),
    ], ["next-month-outlook"]),
  ],
};

function section(
  key: string,
  title: string,
  managementQuestion: string,
  primaryWindowId: string,
  blocks: EnergyIqOverviewDefinition["sections"][number]["blocks"],
  supportingWindowIds: string[] = [],
): EnergyIqOverviewDefinition["sections"][number] {
  return { key, title, managementQuestion, primaryWindowId, supportingWindowIds, blocks };
}

function block(
  key: string,
  capabilityRevisionId: string,
  windowId: string,
  emphasis: "primary" | "standard" | "supporting" = "standard",
): EnergyIqOverviewDefinition["sections"][number]["blocks"][number] {
  return { key, capabilityRevisionId, windowId, emphasis };
}

const ensureNgeeAnnDefaultRuleConfig = (metadataStore: MetadataStore): void => {
  const config = metadataStore.energyIq.rules.getProjectConfig(NGEE_ANN_PROJECT_ID);
  if (
    config.revision !== 0
    || config.selected_rule_revision_ids.includes(NGEE_ANN_DAILY_ANOMALY_RULE_REVISION_ID)
  ) return;
  metadataStore.energyIq.rules.saveProjectConfig({
    project_id: NGEE_ANN_PROJECT_ID,
    expected_revision: config.revision,
    selected_rule_revision_ids: [
      ...config.selected_rule_revision_ids,
      NGEE_ANN_DAILY_ANOMALY_RULE_REVISION_ID,
    ],
    updated_by: "dev-user",
  });
};

const ensureBootstrapProjectWorkspace = (
  metadataStore: MetadataStore,
  projectId: string,
  workspaceId: string
): void => {
  const project = metadataStore.energyIq.getProject(projectId);
  if (project.workspace_id === workspaceId) return;
  metadataStore.energyIq.upsertProject({
    ...project,
    workspace_id: workspaceId
  });
};

const buildNgeeAnnSetup = (): EnergyIqProjectSetupDocument => ({
  project: {
    name: "Ngee Ann Polytechnic",
    timezone: "Asia/Singapore"
  },
  tier_structure_locked: true,
  tiers: [
    { id: "ngee-ann-tier-circuit", ordinal: 1, alias: "Circuit" },
    {
      id: "ngee-ann-tier-level",
      ordinal: 2,
      alias: "Level",
      description: "A floor with an independent analytical and navigation purpose."
    }
  ],
  nodes: [
    {
      id: "level-6",
      tier_definition_id: "ngee-ann-tier-level",
      name: "Level 6",
      sort_order: 10,
      area_sqm: 1_180,
      occupant_count: 76,
      metadata_status: "provisional",
      independent_reason: "Compare floor performance and drill down to circuits."
    },
    {
      id: "level-7",
      tier_definition_id: "ngee-ann-tier-level",
      name: "Level 7",
      sort_order: 20,
      area_sqm: 1_220,
      occupant_count: 82,
      metadata_status: "provisional",
      independent_reason: "Compare floor performance and drill down to circuits."
    },
    ...ngeeAnnCircuits.map((circuit) => ({
      ...circuit,
      tier_definition_id: "ngee-ann-tier-circuit",
      metadata_status: "confirmed" as const
    }))
  ],
  meter_mapping: {
    schema_version: 2,
    source_kind: "excel",
    confirmed: true,
    rows: ngeeAnnPhysicalMeters.map((meter) => ({
      id: meter.id,
      source_label: meter.sourceLabel,
      scope_id: meter.measurementScopeId,
      navigation_scope_id: meter.navigationScopeId,
      display_name: meter.displayName,
      resource: "electricity" as const,
      category: meter.category,
      coverage: meter.role === "total" ? "whole" as const : "partial" as const,
      meter_role: meter.role,
      aggregation_usage: meter.role === "total" ? "official" as const : "excluded" as const
    })),
    official_aggregation_routes: [
      ...ngeeAnnPhysicalMeters.map((meter) => ({
        scope_id: meter.navigationScopeId,
        resource: "electricity" as const,
        category: meter.category,
        meter_point_ids: [meter.id]
      })),
      ...(["level-6", "level-7"] as const).flatMap((levelId) =>
        (["light", "load"] as const).map((category) => ({
          scope_id: levelId,
          resource: "electricity" as const,
          category,
          meter_point_ids: ngeeAnnPhysicalMeters
            .filter((meter) => meter.levelId === levelId && meter.role === "total" && meter.category === category)
            .map((meter) => meter.id)
        }))),
      ...(["light", "load"] as const).map((category) => ({
        scope_id: "project",
        resource: "electricity" as const,
        category,
        meter_point_ids: ngeeAnnPhysicalMeters
          .filter((meter) => meter.role === "total" && meter.category === category)
          .map((meter) => meter.id)
      }))
    ],
    virtual_meters: [{
      id: "ngee-ann-load-12-v1",
      display_name: "Load 12",
      scope_id: "level-6",
      resource: "electricity",
      category: "load",
      terms: [
        { mapping_row_id: "mapping-lvl-6-office-load-1-l1p1-l3p6-3", coefficient: 1 },
        { mapping_row_id: "mapping-lvl-6-office-load-2-l1p7-l3p12-4", coefficient: 1 }
      ]
    }]
  }
});

const ngeeAnnCircuits = [
  circuit("l6-total-light", "level-6", "Total Office Light", 101, "light", "total"),
  circuit("l6-total-load", "level-6", "Total Office Load", 102, "load", "total"),
  circuit("l6-light-left", "level-6", "Office Light-Left: External", 103, "light", "submeter"),
  circuit("l6-light-right", "level-6", "Office Light-Right: Internal", 104, "light", "submeter"),
  circuit("l6-load-1", "level-6", "Office Load 1", 105, "load", "submeter"),
  circuit("l6-load-2", "level-6", "Office Load 2", 106, "load", "submeter"),
  circuit("l6-load-3", "level-6", "Office Load 3", 107, "load", "submeter"),
  circuit("l6-load-4", "level-6", "Office Load 4", 108, "load", "submeter"),
  circuit("l6-load-5", "level-6", "Office Load 5 Fan Isol 1/2", 109, "load", "submeter"),
  circuit("l7-total-light", "level-7", "Total Office Light", 201, "light", "total"),
  circuit("l7-total-load", "level-7", "Total Office Load", 202, "load", "total"),
  circuit("l7-front-light", "level-7", "Front Row Office Light", 203, "light", "submeter"),
  circuit("l7-middle-light", "level-7", "Middle Row Office Light", 204, "light", "submeter"),
  circuit("l7-back-light", "level-7", "Back Row Office Light", 205, "light", "submeter"),
  circuit("l7-load-1", "level-7", "Office Load 1", 206, "load", "submeter"),
  circuit("l7-load-2", "level-7", "Office Load 2", 207, "load", "submeter"),
  circuit("l7-load-3", "level-7", "Office Load 3", 208, "load", "submeter"),
  circuit("l7-load-4", "level-7", "Office Load 4 Fan ISOL 1/2", 209, "load", "submeter")
] as const;

const ngeeAnnPhysicalMeters = [
  meter("mapping-lvl-6-office-light-left-external-1", "Lvl 6 Office Light-Left: External", "l6-light-left", "level-6", "Office Light-Left: External", "light", "component"),
  meter("mapping-lvl-6-office-light-right-internal-2", "Lvl 6 Office Light-Right: Internal", "l6-light-right", "level-6", "Office Light-Right: Internal", "light", "component"),
  meter("mapping-lvl-6-office-load-1-l1p1-l3p6-3", "Lvl 6 Office Load 1: L1P1-L3P6", "l6-load-1", "level-6", "Office Load 1", "load", "component"),
  meter("mapping-lvl-6-office-load-2-l1p7-l3p12-4", "Lvl 6 Office Load 2: L1P7-L3P12", "l6-load-2", "level-6", "Office Load 2", "load", "component"),
  meter("mapping-lvl-6-office-load-3-l1p13-l3p18-5", "Lvl 6 Office Load 3: L1P13-L3P18", "l6-load-3", "level-6", "Office Load 3", "load", "component"),
  meter("mapping-lvl-6-office-load-4-l1p19-l3p24-6", "Lvl 6 Office Load 4: L1P19-L3P24", "l6-load-4", "level-6", "Office Load 4", "load", "component"),
  meter("mapping-lvl-6-office-load-5-l1p25-l3p29-fan-isol-1-2-7", "Lvl 6 Office Load 5: L1P25-L3P29 Fan Isol 1/2", "l6-load-5", "level-6", "Office Load 5 Fan Isol 1/2", "load", "component"),
  meter("mapping-lvl-6-total-office-light-8", "Lvl 6 Total Office Light", "l6-total-light", "level-6", "Total Office Light", "light", "total"),
  meter("mapping-lvl-6-total-office-load-9", "Lvl 6 Total Office Load", "l6-total-load", "level-6", "Total Office Load", "load", "total"),
  meter("mapping-lvl-7-back-row-office-light-10", "Lvl 7 Back Row Office Light", "l7-back-light", "level-7", "Back Row Office Light", "light", "component"),
  meter("mapping-lvl-7-front-row-office-light-11", "Lvl 7 Front Row Office Light", "l7-front-light", "level-7", "Front Row Office Light", "light", "component"),
  meter("mapping-lvl-7-middle-row-office-light-12", "Lvl 7 Middle Row Office Light", "l7-middle-light", "level-7", "Middle Row Office Light", "light", "component"),
  meter("mapping-lvl-7-office-load-1-l1p1-l3p6-13", "Lvl 7 Office Load 1: L1P1-L3P6", "l7-load-1", "level-7", "Office Load 1", "load", "component"),
  meter("mapping-lvl-7-office-load-2-l1p7-l3p15-14", "Lvl 7 Office Load 2: L1P7-L3P15", "l7-load-2", "level-7", "Office Load 2", "load", "component"),
  meter("mapping-lvl-7-office-load-3-l1p16-l3p21-15", "Lvl 7 Office Load 3: L1P16-L3P21", "l7-load-3", "level-7", "Office Load 3", "load", "component"),
  meter("mapping-lvl-7-office-load-4-l1p22-l3p25-fan-isol1-2-16", "Lvl 7 Office Load 4: L1P22-L3P25 Fan ISOL1/2", "l7-load-4", "level-7", "Office Load 4 Fan ISOL 1/2", "load", "component"),
  meter("mapping-lvl-7-total-office-light-17", "Lvl 7 Total Office Light", "l7-total-light", "level-7", "Total Office Light", "light", "total"),
  meter("mapping-lvl-7-total-office-load-18", "Lvl 7 Total Office Load", "l7-total-load", "level-7", "Total Office Load", "load", "total")
] as const;

function meter(
  id: string,
  sourceLabel: string,
  navigationScopeId: string,
  levelId: "level-6" | "level-7",
  displayName: string,
  category: "light" | "load",
  role: "total" | "component"
) {
  return {
    id,
    sourceLabel,
    measurementScopeId: navigationScopeId,
    navigationScopeId,
    levelId,
    displayName,
    category,
    role
  };
}

function circuit(
  id: string,
  parentId: string,
  name: string,
  sortOrder: number,
  category: "light" | "load",
  meterRole: "total" | "submeter"
) {
  return {
    id,
    parent_id: parentId,
    name,
    sort_order: sortOrder,
    metadata: { category, meterRole }
  };
}

const preschoolCentres = [
  ["A", 743, "Senior Care Center", 8, 50],
  ["B", 1548, "Active Aging Center", 10, 50],
  ["C", 710, "Preschool", 8, 39],
  ["D", 1639, "Senior Care Center", 10, 38],
  ["E", 1621, "Active Aging Center", 10, 44],
  ["F", 1505, "Active Aging Center", 7, 27],
  ["G", 505, "Active Aging Center", 4, 23],
  ["H", 1088, "Preschool", 7, 20],
  ["I", 1903, "Senior Care Center", 9, 30],
  ["J", 930, "Senior Care Center", 6, 31],
  ["K", 1230, "Senior Care Center", 9, 36],
  ["L", 1806, "Preschool", 9, 30],
  ["M", 683, "Active Aging Center", 8, 29],
  ["N", 1089, "Senior Care Center", 5, 48],
  ["O", 1820, "Active Aging Center", 9, 38],
  ["P", 1132, "Preschool", 10, 42],
  ["Q", 1255, "Senior Care Center", 7, 33],
  ["R", 685, "Senior Care Center", 8, 37],
  ["S", 1520, "Preschool", 7, 36],
  ["T", 1729, "Senior Care Center", 7, 49],
  ["U", 1574, "Senior Care Center", 10, 33],
  ["V", 1655, "Senior Care Center", 8, 36],
  ["W", 551, "Active Aging Center", 5, 44],
  ["X", 764, "Preschool", 9, 36],
  ["Y", 1873, "Preschool", 9, 39],
  ["Z", 1379, "Senior Care Center", 5, 35],
  ["AA", 968, "Preschool", 9, 42],
  ["AB", 1435, "Active Aging Center", 7, 42],
  ["AC", 1617, "Senior Care Center", 8, 32],
  ["AD", 1871, "Senior Care Center", 8, 45]
] as const;

const preschoolCircuits = [
  ["aircon-1", "Aircon 1", "Aircon", "aircon"],
  ["aircon-2", "Aircon 2", "Aircon", "aircon"],
  ["heater", "Heater", "Heater", "load"],
  ["living-area-plug-load", "Living Area Plug Load", "Plugload", "load"],
  ["kitchen-plug-load", "Kitchen Plug Load", "Plugload", "load"],
  ["plug-load3", "Plug Load3", "Plugload", "load"],
  ["living-room-lighting", "Living Room Lighting", "Lighting", "light"],
  ["kitchen-lighting", "Kitchen Lighting", "Lighting", "light"],
  ["other-lighting3", "Other Lighting3", "Lighting", "light"]
] as const;

const buildPreschoolSetup = (): EnergyIqProjectSetupDocument => {
  const nodes: EnergyIqProjectSetupDocument["nodes"] = [];
  const mappingRows: NonNullable<EnergyIqProjectSetupDocument["meter_mapping"]>["rows"] = [];
  preschoolCentres.forEach(([code, area, facilityType, teachers, customers], centreIndex) => {
    const centreId = `preschool-centre-${code.toLowerCase()}`;
    nodes.push({
      id: centreId,
      tier_definition_id: "preschool-tier-centre",
      name: `Centre ${code}`,
      sort_order: centreIndex + 1,
      area_sqm: area,
      occupant_count: teachers + customers,
      metadata_status: "provisional",
      independent_reason: "Compare centre performance and drill down to circuits.",
      metadata: {
        centreCode: code,
        facilityType,
        teacherCount: teachers,
        customerCount: customers,
        occupantCountDefinition: "teacher + customer",
        metadataNote: "Prototype area and people values; confirmation pending."
      }
    });
    preschoolCircuits.forEach(([slug, name, appliance, category], circuitIndex) => {
      const circuitId = `${centreId}-${slug}`;
      nodes.push({
        id: circuitId,
        tier_definition_id: "preschool-tier-circuit",
        parent_id: centreId,
        name,
        sort_order: 100 + circuitIndex,
        metadata_status: "confirmed",
        metadata: {
          appliance,
          category,
          meterRole: "submeter",
          aggregationRole: "component",
          sourceReadingKind: "interval_usage"
        }
      });
      mappingRows.push({
        id: circuitId,
        source_label: `${centreId}:${name}`,
        scope_id: circuitId,
        navigation_scope_id: circuitId,
        display_name: name,
        resource: "electricity",
        category,
        coverage: "partial",
        meter_role: "component",
        aggregation_usage: "official"
      });
    });
  });
  return {
    project: {
      name: "Preschool Portfolio",
      timezone: "Asia/Singapore"
    },
    tier_structure_locked: true,
    tiers: [
      { id: "preschool-tier-circuit", ordinal: 1, alias: "Circuit" },
      {
        id: "preschool-tier-centre",
        ordinal: 2,
        alias: "Centre",
        description: "A managed centre with independent area and people attributes."
      }
    ],
    nodes,
    meter_mapping: {
      schema_version: 2,
      source_kind: "excel",
      confirmed: true,
      rows: mappingRows,
      official_aggregation_routes: [
        ...mappingRows.map((row) => ({
          scope_id: row.navigation_scope_id ?? row.scope_id,
          resource: row.resource,
          category: row.category,
          meter_point_ids: [row.id]
        })),
        ...preschoolCentres.flatMap(([code]) => {
          const centreId = `preschool-centre-${code.toLowerCase()}`;
          return (["aircon", "load", "light"] as const).map((category) => ({
            scope_id: centreId,
            resource: "electricity" as const,
            category,
            meter_point_ids: mappingRows
              .filter((row) => row.id.startsWith(`${centreId}-`) && row.category === category)
              .map((row) => row.id)
          }));
        }),
        ...(["aircon", "load", "light"] as const).map((category) => ({
          scope_id: "project",
          resource: "electricity" as const,
          category,
          meter_point_ids: mappingRows.filter((row) => row.category === category).map((row) => row.id)
        }))
      ]
    }
  };
};
