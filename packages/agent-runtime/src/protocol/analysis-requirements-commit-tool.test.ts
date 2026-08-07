import { describe, expect, it, vi } from "vitest";

import { createUserAnalysisRequirements } from "./analysis-requirements.js";
import {
  buildAnalysisRequirementsCommitInputSchema,
  createAnalysisRequirementsCommitTool
} from "./analysis-requirements-commit-tool.js";
import type { AnalysisContextEvidenceCatalog } from "./analysis-context-evidence.js";

const requirements = createUserAnalysisRequirements([{
  kind: "metric",
  description: "Report total electricity consumption",
  acceptanceCriteria: ["Exact kWh"],
  assertions: [{
    kind: "metric",
    description: "Validated usage",
    claimValues: [{ name: "usage_kwh", field: "usage_kwh", unit: "kWh", required: true }]
  }]
}]);

const mixedRequirements = createUserAnalysisRequirements([
  {
    kind: "metric",
    description: "Report total electricity consumption",
    acceptanceCriteria: ["Exact kWh"],
    assertions: [{
      kind: "metric",
      description: "Validated usage",
      claimValues: [{ name: "usage_kwh", field: "usage_kwh", unit: "kWh", required: true }]
    }]
  },
  {
    kind: "metric",
    description: "Report centre count",
    acceptanceCriteria: ["Exact count"],
    assertions: [{
      kind: "metric",
      description: "Validated count",
      claimValues: [{ name: "centre_count", field: "centre_count", unit: "count", required: true }]
    }]
  }
]);

describe("analysis requirements commit tool", () => {
  it("removes values from the model schema when no requirement declares claim values", () => {
    const manualRequirements = createUserAnalysisRequirements([{
      kind: "metric",
      description: "Count Active Aging Center facilities",
      acceptanceCriteria: ["Return the exact count"]
    }]);

    const schema = buildAnalysisRequirementsCommitInputSchema(manualRequirements);

    expect(schema.safeParse({
      claims: [{
        requirement_id: "R1",
        claim: "There are 8 Active Aging Center facilities",
        values: [{ name: "active_aging_center_count", value: 8, unit: "count" }]
      }]
    }).success).toBe(false);
    expect(schema.safeParse({
      claims: [{
        requirement_id: "R1",
        claim: "There are 8 Active Aging Center facilities"
      }]
    }).success).toBe(true);
  });

  it("exposes only server-declared requirement ids and value names", () => {
    const schema = buildAnalysisRequirementsCommitInputSchema(requirements);

    expect(schema.safeParse({
      claims: [{
        requirement_id: "R99",
        claim: "Unknown requirement",
        values: [{ name: "usage_kwh", value: 1, unit: "kWh" }]
      }]
    }).success).toBe(false);
    expect(schema.safeParse({
      claims: [{
        requirement_id: "R1",
        claim: "Invented value name",
        values: [{ name: "active_aging_center_count", value: 8, unit: "count" }]
      }]
    }).success).toBe(false);
  });

  it("keeps per-requirement value validation inside the controlled observation boundary", async () => {
    const executeAction = vi.fn();
    const tool = createAnalysisRequirementsCommitTool({
      analysisRequirements: mixedRequirements,
      executeAction,
      runId: "run-1",
      segmentId: "segment-1",
      trustedEnergy: true
    });

    const result = await tool.execute?.({ claims: [{
      requirement_id: "R1",
      claim: "A count incorrectly attached to the usage requirement",
      values: [{ name: "centre_count", value: 8, unit: "count" }]
    }] }, {
      agent: { toolCallId: "call-cross-requirement-value" }
    } as never);

    expect(result).toMatchObject({
      ok: false,
      isError: true,
      error: {
        code: "TRUSTED_ENERGY_REQUIREMENT_VALUE_NOT_FOUND",
        category: "validation",
        executionStatus: "failed",
        retryable: false
      },
      recovery: {
        strategy: "refresh_and_replan",
        avoid: [expect.stringContaining("Do not repeat analysis_requirements_commit unchanged")]
      }
    });
    expect(executeAction).not.toHaveBeenCalled();
  });

  it("binds authorized context facts and injects canonical values before commit", async () => {
    const contextRequirements = createUserAnalysisRequirements([{
      kind: "metric",
      description: "What is Centre A EUI?",
      acceptanceCriteria: ["Use released EUI"],
    }]);
    contextRequirements[0]!.contextEvidence = {
      mode: "sufficient",
      factIds: ["centre-a.eui"],
    };
    const catalog: AnalysisContextEvidenceCatalog = {
      contract: "analysis-context-evidence@1",
      sourceId: "project-analysis-snapshot:project-1:snapshot-1",
      pins: {
        workspaceId: "workspace-1",
        projectId: "project-1",
        scopeId: "project",
        dataSnapshotId: "snapshot-1",
        dataCutoff: "2026-06-01T00:00:00.000Z",
        projectReleaseId: "release-1",
        metricVersion: "metrics-1",
      },
      facts: [{
        id: "centre-a.eui",
        label: "Centre A EUI",
        metricId: "preschool.benchmark.eui",
        value: 13.62,
        unit: "kWh/m2/year",
        status: "provisional",
        evidenceRefs: ["evidence-eui"],
        dimensions: { scopeId: "centre-a" },
      }],
    };
    const executeAction = vi.fn(async (action) => ({ observation: action.input }));
    const tool = createAnalysisRequirementsCommitTool({
      analysisRequirements: contextRequirements,
      contextEvidenceCatalog: catalog,
      executeAction,
      getAnalysisRequirements: () => contextRequirements,
      runId: "run-context",
      segmentId: "segment-context",
      trustedEnergy: true,
    });

    const result = await tool.execute?.({ claims: [{
      requirement_id: "R1",
      claim: "Centre A released EUI is 13.62 kWh/m2/year and is provisional.",
      context_fact_ids: ["centre-a.eui"],
    }] }, { agent: { toolCallId: "call-context" } } as never);

    expect(result).toMatchObject({ claims: [{
      requirement_id: "R1",
      values: [{ name: "centre-a.eui", value: 13.62, unit: "kWh/m2/year" }],
      evidence_refs: ["evidence-eui"],
    }] });
    expect(executeAction).toHaveBeenNthCalledWith(1, expect.objectContaining({
      actionName: "analysis.context.evidence.bind",
      input: expect.objectContaining({
        fact_ids: ["centre-a.eui"],
        completion_mode: "sufficient",
      }),
    }));
    expect(executeAction).toHaveBeenNthCalledWith(2, expect.objectContaining({
      actionName: "analysis.requirements.commit",
    }));
  });

  it("rejects unknown or ungrounded context facts before changing protocol state", async () => {
    const contextRequirements = createUserAnalysisRequirements([{
      kind: "metric",
      description: "What is Centre A EUI?",
      acceptanceCriteria: [],
    }]);
    contextRequirements[0]!.contextEvidence = { mode: "sufficient", factIds: ["centre-a.eui"] };
    const executeAction = vi.fn();
    const tool = createAnalysisRequirementsCommitTool({
      analysisRequirements: contextRequirements,
      contextEvidenceCatalog: {
        contract: "analysis-context-evidence@1",
        sourceId: "snapshot-source",
        pins: {
          workspaceId: "workspace-1",
          projectId: "project-1",
          scopeId: "project",
          dataSnapshotId: "snapshot-1",
          dataCutoff: "2026-06-01T00:00:00.000Z",
          projectReleaseId: "release-1",
          metricVersion: "metrics-1",
        },
        facts: [{
          id: "centre-a.eui",
          label: "Centre A EUI",
          metricId: "preschool.benchmark.eui",
          value: 13.62,
          unit: "kWh/m2/year",
          status: "provisional",
          evidenceRefs: ["evidence-eui"],
          dimensions: { scopeId: "centre-a" },
        }],
      },
      executeAction,
      getAnalysisRequirements: () => contextRequirements,
      runId: "run-context",
      segmentId: "segment-context",
      trustedEnergy: true,
    });

    const result = await tool.execute?.({ claims: [{
      requirement_id: "R1",
      claim: "Invented EUI",
      context_fact_ids: ["invented.eui"],
    }] }, { agent: { toolCallId: "call-invalid-context" } } as never);

    expect(result).toMatchObject({ ok: false, isError: true });
    expect(executeAction).not.toHaveBeenCalled();
  });
});
