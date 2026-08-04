import { describe, expect, it } from "vitest";

import { ngeeAnnGoldenSnapshot } from "./ngee-ann-overview.test-fixture";
import { buildNgeeAnnOverviewViewModel } from "./ngee-ann-overview-view-model";

describe("Ngee Ann Overview ViewModel", () => {
  it("projects the fixed Custom Golden Snapshot without creating a second formula stack", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const view = buildNgeeAnnOverviewViewModel(snapshot);

    expect(view.context).toMatchObject({
      projectName: "Ngee Ann Polytechnic",
      scopeName: "Ngee Ann Polytechnic",
      scopeType: "project",
      period: "Custom",
      timezone: "Asia/Singapore",
    });
    expect(view.dataStatus).toMatchObject({
      status: "ready",
      label: "Ready",
      coverage: "100% coverage",
      intervals: "2,688 / 2,688 valid intervals",
      qualityEvents: "0 quality events",
    });
    expect(Object.fromEntries(view.highlights.map((item) => [item.id, item.value]))).toEqual({
      total: "1531.1683",
      daily: "218.7383",
      peak: "20.6731",
      comparison: "+26.3677%",
      cost: "489.973864 SGD",
    });
    expect(view.highlights.find((item) => item.id === "comparison")?.detail)
      .toBe("Previous 1211.6773 kWh / +319.4911 kWh");
    expect(view.highlights.find((item) => item.id === "cost")?.detail)
      .toBe("Tariff tariff-v1 / 1 allocation");
    expect(view.evidence).toMatchObject({
      snapshotId: "snapshot-ngee-ann-golden",
      projectReleaseId: "release-ngee-ann-golden",
      importBatchCount: 4,
    });
    expect(view.evidence.queryIds).toEqual(snapshot.analysis.provenance.queryIds);
    expect(view.evidence.references).toEqual([expect.objectContaining({
      id: "evidence:ngee-ann-golden:energy.total_usage_kwh",
      queryReceiptId: "receipt-ngee-ann-golden",
    })]);
  });

  it("keeps accepted partial values visible with an actionable incomplete-data status", () => {
    const view = buildNgeeAnnOverviewViewModel(ngeeAnnGoldenSnapshot({
      dataStatus: "partial",
      coveragePct: 50,
      validIntervalCount: 1_344,
    }));

    expect(view.dataStatus).toMatchObject({
      status: "partial",
      label: "Partial data",
      coverage: "50% coverage",
      intervals: "1,344 / 2,688 valid intervals",
    });
    expect(view.dataStatus.recovery).toContain("Restore the missing source intervals");
    expect(view.highlights.find((item) => item.id === "total")).toMatchObject({
      value: "1531.1683",
      available: true,
    });
  });

  it("fails closed when no trusted interval is available and exposes only an explicit CTA hint", () => {
    const view = buildNgeeAnnOverviewViewModel(
      ngeeAnnGoldenSnapshot({
        dataStatus: "unavailable",
        coveragePct: 0,
        validIntervalCount: 0,
        lastSeenAt: null,
      }),
      {
        latestAvailableRange: { from: "2026-06-10", to: "2026-06-16" },
      },
    );

    expect(view.dataStatus).toMatchObject({
      status: "unavailable",
      label: "Unavailable",
      coverage: "0% coverage",
      intervals: "0 / 2,688 valid intervals",
    });
    expect(view.highlights.every((item) => !item.available)).toBe(true);
    expect(view.highlights.map((item) => item.value)).toEqual([
      "Unavailable",
      "Unavailable",
      "Unavailable",
      "Unavailable",
      "Unavailable",
    ]);
    expect(view.latestAvailableRange).toEqual({ from: "2026-06-10", to: "2026-06-16" });
  });

  it("shows Cost as Unavailable when the Snapshot has no effective Tariff", () => {
    const view = buildNgeeAnnOverviewViewModel(ngeeAnnGoldenSnapshot({ costAvailable: false }));

    expect(view.highlights.find((item) => item.id === "cost")).toEqual(expect.objectContaining({
      value: "Unavailable",
      available: false,
      detail: "No effective Tariff covers the selected period.",
    }));
  });
});
