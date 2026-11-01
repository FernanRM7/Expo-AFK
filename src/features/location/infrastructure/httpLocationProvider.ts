import { fetchJsonWithRetry, type RetryExecutionOptions } from '../../../api/cloudClient';
import type { LocationProvider, ResultadoProveedor } from '../domain/locationProvider';

const URL_BASE_POR_DEFECTO = 'http://127.0.0.1:4310';

export type OpcionesProveedorHttp = Readonly<{
    baseUrl?: string;
    headers?: Readonly<Record<string, string>>;
    tiempoLimiteMs?: number;
    fetchImpl?: typeof fetch;
    retry?: RetryExecutionOptions;
}>;

function esRegistro(valor: unknown): valor is Record<string, unknown> {
    return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

export function createHttpLocationProvider(opciones: OpcionesProveedorHttp = {}): LocationProvider {
    const baseUrl = (opciones.baseUrl ?? process.env.EXPO_PUBLIC_COURSE_BACKEND_URL ?? URL_BASE_POR_DEFECTO)
        .replace(/\/$/, '');

    return {
        async resolve(consulta: string): Promise<ResultadoProveedor> {
            const resultado = await fetchJsonWithRetry(
                `${baseUrl}/v1/geocoding?q=${encodeURIComponent(consulta)}`,
                esRegistro,
                opciones.tiempoLimiteMs,
                { headers: { Accept: 'application/json', ...opciones.headers } },
                opciones.fetchImpl,
                undefined,
                opciones.retry,
            );
            if (resultado.ok) return { disponible: true, valor: resultado.value };

            const { reason } = resultado;
            if (reason.kind === 'timeout') return { disponible: false, motivo: 'timeout' };
            if (reason.kind === 'server-error' && reason.status === 429) {
                return { disponible: false, motivo: 'rate-limited' };
            }
            if (reason.kind === 'server-error' && reason.status === 0) {
                return { disponible: false, motivo: 'sin-conexion' };
            }
            return { disponible: false, motivo: 'respuesta-invalida' };
        },
    };
}