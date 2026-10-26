import type { SQLiteDatabase } from 'expo-sqlite';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { IncidentSnapshot } from '../features/incidents/domain/incidentRepository';
import type { PendingWorkEntry } from '../features/incidents/domain/pendingWorkQueue';
import { LocalStore } from './localStore';

class NodeSQLiteDatabase {
  constructor(private readonly database: DatabaseSync) {}

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

  async execAsync(source: string): Promise<void> {
    this.database.exec(source);
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

function openStore(path: string): { database: DatabaseSync; store: LocalStore } {
  const database = new DatabaseSync(path);
  return {
    database,
    store: new LocalStore(new NodeSQLiteDatabase(database) as unknown as SQLiteDatabase),
  };
}

const snapshot: IncidentSnapshot = {
  id: 'campus-inc-001',
  version: 3,
  status: 'assigned',
  incident: {
    id: 'campus-inc-001',
    description: 'Falla sintética de conectividad',
    category: 'connectivity',
    status: 'assigned',
    location: { source: 'manual', label: 'Edificio de prueba' },
    reporterId: 'reporter-1',
    assignedTechnicianId: 'technician-1',
  },
};

const operation: PendingWorkEntry = {
  operation: {
    operationId: 'offline-start-sqlite',
    incidentId: snapshot.id,
    baseVersion: snapshot.version!,
    actorId: 'technician-1',
    action: 'start',
    payload: {
      note: 'Revisar tablero al llegar.',
      photoReferences: ['file:///app/cache/panel.jpg'],
    },
  },
  baseSnapshot: snapshot,
  state: 'pending',
};

test('real SQLite migration rolls back atomically after an injected failure and can retry', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'campusops-local-store-migration-'));
  const path = join(directory, 'campusops.db');
  const { database, store } = openStore(path);

  await expect(store.migrate(() => {
    throw new Error('injected migration failure');
  })).rejects.toThrow('injected migration failure');
  expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 0 });
  expect(database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='incidents'",
  ).get()).toBeUndefined();
  expect(database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='pending_operations'",
  ).get()).toBeUndefined();

  await store.migrate();
  expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 });
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

test('real SQLite upgrade preserves a version 1 incident row', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'campusops-local-store-upgrade-'));
  const path = join(directory, 'campusops.db');
  const { database, store } = openStore(path);
  database.exec(`
    CREATE TABLE incidents (
      id TEXT PRIMARY KEY NOT NULL,
      version INTEGER,
      status TEXT NOT NULL,
      snapshot_json TEXT NOT NULL
    );
    PRAGMA user_version = 1;
  `);
  database.prepare(
    'INSERT INTO incidents(id, version, status, snapshot_json) VALUES (?, ?, ?, ?)',
  ).run(snapshot.id, snapshot.version, snapshot.status, JSON.stringify(snapshot));

  await store.migrate();

  expect(await store.getIncident(snapshot.id)).toEqual(snapshot);
  expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 });
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

test('real SQLite close and reopen preserves the incident and pending notes/photo references', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'campusops-local-store-restart-'));
  const path = join(directory, 'campusops.db');
  const first = openStore(path);
  await first.store.migrate();
  await first.store.saveIncident(snapshot);
  await first.store.enqueue(operation);
  first.database.close();

  const reopened = openStore(path);
  await reopened.store.migrate();
  await expect(reopened.store.getIncident(snapshot.id)).resolves.toEqual(snapshot);
  await expect(reopened.store.pendingOperations()).resolves.toEqual([operation]);
  reopened.database.close();
  rmSync(directory, { recursive: true, force: true });
});
