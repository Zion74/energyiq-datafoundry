import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createOverviewAiArtifactIdentity } from "./overview-ai-artifact.js";
import {
  PRESCHOOL_SECTION_IDS,
  type PreschoolSectionId,
  type PreschoolSectionPack,
} from "./preschool-overview-ai-contracts.js";
import { PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V3 } from "./preschool-overview-ai-structured-output.js";
import { createPreschoolSectionInterpreter } from "./preschool-section-interpreter.js";

const roots: string[] = [];
const closeStores: Array<() => void> = [];

afterEach(() => {
  for (const close of closeStores.splice(0)) close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Preschool Section Interpreter run isolation", () => {
  it("gives every Section its own Run, Session, and self-contained single-Pack context", async () => {
    const harness = createHarness();
    const calls: Array<{ sectionId: PreschoolSectionId; prompt: string; runId: string; sessionId: string }> = [];
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runSection: async ({ identity, prompt, runId, sessionId }) => {
        const sectionId = requireSectionId(identity.targetId);
        calls.push({ sectionId, prompt, runId, sessionId });
        return { answer: JSON.stringify(available(sectionId)), runId, sessionId };
      },
    });

    const result = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: packs(),
      user: harness.user,
    });

    expect(calls).toHaveLength(PRESCHOOL_SECTION_IDS.length);
    expect(result["centre-benchmark"].error_code).toBeUndefined();
    expect(new Set(calls.map(({ runId }) => runId))).toHaveLength(PRESCHOOL_SECTION_IDS.length);
    expect(new Set(calls.map(({ sessionId }) => sessionId))).toHaveLength(PRESCHOOL_SECTION_IDS.length);
    for (const call of calls) {
      expect(call.prompt).toContain(`"sectionId":"${call.sectionId}"`);
      for (const sibling of PRESCHOOL_SECTION_IDS.filter((sectionId) => sectionId !== call.sectionId)) {
        expect(call.prompt).not.toContain(`"sectionId":"${sibling}"`);
      }
      expect(call.prompt).toContain('"audience":"non-technical energy manager"');
      expect(call.prompt).toContain('"dataQuality":{"status":"complete"}');
      expect(call.prompt).toContain('"pageCoverage":["Verified Section evidence"]');
      expect(call.prompt).toContain('"missingEvidence":[]');
      expect(call.prompt).toContain('"allowedNextChecks":["Confirm the operating context."]');
      expect(result[call.sectionId].status).toBe("available");
      expect(JSON.parse(result[call.sectionId].result_json!).runId).toBe(call.runId);
    }
    harness.close();
  });

  it("keeps a single Section transport failure from failing successful siblings", async () => {
    const harness = createHarness();
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runSection: async ({ identity, runId, sessionId }) => {
        const sectionId = requireSectionId(identity.targetId);
        if (sectionId === "standby-wastage") throw new Error("PROVIDER_TRANSPORT_UNAVAILABLE");
        return { answer: JSON.stringify(available(sectionId)), runId, sessionId };
      },
    });

    const result = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: packs(),
      user: harness.user,
    });

    expect(result["standby-wastage"]).toMatchObject({
      status: "failed",
      error_code: "PROVIDER_TRANSPORT_UNAVAILABLE",
    });
    expect(result["centre-benchmark"].status).toBe("available");
    expect(result["operating-behaviour"].status).toBe("available");
    expect(result["planning-outlook"].status).toBe("available");
    harness.close();
  });

  it("accepts one valuable Key Point and persists zero points only as empty", async () => {
    const harness = createHarness();
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runSection: async ({ identity, runId, sessionId }) => {
        const sectionId = requireSectionId(identity.targetId);
        const answer = sectionId === "planning-outlook"
          ? { sectionId, status: "empty", keyPoints: [] }
          : available(sectionId);
        return { answer: JSON.stringify(answer), runId, sessionId };
      },
    });

    const result = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: packs(),
      user: harness.user,
    });

    for (const sectionId of PRESCHOOL_SECTION_IDS.filter((id) => id !== "planning-outlook")) {
      expect(result[sectionId].status).toBe("available");
      expect(JSON.parse(result[sectionId].result_json!).keyPoints).toHaveLength(1);
    }
    expect(JSON.parse(result["planning-outlook"].result_json!)).toMatchObject({
      status: "empty",
      keyPoints: [],
    });
    harness.close();
  });

  it("accepts an Evidence-bound priority Key Point instead of rejecting useful model judgment", async () => {
    const harness = createHarness();
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runSection: async ({ identity, runId, sessionId }) => {
        const sectionId = requireSectionId(identity.targetId);
        return {
          answer: JSON.stringify({
            ...available(sectionId),
            keyPoints: [{
              kind: "priority",
              text: "Review the verified pattern before assigning a cause.",
              evidenceRefs: [`evidence:${sectionId}`],
            }],
          }),
          runId,
          sessionId,
        };
      },
    });

    const result = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: packs(),
      user: harness.user,
    });

    for (const sectionId of PRESCHOOL_SECTION_IDS) {
      expect(result[sectionId].error_code).toBeUndefined();
      expect(result[sectionId]).toMatchObject({ status: "available" });
      expect(JSON.parse(result[sectionId].result_json!).keyPoints[0].kind).toBe("priority");
    }
    harness.close();
  });

  it("advertises priority as a native structured-output Key Point kind", () => {
    const keyPointKind = PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V3.schema
      .properties.keyPoints.items.properties?.kind;

    expect(keyPointKind?.enum).toContain("priority");
  });

  it("gives a retried Section bounded feedback about its previous validation failure", async () => {
    const harness = createHarness();
    const standbyPrompts: string[] = [];
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runSection: async ({ identity, prompt, runId, sessionId }) => {
        const sectionId = requireSectionId(identity.targetId);
        if (sectionId === "standby-wastage") standbyPrompts.push(prompt);
        const answer = sectionId === "standby-wastage" && standbyPrompts.length === 1
          ? {
              ...available(sectionId),
              keyPoints: [{
                kind: "finding",
                text: "Unsupported value 999 needs attention.",
                evidenceRefs: [`evidence:${sectionId}`],
              }],
            }
          : available(sectionId);
        return { answer: JSON.stringify(answer), runId, sessionId };
      },
    });
    const input = { baseIdentity: harness.identity, packs: packs(), user: harness.user };

    const first = await interpreter.execute(input);
    expect(first["standby-wastage"].error_code).toBe("PRESCHOOL_SECTION_INTERPRETATION_FACT_UNSUPPORTED");

    const retried = await interpreter.execute({ ...input, retryTargets: ["standby-wastage"] });

    expect(retried["standby-wastage"].status).toBe("available");
    expect(standbyPrompts[1]).toContain("Previous attempt rejection: PRESCHOOL_SECTION_INTERPRETATION_FACT_UNSUPPORTED");
    expect(standbyPrompts[1]).toContain("Do not repeat that rejected output");
    harness.close();
  });

  it("accepts a natural-language rendering of an exact Evidence date", async () => {
    const harness = createHarness();
    const datedPacks = packs().map((pack) => pack.sectionId === "planning-outlook"
      ? {
          ...pack,
          evidence: [{
            ...pack.evidence[0]!,
            value: { actualThroughLocalDate: "2026-06-07" },
          }],
        }
      : pack);
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runSection: async ({ identity, runId, sessionId }) => {
        const sectionId = requireSectionId(identity.targetId);
        const answer = sectionId === "planning-outlook"
          ? {
              sectionId,
              status: "available",
              summary: "As of 7 June 2026, the verified pattern deserves attention.",
              keyPoints: [{
                kind: "next-check",
                text: "After 7 June 2026, continue monitoring the verified pattern.",
                evidenceRefs: [`evidence:${sectionId}`],
              }],
            }
          : available(sectionId);
        return { answer: JSON.stringify(answer), runId, sessionId };
      },
    });

    const result = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: datedPacks,
      user: harness.user,
    });

    expect(result["planning-outlook"].status).toBe("available");
    harness.close();
  });

  it("rejects a contradictory empty response without affecting sibling Sections", async () => {
    const harness = createHarness();
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runSection: async ({ identity, runId, sessionId }) => {
        const sectionId = requireSectionId(identity.targetId);
        const answer = sectionId === "planning-outlook"
          ? { ...available(sectionId), status: "empty" }
          : available(sectionId);
        return { answer: JSON.stringify(answer), runId, sessionId };
      },
    });

    const result = await interpreter.execute({
      baseIdentity: harness.identity,
      packs: packs(),
      user: harness.user,
    });

    expect(result["planning-outlook"]).toMatchObject({
      status: "failed",
      error_code: "PRESCHOOL_SECTION_INTERPRETATION_MALFORMED",
    });
    expect(result["centre-benchmark"].status).toBe("available");
    expect(result["standby-wastage"].status).toBe("available");
    expect(result["operating-behaviour"].status).toBe("available");
    harness.close();
  });

  it("uses Artifact claims to prevent concurrent ensure calls from duplicating child Runs", async () => {
    const harness = createHarness();
    const calls: PreschoolSectionId[] = [];
    let active = 0;
    let maxActive = 0;
    const interpreter = createPreschoolSectionInterpreter({
      metadataStore: harness.metadata,
      runSection: async ({ identity, runId, sessionId }) => {
        const sectionId = requireSectionId(identity.targetId);
        calls.push(sectionId);
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return { answer: JSON.stringify(available(sectionId)), runId, sessionId };
      },
    });
    const input = { baseIdentity: harness.identity, packs: packs(), user: harness.user };

    await Promise.all([interpreter.execute(input), interpreter.execute(input)]);

    expect(calls).toHaveLength(PRESCHOOL_SECTION_IDS.length);
    expect([...calls].sort()).toEqual([...PRESCHOOL_SECTION_IDS].sort());
    expect(maxActive).toBe(2);
    harness.close();
  });
});

const available = (sectionId: PreschoolSectionId) => ({
  sectionId,
  status: "available",
  summary: "The current pattern deserves management attention.",
  keyPoints: [{
    kind: "meaning",
    text: "Review the verified pattern before assigning a cause.",
    evidenceRefs: [`evidence:${sectionId}`],
  }],
});

const requireSectionId = (value: string | undefined): PreschoolSectionId => {
  if (!PRESCHOOL_SECTION_IDS.includes(value as PreschoolSectionId)) throw new Error("SECTION_ID_MISSING");
  return value as PreschoolSectionId;
};

const packs = (): PreschoolSectionPack[] => PRESCHOOL_SECTION_IDS.map((sectionId) => ({
  sectionId,
  audience: "non-technical energy manager",
  decisionQuestion: "What should the manager understand and check next?",
  binding: {
    workspaceId: "preschool-workspace",
    projectId: "preschool-demo",
    scopeId: "preschool-project",
    dataSnapshotId: "snapshot-current",
    projectReleaseId: "release-current",
    analysisPeriod: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
    modelProfileId: "workspace-default-model-profile",
    modelProfileRevision: 1,
  },
  evidence: [{
    id: `evidence:${sectionId}`,
    label: "Verified Section evidence",
    value: { supportedValue: 30 },
    entityRefs: [],
    evidenceRefs: [`evidence:${sectionId}`],
  }],
  dataQuality: { status: "complete" },
  limitations: [],
  missingEvidence: [],
  pageCoverage: ["Verified Section evidence"],
  allowedNextChecks: ["Confirm the operating context."],
}));

const createHarness = () => {
  const root = mkdtempSync(join(tmpdir(), "preschool-section-isolation-"));
  roots.push(root);
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    metadata.close();
  };
  closeStores.push(close);
  metadata.users.upsertDevUser({ id: "dev-user", email: "dev@example.test", display_name: "Dev", dev_token: "dev" });
  metadata.workspaces.upsert({ id: "preschool-workspace", owner_user_id: "dev-user", name: "Preschool", kind: "customer" });
  metadata.energyIq.upsertProject({
    id: "preschool-demo",
    workspace_id: "preschool-workspace",
    name: "Preschool",
    status: "published",
    root_scope_id: "preschool-project",
  });
  return {
    metadata,
    identity: createOverviewAiArtifactIdentity({
      workspaceId: "preschool-workspace",
      projectId: "preschool-demo",
      scopeId: "preschool-project",
      dataSnapshotId: "snapshot-current",
      projectReleaseId: "release-current",
      analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
      analysisPeriodTo: "2026-06-01T00:00:00.000Z",
      rendererKey: "preschool-overview",
      rendererVersion: "1",
      modelProfileId: "workspace-default-model-profile",
      modelProfileRevision: 1,
    }),
    user: metadata.users.getById({ user_id: "dev-user" }),
    close,
  };
};
