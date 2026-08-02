import type {
  EnergyMetricRevisionDto,
  EnergyProjectSetupDocumentDto,
  EnergyRuleRevisionDto,
} from "../../../lib/config-api";

export type MetricReadiness = {
  status: "ready" | "partial" | "missing";
  label: string;
  detail: string;
};

export type RuleReadiness = MetricReadiness;

export function resolveMetricReadiness(
  metric: EnergyMetricRevisionDto,
  document: EnergyProjectSetupDocumentDto,
): MetricReadiness {
  if (metric.requirement === "always") {
    return {
      status: "ready",
      label: "Ready",
      detail: "Available from interval facts",
    };
  }

  const tierOrdinalById = new Map(document.tiers.map((tier) => [tier.id, tier.ordinal]));
  const minimumOrdinal = Math.min(...document.tiers.map((tier) => tier.ordinal));
  const analyticalNodes = document.nodes.filter((node) =>
    (tierOrdinalById.get(node.tier_definition_id) ?? minimumOrdinal) > minimumOrdinal
  );
  const candidates = analyticalNodes.length > 0 ? analyticalNodes : document.nodes;
  const readyCount = candidates.filter((node) => metric.requirement === "area"
    ? typeof node.area_sqm === "number" && node.area_sqm > 0
    : typeof node.occupant_count === "number" && node.occupant_count > 0
  ).length;
  const metadataLabel = metric.requirement === "area" ? "area" : "24-hour people";

  if (readyCount === 0) {
    return {
      status: "missing",
      label: "Not ready",
      detail: `Missing ${metadataLabel} metadata`,
    };
  }
  if (readyCount < candidates.length) {
    return {
      status: "partial",
      label: "Partially ready",
      detail: `${readyCount}/${candidates.length} analytical scopes have ${metadataLabel} metadata`,
    };
  }
  return {
    status: "ready",
    label: "Ready",
    detail: `${readyCount}/${candidates.length} analytical scopes have ${metadataLabel} metadata`,
  };
}

export function resolveRuleReadiness(
  rule: EnergyRuleRevisionDto,
  document: EnergyProjectSetupDocumentDto,
  selectedMetricRevisionIds: ReadonlySet<string>,
  businessCalendarVersion: string,
): RuleReadiness {
  const missingMetrics = rule.metric_revision_ids.filter((id) => !selectedMetricRevisionIds.has(id));
  if (missingMetrics.length > 0) {
    return {
      status: "missing",
      label: "Not ready",
      detail: `Enable ${missingMetrics.length} required metric${missingMetrics.length === 1 ? "" : "s"} first`,
    };
  }

  if (rule.requirement === "always") {
    return { status: "ready", label: "Ready", detail: "Required metrics are enabled" };
  }
  if (rule.requirement === "operating_hours") {
    return businessCalendarVersion.trim()
      ? { status: "ready", label: "Ready", detail: `Uses ${businessCalendarVersion}` }
      : { status: "missing", label: "Not ready", detail: "Missing operating-hours calendar" };
  }

  const minimumPeers = numericParameter(rule.parameters.minimum_peers, 2);
  const groups = peerGroups(document, rule.requirement);
  const largestGroup = Math.max(0, ...groups.values());
  if (largestGroup >= minimumPeers) {
    const subject = rule.requirement === "children"
      ? "child scopes"
      : rule.requirement === "area_peers"
        ? "area-comparable sibling scopes"
        : "people-comparable sibling scopes";
    return {
      status: "ready",
      label: "Ready",
      detail: `${largestGroup} ${subject} available`,
    };
  }

  const subject = rule.requirement === "children"
    ? "child scopes"
    : rule.requirement === "area_peers"
      ? "siblings with area metadata"
      : "siblings with people metadata";
  return {
    status: "missing",
    label: "Not ready",
    detail: `${largestGroup}/${minimumPeers} required ${subject}`,
  };
}

function peerGroups(
  document: EnergyProjectSetupDocumentDto,
  requirement: EnergyRuleRevisionDto["requirement"],
): Map<string, number> {
  const minimumOrdinal = Math.min(...document.tiers.map((tier) => tier.ordinal));
  const tierOrdinalById = new Map(document.tiers.map((tier) => [tier.id, tier.ordinal]));
  const groups = new Map<string, number>();

  for (const node of document.nodes) {
    const ordinal = tierOrdinalById.get(node.tier_definition_id) ?? minimumOrdinal;
    const hasRequiredMetadata = requirement === "children"
      ? true
      : requirement === "area_peers"
        ? ordinal > minimumOrdinal && typeof node.area_sqm === "number" && node.area_sqm > 0
        : ordinal > minimumOrdinal && typeof node.occupant_count === "number" && node.occupant_count > 0;
    if (!hasRequiredMetadata) continue;

    const groupId = `${node.parent_id ?? "__project__"}:${node.tier_definition_id}`;
    groups.set(groupId, (groups.get(groupId) ?? 0) + 1);
  }
  return groups;
}

function numericParameter(value: number | string | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
