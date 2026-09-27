import { redactForTelemetry } from '../../src/course-evaluation';
import { configureTelemetrySink, reportCampusOpsError } from '../../src/telemetry/safeTelemetry';
import { getBackendHealth } from '../../src/api/courseBackend';

afterEach(() => {
  configureTelemetrySink(null);
  jest.restoreAllMocks();
});

test('CampusOps redacts personal and incident-sensitive data while preserving technical context', () => {
  const result = redactForTelemetry({
    request: { headers: { authorization: 'Bearer course-token', accept: 'application/json' } },
    profile: { email: 'person@campusops.test', displayName: 'Persona ficticia' },
    incidentId: 'campus-inc-001',
    location: 'Zona ficticia',
    photos: ['synthetic-photo-1'],
    internalComments: ['Nota interna ficticia'],
  });
  expect(result).toEqual({
    request: { headers: { authorization: '[REDACTED]', accept: 'application/json' } },
    profile: { email: '[REDACTED]', displayName: '[REDACTED]' },
    incidentId: 'campus-inc-001',
    location: '[REDACTED]',
    photos: '[REDACTED]',
    internalComments: '[REDACTED]',
  });
});

test('redacts nested objects and lists without mutating the original structure', () => {
  const input = {
    incidentId: 'campus-inc-synthetic',
    assignments: [
      {
        assigned_technician_id: 'technician-synthetic',
        photo_metadata: [{ fileName: 'synthetic.jpg', latitude: 19.4 }],
      },
    ],
    request: { 'refresh-token': 'synthetic-refresh-token', status: 'timeout' },
  };

  expect(redactForTelemetry(input)).toEqual({
    incidentId: 'campus-inc-synthetic',
    assignments: [
      {
        assigned_technician_id: '[REDACTED]',
        photo_metadata: [{ fileName: 'synthetic.jpg', latitude: '[REDACTED]' }],
      },
    ],
    request: { 'refresh-token': '[REDACTED]', status: 'timeout' },
  });
  expect(input.assignments[0]?.assigned_technician_id).toBe('technician-synthetic');
  expect(input.request['refresh-token']).toBe('synthetic-refresh-token');
});

test('redacts nested photos and evidence without mutating the input', () => {
  const input = {
    incident: {
      updates: [
        {
          kind: 'field_note',
          photos: ['synthetic-photo-uri'],
          details: {
            evidence: [{ fileName: 'synthetic-proof.jpg', uri: 'synthetic-evidence-uri' }],
            note: 'Nota sintética segura',
          },
        },
      ],
    },
  };
  const original = structuredClone(input);

  expect(redactForTelemetry(input)).toEqual({
    incident: {
      updates: [
        {
          kind: 'field_note',
          photos: '[REDACTED]',
          details: {
            evidence: '[REDACTED]',
            note: 'Nota sintética segura',
          },
        },
      ],
    },
  });
  expect(input).toEqual(original);
});

test('error telemetry redacts sensitive context while preserving technical fields', () => {
  const send = jest.fn();
  configureTelemetrySink(send);

  reportCampusOpsError('backend_request_failed', {
    accessToken: 'synthetic-token',
    userId: 'synthetic-user',
    location: 'Zona ficticia',
    internalComments: 'Comentario ficticio',
    correlationId: 'correlation-synthetic',
    status: 503,
    attempt: 2,
  });

  expect(send).toHaveBeenCalledWith({
    event: 'campusops.error',
    errorCode: 'backend_request_failed',
    context: {
      accessToken: '[REDACTED]',
      userId: '[REDACTED]',
      location: '[REDACTED]',
      internalComments: '[REDACTED]',
      correlationId: 'correlation-synthetic',
      status: 503,
      attempt: 2,
    },
  });

});

test('backend failure exposes only a generic error and safe telemetry context', async () => {
  const send = jest.fn();
  configureTelemetrySink(send);
  jest.spyOn(global, 'fetch').mockRejectedValue(new Error('synthetic-token and private location'));

  await expect(getBackendHealth('http://127.0.0.1:4310')).rejects.toThrow(
    'CampusOps service is unavailable.',
  );
  expect(send).toHaveBeenCalledWith({
    event: 'campusops.error',
    errorCode: 'backend_request_failed',
    context: { status: 'network_error' },
  });
  expect(JSON.stringify(send.mock.calls)).not.toContain('synthetic-token');
  expect(JSON.stringify(send.mock.calls)).not.toContain('private location');
});
