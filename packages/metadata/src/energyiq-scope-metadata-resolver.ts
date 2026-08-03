import type { DatabaseSync } from "node:sqlite";

import type { EnergyIqMetadataStatus } from "./energyiq-project-setup-store.js";

export type EnergyIqAnalysisPeriod = {
  start: string;
  endExclusive: string;
};

export type EnergyIqScopeMetadataEvidence = {
  metadataRevisionId: string;
  hierarchyRevisionId: string;
  status: EnergyIqMetadataStatus;
  effectiveFrom: string | null;
  effectiveTo: string | null;
};

export type EnergyIqScopeMetadataMissingReason =
  | "not-configured"
  | "not-effective-for-period"
  | "ambiguous-effective-revisions"
  | "value-changes-within-period"
  | "invalid-value";

export type EnergyIqResolvedScopeMetadataValue =
  | {
    status: EnergyIqMetadataStatus;
    value: number;
    unit: "m2" | "people";
    metadataRevisionIds: string[];
    hierarchyRevisionIds: string[];
    evidence: EnergyIqScopeMetadataEvidence[];
  }
  | {
    status: "missing";
    value: null;
    unit: "m2" | "people";
    reason: EnergyIqScopeMetadataMissingReason;
    guidance: string;
    metadataRevisionIds: string[];
    hierarchyRevisionIds: string[];
    evidence: EnergyIqScopeMetadataEvidence[];
  };

export type EnergyIqScopeMetadataResolution = {
  projectId: string;
  scopeId: string;
  period: EnergyIqAnalysisPeriod;
  timezone: string;
  status: EnergyIqMetadataStatus | "missing";
  area: EnergyIqResolvedScopeMetadataValue;
  headcount: EnergyIqResolvedScopeMetadataValue;
};

export type EnergyIqNormalisedMetricResult =
  | {
    status: EnergyIqMetadataStatus;
    metricId: "energy.usage_per_sqm" | "energy.usage_per_person";
    value: number;
    unit: "kWh/m2" | "kWh/person";
    metadataRevisionIds: string[];
    hierarchyRevisionIds: string[];
    evidence: EnergyIqScopeMetadataEvidence[];
  }
  | {
    status: "missing";
    metricId: "energy.usage_per_sqm" | "energy.usage_per_person";
    value: null;
    unit: "kWh/m2" | "kWh/person";
    reason: EnergyIqScopeMetadataMissingReason | "invalid-energy";
    guidance: string;
    metadataRevisionIds: string[];
    hierarchyRevisionIds: string[];
    evidence: EnergyIqScopeMetadataEvidence[];
  };

export type EnergyIqEnergyNormalisations = {
  eui: EnergyIqNormalisedMetricResult;
  perPax: EnergyIqNormalisedMetricResult;
};

type MetadataRevision = {
  id: string;
  hierarchyRevisionId: string;
  areaSqm: number | null;
  occupantCount: number | null;
  metadataStatus: EnergyIqMetadataStatus;
  effectiveFrom: string | null;
  effectiveTo: string | null;
};

type EffectiveMetadataRevision = MetadataRevision & {
  effectiveFromMs: number;
  effectiveToMs: number;
};

type PeriodRevisionResolution = {
  revisions: MetadataRevision[];
  failureReason?: "not-configured" | "not-effective-for-period" | "ambiguous-effective-revisions";
};

export class EnergyIqScopeMetadataResolver {
  constructor(private readonly db: DatabaseSync) {}

  resolveForPeriod(input: {
    projectId: string;
    scopeId: string;
    period: EnergyIqAnalysisPeriod;
    timezone: string;
  }): EnergyIqScopeMetadataResolution {
    const periodStart = parseInstant(input.period.start, "ENERGYIQ_METADATA_PERIOD_INVALID");
    const periodEnd = parseInstant(input.period.endExclusive, "ENERGYIQ_METADATA_PERIOD_INVALID");
    if (periodStart >= periodEnd) {
      throw new Error("ENERGYIQ_METADATA_PERIOD_INVALID");
    }
    assertTimeZone(input.timezone);

    const revisions = this.listRevisions(input.projectId, input.scopeId);
    const periodRevisions = resolvePeriodRevisions({
      revisions,
      periodStart,
      periodEnd,
      timezone: input.timezone,
    });

    const area = resolveDimension({
      dimension: "Area",
      scopeId: input.scopeId,
      unit: "m2",
      revisions: periodRevisions.revisions,
      value: (revision) => revision.areaSqm,
      ...(periodRevisions.failureReason ? { failureReason: periodRevisions.failureReason } : {}),
    });
    const headcount = resolveDimension({
      dimension: "Headcount",
      scopeId: input.scopeId,
      unit: "people",
      revisions: periodRevisions.revisions,
      value: (revision) => revision.occupantCount,
      ...(periodRevisions.failureReason ? { failureReason: periodRevisions.failureReason } : {}),
    });

    return {
      projectId: input.projectId,
      scopeId: input.scopeId,
      period: input.period,
      timezone: input.timezone,
      status: combineStatus(area.status, headcount.status),
      area,
      headcount,
    };
  }

  calculateEnergyNormalisations(input: {
    energyKwh: number;
    metadata: EnergyIqScopeMetadataResolution;
  }): EnergyIqEnergyNormalisations {
    return {
      eui: calculateNormalisedMetric({
        energyKwh: input.energyKwh,
        metadata: input.metadata.area,
        metricId: "energy.usage_per_sqm",
        unit: "kWh/m2",
      }),
      perPax: calculateNormalisedMetric({
        energyKwh: input.energyKwh,
        metadata: input.metadata.headcount,
        metricId: "energy.usage_per_person",
        unit: "kWh/person",
      }),
    };
  }

  private listRevisions(projectId: string, scopeId: string): MetadataRevision[] {
    return this.db.prepare(`
      SELECT id, hierarchy_revision_id, area_sqm, occupant_count,
             metadata_status, effective_from, effective_to
      FROM energyiq_node_metadata_revisions
      WHERE project_id = ? AND node_id = ?
      ORDER BY created_at, id
    `).all(projectId, scopeId).flatMap((row) => {
      if (!isRecord(row)) return [];
      return [{
        id: requiredString(row, "id"),
        hierarchyRevisionId: requiredString(row, "hierarchy_revision_id"),
        areaSqm: optionalNumber(row.area_sqm),
        occupantCount: optionalNumber(row.occupant_count),
        metadataStatus: row.metadata_status === "confirmed" ? "confirmed" : "provisional",
        effectiveFrom: optionalString(row.effective_from),
        effectiveTo: optionalString(row.effective_to),
      }];
    });
  }
}

const resolveDimension = (input: {
  dimension: "Area" | "Headcount";
  scopeId: string;
  unit: "m2" | "people";
  revisions: MetadataRevision[];
  value: (revision: MetadataRevision) => number | null;
  failureReason?: "not-configured" | "not-effective-for-period" | "ambiguous-effective-revisions";
}): EnergyIqResolvedScopeMetadataValue => {
  const evidence = input.revisions.map(toEvidence);
  const metadataRevisionIds = evidence.map((item) => item.metadataRevisionId);
  const hierarchyRevisionIds = evidence.map((item) => item.hierarchyRevisionId);
  if (input.failureReason) {
    return missingDimension(input, input.failureReason, evidence, metadataRevisionIds, hierarchyRevisionIds);
  }

  const values = input.revisions.map(input.value);
  if (values.some((value) => value === null)) {
    return missingDimension(input, "not-configured", evidence, metadataRevisionIds, hierarchyRevisionIds);
  }
  const numericValues = values.filter((value): value is number => typeof value === "number");
  if (numericValues.length !== values.length
    || numericValues.some((value) => !Number.isFinite(value) || value <= 0)) {
    return missingDimension(input, "invalid-value", evidence, metadataRevisionIds, hierarchyRevisionIds);
  }
  const distinctValues = new Set(numericValues);
  if (distinctValues.size > 1) {
    return missingDimension(input, "value-changes-within-period", evidence, metadataRevisionIds, hierarchyRevisionIds);
  }
  const value = numericValues[0];
  if (value === undefined) {
    return missingDimension(input, "not-configured", evidence, metadataRevisionIds, hierarchyRevisionIds);
  }
  return {
    status: input.revisions.some((revision) => revision.metadataStatus === "provisional")
      ? "provisional"
      : "confirmed",
    value,
    unit: input.unit,
    metadataRevisionIds,
    hierarchyRevisionIds,
    evidence,
  };
};

const resolvePeriodRevisions = (input: {
  revisions: MetadataRevision[];
  periodStart: number;
  periodEnd: number;
  timezone: string;
}): PeriodRevisionResolution => {
  if (input.revisions.length === 0) {
    return { revisions: [], failureReason: "not-configured" };
  }
  const effective = input.revisions.map((revision): EffectiveMetadataRevision => ({
    ...revision,
    effectiveFromMs: revision.effectiveFrom
      ? parseEffectiveBoundary(revision.effectiveFrom, input.timezone)
      : Number.NEGATIVE_INFINITY,
    effectiveToMs: revision.effectiveTo
      ? parseEffectiveBoundary(revision.effectiveTo, input.timezone)
      : Number.POSITIVE_INFINITY,
  }));
  const intersecting = effective.filter((revision) =>
    revision.effectiveFromMs < input.periodEnd && input.periodStart < revision.effectiveToMs
  );
  const boundaries = [...new Set([
    input.periodStart,
    input.periodEnd,
    ...intersecting.flatMap((revision) => [revision.effectiveFromMs, revision.effectiveToMs])
      .filter((boundary) => input.periodStart < boundary && boundary < input.periodEnd),
  ])].sort((left, right) => left - right);
  const selected: MetadataRevision[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const segmentStart = boundaries[index]!;
    const segmentEnd = boundaries[index + 1]!;
    const active = effective.filter((revision) =>
      revision.effectiveFromMs <= segmentStart && segmentEnd <= revision.effectiveToMs
    );
    if (active.length === 0) {
      return {
        revisions: uniqueRevisions(intersecting),
        failureReason: "not-effective-for-period",
      };
    }
    if (active.length > 1) {
      return {
        revisions: uniqueRevisions(active),
        failureReason: "ambiguous-effective-revisions",
      };
    }
    selected.push(active[0]!);
  }
  return { revisions: uniqueRevisions(selected) };
};

const uniqueRevisions = (revisions: MetadataRevision[]): MetadataRevision[] => {
  const byId = new Map<string, MetadataRevision>();
  for (const revision of revisions) byId.set(revision.id, revision);
  return [...byId.values()];
};

const missingDimension = (
  input: { dimension: "Area" | "Headcount"; scopeId: string; unit: "m2" | "people" },
  reason: EnergyIqScopeMetadataMissingReason,
  evidence: EnergyIqScopeMetadataEvidence[],
  metadataRevisionIds: string[],
  hierarchyRevisionIds: string[],
): EnergyIqResolvedScopeMetadataValue => ({
  status: "missing",
  value: null,
  unit: input.unit,
  reason,
  guidance: completionGuidance(input.dimension, input.scopeId, reason),
  metadataRevisionIds,
  hierarchyRevisionIds,
  evidence,
});

const completionGuidance = (
  dimension: "Area" | "Headcount",
  scopeId: string,
  reason: EnergyIqScopeMetadataMissingReason,
): string => {
  const field = dimension === "Area" ? "comparison area (m2)" : "24-hour representative headcount";
  if (reason === "ambiguous-effective-revisions") {
    return `Resolve overlapping ${dimension} effective dates for Scope ${scopeId} in Admin > Projects > Structure, then publish a new Project Release.`;
  }
  if (reason === "value-changes-within-period") {
    return `${dimension} changes inside the selected Period for Scope ${scopeId}; split the analysis at the effective-date boundary before calculating this metric.`;
  }
  if (reason === "invalid-value") {
    return `Set ${field} to a value greater than zero for Scope ${scopeId} in Admin > Projects > Structure, then publish a new Project Release.`;
  }
  return `Add ${field} for Scope ${scopeId} in Admin > Projects > Structure, set effective dates that cover the selected Period, then publish a new Project Release.`;
};

const calculateNormalisedMetric = (input: {
  energyKwh: number;
  metadata: EnergyIqResolvedScopeMetadataValue;
  metricId: "energy.usage_per_sqm" | "energy.usage_per_person";
  unit: "kWh/m2" | "kWh/person";
}): EnergyIqNormalisedMetricResult => {
  if (!Number.isFinite(input.energyKwh) || input.energyKwh < 0) {
    return {
      status: "missing",
      metricId: input.metricId,
      value: null,
      unit: input.unit,
      reason: "invalid-energy",
      guidance: "Provide a finite, non-negative total energy value for the selected Scope and Period before calculating this metric.",
      metadataRevisionIds: input.metadata.metadataRevisionIds,
      hierarchyRevisionIds: input.metadata.hierarchyRevisionIds,
      evidence: input.metadata.evidence,
    };
  }
  if (input.metadata.status === "missing") {
    return {
      status: "missing",
      metricId: input.metricId,
      value: null,
      unit: input.unit,
      reason: input.metadata.reason,
      guidance: input.metadata.guidance,
      metadataRevisionIds: input.metadata.metadataRevisionIds,
      hierarchyRevisionIds: input.metadata.hierarchyRevisionIds,
      evidence: input.metadata.evidence,
    };
  }
  return {
    status: input.metadata.status,
    metricId: input.metricId,
    value: input.energyKwh / input.metadata.value,
    unit: input.unit,
    metadataRevisionIds: input.metadata.metadataRevisionIds,
    hierarchyRevisionIds: input.metadata.hierarchyRevisionIds,
    evidence: input.metadata.evidence,
  };
};

const toEvidence = (revision: MetadataRevision): EnergyIqScopeMetadataEvidence => ({
  metadataRevisionId: revision.id,
  hierarchyRevisionId: revision.hierarchyRevisionId,
  status: revision.metadataStatus,
  effectiveFrom: revision.effectiveFrom,
  effectiveTo: revision.effectiveTo,
});

const combineStatus = (
  left: EnergyIqMetadataStatus | "missing",
  right: EnergyIqMetadataStatus | "missing",
): EnergyIqMetadataStatus | "missing" => {
  if (left === "missing" || right === "missing") return "missing";
  if (left === "provisional" || right === "provisional") return "provisional";
  return "confirmed";
};

const parseEffectiveBoundary = (value: string, timezone: string): number => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return zonedStartOfDay(value, timezone);
  }
  return parseInstant(value, "ENERGYIQ_METADATA_EFFECTIVE_DATE_INVALID");
};

const zonedStartOfDay = (date: string, timezone: string): number => {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) throw new Error("ENERGYIQ_METADATA_EFFECTIVE_DATE_INVALID");
  const localAsUtc = Date.UTC(year, month - 1, day);
  let guess = localAsUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const valueOf = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((part) => part.type === type)?.value ?? 0);
    const zonedAsUtc = Date.UTC(
      valueOf("year"),
      valueOf("month") - 1,
      valueOf("day"),
      valueOf("hour"),
      valueOf("minute"),
      valueOf("second"),
    );
    guess = localAsUtc - (zonedAsUtc - guess);
  }
  return guess;
};

const assertTimeZone = (timezone: string): void => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date(0));
  } catch {
    throw new Error("ENERGYIQ_METADATA_TIMEZONE_INVALID");
  }
};

const parseInstant = (value: string, errorCode: string): number => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(errorCode);
  return parsed;
};

const optionalString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const optionalNumber = (value: unknown): number | null =>
  typeof value === "number" ? value : null;

const requiredString = (row: Record<string, unknown>, key: string): string => {
  const value = row[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`ENERGYIQ_SCOPE_METADATA_INVALID:${key}`);
  }
  return value;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
