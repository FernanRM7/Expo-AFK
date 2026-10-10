export type SessionLifecycleState =
  | 'unauthenticated'
  | 'authenticating'
  | 'authenticated'
  | 'expired'
  | 'refreshing';

export type SessionLifecycleEvent =
  | 'login-started'
  | 'login-succeeded'
  | 'login-failed'
  | 'access-token-expired'
  | 'refresh-started'
  | 'refresh-succeeded'
  | 'refresh-failed'
  | 'logout';

type SessionLifecycleListener = (state: SessionLifecycleState) => void;

const transitions: Readonly<Record<
  SessionLifecycleState,
  Partial<Record<SessionLifecycleEvent, SessionLifecycleState>>
>> = {
  unauthenticated: { 'login-started': 'authenticating' },
  authenticating: {
    'login-succeeded': 'authenticated',
    'login-failed': 'unauthenticated',
    logout: 'unauthenticated',
  },
  authenticated: {
    'login-started': 'authenticating',
    'access-token-expired': 'expired',
    'refresh-failed': 'unauthenticated',
    logout: 'unauthenticated',
  },
  expired: {
    'refresh-started': 'refreshing',
    'refresh-failed': 'unauthenticated',
    logout: 'unauthenticated',
  },
  refreshing: {
    'refresh-succeeded': 'authenticated',
    'refresh-failed': 'unauthenticated',
    logout: 'unauthenticated',
  },
};

let lifecycleState: SessionLifecycleState = 'unauthenticated';
const listeners = new Set<SessionLifecycleListener>();

export function reduceSessionLifecycle(
  state: SessionLifecycleState,
  event: SessionLifecycleEvent,
): SessionLifecycleState {
  return transitions[state][event] ?? state;
}

export function getSessionLifecycleState(): SessionLifecycleState {
  return lifecycleState;
}

export function subscribeToSessionLifecycle(listener: SessionLifecycleListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function transitionSessionLifecycle(event: SessionLifecycleEvent): SessionLifecycleState {
  lifecycleState = reduceSessionLifecycle(lifecycleState, event);
  for (const listener of listeners) listener(lifecycleState);
  return lifecycleState;
}