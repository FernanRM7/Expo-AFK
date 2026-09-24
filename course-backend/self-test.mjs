import { spawn } from 'node:child_process';
import { testCampusOps } from './campusops-self-test.mjs';

const deniedBind = spawn(process.execPath, ['course-backend/server.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, COURSE_BACKEND_HOST: '0.0.0.0', COURSE_BACKEND_PORT: '0', COURSE_BACKEND_ALLOW_REMOTE: '' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
const deniedBindError = await new Promise((resolve, reject) => {
  let stderr = '';
  deniedBind.stderr.setEncoding('utf8');
  deniedBind.stderr.on('data', (chunk) => { stderr += chunk; });
  deniedBind.once('error', reject);
  deniedBind.once('exit', (code) => resolve({ code, stderr }));
});
if (deniedBindError.code !== 1 || !deniedBindError.stderr.includes('Refusing non-loopback bind')) {
  throw new Error('backend must refuse remote binding without explicit opt-in');
}

const child = spawn(process.execPath, ['course-backend/server.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, COURSE_BACKEND_PORT: '0' },
  stdio: ['ignore', 'pipe', 'inherit'],
});

const baseUrl = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('backend startup timeout')), 5000);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    const match = chunk.match(/(http:\/\/127\.0\.0\.1:\d+)/);
    if (match) {
      clearTimeout(timeout);
      resolve(match[1]);
    }
  });
  child.once('exit', (code) => reject(new Error(`backend exited early: ${code}`)));
});

async function expectStatus(path, status, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  if (response.status !== status) throw new Error(`${path}: expected ${status}, received ${response.status}`);
  return response.json();
}

try {
  const health = await expectStatus('/health', 200);
  if (health.contractVersion !== 1) throw new Error('health contract mismatch');
  const allowedOrigin = await fetch(`${baseUrl}/health`, { headers: { Origin: 'http://localhost:8081' } });
  if (allowedOrigin.headers.get('access-control-allow-origin') !== 'http://localhost:8081') {
    throw new Error('configured development origin should receive CORS access');
  }
  const untrustedOrigin = await fetch(`${baseUrl}/health`, { headers: { Origin: 'https://untrusted.example' } });
  if (untrustedOrigin.headers.has('access-control-allow-origin')) {
    throw new Error('untrusted origin must not receive CORS access');
  }
  await expectStatus('/v1/resources', 401);
  const resources = await expectStatus('/v1/resources', 200, {
    headers: { Authorization: 'Bearer course-valid-token', 'X-Course-Scenario': 'nullable' },
  });
  if (resources.items[0].payload !== null) throw new Error('nullable scenario mismatch');
  const action = { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'self-test-operation' }, body: JSON.stringify({ resourceId: 'resource-1' }) };
  await expectStatus('/v1/resources/action', 201, action);
  const replay = await expectStatus('/v1/resources/action', 200, action);
  if (replay.duplicate !== true) throw new Error('idempotency replay mismatch');
  await testCampusOps(baseUrl);
  process.stdout.write('Controlled backend self-test passed.\n');
} finally {
  child.kill('SIGTERM');
}
