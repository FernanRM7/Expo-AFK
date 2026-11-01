import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { IncidentCreationScreen } from './IncidentCreationScreen';
import type { IncidentRepository } from '../domain/incidentRepository';
import type { IncidentLocation } from '../../../campusops/contracts';

function repositoryWithCreate(create: jest.Mock): IncidentRepository {
    return {
        list: async () => ({ ok: true, value: [] }),
        getById: async () => ({ ok: true, value: null }),
        create,
    };
}

test('keeps manual location available when provider fails and submits the label', async () => {
    const create = jest.fn(async () => ({ ok: true as const, value: {
        id: 'incident-1', version: 1, status: 'open' as const, incident: null,
    } }));
    const locationResolver = {
        resolve: jest.fn(async (_query: string, manualLabel: string): Promise<IncidentLocation> => ({
            source: 'manual', label: manualLabel,
        })),
    };
    const onCreated = jest.fn();
    const view = await render(
        <IncidentCreationScreen
            repository={repositoryWithCreate(create)}
            locationResolver={locationResolver}
            onCreated={onCreated}
            onBack={jest.fn()}
        />,
    );

    await fireEvent.changeText(view.getByPlaceholderText('Describe el problema'), 'Fuga ficticia en pasillo');
    await fireEvent.changeText(view.getByPlaceholderText('Buscar edificio o zona'), 'Edificio norte');
    await fireEvent.changeText(view.getByPlaceholderText('Edificio, zona o referencia manual'), 'Edificio norte, planta 2');
    await fireEvent.press(view.getByText('Buscar ubicación'));
    expect(await view.findByText('Manual: Edificio norte, planta 2')).toBeTruthy();
    await fireEvent.press(view.getByText('Enviar incidencia'));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith(
        { category: 'maintenance', description: 'Fuga ficticia en pasillo', location: 'Edificio norte, planta 2' },
        expect.stringMatching(/^incident-create-/),
    );
});

test('reuses the same operation identity when a creation response is lost and retried', async () => {
    const create = jest.fn()
        .mockResolvedValueOnce({ ok: false as const, reason: { kind: 'timeout' as const } })
        .mockResolvedValueOnce({ ok: true as const, value: {
            id: 'incident-1', version: 1, status: 'open' as const, incident: null,
        } });
    const view = await render(
        <IncidentCreationScreen
            repository={repositoryWithCreate(create)}
            locationResolver={{ resolve: async () => ({ source: 'manual', label: 'Zona ficticia' }) }}
            onCreated={jest.fn()}
            onBack={jest.fn()}
        />,
    );

    await fireEvent.changeText(view.getByPlaceholderText('Describe el problema'), 'Fuga ficticia');
    await fireEvent.changeText(view.getByPlaceholderText('Edificio, zona o referencia manual'), 'Zona ficticia');
    await fireEvent.press(view.getByText('Buscar ubicación'));
    await waitFor(() => expect(view.getByTestId('selected-location')).toBeTruthy());
    await fireEvent.press(view.getByText('Enviar incidencia'));
    await waitFor(() => expect(view.getByText(/No se pudo confirmar/)).toBeTruthy());
    await fireEvent.press(view.getByText('Enviar incidencia'));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1]?.[1]).toBe(create.mock.calls[0]?.[1]);
    expect(create.mock.calls[1]?.[0]).toEqual(create.mock.calls[0]?.[0]);
});
