import type { MetadataStore, UserRecord } from "@datafoundry/metadata";

import type { OverviewAiArtifactIdentityV13 } from "./overview-ai-artifact.js";
import type { PreschoolAdditionalAiInsightsWorkflow } from "./preschool-additional-ai-insights-workflow.js";
import type { PreschoolOverviewAiPageWorkflow } from "./preschool-overview-ai-page-workflow.js";
import {
  PRESCHOOL_SECTION_IDS,
  type PreschoolOverviewAiReadModel,
  type PreschoolOverviewAiUnitStatus,
  type PreschoolSectionId,
} from "./preschool-overview-ai-contracts.js";
import { resolveProjectOverviewProfile } from "./project-analysis-resolver.js";

export type ProjectOverviewAdminReadinessStatus =
  | "ready"
  | "generating"
  | "not-generated"
  | "needs-attention"
  | "no-new-insight"
  | "out-of-date";

export type ProjectOverviewAdminReadinessItem = {
  id: string;
  label: string;
  status: ProjectOverviewAdminReadinessStatus;
  detail: string;
  artifactId?: string;
  completedAt?: string;
};

export type ProjectOverviewAdminState = {
  projectId: string;
  projectName: string;
  rendererKey: "ngee-ann-overview" | "preschool-overview" | null;
  customerOverview: {
    status: ProjectOverviewAdminReadinessStatus;
    detail: string;
    url: string | null;
  };
  currentIdentity: {
    dataSnapshotId: string;
    projectReleaseId: string;
    analysisPeriod: { from: string; to: string };
    modelProfileRevision: number;
  } | null;
  capabilities: {
    keyFindings: boolean;
    sectionAnalysis: PreschoolSectionId[];
    additionalInsights: boolean;
  };
  analysis: {
    supported: boolean;
    status: ProjectOverviewAdminReadinessStatus;
    detail: string;
    readyCount: number;
    totalCount: number;
    lastGeneratedAt: string | null;
    items: ProjectOverviewAdminReadinessItem[];
  };
  allowedActions: Array<"generate-missing">;
  recommendedNextAction: {
    action: "generate-missing";
    label: "Generate missing analysis";
    detail: string;
  } | null;
};

export type ProjectOverviewAdminReadinessService = {
  readProjectOverviewAdminState(input: {
    projectId: string;
    user: UserRecord;
  }): Promise<ProjectOverviewAdminState>;
  requestProjectOverviewAdminAction(input: {
    projectId: string;
    user: UserRecord;
    action: "generate-missing";
  }): Promise<ProjectOverviewAdminState>;
};

export const createProjectOverviewAdminReadinessService = (input: {
  metadataStore: MetadataStore;
  overviewAiWorkflow?: Pick<PreschoolOverviewAiPageWorkflow, "resolveCurrentIdentity" | "read">;
  overviewAiExecutor?: Pick<PreschoolOverviewAiPageWorkflow, "execute">;
  additionalAiInsightsWorkflow?: Pick<PreschoolAdditionalAiInsightsWorkflow, "execute">;
}): ProjectOverviewAdminReadinessService => {
  const readProjectOverviewAdminState: ProjectOverviewAdminReadinessService["readProjectOverviewAdminState"] = async ({ projectId, user }) => {
    const project = input.metadataStore.energyIq.getProject(projectId);
    const profile = resolveProjectOverviewProfile(project.id);
    const customerOverview = profile && project.status === "published"
      ? {
          status: "ready" as const,
          detail: "The published customer Overview is available.",
          url: `/energyiq/overview?projectId=${encodeURIComponent(project.id)}`,
        }
      : profile
        ? {
            status: "not-generated" as const,
            detail: "Publish the Project before customers can open its Overview.",
            url: null,
          }
        : {
            status: "needs-attention" as const,
            detail: "Assign a registered customer Overview before publishing this Project.",
            url: null,
          };

    if (profile?.rendererKey !== "preschool-overview") {
      return {
        projectId: project.id,
        projectName: project.name,
        rendererKey: profile?.rendererKey ?? null,
        customerOverview,
        currentIdentity: null,
        capabilities: {
          keyFindings: false,
          sectionAnalysis: [],
          additionalInsights: false,
        },
        analysis: {
          supported: false,
          status: "not-generated",
          detail: profile?.rendererKey === "ngee-ann-overview"
            ? "This Project uses its existing Ngee Ann Overview analysis path. Layer 1–3 readiness is not connected yet."
            : "AI readiness is not available until a registered customer Overview is assigned.",
          readyCount: 0,
          totalCount: 0,
          lastGeneratedAt: null,
          items: [],
        },
        allowedActions: [],
        recommendedNextAction: null,
      };
    }

    if (project.status !== "published" || !input.overviewAiWorkflow) {
      return unavailablePreschoolState({
        projectId: project.id,
        projectName: project.name,
        customerOverview,
        detail: project.status !== "published"
          ? "Publish the Project before generating analysis."
          : "The AI analysis workflow is not connected.",
      });
    }

    let identity: OverviewAiArtifactIdentityV13;
    try {
      identity = await input.overviewAiWorkflow.resolveCurrentIdentity({
        projectId: project.id,
        scopeId: project.root_scope_id,
        user,
      });
    } catch (reason) {
      const unavailableCustomerOverview = {
        status: "needs-attention" as const,
        detail: readableError(reason, "Current Overview facts are unavailable for the published Project."),
        url: null,
      };
      return unavailablePreschoolState({
        projectId: project.id,
        projectName: project.name,
        customerOverview: unavailableCustomerOverview,
        detail: readableError(reason, "Current data is not ready for AI analysis."),
      });
    }

    const readModel = await input.overviewAiWorkflow.read({ identity, user });
    const items = readinessItems(readModel, identity);
    const readyCount = items.filter((item) => item.status === "ready" || item.status === "no-new-insight").length;
    const analysisStatus = aggregateAnalysisStatus(items);
    const canGenerateMissing = items.some((item) => item.status === "not-generated");
    const lastGeneratedAt = latestTimestamp(items.flatMap((item) =>
      item.completedAt && (item.status === "ready" || item.status === "no-new-insight")
        ? [item.completedAt]
        : []));

    return {
      projectId: project.id,
      projectName: project.name,
      rendererKey: profile.rendererKey,
      customerOverview,
      currentIdentity: {
        dataSnapshotId: identity.dataSnapshotId,
        projectReleaseId: identity.projectReleaseId,
        analysisPeriod: { from: identity.analysisPeriodFrom, to: identity.analysisPeriodTo },
        modelProfileRevision: identity.modelProfileRevision,
      },
      capabilities: {
        keyFindings: true,
        sectionAnalysis: [...PRESCHOOL_SECTION_IDS],
        additionalInsights: true,
      },
      analysis: {
        supported: true,
        status: analysisStatus,
        detail: analysisDetail(analysisStatus, readyCount, items.length),
        readyCount,
        totalCount: items.length,
        lastGeneratedAt,
        items,
      },
      allowedActions: canGenerateMissing ? ["generate-missing"] : [],
      recommendedNextAction: canGenerateMissing
        ? {
            action: "generate-missing",
            label: "Generate missing analysis",
            detail: "Create only the current analysis results that have not been saved yet.",
          }
        : null,
    };
  };

  return {
    readProjectOverviewAdminState,
    async requestProjectOverviewAdminAction({ projectId, user, action }) {
      if (action !== "generate-missing") throw new Error("ENERGYIQ_OVERVIEW_ADMIN_ACTION_INVALID");
      const before = await readProjectOverviewAdminState({ projectId, user });
      if (!before.allowedActions.includes("generate-missing")) return before;
      if (!input.overviewAiWorkflow || !input.overviewAiExecutor) {
        throw new Error("ENERGYIQ_OVERVIEW_AI_SERVER_WORKFLOW_REQUIRED");
      }
      const project = input.metadataStore.energyIq.getProject(projectId);
      const identity = await input.overviewAiWorkflow.resolveCurrentIdentity({
        projectId,
        scopeId: project.root_scope_id,
        user,
      });
      const missingCore = before.analysis.items.some((item) =>
        item.status === "not-generated" && (item.id === "key-findings" || item.id.startsWith("section:")));
      const missingAdditional = before.analysis.items.some((item) =>
        item.status === "not-generated" && item.id === "additional-insights");
      if (missingCore) {
        await input.overviewAiExecutor.execute({ identity, user, retry: false });
      }
      const additionalAiInsightsWorkflow = input.additionalAiInsightsWorkflow;
      if (missingAdditional) {
        if (!additionalAiInsightsWorkflow) {
          throw new Error("ENERGYIQ_ADDITIONAL_AI_SERVER_WORKFLOW_REQUIRED");
        }
        await additionalAiInsightsWorkflow.execute({ baseIdentity: identity, user });
      }
      return readProjectOverviewAdminState({ projectId, user });
    },
  };
};

const unavailablePreschoolState = (input: {
  projectId: string;
  projectName: string;
  customerOverview: ProjectOverviewAdminState["customerOverview"];
  detail: string;
}): ProjectOverviewAdminState => ({
  projectId: input.projectId,
  projectName: input.projectName,
  rendererKey: "preschool-overview",
  customerOverview: input.customerOverview,
  currentIdentity: null,
  capabilities: {
    keyFindings: true,
    sectionAnalysis: [...PRESCHOOL_SECTION_IDS],
    additionalInsights: true,
  },
  analysis: {
    supported: true,
    status: "needs-attention",
    detail: input.detail,
    readyCount: 0,
    totalCount: PRESCHOOL_SECTION_IDS.length + 2,
    lastGeneratedAt: null,
    items: [],
  },
  allowedActions: [],
  recommendedNextAction: null,
});

const readinessItems = (
  readModel: PreschoolOverviewAiReadModel | null,
  identity: OverviewAiArtifactIdentityV13,
): ProjectOverviewAdminReadinessItem[] => {
  if (!readModel) return missingPreschoolItems();
  if (!sameBinding(readModel, identity)) {
    return missingPreschoolItems().map((item) => ({
      ...item,
      status: "needs-attention",
      detail: "The saved analysis failed exact Snapshot, Release, period, or model identity validation.",
    }));
  }
  return [
    unitItem("key-findings", "Key Findings", readModel.executive),
    ...PRESCHOOL_SECTION_IDS.map((sectionId) => unitItem(
      `section:${sectionId}`,
      SECTION_LABELS[sectionId],
      readModel.sections[sectionId],
    )),
    readModel.additional
      ? unitItem("additional-insights", "Additional AI Insights", readModel.additional)
      : missingItem("additional-insights", "Additional AI Insights"),
  ];
};

const missingPreschoolItems = (): ProjectOverviewAdminReadinessItem[] => [
  missingItem("key-findings", "Key Findings"),
  ...PRESCHOOL_SECTION_IDS.map((sectionId) => missingItem(`section:${sectionId}`, SECTION_LABELS[sectionId])),
  missingItem("additional-insights", "Additional AI Insights"),
];

const missingItem = (id: string, label: string): ProjectOverviewAdminReadinessItem => ({
  id,
  label,
  status: "not-generated",
  detail: `${label} has not been generated for the current data.`,
});

const unitItem = (
  id: string,
  label: string,
  unit: PreschoolOverviewAiUnitStatus<unknown>,
): ProjectOverviewAdminReadinessItem => {
  switch (unit.status) {
    case "queued":
    case "running":
      return { id, label, status: "generating", detail: `${label} is being generated.` };
    case "available":
      return {
        id,
        label,
        status: "ready",
        detail: `${label} is ready for the current data.`,
        artifactId: unit.artifactId,
        ...(unit.completedAt ? { completedAt: unit.completedAt } : {}),
      };
    case "empty":
      return {
        id,
        label,
        status: "no-new-insight",
        detail: "No new insight was found for this data update.",
        artifactId: unit.artifactId,
        ...(unit.completedAt ? { completedAt: unit.completedAt } : {}),
      };
    case "unavailable": {
      const notGenerated = /not (?:been )?generated/iu.test(unit.reason);
      return {
        id,
        label,
        status: notGenerated ? "not-generated" : "needs-attention",
        detail: notGenerated ? `${label} has not been generated for the current data.` : readableReason(unit.reason),
        ...(unit.artifactId ? { artifactId: unit.artifactId } : {}),
        ...(unit.completedAt ? { completedAt: unit.completedAt } : {}),
      };
    }
  }
};

const aggregateAnalysisStatus = (items: ProjectOverviewAdminReadinessItem[]): ProjectOverviewAdminReadinessStatus => {
  if (items.some(({ status }) => status === "out-of-date")) return "out-of-date";
  if (items.some(({ status }) => status === "generating")) return "generating";
  if (items.some(({ status }) => status === "needs-attention")) return "needs-attention";
  if (items.some(({ status }) => status === "not-generated")) return "not-generated";
  if (items.every(({ status }) => status === "no-new-insight")) return "no-new-insight";
  return "ready";
};

const analysisDetail = (
  status: ProjectOverviewAdminReadinessStatus,
  readyCount: number,
  totalCount: number,
): string => {
  if (status === "ready") return `All ${totalCount} saved analysis results are ready.`;
  if (status === "no-new-insight") return "No new insight was found for this data update.";
  if (status === "generating") return `${readyCount} of ${totalCount} saved analysis results are ready; generation is continuing.`;
  if (status === "out-of-date") return "Saved analysis is out of date for the current data.";
  if (status === "needs-attention") return `${readyCount} of ${totalCount} saved analysis results are ready; one or more items need attention.`;
  return `${readyCount} of ${totalCount} saved analysis results are ready; missing results can be generated.`;
};

const sameBinding = (
  readModel: PreschoolOverviewAiReadModel,
  identity: OverviewAiArtifactIdentityV13,
): boolean => readModel.binding.workspaceId === identity.workspaceId
  && readModel.binding.projectId === identity.projectId
  && readModel.binding.scopeId === identity.scopeId
  && readModel.binding.dataSnapshotId === identity.dataSnapshotId
  && readModel.binding.projectReleaseId === identity.projectReleaseId
  && readModel.binding.analysisPeriod.from === identity.analysisPeriodFrom
  && readModel.binding.analysisPeriod.to === identity.analysisPeriodTo
  && readModel.binding.modelProfileId === identity.modelProfileId
  && readModel.binding.modelProfileRevision === identity.modelProfileRevision;

const readableReason = (value: string): string => {
  if (!value.trim()) return "This analysis needs attention.";
  if (/^[A-Z0-9_:-]+$/u.test(value)) return "This analysis needs attention. Open Technical details for the failure code.";
  return value;
};

const readableError = (value: unknown, fallback: string): string =>
  value instanceof Error && value.message && !/^[A-Z0-9_:-]+$/u.test(value.message)
    ? value.message
    : fallback;

const latestTimestamp = (values: string[]): string | null => values
  .filter((value) => Number.isFinite(Date.parse(value)))
  .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;

const SECTION_LABELS: Record<PreschoolSectionId, string> = {
  "centre-benchmark": "Centre benchmark",
  "standby-wastage": "Closed-hours use",
  "operating-behaviour": "Operating-hours behaviour",
  "planning-outlook": "Planning outlook",
};
