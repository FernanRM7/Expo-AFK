import {
  deduplicateOperations,
  reconcileSync,
  resolvePendingSyncConflict,
  resolveSync,
} from '../../src/course-evaluation';

test('CampusOps detects offline start versus remote reassignment without mutating either record', () => {
  const base = { id: 'campus-inc-001', version: 1, fields: { work: { assignedTechnicianId: 'technician-1', status: 'assigned' } } };
  const local = { ...base, fields: { work: { assignedTechnicianId: 'technician-1', status: 'in_progress' } } };
  const remote = { ...base, version: 2, fields: { work: { assignedTechnicianId: 'technician-2', status: 'assigned' } } };
  const before = JSON.stringify([base, local, remote]);
  expect(resolveSync(base, local, remote)).toEqual({ kind: 'conflict', fields: ['work'] });
  expect(JSON.stringify([base, local, remote])).toBe(before);
});

test('merges independent field changes and reports same-field conflict', () => {
  const base = { id: 'r1', version: 1, fields: { title: 'A', priority: 1 } };
  expect(
    resolveSync(
      base,
      { id: 'r1', version: 1, fields: { title: 'Local', priority: 1 } },
      { id: 'r1', version: 2, fields: { title: 'A', priority: 2 } },
    ),
  ).toEqual({ kind: 'merged', fields: { title: 'Local', priority: 2 } });
  expect(
    resolveSync(
      base,
      { id: 'r1', version: 1, fields: { title: 'Local', priority: 1 } },
      { id: 'r1', version: 2, fields: { title: 'Remote', priority: 1 } },
    ),
  ).toEqual({ kind: 'conflict', fields: ['title'] });
});

test('reports multiple incompatible fields in stable alphabetical order', () => {
  const base = { id: 'r2', version: 1, fields: { zebra: 'base', alpha: 'base' } };
  const local = { ...base, fields: { zebra: 'local', alpha: 'local' } };
  const remote = { ...base, version: 2, fields: { zebra: 'remote', alpha: 'remote' } };

  expect(resolveSync(base, local, remote)).toEqual({
    kind: 'conflict',
    fields: ['alpha', 'zebra'],
  });
});

test('deduplicates a replayed operation by stable identity', () => {
  const operations = [{ operationId: 'op-1', value: 1 }, { operationId: 'op-1', value: 1 }, { operationId: 'op-2', value: 2 }];
  expect(deduplicateOperations(operations)).toEqual([operations[0], operations[2]]);
});

test('preserves the remote reassignment and queued offline start for conflict review', () => {
  const base = {
    id: 'campus-inc-001',
    version: 1,
    fields: { work: { assignedTechnicianId: 'technician-1', status: 'assigned' } },
  };
  const local = {
    ...base,
    fields: { work: { assignedTechnicianId: 'technician-1', status: 'in_progress' } },
  };
  const remote = {
    ...base,
    version: 2,
    fields: { work: { assignedTechnicianId: 'technician-2', status: 'assigned' } },
  };
  const operation = {
    operationId: 'offline-start-001',
    incidentId: base.id,
    baseVersion: base.version,
    actorId: 'technician-1',
    action: 'start',
    payload: { startedAt: '2026-10-23T18:00:00.000Z' },
  };
  const recordsBefore = JSON.stringify({ base, local, remote, operation });

  const result = reconcileSync(base, local, remote, [operation]);

  expect(result).toEqual({
    kind: 'conflict',
    status: 'needs-review',
    fields: ['work'],
    base,
    local,
    remote,
    pendingOperations: [operation],
  });
  if (result.kind !== 'conflict') throw new Error('Expected a sync conflict.');
  const preservedOperation = result.pendingOperations[0];
  if (!preservedOperation) throw new Error('Expected the offline operation to remain queued.');
  expect(result.remote.fields.work).toEqual({
    assignedTechnicianId: 'technician-2',
    status: 'assigned',
  });
  expect(preservedOperation).toEqual(operation);
  expect(preservedOperation.operationId).toBe('offline-start-001');
  expect(preservedOperation.actorId).toBe('technician-1');
  expect(preservedOperation.baseVersion).toBe(1);
  expect(JSON.stringify({ base, local, remote, operation })).toBe(recordsBefore);
});

test('does not retry after confirmation while the incident remains assigned to another technician', () => {
  const base = {
    id: 'campus-inc-001',
    version: 1,
    fields: { work: { assignedTechnicianId: 'technician-1', status: 'assigned' } },
  };
  const local = {
    ...base,
    fields: { work: { assignedTechnicianId: 'technician-1', status: 'in_progress' } },
  };
  const remote = {
    ...base,
    version: 2,
    fields: { work: { assignedTechnicianId: 'technician-2', status: 'assigned' } },
  };
  const operation = {
    operationId: 'offline-start-001',
    incidentId: base.id,
    baseVersion: 1,
    actorId: 'technician-1',
    action: 'start',
    payload: { startedAt: '2026-10-23T18:00:00.000Z' },
  };
  const conflict = reconcileSync(base, local, remote, [operation]);
  if (conflict.kind !== 'conflict') throw new Error('Expected a sync conflict.');

  const result = resolvePendingSyncConflict(conflict, {
    action: 'retry',
    operationId: operation.operationId,
    confirmed: true,
    latestRemote: remote,
  });

  expect(result.kind).toBe('conflict');
  if (result.kind !== 'conflict') throw new Error('Expected unresolved conflict.');
  expect(result.reason).toBe('assignee-changed');
  expect(result.remote).toEqual(remote);
  expect(result.pendingOperations).toEqual([operation]);
});

test('rebases the same local intent only after explicit confirmation and matching assignment', () => {
  const base = {
    id: 'campus-inc-001',
    version: 1,
    fields: { work: { assignedTechnicianId: 'technician-1', status: 'assigned' } },
  };
  const local = {
    ...base,
    fields: { work: { assignedTechnicianId: 'technician-1', status: 'in_progress' } },
  };
  const remote = {
    ...base,
    version: 2,
    fields: { work: { assignedTechnicianId: 'technician-2', status: 'assigned' } },
  };
  const latestRemote = {
    ...remote,
    version: 3,
    fields: { work: { assignedTechnicianId: 'technician-1', status: 'assigned' } },
  };
  const operation = {
    operationId: 'offline-start-001',
    incidentId: base.id,
    baseVersion: 1,
    actorId: 'technician-1',
    action: 'start',
    payload: { startedAt: '2026-10-23T18:00:00.000Z' },
  };
  const conflict = reconcileSync(base, local, remote, [operation]);
  if (conflict.kind !== 'conflict') throw new Error('Expected a sync conflict.');

  const result = resolvePendingSyncConflict(conflict, {
    action: 'retry',
    operationId: operation.operationId,
    confirmed: true,
    latestRemote,
  });

  expect(result).toEqual({
    kind: 'retry',
    record: latestRemote,
    pendingOperations: [{ ...operation, baseVersion: 3 }],
    operation: { ...operation, baseVersion: 3 },
  });
  expect(operation.baseVersion).toBe(1);
  expect(operation.actorId).toBe('technician-1');
});

test('removes a local intent only after explicit discard confirmation', () => {
  const base = {
    id: 'campus-inc-001',
    version: 1,
    fields: { work: { assignedTechnicianId: 'technician-1', status: 'assigned' } },
  };
  const local = {
    ...base,
    fields: { work: { assignedTechnicianId: 'technician-1', status: 'in_progress' } },
  };
  const remote = {
    ...base,
    version: 2,
    fields: { work: { assignedTechnicianId: 'technician-2', status: 'assigned' } },
  };
  const operation = {
    operationId: 'offline-start-001',
    incidentId: base.id,
    baseVersion: 1,
    actorId: 'technician-1',
    action: 'start',
    payload: { startedAt: '2026-10-23T18:00:00.000Z' },
  };
  const conflict = reconcileSync(base, local, remote, [operation]);
  if (conflict.kind !== 'conflict') throw new Error('Expected a sync conflict.');

  expect(resolvePendingSyncConflict(conflict, {
    action: 'discard',
    operationId: operation.operationId,
    confirmed: true,
  })).toEqual({
    kind: 'discarded',
    record: remote,
    pendingOperations: [],
    operationId: operation.operationId,
  });
});

test('retains the conflict when the proposed retry is based on an older remote version', () => {
  const base = {
    id: 'campus-inc-001',
    version: 1,
    fields: { work: { assignedTechnicianId: 'technician-1', status: 'assigned' } },
  };
  const local = {
    ...base,
    fields: { work: { assignedTechnicianId: 'technician-1', status: 'in_progress' } },
  };
  const remote = {
    ...base,
    version: 2,
    fields: { work: { assignedTechnicianId: 'technician-2', status: 'assigned' } },
  };
  const operation = {
    operationId: 'offline-start-001',
    incidentId: base.id,
    baseVersion: 1,
    actorId: 'technician-1',
    action: 'start',
    payload: { startedAt: '2026-10-23T18:00:00.000Z' },
  };
  const conflict = reconcileSync(base, local, remote, [operation]);
  if (conflict.kind !== 'conflict') throw new Error('Expected a sync conflict.');

  const result = resolvePendingSyncConflict(conflict, {
    action: 'retry',
    operationId: operation.operationId,
    confirmed: true,
    latestRemote: base,
  });

  expect(result.kind).toBe('conflict');
  if (result.kind !== 'conflict') throw new Error('Expected unresolved conflict.');
  expect(result.reason).toBe('stale-remote-version');
  expect(result.pendingOperations).toEqual([operation]);
});
