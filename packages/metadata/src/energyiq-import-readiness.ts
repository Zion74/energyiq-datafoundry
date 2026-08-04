import type {
  EnergyIqDataSnapshotRecord,
  EnergyIqImportBatchRecord,
  EnergyIqProjectRecord,
} from "./energyiq-store.js";
import {
  fingerprintEnergyIqMeterMapping,
  type EnergyIqProjectSetupDocument,
} from "./energyiq-project-setup-store.js";

export type EnergyIqProjectDataReadiness = {
  status: "not_required" | "blocked" | "ready";
  ready: boolean;
  requiresFormalData: boolean;
  importBatchCount: number;
  materializedBatchCount: number;
  sourceLabelCount: number;
  mappedSourceLabelCount: number;
  unmappedSourceLabels: string[];
  inactiveMappingSourceLabels: string[];
  mappingConfirmed: boolean;
  dataSnapshotId?: string;
  blockingReasons: string[];
  warnings: string[];
  audit?: Record<string, unknown>;
};

export const resolveEnergyIqProjectDataReadiness = (input: {
  project: EnergyIqProjectRecord;
  batches: EnergyIqImportBatchRecord[];
  document: EnergyIqProjectSetupDocument;
  snapshot?: EnergyIqDataSnapshotRecord;
  expectedMaterializerContractVersion: string;
  expectedFactWriterContractVersion: string;
}): EnergyIqProjectDataReadiness => {
  const mapping = input.document.meter_mapping;
  const sourceManifest = input.document.source_manifest;
  const requiresFormalData = input.batches.length > 0
    || mapping !== undefined
    || sourceManifest !== undefined;
  if (!requiresFormalData) {
    return {
      status: "not_required",
      ready: true,
      requiresFormalData: false,
      importBatchCount: 0,
      materializedBatchCount: 0,
      sourceLabelCount: 0,
      mappedSourceLabelCount: 0,
      unmappedSourceLabels: [],
      inactiveMappingSourceLabels: [],
      mappingConfirmed: false,
      blockingReasons: [],
      warnings: [],
    };
  }

  const sourceLabels = sourceLabelsAcrossEnergyIqImportBatches(input.batches);
  const sourceByKey = new Map(sourceLabels.map((label) => [normaliseLabel(label), label]));
  const mappingByKey = new Map((mapping?.rows ?? []).map((row) => [normaliseLabel(row.source_label), row.source_label]));
  const unmappedSourceLabels = [...sourceByKey.entries()]
    .filter(([key]) => !mappingByKey.has(key))
    .map(([, label]) => label);
  const inactiveMappingSourceLabels = [...mappingByKey.entries()]
    .filter(([key]) => !sourceByKey.has(key))
    .map(([, label]) => label);
  const materializedBatches = input.batches.filter((batch) => batch.status === "materialized");
  const blockingReasons = resolveEnergyIqMaterializationBlockingReasons({
    batches: input.batches,
    document: input.document,
  });
  const warnings: string[] = [];

  if (materializedBatches.length !== input.batches.length) blockingReasons.push("IMPORT_BATCH_NOT_MATERIALIZED");

  const snapshot = input.snapshot;
  if (!snapshot || snapshot.id !== input.project.data_snapshot_id) {
    blockingReasons.push("DATA_SNAPSHOT_REQUIRED");
  }
  const snapshotManifest = parseRecord(snapshot?.manifest_json);
  const snapshotSourceShas = arrayRecords(snapshotManifest.batches)
    .map((batch) => stringValue(batch.sourceSha256))
    .filter((value): value is string => Boolean(value))
    .map(normaliseSha256)
    .sort();
  const requiredSourceShas = (sourceManifest?.source_sha256 ?? input.batches.map((batch) => batch.source_sha256))
    .map(normaliseSha256)
    .sort();
  if (snapshot && JSON.stringify(snapshotSourceShas) !== JSON.stringify(requiredSourceShas)) {
    blockingReasons.push("SNAPSHOT_BATCH_SET_MISMATCH");
  }
  if (mapping?.confirmed && materializedBatches.length > 0) {
    const fingerprint = fingerprintEnergyIqMeterMapping(mapping);
    const materializationFingerprints = new Set(materializedBatches.map((batch) =>
      stringValue(parseRecord(batch.materialization_json).mappingFingerprint) ?? "<missing>"));
    if (materializationFingerprints.size !== 1 || !materializationFingerprints.has(fingerprint)) {
      blockingReasons.push("SNAPSHOT_MAPPING_MISMATCH");
    }
    const timezones = new Set(materializedBatches.map((batch) =>
      stringValue(parseRecord(batch.materialization_json).timezone) ?? "<missing>"));
    if (timezones.size !== 1 || !timezones.has(input.document.project.timezone)) {
      blockingReasons.push("SNAPSHOT_TIMEZONE_MISMATCH");
    }
    const contractVersions = new Set(materializedBatches.map((batch) =>
      stringValue(parseRecord(batch.materialization_json).materializerContractVersion) ?? "<missing>"));
    if (
      contractVersions.size !== 1
      || !contractVersions.has(input.expectedMaterializerContractVersion)
    ) {
      blockingReasons.push("MATERIALIZER_CONTRACT_MISMATCH");
    }
    const factWriterContractVersions = new Set(materializedBatches.map((batch) =>
      stringValue(parseRecord(batch.materialization_json).factWriterContractVersion) ?? "<missing>"));
    if (
      factWriterContractVersions.size !== 1
      || !factWriterContractVersions.has(input.expectedFactWriterContractVersion)
    ) {
      blockingReasons.push("FACT_WRITER_CONTRACT_MISMATCH");
    }
  }

  const audit = snapshot ? parseRecord(snapshot.audit_json) : undefined;
  const auditValid = audit !== undefined && REQUIRED_AUDIT_FIELDS.every((field) =>
    isNonNegativeFiniteNumber(audit[field]));
  if (snapshot && !auditValid) blockingReasons.push("SNAPSHOT_AUDIT_INVALID");
  if (audit && auditValid) {
    if (numberValue(audit.rawRowCount) <= 0 || numberValue(audit.normalizedReadingCount) <= 0) {
      blockingReasons.push("FACT_STORE_EMPTY");
    }
    if (numberValue(audit.intervalFactCount) <= 0) blockingReasons.push("INTERVAL_FACTS_EMPTY");
    if (numberValue(audit.invalidRawRowCount) > 0) blockingReasons.push("INVALID_RAW_ROWS");
    if (numberValue(audit.unmappedRawRowCount) > 0) blockingReasons.push("UNMAPPED_RAW_ROWS");
    if (
      numberValue(audit.duplicateNormalizedReadingCount) > 0
      || numberValue(audit.duplicateIntervalFactCount) > 0
    ) blockingReasons.push("CANONICAL_DUPLICATES");
    if (numberValue(audit.invalidIntervalDurationCount) > 0) blockingReasons.push("INVALID_INTERVAL_DURATION");
    if (numberValue(audit.negativeDeltaIntervalCount) > 0) blockingReasons.push("NEGATIVE_INTERVAL_DELTAS");
    if (
      numberValue(audit.legacyRawRowCount) > 0
      || numberValue(audit.legacyNormalizedReadingCount) > 0
      || numberValue(audit.legacyIntervalFactCount) > 0
      || numberValue(audit.legacyCanonicalRowCount) > 0
    ) blockingReasons.push("LEGACY_CANONICAL_ROWS");
    const overlapCount = numberValue(audit.rawOverlapConflictCount);
    if (overlapCount > 0) {
      warnings.push(`RAW_OVERLAP_CONFLICTS_RESOLVED_BY_LATER_COVERAGE:${overlapCount}`);
    }
  }

  const uniqueBlockingReasons = [...new Set(blockingReasons)];
  return {
    status: uniqueBlockingReasons.length === 0 ? "ready" : "blocked",
    ready: uniqueBlockingReasons.length === 0,
    requiresFormalData: true,
    importBatchCount: input.batches.length,
    materializedBatchCount: materializedBatches.length,
    sourceLabelCount: sourceLabels.length,
    mappedSourceLabelCount: sourceLabels.length - unmappedSourceLabels.length,
    unmappedSourceLabels,
    inactiveMappingSourceLabels,
    mappingConfirmed: mapping?.confirmed === true,
    ...(snapshot && audit ? { dataSnapshotId: snapshot.id, audit } : {}),
    blockingReasons: uniqueBlockingReasons,
    warnings,
  };
};

export const resolveEnergyIqMaterializationBlockingReasons = (input: {
  batches: EnergyIqImportBatchRecord[];
  document: EnergyIqProjectSetupDocument;
}): string[] => {
  const reasons: string[] = [];
  const mapping = input.document.meter_mapping;
  const sourceManifest = input.document.source_manifest;
  if (input.batches.length === 0) reasons.push("IMPORT_BATCH_REQUIRED");
  if (!sourceManifest) reasons.push("SOURCE_MANIFEST_REQUIRED");
  else if (!sourceManifest.confirmed) reasons.push("SOURCE_MANIFEST_NOT_CONFIRMED");
  if (!mapping) reasons.push("METER_MAPPING_REQUIRED");
  else if (!mapping.confirmed) reasons.push("METER_MAPPING_NOT_CONFIRMED");

  if (sourceManifest) {
    const expectedSourceShas = [...new Set(sourceManifest.source_sha256.map(normaliseSha256))].sort();
    const actualSourceShas = [...new Set(input.batches.map((batch) => normaliseSha256(batch.source_sha256)))].sort();
    if (JSON.stringify(actualSourceShas) !== JSON.stringify(expectedSourceShas)) {
      reasons.push("SOURCE_MANIFEST_MISMATCH");
    }
  }
  if (mapping) {
    const sourceLabels = sourceLabelsAcrossEnergyIqImportBatches(input.batches);
    const sourceKeys = new Set(sourceLabels.map(normaliseLabel));
    const mappingKeys = new Set(mapping.rows.map((row) => normaliseLabel(row.source_label)));
    if (mappingKeys.size !== mapping.rows.length) reasons.push("SOURCE_LABEL_DUPLICATE");
    if (sourceLabels.some((label) => !mappingKeys.has(normaliseLabel(label)))) {
      reasons.push("SOURCE_LABEL_UNMAPPED");
    }
    if (mapping.rows.some((row) => !sourceKeys.has(normaliseLabel(row.source_label)))) {
      reasons.push("MAPPING_SOURCE_INACTIVE");
    }
  }
  return [...new Set(reasons)];
};

export const sourceLabelsAcrossEnergyIqImportBatches = (
  batches: EnergyIqImportBatchRecord[],
): string[] => {
  const labels = new Map<string, string>();
  for (const batch of batches) {
    const inspection = parseRecord(batch.inspection_json);
    for (const source of arrayRecords(inspection.sourceLabels)) {
      const label = stringValue(source.label)?.trim();
      if (label) labels.set(normaliseLabel(label), label);
    }
  }
  return [...labels.values()].sort((left, right) => left.localeCompare(right));
};

const parseRecord = (value: string | undefined): Record<string, unknown> => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const arrayRecords = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normaliseLabel = (value: string): string => value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
const normaliseSha256 = (value: string): string => value.trim().toLocaleLowerCase();
const stringValue = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;
const numberValue = (value: unknown): number => typeof value === "number" && Number.isFinite(value) ? value : 0;
const isNonNegativeFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const REQUIRED_AUDIT_FIELDS = [
  "rawRowCount",
  "invalidRawRowCount",
  "unmappedRawRowCount",
  "rawOverlapConflictCount",
  "normalizedReadingCount",
  "intervalFactCount",
  "duplicateNormalizedReadingCount",
  "duplicateIntervalFactCount",
  "invalidIntervalDurationCount",
  "negativeDeltaIntervalCount",
  "legacyRawRowCount",
  "legacyNormalizedReadingCount",
  "legacyIntervalFactCount",
  "legacyCanonicalRowCount",
] as const;
