import { describe, expect, it } from "vitest";

import type { InsightMethodRevisionRef } from "./energyiq-autonomous-insights.js";
import {
  approveInsightMethodProposal,
  insightMethodIsSelectableForSurface,
  publishApprovedInsightMethodProposal,
  recordInsightMethodFeedback,
  submitInsightMethodProposalForReview,
  type InsightMethodProposal,
  type InsightMethodSelectionContext,
} from "./energyiq-insight-method-promotion.js";

const provisionalProposal = (): InsightMethodProposal => ({
  id: "method-proposal:closed-hours-event-shape",
  target: {
    scope: "workspace",
    workspaceId: "workspace-singapore-preschool",
    userId: "user-charles",
  },
  source: {
    artifactId: "overview-artifact:2026-05",
    findingId: "finding:closed-hours-event-shape",
  },
  status: "provisional",
  feedback: [],
});

const publishedMethod: InsightMethodRevisionRef = {
  skillId: "closed-hours-event-shape",
  semanticVersion: "1.0.0",
  resourceId: "config-resource:closed-hours-event-shape",
  resourceRevision: 1,
  contentSha256: "d".repeat(64),
  scope: "workspace",
  workspaceId: "workspace-singapore-preschool",
  userId: "user-charles",
  role: "expert-direction",
};

const sharedOverviewContext = (
  expectedMethod: InsightMethodRevisionRef,
  viewerUserId = "viewer:one",
): InsightMethodSelectionContext => ({
  surface: "shared-overview",
  executionWorkspaceId: "workspace-singapore-preschool",
  viewerUserId,
  expectedMethod,
});

const privateAnalysisContext = (
  expectedMethod: InsightMethodRevisionRef,
  executionWorkspaceId = "workspace-singapore-preschool",
  executionUserId = "user-charles",
): InsightMethodSelectionContext => ({
  surface: "private-analysis",
  executionWorkspaceId,
  executionUserId,
  expectedMethod,
});

describe("EnergyIQ insight method promotion", () => {
  it("keeps a provisional pattern out of production selection after one Useful feedback", () => {
    const proposal = provisionalProposal();

    expect(insightMethodIsSelectableForSurface(
      { source: "published-proposal", proposal },
      sharedOverviewContext(publishedMethod),
    )).toBe(false);

    const withUsefulFeedback = recordInsightMethodFeedback(proposal, {
      id: "feedback:1",
      rating: "useful",
      actorId: "operator:charles",
      artifactId: proposal.source.artifactId,
      findingId: proposal.source.findingId,
      recordedAt: "2026-08-13T08:45:00.000Z",
    });

    expect(withUsefulFeedback.status).toBe("provisional");
    expect(withUsefulFeedback.feedback).toHaveLength(1);
    expect(insightMethodIsSelectableForSurface(
      { source: "published-proposal", proposal: withUsefulFeedback },
      sharedOverviewContext(publishedMethod),
    )).toBe(false);
  });

  it("requires explicit review, approval and publication before production selection", () => {
    const proposal = provisionalProposal();

    expect(() => publishApprovedInsightMethodProposal(proposal, {
      actorId: "admin:publisher",
      publishedAt: "2026-08-13T09:00:00.000Z",
      method: publishedMethod,
    })).toThrow("INSIGHT_METHOD_NOT_APPROVED");

    const inReview = submitInsightMethodProposalForReview(proposal, {
      actorId: "operator:charles",
      submittedAt: "2026-08-13T08:50:00.000Z",
    });
    const approved = approveInsightMethodProposal(inReview, {
      actorId: "reviewer:energy-expert",
      approvedAt: "2026-08-13T08:55:00.000Z",
    });

    expect(approved.status).toBe("approved");
    expect(insightMethodIsSelectableForSurface(
      { source: "published-proposal", proposal: approved },
      sharedOverviewContext(publishedMethod),
    )).toBe(false);

    const published = publishApprovedInsightMethodProposal(approved, {
      actorId: "admin:publisher",
      publishedAt: "2026-08-13T09:00:00.000Z",
      method: publishedMethod,
    });

    expect(published.status).toBe("published");
    expect(insightMethodIsSelectableForSurface(
      { source: "published-proposal", proposal: published },
      sharedOverviewContext(publishedMethod),
    )).toBe(true);
  });

  it("does not publish a Skill into another tenant's scope", () => {
    const approved = approveInsightMethodProposal(
      submitInsightMethodProposalForReview(provisionalProposal(), {
        actorId: "operator:charles",
        submittedAt: "2026-08-13T08:50:00.000Z",
      }),
      {
        actorId: "reviewer:energy-expert",
        approvedAt: "2026-08-13T08:55:00.000Z",
      },
    );

    expect(() => publishApprovedInsightMethodProposal(approved, {
      actorId: "admin:publisher",
      publishedAt: "2026-08-13T09:00:00.000Z",
      method: { ...publishedMethod, workspaceId: "workspace-other-customer" },
    })).toThrow("INSIGHT_METHOD_TARGET_SCOPE_MISMATCH");
  });

  it("rejects automatic platform publication from the proposal workflow", () => {
    const proposal: InsightMethodProposal = {
      ...provisionalProposal(),
      target: {
        scope: "platform",
        workspaceId: "workspace-system",
        userId: "user-system",
      },
    };
    const approved = approveInsightMethodProposal(
      submitInsightMethodProposalForReview(proposal, {
        actorId: "operator:charles",
        submittedAt: "2026-08-13T08:50:00.000Z",
      }),
      {
        actorId: "reviewer:energy-expert",
        approvedAt: "2026-08-13T08:55:00.000Z",
      },
    );

    expect(() => publishApprovedInsightMethodProposal(approved, {
      actorId: "admin:publisher",
      publishedAt: "2026-08-13T09:00:00.000Z",
      method: {
        ...publishedMethod,
        scope: "builtin",
        workspaceId: "workspace-system",
        userId: "user-system",
      },
    })).toThrow("INSIGHT_METHOD_PLATFORM_PUBLICATION_UNSUPPORTED");
  });
});

describe("EnergyIQ insight method surface selection", () => {
  it("keeps a published user Skill out of the shared Overview", () => {
    const userMethod: InsightMethodRevisionRef = {
      ...publishedMethod,
      scope: "user",
    };
    const proposal: InsightMethodProposal = {
      ...provisionalProposal(),
      target: {
        scope: "user",
        workspaceId: userMethod.workspaceId,
        userId: userMethod.userId,
      },
    };
    const approved = approveInsightMethodProposal(
      submitInsightMethodProposalForReview(proposal, {
        actorId: "operator:charles",
        submittedAt: "2026-08-13T08:50:00.000Z",
      }),
      {
        actorId: "reviewer:energy-expert",
        approvedAt: "2026-08-13T08:55:00.000Z",
      },
    );
    const published = publishApprovedInsightMethodProposal(approved, {
      actorId: "admin:publisher",
      publishedAt: "2026-08-13T09:00:00.000Z",
      method: userMethod,
    });

    expect(insightMethodIsSelectableForSurface(
      { source: "published-proposal", proposal: published },
      sharedOverviewContext(userMethod),
    )).toBe(false);
  });

  it("allows that user Skill in private analysis only for the exact execution workspace and user", () => {
    const userMethod: InsightMethodRevisionRef = { ...publishedMethod, scope: "user" };
    const approved = approveInsightMethodProposal(
      submitInsightMethodProposalForReview({
        ...provisionalProposal(),
        target: {
          scope: "user",
          workspaceId: userMethod.workspaceId,
          userId: userMethod.userId,
        },
      }, {
        actorId: "operator:charles",
        submittedAt: "2026-08-13T08:50:00.000Z",
      }),
      {
        actorId: "reviewer:energy-expert",
        approvedAt: "2026-08-13T08:55:00.000Z",
      },
    );
    const published = publishApprovedInsightMethodProposal(approved, {
      actorId: "admin:publisher",
      publishedAt: "2026-08-13T09:00:00.000Z",
      method: userMethod,
    });
    const candidate = { source: "published-proposal" as const, proposal: published };

    expect(insightMethodIsSelectableForSurface(
      candidate,
      privateAnalysisContext(userMethod),
    )).toBe(true);
    expect(insightMethodIsSelectableForSurface(
      candidate,
      privateAnalysisContext(userMethod, "workspace-other-customer", userMethod.userId),
    )).toBe(false);
    expect(insightMethodIsSelectableForSurface(
      candidate,
      privateAnalysisContext(userMethod, userMethod.workspaceId, "user-other"),
    )).toBe(false);
  });

  it("selects a workspace Skill for shared Overview by execution workspace, not viewer user", () => {
    const approved = approveInsightMethodProposal(
      submitInsightMethodProposalForReview(provisionalProposal(), {
        actorId: "operator:charles",
        submittedAt: "2026-08-13T08:50:00.000Z",
      }),
      {
        actorId: "reviewer:energy-expert",
        approvedAt: "2026-08-13T08:55:00.000Z",
      },
    );
    const published = publishApprovedInsightMethodProposal(approved, {
      actorId: "admin:publisher",
      publishedAt: "2026-08-13T09:00:00.000Z",
      method: publishedMethod,
    });
    const candidate = { source: "published-proposal" as const, proposal: published };

    expect(insightMethodIsSelectableForSurface(
      candidate,
      sharedOverviewContext(publishedMethod, "viewer:one"),
    )).toBe(true);
    expect(insightMethodIsSelectableForSurface(
      candidate,
      sharedOverviewContext(publishedMethod, "viewer:two"),
    )).toBe(true);
    expect(insightMethodIsSelectableForSurface(candidate, {
      ...sharedOverviewContext(publishedMethod),
      executionWorkspaceId: "workspace-other-customer",
    })).toBe(false);
  });

  it("allows an exact builtin catalog revision on shared Overview and rejects revision or SHA drift", () => {
    const builtinMethod: InsightMethodRevisionRef = {
      ...publishedMethod,
      skillId: "energy-insight-investigation",
      resourceId: "config-resource:energy-insight-investigation",
      scope: "builtin",
      workspaceId: "workspace-system",
      userId: "user-system",
      role: "core-method",
    };
    const candidate = { source: "builtin-catalog" as const, method: builtinMethod };

    expect(insightMethodIsSelectableForSurface(
      candidate,
      sharedOverviewContext(builtinMethod),
    )).toBe(true);
    expect(insightMethodIsSelectableForSurface(candidate, sharedOverviewContext({
      ...builtinMethod,
      resourceRevision: builtinMethod.resourceRevision + 1,
    }))).toBe(false);
    expect(insightMethodIsSelectableForSurface(candidate, sharedOverviewContext({
      ...builtinMethod,
      contentSha256: "e".repeat(64),
    }))).toBe(false);
  });
});
