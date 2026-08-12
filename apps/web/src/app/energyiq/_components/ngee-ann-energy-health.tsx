import React from "react";

import type {
  NgeeAnnDayProfileViewModel,
  NgeeAnnLevelComparisonViewModel,
} from "./ngee-ann-overview-view-model";

export function NgeeAnnEnergyHealth({
  dayProfile,
  levelComparison,
}: {
  dayProfile: NgeeAnnDayProfileViewModel;
  levelComparison: NgeeAnnLevelComparisonViewModel;
}) {
  const projectScopeId = dayProfile.scopes[0]?.id;
  const profile = (dayType: "weekday" | "weekend" | "public_holiday") => dayProfile.profiles.find((candidate) => (
    candidate.scopeId === projectScopeId && candidate.dayType === dayType
  )) ?? null;
  const weekday = profile("weekday");
  const weekend = profile("weekend");
  const holiday = profile("public_holiday");

  return (
    <section aria-labelledby="ngee-ann-energy-health-summary" className="border-b border-border px-5 py-6 lg:px-7 lg:py-7">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 id="ngee-ann-energy-health-summary" className="text-lg font-semibold tracking-[-0.015em] text-foreground">Energy Health Summary</h3>
          <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted">Day-type averages and observed weekday time bands from the same release-pinned hourly profile.</p>
        </div>
        <p className="text-xs text-muted">Asia/Singapore local hours · mean of complete days</p>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <ProfileHealthCard label="Weekday daily average" profile={weekday} value="daily" />
        <ProfileHealthCard label="Weekend daily average" profile={weekend} value="daily" />
        <ProfileHealthCard label="Public Holiday daily average" profile={holiday} value="daily" />
        <ProfileHealthCard label="Weekday office hours (08:00–18:00)" profile={weekday} value="office" />
        <ProfileHealthCard label="Weekday after-hours (22:00–06:00)" profile={weekday} value="after" />
        {levelComparison.status === "available" ? levelComparison.rows.map((row) => (
          <article key={row.id} className="rounded-xl border border-border bg-surface px-4 py-4">
            <p className="text-xs font-semibold text-muted">{row.name} total (official aggregate)</p>
            <p className="mt-2 text-xl font-semibold tracking-[-0.02em] tabular-nums text-foreground">{row.currentUsageKwh} <span className="text-sm font-medium text-muted">kWh</span></p>
            <p className="mt-2 text-xs text-muted">{row.projectShare} of official Project energy</p>
          </article>
        )) : (
          <article className="rounded-xl border border-border bg-surface-subtle px-4 py-4 sm:col-span-2">
            <p className="text-xs font-semibold text-foreground">Level totals unavailable</p>
            <p className="mt-1 text-xs leading-5 text-muted">{levelComparison.reason}</p>
          </article>
        )}
      </div>

      <p className="mt-4 border-t border-border pt-4 text-xs leading-5 text-muted">These indicators describe observed timing and concentration. They do not, by themselves, establish waste, a root cause or a saving.</p>
    </section>
  );
}

function ProfileHealthCard({
  label,
  profile,
  value,
}: {
  label: string;
  profile: NgeeAnnDayProfileViewModel["profiles"][number] | null;
  value: "daily" | "office" | "after";
}) {
  if (!profile || profile.summary.status === "unavailable") {
    return (
      <article className="rounded-xl border border-border bg-surface-subtle px-4 py-4">
        <p className="text-xs font-semibold text-muted">{label}</p>
        <p className="mt-2 text-sm font-semibold text-foreground">Unavailable</p>
        <p className="mt-1 text-xs leading-5 text-muted">{profile?.reason ?? "No authoritative complete-day profile is available."}</p>
      </article>
    );
  }
  const displayed = value === "daily"
    ? profile.summary.dailyUsage
    : value === "office"
      ? profile.summary.officeHoursUsage
      : profile.summary.afterHoursUsage;
  const suffix = value === "daily" ? "kWh/day" : "kWh/mean day";
  return (
    <article className="rounded-xl border border-border bg-surface px-4 py-4">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p aria-label={`${displayed} ${suffix}`} className="mt-2 text-xl font-semibold tracking-[-0.02em] tabular-nums text-foreground">{displayed} <span className="text-sm font-medium text-muted">{suffix}</span></p>
      <p className="mt-2 text-xs text-muted">
        {value === "after" ? `${profile.summary.afterHoursShare} of the observed mean day · ` : ""}{profile.summary.sampleDayCount} complete-day {profile.summary.sampleDayCount === 1 ? "sample" : "samples"}
      </p>
    </article>
  );
}
