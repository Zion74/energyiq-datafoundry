import type { AgentEnergyQueryContext } from "../types.js";
import type { TrustedEnergyTextQueryContract } from "./trusted-energy-text.js";
import type { SemanticRequest, SemanticResolution } from "./types.js";

/**
 * Project the server-authoritative Energy Query Context into the protocol's
 * semantic boundary. It does not infer business meaning or replace DataLink;
 * it only certifies the already scoped canonical energy fact view.
 */
export class EnergyQuerySemanticProvider {
  readonly id = "energyiq" as const;

  constructor(private readonly context: AgentEnergyQueryContext | TrustedEnergyTextQueryContract) {}

  async resolve(request: SemanticRequest): Promise<SemanticResolution> {
    if (isTrustedTextContract(this.context)) {
      return resolveTrustedTextContext(this.context, request);
    }
    const context = this.context;
    return {
      value: {
        physicalSchema: request.physicalSchema,
        project: {
          id: context.projectId,
          name: context.projectName
        },
        scope: {
          id: context.scopeId,
          name: context.scopeName,
          type: context.scopeType
        },
        resource: context.resource,
        period: {
          label: context.period,
          from: context.from,
          to: context.to,
          endExclusive: true,
          timezone: context.timezone
        },
        ...(context.metricVersion ? { metricVersion: context.metricVersion } : {})
      },
      capabilities: ["physical-schema", "energy-query-context", "canonical-energy-fact"],
      trust: "authoritative",
      warnings: [],
      ...(context.dataSnapshotId ? { snapshotId: context.dataSnapshotId } : {}),
      provider: "energyiq",
      mode: "live",
      datasourceRevision: request.datasourceRevision
    };
  }
}

function isTrustedTextContract(
  context: AgentEnergyQueryContext | TrustedEnergyTextQueryContract
): context is TrustedEnergyTextQueryContract {
  return "kind" in context && context.kind === "trusted-energy-text-query";
}

const resolveTrustedTextContext = (
  contract: TrustedEnergyTextQueryContract,
  request: SemanticRequest
): SemanticResolution => ({
  value: {
    physicalSchema: request.physicalSchema,
    project: contract.pins.project,
    scope: contract.pins.scope,
    period: {
      label: contract.pins.period.label,
      from: contract.pins.period.start,
      to: contract.pins.period.endExclusive,
      endExclusive: true,
      timezone: contract.pins.period.timezone
    },
    metric: contract.pins.metric,
    dataAsOf: contract.pins.dataAsOf,
    evidenceRefs: contract.pins.evidenceRefs,
    trustedTextQuery: {
      id: contract.id,
      intent: contract.intent,
      selector: contract.selector
    }
  },
  capabilities: [
    "physical-schema",
    "energy-query-context",
    "canonical-energy-fact",
    "trusted-energy-text"
  ],
  trust: "authoritative",
  warnings: [],
  snapshotId: contract.pins.dataSnapshotId,
  provider: "energyiq",
  mode: "live",
  datasourceRevision: request.datasourceRevision
});
