/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PreschoolAdditionalMethodProposalAdmin } from "./preschool-additional-method-proposal-admin";

describe("PreschoolAdditionalMethodProposalAdmin", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("loads proposals and performs only explicit revision-bound approve and publish actions", async () => {
    const proposals = [
      proposal({ id: "proposal-review", status: "in-review", revision: 2 }),
      proposal({ id: "proposal-approved", status: "approved", revision: 3 }),
    ];
    const client = {
      listProposals: vi.fn().mockResolvedValue(proposals),
      transitionProposal: vi.fn(async (input: { proposalId: string; action: string }) => proposal({
        id: input.proposalId,
        status: input.action === "approve" ? "approved" : "published",
        revision: input.action === "approve" ? 3 : 4,
      })),
    };

    await act(async () => root.render(
      <PreschoolAdditionalMethodProposalAdmin projectId="preschool-demo" client={client} />,
    ));
    await act(async () => undefined);

    expect(container.textContent).toContain("Repeated event shape");
    const approve = [...container.querySelectorAll("button")].find((button) => button.textContent === "Approve");
    const publish = [...container.querySelectorAll("button")].find((button) => button.textContent === "Publish");
    await act(async () => approve!.click());
    await act(async () => publish!.click());

    expect(client.transitionProposal).toHaveBeenNthCalledWith(1, {
      projectId: "preschool-demo",
      proposalId: "proposal-review",
      action: "approve",
      expectedRevision: 2,
    });
    expect(client.transitionProposal).toHaveBeenNthCalledWith(2, {
      projectId: "preschool-demo",
      proposalId: "proposal-approved",
      action: "publish",
      expectedRevision: 3,
    });
    expect(container.textContent).toContain("Proposal updated");
  });

  it("shows loading and local transition errors without claiming publication", async () => {
    let resolveList!: (value: ReturnType<typeof proposal>[]) => void;
    const client = {
      listProposals: vi.fn(() => new Promise<ReturnType<typeof proposal>[]>((resolve) => { resolveList = resolve; })),
      transitionProposal: vi.fn().mockRejectedValue(new Error("conflict")),
    };
    await act(async () => root.render(
      <PreschoolAdditionalMethodProposalAdmin projectId="preschool-demo" client={client} />,
    ));
    expect(container.textContent).toContain("Loading Method proposals");
    await act(async () => resolveList([proposal({ id: "proposal-review", status: "in-review", revision: 2 })]));
    const approve = [...container.querySelectorAll("button")].find((button) => button.textContent === "Approve");
    await act(async () => approve!.click());
    expect(container.textContent).toContain("Proposal could not be updated");
    expect(container.textContent).not.toContain("Published automatically");
  });
});

function proposal(input: { id: string; status: "in-review" | "approved" | "published"; revision: number }) {
  return {
    id: input.id,
    workspaceId: "preschool-demo-org",
    projectId: "preschool-demo",
    scopeId: "preschool-project",
    artifactId: "additional-current-v2",
    findingId: "additional:candidate-counter-pattern",
    createdBy: "member-user",
    title: "Repeated event shape",
    guidance: "Compare recurring event timing before treating one spike as reusable.",
    status: input.status,
    revision: input.revision,
    createdAt: "2026-08-14T01:00:00.000Z",
    updatedAt: "2026-08-14T02:00:00.000Z",
    audit: [],
  } as const;
}
