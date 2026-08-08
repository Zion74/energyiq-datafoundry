import type { EnergyProjectOverviewProfileDto } from "../../../lib/config-api";

export type AdminOverviewProfilePresentation = {
  name: string;
  revisionLabel: string;
  latestStatusLabel: string;
  shortTermLabel: string;
  mainRangeLabel: string;
};

export function presentAdminOverviewProfile(
  profile: EnergyProjectOverviewProfileDto,
): AdminOverviewProfilePresentation {
  const name = profile.rendererKey === "ngee-ann-overview"
    ? "Ngee Ann decision overview"
    : "Preschool portfolio overview";
  return {
    name,
    revisionLabel: `${profile.rendererKey}@${profile.rendererVersion}`,
    latestStatusLabel: "Latest complete day",
    shortTermLabel: `Rolling ${profile.horizons.shortTermDays} days`,
    mainRangeLabel: `Rolling ${profile.horizons.mainDays} days`,
  };
}

export function resolveAdminOverviewPreviewMode(
  profile: EnergyProjectOverviewProfileDto | null,
): "customer-renderer-handoff" | "generic-layout-preview" {
  return profile ? "customer-renderer-handoff" : "generic-layout-preview";
}
