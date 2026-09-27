import { reportCampusOpsError } from '../telemetry/safeTelemetry';

export type BackendHealth = Readonly<{
  ok: true;
  service: 'dmi-controlled-backend';
  contractVersion: 1;
}>;

const DEFAULT_URL = 'http://127.0.0.1:4310';

class CampusOpsSafeError extends Error {}

export async function getBackendHealth(
  baseUrl = process.env.EXPO_PUBLIC_COURSE_BACKEND_URL ?? DEFAULT_URL,
): Promise<BackendHealth> {
  try {
    const response = await fetch(`${baseUrl}/health`);
    if (!response.ok) {
      reportCampusOpsError('backend_http_error', { status: response.status });
      throw new CampusOpsSafeError('CampusOps service is unavailable.');
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
      reportCampusOpsError('backend_contract_mismatch', { status: response.status });
      throw new CampusOpsSafeError('CampusOps service returned an invalid response.');
    }
    return payload as BackendHealth;
  } catch (error) {
    if (error instanceof CampusOpsSafeError) {
      throw error;
    }
    reportCampusOpsError('backend_request_failed', { status: 'network_error' });
    throw new CampusOpsSafeError('CampusOps service is unavailable.');
  }
}
