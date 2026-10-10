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
}>;

const DEFAULT_BASE_URL = 'http://127.0.0.1:4310';
const REQUEST_TIMEOUT_MS = 5000;
let refreshInFlight: Promise<FetchResult<null>> | null = null;
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

  return {
    async login(actorId: CourseActorId): Promise<FetchResult<SessionIdentity>> {
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
      if (!refreshInFlight) {
        transitionSessionLifecycle('access-token-expired');
        transitionSessionLifecycle('refresh-started');
        const operation = (async (): Promise<FetchResult<null>> => {
          try {
            const currentTokens = await tokenStore.readSessionTokens();
            if (!currentTokens) return await failRefresh(tokenStore);
            const response = await fetchWithTimeout(fetchImpl, `${baseUrl}/v1/session/refresh`, {
              method: 'POST',
              headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
              body: JSON.stringify({ refreshToken: currentTokens.refreshToken }),
            });
            if (!response.ok) {
              reportCampusOpsError('backend_http_error', { status: response.status });
              return await failRefresh(tokenStore);
            }
            const payload: unknown = await response.json().catch(() => undefined);
            if (!isRefreshResponse(payload)) {
              reportCampusOpsError('backend_contract_mismatch', { status: response.status });
              return await failRefresh(tokenStore);
            }
            await tokenStore.saveSessionTokens({
              accessToken: payload.accessToken,
              refreshToken: payload.refreshToken,
            });
            transitionSessionLifecycle('refresh-succeeded');
            return { ok: true, value: null };
          } catch {
            reportCampusOpsError('backend_request_failed', { status: 'network_error' });
            return await failRefresh(tokenStore);
          }
        })();
        const shared = operation.finally(() => {
          if (refreshInFlight === shared) refreshInFlight = null;
        });
        refreshInFlight = shared;
      }
      return refreshInFlight;
    },

    async logout(): Promise<FetchResult<null>> {
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

async function failRefresh(tokenStore: SessionTokenStore): Promise<FetchResult<null>> {
  try {
    await tokenStore.deleteSessionTokens();
  } catch {
    reportCampusOpsError('session_storage_failed', { operation: 'clear' });
  }
  transitionSessionLifecycle('refresh-failed');
  return { ok: false, reason: { kind: 'session-expired' } };
}

export const sessionService = createSessionService();