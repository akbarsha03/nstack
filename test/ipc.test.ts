import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serve, send, socketPath } from '../src/ipc.js';

test('add from a terminal reaches the running shell; no shell = undefined', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nstack-ipc-'));
  assert.equal(await send(dir, { add: 'x' }), undefined);
  const got: unknown[] = [];
  const server = await serve(dir, msg => { got.push(msg); if (msg.boom) throw new Error('nope'); return { ok: true, lines: ['added'] }; });
  try {
    assert.deepEqual(await send(dir, { add: { name: 'cashier' } }), { ok: true, lines: ['added'] });
    assert.deepEqual(await send(dir, { boom: 1 }), { error: 'nope' });
    assert.deepEqual(got, [{ add: { name: 'cashier' } }, { boom: 1 }]);
  } finally {
    server.close();
  }
  assert.notEqual(socketPath(dir), socketPath(dir + '-other'));
  assert.ok(Buffer.byteLength(socketPath('/a/very/long/project/path/'.repeat(10))) < 100);
});
