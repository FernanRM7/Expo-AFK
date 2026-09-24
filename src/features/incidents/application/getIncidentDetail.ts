import type { Incident } from '../domain/incident';
import type { IncidentRepository } from '../domain/incidentRepository';

/**Caso de uso: obtener el detalle de una incidencia por id. */
export async function getIncidentDetail(
    repository: IncidentRepository,
    incidentId: string,
): Promise<Incident | null> {
    const incident = await repository.getById(incidentId);
    console.log({
        incidentId,
        found: incident !== null,
        status: incident?.status ?? null,
    });
    return incident;
}