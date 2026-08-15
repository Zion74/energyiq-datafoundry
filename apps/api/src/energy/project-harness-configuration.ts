import {
  STATIC_AGENT_TOOL_NAMES,
} from "@datafoundry/agent-runtime";
import {
  ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1,
  resolveCurrentAdditionalAiInsightMethodSet,
} from "@datafoundry/contracts";
import type {
  ConfigResourceRecord,
  MetadataStore,
  UserRecord,
} from "@datafoundry/metadata";
import { WORKSPACE_DEFAULT_MODEL_PROFILE_ID } from "@datafoundry/metadata";
import { configResourceToSkillRecord } from "@datafoundry/skills";

import {
  ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID,
  resolveModelProfileChain,
} from "../workspace-model-profile-resolver.js";
import { resolveConfiguredModelContextProfile } from "../run-config-resolver.js";
import { resolveProjectOverviewProfile } from "./project-analysis-resolver.js";

export type HarnessResourceAvailability = "configured" | "unavailable";

export type ProjectHarnessConfigurationState = {
  status: "available" | "partially-unavailable";
  detail: string;
  project: {
    id: string;
    name: string;
    workspaceId: string;
    rendererKey: "ngee-ann-overview" | "preschool-overview" | null;
  };
  resources: {
    models: HarnessModelSummary[];
    skills: HarnessSkillSummary[];
    methods: HarnessMethodSummary[];
    tools: HarnessToolSummary[];
    mcpServers: HarnessMcpServerSummary[];
  };
  harnesses: HarnessSummary[];
  unavailable: Array<{ id: string; detail: string }>;
};

export type HarnessModelSummary = {
  id: string;
  name: string;
  source: "server-system-binding" | "current-admin-resource";
  status: string;
  revision: number;
  enabled: boolean;
  provider: string | null;
  modelName: string | null;
  planningContext: {
    capabilitySource: "conservative-fallback" | "explicit-profile" | "verified-model-default";
    contextWindow: number;
    maxOutputTokens: number;
    outputReserve: number;
    safetyMargin: number;
    inputBudget: number;
  };
};

export type HarnessSkillSummary = {
  id: string;
  name: string;
  description: string;
  version: string;
  revision: number;
  status: string;
  enabled: boolean;
  physicalOwner: "builtin" | "user";
  declaredScope: "builtin" | "user" | "workspace";
  scopeStatus: "verified" | "unverified";
  availability: HarnessResourceAvailability;
  allowedToolIds: string[];
  deniedToolIds: string[];
  contentSha256: string | null;
};

export type HarnessMethodSummary = {
  resourceId: string;
  resourceRevision: number;
  skillId: string;
  semanticVersion: string;
  role: "core-method" | "expert-direction";
  scope: "builtin" | "workspace";
  contentSha256: string;
  lifecycle: "published";
};

export type HarnessToolSummary = {
  id: string;
  source: "datafoundry-builtin" | "energyiq-server-owned";
  availability: "registered" | "declared-for-stage";
};

export type HarnessMcpServerSummary = {
  id: string;
  name: string;
  revision: number;
  status: string;
  enabled: boolean;
  physicalOwner: "user";
  availability: "configured";
  connection: "persisted-status";
  statusAsOf: string;
  toolManifest: {
    source: "persisted-last-test" | "not-tested";
    toolNames: string[];
  };
};

export type HarnessSummary = {
  id: "ai-analyst" | "key-findings" | "section-analysis" | "additional-insights";
  label: string;
  resolution: "run-dependent" | "fixed-stage-contract";
  status: "available" | "unavailable";
  detail: string;
  modelIds: string[];
  skillIds: string[];
  methodResourceIds: string[];
  toolIds: string[];
  mcpServerIds: string[];
  context: {
    mode: "run-planned";
    sources: string[];
  };
  instructions: Array<{
    kind: "platform" | "workflow-stage" | "skill-method" | "output-contract";
    label: string;
    revision: string | null;
    revisionStatus: "resource-pinned" | "run-pinned" | "not-separately-versioned";
    visibility: "summary-only";
  }>;
};

export type ProjectHarnessConfigurationReader = {
  readProjectHarnessConfiguration(projectId: string): ProjectHarnessConfigurationState;
};

export const createProjectHarnessConfigurationReader = (input: {
  metadataStore: MetadataStore;
  user: UserRecord;
  workspaceId: string;
}): ProjectHarnessConfigurationReader => ({
  readProjectHarnessConfiguration(projectId) {
    requireAdmin(input.metadataStore, input.user);
    const project = input.metadataStore.energyIq.getProject(projectId);
    if (project.workspace_id !== input.workspaceId) {
      throw new Error("ENERGYIQ_PROJECT_FORBIDDEN");
    }

    const unavailable: ProjectHarnessConfigurationState["unavailable"] = [];
    const models = readModels(input, unavailable);
    const skills = input.metadataStore.configResources.list({
      workspace_id: project.workspace_id,
      user_id: input.user.id,
      kind: "skill",
    }).map(skillSummary);
    const mcpServers = input.metadataStore.configResources.list({
      workspace_id: project.workspace_id,
      user_id: input.user.id,
      kind: "mcp-server",
    }).map(mcpServerSummary);
    const publishedMethods = safelyReadPublishedMethods(
      input.metadataStore,
      project.workspace_id,
      unavailable,
    );
    const methods = resolveCurrentAdditionalAiInsightMethodSet(
      project.workspace_id,
      publishedMethods,
    ).methods.map((method) => ({
      resourceId: method.resourceId,
      resourceRevision: method.resourceRevision,
      skillId: method.skillId,
      semanticVersion: method.semanticVersion,
      role: method.role,
      scope: method.scope as "builtin" | "workspace",
      contentSha256: method.contentSha256,
      lifecycle: "published" as const,
    }));
    const profile = resolveProjectOverviewProfile(project.id);
    const systemModelIds = models
      .filter(({ source, enabled, status }) => source === "server-system-binding" && enabled && status === "connected")
      .map(({ id }) => id);
    const analystModelIds = models
      .filter(({ source, enabled, status }) => source === "current-admin-resource" && enabled && status === "connected")
      .map(({ id }) => id);
    const eligibleSkillIds = skills
      .filter(({ availability, enabled }) => availability === "configured" && enabled)
      .map(({ id }) => id);
    const configuredMcpIds = mcpServers.filter(({ enabled }) => enabled).map(({ id }) => id);
    const tools: HarnessToolSummary[] = [
      ...STATIC_AGENT_TOOL_NAMES.map((id) => ({
        id,
        source: "datafoundry-builtin" as const,
        availability: "registered" as const,
      })),
      ...ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1.map((id) => ({
        id,
        source: "energyiq-server-owned" as const,
        availability: "declared-for-stage" as const,
      })),
    ];

    const harnesses: HarnessSummary[] = [
      analystHarness(analystModelIds, eligibleSkillIds, configuredMcpIds),
      ...overviewHarnesses(profile?.rendererKey ?? null, systemModelIds, methods.map(({ resourceId }) => resourceId)),
    ];
    const hasUnavailable = unavailable.length > 0
      || skills.some(({ availability }) => availability === "unavailable")
      || harnesses.some(({ status }) => status === "unavailable");
    return {
      status: hasUnavailable ? "partially-unavailable" : "available",
      detail: hasUnavailable
        ? "Current Harness configuration is available with one or more locally unavailable resources."
        : "Current registered resources and Project Harness declarations are available.",
      project: {
        id: project.id,
        name: project.name,
        workspaceId: project.workspace_id,
        rendererKey: profile?.rendererKey ?? null,
      },
      resources: { models, skills, methods, tools, mcpServers },
      harnesses,
      unavailable,
    };
  },
});

const readModels = (
  input: { metadataStore: MetadataStore; user: UserRecord; workspaceId: string },
  unavailable: ProjectHarnessConfigurationState["unavailable"],
): HarnessModelSummary[] => {
  const models: HarnessModelSummary[] = [];
  const systemBinding = input.metadataStore.workspaceDefaultModelProfiles.find(
    ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID,
  );
  if (!systemBinding) {
    unavailable.push({
      id: "server-system-model",
      detail: "The server-managed EnergyIQ model binding is not configured.",
    });
  } else {
    try {
      const resolved = resolveModelProfileChain({
        metadataStore: input.metadataStore,
        profileId: WORKSPACE_DEFAULT_MODEL_PROFILE_ID,
        userId: systemBinding.profile_owner_user_id,
        workspaceId: ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID,
      });
      models.push(...resolved.map(({ resource }) => modelSummary(resource, "server-system-binding")));
    } catch {
      unavailable.push({
        id: "server-system-model",
        detail: "The server-managed EnergyIQ model profile is locally unavailable.",
      });
    }
  }
  models.push(...input.metadataStore.configResources.list({
    workspace_id: input.workspaceId,
    user_id: input.user.id,
    kind: "model-profile",
  }).filter(({ id }) => !models.some((model) => model.id === id))
    .map((resource) => modelSummary(resource, "current-admin-resource")));
  return models;
};

const modelSummary = (
  resource: ConfigResourceRecord,
  source: HarnessModelSummary["source"],
): HarnessModelSummary => ({
  id: resource.id,
  name: resource.name,
  source,
  status: resource.status,
  revision: resource.revision,
  enabled: resource.default_enabled,
  provider: stringValue(resource.payload.provider) ?? null,
  modelName: stringValue(resource.payload.modelName ?? resource.payload.model) ?? null,
  planningContext: planningContext(resource),
});

const planningContext = (resource: ConfigResourceRecord): HarnessModelSummary["planningContext"] => {
  const modelName = stringValue(resource.payload.modelName ?? resource.payload.model);
  const profile = resolveConfiguredModelContextProfile(resource, modelName);
  return {
    capabilitySource: profile.capabilitySource,
    contextWindow: profile.contextWindow,
    maxOutputTokens: profile.maxOutputTokens,
    outputReserve: profile.outputReserve,
    safetyMargin: profile.safetyMargin,
    inputBudget: Math.max(profile.contextWindow - profile.outputReserve - profile.safetyMargin, 0),
  };
};

const skillSummary = (resource: ConfigResourceRecord): HarnessSkillSummary => {
  const skill = configResourceToSkillRecord(resource);
  const physicalOwner = resource.builtin ? "builtin" as const : "user" as const;
  const scopeStatus = (skill.scope === "builtin" && physicalOwner === "builtin")
    || (skill.scope === "user" && physicalOwner === "user")
    ? "verified" as const
    : "unverified" as const;
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    version: skill.version,
    revision: skill.revision,
    status: skill.status,
    enabled: skill.defaultEnabled,
    physicalOwner,
    declaredScope: skill.scope,
    scopeStatus,
    availability: skill.status === "valid" && scopeStatus === "verified" ? "configured" : "unavailable",
    allowedToolIds: [...skill.allowedTools],
    deniedToolIds: [...skill.deniedTools],
    contentSha256: stringValue(resource.payload.builtinContentSha256) ?? null,
  };
};

const mcpServerSummary = (resource: ConfigResourceRecord): HarnessMcpServerSummary => {
  const toolNames = Array.isArray(resource.payload.toolManifest)
    ? resource.payload.toolManifest.flatMap((tool) => {
        const name = isRecord(tool) ? stringValue(tool.name) : undefined;
        return name ? [name] : [];
      })
    : [];
  return {
    id: resource.id,
    name: resource.name,
    revision: resource.revision,
    status: resource.status,
    enabled: resource.default_enabled,
    physicalOwner: "user",
    availability: "configured",
    connection: "persisted-status",
    statusAsOf: resource.updated_at,
    toolManifest: {
      source: toolNames.length > 0 ? "persisted-last-test" : "not-tested",
      toolNames,
    },
  };
};

const analystHarness = (
  modelIds: string[],
  skillIds: string[],
  mcpServerIds: string[],
): HarnessSummary => ({
  id: "ai-analyst",
  label: "AI Analyst",
  resolution: "run-dependent",
  status: modelIds.length > 0 ? "available" : "unavailable",
  detail: "Current Admin resources are candidates; exact Skill, MCP, Tool, and model resolution occurs per Run.",
  modelIds,
  skillIds,
  methodResourceIds: [],
  toolIds: [...STATIC_AGENT_TOOL_NAMES],
  mcpServerIds,
  context: {
    mode: "run-planned",
    sources: ["conversation", "working-memory", "long-term-memory", "energy-context", "evidence", "knowledge", "attachments", "tool-observations"],
  },
  instructions: [unversionedPlatformInstructions()],
});

const overviewHarnesses = (
  rendererKey: "ngee-ann-overview" | "preschool-overview" | null,
  modelIds: string[],
  methodResourceIds: string[],
): HarnessSummary[] => {
  if (rendererKey !== "preschool-overview") return [];
  const common = {
    resolution: "fixed-stage-contract" as const,
    status: modelIds.length > 0 ? "available" as const : "unavailable" as const,
    modelIds,
    mcpServerIds: [] as string[],
    context: {
      mode: "run-planned" as const,
      sources: ["project-identity", "snapshot", "release", "analysis-period", "evidence-catalog"],
    },
  };
  return [{
    ...common,
    id: "key-findings",
    label: "Key Findings",
    detail: "Server-owned synthesis over accepted Section analysis; no external MCP is declared.",
    skillIds: [],
    methodResourceIds: [],
    toolIds: [],
    instructions: [unversionedPlatformInstructions(), runPinnedInstruction("Key Findings workflow prompt")],
  }, {
    ...common,
    id: "section-analysis",
    label: "Section Analysis",
    detail: "Project adapter resolves each Section Pack and its scoped read-only capabilities at Run time.",
    skillIds: [],
    methodResourceIds: [],
    toolIds: [],
    instructions: [unversionedPlatformInstructions(), runPinnedInstruction("Section workflow prompt")],
  }, {
    ...common,
    id: "additional-insights",
    label: "Additional Insights",
    detail: "Server-owned Method set and scoped read-only Tools; external MCP is not declared for this Stage.",
    skillIds: [],
    methodResourceIds,
    toolIds: [...ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1],
    instructions: [
      unversionedPlatformInstructions(),
      runPinnedInstruction("Additional Insights workflow prompt"),
      ...methodResourceIds.map((resourceId) => ({
        kind: "skill-method" as const,
        label: resourceId,
        revision: resourceId,
        revisionStatus: "resource-pinned" as const,
        visibility: "summary-only" as const,
      })),
      runPinnedInstruction("Additional Insights output contract", "output-contract"),
    ],
  }];
};

const unversionedPlatformInstructions = (): HarnessSummary["instructions"][number] => ({
  kind: "platform",
  label: "DataFoundry platform instructions",
  revision: null,
  revisionStatus: "not-separately-versioned",
  visibility: "summary-only",
});

const runPinnedInstruction = (
  label: string,
  kind: HarnessSummary["instructions"][number]["kind"] = "workflow-stage",
): HarnessSummary["instructions"][number] => ({
  kind,
  label,
  revision: null,
  revisionStatus: "run-pinned",
  visibility: "summary-only",
});

const safelyReadPublishedMethods = (
  metadataStore: MetadataStore,
  workspaceId: string,
  unavailable: ProjectHarnessConfigurationState["unavailable"],
) => {
  try {
    return metadataStore.energyIq.insightMethodGovernance.listPublishedWorkspaceMethodResources({ workspaceId });
  } catch {
    unavailable.push({
      id: "workspace-method-catalog",
      detail: "The Workspace Method catalog is locally unavailable; built-in Methods remain visible.",
    });
    return [];
  }
};

const requireAdmin = (metadataStore: MetadataStore, user: UserRecord): void => {
  if (metadataStore.energyIq.findUserRole(user.id)?.role !== "admin") {
    throw new Error("ENERGYIQ_ADMIN_REQUIRED");
  }
};

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
