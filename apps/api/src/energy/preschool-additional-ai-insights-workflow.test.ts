import type { AnalysisContextEvidenceCatalog } from "@datafoundry/agent-runtime";
import {
  ENERGYIQ_OPEN_DISCOVERY_METHOD_CONTENT_V1,
  type AdditionalAiInsightsArtifact,
} from "@datafoundry/contracts";
import { createMetadataStore, type UserRecord } from "@datafoundry/metadata";
import { toStandardSchema } from "@mastra/core/schema";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  createOverviewAiArtifactIdentity,
  createPreschoolAdditionalAiInsightArtifactIdentity,
} from "./overview-ai-artifact.js";
import { ensureEnergyIqBootstrap, PRESCHOOL_WORKSPACE_ID } from "./energy-bootstrap.js";
import {
  createPreschoolAdditionalAiInsightsWorkflow,
  createPreschoolAdditionalAiPresentedClaims,
} from "./preschool-additional-ai-insights-workflow.js";
import { composePreschoolOverviewAiReadModel } from "./preschool-overview-ai-read-model.js";
import { PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V3 } from "./preschool-overview-ai-structured-output.js";

describe("Preschool Additional AI Insights workflow", () => {
  it("projects the current Additional identity before composing presented Layer 1 and 2 claims", async () => {
    const harness = createHarness();
    const runDiscovery = vi.fn(async ({ runId, sessionId }) => ({
      answer: JSON.stringify({ candidates: [] }),
      runId,
      sessionId,
    }));
    try {
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: async ({ identity, catalog: currentCatalog }) =>
          createPreschoolAdditionalAiPresentedClaims({
            identity,
            catalog: currentCatalog,
            readModel: composePreschoolOverviewAiReadModel({
              metadataStore: harness.metadata,
              baseIdentity: identity,
            }),
          }),
        runDiscovery,
      });

      await expect(workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "presented-claims-run",
        sessionId: "presented-claims-session",
      })).resolves.toMatchObject({
        status: "empty",
        publication: { discoveredCount: 0, acceptedCount: 0, rejectedCount: 0 },
      });
      expect(runDiscovery).toHaveBeenCalledTimes(1);
    } finally {
      harness.close();
    }
  });

  it("preserves Pack claim provenance while accepting a new Catalog-Evidence relationship", async () => {
    const harness = createHarness();
    try {
      const sectionEvidenceRef = "preschool:snapshot-current:section-standby-wastage:summary";
      const runDiscovery = vi.fn(async ({ prompt, runId, sessionId }) => {
        expect(prompt).toContain("Already-presented claim digests");
        expect(prompt).toContain("section:standby-wastage:summary");
        expect(prompt).toContain(sectionEvidenceRef);
        return {
          answer: JSON.stringify({ candidates: [
            candidate("candidate-restatement", "fact:standby-share", {
              title: "The selected period remains 31% standby",
              text: "During the selected period, standby energy use represents 31%.",
              epistemicStatus: "observed",
              incrementalContext: {
                relatedPresentedClaimIds: ["section:standby-wastage:summary"],
                novelConclusion: "During the selected period, standby energy use represents 31%.",
              },
            }),
            candidate("candidate-hypothesis", "fact:standby-share", {
              title: "The same share may hide a concentrated timing pattern",
              text: "Although standby use is 31%, a small number of recurring intervals may account for most of it; test that concentration before choosing an intervention.",
              epistemicStatus: "speculative",
              incrementalContext: {
                relatedPresentedClaimIds: ["section:standby-wastage:summary"],
                novelConclusion: "a small number of recurring intervals may account for most of it",
              },
            }),
            candidate("candidate-forged-claim", "fact:standby-share", {
              title: "A forged relationship",
              text: "This relationship cites an unknown presented claim.",
              epistemicStatus: "speculative",
              incrementalContext: {
                relatedPresentedClaimIds: ["section:standby-wastage:forged"],
                novelConclusion: "Test a relationship to a claim that is not in the current envelope.",
              },
            }),
          ] }),
          runId,
          sessionId,
        };
      });
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: async ({ identity, catalog: currentCatalog }) => {
          const claims = createPreschoolAdditionalAiPresentedClaims({
            identity,
            catalog: currentCatalog,
            readModel: presentedReadModel({
              dataSnapshotId: "snapshot-current",
              sectionEvidenceRef,
            }),
          });
          expect(claims.claims).toEqual(expect.arrayContaining([expect.objectContaining({
            id: "section:standby-wastage:summary",
            artifactId: "section-artifact-standby",
            sourceEvidenceRefs: [sectionEvidenceRef],
          })]));
          return claims;
        },
        runDiscovery,
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "incremental-claim-run",
        sessionId: "incremental-claim-session",
      });

      expect(result).toMatchObject({
        status: "available",
        publication: {
          discoveredCount: 3,
          acceptedCount: 1,
          rejectedCount: 2,
          acceptedCandidateIds: ["candidate-hypothesis"],
          rejectedCandidateIds: ["candidate-restatement", "candidate-forged-claim"],
        },
        findings: [{ id: "additional:candidate-hypothesis", epistemicStatus: "speculative" }],
      });
    } finally {
      harness.close();
    }
  });

  it("binds claimed novelty to the actual published narrative", async () => {
    const harness = createHarness();
    try {
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [
            candidate("candidate-novelty-bypass", "fact:standby-share", {
              title: "fact:standby-share: 31 %",
              text: "fact:standby-share: 31 %",
              epistemicStatus: "observed",
              incrementalContext: {
                relatedPresentedClaimIds: ["deterministic-overview:fact:standby-share"],
                novelConclusion: "A separate timing relationship should be tested.",
              },
            }),
            candidate("candidate-deep-dive-bypass", "fact:standby-share", {
              title: "fact:standby-share: 31 %",
              text: "fact:standby-share: 31 %",
              deepDiveQuestion: "Could a separate timing relationship be tested?",
              epistemicStatus: "observed",
              incrementalContext: {
                relatedPresentedClaimIds: ["deterministic-overview:fact:standby-share"],
                novelConclusion: "Could a separate timing relationship be tested?",
              },
            }),
          ] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "novelty-binding-run",
        sessionId: "novelty-binding-session",
      });

      expect(result.publication).toMatchObject({
        discoveredCount: 2,
        acceptedCount: 0,
        rejectedCount: 2,
        rejectedCandidateIds: ["candidate-novelty-bypass", "candidate-deep-dive-bypass"],
      });
    } finally {
      harness.close();
    }
  });

  it("applies deterministic presented baselines even when the model supplies no related claim IDs", async () => {
    const harness = createHarness();
    try {
      const newRelationship = "fact:standby-share: 31 %, while weekday concentration may move differently; test that relationship.";
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [
            candidate("candidate-empty-related-restatement", "fact:standby-share", {
              title: "fact:standby-share: 31 %",
              text: "fact:standby-share: 31 %",
              epistemicStatus: "observed",
              incrementalContext: {
                relatedPresentedClaimIds: [],
                novelConclusion: "fact:standby-share: 31 %",
              },
            }),
            candidate("candidate-empty-related-new", "fact:standby-share", {
              title: "Test whether the share hides a weekday relationship",
              text: newRelationship,
              epistemicStatus: "speculative",
              incrementalContext: {
                relatedPresentedClaimIds: [],
                novelConclusion: newRelationship,
              },
            }),
          ] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "empty-related-baseline-run",
        sessionId: "empty-related-baseline-session",
      });
      expect(result.publication).toMatchObject({
        discoveredCount: 2,
        acceptedCount: 1,
        rejectedCount: 1,
        acceptedCandidateIds: ["candidate-empty-related-new"],
        rejectedCandidateIds: ["candidate-empty-related-restatement"],
      });
    } finally {
      harness.close();
    }
  });

  it("accepts a same-Evidence superset only when the actual narrative adds a testable relationship", async () => {
    const harness = createHarness();
    try {
      const narrative = "fact:standby-share: 31 %, while its weekday concentration may move differently; test that relationship.";
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [candidate("candidate-superset-relation", "fact:standby-share", {
            title: "Test whether the share hides a weekday relationship",
            text: narrative,
            epistemicStatus: "speculative",
            incrementalContext: {
              relatedPresentedClaimIds: ["deterministic-overview:fact:standby-share"],
              novelConclusion: narrative,
            },
          })] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "superset-relation-run",
        sessionId: "superset-relation-session",
      });
      expect(result.publication.acceptedCandidateIds).toEqual(["candidate-superset-relation"]);
    } finally {
      harness.close();
    }
  });

  it("projects exact deterministic, Section, and Key Finding claims for the current Snapshot", () => {
    const harness = createHarness();
    try {
      const projected = createPreschoolAdditionalAiPresentedClaims({
        identity: harness.additionalIdentity,
        catalog: catalog(),
        readModel: {
          binding: {
            workspaceId: PRESCHOOL_WORKSPACE_ID,
            projectId: "preschool-demo",
            scopeId: "preschool-project",
            dataSnapshotId: "snapshot-current",
            projectReleaseId: "release-current",
            analysisPeriod: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
            modelProfileId: "workspace-default",
            modelProfileRevision: 1,
          },
          sections: {
            "standby-wastage": {
              status: "available",
              artifactId: "section-artifact-standby",
              result: {
                artifactKind: "section-interpretation",
                status: "available",
                sectionId: "standby-wastage",
                binding: {
                  workspaceId: PRESCHOOL_WORKSPACE_ID,
                  projectId: "preschool-demo",
                  scopeId: "preschool-project",
                  dataSnapshotId: "snapshot-current",
                  projectReleaseId: "release-current",
                  analysisPeriod: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
                  modelProfileId: "workspace-default",
                  modelProfileRevision: 1,
                },
                summary: {
                  text: "Standby accounts for 31%.",
                  evidenceRefs: ["preschool:snapshot-current:section-standby-wastage:summary"],
                },
                insights: [{
                  id: "standby-pattern",
                  title: "Standby pattern",
                  text: "The 31% share is already visible.",
                  epistemicStatus: "observed",
                  evidenceRefs: ["preschool:snapshot-current:section-standby-wastage:insight:standby-pattern"],
                }],
              },
            },
          },
          executive: {
            status: "available",
            artifactId: "executive-artifact-current",
            result: {
              artifactKind: "executive-synthesis",
              status: "available",
              binding: {
                workspaceId: PRESCHOOL_WORKSPACE_ID,
                projectId: "preschool-demo",
                scopeId: "preschool-project",
                dataSnapshotId: "snapshot-current",
                projectReleaseId: "release-current",
                analysisPeriod: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
                modelProfileId: "workspace-default",
                modelProfileRevision: 1,
              },
              summary: { text: "Operating use is 69%.", evidenceRefs: ["fact:operating-share"] },
              findings: [{
                id: "operating-theme",
                title: "Operating theme",
                text: "Operating use accounts for 69%.",
                evidenceRefs: ["fact:operating-share"],
                sectionIds: ["operating-behaviour"],
              }],
            },
          },
        },
      });

      expect(projected.claims).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: "deterministic-overview:fact:standby-share",
          source: "deterministic-overview",
          sourceEvidenceRefs: ["fact:standby-share"],
        }),
        {
          id: "section:standby-wastage:summary",
          source: "section-summary",
          sectionId: "standby-wastage",
          artifactId: "section-artifact-standby",
          text: "Standby accounts for 31%.",
          sourceEvidenceRefs: ["preschool:snapshot-current:section-standby-wastage:summary"],
        },
        expect.objectContaining({ id: "section:standby-wastage:insight:standby-pattern" }),
        expect.objectContaining({ id: "key-finding:operating-theme", artifactId: "executive-artifact-current" }),
      ]));
    } finally {
      harness.close();
    }
  });

  it("does not carry presented Section provenance across Snapshot identities", () => {
    const harness = createHarness();
    try {
      const nextBaseIdentity = createOverviewAiArtifactIdentity({
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        projectId: "preschool-demo",
        scopeId: "preschool-project",
        dataSnapshotId: "snapshot-next",
        projectReleaseId: "release-current",
        analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
        analysisPeriodTo: "2026-06-01T00:00:00.000Z",
        rendererKey: "preschool-overview",
        rendererVersion: "1",
        modelProfileId: "workspace-default",
        modelProfileRevision: 1,
      });
      const nextIdentity = createPreschoolAdditionalAiInsightArtifactIdentity({ baseIdentity: nextBaseIdentity });
      const nextCatalog = catalog();
      nextCatalog.sourceId = "project-analysis-snapshot:preschool-demo:snapshot-next";
      nextCatalog.pins.dataSnapshotId = "snapshot-next";

      expect(() => createPreschoolAdditionalAiPresentedClaims({
        identity: nextIdentity,
        catalog: nextCatalog,
        readModel: presentedReadModel({
          dataSnapshotId: "snapshot-current",
          sectionEvidenceRef: "preschool:snapshot-current:section-standby-wastage:summary",
        }),
      })).toThrowError("PRESCHOOL_ADDITIONAL_AI_PRESENTED_READ_MODEL_INVALID");

      const projected = createPreschoolAdditionalAiPresentedClaims({
        identity: nextIdentity,
        catalog: nextCatalog,
        readModel: presentedReadModel({
          dataSnapshotId: "snapshot-next",
          sectionEvidenceRef: "preschool:snapshot-next:section-standby-wastage:summary",
        }),
      });
      const sectionClaim = projected.claims.find(({ id }) => id === "section:standby-wastage:summary");
      expect(sectionClaim?.sourceEvidenceRefs).toEqual([
        "preschool:snapshot-next:section-standby-wastage:summary",
      ]);
      expect(JSON.stringify(projected.claims)).not.toContain("preschool:snapshot-current:section-");
    } finally {
      harness.close();
    }
  });

  it("ignores malformed presented units locally without losing deterministic or valid sibling claims", () => {
    const harness = createHarness();
    try {
      const projected = createPreschoolAdditionalAiPresentedClaims({
        identity: harness.additionalIdentity,
        catalog: catalog(),
        readModel: {
          binding: {
            workspaceId: PRESCHOOL_WORKSPACE_ID,
            projectId: "preschool-demo",
            scopeId: "preschool-project",
            dataSnapshotId: "snapshot-current",
            projectReleaseId: "release-current",
            analysisPeriod: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
            modelProfileId: "workspace-default",
            modelProfileRevision: 1,
          },
          sections: {
            "standby-wastage": {
              status: "available",
              artifactId: "section-malformed",
              result: { status: "available", summary: { text: "Malformed.", evidenceRefs: ["fact:standby-share"] } },
            },
            "operating-behaviour": {
              status: "available",
              artifactId: "section-valid",
              result: {
                artifactKind: "section-interpretation",
                status: "available",
                sectionId: "operating-behaviour",
                binding: {
                  workspaceId: PRESCHOOL_WORKSPACE_ID,
                  projectId: "preschool-demo",
                  scopeId: "preschool-project",
                  dataSnapshotId: "snapshot-current",
                  projectReleaseId: "release-current",
                  analysisPeriod: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
                  modelProfileId: "workspace-default",
                  modelProfileRevision: 1,
                },
                summary: { text: "Operating share is 69%.", evidenceRefs: ["fact:operating-share"] },
                insights: [],
              },
            },
          },
          executive: {
            status: "available",
            artifactId: "executive-malformed",
            result: { status: "available", summary: { text: "Malformed.", evidenceRefs: ["fact:standby-share"] } },
          },
        },
      });

      expect(projected.claims).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "deterministic-overview:fact:standby-share" }),
        expect.objectContaining({ id: "section:operating-behaviour:summary", artifactId: "section-valid" }),
      ]));
      expect(projected.claims).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ artifactId: "section-malformed" }),
        expect.objectContaining({ artifactId: "executive-malformed" }),
      ]));
    } finally {
      harness.close();
    }
  });

  it.each([null, "malformed-executive"])(
    "ignores a non-object Executive locally without losing valid Section claims: %j",
    (executive) => {
      const harness = createHarness();
      try {
        const readModel = presentedReadModel({
          dataSnapshotId: "snapshot-current",
          sectionEvidenceRef: "preschool:snapshot-current:section-standby-wastage:summary",
        });
        const projected = createPreschoolAdditionalAiPresentedClaims({
          identity: harness.additionalIdentity,
          catalog: catalog(),
          readModel: { ...readModel, executive },
        });
        expect(projected.claims).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: "deterministic-overview:fact:standby-share" }),
          expect.objectContaining({ id: "section:standby-wastage:summary" }),
        ]));
      } finally {
        harness.close();
      }
    },
  );

  it("rejects candidate-local numbers and Centre entities not covered by its own Evidence refs", async () => {
    const harness = createHarness();
    try {
      const evidenceCatalog = catalog();
      evidenceCatalog.facts.push(
        entityFact("fact:centre-g-intensity", "Centre G", 3.26),
        entityFact("fact:centre-n-intensity", "Centre N", 3.26),
        entityFact("fact:centre-q-intensity", "Centre Q", 4.75),
      );
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => evidenceCatalog,
        resolvePresentedClaims: async ({ identity, catalog: currentCatalog }) =>
          createPreschoolAdditionalAiPresentedClaims({ identity, catalog: currentCatalog, readModel: null }),
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [
            candidate("candidate-wrong-centre", "fact:centre-g-intensity", {
              title: "Centre N reaches 3.26 kWh/m2",
              text: "Centre N records 3.26 kWh/m2, despite citing only Centre G Evidence.",
              incrementalContext: incrementalContext("deterministic-overview:fact:centre-g-intensity"),
            }),
            candidate("candidate-centre-n", "fact:centre-n-intensity", {
              title: "Centre N reaches 3.26 kWh/m2",
              text: "Centre N records 3.26 kWh/m2; compare its operating pattern before inferring a driver.",
              incrementalContext: incrementalContext("deterministic-overview:fact:centre-n-intensity"),
            }),
            candidate("candidate-centre-q", "fact:centre-q-intensity", {
              title: "Centre Q reaches 4.75 kWh/m2",
              text: "Centre Q records 4.75 kWh/m2; test whether its timing differs from peers.",
              incrementalContext: incrementalContext("deterministic-overview:fact:centre-q-intensity"),
            }),
            candidate("candidate-wrong-centre-without-number", "fact:centre-g-intensity", {
              title: "Centre N warrants a timing check",
              text: "Centre N warrants a separate timing check despite citing only Centre G Evidence.",
              incrementalContext: incrementalContext("deterministic-overview:fact:centre-g-intensity"),
            }),
            candidate("candidate-centre-n-without-number", "fact:centre-n-intensity", {
              title: "Centre N warrants a timing check",
              text: "Centre N warrants a separate timing check before attributing a driver.",
              incrementalContext: incrementalContext("deterministic-overview:fact:centre-n-intensity"),
            }),
          ] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "candidate-lineage-run",
        sessionId: "candidate-lineage-session",
      });

      expect(result.publication).toMatchObject({
        discoveredCount: 5,
        acceptedCount: 3,
        rejectedCount: 2,
        acceptedCandidateIds: ["candidate-centre-n", "candidate-centre-q", "candidate-centre-n-without-number"],
        rejectedCandidateIds: ["candidate-wrong-centre", "candidate-wrong-centre-without-number"],
      });
    } finally {
      harness.close();
    }
  });

  it("uses the complete Catalog Centre vocabulary while validating only candidate-cited Evidence", async () => {
    const harness = createHarness();
    try {
      const evidenceCatalog = catalog();
      evidenceCatalog.facts.push(
        entityFact("fact:centre-g-intensity", "Centre G", 3.26),
        entityFact("fact:centre-aa-intensity", "Centre AA", 4.25),
      );
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => evidenceCatalog,
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [
            candidate("candidate-aa-with-g-evidence", "fact:centre-g-intensity", {
              title: "centre aa warrants a timing check",
              text: "centre aa warrants a separate timing check despite citing only Centre G Evidence.",
              incrementalContext: incrementalContext("deterministic-overview:fact:centre-g-intensity"),
            }),
            candidate("candidate-aa-with-aa-evidence", "fact:centre-aa-intensity", {
              title: "centre aa warrants a separate check",
              text: "centre aa warrants a separate timing check before attributing a driver.",
              incrementalContext: incrementalContext("deterministic-overview:fact:centre-aa-intensity"),
            }),
          ] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "candidate-aa-lineage-run",
        sessionId: "candidate-aa-lineage-session",
      });
      expect(result.publication).toMatchObject({
        discoveredCount: 2,
        acceptedCount: 1,
        rejectedCount: 1,
        acceptedCandidateIds: ["candidate-aa-with-aa-evidence"],
        rejectedCandidateIds: ["candidate-aa-with-g-evidence"],
      });
    } finally {
      harness.close();
    }
  });

  it("rejects explicit causal, action, and external-benchmark assertions that overstate their epistemic status", async () => {
    const harness = createHarness();
    try {
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: async ({ identity, catalog: currentCatalog }) =>
          createPreschoolAdditionalAiPresentedClaims({ identity, catalog: currentCatalog, readModel: null }),
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [
            candidate("candidate-causal-observed", "fact:standby-share", {
              title: "Area and occupancy drive the variance",
              text: "The difference is driven by area and occupancy.",
              epistemicStatus: "observed",
              incrementalContext: incrementalContext("deterministic-overview:fact:standby-share"),
            }),
            candidate("candidate-action-observed", "fact:standby-share", {
              title: "The highest-leverage reduction target",
              text: "Standby is the best reduction target.",
              epistemicStatus: "observed",
              incrementalContext: incrementalContext("deterministic-overview:fact:standby-share"),
            }),
            candidate("candidate-causal-inferred", "fact:standby-share", {
              title: "Occupancy may help explain the variance",
              text: "The pattern may be driven by occupancy, which remains an inference to test.",
              epistemicStatus: "inferred",
              incrementalContext: incrementalContext("deterministic-overview:fact:standby-share"),
            }),
            candidate("candidate-industry-inferred", "fact:standby-share", {
              title: "Typical learning environments should behave this way",
              text: "Cooling should dominate in a tropical preschool.",
              epistemicStatus: "inferred",
              incrementalContext: incrementalContext("deterministic-overview:fact:standby-share"),
            }),
            candidate("candidate-industry-hypothesis", "fact:standby-share", {
              title: "Test whether cooling dominates in this setting",
              text: "Cooling dominance is an external hypothesis to verify, not an observed industry benchmark.",
              epistemicStatus: "speculative",
              incrementalContext: incrementalContext("deterministic-overview:fact:standby-share"),
            }),
            candidate("candidate-causal-deep-dive", "fact:standby-share", {
              title: "Check the variance boundary",
              text: "The measured share is the only observed result.",
              deepDiveQuestion: "Is the variance driven by occupancy?",
              epistemicStatus: "observed",
              incrementalContext: incrementalContext("deterministic-overview:fact:standby-share"),
            }),
          ] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "epistemic-boundary-run",
        sessionId: "epistemic-boundary-session",
      });

      expect(result.publication).toMatchObject({
        discoveredCount: 6,
        acceptedCount: 2,
        rejectedCount: 4,
        acceptedCandidateIds: ["candidate-causal-inferred", "candidate-industry-hypothesis"],
        rejectedCandidateIds: [
          "candidate-causal-observed",
          "candidate-action-observed",
          "candidate-industry-inferred",
          "candidate-causal-deep-dive",
        ],
      });
    } finally {
      harness.close();
    }
  });

  it("requires AI-discovered multi-Evidence relationships to be inferred without guessing from prose keywords", async () => {
    const harness = createHarness();
    try {
      const relationship = (id: string, epistemicStatus: "observed" | "inferred", qualifier: string) =>
        candidate(id, "fact:standby-share", {
          title: `Compare the two shares ${qualifier}`,
          text: `Standby is 31% while operating is 69%; ${qualifier}.`,
          epistemicStatus,
          evidenceRefs: ["fact:standby-share", "fact:operating-share"],
          incrementalContext: {
            relatedPresentedClaimIds: [],
            novelConclusion: `Standby is 31% while operating is 69%; ${qualifier}.`,
          },
        });
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [
            relationship("candidate-relational-observed", "observed", "their connection is newly asserted"),
            relationship("candidate-relational-inferred", "inferred", "their connection remains an inference to test"),
          ] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "structured-epistemic-run",
        sessionId: "structured-epistemic-session",
      });
      expect(result.publication).toMatchObject({
        discoveredCount: 2,
        acceptedCount: 1,
        rejectedCount: 1,
        acceptedCandidateIds: ["candidate-relational-inferred"],
        rejectedCandidateIds: ["candidate-relational-observed"],
      });
    } finally {
      harness.close();
    }
  });

  it("rejects overlong or title-list summaries while preserving a concise highest-value Finding", async () => {
    const harness = createHarness();
    try {
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: async ({ identity, catalog: currentCatalog }) =>
          createPreschoolAdditionalAiPresentedClaims({ identity, catalog: currentCatalog, readModel: null }),
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [
            candidate("candidate-title-list", "fact:standby-share", {
              title: "First repeated title; second repeated title; third repeated title",
              incrementalContext: incrementalContext("deterministic-overview:fact:standby-share"),
            }),
            candidate("candidate-title-overlong", "fact:standby-share", {
              title: "One ostensibly incremental conclusion ".repeat(8),
              incrementalContext: incrementalContext("deterministic-overview:fact:standby-share"),
            }),
            candidate("candidate-title-multiple-sentences", "fact:standby-share", {
              title: "The share is stable. A timing relationship remains untested",
              incrementalContext: incrementalContext("deterministic-overview:fact:standby-share"),
            }),
            candidate("candidate-title-long-under-old-limit", "fact:standby-share", {
              title: "A concise finding should not become a long management-summary headline that carries several loosely connected qualifications",
              incrementalContext: incrementalContext("deterministic-overview:fact:standby-share"),
            }),
            candidate("candidate-concise", "fact:standby-share", {
              title: "Standby concentration is worth testing",
              text: "The existing share may be concentrated in a small set of intervals.",
              epistemicStatus: "speculative",
              incrementalContext: incrementalContext("deterministic-overview:fact:standby-share"),
            }),
          ] }),
          runId,
          sessionId,
        }),
      });

      const result = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "concise-summary-run",
        sessionId: "concise-summary-session",
      });

      expect(result.publication).toMatchObject({
        acceptedCandidateIds: ["candidate-concise"],
        rejectedCandidateIds: [
          "candidate-title-list",
          "candidate-title-overlong",
          "candidate-title-multiple-sentences",
          "candidate-title-long-under-old-limit",
        ],
      });
      expect(result.findings[0]?.title).toBe("Standby concentration is worth testing");
    } finally {
      harness.close();
    }
  });

  it("runs independent evaluation attempts through the real acceptance seam without current Artifact queue/cache", async () => {
    const harness = createHarness();
    try {
      const runDiscovery = vi.fn(async ({ runId, sessionId }) => ({
        answer: JSON.stringify({ candidates: [candidate(`candidate-${runId}`, "fact:standby-share")] }),
        runId,
        sessionId,
      }));
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery,
      });
      const first = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "evaluation-run-1",
        sessionId: "evaluation-session-1",
      });
      const second = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "evaluation-run-2",
        sessionId: "evaluation-session-2",
      });
      expect(runDiscovery).toHaveBeenCalledTimes(2);
      expect([first.runId, second.runId]).toEqual(["evaluation-run-1", "evaluation-run-2"]);
      expect(harness.metadata.energyIq.overviewAiArtifacts.find(harness.additionalIdentity)).toBeUndefined();
    } finally {
      harness.close();
    }
  });

  it("carries the prompt origin declaration through strict schema parsing and server acceptance", async () => {
    const harness = createHarness();
    try {
      const proposed = {
        candidates: [candidate("candidate-origin-contract", "fact:standby-share", {
          origin: { kind: "ai-discovery", directionMethodResourceIds: [] },
        })],
      };
      const strictSchema = toStandardSchema(PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V3.schema as never);
      const runDiscovery = vi.fn(async ({ prompt, runId, sessionId }) => {
        expect(prompt).toContain("origin:{kind:'ai-discovery|expert-sop|hybrid'");
        const validation = await strictSchema["~standard"].validate(proposed);
        expect(validation).not.toEqual(expect.objectContaining({ issues: expect.anything() }));
        return { answer: JSON.stringify(proposed), runId, sessionId };
      });
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery,
      });

      const artifact = await workflow.evaluateAttempt({
        identity: harness.additionalIdentity,
        user: harness.user,
        runId: "origin-contract-run",
        sessionId: "origin-contract-session",
      });

      expect(artifact).toMatchObject({
        status: "available",
        publication: { discoveredCount: 1, acceptedCount: 1, rejectedCount: 0 },
        findings: [{
          id: "additional:candidate-origin-contract",
          origin: { kind: "ai-discovery", directionMethods: [] },
        }],
      });
    } finally {
      harness.close();
    }
  });

  it("maps each candidate's stable Method refs to truthful Finding provenance and rejects bad refs locally", async () => {
    const harness = createHarness();
    try {
      const prompts: string[] = [];
      let discoveryCall = 0;
      let publishedMethodResourceId = "";
      const runDiscovery = vi.fn(async ({ prompt, runId, sessionId }) => {
        prompts.push(prompt);
        discoveryCall += 1;
        return {
          answer: JSON.stringify({ candidates: discoveryCall === 1
            ? [candidate("candidate-source", "fact:standby-share", {
                origin: { kind: "ai-discovery", directionMethodResourceIds: [] },
              })]
            : [
                candidate("candidate-core", "fact:standby-share", {
                  origin: { kind: "ai-discovery", directionMethodResourceIds: [] },
                }),
                candidate("candidate-sop", "fact:operating-share", {
                  origin: { kind: "expert-sop", directionMethodResourceIds: [publishedMethodResourceId] },
                }),
                candidate("candidate-unknown", "fact:standby-share", {
                  origin: { kind: "expert-sop", directionMethodResourceIds: ["insight-method:unloaded"] },
                }),
                candidate("candidate-duplicate", "fact:standby-share", {
                  origin: {
                    kind: "expert-sop",
                    directionMethodResourceIds: [publishedMethodResourceId, publishedMethodResourceId],
                  },
                }),
                candidate("candidate-hybrid-too-long", "fact:operating-share", {
                  origin: {
                    kind: "hybrid",
                    directionMethodResourceIds: [publishedMethodResourceId],
                    novelContribution: "x".repeat(801),
                  },
                }),
                candidate("candidate-hybrid", "fact:operating-share", {
                  origin: {
                    kind: "hybrid",
                    directionMethodResourceIds: [publishedMethodResourceId],
                    novelContribution: "Connect the repeated event shape to a separately evidenced operating pattern.",
                  },
                }),
              ] }),
          runId,
          sessionId,
        };
      });
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery,
      });
      const first = await workflow.execute({ baseIdentity: harness.baseIdentity, user: harness.user });
      const guidance = "Compare repeated event shape and timing before treating an isolated spike as a reusable pattern.";
      const provisional = harness.metadata.energyIq.insightMethodGovernance.createProposal({
        expectedWorkspaceId: PRESCHOOL_WORKSPACE_ID,
        expectedProjectId: "preschool-demo",
        artifactId: first.id,
        findingId: "additional:candidate-source",
        actorId: harness.user.id,
        idempotencyKey: "proposal:workflow-method",
        title: "Repeated event shape",
        guidance,
      });
      const inReview = harness.metadata.energyIq.insightMethodGovernance.submitProposal({
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        projectId: "preschool-demo",
        proposalId: provisional.id,
        actorId: harness.user.id,
        expectedRevision: provisional.revision,
      });
      const approved = harness.metadata.energyIq.insightMethodGovernance.approveProposal({
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        projectId: "preschool-demo",
        proposalId: provisional.id,
        actorId: harness.user.id,
        expectedRevision: inReview.revision,
      });
      const published = harness.metadata.energyIq.insightMethodGovernance.publishProposal({
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        projectId: "preschool-demo",
        proposalId: provisional.id,
        actorId: harness.user.id,
        expectedRevision: approved.revision,
      });
      publishedMethodResourceId = published.publication!.method.resourceId;

      const second = await workflow.execute({ baseIdentity: harness.baseIdentity, user: harness.user });
      const result = JSON.parse(second.result_json!) as AdditionalAiInsightsArtifact;

      expect(runDiscovery).toHaveBeenCalledTimes(2);
      expect(second.id).not.toBe(first.id);
      expect(prompts[1]).toContain(guidance);
      expect(prompts[1]).toContain("directionMethodResourceIds");
      expect(result.methodExecution.loadedMethods).toHaveLength(2);
      expect(result.findings.map(({ id }) => id)).toEqual([
        "additional:candidate-core",
        "additional:candidate-sop",
        "additional:candidate-hybrid",
      ]);
      expect(result.findings[0]?.origin).toEqual({
        kind: "ai-discovery",
        coreMethod: result.methodExecution.loadedMethods[0],
        directionMethods: [],
      });
      expect(result.findings[1]?.origin).toMatchObject({
        kind: "expert-sop",
        directionMethods: [expect.objectContaining({
          resourceId: publishedMethodResourceId,
          scope: "workspace",
          workspaceId: PRESCHOOL_WORKSPACE_ID,
          role: "expert-direction",
        })],
      });
      expect(result.findings[2]?.origin).toMatchObject({
        kind: "hybrid",
        directionMethods: [expect.objectContaining({ resourceId: publishedMethodResourceId })],
        novelContribution: "Connect the repeated event shape to a separately evidenced operating pattern.",
      });
      expect(result.publication.rejectedCandidateIds).toEqual([
        "candidate-unknown",
        "candidate-duplicate",
        "candidate-hybrid-too-long",
      ]);
      expect(composePreschoolOverviewAiReadModel({
        metadataStore: harness.metadata,
        baseIdentity: harness.baseIdentity,
      })?.additional).toMatchObject({
        status: "available",
        artifactId: second.id,
      });
    } finally {
      harness.close();
    }
  });

  it("discovers openly, rejects bad candidates locally and publishes at most three in model source order", async () => {
    const harness = createHarness();
    try {
      let receivedPrompt = "";
      const runDiscovery = vi.fn(async ({ prompt, invokeTool, runId, sessionId }) => {
        receivedPrompt = prompt;
        const tool = await invokeTool({
          toolName: "energy.evidence.read",
          toolCallId: "tool-call:discovery:1",
          input: { factIds: ["fact:standby-share"] },
        });
        return {
          answer: JSON.stringify({ candidates: [
            candidate("candidate-pattern", "fact:standby-share", { toolAuditIds: [tool.auditId] }),
            candidate("candidate-forged", "fact:forged"),
            candidate("candidate-compare", "fact:operating-share", { epistemicStatus: "observed" }),
            candidate("candidate-overstated-alert", "fact:partial", {
              epistemicStatus: "speculative",
              alert: { severity: "urgent", certainty: "confirmed", evidenceRefs: ["fact:partial"] },
            }),
            candidate("candidate-counterexample", "fact:standby-share"),
            candidate("candidate-low-risk-test", "fact:operating-share", { epistemicStatus: "speculative" }),
          ] }),
          runId,
          sessionId,
        };
      });
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery,
      });

      const artifact = await workflow.execute({ baseIdentity: harness.baseIdentity, user: harness.user });
      expect(artifact.error_code).toBeUndefined();
      expect(artifact).toMatchObject({ status: "available" });
      expect(receivedPrompt).toContain(ENERGYIQ_OPEN_DISCOVERY_METHOD_CONTENT_V1);
      expect(receivedPrompt).toContain("Zero candidates is valid");
      expect(receivedPrompt).not.toContain("fill every lens");
      expect(receivedPrompt).not.toContain("snapshot-evidence:");
      const result = JSON.parse(artifact.result_json!) as AdditionalAiInsightsArtifact;

      expect(artifact).toMatchObject({
        status: "available",
        attempt_count: 1,
        run_id: expect.stringMatching(/^preschool-additional-ai-insights-/u),
      });
      expect(result.status).toBe("available");
      expect(result.findings.map(({ id }) => id)).toEqual([
        "additional:candidate-pattern",
        "additional:candidate-compare",
        "additional:candidate-counterexample",
      ]);
      expect(result.publication).toMatchObject({
        discoveredCount: 6,
        acceptedCount: 4,
        rejectedCount: 2,
        publishedCount: 3,
        sourceOrderCandidateIds: [
          "candidate-pattern", "candidate-forged", "candidate-compare",
          "candidate-overstated-alert", "candidate-counterexample", "candidate-low-risk-test",
        ],
        acceptedCandidateIds: [
          "candidate-pattern", "candidate-compare", "candidate-counterexample", "candidate-low-risk-test",
        ],
        rejectedCandidateIds: ["candidate-forged", "candidate-overstated-alert"],
        publishedCandidateIds: ["candidate-pattern", "candidate-compare", "candidate-counterexample"],
        suppressedCandidateIds: ["candidate-low-risk-test"],
      });
      expect(result.evidenceLineage.facts.map(({ id }) => id).sort()).toEqual([
        "fact:operating-share", "fact:standby-share",
      ]);
      expect(result.methodExecution.loadedMethods).toHaveLength(1);
      expect(result.toolAudits).toEqual([
        expect.objectContaining({
          auditId: "additional-tool-audit:tool-call:discovery:1",
          status: "succeeded",
        }),
      ]);
    } finally {
      harness.close();
    }
  });

  it("persists a truthful empty result when discovery yields no accepted candidate", async () => {
    const harness = createHarness();
    try {
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [] }),
          runId,
          sessionId,
        }),
      });

      const artifact = await workflow.execute({ baseIdentity: harness.baseIdentity, user: harness.user });
      expect(artifact.error_code).toBeUndefined();
      const result = JSON.parse(artifact.result_json!) as AdditionalAiInsightsArtifact;
      expect(result).toMatchObject({
        status: "empty",
        findings: [],
        publication: {
          discoveredCount: 0,
          acceptedCount: 0,
          rejectedCount: 0,
          publishedCount: 0,
        },
      });
    } finally {
      harness.close();
    }
  });

  it("persists server-accepted Canvas blocks while rejecting a bad sibling block locally", async () => {
    const harness = createHarness();
    try {
      const canvasCandidate = candidate("candidate-canvas", "fact:standby-share", {
        canvas: canvasPlan({
          candidateId: "candidate-canvas",
          title: "Title for candidate-canvas",
          text: "Incremental observation for candidate-canvas.",
        }),
      });
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [canvasCandidate] }),
          runId,
          sessionId,
        }),
      });

      const artifact = await workflow.execute({ baseIdentity: harness.baseIdentity, user: harness.user });
      expect(artifact.error_code).toBeUndefined();
      expect(artifact).toMatchObject({ status: "available" });
      const result = JSON.parse(artifact.result_json!) as AdditionalAiInsightsArtifact;
      expect(result.status).toBe("available");
      if (result.status !== "available") throw new Error("available Additional fixture required");
      expect(result.findings[0]?.canvas).toMatchObject({
        contractRevision: "energyiq-insight-canvas-v2",
        planId: "canvas-plan:additional:candidate-canvas",
        acceptedBlockIds: ["canvas-block:standby-share"],
        acceptedBlocks: [{
          id: "canvas-block:standby-share",
          visualization: "comparison",
          bindings: [{ evidenceRef: "fact:standby-share", value: 31, unit: "%" }],
        }],
        rejections: [{
          code: "EVIDENCE_BINDING_MISMATCH",
          subjectId: "canvas-block:forged",
        }],
      });
      expect(result.evidenceLineage.facts).toContainEqual(expect.objectContaining({
        id: "fact:standby-share",
        metricId: "energy.standby-share",
        value: 31,
        unit: "%",
      }));
    } finally {
      harness.close();
    }
  });

  it("keeps the first three accepted Canvas blocks and records a local rejection for the presentation budget", async () => {
    const harness = createHarness();
    try {
      const plan = canvasPlan({
        candidateId: "candidate-budget",
        title: "Title for candidate-budget",
        text: "Incremental observation for candidate-budget.",
      });
      const acceptedTemplate = plan.investigatorBlocks[0]!;
      plan.investigatorBlocks = Array.from({ length: 4 }, (_, index) => ({
        ...structuredClone(acceptedTemplate),
        id: `canvas-block:accepted-${index + 1}`,
        title: `Accepted block ${index + 1}`,
      }));
      plan.editorPlan.orderedBlockIds = plan.investigatorBlocks.map(({ id }) => id);
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({
            candidates: [candidate("candidate-budget", "fact:standby-share", { canvas: plan })],
          }),
          runId,
          sessionId,
        }),
      });

      const artifact = await workflow.execute({ baseIdentity: harness.baseIdentity, user: harness.user });
      expect(artifact).toMatchObject({ status: "available" });
      const result = JSON.parse(artifact.result_json!) as AdditionalAiInsightsArtifact;
      if (result.status !== "available") throw new Error("available Additional fixture required");
      expect(result.findings[0]?.canvas).toMatchObject({
        acceptedBlockIds: [
          "canvas-block:accepted-1",
          "canvas-block:accepted-2",
          "canvas-block:accepted-3",
        ],
        rejections: [{
          code: "PRESENTATION_BUDGET_EXCEEDED",
          subjectId: "canvas-block:accepted-4",
        }],
      });
    } finally {
      harness.close();
    }
  });

  it("rejects a forged tool audit locally without losing its valid sibling", async () => {
    const harness = createHarness();
    try {
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery: async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [
            candidate("candidate-audit-forged", "fact:standby-share", { toolAuditIds: ["audit:forged"] }),
            candidate("candidate-valid", "fact:operating-share"),
          ] }),
          runId,
          sessionId,
        }),
      });

      const artifact = await workflow.execute({ baseIdentity: harness.baseIdentity, user: harness.user });
      const result = JSON.parse(artifact.result_json!) as AdditionalAiInsightsArtifact;
      expect(result.findings.map(({ id }) => id)).toEqual(["additional:candidate-valid"]);
      expect(result.publication.rejectedCandidateIds).toEqual(["candidate-audit-forged"]);
    } finally {
      harness.close();
    }
  });

  it("single-flights exact concurrent and repeated generation without adding Provider runs", async () => {
    const harness = createHarness();
    try {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let started!: () => void;
      const hasStarted = new Promise<void>((resolve) => { started = resolve; });
      const runDiscovery = vi.fn(async ({ runId, sessionId }) => {
        started();
        await gate;
        return {
          answer: JSON.stringify({ candidates: [candidate("candidate-once", "fact:standby-share")] }),
          runId,
          sessionId,
        };
      });
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery,
      });

      const first = workflow.execute({ baseIdentity: harness.baseIdentity, user: harness.user });
      await hasStarted;
      const concurrent = await workflow.execute({ baseIdentity: harness.baseIdentity, user: harness.user });
      expect(concurrent.status).toBe("running");
      expect(runDiscovery).toHaveBeenCalledTimes(1);
      release();
      const completed = await first;
      const repeated = await workflow.execute({ baseIdentity: harness.baseIdentity, user: harness.user });

      expect(completed.status).toBe("available");
      expect(repeated).toEqual(completed);
      expect(runDiscovery).toHaveBeenCalledTimes(1);
    } finally {
      harness.close();
    }
  });

  it("recovers a failed exact Artifact on the next authorized generation attempt", async () => {
    const harness = createHarness();
    try {
      const runDiscovery = vi.fn()
        .mockRejectedValueOnce(new Error("PRESCHOOL_ADDITIONAL_AI_PROVIDER_FAILED"))
        .mockImplementationOnce(async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ candidates: [candidate("candidate-recovered", "fact:standby-share")] }),
          runId,
          sessionId,
        }));
      const workflow = createPreschoolAdditionalAiInsightsWorkflow({
        metadataStore: harness.metadata,
        resolveEvidenceCatalog: async () => catalog(),
        resolvePresentedClaims: resolvePresentedClaimsFixture,
        runDiscovery,
      });

      const failed = await workflow.execute({ baseIdentity: harness.baseIdentity, user: harness.user });
      const recovered = await workflow.execute({ baseIdentity: harness.baseIdentity, user: harness.user });

      expect(failed).toMatchObject({
        status: "failed",
        attempt_count: 1,
        error_code: "PRESCHOOL_ADDITIONAL_AI_PROVIDER_FAILED",
      });
      expect(recovered).toMatchObject({ status: "available", attempt_count: 2 });
      expect(runDiscovery).toHaveBeenCalledTimes(2);
    } finally {
      harness.close();
    }
  });
});

const createHarness = () => {
  const root = mkdtempSync(join(tmpdir(), "preschool-additional-workflow-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  metadata.users.upsertDevUser({
    id: "dev-user",
    email: "admin@example.test",
    display_name: "Admin",
    dev_token: "dev-token",
  });
  ensureEnergyIqBootstrap(metadata);
  metadata.configResources.upsert({
    id: "profile-test",
    workspace_id: "default",
    user_id: "dev-user",
    kind: "model-profile",
    name: "Test profile",
    payload: { provider: "openai-compatible", modelName: "model-test" },
    default_enabled: true,
    status: "connected",
  });
  metadata.workspaceDefaultModelProfiles.set({
    workspace_id: "default",
    profile_id: "profile-test",
    profile_owner_user_id: "dev-user",
    configured_by_user_id: "dev-user",
  });
  const user = metadata.users.getById({ user_id: "dev-user" }) as UserRecord;
  const project = metadata.energyIq.getProject("preschool-demo");
  const baseIdentity = createOverviewAiArtifactIdentity({
    workspaceId: PRESCHOOL_WORKSPACE_ID,
    projectId: "preschool-demo",
    scopeId: project.root_scope_id,
    dataSnapshotId: "snapshot-current",
    projectReleaseId: "release-current",
    analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
    analysisPeriodTo: "2026-06-01T00:00:00.000Z",
    rendererKey: "preschool-overview",
    rendererVersion: "1",
    modelProfileId: "workspace-default",
    modelProfileRevision: 1,
  });
  return {
    metadata,
    user,
    baseIdentity,
    additionalIdentity: createPreschoolAdditionalAiInsightArtifactIdentity({ baseIdentity }),
    close: () => {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
};

const candidate = (
  id: string,
  evidenceRef: string,
  overrides: Record<string, unknown> = {},
) => {
  const value = {
    id,
    title: `Title for ${id}`,
    text: `Incremental observation for ${id}.`,
    epistemicStatus: "inferred",
    origin: { kind: "ai-discovery", directionMethodResourceIds: [] },
    incrementalContext: incrementalContext(`deterministic-overview:${evidenceRef}`),
    evidenceRefs: [evidenceRef],
    toolAuditIds: [],
    ...overrides,
  };
  if (value.incrementalContext.novelConclusion === TEST_NOVEL_CONCLUSION_FROM_NARRATIVE) {
    value.incrementalContext = {
      ...value.incrementalContext,
      novelConclusion: String(value.text),
    };
  }
  return value;
};

const TEST_NOVEL_CONCLUSION_FROM_NARRATIVE = "__use-candidate-narrative__";

const incrementalContext = (relatedPresentedClaimId: string) => ({
  relatedPresentedClaimIds: [relatedPresentedClaimId],
  novelConclusion: TEST_NOVEL_CONCLUSION_FROM_NARRATIVE,
});

const resolvePresentedClaimsFixture: Parameters<typeof createPreschoolAdditionalAiInsightsWorkflow>[0]["resolvePresentedClaims"] =
  async ({ identity, catalog: currentCatalog }) => createPreschoolAdditionalAiPresentedClaims({
    identity,
    catalog: currentCatalog,
    readModel: null,
  });

const canvasPlan = (input: { candidateId: string; title: string; text: string }) => ({
  identity: {
    workspaceId: PRESCHOOL_WORKSPACE_ID,
    projectId: "preschool-demo",
    scopeId: "preschool-project",
    dataSnapshotId: "snapshot-current",
    projectReleaseId: "release-current",
  },
  finding: {
    id: input.candidateId,
    title: input.title,
    text: input.text,
    evidenceRefs: ["fact:standby-share"],
    visualNeeded: true,
  },
  investigatorBlocks: [{
    id: "canvas-block:standby-share",
    kind: "quantitative",
    visualization: "comparison",
    title: "Standby share",
    bindings: [{
      evidenceRef: "fact:standby-share",
      entityId: "preschool-project",
      metricId: "energy.standby-share",
      value: 31,
      unit: "%",
    }],
  }, {
    id: "canvas-block:forged",
    kind: "quantitative",
    visualization: "trend",
    title: "Forged trend",
    bindings: [{
      evidenceRef: "fact:standby-share",
      entityId: "preschool-project",
      metricId: "energy.standby-share",
      value: 999,
      unit: "%",
    }],
  }],
  presentationGapRequests: [],
  editorPlan: { orderedBlockIds: ["canvas-block:standby-share", "canvas-block:forged"] },
});

const catalog = (): AnalysisContextEvidenceCatalog => ({
  contract: "analysis-context-evidence@1",
  sourceId: "project-analysis-snapshot:preschool-demo:snapshot-current",
  pins: {
    workspaceId: PRESCHOOL_WORKSPACE_ID,
    projectId: "preschool-demo",
    scopeId: "preschool-project",
    dataSnapshotId: "snapshot-current",
    dataCutoff: "2026-06-01T00:00:00.000Z",
    projectReleaseId: "release-current",
    metricVersion: "energy-metrics-v1",
  },
  facts: [
    fact("fact:standby-share", "confirmed", 31),
    fact("fact:operating-share", "confirmed", 69),
    fact("fact:partial", "partial", 12),
  ],
});

const fact = (
  id: string,
  status: "confirmed" | "provisional" | "partial",
  value: number,
) => ({
  id,
  label: id,
  metricId: id.replace("fact:", "energy."),
  value,
  unit: "%",
  status,
  evidenceRefs: [`snapshot-evidence:${id}`],
  dimensions: {},
});

const presentedReadModel = (input: {
  dataSnapshotId: string;
  sectionEvidenceRef: string;
}) => ({
  binding: {
    workspaceId: PRESCHOOL_WORKSPACE_ID,
    projectId: "preschool-demo",
    scopeId: "preschool-project",
    dataSnapshotId: input.dataSnapshotId,
    projectReleaseId: "release-current",
    analysisPeriod: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
    modelProfileId: "workspace-default",
    modelProfileRevision: 1,
  },
  sections: {
    "standby-wastage": {
      status: "available",
      artifactId: "section-artifact-standby",
      result: {
        artifactKind: "section-interpretation",
        status: "available",
        sectionId: "standby-wastage",
        binding: {
          workspaceId: PRESCHOOL_WORKSPACE_ID,
          projectId: "preschool-demo",
          scopeId: "preschool-project",
          dataSnapshotId: input.dataSnapshotId,
          projectReleaseId: "release-current",
          analysisPeriod: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
          modelProfileId: "workspace-default",
          modelProfileRevision: 1,
        },
        summary: { text: "Standby energy use accounts for 31% of the selected period.", evidenceRefs: [input.sectionEvidenceRef] },
        insights: [],
      },
    },
  },
  executive: { status: "empty" },
});

const entityFact = (id: string, centreName: string, value: number) => ({
  id,
  label: `${centreName} energy intensity`,
  metricId: "energy.kwh_per_sqm",
  value,
  unit: "kWh/m2",
  status: "confirmed" as const,
  evidenceRefs: [`snapshot-evidence:${id}`],
  dimensions: { scopeName: centreName, centreCode: centreName.replace("Centre ", "") },
});
