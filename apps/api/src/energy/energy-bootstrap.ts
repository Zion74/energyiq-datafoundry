import type {
  EnergyIqProjectSetupDocument,
  MetadataStore
} from "@datafoundry/metadata";

const NGEE_ANN_PROJECT_ID = "ngee-ann-polytechnic";
const PRESCHOOL_PROJECT_ID = "preschool-demo";
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
  ensureBootstrapProjectWorkspace(metadataStore, PRESCHOOL_PROJECT_ID, PRESCHOOL_WORKSPACE_ID);
  metadataStore.energyIq.upsertProjectAccess({
    project_id: PRESCHOOL_PROJECT_ID,
    user_id: "dev-user",
    role: "editor"
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
  ]
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
      nodes.push({
        id: `${centreId}-${slug}`,
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
    nodes
  };
};
