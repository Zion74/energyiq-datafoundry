import { createHash } from "node:crypto";
import { z } from "zod";

export const TRUSTED_ENERGY_TEXT_INTENTS = [
  "period-usage-vs-previous",
  "historical-normal-level",
  "day-type-pattern",
  "top-peer-scope",
  "normalised-performance",
  "top-circuit-contribution",
  "category-breakdown",
  "peak-and-contributors",
  "non-operating-usage",
  "priority-actions"
] as const;

export type TrustedEnergyTextIntent = typeof TRUSTED_ENERGY_TEXT_INTENTS[number];

export const TRUSTED_ENERGY_TEXT_INTENT_METRICS = {
  "period-usage-vs-previous": ["energy.total_usage_kwh"],
  "historical-normal-level": ["energy.total_usage_kwh"],
  "day-type-pattern": ["energy.total_usage_kwh"],
  "top-peer-scope": ["energy.total_usage_kwh"],
  "normalised-performance": ["energy.usage_per_sqm", "energy.usage_per_person"],
  "top-circuit-contribution": ["energy.total_usage_kwh"],
  "category-breakdown": ["energy.total_usage_kwh"],
  "peak-and-contributors": ["energy.peak_demand_kw"],
  "non-operating-usage": ["energy.off_hours_usage_kwh", "energy.off_hours_share_pct"],
  "priority-actions": ["energy.total_usage_kwh"]
} as const satisfies Record<TrustedEnergyTextIntent, readonly string[]>;

const snapshotSelectorByIntent = {
  "period-usage-vs-previous": "analysis.summary+analysis.comparison",
  "historical-normal-level": "analysis.baseline",
  "day-type-pattern": "analysis.dayTypeProfile",
  "top-peer-scope": "analysis.childScopes",
  "normalised-performance": "analysis.childScopes.normalised",
  "top-circuit-contribution": "analysis.topCircuits",
  "category-breakdown": "analysis.categories",
  "peak-and-contributors": "analysis.summary.peak+analysis.topCircuits",
  "non-operating-usage": "analysis.offHours",
  "priority-actions": "findings+dataQuality"
} as const satisfies Record<TrustedEnergyTextIntent, string>;

const identifierSchema = z.string().trim().min(1).max(256);
const timestampSchema = z.string().datetime({ offset: true });
const evidenceRefSchema = z.object({
  id: identifierSchema,
  metricId: identifierSchema,
  dataSnapshotId: identifierSchema
}).strict();
const trustedEnergyTextRequestSchema = z.object({
  kind: z.literal("trusted-energy-text"),
  intent: z.enum(TRUSTED_ENERGY_TEXT_INTENTS),
  context: z.object({
    project: z.object({ id: identifierSchema, name: identifierSchema }).strict(),
    scope: z.object({ id: identifierSchema, name: identifierSchema, type: identifierSchema }).strict(),
    period: z.object({
      label: identifierSchema,
      start: timestampSchema,
      endExclusive: timestampSchema,
      timezone: identifierSchema.refine(isTimeZone, { message: "Invalid IANA timezone." })
    }).strict(),
    metric: z.object({
      id: identifierSchema,
      label: identifierSchema,
      unit: identifierSchema,
      revisionId: identifierSchema
    }).strict(),
    dataSnapshotId: identifierSchema,
    dataAsOf: timestampSchema,
    evidenceRefs: z.array(evidenceRefSchema).min(1).max(64)
  }).strict()
}).strict();

export type TrustedEnergyTextRequest = z.infer<typeof trustedEnergyTextRequestSchema>;

export type TrustedEnergyTextQueryContract = {
  kind: "trusted-energy-text-query";
  id: string;
  intent: TrustedEnergyTextIntent;
  source: "project-analysis-snapshot";
  selector: typeof snapshotSelectorByIntent[TrustedEnergyTextIntent];
  pins: TrustedEnergyTextRequest["context"];
};

const trustedEnergyTextResultSchema = z.object({
  body: z.string().trim().min(1).max(20_000),
  metricId: identifierSchema,
  metricRevisionId: identifierSchema,
  dataSnapshotId: identifierSchema,
  evidenceRefIds: z.array(identifierSchema).min(1).max(64)
}).strict();

export type TrustedEnergyTextResultInput = z.infer<typeof trustedEnergyTextResultSchema>;
export type TrustedEnergyTextResult = TrustedEnergyTextResultInput & { validated: true };

/**
 * Compile an allowlisted EnergyIQ text intent into a ProjectAnalysisSnapshot selector.
 * The caller must project a trusted Snapshot into this strict contract; free-form SQL
 * and model-selected Scope/Period/Metric values are deliberately not accepted here.
 */
export const compileTrustedEnergyTextQuery = (input: unknown): TrustedEnergyTextQueryContract => {
  const parsed = trustedEnergyTextRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`TRUSTED_ENERGY_TEXT_REQUEST_INVALID:${formatIssues(parsed.error)}`);
  }
  const { context, intent } = parsed.data;
  if (Date.parse(context.period.start) >= Date.parse(context.period.endExclusive)) {
    throw new Error("TRUSTED_ENERGY_TEXT_REQUEST_INVALID:PERIOD_NOT_HALF_OPEN");
  }
  if (!TRUSTED_ENERGY_TEXT_INTENT_METRICS[intent].some((metricId) => metricId === context.metric.id)) {
    throw new Error(`TRUSTED_ENERGY_TEXT_REQUEST_INVALID:INTENT_METRIC_MISMATCH:${intent}`);
  }
  if (!context.metric.revisionId.startsWith(`${context.metric.id}@`)) {
    throw new Error("TRUSTED_ENERGY_TEXT_REQUEST_INVALID:METRIC_REVISION_MISMATCH");
  }
  for (const evidenceRef of context.evidenceRefs) {
    if (evidenceRef.metricId !== context.metric.id) {
      throw new Error(`TRUSTED_ENERGY_TEXT_REQUEST_INVALID:EVIDENCE_METRIC_MISMATCH:${evidenceRef.id}`);
    }
    if (evidenceRef.dataSnapshotId !== context.dataSnapshotId) {
      throw new Error(`TRUSTED_ENERGY_TEXT_REQUEST_INVALID:EVIDENCE_SNAPSHOT_MISMATCH:${evidenceRef.id}`);
    }
  }
  const pins = structuredClone(context);
  const id = createHash("sha256")
    .update(JSON.stringify({ intent, pins }))
    .digest("hex")
    .slice(0, 24);
  return deepFreeze({
    kind: "trusted-energy-text-query",
    id: `energy-text-${id}`,
    intent,
    source: "project-analysis-snapshot",
    selector: snapshotSelectorByIntent[intent],
    pins
  });
};

/** Bind answer text back to the exact Metric, Snapshot and Evidence selected by the compiler. */
export const validateTrustedEnergyTextResult = (
  contract: TrustedEnergyTextQueryContract,
  input: unknown
): TrustedEnergyTextResult => {
  const parsed = trustedEnergyTextResultSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`TRUSTED_ENERGY_TEXT_RESULT_INVALID:${formatIssues(parsed.error)}`);
  }
  const result = parsed.data;
  if (result.metricId !== contract.pins.metric.id) {
    throw new Error("TRUSTED_ENERGY_TEXT_METRIC_MISMATCH");
  }
  if (result.metricRevisionId !== contract.pins.metric.revisionId) {
    throw new Error("TRUSTED_ENERGY_TEXT_METRIC_REVISION_MISMATCH");
  }
  if (result.dataSnapshotId !== contract.pins.dataSnapshotId) {
    throw new Error("TRUSTED_ENERGY_TEXT_SNAPSHOT_MISMATCH");
  }
  const allowedEvidenceIds = new Set(contract.pins.evidenceRefs.map((ref) => ref.id));
  if (result.evidenceRefIds.some((evidenceRefId) => !allowedEvidenceIds.has(evidenceRefId))) {
    throw new Error("TRUSTED_ENERGY_TEXT_EVIDENCE_MISMATCH");
  }
  if (containsSecretBearingText(result.body)) {
    throw new Error("TRUSTED_ENERGY_TEXT_SECRET_REDACTION_REQUIRED");
  }
  return deepFreeze({ ...result, validated: true as const });
};

/** Render the non-optional trust envelope shown with every trusted text answer. */
export const createTrustedEnergyAnswerEnvelope = (
  contract: TrustedEnergyTextQueryContract,
  result: TrustedEnergyTextResult
): string => {
  if (result.validated !== true) {
    throw new Error("TRUSTED_ENERGY_TEXT_RESULT_NOT_VALIDATED");
  }
  return [
    result.body,
    "",
    `Scope: ${contract.pins.scope.name}`,
    `Period: ${formatLocalTimestamp(contract.pins.period.start, contract.pins.period.timezone)} to `
      + `${formatLocalTimestamp(contract.pins.period.endExclusive, contract.pins.period.timezone)} (exclusive) · `
      + contract.pins.period.timezone,
    `Metric: ${contract.pins.metric.label} (${contract.pins.metric.unit}) · ${contract.pins.metric.revisionId}`,
    `Data as of: ${formatLocalTimestamp(contract.pins.dataAsOf, contract.pins.period.timezone)} · `
      + contract.pins.period.timezone,
    `Evidence: ${result.evidenceRefIds.join(", ")}`
  ].join("\n");
};

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

const formatLocalTimestamp = (value: string, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
};

const containsSecretBearingText = (value: string): boolean =>
  /\b(?:api[_ -]?key|authorization|bearer|client[_ -]?secret)\b\s*[:=]|\bsk-[a-z0-9_-]{12,}\b/iu.test(value);

const formatIssues = (error: z.ZodError): string => error.issues
  .map((issue) => `${issue.path.join(".") || "request"}:${issue.code}`)
  .join(",");

const deepFreeze = <T>(value: T): T => {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
};
