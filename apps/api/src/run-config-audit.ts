export type RunConfigAuditCapture = {
  resource_revisions: Record<string, number>;
  mcp_tool_names_by_server_id: Record<string, string[]>;
};

/** Build the immutable, secret-free configuration fields persisted on run.config.resolved. */
export const createRunConfigAuditCapture = (input: {
  resourceRevisions?: Record<string, number>;
  mcpToolNamesByServerId: Record<string, string[]>;
}): RunConfigAuditCapture => ({
  resource_revisions: Object.fromEntries(Object.entries(input.resourceRevisions ?? {})
    .filter(([, revision]) => Number.isSafeInteger(revision) && revision >= 0)
    .sort(([left], [right]) => left.localeCompare(right))),
  mcp_tool_names_by_server_id: Object.fromEntries(Object.entries(input.mcpToolNamesByServerId)
    .map(([serverId, toolNames]) => [
      serverId,
      [...new Set(toolNames)].sort((left, right) => left.localeCompare(right)),
    ] as const)
    .sort(([left], [right]) => left.localeCompare(right))),
});

/** Capture Skill revisions that were already materialized into the assembled started Run. */
export const createSkillMaterializedAuditCapture = <T extends { id: string; revision: number }>(
  skills: T[],
): { items: Array<{ id: string; revision: number }> } => ({
  items: skills
    .filter(({ id, revision }) => id.trim().length > 0 && Number.isSafeInteger(revision) && revision >= 0)
    .map(({ id, revision }) => ({ id, revision }))
    .sort((left, right) => left.id.localeCompare(right.id)),
});
