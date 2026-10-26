import { LocalStore, CURRENT_SCHEMA_VERSION } from "./localStore";
import type { SQLiteDatabase } from "expo-sqlite";

function database(version = 0) {
  let currentVersion = version;
  const tables = new Set<string>();
  const db = {
    withTransactionAsync: async (work: () => Promise<void>) => {
      const previousVersion = currentVersion;
      const previousTables = new Set(tables);
      try {
        await work();
      } catch (error) {
        currentVersion = previousVersion;
        tables.clear();
        previousTables.forEach((table) => tables.add(table));
        throw error;
      }
    },
    getFirstAsync: async (sql: string) =>
      sql.includes("user_version") ? { user_version: currentVersion } : null,
    execAsync: async (sql: string) => {
      for (const match of sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? (\w+)/g))
        tables.add(match[1]!);
      const next = sql.match(/PRAGMA user_version = (\d+)/);
      if (next) currentVersion = Number(next[1]);
    },
    runAsync: async () => ({ changes: 1, lastInsertRowId: 1 }),
    getAllAsync: async () => [],
  };
  return {
    db: db as unknown as SQLiteDatabase,
    tables,
    version: () => currentVersion,
  };
}

test("migrates fresh database atomically to current schema", async () => {
  const fake = database();
  await new LocalStore(fake.db).migrate();
  expect(fake.version()).toBe(CURRENT_SCHEMA_VERSION);
  expect(fake.tables).toEqual(new Set(["incidents", "pending_operations"]));
});

test("rolls back every schema change after an injected migration failure and retries", async () => {
  const fake = database();
  const store = new LocalStore(fake.db);
  await expect(
    store.migrate(() => {
      throw new Error("injected failure");
    }),
  ).rejects.toThrow("injected failure");
  expect(fake.version()).toBe(0);
  expect(fake.tables.size).toBe(0);
  await store.migrate();
  expect(fake.version()).toBe(CURRENT_SCHEMA_VERSION);
  expect(fake.tables.size).toBe(2);
});

test("upgrades schema v1 by preserving the existing incident table", async () => {
  const fake = database(1);
  fake.tables.add("incidents");
  await new LocalStore(fake.db).migrate();
  expect(fake.version()).toBe(2);
  expect(fake.tables).toEqual(new Set(["incidents", "pending_operations"]));
});
