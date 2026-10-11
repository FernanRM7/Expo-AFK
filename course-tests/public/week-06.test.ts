import { coordinateRefresh } from '../../src/course-evaluation';

test('coalesces concurrent 401s into one refresh and retries each request once', () => {
  const summary = coordinateRefresh([
    { type: 'request401', requestId: 'a', generation: 0 },
    { type: 'request401', requestId: 'b', generation: 0 },
    { type: 'request401', requestId: 'c', generation: 0 },
    { type: 'refreshSucceeded', generation: 1, token: 'course-token-1' },
  ]);
  expect(summary).toEqual({
    status: 'authenticated',
    activeGeneration: 1,
    refreshCalls: 1,
    retriedRequestIds: ['a', 'b', 'c'],
    persistedToken: 'course-token-1',
  });
});

test('logout removes persisted session state', () => {
  expect(coordinateRefresh([{ type: 'logout' }]).persistedToken).toBeNull();
});

test('a failed refresh clears pending retries and returns to anonymous', () => {
  expect(coordinateRefresh([
    { type: 'request401', requestId: 'request-a', generation: 0 },
    { type: 'request401', requestId: 'request-b', generation: 0 },
    { type: 'refreshFailed', generation: 0 },
  ])).toEqual({
    status: 'anonymous',
    activeGeneration: null,
    refreshCalls: 1,
    retriedRequestIds: [],
    persistedToken: null,
  });
});

test('an obsolete refresh failure cannot erase a newer authenticated generation', () => {
  expect(coordinateRefresh([
    { type: 'request401', requestId: 'before-refresh', generation: 0 },
    { type: 'refreshSucceeded', generation: 1, token: 'synthetic-generation-one' },
    { type: 'refreshFailed', generation: 0 },
    { type: 'request401', requestId: 'late-401', generation: 0 },
  ])).toEqual({
    status: 'authenticated',
    activeGeneration: 1,
    refreshCalls: 1,
    retriedRequestIds: ['before-refresh', 'late-401'],
    persistedToken: 'synthetic-generation-one',
  });
});
