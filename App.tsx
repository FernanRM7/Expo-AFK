import { useEffect, useMemo, useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { getBackendHealth } from './src/api/courseBackend';
import { createLocationResolver } from './src/features/location/application/resolveIncidentLocation';
import { createHttpLocationProvider } from './src/features/location/infrastructure/httpLocationProvider';
import { createOfflineWorkSyncService } from './src/features/incidents/application/offlineWorkSyncService';
import { RemoteIncidentRepository } from './src/features/incidents/infrastructure/remoteIncidentRepository';
import { IncidentCreationScreen } from './src/features/incidents/ui/IncidentCreationScreen';
import { getSQLitePendingWorkQueue } from './src/features/incidents/infrastructure/sqlitePendingWorkQueue';
import { OfflineWorkQueueScreen } from './src/features/incidents/ui/OfflineWorkQueueScreen';
import type { CourseActorId } from './src/features/incidents/infrastructure/remoteIncidentRepository';
import {
  getSessionLifecycleState,
  subscribeToSessionLifecycle,
} from './src/features/session/application/sessionLifecycle';
import type { SessionLifecycleState } from './src/features/session/application/sessionLifecycle';
import { sessionService } from './src/features/session/application/sessionService';

export default function App() {
  const [status, setStatus] = useState<'checking' | 'available' | 'offline'>('checking');
  const [sessionState, setSessionState] = useState<SessionLifecycleState>(getSessionLifecycleState);
  const [sessionMessage, setSessionMessage] = useState('');
  const [actorId, setActorId] = useState<CourseActorId | null>(null);
  const [showOfflineWork, setShowOfflineWork] = useState(false);
  const [showIncidentCreation, setShowIncidentCreation] = useState(false);
  const incidentRepository = useMemo(
    () => new RemoteIncidentRepository({ actorId: actorId ?? 'technician-1' }),
    [actorId],
  );
  const offlineWorkService = useMemo(
    () => createOfflineWorkSyncService({
      actorId: actorId ?? 'technician-1',
      queue: getSQLitePendingWorkQueue,
      gateway: incidentRepository,
    }),
    [actorId, incidentRepository],
  );
  const locationResolver = useMemo(() => createLocationResolver({
    proveedor: {
      async resolve(consulta) {
        const access = await sessionService.getAccessToken();
        if (!access.ok) return { disponible: false, motivo: 'respuesta-invalida' as const };
        return createHttpLocationProvider({
          headers: {
            Authorization: `Bearer ${access.value}`,
            'X-Course-Actor': actorId ?? 'reporter-1',
          },
        }).resolve(consulta);
      },
    },
  }), [actorId]);

  useEffect(() => {
    let active = true;
    getBackendHealth()
      .then(() => active && setStatus('available'))
      .catch(() => active && setStatus('offline'));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => subscribeToSessionLifecycle(setSessionState), []);

  async function login(nextActorId: CourseActorId): Promise<void> {
    setSessionMessage('');
    const result = await sessionService.login(nextActorId);
    if (result.ok) setActorId(nextActorId);
    setSessionMessage(result.ok ? 'Sesión iniciada.' : 'No se pudo iniciar sesión.');
  }

  async function logout(): Promise<void> {
    const result = await sessionService.logout();
    if (result.ok) {
      setActorId(null);
      setShowOfflineWork(false);
    }
    setSessionMessage(result.ok ? 'Sesión cerrada.' : 'No se pudo limpiar la sesión.');
  }

  async function refresh(): Promise<void> {
    setSessionMessage('');
    const result = await sessionService.refresh();
    setSessionMessage(result.ok ? 'Sesión renovada.' : 'La sesión expiró. Inicia sesión de nuevo.');
  }

  if (showOfflineWork && actorId?.startsWith('technician-')) {
    return (
      <View style={styles.screen}>
        <OfflineWorkQueueScreen
          repository={incidentRepository}
          service={offlineWorkService}
          onBack={() => setShowOfflineWork(false)}
        />
        <StatusBar style="auto" />
      </View>
    );
  }

  if (showIncidentCreation && actorId?.startsWith('reporter-')) {
    return (
      <View style={styles.screen}>
        <IncidentCreationScreen
          repository={incidentRepository}
          locationResolver={locationResolver}
          onCreated={() => setShowIncidentCreation(false)}
          onBack={() => setShowIncidentCreation(false)}
        />
        <StatusBar style="auto" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View accessibilityRole="summary" style={styles.card}>
        <Text style={styles.title}>CampusOps</Text>
        <Text>Incidencias del campus · entorno académico ficticio</Text>
        <Text testID="backend-status">Backend: {status}</Text>
        <Text testID="session-state">Sesión: {sessionState}</Text>
        {sessionState === 'authenticated' || sessionState === 'refreshing' ? (
          <>
            <Button title="Renovar sesión" onPress={() => void refresh()} />
            <Button title="Cerrar sesión" onPress={() => void logout()} />
          </>
        ) : (
          <>
            <Button
              testID="login-button"
              title={sessionState === 'authenticating' ? 'Iniciando sesión...' : 'Iniciar sesión como reportante'}
              disabled={sessionState === 'authenticating'}
              onPress={() => void login('reporter-1')}
            />
            <Button
              testID="technician-login-button"
              title="Iniciar sesión como técnico"
              disabled={sessionState === 'authenticating'}
              onPress={() => void login('technician-1')}
            />
          </>
        )}
        {sessionState === 'authenticated' && actorId?.startsWith('technician-') ? (
          <Button title="Trabajo sin conexión" onPress={() => setShowOfflineWork(true)} />
        ) : null}
        {sessionState === 'authenticated' && actorId?.startsWith('reporter-') ? (
          <Button title="Reportar incidencia" onPress={() => setShowIncidentCreation(true)} />
        ) : null}
        {sessionMessage ? <Text testID="session-message">{sessionMessage}</Text> : null}
      </View>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: 24 },
  card: { gap: 12, padding: 20 },
  title: { fontSize: 24, fontWeight: '700' },
});
