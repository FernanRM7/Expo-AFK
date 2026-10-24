import { openDatabaseAsync } from 'expo-sqlite';
import type { SQLiteBindParams } from 'expo-sqlite';

import type { PendingWorkEntry, PendingWorkQueue } from '../domain/pendingWorkQueue';

const DATABASE_NAME = 'campusops-offline.db';
const TABLE_NAME = 'pending_work_operations';

type QueueDatabase = Readonly<{
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params: SQLiteBindParams): Promise<Readonly<{ changes: number }>>;
  getAllAsync<T>(source: string, params: SQLiteBindParams): Promise<T[]>;
}>;

type StoredEntry = Readonly<{
  operation_id: string;
  entry_json: string;
}>;

export class SQLitePendingWorkQueue implements PendingWorkQueue {
  private readonly ready: Promise<void>;

  constructor(
    private readonly database: QueueDatabase,
  ) {
    this.ready = this.database.execAsync(`
      CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
        operation_id TEXT PRIMARY KEY NOT NULL,
        incident_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending', 'needs-review')),
        entry_json TEXT NOT NULL
      );
    `);
  }

  async enqueue(entry: PendingWorkEntry): Promise<void> {
    await this.ready;
    await this.database.runAsync(
      `INSERT INTO ${TABLE_NAME} (operation_id, incident_id, state, entry_json)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(operation_id) DO NOTHING`,
      [
        entry.operation.operationId,
        entry.operation.incidentId,
        entry.state,
        JSON.stringify(entry),
      ],
    );
  }

  async list(): Promise<readonly PendingWorkEntry[]> {
    await this.ready;
    const rows = await this.database.getAllAsync<StoredEntry>(
      `SELECT operation_id, entry_json FROM ${TABLE_NAME} ORDER BY rowid`,
      [],
    );
    return rows.map((row) => parseEntry(row.entry_json, row.operation_id));
  }

  async update(entry: PendingWorkEntry): Promise<void> {
    await this.ready;
    const result = await this.database.runAsync(
      `UPDATE ${TABLE_NAME} SET state = ?, entry_json = ? WHERE operation_id = ?`,
      [entry.state, JSON.stringify(entry), entry.operation.operationId],
    );
    if (result.changes !== 1) throw new Error('Pending work operation was not found.');
  }

  async remove(operationId: string): Promise<void> {
    await this.ready;
    await this.database.runAsync(
      `DELETE FROM ${TABLE_NAME} WHERE operation_id = ?`,
      [operationId],
    );
  }
}

let defaultQueue: Promise<PendingWorkQueue> | undefined;

export function getSQLitePendingWorkQueue(): Promise<PendingWorkQueue> {
  defaultQueue ??= openDatabaseAsync(DATABASE_NAME).then(
    (database) => new SQLitePendingWorkQueue(database),
  );
  return defaultQueue;
}

function parseEntry(serialized: string, operationId: string): PendingWorkEntry {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error(`Pending work operation ${operationId} is invalid JSON.`);
  }
  if (
    typeof value !== 'object' || value === null ||
    !('operation' in value) || typeof value.operation !== 'object' || value.operation === null ||
    !('operationId' in value.operation) || value.operation.operationId !== operationId ||
    !('incidentId' in value.operation) || typeof value.operation.incidentId !== 'string' ||
    !('actorId' in value.operation) || typeof value.operation.actorId !== 'string' ||
    !('baseVersion' in value.operation) || typeof value.operation.baseVersion !== 'number' ||
    !('action' in value.operation) || value.operation.action !== 'start' ||
    !('payload' in value.operation) || typeof value.operation.payload !== 'object' ||
    value.operation.payload === null || Array.isArray(value.operation.payload) ||
    !('baseSnapshot' in value) || typeof value.baseSnapshot !== 'object' || value.baseSnapshot === null ||
    !('state' in value) || (value.state !== 'pending' && value.state !== 'needs-review')
  ) {
    throw new Error(`Pending work operation ${operationId} does not match the stored contract.`);
  }
  return value as PendingWorkEntry;
}
