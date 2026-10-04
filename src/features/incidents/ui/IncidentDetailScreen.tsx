import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { IncidentRepository, IncidentSnapshot } from '../domain/incidentRepository';
import { getIncidentDetail } from '../application/getIncidentDetail';

type Props = Readonly<{
    repository: IncidentRepository;
    incidentId: string;
}>;

export function IncidentDetailScreen({ repository, incidentId }: Props) {
    const [result, setResult] = useState<
        { ok: true; value: IncidentSnapshot | null } | { ok: false; reason: unknown } | undefined
    >(undefined);

    useEffect(() => {
        let active = true;
        getIncidentDetail(repository, incidentId).then((result) => {
            if (active) setResult(result);
        });
        return () => {
            active = false;
        };
    }, [repository, incidentId]);

    if (result === undefined) {
        return (
            <View style={styles.screen}>
                <Text>Cargando…</Text>
            </View>
        );
    }

    if (!result.ok) {
        return (
            <View style={styles.screen}>
                <Text testID="incident-detail-error">No se pudo cargar la incidencia.</Text>
            </View>
        );
    }

    if (result.value === null) {
        return (
            <View style={styles.screen}>
                <Text testID="incident-not-found">Incidencia no encontrada</Text>
            </View>
        );
    }

    const incident = result.value.incident;
    if (incident === null) {
        return (
            <View style={styles.screen}>
                <Text testID="incident-detail-empty">Detalles no disponibles</Text>
                <Text testID="incident-detail-status">Estado: {result.value.status}</Text>
            </View>
        );
    }

    return (
        <View style={styles.screen}>
            {incident.title && <Text style={styles.title}>{incident.title}</Text>}
            <Text testID="incident-detail-status">Estado: {incident.status}</Text>
            <Text testID="incident-detail-category">Categoría: {incident.category}</Text>
            <Text>{incident.description}</Text>
            <Text>Ubicación: {incident.location.label}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, padding: 16, gap: 8 },
    title: { fontSize: 20, fontWeight: '700' },
});
