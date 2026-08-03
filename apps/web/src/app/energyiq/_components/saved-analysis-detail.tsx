"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { configApi, type EnergySavedAnalysisDetailDto } from "../../../lib/config-api";
import { buildEnergyTemplateRenderPlan } from "./energy-template-render-plan";
import { EnergyTemplateRenderer, type EnergyTemplateRendererState } from "./energy-template-renderer";
import { useEnergyIqAccess } from "./energyiq-access";
import { EnergyIcon } from "./icons";
import { ScopeMetadataStatus } from "./scope-metadata-status";

export function SavedAnalysisDetail() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { activeProject } = useEnergyIqAccess();
  const [detail, setDetail] = useState<EnergySavedAnalysisDetailDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState(false);
  const projectId = activeProject?.id ?? "";
  const analysisId = params.id;

  useEffect(() => {
    if (!projectId || !analysisId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void configApi.getEnergySavedAnalysis(projectId, analysisId)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((reason) => {
        if (!cancelled) {
          setDetail(null);
          setError(reason instanceof Error ? reason.message : "Unable to load saved analysis");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [analysisId, projectId]);

  const plan = useMemo(() => {
    if (!detail) return null;
    const template = detail.templateRevision.document.templates.find((candidate) => candidate.template_id === "project");
    return template ? buildEnergyTemplateRenderPlan({ template, catalog: detail.catalog }) : null;
  }, [detail]);

  const rendererState: EnergyTemplateRendererState = loading || (!detail && !error)
    ? { status: "loading", title: "Loading saved analysis", detail: "Reading the immutable result and its pinned Template Revision." }
    : error
      ? { status: "error", title: "Saved analysis unavailable", detail: error }
      : detail && plan
        ? { status: "ready", analysis: detail.analysis, plan }
        : { status: "empty", title: "Saved analysis is incomplete", detail: "The pinned Project Template cannot be rendered." };

  const rerun = async () => {
    if (!projectId || !detail) return;
    setRerunning(true);
    setError(null);
    try {
      const next = await configApi.rerunEnergySavedAnalysis(projectId, detail.id);
      router.push(`/energyiq/saved/${next.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to rerun saved analysis");
    } finally {
      setRerunning(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1320px] px-4 py-6 lg:px-8 lg:py-8">
      <div className="border-b border-border pb-6">
        <Link href="/energyiq/saved" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
          ← Saved analyses
        </Link>
        <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted">Read-only saved result</span>
              {detail ? <span className="text-xs text-muted">Version {detail.sequence}</span> : null}
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight">{detail?.title ?? "Saved analysis"}</h1>
            {detail ? (
              <p className="mt-1.5 text-sm text-muted">
                {formatPeriod(detail)} · saved {formatSavedAt(detail.createdAt)}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => void rerun()}
            disabled={!detail || rerunning}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-white hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-50"
          >
            <EnergyIcon name="analysis" className="h-3.5 w-3.5" />
            {rerunning ? "Rerunning…" : "Rerun with latest data"}
          </button>
        </div>
        {detail ? (
          <dl className="mt-5 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
            <SavedFact label="Template Revision" value={detail.templateRevisionId} />
            <SavedFact label="Data Snapshot" value={detail.dataSnapshotId} />
            <SavedFact label="Scope" value={detail.scopeName} />
            <SavedFact label="Series" value={`${detail.seriesId} · v${detail.sequence}`} />
          </dl>
        ) : null}
      </div>

      {detail ? (
        <div className="mt-7">
          <ScopeMetadataStatus metadata={detail.analysis.metadata} mode="saved" />
        </div>
      ) : null}

      <div className="mt-7">
        <EnergyTemplateRenderer state={rendererState} />
      </div>
    </div>
  );
}

function SavedFact({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 bg-surface px-4 py-3"><dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-light">{label}</dt><dd className="mt-1 truncate font-mono text-[11px] text-foreground" title={value}>{value}</dd></div>;
}

function formatPeriod(detail: EnergySavedAnalysisDetailDto): string {
  const formatter = new Intl.DateTimeFormat("en-SG", { day: "2-digit", month: "short", year: "numeric", timeZone: detail.analysis.context.timezone });
  const from = formatter.format(new Date(detail.analysis.context.from));
  const to = formatter.format(new Date(Date.parse(detail.analysis.context.to) - 1));
  return `${detail.analysis.context.scopeName} · ${from}–${to}`;
}

function formatSavedAt(value: string): string {
  return new Intl.DateTimeFormat("en-SG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
