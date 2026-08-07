import type {
  EnergyProjectAnalysisSnapshotDto,
  EnergySavedAnalysisAiArtifactInputDto,
} from "../../../lib/config-api";

export async function runSavedAnalysisAiForSnapshot(
  snapshot: EnergyProjectAnalysisSnapshotDto,
): Promise<EnergySavedAnalysisAiArtifactInputDto | null> {
  if (snapshot.renderer.key === "ngee-ann-overview") {
    const [{ buildNgeeAnnOverviewViewModel }, { buildNgeeAnnAiRunInput, getOrStartNgeeAnnAiRun }] = await Promise.all([
      import("./ngee-ann-overview-view-model"),
      import("./ngee-ann-ai-run"),
    ]);
    const input = buildNgeeAnnAiRunInput(
      snapshot,
      buildNgeeAnnOverviewViewModel(snapshot).decisionPriorities,
    );
    if (!input) return null;
    const result = await getOrStartNgeeAnnAiRun(input);
    if (result.status !== "available") return null;
    return {
      contract: "energyiq-saved-ai-result@1",
      rendererKey: "ngee-ann-overview",
      snapshotId: snapshot.dataSnapshot.id,
      projectReleaseId: snapshot.projectRelease.id,
      result,
    };
  }

  if (snapshot.renderer.key === "preschool-overview") {
    const [{ buildPreschoolOverviewViewModel }, { buildPreschoolAiRunInput, getOrStartPreschoolAiRun }] = await Promise.all([
      import("./preschool-overview-view-model"),
      import("./preschool-ai-run"),
    ]);
    const input = buildPreschoolAiRunInput(
      snapshot,
      buildPreschoolOverviewViewModel(snapshot).decisionSummary,
    );
    if (!input) return null;
    const result = await getOrStartPreschoolAiRun(input);
    if (result.status !== "available") return null;
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
