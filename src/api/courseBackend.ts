export type BackendHealth = Readonly<{
  ok: true;
  service: 'dmi-controlled-backend';
  contractVersion: 1;
}>;

function resolveBackendUrl(): string {
  const url = process.env.EXPO_PUBLIC_COURSE_BACKEND_URL;
  if (!url) {
    throw new Error(
      'EXPO_PUBLIC_COURSE_BACKEND_URL no está configurada. Define esta variable en tu archivo .env (ver .env.example).',
    );
  }
  return url;
}

export async function getBackendHealth(
  baseUrl = resolveBackendUrl(),
): Promise<BackendHealth> {
  const response = await fetch(`${baseUrl}/health`);
  if (!response.ok) {
    throw new Error(`Backend health failed with ${response.status}`);
  }
  const payload: unknown = await response.json();
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('ok' in payload) ||
    payload.ok !== true ||
    !('contractVersion' in payload) ||
    payload.contractVersion !== 1
  ) {
    throw new Error('Backend health contract mismatch');
  }
  return payload as BackendHealth;
}
