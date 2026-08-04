import { describe, expect, it } from "vitest";

import type { EnergyOperationalPolicyConfigurationDto } from "../../../lib/config-api";
import {
  calendarDraftFromConfiguration,
  calendarPublishEntries,
  hasPendingPolicyRelease,
  tariffDraftFromConfiguration,
  tariffPublishEntries,
} from "./operational-policy-model";

describe("operational policy Admin model", () => {
  it("loads the pending revisions instead of the newest unrelated revision", () => {
    const configuration = fixture();

    expect(tariffDraftFromConfiguration(configuration)).toMatchObject([{
      owner: { kind: "project" },
      currency: "SGD",
      ratePerKwh: "0.28",
    }]);
    expect(calendarDraftFromConfiguration(configuration)[0]).toMatchObject({
      owner: { kind: "scope", scopeId: "level-6" },
      weekly: { monday: [{ from: "08:00", to: "18:00" }] },
      exceptions: [{ date: "2026-08-10", label: "Closure", operating: [] }],
    });
    expect(hasPendingPolicyRelease(configuration)).toBe(true);
  });

  it("projects validated immutable publish inputs without persisted revision IDs", () => {
    const configuration = fixture();
    expect(tariffPublishEntries(tariffDraftFromConfiguration(configuration))).toEqual([{
      owner: { kind: "project" },
      effectiveFrom: "2026-07-01T00:00:00+08:00",
      currency: "SGD",
      ratePerKwh: 0.28,
    }]);
    expect(calendarPublishEntries(calendarDraftFromConfiguration(configuration))).toMatchObject([{
      owner: { kind: "scope", scopeId: "level-6" },
      effectiveFrom: "2026-07-01",
      weekly: { monday: [{ from: "08:00", to: "18:00" }] },
    }]);
  });
});

const fixture = (): EnergyOperationalPolicyConfigurationDto => ({
  projectId: "ngee-ann-polytechnic",
  timezone: "Asia/Singapore",
  published: {
    tariff_schedule_version: "tariff-v1",
    business_calendar_version: "calendar-v1",
  },
  pending: {
    tariff_schedule_version: "tariff-v2",
    business_calendar_version: "calendar-v2",
  },
  tariffRevisions: [
    {
      version_id: "tariff-v3-unrelated",
      project_id: "ngee-ann-polytechnic",
      published_by: "admin",
      published_at: "2026-08-04T02:00:00.000Z",
      entries: [{
        id: "tariff-v3-rate",
        owner: { kind: "project" },
        effective_from: "2026-09-01T00:00:00+08:00",
        currency: "SGD",
        rate_per_kwh: 0.3,
      }],
    },
    {
      version_id: "tariff-v2",
      project_id: "ngee-ann-polytechnic",
      published_by: "admin",
      published_at: "2026-08-04T01:00:00.000Z",
      entries: [{
        id: "tariff-v2-rate",
        owner: { kind: "project" },
        effective_from: "2026-07-01T00:00:00+08:00",
        currency: "SGD",
        rate_per_kwh: 0.28,
      }],
    },
  ],
  operatingCalendarRevisions: [{
    version_id: "calendar-v2",
    project_id: "ngee-ann-polytechnic",
    timezone: "Asia/Singapore",
    published_by: "admin",
    published_at: "2026-08-04T01:00:00.000Z",
    entries: [{
      id: "calendar-v2-hours",
      owner: { kind: "scope", scope_id: "level-6" },
      effective_from: "2026-07-01",
      weekly: {
        monday: [{ from: "08:00", to: "18:00" }],
        tuesday: [{ from: "08:00", to: "18:00" }],
        wednesday: [{ from: "08:00", to: "18:00" }],
        thursday: [{ from: "08:00", to: "18:00" }],
        friday: [{ from: "08:00", to: "18:00" }],
        saturday: [],
        sunday: [],
      },
      exceptions: [{ date: "2026-08-10", label: "Closure", operating: [] }],
    }],
  }],
  hasUnpublishedChanges: true,
});
