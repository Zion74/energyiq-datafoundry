import type { EnergyProjectAnalysisSnapshotDto } from "../../../lib/config-api";
import { ngeeAnnGoldenSnapshot } from "./ngee-ann-overview.test-fixture";

export function preschoolGoldenSnapshot(): EnergyProjectAnalysisSnapshotDto {
  const base = structuredClone(ngeeAnnGoldenSnapshot());
  const centreCodes = [
    "A", "B", "C", "D", "E", "F", "G", "H", "I", "J",
    "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T",
    "U", "V", "W", "X", "Y", "Z", "AA", "AB", "AC", "AD",
  ];
  const centres = Array.from({ length: 30 }, (_, index) => {
    const name = `Centre ${String.fromCharCode(65 + Math.min(index, 25))}${index > 25 ? String(index - 25) : ""}`;
    const usageKwh = index === 0 ? 843.0985 : index === 29 ? 830.2998 : 830.3005;
    const area = 743 + index * 3;
    const headcount = 58 + (index % 9);
    const metadata = {
      scopeId: `preschool-centre-${index + 1}`,
      scopeName: name,
      usageKwh,
      status: "provisional",
      area: { status: "provisional", value: area, unit: "m2", metadataRevisionIds: ["metadata-1"], hierarchyRevisionIds: ["preschool-hierarchy-v4"], evidence: [] },
      headcount: { status: "provisional", value: headcount, unit: "people", metadataRevisionIds: ["metadata-1"], hierarchyRevisionIds: ["preschool-hierarchy-v4"], evidence: [] },
      normalisations: {
        eui: { status: "provisional", metricId: "energy.usage_per_sqm", value: usageKwh / area, unit: "kWh/m2", metadataRevisionIds: ["metadata-1"], hierarchyRevisionIds: ["preschool-hierarchy-v4"], evidence: [] },
        perPax: { status: "provisional", metricId: "energy.usage_per_person", value: usageKwh / headcount, unit: "kWh/person", metadataRevisionIds: ["metadata-1"], hierarchyRevisionIds: ["preschool-hierarchy-v4"], evidence: [] },
      },
      evidence: [],
    };
    return {
      nodeId: metadata.scopeId,
      name,
      nodeType: "centre",
      usageKwh,
      sharePct: (usageKwh / 24_921.8123) * 100,
      areaSqm: area,
      occupantCount: headcount,
      kwhPerSqm: usageKwh / area,
      kwhPerPerson: usageKwh / headcount,
      topCircuitName: "Aircon 1",
      topCircuitUsageKwh: usageKwh * 0.2,
      metadata,
    };
  });
  const selectedScope = {
    scopeId: "preschool-project",
    scopeName: "Preschool Portfolio",
    usageKwh: 24_921.8123,
    status: "missing",
    area: { status: "missing", value: null, unit: "m2", reason: "not-configured", guidance: "Use Centre metadata.", metadataRevisionIds: [], hierarchyRevisionIds: ["preschool-hierarchy-v4"], evidence: [] },
    headcount: { status: "missing", value: null, unit: "people", reason: "not-configured", guidance: "Use Centre metadata.", metadataRevisionIds: [], hierarchyRevisionIds: ["preschool-hierarchy-v4"], evidence: [] },
    normalisations: {
      eui: { status: "missing", metricId: "energy.usage_per_sqm", value: null, unit: "kWh/m2", reason: "not-configured", guidance: "Use Centre EUI.", metadataRevisionIds: [], hierarchyRevisionIds: ["preschool-hierarchy-v4"], evidence: [] },
      perPax: { status: "missing", metricId: "energy.usage_per_person", value: null, unit: "kWh/person", reason: "not-configured", guidance: "Use Centre per-pax values.", metadataRevisionIds: [], hierarchyRevisionIds: ["preschool-hierarchy-v4"], evidence: [] },
    },
    evidence: [],
  };
  const facilityTypeByCode = new Map<string, string>([
    ...["A", "D", "I", "J", "K", "N", "Q", "R", "T", "U", "V", "Z", "AC", "AD"].map((code) => [code, "Senior Care Center"] as const),
    ...["B", "E", "F", "G", "M", "O", "W", "AB"].map((code) => [code, "Active Aging Center"] as const),
    ...["C", "H", "L", "P", "S", "X", "Y", "AA"].map((code) => [code, "Preschool"] as const),
  ]);
  const priorityCodes = new Set(["G", "M", "J"]);
  const benchmarkCentres = centres.map((centre, index) => {
    const centreCode = centreCodes[index]!;
    const priority = priorityCodes.has(centreCode);
    return {
      scopeId: centre.nodeId,
      centreCode,
      name: centre.name,
      cohort: facilityTypeByCode.get(centreCode)!,
      usageKwh: centre.usageKwh,
      annualisedEuiKwhPerSqmYear: priority ? 12 + index / 10 : 5 + index / 5,
      mayKwhPerPerson: priority ? 22 + index / 10 : 13 + index / 4,
      quadrant: priority ? "priority" as const : "lower-intensity" as const,
      priority,
    };
  });
  const centreByCode = new Map(benchmarkCentres.map((centre) => [centre.centreCode, centre]));
  const spikeCentre = (code: string, spikeCount: number, operating: boolean) => {
    const centre = centreByCode.get(code)!;
    return {
      scopeId: centre.scopeId,
      centreCode: code,
      name: centre.name,
      centreType: centre.cohort,
      spikeCount,
      worstSpike: {
        localDate: operating ? "2026-05-18" : code === "L" ? "2026-05-25" : "2026-05-08",
        localHour: operating ? 14 : code === "L" ? 1 : 22,
        dayType: operating ? "weekday" as const : code === "L" ? "weekend" as const : "weekday" as const,
        usageKwh: operating ? 19.503 : code === "L" ? 5.038 : 4.171,
        baselineKwh: operating ? 3.7 : code === "L" ? 0.403 : 0.328,
        impactKwh: operating ? 15.803 : code === "L" ? 4.635 : 3.843,
        variancePct: operating ? 427.1 : code === "L" ? 1_149.4 : 1_173,
        leadingCircuitName: `${centre.scopeId}:${operating ? "Aircon 1" : "Other Lighting3"}`,
        leadingCircuitKwh: operating ? 18.2 : code === "L" ? 4.851 : 3.958,
        leadingCircuitSharePct: operating ? 93 : code === "L" ? 96 : 95,
      },
    };
  };
  const standbySpikeCounts = new Map([["L", 4], ["E", 2], ["N", 1]]);
  const operatingSpikeCounts = new Map(centreCodes.slice(0, 14).map((code, index) => [code, index === 0 ? 8 : 1]));

  return {
    ...base,
    context: {
      ...base.context,
      workspaceId: "preschool-demo-org",
      projectId: "preschool-demo",
      projectName: "Preschool Portfolio",
      scopeId: "preschool-project",
      scopeName: "Preschool Portfolio",
      from: "2026-04-30T16:00:00.000Z",
      to: "2026-05-31T16:00:00.000Z",
      hierarchyRevisionId: "preschool-hierarchy-v4",
      meterMappingRevisionId: "preschool-mapping-v4",
      meterFormulaRevisionId: "preschool-formula-v1",
      dataSnapshotId: "preschool-26b85b9c0b95e090",
      metricVersion: "metric-revisions:energy.total_usage_kwh@1,energy.usage_per_person,energy.usage_per_sqm",
      businessCalendarVersion: "sg-preschool-calendar-v1",
      tariffScheduleVersion: "missing",
      projectReleaseId: "legacy-profile:preschool-demo:1",
      primaryPeriod: {
        start: "2026-04-30T16:00:00.000Z",
        endExclusive: "2026-05-31T16:00:00.000Z",
      },
    },
    projectRelease: {
      ...base.projectRelease,
      id: "legacy-profile:preschool-demo:1",
      projectId: "preschool-demo",
      hierarchyRevisionId: "preschool-hierarchy-v4",
      meterMappingRevisionId: "preschool-mapping-v4",
      meterFormulaRevisionId: "preschool-formula-v1",
      metricRevisionIds: [
        "energy.total_usage_kwh@1",
        "energy.usage_per_person",
        "energy.usage_per_sqm",
      ],
      businessCalendarVersion: "sg-preschool-calendar-v1",
      tariffScheduleVersion: "missing",
      renderer: {
        key: "preschool-overview",
        version: "1",
        contractVersion: "project-analysis-snapshot@1",
      },
    },
    renderer: {
      key: "preschool-overview",
      version: "1",
      contractVersion: "project-analysis-snapshot@1",
    },
    dataQuality: {
      ...base.dataQuality,
      status: "complete",
      coveragePct: 100,
      expectedMeterIntervalCount: 200_880,
      validIntervalCount: 200_880,
      qualityEventCount: 0,
    },
    dataSnapshot: {
      id: "preschool-26b85b9c0b95e090",
      importBatchIds: ["preschool-may-2026"],
      lastSeenAt: "2026-05-31T15:00:00.000Z",
    },
    preschoolBenchmark: {
      status: "provisional",
      contract: {
        id: "preschool-may-2026-benchmark",
        version: "1",
        annualisationFactor: 12,
      },
      period: {
        start: "2026-04-30T16:00:00.000Z",
        endExclusive: "2026-05-31T16:00:00.000Z",
        timezone: "Asia/Singapore",
      },
      sampleSize: 30,
      portfolio: {
        eui: { p50: 7.034247079, p75: 10.525439076, unit: "kWh/m2/year" },
        perPax: { p50: 18.395011111, p75: 20.84584375, unit: "kWh/person/month" },
      },
      cohorts: [
        { name: "Active Aging Center", sampleSize: 8, eui: { p50: 6.7234, p75: 15.1315, unit: "kWh/m2/year" }, perPax: { p50: 17.1931, p75: 22.4632, unit: "kWh/person/month" } },
        { name: "Preschool", sampleSize: 8, eui: { p50: 9.0018, p75: 10.9544, unit: "kWh/m2/year" }, perPax: { p50: 18.0713, p75: 20.0863, unit: "kWh/person/month" } },
        { name: "Senior Care Center", sampleSize: 14, eui: { p50: 6.7567, p75: 9.2022, unit: "kWh/m2/year" }, perPax: { p50: 18.5196, p75: 20.695, unit: "kWh/person/month" } },
      ],
      centres: benchmarkCentres,
      priorityCentreCodes: ["G", "M", "J"],
      evidence: {
        projectReleaseId: "legacy-profile:preschool-demo:1",
        dataSnapshotId: "preschool-26b85b9c0b95e090",
        hierarchyRevisionId: "preschool-hierarchy-v4",
        meterMappingRevisionId: "preschool-mapping-v4",
        metricRevisionIds: ["energy.usage_per_sqm", "energy.usage_per_person"],
        metadataRevisionIds: ["preschool-metadata-v4"],
        sourceQueryIds: ["scope_summary_v1", "child_scope_breakdown_v1"],
        projectionRecipeIds: ["preschool-eui-benchmark-v1", "preschool-per-pax-benchmark-v1", "preschool-quadrant-v1"],
        cohortSource: "published-hierarchy-node-metadata",
        metadataStatus: "provisional",
        normalisation: {
          eui: "May usage kWh * 12 / published comparison area m2",
          perPax: "May usage kWh / published representative headcount",
        },
      },
    },
    preschoolOperational: {
      status: "available",
      contract: {
        id: "preschool-may-2026-operational-behaviour",
        version: "1",
        spikeThresholdPct: 50,
      },
      period: {
        start: "2026-04-30T16:00:00.000Z",
        endExclusive: "2026-05-31T16:00:00.000Z",
        timezone: "Asia/Singapore",
      },
      energy: {
        totalKwh: 24_921.8123,
        standbyKwh: 3_103.784,
        standbySharePct: 12.45,
        operatingKwh: 21_818.0283,
      },
      spikes: {
        standby: {
          count: 7,
          centreCount: 3,
          centres: [...standbySpikeCounts].map(([code, count]) => spikeCentre(code, count, false)),
        },
        operating: {
          count: 21,
          centreCount: 14,
          centres: [...operatingSpikeCounts].map(([code, count]) => spikeCentre(code, count, true)),
        },
      },
      sop: {
        status: "provisional",
        label: "Provisional after-hours SOP signal",
        baselineScore: 100,
        deductionPerStandbySpike: 1,
        breachingCentreCodes: ["L", "E", "N"],
        centres: benchmarkCentres
          .map((centre) => ({
            scopeId: centre.scopeId,
            centreCode: centre.centreCode,
            name: centre.name,
            centreType: centre.cohort,
            standbySpikeCount: standbySpikeCounts.get(centre.centreCode) ?? 0,
            score: 100 - (standbySpikeCounts.get(centre.centreCode) ?? 0),
          }))
          .sort((left, right) => left.score - right.score || left.centreCode.localeCompare(right.centreCode)),
      },
      evidence: {
        projectReleaseId: "legacy-profile:preschool-demo:1",
        dataSnapshotId: "preschool-26b85b9c0b95e090",
        hierarchyRevisionId: "preschool-hierarchy-v4",
        meterMappingRevisionId: "preschool-mapping-v4",
        metricRevisionIds: ["energy.total_usage_kwh@1"],
        businessCalendarVersion: "sg-preschool-calendar-v1",
        sourceQueryIds: ["scope_summary_v1"],
        projectionQueryId: "preschool_centre_hour_cells_v1",
        projectionRecipeIds: ["preschool-hour-slot-spike-v1", "preschool-after-hours-sop-signal-v1"],
        baseline: "same-centre same-hour-slot mean within operating state",
      },
    },
    metadata: {
      status: "provisional",
      hierarchyRevisionId: "preschool-hierarchy-v4",
      timezone: "Asia/Singapore",
      period: { start: "2026-04-30T16:00:00.000Z", endExclusive: "2026-05-31T16:00:00.000Z" },
      selectedScope,
      comparisonScopes: centres.map((centre) => centre.metadata),
      evidence: [],
    },
    analysis: {
      ...base.analysis,
      context: {
        ...base.analysis.context,
        projectId: "preschool-demo",
        projectName: "Preschool Portfolio",
        scopeId: "preschool-project",
        scopeName: "Preschool Portfolio",
        from: "2026-04-30T16:00:00.000Z",
        to: "2026-05-31T16:00:00.000Z",
        hierarchyRevisionId: "preschool-hierarchy-v4",
        meterMappingRevisionId: "preschool-mapping-v4",
        meterFormulaRevisionId: "preschool-formula-v1",
        dataSnapshotId: "preschool-26b85b9c0b95e090",
        metricVersion: "metric-revisions:energy.total_usage_kwh@1,energy.usage_per_person,energy.usage_per_sqm",
        businessCalendarVersion: "sg-preschool-calendar-v1",
        tariffScheduleVersion: "missing",
      },
      summary: {
        ...base.analysis.summary,
        usageKwh: 24_921.8123,
        averageDailyUsageKwh: 803.9294,
        nonOperatingKwh: 3_103.784,
        nonOperatingSharePct: 12.45,
      },
      childScopes: centres,
      offHours: {
        status: "available",
        operatingKwh: 21_818.0283,
        standbyKwh: 3_103.784,
        usageKwh: 24_921.8123,
        sharePct: 12.45,
        timezone: "Asia/Singapore",
        businessCalendarVersion: "sg-preschool-calendar-v1",
      },
      cost: {
        status: "unavailable",
        reason: {
          code: "TARIFF_VERSION_MISSING",
          message: "No published Preschool tariff is available for this Snapshot.",
        },
      },
      dataHealth: {
        ...base.analysis.dataHealth,
        status: "complete",
        coveragePct: 100,
        expectedMeterIntervalCount: 200_880,
        validIntervalCount: 200_880,
        qualityEventCount: 0,
      },
      metadata: {
        status: "provisional",
        hierarchyRevisionId: "preschool-hierarchy-v4",
        timezone: "Asia/Singapore",
        period: { start: "2026-04-30T16:00:00.000Z", endExclusive: "2026-05-31T16:00:00.000Z" },
        selectedScope,
        comparisonScopes: centres.map((centre) => centre.metadata),
        evidence: [],
      },
      provenance: {
        ...base.analysis.provenance,
        dataSnapshotId: "preschool-26b85b9c0b95e090",
        hierarchyRevisionId: "preschool-hierarchy-v4",
        meterMappingRevisionId: "preschool-mapping-v4",
        meterFormulaRevisionId: "preschool-formula-v1",
        metricVersion: "metric-revisions:energy.total_usage_kwh@1,energy.usage_per_person,energy.usage_per_sqm",
      },
    },
  } as unknown as EnergyProjectAnalysisSnapshotDto;
}
