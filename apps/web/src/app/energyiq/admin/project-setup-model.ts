import type {
  EnergyMeterCategoryDto,
  EnergyMeterMappingDraftDto,
  EnergyMeterMappingRowDto,
  EnergyProjectSetupDocumentDto,
  EnergyProjectSetupNodeDto,
  EnergyTierDefinitionDto,
} from "../../../lib/config-api";

export const tiersTopDown = (
  document: EnergyProjectSetupDocumentDto,
): EnergyTierDefinitionDto[] =>
  [...document.tiers].sort((left, right) => right.ordinal - left.ordinal);

export const nodesForTierAndParent = (
  document: EnergyProjectSetupDocumentDto,
  tierId: string,
  parentId?: string,
): EnergyProjectSetupNodeDto[] =>
  document.nodes
    .filter((node) => (
      node.tier_definition_id === tierId
      && (parentId ? node.parent_id === parentId : !node.parent_id)
    ))
    .sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name));

export const initialTierSelection = (
  document: EnergyProjectSetupDocumentDto,
): Record<string, string> => {
  const selected: Record<string, string> = {};
  let parentId: string | undefined;
  for (const tier of tiersTopDown(document)) {
    const first = nodesForTierAndParent(document, tier.id, parentId)[0];
    if (!first) break;
    selected[tier.id] = first.id;
    parentId = first.id;
  }
  return selected;
};

export type EnergyAggregationReview = {
  key: string;
  scopeId: string;
  scopeName: string;
  resource: EnergyMeterMappingRowDto["resource"];
  category: EnergyMeterCategoryDto;
  officialTotals: EnergyMeterMappingRowDto[];
  officialComponents: EnergyMeterMappingRowDto[];
  excluded: EnergyMeterMappingRowDto[];
  recommendation: "direct total" | "selected components" | "reference only";
  conflict: boolean;
};

export const addParentTier = (
  document: EnergyProjectSetupDocumentDto,
  projectId: string,
): EnergyProjectSetupDocumentDto => {
  const ordinal = Math.max(0, ...document.tiers.map((tier) => tier.ordinal)) + 1;
  if (ordinal > 7) return document;
  const id = uniqueId(
    `${projectId}-tier-${ordinal}`,
    new Set(document.tiers.map((tier) => tier.id)),
  );
  return {
    ...document,
    tiers: [
      ...document.tiers,
      {
        id,
        ordinal,
        alias: ordinal === 1 ? "Scope" : `Parent scope ${ordinal}`,
        description: "Rename this tier to the customer-facing business term.",
      },
    ],
  };
};

export const removeHighestTier = (
  document: EnergyProjectSetupDocumentDto,
): EnergyProjectSetupDocumentDto => {
  if (document.nodes.length > 0 || document.tiers.length === 0) return document;
  const highestOrdinal = Math.max(...document.tiers.map((tier) => tier.ordinal));
  return {
    ...document,
    tiers: document.tiers.filter((tier) => tier.ordinal !== highestOrdinal),
  };
};

export const canLockTierStructure = (
  document: EnergyProjectSetupDocumentDto,
): boolean => {
  if (document.tiers.length === 0 || document.tiers.length > 7) return false;
  const aliases = new Set<string>();
  for (const tier of document.tiers) {
    const alias = tier.alias.trim().replace(/\s+/g, " ").toLocaleLowerCase();
    if (!alias || aliases.has(alias)) return false;
    aliases.add(alias);
  }
  return true;
};

export const isTierStructureLocked = (
  document: EnergyProjectSetupDocumentDto,
): boolean => typeof document.tier_structure_locked === "boolean"
  ? document.tier_structure_locked
  : document.nodes.length > 0;

export const branchNodeCount = (
  document: EnergyProjectSetupDocumentDto,
  nodeId: string,
): number => document.nodes.length - removeNodeAndDescendants(document, nodeId).nodes.length;

export const nodePathLabel = (
  document: EnergyProjectSetupDocumentDto,
  nodeId: string,
): string => {
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]));
  const names: string[] = [];
  let current = nodesById.get(nodeId);
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    names.unshift(current.name);
    current = current.parent_id ? nodesById.get(current.parent_id) : undefined;
  }
  return names.join(" / ");
};

export const createInitialMeterMapping = (
  document: EnergyProjectSetupDocumentDto,
): EnergyMeterMappingDraftDto => {
  const lowestOrdinal = Math.min(...document.tiers.map((tier) => tier.ordinal));
  const lowestTierIds = new Set(
    document.tiers.filter((tier) => tier.ordinal === lowestOrdinal).map((tier) => tier.id),
  );
  const sourceNodes = document.nodes.filter((node) => lowestTierIds.has(node.tier_definition_id));
  const nameCounts = new Map<string, number>();
  for (const node of sourceNodes) {
    const key = node.name.trim().toLocaleLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  const rows = sourceNodes
    .map((node): EnergyMeterMappingRowDto => {
      const category = inferMeterCategory(node.name);
      const representsParentTotal = /^total\b/i.test(node.name) && Boolean(node.parent_id);
      const duplicateName = (nameCounts.get(node.name.trim().toLocaleLowerCase()) ?? 0) > 1;
      return {
        id: `mapping-${node.id}`,
        source_label: duplicateName ? nodePathLabel(document, node.id) : node.name,
        scope_id: representsParentTotal ? node.parent_id! : node.id,
        display_name: node.name,
        resource: "electricity",
        category,
        coverage: "whole",
        meter_role: "total",
        aggregation_usage: "official",
      };
    })
    .sort((left, right) => left.source_label.localeCompare(right.source_label));
  return { source_kind: "excel", rows, confirmed: false };
};

export const createMeterMappingFromSourceLabels = (
  document: EnergyProjectSetupDocumentDto,
  labels: string[],
): EnergyMeterMappingDraftDto => {
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]));
  const rows = [...new Set(labels.map((label) => label.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .map((sourceLabel, index): EnergyMeterMappingRowDto => {
      const parsed = parseSourceLabel(sourceLabel);
      const candidates = document.nodes.filter((node) => normaliseDisplayName(node.name) === normaliseDisplayName(parsed.meterName));
      const scopedCandidates = parsed.locationName
        ? candidates.filter((node) => ancestorNames(node, nodesById)
          .some((name) => normaliseDisplayName(name) === normaliseDisplayName(parsed.locationName!)))
        : candidates;
      const matched = scopedCandidates.length === 1
        ? scopedCandidates[0]
        : candidates.length === 1
          ? candidates[0]
          : undefined;
      const representsParentTotal = /^total\b/i.test(parsed.meterName) && Boolean(matched?.parent_id);
      const scopeId = representsParentTotal ? matched!.parent_id! : matched?.id ?? "";
      return {
        id: `mapping-${slug(sourceLabel)}-${index + 1}`,
        source_label: sourceLabel,
        scope_id: scopeId,
        display_name: parsed.meterName,
        resource: "electricity",
        category: inferMeterCategory(parsed.meterName),
        coverage: representsParentTotal ? "whole" : "whole",
        meter_role: "total",
        aggregation_usage: "official",
      };
    });
  return { source_kind: "excel", rows, confirmed: false };
};

export const inferMeterCategory = (label: string): EnergyMeterCategoryDto => {
  const value = label.toLocaleLowerCase();
  if (/air\s*con|aircon|a\/c/.test(value)) return "aircon";
  if (/light|lighting/.test(value)) return "light";
  if (/load|socket|power/.test(value)) return "load";
  return "other";
};

export const buildAggregationReview = (
  document: EnergyProjectSetupDocumentDto,
  mapping: EnergyMeterMappingDraftDto,
): EnergyAggregationReview[] => {
  const groups = new Map<string, EnergyMeterMappingRowDto[]>();
  for (const row of mapping.rows) {
    const key = `${row.scope_id}:${row.resource}:${row.category}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].map(([key, rows]): EnergyAggregationReview => {
    const officialTotals = rows.filter((row) => row.meter_role === "total" && row.aggregation_usage === "official");
    const officialComponents = rows.filter((row) => row.meter_role === "component" && row.aggregation_usage === "official");
    const excluded = rows.filter((row) => row.aggregation_usage === "excluded");
    return {
      key,
      scopeId: rows[0]!.scope_id,
      scopeName: document.nodes.some((node) => node.id === rows[0]!.scope_id)
        ? nodePathLabel(document, rows[0]!.scope_id)
        : "Missing Scope",
      resource: rows[0]!.resource,
      category: rows[0]!.category,
      officialTotals,
      officialComponents,
      excluded,
      recommendation: officialTotals.length === 1
        ? "direct total"
        : officialComponents.length > 0
          ? "selected components"
          : "reference only",
      conflict: officialTotals.length > 1,
    };
  }).sort((left, right) => left.scopeName.localeCompare(right.scopeName) || left.category.localeCompare(right.category));
};

export const addNode = (
  document: EnergyProjectSetupDocumentDto,
  input: { projectId: string; tierId: string; parentId?: string },
): { document: EnergyProjectSetupDocumentDto; nodeId: string } => {
  const tier = document.tiers.find((candidate) => candidate.id === input.tierId);
  if (!tier) return { document, nodeId: "" };
  const existingIds = new Set(document.nodes.map((node) => node.id));
  const siblingCount = document.nodes.filter(
    (node) => node.tier_definition_id === tier.id && node.parent_id === input.parentId,
  ).length;
  let displayIndex = siblingCount + 1;
  let displayName = `${tier.alias} ${displayIndex}`;
  while (hasSiblingNameConflict(document, {
    tierId: tier.id,
    parentId: input.parentId,
    name: displayName,
  })) {
    displayIndex += 1;
    displayName = `${tier.alias} ${displayIndex}`;
  }
  const nodeId = uniqueId(
    `${input.projectId}-${slug(tier.alias)}-${displayIndex}`,
    existingIds,
  );
  const next: EnergyProjectSetupNodeDto = {
    id: nodeId,
    tier_definition_id: tier.id,
    ...(input.parentId ? { parent_id: input.parentId } : {}),
    name: displayName,
    sort_order: (siblingCount + 1) * 10,
    metadata_status: "provisional",
  };
  return {
    document: { ...document, nodes: [...document.nodes, next] },
    nodeId,
  };
};

export const hasSiblingNameConflict = (
  document: EnergyProjectSetupDocumentDto,
  input: {
    tierId: string;
    parentId?: string;
    name: string;
    excludeNodeId?: string;
  },
): boolean => {
  const candidate = normaliseDisplayName(input.name);
  if (!candidate) return false;
  return document.nodes.some((node) => (
    node.id !== input.excludeNodeId
    && node.tier_definition_id === input.tierId
    && node.parent_id === input.parentId
    && normaliseDisplayName(node.name) === candidate
  ));
};

export const removeNodeAndDescendants = (
  document: EnergyProjectSetupDocumentDto,
  nodeId: string,
): EnergyProjectSetupDocumentDto => {
  const removed = new Set([nodeId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of document.nodes) {
      if (node.parent_id && removed.has(node.parent_id) && !removed.has(node.id)) {
        removed.add(node.id);
        changed = true;
      }
    }
  }
  return { ...document, nodes: document.nodes.filter((node) => !removed.has(node.id)) };
};

const slug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "scope";

const normaliseDisplayName = (value: string): string =>
  value.trim().replace(/\s+/g, " ").toLocaleLowerCase();

const parseSourceLabel = (label: string): { locationName?: string; meterName: string } => {
  const match = label.trim().match(/^(?:lvl|level|floor)\s+([^\s]+)\s+(.+)$/i);
  if (!match) return { meterName: label.trim() };
  return { locationName: `Level ${match[1]}`, meterName: match[2]!.trim() };
};

const ancestorNames = (
  node: EnergyProjectSetupNodeDto,
  nodesById: Map<string, EnergyProjectSetupNodeDto>,
): string[] => {
  const names: string[] = [];
  const visited = new Set<string>();
  let current = node.parent_id ? nodesById.get(node.parent_id) : undefined;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    names.push(current.name);
    current = current.parent_id ? nodesById.get(current.parent_id) : undefined;
  }
  return names;
};

const uniqueId = (candidate: string, existing: Set<string>): string => {
  let value = candidate;
  let suffix = 2;
  while (existing.has(value)) {
    value = `${candidate}-${suffix}`;
    suffix += 1;
  }
  return value;
};
