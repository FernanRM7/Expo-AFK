import { configureTelemetrySink, reportCampusOpsError } from './safeTelemetry';

afterEach(() => configureTelemetrySink(null));

test('CampusOps error telemetry keeps safe context and removes nested sensitive values', () => {
  const send = jest.fn();
  const context = {
    correlationId: 'corr-synthetic-1',
    status: 500,
    attempt: 2,
    request: { access_token: 'synthetic-token', location: 'Zona ficticia' },
    internal_comments: ['Nota ficticia'],
  };

  configureTelemetrySink(send);
  reportCampusOpsError('backend_request_failed', context);

  expect(send).toHaveBeenCalledWith({
    event: 'campusops.error',
    errorCode: 'backend_request_failed',
    context: {
      correlationId: 'corr-synthetic-1',
      status: 500,
      attempt: 2,
      request: { access_token: '[REDACTED]', location: '[REDACTED]' },
      internal_comments: '[REDACTED]',
    },
  });
  expect(context.request.access_token).toBe('synthetic-token');
});

test('telemetry sink failure does not escape into the app error path', () => {
  configureTelemetrySink(() => {
    throw new Error('transport failure');
  });

  expect(() => reportCampusOpsError('backend_request_failed', { status: 500 })).not.toThrow();
});
