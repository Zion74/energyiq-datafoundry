import { Suspense } from "react";

import { EnergyAnalysisWorkbench } from "../_components/energy-analysis-workbench";

export default function EnergyIqAiPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full min-h-[560px] items-center justify-center bg-surface-subtle text-sm text-muted">
          Loading AI Analyst…
        </div>
      }
    >
      <EnergyAnalysisWorkbench />
    </Suspense>
  );
}
