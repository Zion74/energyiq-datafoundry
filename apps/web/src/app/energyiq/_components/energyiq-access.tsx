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
  selectOrganisation: (workspaceId: string) => Promise<void>;
  selectProject: (projectId: string) => void;
};

const EnergyIqAccessContext = createContext<EnergyIqAccessValue | null>(null);
const ORGANISATION_STORAGE_KEY = "energyiq:active-organisation:v1";
const projectStorageKey = (workspaceId: string) => `energyiq:active-project:${workspaceId}:v1`;

export function EnergyIqAccessProvider({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<EnergyAccessContextDto | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (requestedWorkspaceId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const restoredWorkspaceId = requestedWorkspaceId || (typeof window === "undefined"
        ? null
        : window.localStorage.getItem(ORGANISATION_STORAGE_KEY));
      if (restoredWorkspaceId) setConfigApiWorkspaceId(restoredWorkspaceId);
      const next = await configApi.getEnergyAccessContext();
      if (next.activeWorkspaceId) {
        setConfigApiWorkspaceId(next.activeWorkspaceId);
        try {
          window.localStorage.setItem(ORGANISATION_STORAGE_KEY, next.activeWorkspaceId);
        } catch {
          // The server-selected Organisation remains authoritative.
        }
      }
      setAccess(next);
      const published = next.projects.filter((project) => project.status === "published");
      const stored = typeof window === "undefined"
        ? null
        : window.localStorage.getItem(projectStorageKey(next.activeWorkspaceId));
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
      if (access?.activeWorkspaceId) {
        window.localStorage.setItem(projectStorageKey(access.activeWorkspaceId), projectId);
      }
    } catch {
      // Selection remains in memory when localStorage is unavailable.
    }
  }, [access?.activeWorkspaceId]);

  const selectOrganisation = useCallback(async (workspaceId: string) => {
    if (!workspaceId || workspaceId === access?.activeWorkspaceId) return;
    setConfigApiWorkspaceId(workspaceId);
    try {
      window.localStorage.setItem(ORGANISATION_STORAGE_KEY, workspaceId);
    } catch {
      // Selection remains in memory when localStorage is unavailable.
    }
    await load(workspaceId);
  }, [access?.activeWorkspaceId, load]);

  const value = useMemo<EnergyIqAccessValue>(
    () => ({
      access,
      activeProject,
      error,
      loading,
      refresh: load,
      selectOrganisation,
      selectProject,
    }),
    [access, activeProject, error, load, loading, selectOrganisation, selectProject],
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
