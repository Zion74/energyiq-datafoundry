import { readSheet, type CellValue } from "read-excel-file/node";

const REQUIRED_COLUMNS = ["Device Name", "Time", "Active Energy"] as const;

export type EnergyExcelImportInspection = {
  columns: string[];
  sourceLabels: Array<{ label: string; rowCount: number }>;
  rowCount: number;
  validRowCount: number;
  invalidRowCount: number;
  duplicateReadingCount: number;
  negativeReadingCount: number;
  coverageFrom?: string;
  coverageTo?: string;
  typicalIntervalMinutes?: number;
  readingKind: "cumulative";
  qualityStatus: "ready" | "needs_review";
  issues: string[];
};

export const inspectEnergyExcelWorkbook = async (
  content: Buffer,
): Promise<EnergyExcelImportInspection> => {
  const rows = await readSheet(content);
  if (rows.length === 0) throw new Error("ENERGYIQ_EXCEL_EMPTY");
  const columns = rows[0]!.map(displayCell);
  const indexes = new Map(columns.map((column, index) => [normaliseHeader(column), index]));
  for (const required of REQUIRED_COLUMNS) {
    if (!indexes.has(normaliseHeader(required))) {
      throw new Error(`ENERGYIQ_EXCEL_COLUMN_REQUIRED:${required}`);
    }
  }

  const labelIndex = indexes.get(normaliseHeader("Device Name"))!;
  const timeIndex = indexes.get(normaliseHeader("Time"))!;
  const readingIndex = indexes.get(normaliseHeader("Active Energy"))!;
  const labelCounts = new Map<string, number>();
  const timestampsByLabel = new Map<string, number[]>();
  const readingKeys = new Set<string>();
  let rowCount = 0;
  let validRowCount = 0;
  let invalidRowCount = 0;
  let duplicateReadingCount = 0;
  let negativeReadingCount = 0;
  let coverageFrom: number | undefined;
  let coverageTo: number | undefined;

  for (const row of rows.slice(1)) {
    if (row.every((cell) => cell === null || displayCell(cell) === "")) continue;
    rowCount += 1;
    const label = displayCell(row[labelIndex]).trim();
    const timestamp = timestampValue(row[timeIndex]);
    const reading = numberValue(row[readingIndex]);
    if (!label || timestamp === undefined || reading === undefined) {
      invalidRowCount += 1;
      continue;
    }
    validRowCount += 1;
    if (reading < 0) negativeReadingCount += 1;
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
    timestampsByLabel.set(label, [...(timestampsByLabel.get(label) ?? []), timestamp]);
    const key = `${label}\u0000${timestamp}`;
    if (readingKeys.has(key)) duplicateReadingCount += 1;
    readingKeys.add(key);
    coverageFrom = coverageFrom === undefined ? timestamp : Math.min(coverageFrom, timestamp);
    coverageTo = coverageTo === undefined ? timestamp : Math.max(coverageTo, timestamp);
  }

  const intervals: number[] = [];
  for (const timestamps of timestampsByLabel.values()) {
    const sorted = [...new Set(timestamps)].sort((left, right) => left - right);
    for (let index = 1; index < sorted.length; index += 1) {
      const minutes = (sorted[index]! - sorted[index - 1]!) / 60_000;
      if (minutes > 0 && Number.isFinite(minutes)) intervals.push(minutes);
    }
  }
  intervals.sort((left, right) => left - right);
  const typicalIntervalMinutes = intervals.length > 0
    ? intervals[Math.floor(intervals.length / 2)]
    : undefined;
  const issues = [
    ...(invalidRowCount > 0 ? [`${invalidRowCount} row(s) have missing or invalid required values.`] : []),
    ...(duplicateReadingCount > 0 ? [`${duplicateReadingCount} duplicate device/time reading(s) require deterministic de-duplication.`] : []),
    ...(negativeReadingCount > 0 ? [`${negativeReadingCount} cumulative reading(s) are negative.`] : []),
    ...(typicalIntervalMinutes !== undefined && typicalIntervalMinutes !== 15
      ? [`Typical interval is ${typicalIntervalMinutes} minutes rather than 15 minutes.`]
      : []),
  ];

  return {
    columns,
    sourceLabels: [...labelCounts.entries()]
      .map(([label, count]) => ({ label, rowCount: count }))
      .sort((left, right) => left.label.localeCompare(right.label)),
    rowCount,
    validRowCount,
    invalidRowCount,
    duplicateReadingCount,
    negativeReadingCount,
    ...(coverageFrom === undefined ? {} : { coverageFrom: new Date(coverageFrom).toISOString() }),
    ...(coverageTo === undefined ? {} : { coverageTo: new Date(coverageTo).toISOString() }),
    ...(typicalIntervalMinutes === undefined ? {} : { typicalIntervalMinutes }),
    readingKind: "cumulative",
    qualityStatus: issues.length === 0 ? "ready" : "needs_review",
    issues,
  };
};

const normaliseHeader = (value: string): string => value.trim().replace(/\s+/g, " ").toLowerCase();

const displayCell = (value: CellValue | null | undefined): string => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
};

const timestampValue = (value: CellValue | null | undefined): number | undefined => {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime();
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
};

const numberValue = (value: CellValue | null | undefined): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
