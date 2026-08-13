import { afterEach, describe, expect, it, vi } from "vitest";

import { configApi } from "../client";

describe("Overview AI Artifact client controls", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_DATAFOUNDRY_AUTH_MODE;
    vi.unstubAllGlobals();
  });

  it("starts server-owned materialization through a CSRF-protected ensure POST", async () => {
    process.env.NEXT_PUBLIC_DATAFOUNDRY_AUTH_MODE = "password";
    vi.stubGlobal("document", { cookie: "df_csrf=csrf-token" });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: {
        status: "queued",
        dataSnapshotId: "snapshot-1",
        projectReleaseId: "release-1",
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await configApi.ensureEnergyOverviewAiArtifact("preschool-demo", "preschool-portfolio");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/overview-ai-artifact/ensure?scopeId=preschool-portfolio"),
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        headers: expect.objectContaining({ "X-CSRF-Token": "csrf-token" }),
      }),
    );
  });

  it("pins the Artifact request to the Snapshot and period visible on the Overview", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: {
        status: "missing",
        dataSnapshotId: "snapshot-may",
        projectReleaseId: "release-may",
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await configApi.getEnergyOverviewAiArtifact("preschool-demo", "preschool-project", {
      from: "2026-05-01",
      to: "2026-05-31",
      dataSnapshotId: "snapshot-may",
      projectReleaseId: "release-may",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("scopeId=preschool-project&from=2026-05-01&to=2026-05-31&dataSnapshotId=snapshot-may&projectReleaseId=release-may"),
      expect.any(Object),
    );
  });

  it("sends only the selected failed Section as the retry target", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: {
        status: "available",
        dataSnapshotId: "snapshot-may",
        projectReleaseId: "release-may",
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await configApi.retryEnergyOverviewAiArtifact(
      "preschool-demo",
      "preschool-project",
      {
        from: "2026-05-01",
        to: "2026-05-31",
        dataSnapshotId: "snapshot-may",
        projectReleaseId: "release-may",
      },
      "standby-wastage",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/overview-ai-artifact/retry?"),
      expect.objectContaining({ method: "POST", body: JSON.stringify({ targetId: "standby-wastage" }) }),
    );
  });
});
