import { createHttpLocationProvider } from './httpLocationProvider';

function respuesta(estado: number, cuerpo: unknown): Response {
    return { ok: estado >= 200 && estado < 300, status: estado, json: async () => cuerpo } as Response;
}

function crearProveedor(fetchSimulado: jest.Mock, tiempoLimiteMs = 50) {
    return createHttpLocationProvider({
        baseUrl: 'http://127.0.0.1:4310',
        tiempoLimiteMs,
        fetchImpl: fetchSimulado as unknown as typeof fetch,
    });
}

test('éxito: devuelve el valor del proveedor y consulta la ruta de geocodificación', async () => {
    const fetchSimulado = jest.fn(async (_url: unknown, _opciones?: RequestInit) =>
        respuesta(200, { label: 'Edificio de prueba A', latitude: 0, longitude: 0 }));
    const resultado = await crearProveedor(fetchSimulado).resolve('edificio a');

    expect(resultado).toEqual({
        disponible: true,
        valor: { label: 'Edificio de prueba A', latitude: 0, longitude: 0 },
    });
    expect(String(fetchSimulado.mock.calls[0]?.[0])).toBe('http://127.0.0.1:4310/v1/geocoding?q=edificio%20a');
});

test('datos incompletos: se entregan tal cual para que selectIncidentLocation decida', async () => {
    const fetchSimulado = jest.fn(async () => respuesta(200, { label: 'Zona ficticia' }));
    const resultado = await crearProveedor(fetchSimulado).resolve('zona');
    expect(resultado).toEqual({ disponible: true, valor: { label: 'Zona ficticia' } });
});

test('respuesta que no es un objeto: no disponible por respuesta inválida', async () => {
    const fetchSimulado = jest.fn(async () => respuesta(200, null));
    expect(await crearProveedor(fetchSimulado).resolve('zona')).toEqual({
        disponible: false, motivo: 'respuesta-invalida',
    });
});

test('timeout: no disponible sin lanzar excepción', async () => {
    const fetchSimulado = jest.fn(
        (_url: unknown, opciones?: RequestInit) =>
            new Promise<Response>((_resolver, rechazar) => {
                opciones?.signal?.addEventListener('abort', () =>
                    rechazar(new DOMException('Aborted', 'AbortError')));
            }),
    );
    expect(await crearProveedor(fetchSimulado).resolve('zona')).toEqual({
        disponible: false, motivo: 'timeout',
    });
});

test('429: no disponible por límite de solicitudes', async () => {
    const fetchSimulado = jest.fn(async () => respuesta(429, { code: 'rate_limited' }));
    expect(await crearProveedor(fetchSimulado).resolve('zona')).toEqual({
        disponible: false, motivo: 'rate-limited',
    });
});

test('desconexión: no disponible por falta de conexión', async () => {
    const fetchSimulado = jest.fn(async () => {
        throw new TypeError('Network request failed');
    });
    expect(await crearProveedor(fetchSimulado).resolve('zona')).toEqual({
        disponible: false, motivo: 'sin-conexion',
    });
});