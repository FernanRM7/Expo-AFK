import type { CampusRole } from '../../../campusops/contracts';

export type OperacionIncidencia =
    | 'view'
    | 'assign'
    | 'prioritize'
    | 'start'
    | 'resolve'
    | 'close'
    | 'reopen'
    | 'comment'
    | 'add_evidence';

export type ActorAutorizacion = Readonly<{ actorId: string; role: CampusRole }>;

export type IncidenciaAutorizable = Readonly<{
    reporterId: string;
    assignedTechnicianId: string | null;
}>;

export type ResultadoAutorizacion =
    | Readonly<{ allowed: true }>
    | Readonly<{ allowed: false; code: 'forbidden' }>;

const PERMITIDO: ResultadoAutorizacion = { allowed: true };
const DENEGADO: ResultadoAutorizacion = { allowed: false, code: 'forbidden' };

const ACCIONES_COORDINADOR: readonly OperacionIncidencia[] = ['assign', 'prioritize', 'close', 'reopen'];
const ACCIONES_TECNICO: readonly OperacionIncidencia[] = ['start', 'resolve'];

function esVisible(actor: ActorAutorizacion, incidencia: IncidenciaAutorizable): boolean {
    if (actor.role === 'coordinator') return true;
    if (actor.role === 'reporter') return incidencia.reporterId === actor.actorId;
    return incidencia.assignedTechnicianId === actor.actorId;
}

export function authorizeOperation(
    actor: ActorAutorizacion,
    incidencia: IncidenciaAutorizable,
    operacion: OperacionIncidencia,
): ResultadoAutorizacion {
    if (ACCIONES_COORDINADOR.includes(operacion)) {
        return actor.role === 'coordinator' ? PERMITIDO : DENEGADO;
    }
    if (ACCIONES_TECNICO.includes(operacion)) {
        return actor.role === 'technician' && esVisible(actor, incidencia) ? PERMITIDO : DENEGADO;
    }

    return esVisible(actor, incidencia) ? PERMITIDO : DENEGADO;
}