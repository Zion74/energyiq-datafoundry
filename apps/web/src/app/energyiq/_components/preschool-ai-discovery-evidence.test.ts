import { describe, expect, it } from "vitest";

import { buildPreschoolDiscoveryEvidenceBundle } from "./preschool-ai-discovery-evidence";
import { preschoolGoldenSnapshot } from "./preschool-overview.test-fixture";

describe("Preschool AI Discovery Evidence", () => {
  it("projects a bounded decision-useful Bundle from one release-pinned Preschool Snapshot", () => {
    const snapshot = preschoolGoldenSnapshot();
    const bundle = buildPreschoolDiscoveryEvidenceBundle(snapshot);

    expect(bundle).not.toBeNull();
    expect(bundle?.identity).toMatchObject({
      projectId: "preschool-demo",
      scopeId: "preschool-project",
      snapshotId: "preschool-26b85b9c0b95e090",
      projectReleaseId: "legacy-profile:preschool-demo:1",
      rendererKey: "preschool-overview",
      period: {
        from: "2026-04-30T16:00:00.000Z",
        to: "2026-05-31T16:00:00.000Z",
      },
    });
    expect(bundle?.items.length).toBeGreaterThanOrEqual(10);
    expect(bundle?.items.length).toBeLessThanOrEqual(20);
    expect([...new Set(bundle?.items.map((item) => item.kind))]).toEqual(expect.arrayContaining([
      "portfolio", "benchmark", "centre", "operating", "spike", "circuit", "quality", "limitation",
    ]));
    expect(bundle?.items.find((item) => item.id === "benchmark:portfolio-p75")?.values)
      .toMatchObject({ euiP75: 10.525439076, perPaxP75: 20.84584375, metadataStatus: "provisional" });
    expect(bundle?.items.filter((item) => item.id.startsWith("benchmark:priority-centre:"))
      .map((item) => item.values.centreCode)).toEqual(["G", "M", "J"]);
    expect(bundle?.items.find((item) => item.id === "operating:portfolio")?.values)
      .toMatchObject({ standbyKwh: 3_103.784, standbySharePct: 12.45, operatingKwh: 21_818.0283 });
    expect(bundle?.items.find((item) => item.id === "spike:standby-summary")?.values)
      .toMatchObject({ spikeCount: 7, centreCount: 3 });
    expect(bundle?.items.find((item) => item.id === "spike:operating-summary")?.values)
      .toMatchObject({ spikeCount: 21, centreCount: 14 });
    expect(bundle?.items.some((item) => item.kind === "circuit" && item.values.leadingCircuit === "Other Lighting3"))
      .toBe(true);

    const serialized = JSON.stringify(bundle);
    expect(serialized.length).toBeLessThanOrEqual(6_000);
    expect(serialized).not.toMatch(/forecast|tariff|cost|28,011|7,639|raw reading|energy_interval_facts/i);
    expect(serialized).not.toMatch(/Level 6|Level 7|Fan ISOL/i);
    expect(serialized).not.toContain("hourlyProfile");
    expect(serialized).not.toContain("childScopes");
    expect(serialized).not.toContain("preschoolBenchmark");
    expect(serialized).not.toContain("preschoolOperational");
  });

  it("stays within the bounded budget with production-sized Release pins and query provenance", () => {
    const snapshot = preschoolGoldenSnapshot();
    const metricRevisionIds = [
      "data.quality_event_count@1",
      "data.valid_interval_count@1",
      "energy.average_daily_usage_kwh@1",
      "energy.off_hours_share_pct@1",
      "energy.off_hours_usage_kwh@1",
      "energy.peak_demand_kw@1",
      "energy.total_usage_kwh@1",
      "energy.usage_per_person@1",
      "energy.usage_per_sqm@1",
    ];
    const metricVersion = `metric-revisions:${metricRevisionIds.join(",")}`;
    const productionQueryIds = [
      "scope_summary_v1",
      "hourly_profile_v1",
      "daily_totals_v1",
      "peak_breakdown_v1",
      "meter_breakdown_v1",
      "previous_meter_usage_v1",
      "operational_policy_scope_intervals_v1",
    ];
    snapshot.projectRelease.metricRevisionIds = metricRevisionIds;
    snapshot.context.metricVersion = metricVersion;
    snapshot.analysis.context.metricVersion = metricVersion;
    snapshot.analysis.provenance.metricVersion = metricVersion;
    snapshot.preschoolBenchmark!.evidence.sourceQueryIds = productionQueryIds;
    if (snapshot.preschoolOperational?.status === "available") {
      snapshot.preschoolOperational.evidence.sourceQueryIds = productionQueryIds;
    }

    const bundle = buildPreschoolDiscoveryEvidenceBundle(snapshot);

    expect(bundle).not.toBeNull();
    expect(JSON.stringify(bundle).length).toBeLessThanOrEqual(6_000);
  });

  it.each([
    ["root Snapshot", (snapshot: ReturnType<typeof preschoolGoldenSnapshot>) => { snapshot.dataSnapshot.id = "drifted-snapshot"; }],
    ["Benchmark Release", (snapshot: ReturnType<typeof preschoolGoldenSnapshot>) => { snapshot.preschoolBenchmark!.evidence.projectReleaseId = "drifted-release"; }],
    ["Benchmark Mapping", (snapshot: ReturnType<typeof preschoolGoldenSnapshot>) => { snapshot.preschoolBenchmark!.evidence.meterMappingRevisionId = "drifted-mapping"; }],
    ["analysis Metric", (snapshot: ReturnType<typeof preschoolGoldenSnapshot>) => { snapshot.analysis.context.metricVersion = "drifted-metric"; }],
    ["analysis Period", (snapshot: ReturnType<typeof preschoolGoldenSnapshot>) => { snapshot.analysis.context.to = "2026-05-30T16:00:00.000Z"; }],
    ["analysis Scope", (snapshot: ReturnType<typeof preschoolGoldenSnapshot>) => { snapshot.analysis.context.scopeId = "another-scope"; }],
    ["provenance Formula", (snapshot: ReturnType<typeof preschoolGoldenSnapshot>) => { snapshot.analysis.provenance.meterFormulaRevisionId = "drifted-formula"; }],
    ["Release Metrics", (snapshot: ReturnType<typeof preschoolGoldenSnapshot>) => { snapshot.projectRelease.metricRevisionIds = ["different-metric"]; }],
    ["Release Tariff", (snapshot: ReturnType<typeof preschoolGoldenSnapshot>) => { snapshot.projectRelease.tariffScheduleVersion = "drifted-tariff"; }],
    ["Release Renderer", (snapshot: ReturnType<typeof preschoolGoldenSnapshot>) => { snapshot.projectRelease.renderer.version = "2"; }],
    ["Operational Calendar", (snapshot: ReturnType<typeof preschoolGoldenSnapshot>) => {
      if (snapshot.preschoolOperational?.status === "available") {
        snapshot.preschoolOperational.evidence.businessCalendarVersion = "drifted-calendar";
      }
    }],
  ])("fails closed when the %s pin drifts", (_name, mutate) => {
    const snapshot = preschoolGoldenSnapshot();
    mutate(snapshot);

    expect(buildPreschoolDiscoveryEvidenceBundle(snapshot)).toBeNull();
  });

  it("does not manufacture AI Evidence when either required published projection is unavailable", () => {
    const withoutBenchmark = preschoolGoldenSnapshot();
    delete withoutBenchmark.preschoolBenchmark;
    expect(buildPreschoolDiscoveryEvidenceBundle(withoutBenchmark)).toBeNull();

    const withoutOperational = preschoolGoldenSnapshot();
    delete withoutOperational.preschoolOperational;
    expect(buildPreschoolDiscoveryEvidenceBundle(withoutOperational)).toBeNull();
  });
});
