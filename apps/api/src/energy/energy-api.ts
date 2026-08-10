import {
  createErrorResult,
  createSuccessResult,
  filterAiFindingPresentationEvidence,
  parseAiFindingPresentation,
  type AppErrorCode,
} from "@datafoundry/contracts";
import {
  assertEnergyCurrentSnapshotFacts,
  ENERGY_FACT_WRITER_CONTRACT_VERSION,
  readEnergyFactCoverage,
} from "@datafoundry/data-gateway";
import type {
  EnergyIqDataSnapshotRecord,
  EnergyIqImportBatchRecord,
  EnergyIqOperatingCalendarEntry,
  EnergyIqOperatingDay,
  EnergyIqOperatingTimeRange,
  EnergyIqOverviewAiArtifactRecord,
  EnergyIqPolicyOwner,
  EnergyIqProjectSetupDocument,
  EnergyIqSavedAnalysisRecord,
  EnergyIqTariffScheduleEntry,
  EnergyIqTemplateDraftDocument,
  EnergyIqTemplateRevisionRecord,
} from "@datafoundry/metadata";
import {
  createDefaultTemplateDocument,
  createEnergyIqSourceManifest,
  resolveEnergyIqMaterializationBlockingReasons,
  resolveEnergyIqProjectDataReadiness,
} from "@datafoundry/metadata";
import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

import type { ConfigApiContext, ConfigApiResponse } from "../routes/types.js";
import { AuthError } from "../auth/service.js";
import { readMultipartUpload } from "../upload-parser.js";
import {
  executeEnergyScopeAnalysisWithLatestAvailable,
  selectEnergyCurrentOverviewPeriod,
  selectEnergyLatestAvailableDay,
  selectEnergyLatestCompleteDay,
  type EnergyScopeAnalysis,
} from "./energy-analysis.js";
import { inspectEnergyExcelWorkbook } from "./energy-excel-import.js";
import {
  ENERGY_EXCEL_MATERIALIZER_CONTRACT_VERSION,
} from "./energy-import-materializer.js";
import { materializeEnergyProjectManifest } from "./energy-project-materialization.js";
import {
  queueCurrentProjectOverviewAiArtifact,
} from "./overview-ai-artifact.js";
import { EnergyAdminAccessService } from "./energy-admin-access.js";
import {
  resolveProjectAnalysis,
  resolveProjectOverviewProfile,
  resolvePublishedEnergyQueryContext,
  type ProjectAnalysisSnapshot,
} from "./project-analysis-resolver.js";
import {
  resolveEnergyAccessContext,
  resolveEnergyPublishedHierarchyNodes,
  resolveEnergyQueryContext,
  type EnergyPeriod,
  type EnergyQueryContextRequest
} from "./energy-query-context.js";

const EXPLORER_ANALYSIS_CACHE_LIMIT = 100;
const explorerAnalysisCache = new Map<string, EnergyScopeAnalysis>();
const explorerAnchoredWindowCache = new Map<string, { localFrom: string; localTo: string }>();

type ExplorerPeriodSelectionInput = Parameters<typeof selectEnergyLatestCompleteDay>[0];

const resolveExplorerAnchoredWindow = async (
  input: ExplorerPeriodSelectionInput & {
    analysisWindow: "latest-complete-day" | "current-overview-28d";
  },
): Promise<{ localFrom: string; localTo: string }> => {
  if (input.analysisWindow === "current-overview-28d") {
    try {
      const selected = await selectEnergyCurrentOverviewPeriod(input);
      return {
        localFrom: selected.period.localFrom,
        localTo: selected.cutoffLocalDate,
      };
    } catch (error) {
      if (!(error instanceof Error) || (
        error.message !== "ENERGYIQ_CURRENT_OVERVIEW_COVERAGE_NOT_FOUND"
        && error.message !== "ENERGYIQ_CURRENT_OVERVIEW_PERIOD_NOT_FOUND"
      )) {
        throw error;
      }
    }
  } else {
    try {
      const selected = await selectEnergyLatestCompleteDay(input);
      return {
        localFrom: selected.period.localFrom,
        localTo: selected.period.localFrom,
      };
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "ENERGYIQ_LATEST_COMPLETE_DAY_NOT_FOUND") {
        throw error;
      }
    }
  }
  const fallback = await selectEnergyLatestAvailableDay(input);
  return {
    localFrom: fallback.period.localFrom,
    localTo: fallback.period.localFrom,
  };
};

export const handleEnergyApiRequest = async (
  request: IncomingMessage,
  segments: string[],
  context: Required<ConfigApiContext>
): Promise<ConfigApiResponse> => {
  try {
    const user = context.metadataStore.users.getById({ user_id: context.userId });
    if (segments[0] === "admin") {
      requireEnergyAdmin(context, user);
      const service = new EnergyAdminAccessService(context.metadataStore, context.authService);
      if (segments[1] === "organisations" && segments.length === 2 && request.method === "GET") {
        return { status: 200, body: createSuccessResult({ organisations: service.listOrganisations() }) };
      }
      if (segments[1] === "organisations" && segments.length === 2 && request.method === "POST") {
        const body = requireRecord(await readJsonBody(request));
        return {
          status: 201,
          body: createSuccessResult(service.createOrganisation({
            actorUserId: user.id,
            name: requireNonEmptyString(body.name, "ENERGYIQ_ORGANISATION_NAME_REQUIRED")
          }))
        };
      }
      if (segments[1] === "organisations" && segments[2] && segments.length === 3 && request.method === "PATCH") {
        const body = requireRecord(await readJsonBody(request));
        return {
          status: 200,
          body: createSuccessResult(service.updateOrganisation({
            actorUserId: user.id,
            id: decodeURIComponent(segments[2]),
            name: requireNonEmptyString(body.name, "ENERGYIQ_ORGANISATION_NAME_REQUIRED"),
            disabled: body.disabled === true
          }))
        };
      }
      if (segments[1] === "users" && segments.length === 2 && request.method === "GET") {
        return { status: 200, body: createSuccessResult({ users: service.listUsers() }) };
      }
      if (segments[1] === "users" && segments.length === 2 && request.method === "POST") {
        const body = requireRecord(await readJsonBody(request));
        const displayName = optionalString(body.displayName);
        return {
          status: 201,
          body: createSuccessResult(await service.inviteUser({
            actorUserId: user.id,
            email: requireNonEmptyString(body.email, "ENERGYIQ_USER_EMAIL_REQUIRED"),
            ...(displayName ? { displayName } : {}),
            organisationIds: requireStringArray(body.organisationIds, "ENERGYIQ_USER_ORGANISATIONS_REQUIRED"),
            role: body.role === "admin" ? "admin" : "user"
          }))
        };
      }
      if (segments[1] === "users" && segments[2] && segments.length === 3 && request.method === "PATCH") {
        const body = requireRecord(await readJsonBody(request));
        return {
          status: 200,
          body: createSuccessResult(service.updateUser({
            actorUserId: user.id,
            userId: decodeURIComponent(segments[2]),
            displayName: requireNonEmptyString(body.displayName, "ENERGYIQ_USER_NAME_REQUIRED"),
            organisationIds: requireStringArray(body.organisationIds, "ENERGYIQ_USER_ORGANISATIONS_REQUIRED"),
            role: body.role === "admin" ? "admin" : "user",
            disabled: body.disabled === true
          }))
        };
      }
      if (segments[1] === "users" && segments[2] && segments[3] === "resend-invitation" && request.method === "POST") {
        return {
          status: 200,
          body: createSuccessResult(await service.resendInvitation({
            actorUserId: user.id,
            userId: decodeURIComponent(segments[2])
          }))
        };
      }
    }
    if (segments[0] === "access-context" && request.method === "GET") {
      return {
        status: 200,
        body: createSuccessResult(resolveEnergyAccessContext({
          metadataStore: context.metadataStore,
          user,
          requestedWorkspaceId: context.workspaceId
        }))
      };
    }
    if (segments[0] === "projects" && segments[2] === "overview-ai-artifact") {
      const projectId = decodeURIComponent(segments[1] ?? "");
      const project = context.metadataStore.energyIq.getProject(projectId);
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const scopeId = requestUrl.searchParams.get("scopeId") ?? project.root_scope_id;
      const pinParts = {
        from: requestUrl.searchParams.get("from"),
        to: requestUrl.searchParams.get("to"),
        dataSnapshotId: requestUrl.searchParams.get("dataSnapshotId"),
        projectReleaseId: requestUrl.searchParams.get("projectReleaseId"),
      };
      const suppliedPinParts = Object.values(pinParts).filter((value) => value?.trim()).length;
      if (suppliedPinParts > 0 && suppliedPinParts < 4) {
        throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_PIN_INCOMPLETE");
      }
      const pin = suppliedPinParts === 4
        ? {
            from: pinParts.from!,
            to: pinParts.to!,
            dataSnapshotId: pinParts.dataSnapshotId!,
            projectReleaseId: pinParts.projectReleaseId!,
          }
        : undefined;
      if (!context.overviewAiWorkflow) throw new Error("ENERGYIQ_OVERVIEW_AI_SERVER_WORKFLOW_REQUIRED");
      const identity = await context.overviewAiWorkflow.resolveCurrentIdentity({
        projectId,
        scopeId,
        user,
        ...(pin ? { pin } : {}),
      });
      if (segments.length === 3 && request.method === "GET") {
        const artifact = context.metadataStore.energyIq.overviewAiArtifacts.find(identity);
        return {
          status: 200,
          headers: { "Cache-Control": "private, no-store" },
          body: createSuccessResult(artifact
            ? toOverviewAiArtifactDto(artifact)
            : {
                status: "missing",
                dataSnapshotId: identity.dataSnapshotId,
                projectReleaseId: identity.projectReleaseId,
              }),
        };
      }
      if (segments.length === 4 && segments[3] === "ensure" && request.method === "POST") {
        const artifact = await context.overviewAiWorkflow.execute({ identity, user, retry: false });
        return { status: 200, body: createSuccessResult(toOverviewAiArtifactDto(artifact)) };
      }
      if (segments.length === 4 && segments[3] === "retry" && request.method === "POST") {
        const artifact = await context.overviewAiWorkflow.execute({ identity, user, retry: true });
        return { status: 200, body: createSuccessResult(toOverviewAiArtifactDto(artifact)) };
      }
      if (segments.length === 4
        && (segments[3] === "claim" || segments[3] === "complete" || segments[3] === "fail")
        && request.method === "POST") {
        throw new AuthError(403, "FORBIDDEN", "Overview AI Artifact browser orchestration is forbidden.");
      }
    }
    if (segments[0] === "projects" && segments.length === 1 && request.method === "POST") {
      const access = requireEnergyAdmin(context, user);
      const body = requireRecord(await readJsonBody(request));
      const name = requireNonEmptyString(body.name, "ENERGYIQ_PROJECT_NAME_REQUIRED");
      const timezone = optionalString(body.timezone) ?? "Asia/Singapore";
      const projectId = optionalString(body.id) ?? `energy-project-${randomUUID().slice(0, 8)}`;
      const project = context.metadataStore.energyIq.upsertProject({
        id: projectId,
        workspace_id: access.activeWorkspaceId,
        name,
        status: "draft",
        timezone,
        root_scope_id: `${projectId}-project`
      });
      context.metadataStore.energyIq.upsertProjectAccess({
        project_id: projectId,
        user_id: user.id,
        role: "editor"
      });
      const draft = context.metadataStore.energyIq.projectSetup.getDraft({
        project_id: projectId,
        user_id: user.id
      });
      return {
        status: 201,
        body: createSuccessResult({ project, draft })
      };
    }
    if (segments[0] === "projects" && segments[2] === "imports") {
      const projectId = decodeURIComponent(segments[1] ?? "");
      requireEnergyAdminProject(context, user, projectId);
      const project = context.metadataStore.energyIq.getProject(projectId);
      if (segments.length === 5 && segments[4] === "materialize" && request.method === "POST") {
        const batchId = decodeURIComponent(segments[3] ?? "");
        const materialized = await materializeEnergyProjectManifest({
          context,
          userId: user.id,
          projectId,
          requestedBatchId: batchId,
        });
        let overviewAiArtifact: Awaited<ReturnType<typeof queueCurrentProjectOverviewAiArtifact>> = null;
        try {
          overviewAiArtifact = await queueCurrentProjectOverviewAiArtifact({
            metadataStore: context.metadataStore,
            dataGateway: context.dataGateway,
            projectId,
            user,
          });
        } catch (error) {
          console.warn("[energyiq] failed to queue Overview AI Artifact after materialization", error);
        }
        return {
          status: 200,
          body: createSuccessResult({
            batch: toEnergyImportBatchDto(materialized.batch),
            dataSnapshot: toEnergyDataSnapshotDto(materialized.snapshot),
            readiness: await createProjectDataReadiness(context, projectId, materialized.document),
            duplicate: materialized.duplicate,
            ...(materialized.timings ? { materializationTimings: materialized.timings } : {}),
            ...(overviewAiArtifact
              ? {
                  overviewAiArtifact: {
                    id: overviewAiArtifact.id,
                    status: overviewAiArtifact.status,
                    dataSnapshotId: overviewAiArtifact.data_snapshot_id,
                  },
                }
              : {}),
          }),
        };
      }
      if (segments.length === 3 && request.method === "GET") {
        const batches = context.metadataStore.energyIq.listImportBatches(projectId);
        const draft = context.metadataStore.energyIq.projectSetup.getDraft({
          project_id: projectId,
          user_id: user.id,
        });
        const snapshot = context.metadataStore.energyIq.findCurrentDataSnapshot(projectId);
        return {
          status: 200,
          body: createSuccessResult({
            batches: batches.map(toEnergyImportBatchDto),
            ...(snapshot ? { dataSnapshot: toEnergyDataSnapshotDto(snapshot) } : {}),
            readiness: await createProjectDataReadiness(context, projectId, draft.document),
          }),
        };
      }
      if (segments[3] === "excel" && request.method === "POST") {
        if (!request.headers["content-type"]?.includes("multipart/form-data")) {
          throw new Error("ENERGYIQ_EXCEL_MULTIPART_REQUIRED");
        }
        const { file } = await readMultipartUpload(request);
        if (!file.filename.toLowerCase().endsWith(".xlsx")) {
          throw new Error("ENERGYIQ_EXCEL_FILE_INVALID");
        }
        const sourceSha256 = createHash("sha256").update(file.content).digest("hex");
        const existing = context.metadataStore.energyIq.findImportBatchBySha({
          project_id: projectId,
          source_sha256: sourceSha256,
        });
        if (existing) {
          return {
            status: 200,
            body: createSuccessResult({ batch: toEnergyImportBatchDto(existing), duplicate: true }),
          };
        }
        const inspection = await inspectEnergyExcelWorkbook(file.content);
        const fileRef = context.fileAssetService.createRef({
          user_id: user.id,
          workspace_id: project.workspace_id,
          filename: file.filename,
          content: file.content,
          declared_mime_type: file.mimeType,
          source: "upload",
          metadata: { purpose: "energyiq_import", projectId },
        });
        const batch = context.metadataStore.energyIq.createImportBatch({
          id: `energy-import-${randomUUID()}`,
          workspace_id: project.workspace_id,
          project_id: projectId,
          source_kind: "excel",
          source_sha256: sourceSha256,
          filename: file.filename,
          file_asset_ref_id: fileRef.ref.id,
          status: "inspected",
          inspection,
          created_by: user.id,
        });
        return {
          status: 201,
          body: createSuccessResult({ batch: toEnergyImportBatchDto(batch), duplicate: false }),
        };
      }
    }
    if (segments[0] === "projects" && segments[2] === "data-coverage" && segments.length === 3 && request.method === "GET") {
      const projectId = decodeURIComponent(segments[1] ?? "");
      requireEnergyAdminProject(context, user, projectId);
      const project = context.metadataStore.energyIq.getProject(projectId);
      return {
        status: 200,
        body: createSuccessResult({
          coverage: await readEnergyFactCoverage({
            metadataStore: context.metadataStore,
            workspaceId: project.workspace_id,
            projectId,
            dataSnapshotId: project.data_snapshot_id,
            resource: "electricity",
          }),
        }),
      };
    }
    if (segments[0] === "projects" && segments[2] === "operational-policies") {
      const projectId = decodeURIComponent(segments[1] ?? "");
      requireEnergyAdminProject(context, user, projectId);
      if (segments.length === 3 && request.method === "GET") {
        return {
          status: 200,
          body: createSuccessResult(createOperationalPolicyConfiguration(context, projectId)),
        };
      }
      if (segments.length === 4 && segments[3] === "tariff" && request.method === "POST") {
        const body = requireRecord(await readJsonBody(request));
        const revision = context.metadataStore.energyIq.operationalPolicy.publishTariffSchedule({
          version_id: `tariff-${randomUUID()}`,
          project_id: projectId,
          entries: parseTariffScheduleEntries(body.entries),
          published_by: user.id,
          activate: true,
        });
        return {
          status: 201,
          body: createSuccessResult({
            revision,
            configuration: createOperationalPolicyConfiguration(context, projectId),
          }),
        };
      }
      if (segments.length === 4 && segments[3] === "calendar" && request.method === "POST") {
        const body = requireRecord(await readJsonBody(request));
        const revision = context.metadataStore.energyIq.operationalPolicy.publishOperatingCalendar({
          version_id: `calendar-${randomUUID()}`,
          project_id: projectId,
          entries: parseOperatingCalendarEntries(body.entries),
          published_by: user.id,
          activate: true,
        });
        return {
          status: 201,
          body: createSuccessResult({
            revision,
            configuration: createOperationalPolicyConfiguration(context, projectId),
          }),
        };
      }
    }
    if (segments[0] === "projects" && segments[2] === "setup") {
      const projectId = decodeURIComponent(segments[1] ?? "");
      requireEnergyAdminProject(context, user, projectId);
      if (segments.length === 3 && request.method === "GET") {
        const draft = context.metadataStore.energyIq.projectSetup.getDraft({
          project_id: projectId,
          user_id: user.id
        });
        return {
          status: 200,
          body: createSuccessResult({
            project: context.metadataStore.energyIq.getProject(projectId),
            overviewProfile: resolveProjectOverviewProfile(projectId),
            draft,
            validation: context.metadataStore.energyIq.projectSetup.validateDraft(projectId),
            published: {
              tiers: context.metadataStore.energyIq.listTierDefinitions(projectId),
              nodes: context.metadataStore.energyIq.listProjectNodes(projectId),
              revisions: context.metadataStore.energyIq.projectSetup.listHierarchyRevisions(projectId),
              templateRevisions: context.metadataStore.energyIq.templates.listProjectRevisions(projectId),
            }
          })
        };
      }
      if (segments[3] === "draft" && request.method === "PUT") {
        const body = requireRecord(await readJsonBody(request));
        const draft = context.metadataStore.energyIq.projectSetup.saveDraft({
          project_id: projectId,
          expected_revision: requireInteger(body.expectedRevision, "ENERGYIQ_SETUP_REVISION_REQUIRED"),
          user_id: user.id,
          document: parseProjectSetupDocument(body.document)
        });
        return {
          status: 200,
          body: createSuccessResult({
            draft,
            validation: context.metadataStore.energyIq.projectSetup.validateDraft(projectId)
          })
        };
      }
      if (segments[3] === "validate" && request.method === "POST") {
        return {
          status: 200,
          body: createSuccessResult(
            context.metadataStore.energyIq.projectSetup.validateDraft(projectId)
          )
        };
      }
      if (segments[3] === "publish" && request.method === "POST") {
        const body = requireRecord(await readJsonBody(request));
        const draft = context.metadataStore.energyIq.projectSetup.getDraft({
          project_id: projectId,
          user_id: user.id,
        });
        const readiness = await createProjectDataReadiness(context, projectId, draft.document);
        if (readiness.requiresFormalData && !readiness.ready) {
          throw new Error(`ENERGYIQ_PROJECT_DATA_NOT_READY:${readiness.blockingReasons.join(",")}`);
        }
        const published = context.metadataStore.energyIq.projectSetup.publishDraft({
          project_id: projectId,
          expected_revision: requireInteger(body.expectedRevision, "ENERGYIQ_SETUP_REVISION_REQUIRED"),
          user_id: user.id,
          expected_template_draft_revision: requireInteger(
            body.expectedTemplateDraftRevision,
            "ENERGYIQ_TEMPLATE_DRAFT_REVISION_REQUIRED",
          ),
          expected_metric_config_revision: requireInteger(
            body.expectedMetricConfigRevision,
            "ENERGYIQ_METRIC_CONFIG_REVISION_REQUIRED",
          ),
          expected_rule_config_revision: requireInteger(
            body.expectedRuleConfigRevision,
            "ENERGYIQ_RULE_CONFIG_REVISION_REQUIRED",
          ),
        });
        let overviewAiArtifact: Awaited<ReturnType<typeof queueCurrentProjectOverviewAiArtifact>> = null;
        try {
          overviewAiArtifact = await queueCurrentProjectOverviewAiArtifact({
            metadataStore: context.metadataStore,
            dataGateway: context.dataGateway,
            projectId,
            user,
          });
        } catch (error) {
          console.warn("[energyiq] failed to queue Overview AI Artifact after Project publish", error);
        }
        return {
          status: 200,
          body: createSuccessResult({
            ...published,
            project: context.metadataStore.energyIq.getProject(projectId),
            ...(overviewAiArtifact
              ? {
                  overviewAiArtifact: {
                    id: overviewAiArtifact.id,
                    status: overviewAiArtifact.status,
                    dataSnapshotId: overviewAiArtifact.data_snapshot_id,
                  },
                }
              : {}),
          })
        };
      }
    }
    if (segments[0] === "projects" && segments[2] === "metric-config" && segments.length === 3) {
      const projectId = decodeURIComponent(segments[1] ?? "");
      requireEnergyAdminProject(context, user, projectId);
      if (request.method === "GET") {
        return {
          status: 200,
          body: createSuccessResult({
            catalog: context.metadataStore.energyIq.metrics.listRevisions(),
            config: context.metadataStore.energyIq.metrics.getProjectConfig(projectId)
          })
        };
      }
      if (request.method === "PUT") {
        const body = requireRecord(await readJsonBody(request));
        const selectedMetricRevisionIds = requireStringArray(
          body.selectedMetricRevisionIds,
          "ENERGYIQ_METRIC_SELECTION_REQUIRED"
        );
        return {
          status: 200,
          body: createSuccessResult({
            catalog: context.metadataStore.energyIq.metrics.listRevisions(),
            config: context.metadataStore.energyIq.metrics.saveProjectConfig({
              project_id: projectId,
              expected_revision: requireInteger(
                body.expectedRevision,
                "ENERGYIQ_METRIC_CONFIG_REVISION_REQUIRED"
              ),
              selected_metric_revision_ids: selectedMetricRevisionIds,
              updated_by: user.id
            })
          })
        };
      }
    }
    if (segments[0] === "projects" && segments[2] === "rule-config" && segments.length === 3) {
      const projectId = decodeURIComponent(segments[1] ?? "");
      requireEnergyAdminProject(context, user, projectId);
      if (request.method === "GET") {
        return {
          status: 200,
          body: createSuccessResult({
            catalog: context.metadataStore.energyIq.rules.listRevisions(),
            config: context.metadataStore.energyIq.rules.getProjectConfig(projectId)
          })
        };
      }
      if (request.method === "PUT") {
        const body = requireRecord(await readJsonBody(request));
        const selectedRuleRevisionIds = requireStringArray(
          body.selectedRuleRevisionIds,
          "ENERGYIQ_RULE_SELECTION_REQUIRED"
        );
        return {
          status: 200,
          body: createSuccessResult({
            catalog: context.metadataStore.energyIq.rules.listRevisions(),
            config: context.metadataStore.energyIq.rules.saveProjectConfig({
              project_id: projectId,
              expected_revision: requireInteger(
                body.expectedRevision,
                "ENERGYIQ_RULE_CONFIG_REVISION_REQUIRED"
              ),
              selected_rule_revision_ids: selectedRuleRevisionIds,
              updated_by: user.id
            })
          })
        };
      }
    }
    if (segments[0] === "projects" && segments[2] === "template-draft" && segments.length === 3) {
      const projectId = decodeURIComponent(segments[1] ?? "");
      requireEnergyAdminProject(context, user, projectId);
      const setupDraft = context.metadataStore.energyIq.projectSetup.getDraft({
        project_id: projectId,
        user_id: user.id,
      });
      const tierDefinitionIds = [...setupDraft.document.tiers]
        .sort((left, right) => right.ordinal - left.ordinal)
        .map((tier) => tier.id);
      if (request.method === "GET") {
        return {
          status: 200,
          body: createSuccessResult({
            catalog: context.metadataStore.energyIq.templates.listComponentRevisions(),
            draft: context.metadataStore.energyIq.templates.getProjectDraft({
              project_id: projectId,
              tier_definition_ids: tierDefinitionIds,
            }),
          }),
        };
      }
      if (request.method === "PUT") {
        const body = requireRecord(await readJsonBody(request));
        return {
          status: 200,
          body: createSuccessResult({
            catalog: context.metadataStore.energyIq.templates.listComponentRevisions(),
            draft: context.metadataStore.energyIq.templates.saveProjectDraft({
              project_id: projectId,
              expected_revision: requireInteger(
                body.expectedRevision,
                "ENERGYIQ_TEMPLATE_DRAFT_REVISION_REQUIRED",
              ),
              tier_definition_ids: tierDefinitionIds,
              document: parseTemplateDraftDocument(body.document),
              updated_by: user.id,
            }),
          }),
        };
      }
    }
    if (segments[0] === "projects" && segments[2] === "saved-analyses") {
      const projectId = decodeURIComponent(segments[1] ?? "");
      const projectAccessContext = resolveEnergyAccessContext({
        metadataStore: context.metadataStore,
        user,
        requestedWorkspaceId: context.workspaceId,
      });
      const projectAccess = projectAccessContext.projects.find((project) => project.id === projectId);
      if (!projectAccess || projectAccess.workspaceId !== projectAccessContext.activeWorkspaceId) {
        throw new Error("ENERGYIQ_PROJECT_FORBIDDEN");
      }
      if (projectAccess.status !== "published" && projectAccessContext.role !== "admin") {
        throw new Error("ENERGYIQ_PROJECT_FORBIDDEN");
      }
      if (segments.length === 3 && request.method === "GET") {
        return {
          status: 200,
          body: createSuccessResult({
            items: context.metadataStore.energyIq.savedAnalyses
              .listProject(projectId)
              .map(toEnergySavedAnalysisSummary),
          }),
        };
      }
      if (segments.length === 3 && request.method === "POST") {
        const body = requireRecord(await readJsonBody(request));
        const query = parseQueryContextRequest({ ...body, projectId });
        if (query.resource === "water") throw new Error("ENERGYIQ_SAVED_ANALYSIS_RESOURCE_INVALID");
        const resolution = await resolveProjectAnalysis({
          metadataStore: context.metadataStore,
          dataGateway: context.dataGateway,
          user,
          workspaceId: context.workspaceId,
          request: query,
        });
        if (resolution.status !== "ready") throw new Error("ENERGYIQ_PROJECT_ANALYSIS_CONFIGURATION_REQUIRED");
        const { analysis, context: energyContext } = resolution.snapshot;
        requireDecisionGradeCoverage(analysis);
        const templateRevision = requireSnapshotTemplateRevision(context, resolution.snapshot);
        const viewState = parseRequestedSavedAnalysisViewState(body.viewState);
        const aiArtifact = parseRequestedSavedAnalysisAiArtifact(
          body.aiArtifact,
          resolution.snapshot,
          context,
          user.id,
        );
        const rerunQuery = savedAnalysisRerunQuery(query);
        const record = context.metadataStore.energyIq.savedAnalyses.create({
          id: `saved-analysis-${randomUUID()}`,
          series_id: `saved-analysis-series-${randomUUID()}`,
          project_id: projectId,
          workspace_id: projectAccessContext.activeWorkspaceId,
          scope_id: energyContext.scopeId,
          scope_name: energyContext.scopeName,
          resource: "electricity",
          title: optionalString(body.title) ?? `${energyContext.scopeName} · ${query.period ?? "Custom"}`,
          query_json: JSON.stringify(rerunQuery),
          analysis_json: JSON.stringify(analysis),
          snapshot_json: JSON.stringify(resolution.snapshot),
          ...(viewState ? { view_state_json: JSON.stringify(viewState) } : {}),
          ...(aiArtifact ? { ai_result_json: JSON.stringify(aiArtifact) } : {}),
          template_revision_id: templateRevision.revision_id,
          data_snapshot_id: analysis.provenance.dataSnapshotId,
          created_by: user.id,
        });
        return {
          status: 201,
          body: createSuccessResult(toEnergySavedAnalysisDetail(record, templateRevision, context)),
        };
      }
      if (segments[3] && segments.length === 4 && request.method === "GET") {
        const record = requireSavedAnalysisForProject(context, projectId, decodeURIComponent(segments[3]));
        return {
          status: 200,
          body: createSuccessResult(toEnergySavedAnalysisDetail(
            record,
            requireSavedAnalysisTemplateRevision(context, record),
            context,
          )),
        };
      }
      if (segments[3] && segments[4] === "ai-result" && segments.length === 5 && request.method === "POST") {
        const previous = requireSavedAnalysisForProject(context, projectId, decodeURIComponent(segments[3]));
        if (previous.created_by !== user.id) throw new Error("ENERGYIQ_SAVED_ANALYSIS_AI_RESULT_FORBIDDEN");
        const snapshot = parseSavedAnalysisSnapshot(previous);
        if (!snapshot) throw new Error("ENERGYIQ_SAVED_ANALYSIS_SNAPSHOT_INVALID");
        const body = requireRecord(await readJsonBody(request));
        const aiArtifact = parseRequestedSavedAnalysisAiArtifact(
          body.aiArtifact,
          snapshot,
          context,
          user.id,
        );
        if (!aiArtifact) throw new Error("ENERGYIQ_SAVED_ANALYSIS_AI_RESULT_INVALID");
        const record = context.metadataStore.energyIq.savedAnalyses.attachAiResult({
          id: previous.id,
          ai_result_json: JSON.stringify(aiArtifact),
        });
        return {
          status: 200,
          body: createSuccessResult(toEnergySavedAnalysisDetail(
            record,
            requireSavedAnalysisTemplateRevision(context, record),
            context,
          )),
        };
      }
      if (segments[3] && segments[4] === "rerun" && segments.length === 5 && request.method === "POST") {
        const previous = requireSavedAnalysisForProject(context, projectId, decodeURIComponent(segments[3]));
        const query = parseSavedAnalysisQuery(previous);
        const resolution = await resolveProjectAnalysis({
          metadataStore: context.metadataStore,
          dataGateway: context.dataGateway,
          user,
          workspaceId: context.workspaceId,
          request: query,
        });
        if (resolution.status !== "ready") throw new Error("ENERGYIQ_PROJECT_ANALYSIS_CONFIGURATION_REQUIRED");
        const { analysis, context: energyContext } = resolution.snapshot;
        requireDecisionGradeCoverage(analysis);
        const templateRevision = requireSnapshotTemplateRevision(context, resolution.snapshot);
        const record = context.metadataStore.energyIq.savedAnalyses.create({
          id: `saved-analysis-${randomUUID()}`,
          series_id: previous.series_id,
          project_id: previous.project_id,
          workspace_id: previous.workspace_id,
          scope_id: energyContext.scopeId,
          scope_name: energyContext.scopeName,
          resource: "electricity",
          title: previous.title,
          query_json: previous.query_json,
          analysis_json: JSON.stringify(analysis),
          snapshot_json: JSON.stringify(resolution.snapshot),
          ...(previous.view_state_json ? { view_state_json: previous.view_state_json } : {}),
          template_revision_id: templateRevision.revision_id,
          data_snapshot_id: analysis.provenance.dataSnapshotId,
          rerun_of_id: previous.id,
          created_by: user.id,
        });
        return {
          status: 201,
          body: createSuccessResult(toEnergySavedAnalysisDetail(record, templateRevision, context)),
        };
      }
    }
    if (segments[0] === "projects" && segments[2] === "published-template" && segments.length === 3 && request.method === "GET") {
      const projectId = decodeURIComponent(segments[1] ?? "");
      resolveEnergyQueryContext({
        metadataStore: context.metadataStore,
        user,
        workspaceId: context.workspaceId,
        request: { projectId, scopeId: "project", period: "Yesterday" },
      });
      const catalog = context.metadataStore.energyIq.templates.listComponentRevisions();
      const revision = context.metadataStore.energyIq.templates.getLatestProjectRevision(projectId);
      const document = revision?.document ?? createDefaultTemplateDocument(
        catalog,
        [...context.metadataStore.energyIq.listTierDefinitions(projectId)]
          .sort((left, right) => right.ordinal - left.ordinal)
          .map((tier) => tier.id),
      );
      return {
        status: 200,
        body: createSuccessResult({
          source: revision ? "published-revision" : "compatibility-default",
          revision,
          document,
          catalog,
        }),
      };
    }
    if (segments[0] === "query-context" && segments[1] === "resolve" && request.method === "POST") {
      const body = await readJsonBody(request);
      return {
        status: 200,
        body: createSuccessResult(resolveEnergyQueryContext({
          metadataStore: context.metadataStore,
          user,
          workspaceId: context.workspaceId,
          request: parseQueryContextRequest(body)
        }))
      };
    }
    if (segments[0] === "analysis" && segments[1] === "execute" && request.method === "POST") {
      const body = await readJsonBody(request);
      const query = parseQueryContextRequest(body);
      const explorerAnchoredWindow = isRecord(body)
        && body.surface === "project-explorer"
        && (query.analysisWindow === "latest-complete-day"
          || query.analysisWindow === "current-overview-28d");
      const preliminaryRun = resolvePublishedEnergyQueryContext({
        metadataStore: context.metadataStore,
        user,
        workspaceId: context.workspaceId,
        request: explorerAnchoredWindow
          ? { ...query, scopeId: "project", period: "Last 30 days" }
          : query,
      });
      const explorerAnchoredWindowCacheKey = explorerAnchoredWindow
        ? JSON.stringify({
            userId: context.userId,
            workspaceId: preliminaryRun.context.workspaceId,
            projectId: preliminaryRun.context.projectId,
            resource: preliminaryRun.context.resource,
            analysisWindow: query.analysisWindow,
            dataSnapshotId: preliminaryRun.context.dataSnapshotId,
            hierarchyRevisionId: preliminaryRun.context.hierarchyRevisionId,
            meterMappingRevisionId: preliminaryRun.context.meterMappingRevisionId,
            meterFormulaRevisionId: preliminaryRun.context.meterFormulaRevisionId,
            metricVersion: preliminaryRun.context.metricVersion,
            businessCalendarVersion: preliminaryRun.context.businessCalendarVersion,
            tariffScheduleVersion: preliminaryRun.context.tariffScheduleVersion,
            projectReleaseId: preliminaryRun.projectRelease?.id ?? null,
          })
        : null;
      const cachedAnchoredWindow = explorerAnchoredWindowCacheKey
        ? explorerAnchoredWindowCache.get(explorerAnchoredWindowCacheKey)
        : undefined;
      const resolvedAnchoredWindow = cachedAnchoredWindow ?? (explorerAnchoredWindow
        ? await resolveExplorerAnchoredWindow({
            metadataStore: context.metadataStore,
            dataGateway: context.dataGateway,
            userId: context.userId,
            context: preliminaryRun.context,
            analysisWindow: query.analysisWindow === "current-overview-28d"
              ? "current-overview-28d"
              : "latest-complete-day",
          })
        : null);
      if (explorerAnchoredWindowCacheKey && resolvedAnchoredWindow && !cachedAnchoredWindow) {
        explorerAnchoredWindowCache.set(explorerAnchoredWindowCacheKey, resolvedAnchoredWindow);
        while (explorerAnchoredWindowCache.size > EXPLORER_ANALYSIS_CACHE_LIMIT) {
          const oldestKey = explorerAnchoredWindowCache.keys().next().value as string | undefined;
          if (!oldestKey) break;
          explorerAnchoredWindowCache.delete(oldestKey);
        }
      }
      const energyContext = resolvedAnchoredWindow
        ? resolvePublishedEnergyQueryContext({
            metadataStore: context.metadataStore,
            user,
            workspaceId: context.workspaceId,
            request: {
              ...query,
              period: "Custom",
              from: resolvedAnchoredWindow.localFrom,
              to: resolvedAnchoredWindow.localTo,
            },
          }).context
        : preliminaryRun.context;
      const useExplorerCache = isRecord(body)
        && body.surface === "project-explorer"
        && body.bypassCache !== true;
      const explorerCacheKey = useExplorerCache
        ? JSON.stringify({
            userId: context.userId,
            workspaceId: energyContext.workspaceId,
            projectId: energyContext.projectId,
            scopeId: energyContext.scopeId,
            resource: energyContext.resource,
            from: energyContext.from,
            to: energyContext.to,
            dataSnapshotId: energyContext.dataSnapshotId,
            hierarchyRevisionId: energyContext.hierarchyRevisionId,
            meterMappingRevisionId: energyContext.meterMappingRevisionId,
            meterFormulaRevisionId: energyContext.meterFormulaRevisionId,
            metricVersion: energyContext.metricVersion,
            businessCalendarVersion: energyContext.businessCalendarVersion,
            tariffScheduleVersion: energyContext.tariffScheduleVersion,
            projectReleaseId: preliminaryRun.projectRelease?.id ?? null,
          })
        : null;
      const cachedExplorerAnalysis = explorerCacheKey
        ? explorerAnalysisCache.get(explorerCacheKey)
        : undefined;
      const analysis = cachedExplorerAnalysis ?? await executeEnergyScopeAnalysisWithLatestAvailable({
          metadataStore: context.metadataStore,
          dataGateway: context.dataGateway,
          userId: context.userId,
          context: energyContext,
          ...(isRecord(body) && body.surface === "project-explorer"
            ? { profile: "explorer" as const }
            : {}),
        });
      if (explorerCacheKey && !cachedExplorerAnalysis) {
        explorerAnalysisCache.set(explorerCacheKey, analysis);
        while (explorerAnalysisCache.size > EXPLORER_ANALYSIS_CACHE_LIMIT) {
          const oldestKey = explorerAnalysisCache.keys().next().value as string | undefined;
          if (!oldestKey) break;
          explorerAnalysisCache.delete(oldestKey);
        }
      }
      return {
        status: 200,
        body: createSuccessResult(analysis)
      };
    }
    if (segments[0] === "analysis" && segments[1] === "resolve" && request.method === "POST") {
      const body = requireRecord(await readJsonBody(request));
      return {
        status: 200,
        body: createSuccessResult(await resolveProjectAnalysis({
          metadataStore: context.metadataStore,
          dataGateway: context.dataGateway,
          user,
          workspaceId: context.workspaceId,
          request: parseQueryContextRequest(body),
          bypassCache: body.bypassCache === true,
        })),
      };
    }
    if (segments[0] === "projects" && segments[2] === "hierarchy" && request.method === "GET") {
      const projectId = decodeURIComponent(segments[1] ?? "");
      const access = resolveEnergyAccessContext({
        metadataStore: context.metadataStore,
        user,
        requestedWorkspaceId: context.workspaceId,
      });
      const accessibleProject = access.projects.find((project) => project.id === projectId);
      if (!accessibleProject || accessibleProject.workspaceId !== access.activeWorkspaceId) {
        throw new Error("ENERGYIQ_PROJECT_FORBIDDEN");
      }
      if (accessibleProject.status !== "published" && access.role !== "admin") {
        throw new Error("ENERGYIQ_PROJECT_FORBIDDEN");
      }
      const project = context.metadataStore.energyIq.getProject(projectId);
      const templateRevision = context.metadataStore.energyIq.templates.getLatestProjectRevision(projectId);
      const hierarchyRevisionId = templateRevision?.hierarchy_revision_id ?? project.hierarchy_revision_id;
      const hierarchyRevision = context.metadataStore.energyIq.projectSetup.listHierarchyRevisions(projectId)
        .find((revision) => revision.id === hierarchyRevisionId);
      if (!hierarchyRevision) {
        throw new Error(`ENERGYIQ_PUBLISHED_HIERARCHY_REVISION_REQUIRED:${hierarchyRevisionId}`);
      }
      const document = JSON.parse(hierarchyRevision.snapshot_json) as EnergyIqProjectSetupDocument;
      return {
        status: 200,
        body: createSuccessResult({
          project: { ...project, hierarchy_revision_id: hierarchyRevisionId },
          tiers: document.tiers,
          nodes: resolveEnergyPublishedHierarchyNodes(
            context.metadataStore,
            projectId,
            hierarchyRevisionId,
          ),
        })
      };
    }
    return {
      status: 404,
      body: createErrorResult("RESOURCE_NOT_FOUND", "EnergyIQ endpoint not found.")
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        status: error.status,
        body: createErrorResult(error.code as AppErrorCode, error.message)
      };
    }
    return toEnergyApiErrorResponse(error);
  }
};

export const toEnergyApiErrorResponse = (error: unknown): ConfigApiResponse => {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = rawMessage.match(/ENERGYIQ_[A-Z0-9_]+(?::[^\s]+)?/)?.[0] ?? rawMessage;
  const forbidden = message.includes("FORBIDDEN") || message.includes("ADMIN_REQUIRED");
  const conflict = message.includes("CONFLICT")
    || message === "ENERGYIQ_SOURCE_MANIFEST_NOT_CONFIRMED"
    || message === "ENERGYIQ_SOURCE_MANIFEST_MISMATCH"
    || message.startsWith("ENERGYIQ_IMPORT_BATCH_NOT_PINNED")
    || message.startsWith("ENERGYIQ_IMPORT_MATERIALIZATION_NOT_READY:")
    || message.startsWith("ENERGYIQ_SNAPSHOT_STALE")
    || message.startsWith("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE")
    || message === "ENERGYIQ_DATA_SNAPSHOT_MISMATCH"
    || message === "ENERGYIQ_PROJECT_RELEASE_MISMATCH"
    || message.startsWith("ENERGYIQ_DATA_SNAPSHOT_IMMUTABLE_CONFLICT:")
    || message.startsWith("ENERGYIQ_PROJECT_DATA_NOT_READY");
  const invalid = message.includes("INVALID")
    || message.includes("REQUIRED")
    || message.includes("EXCEL_EMPTY")
    || message.includes("NOT_CONFIRMED")
    || message.startsWith("ENERGYIQ_TARIFF_")
    || message.startsWith("ENERGYIQ_OPERATING_")
    || message === "ENERGYIQ_METRIC_REVISION_NOT_FOUND"
    || message === "ENERGYIQ_RULE_REVISION_NOT_FOUND";
  const code: AppErrorCode = forbidden
    ? "FORBIDDEN"
    : conflict
      ? "CONFLICT"
      : invalid
        ? "BAD_REQUEST"
        : "INTERNAL_ERROR";
  return {
    status: forbidden ? 403 : conflict ? 409 : invalid ? 400 : 500,
    body: createErrorResult(code, message),
  };
};

const MINIMUM_SAVED_ANALYSIS_COVERAGE_PCT = 95;

const createOperationalPolicyConfiguration = (
  context: Required<ConfigApiContext>,
  projectId: string,
) => {
  const project = context.metadataStore.energyIq.getProject(projectId);
  const binding = context.metadataStore.energyIq.operationalPolicy.getActivePolicyVersions(projectId);
  const publishedRevision = context.metadataStore.energyIq.templates.getLatestProjectRevision(projectId);
  return {
    projectId,
    timezone: project.timezone,
    published: {
      tariff_schedule_version: publishedRevision?.tariff_schedule_version ?? project.tariff_schedule_version,
      business_calendar_version: publishedRevision?.business_calendar_version ?? project.business_calendar_version,
      ...(publishedRevision ? { template_revision_id: publishedRevision.revision_id } : {}),
    },
    pending: {
      tariff_schedule_version: binding.tariff_schedule_version ?? project.tariff_schedule_version,
      business_calendar_version: binding.business_calendar_version ?? project.business_calendar_version,
    },
    tariffRevisions: context.metadataStore.energyIq.operationalPolicy.listTariffSchedules(projectId),
    operatingCalendarRevisions: context.metadataStore.energyIq.operationalPolicy.listOperatingCalendars(projectId),
    hasUnpublishedChanges: project.has_unpublished_changes,
  };
};

const requireDecisionGradeCoverage = (analysis: EnergyScopeAnalysis): void => {
  if (analysis.dataHealth.coveragePct < MINIMUM_SAVED_ANALYSIS_COVERAGE_PCT) {
    throw new Error("ENERGYIQ_DECISION_COVERAGE_REQUIRED");
  }
};

const requireStringArray = (value: unknown, code: string): string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(code);
  }
  return value.map((item) => item.trim()).filter(Boolean);
};

const toEnergyImportBatchDto = (
  batch: EnergyIqImportBatchRecord,
) => ({
  id: batch.id,
  projectId: batch.project_id,
  sourceKind: batch.source_kind,
  sourceSha256: batch.source_sha256,
  filename: batch.filename,
  status: batch.status,
  inspection: JSON.parse(batch.inspection_json) as unknown,
  ...(batch.materialization_json
    ? { materialization: JSON.parse(batch.materialization_json) as unknown }
    : {}),
  ...(batch.materialized_at ? { materializedAt: batch.materialized_at } : {}),
  createdAt: batch.created_at,
});

const toEnergyDataSnapshotDto = (snapshot: EnergyIqDataSnapshotRecord) => ({
  id: snapshot.id,
  projectId: snapshot.project_id,
  manifest: JSON.parse(snapshot.manifest_json) as unknown,
  audit: JSON.parse(snapshot.audit_json) as unknown,
  createdAt: snapshot.created_at,
});

const createProjectDataReadiness = (
  context: Required<ConfigApiContext>,
  projectId: string,
  document: EnergyIqProjectSetupDocument,
): Promise<ReturnType<typeof resolveEnergyIqProjectDataReadiness>> => {
  return createProjectDataReadinessAsync(context, projectId, document);
};

const createProjectDataReadinessAsync = async (
  context: Required<ConfigApiContext>,
  projectId: string,
  document: EnergyIqProjectSetupDocument,
): Promise<ReturnType<typeof resolveEnergyIqProjectDataReadiness>> => {
  const project = context.metadataStore.energyIq.getProject(projectId);
  const batches = context.metadataStore.energyIq.listImportBatches(projectId);
  const snapshot = context.metadataStore.energyIq.findCurrentDataSnapshot(projectId);
  const readiness = resolveEnergyIqProjectDataReadiness({
    project,
    batches,
    document,
    ...(snapshot ? { snapshot } : {}),
    expectedMaterializerContractVersion: ENERGY_EXCEL_MATERIALIZER_CONTRACT_VERSION,
    expectedFactWriterContractVersion: ENERGY_FACT_WRITER_CONTRACT_VERSION,
  });
  if (!readiness.requiresFormalData || !snapshot || snapshot.id !== project.data_snapshot_id) {
    return readiness;
  }
  let factStateReason: "SNAPSHOT_FACT_STATE_STALE" | "SNAPSHOT_FACT_STATE_UNAVAILABLE" | undefined;
  try {
    await assertEnergyCurrentSnapshotFacts({
      metadataStore: context.metadataStore,
      workspaceId: project.workspace_id,
      projectId,
      dataSnapshotId: snapshot.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ENERGYIQ_SNAPSHOT_STALE")) factStateReason = "SNAPSHOT_FACT_STATE_STALE";
    else if (message.includes("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE")) {
      factStateReason = "SNAPSHOT_FACT_STATE_UNAVAILABLE";
    } else {
      throw error;
    }
  }
  if (!factStateReason) return readiness;
  return {
    ...readiness,
    status: "blocked",
    ready: false,
    blockingReasons: [...new Set([...readiness.blockingReasons, factStateReason])],
  };
};

export const requireEnergyImportMaterializationPreconditions = (
  batches: EnergyIqImportBatchRecord[],
  document: EnergyIqProjectSetupDocument,
): void => {
  const reasons = resolveEnergyIqMaterializationBlockingReasons({ batches, document });
  if (reasons.length > 0) {
    throw new Error(`ENERGYIQ_IMPORT_MATERIALIZATION_NOT_READY:${reasons.join(",")}`);
  }
};

const toEnergySavedAnalysisSummary = (record: EnergyIqSavedAnalysisRecord) => ({
  id: record.id,
  seriesId: record.series_id,
  sequence: record.sequence,
  projectId: record.project_id,
  scopeId: record.scope_id,
  scopeName: record.scope_name,
  resource: record.resource,
  title: record.title,
  templateRevisionId: record.template_revision_id,
  dataSnapshotId: record.data_snapshot_id,
  ...(record.rerun_of_id ? { rerunOfId: record.rerun_of_id } : {}),
  createdBy: record.created_by,
  createdAt: record.created_at,
});

const toEnergySavedAnalysisDetail = (
  record: EnergyIqSavedAnalysisRecord,
  templateRevision: EnergyIqTemplateRevisionRecord,
  context: Required<ConfigApiContext>,
) => {
  const snapshot = parseSavedAnalysisSnapshot(record);
  const viewState = parseStoredSavedAnalysisViewState(record);
  const aiArtifact = snapshot ? parseStoredSavedAnalysisAiArtifact(record, snapshot) : undefined;
  return {
    ...toEnergySavedAnalysisSummary(record),
    query: parseSavedAnalysisQuery(record),
    analysis: JSON.parse(record.analysis_json) as unknown,
    ...(snapshot ? { snapshot } : {}),
    ...(viewState ? { viewState } : {}),
    ...(aiArtifact ? { aiArtifact } : {}),
    templateRevision,
    catalog: context.metadataStore.energyIq.templates.listComponentRevisions(),
  };
};

const requireSavedAnalysisForProject = (
  context: Required<ConfigApiContext>,
  projectId: string,
  analysisId: string,
): EnergyIqSavedAnalysisRecord => {
  const record = context.metadataStore.energyIq.savedAnalyses.get(analysisId);
  if (record.project_id !== projectId) throw new Error("ENERGYIQ_SAVED_ANALYSIS_FORBIDDEN");
  return record;
};

const requireSavedAnalysisTemplateRevision = (
  context: Required<ConfigApiContext>,
  record: EnergyIqSavedAnalysisRecord,
) => {
  const revision = context.metadataStore.energyIq.templates
    .listProjectRevisions(record.project_id)
    .find((candidate) => candidate.revision_id === record.template_revision_id);
  if (!revision) throw new Error("ENERGYIQ_TEMPLATE_REVISION_NOT_FOUND");
  return revision;
};

const requireSnapshotTemplateRevision = (
  context: Required<ConfigApiContext>,
  snapshot: ProjectAnalysisSnapshot,
): EnergyIqTemplateRevisionRecord => {
  const revisionId = snapshot.projectRelease.templateRevisionId;
  if (!revisionId) throw new Error("ENERGYIQ_TEMPLATE_REVISION_REQUIRED");
  const revision = context.metadataStore.energyIq.templates
    .listProjectRevisions(snapshot.context.projectId)
    .find((candidate) => candidate.revision_id === revisionId);
  if (!revision) throw new Error("ENERGYIQ_TEMPLATE_REVISION_NOT_FOUND");
  return revision;
};

const parseSavedAnalysisQuery = (record: EnergyIqSavedAnalysisRecord): EnergyQueryContextRequest => {
  try {
    return parseQueryContextRequest(JSON.parse(record.query_json) as unknown);
  } catch {
    throw new Error("ENERGYIQ_SAVED_ANALYSIS_QUERY_INVALID");
  }
};

const toOverviewAiArtifactDto = (artifact: EnergyIqOverviewAiArtifactRecord): Record<string, unknown> => ({
  id: artifact.id,
  status: artifact.status,
  dataSnapshotId: artifact.data_snapshot_id,
  projectReleaseId: artifact.project_release_id,
  modelProfileId: artifact.model_profile_id,
  modelProfileRevision: artifact.model_profile_revision,
  attemptCount: artifact.attempt_count,
  ...(artifact.run_id ? { runId: artifact.run_id } : {}),
  ...(artifact.completed_at ? { completedAt: artifact.completed_at } : {}),
  ...(artifact.error_code ? { errorCode: artifact.error_code } : {}),
  ...(artifact.result_json ? { result: customerVisibleOverviewAiResult(JSON.parse(artifact.result_json) as unknown) } : {}),
});

const customerVisibleOverviewAiResult = (value: unknown): unknown => {
  if (!isRecord(value) || !isRecord(value.workflow) || !Array.isArray(value.workflow.editorTrace)) return value;
  const { editorTrace: _, ...workflow } = value.workflow;
  return { ...value, workflow };
};

const savedAnalysisRerunQuery = (
  query: EnergyQueryContextRequest,
): EnergyQueryContextRequest => {
  if (!query.analysisWindow) return query;
  const {
    from: _from,
    to: _to,
    expectedDataSnapshotId: _expectedDataSnapshotId,
    expectedProjectReleaseId: _expectedProjectReleaseId,
    ...semanticQuery
  } = query;
  return semanticQuery;
};

type SavedAnalysisViewState = {
  grain: "day" | "hour";
  comparison: "overlay" | "selected" | "average";
  category: "all" | "load" | "light";
};

const parseRequestedSavedAnalysisViewState = (value: unknown): SavedAnalysisViewState | undefined => {
  if (value === undefined) return undefined;
  return parseSavedAnalysisViewState(value);
};

const parseStoredSavedAnalysisViewState = (
  record: EnergyIqSavedAnalysisRecord,
): SavedAnalysisViewState | undefined => {
  if (!record.view_state_json) return undefined;
  try {
    return parseSavedAnalysisViewState(JSON.parse(record.view_state_json) as unknown);
  } catch {
    throw new Error("ENERGYIQ_SAVED_ANALYSIS_VIEW_STATE_INVALID");
  }
};

const parseSavedAnalysisViewState = (value: unknown): SavedAnalysisViewState => {
  if (!isRecord(value)) throw new Error("ENERGYIQ_SAVED_ANALYSIS_VIEW_STATE_INVALID");
  const { grain, comparison, category } = value;
  if ((grain !== "day" && grain !== "hour")
    || (comparison !== "overlay" && comparison !== "selected" && comparison !== "average")
    || (category !== "all" && category !== "load" && category !== "light")) {
    throw new Error("ENERGYIQ_SAVED_ANALYSIS_VIEW_STATE_INVALID");
  }
  return { grain, comparison, category };
};

type SavedAnalysisAiArtifactInput = {
  contract: "energyiq-saved-ai-result@1";
  rendererKey: "ngee-ann-overview" | "preschool-overview";
  snapshotId: string;
  projectReleaseId: string;
  result: Record<string, unknown> & {
    status: "available";
    providerProfileId: string;
    runId: string;
    findings: Record<string, unknown>[];
  };
};

type SavedAnalysisAiArtifact = SavedAnalysisAiArtifactInput & {
  completedAt: string;
  runProvenance?: {
    modelProvider: string;
    modelName: string;
    requestFingerprint?: string;
    contextSha256: string;
  };
};

const parseRequestedSavedAnalysisAiArtifact = (
  value: unknown,
  snapshot: ProjectAnalysisSnapshot,
  context: Required<ConfigApiContext>,
  userId: string,
): SavedAnalysisAiArtifact | undefined => {
  if (value === undefined) return undefined;
  const artifact = parseSavedAnalysisAiArtifactInput(value, snapshot);
  if (snapshot.renderer.key === "preschool-overview" && !isPreschoolAcceptedSavedResult(artifact.result, snapshot)) {
    throw new Error("ENERGYIQ_SAVED_ANALYSIS_AI_RESULT_INVALID");
  }
  const runIds = savedAnalysisAiRunIds(artifact.result);
  const runs = runIds.map((runId) => {
    const run = context.metadataStore.runs.find({ user_id: userId, run_id: runId });
    if (!run
      || run.status !== "completed"
      || !run.finished_at
      || !run.user_input.includes(artifact.snapshotId)
      || !run.user_input.includes(artifact.projectReleaseId)) {
      throw new Error("ENERGYIQ_SAVED_ANALYSIS_AI_RESULT_RUN_INVALID");
    }
    return run;
  });
  const run = runs.find((candidate) => candidate.id === artifact.result.runId);
  if (!run?.finished_at) throw new Error("ENERGYIQ_SAVED_ANALYSIS_AI_RESULT_RUN_INVALID");
  return {
    ...artifact,
    completedAt: run.finished_at,
    runProvenance: {
      modelProvider: run.model_provider ?? "unrecorded",
      modelName: run.model_name ?? "unrecorded",
      ...(run.request_fingerprint ? { requestFingerprint: run.request_fingerprint } : {}),
      contextSha256: createHash("sha256").update(run.user_input).digest("hex"),
    },
  };
};

const parseStoredSavedAnalysisAiArtifact = (
  record: EnergyIqSavedAnalysisRecord,
  snapshot: ProjectAnalysisSnapshot,
): SavedAnalysisAiArtifact | undefined => {
  if (!record.ai_result_json) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(record.ai_result_json) as unknown;
  } catch {
    throw new Error("ENERGYIQ_SAVED_ANALYSIS_AI_RESULT_INVALID");
  }
  const artifact = parseSavedAnalysisAiArtifactInput(value, snapshot);
  if (!isRecord(value) || typeof value.completedAt !== "string" || !Number.isFinite(Date.parse(value.completedAt))) {
    throw new Error("ENERGYIQ_SAVED_ANALYSIS_AI_RESULT_INVALID");
  }
  const runProvenance = parseSavedAnalysisAiRunProvenance(value.runProvenance);
  return { ...artifact, completedAt: value.completedAt, ...(runProvenance ? { runProvenance } : {}) };
};

const parseSavedAnalysisAiRunProvenance = (
  value: unknown,
): NonNullable<SavedAnalysisAiArtifact["runProvenance"]> | undefined => {
  if (value === undefined) return undefined;
  if (!isRecord(value)
    || typeof value.modelProvider !== "string"
    || !value.modelProvider.trim()
    || typeof value.modelName !== "string"
    || !value.modelName.trim()
    || (value.requestFingerprint !== undefined && typeof value.requestFingerprint !== "string")
    || typeof value.contextSha256 !== "string"
    || !/^[a-f0-9]{64}$/u.test(value.contextSha256)) {
    throw new Error("ENERGYIQ_SAVED_ANALYSIS_AI_RESULT_INVALID");
  }
  return value as NonNullable<SavedAnalysisAiArtifact["runProvenance"]>;
};

const parseSavedAnalysisAiArtifactInput = (
  value: unknown,
  snapshot: ProjectAnalysisSnapshot,
): SavedAnalysisAiArtifactInput => {
  if (!isRecord(value)
    || value.contract !== "energyiq-saved-ai-result@1"
    || value.rendererKey !== snapshot.renderer.key
    || value.snapshotId !== snapshot.dataSnapshot.id
    || value.projectReleaseId !== snapshot.projectRelease.id
    || !isRecord(value.result)
    || value.result.status !== "available"
    || typeof value.result.providerProfileId !== "string"
    || !value.result.providerProfileId.trim()
    || typeof value.result.runId !== "string"
    || !value.result.runId.trim()
    || !Array.isArray(value.result.findings)
    || !value.result.findings.every((finding) => isRecord(finding)
      && isRecord(finding.evidence)
      && finding.evidence.snapshotId === snapshot.dataSnapshot.id)) {
    throw new Error("ENERGYIQ_SAVED_ANALYSIS_AI_RESULT_INVALID");
  }
  if (snapshot.renderer.key === "ngee-ann-overview" && value.result.findings.length > 3) {
    throw new Error("ENERGYIQ_SAVED_ANALYSIS_AI_RESULT_INVALID");
  }
  if (snapshot.renderer.key === "preschool-overview"
    && (value.result.packId !== "preschool-analysis-pack"
      || value.result.packRevision !== "v1"
      || (!isPreschoolAcceptedSavedResult(value.result, snapshot) && value.result.findings.length > 3))) {
    throw new Error("ENERGYIQ_SAVED_ANALYSIS_AI_RESULT_INVALID");
  }
  const input = value as SavedAnalysisAiArtifactInput;
  const artifact: SavedAnalysisAiArtifactInput = {
    ...input,
    result: {
      ...input.result,
      findings: input.result.findings.map(materializeSavedAiFinding),
    },
  };
  const serialized = JSON.stringify(artifact);
  if (serialized.length > 262_144) throw new Error("ENERGYIQ_SAVED_ANALYSIS_AI_RESULT_TOO_LARGE");
  return artifact;
};

const savedAnalysisAiRunIds = (result: SavedAnalysisAiArtifactInput["result"]): string[] => {
  if (!isRecord(result.workflow)
    || !isRecord(result.workflow.stages)
    || !isRecord(result.workflow.stages.investigator)
    || !isRecord(result.workflow.stages.editor)
    || typeof result.workflow.stages.investigator.runId !== "string"
    || typeof result.workflow.stages.editor.runId !== "string") return [result.runId];
  return [...new Set([
    result.workflow.stages.investigator.runId,
    result.workflow.stages.editor.runId,
  ])];
};

const isPreschoolAcceptedSavedResult = (
  result: Record<string, unknown>,
  snapshot: ProjectAnalysisSnapshot,
): boolean => {
  if (!isRecord(result.contract)
    || result.contract.id !== "preschool-ai-accepted-artifact"
    || result.contract.revision !== "v13"
    || !isRecord(result.binding)
    || result.binding.projectId !== snapshot.context.projectId
    || result.binding.scopeId !== snapshot.context.scopeId
    || result.binding.dataSnapshotId !== snapshot.dataSnapshot.id
    || result.binding.projectReleaseId !== snapshot.projectRelease.id
    || result.binding.dataCutoff !== snapshot.context.primaryPeriod.endExclusive
    || !isRecord(result.binding.analysisPeriod)
    || result.binding.analysisPeriod.from !== snapshot.context.primaryPeriod.start
    || result.binding.analysisPeriod.to !== snapshot.context.primaryPeriod.endExclusive
    || result.binding.outputContractRevision !== "v13"
    || !isRecord(result.workflow)
    || result.workflow.id !== "preschool-two-stage"
    || result.workflow.revision !== "preschool-two-stage-v2"
    || !isRecord(result.workflow.methodSkill)
    || result.workflow.methodSkill.id !== "energy-insight-investigation"
    || result.workflow.methodSkill.revision !== "1.0.0"
    || !isRecord(result.workflow.stages)
    || !isRecord(result.workflow.stages.investigator)
    || !isRecord(result.workflow.stages.editor)
    || !isPresentString(result.workflow.stages.investigator.runId)
    || !isPresentString(result.workflow.stages.editor.runId)
    || result.workflow.stages.investigator.promptRevision !== "preschool-investigator-v11"
    || result.workflow.stages.editor.promptRevision !== "preschool-insight-editor-v5"
    || result.workflow.stages.editor.runId !== result.runId
    || result.workflow.stages.investigator.runId === result.workflow.stages.editor.runId
    || !Array.isArray(result.findings)) return false;
  return result.findings.every((finding) => isRecord(finding)
    && isPresentString(finding.id)
    && isRecord(finding.binding)
    && finding.binding.projectId === snapshot.context.projectId
    && finding.binding.scopeId === snapshot.context.scopeId
    && finding.binding.dataSnapshotId === snapshot.dataSnapshot.id
    && finding.binding.projectReleaseId === snapshot.projectRelease.id
    && finding.binding.dataCutoff === snapshot.context.primaryPeriod.endExclusive
    && isRecord(finding.binding.analysisPeriod)
    && finding.binding.analysisPeriod.from === snapshot.context.primaryPeriod.start
    && finding.binding.analysisPeriod.to === snapshot.context.primaryPeriod.endExclusive
    && finding.binding.outputContractRevision === "v13"
    && Array.isArray(finding.placementTargets)
    && finding.placementTargets.length > 0
    && finding.placementTargets.every(isPreschoolPlacementTarget)
    && (finding.epistemicLevel === "verified"
      || finding.epistemicLevel === "hypothesis"
      || finding.epistemicLevel === "exploration-idea")
    && (finding.relationship === "supports"
      || finding.relationship === "challenges"
      || finding.relationship === "independent")
    && isStringArray(finding.signalRefs)
    && isPresentString(finding.title)
    && isPresentString(finding.takeaway)
    && isOptionalPresentString(finding.interpretation)
    && isPresentString(finding.action)
    && isPresentString(finding.expectedIfAct)
    && isPresentString(finding.ifIgnored)
    && isOptionalPresentString(finding.possibleExplanation)
    && isOptionalPresentString(finding.verification)
    && isPresentString(finding.uncertainty)
    && (!isPresentString(finding.possibleExplanation) || isPresentString(finding.verification))
    && (finding.epistemicLevel === "verified"
      || isPresentString(finding.verification)
      || isPresentString(finding.uncertainty))
    && isRecord(finding.evidence)
    && finding.evidence.snapshotId === snapshot.dataSnapshot.id
    && isRecord(finding.evidence.period)
    && finding.evidence.period.from === snapshot.context.primaryPeriod.start
    && finding.evidence.period.to === snapshot.context.primaryPeriod.endExclusive
    && Array.isArray(finding.evidence.deterministic)
    && Array.isArray(finding.evidence.tools)
    && (finding.epistemicLevel !== "verified"
      || finding.evidence.deterministic.length > 0
      || finding.evidence.tools.length > 0));
};

const isPreschoolPlacementTarget = (value: unknown): boolean =>
  value === "preschool.overall-key-findings"
  || value === "preschool.benchmark"
  || value === "preschool.standby"
  || value === "preschool.operating-hours"
  || value === "preschool.forecast"
  || value === "cross-section";

const isPresentString = (value: unknown): value is string =>
  typeof value === "string" && Boolean(value.trim());

const isOptionalPresentString = (value: unknown): boolean => value === undefined || isPresentString(value);

const isStringArray = (value: unknown): boolean => Array.isArray(value) && value.every(isPresentString);

const materializeSavedAiFinding = (finding: Record<string, unknown>): Record<string, unknown> => {
  const { presentation: _untrustedPresentation, ...findingWithoutPresentation } = finding;
  const presentation = parseAiFindingPresentation(finding.presentation);
  if (!presentation || !isRecord(finding.evidence)) return findingWithoutPresentation;
  const deterministicIds = Array.isArray(finding.evidence.deterministic)
    ? finding.evidence.deterministic.flatMap((item) => (
        isRecord(item) && typeof item.id === "string" && item.id.trim() ? [item.id] : []
      ))
    : [];
  const sqlIndexes = Array.isArray(finding.evidence.tools)
    ? finding.evidence.tools.flatMap((tool) => (
        isRecord(tool)
        && typeof tool.evidenceIndex === "number"
        && Number.isSafeInteger(tool.evidenceIndex)
        && tool.evidenceIndex > 0
          ? [tool.evidenceIndex]
          : []
      ))
    : [];
  const materialized = filterAiFindingPresentationEvidence(presentation, {
    evidenceRefs: deterministicIds,
    evidenceSqlIndexes: sqlIndexes,
  });
  return {
    ...findingWithoutPresentation,
    ...(materialized ? { presentation: materialized } : {}),
  };
};

const parseSavedAnalysisSnapshot = (
  record: EnergyIqSavedAnalysisRecord,
): ProjectAnalysisSnapshot | undefined => {
  if (!record.snapshot_json) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(record.snapshot_json) as unknown;
  } catch {
    throw new Error("ENERGYIQ_SAVED_ANALYSIS_SNAPSHOT_INVALID");
  }
  if (!isRecord(value)
    || !isRecord(value.context)
    || !isRecord(value.projectRelease)
    || !isRecord(value.renderer)
    || !isRecord(value.dataSnapshot)
    || !isRecord(value.analysis)
    || !isRecord(value.analysis.provenance)) {
    throw new Error("ENERGYIQ_SAVED_ANALYSIS_SNAPSHOT_INVALID");
  }
  const rendererKey = value.renderer.key;
  if (value.context.projectId !== record.project_id
    || value.context.scopeId !== record.scope_id
    || value.context.resource !== record.resource
    || value.context.dataSnapshotId !== record.data_snapshot_id
    || value.projectRelease.templateRevisionId !== record.template_revision_id
    || value.dataSnapshot.id !== record.data_snapshot_id
    || value.analysis.provenance.dataSnapshotId !== record.data_snapshot_id
    || (rendererKey !== "ngee-ann-overview" && rendererKey !== "preschool-overview")) {
    throw new Error("ENERGYIQ_SAVED_ANALYSIS_SNAPSHOT_INVALID");
  }
  return value as ProjectAnalysisSnapshot;
};

const requireEnergyAdmin = (
  context: Required<ConfigApiContext>,
  user: ReturnType<Required<ConfigApiContext>["metadataStore"]["users"]["getById"]>
) => {
  const access = resolveEnergyAccessContext({
    metadataStore: context.metadataStore,
    user,
    requestedWorkspaceId: context.workspaceId
  });
  if (access.role !== "admin") {
    throw new Error("ENERGYIQ_ADMIN_REQUIRED");
  }
  return access;
};

const requireEnergyAdminProject = (
  context: Required<ConfigApiContext>,
  user: ReturnType<Required<ConfigApiContext>["metadataStore"]["users"]["getById"]>,
  projectId: string
): void => {
  const access = requireEnergyAdmin(context, user);
  const project = context.metadataStore.energyIq.getProject(projectId);
  if (project.workspace_id !== access.activeWorkspaceId) {
    throw new Error("ENERGYIQ_PROJECT_FORBIDDEN");
  }
};

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1024 * 1024) {
      throw new Error("ENERGYIQ_INVALID_BODY");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new Error("ENERGYIQ_INVALID_BODY");
  }
};

const parseQueryContextRequest = (value: unknown): EnergyQueryContextRequest => {
  if (!isRecord(value) || typeof value.projectId !== "string") {
    throw new Error("ENERGYIQ_PROJECT_REQUIRED");
  }
  const resource = value.resource === "water" ? "water" : "electricity";
  const allowedPeriods = new Set(["Yesterday", "Last 7 days", "Last 30 days", "Previous week", "Previous month", "Custom"]);
  if (value.period !== undefined && (
    typeof value.period !== "string" || !allowedPeriods.has(value.period)
  )) {
    throw new Error("ENERGYIQ_PERIOD_INVALID");
  }
  if (value.analysisWindow !== undefined
    && value.analysisWindow !== "latest-complete-day"
    && value.analysisWindow !== "latest-complete-7d"
    && value.analysisWindow !== "current-overview-28d") {
    throw new Error("ENERGYIQ_ANALYSIS_WINDOW_INVALID");
  }
  const period: EnergyPeriod = value.period === undefined
    ? "Last 30 days"
    : value.period as EnergyPeriod;
  return {
    projectId: value.projectId,
    ...(typeof value.scopeId === "string" ? { scopeId: value.scopeId } : {}),
    resource,
    period,
    ...(typeof value.from === "string" ? { from: value.from } : {}),
    ...(typeof value.to === "string" ? { to: value.to } : {}),
    ...(value.analysisWindow === "latest-complete-day"
      || value.analysisWindow === "latest-complete-7d"
      || value.analysisWindow === "current-overview-28d"
      ? { analysisWindow: value.analysisWindow }
      : {}),
    ...(typeof value.expectedDataSnapshotId === "string"
      ? { expectedDataSnapshotId: value.expectedDataSnapshotId }
      : {}),
    ...(typeof value.expectedProjectReleaseId === "string"
      ? { expectedProjectReleaseId: value.expectedProjectReleaseId }
      : {}),
  };
};

const parseProjectSetupDocument = (value: unknown): EnergyIqProjectSetupDocument => {
  const document = requireRecord(value, "ENERGYIQ_SETUP_DOCUMENT_INVALID");
  const project = requireRecord(document.project, "ENERGYIQ_SETUP_PROJECT_INVALID");
  if (!Array.isArray(document.tiers) || !Array.isArray(document.nodes)) {
    throw new Error("ENERGYIQ_SETUP_DOCUMENT_INVALID");
  }
  const meterMapping = document.meter_mapping === undefined
    ? undefined
    : parseMeterMappingDraft(document.meter_mapping);
  const sourceManifest = document.source_manifest === undefined
    ? undefined
    : parseSourceManifest(document.source_manifest);
  return {
    project: {
      name: requireNonEmptyString(project.name, "ENERGYIQ_PROJECT_NAME_REQUIRED"),
      timezone: requireNonEmptyString(project.timezone, "ENERGYIQ_PROJECT_TIMEZONE_REQUIRED")
    },
    tier_structure_locked: typeof document.tier_structure_locked === "boolean"
      ? document.tier_structure_locked
      : document.nodes.length > 0,
    tiers: document.tiers.map((value, index) => {
      const tier = requireRecord(value, `ENERGYIQ_TIER_INVALID:${index}`);
      const description = optionalString(tier.description);
      return {
        id: requireNonEmptyString(tier.id, `ENERGYIQ_TIER_ID_REQUIRED:${index}`),
        ordinal: requireInteger(tier.ordinal, `ENERGYIQ_TIER_ORDINAL_REQUIRED:${index}`),
        alias: requireNonEmptyString(tier.alias, `ENERGYIQ_TIER_ALIAS_REQUIRED:${index}`),
        ...(description ? { description } : {})
      };
    }),
    nodes: document.nodes.map((value, index) => {
      const node = requireRecord(value, `ENERGYIQ_NODE_INVALID:${index}`);
      const parentId = optionalString(node.parent_id);
      const areaSqm = optionalNumber(node.area_sqm);
      const occupantCount = optionalNumber(node.occupant_count);
      const effectiveFrom = optionalString(node.effective_from);
      const effectiveTo = optionalString(node.effective_to);
      const independentReason = optionalString(node.independent_reason);
      const metadata = node.metadata === undefined
        ? undefined
        : requireRecord(node.metadata, `ENERGYIQ_NODE_METADATA_INVALID:${index}`);
      return {
        id: requireNonEmptyString(node.id, `ENERGYIQ_NODE_ID_REQUIRED:${index}`),
        tier_definition_id: requireNonEmptyString(
          node.tier_definition_id,
          `ENERGYIQ_NODE_TIER_REQUIRED:${index}`
        ),
        ...(parentId ? { parent_id: parentId } : {}),
        name: requireNonEmptyString(node.name, `ENERGYIQ_NODE_NAME_REQUIRED:${index}`),
        sort_order: requireInteger(node.sort_order, `ENERGYIQ_NODE_SORT_ORDER_REQUIRED:${index}`),
        ...(areaSqm === undefined ? {} : { area_sqm: areaSqm }),
        ...(occupantCount === undefined ? {} : { occupant_count: occupantCount }),
        metadata_status: node.metadata_status === "confirmed" ? "confirmed" : "provisional",
        ...(effectiveFrom ? { effective_from: effectiveFrom } : {}),
        ...(effectiveTo ? { effective_to: effectiveTo } : {}),
        ...(independentReason ? { independent_reason: independentReason } : {}),
        ...(metadata ? { metadata } : {})
      };
    }),
    ...(sourceManifest ? { source_manifest: sourceManifest } : {}),
    ...(meterMapping ? { meter_mapping: meterMapping } : {})
  };
};

const parseSourceManifest = (
  value: unknown,
): NonNullable<EnergyIqProjectSetupDocument["source_manifest"]> => {
  const manifest = requireRecord(value, "ENERGYIQ_SOURCE_MANIFEST_INVALID");
  if (!Array.isArray(manifest.source_sha256) || manifest.source_sha256.length === 0) {
    throw new Error("ENERGYIQ_SOURCE_MANIFEST_REQUIRED");
  }
  const sourceSha256 = manifest.source_sha256.map((candidate, index) => {
    const sha256 = requireNonEmptyString(
      candidate,
      `ENERGYIQ_SOURCE_MANIFEST_SHA_REQUIRED:${index}`,
    ).toLocaleLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sha256)) {
      throw new Error(`ENERGYIQ_SOURCE_MANIFEST_SHA_INVALID:${index}`);
    }
    return sha256;
  });
  return createEnergyIqSourceManifest(sourceSha256, manifest.confirmed === true);
};

const parseTariffScheduleEntries = (value: unknown): EnergyIqTariffScheduleEntry[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("ENERGYIQ_TARIFF_ENTRIES_REQUIRED");
  }
  return value.map((candidate, index) => {
    const entry = requireRecord(candidate, `ENERGYIQ_TARIFF_ENTRY_INVALID:${index}`);
    const effectiveTo = optionalString(entry.effectiveTo);
    return {
      id: `tariff-entry-${randomUUID()}`,
      owner: parsePolicyOwner(entry.owner, `ENERGYIQ_TARIFF_OWNER_INVALID:${index}`),
      effective_from: requireNonEmptyString(
        entry.effectiveFrom,
        `ENERGYIQ_TARIFF_EFFECTIVE_FROM_REQUIRED:${index}`,
      ),
      ...(effectiveTo ? { effective_to: effectiveTo } : {}),
      currency: requireNonEmptyString(entry.currency, `ENERGYIQ_TARIFF_CURRENCY_REQUIRED:${index}`).toUpperCase(),
      rate_per_kwh: requirePositiveNumber(entry.ratePerKwh, `ENERGYIQ_TARIFF_RATE_INVALID:${index}`),
    };
  });
};

const OPERATING_POLICY_DAYS: EnergyIqOperatingDay[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const parseOperatingCalendarEntries = (value: unknown): EnergyIqOperatingCalendarEntry[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("ENERGYIQ_OPERATING_CALENDAR_ENTRIES_REQUIRED");
  }
  return value.map((candidate, index) => {
    const entry = requireRecord(candidate, `ENERGYIQ_OPERATING_CALENDAR_ENTRY_INVALID:${index}`);
    const effectiveTo = optionalString(entry.effectiveTo);
    const weekly = requireRecord(entry.weekly, `ENERGYIQ_OPERATING_WEEKLY_REQUIRED:${index}`);
    const parsedWeekly = Object.fromEntries(OPERATING_POLICY_DAYS.map((day) => [
      day,
      parseOperatingTimeRanges(weekly[day], `ENERGYIQ_OPERATING_DAY_INVALID:${index}:${day}`),
    ])) as Record<EnergyIqOperatingDay, EnergyIqOperatingTimeRange[]>;
    const exceptions = entry.exceptions === undefined
      ? undefined
      : parseOperatingExceptions(entry.exceptions, index);
    return {
      id: `calendar-entry-${randomUUID()}`,
      owner: parsePolicyOwner(entry.owner, `ENERGYIQ_OPERATING_OWNER_INVALID:${index}`),
      effective_from: requireNonEmptyString(
        entry.effectiveFrom,
        `ENERGYIQ_OPERATING_EFFECTIVE_FROM_REQUIRED:${index}`,
      ),
      ...(effectiveTo ? { effective_to: effectiveTo } : {}),
      weekly: parsedWeekly,
      ...(exceptions ? { exceptions } : {}),
    };
  });
};

const parsePolicyOwner = (value: unknown, message: string): EnergyIqPolicyOwner => {
  const owner = requireRecord(value, message);
  if (owner.kind === "project") return { kind: "project" };
  if (owner.kind === "scope") {
    return {
      kind: "scope",
      scope_id: requireNonEmptyString(owner.scopeId, `${message}:SCOPE_REQUIRED`),
    };
  }
  throw new Error(message);
};

const parseOperatingTimeRanges = (
  value: unknown,
  message: string,
): EnergyIqOperatingTimeRange[] => {
  if (!Array.isArray(value)) throw new Error(message);
  return value.map((candidate, index) => {
    const range = requireRecord(candidate, `${message}:${index}`);
    return {
      from: requireNonEmptyString(range.from, `${message}:${index}:FROM_REQUIRED`),
      to: requireNonEmptyString(range.to, `${message}:${index}:TO_REQUIRED`),
    };
  });
};

const parseOperatingExceptions = (
  value: unknown,
  entryIndex: number,
): NonNullable<EnergyIqOperatingCalendarEntry["exceptions"]> => {
  if (!Array.isArray(value)) {
    throw new Error(`ENERGYIQ_OPERATING_EXCEPTIONS_INVALID:${entryIndex}`);
  }
  return value.map((candidate, exceptionIndex) => {
    const exception = requireRecord(
      candidate,
      `ENERGYIQ_OPERATING_EXCEPTION_INVALID:${entryIndex}:${exceptionIndex}`,
    );
    const label = optionalString(exception.label);
    return {
      date: requireNonEmptyString(
        exception.date,
        `ENERGYIQ_OPERATING_EXCEPTION_DATE_REQUIRED:${entryIndex}:${exceptionIndex}`,
      ),
      operating: parseOperatingTimeRanges(
        exception.operating,
        `ENERGYIQ_OPERATING_EXCEPTION_RANGES_INVALID:${entryIndex}:${exceptionIndex}`,
      ),
      ...(label ? { label } : {}),
    };
  });
};

const parseTemplateDraftDocument = (value: unknown): EnergyIqTemplateDraftDocument => {
  const document = requireRecord(value, "ENERGYIQ_TEMPLATE_DOCUMENT_INVALID");
  if (!Array.isArray(document.templates)) throw new Error("ENERGYIQ_TEMPLATE_DOCUMENT_INVALID");
  if (document.schema_version !== undefined && document.schema_version !== 2) {
    throw new Error("ENERGYIQ_TEMPLATE_SCHEMA_VERSION_INVALID");
  }
  return {
    schema_version: 2,
    templates: document.templates.map((value, templateIndex) => {
      const template = requireRecord(value, `ENERGYIQ_TEMPLATE_INVALID:${templateIndex}`);
      if (!Array.isArray(template.components)) {
        throw new Error(`ENERGYIQ_TEMPLATE_COMPONENTS_INVALID:${templateIndex}`);
      }
      const targetKind = template.target_kind;
      if (targetKind !== "project" && targetKind !== "tier") {
        throw new Error(`ENERGYIQ_TEMPLATE_TARGET_INVALID:${templateIndex}`);
      }
      const tierDefinitionId = optionalString(template.tier_definition_id);
      const sections = Array.isArray(template.sections)
        ? template.sections.map((value, sectionIndex) => {
            const section = requireRecord(value, `ENERGYIQ_TEMPLATE_SECTION_INVALID:${templateIndex}:${sectionIndex}`);
            const description = optionalString(section.description);
            return {
              section_id: requireNonEmptyString(section.section_id, `ENERGYIQ_TEMPLATE_SECTION_ID_REQUIRED:${templateIndex}:${sectionIndex}`),
              title: requireNonEmptyString(section.title, `ENERGYIQ_TEMPLATE_SECTION_TITLE_REQUIRED:${templateIndex}:${sectionIndex}`),
              navigation_label: requireNonEmptyString(section.navigation_label, `ENERGYIQ_TEMPLATE_SECTION_NAVIGATION_REQUIRED:${templateIndex}:${sectionIndex}`),
              ...(description ? { description } : {}),
            };
          })
        : undefined;
      return {
        template_id: requireNonEmptyString(template.template_id, `ENERGYIQ_TEMPLATE_ID_REQUIRED:${templateIndex}`),
        target_kind: targetKind,
        ...(tierDefinitionId ? { tier_definition_id: tierDefinitionId } : {}),
        ...(sections ? { sections } : {}),
        components: template.components.map((value, componentIndex) => {
          const component = requireRecord(
            value,
            `ENERGYIQ_TEMPLATE_COMPONENT_INVALID:${templateIndex}:${componentIndex}`,
          );
          const placementId = optionalString(component.placement_id);
          const sectionId = optionalString(component.section_id);
          const layout = component.layout === undefined
            ? undefined
            : parseTemplateLayout(component.layout, templateIndex, componentIndex);
          const presentation = component.presentation === undefined
            ? undefined
            : parseTemplatePresentation(component.presentation, templateIndex, componentIndex);
          return {
            ...(placementId ? { placement_id: placementId } : {}),
            component_revision_id: requireNonEmptyString(
              component.component_revision_id,
              `ENERGYIQ_TEMPLATE_COMPONENT_ID_REQUIRED:${templateIndex}:${componentIndex}`,
            ),
            enabled: component.enabled === true,
            ...(sectionId ? { section_id: sectionId } : {}),
            ...(layout ? { layout } : {}),
            ...(presentation ? { presentation } : {}),
          };
        }),
      };
    }),
  };
};

const parseTemplateLayout = (
  value: unknown,
  templateIndex: number,
  componentIndex: number,
): NonNullable<EnergyIqTemplateDraftDocument["templates"][number]["components"][number]["layout"]> => {
  const layout = requireRecord(value, `ENERGYIQ_TEMPLATE_LAYOUT_INVALID:${templateIndex}:${componentIndex}`);
  const span = layout.span;
  const height = layout.height;
  if (span !== 4 && span !== 6 && span !== 8 && span !== 12) {
    throw new Error(`ENERGYIQ_TEMPLATE_LAYOUT_SPAN_INVALID:${templateIndex}:${componentIndex}`);
  }
  if (height !== "compact" && height !== "standard" && height !== "tall") {
    throw new Error(`ENERGYIQ_TEMPLATE_LAYOUT_HEIGHT_INVALID:${templateIndex}:${componentIndex}`);
  }
  return { span, height };
};

const parseTemplatePresentation = (
  value: unknown,
  templateIndex: number,
  componentIndex: number,
): NonNullable<EnergyIqTemplateDraftDocument["templates"][number]["components"][number]["presentation"]> => {
  const presentation = requireRecord(value, `ENERGYIQ_TEMPLATE_PRESENTATION_INVALID:${templateIndex}:${componentIndex}`);
  const visualPreset = presentation.visual_preset;
  const density = presentation.density;
  const tone = presentation.tone;
  const limit = requireInteger(presentation.limit, `ENERGYIQ_TEMPLATE_LIMIT_REQUIRED:${templateIndex}:${componentIndex}`);
  if (visualPreset !== "auto" && visualPreset !== "cards" && visualPreset !== "bar" && visualPreset !== "area" && visualPreset !== "table" && visualPreset !== "list") {
    throw new Error(`ENERGYIQ_TEMPLATE_VISUAL_PRESET_INVALID:${templateIndex}:${componentIndex}`);
  }
  if (density !== "comfortable" && density !== "compact") {
    throw new Error(`ENERGYIQ_TEMPLATE_DENSITY_INVALID:${templateIndex}:${componentIndex}`);
  }
  if (tone !== "default" && tone !== "highlight" && tone !== "quiet") {
    throw new Error(`ENERGYIQ_TEMPLATE_TONE_INVALID:${templateIndex}:${componentIndex}`);
  }
  const title = optionalString(presentation.title);
  const description = optionalString(presentation.description);
  return {
    visual_preset: visualPreset,
    density,
    tone,
    show_legend: presentation.show_legend === true,
    limit,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
  };
};

const parseMeterMappingDraft = (
  value: unknown
): NonNullable<EnergyIqProjectSetupDocument["meter_mapping"]> => {
  const mapping = requireRecord(value, "ENERGYIQ_METER_MAPPING_INVALID");
  if (!Array.isArray(mapping.rows)) {
    throw new Error("ENERGYIQ_METER_MAPPING_ROWS_INVALID");
  }
  if (mapping.schema_version !== 2) {
    throw new Error("ENERGYIQ_METER_MAPPING_SCHEMA_UNSUPPORTED");
  }
  return {
    schema_version: 2,
    source_kind: mapping.source_kind === "tuya" ? "tuya" : "excel",
    confirmed: mapping.confirmed === true,
    rows: mapping.rows.map((value, index) => {
      const row = requireRecord(value, `ENERGYIQ_METER_MAPPING_ROW_INVALID:${index}`);
      const category = row.category;
      const coverage = row.coverage;
      const meterRole = row.meter_role;
      const aggregationUsage = row.aggregation_usage;
      if (row.resource !== "electricity" && row.resource !== "water") {
        throw new Error(`ENERGYIQ_METER_RESOURCE_INVALID:${index}`);
      }
      if (category !== "overall" && category !== "load" && category !== "light" && category !== "aircon" && category !== "other") {
        throw new Error(`ENERGYIQ_METER_CATEGORY_INVALID:${index}`);
      }
      if (coverage !== "whole" && coverage !== "partial" && coverage !== "reference") {
        throw new Error(`ENERGYIQ_METER_COVERAGE_INVALID:${index}`);
      }
      if (meterRole !== "total" && meterRole !== "component" && meterRole !== "standalone") {
        throw new Error(`ENERGYIQ_METER_ROLE_INVALID:${index}`);
      }
      if (aggregationUsage !== "official" && aggregationUsage !== "excluded") {
        throw new Error(`ENERGYIQ_AGGREGATION_USAGE_INVALID:${index}`);
      }
      return {
        id: requireNonEmptyString(row.id, `ENERGYIQ_METER_MAPPING_ID_REQUIRED:${index}`),
        source_label: requireNonEmptyString(row.source_label, `ENERGYIQ_SOURCE_LABEL_REQUIRED:${index}`),
        scope_id: requireNonEmptyString(row.scope_id, `ENERGYIQ_METER_SCOPE_REQUIRED:${index}`),
        ...(typeof row.navigation_scope_id === "string" && row.navigation_scope_id.trim()
          ? { navigation_scope_id: row.navigation_scope_id.trim() }
          : {}),
        display_name: requireNonEmptyString(row.display_name, `ENERGYIQ_METER_NAME_REQUIRED:${index}`),
        resource: row.resource,
        category,
        coverage,
        meter_role: meterRole,
        aggregation_usage: aggregationUsage
      };
    }),
    ...(Array.isArray(mapping.official_aggregation_routes) ? {
      official_aggregation_routes: mapping.official_aggregation_routes.map((value, index) => {
        const route = requireRecord(value, `ENERGYIQ_OFFICIAL_ROUTE_INVALID:${index}`);
        if (!Array.isArray(route.meter_point_ids)) {
          throw new Error(`ENERGYIQ_OFFICIAL_ROUTE_METERS_INVALID:${index}`);
        }
        const category = route.category;
        if (route.resource !== "electricity" && route.resource !== "water") {
          throw new Error(`ENERGYIQ_OFFICIAL_ROUTE_RESOURCE_INVALID:${index}`);
        }
        if (category !== "overall" && category !== "load" && category !== "light" && category !== "aircon" && category !== "other") {
          throw new Error(`ENERGYIQ_OFFICIAL_ROUTE_CATEGORY_INVALID:${index}`);
        }
        return {
          scope_id: requireNonEmptyString(route.scope_id, `ENERGYIQ_OFFICIAL_ROUTE_SCOPE_REQUIRED:${index}`),
          resource: route.resource,
          category,
          meter_point_ids: route.meter_point_ids.map((meterPointId, memberIndex) =>
            requireNonEmptyString(meterPointId, `ENERGYIQ_OFFICIAL_ROUTE_METER_REQUIRED:${index}:${memberIndex}`))
        };
      })
    } : {}),
    ...(Array.isArray(mapping.virtual_meters) ? {
      virtual_meters: mapping.virtual_meters.map((value, index) => {
        const virtualMeter = requireRecord(value, `ENERGYIQ_VIRTUAL_METER_INVALID:${index}`);
        if (!Array.isArray(virtualMeter.terms)) {
          throw new Error(`ENERGYIQ_VIRTUAL_METER_TERMS_INVALID:${index}`);
        }
        const category = virtualMeter.category;
        if (category !== "overall" && category !== "load" && category !== "light" && category !== "aircon" && category !== "other") {
          throw new Error(`ENERGYIQ_VIRTUAL_METER_CATEGORY_INVALID:${index}`);
        }
        return {
          id: requireNonEmptyString(virtualMeter.id, `ENERGYIQ_VIRTUAL_METER_ID_REQUIRED:${index}`),
          display_name: requireNonEmptyString(virtualMeter.display_name, `ENERGYIQ_VIRTUAL_METER_NAME_REQUIRED:${index}`),
          scope_id: requireNonEmptyString(virtualMeter.scope_id, `ENERGYIQ_VIRTUAL_METER_SCOPE_REQUIRED:${index}`),
          resource: virtualMeter.resource === "water" ? "water" as const : "electricity" as const,
          category,
          terms: virtualMeter.terms.map((value, termIndex) => {
            const term = requireRecord(value, `ENERGYIQ_VIRTUAL_METER_TERM_INVALID:${index}:${termIndex}`);
            return {
              mapping_row_id: requireNonEmptyString(term.mapping_row_id, `ENERGYIQ_VIRTUAL_METER_TERM_ID_REQUIRED:${index}:${termIndex}`),
              coefficient: term.coefficient === -1 ? -1 as const : 1 as const
            };
          })
        };
      })
    } : {})
  };
};

const requireRecord = (
  value: unknown,
  message = "ENERGYIQ_INVALID_BODY"
): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error(message);
  }
  return value;
};

const requireNonEmptyString = (value: unknown, message: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(message);
  }
  return value.trim();
};

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const optionalNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const requirePositiveNumber = (value: unknown, message: string): number => {
  const number = optionalNumber(value);
  if (number === undefined || number <= 0) throw new Error(message);
  return number;
};

const requireInteger = (value: unknown, message: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(message);
  }
  return value;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
