import type { FetchResult } from '../../../course-evaluation/contracts';
import type { IncidentRepository, IncidentSnapshot } from '../domain/incidentRepository';

/**Caso de uso: obtener el detalle de una incidencia por id. */
export async function getIncidentDetail(
    repository: IncidentRepository,
    incidentId: string,
): Promise<FetchResult<IncidentSnapshot | null>> {
    return repository.getById(incidentId);
}
