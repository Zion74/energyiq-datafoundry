import type { Metadata } from "next";
import type { ReactNode } from "react";

import { DataTaskIdentityProvider } from "../data-tasks/data-task-identity";
import { EnergyIqShell } from "./_components/energyiq-shell";
import { EnergyIqAccessProvider } from "./_components/energyiq-access";

export const metadata: Metadata = {
  title: "EnergyIQ",
  description: "Decision-first energy and water analysis",
};

export default function EnergyIqLayout({ children }: { children: ReactNode }) {
  return (
    <DataTaskIdentityProvider>
      <EnergyIqAccessProvider>
        <EnergyIqShell>{children}</EnergyIqShell>
      </EnergyIqAccessProvider>
    </DataTaskIdentityProvider>
  );
}
