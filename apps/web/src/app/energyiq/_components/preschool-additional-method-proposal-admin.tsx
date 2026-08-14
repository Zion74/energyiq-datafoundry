"use client";

import React, { useEffect, useState } from "react";

import {
  configApi,
  type EnergyInsightMethodProposalDto,
} from "../../../lib/config-api";

export type PreschoolAdditionalMethodProposalAdminClient = {
  listProposals(projectId: string): Promise<EnergyInsightMethodProposalDto[]>;
  transitionProposal(input: {
    projectId: string;
    proposalId: string;
    action: "approve" | "publish";
    expectedRevision: number;
  }): Promise<EnergyInsightMethodProposalDto>;
};

const configApiProposalClient: PreschoolAdditionalMethodProposalAdminClient = {
  listProposals: (projectId) => configApi.listEnergyInsightMethodProposals(projectId)
    .then(({ proposals }) => proposals),
  transitionProposal: ({ projectId, proposalId, action, expectedRevision }) =>
    configApi.transitionEnergyInsightMethodProposal(projectId, proposalId, action, expectedRevision),
};

export function PreschoolAdditionalMethodProposalAdmin({
  projectId,
  client = configApiProposalClient,
}: {
  projectId: string;
  client?: PreschoolAdditionalMethodProposalAdminClient;
}) {
  const [proposals, setProposals] = useState<EnergyInsightMethodProposalDto[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "updated" | "error">("loading");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setState("loading");
    void client.listProposals(projectId).then((loaded) => {
      if (!active) return;
      setProposals(loaded);
      setState("ready");
    }).catch(() => {
      if (active) setState("error");
    });
    return () => { active = false; };
  }, [client, projectId]);

  const transition = async (
    proposal: EnergyInsightMethodProposalDto,
    action: "approve" | "publish",
  ) => {
    setUpdatingId(proposal.id);
    setState("ready");
    try {
      const updated = await client.transitionProposal({
        projectId,
        proposalId: proposal.id,
        action,
        expectedRevision: proposal.revision,
      });
      setProposals((current) => current.map((item) => item.id === updated.id ? updated : item));
      setState("updated");
    } catch {
      setState("error");
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <section aria-labelledby="additional-method-proposals-heading" className="space-y-4">
      <div>
        <h2 id="additional-method-proposals-heading" className="text-lg font-semibold text-foreground">
          Additional Insight Method proposals
        </h2>
        <p className="mt-1 text-sm text-muted">
          Human review is required. Feedback and vote totals never approve or publish a Method automatically.
        </p>
      </div>
      {state === "loading" ? <p role="status" className="text-sm text-muted">Loading Method proposals…</p> : null}
      {state === "error" ? <p role="alert" className="text-sm text-step-error">Proposal could not be updated. Refresh before retrying.</p> : null}
      {state === "updated" ? <p role="status" className="text-sm text-step-success">Proposal updated</p> : null}
      {state !== "loading" && proposals.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface-subtle p-4 text-sm text-muted">No Method proposals are awaiting review.</p>
      ) : null}
      <div className="space-y-3">
        {proposals.map((proposal) => {
          const action = proposal.status === "in-review"
            ? "approve" as const
            : proposal.status === "approved"
              ? "publish" as const
              : null;
          return (
            <article key={proposal.id} className="rounded-lg border border-border bg-surface p-4" data-method-proposal={proposal.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="max-w-[75ch]">
                  <h3 className="font-semibold text-foreground">{proposal.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted">{proposal.guidance}</p>
                  <p className="mt-2 text-xs text-muted">Status: {proposal.status} · Revision {proposal.revision}</p>
                </div>
                {action ? (
                  <button
                    type="button"
                    disabled={updatingId !== null}
                    onClick={() => void transition(proposal, action)}
                    className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {action === "approve" ? "Approve" : "Publish"}
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
