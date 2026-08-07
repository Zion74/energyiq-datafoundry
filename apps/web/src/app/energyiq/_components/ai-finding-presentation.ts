export type AiPresentationValueItem = {
  label: string;
  value: number;
};

export type AiPresentationBlock =
  | { type: "metric"; label: string; value: number; unit?: string; context?: string }
  | { type: "comparison" | "ranking" | "share" | "distribution"; title?: string; unit?: string; items: AiPresentationValueItem[] }
  | { type: "trend"; title?: string; unit?: string; points: AiPresentationValueItem[] }
  | { type: "heatmap"; title?: string; unit?: string; xLabels: string[]; yLabels: string[]; values: number[][] }
  | { type: "table"; title?: string; columns: string[]; rows: Array<Array<string | number>> }
  | { type: "callout"; tone: "insight" | "caution" | "positive" | "neutral"; text: string };

export type AiFindingPresentation = {
  version: "1";
  blocks: AiPresentationBlock[];
};

const MAX_BLOCKS = 8;
const MAX_SERIES_ITEMS = 12;
const MAX_TREND_POINTS = 31;
const MAX_TABLE_COLUMNS = 6;
const MAX_TABLE_ROWS = 12;
const MAX_HEATMAP_COLUMNS = 24;
const MAX_HEATMAP_ROWS = 12;

/**
 * Parses an Agent-authored presentation as a collection of safe, composable
 * primitives. Invalid blocks fail locally so one unsupported visual never
 * hides the verified Finding or its narrative fallback.
 */
export function parseAiFindingPresentation(value: unknown): AiFindingPresentation | null {
  if (!isRecord(value) || value.version !== "1" || !Array.isArray(value.blocks)) return null;
  const blocks = value.blocks.slice(0, MAX_BLOCKS).flatMap<AiPresentationBlock>(parseBlock);
  return blocks.length > 0 ? { version: "1", blocks } : null;
}

export function aiFindingPresentationEvidenceText(presentation: AiFindingPresentation | null | undefined): string {
  if (!presentation) return "";
  return presentation.blocks.flatMap((block) => {
    switch (block.type) {
      case "metric":
        return [block.label, block.value, block.unit, block.context];
      case "comparison":
      case "ranking":
      case "share":
      case "distribution":
        return [block.title, block.unit, ...block.items.flatMap((item) => [item.label, item.value])];
      case "trend":
        return [block.title, block.unit, ...block.points.flatMap((point) => [point.label, point.value])];
      case "heatmap":
        return [block.title, block.unit, ...block.xLabels, ...block.yLabels, ...block.values.flat()];
      case "table":
        return [block.title, ...block.columns, ...block.rows.flat()];
      case "callout":
        return [block.text];
    }
  }).filter((part): part is string | number => typeof part === "number" || Boolean(part)).join(" ");
}

function parseBlock(value: unknown): AiPresentationBlock[] {
  if (!isRecord(value)) return [];
  const type = text(value.type, 40);
  if (type === "metric") {
    const label = text(value.label, 120);
    const metricValue = finiteNumber(value.value);
    if (!label || metricValue === null) return [];
    const unit = optionalText(value.unit, 32);
    const context = optionalText(value.context, 180);
    return [{ type, label, value: metricValue, ...(unit ? { unit } : {}), ...(context ? { context } : {}) }];
  }
  if (type === "comparison" || type === "ranking" || type === "share" || type === "distribution") {
    const items = parseValueItems(value.items, type === "comparison" ? 2 : 1, MAX_SERIES_ITEMS);
    if (!items) return [];
    const title = optionalText(value.title, 160);
    const unit = optionalText(value.unit, 32);
    return [{ type, items, ...(title ? { title } : {}), ...(unit ? { unit } : {}) }];
  }
  if (type === "trend") {
    const points = parseValueItems(value.points, 2, MAX_TREND_POINTS);
    if (!points) return [];
    const title = optionalText(value.title, 160);
    const unit = optionalText(value.unit, 32);
    return [{ type, points, ...(title ? { title } : {}), ...(unit ? { unit } : {}) }];
  }
  if (type === "heatmap") {
    const title = optionalText(value.title, 160);
    const unit = optionalText(value.unit, 32);
    const xLabels = stringList(value.xLabels, MAX_HEATMAP_COLUMNS);
    const yLabels = stringList(value.yLabels, MAX_HEATMAP_ROWS);
    if (!xLabels || !yLabels || !Array.isArray(value.values) || value.values.length !== yLabels.length) return [];
    const values = value.values.flatMap<number[]>((row) => {
      if (!Array.isArray(row) || row.length !== xLabels.length) return [];
      const parsed = row.map(finiteNumber);
      return parsed.some((candidate) => candidate === null) ? [] : [parsed as number[]];
    });
    if (values.length !== yLabels.length) return [];
    return [{ type, xLabels, yLabels, values, ...(title ? { title } : {}), ...(unit ? { unit } : {}) }];
  }
  if (type === "table") {
    const title = optionalText(value.title, 160);
    const columns = stringList(value.columns, MAX_TABLE_COLUMNS);
    if (!columns || !Array.isArray(value.rows) || value.rows.length === 0 || value.rows.length > MAX_TABLE_ROWS) return [];
    const rows = value.rows.flatMap<Array<string | number>>((row) => {
      if (!Array.isArray(row) || row.length !== columns.length) return [];
      const cells = row.flatMap<string | number>((cell) => {
        const numeric = finiteNumber(cell);
        if (numeric !== null) return [numeric];
        const label = text(cell, 120);
        return label ? [label] : [];
      });
      return cells.length === columns.length ? [cells] : [];
    });
    if (rows.length !== value.rows.length) return [];
    return [{ type, columns, rows, ...(title ? { title } : {}) }];
  }
  if (type === "callout") {
    const tone = text(value.tone, 20);
    const calloutText = text(value.text, 320);
    if (!calloutText || (tone !== "insight" && tone !== "caution" && tone !== "positive" && tone !== "neutral")) return [];
    return [{ type, tone, text: calloutText }];
  }
  return [];
}

function parseValueItems(value: unknown, minimum: number, maximum: number): AiPresentationValueItem[] | null {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) return null;
  const items = value.flatMap<AiPresentationValueItem>((candidate) => {
    if (!isRecord(candidate)) return [];
    const label = text(candidate.label, 100);
    const itemValue = finiteNumber(candidate.value);
    return label && itemValue !== null ? [{ label, value: itemValue }] : [];
  });
  return items.length === value.length ? items : null;
}

function stringList(value: unknown, maximum: number): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum) return null;
  const items = value.flatMap((candidate) => {
    const item = text(candidate, 80);
    return item ? [item] : [];
  });
  return items.length === value.length ? items : null;
}

function optionalText(value: unknown, maximum: number): string | undefined {
  return value === undefined || value === null ? undefined : text(value, maximum) ?? undefined;
}

function text(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/gu, " ").trim();
  return cleaned && cleaned.length <= maximum ? cleaned : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
