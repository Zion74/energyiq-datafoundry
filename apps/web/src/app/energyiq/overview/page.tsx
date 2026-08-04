import { Suspense } from "react";

import { PublishedDecisionDashboard } from "../_components/published-decision-dashboard";

export default function EnergyIqOverviewPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted">Loading published analysis…</div>}>
      <PublishedDecisionDashboard />
    </Suspense>
  );
}
