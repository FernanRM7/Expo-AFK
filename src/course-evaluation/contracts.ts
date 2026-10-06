export type JsonObject = Readonly<Record<string, unknown>>;

export type ParseResult =
  | Readonly<{ ok: true; value: { id: string; version: number; status: string; payload: JsonObject | null } }>
  | Readonly<{ ok: false; error: 'contract' }>;

export type AuthEvent = Readonly<{
  type: 'request401' | 'refreshSucceeded' | 'refreshFailed' | 'logout';
  requestId?: string;
  generation?: number;
  token?: string;
}>;

export type SyncRecord = Readonly<{ id: string; version: number; fields: JsonObject }>;

export type RemoteResponse = Readonly<{ requestId: string; value?: unknown; error?: string }>;

export type PermissionEvent = 'granted' | 'paused' | 'revoked' | 'resumed' | 'denied_permanently';

export type FetchErrorReason =
  | Readonly<{ kind: 'contract-invalid' }>
  | Readonly<{ kind: 'timeout' }>
  | Readonly<{ kind: 'session-expired' }>
  | Readonly<{ kind: 'server-error'; status: number }>;

export type FetchResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; reason: FetchErrorReason }>;