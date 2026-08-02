import type { ReactNode } from "react";

import type { EnergyComponentRevisionDto, EnergyScopeAnalysisDto } from "../../../lib/config-api";
import { buildDecisionDashboardModel } from "./decision-dashboard-model";

type RenderedModule = {
  component: EnergyComponentRevisionDto;
  readiness: {
    status: "ready" | "partial" | "missing";
    label: string;
    detail: string;
  };
};

export function EnergyTemplateRenderer({
  analysis,
  modules,
}: {
  analysis: EnergyScopeAnalysisDto;
  modules: RenderedModule[];
}) {
  const dashboard = buildDecisionDashboardModel(analysis);
  if (modules.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface-subtle p-8 text-center text-xs text-muted">
        This template does not have any enabled modules.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {modules.map((module, index) => (
        <TemplateModuleFrame key={module.component.revision_id} index={index} module={module}>
          {module.readiness.status === "missing" ? (
            <UnavailableModule detail={module.readiness.detail} />
          ) : (
            <ModuleContent viewKey={module.component.view_key} analysis={analysis} dashboard={dashboard} />
          )}
        </TemplateModuleFrame>
      ))}
    </div>
  );
}

function TemplateModuleFrame({
  index,
  module,
  children,
}: {
  index: number;
  module: RenderedModule;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-subtle text-[10px] font-bold text-muted">
            {String(index + 1).padStart(2, "0")}
          </span>
          <div className="min-w-0">
            <h6 className="text-sm font-semibold text-foreground">{module.component.display_name}</h6>
            <p className="mt-1 text-[11px] leading-4 text-muted">{module.component.description}</p>
          </div>
        </div>
        <span className={[
          "rounded-full px-2.5 py-1 text-[9px] font-semibold",
          module.readiness.status === "ready"
            ? "bg-step-success/10 text-step-success"
            : module.readiness.status === "partial"
              ? "bg-step-warning/10 text-step-warning"
              : "bg-surface-subtle text-muted",
        ].join(" ")}>
          {module.readiness.label}
        </span>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function ModuleContent({
  viewKey,
  analysis,
  dashboard,
}: {
  viewKey: string;
  analysis: EnergyScopeAnalysisDto;
  dashboard: ReturnType<typeof buildDecisionDashboardModel>;
}) {
  switch (viewKey) {
    case "executive_action_summary_v1":
      return <ExecutiveAction dashboard={dashboard} />;
    case "consumption_overview_v1":
      return <ConsumptionOverview dashboard={dashboard} analysis={analysis} />;
    case "child_scope_ranking_v1":
      return <ScopeRanking analysis={analysis} />;
    case "area_intensity_comparison_v1":
      return <NormalisedComparison analysis={analysis} kind="area" />;
    case "people_intensity_comparison_v1":
      return <NormalisedComparison analysis={analysis} kind="people" />;
    case "off_hours_analysis_v1":
      return <OffHoursAnalysis analysis={analysis} />;
    case "operating_pattern_v1":
      return <OperatingPattern analysis={analysis} />;
    case "meter_breakdown_v1":
      return <MeterBreakdown analysis={analysis} />;
    case "data_quality_summary_v1":
      return <DataQuality analysis={analysis} />;
    case "exceptions_evidence_v1":
      return <ExceptionsEvidence analysis={analysis} />;
    default:
      return <UnavailableModule detail={`No renderer is registered for ${viewKey}`} />;
  }
}

function ExecutiveAction({ dashboard }: { dashboard: ReturnType<typeof buildDecisionDashboardModel> }) {
  const insight = dashboard.insights[0];
  if (!insight) return <UnavailableModule detail="No deterministic finding is available for this selection." />;
  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-light">Recommended first action</p>
        <h6 className="mt-2 text-base font-semibold text-foreground">{insight.title}</h6>
        <p className="mt-2 text-sm leading-6 text-muted">{insight.finding}</p>
        <div className="mt-4 border-l-2 border-primary bg-surface-subtle px-4 py-3 text-sm text-muted">{insight.action}</div>
      </div>
      <dl className="grid content-start gap-3 rounded-lg bg-surface-subtle p-4 text-xs">
        <div><dt className="text-muted-light">Scope</dt><dd className="mt-1 font-semibold">{insight.scope}</dd></div>
        <div><dt className="text-muted-light">Impact</dt><dd className="mt-1 font-semibold">{insight.impact}</dd></div>
        <div><dt className="text-muted-light">Evidence</dt><dd className="mt-1 break-words text-muted">{insight.evidence}</dd></div>
      </dl>
    </div>
  );
}

function ConsumptionOverview({
  dashboard,
  analysis,
}: {
  dashboard: ReturnType<typeof buildDecisionDashboardModel>;
  analysis: EnergyScopeAnalysisDto;
}) {
  const cards = [
    ...dashboard.summary,
    { label: "Peak demand", value: `${formatNumber(analysis.summary.peakKw, 2)} kW`, note: dashboard.periodLabel, tone: "muted" as const },
  ];
  return (
    <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 xl:grid-cols-5">
      {cards.map((item) => (
        <div key={item.label} className="bg-surface px-4 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-light">{item.label}</p>
          <p className="mt-2 text-lg font-semibold tabular-nums text-foreground">{item.value}</p>
          <p className="mt-1 text-[10px] leading-4 text-muted">{item.note}</p>
        </div>
      ))}
    </div>
  );
}

function ScopeRanking({ analysis }: { analysis: EnergyScopeAnalysisDto }) {
  const rows = analysis.childScopes.toSorted((left, right) => right.usageKwh - left.usageKwh);
  const maximum = Math.max(0, ...rows.map((row) => row.usageKwh));
  if (rows.length === 0) return <UnavailableModule detail="The selected scope has no directly comparable child scopes." />;
  return (
    <div className="space-y-3">
      {rows.slice(0, 10).map((row, index) => (
        <div key={row.nodeId} className="grid grid-cols-[24px_minmax(120px,0.8fr)_minmax(120px,1.4fr)_auto] items-center gap-3 text-xs">
          <span className="text-muted-light">{index + 1}</span>
          <span className="truncate font-semibold">{row.name}</span>
          <div className="h-2 overflow-hidden rounded-full bg-surface-subtle"><div className="h-full rounded-full bg-primary" style={{ width: `${maximum > 0 ? (row.usageKwh / maximum) * 100 : 0}%` }} /></div>
          <span className="text-right tabular-nums text-muted">{formatNumber(row.usageKwh, 1)} kWh · {row.sharePct.toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}

function NormalisedComparison({ analysis, kind }: { analysis: EnergyScopeAnalysisDto; kind: "area" | "people" }) {
  const rows = analysis.childScopes
    .flatMap((row) => {
      const value = kind === "area" ? row.kwhPerSqm : row.kwhPerPerson;
      return value === undefined ? [] : [{ id: row.nodeId, name: row.name, value, base: kind === "area" ? row.areaSqm : row.occupantCount }];
    })
    .toSorted((left, right) => right.value - left.value);
  if (rows.length === 0) {
    return <UnavailableModule detail={`No child scope has usable ${kind === "area" ? "area" : "people"} metadata in this result.`} />;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-xs">
        <thead className="text-[10px] uppercase tracking-wide text-muted-light"><tr><th className="pb-3">Scope</th><th className="pb-3 text-right">{kind === "area" ? "Area" : "People"}</th><th className="pb-3 text-right">{kind === "area" ? "kWh / m²" : "kWh / person"}</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id} className="border-t border-border"><td className="py-3 font-semibold">{row.name}</td><td className="py-3 text-right text-muted">{row.base?.toLocaleString() ?? "—"}</td><td className="py-3 text-right font-semibold tabular-nums">{formatNumber(row.value, 2)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function OffHoursAnalysis({ analysis }: { analysis: EnergyScopeAnalysisDto }) {
  const rows = analysis.circuits.toSorted((left, right) => right.nonOperatingKwh - left.nonOperatingKwh).slice(0, 8);
  return (
    <div className="grid gap-5 lg:grid-cols-[0.7fr_1.3fr]">
      <div className="rounded-lg bg-surface-subtle p-5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-light">Outside operating hours</p>
        <p className="mt-2 text-2xl font-semibold">{formatNumber(analysis.summary.nonOperatingKwh, 2)} kWh</p>
        <p className="mt-1 text-xs text-muted">{analysis.summary.nonOperatingSharePct.toFixed(1)}% of selected-period use</p>
      </div>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.meterNodeId} className="flex items-center justify-between gap-3 border-b border-border py-2 text-xs last:border-b-0">
            <span className="truncate font-medium">{row.name}</span>
            <span className="shrink-0 tabular-nums text-muted">{formatNumber(row.nonOperatingKwh, 2)} kWh</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function OperatingPattern({ analysis }: { analysis: EnergyScopeAnalysisDto }) {
  const maximum = Math.max(0, ...analysis.hourlyProfile.map((point) => point.peakKw));
  return (
    <div className="grid h-56 grid-cols-12 items-end gap-1 sm:grid-cols-24">
      {analysis.hourlyProfile.map((point) => (
        <div key={point.hour} className="group flex h-full flex-col justify-end gap-1" title={`${String(point.hour).padStart(2, "0")}:00 · avg ${point.averageKw.toFixed(2)} kW · peak ${point.peakKw.toFixed(2)} kW`}>
          <div className="mx-auto w-full max-w-5 rounded-t bg-primary/25" style={{ height: `${maximum > 0 ? Math.max(2, (point.peakKw / maximum) * 100) : 2}%` }} />
          <div className="mx-auto w-full max-w-5 rounded-t bg-primary" style={{ height: `${maximum > 0 ? Math.max(2, (point.averageKw / maximum) * 100) : 2}%` }} />
          <span className="hidden text-center text-[8px] text-muted-light sm:block">{point.hour % 3 === 0 ? String(point.hour).padStart(2, "0") : ""}</span>
        </div>
      ))}
    </div>
  );
}

function MeterBreakdown({ analysis }: { analysis: EnergyScopeAnalysisDto }) {
  const rows = analysis.circuits.toSorted((left, right) => right.usageKwh - left.usageKwh);
  if (rows.length === 0) return <UnavailableModule detail="No mapped meter contributes to the selected scope and period." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] text-left text-xs">
        <thead className="text-[10px] uppercase tracking-wide text-muted-light"><tr><th className="pb-3">Meter</th><th className="pb-3">Category</th><th className="pb-3">Role</th><th className="pb-3 text-right">Energy</th><th className="pb-3 text-right">Share</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.meterNodeId} className="border-t border-border"><td className="py-3 font-semibold">{row.name}</td><td className="py-3 capitalize text-muted">{row.category}</td><td className="py-3 capitalize text-muted">{row.meterRole}</td><td className="py-3 text-right tabular-nums">{formatNumber(row.usageKwh, 2)} kWh</td><td className="py-3 text-right tabular-nums text-muted">{row.sharePct.toFixed(1)}%</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function DataQuality({ analysis }: { analysis: EnergyScopeAnalysisDto }) {
  return (
    <dl className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
      <QualityFact label="Valid intervals" value={analysis.summary.validIntervalCount.toLocaleString()} />
      <QualityFact label="Quality events" value={analysis.summary.qualityEventCount.toLocaleString()} />
      <QualityFact label="Data snapshot" value={analysis.provenance.dataSnapshotId} mono />
    </dl>
  );
}

function QualityFact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="bg-surface p-4"><dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-light">{label}</dt><dd className={["mt-2 text-sm font-semibold", mono ? "break-all font-mono text-[11px]" : ""].join(" ")}>{value}</dd></div>;
}

function ExceptionsEvidence({ analysis }: { analysis: EnergyScopeAnalysisDto }) {
  const items = analysis.attention.length > 0 ? analysis.attention : [{ code: "NO_EXCEPTION", severity: "info" as const, title: "No deterministic exception was triggered", evidence: "The selected scope passed the enabled rules.", suggestedAction: "Continue monitoring after the next import." }];
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={`${item.code}:${item.title}`} className="rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-surface-subtle px-2 py-0.5 text-[9px] font-semibold uppercase text-muted">{item.severity}</span><strong className="text-xs">{item.title}</strong></div>
          <p className="mt-2 text-xs leading-5 text-muted">{item.evidence}</p>
          <p className="mt-2 text-xs font-medium">{item.suggestedAction}</p>
        </div>
      ))}
      <p className="break-words text-[10px] text-muted-light">Queries: {analysis.provenance.queryIds.join(", ")} · Rules: {analysis.provenance.ruleRevisionIds.join(", ") || "none"} · Aggregation: {analysis.provenance.aggregationRule}</p>
    </div>
  );
}

function UnavailableModule({ detail }: { detail: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface-subtle px-4 py-5 text-xs text-muted">
      Preview withheld: {detail}
    </div>
  );
}

function formatNumber(value: number, digits: number): string {
  return value.toLocaleString("en-SG", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
