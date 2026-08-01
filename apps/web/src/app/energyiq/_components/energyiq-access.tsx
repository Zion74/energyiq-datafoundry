"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  configApi,
  setConfigApiWorkspaceId,
  type EnergyAccessContextDto,
  type EnergyProjectDto,
} from "../../../lib/config-api";

type EnergyIqAccessValue = {
  access: EnergyAccessContextDto | null;
  activeProject: EnergyProjectDto | null;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  selectProject: (projectId: string) => void;
};

const EnergyIqAccessContext = createContext<EnergyIqAccessValue | null>(null);
const PROJECT_STORAGE_KEY = "energyiq:active-project:v1";

export function EnergyIqAccessProvider({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<EnergyAccessContextDto | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await configApi.getEnergyAccessContext();
      setConfigApiWorkspaceId(next.activeWorkspaceId);
      setAccess(next);
      const published = next.projects.filter((project) => project.status === "published");
      const stored = typeof window === "undefined"
        ? null
        : window.localStorage.getItem(PROJECT_STORAGE_KEY);
      const selected = published.find((project) => project.id === stored) ?? published[0] ?? null;
      setActiveProjectId(selected?.id ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed to load EnergyIQ access");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const publishedProjects = useMemo(
    () => access?.projects.filter((project) => project.status === "published") ?? [],
    [access],
  );
  const activeProject = publishedProjects.find((project) => project.id === activeProjectId)
    ?? publishedProjects[0]
    ?? null;

  const selectProject = useCallback((projectId: string) => {
    setActiveProjectId(projectId);
    try {
      window.localStorage.setItem(PROJECT_STORAGE_KEY, projectId);
    } catch {
      // Selection remains in memory when localStorage is unavailable.
    }
  }, []);

  const value = useMemo<EnergyIqAccessValue>(
    () => ({
      access,
      activeProject,
      error,
      loading,
      refresh: load,
      selectProject,
    }),
    [access, activeProject, error, load, loading, selectProject],
  );

  return (
    <EnergyIqAccessContext.Provider value={value}>
      {children}
    </EnergyIqAccessContext.Provider>
  );
}

export function useEnergyIqAccess(): EnergyIqAccessValue {
  const value = useContext(EnergyIqAccessContext);
  if (!value) {
    throw new Error("useEnergyIqAccess must be used inside EnergyIqAccessProvider");
  }
  return value;
}
