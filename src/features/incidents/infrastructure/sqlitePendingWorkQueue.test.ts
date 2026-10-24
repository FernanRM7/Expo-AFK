import type { SQLiteBindParams } from 'expo-sqlite';

import type { PendingWorkEntry } from '../domain/pendingWorkQueue';
import { SQLitePendingWorkQueue } from './sqlitePendingWorkQueue';

function positionalStrings(params: SQLiteBindParams): string[] {
  if (!Array.isArray(params)) throw new Error('Expected positional parameters.');
  const values: string[] = [];
  for (const value of params) {
    if (typeof value !== 'string') throw new Error('Expected string parameters.');
    values.push(value);
  }
  return values;
}

test('persists a pending operation across queue instances and updates it only by stable identity', async () => {
  const rows: { operation_id: string; incident_id: string; state: string; entry_json: string }[] = [];
  const database = {
    async execAsync() {},
    async runAsync(source: string, params: SQLiteBindParams) {
      const values = positionalStrings(params);
      if (source.includes('INSERT INTO')) {
        const [operationId, incidentId, state, serialized] = values;
        if (!operationId || !incidentId || !state || !serialized) throw new Error('Missing insert parameters.');
        if (!rows.some((row) => row.operation_id === operationId)) {
          rows.push({ operation_id: operationId, incident_id: incidentId, state, entry_json: serialized });
        }
      } else if (source.includes('UPDATE')) {
        const [state, serialized, operationId] = values;
        if (!state || !serialized || !operationId) throw new Error('Missing update parameters.');
        const row = rows.find((item) => item.operation_id === operationId);
        if (row) {
          row.state = state;
          row.entry_json = serialized;
        }
      } else if (source.includes('DELETE')) {
        const [operationId] = values;
        if (!operationId) throw new Error('Missing delete parameter.');
        const index = rows.findIndex((item) => item.operation_id === operationId);
        if (index >= 0) rows.splice(index, 1);
      }
      return { changes: 1, lastInsertRowId: rows.length };
    },
    async getAllAsync<T>(_source: string, _params: SQLiteBindParams) {
      return rows.map((row) => ({ operation_id: row.operation_id, entry_json: row.entry_json })) as T[];
    },
  };
  const entry: PendingWorkEntry = {
    operation: {
      operationId: 'offline-start-persisted',
      incidentId: 'campus-inc-001',
      baseVersion: 8,
      actorId: 'technician-1',
      action: 'start',
      payload: { startedAt: '2026-10-23T18:00:00.000Z' },
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

  const firstInstance = new SQLitePendingWorkQueue(database);
  await firstInstance.enqueue(entry);
  const secondInstance = new SQLitePendingWorkQueue(database);
  await expect(secondInstance.list()).resolves.toEqual([entry]);
  await secondInstance.update({ ...entry, state: 'needs-review', conflictMessage: 'Revisión requerida.' });
  await expect(firstInstance.list()).resolves.toEqual([
    { ...entry, state: 'needs-review', conflictMessage: 'Revisión requerida.' },
  ]);
  await firstInstance.remove(entry.operation.operationId);
  await expect(secondInstance.list()).resolves.toEqual([]);
});
