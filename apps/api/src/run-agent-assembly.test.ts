import { beforeEach, describe, expect, it, vi } from "vitest";

const createDataFoundry = vi.hoisted(() => vi.fn());

vi.mock("@datafoundry/agent-runtime", async (importOriginal) => ({
  ...await importOriginal<typeof import("@datafoundry/agent-runtime")>(),
  createDataFoundry,
}));

vi.mock("@ag-ui/mastra", () => ({
  MastraAgent: class MastraAgent {
    constructor(readonly input: unknown) {}
  },
}));

import { createRunAgentAssembly } from "./run-agent-assembly.js";

describe("createRunAgentAssembly", () => {
  beforeEach(() => {
    createDataFoundry.mockReset();
    createDataFoundry.mockResolvedValue({
      agent: {},
      commandExecutionEnabled: false,
      destroyWorkspace: vi.fn(async () => undefined),
      flushProtocolEvents: vi.fn(),
      governedMessages: [],
      isolation: "none",
      protocol: {},
      sessionDir: "D:/tmp/session",
      workspaceDir: "D:/tmp/workspace",
    });
  });

  it("forwards the server-owned Additional submission capability to the Agent Runtime", async () => {
    await createRunAgentAssembly({
      additionalAiInsightSubmission: true,
      mcpRuntime: { servers: [], toolNames: [], toolNamesByServerId: {} },
      effectiveRunConfig: {
        enabledDatasourceIds: [],
        fileIds: [],
        enabledKnowledgeIds: [],
        enabledMcpServerIds: [],
        enabledSkillIds: [],
        skillIds: [],
        skillMode: "none",
        skillPolicy: {
          allowedToolNames: [],
          deniedToolNames: [],
          maxSkills: 0,
          requireUserInvocable: true,
          strictSkillTools: true,
        },
        skillTags: [],
        evidenceRefs: [],
      },
      messages: [],
      longTermMemories: [],
      selectedSkills: [],
      skillSelection: { selectedSkills: [], diagnostics: [] },
      workspaceRoot: "D:/tmp",
      userId: "user-a",
      workspaceId: "workspace-a",
    } as never);

    expect(createDataFoundry).toHaveBeenCalledWith(expect.objectContaining({
      additionalAiInsightSubmission: true,
    }));
  });
});
