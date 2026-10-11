import { RemoteIncidentRepository } from './remoteIncidentRepository';
import { createSessionService } from '../../session/application/sessionService';
import { transitionSessionLifecycle } from '../../session/application/sessionLifecycle';

function response(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    } as Response;
}

function dto(payload: unknown = {
    category: 'connectivity',
    description: 'Falla sintética de conexión',
    location: 'Edificio de prueba A',
    reporterId: 'reporter-1',
    assignedTechnicianId: null,
    priority: 'medium',
    notes: [{ text: 'nota interna que no pertenece al modelo de pantalla' }],
}) {
    return { id: 'campus-inc-001', version: 3, status: 'assigned', payload };
}

function repository(fetchImpl: typeof fetch) {
    return new RemoteIncidentRepository({
        baseUrl: 'http://127.0.0.1:4310/',
        actorId: 'reporter-1',
        accessToken: 'course-valid-token',
        fetchImpl,
    });
}

beforeEach(() => {
    transitionSessionLifecycle('logout');
});

test('list maps remote DTOs to application snapshots and sends only contract headers', async () => {
    const fetchImpl = jest.fn<Promise<Response>, Parameters<typeof fetch>>()
        .mockResolvedValue(response({ items: [dto()] }));
    const client = repository(fetchImpl as typeof fetch);

    const result = await client.list();

    expect(result).toEqual({
        ok: true,
        value: [{
            id: 'campus-inc-001',
            version: 3,
            status: 'assigned',
            incident: {
                id: 'campus-inc-001',
                category: 'connectivity',
                status: 'assigned',
                description: 'Falla sintética de conexión',
                location: { source: 'manual', label: 'Edificio de prueba A' },
                reporterId: 'reporter-1',
                assignedTechnicianId: null,
            },
        }],
    });
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:4310/v1/incidents', expect.objectContaining({
        headers: {
            Accept: 'application/json',
            Authorization: 'Bearer course-valid-token',
            'X-Course-Actor': 'reporter-1',
        },
    }));
    const serializedModel = JSON.stringify(result);
    expect(serializedModel).not.toContain('priority');
    expect(serializedModel).not.toContain('nota interna');
});

test('list distinguishes an empty list and a valid nullable payload from malformed data', async () => {
    const fetchImpl = jest.fn<Promise<Response>, Parameters<typeof fetch>>()
        .mockResolvedValueOnce(response({ items: [] }))
        .mockResolvedValueOnce(response({ items: [dto(null)] }))
        .mockResolvedValueOnce(response({ items: [{ id: 'bad', version: 1, status: 'open', payload: { category: 'invented' } }] }));
    const client = repository(fetchImpl as typeof fetch);

    await expect(client.list()).resolves.toEqual({ ok: true, value: [] });
    await expect(client.list()).resolves.toEqual({
        ok: true,
        value: [{ id: 'campus-inc-001', version: 3, status: 'assigned', incident: null }],
    });
    await expect(client.list()).resolves.toEqual({ ok: false, reason: { kind: 'contract-invalid' } });
});

test('detail uses an encoded resource id and preserves nullable payload as valid empty data', async () => {
    const fetchImpl = jest.fn<Promise<Response>, Parameters<typeof fetch>>()
        .mockResolvedValue(response(dto(null)));
    const client = repository(fetchImpl as typeof fetch);

    await expect(client.getById('campus/inc 001')).resolves.toEqual({
        ok: true,
        value: { id: 'campus-inc-001', version: 3, status: 'assigned', incident: null },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
        'http://127.0.0.1:4310/v1/incidents/campus%2Finc%20001',
        expect.objectContaining({ headers: expect.objectContaining({ 'X-Course-Actor': 'reporter-1' }) }),
    );
});

test('create sends the exact DTO and caller-stable idempotency key, then maps only known fields', async () => {
    const fetchImpl = jest.fn<Promise<Response>, Parameters<typeof fetch>>()
        .mockResolvedValue(response({ incident: { ...dto({
            category: 'water',
            description: 'Fuga sintética',
            location: 'Laboratorio de prueba',
            reporterId: 'reporter-1',
            assignedTechnicianId: null,
        }), status: 'open' }, operationId: 'create-operation-01', duplicate: false }, 201));
    const client = repository(fetchImpl as typeof fetch);
    const input = { category: 'water' as const, description: 'Fuga sintética', location: 'Laboratorio de prueba' };

    const result = await client.create(input, 'create-operation-01');

    expect(result).toEqual({
        ok: true,
        value: {
            id: 'campus-inc-001',
            version: 3,
            status: 'open',
            incident: {
                id: 'campus-inc-001',
                category: 'water',
                status: 'open',
                description: 'Fuga sintética',
                location: { source: 'manual', label: 'Laboratorio de prueba' },
                reporterId: 'reporter-1',
                assignedTechnicianId: null,
            },
        },
    });
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:4310/v1/incidents', expect.objectContaining({
        method: 'POST',
        headers: {
            Accept: 'application/json',
            Authorization: 'Bearer course-valid-token',
            'X-Course-Actor': 'reporter-1',
            'Content-Type': 'application/json',
            'Idempotency-Key': 'create-operation-01',
        },
        body: JSON.stringify(input),
    }));
});

test('create refuses a short idempotency key without sending a request', async () => {
    const fetchImpl = jest.fn<Promise<Response>, Parameters<typeof fetch>>();
    const client = repository(fetchImpl as typeof fetch);

    await expect(client.create(
        { category: 'water', description: 'Fuga sintética', location: 'Zona de prueba' },
        'short',
    )).resolves.toEqual({ ok: false, reason: { kind: 'contract-invalid' } });
    expect(fetchImpl).not.toHaveBeenCalled();
});

test('session-backed incident requests share one refresh and retry each request once', async () => {
    let stored: { accessToken: string; refreshToken: string } | null = {
        accessToken: 'synthetic-old-access',
        refreshToken: 'synthetic-refresh',
    };
    const tokenStore = {
        readSessionTokens: jest.fn(async () => stored),
        saveSessionTokens: jest.fn(async (tokens: { accessToken: string; refreshToken: string }) => { stored = tokens; }),
        deleteSessionTokens: jest.fn(async () => { stored = null; }),
    };
    transitionSessionLifecycle('login-started');
    transitionSessionLifecycle('login-succeeded');

    let releaseRefresh!: (response: Response) => void;
    let refreshStarted!: () => void;
    let unauthorizedCount = 0;
    const refreshPending = new Promise<Response>((resolve) => { releaseRefresh = resolve; });
    const refreshStartedSignal = new Promise<void>((resolve) => { refreshStarted = resolve; });
    const fetchImpl = jest.fn<Promise<Response>, Parameters<typeof fetch>>().mockImplementation((input, init) => {
        const url = String(input);
        if (url.endsWith('/v1/session/refresh')) {
            refreshStarted();
            return refreshPending;
        }
        const authorization = new Headers(init?.headers).get('Authorization');
        if (authorization === 'Bearer synthetic-old-access') {
            unauthorizedCount += 1;
            return Promise.resolve(response({ code: 'expired' }, 401));
        }
        return Promise.resolve(response({ items: [] }));
    });
    const session = createSessionService({
        baseUrl: 'http://127.0.0.1:4310',
        fetchImpl: fetchImpl as typeof fetch,
        tokenStore,
    });
    const client = new RemoteIncidentRepository({
        baseUrl: 'http://127.0.0.1:4310',
        actorId: 'reporter-1',
        session,
        fetchImpl: fetchImpl as typeof fetch,
    });

    const pending = Promise.all([client.list(), client.list(), client.list()]);
    await refreshStartedSignal;
    expect(unauthorizedCount).toBe(3);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/v1/session/refresh'))).toHaveLength(1);
    releaseRefresh(response({
        accessToken: 'synthetic-new-access',
        refreshToken: 'synthetic-next-refresh',
        expiresIn: 60,
    }));

    await expect(pending).resolves.toEqual([
        { ok: true, value: [] },
        { ok: true, value: [] },
        { ok: true, value: [] },
    ]);
    expect(fetchImpl.mock.calls.filter(([, init]) => new Headers(init?.headers).get('Authorization') === 'Bearer synthetic-new-access')).toHaveLength(3);
    expect(tokenStore.saveSessionTokens).toHaveBeenCalledTimes(1);
});

test('technicians cannot invoke an incident action unless assigned; coordination reaches the action endpoint', async () => {
    const fetchImpl = jest.fn<Promise<Response>, Parameters<typeof fetch>>().mockResolvedValue(
        response({ incident: dto(), operationId: 'stable-action-01', duplicate: false }, 201),
    );
    const assignedSnapshot = {
        id: 'campus-inc-001',
        version: 3,
        status: 'assigned' as const,
        incident: {
            id: 'campus-inc-001',
            category: 'connectivity' as const,
            status: 'assigned' as const,
            description: 'Falla sintética',
            location: { source: 'manual' as const, label: 'Zona de prueba' },
            reporterId: 'reporter-1',
            assignedTechnicianId: 'technician-1',
        },
    };
    const unassigned = new RemoteIncidentRepository({
        baseUrl: 'http://127.0.0.1:4310',
        actorId: 'technician-2',
        accessToken: 'course-valid-token',
        fetchImpl: fetchImpl as typeof fetch,
    });
    await expect(unassigned.actOnIncident(assignedSnapshot, 'resolve', { diagnosis: 'synthetic' }, 'action-key-01'))
        .resolves.toEqual({ ok: false, reason: { kind: 'forbidden' } });
    expect(fetchImpl).not.toHaveBeenCalled();

    const coordinator = new RemoteIncidentRepository({
        baseUrl: 'http://127.0.0.1:4310',
        actorId: 'coordinator-1',
        accessToken: 'course-valid-token',
        fetchImpl: fetchImpl as typeof fetch,
    });
    await coordinator.actOnIncident(assignedSnapshot, 'close', {}, 'action-key-02');
    expect(fetchImpl).toHaveBeenCalledWith(
        'http://127.0.0.1:4310/v1/incidents/campus-inc-001/actions',
        expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ action: 'close', baseVersion: 3 }),
        }),
    );
});

test('a second 401 after refresh is returned without starting another refresh cycle', async () => {
    let stored: { accessToken: string; refreshToken: string } | null = {
        accessToken: 'synthetic-old-access',
        refreshToken: 'synthetic-refresh',
    };
    const tokenStore = {
        readSessionTokens: jest.fn(async () => stored),
        saveSessionTokens: jest.fn(async (tokens: { accessToken: string; refreshToken: string }) => { stored = tokens; }),
        deleteSessionTokens: jest.fn(async () => { stored = null; }),
    };
    transitionSessionLifecycle('login-started');
    transitionSessionLifecycle('login-succeeded');
    const fetchImpl = jest.fn<Promise<Response>, Parameters<typeof fetch>>().mockImplementation(async (input) => {
        if (String(input).endsWith('/v1/session/refresh')) {
            return response({
                accessToken: 'synthetic-new-access',
                refreshToken: 'synthetic-new-refresh',
                expiresIn: 60,
            });
        }
        return response({ code: 'still-expired' }, 401);
    });
    const session = createSessionService({ fetchImpl: fetchImpl as typeof fetch, tokenStore });
    const client = new RemoteIncidentRepository({
        baseUrl: 'http://127.0.0.1:4310',
        actorId: 'reporter-1',
        session,
        fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(client.list()).resolves.toEqual({ ok: false, reason: { kind: 'server-error', status: 401 } });
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/v1/session/refresh'))).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
});
