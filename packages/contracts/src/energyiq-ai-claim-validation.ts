export type EnergyAiTypedEvidenceItem = {
  id: string;
  label: string;
  unit: string | null;
  values: Record<string, unknown>;
};

export type EnergyAiSqlEvidence = {
  columns: readonly string[];
  rows: readonly unknown[];
};

type NumericClaim = {
  context: string;
  entityContext: string;
  precision: number;
  value: number;
};

type SqlDimension = { column: string | null; value: string };
type SqlNumericCell = {
  column: string | null;
  value: number;
  dimensions: SqlDimension[];
};

/**
 * Validates displayed numeric claims against one typed deterministic Evidence item
 * or one SQL row. A matching scalar elsewhere in the cited material is insufficient.
 */
export function energyAiNarrativeClaimsSupported(input: {
  narrative: string;
  evidence: readonly EnergyAiTypedEvidenceItem[];
  sqlEvidence: readonly EnergyAiSqlEvidence[];
  fallbackCentreReference?: string | null;
}): boolean {
  const deterministic = input.evidence.flatMap((item) => collectTypedNumericEvidence(item.values)
    .map((cell) => ({ item, cell })));
  const sql = input.sqlEvidence.flatMap(({ columns, rows }) => collectSqlNumericEvidence(columns, rows));
  return numericClaims(input.narrative).every((claim) =>
    deterministic.some(({ item, cell }) => numericMatches(claim, cell.value)
      && deterministicCellSupportsClaim(item, cell, claim, input.fallbackCentreReference ?? null))
    || sql.some((cell) => numericMatches(claim, cell.value)
      && sqlCellSupportsClaim(cell, claim, input.fallbackCentreReference ?? null)));
}

function collectTypedNumericEvidence(
  value: unknown,
  field = "",
): Array<{ field: string | null; value: number }> {
  if (typeof value === "number") return Number.isFinite(value) ? [{ field: field || null, value }] : [];
  if (Array.isArray(value)) return value.flatMap((item) => collectTypedNumericEvidence(item, field));
  if (isRecord(value)) return Object.entries(value).flatMap(([key, item]) => collectTypedNumericEvidence(item, key));
  return [];
}

function collectSqlNumericEvidence(columns: readonly string[], rows: readonly unknown[]): SqlNumericCell[] {
  return rows.flatMap((row) => {
    if (Array.isArray(row)) {
      const dimensions = row.flatMap<SqlDimension>((value, columnIndex) => typeof value === "string"
        ? [{ column: columns[columnIndex] ?? null, value }]
        : []);
      return row.flatMap((value, columnIndex) => typeof value === "number" && Number.isFinite(value)
        ? [{ column: columns[columnIndex] ?? null, value, dimensions }]
        : []);
    }
    if (isRecord(row)) {
      const dimensions = Object.entries(row).flatMap<SqlDimension>(([column, value]) => typeof value === "string"
        ? [{ column, value }]
        : []);
      return Object.entries(row).flatMap(([column, value]) => typeof value === "number" && Number.isFinite(value)
        ? [{ column, value, dimensions }]
        : []);
    }
    return [];
  });
}

function numericClaims(value: string): NumericClaim[] {
  return [...value.matchAll(/(?<![A-Za-z0-9])[-+]?\d[\d,]*(?:\.\d+)?(?![A-Za-z0-9])/gu)].flatMap((match) => {
    const token = match[0];
    const normalized = token.replaceAll(",", "");
    const parsed = Number(normalized);
    const start = match.index ?? 0;
    const end = start + token.length;
    return Number.isFinite(parsed) ? [{
      context: numericUnitContext(value, start, end),
      entityContext: entityClauseAround(value, start, end).toLowerCase(),
      precision: normalized.includes(".") ? normalized.split(".")[1]!.length : 0,
      value: parsed,
    }] : [];
  });
}

function numericUnitContext(value: string, numberStart: number, numberEnd: number): string {
  const before = value.slice(Math.max(0, numberStart - 20), numberStart).toLowerCase();
  const after = value.slice(numberEnd, Math.min(value.length, numberEnd + 28)).toLowerCase();
  const explicitAfter = /^\s*(?:%|percent(?:age)?|kwh|mwh|gwh|wh|kw|mw|gw|kilowatt[- ]?hours?|centres?|spikes?|events?|people|persons?|pax)/u.exec(after);
  const explicitBefore = /(?:[$€£]|\b(?:sgd|usd))\s*$/u.exec(before);
  return explicitAfter || explicitBefore
    ? `${explicitBefore?.[0] ?? ""} ${explicitAfter?.[0] ?? ""}`
    : `${before} ${after}`;
}

function entityClauseAround(value: string, numberStart: number, numberEnd: number): string {
  const boundaries = [...value.matchAll(/[.;\n]|\b(?:while|whereas|however|but)\b/giu)];
  const previous = boundaries.filter((boundary) => (boundary.index ?? 0) < numberStart).at(-1);
  const next = boundaries.find((boundary) => (boundary.index ?? value.length) >= numberEnd);
  const start = previous?.index === undefined ? 0 : previous.index + previous[0].length;
  const end = next?.index ?? value.length;
  return value.slice(start, end);
}

function numericMatches(claim: NumericClaim, evidence: number): boolean {
  return Math.abs(claim.value - evidence) <= (0.5 * (10 ** -claim.precision)) + Number.EPSILON;
}

function deterministicCellSupportsClaim(
  item: EnergyAiTypedEvidenceItem,
  cell: { field: string | null; value: number },
  claim: NumericClaim,
  fallbackCentreReference: string | null,
): boolean {
  const metricContext = `${claim.context} ${semanticMetricContext(claim.entityContext)}`;
  if (!fieldSupportsClaim(cell.field, metricContext, item.unit)) return false;
  const centreReference = explicitCentreReference(claim.entityContext) ?? fallbackCentreReference;
  if (!centreReference) return true;
  const dimensions: string[] = `${item.id} ${item.label} ${collectNamedCentreDimensions(item.values).join(" ")}`
    .toLowerCase().match(/[a-z0-9]+/gu) ?? [];
  return dimensions.includes(centreReference);
}

function sqlCellSupportsClaim(
  cell: SqlNumericCell,
  claim: NumericClaim,
  fallbackCentreReference: string | null,
): boolean {
  if (!fieldSupportsClaim(cell.column, `${claim.context} ${semanticMetricContext(claim.entityContext)}`, null)) return false;
  const centreReference = explicitCentreReference(claim.entityContext) ?? fallbackCentreReference;
  if (!centreReference) return true;
  return cell.dimensions.some((dimension) => {
    if (!dimension.column || !/(?:centre|center|parent_node|scope)/u.test(dimension.column.toLowerCase())) return false;
    const tokens: string[] = dimension.value.toLowerCase().match(/[a-z0-9]+/gu) ?? [];
    return tokens.includes(centreReference);
  });
}

function fieldSupportsClaim(field: string | null, context: string, itemUnit: string | null): boolean {
  const normalizedField = field?.toLowerCase() ?? "";
  if (hasCurrencyUnit(context)) return /cost|amount|price|tariff|sgd|usd|currency/u.test(normalizedField);
  if (/\b(?:eui|kwh\s*(?:\/|per)\s*(?:m(?:²|2)|sqm|square metres?))\b/u.test(context)) {
    return /eui|kwh.*(?:m2|sqm)|(?:m2|sqm).*kwh/u.test(normalizedField);
  }
  if (/\bkwh\s*(?:\/|per)\s*(?:pax|people|persons?)\b|\bper[-_ ]?pax\b/u.test(context)) {
    return /per_?pax|pax|kwh.*person|person.*kwh/u.test(normalizedField);
  }
  const energyUnit = context.match(/\b(kwh|mwh|gwh|wh|kw|mw|gw|kilowatt[- ]?hours?)\b/u)?.[1];
  if (energyUnit) {
    const expected = energyUnit === "kwh" || energyUnit.startsWith("kilowatt") ? "kwh" : energyUnit;
    return normalizedField.includes(expected)
      || itemUnit?.toLowerCase() === expected && !/(?:count|pct|percent|share|rate|ratio)/u.test(normalizedField);
  }
  if (/%|\bpercent(?:age)?\b/u.test(context)) return /pct|percent|share|rate|ratio/u.test(normalizedField);
  if (/\bcentres?\b/u.test(context)) return /centre.*count|count.*centre/u.test(normalizedField);
  if (/\b(?:spikes?|events?)\b/u.test(context)) return /spike.*count|event.*count|count.*spike|count.*event/u.test(normalizedField);
  if (/\b(?:people|persons?|pax)\b/u.test(context)) return /pax|people|person|headcount/u.test(normalizedField);
  return true;
}

function semanticMetricContext(entityContext: string): string {
  return [
    /[$€£]|\b(?:sgd|usd|cost|price|tariff|dollars?)\b/u.test(entityContext) ? "cost" : "",
    /\b(?:eui|kwh\s*(?:\/|per)\s*(?:m(?:²|2)|sqm|square metres?))\b/u.test(entityContext) ? "eui" : "",
    /\bkwh\s*(?:\/|per)\s*(?:pax|people|persons?)\b|\bper[-_ ]?pax\b/u.test(entityContext) ? "per-pax" : "",
  ].filter(Boolean).join(" ");
}

function collectNamedCentreDimensions(value: unknown, field = ""): string[] {
  if (typeof value === "string") {
    return /(?:centre|center|parent_node|scope)(?:_?code|_?id|_?name)?$/u.test(field.toLowerCase()) ? [value] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => collectNamedCentreDimensions(item, field));
  if (isRecord(value)) return Object.entries(value).flatMap(([key, item]) => collectNamedCentreDimensions(item, key));
  return [];
}

function explicitCentreReference(context: string): string | null {
  const references = new Set([...context.matchAll(/\bcent(?:re|er)\s+([a-z0-9][a-z0-9_-]{0,15})\b/giu)]
    .map((match) => match[1]!.toLowerCase()));
  if (references.size === 0) return null;
  if (references.size > 1) return "__ambiguous_centre__";
  return [...references][0]!;
}

function hasCurrencyUnit(context: string): boolean {
  return /[$€£]|\b(?:sgd|usd|cost|price|tariff|dollars?)\b/u.test(context);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
