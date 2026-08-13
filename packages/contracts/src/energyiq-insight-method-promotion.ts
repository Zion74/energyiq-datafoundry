import {
  insightMethodRevisionRefIsValid,
  sameInsightMethodRevision,
  type InsightMethodRevisionRef,
} from "./energyiq-autonomous-insights.js";

export type InsightMethodPromotionStatus =
  | "provisional"
  | "in-review"
  | "approved"
  | "published"
  | "rejected"
  | "superseded";

export type InsightMethodPromotionTarget = {
  scope: "platform" | "user" | "workspace";
  workspaceId: string;
  userId: string;
};

export type InsightMethodFeedback = {
  id: string;
  rating: "useful" | "not-useful";
  actorId: string;
  artifactId: string;
  findingId: string;
  recordedAt: string;
};

export type InsightMethodProposal = {
  id: string;
  target: InsightMethodPromotionTarget;
  source: {
    artifactId: string;
    findingId: string;
  };
  status: InsightMethodPromotionStatus;
  feedback: readonly InsightMethodFeedback[];
  reviewSubmission?: {
    actorId: string;
    submittedAt: string;
  };
  approval?: {
    actorId: string;
    approvedAt: string;
  };
  publication?: {
    actorId: string;
    publishedAt: string;
    method: InsightMethodRevisionRef;
  };
};

export type InsightMethodReviewSubmission = {
  actorId: string;
  submittedAt: string;
};

export type InsightMethodApproval = {
  actorId: string;
  approvedAt: string;
};

export type InsightMethodPublication = {
  actorId: string;
  publishedAt: string;
  method: InsightMethodRevisionRef;
};

export type InsightMethodSelectionCandidate =
  | {
    source: "builtin-catalog";
    method: InsightMethodRevisionRef;
  }
  | {
    source: "published-proposal";
    proposal: InsightMethodProposal;
  };

export type InsightMethodSelectionContext =
  | {
    surface: "shared-overview";
    executionWorkspaceId: string;
    viewerUserId: string;
    expectedMethod: InsightMethodRevisionRef;
  }
  | {
    surface: "private-analysis";
    executionWorkspaceId: string;
    executionUserId: string;
    expectedMethod: InsightMethodRevisionRef;
  };

const nonEmpty = (value: string): boolean => /\S/.test(value);

const assertActorStamp = (actorId: string, timestamp: string): void => {
  if (!nonEmpty(actorId) || !nonEmpty(timestamp)) {
    throw new Error("INSIGHT_METHOD_AUDIT_STAMP_REQUIRED");
  }
};

const expectedMethodScope = (
  targetScope: InsightMethodPromotionTarget["scope"],
): InsightMethodRevisionRef["scope"] => targetScope === "platform" ? "builtin" : targetScope;

const methodMatchesTarget = (
  target: InsightMethodPromotionTarget,
  method: InsightMethodRevisionRef,
): boolean => method.scope === expectedMethodScope(target.scope)
  && method.workspaceId === target.workspaceId
  && method.userId === target.userId;

export const recordInsightMethodFeedback = (
  proposal: InsightMethodProposal,
  feedback: InsightMethodFeedback,
): InsightMethodProposal => {
  assertActorStamp(feedback.actorId, feedback.recordedAt);
  if (!nonEmpty(feedback.id)
    || feedback.artifactId !== proposal.source.artifactId
    || feedback.findingId !== proposal.source.findingId) {
    throw new Error("INSIGHT_METHOD_FEEDBACK_SOURCE_MISMATCH");
  }
  if (proposal.feedback.some((entry) => entry.id === feedback.id)) {
    return proposal;
  }

  // Feedback is evidence for review. It never promotes or publishes by itself.
  return {
    ...proposal,
    feedback: [...proposal.feedback, feedback],
  };
};

export const submitInsightMethodProposalForReview = (
  proposal: InsightMethodProposal,
  submission: InsightMethodReviewSubmission,
): InsightMethodProposal => {
  if (proposal.status !== "provisional") {
    throw new Error("INSIGHT_METHOD_NOT_PROVISIONAL");
  }
  assertActorStamp(submission.actorId, submission.submittedAt);
  return {
    ...proposal,
    status: "in-review",
    reviewSubmission: submission,
  };
};

export const approveInsightMethodProposal = (
  proposal: InsightMethodProposal,
  approval: InsightMethodApproval,
): InsightMethodProposal => {
  if (proposal.status !== "in-review" || !proposal.reviewSubmission) {
    throw new Error("INSIGHT_METHOD_NOT_IN_REVIEW");
  }
  assertActorStamp(approval.actorId, approval.approvedAt);
  return {
    ...proposal,
    status: "approved",
    approval,
  };
};

export const publishApprovedInsightMethodProposal = (
  proposal: InsightMethodProposal,
  publication: InsightMethodPublication,
): InsightMethodProposal => {
  if (proposal.status !== "approved" || !proposal.reviewSubmission || !proposal.approval) {
    throw new Error("INSIGHT_METHOD_NOT_APPROVED");
  }
  if (proposal.target.scope === "platform") {
    throw new Error("INSIGHT_METHOD_PLATFORM_PUBLICATION_UNSUPPORTED");
  }
  assertActorStamp(publication.actorId, publication.publishedAt);
  if (!insightMethodRevisionRefIsValid(publication.method)
    || publication.method.role !== "expert-direction") {
    throw new Error("INSIGHT_METHOD_PUBLISHED_REVISION_INVALID");
  }
  if (!methodMatchesTarget(proposal.target, publication.method)) {
    throw new Error("INSIGHT_METHOD_TARGET_SCOPE_MISMATCH");
  }
  return {
    ...proposal,
    status: "published",
    publication,
  };
};

const publishedProposalMethod = (
  proposal: InsightMethodProposal,
): InsightMethodRevisionRef | undefined => {
  if (proposal.status !== "published"
    || proposal.target.scope === "platform"
    || proposal.reviewSubmission === undefined
    || proposal.approval === undefined
    || proposal.publication === undefined
    || !insightMethodRevisionRefIsValid(proposal.publication.method)
    || proposal.publication.method.role !== "expert-direction"
    || !methodMatchesTarget(proposal.target, proposal.publication.method)) {
    return undefined;
  }
  return proposal.publication.method;
};

const candidateMethod = (
  candidate: InsightMethodSelectionCandidate,
): InsightMethodRevisionRef | undefined => {
  if (candidate.source === "builtin-catalog") {
    return insightMethodRevisionRefIsValid(candidate.method) && candidate.method.scope === "builtin"
      ? candidate.method
      : undefined;
  }
  return publishedProposalMethod(candidate.proposal);
};

/**
 * Surface-specific selection gate. Publication alone never implies that a Skill
 * may run on a shared surface.
 */
export const insightMethodIsSelectableForSurface = (
  candidate: InsightMethodSelectionCandidate,
  context: InsightMethodSelectionContext,
): boolean => {
  const method = candidateMethod(candidate);
  if (!method || !sameInsightMethodRevision(method, context.expectedMethod)) {
    return false;
  }

  if (context.surface === "shared-overview") {
    if (method.scope === "builtin") {
      return true;
    }
    return method.scope === "workspace"
      && method.workspaceId === context.executionWorkspaceId;
  }

  if (method.scope === "builtin") {
    return true;
  }
  if (method.workspaceId !== context.executionWorkspaceId) {
    return false;
  }
  return method.scope === "workspace" || method.userId === context.executionUserId;
};
