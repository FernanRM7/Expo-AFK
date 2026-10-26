import type { SQLiteDatabase } from 'expo-sqlite';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PendingWorkEntry } from '../domain/pendingWorkQueue';
import { SQLitePendingWorkQueue } from './sqlitePendingWorkQueue';

class NodeSQLiteDatabase {
  constructor(private readonly database: DatabaseSync) {}

  async execAsync(source: string): Promise<void> {
    this.database.exec(source);
  }

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    this.database.exec('BEGIN');
    try {
      await task();
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  async runAsync(source: string, ...params: unknown[]): Promise<Readonly<{ changes: number; lastInsertRowId: number }>> {
    const result = this.database.prepare(source).run(...params as never[]);
    return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
  }

  async getFirstAsync<T>(source: string, ...params: unknown[]): Promise<T | null> {
    return (this.database.prepare(source).get(...params as never[]) as T | undefined) ?? null;
  }

  async getAllAsync<T>(source: string, ...params: unknown[]): Promise<T[]> {
    return this.database.prepare(source).all(...params as never[]) as T[];
  }
}

function openQueue(database: DatabaseSync, beforeVersionChange?: (from: number, to: number) => void): SQLitePendingWorkQueue {
  return new SQLitePendingWorkQueue(
    new NodeSQLiteDatabase(database) as unknown as SQLiteDatabase,
    beforeVersionChange,
  );
}

const entry: PendingWorkEntry = {
  operation: {
    operationId: 'offline-start-persisted',
    incidentId: 'campus-inc-001',
    baseVersion: 8,
    actorId: 'technician-1',
    action: 'start',
    payload: {
      startedAt: '2026-10-23T18:00:00.000Z',
      note: 'Revisar tablero al llegar.',
      photoReferences: ['file:///app/cache/panel.jpg'],
    },
  },
  baseSnapshot: {
    id: 'campus-inc-001',
    version: 8,
    status: 'assigned',
    incident: {
      id: 'campus-inc-001',
      description: 'Prueba',
      category: 'connectivity',
      status: 'assigned',
      location: { source: 'manual', label: 'Edificio de prueba' },
      reporterId: 'reporter-1',
      assignedTechnicianId: 'technician-1',
    },
  },
  state: 'pending',
};

test('rolls back a failed outbox migration without losing legacy queued work, then recovers', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'campusops-queue-migration-'));
  const path = join(directory, 'campusops.db');
  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE pending_work_operations (
      operation_id TEXT PRIMARY KEY NOT NULL,
      incident_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('pending', 'needs-review')),
      entry_json TEXT NOT NULL
    );
  `);
  database.prepare(
    'INSERT INTO pending_work_operations(operation_id, incident_id, state, entry_json) VALUES (?, ?, ?, ?)',
  ).run(entry.operation.operationId, entry.operation.incidentId, entry.state, JSON.stringify(entry));
  const failingQueue = openQueue(database, () => {
    throw new Error('injected queue migration failure');
  });

  await expect(failingQueue.list()).rejects.toThrow('injected queue migration failure');
  expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 0 });
  expect(database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='pending_operations'",
  ).get()).toBeUndefined();
  expect(database.prepare('SELECT COUNT(*) AS count FROM pending_work_operations').get()).toEqual({ count: 1 });

  await expect(openQueue(database).list()).resolves.toEqual([entry]);
  expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 });
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

test('migrates queued entries from the pre-versioned offline table without losing them', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'campusops-queue-legacy-'));
  const path = join(directory, 'campusops-offline.db');
  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE pending_work_operations (
      operation_id TEXT PRIMARY KEY NOT NULL,
      incident_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('pending', 'needs-review')),
      entry_json TEXT NOT NULL
    );
  `);
  database.prepare(
    'INSERT INTO pending_work_operations(operation_id, incident_id, state, entry_json) VALUES (?, ?, ?, ?)',
  ).run(entry.operation.operationId, entry.operation.incidentId, entry.state, JSON.stringify(entry));

  await expect(openQueue(database).list()).resolves.toEqual([entry]);
  expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 });
  expect(database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='pending_work_operations'",
  ).get()).toBeUndefined();
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

test('persists the first operation identity and recovers its note and photo references after restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'campusops-queue-restart-'));
  const path = join(directory, 'campusops.db');
  const firstDatabase = new DatabaseSync(path);
  const firstQueue = openQueue(firstDatabase);
  await firstQueue.enqueue(entry);
  await firstQueue.enqueue({
    ...entry,
    operation: { ...entry.operation, payload: { note: 'must not replace original' } },
  });
  await firstQueue.update({ ...entry, state: 'needs-review', conflictMessage: 'Revisión requerida.' });
  firstDatabase.close();

  const reopenedDatabase = new DatabaseSync(path);
  const reopenedQueue = openQueue(reopenedDatabase);
  await expect(reopenedQueue.list()).resolves.toEqual([
    { ...entry, state: 'needs-review', conflictMessage: 'Revisión requerida.' },
  ]);
  await reopenedQueue.remove(entry.operation.operationId);
  await expect(reopenedQueue.list()).resolves.toEqual([]);
  reopenedDatabase.close();
  rmSync(directory, { recursive: true, force: true });
});
