import { authorizeOperation } from './authorizeOperation';
import type { ActorAutorizacion, IncidenciaAutorizable } from './authorizeOperation';

const reportante1: ActorAutorizacion = { actorId: 'reporter-1', role: 'reporter' };
const reportante2: ActorAutorizacion = { actorId: 'reporter-2', role: 'reporter' };
const tecnico1: ActorAutorizacion = { actorId: 'technician-1', role: 'technician' };
const tecnico2: ActorAutorizacion = { actorId: 'technician-2', role: 'technician' };
const coordinador: ActorAutorizacion = { actorId: 'coordinator-1', role: 'coordinator' };

const incidencia: IncidenciaAutorizable = {
    reporterId: 'reporter-1',
    assignedTechnicianId: 'technician-1',
};

test('reportante consulta solo sus incidencias', () => {
    expect(authorizeOperation(reportante1, incidencia, 'view')).toEqual({ allowed: true });
    expect(authorizeOperation(reportante2, incidencia, 'view')).toEqual({ allowed: false, code: 'forbidden' });
});

test('técnico resuelve solo incidencias asignadas a él', () => {
    expect(authorizeOperation(tecnico1, incidencia, 'resolve')).toEqual({ allowed: true });
    expect(authorizeOperation(tecnico2, incidencia, 'resolve')).toEqual({ allowed: false, code: 'forbidden' });
});

test('técnico puede iniciar solo su incidencia asignada', () => {
    expect(authorizeOperation(tecnico1, incidencia, 'start')).toEqual({ allowed: true });
    expect(authorizeOperation(tecnico2, incidencia, 'start')).toEqual({ allowed: false, code: 'forbidden' });
});

test('coordinación puede cerrar y reabrir', () => {
    expect(authorizeOperation(coordinador, incidencia, 'close')).toEqual({ allowed: true });
    expect(authorizeOperation(coordinador, incidencia, 'reopen')).toEqual({ allowed: true });
});

test('reportante y técnico no pueden cerrar ni reabrir', () => {
    for (const actor of [reportante1, tecnico1]) {
        expect(authorizeOperation(actor, incidencia, 'close')).toEqual({ allowed: false, code: 'forbidden' });
        expect(authorizeOperation(actor, incidencia, 'reopen')).toEqual({ allowed: false, code: 'forbidden' });
    }
});

test('un reportante no puede resolver aunque sea su incidencia', () => {
    expect(authorizeOperation(reportante1, incidencia, 'resolve')).toEqual({ allowed: false, code: 'forbidden' });
});

test('solo coordinación asigna y prioriza', () => {
    expect(authorizeOperation(coordinador, incidencia, 'assign')).toEqual({ allowed: true });
    expect(authorizeOperation(coordinador, incidencia, 'prioritize')).toEqual({ allowed: true });
    expect(authorizeOperation(tecnico1, incidencia, 'assign')).toEqual({ allowed: false, code: 'forbidden' });
});

test('el rechazo no expone datos de la incidencia', () => {
    const resultado = authorizeOperation(reportante2, incidencia, 'view');
    expect(JSON.stringify(resultado)).not.toContain('reporter-1');
    expect(JSON.stringify(resultado)).not.toContain('technician-1');
});