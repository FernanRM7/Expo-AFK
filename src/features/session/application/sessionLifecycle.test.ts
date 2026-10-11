import {
  reduceSessionLifecycle,
  type SessionLifecycleEvent,
  type SessionLifecycleState,
} from './sessionLifecycle';

function run(initial: SessionLifecycleState, events: readonly SessionLifecycleEvent[]): SessionLifecycleState[] {
  const states: SessionLifecycleState[] = [];
  let state = initial;
  for (const event of events) {
    state = reduceSessionLifecycle(state, event);
    states.push(state);
  }
  return states;
}

test('models login, valid session, expiration, refresh, and logout', () => {
  expect(run('unauthenticated', [
    'login-started',
    'login-succeeded',
    'access-token-expired',
    'refresh-started',
    'refresh-succeeded',
    'logout',
  ])).toEqual([
    'authenticating',
    'authenticated',
    'expired',
    'refreshing',
    'authenticated',
    'unauthenticated',
  ]);
});

test('failed login and failed refresh return to unauthenticated', () => {
  expect(run('unauthenticated', ['login-started', 'login-failed'])).toEqual([
    'authenticating',
    'unauthenticated',
  ]);
  expect(run('authenticated', ['access-token-expired', 'refresh-started', 'refresh-failed'])).toEqual([
    'expired',
    'refreshing',
    'unauthenticated',
  ]);
});

test('ignores transitions that are not valid from the current state', () => {
  expect(reduceSessionLifecycle('unauthenticated', 'refresh-succeeded')).toBe('unauthenticated');
});