import type {
  EnergyOperatingCalendarEntryInputDto,
  EnergyOperatingDayDto,
  EnergyOperationalPolicyConfigurationDto,
  EnergyOperationalPolicyOwnerInputDto,
  EnergyTariffScheduleEntryInputDto,
} from "../../../lib/config-api";

export const OPERATING_DAYS: EnergyOperatingDayDto[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

export type PolicyOwnerDraft = { kind: "project" | "scope"; scopeId: string };

export type TariffEntryDraft = {
  key: string;
  owner: PolicyOwnerDraft;
  effectiveFrom: string;
  effectiveTo: string;
  currency: string;
  ratePerKwh: string;
};

export type OperatingTimeRangeDraft = { key: string; from: string; to: string };

export type OperatingExceptionDraft = {
  key: string;
  date: string;
  label: string;
  classification: "" | "public_holiday" | "special_closure" | "special_operating_day";
  operating: OperatingTimeRangeDraft[];
};

export type OperatingCalendarEntryDraft = {
  key: string;
  owner: PolicyOwnerDraft;
  effectiveFrom: string;
  effectiveTo: string;
  weekly: Record<EnergyOperatingDayDto, OperatingTimeRangeDraft[]>;
  exceptions: OperatingExceptionDraft[];
};

export const createEmptyTariffEntry = (key: string): TariffEntryDraft => ({
  key,
  owner: { kind: "project", scopeId: "" },
  effectiveFrom: "",
  effectiveTo: "",
  currency: "SGD",
  ratePerKwh: "",
});

export const createEmptyCalendarEntry = (key: string): OperatingCalendarEntryDraft => ({
  key,
  owner: { kind: "project", scopeId: "" },
  effectiveFrom: "",
  effectiveTo: "",
  weekly: {
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
    sunday: [],
  },
  exceptions: [],
});

export const tariffDraftFromConfiguration = (
  configuration: EnergyOperationalPolicyConfigurationDto,
): TariffEntryDraft[] => {
  const revision = configuration.tariffRevisions.find(
    (candidate) => candidate.version_id === configuration.pending.tariff_schedule_version,
  );
  if (!revision) return [createEmptyTariffEntry("tariff-new-1")];
  return revision.entries.map((entry) => ({
    key: entry.id,
    owner: ownerToDraft(entry.owner),
    effectiveFrom: entry.effective_from,
    effectiveTo: entry.effective_to ?? "",
    currency: entry.currency,
    ratePerKwh: String(entry.rate_per_kwh),
  }));
};

export const calendarDraftFromConfiguration = (
  configuration: EnergyOperationalPolicyConfigurationDto,
): OperatingCalendarEntryDraft[] => {
  const revision = configuration.operatingCalendarRevisions.find(
    (candidate) => candidate.version_id === configuration.pending.business_calendar_version,
  );
  if (!revision) return [createEmptyCalendarEntry("calendar-new-1")];
  return revision.entries.map((entry) => ({
    key: entry.id,
    owner: ownerToDraft(entry.owner),
    effectiveFrom: entry.effective_from,
    effectiveTo: entry.effective_to ?? "",
    weekly: Object.fromEntries(OPERATING_DAYS.map((day) => [
      day,
      entry.weekly[day].map((range, index) => ({
        key: `${entry.id}-${day}-${index}`,
        ...range,
      })),
    ])) as Record<EnergyOperatingDayDto, OperatingTimeRangeDraft[]>,
    exceptions: (entry.exceptions ?? []).map((exception, exceptionIndex) => ({
      key: `${entry.id}-exception-${exceptionIndex}`,
      date: exception.date,
      label: exception.label ?? "",
      classification: exception.classification ?? "",
      operating: exception.operating.map((range, rangeIndex) => ({
        key: `${entry.id}-exception-${exceptionIndex}-${rangeIndex}`,
        ...range,
      })),
    })),
  }));
};

export const tariffPublishEntries = (
  entries: TariffEntryDraft[],
): EnergyTariffScheduleEntryInputDto[] => entries.map((entry, index) => {
  const rate = Number(entry.ratePerKwh);
  if (!entry.effectiveFrom) throw new Error(`Tariff window ${index + 1} needs an effective start.`);
  if (!entry.currency.trim()) throw new Error(`Tariff window ${index + 1} needs a currency.`);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error(`Tariff window ${index + 1} needs a positive rate.`);
  return {
    owner: ownerToInput(entry.owner, `Tariff window ${index + 1}`),
    effectiveFrom: entry.effectiveFrom,
    ...(entry.effectiveTo ? { effectiveTo: entry.effectiveTo } : {}),
    currency: entry.currency.trim().toUpperCase(),
    ratePerKwh: rate,
  };
});

export const calendarPublishEntries = (
  entries: OperatingCalendarEntryDraft[],
): EnergyOperatingCalendarEntryInputDto[] => entries.map((entry, index) => {
  if (!entry.effectiveFrom) throw new Error(`Calendar window ${index + 1} needs an effective start.`);
  return {
    owner: ownerToInput(entry.owner, `Calendar window ${index + 1}`),
    effectiveFrom: entry.effectiveFrom,
    ...(entry.effectiveTo ? { effectiveTo: entry.effectiveTo } : {}),
    weekly: Object.fromEntries(OPERATING_DAYS.map((day) => [
      day,
      entry.weekly[day].map((range, rangeIndex) => {
        if (!range.from || !range.to) {
          throw new Error(`Calendar window ${index + 1}, ${day} range ${rangeIndex + 1} is incomplete.`);
        }
        return { from: range.from, to: range.to };
      }),
    ])) as EnergyOperatingCalendarEntryInputDto["weekly"],
    ...(entry.exceptions.length > 0 ? {
      exceptions: entry.exceptions.map((exception, exceptionIndex) => {
        if (!exception.date) {
          throw new Error(`Calendar window ${index + 1}, exception ${exceptionIndex + 1} needs a date.`);
        }
        return {
          date: exception.date,
          operating: exception.operating.map((range, rangeIndex) => {
            if (!range.from || !range.to) {
              throw new Error(
                `Calendar window ${index + 1}, exception ${exceptionIndex + 1}, range ${rangeIndex + 1} is incomplete.`,
              );
            }
            return { from: range.from, to: range.to };
          }),
          ...(exception.label.trim() ? { label: exception.label.trim() } : {}),
          ...(exception.classification ? { classification: exception.classification } : {}),
        };
      }),
    } : {}),
  };
});

export const hasPendingPolicyRelease = (
  configuration: EnergyOperationalPolicyConfigurationDto,
): boolean => configuration.pending.tariff_schedule_version !== configuration.published.tariff_schedule_version
  || configuration.pending.business_calendar_version !== configuration.published.business_calendar_version;

const ownerToDraft = (
  owner: { kind: "project" } | { kind: "scope"; scope_id: string },
): PolicyOwnerDraft => owner.kind === "project"
  ? { kind: "project", scopeId: "" }
  : { kind: "scope", scopeId: owner.scope_id };

const ownerToInput = (
  owner: PolicyOwnerDraft,
  label: string,
): EnergyOperationalPolicyOwnerInputDto => {
  if (owner.kind === "project") return { kind: "project" };
  if (!owner.scopeId) throw new Error(`${label} needs a Scope.`);
  return { kind: "scope", scopeId: owner.scopeId };
};
