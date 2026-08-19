export const ENERGYIQ_OVERVIEW_DEFINITION_REVISION = "energyiq-overview-definition@1" as const;

export type EnergyIqOverviewBlockEmphasis = "primary" | "standard" | "supporting";

export type EnergyIqOverviewBlockDefinition = {
  key: string;
  capabilityRevisionId: string;
  windowId: string;
  emphasis: EnergyIqOverviewBlockEmphasis;
};

export type EnergyIqOverviewSectionDefinition = {
  key: string;
  title: string;
  managementQuestion: string;
  primaryWindowId: string;
  supportingWindowIds: string[];
  blocks: EnergyIqOverviewBlockDefinition[];
};

export type EnergyIqOverviewDefinition = {
  contractRevision: typeof ENERGYIQ_OVERVIEW_DEFINITION_REVISION;
  timePolicyRevisionId: string;
  sections: EnergyIqOverviewSectionDefinition[];
};
