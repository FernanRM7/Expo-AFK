import { RemoteIncidentRepository } from './remoteIncidentRepository';

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
        sessionTokenStore: {
            readSessionTokens: async () => ({
                accessToken: 'course-valid-token',
                refreshToken: 'course-refresh-token',
            }),
            saveSessionTokens: async () => undefined,
            deleteSessionTokens: async () => undefined,
        },
    });
}

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
    const [listUrl, listRequest] = fetchImpl.mock.calls[0] as Parameters<typeof fetch>;
    const listHeaders = new Headers((listRequest as RequestInit).headers);
    expect(listUrl).toBe('http://127.0.0.1:4310/v1/incidents');
    expect(listHeaders.get('Accept')).toBe('application/json');
    expect(listHeaders.get('Authorization')).toBe('Bearer course-valid-token');
    expect(listHeaders.get('X-Course-Actor')).toBe('reporter-1');
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
    const [detailUrl, detailRequest] = fetchImpl.mock.calls[0] as Parameters<typeof fetch>;
    expect(detailUrl).toBe('http://127.0.0.1:4310/v1/incidents/campus%2Finc%20001');
    expect(new Headers((detailRequest as RequestInit).headers).get('X-Course-Actor')).toBe('reporter-1');
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
    const [createUrl, createRequest] = fetchImpl.mock.calls[0] as Parameters<typeof fetch>;
    const createInit = createRequest as RequestInit;
    const createHeaders = new Headers(createInit.headers);
    expect(createUrl).toBe('http://127.0.0.1:4310/v1/incidents');
    expect(createInit.method).toBe('POST');
    expect(createHeaders.get('Accept')).toBe('application/json');
    expect(createHeaders.get('Authorization')).toBe('Bearer course-valid-token');
    expect(createHeaders.get('X-Course-Actor')).toBe('reporter-1');
    expect(createHeaders.get('Content-Type')).toBe('application/json');
    expect(createHeaders.get('Idempotency-Key')).toBe('create-operation-01');
    expect(createInit.body).toBe(JSON.stringify(input));
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
