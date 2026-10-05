import type { Incident } from './incident';
import type { FetchResult } from '../../../course-evaluation/contracts';
import type { IncidentStatus } from '../../../campusops/contracts';

export type IncidentSnapshot = Readonly<{
  id: string;
  version: number | null;
  status: IncidentStatus;
  incident: Incident | null;
}>;

export type CreateIncidentInput = Readonly<{
  category: Incident['category'];
  description: string;
  location: string;
}>;

/**Puerto del repositorio de incidencias.*/
export interface IncidentRepository {
  list(): Promise<FetchResult<readonly IncidentSnapshot[]>>;
  getById(id: string): Promise<FetchResult<IncidentSnapshot | null>>;
  create(input: CreateIncidentInput, idempotencyKey: string): Promise<FetchResult<IncidentSnapshot>>;
}
