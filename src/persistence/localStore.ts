import type { SQLiteDatabase } from "expo-sqlite";
import type { IncidentSnapshot } from "../features/incidents/domain/incidentRepository";
import type { PendingWorkEntry, PendingWorkQueue } from "../features/incidents/domain/pendingWorkQueue";

export const CURRENT_SCHEMA_VERSION = 2;

export type PendingOperation = PendingWorkEntry;

/** SQLite adapter for offline incident snapshots and their durable outbox. */
export class LocalStore implements PendingWorkQueue {
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
          CREATE TABLE IF NOT EXISTS pending_operations (
            operation_id TEXT PRIMARY KEY NOT NULL,
            incident_id TEXT NOT NULL,
            base_version INTEGER NOT NULL,
            actor_id TEXT NOT NULL,
            operation_json TEXT NOT NULL
          );
          CREATE INDEX pending_operations_incident ON pending_operations(incident_id);
        `);
        const legacyQueue = await this.db.getFirstAsync<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='pending_work_operations'",
        );
        if (legacyQueue) {
          const legacyRows = await this.db.getAllAsync<{
            operation_id: string;
            incident_id: string;
            entry_json: string;
          }>(
            'SELECT operation_id, incident_id, entry_json FROM pending_work_operations ORDER BY rowid',
          );
          for (const legacyRow of legacyRows) {
            const entry = parsePendingOperation(legacyRow.entry_json);
            if (
              entry.operation.operationId !== legacyRow.operation_id ||
              entry.operation.incidentId !== legacyRow.incident_id
            ) {
              throw new Error('A legacy pending operation does not match its stored identity.');
            }
            await this.db.runAsync(
              `INSERT INTO pending_operations(operation_id, incident_id, base_version, actor_id, operation_json)
               VALUES (?, ?, ?, ?, ?) ON CONFLICT(operation_id) DO NOTHING`,
              legacyRow.operation_id,
              legacyRow.incident_id,
              entry.operation.baseVersion,
              entry.operation.actorId,
              legacyRow.entry_json,
            );
          }
          await this.db.execAsync('DROP TABLE pending_work_operations;');
        }
        await this.db.execAsync('PRAGMA user_version = 2;');
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

  async enqueue(entry: PendingOperation): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO pending_operations(operation_id, incident_id, base_version, actor_id, operation_json)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT(operation_id) DO NOTHING`,
      entry.operation.operationId,
      entry.operation.incidentId,
      entry.operation.baseVersion,
      entry.operation.actorId,
      JSON.stringify(entry),
    );
  }

  async pendingOperations(): Promise<readonly PendingOperation[]> {
    const rows = await this.db.getAllAsync<{ operation_json: string }>(
      "SELECT operation_json FROM pending_operations ORDER BY rowid",
    );
    return rows.map(({ operation_json }) => parsePendingOperation(operation_json));
  }

  async list(): Promise<readonly PendingOperation[]> {
    return this.pendingOperations();
  }

  async update(entry: PendingOperation): Promise<void> {
    const result = await this.db.runAsync(
      "UPDATE pending_operations SET operation_json = ? WHERE operation_id = ?",
      JSON.stringify(entry),
      entry.operation.operationId,
    );
    if (result.changes !== 1) throw new Error("Pending work operation was not found.");
  }

  async remove(operationId: string): Promise<void> {
    await this.db.runAsync(
      "DELETE FROM pending_operations WHERE operation_id = ?",
      operationId,
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

function parsePendingOperation(serialized: string): PendingOperation {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error("A pending work operation is invalid JSON.");
  }
  if (
    typeof value !== "object" || value === null ||
    !("operation" in value) || typeof value.operation !== "object" || value.operation === null ||
    !("operationId" in value.operation) || typeof value.operation.operationId !== "string" ||
    !("incidentId" in value.operation) || typeof value.operation.incidentId !== "string" ||
    !("actorId" in value.operation) || typeof value.operation.actorId !== "string" ||
    !("baseVersion" in value.operation) || typeof value.operation.baseVersion !== "number" ||
    !("action" in value.operation) || typeof value.operation.action !== "string" ||
    !("payload" in value.operation) || typeof value.operation.payload !== "object" ||
    value.operation.payload === null || Array.isArray(value.operation.payload) ||
    !("baseSnapshot" in value) || typeof value.baseSnapshot !== "object" || value.baseSnapshot === null ||
    !("state" in value) || (value.state !== "pending" && value.state !== "needs-review")
  ) {
    throw new Error("A pending work operation does not match the stored contract.");
  }
  return value as PendingOperation;
}

export async function openLocalStore(
  name = "campusops.db",
): Promise<LocalStore> {
  const { openDatabaseAsync } = await import("expo-sqlite");
  const store = new LocalStore(await openDatabaseAsync(name));
  await store.migrate();
  return store;
}
