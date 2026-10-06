import type { FetchResult } from '../course-evaluation/contracts';
import { setSessionLifecycleState } from '../features/session/application/sessionLifecycle';
import type { SessionTokenStore, SessionTokens } from '../features/session/infrastructure/secureSessionStorage';
import { reportCampusOpsError } from '../telemetry/safeTelemetry';

const TIEMPO_LIMITE_MS = 5000;
let refreshInFlight: Promise<string | null> | null = null;

export type AuthenticatedFetchOptions = Readonly<{
    baseUrl: string;
    tokenStore: SessionTokenStore;
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

export async function fetchJsonWithSessionRefresh<T>(
    url: string,
    validar: (payload: unknown) => payload is T,
    tiempoLimiteMs: number,
    request: RequestInit,
    fetchImpl: typeof fetch,
    session: AuthenticatedFetchOptions,
): Promise<FetchResult<T>> {
    const initialAuthorization = new Headers(request.headers).get('Authorization');
    let initialAccessToken = initialAuthorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
    let initialRequest = request;
    try {
        const storedTokens = await session.tokenStore.readSessionTokens();
        if (storedTokens) {
            initialAccessToken = storedTokens.accessToken;
            const headers = new Headers(request.headers);
            headers.set('Authorization', `Bearer ${storedTokens.accessToken}`);
            initialRequest = { ...request, headers };
        }
    } catch {
        await expireSession(session.tokenStore);
        return { ok: false, reason: { kind: 'session-expired' } };
    }

    const initialResult = await fetchJson(url, validar, tiempoLimiteMs, initialRequest, fetchImpl);
    if (
        initialResult.ok ||
        initialResult.reason.kind !== 'server-error' ||
        initialResult.reason.status !== 401 ||
        initialAccessToken === null
    ) {
        return initialResult;
    }

    let tokens: SessionTokens | null;
    try {
        tokens = await session.tokenStore.readSessionTokens();
    } catch {
        await expireSession(session.tokenStore);
        return { ok: false, reason: { kind: 'session-expired' } };
    }

    const accessToken = tokens && tokens.accessToken !== initialAccessToken
        ? tokens.accessToken
        : await getRefreshedAccessToken(session, fetchImpl, tokens?.refreshToken ?? null, tiempoLimiteMs);
    if (!accessToken) return { ok: false, reason: { kind: 'session-expired' } };

    const headers = new Headers(request.headers);
    headers.set('Authorization', `Bearer ${accessToken}`);
    return fetchJson(url, validar, tiempoLimiteMs, { ...request, headers }, fetchImpl);
}

function getRefreshedAccessToken(
    session: AuthenticatedFetchOptions,
    fetchImpl: typeof fetch,
    refreshToken: string | null,
    timeoutMs: number,
): Promise<string | null> {
    if (!refreshInFlight) {
        const refresh = refreshSession(session, fetchImpl, refreshToken, timeoutMs);
        const sharedRefresh = refresh.finally(() => {
            if (refreshInFlight === sharedRefresh) refreshInFlight = null;
        });
        refreshInFlight = sharedRefresh;
    }
    return refreshInFlight;
}

async function refreshSession(
    session: AuthenticatedFetchOptions,
    fetchImpl: typeof fetch,
    refreshToken: string | null,
    timeoutMs: number,
): Promise<string | null> {
    console.log('REFRESH START');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        if (!refreshToken) throw new Error('Refresh token unavailable.');
        const response = await fetchImpl(`${session.baseUrl.replace(/\/$/, '')}/v1/session/refresh`, {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
            signal: controller.signal,
        });
        if (!response.ok) throw new Error('Session refresh failed.');
        const payload: unknown = await response.json();
        if (
            typeof payload !== 'object' || payload === null ||
            !('accessToken' in payload) || typeof payload.accessToken !== 'string' || payload.accessToken.length === 0 ||
            !('refreshToken' in payload) || typeof payload.refreshToken !== 'string' || payload.refreshToken.length === 0
        ) {
            throw new Error('Session refresh returned an invalid response.');
        }
        const tokens = { accessToken: payload.accessToken, refreshToken: payload.refreshToken };
        await session.tokenStore.saveSessionTokens(tokens);
        setSessionLifecycleState('active');
        return tokens.accessToken;
    } catch {
        await expireSession(session.tokenStore);
        return null;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function expireSession(tokenStore: SessionTokenStore): Promise<void> {
    try {
        await tokenStore.deleteSessionTokens();
    } catch {
        reportCampusOpsError('session_storage_failed', { operation: 'clear' });
    }
    setSessionLifecycleState('expired');
}
