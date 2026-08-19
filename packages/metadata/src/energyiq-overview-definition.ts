import {
  ENERGYIQ_OVERVIEW_DEFINITION_REVISION,
  type EnergyIqOverviewBlockEmphasis,
  type EnergyIqOverviewDefinition,
  type ReportTimePolicyRevision,
} from "@datafoundry/contracts";
import { createHash } from "node:crypto";

import {
  validateAndCanonicalizeTemplateDocument,
  type EnergyIqComponentRevisionRecord,
  type EnergyIqTemplateDraftDocument,
} from "./energyiq-template-store.js";

export type CompiledEnergyIqOverviewDefinition = {
  definition: EnergyIqOverviewDefinition;
  definitionFingerprint: string;
  templateDocument: EnergyIqTemplateDraftDocument;
  diff: EnergyIqOverviewDefinitionDiffItem[];
};

export type EnergyIqOverviewDefinitionDiffItem =
  | {
      kind: "section_order_changed";
      before: string[];
      after: string[];
    }
  | {
      kind: "section_updated";
      sectionKey: string;
      changedFields: string[];
    }
  | {
      kind: "block_updated";
      sectionKey: string;
      blockKey: string;
      changedFields: string[];
    }
  | {
      kind: "block_added";
      sectionKey: string;
      blockKey: string;
      index: number;
    };

export const compileEnergyIqOverviewDefinition = (input: {
  definition: unknown;
  baseDefinition?: unknown;
  catalog: readonly EnergyIqComponentRevisionRecord[];
  reportTimePolicy: ReportTimePolicyRevision;
}): CompiledEnergyIqOverviewDefinition => {
  const definition = canonicalizeDefinition(input.definition);
  assertUniqueDefinitionKeys(definition);
  const expectedPolicyRevisionId = `${input.reportTimePolicy.policyId}@${input.reportTimePolicy.revision}`;
  if (definition.timePolicyRevisionId !== expectedPolicyRevisionId) {
    throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_TIME_POLICY_MISMATCH");
  }
  const windowIds = new Set(input.reportTimePolicy.windows.map((window) => window.windowId));
  const catalogIds = new Set(input.catalog.map((capability) => capability.revision_id));
  for (const section of definition.sections) {
    if (!windowIds.has(section.primaryWindowId)
      || section.supportingWindowIds.some((windowId) => !windowIds.has(windowId))) {
      throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_WINDOW_INVALID");
    }
    for (const block of section.blocks) {
      if (!windowIds.has(block.windowId)) throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_WINDOW_INVALID");
      if (!catalogIds.has(block.capabilityRevisionId)) {
        throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_CAPABILITY_INVALID");
      }
    }
  }

  const canonicalTemplate = validateAndCanonicalizeTemplateDocument({
    document: {
      templates: [
        {
          template_id: "project",
          target_kind: "project",
          sections: definition.sections.map((section) => ({
            section_id: section.key,
            title: section.title,
            navigation_label: section.title,
            description: section.managementQuestion,
          })),
          components: definition.sections.flatMap((section) => section.blocks.map((block) => ({
            placement_id: block.key,
            component_revision_id: block.capabilityRevisionId,
            enabled: true,
            section_id: section.key,
          }))),
        },
      ],
    },
    tier_definition_ids: [],
    catalog: input.catalog,
  });

  const blocksByKey = new Map(definition.sections.flatMap((section) =>
    section.blocks.map((block) => [block.key, block] as const)));
  const project = canonicalTemplate.templates[0]!;
  for (const placement of project.components) {
    const block = blocksByKey.get(placement.placement_id!);
    const capability = input.catalog.find((item) => item.revision_id === placement.component_revision_id);
    if (!block || !capability || !placement.presentation) continue;
    const requestedTone = toneFor(block.emphasis);
    if (capability.allowed_presentation.visuals.tones.includes(requestedTone)) {
      placement.presentation.tone = requestedTone;
    }
  }

  const baseDefinition = input.baseDefinition === undefined
    ? undefined
    : canonicalizeDefinition(input.baseDefinition);
  if (baseDefinition) assertUniqueDefinitionKeys(baseDefinition);
  return {
    definition,
    definitionFingerprint: createHash("sha256").update(JSON.stringify(definition)).digest("hex"),
    templateDocument: canonicalTemplate,
    diff: baseDefinition ? describeDefinitionChanges(baseDefinition, definition) : [],
  };
};

const describeDefinitionChanges = (
  base: EnergyIqOverviewDefinition,
  desired: EnergyIqOverviewDefinition,
): EnergyIqOverviewDefinitionDiffItem[] => {
  const diff: EnergyIqOverviewDefinitionDiffItem[] = [];
  const beforeSectionOrder = base.sections.map((section) => section.key);
  const afterSectionOrder = desired.sections.map((section) => section.key);
  if (sameMembers(beforeSectionOrder, afterSectionOrder)
    && JSON.stringify(beforeSectionOrder) !== JSON.stringify(afterSectionOrder)) {
    diff.push({
      kind: "section_order_changed",
      before: beforeSectionOrder,
      after: afterSectionOrder,
    });
  }
  const baseSections = new Map(base.sections.map((section) => [section.key, section]));
  for (const section of desired.sections) {
    const previous = baseSections.get(section.key);
    if (!previous) continue;
    const sectionFields = [
      ...changed("title", previous.title, section.title),
      ...changed("managementQuestion", previous.managementQuestion, section.managementQuestion),
      ...changed("primaryWindowId", previous.primaryWindowId, section.primaryWindowId),
      ...changed(
        "supportingWindowIds",
        JSON.stringify(previous.supportingWindowIds),
        JSON.stringify(section.supportingWindowIds),
      ),
    ];
    if (sectionFields.length > 0) {
      diff.push({ kind: "section_updated", sectionKey: section.key, changedFields: sectionFields });
    }
    const previousBlocks = new Map(previous.blocks.map((block) => [block.key, block]));
    for (const [blockIndex, block] of section.blocks.entries()) {
      const previousBlock = previousBlocks.get(block.key);
      if (!previousBlock) {
        diff.push({
          kind: "block_added",
          sectionKey: section.key,
          blockKey: block.key,
          index: blockIndex,
        });
        continue;
      }
      const blockFields = [
        ...changed("capabilityRevisionId", previousBlock.capabilityRevisionId, block.capabilityRevisionId),
        ...changed("windowId", previousBlock.windowId, block.windowId),
        ...changed("emphasis", previousBlock.emphasis, block.emphasis),
      ];
      if (blockFields.length > 0) {
        diff.push({
          kind: "block_updated",
          sectionKey: section.key,
          blockKey: block.key,
          changedFields: blockFields,
        });
      }
    }
  }
  return diff;
};

const changed = (field: string, before: string, after: string): string[] => before === after ? [] : [field];

const sameMembers = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value) => right.includes(value));

const assertUniqueDefinitionKeys = (definition: EnergyIqOverviewDefinition): void => {
  const sectionKeys = new Set<string>();
  const blockKeys = new Set<string>();
  for (const section of definition.sections) {
    if (sectionKeys.has(section.key)) throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_KEY_DUPLICATE");
    sectionKeys.add(section.key);
    for (const block of section.blocks) {
      if (blockKeys.has(block.key)) throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_KEY_DUPLICATE");
      blockKeys.add(block.key);
    }
  }
};

const canonicalizeDefinition = (value: unknown): EnergyIqOverviewDefinition => {
  const record = requireRecord(value);
  requireExactKeys(record, ["contractRevision", "timePolicyRevisionId", "sections"]);
  if (record.contractRevision !== ENERGYIQ_OVERVIEW_DEFINITION_REVISION) {
    throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_CONTRACT_INVALID");
  }
  if (!Array.isArray(record.sections) || record.sections.length === 0) {
    throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_SECTIONS_INVALID");
  }
  return {
    contractRevision: ENERGYIQ_OVERVIEW_DEFINITION_REVISION,
    timePolicyRevisionId: requireText(record.timePolicyRevisionId),
    sections: record.sections.map((sectionValue) => {
      const section = requireRecord(sectionValue);
      requireExactKeys(
        section,
        ["key", "title", "managementQuestion", "primaryWindowId", "blocks"],
        ["supportingWindowIds"],
      );
      const primaryWindowId = requireText(section.primaryWindowId);
      if (!Array.isArray(section.blocks) || section.blocks.length === 0) {
        throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_BLOCKS_INVALID");
      }
      return {
        key: requireKey(section.key),
        title: requireText(section.title),
        managementQuestion: requireText(section.managementQuestion),
        primaryWindowId,
        supportingWindowIds: Array.isArray(section.supportingWindowIds)
          ? section.supportingWindowIds.map(requireText)
          : [],
        blocks: section.blocks.map((blockValue) => {
          const block = requireRecord(blockValue);
          requireExactKeys(block, ["key", "capabilityRevisionId"], ["windowId", "emphasis"]);
          return {
            key: requireKey(block.key),
            capabilityRevisionId: requireText(block.capabilityRevisionId),
            windowId: block.windowId === undefined ? primaryWindowId : requireText(block.windowId),
            emphasis: requireEmphasis(block.emphasis),
          };
        }),
      };
    }),
  };
};

const requireExactKeys = (
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void => {
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !(key in record)) || Object.keys(record).some((key) => !allowed.has(key))) {
    throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_FIELD_UNKNOWN");
  }
};

const requireRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_INVALID");
  }
  return value as Record<string, unknown>;
};

const requireText = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_TEXT_INVALID");
  const normalized = value.trim();
  if (/[<>]/u.test(normalized)) throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_TEXT_INVALID");
  return normalized;
};

const requireKey = (value: unknown): string => {
  const key = requireText(value);
  if (!/^[a-z][a-z0-9-]{0,63}$/u.test(key)) {
    throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_KEY_INVALID");
  }
  return key;
};

const requireEmphasis = (value: unknown): EnergyIqOverviewBlockEmphasis => {
  if (value === undefined) return "standard";
  if (value === "primary" || value === "standard" || value === "supporting") return value;
  throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_EMPHASIS_INVALID");
};

const toneFor = (emphasis: EnergyIqOverviewBlockEmphasis): "highlight" | "default" | "quiet" => {
  if (emphasis === "primary") return "highlight";
  if (emphasis === "supporting") return "quiet";
  return "default";
};
