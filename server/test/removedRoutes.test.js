import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

test('retired APIs are unmounted while built-in and source APIs keep their authentication guards', { timeout: 20000 }, async t => {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const { port } = reservation.address();
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.js', import.meta.url))], {
    windowsHide: true,
    // Empty DATABASE_URL takes precedence over dotenv: no shared DB connection,
    // startup migrations, credentials, source syncs or persistent writes.
    env: { ...process.env, DATABASE_URL: '', NODE_ENV: 'development', PORT: String(port), GOOGLE_CLIENT_ID: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.resume();
  child.stderr.resume();
  t.after(async () => {
    if (child.exitCode !== null) return;
    const ended = once(child, 'exit');
    child.kill();
    await ended;
  });
  const base = `http://127.0.0.1:${port}/api`;
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    assert.equal(child.exitCode, null, 'isolated server exited before it was ready');
    try { ready = (await fetch(base + '/auth/config')).ok; } catch { /* startup */ }
    if (ready) break;
    await delay(100);
  }
  assert.ok(ready, 'isolated server is listening');
  for (const path of ['/charts', '/charts/preview', '/charts/inspect', '/charts/options/source', '/charts/id', '/charts/id/data', '/custom-dashboards', '/custom-dashboards/id']) {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
      const response = await fetch(base + path, { method });
      assert.equal(response.status, 404, `${method} ${path} must be unmounted`);
    }
  }
  assert.equal((await fetch(base + '/datasources/source/schema')).status, 404);
  for (const path of ['/templates', '/datasources', '/dashboards/win-board/state', '/win-board/snapshot', '/share-tokens']) {
    assert.equal((await fetch(base + path)).status, 401, `${path} retains authentication`);
  }
  assert.equal((await fetch(base + '/share-tokens', { method: 'POST' })).status, 401);
});
