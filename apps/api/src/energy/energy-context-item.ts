import {
  createAgentContextItem,
  createAgentContextSourceMetadata,
  type AgentContextItem
} from "@datafoundry/agent-runtime";
import type { TrustedEnergyTextQueryContract } from "@datafoundry/agent-runtime";

import type { EnergyQueryContext } from "./energy-query-context.js";

export const createEnergyQueryContextItem = (
  context: EnergyQueryContext,
  sessionId: string
): AgentContextItem => createAgentContextItem({
  id: `energy-query-context:${context.projectId}:${context.scopeId}:${context.dataSnapshotId}`,
  sourceType: "energy-query-context",
  sourceId: context.projectId,
  groupId: "energy-query-context",
  visibility: "model",
  trust: "tool",
  retention: "active",
  priority: 100,
  content: [
    "Authoritative EnergyIQ query context. Use this scope and time range for every data query.",
    "The end timestamp is exclusive. Never substitute client-provided project or scope names.",
    "The enabled DuckDB datasource is a server-filtered view for exactly this context; do not use another datasource.",
    "usage_kwh is canonical interval consumption. source_reading_kind states whether it came from a cumulative-energy delta or a supplied interval-usage value.",
    "The datasource exposes only published Meter attachments. Use official_aggregation_eligible for Scope totals; never infer or replace that route from scope_id or meter_role.",
    "Use appliance for Aircon, Heater, Lighting and Plugload analysis; category is the simplified aircon, light or load business classification.",
    "is_operating comes from the published operating schedule. Compare non-operating usage, per-person usage and per-area usage only when the relevant metadata is available.",
    "Rows with quality_status other than 'ok' are evidence of data quality events and must not be counted as consumption.",
    ...ngeeAnnAnalysisPolicy(context),
    `workspace_id=${context.workspaceId}`,
    `project_id=${context.projectId}`,
    `project_name=${context.projectName}`,
    `scope_id=${context.scopeId}`,
    `scope_name=${context.scopeName}`,
    `scope_type=${context.scopeType}`,
    `resource=${context.resource}`,
    `timezone=${context.timezone}`,
    `from=${context.from}`,
    `to_exclusive=${context.to}`,
    `hierarchy_revision_id=${context.hierarchyRevisionId}`,
    `meter_mapping_revision_id=${context.meterMappingRevisionId}`,
    `meter_formula_revision_id=${context.meterFormulaRevisionId}`,
    `data_snapshot_id=${context.dataSnapshotId}`,
    `metric_version=${context.metricVersion}`,
    `business_calendar_version=${context.businessCalendarVersion}`,
    `tariff_schedule_version=${context.tariffScheduleVersion}`
  ].join("\n"),
  metadata: createAgentContextSourceMetadata({
    dedupeKeys: ["energy-query-context"],
    exclusivityKey: "energy-query-context",
    overlapKeys: [
      `project:${context.projectId}`,
      `scope:${context.scopeId}`,
      `snapshot:${context.dataSnapshotId}`
    ],
    scope: {
      datasourceId: context.dataSnapshotId,
      sessionId,
      userId: context.userId
    },
    sourceKind: "energy-query-context",
    sourceOwner: "server"
  }, {
    atomic: true,
    groupKind: "source"
  })
});

export const createTrustedEnergyTextContextItem = (
  contract: TrustedEnergyTextQueryContract,
  sessionId: string,
  userId: string
): AgentContextItem => createAgentContextItem({
  id: `trusted-energy-text:${contract.id}`,
  sourceType: "project-analysis-snapshot",
  sourceId: contract.pins.project.id,
  groupId: "trusted-energy-text",
  visibility: "model",
  trust: "tool",
  retention: "active",
  priority: 100,
  content: [
    "Authoritative ProjectAnalysisSnapshot trusted-text contract.",
    "Use only the expected facts and Evidence below. Do not query another source or substitute Scope, Period, Metric, or values.",
    "The Period end is exclusive. Return structured claims for validation; never reveal provider configuration or credentials.",
    `contract_id=${contract.id}`,
    `intent=${contract.intent}`,
    `scope=${contract.pins.scope.name} (${contract.pins.scope.id})`,
    `period_start=${contract.pins.period.start}`,
    `period_end_exclusive=${contract.pins.period.endExclusive}`,
    `timezone=${contract.pins.period.timezone}`,
    `metric=${contract.pins.metric.id} (${contract.pins.metric.revisionId})`,
    `data_snapshot_id=${contract.pins.dataSnapshotId}`,
    `data_as_of=${contract.pins.dataAsOf}`,
    `expected_facts=${JSON.stringify(contract.pins.expectedFacts)}`,
    `evidence=${JSON.stringify(contract.pins.evidenceRefs)}`
  ].join("\n"),
  metadata: createAgentContextSourceMetadata({
    dedupeKeys: ["trusted-energy-text"],
    exclusivityKey: "trusted-energy-text",
    overlapKeys: [
      `project:${contract.pins.project.id}`,
      `scope:${contract.pins.scope.id}`,
      `snapshot:${contract.pins.dataSnapshotId}`
    ],
    scope: {
      datasourceId: contract.pins.sourcePin.datasourceId,
      sessionId,
      userId
    },
    sourceKind: "project-analysis-snapshot",
    sourceOwner: "server"
  }, { atomic: true, groupKind: "source" })
});

const ngeeAnnAnalysisPolicy = (context: EnergyQueryContext): string[] =>
  context.projectId === "ngee-ann-polytechnic"
    ? [
        "Ngee Ann analysis policy:",
        "Start with list_data_sources, inspect_schema and preview_table. Use run_sql_readonly only after inspecting the run-local schema, and cite the resulting tool call or artifact for every reported number.",
        "For Project or Level totals, filter quality_status='ok' and use only the published Official Aggregation Route. Meter role is descriptive evidence, not permission to alter the route.",
        "For Circuit or category contribution, query non-total breakdown rows separately and compare them with the corresponding designated total. If the breakdown does not reconcile with that total, disclose the mismatch instead of forcing shares to 100%.",
        "For peak interval-average power, group by local_interval_start, sum average_kw across the designated totals, and then take the maximum. Never use MAX(average_kw) across individual meter rows as the Project peak.",
        "Compare Workday, Weekend and Public Holiday only for day_type values actually present in the inspected result. An absent slice is unavailable, not zero.",
        "Previous-period change and own-history normal level require rows for those comparison windows. This scoped datasource contains only the authoritative from-to range; when required rows fall outside it, say the comparison is unavailable instead of extrapolating.",
        "Per-area and per-person results require authoritative metadata in the current context or tool evidence. If those dimensions are absent, say unavailable and do not infer them from names or typical values.",
        "Off-hours conclusions require authoritative is_operating values and adequate coverage. If schedule or coverage cannot be established, describe observed rows only and do not label usage as avoidable waste.",
        "Do not answer tariff cost, carbon, forecast or water questions unless authoritative values are explicitly present in the current evidence.",
        "Every answer must state Scope, inclusive-exclusive Period, timezone, unit, aggregation route, material limitations, and the SQL/tool evidence used.",
        "Use SQL-produced table evidence for exact figures. Controlled line, bar or pie charts may only reuse columns returned by a tool result; never create new chart values or arbitrary chart code.",
        "When evidence is insufficient, return the precise limitation and the next required data. Never generate mock figures, business anomalies, root causes or action priorities."
      ]
    : [];
