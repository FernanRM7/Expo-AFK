import type { FetchResult } from '../../../course-evaluation/contracts';
import { reportCampusOpsError } from '../../../telemetry/safeTelemetry';
import type { SessionTokenStore, SessionTokens } from '../infrastructure/secureSessionStorage';
import { transitionSessionLifecycle } from './sessionLifecycle';

export type CourseActorId =
  | 'reporter-1'
  | 'reporter-2'
  | 'technician-1'
  | 'technician-2'
  | 'coordinator-1';

export type SessionIdentity = Readonly<{
  actorId: CourseActorId;
  role: 'reporter' | 'technician' | 'coordinator';
  expiresIn: number;
}>;

type LoginResponse = SessionIdentity & SessionTokens;

export type SessionServiceDependencies = Readonly<{
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  tokenStore?: SessionTokenStore;
  now?: () => number;
}>;

const DEFAULT_BASE_URL = 'http://127.0.0.1:4310';
const REQUEST_TIMEOUT_MS = 5000;
const lazyTokenStore: SessionTokenStore = {
  async readSessionTokens() {
    return (await import('../infrastructure/secureSessionStorage')).readSessionTokens();
  },
  async saveSessionTokens(tokens) {
    return (await import('../infrastructure/secureSessionStorage')).saveSessionTokens(tokens);
  },
  async deleteSessionTokens() {
    return (await import('../infrastructure/secureSessionStorage')).deleteSessionTokens();
  },
};

const ACTORS = new Set<CourseActorId>([
  'reporter-1', 'reporter-2', 'technician-1', 'technician-2', 'coordinator-1',
]);
const ROLES = new Set<LoginResponse['role']>(['reporter', 'technician', 'coordinator']);

function isLoginResponse(value: unknown): value is LoginResponse {
  if (typeof value !== 'object' || value === null) return false;
  const response = value as Record<string, unknown>;
  return typeof response.actorId === 'string' && ACTORS.has(response.actorId as CourseActorId) &&
    typeof response.role === 'string' && ROLES.has(response.role as LoginResponse['role']) &&
    typeof response.accessToken === 'string' && response.accessToken.length > 0 &&
    typeof response.refreshToken === 'string' && response.refreshToken.length > 0 &&
    typeof response.expiresIn === 'number' && Number.isFinite(response.expiresIn) && response.expiresIn > 0;
}

function isRefreshResponse(value: unknown): value is SessionTokens & Readonly<{ expiresIn: number }> {
  if (typeof value !== 'object' || value === null) return false;
  const response = value as Record<string, unknown>;
  return typeof response.accessToken === 'string' && response.accessToken.length > 0 &&
    typeof response.refreshToken === 'string' && response.refreshToken.length > 0 &&
    typeof response.expiresIn === 'number' && Number.isFinite(response.expiresIn) && response.expiresIn > 0;
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  request: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...request, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

export function createSessionService(dependencies: SessionServiceDependencies = {}) {
  const baseUrl = (dependencies.baseUrl ?? process.env.EXPO_PUBLIC_COURSE_BACKEND_URL ?? DEFAULT_BASE_URL)
    .replace(/\/$/, '');
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const tokenStore = dependencies.tokenStore ?? lazyTokenStore;
  const now = dependencies.now ?? Date.now;
  let refreshInFlight: Promise<FetchResult<string>> | null = null;
  let generation = 0;
  let expiresAt: number | null = null;

  async function readTokens(): Promise<SessionTokens | null> {
    try {
      return await tokenStore.readSessionTokens();
    } catch {
      return null;
    }
  }

  async function refreshAccessToken(): Promise<FetchResult<string>> {
    if (refreshInFlight) return refreshInFlight;
    const refreshGeneration = generation;
    transitionSessionLifecycle('access-token-expired');
    transitionSessionLifecycle('refresh-started');
    const operation = (async (): Promise<FetchResult<string>> => {
      try {
        const currentTokens = await tokenStore.readSessionTokens();
        if (!currentTokens) return await failRefresh(tokenStore, refreshGeneration, generation);
        const response = await fetchWithTimeout(fetchImpl, `${baseUrl}/v1/session/refresh`, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: currentTokens.refreshToken }),
        });
        if (!response.ok) {
          reportCampusOpsError('backend_http_error', { status: response.status });
          return await failRefresh(tokenStore, refreshGeneration, generation);
        }
        const payload: unknown = await response.json().catch(() => undefined);
        if (!isRefreshResponse(payload)) {
          reportCampusOpsError('backend_contract_mismatch', { status: response.status });
          return await failRefresh(tokenStore, refreshGeneration, generation);
        }
        if (refreshGeneration !== generation) return { ok: false, reason: { kind: 'session-expired' } };
        await tokenStore.saveSessionTokens({ accessToken: payload.accessToken, refreshToken: payload.refreshToken });
        if (refreshGeneration !== generation) {
          await tokenStore.deleteSessionTokens();
          return { ok: false, reason: { kind: 'session-expired' } };
        }
        expiresAt = now() + payload.expiresIn * 1000;
        generation += 1;
        transitionSessionLifecycle('refresh-succeeded');
        return { ok: true, value: payload.accessToken };
      } catch {
        reportCampusOpsError('backend_request_failed', { status: 'network_error' });
        return await failRefresh(tokenStore, refreshGeneration, generation);
      }
    })();
    const shared = operation.finally(() => {
      if (refreshInFlight === shared) refreshInFlight = null;
    });
    refreshInFlight = shared;
    return shared;
  }

  return {
    async login(actorId: CourseActorId): Promise<FetchResult<SessionIdentity>> {
      generation += 1;
      const loginGeneration = generation;
      transitionSessionLifecycle('login-started');
      let response: Response;
      try {
        response = await fetchWithTimeout(fetchImpl, `${baseUrl}/v1/session/login`, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ actorId }),
        });
      } catch {
        reportCampusOpsError('backend_request_failed', { status: 'network_error' });
        transitionSessionLifecycle('login-failed');
        return { ok: false, reason: { kind: 'server-error', status: 0 } };
      }
      if (!response.ok) {
        reportCampusOpsError('backend_http_error', { status: response.status });
        transitionSessionLifecycle('login-failed');
        return { ok: false, reason: { kind: 'server-error', status: response.status } };
      }

      const payload: unknown = await response.json().catch(() => undefined);
      if (!isLoginResponse(payload)) {
        reportCampusOpsError('backend_contract_mismatch', { status: response.status });
        transitionSessionLifecycle('login-failed');
        return { ok: false, reason: { kind: 'contract-invalid' } };
      }

      if (loginGeneration !== generation) return { ok: false, reason: { kind: 'session-expired' } };

      try {
        await tokenStore.saveSessionTokens({
          accessToken: payload.accessToken,
          refreshToken: payload.refreshToken,
        });
      } catch {
        reportCampusOpsError('session_storage_failed', { operation: 'save' });
        transitionSessionLifecycle('login-failed');
        return { ok: false, reason: { kind: 'server-error', status: 0 } };
      }

      transitionSessionLifecycle('login-succeeded');
      expiresAt = now() + payload.expiresIn * 1000;
      return {
        ok: true,
        value: {
          actorId: payload.actorId,
          role: payload.role,
          expiresIn: payload.expiresIn,
        },
      };
    },

    async refresh(): Promise<FetchResult<null>> {
      const result = await refreshAccessToken();
      return result.ok ? { ok: true, value: null } : result;
    },

    async getAccessToken(): Promise<FetchResult<string>> {
      const tokens = await readTokens();
      if (!tokens) return { ok: false, reason: { kind: 'session-expired' } };
      if (expiresAt !== null && now() >= expiresAt) return refreshAccessToken();
      return { ok: true, value: tokens.accessToken };
    },

    async refreshAfterUnauthorized(observedAccessToken: string): Promise<FetchResult<string>> {
      const tokens = await readTokens();
      if (!tokens) return await failRefresh(tokenStore, generation, generation);
      if (tokens.accessToken !== observedAccessToken) return { ok: true, value: tokens.accessToken };
      return refreshAccessToken();
    },

    async logout(): Promise<FetchResult<null>> {
      generation += 1;
      expiresAt = null;
      const pendingRefresh = refreshInFlight;
      if (pendingRefresh) await pendingRefresh;
      try {
        await tokenStore.deleteSessionTokens();
        transitionSessionLifecycle('logout');
        return { ok: true, value: null };
      } catch {
        reportCampusOpsError('session_storage_failed', { operation: 'clear' });
        transitionSessionLifecycle('logout');
        return { ok: false, reason: { kind: 'server-error', status: 0 } };
      }
    },
  };
}

async function failRefresh(
  tokenStore: SessionTokenStore,
  operationGeneration: number,
  currentGeneration: number,
): Promise<FetchResult<string>> {
  if (operationGeneration === currentGeneration) {
    try {
      await tokenStore.deleteSessionTokens();
      transitionSessionLifecycle('refresh-failed');
    } catch {
      reportCampusOpsError('session_storage_failed', { operation: 'clear' });
      transitionSessionLifecycle('refresh-failed');
    }
  }
  return { ok: false, reason: { kind: 'session-expired' } };
}

export const sessionService = createSessionService();
