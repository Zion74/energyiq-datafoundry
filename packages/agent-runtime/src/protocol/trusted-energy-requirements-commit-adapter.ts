import type { AnalysisRequirement } from "./analysis-requirements.js";
import type { AnalysisScalar } from "./analysis-contract.js";

export type TrustedEnergyCommitClaim = {
  requirement_id: string;
  claim: string;
  values?: Array<{
    name: string;
    value: AnalysisScalar;
    unit?: string | undefined;
  }> | undefined;
  evidence_refs?: string[] | undefined;
  evidence_requirement_ids?: string[] | undefined;
};

export type TrustedEnergyRequirementsCommitInput = {
  claims: TrustedEnergyCommitClaim[];
};

/**
 * Reconcile model-shaped commit input with the server-owned requirement registry.
 * The old global fallback kept invented values whenever any other requirement had
 * declared values; normalizing per requirement prevents that mismatch/retry loop.
 */
export const adaptTrustedEnergyRequirementsCommit = (
  input: TrustedEnergyRequirementsCommitInput,
  requirements: AnalysisRequirement[]
): TrustedEnergyRequirementsCommitInput => {
  const requirementsById = new Map(requirements.map((requirement) => [requirement.id, requirement]));
  return {
    claims: input.claims.map((claim) => {
      const requirement = requirementsById.get(claim.requirement_id);
      if (!requirement || requirement.source !== "user") {
        throw new Error(`TRUSTED_ENERGY_REQUIREMENT_NOT_FOUND:${claim.requirement_id}`);
      }
      for (const evidenceRequirementId of claim.evidence_requirement_ids ?? []) {
        const evidenceRequirement = requirementsById.get(evidenceRequirementId);
        if (!evidenceRequirement || evidenceRequirement.source !== "user") {
          throw new Error(`TRUSTED_ENERGY_EVIDENCE_REQUIREMENT_NOT_FOUND:${evidenceRequirementId}`);
        }
      }
      const declaredValueNames = new Set(requirement.assertions.flatMap((assertion) =>
        assertion.claimValues.map((value) => value.name)));
      const values = (claim.values ?? []).filter((value) => declaredValueNames.has(value.name));
      return {
        requirement_id: claim.requirement_id,
        claim: claim.claim,
        ...(values.length > 0 ? { values: structuredClone(values) } : {}),
        ...(claim.evidence_refs && claim.evidence_refs.length > 0
          ? { evidence_refs: [...claim.evidence_refs] }
          : {}),
        ...(claim.evidence_requirement_ids && claim.evidence_requirement_ids.length > 0
          ? { evidence_requirement_ids: [...claim.evidence_requirement_ids] }
          : {})
      };
    })
  };
};
