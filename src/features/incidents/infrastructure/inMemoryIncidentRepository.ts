import type { Incident } from '../domain/incident';
import type { IncidentRepository, IncidentSnapshot, CreateIncidentInput } from '../domain/incidentRepository';
import type { FetchResult } from '../../../course-evaluation/contracts';

/** Datos ficticios  para desarrollo y pruebas*/
const SEED_INCIDENTS: readonly Incident[] = [
    {
        id: 'inc-001',
        title: 'Fuga de agua en laboratorio B',
        description: 'Se observa fuga en la tubería bajo el fregadero del laboratorio B.',
        category: 'water',
        status: 'open',
        location: { source: 'manual', label: 'Edificio B, Laboratorio 2' },
        reporterId: 'student-reporter-01',
        assignedTechnicianId: null,
        createdAt: '2026-09-10T08:00:00.000Z',
    },
    {
        id: 'inc-002',
        title: 'Sin conectividad en sala de cómputo',
        description: 'Los equipos de la sala 4 no logran conectarse a la red institucional.',
        category: 'connectivity',
        status: 'assigned',
        location: { source: 'manual', label: 'Edificio C, Sala 4' },
        reporterId: 'student-reporter-02',
        assignedTechnicianId: 'tech-01',
        createdAt: '2026-09-10T09:30:00.000Z',
    },
    {
        id: 'inc-003',
        title: 'Falla eléctrica en pasillo principal',
        description: 'Parpadeo constante de luminarias en el pasillo principal del edificio A.',
        category: 'electrical',
        status: 'in_progress',
        location: { source: 'manual', label: 'Edificio A, Pasillo principal' },
        reporterId: 'student-reporter-01',
        assignedTechnicianId: 'tech-02',
        createdAt: '2026-09-09T14:15:00.000Z',
    },
];

/** Fake determinista de infraestructura */

export class InMemoryIncidentRepository implements IncidentRepository {
    private readonly incidents: Incident[];
    private readonly creations = new Map<string, { fingerprint: string; snapshot: IncidentSnapshot }>();

    constructor(seed: readonly Incident[] = SEED_INCIDENTS) {
        this.incidents = [...seed];
    }

    async list(): Promise<FetchResult<readonly IncidentSnapshot[]>> {
        return {
            ok: true,
            value: this.incidents.map((incident) => ({
                id: incident.id,
                version: null,
                status: incident.status,
                incident,
            })),
        };
    }

    async getById(id: string): Promise<FetchResult<IncidentSnapshot | null>> {
        const incident = this.incidents.find((item) => item.id === id);
        return {
            ok: true,
            value: incident ? {
                id: incident.id,
                version: null,
                status: incident.status,
                incident,
            } : null,
        };
    }

    async create(
        input: CreateIncidentInput,
        idempotencyKey: string,
    ): Promise<FetchResult<IncidentSnapshot>> {
        const fingerprint = JSON.stringify(input);
        const previous = this.creations.get(idempotencyKey);
        if (previous) {
            return previous.fingerprint === fingerprint
                ? { ok: true, value: previous.snapshot }
                : { ok: false, reason: { kind: 'contract-invalid' } };
        }
        const incident: Incident = {
            id: `local-incident-${this.incidents.length + 1}`,
            description: input.description,
            category: input.category,
            status: 'open',
            location: { source: 'manual', label: input.location },
            reporterId: 'local-reporter',
            assignedTechnicianId: null,
        };
        this.incidents.push(incident);
        const snapshot = { id: incident.id, version: null, status: incident.status, incident };
        this.creations.set(idempotencyKey, { fingerprint, snapshot });
        return {
            ok: true,
            value: snapshot,
        };
    }
}
