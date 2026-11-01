import type { FetchResult } from '../course-evaluation/contracts';
import { planRetry } from '../course-evaluation';
import type { RetryPolicy } from '../course-evaluation';
import { reportCampusOpsError } from '../telemetry/safeTelemetry';

const TIEMPO_LIMITE_MS = 5000;
const MAX_ELAPSED_MS = 15_000;

export type RetryExecutionOptions = RetryPolicy & Readonly<{
    sleep?: (delayMs: number) => Promise<void>;
    now?: () => number;
}>;

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
    onResponse?: (response: Response) => void,
): Promise<FetchResult<T>> {
    const controlador = new AbortController();
    const idTiempoLimite = setTimeout(() => controlador.abort(), tiempoLimiteMs);

    try {
        const respuesta = await fetchImpl(url, {
            ...request,
            signal: controlador.signal,
        });
        onResponse?.(respuesta);

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
    onResponse?: (response: Response) => void,
): Promise<FetchResult<T>> {
    const access = await session.getAccessToken();
    if (!access.ok) return access;
    const withToken = (token: string): RequestInit => {
        const headers = new Headers(request.headers);
        headers.set('Authorization', `Bearer ${token}`);
        return { ...request, headers };
    };
    const first = await fetchJson(url, validar, timeoutMs, withToken(access.value), fetchImpl, onResponse);
    if (!first.ok && first.reason.kind === 'server-error' && first.reason.status === 401) {
        const refreshed = await session.refreshAfterUnauthorized(access.value);
        if (!refreshed.ok) return refreshed;
        return fetchJson(url, validar, timeoutMs, withToken(refreshed.value), fetchImpl, onResponse);
    }
    return first;
}

export function parseRetryAfterMs(value: string | null, nowMs = Date.now()): number | undefined {
    if (value === null || !Number.isFinite(nowMs)) return undefined;
    const trimmed = value.trim();
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) {
        const seconds = Number(trimmed);
        if (Number.isNaN(seconds) || seconds < 0) return undefined;
        if (!Number.isFinite(seconds)) return Number.MAX_VALUE;
        const milliseconds = seconds * 1000;
        return Number.isFinite(milliseconds) ? milliseconds : Number.MAX_VALUE;
    }
    const dateMs = Date.parse(value);
    if (!Number.isFinite(dateMs)) return undefined;
    return Math.max(0, dateMs - nowMs);
}

function sleep(delayMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/** Performs bounded retries while preserving the original request, including POST identity and body. */
export async function fetchJsonWithRetry<T>(
    url: string,
    validar: (payload: unknown) => payload is T,
    timeoutMs = TIEMPO_LIMITE_MS,
    request: RequestInit = {},
    fetchImpl: typeof fetch = fetch,
    session?: SessionRequestCoordinator,
    options: RetryExecutionOptions = {},
): Promise<FetchResult<T>> {
    const now = options.now ?? Date.now;
    const pause = options.sleep ?? sleep;
    const startedAt = now();
    const maxElapsedMs = options.maxElapsedMs ?? MAX_ELAPSED_MS;
    const method = request.method?.toUpperCase() === 'POST' ? 'POST' : 'GET';
    const headers = new Headers(request.headers);
    const idempotencyKey = headers.get('Idempotency-Key') ?? undefined;
    let attempt = 0;
    let lastResult: FetchResult<T> = { ok: false, reason: { kind: 'timeout' } };

    while (attempt < 4) {
        const elapsedMs = now() - startedAt;
        const remainingMs = maxElapsedMs - elapsedMs;
        if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
            return { ok: false, reason: { kind: 'timeout' } };
        }

        attempt += 1;
        const attemptStartedAt = now();
        let responseStatus: number | undefined;
        let retryAfterHeader: string | null = null;
        const observeResponse = (response: Response): void => {
            responseStatus = response.status;
            retryAfterHeader = response.headers?.get('Retry-After') ?? null;
        };
        const requestTimeoutMs = Math.max(1, Math.min(timeoutMs, remainingMs));
        lastResult = session
            ? await fetchJsonWithSession(url, validar, requestTimeoutMs, request, fetchImpl, session, observeResponse)
            : await fetchJson(url, validar, requestTimeoutMs, request, fetchImpl, observeResponse);

        const finishedAt = now();
        const elapsedAfterRequest = finishedAt - startedAt;
        const duration = finishedAt - attemptStartedAt;
        const retryAfterMs = parseRetryAfterMs(retryAfterHeader, finishedAt);
        const status = responseStatus ??
            (lastResult.ok ? 200 : lastResult.reason.kind === 'server-error'
                ? lastResult.reason.status
                : lastResult.reason.kind);
        const plan = lastResult.ok || (
            lastResult.reason.kind !== 'timeout' && lastResult.reason.kind !== 'server-error'
        )
            ? { retry: false, delayMs: 0, requiresStableIdempotencyKey: false }
            : planRetry({
                method,
                status: lastResult.reason.kind === 'timeout' ? 'timeout' : lastResult.reason.status,
                attempt,
                elapsedMs: elapsedAfterRequest,
                maxElapsedMs,
                ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
                ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
                ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
                ...(options.baseDelayMs === undefined ? {} : { baseDelayMs: options.baseDelayMs }),
                ...(options.maxDelayMs === undefined ? {} : { maxDelayMs: options.maxDelayMs }),
            });

        reportCampusOpsError('backend_retry_attempt', {
            method,
            attempt,
            status,
            durationMs: Number.isFinite(duration) ? Math.max(0, Math.min(duration, MAX_ELAPSED_MS)) : 0,
            retry: plan.retry,
            delayMs: plan.delayMs,
        });

        if (!plan.retry || lastResult.ok) return lastResult;
        await pause(plan.delayMs);
    }

    return lastResult;
}
