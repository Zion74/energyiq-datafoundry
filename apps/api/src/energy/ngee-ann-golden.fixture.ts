export const NGEE_ANN_GOLDEN = {
  projectId: "ngee-ann-polytechnic",
  workspaceId: "default",
  resource: "electricity",
  timezone: "Asia/Singapore",
  selection: {
    periodDays: 7,
    intervalMinutes: 15,
    policy: "highest current coverage, then previous-period coverage, then fewest quality events, then latest",
    period: {
      localFrom: "2026-06-10",
      localToExclusive: "2026-06-17",
      from: "2026-06-09T16:00:00.000Z",
      to: "2026-06-16T16:00:00.000Z"
    },
    day: {
      localDate: "2026-06-16",
      from: "2026-06-15T16:00:00.000Z",
      to: "2026-06-16T16:00:00.000Z"
    }
  },
  officialMeterNodeIds: [
    "mapping-lvl-7-total-office-light-17",
    "mapping-lvl-7-total-office-load-18",
    "mapping-lvl-6-total-office-light-8",
    "mapping-lvl-6-total-office-load-9"
  ],
  period: {
    usageKwh: 1531.1683,
    previousUsageKwh: 1211.6773,
    changeKwh: 319.4911,
    changePct: 26.3677,
    peakKw: 20.6731,
    peakAt: "2026-06-11T06:00:00.000Z",
    levelUsageKwh: {
      "level-7": 1054.1845,
      "level-6": 476.9838
    },
    levels: {
      "level-7": {
        usageKwh: 1054.1845,
        previousUsageKwh: 734.6257,
        changeKwh: 319.5588,
        changePct: 43.4995,
        peakKw: 12.0637,
        peakAt: "2026-06-11T06:00:00.000Z"
      },
      "level-6": {
        usageKwh: 476.9838,
        previousUsageKwh: 477.0516,
        changeKwh: -0.0678,
        changePct: -0.0142,
        peakKw: 9.2051,
        peakAt: "2026-06-10T02:30:00.000Z"
      }
    },
    categoryUsageKwh: {
      light: 291.7444,
      load: 1239.4239
    },
    topCircuit: {
      scopeId: "l7-load-4",
      meterNodeId: "mapping-lvl-7-office-load-4-l1p22-l3p25-fan-isol1-2-16",
      usageKwh: 439.0972,
      previousUsageKwh: 247.9813,
      changeKwh: 191.1159,
      changePct: 77.0687,
      peakKw: 3.5307
    },
    totalCircuits: [
      { scopeId: "l6-total-light", meterNodeId: "mapping-lvl-6-total-office-light-8", rawUsageKwh: 110.974382, apiUsageKwh: 110.9744 },
      { scopeId: "l6-total-load", meterNodeId: "mapping-lvl-6-total-office-load-9", rawUsageKwh: 366.009445, apiUsageKwh: 366.0094 },
      { scopeId: "l7-total-light", meterNodeId: "mapping-lvl-7-total-office-light-17", rawUsageKwh: 180.770005, apiUsageKwh: 180.77 },
      { scopeId: "l7-total-load", meterNodeId: "mapping-lvl-7-total-office-load-18", rawUsageKwh: 873.414492, apiUsageKwh: 873.4145 }
    ],
    dataHealth: {
      status: "complete",
      coveragePct: 100,
      expectedMeterIntervalCount: 2688,
      validIntervalCount: 2688,
      qualityEventCount: 0,
      lastSeenAt: "2026-06-16T16:00:00.000Z",
      importBatchIds: [
        "<legacy>",
        "energy-import-776b4be8-9ac4-4159-87d6-73837abe896e"
      ]
    },
    hourlyProfile: [
      [0, 34.102316, 4.871759, 5.649868],
      [1, 33.992199, 4.856028, 5.717524],
      [2, 33.932614, 4.847516, 5.626752],
      [3, 33.832089, 4.833156, 5.607356],
      [4, 33.964286, 4.852041, 5.753408],
      [5, 33.891544, 4.841649, 5.62244],
      [6, 58.626076, 8.375154, 11.39578],
      [7, 73.499332, 10.499905, 15.036236],
      [8, 82.5721, 11.796014, 17.543976],
      [9, 92.633765, 13.233395, 19.907484],
      [10, 96.758198, 13.8226, 20.061168],
      [11, 96.989554, 13.855651, 19.1122],
      [12, 96.622015, 13.803145, 19.271664],
      [13, 98.235635, 14.033662, 20.28724],
      [14, 99.781167, 14.254452, 20.673108],
      [15, 98.641762, 14.09168, 19.677044],
      [16, 92.724402, 13.246343, 18.137052],
      [17, 81.79052, 11.68436, 16.41514],
      [18, 63.807229, 9.115318, 13.19846],
      [19, 40.634708, 5.804958, 8.338272],
      [20, 39.402286, 5.628898, 6.605116],
      [21, 39.09562, 5.585089, 6.298508],
      [22, 38.341055, 5.477294, 5.980136],
      [23, 37.297852, 5.328265, 5.671996]
    ]
  },
  day: {
    usageKwh: 221.9982,
    peakKw: 14.4494,
    peakAt: "2026-06-16T07:15:00.000Z",
    expectedMeterIntervalCount: 384,
    validIntervalCount: 384,
    qualityEventCount: 0,
    hourlyProfile: [
      [0, 5.35652, 5.35652, 5.418924],
      [1, 5.173563, 5.173563, 5.210572],
      [2, 5.104549, 5.104549, 5.254688],
      [3, 5.125056, 5.125056, 5.258084],
      [4, 5.185748, 5.185748, 5.281752],
      [5, 5.242188, 5.242188, 5.338536],
      [6, 9.238492, 9.238492, 10.778516],
      [7, 11.201303, 11.201303, 11.800664],
      [8, 12.091472, 12.091472, 12.918548],
      [9, 13.781568, 13.781568, 14.078844],
      [10, 13.979613, 13.979613, 14.038844],
      [11, 13.843545, 13.843545, 14.11948],
      [12, 13.424247, 13.424247, 13.620016],
      [13, 13.540453, 13.540453, 13.98698],
      [14, 14.108092, 14.108092, 14.433044],
      [15, 14.267255, 14.267255, 14.44942],
      [16, 13.5892, 13.5892, 14.117296],
      [17, 11.792498, 11.792498, 12.472988],
      [18, 9.493087, 9.493087, 10.942676],
      [19, 5.396631, 5.396631, 5.7005],
      [20, 5.279697, 5.279697, 5.349632],
      [21, 5.299933, 5.299933, 5.400328],
      [22, 5.304831, 5.304831, 5.363924],
      [23, 5.178619, 5.178619, 5.263648]
    ]
  },
  virtualMeter: {
    meterNodeId: "ngee-ann-load-12-v1",
    name: "Load 12",
    scopeId: "level-6",
    termMeterNodeIds: [
      "mapping-lvl-6-office-load-1-l1p1-l3p6-3",
      "mapping-lvl-6-office-load-2-l1p7-l3p12-4"
    ],
    usageKwh: 49.0218,
    includedInOfficialTotal: false
  },
  invariants: {
    allMeterUsageKwh: 3050.1648,
    cumulativeDeltaMismatchCount: 0,
    averageKwMismatchCount: 0,
    invalidIntervalDurationCount: 0,
    offHoursStatus: "unavailable",
    tariffStatus: "unavailable",
    usageUnit: "kWh",
    demandUnit: "kW"
  }
} as const;
