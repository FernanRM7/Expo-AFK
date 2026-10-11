import type { FetchResult } from '../../../course-evaluation/contracts';
import type {
    CreateIncidentInput,
    IncidentRepository,
    IncidentSnapshot,
} from '../domain/incidentRepository';

export function createIncident(
    repository: IncidentRepository,
    input: CreateIncidentInput,
    idempotencyKey: string,
): Promise<FetchResult<IncidentSnapshot>> {
    return repository.create(input, idempotencyKey);
}
