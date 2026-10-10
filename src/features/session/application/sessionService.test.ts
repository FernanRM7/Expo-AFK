import { configureTelemetrySink } from '../../../telemetry/safeTelemetry';
import { getSessionLifecycleState, transitionSessionLifecycle } from './sessionLifecycle';
import { createSessionService } from './sessionService';
import type { SessionTokenStore, SessionTokens } from '../infrastructure/secureSessionStorage';

function httpResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function memoryStore(initial: SessionTokens | null = null) {
  let stored = initial;
  const store: SessionTokenStore = {
    readSessionTokens: async () => stored,
    saveSessionTokens: async (tokens) => { stored = tokens; },
    deleteSessionTokens: async () => { stored = null; },
  };
  return { store, read: () => stored };
}

beforeEach(() => {
  transitionSessionLifecycle('logout');
  configureTelemetrySink(null);
});

afterEach(() => {
  transitionSessionLifecycle('logout');
  configureTelemetrySink(null);
  jest.restoreAllMocks();
});

test('login stores both tokens securely but returns only non-secret identity', async () => {
  const tokens = { accessToken: 'synthetic-access-secret', refreshToken: 'synthetic-refresh-secret' };
  const storage = memoryStore();
  const fetchImpl = jest.fn<Promise<Response>, Parameters<typeof fetch>>().mockResolvedValue(httpResponse({
    actorId: 'reporter-1',
    role: 'reporter',
    ...tokens,
    expiresIn: 60,
  }));
  const service = createSessionService({
    baseUrl: 'http://127.0.0.1:4310',
    fetchImpl: fetchImpl as typeof fetch,
    tokenStore: storage.store,
  });

  await expect(service.login('reporter-1')).resolves.toEqual({
    ok: true,
    value: { actorId: 'reporter-1', role: 'reporter', expiresIn: 60 },
  });

  expect(storage.read()).toEqual(tokens);
  expect(getSessionLifecycleState()).toBe('authenticated');
  expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:4310/v1/session/login', expect.objectContaining({
    method: 'POST',
    body: JSON.stringify({ actorId: 'reporter-1' }),
  }));
});

test('rejected login stores no tokens and returns to unauthenticated', async () => {
  const storage = memoryStore();
  const telemetry = jest.fn();
  configureTelemetrySink(telemetry);
  const fetchImpl = jest.fn<Promise<Response>, Parameters<typeof fetch>>().mockResolvedValue(
    httpResponse({ accessToken: 'synthetic-secret-not-logged' }, 401),
  );
  const service = createSessionService({ fetchImpl: fetchImpl as typeof fetch, tokenStore: storage.store });

  await expect(service.login('reporter-1')).resolves.toEqual({
    ok: false,
    reason: { kind: 'server-error', status: 401 },
  });

  expect(storage.read()).toBeNull();
  expect(getSessionLifecycleState()).toBe('unauthenticated');
  expect(JSON.stringify(telemetry.mock.calls)).not.toContain('synthetic-secret-not-logged');
});

test('logout deletes the persisted token pair and transitions to unauthenticated', async () => {
  const storage = memoryStore({
    accessToken: 'synthetic-access-secret',
    refreshToken: 'synthetic-refresh-secret',
  });
  transitionSessionLifecycle('login-started');
  transitionSessionLifecycle('login-succeeded');
  const service = createSessionService({ tokenStore: storage.store });

  await expect(service.logout()).resolves.toEqual({ ok: true, value: null });

  expect(storage.read()).toBeNull();
  expect(getSessionLifecycleState()).toBe('unauthenticated');
});

test('a successful refresh replaces the stored pair and returns to authenticated', async () => {
  const storage = memoryStore({
    accessToken: 'synthetic-expired-access',
    refreshToken: 'synthetic-refresh',
  });
  transitionSessionLifecycle('login-started');
  transitionSessionLifecycle('login-succeeded');
  const fetchImpl = jest.fn<Promise<Response>, Parameters<typeof fetch>>().mockResolvedValue(httpResponse({
    accessToken: 'synthetic-new-access',
    refreshToken: 'synthetic-new-refresh',
    expiresIn: 60,
  }));
  const service = createSessionService({ fetchImpl: fetchImpl as typeof fetch, tokenStore: storage.store });

  await expect(service.refresh()).resolves.toEqual({ ok: true, value: null });

  expect(storage.read()).toEqual({
    accessToken: 'synthetic-new-access',
    refreshToken: 'synthetic-new-refresh',
  });
  expect(getSessionLifecycleState()).toBe('authenticated');
  expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('/v1/session/refresh'), expect.objectContaining({
    body: JSON.stringify({ refreshToken: 'synthetic-refresh' }),
  }));
});

test('a failed refresh removes the stored pair and returns to unauthenticated', async () => {
  const storage = memoryStore({
    accessToken: 'synthetic-expired-access',
    refreshToken: 'synthetic-revoked-refresh',
  });
  transitionSessionLifecycle('login-started');
  transitionSessionLifecycle('login-succeeded');
  const telemetry = jest.fn();
  configureTelemetrySink(telemetry);
  const fetchImpl = jest.fn<Promise<Response>, Parameters<typeof fetch>>().mockResolvedValue(
    httpResponse({ code: 'invalid_grant', token: 'synthetic-secret-response' }, 401),
  );
  const service = createSessionService({ fetchImpl: fetchImpl as typeof fetch, tokenStore: storage.store });

  await expect(service.refresh()).resolves.toEqual({
    ok: false,
    reason: { kind: 'session-expired' },
  });

  expect(storage.read()).toBeNull();
  expect(getSessionLifecycleState()).toBe('unauthenticated');
  expect(JSON.stringify(telemetry.mock.calls)).not.toContain('synthetic-');
});

test('concurrent refresh requests share one endpoint call', async () => {
  const storage = memoryStore({
    accessToken: 'synthetic-expired-access',
    refreshToken: 'synthetic-refresh',
  });
  transitionSessionLifecycle('login-started');
  transitionSessionLifecycle('login-succeeded');
  let releaseResponse!: (response: Response) => void;
  let markFetchStarted!: () => void;
  const delayedResponse = new Promise<Response>((resolve) => { releaseResponse = resolve; });
  const fetchStarted = new Promise<void>((resolve) => { markFetchStarted = resolve; });
  const fetchImpl = jest.fn<Promise<Response>, Parameters<typeof fetch>>().mockImplementation(() => {
    markFetchStarted();
    return delayedResponse;
  });
  const service = createSessionService({ fetchImpl: fetchImpl as typeof fetch, tokenStore: storage.store });

  const first = service.refresh();
  const second = service.refresh();
  await fetchStarted;
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  releaseResponse(httpResponse({
    accessToken: 'synthetic-new-access',
    refreshToken: 'synthetic-new-refresh',
    expiresIn: 60,
  }));

  await expect(Promise.all([first, second])).resolves.toEqual([
    { ok: true, value: null },
    { ok: true, value: null },
  ]);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});