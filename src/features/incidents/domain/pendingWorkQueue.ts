import type { PendingIncidentOperation } from '../../../campusops/contracts';
import type { IncidentSnapshot } from './incidentRepository';

export type PendingWorkState = 'pending' | 'needs-review';

export type PendingWorkEntry = Readonly<{
  operation: PendingIncidentOperation;
  baseSnapshot: IncidentSnapshot;
  state: PendingWorkState;
  conflictMessage?: string;
  conflictRemote?: IncidentSnapshot;
}>;

export interface PendingWorkQueue {
  enqueue(entry: PendingWorkEntry): Promise<void>;
  list(): Promise<readonly PendingWorkEntry[]>;
  update(entry: PendingWorkEntry): Promise<void>;
  remove(operationId: string): Promise<void>;
}
