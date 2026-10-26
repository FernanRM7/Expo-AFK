import type { FetchResult } from '../../../course-evaluation/contracts';
import type { IncidentSnapshot } from '../domain/incidentRepository';
import type { PendingWorkEntry, PendingWorkQueue } from '../domain/pendingWorkQueue';
import { createOfflineWorkSyncService } from './offlineWorkSyncService';
import type { OfflineWorkGateway } from './offlineWorkSyncService';

const baseSnapshot: IncidentSnapshot = {
  id: 'campus-inc-001',
  version: 1,
  status: 'assigned',
  incident: {
    id: 'campus-inc-001',
    title: 'Incidencia de prueba',
    description: 'Caso de sincronización',
    category: 'connectivity',
    status: 'assigned',
    location: { source: 'manual', label: 'Edificio ficticio' },
    reporterId: 'reporter-1',
    assignedTechnicianId: 'technician-1',
  },
};

function reassignedSnapshot(version = 2): IncidentSnapshot {
  return {
    ...baseSnapshot,
    version,
    incident: { ...baseSnapshot.incident!, assignedTechnicianId: 'technician-2' },
  };
}

function memoryQueue(): PendingWorkQueue & { entries: PendingWorkEntry[] } {
  const entries: PendingWorkEntry[] = [];
  return {
    entries,
    async enqueue(entry) {
      if (!entries.some((existing) => existing.operation.operationId === entry.operation.operationId)) {
        entries.push(entry);
      }
    },
    async list() {
      return [...entries];
    },
    async update(entry) {
      const index = entries.findIndex((existing) => existing.operation.operationId === entry.operation.operationId);
      if (index < 0) throw new Error('Missing operation.');
      entries[index] = entry;
    },
    async remove(operationId) {
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        if (entries[index]?.operation.operationId === operationId) entries.splice(index, 1);
      }
    },
  };
}

test('persists offline start identity and keeps reassignment authoritative after sync conflict', async () => {
  const queue = memoryQueue();
  let remote = reassignedSnapshot();
  const gateway: OfflineWorkGateway = {
    async getById() {
      return { ok: true, value: remote };
    },
    async actOnIncident() {
      throw new Error('The stale offline operation must not be sent.');
    },
  };
  const service = createOfflineWorkSyncService({
    actorId: 'technician-1',
    queue,
    gateway,
    now: () => new Date('2026-10-23T18:00:00.000Z'),
    createOperationId: () => 'offline-start-001',
  });

  const queued = await service.queueStart(baseSnapshot);
  expect(queued.ok).toBe(true);
  const beforeSync = await service.listPending();
  expect(beforeSync[0]?.operation).toEqual({
    operationId: 'offline-start-001',
    incidentId: 'campus-inc-001',
    baseVersion: 1,
    actorId: 'technician-1',
    action: 'start',
    payload: { startedAt: '2026-10-23T18:00:00.000Z' },
  });

  const result = await service.synchronize();

  expect(result).toEqual([{
    operationId: 'offline-start-001',
    status: 'needs-review',
    message: 'Conflicto de sincronización; se conserva la asignación remota y el inicio local pendiente.',
  }]);
  expect(remote.incident?.assignedTechnicianId).toBe('technician-2');
  expect(queue.entries).toHaveLength(1);
  expect(queue.entries[0]?.state).toBe('needs-review');
  expect(queue.entries[0]?.operation.actorId).toBe('technician-1');
  expect(queue.entries[0]?.operation.baseVersion).toBe(1);
  expect(queue.entries[0]?.conflictRemote).toEqual(remote);
});

test('retains local intent if reassigned technician cannot read the new remote assignment', async () => {
  const queue = memoryQueue();
  const gateway: OfflineWorkGateway = {
    async getById(): Promise<FetchResult<IncidentSnapshot | null>> {
      return { ok: false, reason: { kind: 'forbidden' } };
    },
    async actOnIncident() {
      throw new Error('Forbidden operations must not be sent.');
    },
  };
  const service = createOfflineWorkSyncService({
    actorId: 'technician-1',
    queue,
    gateway,
    createOperationId: () => 'offline-start-002',
  });

  await service.queueStart(baseSnapshot);
  const result = await service.synchronize();

  expect(result[0]?.status).toBe('needs-review');
  expect(queue.entries).toHaveLength(1);
  expect(queue.entries[0]?.operation.operationId).toBe('offline-start-002');
  expect(queue.entries[0]?.operation.baseVersion).toBe(1);
});

test('retries the same operation with the latest base version and removes it only on server confirmation', async () => {
  const queue = memoryQueue();
  let remote = reassignedSnapshot();
  const action = jest.fn(async (snapshot: IncidentSnapshot, _action: 'start', _details: Readonly<Record<string, unknown>>, _key: string) => ({
    ok: true as const,
    value: { ...snapshot, status: 'in_progress' as const },
  }));
  const gateway: OfflineWorkGateway = {
    async getById() {
      return { ok: true, value: remote };
    },
    actOnIncident: action,
  };
  const service = createOfflineWorkSyncService({
    actorId: 'technician-1',
    queue,
    gateway,
    createOperationId: () => 'offline-start-003',
  });

  await service.queueStart(baseSnapshot);
  await service.synchronize();
  expect(queue.entries[0]?.state).toBe('needs-review');

  remote = {
    ...baseSnapshot,
    version: 3,
    status: 'assigned',
    incident: { ...baseSnapshot.incident!, assignedTechnicianId: 'technician-1' },
  };
  const result = await service.retry('offline-start-003');

  expect(result.status).toBe('synced');
  expect(action).toHaveBeenCalledWith(remote, 'start', expect.any(Object), 'offline-start-003');
  expect(queue.entries).toHaveLength(0);
});

test('does not clear a pending operation when the server does not confirm it', async () => {
  const queue = memoryQueue();
  const remote = { ...baseSnapshot, version: 2 };
  const gateway: OfflineWorkGateway = {
    async getById() {
      return { ok: true, value: remote };
    },
    async actOnIncident() {
      return { ok: false, reason: { kind: 'server-error', status: 503 } };
    },
  };
  const service = createOfflineWorkSyncService({
    actorId: 'technician-1',
    queue,
    gateway,
    createOperationId: () => 'offline-start-004',
  });

  await service.queueStart(baseSnapshot);
  const result = await service.synchronize();

  expect(result[0]?.status).toBe('pending');
  expect(queue.entries).toHaveLength(1);
  expect(queue.entries[0]?.state).toBe('pending');
});

test('deduplicates repeated persisted identities before submitting them to the server', async () => {
  const queue = memoryQueue();
  let effectCount = 0;
  const gateway: OfflineWorkGateway = {
    async getById() {
      return { ok: true, value: baseSnapshot };
    },
    async actOnIncident(snapshot) {
      effectCount += 1;
      return { ok: true, value: { ...snapshot, status: 'in_progress' } };
    },
  };
  const service = createOfflineWorkSyncService({
    actorId: 'technician-1',
    queue,
    gateway,
    createOperationId: () => 'offline-start-deduplicated',
  });

  await service.queueStart(baseSnapshot);
  queue.entries.push({ ...queue.entries[0]! });
  await expect(service.listPending()).resolves.toHaveLength(1);
  const result = await service.synchronize();

  expect(result).toHaveLength(1);
  expect(effectCount).toBe(1);
  expect(queue.entries).toHaveLength(0);
});

test('replays an operation after a lost response with the same identity and one server effect', async () => {
  const queue = memoryQueue();
  const effectsByOperation = new Map<string, IncidentSnapshot>();
  const submittedIds: string[] = [];
  let dropFirstResponse = true;
  const gateway: OfflineWorkGateway = {
    async getById() {
      return { ok: true, value: baseSnapshot };
    },
    async actOnIncident(snapshot, _action, _details, operationId) {
      submittedIds.push(operationId);
      let confirmed = effectsByOperation.get(operationId);
      if (!confirmed) {
        confirmed = { ...snapshot, status: 'in_progress' };
        effectsByOperation.set(operationId, confirmed);
      }
      if (dropFirstResponse) {
        dropFirstResponse = false;
        return { ok: false, reason: { kind: 'timeout' } };
      }
      return { ok: true, value: confirmed };
    },
  };
  const service = createOfflineWorkSyncService({
    actorId: 'technician-1',
    queue,
    gateway,
    createOperationId: () => 'offline-start-replay-001',
  });

  await service.queueStart(baseSnapshot);
  await expect(service.synchronize()).resolves.toEqual([{
    operationId: 'offline-start-replay-001',
    status: 'pending',
    message: 'El servidor no confirmó el inicio; la operación permanece en la cola.',
  }]);
  expect(queue.entries).toHaveLength(1);

  await expect(service.synchronize()).resolves.toEqual([{
    operationId: 'offline-start-replay-001',
    status: 'synced',
    message: 'El servidor confirmó el inicio de atención.',
  }]);
  expect(submittedIds).toEqual(['offline-start-replay-001', 'offline-start-replay-001']);
  expect(effectsByOperation.size).toBe(1);
  expect(queue.entries).toHaveLength(0);
});

test('does not expose or resolve another technician’s pending operation', async () => {
  const queue = memoryQueue();
  const gateway = {
    getById: jest.fn(async () => ({ ok: false as const, reason: { kind: 'forbidden' as const } })),
    actOnIncident: jest.fn(),
  };
  const ownerService = createOfflineWorkSyncService({
    actorId: 'technician-1',
    queue,
    gateway,
    createOperationId: () => 'offline-start-private',
  });
  await ownerService.queueStart(baseSnapshot);
  await ownerService.synchronize();

  const otherTechnician = createOfflineWorkSyncService({
    actorId: 'technician-2',
    queue,
    gateway,
  });

  await expect(otherTechnician.listPending()).resolves.toEqual([]);
  await expect(otherTechnician.retry('offline-start-private')).rejects.toThrow(
    'Only the author of a pending operation can retry it.',
  );
  await expect(otherTechnician.discard('offline-start-private')).rejects.toThrow(
    'Only the author of a pending operation can discard it.',
  );
  expect(gateway.actOnIncident).not.toHaveBeenCalled();
  expect(queue.entries).toHaveLength(1);
});
