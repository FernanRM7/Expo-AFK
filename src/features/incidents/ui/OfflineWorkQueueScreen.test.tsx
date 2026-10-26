import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import type { OfflineWorkGateway, OfflineWorkSyncService } from '../application/offlineWorkSyncService';
import type { PendingWorkEntry } from '../domain/pendingWorkQueue';
import type { IncidentRepository } from '../domain/incidentRepository';
import { OfflineWorkQueueScreen } from './OfflineWorkQueueScreen';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const conflictEntry: PendingWorkEntry = {
  operation: {
    operationId: 'offline-start-ui',
    incidentId: 'campus-inc-001',
    baseVersion: 1,
    actorId: 'technician-1',
    action: 'start',
    payload: { startedAt: '2026-10-23T18:00:00.000Z' },
  },
  baseSnapshot: {
    id: 'campus-inc-001',
    version: 1,
    status: 'assigned',
    incident: {
      id: 'campus-inc-001',
      description: 'Falla ficticia',
      category: 'connectivity',
      status: 'assigned',
      location: { source: 'manual', label: 'Edificio de prueba' },
      reporterId: 'reporter-1',
      assignedTechnicianId: 'technician-1',
    },
  },
  state: 'needs-review',
  conflictMessage: 'La asignación remota cambió.',
  conflictRemote: {
    id: 'campus-inc-001',
    version: 2,
    status: 'assigned',
    incident: {
      id: 'campus-inc-001',
      description: 'Falla ficticia',
      category: 'connectivity',
      status: 'assigned',
      location: { source: 'manual', label: 'Edificio de prueba' },
      reporterId: 'reporter-1',
      assignedTechnicianId: 'technician-2',
    },
  },
};

test('presents the conflict, remote assignment, author and base version with explicit decisions', async () => {
  const repository: IncidentRepository & OfflineWorkGateway = {
    async list() {
      return { ok: true, value: [] };
    },
    async getById() {
      return { ok: true, value: null };
    },
    async create() {
      return { ok: false, reason: { kind: 'contract-invalid' } };
    },
    async actOnIncident() {
      return { ok: false, reason: { kind: 'contract-invalid' } };
    },
  };
  const retry = jest.fn(async () => ({
    operationId: conflictEntry.operation.operationId,
    status: 'needs-review' as const,
    message: 'Sigue en revisión.',
  }));
  const discard = jest.fn(async () => undefined);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const service: OfflineWorkSyncService = {
    async queueStart() {
      return { ok: false, reason: { kind: 'contract-invalid' } };
    },
    async listPending() {
      return [conflictEntry];
    },
    async synchronize() {
      return [];
    },
    retry,
    discard,
  };
  const view = await render(
    <OfflineWorkQueueScreen
      repository={repository}
      service={service}
      onBack={() => undefined}
    />,
  );

  await waitFor(() => {
    expect(view.getByTestId('queued-operation-offline-start-ui')).toBeTruthy();
    expect(view.getByTestId('conflict-remote-assignee-offline-start-ui').props.children.join(''))
      .toContain('technician-2');
    expect(view.getByTestId('conflict-operation-author-offline-start-ui').props.children.join(''))
      .toContain('technician-1');
    expect(view.getByTestId('conflict-operation-base-version-offline-start-ui').props.children.join(''))
      .toContain('1');
    expect(view.getByText('Conflicto de sincronización')).toBeTruthy();
    expect(view.getByText('La asignación remota cambió.')).toBeTruthy();
  });
  fireEvent.press(view.getByTestId('retry-operation-offline-start-ui'));
  await waitFor(() => expect(retry).toHaveBeenCalledWith('offline-start-ui'));
  await waitFor(() => {
    expect(view.getByTestId('discard-operation-offline-start-ui').props.accessibilityState.disabled).toBe(false);
  });
  fireEvent.press(view.getByTestId('discard-operation-offline-start-ui'));
  expect(alert).toHaveBeenCalledTimes(1);
  const buttons = alert.mock.calls[0]?.[2];
  expect(buttons?.find((button) => button.text === 'Descartar')?.onPress).toEqual(expect.any(Function));
  alert.mockRestore();
});

test('queues a start from the previously loaded snapshot without requesting the server again', async () => {
  const snapshot = conflictEntry.baseSnapshot;
  const getById = jest.fn(async () => ({ ok: false as const, reason: { kind: 'server-error' as const, status: 0 } }));
  const repository: IncidentRepository & OfflineWorkGateway = {
    async list() {
      return { ok: true, value: [snapshot] };
    },
    getById,
    async create() {
      return { ok: false, reason: { kind: 'contract-invalid' } };
    },
    async actOnIncident() {
      return { ok: false, reason: { kind: 'contract-invalid' } };
    },
  };
  const queueStart = jest.fn(async () => ({ ok: true as const, value: conflictEntry }));
  const service: OfflineWorkSyncService = {
    queueStart,
    async listPending() {
      return [];
    },
    async synchronize() {
      return [];
    },
    async retry() {
      throw new Error('No conflict to retry.');
    },
    async discard() {},
  };
  const view = await render(
    <OfflineWorkQueueScreen repository={repository} service={service} onBack={() => undefined} />,
  );

  const startButton = await waitFor(() => view.getByText('Guardar inicio offline'));
  fireEvent.press(startButton);

  await waitFor(() => expect(queueStart).toHaveBeenCalledWith(snapshot));
  expect(getById).not.toHaveBeenCalled();
});
