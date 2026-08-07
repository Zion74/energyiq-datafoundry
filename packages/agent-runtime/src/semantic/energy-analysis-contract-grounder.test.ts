import { describe, expect, it } from "vitest";

import { createUserAnalysisRequirements } from "../protocol/analysis-requirements.js";
import { validateSqlSemantics } from "../protocol/sql-semantic-validator.js";
import {
  createEnergyAnalysisContractGrounder,
  type EnergyAnalysisSemantics,
} from "./energy-analysis-contract-grounder.js";

const semantics: EnergyAnalysisSemantics = {
  contract: "energyiq-analysis-semantics@1",
  relations: {
    facts: {
      relation: "energy_scope_123",
      usageColumn: "usage_kwh",
      qualityStatusColumn: "quality_status",
      officialAggregationColumn: "official_aggregation_eligible",
    },
    scopeMetadata: {
      relation: "energy_scope_123_metadata",
      scopeIdColumn: "scope_id",
      scopeTypeColumn: "scope_type",
      facilityTypeColumn: "facility_type",
      metadataStatusColumn: "metadata_status",
      publishedFacilityTypes: [
        "Active Aging Center",
        "Preschool",
        "Senior Care Center",
      ],
    },
  },
  measureAuthorities: [
    {
      id: "energy.usage_kwh",
      authority: "queryable",
      source: "facts",
      unit: "kWh",
    },
    {
      id: "energy.annualised_eui",
      authority: "deterministic-evidence",
      source: "project-analysis-snapshot",
      unit: "kWh/m2/yr",
    },
  ],
};

describe("createEnergyAnalysisContractGrounder", () => {
  it("grounds a published facility-type count to the metadata relation", async () => {
    const requirements = createUserAnalysisRequirements([{
      kind: "validation",
      description: "How many Active Aging Centers are in this project?",
      acceptanceCriteria: ["Return the published Centre count"],
    }]);

    const result = await createEnergyAnalysisContractGrounder(semantics)({
      requirements,
      datasourceRevision: "7",
      physicalSchema: {
        tables: [
          { name: "energy_scope_123" },
          { name: "energy_scope_123_metadata" },
        ],
      },
      semanticResolution: {
        provider: "energyiq",
        mode: "live",
        datasourceRevision: "7",
        value: {},
        capabilities: [],
        trust: "authoritative",
        warnings: [],
      },
    });

    expect(result.findings).toEqual([]);
    expect(result.requirements[0]?.assertions).toEqual([
      expect.objectContaining({
        id: "R1.A1",
        kind: "metric",
        sourceTables: ["energy_scope_123_metadata"],
        dimensions: ["facility_type"],
        sqlConstraints: [
          { kind: "source", table: "energy_scope_123_metadata" },
          { kind: "filter", column: "scope_type", operator: "eq", value: "centre" },
          {
            kind: "filter",
            column: "facility_type",
            operator: "eq",
            value: "Active Aging Center",
          },
          { kind: "aggregate", function: "COUNT", column: "*", alias: "centre_count" },
        ],
        claimValues: [{ name: "centre_count", field: "centre_count", required: true }],
      }),
    ]);
    const assertions = result.requirements[0]?.assertions ?? [];
    expect(validateSqlSemantics(`
      SELECT COUNT(*) AS centre_count
      FROM energy_scope_123_metadata
      WHERE scope_type = 'centre'
        AND facility_type = 'Active Aging Center'
    `, "duckdb", assertions)).toEqual([]);
    expect(validateSqlSemantics(`
      SELECT COUNT(*) AS centre_count
      FROM energy_scope_123_metadata
      WHERE scope_type = 'centre'
    `, "duckdb", assertions)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "SQL_SEMANTIC_FILTER_MISSING:facility_type:eq" }),
    ]));
  });

  it("keeps open-ended investigation manual instead of constraining autonomous analysis", async () => {
    const requirements = createUserAnalysisRequirements([{
      kind: "decision",
      description: "Which centres should I investigate first, why, and what should I check next?",
      acceptanceCriteria: ["Return an evidenced investigation direction"],
    }]);

    const result = await createEnergyAnalysisContractGrounder(semantics)({
      requirements,
      datasourceRevision: "7",
      physicalSchema: { tables: [] },
      semanticResolution: {
        provider: "energyiq",
        mode: "live",
        datasourceRevision: "7",
        value: {},
        capabilities: [],
        trust: "authoritative",
        warnings: [],
      },
    });

    expect(result.requirements[0]?.assertions).toEqual([
      expect.objectContaining({ kind: "manual", sourceTables: [], sqlConstraints: [] }),
    ]);
  });

  it("does not ground a count for a facility type absent from Published Metadata", async () => {
    const requirements = createUserAnalysisRequirements([{
      kind: "validation",
      description: "How many Hospitals are in this project?",
      acceptanceCriteria: ["Return the count"],
    }]);

    const result = await createEnergyAnalysisContractGrounder(semantics)({
      requirements,
      datasourceRevision: "7",
      physicalSchema: { tables: [] },
      semanticResolution: {
        provider: "energyiq",
        mode: "live",
        datasourceRevision: "7",
        value: {},
        capabilities: [],
        trust: "authoritative",
        warnings: [],
      },
    });

    expect(result.requirements[0]?.assertions[0]).toMatchObject({ kind: "manual" });
  });

  it("fails closed when the authorized metadata relation is absent from the inspected schema", async () => {
    const requirements = createUserAnalysisRequirements([{
      kind: "validation",
      description: "有几个 Active Aging Center？",
      acceptanceCriteria: ["Return the published Centre count"],
    }]);

    const result = await createEnergyAnalysisContractGrounder(semantics)({
      requirements,
      datasourceRevision: "7",
      physicalSchema: { tables: [{ name: "energy_scope_123" }] },
      semanticResolution: {
        provider: "energyiq",
        mode: "live",
        datasourceRevision: "7",
        value: {},
        capabilities: [],
        trust: "authoritative",
        warnings: [],
      },
    });

    expect(result.requirements[0]?.assertions[0]).toMatchObject({ kind: "manual" });
    expect(result.findings).toEqual([
      expect.objectContaining({
        requirementId: "R1",
        code: "CONTRACT_UNKNOWN_TABLE",
      }),
    ]);
  });
});
