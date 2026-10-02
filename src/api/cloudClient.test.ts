import { fetchJson } from './cloudClient';
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