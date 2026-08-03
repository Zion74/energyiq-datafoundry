import {
  projectAnalysisSnapshotToTrustedText,
  type TrustedEnergyTextIntent,
  type TrustedEnergyTextQueryContract
} from "@datafoundry/agent-runtime";
import type { EnergyScopedDataSource } from "@datafoundry/data-gateway";
import type { MetadataStore } from "@datafoundry/metadata";

import type { ProjectAnalysisSnapshot } from "./energy/project-analysis-resolver.js";

/** Bind an authoritative Snapshot to the exact run-local datasource and released Metric catalog. */
export const compileTrustedEnergyRunContract = (input: {
  intent: TrustedEnergyTextIntent;
  metadataStore: MetadataStore;
  scopedDatasource: EnergyScopedDataSource;
  snapshot: ProjectAnalysisSnapshot;
}): TrustedEnergyTextQueryContract => {
  const metricCatalog = input.metadataStore.energyIq.metrics.listRevisions()
    .filter((metric) => input.snapshot.projectRelease.metricRevisionIds.includes(metric.revision_id))
    .map((metric) => ({
      id: metric.metric_id,
      label: metric.display_name,
      unit: metric.unit,
      revisionId: metric.revision_id
    }));
  return projectAnalysisSnapshotToTrustedText({
    intent: input.intent,
    snapshot: input.snapshot,
    sourcePin: {
      datasourceId: input.scopedDatasource.datasourceId,
      datasourceRevision: String(input.scopedDatasource.revision),
      physicalSchema: { tables: [{ name: input.scopedDatasource.viewName }] }
    },
    metrics: metricCatalog
  });
};
