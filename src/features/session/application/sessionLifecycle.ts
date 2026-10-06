export type SessionLifecycleState = 'active' | 'expired';

type SessionLifecycleListener = (state: SessionLifecycleState) => void;

let lifecycleState: SessionLifecycleState = 'active';
const listeners = new Set<SessionLifecycleListener>();

export function getSessionLifecycleState(): SessionLifecycleState {
  return lifecycleState;
}

export function subscribeToSessionLifecycle(listener: SessionLifecycleListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setSessionLifecycleState(state: SessionLifecycleState): void {
  lifecycleState = state;
  for (const listener of listeners) listener(state);
}