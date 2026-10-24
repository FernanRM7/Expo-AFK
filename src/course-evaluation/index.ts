import type {
  AuthEvent,
  JsonObject,
  ParseResult,
  PermissionEvent,
  RemoteResponse,
  SyncRecord,
} from './contracts';
import type { IncidentLocation, PendingIncidentOperation } from '../campusops/contracts';

function pending(name: string): never {
  throw new Error(`${name} must be implemented in the assigned week`);
}

const SENSITIVE_TELEMETRY_KEYS = new Set([
  'authorization',
  'password',
  'token',
  'accesstoken',
  'refreshtoken',
  'email',
  'displayname',
  'name',
  'userid',
  'reporterid',
  'technicianid',
  'assignedtechnicianid',
  'location',
  'latitude',
  'longitude',
  'photos',
  'evidence',
  'internalcomments',
  'assignmenthistory',
]);

function normalizeTelemetryKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '');
}

function redactTelemetryValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactTelemetryValue);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      SENSITIVE_TELEMETRY_KEYS.has(normalizeTelemetryKey(key))
        ? '[REDACTED]'
        : redactTelemetryValue(nestedValue),
    ]),
  );
}

export function redactForTelemetry(input: unknown): unknown {
  return redactTelemetryValue(input);
}

export function parseRemoteResource(input: unknown): ParseResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: 'contract' };
  }

  const resource = input as Record<string, unknown>;
  const { id, version, status, payload } = resource;
  if (
    typeof id !== 'string' ||
    id.trim().length === 0 ||
    typeof status !== 'string' ||
    status.trim().length === 0 ||
    typeof version !== 'number' ||
    !Number.isInteger(version) ||
    version < 0 ||
    !Object.prototype.hasOwnProperty.call(resource, 'payload') ||
    (payload !== null && (typeof payload !== 'object' || Array.isArray(payload)))
  ) {
    return { ok: false, error: 'contract' };
  }

  return {
    ok: true,
    value: { id, version, status, payload: payload as JsonObject | null },
  };
}

export function coordinateRefresh(events: readonly AuthEvent[]): Readonly<{
  status: 'anonymous' | 'authenticated';
  activeGeneration: number | null;
  refreshCalls: number;
  retriedRequestIds: readonly string[];
  persistedToken: string | null;
}> {
  let status: 'anonymous' | 'authenticated' = 'authenticated';
  let activeGeneration = 0;
  let refreshCalls = 0;
  let refreshPending = false;
  let persistedToken: string | null = null;
  const pendingRequestIds = new Set<string>();
  const retriedRequestIds = new Set<string>();

  for (const event of events) {
    if (event.type === 'logout') {
      status = 'anonymous';
      persistedToken = null;
      refreshPending = false;
      pendingRequestIds.clear();
      continue;
    }

    if (event.type === 'refreshFailed') {
      if (event.generation !== undefined && event.generation !== activeGeneration) continue;
      status = 'anonymous';
      persistedToken = null;
      refreshPending = false;
      pendingRequestIds.clear();
      continue;
    }

    if (event.type === 'request401') {
      if (
        status !== 'authenticated' || !event.requestId ||
        pendingRequestIds.has(event.requestId) || retriedRequestIds.has(event.requestId)
      ) continue;
      const requestGeneration = event.generation ?? activeGeneration;
      if (requestGeneration < activeGeneration && persistedToken) {
        retriedRequestIds.add(event.requestId);
      } else if (requestGeneration === activeGeneration) {
        pendingRequestIds.add(event.requestId);
      }
      if (requestGeneration === activeGeneration && !refreshPending) {
        refreshPending = true;
        refreshCalls += 1;
      }
      continue;
    }

    if (event.type === 'refreshSucceeded') {
      const nextGeneration = event.generation ?? activeGeneration + 1;
      if (nextGeneration <= activeGeneration) continue;
      activeGeneration = nextGeneration;
      persistedToken = event.token ?? null;
      status = persistedToken ? 'authenticated' : 'anonymous';
      refreshPending = false;
      if (persistedToken) {
        for (const requestId of pendingRequestIds) retriedRequestIds.add(requestId);
      }
      pendingRequestIds.clear();
    }
  }

  return {
    status,
    activeGeneration: status === 'authenticated' ? activeGeneration : null,
    refreshCalls,
    retriedRequestIds: [...retriedRequestIds],
    persistedToken,
  };
}

export type SyncResolution =
  | Readonly<{ kind: 'merged'; fields: JsonObject }>
  | Readonly<{ kind: 'conflict'; fields: readonly string[] }>;

export type SyncReconciliation =
  | Readonly<{
      kind: 'merged';
      record: SyncRecord;
      pendingOperations: readonly PendingIncidentOperation[];
    }>
  | Readonly<{
      kind: 'conflict';
      status: 'needs-review';
      fields: readonly string[];
      base: SyncRecord;
      local: SyncRecord;
      remote: SyncRecord;
      pendingOperations: readonly PendingIncidentOperation[];
      reason?: 'assignee-changed' | 'stale-remote-version' | 'action-no-longer-applicable';
    }>;

export type SyncConflictDecision =
  | Readonly<{ action: 'discard'; operationId: string; confirmed: true }>
  | Readonly<{
      action: 'retry';
      operationId: string;
      confirmed: true;
      latestRemote: SyncRecord;
    }>;

export type SyncConflictDecisionResult =
  | Readonly<{
      kind: 'discarded';
      record: SyncRecord;
      pendingOperations: readonly PendingIncidentOperation[];
      operationId: string;
    }>
  | Readonly<{
      kind: 'retry';
      record: SyncRecord;
      pendingOperations: readonly PendingIncidentOperation[];
      operation: PendingIncidentOperation;
    }>
  | Extract<SyncReconciliation, { kind: 'conflict' }>;

export function resolveSync(
  base: SyncRecord,
  local: SyncRecord,
  remote: SyncRecord,
): SyncResolution {
  const fields = new Set([
    ...Object.keys(base.fields),
    ...Object.keys(local.fields),
    ...Object.keys(remote.fields),
  ]);
  const conflicts: string[] = [];
  const merged: Record<string, unknown> = {};

  for (const field of fields) {
    const baseValue = base.fields[field];
    const localValue = local.fields[field];
    const remoteValue = remote.fields[field];
    const localChanged = !areSyncValuesEqual(localValue, baseValue);
    const remoteChanged = !areSyncValuesEqual(remoteValue, baseValue);

    if (localChanged && remoteChanged && !areSyncValuesEqual(localValue, remoteValue)) {
      conflicts.push(field);
      continue;
    }

    const source = localChanged ? local.fields : remote.fields;
    if (Object.prototype.hasOwnProperty.call(source, field)) merged[field] = source[field];
  }

  return conflicts.length > 0
    ? { kind: 'conflict', fields: conflicts }
    : { kind: 'merged', fields: merged };
}

export function reconcileSync(
  base: SyncRecord,
  local: SyncRecord,
  remote: SyncRecord,
  pendingOperations: readonly PendingIncidentOperation[] = [],
): SyncReconciliation {
  if (base.id !== local.id || base.id !== remote.id) {
    throw new Error('Cannot reconcile different incident records.');
  }
  if (pendingOperations.some((operation) => operation.incidentId !== base.id)) {
    throw new Error('A pending operation belongs to a different incident.');
  }

  const resolution = resolveSync(base, local, remote);
  const queue = [...pendingOperations];
  if (resolution.kind === 'merged') {
    return {
      kind: 'merged',
      record: { ...remote, fields: resolution.fields },
      pendingOperations: queue,
    };
  }

  return {
    kind: 'conflict',
    status: 'needs-review',
    fields: resolution.fields,
    base,
    local,
    remote,
    pendingOperations: queue,
  };
}

export function resolvePendingSyncConflict(
  conflict: Extract<SyncReconciliation, { kind: 'conflict' }>,
  decision: SyncConflictDecision,
): SyncConflictDecisionResult {
  const operationIndex = conflict.pendingOperations.findIndex(
    (operation) => operation.operationId === decision.operationId,
  );
  if (operationIndex < 0) {
    throw new Error('The pending operation is not part of this conflict.');
  }

  if (decision.action === 'discard') {
    return {
      kind: 'discarded',
      record: conflict.remote,
      pendingOperations: conflict.pendingOperations.filter(
        (_operation, index) => index !== operationIndex,
      ),
      operationId: decision.operationId,
    };
  }

  const operation = conflict.pendingOperations[operationIndex];
  if (!operation) {
    throw new Error('The pending operation is not part of this conflict.');
  }
  const latestRemote = decision.latestRemote;
  if (latestRemote.id !== conflict.remote.id) {
    throw new Error('The retry snapshot belongs to a different incident.');
  }
  if (latestRemote.version < conflict.remote.version) {
    return { ...conflict, reason: 'stale-remote-version' };
  }
  if (assignedTechnicianId(latestRemote) !== operation.actorId) {
    return { ...conflict, remote: latestRemote, reason: 'assignee-changed' };
  }
  if (
    (operation.action === 'start' || operation.action === 'start-work') &&
    workStatus(latestRemote) !== 'assigned'
  ) {
    return { ...conflict, remote: latestRemote, reason: 'action-no-longer-applicable' };
  }

  const rebasedOperation = { ...operation, baseVersion: latestRemote.version };
  return {
    kind: 'retry',
    record: latestRemote,
    pendingOperations: conflict.pendingOperations.map((queued, index) =>
      index === operationIndex ? rebasedOperation : queued,
    ),
    operation: rebasedOperation,
  };
}

function assignedTechnicianId(record: SyncRecord): string | null {
  const work = workFields(record);
  const value = work?.assignedTechnicianId;
  return typeof value === 'string' ? value : null;
}

function workStatus(record: SyncRecord): string | null {
  const value = workFields(record)?.status;
  return typeof value === 'string' ? value : null;
}

function workFields(record: SyncRecord): Record<string, unknown> | null {
  const work = record.fields.work;
  return typeof work === 'object' && work !== null && !Array.isArray(work)
    ? work as Record<string, unknown>
    : null;
}

function areSyncValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => areSyncValuesEqual(value, right[index]));
  }
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) {
    return false;
  }

  const rightRecord = right as Record<string, unknown>;
  const entries = Object.entries(left);
  return entries.length === Object.keys(right).length &&
    entries.every(([key, value]) =>
      Object.prototype.hasOwnProperty.call(rightRecord, key) &&
      areSyncValuesEqual(value, rightRecord[key]),
    );
}

export function deduplicateOperations<T extends Readonly<{ operationId: string }>>(
  operations: readonly T[],
): readonly T[] {
  const seen = new Set<string>();
  return operations.filter((operation) => {
    if (seen.has(operation.operationId)) return false;
    seen.add(operation.operationId);
    return true;
  });
}

export function planRetry(_input: Readonly<{
  method: 'GET' | 'POST';
  status: number | 'timeout';
  attempt: number;
  retryAfterMs?: number;
  idempotencyKey?: string;
}>): Readonly<{ retry: boolean; delayMs: number; requiresStableIdempotencyKey: boolean }> {
  return pending('planRetry');
}

export function reduceRemoteResponses(_input: Readonly<{
  activeRequestId: string;
  responses: readonly RemoteResponse[];
}>): Readonly<{ state: 'success' | 'error' | 'loading'; value?: unknown; error?: string }> {
  return pending('reduceRemoteResponses');
}

export function reducePermissionLifecycle(
  _events: readonly PermissionEvent[],
): Readonly<{ status: 'available' | 'denied' | 'blocked'; resourceActive: boolean }> {
  return pending('reducePermissionLifecycle');
}

/** Week 09: see docs/CAMPUSOPS_API.md; this is not a completed solution. */
export function selectIncidentLocation(_provider: unknown, _manualLabel: string): IncidentLocation {
  return pending('selectIncidentLocation');
}
