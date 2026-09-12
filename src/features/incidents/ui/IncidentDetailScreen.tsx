import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { Incident } from '../domain/incident';
import type { IncidentRepository } from '../domain/incidentRepository';
import { getIncidentDetail } from '../application/getIncidentDetail';

type Props = Readonly<{
    repository: IncidentRepository;
    incidentId: string;
}>;

export function IncidentDetailScreen({ repository, incidentId }: Props) {
    const [incident, setIncident] = useState<Incident | null | undefined>(undefined);

    useEffect(() => {
        let active = true;
        getIncidentDetail(repository, incidentId).then((result) => {
            if (active) setIncident(result);
        });
        return () => {
            active = false;
        };
    }, [repository, incidentId]);

    if (incident === undefined) {
        return (
            <View style={styles.screen}>
                <Text>Cargando…</Text>
            </View>
        );
    }

    if (incident === null) {
        return (
            <View style={styles.screen}>
                <Text testID="incident-not-found">Incidencia no encontrada</Text>
            </View>
        );
    }

    return (
        <View style={styles.screen}>
            <Text style={styles.title}>{incident.title}</Text>
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