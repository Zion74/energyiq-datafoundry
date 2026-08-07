import { createAnalysisAssertions } from "../protocol/analysis-contract.js";
import type {
  AnalysisContractGrounder,
  AnalysisContractGroundingFinding,
  AnalysisContractGroundingResult,
} from "../protocol/model-analysis-contract-grounder.js";
import type { AnalysisRequirement } from "../protocol/analysis-requirements.js";

export type EnergyAnalysisSemantics = {
  contract: "energyiq-analysis-semantics@1";
  relations: {
    facts: {
      relation: string;
      usageColumn: string;
      qualityStatusColumn: string;
      officialAggregationColumn: string;
    };
    scopeMetadata: {
      relation: string;
      scopeIdColumn: string;
      scopeTypeColumn: string;
      facilityTypeColumn: string;
      metadataStatusColumn: string;
      publishedFacilityTypes: string[];
    };
  };
  measureAuthorities: Array<{
    id: string;
    authority: "queryable" | "deterministic-evidence";
    source: "facts" | "scope-metadata" | "project-analysis-snapshot";
    unit?: string;
  }>;
};

/**
 * Ground the small set of EnergyIQ requirements whose physical mapping is
 * completely determined by the accepted Project release. Open-ended analysis
 * deliberately stays manual so the Analyst can choose its own investigation.
 */
export const createEnergyAnalysisContractGrounder = (
  semantics: EnergyAnalysisSemantics,
): AnalysisContractGrounder => async (input): Promise<AnalysisContractGroundingResult> => {
  const findings: AnalysisContractGroundingFinding[] = [];
  const availableTables = physicalTableNames(input.physicalSchema);
  const requirements = input.requirements.map((requirement) => {
    if (requirement.source !== "user") return cloneRequirement(requirement);
    const facilityType = requestedFacilityType(requirement.description, semantics);
    if (!facilityType || !isCountQuestion(requirement.description)) {
      return cloneRequirement(requirement);
    }
    const metadata = semantics.relations.scopeMetadata;
    if (!availableTables.has(normalize(metadata.relation))) {
      findings.push({
        requirementId: requirement.id,
        code: "CONTRACT_UNKNOWN_TABLE",
        message: `Published Scope metadata relation '${metadata.relation}' is absent from the inspected schema.`,
      });
      return cloneRequirement(requirement);
    }
    return {
      ...cloneRequirement(requirement),
      assertions: createAnalysisAssertions(requirement.id, [{
        kind: "metric",
        description: `Count published Centre scopes with facility_type '${facilityType}'.`,
        sourceTables: [metadata.relation],
        dimensions: [metadata.facilityTypeColumn],
        sqlConstraints: [
          { kind: "source", table: metadata.relation },
          {
            kind: "filter",
            column: metadata.scopeTypeColumn,
            operator: "eq",
            value: "centre",
          },
          {
            kind: "filter",
            column: metadata.facilityTypeColumn,
            operator: "eq",
            value: facilityType,
          },
          { kind: "aggregate", function: "COUNT", column: "*", alias: "centre_count" },
        ],
        resultChecks: [
          { kind: "row_count", required: true, min: 1, max: 1 },
          { kind: "not_null", required: true, fields: ["centre_count"] },
        ],
        claimValues: [{ name: "centre_count", field: "centre_count", required: true }],
      }]),
    };
  });
  return { requirements, findings };
};

const isCountQuestion = (value: string): boolean =>
  /\bhow\s+many\b|\bcount\b|\bnumber\s+of\b|多少|几个/iu.test(value);

const requestedFacilityType = (
  question: string,
  semantics: EnergyAnalysisSemantics,
): string | undefined => {
  const normalizedQuestion = normalize(question);
  const matches = semantics.relations.scopeMetadata.publishedFacilityTypes
    .filter((facilityType) => normalizedQuestion.includes(normalize(facilityType)))
    .sort((left, right) => right.length - left.length);
  return matches.length === 1 ? matches[0] : undefined;
};

const physicalTableNames = (physicalSchema: unknown): Set<string> => {
  if (!isRecord(physicalSchema) || !Array.isArray(physicalSchema.tables)) return new Set();
  return new Set(physicalSchema.tables.flatMap((table) => {
    if (typeof table === "string") return [normalize(table)];
    if (!isRecord(table) || typeof table.name !== "string") return [];
    return [normalize(table.name)];
  }));
};

const cloneRequirement = (requirement: AnalysisRequirement): AnalysisRequirement =>
  structuredClone(requirement);

const normalize = (value: string): string => value.trim().toLocaleLowerCase();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
