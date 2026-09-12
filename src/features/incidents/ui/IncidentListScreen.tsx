import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Incident } from '../domain/incident';
import type { IncidentRepository } from '../domain/incidentRepository';
import { listIncidents } from '../application/listIncidents';

type Props = Readonly<{
    repository: IncidentRepository;
    onSelectIncident: (incidentId: string) => void;
}>;

export function IncidentListScreen({ repository, onSelectIncident }: Props) {
    const [incidents, setIncidents] = useState<readonly Incident[]>([]);

    useEffect(() => {
        let active = true;
        listIncidents(repository).then((result) => {
            if (active) setIncidents(result);
        });
        return () => {
            active = false;
        };
    }, [repository]);

    return (
        <View style={styles.screen}>
            <Text style={styles.title}>Incidencias</Text>
            <FlatList
                data={incidents}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                    <Pressable
                        testID={`incident-row-${item.id}`}
                        style={styles.row}
                        onPress={() => onSelectIncident(item.id)}
                    >
                        <Text style={styles.rowTitle}>{item.title}</Text>
                        <Text testID={`incident-status-${item.id}`}>{item.status}</Text>
                    </Pressable>
                )}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, padding: 16 },
    title: { fontSize: 20, fontWeight: '700', marginBottom: 12 },
    row: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#ddd' },
    rowTitle: { fontSize: 16, fontWeight: '600' },
});