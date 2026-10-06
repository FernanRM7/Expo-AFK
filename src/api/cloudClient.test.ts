import { fetchJson, fetchJsonWithSessionRefresh } from './cloudClient';
import { configureTelemetrySink } from '../telemetry/safeTelemetry';
import {
    getSessionLifecycleState,
    setSessionLifecycleState,
    subscribeToSessionLifecycle,
} from '../features/session/application/sessionLifecycle';

type Incidente = Readonly<{ id: string; status: string }>;

function esIncidenteValido(payload: unknown): payload is Incidente {
    return (
        typeof payload === 'object' &&
        payload !== null &&
        typeof (payload as Record<string, unknown>).id === 'string' &&
        typeof (payload as Record<string, unknown>).status === 'string'
    );
}

afterEach(() => {
    configureTelemetrySink(null);
    setSessionLifecycleState('active');
    jest.restoreAllMocks();
});

function response(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    } as Response;
}

function isSuccessfulPayload(payload: unknown): payload is { ok: true } {
    return typeof payload === 'object' && payload !== null && 'ok' in payload && payload.ok === true;
}

test('contract-invalid: una respuesta malformada se distingue sin exponer el payload crudo', async () => {
    const envioTelemetria = jest.fn();
    configureTelemetrySink(envioTelemetria);
    jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ campoInesperado: 'dato-sintetico-sensible' }),
    } as Response);

    const resultado = await fetchJson('http://127.0.0.1:4310/v1/incidents/campus-inc-001', esIncidenteValido);

    expect(resultado).toEqual({ ok: false, reason: { kind: 'contract-invalid' } });
    const serializado = JSON.stringify(envioTelemetria.mock.calls);
    expect(serializado).not.toContain('dato-sintetico-sensible');
});

test('timeout: una respuesta lenta se distingue como timeout', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(
        (_url, options) =>
            new Promise((_resolve, reject) => {
                const signal = (options as RequestInit)?.signal;
                signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
            }),
    );

    const resultado = await fetchJson(
        'http://127.0.0.1:4310/v1/incidents/campus-inc-001',
        esIncidenteValido,
        50,
    );

    expect(resultado).toEqual({ ok: false, reason: { kind: 'timeout' } });
});

test('server-error: un HTTP 500 con payload sensible se distingue sin exponerlo', async () => {
    const envioTelemetria = jest.fn();
    configureTelemetrySink(envioTelemetria);
    jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ token: 'token-sintetico-secreto', comentario: 'comentario-sintetico-secreto' }),
    } as Response);

    const resultado = await fetchJson('http://127.0.0.1:4310/v1/incidents/campus-inc-001', esIncidenteValido);

    expect(resultado).toEqual({ ok: false, reason: { kind: 'server-error', status: 500 } });
    const serializado = JSON.stringify(envioTelemetria.mock.calls);
    expect(serializado).not.toContain('token-sintetico-secreto');
    expect(serializado).not.toContain('comentario-sintetico-secreto');
});

test('coalesces three concurrent 401s into one refresh and retries with the saved access token', async () => {
    let releaseRefresh!: (value: Response) => void;
    let markRefreshStarted!: () => void;
    let releaseInitial401s!: () => void;
    let markInitialRequestsSent!: () => void;
    const refreshStarted = new Promise<void>((resolve) => { markRefreshStarted = resolve; });
    const allInitialRequestsSent = new Promise<void>((resolve) => { markInitialRequestsSent = resolve; });
    const initial401Gate = new Promise<void>((resolve) => { releaseInitial401s = resolve; });
    const refreshResponse = new Promise<Response>((resolve) => { releaseRefresh = resolve; });
    const tokens = { accessToken: 'synthetic-old-access', refreshToken: 'synthetic-refresh' };
    const tokenStore = {
        readSessionTokens: jest.fn().mockResolvedValue(tokens),
        saveSessionTokens: jest.fn().mockResolvedValue(undefined),
        deleteSessionTokens: jest.fn().mockResolvedValue(undefined),
    };
    let refreshCalls = 0;
    let initial401Count = 0;
    const retryAuthorization: string[] = [];
    const fetchImpl = jest.fn<Promise<Response>, Parameters<typeof fetch>>()
        .mockImplementation(async (input, init) => {
            if (String(input).endsWith('/v1/session/refresh')) {
                refreshCalls += 1;
                markRefreshStarted();
                return refreshResponse;
            }
            const authorization = new Headers(init?.headers).get('Authorization');
            if (authorization === `Bearer ${tokens.accessToken}`) {
                initial401Count += 1;
                if (initial401Count === 3) markInitialRequestsSent();
                await initial401Gate;
                return response({ unauthorized: true }, 401);
            }
            retryAuthorization.push(authorization ?? '');
            return response({ ok: true });
        });
    const refreshLog = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const request = (id: string) => fetchJsonWithSessionRefresh(
        `http://127.0.0.1:4310/v1/incidents/${id}`,
        isSuccessfulPayload,
        1000,
        { headers: { Authorization: `Bearer ${tokens.accessToken}` } },
        fetchImpl as typeof fetch,
        { baseUrl: 'http://127.0.0.1:4310', tokenStore },
    );

    const pendingResults = Promise.all([request('one'), request('two'), request('three')]);
    await allInitialRequestsSent;
    expect(initial401Count).toBe(3);
    releaseInitial401s();
    await refreshStarted;
    expect(refreshCalls).toBe(1);
    releaseRefresh(response({ accessToken: 'synthetic-new-access', refreshToken: 'synthetic-next-refresh' }));

    await expect(pendingResults).resolves.toEqual([
        { ok: true, value: { ok: true } },
        { ok: true, value: { ok: true } },
        { ok: true, value: { ok: true } },
    ]);
    expect(refreshCalls).toBe(1);
    expect(retryAuthorization).toEqual([
        'Bearer synthetic-new-access',
        'Bearer synthetic-new-access',
        'Bearer synthetic-new-access',
    ]);
    expect(tokenStore.saveSessionTokens).toHaveBeenCalledTimes(1);
    expect(tokenStore.saveSessionTokens).toHaveBeenCalledWith({
        accessToken: 'synthetic-new-access',
        refreshToken: 'synthetic-next-refresh',
    });
    expect(refreshLog).toHaveBeenCalledTimes(1);
    expect(refreshLog).toHaveBeenCalledWith('REFRESH START');
    expect(JSON.stringify(refreshLog.mock.calls)).not.toContain('synthetic-');
});

test('failed refresh clears both tokens and returns the session to login without retrying', async () => {
    const tokens = { accessToken: 'synthetic-expired-access', refreshToken: 'synthetic-invalid-refresh' };
    const tokenStore = {
        readSessionTokens: jest.fn().mockResolvedValue(tokens),
        saveSessionTokens: jest.fn().mockResolvedValue(undefined),
        deleteSessionTokens: jest.fn().mockResolvedValue(undefined),
    };
    const fetchImpl = jest.fn<Promise<Response>, Parameters<typeof fetch>>()
        .mockImplementation(async (input) => String(input).endsWith('/v1/session/refresh')
            ? response({ code: 'invalid_grant' }, 401)
            : response({ code: 'unauthorized' }, 401));
    const lifecycleEvents: string[] = [];
    const unsubscribe = subscribeToSessionLifecycle((state) => lifecycleEvents.push(state));

    const result = await fetchJsonWithSessionRefresh(
        'http://127.0.0.1:4310/v1/incidents',
        isSuccessfulPayload,
        1000,
        { headers: { Authorization: `Bearer ${tokens.accessToken}` } },
        fetchImpl as typeof fetch,
        { baseUrl: 'http://127.0.0.1:4310', tokenStore },
    );
    unsubscribe();

    expect(result).toEqual({ ok: false, reason: { kind: 'session-expired' } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(tokenStore.deleteSessionTokens).toHaveBeenCalledTimes(1);
    expect(tokenStore.saveSessionTokens).not.toHaveBeenCalled();
    expect(getSessionLifecycleState()).toBe('expired');
    expect(lifecycleEvents).toEqual(['expired']);
});

test('a 401 after the single retry does not begin another refresh cycle', async () => {
    const tokens = { accessToken: 'synthetic-expired-access', refreshToken: 'synthetic-refresh' };
    const tokenStore = {
        readSessionTokens: jest.fn().mockResolvedValue(tokens),
        saveSessionTokens: jest.fn().mockResolvedValue(undefined),
        deleteSessionTokens: jest.fn().mockResolvedValue(undefined),
    };
    let refreshCalls = 0;
    const fetchImpl = jest.fn<Promise<Response>, Parameters<typeof fetch>>()
        .mockImplementation(async (input) => {
            if (String(input).endsWith('/v1/session/refresh')) {
                refreshCalls += 1;
                return response({ accessToken: 'synthetic-new-access', refreshToken: 'synthetic-next-refresh' });
            }
            return response({ code: 'unauthorized' }, 401);
        });

    const result = await fetchJsonWithSessionRefresh(
        'http://127.0.0.1:4310/v1/incidents',
        isSuccessfulPayload,
        1000,
        { headers: { Authorization: `Bearer ${tokens.accessToken}` } },
        fetchImpl as typeof fetch,
        { baseUrl: 'http://127.0.0.1:4310', tokenStore },
    );

    expect(result).toEqual({ ok: false, reason: { kind: 'server-error', status: 401 } });
    expect(refreshCalls).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(tokenStore.deleteSessionTokens).not.toHaveBeenCalled();
});

test('a timed out refresh clears the session and releases the waiting request', async () => {
    const tokens = { accessToken: 'synthetic-expired-access', refreshToken: 'synthetic-refresh' };
    const tokenStore = {
        readSessionTokens: jest.fn().mockResolvedValue(tokens),
        saveSessionTokens: jest.fn().mockResolvedValue(undefined),
        deleteSessionTokens: jest.fn().mockResolvedValue(undefined),
    };
    const fetchImpl = jest.fn<Promise<Response>, Parameters<typeof fetch>>()
        .mockImplementation((input, init) => {
            if (!String(input).endsWith('/v1/session/refresh')) return Promise.resolve(response({}, 401));
            return new Promise((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
            });
        });

    await expect(fetchJsonWithSessionRefresh(
        'http://127.0.0.1:4310/v1/incidents',
        isSuccessfulPayload,
        20,
        { headers: { Authorization: `Bearer ${tokens.accessToken}` } },
        fetchImpl as typeof fetch,
        { baseUrl: 'http://127.0.0.1:4310', tokenStore },
    )).resolves.toEqual({ ok: false, reason: { kind: 'session-expired' } });
    expect(tokenStore.deleteSessionTokens).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
});