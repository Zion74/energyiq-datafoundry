import { Suspense } from "react";

import { ProjectExplorer } from "../_components/project-explorer";

export default function EnergyIqExplorerPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted">Loading Project Explorer…</div>}>
      <ProjectExplorer />
    </Suspense>
  );
}
