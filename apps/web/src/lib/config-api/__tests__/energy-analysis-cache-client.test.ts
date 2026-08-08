import { afterEach, describe, expect, it, vi } from "vitest";

import { configApi } from "../client";

describe("configApi.resolveProjectAnalysis cache control", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds bypassCache only to the explicit refresh transport body", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: { status: "configuration-required" },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const request = {
      projectId: "preschool-demo",
      scopeId: "project",
      resource: "electricity" as const,
      period: "Custom" as const,
      from: "2026-05-01",
      to: "2026-05-31",
    };

    await configApi.resolveProjectAnalysis(request);
    await configApi.resolveProjectAnalysis(request, { bypassCache: true });

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual(request);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      ...request,
      bypassCache: true,
    });
    expect(request).not.toHaveProperty("bypassCache");
  });
});
