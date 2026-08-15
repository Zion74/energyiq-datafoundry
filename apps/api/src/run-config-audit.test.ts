import { describe, expect, it } from "vitest";

import {
  createRunConfigAuditCapture,
  createSkillMaterializedAuditCapture,
} from "./run-config-audit.js";

describe("Run config audit capture", () => {
  it("persists exact resource revisions and MCP server-to-tool mapping with stable ordering", () => {
    expect(createRunConfigAuditCapture({
      resourceRevisions: {
        "skill:investigation": 4,
        "model-profile:system": 7,
      },
      mcpToolNamesByServerId: {
        "server-z": ["forecast_read", "forecast_read"],
        "server-a": ["asset_lookup"],
      },
    })).toEqual({
      resource_revisions: {
        "model-profile:system": 7,
        "skill:investigation": 4,
      },
      mcp_tool_names_by_server_id: {
        "server-a": ["asset_lookup"],
        "server-z": ["forecast_read"],
      },
    });
  });

  it("records only exact Skill identity materialized into the started Run", () => {
    expect(createSkillMaterializedAuditCapture([
      { id: "skill-z", revision: 3, name: "Skill Z", packageFileRefId: "private-ref" },
      { id: "skill-a", revision: 5, name: "Skill A" },
    ])).toEqual({
      items: [
        { id: "skill-a", revision: 5 },
        { id: "skill-z", revision: 3 },
      ],
    });
  });
});
