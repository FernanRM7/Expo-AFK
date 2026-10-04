import type { FetchResult } from '../course-evaluation/contracts';
import { reportCampusOpsError } from '../telemetry/safeTelemetry';

const TIEMPO_LIMITE_MS = 5000;

export async function fetchJson<T>(
    url: string,
    validar: (payload: unknown) => payload is T,
    tiempoLimiteMs = TIEMPO_LIMITE_MS,
    request: RequestInit = {},
    fetchImpl: typeof fetch = fetch,
): Promise<FetchResult<T>> {
    const controlador = new AbortController();
    const idTiempoLimite = setTimeout(() => controlador.abort(), tiempoLimiteMs);

    try {
        const respuesta = await fetchImpl(url, {
            ...request,
            signal: controlador.signal,
        });

        if (!respuesta.ok) {
            reportCampusOpsError('backend_http_error', { status: respuesta.status });
            return { ok: false, reason: { kind: 'server-error', status: respuesta.status } };
        }

        const payload: unknown = await respuesta.json().catch(() => undefined);
        if (!validar(payload)) {
            reportCampusOpsError('backend_contract_mismatch', { status: respuesta.status });
            return { ok: false, reason: { kind: 'contract-invalid' } };
        }

        return { ok: true, value: payload };
    } catch (error) {
        if (
            typeof error === 'object' &&
            error !== null &&
            'name' in error &&
            error.name === 'AbortError'
        ) {
            reportCampusOpsError('backend_request_failed', { status: 'timeout' });
            return { ok: false, reason: { kind: 'timeout' } };
        }
        reportCampusOpsError('backend_request_failed', { status: 'network_error' });
        return { ok: false, reason: { kind: 'server-error', status: 0 } };
    } finally {
        clearTimeout(idTiempoLimite);
    }
}
