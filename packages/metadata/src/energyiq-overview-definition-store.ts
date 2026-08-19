import type {
  EnergyIqOverviewDefinition,
  ReportTimePolicyRevision,
} from "@datafoundry/contracts";
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import {
  compileEnergyIqOverviewDefinition,
  type EnergyIqOverviewDefinitionDiffItem,
} from "./energyiq-overview-definition.js";
import {
  EnergyIqTemplateStore,
  type EnergyIqTemplateRevisionRecord,
} from "./energyiq-template-store.js";

export type EnergyIqOverviewDefinitionRevisionRecord = {
  template_revision_id: string;
  definition: EnergyIqOverviewDefinition;
  definition_fingerprint: string;
  time_policy_revision_id: string;
};

export const initializeEnergyIqOverviewDefinitionSchema = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS energyiq_overview_definition_revisions (
      template_revision_id TEXT PRIMARY KEY,
      definition_json TEXT NOT NULL,
      definition_fingerprint TEXT NOT NULL,
      time_policy_revision_id TEXT NOT NULL,
      FOREIGN KEY (template_revision_id) REFERENCES energyiq_template_revisions(revision_id) ON DELETE CASCADE
    );
  `);
};

export class EnergyIqOverviewDefinitionStore {
  private readonly templates: EnergyIqTemplateStore;

  constructor(private readonly db: DatabaseSync) {
    this.templates = new EnergyIqTemplateStore(db);
  }

  get(templateRevisionId: string): EnergyIqOverviewDefinitionRevisionRecord | null {
    const row = this.db.prepare(`
      SELECT template_revision_id, definition_json, definition_fingerprint, time_policy_revision_id
      FROM energyiq_overview_definition_revisions
      WHERE template_revision_id = ?
    `).get(templateRevisionId);
    return isRecord(row) ? mapRecord(row) : null;
  }

  publishFromRevisionWithinTransaction(input: {
    project_id: string;
    expected_base_revision_id: string;
    definition: unknown;
    report_time_policy: ReportTimePolicyRevision;
    published_by: string;
    published_at: string;
  }): {
    revision: EnergyIqTemplateRevisionRecord;
    record: EnergyIqOverviewDefinitionRevisionRecord;
    diff: EnergyIqOverviewDefinitionDiffItem[];
  } {
    const latest = this.templates.getLatestProjectRevision(input.project_id);
    if (!latest || latest.revision_id !== input.expected_base_revision_id) {
      throw new Error("ENERGYIQ_TEMPLATE_CHANGE_BASE_REVISION_STALE");
    }
    const baseDefinition = this.get(latest.revision_id)?.definition;
    const compiled = compileEnergyIqOverviewDefinition({
      definition: input.definition,
      ...(baseDefinition ? { baseDefinition } : {}),
      catalog: this.templates.listComponentRevisions(),
      reportTimePolicy: input.report_time_policy,
    });
    const projectTemplate = compiled.templateDocument.templates[0]!;
    const document = {
      schema_version: 2 as const,
      templates: [
        projectTemplate,
        ...latest.document.templates.filter((template) => template.target_kind === "tier"),
      ],
    };
    const revision = this.templates.publishDocumentFromRevisionWithinTransaction({
      project_id: input.project_id,
      expected_base_revision_id: input.expected_base_revision_id,
      document,
      published_by: input.published_by,
      published_at: input.published_at,
    });
    this.db.prepare(`
      INSERT INTO energyiq_overview_definition_revisions (
        template_revision_id, definition_json, definition_fingerprint, time_policy_revision_id
      ) VALUES (?, ?, ?, ?)
    `).run(
      revision.revision_id,
      JSON.stringify(compiled.definition),
      compiled.definitionFingerprint,
      compiled.definition.timePolicyRevisionId,
    );
    return {
      revision,
      record: this.require(revision.revision_id),
      diff: compiled.diff,
    };
  }

  private require(templateRevisionId: string): EnergyIqOverviewDefinitionRevisionRecord {
    const record = this.get(templateRevisionId);
    if (!record) throw new Error(`ENERGYIQ_OVERVIEW_DEFINITION_NOT_FOUND:${templateRevisionId}`);
    return record;
  }
}

const mapRecord = (row: Record<string, unknown>): EnergyIqOverviewDefinitionRevisionRecord => {
  const definitionJson = requiredString(row.definition_json);
  const definition = JSON.parse(definitionJson) as EnergyIqOverviewDefinition;
  const fingerprint = requiredString(row.definition_fingerprint);
  const actualFingerprint = createHash("sha256").update(JSON.stringify(definition)).digest("hex");
  if (actualFingerprint !== fingerprint) throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_FINGERPRINT_INVALID");
  return {
    template_revision_id: requiredString(row.template_revision_id),
    definition,
    definition_fingerprint: fingerprint,
    time_policy_revision_id: requiredString(row.time_policy_revision_id),
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const requiredString = (value: unknown): string => {
  if (typeof value !== "string" || !value) throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_RECORD_INVALID");
  return value;
};
