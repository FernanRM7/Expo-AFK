import type { FetchResult } from '../../../course-evaluation/contracts';
import type { IncidentRepository, IncidentSnapshot } from '../domain/incidentRepository';

/**Caso de uso: obtener la lista de incidencias. */
export async function listIncidents(
    repository: IncidentRepository,
): Promise<FetchResult<readonly IncidentSnapshot[]>> {
  return repository.list();
}
