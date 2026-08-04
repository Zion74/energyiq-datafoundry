import {
  ENERGY_FACT_WRITER_CONTRACT_VERSION,
  type EnergyFactMaterializationWrite,
  type EnergyFactMaterializationResult,
  type EnergyIntervalFactWrite,
  type EnergyNormalizedReadingWrite,
  type EnergyQualityEventWrite,
  type EnergyRawReadingWrite,
} from "@datafoundry/data-gateway";
import type {
  EnergyIqImportBatchRecord,
  EnergyIqProjectSetupDocument,
} from "@datafoundry/metadata";
import { fingerprintEnergyIqMeterMapping } from "@datafoundry/metadata";

import { readEnergyExcelWorkbook } from "./energy-excel-import.js";

export type EnergyImportMaterializationSummary = {
  rawRowCount: number;
  normalizedReadingCount: number;
  intervalFactCount: number;
  totalUsageKwh: number;
  qualityCounts: Record<string, number>;
  mappingRevision: number;
  mappingFingerprint: string;
  timezone: string;
  materializerContractVersion: typeof ENERGY_EXCEL_MATERIALIZER_CONTRACT_VERSION;
  factWriterContractVersion: typeof ENERGY_FACT_WRITER_CONTRACT_VERSION;
  sourceSheetName: string;
  sourceRowCount: number;
  sourceLabels: string[];
  sourceCoverageFrom?: string;
  sourceCoverageTo?: string;
};

export type EnergyFactMaterializationDraft = Omit<EnergyFactMaterializationWrite, "snapshotFactScope">;

export const ENERGY_EXCEL_MATERIALIZER_CONTRACT_VERSION = "energy-excel-cumulative-v1" as const;

export const createEnergyImportCompletionInput = (
  summary: EnergyImportMaterializationSummary,
  persisted: EnergyFactMaterializationResult,
): { summary: EnergyImportMaterializationSummary; project_audit: EnergyFactMaterializationResult["projectAudit"] } => ({
  summary,
  project_audit: persisted.projectAudit,
});

export const isEnergyImportMaterializationCurrent = (input: {
  batch: EnergyIqImportBatchRecord;
  document: EnergyIqProjectSetupDocument;
  timezone: string;
}): boolean => {
  const mapping = input.document.meter_mapping;
  if (input.batch.status !== "materialized" || !mapping?.confirmed || !input.batch.materialization_json) {
    return false;
  }
  let summary: unknown;
  try {
    summary = JSON.parse(input.batch.materialization_json) as unknown;
  } catch {
    return false;
  }
  if (!isRecord(summary)) return false;
  return summary.mappingFingerprint === fingerprintEnergyIqMeterMapping(mapping)
    && summary.timezone === input.timezone
    && summary.materializerContractVersion === ENERGY_EXCEL_MATERIALIZER_CONTRACT_VERSION
    && summary.factWriterContractVersion === ENERGY_FACT_WRITER_CONTRACT_VERSION;
};

export const buildEnergyExcelMaterialization = async (input: {
  content: Buffer;
  batch: EnergyIqImportBatchRecord;
  document: EnergyIqProjectSetupDocument;
  mappingRevision: number;
  timezone: string;
  databasePath: string;
}): Promise<{
  write: EnergyFactMaterializationDraft;
  summary: EnergyImportMaterializationSummary;
}> => {
  const mapping = input.document.meter_mapping;
  if (!mapping?.confirmed) throw new Error("ENERGYIQ_METER_MAPPING_NOT_CONFIRMED");
  const mappingByLabel = new Map(mapping.rows.map((row) => [row.source_label, row]));
  const nodesById = new Map(input.document.nodes.map((node) => [node.id, node]));
  const workbook = await readEnergyExcelWorkbook(input.content);
  const qualityEvents: EnergyQualityEventWrite[] = [];
  const conflictRows = new Set<number>();
  const deduplicated = new Map<string, EnergyNormalizedReadingWrite>();
  const candidateBySourceRow = new Map<number, EnergyNormalizedReadingWrite>();

  for (const row of workbook.rows) {
    const mapped = mappingByLabel.get(row.sourceLabel);
    if (row.validationError) {
      qualityEvents.push(qualityEvent(input.batch, {
        sourceLabel: row.sourceLabel,
        code: row.validationError,
        severity: "error",
        details: { sourceRowNumber: row.sourceRowNumber },
      }));
      continue;
    }
    if (!mapped) {
      qualityEvents.push(qualityEvent(input.batch, {
        sourceLabel: row.sourceLabel,
        code: "unmapped_source_label",
        severity: "error",
        details: { sourceRowNumber: row.sourceRowNumber },
      }));
      continue;
    }
    if (!row.localTimestamp || row.activeEnergyKwh === undefined) continue;
    const eventTime = localTimestampToUtc(row.localTimestamp, input.timezone);
    const candidate: EnergyNormalizedReadingWrite = {
      workspaceId: input.batch.workspace_id,
      projectId: input.batch.project_id,
      importBatchId: input.batch.id,
      resource: mapped.resource,
      meterPointId: mapped.id,
      scopeId: mapped.scope_id,
      ...(nodesById.get(mapped.scope_id)?.parent_id
        ? { parentNodeId: nodesById.get(mapped.scope_id)!.parent_id }
        : {}),
      sourceLabel: row.sourceLabel,
      category: mapped.category,
      meterRole: mapped.meter_role,
      eventTime,
      activeEnergyKwh: row.activeEnergyKwh,
      sourceFile: input.batch.filename,
      sourceSha256: input.batch.source_sha256,
      sourceRowNumber: row.sourceRowNumber,
      sourceReadingKind: "cumulative_energy",
    };
    candidateBySourceRow.set(row.sourceRowNumber, candidate);
    const key = `${mapped.id}\u0000${eventTime}`;
    const existing = deduplicated.get(key);
    if (existing) {
      const conflict = existing.activeEnergyKwh !== candidate.activeEnergyKwh;
      if (conflict) {
        conflictRows.add(existing.sourceRowNumber);
        conflictRows.add(candidate.sourceRowNumber);
      }
      qualityEvents.push(qualityEvent(input.batch, {
        meterPointId: mapped.id,
        sourceLabel: row.sourceLabel,
        eventTime,
        code: conflict ? "duplicate_reading_conflict" : "duplicate_reading",
        severity: conflict ? "error" : "warning",
        details: {
          keptSourceRowNumber: candidate.sourceRowNumber,
          replacedSourceRowNumber: existing.sourceRowNumber,
        },
      }));
    }
    deduplicated.set(key, candidate);
  }

  const normalizedReadings = [...deduplicated.values()].sort(
    (left, right) => left.meterPointId.localeCompare(right.meterPointId)
      || left.eventTime.localeCompare(right.eventTime),
  );
  const intervalFacts: EnergyIntervalFactWrite[] = [];
  const readingsByMeter = new Map<string, EnergyNormalizedReadingWrite[]>();
  for (const reading of normalizedReadings) {
    readingsByMeter.set(reading.meterPointId, [...(readingsByMeter.get(reading.meterPointId) ?? []), reading]);
  }
  for (const readings of readingsByMeter.values()) {
    readings.sort((left, right) => left.eventTime.localeCompare(right.eventTime));
    const first = readings[0];
    if (first) {
      qualityEvents.push(qualityEvent(input.batch, {
        meterPointId: first.meterPointId,
        sourceLabel: first.sourceLabel,
        eventTime: first.eventTime,
        code: "boundary",
        severity: "warning",
        details: { reason: "No previous cumulative reading exists inside this Import Batch." },
      }));
    }
    for (let index = 1; index < readings.length; index += 1) {
      const previous = readings[index - 1]!;
      const current = readings[index]!;
      const elapsedMinutes = (Date.parse(current.eventTime) - Date.parse(previous.eventTime)) / 60_000;
      const rawDeltaKwh = current.activeEnergyKwh - previous.activeEnergyKwh;
      const qualityStatus = rawDeltaKwh < 0
        ? "negative_delta"
        : elapsedMinutes > 15.1
          ? "gap"
          : elapsedMinutes < 14.9
            ? "irregular_interval"
            : "ok";
      const usageKwh = qualityStatus === "ok" ? rawDeltaKwh : undefined;
      const local = localParts(previous.eventTime, input.timezone);
      intervalFacts.push({
        workspaceId: current.workspaceId,
        projectId: current.projectId,
        importBatchId: current.importBatchId,
        resource: current.resource,
        meterPointId: current.meterPointId,
        scopeId: current.scopeId,
        ...(current.parentNodeId ? { parentNodeId: current.parentNodeId } : {}),
        sourceLabel: current.sourceLabel,
        category: current.category,
        meterRole: current.meterRole,
        intervalStart: previous.eventTime,
        intervalEnd: current.eventTime,
        elapsedMinutes,
        activeEnergyKwh: current.activeEnergyKwh,
        previousActiveEnergyKwh: previous.activeEnergyKwh,
        rawDeltaKwh,
        ...(usageKwh === undefined ? {} : {
          usageKwh,
          averageKw: usageKwh / (elapsedMinutes / 60),
        }),
        qualityStatus,
        localDate: local.date,
        localHour: local.hour,
        dayType: local.dayType,
        sourceFile: current.sourceFile,
        sourceSha256: current.sourceSha256,
        sourceReadingKind: "cumulative_energy",
      });
      if (qualityStatus !== "ok") {
        qualityEvents.push(qualityEvent(input.batch, {
          meterPointId: current.meterPointId,
          sourceLabel: current.sourceLabel,
          eventTime: current.eventTime,
          code: qualityStatus,
          severity: qualityStatus === "negative_delta" ? "error" : "warning",
          details: { elapsedMinutes, rawDeltaKwh },
        }));
      }
    }
  }

  const rawReadings: EnergyRawReadingWrite[] = workbook.rows.map((row) => {
    const mapped = mappingByLabel.get(row.sourceLabel);
    const candidate = candidateBySourceRow.get(row.sourceRowNumber);
    return {
      workspaceId: input.batch.workspace_id,
      projectId: input.batch.project_id,
      importBatchId: input.batch.id,
      resource: mapped?.resource ?? "electricity",
      sourceLabel: row.sourceLabel,
      ...(mapped ? { meterPointId: mapped.id, scopeId: mapped.scope_id } : {}),
      ...(candidate ? { eventTime: candidate.eventTime } : {}),
      ...(row.activeEnergyKwh === undefined ? {} : { activeEnergyKwh: row.activeEnergyKwh }),
      sourceFile: input.batch.filename,
      sourceSha256: input.batch.source_sha256,
      sourceRowNumber: row.sourceRowNumber,
      isValid: !row.validationError && Boolean(mapped),
      ...((row.validationError ?? (!mapped ? "unmapped_source_label" : undefined))
        ? { validationError: row.validationError ?? "unmapped_source_label" }
        : {}),
      isOverlapConflict: conflictRows.has(row.sourceRowNumber),
    };
  });
  const qualityCounts = countQuality([
    ...intervalFacts.filter((fact) => fact.qualityStatus === "ok").map(() => "ok"),
    ...qualityEvents.map((event) => event.code),
  ]);
  const summary: EnergyImportMaterializationSummary = {
    rawRowCount: rawReadings.length,
    normalizedReadingCount: normalizedReadings.length,
    intervalFactCount: intervalFacts.length,
    totalUsageKwh: round(intervalFacts.reduce((sum, fact) => sum + (fact.usageKwh ?? 0), 0)),
    qualityCounts,
    mappingRevision: input.mappingRevision,
    mappingFingerprint: fingerprintEnergyIqMeterMapping(mapping),
    timezone: input.timezone,
    materializerContractVersion: ENERGY_EXCEL_MATERIALIZER_CONTRACT_VERSION,
    factWriterContractVersion: ENERGY_FACT_WRITER_CONTRACT_VERSION,
    sourceSheetName: workbook.inspection.sheetName,
    sourceRowCount: workbook.inspection.rowCount,
    sourceLabels: workbook.inspection.sourceLabels.map((source) => source.label),
    ...(workbook.inspection.coverageFrom ? { sourceCoverageFrom: workbook.inspection.coverageFrom } : {}),
    ...(workbook.inspection.coverageTo ? { sourceCoverageTo: workbook.inspection.coverageTo } : {}),
  };
  return {
    write: {
      databasePath: input.databasePath,
      projectId: input.batch.project_id,
      importBatchId: input.batch.id,
      sourceSha256: input.batch.source_sha256,
      timezone: input.timezone,
      rawReadings,
      normalizedReadings,
      intervalFacts,
      qualityEvents,
    },
    summary,
  };
};

const qualityEvent = (
  batch: EnergyIqImportBatchRecord,
  event: Omit<EnergyQualityEventWrite, "workspaceId" | "projectId" | "importBatchId" | "sourceReadingKind">,
): EnergyQualityEventWrite => ({
  workspaceId: batch.workspace_id,
  projectId: batch.project_id,
  importBatchId: batch.id,
  sourceReadingKind: "cumulative_energy",
  ...event,
});

const localTimestampToUtc = (value: string, timezone: string): string => {
  const explicit = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  if (explicit) {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) throw new Error(`ENERGYIQ_TIMESTAMP_INVALID:${value}`);
    return new Date(timestamp).toISOString();
  }
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) throw new Error(`ENERGYIQ_TIMESTAMP_INVALID:${value}`);
  const parts = match.slice(1).map(Number);
  const localAsUtc = Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!, parts[3]!, parts[4]!, parts[5] ?? 0);
  let guess = localAsUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const zoned = zonedParts(new Date(guess), timezone);
    const zonedAsUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second);
    const next = localAsUtc - (zonedAsUtc - guess);
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess).toISOString();
};

const localParts = (timestamp: string, timezone: string): { date: string; hour: number; dayType: string } => {
  const date = new Date(timestamp);
  const parts = zonedParts(date, timezone);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(date);
  return {
    date: `${parts.year.toString().padStart(4, "0")}-${parts.month.toString().padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`,
    hour: parts.hour,
    dayType: weekday === "Sat" || weekday === "Sun" ? "weekend" : "weekday",
  };
};

const zonedParts = (date: Date, timezone: string) => {
  const values = new Map(new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
    hour: Number(values.get("hour")),
    minute: Number(values.get("minute")),
    second: Number(values.get("second")),
  };
};

const countQuality = (codes: string[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const code of codes) counts[code] = (counts[code] ?? 0) + 1;
  return counts;
};

const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
