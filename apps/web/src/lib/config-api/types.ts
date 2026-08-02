import type { EvidenceRef } from "@datafoundry/contracts";

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "CONFLICT"
  | "DATASOURCE_TEST_FAILED"
  | "EMAIL_NOT_VERIFIED"
  | "FORBIDDEN"
  | "INTERNAL_ERROR"
  | "JOB_NOT_FOUND"
  | "NOT_ENABLED"
  | "PARSE_FAILED"
  | "PROVIDER_CONFIG_MISSING"
  | "PROVIDER_RATE_LIMITED"
  | "RATE_LIMITED"
  | "PROVIDER_TEST_FAILED"
  | "REINDEX_REQUIRED"
  | "RESOURCE_NOT_FOUND"
  | "REVISION_CONFLICT"
  | "SECRET_MASTER_KEY_REQUIRED"
  | "SQL_BLOCKED"
  | "SQL_TIMEOUT"
  | "UNAUTHORIZED"
  | "UNSUPPORTED_FILE_TYPE";

export type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: ApiErrorCode; message: string } };

export class ConfigApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;

  constructor(code: ApiErrorCode, message: string, status: number) {
    super(message);
    this.name = "ConfigApiError";
    this.code = code;
    this.status = status;
  }
}

export type DevIdentityUser = {
  id: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
  devToken?: string;
};

export type IdentityWorkspace = {
  id: string;
  name?: string;
};

export type MeResponseDto = {
  user: DevIdentityUser;
  workspace: IdentityWorkspace;
};

export type EnergyRole = "user" | "admin";

export type EnergyWorkspaceDto = {
  id: string;
  name: string;
  kind: "personal" | "customer";
  disabled: boolean;
};

export type EnergyAdminOrganisationDto = {
  id: string;
  name: string;
  status: "active" | "disabled";
  userCount: number;
  projectCount: number;
  projects: Array<{ id: string; name: string; status: string }>;
  createdAt: string;
};

export type EnergyAdminUserDto = {
  id: string;
  displayName?: string;
  email?: string;
  role: EnergyRole;
  status: "pending" | "active" | "disabled";
  organisationIds: string[];
  organisations: Array<{ id: string; name: string }>;
  projectIds: string[];
  lastLoginAt?: string;
  createdAt: string;
};

export type EnergyProjectDto = {
  id: string;
  workspaceId: string;
  name: string;
  status: "draft" | "published" | "archived";
  timezone: string;
};

export type EnergyDeliveryStage = "draft" | "configured" | "published";

export type EnergyProjectRecordDto = {
  id: string;
  workspace_id: string;
  name: string;
  status: "draft" | "published" | "archived";
  timezone: string;
  hierarchy_revision_id: string;
  meter_formula_revision_id: string;
  data_snapshot_id: string;
  metric_version: string;
  business_calendar_version: string;
  tariff_schedule_version: string;
  delivery_stage: EnergyDeliveryStage;
  root_scope_id: string;
  has_unpublished_changes: boolean;
};

export type EnergyTierDefinitionDto = {
  id: string;
  ordinal: number;
  alias: string;
  description?: string;
};

export type EnergyProjectSetupNodeDto = {
  id: string;
  tier_definition_id: string;
  parent_id?: string;
  name: string;
  sort_order: number;
  area_sqm?: number;
  occupant_count?: number;
  metadata_status: "provisional" | "confirmed";
  effective_from?: string;
  effective_to?: string;
  independent_reason?: string;
  metadata?: Record<string, unknown>;
};

export type EnergyMeterCategoryDto = "overall" | "load" | "light" | "aircon" | "other";
export type EnergyMeterCoverageDto = "whole" | "partial" | "reference";
export type EnergyMeterRoleDto = "total" | "component" | "standalone";
export type EnergyAggregationUsageDto = "official" | "excluded";

export type EnergyMeterMappingRowDto = {
  id: string;
  source_label: string;
  scope_id: string;
  display_name: string;
  resource: "electricity" | "water";
  category: EnergyMeterCategoryDto;
  coverage: EnergyMeterCoverageDto;
  meter_role: EnergyMeterRoleDto;
  aggregation_usage: EnergyAggregationUsageDto;
};

export type EnergyVirtualMeterTermDto = {
  mapping_row_id: string;
  coefficient: 1 | -1;
};

export type EnergyVirtualMeterDto = {
  id: string;
  display_name: string;
  scope_id: string;
  resource: "electricity" | "water";
  category: EnergyMeterCategoryDto;
  terms: EnergyVirtualMeterTermDto[];
};

export type EnergyMeterMappingDraftDto = {
  source_kind: "excel" | "tuya";
  rows: EnergyMeterMappingRowDto[];
  virtual_meters?: EnergyVirtualMeterDto[];
  confirmed: boolean;
};

export type EnergyExcelImportInspectionDto = {
  columns: string[];
  sourceLabels: Array<{ label: string; rowCount: number }>;
  rowCount: number;
  validRowCount: number;
  invalidRowCount: number;
  duplicateReadingCount: number;
  negativeReadingCount: number;
  coverageFrom?: string;
  coverageTo?: string;
  typicalIntervalMinutes?: number;
  readingKind: "cumulative";
  qualityStatus: "ready" | "needs_review";
  issues: string[];
};

export type EnergyImportBatchDto = {
  id: string;
  projectId: string;
  sourceKind: "excel" | "tuya";
  sourceSha256: string;
  filename: string;
  status: "inspected" | "materialized" | "failed";
  inspection: EnergyExcelImportInspectionDto;
  materialization?: {
    snapshotId: string;
    rawRowCount: number;
    normalizedReadingCount: number;
    intervalFactCount: number;
    totalUsageKwh: number;
    qualityCounts: Record<string, number>;
  };
  materializedAt?: string;
  createdAt: string;
};

export type EnergyProjectSetupDocumentDto = {
  project: { name: string; timezone: string };
  tier_structure_locked: boolean;
  tiers: EnergyTierDefinitionDto[];
  nodes: EnergyProjectSetupNodeDto[];
  meter_mapping?: EnergyMeterMappingDraftDto;
};

export type EnergyProjectSetupDraftDto = {
  project_id: string;
  revision: number;
  based_on_hierarchy_revision_id?: string;
  document: EnergyProjectSetupDocumentDto;
  updated_by: string;
  updated_at: string;
};

export type EnergyProjectSetupIssueDto = {
  code: string;
  severity: "error" | "warning";
  message: string;
  path?: string;
};

export type EnergyProjectSetupValidationDto = {
  blocking: boolean;
  issues: EnergyProjectSetupIssueDto[];
};

export type EnergyHierarchyRevisionDto = {
  id: string;
  project_id: string;
  sequence: number;
  published_by: string;
  published_at: string;
};

export type EnergyProjectSetupDto = {
  project: EnergyProjectRecordDto;
  draft: EnergyProjectSetupDraftDto;
  validation: EnergyProjectSetupValidationDto;
  published: {
    tiers: EnergyTierDefinitionDto[];
    nodes: EnergyProjectNodeDto[];
    revisions: EnergyHierarchyRevisionDto[];
  };
};

export type EnergyAccessContextDto = {
  role: EnergyRole;
  user: {
    id: string;
    email?: string;
    displayName?: string;
  };
  activeWorkspaceId: string;
  workspaces: EnergyWorkspaceDto[];
  projects: EnergyProjectDto[];
};

export type EnergyQueryContextRequestDto = {
  projectId: string;
  scopeId?: string;
  resource?: "electricity" | "water";
  period?: "Yesterday" | "Last 7 days" | "Last 30 days" | "Custom";
  from?: string;
  to?: string;
};

export type EnergyQueryContextDto = {
  userId: string;
  workspaceId: string;
  projectId: string;
  projectName: string;
  scopeId: string;
  scopeName: string;
  scopeType: string;
  resource: "electricity" | "water";
  timezone: string;
  from: string;
  to: string;
  endExclusive: true;
  period: EnergyQueryContextRequestDto["period"];
  hierarchyRevisionId: string;
  meterFormulaRevisionId: string;
  dataSnapshotId: string;
  metricVersion: string;
  businessCalendarVersion: string;
  tariffScheduleVersion: string;
  resolvedAt: string;
};

export type EnergyScopeAnalysisDto = {
  context: EnergyQueryContextDto;
  summary: {
    usageKwh: number;
    averageDailyUsageKwh: number;
    costSgd: number;
    peakKw: number;
    nonOperatingKwh: number;
    nonOperatingSharePct: number;
    areaSqm?: number;
    occupantCount?: number;
    kwhPerSqm?: number;
    kwhPerPerson?: number;
    validIntervalCount: number;
    qualityEventCount: number;
  };
  hourlyProfile: Array<{
    hour: number;
    averageKw: number;
    peakKw: number;
  }>;
  childScopes: Array<{
    nodeId: string;
    name: string;
    nodeType: string;
    usageKwh: number;
    sharePct: number;
    areaSqm?: number;
    occupantCount?: number;
    kwhPerSqm?: number;
    kwhPerPerson?: number;
    topCircuitName?: string;
    topCircuitUsageKwh?: number;
  }>;
  circuits: Array<{
    meterNodeId: string;
    name: string;
    appliance: string;
    category: string;
    meterRole: string;
    usageKwh: number;
    sharePct: number;
    nonOperatingKwh: number;
    peakKw: number;
    qualityEventCount: number;
  }>;
  attention: Array<{
    code: string;
    severity: "info" | "warning";
    title: string;
    evidence: string;
    suggestedAction: string;
  }>;
  provenance: {
    dataSnapshotId: string;
    hierarchyRevisionId: string;
    meterFormulaRevisionId: string;
    metricVersion: string;
    ruleRevisionIds: string[];
    aggregationRule: "designated_total" | "component" | "submeter" | "none";
    sourceView: string;
    queryIds: ["scope_summary_v1", "hourly_profile_v1", "meter_breakdown_v1"];
  };
};

export type EnergyProjectNodeDto = {
  id: string;
  project_id: string;
  parent_id?: string;
  name: string;
  node_type: string;
  tier_definition_id?: string;
  hierarchy_revision_id?: string;
  sort_order: number;
  area_sqm?: number;
  occupant_count?: number;
  metadata_json?: string;
  metadata_status: "provisional" | "confirmed";
  effective_from?: string;
  effective_to?: string;
  independent_reason?: string;
};

export type EnergyProjectHierarchyDto = {
  project: {
    id: string;
    name: string;
    hierarchy_revision_id: string;
  };
  tiers: EnergyTierDefinitionDto[];
  nodes: EnergyProjectNodeDto[];
};

export type EnergyMetricFamilyDto = "aggregate" | "time" | "normalised" | "quality";
export type EnergyMetricRequirementDto = "always" | "area" | "people";

export type EnergyMetricRevisionDto = {
  revision_id: string;
  metric_id: string;
  version: number;
  display_name: string;
  description: string;
  family: EnergyMetricFamilyDto;
  unit: string;
  value_type: "number";
  calculation_key: string;
  requirement: EnergyMetricRequirementDto;
  created_at: string;
};

export type EnergyProjectMetricConfigDto = {
  project_id: string;
  revision: number;
  selected_metric_revision_ids: string[];
  updated_by?: string;
  created_at?: string;
  updated_at?: string;
};

export type EnergyProjectMetricConfigResponseDto = {
  catalog: EnergyMetricRevisionDto[];
  config: EnergyProjectMetricConfigDto;
};

export type EnergyRuleFamilyDto = "data_quality" | "time" | "comparison";
export type EnergyRuleRequirementDto = "always" | "operating_hours" | "children" | "area_peers" | "people_peers";

export type EnergyRuleRevisionDto = {
  revision_id: string;
  rule_id: string;
  version: number;
  display_name: string;
  description: string;
  family: EnergyRuleFamilyDto;
  severity: "info" | "warning";
  evaluation_key: string;
  metric_revision_ids: string[];
  parameters: Record<string, number | string>;
  requirement: EnergyRuleRequirementDto;
  created_at: string;
};

export type EnergyProjectRuleConfigDto = {
  project_id: string;
  revision: number;
  selected_rule_revision_ids: string[];
  updated_by?: string;
  created_at?: string;
  updated_at?: string;
};

export type EnergyProjectRuleConfigResponseDto = {
  catalog: EnergyRuleRevisionDto[];
  config: EnergyProjectRuleConfigDto;
};

export type EnergyComponentFamilyDto = "decision" | "overview" | "comparison" | "time" | "composition" | "quality" | "evidence";
export type EnergyComponentTargetDto = "project" | "tier" | "both";
export type EnergyComponentRequirementDto = "always" | "rules" | "operating_hours" | "children" | "area_peers" | "people_peers" | "meter_breakdown";

export type EnergyComponentRevisionDto = {
  revision_id: string;
  component_id: string;
  version: number;
  display_name: string;
  description: string;
  family: EnergyComponentFamilyDto;
  view_key: string;
  target: EnergyComponentTargetDto;
  metric_revision_ids: string[];
  rule_revision_ids: string[];
  query_ids: string[];
  requirement: EnergyComponentRequirementDto;
  created_at: string;
};

export type EnergyTemplateComponentPlacementDto = {
  component_revision_id: string;
  enabled: boolean;
};

export type EnergyTemplateDefinitionDto = {
  template_id: string;
  target_kind: "project" | "tier";
  tier_definition_id?: string;
  components: EnergyTemplateComponentPlacementDto[];
};

export type EnergyTemplateDraftDocumentDto = {
  templates: EnergyTemplateDefinitionDto[];
};

export type EnergyProjectTemplateDraftDto = {
  project_id: string;
  revision: number;
  document: EnergyTemplateDraftDocumentDto;
  updated_by?: string;
  created_at?: string;
  updated_at?: string;
};

export type EnergyProjectTemplateDraftResponseDto = {
  catalog: EnergyComponentRevisionDto[];
  draft: EnergyProjectTemplateDraftDto;
};

export type DevIdentitiesResponseDto = {
  users: DevIdentityUser[];
  currentUserId: string;
  workspace: IdentityWorkspace;
};

export type BackendCapabilitiesResponse = {
  "artifact.export"?: boolean;
  "artifact.list"?: boolean;
  "artifact.promote"?: boolean;
  "chat.fileUpload"?: boolean;
  "chat.imageInput"?: boolean;
  "conversation.memory"?: boolean;
  "conversation.title"?: boolean;
  "interaction.resume"?: boolean;
  "datasource.fieldMasking"?: boolean;
  "datasource.extendedTypes"?: boolean;
  "datasource.introspectionPolicy"?: boolean;
  "datasource.queryPolicy"?: boolean;
  "datasource.samplePolicy"?: boolean;
  "datasource.server"?: boolean;
  "kb.chunking"?: boolean;
  "kb.citationPolicy"?: boolean;
  "kb.scope"?: boolean;
  "llm.advancedSampling"?: boolean;
  "mcp.stdio"?: boolean;
  "mcp.toolPolicy"?: boolean;
  "skill.resourceBinding"?: boolean;
  "llm.samplingParams"?: boolean;
  knowledge?: boolean;
  mcp?: boolean;
  skills?: boolean;
  files?: boolean;
};

export type FileAssetRefDto = {
  id: string;
  assetId?: string;
  filename: string;
  mimeType?: string;
  sizeBytes?: number;
  sha256?: string;
  source?: string;
  origin?: string;
  scope?: "session" | "workspace";
  status?: string;
  sessionId?: string;
  runId?: string;
  createdAt?: string;
};

export type DatasourceDto = {
  id: string;
  name: string;
  description?: string;
  type: string;
  mode?: string;
  config?: Record<string, unknown>;
  secretRef?: string | null;
  hasSecret?: boolean;
  defaultEnabled?: boolean;
  builtin?: boolean;
  connectionStatus?: string;
  revision?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type DatasourceTypeParamDto = {
  name: string;
  label: string;
  type: "string" | "password" | "select" | "number" | "boolean" | "file";
  required: boolean;
  default_value?: string | number | boolean;
  options?: string[];
};

export type DatasourceTypeDto = {
  name: string;
  label: string;
  enabled: boolean;
  description?: string;
  parameters: DatasourceTypeParamDto[];
};

export type KnowledgeBaseDto = {
  id: string;
  name: string;
  description?: string;
  retrievalTopK?: number;
  scoreThreshold?: number;
  embeddingProvider?: string;
  embeddingModel?: string;
  embeddingBaseUrl?: string;
  citationRequired?: boolean;
  chunkOverlap?: number;
  chunkSize?: number;
  graphRagEnabled?: boolean;
  rerankEnabled?: boolean;
  rerankModel?: string;
  scope?: string;
  vectorStore?: string;
  secretRef?: string | null;
  hasSecret?: boolean;
  defaultEnabled?: boolean;
  builtin?: boolean;
  indexStatus?: string;
  revision?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type KnowledgeDocumentDto = {
  id: string;
  userId?: string;
  collectionId?: string;
  filename: string;
  fileAssetRefId?: string;
  mimeType?: string;
  status: string;
};

export type McpServerDto = {
  id: string;
  name: string;
  description?: string;
  transport?: string;
  serverUrl?: string;
  apiUrl?: string;
  authType?: string;
  toolManifest?: unknown[];
  toolAllowlist?: string[] | string;
  timeoutMs?: number;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  secretRef?: string | null;
  hasSecret?: boolean;
  defaultEnabled?: boolean;
  builtin?: boolean;
  healthStatus?: string;
  revision?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type DatalinkServerDto = {
  id: string;
  name: string;
  description?: string;
  healthStatus?: string;
  serverUrl?: string;
  apiUrl?: string;
  transport?: string;
  toolCount?: number;
  toolNames?: string[];
  updatedAt?: string;
};

export type DatalinkNodeDto = {
  id: string;
  type: string;
  name?: string;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
};

export type DatalinkEdgeDto = {
  id: string;
  source_id?: string;
  source?: string;
  target_id?: string;
  target?: string;
  type: string;
  confidence?: number;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
};

export type DatalinkGraphDto = {
  nodes: DatalinkNodeDto[];
  edges: DatalinkEdgeDto[];
};

export type DatalinkServersResponseDto = {
  servers: DatalinkServerDto[];
};

export type DatalinkGraphResponseDto = {
  graph: DatalinkGraphDto;
  server: DatalinkServerDto;
};

export type DatalinkToolResponseDto = {
  result: string;
  server: DatalinkServerDto;
};

export type ModelProfileDto = {
  id: string;
  name: string;
  description?: string;
  provider?: string;
  modelName?: string;
  baseUrl?: string;
  fallbackProfileId?: string;
  frequencyPenalty?: number;
  maxTokens?: number;
  presencePenalty?: number;
  contextLength?: number;
  reasoningModel?: boolean;
  temperature?: number;
  topP?: number;
  timeoutMs?: number;
  secretRef?: string | null;
  hasSecret?: boolean;
  defaultEnabled?: boolean;
  builtin?: boolean;
  connectionStatus?: string;
  revision?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type SkillDto = {
  id: string;
  name: string;
  description?: string;
  allowedTools?: string[];
  version?: string;
  packageFileRefId?: string;
  packageFileName?: string;
  packageFormat?: "skill-md" | "zip";
  packageSource?: string;
  manifest?: Record<string, unknown>;
  defaultDbIds?: string[];
  defaultKbIds?: string[];
  defaultMcpIds?: string[];
  modelProfileId?: string;
  secretRef?: string | null;
  hasSecret?: boolean;
  defaultEnabled?: boolean;
  builtin?: boolean;
  validationStatus?: string;
  revision?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type WorkspaceConfigDto = {
  datasources: DatasourceDto[];
  knowledgeBases: KnowledgeBaseDto[];
  mcpServers: McpServerDto[];
  modelProfiles: ModelProfileDto[];
  skills: SkillDto[];
};

export type RunDefaultsDto = {
  enabledDatasourceIds: string[];
  enabledKnowledgeIds: string[];
  enabledMcpServerIds: string[];
  enabledSkillIds: string[];
  activeDatasourceId?: string;
  activeLlmProfileId: string | null;
  activeSkillId: string;
};

export type ConversationMessageDto = {
  id: string;
  runId: string;
  role: "assistant" | "user";
  source: "agent" | "client";
  messageId?: string;
  contentText: string;
  contentParts?: Array<{ type: "reasoning" | "text"; text: string }>;
  evidenceRefs?: EvidenceRef[];
  position: number;
  createdAt: string;
};

export type ConversationSummaryDto = {
  id: string;
  sourceRunId?: string;
  fromPosition: number;
  toPosition: number;
  summaryText: string;
  createdAt: string;
};

export type ConversationRunEventRefDto = {
  runId: string;
  eventCount: number;
  firstSeq?: number;
  lastSeq?: number;
};

export type ConversationCheckpointDto = {
  runId: string;
  status: "queued" | "running" | "suspended" | "completed" | "failed" | "canceled";
  messageStartPosition?: number;
  messageEndPosition?: number;
  firstEventSeq?: number;
  lastEventSeq?: number;
  /** Absent for legacy event-only runs that have no `runs` row. */
  startedAt?: string;
  finishedAt?: string;
  errorMessage?: string;
  /** Canonical terminal event name for the run status ("RUN_FINISHED" | "RUN_ERROR"). */
  terminalEvent?: "RUN_FINISHED" | "RUN_ERROR";
  /** Authoritative ids of artifacts produced by this run (R-018). */
  artifactIds?: string[];
};

export type ConversationBranchDto = {
  sessionId: string;
  threadId?: string;
  parentSessionId: string;
  rootSessionId: string;
  forkRunId: string;
  forkCheckpointId?: string;
  forkMessageEndPosition: number;
  isOriginal?: boolean;
  createdAt: string;
  title?: string;
};

export type SessionBranchDto = {
  id: string;
  sessionId: string;
  threadId?: string;
  parentSessionId: string;
  rootSessionId: string;
  forkRunId: string;
  forkCheckpointId?: string;
  forkMessageEndPosition: number;
  createdAt: string;
  title?: string;
  session: SessionListItemDto;
};

export type ContextCheckpointDto = {
  id: string;
  sessionId: string;
  runId: string;
  branchId: string;
  eventSeq: number;
  contextPackageId: string;
  contextPackageRevision: number;
  kind: "context-compiled" | "run-terminal" | "tool-result";
  status: "stable" | "failed" | "terminal";
  label: string;
  contextPlanId?: string;
  parentCheckpointId?: string;
  stepNumber?: number;
  stepId?: string;
  toolCallId?: string;
  messagePosition?: number;
  createdAt: string;
};

export type TraceDagNodeKind =
  | "artifact"
  | "branch"
  | "context"
  | "run-start"
  | "run-terminal"
  | "tool"
  | "user-turn";

export type TraceDagContextDetailDto = {
  type: "context";
  assistantOutput?: string;
  budgetTokens?: number;
  decisions?: unknown[];
  inputBudget?: number;
  model?: string;
  modelProfileId?: string;
  omittedGroupIds?: string[];
  omittedSources?: unknown[];
  packageId?: string;
  packageRevision?: number;
  planId?: string;
  promptTokens?: number;
  reasoning?: string;
  remainingTokens?: number;
  selectedGroupIds?: string[];
  selectedSources?: unknown[];
  stepNumber?: number;
  tokenReport?: unknown;
  totalTokens?: number;
};

export type TraceDagToolDetailDto = {
  type: "tool";
  arguments?: unknown;
  argumentsText?: string;
  result?: unknown;
  resultText?: string;
  toolName?: string;
};

export type TraceDagArtifactDetailDto = {
  type: "artifact";
  artifactType?: string;
  mimeType?: string;
  name?: string;
  preview?: unknown;
};

export type TraceDagTerminalDetailDto = {
  type: "terminal";
  error?: string;
  message?: string;
};

export type TraceDagNodeDetailDto =
  | TraceDagArtifactDetailDto
  | TraceDagContextDetailDto
  | TraceDagTerminalDetailDto
  | TraceDagToolDetailDto;

export type TraceDagNodeDto = {
  id: string;
  kind: TraceDagNodeKind;
  label: string;
  artifactId?: string;
  checkpointId?: string;
  checkpointKind?: ContextCheckpointDto["kind"];
  checkpointStatus?: ContextCheckpointDto["status"];
  createdAt?: string;
  eventSeq?: number;
  messageId?: string;
  messagePosition?: number;
  prominent?: boolean;
  rollbackable?: boolean;
  runId?: string;
  sessionId?: string;
  status?: string;
  summary?: string;
  toolCallId?: string;
  detail?: TraceDagNodeDetailDto;
};

export type TraceDagEdgeKind =
  | "branches_from"
  | "continues_to"
  | "emits"
  | "produces_artifact"
  | "starts_run";

export type TraceDagEdgeDto = {
  id: string;
  source: string;
  target: string;
  kind: TraceDagEdgeKind;
  label?: string;
};

export type TraceDagDto = {
  sessionId: string;
  nodes: TraceDagNodeDto[];
  edges: TraceDagEdgeDto[];
  sections: TraceDagSectionDto[];
};

export type TraceDagSectionDto = {
  id: string;
  runId: string;
  phaseKey: string;
  status: "completed" | "failed" | "in-progress";
  title: string;
  summary: string;
  startEventSeq: number;
  endEventSeq: number;
  nodeIds: string[];
};

export type ConversationToolCallDto = {
  runId: string;
  id?: string;
  toolCallId: string;
  status: "completed" | "failed" | "pending";
  /** Authoritative "run is suspended waiting on this HITL tool" flag (R-018). */
  awaitingInteraction?: boolean;
  name?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  callEventSeq?: number;
  endEventSeq?: number;
  resultEventSeq?: number;
  parentMessageId?: string;
  resultMessageId?: string;
  resultPreview?: string;
};

export type RestorableCustomEventDto = {
  runId: string;
  seq: number;
  name: string;
  value: unknown;
};

export type PendingInteractionDto = {
  interactionId: string;
  runId: string;
  toolCallId: string;
  toolName: "ask_user" | "submit_plan";
  interruptEvent?: unknown;
  payload?: unknown;
  resumeSchema?: unknown;
};

export type SessionActiveRunDto = {
  sessionId: string;
  activeRunId: string;
  status: "queued" | "running" | "suspended";
  startedAt: string;
  userInputPreview: string;
};

export type SessionConversationDto = {
  sessionId: string;
  title?: string;
  titleSource?: string;
  updatedAt?: string;
  messages: ConversationMessageDto[];
  summary?: ConversationSummaryDto;
  runEventRefs: ConversationRunEventRefDto[];
  checkpoints?: ConversationCheckpointDto[];
  branch?: Omit<ConversationBranchDto, "isOriginal"> & { id: string };
  branches?: ConversationBranchDto[];
  toolCalls: ConversationToolCallDto[];
  pendingInteractions?: PendingInteractionDto[];
  restorableCustomEvents?: RestorableCustomEventDto[];
  activeRun?: SessionActiveRunDto | null;
};

export type SessionListItemDto = {
  id: string;
  threadId: string;
  title?: string;
  titleSource?: string;
  createdAt?: string;
  updatedAt?: string;
  lastMessageAt?: string;
  activeRun?: SessionActiveRunDto | null;
};

export type SessionListResponseDto = {
  sessions: SessionListItemDto[];
  nextCursor?: string;
};

export type SessionTitleDto = {
  sessionId: string;
  title: string;
  titleSource?: string;
  updatedAt?: string;
};

export type JobDto = {
  id: string;
  workspace_id?: string;
  user_id?: string;
  type: string;
  resource_id: string;
  resourceId?: string;
  artifactId?: string;
  status: "pending" | "running" | "completed" | "failed" | "canceled";
  progress: number;
  result?: Record<string, unknown>;
  created_at?: string;
  started_at?: string;
  finished_at?: string;
};

export type ArtifactExportFormat = "csv" | "xlsx";

export type RunCancelDto = {
  canceled: boolean;
  runId: string;
  sessionId?: string;
  persistedOnly?: boolean;
  reason?: string;
};

export type DatasourceSchemaColumnDto = {
  name: string;
  type?: string;
  nullable?: boolean;
  description?: string;
};

export type DatasourceSchemaTableDto = {
  name: string;
  table?: string;
  description?: string;
  sampleAvailable?: boolean;
  columns: DatasourceSchemaColumnDto[];
  stats?: {
    rowCount?: number;
    sizeBytes?: number;
  };
};

export type DatasourceSchemaDto = {
  datasourceId?: string;
  datasource_id?: string;
  tables: DatasourceSchemaTableDto[];
  inspectedAt?: string;
  adapterSchemaVersion?: number;
};

export type DatasourceTablePreviewColumnDto = {
  name: string;
  type?: string;
};

export type DatasourceTablePreviewDto = {
  columns: DatasourceTablePreviewColumnDto[];
  rows: Array<Record<string, unknown>>;
  total?: number;
  hasMore?: boolean;
};

export type QueryHistoryItemDto = {
  id: string;
  sessionId?: string;
  runId?: string;
  datasourceId?: string;
  sql: string;
  rowCount?: number;
  elapsedMs?: number;
  favorite?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type QueryHistoryListResponseDto = {
  queries: QueryHistoryItemDto[];
};

export type ArtifactDto = {
  id: string;
  type?: string;
  name?: string;
  fileId?: string;
  downloadUrl?: string;
  preview_json?: Record<string, unknown> | null;
  /** True when preview_json exists or a file-backed preview can be synthesized. */
  preview_available?: boolean;
  mimeType?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  /** For session-file outputs: `session_file:<path>`. */
  logicalKey?: string;
  /** Number of stored versions. 0 when no version records exist (legacy artifacts). */
  versionCount?: number;
  /** Authoritative origin (R-018): the producing run / tool call / step. */
  runId?: string;
  toolCallId?: string;
  stepId?: string;
};

export type ArtifactVersionDto = {
  id: string;
  version: number;
  fileId?: string;
  downloadUrl?: string;
  createdAt: string;
};
