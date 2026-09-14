import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { IncidentListScreen } from './IncidentListScreen';
import { InMemoryIncidentRepository } from '../infrastructure/inMemoryIncidentRepository';
import type { Incident } from '../domain/incident';

const INCIDENCIAS_FIJAS: readonly Incident[] = [
    {
        id: 'inc-test-1',
        title: 'Incidencia de prueba',
        description: 'Descripción de prueba',
        category: 'electrical',
        status: 'open',
        location: { source: 'manual', label: 'Edificio de prueba' },
        reporterId: 'reporter-test',
        assignedTechnicianId: null,
        createdAt: '2026-09-10T00:00:00.000Z',
    },
];

test('renderiza las incidencias del repositorio inyectado (fake, determinista)', async () => {
    const repositorio = new InMemoryIncidentRepository(INCIDENCIAS_FIJAS);
    const vista = await render(
        <IncidentListScreen repository={repositorio} onSelectIncident={() => { }} />,
    );
    await waitFor(() => {
        expect(vista.getByText('Incidencia de prueba')).toBeTruthy();
        expect(vista.getByTestId('incident-status-inc-test-1').props.children).toBe('open');
    });
});

test('llama a onSelectIncident con el id de la incidencia presionada', async () => {
    const repositorio = new InMemoryIncidentRepository(INCIDENCIAS_FIJAS);
    let idSeleccionado: string | null = null;
    const vista = await render(
        <IncidentListScreen repository={repositorio} onSelectIncident={(id) => (idSeleccionado = id)} />,
    );

    const fila = await waitFor(() => vista.getByTestId('incident-row-inc-test-1'));
    fireEvent.press(fila);

    expect(idSeleccionado).toBe('inc-test-1');
});