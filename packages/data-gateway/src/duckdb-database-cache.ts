import type * as DuckDbModule from "duckdb";

const databases = new Map<string, Promise<DuckDbModule.Database>>();

/**
 * duckdb@1.4.x on Node 24 cannot reliably reopen the same file after
 * Database.close() in one process. Keep one Database handle per path and use
 * short-lived connections for individual operations.
 */
export const getDuckDbDatabase = async (path: string): Promise<DuckDbModule.Database> => {
  const existing = databases.get(path);
  if (existing) {
    return await existing;
  }
  const duckdb = await loadDuckDb();
  const opening = new Promise<DuckDbModule.Database>((resolve, reject) => {
    const database = new duckdb.Database(path, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve(database);
      }
    });
  });
  databases.set(path, opening);
  try {
    return await opening;
  } catch (error) {
    databases.delete(path);
    throw error;
  }
};

const loadDuckDb = async (): Promise<typeof DuckDbModule> => {
  const loaded = await import("duckdb") as unknown as { default?: typeof DuckDbModule } & typeof DuckDbModule;
  return loaded.default ?? loaded;
};
