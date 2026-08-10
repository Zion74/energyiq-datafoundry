import type { OverviewNavigationSection } from "./overview-section-navigation";

/**
 * The Ngee Ann report contract follows the approved Net-Zero template reading order.
 * Renderer anchors and the dashboard contents rail must consume this same list.
 */
export const NGEE_ANN_OVERVIEW_SECTIONS: ReadonlyArray<OverviewNavigationSection> = [
  { id: "ngee-ann-daily-trend", label: "Daily trend" },
  { id: "ngee-ann-executive-summary", label: "Executive summary" },
  { id: "ngee-ann-summary-findings", label: "Summary of findings" },
  { id: "ngee-ann-day-profile-analysis", label: "Day profile" },
  { id: "ngee-ann-energy-health", label: "Energy health" },
  { id: "ngee-ann-circuit-analysis", label: "Circuit analysis" },
  { id: "ngee-ann-recommendations", label: "Recommendations" },
  { id: "ngee-ann-evidence", label: "Evidence" },
] as const;
