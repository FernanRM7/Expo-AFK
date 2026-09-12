import type { Incident } from './incident';

/**Puerto del repositorio de incidencias.*/
export interface IncidentRepository {
  list(): Promise<readonly Incident[]>;
  getById(id: string): Promise<Incident | null>;
}