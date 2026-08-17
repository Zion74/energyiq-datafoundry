import type {
  EnergyProjectAnalysisSnapshotDto,
  EnergySavedAnalysisAiArtifactInputDto,
  PreschoolOverviewAiReadModelDto,
} from "../../../lib/config-api";
import type { PreschoolAiRunResult } from "./preschool-ai-run";

export async function runSavedAnalysisAiForSnapshot(
  snapshot: EnergyProjectAnalysisSnapshotDto,
): Promise<EnergySavedAnalysisAiArtifactInputDto | null> {
  if (snapshot.renderer.key === "ngee-ann-overview") {
    // Ngee Ann live analysis now restores server-persisted Project artifacts.
    // Until Saved @2 accepts that exact read model, saving must not revive the
    // legacy browser runner or create Provider work as a side effect.
    return null;
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
