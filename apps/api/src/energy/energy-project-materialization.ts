import {
  ENERGY_FACT_WRITER_CONTRACT_VERSION,
  probeEnergyFactProjectStateForMaterialization,
  resolveEnergyFactStorePath,
  writeEnergyFactProjectMaterialization,
} from "@datafoundry/data-gateway";
import {
  activeEnergyIqImportBatches,
  resolveEnergyIqMaterializationBlockingReasons,
  resolveEnergyIqSnapshotFactScope,
  type EnergyIqDataSnapshotRecord,
  type EnergyIqImportBatchRecord,
  type EnergyIqProjectSetupDocument,
  type EnergyIqSnapshotFactScope,
} from "@datafoundry/metadata";

import type { ConfigApiContext } from "../routes/types.js";
import {
  buildEnergyExcelMaterialization,
  isEnergyImportMaterializationCurrent,
} from "./energy-import-materializer.js";

const projectMaterializationTails = new Map<string, Promise<void>>();

export const withEnergyProjectMaterializationLock = async <T>(
  workspaceId: string,
  projectId: string,
  action: () => Promise<T>,
): Promise<T> => {
  const key = `${workspaceId}\u0000${projectId}`;
  const predecessor = projectMaterializationTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const current = predecessor.catch(() => undefined).then(() => released);
  projectMaterializationTails.set(key, current);
  await predecessor.catch(() => undefined);
  try {
    return await action();
  } finally {
    release();
    if (projectMaterializationTails.get(key) === current) {
      projectMaterializationTails.delete(key);
    }
  }
};

export type EnergyProjectManifestMaterialization = {
  batch: EnergyIqImportBatchRecord;
  snapshot: EnergyIqDataSnapshotRecord;
  document: EnergyIqProjectSetupDocument;
  duplicate: boolean;
  timings?: EnergyProjectManifestMaterializationTimings;
};

export type EnergyProjectManifestMaterializationTimings = {
  parseNormalizeByBatch: Array<{ batchId: string; durationMs: number }>;
  sourceWriteByBatch: Array<{
    importBatchId: string;
    deleteExistingMs: number;
    historicalMappingMs: number;
    rawWriteMs: number;
    normalizedWriteMs: number;
    intervalWriteMs: number;
    qualityWriteMs: number;
    totalMs: number;
  }>;
  sourceWriteMs: number;
  canonicalRebuildMs: number;
  integrityAndCheckpointMs: number;
  totalMs: number;
};

export const materializeEnergyProjectManifest = async (input: {
  context: Required<ConfigApiContext>;
  userId: string;
  projectId: string;
  requestedBatchId: string;
  databasePath?: string;
}): Promise<EnergyProjectManifestMaterialization> => {
  const initialProject = input.context.metadataStore.energyIq.getProject(input.projectId);
  return withEnergyProjectMaterializationLock(
    initialProject.workspace_id,
    input.projectId,
    async () => {
      const totalStartedAt = performance.now();
      const project = input.context.metadataStore.energyIq.getProject(input.projectId);
      const draft = input.context.metadataStore.energyIq.projectSetup.getDraft({
        project_id: input.projectId,
        user_id: input.userId,
      });
      const registeredBatches = input.context.metadataStore.energyIq.listImportBatches(input.projectId);
      const sourceManifest = draft.document.source_manifest;
      if (!sourceManifest) {
        throw new Error("ENERGYIQ_IMPORT_MATERIALIZATION_NOT_READY:SOURCE_MANIFEST_REQUIRED");
      }
      const sourceSet = new Set(sourceManifest.source_sha256.map(normalizeSha));
      const batches = activeEnergyIqImportBatches(registeredBatches, draft.document)
        .sort((left, right) => left.source_sha256.localeCompare(right.source_sha256));
      if (batches.length !== sourceSet.size) {
        throw new Error("ENERGYIQ_SOURCE_MANIFEST_MISMATCH");
      }
      const blockingReasons = resolveEnergyIqMaterializationBlockingReasons({
        batches,
        document: draft.document,
      });
      if (blockingReasons.length > 0) {
        throw new Error(`ENERGYIQ_IMPORT_MATERIALIZATION_NOT_READY:${blockingReasons.join(",")}`);
      }
      const requestedBatch = batches.find((batch) => batch.id === input.requestedBatchId);
      if (!requestedBatch) throw new Error("ENERGYIQ_IMPORT_BATCH_NOT_PINNED");

      const databasePath = input.databasePath ?? resolveEnergyFactStorePath(project.workspace_id);
      const factState = await probeEnergyFactProjectStateForMaterialization({
        databasePath,
        projectId: input.projectId,
      });
      const factStateAheadOfMetadata = factState?.dataSnapshotId !== undefined
        && factState.dataSnapshotId !== project.data_snapshot_id;
      const currentSnapshot = input.context.metadataStore.energyIq.findCurrentDataSnapshot(input.projectId);
      if (factState && !currentSnapshot && !factStateAheadOfMetadata) {
        throw new Error(`ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE:${project.data_snapshot_id}`);
      }
      const allBatchesCurrent = batches.every((batch) => isEnergyImportMaterializationCurrent({
        batch,
        document: draft.document,
        timezone: draft.document.project.timezone,
      }));
      if (factState && currentSnapshot && allBatchesCurrent) {
        let expectedScope: EnergyIqSnapshotFactScope;
        try {
          expectedScope = resolveEnergyIqSnapshotFactScope(currentSnapshot);
        } catch {
          throw new Error(`ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE:${currentSnapshot.id}`);
        }
        if (isEnergyProjectFactStateCurrent({
          factState,
          snapshotScope: expectedScope,
          workspaceId: project.workspace_id,
          projectId: input.projectId,
          currentSourceManifestSha256: sourceManifest.source_sha256,
        })) {
          return {
            batch: requestedBatch,
            snapshot: currentSnapshot,
            document: draft.document,
            duplicate: true,
          };
        }
      }

      const materializations = await Promise.all(batches.map(async (batch) => {
        const parseNormalizeStartedAt = performance.now();
        if (batch.source_kind !== "excel" || !batch.file_asset_ref_id) {
          throw new Error(`ENERGYIQ_IMPORT_BATCH_INVALID:${batch.id}`);
        }
        const original = input.context.fileAssetService.readRef({
          user_id: batch.created_by,
          workspace_id: batch.workspace_id,
          id: batch.file_asset_ref_id,
        });
        return {
          batch,
          result: await buildEnergyExcelMaterialization({
            content: original.body,
            batch,
            document: draft.document,
            mappingRevision: draft.revision,
            timezone: draft.document.project.timezone,
          }),
          parseNormalizeMs: elapsedMs(parseNormalizeStartedAt),
        };
      }));
      const metadataMaterializations = materializations.map(({ batch, result }) => ({
        batch_id: batch.id,
        summary: result.summary,
      }));
      const prepared = input.context.metadataStore.energyIq.prepareProjectManifestMaterialization({
        project_id: input.projectId,
        materializations: metadataMaterializations,
        source_manifest_sha256: sourceManifest.source_sha256,
      });
      if (factStateAheadOfMetadata && factState) {
        if (factState.dataSnapshotId !== prepared.expected_snapshot_id) {
          throw new Error(`ENERGYIQ_SNAPSHOT_STALE:${factState.dataSnapshotId}`);
        }
        if (!isEnergyProjectFactStateCurrent({
          factState,
          snapshotScope: prepared.fact_scope,
          workspaceId: project.workspace_id,
          projectId: input.projectId,
          currentSourceManifestSha256: sourceManifest.source_sha256,
        })) {
          throw new Error(`ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE:${factState.dataSnapshotId}`);
        }
      }
      const persisted = await writeEnergyFactProjectMaterialization({
        databasePath,
        projectId: input.projectId,
        timezone: draft.document.project.timezone,
        expectedPreviousDataSnapshotId: prepared.expected_previous_snapshot_id,
        snapshotFactScope: prepared.fact_scope,
        batches: materializations.map(({ result }) => result.write),
      });
      const completed = input.context.metadataStore.energyIq.completeProjectManifestMaterialization({
        project_id: input.projectId,
        materializations: metadataMaterializations,
        project_audit: persisted.projectAudit,
        source_manifest_sha256: sourceManifest.source_sha256,
        expected_snapshot_id: prepared.expected_snapshot_id,
        expected_previous_snapshot_id: prepared.expected_previous_snapshot_id,
      });
      const completedBatch = completed.batches.find((batch) => batch.id === input.requestedBatchId);
      if (!completedBatch) throw new Error(`ENERGYIQ_IMPORT_BATCH_NOT_FOUND:${input.requestedBatchId}`);
      return {
        batch: completedBatch,
        snapshot: completed.snapshot,
        document: draft.document,
        duplicate: false,
        timings: {
          parseNormalizeByBatch: materializations.map(({ batch, parseNormalizeMs }) => ({
            batchId: batch.id,
            durationMs: parseNormalizeMs,
          })),
          ...persisted.timings,
          totalMs: elapsedMs(totalStartedAt),
        },
      };
    },
  );
};

const sameFactScope = (
  actual: {
    workspaceId: string;
    projectId: string;
    dataSnapshotId: string;
    manifestFingerprint: string;
    sourceSha256: string[];
  },
  expected: {
    workspaceId: string;
    projectId: string;
    dataSnapshotId: string;
    manifestFingerprint: string;
    sourceSha256: string[];
  },
): boolean => actual.workspaceId === expected.workspaceId
  && actual.projectId === expected.projectId
  && actual.dataSnapshotId === expected.dataSnapshotId
  && actual.manifestFingerprint === expected.manifestFingerprint
  && actual.sourceSha256.length === expected.sourceSha256.length
  && actual.sourceSha256.every((value, index) => normalizeSha(value) === normalizeSha(expected.sourceSha256[index] ?? ""));

export const isEnergyProjectFactStateCurrent = (input: {
  factState: {
    workspaceId: string;
    projectId: string;
    dataSnapshotId: string;
    manifestFingerprint: string;
    sourceSha256: string[];
    factWriterContractVersion: string;
  };
  snapshotScope: {
    workspaceId: string;
    projectId: string;
    dataSnapshotId: string;
    manifestFingerprint: string;
    sourceSha256: string[];
  };
  workspaceId: string;
  projectId: string;
  currentSourceManifestSha256: readonly string[];
}): boolean => input.snapshotScope.workspaceId === input.workspaceId
  && input.snapshotScope.projectId === input.projectId
  && input.factState.factWriterContractVersion === ENERGY_FACT_WRITER_CONTRACT_VERSION
  && sameFactScope(input.factState, input.snapshotScope)
  && sameSourceSet(input.snapshotScope.sourceSha256, input.currentSourceManifestSha256);

const sameSourceSet = (left: readonly string[], right: readonly string[]): boolean => {
  const normalizedLeft = [...new Set(left.map(normalizeSha))].sort((a, b) => a.localeCompare(b));
  const normalizedRight = [...new Set(right.map(normalizeSha))].sort((a, b) => a.localeCompare(b));
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((value, index) => value === normalizedRight[index]);
};

const normalizeSha = (value: string): string => value.trim().toLocaleLowerCase();

const elapsedMs = (startedAt: number): number => Math.round((performance.now() - startedAt) * 1_000) / 1_000;
