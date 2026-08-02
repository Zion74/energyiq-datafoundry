import type {
  EnergyMetricRevisionDto,
  EnergyProjectSetupDocumentDto,
} from "../../../lib/config-api";

export type MetricReadiness = {
  status: "ready" | "partial" | "missing";
  label: string;
  detail: string;
};

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
