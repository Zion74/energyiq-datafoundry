import type { AgentEnergyQueryContext } from "../types.js";
import type { SemanticRequest, SemanticResolution } from "./types.js";

/**
 * Project the server-authoritative Energy Query Context into the protocol's
 * semantic boundary. It does not infer business meaning or replace DataLink;
 * it only certifies the already scoped canonical energy fact view.
 */
export class EnergyQuerySemanticProvider {
  readonly id = "energyiq" as const;

  constructor(private readonly context: AgentEnergyQueryContext) {}

  async resolve(request: SemanticRequest): Promise<SemanticResolution> {
    return {
      value: {
        physicalSchema: request.physicalSchema,
        project: {
          id: this.context.projectId,
          name: this.context.projectName
        },
        scope: {
          id: this.context.scopeId,
          name: this.context.scopeName,
          type: this.context.scopeType
        },
        resource: this.context.resource,
        period: {
          label: this.context.period,
          from: this.context.from,
          to: this.context.to,
          endExclusive: true,
          timezone: this.context.timezone
        },
        ...(this.context.metricVersion ? { metricVersion: this.context.metricVersion } : {})
      },
      capabilities: ["physical-schema", "energy-query-context", "canonical-energy-fact"],
      trust: "authoritative",
      warnings: [],
      ...(this.context.dataSnapshotId ? { snapshotId: this.context.dataSnapshotId } : {}),
      provider: "energyiq",
      mode: "live",
      datasourceRevision: request.datasourceRevision
    };
  }
}
