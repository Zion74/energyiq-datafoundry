import type {
  EnergyProjectAnalysisSnapshotDto,
  EnergySavedAnalysisAiArtifactInputDto,
  PreschoolOverviewAiReadModelDto,
} from "../../../lib/config-api";
import { configApi, type EnergyProjectOverviewAiReadModelDto } from "../../../lib/config-api";
import type { PreschoolAiRunResult } from "./preschool-ai-run";

export async function runSavedAnalysisAiForSnapshot(
  snapshot: EnergyProjectAnalysisSnapshotDto,
): Promise<EnergySavedAnalysisAiArtifactInputDto | null> {
  if (snapshot.renderer.key === "ngee-ann-overview") {
    const result = await configApi.getEnergyProjectOverviewAiReadModel(
      snapshot.context.projectId,
      snapshot.context.scopeId,
    );
    if (!isExactTerminalNgeeAnnReadModel(result, snapshot)) return null;
    return {
      contract: "energyiq-saved-ai-result@3",
      rendererKey: "ngee-ann-overview",
      snapshotId: snapshot.dataSnapshot.id,
      projectReleaseId: snapshot.projectRelease.id,
      result,
    };
  }

  if (snapshot.renderer.key === "preschool-overview") {
    const { buildPreschoolAiRunInput, getOrStartPreschoolAiRun } = await import("./preschool-ai-run");
    const input = buildPreschoolAiRunInput(snapshot);
    if (!input) return null;
    const result = await getOrStartPreschoolAiRun(input);
    if (result.status !== "available") return null;
    if (isPreschoolSectionedSavedResult(result)) {
      return {
        contract: "energyiq-saved-ai-result@2",
        rendererKey: "preschool-overview",
        snapshotId: snapshot.dataSnapshot.id,
        projectReleaseId: snapshot.projectRelease.id,
        result,
      };
    }
    return {
      contract: "energyiq-saved-ai-result@1",
      rendererKey: "preschool-overview",
      snapshotId: snapshot.dataSnapshot.id,
      projectReleaseId: snapshot.projectRelease.id,
      result,
    };
  }

  return null;
}

const isPreschoolSectionedSavedResult = (
  value: PreschoolAiRunResult,
): value is PreschoolOverviewAiReadModelDto => value.status === "available"
  && "artifactKind" in value
  && value.artifactKind === "preschool-overview-ai-read-model";

const isExactTerminalNgeeAnnReadModel = (
  value: EnergyProjectOverviewAiReadModelDto,
  snapshot: EnergyProjectAnalysisSnapshotDto,
): boolean => value.contract === "energyiq-project-overview-ai-read-model@1"
  && value.rendererKey === "ngee-ann-overview"
  && value.binding.workspaceId === snapshot.context.workspaceId
  && value.binding.projectId === snapshot.context.projectId
  && value.binding.scopeId === snapshot.context.scopeId
  && value.binding.dataSnapshotId === snapshot.dataSnapshot.id
  && value.binding.projectReleaseId === snapshot.projectRelease.id
  && value.binding.analysisPeriod.from === snapshot.context.primaryPeriod.start
  && value.binding.analysisPeriod.to === snapshot.context.primaryPeriod.endExclusive
  && [
    value.keyFindings,
    value.sections["trend-and-demand"],
    value.sections["time-behaviour"],
    value.sections["circuit-concentration"],
    value.sections["decision-priorities"],
    value.additionalInsights,
  ].every((unit) => unit !== undefined && terminal(unit.status));

const terminal = (status: string): boolean => status === "available"
  || status === "empty"
  || status === "failed"
  || status === "unavailable";
