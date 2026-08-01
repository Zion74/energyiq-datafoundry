import type {
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

const uniqueId = (candidate: string, existing: Set<string>): string => {
  let value = candidate;
  let suffix = 2;
  while (existing.has(value)) {
    value = `${candidate}-${suffix}`;
    suffix += 1;
  }
  return value;
};
