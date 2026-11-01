import { fetchJson, fetchJsonWithRetry, parseRetryAfterMs } from './cloudClient';
import { planRetry } from '../course-evaluation';
import { configureTelemetrySink } from '../telemetry/safeTelemetry';

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
    jest.restoreAllMocks();
});

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

test('Retry-After controls a bounded retry and logs only sanitized attempt metadata', async () => {
    const telemetry = jest.fn();
    const sleep = jest.fn(async (_delayMs: number) => undefined);
    const fetchImpl = jest.fn<Promise<Response>, Parameters<typeof fetch>>()
        .mockResolvedValueOnce({
            ok: false,
            status: 429,
            headers: new Headers({ 'Retry-After': '1' }),
        } as Response)
        .mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({ id: 'resource-1', status: 'open' }),
        } as Response);
    configureTelemetrySink(telemetry);

    await expect(fetchJsonWithRetry(
        'http://127.0.0.1:4310/v1/resources',
        esIncidenteValido,
        5000,
        {},
        fetchImpl as typeof fetch,
        undefined,
        { sleep },
    )).resolves.toEqual({ ok: true, value: { id: 'resource-1', status: 'open' } });

    expect(sleep).toHaveBeenCalledWith(1000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const attempts = telemetry.mock.calls
        .map(([event]) => event)
        .filter((event) => event.errorCode === 'backend_retry_attempt');
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({
        errorCode: 'backend_retry_attempt',
        context: { method: 'GET', attempt: 1, status: 429, retry: true, delayMs: 1000 },
    });
});

test('a retried POST reuses the same idempotency key and serialized body', async () => {
    const telemetry = jest.fn();
    const sleep = jest.fn(async (_delayMs: number) => undefined);
    const fetchImpl = jest.fn<Promise<Response>, Parameters<typeof fetch>>()
        .mockRejectedValueOnce(new Error('response lost'))
        .mockResolvedValueOnce({
            ok: true,
            status: 201,
            headers: new Headers(),
            json: async () => ({ id: 'resource-1', status: 'open' }),
        } as Response);
    const body = JSON.stringify({ resourceId: 'resource-1', note: 'private synthetic content' });
    const request: RequestInit = {
        method: 'POST',
        headers: { 'Idempotency-Key': 'stable-operation-001' },
        body,
    };
    configureTelemetrySink(telemetry);

    await expect(fetchJsonWithRetry(
        'http://127.0.0.1:4310/v1/resources/action',
        esIncidenteValido,
        5000,
        request,
        fetchImpl as typeof fetch,
        undefined,
        { sleep },
    )).resolves.toEqual({ ok: true, value: { id: 'resource-1', status: 'open' } });

    expect(sleep).toHaveBeenCalledWith(250);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchImpl.mock.calls) {
        expect(new Headers(init?.headers).get('Idempotency-Key')).toBe('stable-operation-001');
        expect(init?.body).toBe(body);
    }
    const serializedTelemetry = JSON.stringify(telemetry.mock.calls);
    expect(serializedTelemetry).not.toContain('stable-operation-001');
    expect(serializedTelemetry).not.toContain('private synthetic content');
});

test('a POST without a stable idempotency key is never retried', async () => {
    const sleep = jest.fn(async (_delayMs: number) => undefined);
    const fetchImpl = jest.fn<Promise<Response>, Parameters<typeof fetch>>()
        .mockRejectedValue(new Error('response lost'));

    await expect(fetchJsonWithRetry(
        'http://127.0.0.1:4310/v1/resources/action',
        esIncidenteValido,
        5000,
        { method: 'POST', body: JSON.stringify({ resourceId: 'resource-1' }) },
        fetchImpl as typeof fetch,
        undefined,
        { sleep },
    )).resolves.toEqual({ ok: false, reason: { kind: 'server-error', status: 0 } });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
});

test('Retry-After accepts seconds and HTTP dates without producing non-finite delays', () => {
    expect(parseRetryAfterMs('1.5', 0)).toBe(1500);
    expect(parseRetryAfterMs('Thu, 01 Jan 1970 00:00:02 GMT', 500)).toBe(1500);
    expect(parseRetryAfterMs('invalid', 0)).toBeUndefined();
    expect(parseRetryAfterMs('-1', 0)).toBeUndefined();
    expect(parseRetryAfterMs('Infinity', 0)).toBeUndefined();
    expect(parseRetryAfterMs('9'.repeat(310), 0)).toBe(Number.MAX_VALUE);
});

test('does not retry before a Retry-After delay that exceeds the configured wait limit', () => {
    expect(planRetry({ method: 'GET', status: 429, attempt: 1, retryAfterMs: 6000, maxDelayMs: 5000 }))
        .toEqual({ retry: false, delayMs: 0, requiresStableIdempotencyKey: false });
});
