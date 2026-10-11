import { parseRemoteResource } from '../../src/course-evaluation';

test('parses a remote DTO without interpreting its payload as a domain incident', () => {
  const payload = { category: 'connectivity', description: 'Falla sintética' };

  expect(parseRemoteResource({
    id: 'campus-inc-001',
    version: 2,
    status: 'assigned',
    payload,
  })).toEqual({
    ok: true,
    value: { id: 'campus-inc-001', version: 2, status: 'assigned', payload },
  });
});

test('preserves a valid null payload without fabricating domain data', () => {
  expect(parseRemoteResource({
    id: 'campus-inc-002',
    version: 0,
    status: 'open',
    payload: null,
  })).toEqual({
    ok: true,
    value: { id: 'campus-inc-002', version: 0, status: 'open', payload: null },
  });
});

test.each([
  ['empty id', { id: '', version: 1, status: 'open', payload: null }],
  ['blank id', { id: '  ', version: 1, status: 'open', payload: null }],
  ['non-string id', { id: 7, version: 1, status: 'open', payload: null }],
  ['empty status', { id: 'incident-1', version: 1, status: '', payload: null }],
  ['non-string status', { id: 'incident-1', version: 1, status: 1, payload: null }],
  ['string version', { id: 'incident-1', version: '1', status: 'open', payload: null }],
  ['negative version', { id: 'incident-1', version: -1, status: 'open', payload: null }],
  ['fractional version', { id: 'incident-1', version: 1.5, status: 'open', payload: null }],
  ['missing payload', { id: 'incident-1', version: 1, status: 'open' }],
  ['array payload', { id: 'incident-1', version: 1, status: 'open', payload: [] }],
  ['primitive payload', { id: 'incident-1', version: 1, status: 'open', payload: 'invalid' }],
  ['null envelope', null],
  ['array envelope', []],
])('rejects malformed remote DTO: %s', (_caseName, input) => {
  expect(parseRemoteResource(input)).toEqual({ ok: false, error: 'contract' });
});

test('ignores future envelope fields while preserving the known DTO result', () => {
  expect(parseRemoteResource({
    id: 'incident-future',
    version: 4,
    status: 'resolved',
    payload: { category: 'equipment' },
    futureMetadata: { revision: 'next-contract' },
  })).toEqual({
    ok: true,
    value: {
      id: 'incident-future',
      version: 4,
      status: 'resolved',
      payload: { category: 'equipment' },
    },
  });
});
