import type { Incident } from '../domain/incident';
import type { IncidentRepository } from '../domain/incidentRepository';

/**Caso de uso: obtener la lista de incidencias. */
export async function listIncidents(repository: IncidentRepository): Promise<readonly Incident[]> {
  return repository.list();
}