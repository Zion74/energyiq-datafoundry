import {
  selectPreschoolAiSectionInterpretation,
  type PreschoolAiArtifactBinding,
  type PreschoolAiEpistemicLevel,
} from "./preschool-ai-artifact";

export type PreschoolSectionInterpretationView =
  | ({
      status: "available";
      headline: string;
      summary: string;
      actions?: string[];
      epistemicLevel?: PreschoolAiEpistemicLevel;
    } & PreschoolSectionInterpretationIdentity)
  | ({ status: "pending" } & PreschoolSectionInterpretationIdentity)
  | {
      status: "unavailable";
      detail?: string;
    };

type PreschoolSectionInterpretationIdentity = {
  dataSnapshotId: string;
  projectReleaseId: string;
  period: {
    start: string;
    endExclusive: string;
  };
};

export function adaptPreschoolAiArtifactToSectionInterpretation(input: {
  candidate: unknown;
  expected: PreschoolAiArtifactBinding | null;
  target: "preschool.benchmark" | "preschool.standby";
  mode: "live" | "saved";
}): PreschoolSectionInterpretationView {
  if (!input.expected) {
    return { status: "unavailable", detail: "This Snapshot does not expose the trusted inputs required for AI interpretation." };
  }
  const identity = routeAIdentity(input.expected);
  const selected = selectPreschoolAiSectionInterpretation(input.candidate, input.expected, input.target);
  if (selected.status === "preparing") {
    return input.mode === "live"
      ? { status: "pending", ...identity }
      : { status: "unavailable", detail: "No completed AI interpretation was saved for this section." };
  }
  if (selected.status === "unavailable") {
    return { status: "unavailable", detail: selected.reason };
  }
  const finding = selected.findings[0];
  if (!finding) {
    return {
      status: "unavailable",
      detail: "The AI run did not identify a distinct insight for this section in the current Snapshot.",
    };
  }
  const summary = [finding.takeaway, finding.interpretation]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ");
  const actions = [finding.action, finding.verification]
    .filter((value): value is string => Boolean(value?.trim()));
  return {
    status: "available",
    ...identity,
    headline: finding.title,
    summary,
    ...(actions.length > 0 ? { actions } : {}),
    epistemicLevel: finding.epistemicLevel,
  };
}

function routeAIdentity(binding: PreschoolAiArtifactBinding): PreschoolSectionInterpretationIdentity {
  return {
    dataSnapshotId: binding.dataSnapshotId,
    projectReleaseId: binding.projectReleaseId,
    period: {
      start: binding.analysisPeriod.from,
      endExclusive: binding.analysisPeriod.to,
    },
  };
}
