import type { ConfigResourceRecord, MetadataStore } from "@datafoundry/metadata";
import { WORKSPACE_DEFAULT_MODEL_PROFILE_ID } from "@datafoundry/metadata";

export type ResolvedModelProfile = {
  exposedId: string;
  ownerUserId: string;
  resource: ConfigResourceRecord;
};

export const resolveModelProfileChain = (input: {
  metadataStore: MetadataStore;
  profileId: string;
  userId: string;
  workspaceId: string;
}): ResolvedModelProfile[] => {
  if (input.profileId === WORKSPACE_DEFAULT_MODEL_PROFILE_ID) {
    const binding = input.metadataStore.workspaceDefaultModelProfiles.get(input.workspaceId);
    const resource = input.metadataStore.configResources.find({
      id: binding.profile_id,
      workspace_id: input.workspaceId,
      user_id: binding.profile_owner_user_id,
      kind: "model-profile"
    });
    if (!resource) throw new Error("WORKSPACE_DEFAULT_MODEL_PROFILE_SOURCE_UNAVAILABLE");
    if (!resource.default_enabled) throw new Error("WORKSPACE_DEFAULT_MODEL_PROFILE_DISABLED");
    if (resource.status !== "connected") throw new Error("WORKSPACE_DEFAULT_MODEL_PROFILE_NOT_CONNECTED");
    if (stringValue(resource.payload.fallbackProfileId)) {
      throw new Error("WORKSPACE_DEFAULT_MODEL_FALLBACK_MUST_BE_DISABLED");
    }
    return [{
      exposedId: WORKSPACE_DEFAULT_MODEL_PROFILE_ID,
      ownerUserId: binding.profile_owner_user_id,
      resource
    }];
  }

  const profiles: ResolvedModelProfile[] = [];
  const visited = new Set<string>();
  let currentId: string | undefined = input.profileId;
  while (currentId) {
    if (visited.has(currentId)) throw new Error(`MODEL_FALLBACK_CYCLE:${currentId}`);
    visited.add(currentId);
    const resource = input.metadataStore.configResources.get({
      id: currentId,
      workspace_id: input.workspaceId,
      user_id: input.userId,
      kind: "model-profile"
    });
    profiles.push({ exposedId: currentId, ownerUserId: input.userId, resource });
    currentId = stringValue(resource.payload.fallbackProfileId);
  }
  return profiles;
};

export const workspaceDefaultModelProfileConfigured = (
  metadataStore: MetadataStore,
  workspaceId: string,
): boolean => metadataStore.workspaceDefaultModelProfiles.find(workspaceId) !== undefined;

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
