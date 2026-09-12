import type { Incident } from '../domain/incident';
import type { IncidentRepository } from '../domain/incidentRepository';

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
    private readonly incidents: readonly Incident[];

    constructor(seed: readonly Incident[] = SEED_INCIDENTS) {
        this.incidents = seed;
    }

    async list(): Promise<readonly Incident[]> {
        return this.incidents;
    }

    async getById(id: string): Promise<Incident | null> {
        return this.incidents.find((incident) => incident.id === id) ?? null;
    }
}