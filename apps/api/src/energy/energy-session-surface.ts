const CURRENT_OVERVIEW_SLOT_PREFIX = "energyiq-overview-slot-";
const LEGACY_OVERVIEW_SLOT_PREFIXES = [
  "ngee-ann-overview-",
  "preschool-overview-",
] as const;

export const isEnergyIqOverviewSlotSessionId = (sessionId: string): boolean =>
  sessionId.startsWith(CURRENT_OVERVIEW_SLOT_PREFIX)
  || LEGACY_OVERVIEW_SLOT_PREFIXES.some((prefix) => sessionId.startsWith(prefix));
