import type { FetchResult } from '../course-evaluation/contracts';
import { reportCampusOpsError } from '../telemetry/safeTelemetry';

const TIEMPO_LIMITE_MS = 5000;

export type SessionRequestCoordinator = Readonly<{
    getAccessToken(): Promise<FetchResult<string>>;
    refreshAfterUnauthorized(observedAccessToken: string): Promise<FetchResult<string>>;
}>;

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

/** Makes one authenticated request and shares session refresh after a 401. */
export async function fetchJsonWithSession<T>(
    url: string,
    validar: (payload: unknown) => payload is T,
    timeoutMs: number,
    request: RequestInit,
    fetchImpl: typeof fetch,
    session: SessionRequestCoordinator,
): Promise<FetchResult<T>> {
    const access = await session.getAccessToken();
    if (!access.ok) return access;
    const withToken = (token: string): RequestInit => {
        const headers = new Headers(request.headers);
        headers.set('Authorization', `Bearer ${token}`);
        return { ...request, headers };
    };
    const first = await fetchJson(url, validar, timeoutMs, withToken(access.value), fetchImpl);
    if (!first.ok && first.reason.kind === 'server-error' && first.reason.status === 401) {
        const refreshed = await session.refreshAfterUnauthorized(access.value);
        if (!refreshed.ok) return refreshed;
        return fetchJson(url, validar, timeoutMs, withToken(refreshed.value), fetchImpl);
    }
    return first;
}
