import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { overviewViewStateFromSearchParams } from "./published-decision-dashboard";

const rendererSource = readFileSync(new URL("./energy-template-renderer.tsx", import.meta.url), "utf8");
const shellSource = readFileSync(new URL("./energyiq-shell.tsx", import.meta.url), "utf8");
const explorerSource = readFileSync(new URL("./project-explorer.tsx", import.meta.url), "utf8");
const overviewSource = readFileSync(new URL("./published-decision-dashboard.tsx", import.meta.url), "utf8");
const savedHistorySource = readFileSync(new URL("./saved-analysis-history.tsx", import.meta.url), "utf8");
const savedDetailSource = readFileSync(new URL("./saved-analysis-detail.tsx", import.meta.url), "utf8");
const adminSource = readFileSync(new URL("../admin/project-setup-workbench.tsx", import.meta.url), "utf8");
const adminSidebarSource = readFileSync(new URL("../admin/admin-sidebar.tsx", import.meta.url), "utf8");

describe("EnergyIQ UI regressions", () => {
  it("labels the operating-pattern curves and lists peak before average", () => {
    const start = rendererSource.indexOf("function OperatingPattern");
    const end = rendererSource.indexOf("function MeterBreakdown", start);
    const source = rendererSource.slice(start, end);

    expect(source).toContain("<Legend");
    expect(source).toContain('name="Observed peak"');
    expect(source).toContain('name="Hourly average"');
    expect(source.indexOf('name="Observed peak"')).toBeLessThan(source.indexOf('name="Hourly average"'));
  });

  it("makes the two global selectors self-explanatory", () => {
    expect(shellSource).toContain("Customer workspace");
    expect(shellSource).toContain("Energy project");
  });

  it("offers bulk hierarchy expansion in Explorer and Admin Structure", () => {
    for (const source of [explorerSource, adminSource]) {
      expect(source).toContain('aria-label="Expand all hierarchy nodes"');
      expect(source).toContain('aria-label="Collapse all hierarchy nodes"');
    }
  });

  it("loads the administrator project picker across customer workspaces", () => {
    expect(adminSource).toContain("listEnergyAdminOrganisations");
    expect(adminSource).toContain("selectProjectContext");
  });

  it("lets administrators collapse and restore the desktop navigation", () => {
    expect(adminSidebarSource).toContain('aria-label="Collapse admin navigation"');
    expect(adminSource).toContain('aria-label="Show admin navigation"');
  });

  it("keeps module selection and layout controls beside Draft Preview", () => {
    expect(adminSource).toContain('aria-label={`Select ${component.display_name} module`}');
    expect(adminSource).toContain("Selected module settings");
    expect(adminSource).toContain("xl:grid-cols-[minmax(340px,400px)_minmax(0,1fr)]");
  });

  it("restores the public Overview URL without shipping a demo range or fake previous month", () => {
    expect(overviewSource).not.toContain("demoRangeForProject");
    expect(overviewSource).not.toContain('value: "Last 30 days"');
    expect(overviewSource).toContain('{ label: "Previous month", disabled: true');
    expect(overviewViewStateFromSearchParams(new URLSearchParams(
      "projectId=ngee-ann-polytechnic&scopeId=level-6&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16",
    ))).toEqual({
      projectId: "ngee-ann-polytechnic",
      scopeId: "level-6",
      resource: "electricity",
      period: "Custom",
      from: "2026-06-10",
      to: "2026-06-16",
    });
  });

  it("keeps Project Explorer as a narrow data-verification surface", () => {
    expect(explorerSource).not.toContain("ngeeAnnNodes");
    expect(explorerSource).not.toContain("Horizontal and vertical comparisons");
    expect(explorerSource).not.toContain("What needs attention");
    expect(explorerSource).not.toContain("Investigate with AI");
    expect(explorerSource).not.toContain("analysisPeriodForProject");
    expect(explorerSource).toContain("Period consumption");
    expect(explorerSource).toContain("Average power");
    expect(explorerSource).toContain("Source & Data Health");
    expect(explorerSource).toContain("Latest cumulative reading");
  });

  it("keeps saved analyses immutable and reruns them through the trusted API", () => {
    expect(overviewSource).toContain("saveEnergyAnalysis");
    expect(savedHistorySource).toContain("Immutable results saved manually from Overview");
    expect(savedHistorySource).toContain("Each rerun is a new version");
    expect(savedDetailSource).toContain("Read-only saved result");
    expect(savedDetailSource).toContain("rerunEnergySavedAnalysis");
    expect(savedDetailSource).not.toContain("contentEditable");
  });

  it("shows release-pinned metadata in Overview and only frozen metadata in Saved Analysis", () => {
    expect(overviewSource).toContain("<ScopeMetadataStatus metadata={currentSnapshot.metadata} mode=\"interactive\" />");
    expect(savedDetailSource).toContain("<ScopeMetadataStatus metadata={detail.analysis.metadata} mode=\"saved\" />");
    expect(savedDetailSource).not.toContain("resolveProjectAnalysis");
  });
});
