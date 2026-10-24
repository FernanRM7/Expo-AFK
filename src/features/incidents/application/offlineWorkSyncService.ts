import type { PendingIncidentOperation } from '../../../campusops/contracts';
import type { FetchResult } from '../../../course-evaluation/contracts';
import { reconcileSync } from '../../../course-evaluation';
import type { IncidentSnapshot } from '../domain/incidentRepository';
import type { PendingWorkEntry, PendingWorkQueue } from '../domain/pendingWorkQueue';

export type OfflineWorkGateway = Readonly<{
  getById(id: string): Promise<FetchResult<IncidentSnapshot | null>>;
  actOnIncident(
    snapshot: IncidentSnapshot,
    action: 'start',
    details: Readonly<Record<string, unknown>>,
    idempotencyKey: string,
  ): Promise<FetchResult<IncidentSnapshot>>;
}>;

export type OfflineWorkSyncResult = Readonly<{
  operationId: string;
  status: 'synced' | 'needs-review' | 'pending';
  message: string;
}>;

export type OfflineWorkSyncService = Readonly<{
  queueStart(snapshot: IncidentSnapshot): Promise<FetchResult<PendingWorkEntry>>;
  listPending(): Promise<readonly PendingWorkEntry[]>;
  synchronize(): Promise<readonly OfflineWorkSyncResult[]>;
  retry(operationId: string): Promise<OfflineWorkSyncResult>;
  discard(operationId: string): Promise<void>;
}>;

type Dependencies = Readonly<{
  actorId: string;
  queue: PendingWorkQueue | Promise<PendingWorkQueue> | (() => Promise<PendingWorkQueue>);
  gateway: OfflineWorkGateway;
  now?: () => Date;
  createOperationId?: () => string;
}>;

function makeOperationId(): string {
  return `offline-start-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function toSyncRecord(snapshot: IncidentSnapshot) {
  return {
    id: snapshot.id,
    version: snapshot.version ?? 0,
    fields: {
      work: {
        assignedTechnicianId: snapshot.incident?.assignedTechnicianId ?? null,
        status: snapshot.status,
      },
    },
  };
}

function markNeedsReview(
  entry: PendingWorkEntry,
  conflictMessage: string,
  conflictRemote?: IncidentSnapshot,
): PendingWorkEntry {
  return {
    ...entry,
    state: 'needs-review',
    conflictMessage,
    ...(conflictRemote ? { conflictRemote } : {}),
  };
}

export function createOfflineWorkSyncService(
  dependencies: Dependencies,
): OfflineWorkSyncService {
  const getQueue = async () => typeof dependencies.queue === 'function'
    ? await dependencies.queue()
    : await dependencies.queue;
  const now = dependencies.now ?? (() => new Date());
  const createOperationId = dependencies.createOperationId ?? makeOperationId;

  async function attempt(entry: PendingWorkEntry): Promise<OfflineWorkSyncResult> {
    const current = await dependencies.gateway.getById(entry.operation.incidentId);
    if (!current.ok) {
      if (current.reason.kind === 'forbidden' ||
        (current.reason.kind === 'server-error' && current.reason.status === 409)) {
        await (await getQueue()).update(markNeedsReview(
          entry,
          'Conflicto de sincronización: cambió la asignación o la versión remota. La intención local sigue pendiente.',
        ));
        return {
          operationId: entry.operation.operationId,
          status: 'needs-review',
          message: 'Conflicto de sincronización; la operación local se conserva para revisión.',
        };
      }
      return {
        operationId: entry.operation.operationId,
        status: 'pending',
        message: 'No se pudo consultar el servidor; la operación permanece en la cola.',
      };
    }
    if (current.value === null || current.value.version === null) {
      await (await getQueue()).update(markNeedsReview(
        entry,
        'Conflicto de sincronización: no existe una versión remota válida para confirmar el inicio.',
      ));
      return {
        operationId: entry.operation.operationId,
        status: 'needs-review',
        message: 'Conflicto de sincronización; la operación local se conserva para revisión.',
      };
    }

    const base = toSyncRecord(entry.baseSnapshot);
    const baseWork = base.fields.work;
    if (typeof baseWork !== 'object' || baseWork === null || Array.isArray(baseWork)) {
      throw new Error('The saved base snapshot has no valid work state.');
    }
    const local = {
      ...base,
      fields: {
        ...base.fields,
        work: { ...baseWork, status: 'in_progress' },
      },
    };
    const remote = toSyncRecord(current.value);
    const reconciliation = reconcileSync(base, local, remote, [entry.operation]);
    if (reconciliation.kind === 'conflict') {
      await (await getQueue()).update(markNeedsReview(
        entry,
        'Conflicto de trabajo: coordinación cambió la asignación o el estado desde la versión base.',
        current.value,
      ));
      return {
        operationId: entry.operation.operationId,
        status: 'needs-review',
        message: 'Conflicto de sincronización; se conserva la asignación remota y el inicio local pendiente.',
      };
    }

    const action = await dependencies.gateway.actOnIncident(
      current.value,
      'start',
      entry.operation.payload,
      entry.operation.operationId,
    );
    if (action.ok) {
      await (await getQueue()).remove(entry.operation.operationId);
      return {
        operationId: entry.operation.operationId,
        status: 'synced',
        message: 'El servidor confirmó el inicio de atención.',
      };
    }
    if (action.reason.kind === 'forbidden' ||
      (action.reason.kind === 'server-error' && action.reason.status === 409)) {
      await (await getQueue()).update(markNeedsReview(
        entry,
        'Conflicto de sincronización: el servidor rechazó la versión o la asignación. La intención local sigue pendiente.',
        current.value,
      ));
      return {
        operationId: entry.operation.operationId,
        status: 'needs-review',
        message: 'Conflicto de sincronización; la operación local se conserva para revisión.',
      };
    }
    return {
      operationId: entry.operation.operationId,
      status: 'pending',
      message: 'El servidor no confirmó el inicio; la operación permanece en la cola.',
    };
  }

  return {
    async queueStart(snapshot) {
      if (
        snapshot.version === null ||
        snapshot.incident === null ||
        snapshot.status !== 'assigned'
      ) {
        return { ok: false, reason: { kind: 'contract-invalid' } };
      }
      if (snapshot.incident.assignedTechnicianId !== dependencies.actorId) {
        return { ok: false, reason: { kind: 'forbidden' } };
      }

      const operation: PendingIncidentOperation = {
        operationId: createOperationId(),
        incidentId: snapshot.id,
        baseVersion: snapshot.version,
        actorId: dependencies.actorId,
        action: 'start',
        payload: { startedAt: now().toISOString() },
      };
      const entry: PendingWorkEntry = { operation, baseSnapshot: snapshot, state: 'pending' };
      await (await getQueue()).enqueue(entry);
      return { ok: true, value: entry };
    },

    async listPending() {
      return (await getQueue()).list().then((entries) =>
        entries.filter((entry) => entry.operation.actorId === dependencies.actorId),
      );
    },

    async synchronize() {
      const entries = (await (await getQueue()).list()).filter(
        (entry) => entry.operation.actorId === dependencies.actorId,
      );
      const results: OfflineWorkSyncResult[] = [];
      for (const entry of entries) {
        if (entry.state === 'needs-review') {
          results.push({
            operationId: entry.operation.operationId,
            status: 'needs-review',
            message: entry.conflictMessage ?? 'Conflicto pendiente de revisión.',
          });
        } else {
          results.push(await attempt(entry));
        }
      }
      return results;
    },

    async retry(operationId) {
      const queue = await getQueue();
      const entry = (await queue.list()).find(
        (queued) => queued.operation.operationId === operationId,
      );
      if (!entry || entry.state !== 'needs-review') {
        throw new Error('The requested operation is not awaiting conflict review.');
      }
      if (entry.operation.actorId !== dependencies.actorId) {
        throw new Error('Only the author of a pending operation can retry it.');
      }

      const current = await dependencies.gateway.getById(entry.operation.incidentId);
      if (!current.ok || !current.value || current.value.version === null) {
        return {
          operationId,
          status: 'needs-review',
          message: 'No se pudo validar la asignación remota; la operación sigue pendiente.',
        };
      }
      if (
        current.value.incident?.assignedTechnicianId !== entry.operation.actorId ||
        current.value.status !== 'assigned'
      ) {
        const updated = markNeedsReview(
          entry,
          'La reasignación remota sigue vigente. Coordinación debe reasignar la incidencia al autor antes de reintentar.',
          current.value,
        );
        await queue.update(updated);
        return {
          operationId,
          status: 'needs-review',
          message: updated.conflictMessage ?? 'La asignación remota requiere resolución.',
        };
      }

      const rebased: PendingWorkEntry = {
        operation: { ...entry.operation, baseVersion: current.value.version },
        baseSnapshot: entry.baseSnapshot,
        state: 'pending',
        conflictRemote: current.value,
      };
      await queue.update(rebased);
      return attempt(rebased);
    },

    async discard(operationId) {
      const queue = await getQueue();
      const entry = (await queue.list()).find(
        (queued) => queued.operation.operationId === operationId,
      );
      if (!entry || entry.state !== 'needs-review') {
        throw new Error('Only an operation awaiting conflict review can be discarded.');
      }
      if (entry.operation.actorId !== dependencies.actorId) {
        throw new Error('Only the author of a pending operation can discard it.');
      }
      await queue.remove(operationId);
    },
  };
}
