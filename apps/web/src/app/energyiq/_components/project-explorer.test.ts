import { describe, expect, it } from "vitest";

import { explorerViewStateFromSearchParams, formatDateInput } from "./project-explorer";

describe("Project Explorer trusted date inputs", () => {
  it("uses the Project timezone for inclusive Custom dates", () => {
    expect(formatDateInput("2026-06-09T16:00:00.000Z", "Asia/Singapore")).toBe("2026-06-10");
    expect(formatDateInput("2026-06-16T15:59:59.999Z", "Asia/Singapore")).toBe("2026-06-16");
  });

  it("restores the fixed Overview handoff Project, Scope, resource and Custom Period", () => {
    const view = explorerViewStateFromSearchParams(new URLSearchParams(
      "projectId=ngee-ann-polytechnic&scopeId=l7-load-4&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16&grain=day&comparison=selected&category=load",
    ));

    expect(view).toEqual({
      projectId: "ngee-ann-polytechnic",
      scopeId: "l7-load-4",
      resource: "electricity",
      period: "Custom",
      from: "2026-06-10",
      to: "2026-06-16",
    });
  });

  it("preserves supported previous Periods and rejects an invalid Custom range", () => {
    expect(explorerViewStateFromSearchParams(new URLSearchParams("period=Previous+month"))).toMatchObject({
      period: "Previous month",
      from: "",
      to: "",
    });
    expect(explorerViewStateFromSearchParams(new URLSearchParams(
      "period=Custom&from=2026-06-17&to=2026-06-16&resource=unknown",
    ))).toMatchObject({
      resource: "electricity",
      period: "Custom",
      from: "",
      to: "",
    });
  });
});
