import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { OfflineWorkGateway, OfflineWorkSyncService } from '../application/offlineWorkSyncService';
import type { PendingWorkEntry } from '../domain/pendingWorkQueue';
import type { IncidentRepository, IncidentSnapshot } from '../domain/incidentRepository';

type Props = Readonly<{
  repository: IncidentRepository & OfflineWorkGateway;
  service: OfflineWorkSyncService;
  onBack: () => void;
}>;

export function OfflineWorkQueueScreen({ repository, service, onBack }: Props) {
  const [incidents, setIncidents] = useState<readonly IncidentSnapshot[]>([]);
  const [pending, setPending] = useState<readonly PendingWorkEntry[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [listed, queued] = await Promise.all([repository.list(), service.listPending()]);
      if (listed.ok) setIncidents([...listed.value]);
      else setMessage('No se pudieron cargar incidencias. Las operaciones guardadas localmente siguen disponibles.');
      setPending(queued);
    } catch {
      setMessage('No se pudo abrir el almacenamiento local o cargar la información. Intenta de nuevo.');
    }
  }, [repository, service]);

  useEffect(() => {
    let active = true;
    Promise.all([repository.list(), service.listPending()])
      .then(([listed, queued]) => {
        if (!active) return;
        if (listed.ok) setIncidents([...listed.value]);
        else setMessage('No se pudieron cargar incidencias. Las operaciones guardadas localmente siguen disponibles.');
        setPending(queued);
      })
      .catch(() => {
        if (active) setMessage('No se pudo abrir el almacenamiento local o cargar la información. Intenta de nuevo.');
      });
    return () => {
      active = false;
    };
  }, [repository, service]);

  async function queueStart(snapshot: IncidentSnapshot): Promise<void> {
    setBusy(true);
    setMessage('');
    try {
      const queued = await service.queueStart(snapshot);
      setMessage(queued.ok
        ? 'Inicio guardado sin conexión; permanece pendiente hasta confirmarlo con el servidor.'
        : 'No se pudo guardar el inicio. Verifica la asignación y la versión de la incidencia.');
      await refresh();
    } catch {
      setMessage('No se pudo guardar el inicio en la cola local.');
    } finally {
      setBusy(false);
    }
  }

  async function synchronize(): Promise<void> {
    setBusy(true);
    setMessage('');
    try {
      const results = await service.synchronize();
      setMessage(results.some((result) => result.status === 'needs-review')
        ? 'Se detectó un conflicto de sincronización. La operación local se conservó para revisión.'
        : 'Sincronización terminada; las acciones pendientes no confirmadas siguen en cola.');
      await refresh();
    } catch {
      setMessage('No se pudo completar la sincronización; las operaciones locales se conservan.');
    } finally {
      setBusy(false);
    }
  }

  async function retry(operationId: string): Promise<void> {
    setBusy(true);
    try {
      const result = await service.retry(operationId);
      setMessage(result.message);
      await refresh();
    } catch {
      setMessage('No se pudo reintentar. La intención local permanece pendiente.');
    } finally {
      setBusy(false);
    }
  }

  async function discard(operationId: string): Promise<void> {
    setBusy(true);
    try {
      await service.discard(operationId);
      setMessage('Intención local descartada tras tu confirmación; la asignación remota no se modificó.');
      await refresh();
    } catch {
      setMessage('No se pudo descartar la operación; sigue conservada en la cola.');
    } finally {
      setBusy(false);
    }
  }

  function confirmDiscard(operationId: string): void {
    Alert.alert(
      'Descartar intención local',
      'La asignación remota se conservará. ¿Quieres eliminar esta operación pendiente?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Descartar', style: 'destructive', onPress: () => void discard(operationId) },
      ],
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.title}>Trabajo sin conexión</Text>
      <Text>Los inicios se guardan localmente y no cambian el estado remoto hasta que el servidor los confirme.</Text>
      <Button title="Volver" onPress={onBack} />
      <Button title="Sincronizar pendientes" disabled={busy} onPress={() => void synchronize()} />
      {message ? <Text accessibilityRole="alert" testID="offline-work-message">{message}</Text> : null}

      <Text style={styles.heading}>Incidencias asignadas</Text>
      {incidents.map((item) => (
        <View key={item.id} style={styles.card}>
          <Text style={styles.emphasis}>{item.incident?.title ?? item.id}</Text>
          <Text>Asignado a: {item.incident?.assignedTechnicianId ?? 'sin asignar'}</Text>
          <Text>Estado: {item.status} · versión {item.version ?? 'local'}</Text>
          {item.status === 'assigned' ? (
            <Button
              title="Guardar inicio offline"
              disabled={busy}
              onPress={() => void queueStart(item)}
            />
          ) : null}
        </View>
      ))}

      <Text style={styles.heading}>Cola local</Text>
      {pending.length === 0 ? <Text>No hay operaciones pendientes.</Text> : null}
      {pending.map((entry) => (
        <View key={entry.operation.operationId} style={styles.card} testID={`queued-operation-${entry.operation.operationId}`}>
          <Text style={styles.emphasis}>
            {entry.state === 'needs-review' ? 'Conflicto de sincronización' : 'Inicio pendiente'}
          </Text>
          <Text>Incidencia: {entry.operation.incidentId}</Text>
          <Text>Operación: {entry.operation.operationId}</Text>
          <Text testID={`conflict-operation-author-${entry.operation.operationId}`}>
            Autor: {entry.operation.actorId}
          </Text>
          <Text testID={`conflict-operation-base-version-${entry.operation.operationId}`}>
            Versión base: {entry.operation.baseVersion}
          </Text>
          <Text testID={`conflict-remote-assignee-${entry.operation.operationId}`}>
            Asignación vigente del servidor:{' '}
            {entry.conflictRemote
              ? entry.conflictRemote.incident?.assignedTechnicianId ?? 'sin asignar'
              : 'no disponible; requiere revisión con el servidor'}
          </Text>
          {entry.conflictMessage ? <Text>{entry.conflictMessage}</Text> : null}
          {entry.state === 'needs-review' ? (
            <>
              <Button
                testID={`retry-operation-${entry.operation.operationId}`}
                title="Reintentar tras revisar"
                disabled={busy}
                onPress={() => void retry(entry.operation.operationId)}
              />
              <Button
                testID={`discard-operation-${entry.operation.operationId}`}
                title="Descartar intención local"
                disabled={busy}
                onPress={() => confirmDiscard(entry.operation.operationId)}
              />
            </>
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '700' },
  heading: { marginTop: 8, fontSize: 18, fontWeight: '600' },
  card: { padding: 12, gap: 6, borderWidth: 1, borderColor: '#8a8a8a', borderRadius: 8 },
  emphasis: { fontWeight: '700' },
});
