import { useMemo, useState } from 'react';
import { Button, StyleSheet, Text, TextInput, View } from 'react-native';

import type { FetchResult } from '../../../course-evaluation/contracts';
import type { IncidentLocation } from '../../../campusops/contracts';
import { createIncident } from '../application/createIncident';
import type { IncidentRepository } from '../domain/incidentRepository';

type LocationResolver = Readonly<{
    resolve(query: string, manualLabel: string): Promise<IncidentLocation>;
}>;

type Props = Readonly<{
    repository: IncidentRepository;
    locationResolver: LocationResolver;
    onCreated: () => void;
    onBack: () => void;
}>;

let operationSequence = 0;

export function IncidentCreationScreen({ repository, locationResolver, onCreated, onBack }: Props) {
    const [description, setDescription] = useState('');
    const [locationQuery, setLocationQuery] = useState('');
    const [manualLabel, setManualLabel] = useState('');
    const [selectedLocation, setSelectedLocation] = useState<IncidentLocation | null>(null);
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const [pendingOperation, setPendingOperation] = useState<Readonly<{ key: string; fingerprint: string }> | null>(null);

    const canSubmit = useMemo(
        () => description.trim().length > 0 && (selectedLocation?.label.trim().length ?? 0) > 0,
        [description, selectedLocation],
    );

    async function findLocation(): Promise<void> {
        setBusy(true);
        setMessage('Buscando ubicación…');
        try {
            const location = await locationResolver.resolve(locationQuery, manualLabel);
            setSelectedLocation(location);
            setMessage(location.source === 'provider'
                ? `Ubicación encontrada: ${location.label}`
                : location.label
                    ? `Proveedor no disponible. Se usará la ubicación manual: ${location.label}`
                    : 'Proveedor no disponible. Escribe edificio, zona o referencia.');
        } catch {
            setSelectedLocation(null);
            setMessage('No se pudo resolver la ubicación. Escribe edificio, zona o referencia.');
        } finally {
            setBusy(false);
        }
    }

    async function submitIncident(): Promise<void> {
        if (!canSubmit || !selectedLocation) return;
        const input = {
            category: 'maintenance' as const,
            description: description.trim(),
            location: selectedLocation.label.trim(),
        };
        const fingerprint = JSON.stringify(input);
        const operation = pendingOperation?.fingerprint === fingerprint
            ? pendingOperation
            : {
                key: `incident-create-${Date.now()}-${++operationSequence}`,
                fingerprint,
            };

        setBusy(true);
        setMessage('Enviando reporte…');
        setPendingOperation(operation);
        try {
            const result: FetchResult<unknown> = await createIncident(repository, input, operation.key);
            if (!result.ok) {
                setMessage('No se pudo confirmar el reporte. Puedes reintentar con la misma operación.');
                return;
            }
            setPendingOperation(null);
            setMessage('Incidencia reportada.');
            onCreated();
        } catch {
            setMessage('No se pudo confirmar el reporte. Puedes reintentar con la misma operación.');
        } finally {
            setBusy(false);
        }
    }

    function updateDescription(value: string): void {
        setDescription(value);
        setPendingOperation(null);
    }

    function updateManualLabel(value: string): void {
        setManualLabel(value);
        setSelectedLocation(null);
        setPendingOperation(null);
    }

    return (
        <View style={styles.screen}>
            <Text style={styles.title}>Reportar incidencia</Text>
            <TextInput
                accessibilityLabel="Descripción de la incidencia"
                placeholder="Describe el problema"
                value={description}
                onChangeText={updateDescription}
                multiline
                style={styles.input}
            />
            <TextInput
                accessibilityLabel="Buscar ubicación"
                placeholder="Buscar edificio o zona"
                value={locationQuery}
                onChangeText={(value) => {
                    setLocationQuery(value);
                    setSelectedLocation(null);
                    setPendingOperation(null);
                }}
                style={styles.input}
            />
            <TextInput
                accessibilityLabel="Ubicación manual"
                placeholder="Edificio, zona o referencia manual"
                value={manualLabel}
                onChangeText={updateManualLabel}
                style={styles.input}
            />
            <Button title="Buscar ubicación" disabled={busy} onPress={() => void findLocation()} />
            {selectedLocation ? (
                <Text testID="selected-location">
                    {selectedLocation.source === 'provider' ? 'Proveedor' : 'Manual'}: {selectedLocation.label}
                </Text>
            ) : null}
            {message ? <Text accessibilityLiveRegion="polite" testID="creation-message">{message}</Text> : null}
            <Button title="Enviar incidencia" disabled={busy || !canSubmit} onPress={() => void submitIncident()} />
            <Button title="Volver" disabled={busy} onPress={onBack} />
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, padding: 20, gap: 12 },
    title: { fontSize: 22, fontWeight: '700' },
    input: { borderColor: '#777', borderWidth: 1, borderRadius: 8, minHeight: 44, padding: 10 },
});
