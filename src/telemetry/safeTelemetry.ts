import { redactForTelemetry } from '../course-evaluation';

export type CampusOpsTelemetryEvent = Readonly<{
  event: 'campusops.error';
  errorCode: string;
  context: unknown;
}>;

export type TelemetrySink = (event: CampusOpsTelemetryEvent) => void;

let sink: TelemetrySink = () => undefined;
const SAFE_ERROR_CODES = new Set([
  'backend_http_error',
  'backend_contract_mismatch',
  'backend_request_failed',
]);

/** Installs the app's telemetry transport. Call with null to disable it. */
export function configureTelemetrySink(nextSink: TelemetrySink | null): void {
  sink = nextSink ?? (() => undefined);
}

/** Reports a fixed error category and sanitized, structured technical context. */
export function reportCampusOpsError(errorCode: string, context: unknown): void {
  const safeCode = SAFE_ERROR_CODES.has(errorCode) ? errorCode : 'unknown_error';
  const event: CampusOpsTelemetryEvent = {
    event: 'campusops.error',
    errorCode: safeCode,
    context: redactForTelemetry(context),
  };

  try {
    sink(event);
  } catch {
    // A telemetry outage must not replace or expose the original app error.
  }
}
