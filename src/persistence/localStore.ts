import type { SQLiteDatabase } from "expo-sqlite";
import type { PendingIncidentOperation } from "../campusops/contracts";
import type { IncidentSnapshot } from "../features/incidents/domain/incidentRepository";

export const CURRENT_SCHEMA_VERSION = 2;

export type PendingOperation = PendingIncidentOperation &
  Readonly<{
    note?: string;
    photoReferences?: readonly string[];
  }>;

/** SQLite adapter for offline incident snapshots and their durable outbox. */
export class LocalStore {
  constructor(private readonly db: SQLiteDatabase) {}

  async migrate(
    beforeVersionChange?: (from: number, to: number) => void,
  ): Promise<void> {
    await this.db.withTransactionAsync(async () => {
      const row = await this.db.getFirstAsync<{ user_version: number }>(
        "PRAGMA user_version",
      );
      const version = row?.user_version ?? 0;
      if (version > CURRENT_SCHEMA_VERSION)
        throw new Error(`Unsupported schema version ${version}`);
      if (version < 1) {
        await this.db.execAsync(`
          CREATE TABLE incidents (
            id TEXT PRIMARY KEY NOT NULL,
            version INTEGER,
            status TEXT NOT NULL,
            snapshot_json TEXT NOT NULL
          );
          PRAGMA user_version = 1;
        `);
      }
      if (version < 2) {
        await this.db.execAsync(`
          CREATE TABLE pending_operations (
            operation_id TEXT PRIMARY KEY NOT NULL,
            incident_id TEXT NOT NULL,
            base_version INTEGER NOT NULL,
            actor_id TEXT NOT NULL,
            operation_json TEXT NOT NULL
          );
          CREATE INDEX pending_operations_incident ON pending_operations(incident_id);
          PRAGMA user_version = 2;
        `);
      }
      beforeVersionChange?.(version, CURRENT_SCHEMA_VERSION);
    });
  }

  async saveIncident(snapshot: IncidentSnapshot): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO incidents(id, version, status, snapshot_json) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET version=excluded.version, status=excluded.status, snapshot_json=excluded.snapshot_json`,
      snapshot.id,
      snapshot.version,
      snapshot.status,
      JSON.stringify(snapshot),
    );
  }

  async getIncident(id: string): Promise<IncidentSnapshot | null> {
    const row = await this.db.getFirstAsync<{ snapshot_json: string }>(
      "SELECT snapshot_json FROM incidents WHERE id = ?",
      id,
    );
    return row ? (JSON.parse(row.snapshot_json) as IncidentSnapshot) : null;
  }

  async listIncidents(): Promise<readonly IncidentSnapshot[]> {
    const rows = await this.db.getAllAsync<{ snapshot_json: string }>(
      "SELECT snapshot_json FROM incidents ORDER BY id",
    );
    return rows.map(
      ({ snapshot_json }) => JSON.parse(snapshot_json) as IncidentSnapshot,
    );
  }

  async enqueue(operation: PendingOperation): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO pending_operations(operation_id, incident_id, base_version, actor_id, operation_json)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT(operation_id) DO NOTHING`,
      operation.operationId,
      operation.incidentId,
      operation.baseVersion,
      operation.actorId,
      JSON.stringify(operation),
    );
  }

  async pendingOperations(): Promise<readonly PendingOperation[]> {
    const rows = await this.db.getAllAsync<{ operation_json: string }>(
      "SELECT operation_json FROM pending_operations ORDER BY rowid",
    );
    return rows.map(
      ({ operation_json }) => JSON.parse(operation_json) as PendingOperation,
    );
  }

  async acknowledge(operationIds: readonly string[]): Promise<void> {
    await this.db.withTransactionAsync(async () => {
      for (const id of operationIds) {
        await this.db.runAsync(
          "DELETE FROM pending_operations WHERE operation_id = ?",
          id,
        );
      }
    });
  }
}

export async function openLocalStore(
  name = "campusops.db",
): Promise<LocalStore> {
  const { openDatabaseAsync } = await import("expo-sqlite");
  const store = new LocalStore(await openDatabaseAsync(name));
  await store.migrate();
  return store;
}
